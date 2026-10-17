// Changes to the document. Every op is immutable and keeps the identity of untouched parts, so the
// runtime can compare with ===.

import type { LayoutDoc, Node, NavState } from './types.ts';
import { indexDoc, type TreeIndex } from './tree.ts';
import { resolveFrame } from './layout.ts';
import { canGo, record, resolveVisit, visitOf } from './history.ts';

function mapNode(node: Node, id: string, fn: (n: Node) => Node): Node {
  if (node.id === id) return fn(node);
  if (node.kind === 'panel') return node;
  let changed = false;
  const children = node.children.map((c) => {
    const n = mapNode(c, id, fn);
    if (n !== c) changed = true;
    return n;
  });
  return changed ? { ...node, children } : node;
}

/** Apply `fn` to the node with this id, wherever it is: in the root tree or in any dock. */
export function updateNode(doc: LayoutDoc, idx: TreeIndex, id: string, fn: (n: Node) => Node): LayoutDoc {
  // Find which tree (root or which app's dock) holds the node.
  let top = id;
  for (let guard = 0; guard < 1000; guard++) {
    const owner = idx.owner.get(top);
    if (!owner) return doc;
    if (owner.type === 'root') break;
    if (owner.type === 'dock') {
      const rec = doc.apps[owner.app];
      if (!rec?.dock) return doc;
      const dock = mapNode(rec.dock, id, fn);
      if (dock === rec.dock) return doc;
      return { ...doc, apps: { ...doc.apps, [owner.app]: { ...rec, dock } } };
    }
    top = owner.id;
  }
  if (!doc.root) return doc;
  const root = mapNode(doc.root, id, fn);
  return root === doc.root ? doc : { ...doc, root };
}

export function selectTab(doc: LayoutDoc, idx: TreeIndex, panelId: string, app: string): LayoutDoc {
  return updateNode(doc, idx, panelId, (n) => (n.kind === 'panel' && n.tabs.includes(app) && n.selected !== app ? { ...n, selected: app } : n));
}

/** Select every tab on the way down to a frame, so the frame is actually showing. */
export function revealFrame(doc: LayoutDoc, idx: TreeIndex, frame: string | null): LayoutDoc {
  let cur = frame;
  let out = doc;
  for (let guard = 0; cur !== null && guard < 1000; guard++) {
    const owner = idx.owner.get(cur);
    if (!owner || owner.type === 'root') break;
    if (owner.type === 'dock') {
      const panel = idx.panelOf.get(owner.app);
      if (!panel) break;
      out = selectTab(out, idx, panel, owner.app);
      cur = panel;
    } else cur = owner.id;
  }
  return out;
}

function withNav(doc: LayoutDoc, nav: NavState): LayoutDoc {
  return nav === doc.nav ? doc : { ...doc, nav };
}

/** Frame a node (or the overview with null): reveal it, and record the visit. */
export function setFrame(doc: LayoutDoc, target: string | null, opts: { record?: boolean } = {}): LayoutDoc {
  const idx = indexDoc(doc);
  const frame = resolveFrame(doc, idx, target);
  let out = revealFrame(doc, idx, frame);
  let nav: NavState = out.nav.frame === frame ? out.nav : { ...out.nav, frame };
  if (opts.record !== false) nav = record(nav, visitOf(out, idx, frame));
  out = withNav(out, nav);
  return out;
}

/** Step back (-1) or forward (+1) through history. */
export function goHistory(doc: LayoutDoc, step: -1 | 1): LayoutDoc {
  if (!canGo(doc.nav, step)) return doc;
  const idx = indexDoc(doc);
  const index = doc.nav.index + step;
  const frame = resolveVisit(doc, idx, doc.nav.visits[index]);
  const out = revealFrame(doc, idx, frame);
  return withNav(out, { ...out.nav, frame, index });
}

/** Overview, and back to where you were. */
export function toggleOverview(doc: LayoutDoc): LayoutDoc {
  const idx = indexDoc(doc);
  if (doc.nav.frame !== null) {
    const back = visitOf(doc, idx, doc.nav.frame);
    const out = setFrame(doc, null);
    return withNav(out, { ...out.nav, overviewReturn: back });
  }
  const ret = doc.nav.overviewReturn;
  if (!ret) return doc;
  return setFrame(doc, resolveVisit(doc, idx, ret));
}
