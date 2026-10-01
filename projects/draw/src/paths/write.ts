// A boolean's write (P1-M3 S3), pure: the result replaces the bottom operand, keeping its attributes
// (research 05), and the other operands go.
//
// - A bottom <path> keeps its element: only its d changes (opSetAttr: its position and quote kept),
//   and its generator inputs go (draw:gen and the generator's own; M2's hook would drop them anyway).
// - Any other bottom gives way to a new <path> (the root's prefix) in its place, after its leading
//   whitespace: the bottom's attributes in their order, less its geometry (x, y, width, height, rx,
//   ry, cx, cy, r, points, pathLength) and its generator inputs, then d. Its own children (whitespace
//   or a comment: a shape with element children is refused before this) go with it.
// - The other operands are removed with their leading whitespace (M1's remove).
// - When generator inputs went, Draw's namespace declaration goes too if nothing of Draw's is left
//   (M2's detach).
// Returns the result's element.

import { el, serializeNode, type Doc, type NodeId } from '../../../../engine/model/doc.ts';
import { opSetAttr, type Op } from '../../../../engine/commands/ops.ts';
import { insertMarkup, removeWithSpace } from '../../../../engine/model/space.ts';
import { DRAW_NS } from '../../../../engine/model/draw-ns.ts';
import { dropDrawAttrs, undeclareIfUnused } from '../../../../engine/model/draw-state.ts';
import { generatorFor } from '../../../../engine/generators/index.ts';
import { remove } from '../interact/structure.ts';

/** A shape's geometry attributes, which the result's d replaces. */
export const GEOMETRY_ATTRS: ReadonlySet<string> = new Set(['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'points', 'pathLength']);

/** The draw: attributes of the element's generator (draw:gen and its inputs), when it has one. */
function generatorAttrs(doc: Doc, id: NodeId): string[] {
  const g = generatorFor(doc, el(doc, id));
  return g ? ['gen', ...g.inputs.map((i) => i.name)] : [];
}

/** The new <path>'s markup for a bottom that isn't a path (see the header). */
export function pathMarkupFor(doc: Doc, bottom: NodeId, d: string): string {
  const n = el(doc, bottom);
  const prefix = el(doc, doc.root).prefix;
  const qname = prefix ? `${prefix}:path` : 'path';
  const gen = new Set(generatorAttrs(doc, bottom));
  let s = `<${qname}`;
  for (const a of n.attrs) {
    if ((a.ns === null && GEOMETRY_ATTRS.has(a.local)) || (a.ns === DRAW_NS && gen.has(a.local))) continue;
    s += `${a.lead}${a.qname}${a.eq}${a.quote}${a.raw}${a.quote}`;
  }
  s += ` d="${d}"`; // numbers, spaces and M, L, C, Z: nothing to escape
  if (!n.children.length) return `${s}${n.tail}/>`;
  return `${s}${n.tail}>${n.children.map((c) => serializeNode(doc, c)).join('')}</${qname}${n.endTail}>`;
}

/**
 * Write a boolean's result: `ids` are the operands in document order (the bottom first), `d` the
 * result in the bottom's user units. Returns the result's element.
 */
export function writeBoolean(doc: Doc, ids: readonly NodeId[], d: string, apply: (op: Op) => void): NodeId {
  const [bottom, ...others] = ids;
  const gen = generatorAttrs(doc, bottom);
  let result = bottom;
  if (el(doc, bottom).local === 'path') {
    dropDrawAttrs(doc, bottom, gen, apply, false);
    apply(opSetAttr(doc, bottom, null, 'd', d));
  } else {
    result = insertMarkup(doc, { before: bottom }, pathMarkupFor(doc, bottom, d), apply);
    removeWithSpace(doc, bottom, apply);
  }
  remove(doc, others, apply);
  if (gen.length) undeclareIfUnused(doc, apply);
  return result;
}
