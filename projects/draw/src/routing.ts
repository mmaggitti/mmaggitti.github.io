// Where a ChangeSet goes. The editor applies one route per session emit, in the plan's fixed order:
// the canvas (one element's attributes, or the smallest set of subtrees), then the code view (one
// block per changed node, or the whole listing when the tree's shape changed). Pure, so the rules
// are unit-tested in node; editor.ts only calls the views.

import type { ChangeSet } from '../../../engine/commands/ops.ts';
import type { Doc, NodeId } from '../../../engine/model/doc.ts';

export interface Route {
  /** Elements whose start tag changed and that are not inside a subtree being re-rendered. */
  attrs: NodeId[];
  /** The topmost nodes to re-render: parents whose child list changed, and edited text's parents. */
  subtrees: NodeId[];
  /** The code view: re-read these nodes' blocks, or rebuild the whole listing. */
  code: { reset: true } | { reset: false; blocks: NodeId[] };
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

export function route(doc: Doc, cs: ChangeSet): Route {
  const roots = new Set<NodeId>(cs.structure);
  for (const id of cs.texts) {
    const p = doc.nodes.get(id)?.parent;
    if (p != null) roots.add(p);
  }
  // Only the topmost: re-rendering a parent re-renders everything under it.
  const subtrees = [...roots].filter((id) => !under(doc, id, roots, false));
  const top = new Set(subtrees);
  const attrs = [...cs.attrs].filter((id) => attached(doc, id) && !under(doc, id, top, true));
  const code = cs.structure.size ? { reset: true as const } : { reset: false as const, blocks: [...new Set([...cs.attrs, ...cs.texts])] };
  return { attrs, subtrees, code };
}
