// Structure commands over the model: Bring forward, Send back, Delete, Duplicate, Group, Ungroup and
// Select group. Pure, no DOM: each builds engine ops through `apply`, inside the one Session
// transaction the editor opens, so one undo restores the file byte for byte.
//
// An element travels with its leading whitespace (the whitespace-only text node right before it),
// so the file's indentation moves with it: Forward and Back swap it, with its whitespace, past the
// next or previous element sibling and its whitespace; Delete takes both away; a copy, or a new
// group, brings a copy of the whitespace before the element it follows.

import { NS, attrValue, descendants, el, findAttr, serializeNode, type Doc, type ElementNode, type LeafNode, type NodeId } from '../../../../engine/model/doc.ts';
import { opInsert, opRemove, opSetAttr, opSetAttrRaw, type Op } from '../../../../engine/commands/ops.ts';
import { parseFragment } from '../../../../engine/model/fragment.ts';
import { freshId, idsInUse, renameIdsIn } from '../../../../engine/model/ids.ts';
import { buildRefIndex } from '../../../../engine/model/refs.ts';
import { DRAW_NS, isLocked } from '../../../../engine/model/draw-state.ts';
import { cssSets } from '../../../../engine/geometry/css.ts';
import { TokenEditError } from '../../../../engine/code/edit.ts';

export const ROOT_DELETE = 'The root <svg> can’t be deleted.';

