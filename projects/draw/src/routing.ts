// Where a ChangeSet goes. The editor applies one route per session emit, in the plan's fixed order:
// the canvas (one element's attributes, a node placed or taken away alone, or the smallest set of
// subtrees), then the code view (one block per changed node, a moved node's blocks placed or taken
// away, or the whole listing). Pure, so the rules are unit-tested in node; editor.ts only calls
// the views.
//
// A node whose place changed (cs.moved: inserted, removed, reordered, moved to another parent) is
// patched alone, on the canvas and in the code: its parent is not drawn again, so every other node
// keeps its DOM node (a Forward on a 2,000-node drawing moves one element and its whitespace). They
// go last to first in document order, so each lands before a sibling already in its place. A node
// moved in or out of a <style> keeps the old route (the <style> is judged whole, and drawn again),
// and so does one inside a subtree that is being drawn again anyway.

import type { ChangeSet } from '../../../engine/commands/ops.ts';
import type { Doc, NodeId } from '../../../engine/model/doc.ts';
import { NS } from '../../../engine/model/doc.ts';

export interface Route {
  /** Elements whose start tag changed and that are not inside a subtree being re-rendered. */
  attrs: NodeId[];
  /** The topmost nodes to re-render: edited text's parents, and a <style> whose children moved. */
  subtrees: NodeId[];
  /** Nodes to place alone at their model position, or take away: last first in document order. */
  moved: NodeId[];
  /**
   * The code view: re-read these nodes' blocks, place or take away the moved ones' blocks, and
   * re-read the start and end blocks of the parents whose children changed; or rebuild it all.
   */
  code: { reset: true } | { reset: false; blocks: NodeId[]; moved: NodeId[]; parents: NodeId[] };
}

/** Is `id` in the document (its parents reach the root)? */
export function attached(doc: Doc, id: NodeId): boolean {
  for (let n = doc.nodes.get(id); n; n = n.parent === null ? undefined : doc.nodes.get(n.parent)) {
    if (n.id === doc.root) return true;
    if (n.parent === null) return doc.prolog.includes(n.id) || doc.epilog.includes(n.id);
  }
  return false;
}

/** Is `id` one of `roots` or inside one of them? */
function under(doc: Doc, id: NodeId, roots: ReadonlySet<NodeId>, self: boolean): boolean {
  let n = doc.nodes.get(id);
  if (n && !self) n = n.parent === null ? undefined : doc.nodes.get(n.parent);
  for (; n; n = n.parent === null ? undefined : doc.nodes.get(n.parent)) if (roots.has(n.id)) return true;
  return false;
}

const isStyle = (doc: Doc, id: NodeId | null | undefined): boolean => {
  const n = id === null || id === undefined ? undefined : doc.nodes.get(id);
  return n?.kind === 'element' && n.local === 'style' && (n.ns === NS.svg || n.ns === NS.xhtml);
};

/** Every node's place in document order (attached nodes only). */
function orderOf(doc: Doc): Map<NodeId, number> {
  const order = new Map<NodeId, number>();
  let i = 0;
  const walk = (id: NodeId) => {
    order.set(id, i++);
    const n = doc.nodes.get(id);
    if (n?.kind === 'element') for (const c of n.children) walk(c);
  };
  for (const id of doc.prolog) walk(id);
  walk(doc.root);
  for (const id of doc.epilog) walk(id);
  return order;
}

export function route(doc: Doc, cs: ChangeSet): Route {
  const roots = new Set<NodeId>();
  for (const id of cs.texts) {
    const p = doc.nodes.get(id)?.parent;
    if (p != null) roots.add(p);
  }
  // A child moved in or out of a <style>: the <style> is judged whole, so it is drawn again (and
  // the code listing rebuilt).
  const styles = [...cs.structure].filter((id) => isStyle(doc, id));
  for (const s of styles) roots.add(s);
  const reset = styles.length > 0;
  const alone = [...cs.moved].filter((id) => !isStyle(doc, doc.nodes.get(id)?.parent));
  // Only the topmost: re-rendering a parent re-renders everything under it.
  const subtrees = [...roots].filter((id) => !under(doc, id, roots, false));
  const top = new Set(subtrees);
  const order = orderOf(doc);
  // A node inside another placed node comes with it.
  const within = new Set(alone.filter((id) => order.has(id)));
  const placed = alone.filter((id) => !order.has(id) || (!under(doc, id, top, false) && !under(doc, id, within, false)));
  // Taken away first (they have no place), then the rest last to first.
  const moved = [...placed.filter((id) => !order.has(id)), ...placed.filter((id) => order.has(id)).sort((a, b) => order.get(b)! - order.get(a)!)];
  const drawn = new Set([...top, ...moved.filter((id) => order.has(id))]);
  const attrs = [...cs.attrs].filter((id) => attached(doc, id) && !under(doc, id, drawn, true));
  const isMoved = new Set(moved);
  const code = reset
    ? { reset: true as const }
    : { reset: false as const, blocks: [...new Set([...cs.attrs, ...cs.texts])].filter((id) => !isMoved.has(id)), moved, parents: [...cs.structure] };
  return { attrs, subtrees, moved, code };
}
