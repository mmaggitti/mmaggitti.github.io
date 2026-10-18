// Arranging: moving tabs and panels, adding and closing. Every op is immutable and returns a
// normalized document, or null when it isn't allowed (a cycle, a target that doesn't exist).
//
// A move first leaves a tombstone where the source was, then inserts at the target, then sweeps
// the tombstones away. So a target taken from the current layout (a tab index, a seam index) still
// means what it meant on screen, even when the source sits before it in the same list.

import type { AppRecord, LayoutDoc, Node, Panel } from './types.ts';
import { appsIn, indexDoc, normalizeDoc, type TreeIndex } from './tree.ts';
import { kindOf } from './kinds.ts';
import { updateNode } from './ops.ts';
import { resolveFrame } from './layout.ts';
import { resolveVisit, visitOf } from './history.ts';

export type Side = 'left' | 'right' | 'top' | 'bottom';

export type Payload = { kind: 'tab'; app: string } | { kind: 'panel'; panel: string };

export type Target =
  /** Into a panel's tab strip, before the tab at `index` (tabs.length appends). */
  | { kind: 'tab'; panel: string; index: number }
  /** A new child of a split, before child `index`. */
  | { kind: 'seam'; split: string; index: number }
  /** Beside a node: wrap it in a new split. */
  | { kind: 'edge'; node: string; side: Side }
  /** Into a host's empty dock, or the empty root (host null). */
  | { kind: 'dock'; host: string | null };

const TOMB = '\u0000tomb';

/** A panel or split id that isn't used yet, prefix + a number. Every tree is scanned, the root and
 * every app's dock, reachable or not: a lifted group's dock is out of the index but still in use. */