/** The whitespace-only text node right before `id` among its siblings, or null (looked for from the end, as detachNode does). */
export function leadingSpace(doc: Doc, id: NodeId): NodeId | null {
  const parent = doc.nodes.get(id)?.parent ?? null;
  if (parent === null) return null;
  const kids = el(doc, parent).children;
  const prev = doc.nodes.get(kids[kids.lastIndexOf(id) - 1]);
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

/**
 * Delete each of `ids` with its leading whitespace (attached elements, none the root, in document
 * order). Last first: each leaves from the end of what is left, so deleting 4,000 shapes shifts
 * nothing, and the undo puts them back in order.
 */
export function remove(doc: Doc, ids: readonly NodeId[], apply: (op: Op) => void): void {
  for (const id of [...ids].reverse()) {
    const ws = leadingSpace(doc, id);
    if (ws !== null) apply(opRemove(doc, ws));
    apply(opRemove(doc, id));
  }
}

/** A copy of the whitespace text `ws` (a new node, detached), for `parent`. */
function spaceLike(doc: Doc, parent: NodeId, ws: NodeId): NodeId | null {
  const made = parseFragment(doc, parent, (doc.nodes.get(ws) as LeafNode).raw);
  return made.ok && made.nodes.length === 1 ? made.nodes[0] : null;
}

/**
 * Duplicate each of `ids` (attached elements, none the root, in document order): a copy right after
 * its original, with a copy of the original's leading whitespace; every id in the copy fresh (id,
 * id-2, …, reserved across the batch) and the references inside the copy following them (those
 * outside keep pointing at the originals); draw:locked left off. One fragment parse per parent, the
 * copies' whitespace included, and the ids in use read once: linear in what is copied.
 * Returns the copies, in order.
 */
export function duplicate(doc: Doc, ids: readonly NodeId[], apply: (op: Op) => void): NodeId[] {
  const byParent = new Map<NodeId, NodeId[]>();
  for (const id of ids) {
    const p = doc.nodes.get(id)!.parent!;
    const list = byParent.get(p);
    if (list) list.push(id);
    else byParent.set(p, [id]);
  }
  const taken = new Set<string>();
  const used = idsInUse(doc);
  const copies: NodeId[] = [];
  for (const [parent, list] of byParent) {
    // Each copy after a copy of its original's leading whitespace, all in one parse.
    const spaces = list.map((id) => leadingSpace(doc, id));
    const made = parseFragment(doc, parent, list.map((id, i) => `${spaces[i] === null ? '' : (doc.nodes.get(spaces[i]!) as LeafNode).raw}${serializeNode(doc, id)}`).join(''));
    if (!made.ok) throw new TokenEditError(`It can’t be duplicated here: ${made.error.message}`);
    const els: NodeId[] = [];
    const wsOf: (NodeId | null)[] = [];
    let ws: NodeId | null = null;
    for (const n of made.nodes) {
      if (doc.nodes.get(n)?.kind !== 'element') ws = n;
      else {
        els.push(n);
        wsOf.push(ws);
        ws = null;
      }
    }
    els.forEach((copy, i) => {
      const map = new Map<string, string>();
      for (const n of descendants(doc, copy)) {
        if (n.kind !== 'element') continue;
        for (const a of n.attrs) {
          if (!(a.local === 'id' && (a.ns === null || a.ns === NS.xml))) continue;
          const was = attrValue(doc, n, a.ns, 'id');
          if (was === null || map.has(was)) continue;
          const now = freshId(doc, was, taken, used);
          taken.add(now);
          map.set(was, now);
        }
      }
      renameIdsIn(doc, copy, map, apply);
      for (const n of descendants(doc, copy)) if (n.kind === 'element' && findAttr(n, DRAW_NS, 'locked')) apply(opSetAttr(doc, n.id, DRAW_NS, 'locked', null));
      const orig = list[i];
      let at = el(doc, parent).children.indexOf(orig) + 1;
      const copyWs = wsOf[i];
      if (copyWs !== null) apply(opInsert(doc, copyWs, parent, at++));
      apply(opInsert(doc, copy, parent, at));
      copies.push(copy);
    });
  }
  return copies;
}

/** Why `ids` can't be grouped, or null: one parent, none the root, none locked. */
export function groupRefusal(doc: Doc, ids: readonly NodeId[]): string | null {
  if (!ids.length) return 'Select the shapes to group first.';
  if (ids.includes(doc.root)) return 'Group can’t take the root <svg>.';
  if (ids.some((id) => isLocked(doc, id))) return 'It’s locked. Unlock it in Layers first.';
  const p = doc.nodes.get(ids[0])!.parent;
  if (ids.some((id) => doc.nodes.get(id)!.parent !== p)) return 'Group needs shapes with the same parent.';
  return null;
}

/**
 * Group `ids` (one parent, document order) in a new <g> where the last one was, with a copy of its
 * leading whitespace; each moves in, in order, with its own leading whitespace, and a copy of the
 * group's whitespace goes before </g>. Returns the group.
 */
export function group(doc: Doc, ids: readonly NodeId[], apply: (op: Op) => void): NodeId {
  const parent = doc.nodes.get(ids[0])!.parent!;
  const last = ids[ids.length - 1];
  const kids = el(doc, parent).children;
  const after = kids[kids.indexOf(last) + 1] ?? null;
  const lastWs = leadingSpace(doc, last);
  const made = parseFragment(doc, parent, '<g></g>');
  if (!made.ok) throw new TokenEditError(made.error.message);
  const g = made.nodes[0];
  // Taken out last first (nothing left behind them to shift), then put in the group in order.
  const moving: [NodeId | null, NodeId][] = [];
  for (const id of [...ids].reverse()) {
    const ws = leadingSpace(doc, id);
    if (ws !== null) apply(opRemove(doc, ws));
    apply(opRemove(doc, id));
    moving.push([ws, id]);
  }
  moving.reverse();
  let at = after === null ? el(doc, parent).children.length : el(doc, parent).children.indexOf(after);
  const before = lastWs === null ? null : spaceLike(doc, parent, lastWs);
  if (before !== null) apply(opInsert(doc, before, parent, at++));
  apply(opInsert(doc, g, parent, at));
  let i = 0;
  for (const [ws, id] of moving) {
    if (ws !== null) apply(opInsert(doc, ws, g, i++));
    apply(opInsert(doc, id, g, i++));
  }
  const end = lastWs === null ? null : spaceLike(doc, g, lastWs);
  if (end !== null) apply(opInsert(doc, end, g, i));
  return g;
}

const KEEPS = (a: { ns: string | null; local: string }) => (a.ns === null && (a.local === 'id' || a.local === 'transform')) || a.ns === DRAW_NS;

/** Why the group `id` can't be ungrouped without changing how it looks, or null. */
export function ungroupRefusal(doc: Doc, id: NodeId): string | null {
  const n = doc.nodes.get(id);
  if (!n || n.kind !== 'element' || n.ns !== NS.svg || n.local !== 'g' || id === doc.root) return 'Select a group to ungroup.';
  if (isLocked(doc, id)) return 'It’s locked. Unlock it in Layers first.';
  const other = n.attrs.find((a) => !KEEPS(a));
  if (other) return `It has ${other.qname}, which applies to the group as a whole; ungrouping would change how it looks.`;
  for (const prop of ['transform', 'transform-origin', 'transform-box']) {
    if (cssSets(doc, id, prop) !== 'no') return `Its ${prop} is set by CSS, so its children can’t take it.`;
  }
  const own = attrValue(doc, n, null, 'id');
  if (own !== null && buildRefIndex(doc).refs.get(own)?.length) return `Something refers to the group’s id (#${own}).`;
  for (const c of n.children) {
    const k = doc.nodes.get(c);
    if (k?.kind !== 'element') continue;
    if (findAttr(k, null, 'transform-origin') || cssSets(doc, c, 'transform-origin') !== 'no' || cssSets(doc, c, 'transform') !== 'no') {
      return 'A child’s transform origin (or CSS transform) can’t take the group’s transform.';
    }
  }
  return null;
}

/**
 * Ungroup `id` (ungroupRefusal is null): its children take its place, in order, keeping their bytes
 * and whitespace; each element child gets the group's transform pushed down (the group's raw text, a
 * space, then its own); the group and its leading whitespace go. Returns the former element children.
 */
export function ungroup(doc: Doc, id: NodeId, apply: (op: Op) => void): NodeId[] {
  const g = el(doc, id);
  const parent = g.parent!;
  const t = findAttr(g, null, 'transform');
  const gValue = t ? attrValue(doc, g, null, 'transform') : null;
  const children = [...g.children];
  const ws = leadingSpace(doc, id);
  let at = el(doc, parent).children.indexOf(id);
  if (ws !== null) {
    apply(opRemove(doc, ws));
    at--;
  }
  apply(opRemove(doc, id));
  const out: NodeId[] = [];
  for (const c of children) {
    apply(opRemove(doc, c));
    apply(opInsert(doc, c, parent, at++));
    const k = doc.nodes.get(c)!;
    if (k.kind !== 'element') continue;
    out.push(c);
    if (!t || gValue === null || !gValue.trim()) continue;
    const own = findAttr(k, null, 'transform');
    if (own) apply(opSetAttrRaw(doc, c, null, 'transform', own.quote === t.quote ? `${t.raw} ${own.raw}` : `${gValue.replace(/[<&"']/g, (ch) => `&#${ch.charCodeAt(0)};`)} ${own.raw}`));
    else {
      apply(opSetAttr(doc, c, null, 'transform', gValue));
      if (/^[^"<]*$/.test(t.raw)) apply(opSetAttrRaw(doc, c, null, 'transform', t.raw)); // the group's own bytes
    }
  }
  return out;
}

const CONTAINERS = new Set(['g', 'a', 'switch', 'svg']);

/** Select group: each element becomes its nearest container ancestor that isn't the root (or stays). */
export function groupsOf(doc: Doc, ids: readonly NodeId[]): NodeId[] {
  const out: NodeId[] = [];
  for (const id of ids) {
    let p = doc.nodes.get(id)?.parent ?? null;
    let found: NodeId = id;
    for (; p !== null && p !== doc.root; p = doc.nodes.get(p)?.parent ?? null) {
      const n = doc.nodes.get(p) as ElementNode;
      if (n.ns === NS.svg && CONTAINERS.has(n.local)) {
        found = p;
        break;
      }
    }
    if (!out.includes(found)) out.push(found);
  }
  return out;
}
