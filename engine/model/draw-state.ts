// Draw's own state in a document: the draw: namespace. Per-element state is draw:* attributes (a
// locked element carries draw:locked="true"); nothing else writes this namespace.

import { el, type Doc, type NodeId } from './doc.ts';

export const DRAW_NS = 'https://mmaggitti.github.io/draw/ns';

/** Is this element locked: draw:locked="true" on it or on an ancestor? */
export function isLocked(doc: Doc, id: NodeId): boolean {
  for (let n = doc.nodes.get(id); n && n.kind === 'element'; n = n.parent === null ? undefined : doc.nodes.get(n.parent)) {
    if (el(doc, n.id).attrs.some((a) => a.ns === DRAW_NS && a.local === 'locked' && a.raw === 'true')) return true;
  }
  return false;
}