export function freshId(doc: LayoutDoc, prefix: string): string {
  const used = new Set<string>(Object.keys(doc.apps));
  const walk = (n: Node | null | undefined) => {
    if (!n) return;
    used.add(n.id);
    if (n.kind === 'split') n.children.forEach(walk);
  };
  walk(doc.root);
  for (const rec of Object.values(doc.apps)) walk(rec.dock);
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/** The apps a payload carries, docks and all. */
function carried(doc: LayoutDoc, idx: TreeIndex, payload: Payload): Set<string> | null {
  if (payload.kind === 'tab') {
    if (!idx.panelOf.has(payload.app)) return null;
    const out = new Set([payload.app]);
    const dock = doc.apps[payload.app]?.dock;
    if (dock) appsIn(doc, dock).forEach((a) => out.add(a));
    return out;
  }
  const node = idx.nodes.get(payload.panel);
  if (node?.kind !== 'panel') return null;
  return new Set(appsIn(doc, node));
}

/** Is `node` inside the dock of one of these apps, at any depth? (Or is it the dock host itself?) */
function insideOf(idx: TreeIndex, node: string, apps: Set<string>): boolean {
  let cur = node;
  for (let guard = 0; guard < 10000; guard++) {
    const owner = idx.owner.get(cur);
    if (!owner || owner.type === 'root') return false;
    if (owner.type === 'split') {
      cur = owner.id;
      continue;
    }
    if (apps.has(owner.app)) return true;
    const panel = idx.panelOf.get(owner.app);
    if (!panel) return false;
    cur = panel;
  }
  return false;
}

/** The node a target attaches to, for the cycle check (null: the root). */
function anchorOf(idx: TreeIndex, target: Target): string | null | undefined {
  switch (target.kind) {
    case 'tab':
      return target.panel;
    case 'seam':
      return target.split;
    case 'edge':
      return target.node;
    case 'dock':
      return target.host === null ? null : idx.panelOf.get(target.host);
  }
}

/** Where a payload may go: never into its own dock, and only to targets that exist. */
export function canDrop(doc: LayoutDoc, payload: Payload, target: Target, idx = indexDoc(doc)): boolean {
  return move(doc, payload, target, idx) !== null;
}

/** Move a tab or a whole panel to a target. Null when not allowed; the same doc when it changes
 * nothing (a drop onto itself). */
export function move(doc: LayoutDoc, payload: Payload, target: Target, idx = indexDoc(doc)): LayoutDoc | null {
  const apps = carried(doc, idx, payload);
  if (!apps) return null;
  if (!validTarget(doc, idx, target)) return null;
  const anchor = anchorOf(idx, target);
  if (anchor === undefined) return null;
  if (target.kind === 'dock' && target.host !== null && apps.has(target.host)) return null;
  if (anchor !== null && insideOf(idx, anchor, apps)) return null;
  if (payload.kind === 'panel' && anchor === payload.panel && target.kind !== 'seam') return doc;

  let piece: Piece;
  let out: LayoutDoc;
  if (payload.kind === 'tab') {
    const from = idx.panelOf.get(payload.app)!;
    const src = idx.nodes.get(from) as Panel;
    // Its own panel's edges or centre, when it is the only tab, change nothing.
    if (src.tabs.length === 1 && target.kind !== 'seam' && anchor === from) return doc;
    out = updateNode(doc, idx, from, (n) => (n.kind === 'panel' ? { ...n, tabs: n.tabs.map((t) => (t === payload.app ? TOMB : t)) } : n));
    piece = { apps: [payload.app] };
  } else {
    const src = idx.nodes.get(payload.panel) as Panel;
    out = updateNode(doc, idx, payload.panel, () => ({ kind: 'panel', id: TOMB, tabs: [], selected: '' }));
    piece = { apps: src.tabs, panel: src };
  }
  const placed = place(out, indexDoc(out), piece, target);
  if (!placed) return null;
  const done = finish(doc, sweep(placed));
  return sameLayout(doc, done) ? doc : done;
}

interface Piece {
  apps: string[];
  /** Reuse this panel (a whole-panel move keeps its id); otherwise a new one is made. */
  panel?: Panel;
}

function validTarget(doc: LayoutDoc, idx: TreeIndex, t: Target): boolean {
  switch (t.kind) {
    case 'tab': {
      const n = idx.nodes.get(t.panel);
      return n?.kind === 'panel' && Number.isInteger(t.index) && t.index >= 0 && t.index <= n.tabs.length;
    }
    case 'seam': {
      const n = idx.nodes.get(t.split);
      return n?.kind === 'split' && Number.isInteger(t.index) && t.index >= 0 && t.index <= n.children.length;
    }
    case 'edge':
      return idx.nodes.has(t.node);
    case 'dock':
      if (t.host === null) return doc.root === null;
      return idx.panelOf.has(t.host) && kindOf(doc.apps[t.host]?.kind ?? '').hosts && !doc.apps[t.host].dock;
  }
}

/** Insert a piece at a target. */
function place(doc: LayoutDoc, idx: TreeIndex, piece: Piece, target: Target): LayoutDoc | null {
  const panel = (): Panel =>
    piece.panel ?? { kind: 'panel', id: freshId(doc, 'p-'), tabs: [...piece.apps], selected: piece.apps[0] };
  switch (target.kind) {
    case 'tab':
      return updateNode(doc, idx, target.panel, (n) => {
        if (n.kind !== 'panel') return n;
        const tabs = [...n.tabs];
        tabs.splice(target.index, 0, ...piece.apps);
        return { ...n, tabs, selected: piece.panel?.selected ?? piece.apps[0] };
      });
    case 'seam':
      return updateNode(doc, idx, target.split, (n) => {
        if (n.kind !== 'split') return n;
        const children = [...n.children];
        const weights = [...n.weights];
        children.splice(target.index, 0, panel());
        weights.splice(target.index, 0, 1 / n.children.length);
        return { ...n, children, weights };
      });
    case 'edge': {
      const axis = target.side === 'left' || target.side === 'right' ? 'x' : 'y';
      const before = target.side === 'left' || target.side === 'top';
      const id = freshId(doc, 's-');
      return updateNode(doc, idx, target.node, (n) => ({
        kind: 'split',
        id,
        axis,
        weights: [0.5, 0.5],
        children: before ? [panel(), n] : [n, panel()],
      }));
    }
    case 'dock': {
      if (target.host === null) return { ...doc, root: panel() };
      const rec = doc.apps[target.host];
      return { ...doc, apps: { ...doc.apps, [target.host]: { ...rec, dock: panel() } } };
    }
  }
}

function sweepNode(node: Node): Node {
  if (node.kind === 'panel') {
    if (node.id === TOMB) return { ...node, tabs: [] };
    if (!node.tabs.includes(TOMB)) return node;
    const at = node.tabs.indexOf(TOMB);
    const tabs = node.tabs.filter((t) => t !== TOMB);
    // A panel that lost its selected tab shows the neighbour that took its place.
    const selected = node.tabs.includes(node.selected) ? node.selected : (tabs[Math.min(at, tabs.length - 1)] ?? '');
    return { ...node, tabs, selected };
  }
  const children = node.children.map(sweepNode);
  return children.every((c, i) => c === node.children[i]) ? node : { ...node, children };
}

/** Drop tombstones everywhere, then normalize (empty panels go, single-child splits collapse). */
function sweep(doc: LayoutDoc): LayoutDoc {
  let apps = doc.apps;
  for (const [id, rec] of Object.entries(doc.apps)) {
    if (!rec.dock) continue;
    const dock = sweepNode(rec.dock);
    if (dock !== rec.dock) {
      if (apps === doc.apps) apps = { ...doc.apps };
      apps[id] = { ...rec, dock };
    }
  }
  const root = doc.root ? sweepNode(doc.root) : null;
  return normalizeDoc({ ...doc, root, apps });
}

/** Keep the frame if it still exists; otherwise frame where its apps went. */
export function finish(before: LayoutDoc, after: LayoutDoc): LayoutDoc {
  const idx = indexDoc(after);
  const f = before.nav.frame;
  if (resolveFrame(after, idx, f) === f) return after;
  const frame = resolveVisit(after, idx, visitOf(before, indexDoc(before), f));
  return { ...after, nav: { ...after.nav, frame } };
}

function sameNode(a: Node | null, b: Node | null, weights: boolean): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind === 'panel' && b.kind === 'panel') return a.selected === b.selected && a.tabs.join('\n') === b.tabs.join('\n');
  if (a.kind === 'split' && b.kind === 'split') {
    if (a.axis !== b.axis || a.children.length !== b.children.length) return false;
    if (weights && a.weights.some((w, i) => Math.abs(w - b.weights[i]) > 1e-9)) return false;
    return a.children.every((c, i) => sameNode(c, b.children[i], weights));
  }
  return false;
}

