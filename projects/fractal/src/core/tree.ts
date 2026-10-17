// Reading the tree: one index over every level, normalization, and the invariants.
// (Normalization follows the idea of Trellis's model/tree.ts `normalize`; written fresh.)

import type { LayoutDoc, Node, Panel, Split } from './types.ts';
import { kindOf } from './kinds.ts';

/** Where a node sits: the top of the layout, a split's child, or the root of an app's dock. */
export type Owner =
  | { type: 'root' }
  | { type: 'split'; id: string; index: number }
  | { type: 'dock'; app: string };

export interface TreeIndex {
  nodes: Map<string, Node>;
  owner: Map<string, Owner>;
  /** App id → the panel that holds it. */
  panelOf: Map<string, string>;
  /** How many host boundaries lie above a node. */
  depth: Map<string, number>;
}

/** Index the whole document, docks of unselected tabs included. Safe on bad input: a node or app
 * seen twice is indexed once, so a cycle can't loop. */
export function indexDoc(doc: LayoutDoc): TreeIndex {
  const idx: TreeIndex = { nodes: new Map(), owner: new Map(), panelOf: new Map(), depth: new Map() };
  const visit = (node: Node, owner: Owner, depth: number) => {
    if (idx.nodes.has(node.id)) return;
    idx.nodes.set(node.id, node);
    idx.owner.set(node.id, owner);
    idx.depth.set(node.id, depth);
    if (node.kind === 'split') {
      node.children.forEach((c, index) => visit(c, { type: 'split', id: node.id, index }, depth));
      return;
    }
    for (const app of node.tabs) {
      if (idx.panelOf.has(app)) continue;
      idx.panelOf.set(app, node.id);
      const dock = doc.apps[app]?.dock;
      if (dock) visit(dock, { type: 'dock', app }, depth + 1);
    }
  };
  if (doc.root) visit(doc.root, { type: 'root' }, 0);
  return idx;
}

/** Every app id under a node, through every dock. */
export function appsIn(doc: LayoutDoc, node: Node, out: string[] = [], seen = new Set<string>()): string[] {
  if (seen.has(node.id)) return out;
  seen.add(node.id);
  if (node.kind === 'split') {
    for (const c of node.children) appsIn(doc, c, out, seen);
    return out;
  }
  for (const app of node.tabs) {
    out.push(app);
    const dock = doc.apps[app]?.dock;
    if (dock) appsIn(doc, dock, out, seen);
  }
  return out;
}

/** The host app whose dock this node is the root of, if any. */
export function dockHost(idx: TreeIndex, id: string): string | null {
  const o = idx.owner.get(id);
  return o?.type === 'dock' ? o.app : null;
}

function sameWeights(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
}

/** Collapse single-child splits, flatten same-axis children, drop empty panels, fix weights.
 * Returns the same object when nothing changed. Docks are normalized by `normalizeDoc`. */
export function normalize(node: Node | null): Node | null {
  if (!node) return null;
  if (node.kind === 'panel') {
    if (!node.tabs.length) return null;
    if (node.tabs.includes(node.selected)) return node;
    return { ...node, selected: node.tabs[0] };
  }
  const children: Node[] = [];
  const weights: number[] = [];
  const raw = node.weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 1e-3));
  let changed = raw.some((w, i) => w !== node.weights[i]) || raw.length !== node.children.length;
  node.children.forEach((child, i) => {
    const n = normalize(child);
    if (n !== child) changed = true;
    if (!n) return;
    const w = raw[i] ?? 1;
    if (n.kind === 'split' && n.axis === node.axis) {
      changed = true;
      const sum = n.weights.reduce((a, b) => a + b, 0);
      n.children.forEach((g, j) => {
        children.push(g);
        weights.push((w * n.weights[j]) / sum);
      });
    } else {
      children.push(n);
      weights.push(w);
    }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  const sum = weights.reduce((a, b) => a + b, 0);
  const norm = weights.map((w) => w / sum);
  if (!changed && sameWeights(norm, node.weights)) return node;
  return { ...node, children, weights: norm };
}

/** Normalize the root and every dock. An emptied dock becomes null rather than vanishing. */
export function normalizeDoc(doc: LayoutDoc): LayoutDoc {
  let apps = doc.apps;
  for (const [id, rec] of Object.entries(doc.apps)) {
    if (rec.dock === undefined) continue;
    const dock = normalize(rec.dock);
    if (dock !== rec.dock) {
      if (apps === doc.apps) apps = { ...doc.apps };
      apps[id] = { ...rec, dock };
    }
  }
  const root = normalize(doc.root);
  if (root === doc.root && apps === doc.apps) return doc;
  return { ...doc, root, apps };
}

/** Problems with a document, as short strings. Empty means valid. */
export function check(doc: LayoutDoc): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const appSeen = new Set<string>();
  const walk = (node: Node, path: Set<string>) => {
    if (ids.has(node.id)) problems.push(`duplicate id ${node.id}`);
    ids.add(node.id);
    if (node.kind === 'split') {
      if (node.children.length < 2) problems.push(`split ${node.id} has fewer than 2 children`);
      if (node.weights.length !== node.children.length) problems.push(`split ${node.id} weights mismatch`);
      if (node.weights.some((w) => !(w > 0))) problems.push(`split ${node.id} has a non-positive weight`);
      for (const c of node.children) {
        if (c.kind === 'split' && c.axis === node.axis) problems.push(`split ${c.id} on the same axis as its parent`);
        walk(c, path);
      }
      return;
    }
    if (!node.tabs.length) problems.push(`panel ${node.id} is empty`);
    if (!node.tabs.includes(node.selected)) problems.push(`panel ${node.id} selects a missing tab`);
    for (const app of node.tabs) {
      const rec = doc.apps[app];
      if (!rec) {
        problems.push(`panel ${node.id} holds missing app ${app}`);
        continue;
      }
      if (appSeen.has(app)) problems.push(`app ${app} is in more than one panel`);
      appSeen.add(app);
      if (rec.dock !== undefined && !kindOf(rec.kind).hosts) problems.push(`app ${app} has a dock but can't host`);
      if (rec.dock) {
        if (path.has(app)) {
          problems.push(`app ${app} is inside its own dock`);
          continue;
        }
        path.add(app);
        walk(rec.dock, path);
        path.delete(app);
      }
    }
  };
  if (doc.root) walk(doc.root, new Set());
  for (const id of Object.keys(doc.apps)) {
    if (!appSeen.has(id)) problems.push(`app ${id} is not in the layout`);
    const f = doc.apps[id].follows;
    if (f !== undefined) {
      if (f === id) problems.push(`app ${id} follows itself`);
      else if (!doc.apps[f]) problems.push(`app ${id} follows missing app ${f}`);
    }
  }
  return problems;
}

export function isSplit(n: Node | undefined): n is Split {
  return n?.kind === 'split';
}

export function isPanel(n: Node | undefined): n is Panel {
  return n?.kind === 'panel';
}
