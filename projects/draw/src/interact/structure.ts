// Structure commands over the model: Bring forward, Send back and Delete (S4 adds Duplicate, Group
// and Ungroup here). Pure, no DOM: each builds engine place ops through `apply`, inside the one
// Session transaction the editor opens, so one undo restores the file byte for byte.
//
// An element travels with its leading whitespace (the whitespace-only text node right before it),
// so the file's indentation moves with it: Forward and Back swap it, with its whitespace, past the
// next or previous element sibling and its whitespace; Delete takes both away.

import { el, type Doc, type NodeId } from '../../../../engine/model/doc.ts';
import { opInsert, opRemove, type Op } from '../../../../engine/commands/ops.ts';

export const ROOT_DELETE = 'The root <svg> can’t be deleted.';

/** The whitespace-only text node right before `id` among its siblings, or null. */
export function leadingSpace(doc: Doc, id: NodeId): NodeId | null {
  const parent = doc.nodes.get(id)?.parent ?? null;
  if (parent === null) return null;
  const kids = el(doc, parent).children;
  const prev = doc.nodes.get(kids[kids.indexOf(id) - 1]);
  return prev?.kind === 'text' && /^[ \t\r\n]+$/.test(prev.raw) ? prev.id : null;
}

/** The nearest element sibling after (dir 1) or before (dir -1) `id`, or null. */
function neighbour(doc: Doc, id: NodeId, dir: 1 | -1): NodeId | null {
  const kids = el(doc, doc.nodes.get(id)!.parent!).children;
  for (let i = kids.indexOf(id) + dir; i >= 0 && i < kids.length; i += dir) if (doc.nodes.get(kids[i])?.kind === 'element') return kids[i];
  return null;
}

/**
 * Bring forward (dir 1: after the next element sibling) or send back (dir -1: before the previous
 * one, and before its whitespace) each of `ids`, with its leading whitespace. Forward goes last to
 * first and Back first to last, and one whose neighbour is also moving but couldn't stays: the
 * elements keep their order among themselves, and one already last (first) stays. `ids` are
 * attached elements, none the root, in document order.
 */
export function restack(doc: Doc, ids: readonly NodeId[], dir: 1 | -1, apply: (op: Op) => void): void {
  const moving = new Set(ids);
  for (const id of dir === 1 ? [...ids].reverse() : ids) {
    const past = neighbour(doc, id, dir);
    if (past === null || moving.has(past)) continue;
    const parent = doc.nodes.get(id)!.parent!;
    const ws = leadingSpace(doc, id);
    if (ws !== null) apply(opRemove(doc, ws));
    apply(opRemove(doc, id));
    const kids = el(doc, parent).children;
    let at = dir === 1 ? kids.indexOf(past) + 1 : kids.indexOf(leadingSpace(doc, past) ?? past);
    if (ws !== null) apply(opInsert(doc, ws, parent, at++));
    apply(opInsert(doc, id, parent, at));
  }
}

/** Delete each of `ids` with its leading whitespace (attached elements, none the root). */
export function remove(doc: Doc, ids: readonly NodeId[], apply: (op: Op) => void): void {
  for (const id of ids) {
    const ws = leadingSpace(doc, id);
    if (ws !== null) apply(opRemove(doc, ws));
    apply(opRemove(doc, id));
  }
}