/** Same arrangement, ignoring navigation (and, unless asked, split weights)? */
export function sameLayout(a: LayoutDoc, b: LayoutDoc, weights = false): boolean {
  if (!sameNode(a.root, b.root, weights)) return false;
  const keys = Object.keys(a.apps);
  if (keys.length !== Object.keys(b.apps).length) return false;
  return keys.every((k) => Object.hasOwn(b.apps, k) && sameNode(a.apps[k].dock ?? null, b.apps[k].dock ?? null, weights));
}

// ---------------------------------------------------------------- adding and closing

/** Block colours, in the order new blocks take them. */
export const PALETTE: readonly { name: string; hue: number }[] = [
  { name: 'Coral', hue: 30 },
  { name: 'Amber', hue: 75 },
  { name: 'Lime', hue: 130 },
  { name: 'Teal', hue: 185 },
  { name: 'Sky', hue: 230 },
  { name: 'Indigo', hue: 275 },
  { name: 'Violet', hue: 305 },
  { name: 'Rose', hue: 355 },
  { name: 'Orange', hue: 55 },
  { name: 'Green', hue: 155 },
  { name: 'Cyan', hue: 205 },
  { name: 'Plum', hue: 330 },
];

/** The next block: the first palette colour no block uses, else the least-used one, numbered. */
export function nextBlock(doc: LayoutDoc): { title: string; hue: number } {
  const titles = new Set(Object.values(doc.apps).map((a) => a.title));
  const used = new Map<number, number>();
  for (const a of Object.values(doc.apps)) {
    if (a.kind === 'block' && typeof a.params.hue === 'number') used.set(a.params.hue, (used.get(a.params.hue) ?? 0) + 1);
  }
  let best = PALETTE[0];
  let bestUse = Infinity;
  for (const c of PALETTE) {
    const u = used.get(c.hue) ?? 0;
    if (u < bestUse) {
      best = c;
      bestUse = u;
    }
  }
  let title = best.name;
  for (let n = 2; titles.has(title); n++) title = `${best.name} ${n}`;
  return { title, hue: best.hue };
}

function nextGroupTitle(doc: LayoutDoc): string {
  const titles = new Set(Object.values(doc.apps).map((a) => a.title));
  for (let i = 0; i < 26; i++) {
    const t = `Group ${String.fromCharCode(65 + i)}`;
    if (!titles.has(t)) return t;
  }
  for (let n = 27; ; n++) if (!titles.has(`Group ${n}`)) return `Group ${n}`;
}

function add(doc: LayoutDoc, rec: AppRecord, prefix: string, target: Target): { doc: LayoutDoc; app: string } | null {
  const idx = indexDoc(doc);
  if (!validTarget(doc, idx, target)) return null;
  const app = freshId(doc, prefix);
  const withApp = { ...doc, apps: { ...doc.apps, [app]: rec } };
  const placed = place(withApp, indexDoc(withApp), { apps: [app] }, target);
  return placed ? { doc: finish(doc, normalizeDoc(placed)), app } : null;
}

export function addBlock(doc: LayoutDoc, target: Target) {
  const { title, hue } = nextBlock(doc);
  return add(doc, { kind: 'block', title, params: { hue } }, 'block-', target);
}

export function addGroup(doc: LayoutDoc, target: Target) {
  return add(doc, { kind: 'container', title: nextGroupTitle(doc), params: {}, dock: null }, 'group-', target);
}

/** Close one tab: the app, and everything in its dock, are gone. */
export function closeTab(doc: LayoutDoc, app: string, idx = indexDoc(doc)): LayoutDoc | null {
  const panel = idx.panelOf.get(app);
  if (!panel) return null;
  const gone = carried(doc, idx, { kind: 'tab', app })!;
  const marked = updateNode(doc, idx, panel, (n) => (n.kind === 'panel' ? { ...n, tabs: n.tabs.map((t) => (t === app ? TOMB : t)) } : n));
  const apps: Record<string, AppRecord> = {};
  for (const [id, rec] of Object.entries(marked.apps)) if (!gone.has(id)) apps[id] = rec;
  return finish(doc, sweep({ ...marked, apps }));
}

/** Close a whole panel: every tab in it. */
export function closePanel(doc: LayoutDoc, panel: string, idx = indexDoc(doc)): LayoutDoc | null {
  const node = idx.nodes.get(panel);
  if (node?.kind !== 'panel') return null;
  const gone = new Set(appsIn(doc, node));
  const marked = updateNode(doc, idx, panel, () => ({ kind: 'panel', id: TOMB, tabs: [], selected: '' }));
  const apps: Record<string, AppRecord> = {};
  for (const [id, rec] of Object.entries(marked.apps)) if (!gone.has(id)) apps[id] = rec;
  return finish(doc, sweep({ ...marked, apps }));
}

/** How many apps closing this would remove beyond the tab itself (a group's contents). */
export function closeCost(doc: LayoutDoc, payload: Payload, idx = indexDoc(doc)): number {
  const apps = carried(doc, idx, payload);
  if (!apps) return 0;
  const node = payload.kind === 'panel' ? idx.nodes.get(payload.panel) : null;
  const own = payload.kind === 'tab' ? 1 : node?.kind === 'panel' ? node.tabs.length : 0;
  return apps.size - own;
}

/** "Move to…": a destination is the top level (null) or a group. Lands as a new last row with an
 * ordinary share of the height (a column gains a child; anything else is split below), or fills an
 * empty dock. */
export function moveTo(doc: LayoutDoc, payload: Payload, host: string | null, idx = indexDoc(doc)): LayoutDoc | null {
  const top = host === null ? doc.root : doc.apps[host]?.dock;
  if (host !== null && !kindOf(doc.apps[host]?.kind ?? '').hosts) return null;
  const target: Target = !top
    ? { kind: 'dock', host }
    : top.kind === 'split' && top.axis === 'y'
      ? { kind: 'seam', split: top.id, index: top.children.length }
      : { kind: 'edge', node: top.id, side: 'bottom' };
  return move(doc, payload, target, idx);
}
