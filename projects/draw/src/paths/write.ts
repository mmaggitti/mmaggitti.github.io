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
//
// Stroke to path's write (P1-M4 S0, writeStrokeOutline) follows the same rules, and pathRuleRefusal is
// the check both run before a shape becomes a <path> (the converse of the P1-M3 review's R7).

import { el, findAttr, serializeNode, type Doc, type NodeId } from '../../../../engine/model/doc.ts';
import { opSetAttr, opSetAttrRaw, type Op } from '../../../../engine/commands/ops.ts';
import { insertMarkup, removeWithSpace } from '../../../../engine/model/space.ts';
import { DRAW_NS } from '../../../../engine/model/draw-ns.ts';
import { dropDrawAttrs, undeclareIfUnused } from '../../../../engine/model/draw-state.ts';
import { generatorFor } from '../../../../engine/generators/index.ts';
import { sheetProps, sheetSets, declarations } from '../../../../engine/geometry/css.ts';
import { applyPlan } from '../../../../engine/geometry/write.ts';
import { planStyle, planStyleOne, type StyleCtx } from '../../../../engine/style/write.ts';
import { shownValue, styleSource } from '../../../../engine/style/where.ts';
import { escape } from '../../../../engine/xml/entities.ts';
import { TokenEditError } from '../../../../engine/code/edit.ts';
import { RULED, type StrokeOf } from '../../../../engine/path/offset.ts';
import { remove } from '../interact/structure.ts';

/** A shape's geometry attributes, which the result's d replaces (a line's ends too: Stroke to path takes lines, P1-M4). */
export const GEOMETRY_ATTRS: ReadonlySet<string> = new Set(['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'points', 'pathLength', 'x1', 'y1', 'x2', 'y2']);

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

// ── P1-M4 S0: a converted <path>'s style rules, and Stroke to path's write ─────────────────────────

/**
 * Why a shape can't become a <path> (or, `bare`, have a new <path> drawn just after it): a <style>
 * rule may set some property on that <path> that it may not set on the shape (`path { fill: … }`
 * would repaint it), read as conservatively as M2 reads rules (css.ts sheetSets, asked about the shape
 * as a <path>: its id and classes kept, or none for a new one). M2's P2 wording; null when none may.
 * A <path> keeps its own element, so nothing changes for one.
 */
export function pathRuleRefusal(doc: Doc, id: NodeId, bare = false): string | null {
  if (!bare && el(doc, id).local === 'path') return null;
  for (const p of sheetProps(doc)) {
    if (sheetSets(doc, id, p, { local: 'path', bare }) !== 'no' && (bare || sheetSets(doc, id, p) === 'no')) return RULED;
  }
  return null;
}

const isStroke = (local: string) => local === 'stroke' || local.startsWith('stroke-');
const sameNumber = (a: string, b: string) => {
  const [x, y] = [Number(a.trim().replace(/%$/, '')) / (a.trim().endsWith('%') ? 100 : 1), Number(b.trim().replace(/%$/, '')) / (b.trim().endsWith('%') ? 100 : 1)];
  return Number.isFinite(x) && Number.isFinite(y) ? x === y : a.trim() === b.trim();
};

// A style attribute's raw text without its stroke declarations (each declaration's text, its spacing
// and separators kept for the rest); null when nothing but whitespace is left.
function withoutStroke(raw: string): string | null {
  const parts: string[] = [];
  let seg = 0;
  let depth = 0;
  let quote = '';
  for (let i = 0; i <= raw.length; i++) {
    const c = raw[i];
    if (i < raw.length) {
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (c !== ';' || depth > 0) continue;
    }
    parts.push(raw.slice(seg, i));
    seg = i + 1;
  }
  const kept = parts.filter((p) => {
    const d = declarations(p)[0];
    return !(d && isStroke(d.name));
  });
  // The first declaration kept starts the value without the space that followed a removed one.
  const out = kept.map((p, i) => (i === 0 && p !== parts[0] ? p.replace(/^\s+/, '') : p)).join(';');
  return /^[\s;]*$/.test(out) ? null : out;
}

/**
 * Write Stroke to path's result (P1-M4 S0; engine/path/offset.ts strokeOf reads `s`), `d` the outline
 * in the element's own user units:
 * - no fill (or a line): the outline takes its place, as a boolean's result takes a non-path bottom's
 *   (pathMarkupFor: its attributes in order less its geometry and generator inputs, its id kept), with
 *   fill set to the stroke's paint where the fill lives (planStyleOne: its style="" declaration, its
 *   attribute, or a new attribute), fill-opacity to the stroke's opacity where they differ, every
 *   stroke attribute and style="" declaration taken away, and stroke="none" when its parent's stroke
 *   would reach it; a <path> keeps its element, and only those attributes and its d change;
 * - a fill: it keeps its fill and its stroke is written none where it lives (planStyle), and the
 *   outline <path> goes right after it with its transform and opacity, fill the stroke's paint.
 * Returns the outline's element.
 */
export function writeStrokeOutline(doc: Doc, id: NodeId, d: string, s: StrokeOf, ctx: StyleCtx, apply: (op: Op) => void): NodeId {
  const n = el(doc, id);
  const parent = n.parent!;
  const prefix = el(doc, doc.root).prefix;
  const qname = prefix ? `${prefix}:path` : 'path';
  const parentStroke = shownValue(doc, parent, 'stroke').value;
  const strokeNone = parentStroke === null || parentStroke.trim().toLowerCase() !== 'none';
  if (s.filled) {
    applyPlan(doc, planStyle(doc, [id], 'stroke', 'none', ctx), apply);
    let m = `<${qname}`;
    const t = findAttr(n, null, 'transform');
    if (t) m += ` transform=${t.quote}${t.raw}${t.quote}`;
    const o = styleSource(doc, id, 'opacity');
    if (o.value !== null && o.value.toLowerCase() !== 'inherit') m += ` opacity="${escape(o.value, '"')}"`;
    m += ` fill="${escape(s.paint, '"')}"`;
    const inherit = shownValue(doc, parent, 'fill-opacity').value ?? '1';
    if (!sameNumber(s.opacity, inherit)) m += ` fill-opacity="${escape(s.opacity, '"')}"`;
    if (strokeNone) m += ' stroke="none"';
    return insertMarkup(doc, { after: id }, `${m} d="${d}"/>`, apply);
  }
  const styleAttr = findAttr(n, null, 'style');
  if (styleAttr && styleAttr.raw.includes('&')) throw new TokenEditError('Its style is written with a character reference; edit it in the code.');
  // The fill and fill-opacity where they live (an earlier edit of style="" read by the next).
  let styleRaw = styleAttr?.raw;
  const set = new Map<string, string>(); // attribute → its new raw text
  const add: [string, string][] = []; // attributes added: their values, unescaped
  const writes: [string, string][] = [['fill', s.paint]];
  if (!sameNumber(s.opacity, s.fillOpacity)) writes.push(['fill-opacity', s.opacity]);
  for (const [prop, v] of writes) {
    const e = planStyleOne(doc, id, prop, v, styleRaw);
    if (e && 'refused' in e) throw new TokenEditError(e.refused);
    if (!e) continue;
    if (e.local === 'style') styleRaw = e.raw;
    else if (e.add) add.push([prop, e.raw]);
    else set.set(prop, e.raw);
  }
  const style = styleRaw === undefined ? undefined : withoutStroke(styleRaw);
  if (strokeNone) add.push(['stroke', 'none']);
  const gen = generatorAttrs(doc, id);
  if (n.local === 'path') {
    dropDrawAttrs(doc, id, gen, apply, false);
    for (const a of [...n.attrs]) if (a.ns === null && isStroke(a.local)) apply(opSetAttr(doc, id, null, a.local, null));
    for (const [local, raw] of set) apply(opSetAttrRaw(doc, id, null, local, raw));
    if (styleAttr) apply(style === null ? opSetAttr(doc, id, null, 'style', null) : opSetAttrRaw(doc, id, null, 'style', style!));
    for (const [local, value] of add) apply(opSetAttr(doc, id, null, local, value));
    apply(opSetAttr(doc, id, null, 'd', d));
    if (gen.length) undeclareIfUnused(doc, apply);
    return id;
  }
  const drop = new Set(gen);
  let m = `<${qname}`;
  for (const a of n.attrs) {
    if (a.ns === DRAW_NS && drop.has(a.local)) continue;
    if (a.ns === null && (GEOMETRY_ATTRS.has(a.local) || isStroke(a.local))) continue;
    if (a.ns === null && a.local === 'style') {
      if (style !== null && style !== undefined) m += `${a.lead}${a.qname}${a.eq}${a.quote}${style}${a.quote}`;
      continue;
    }
    const raw = a.ns === null ? (set.get(a.local) ?? a.raw) : a.raw;
    m += `${a.lead}${a.qname}${a.eq}${a.quote}${raw}${a.quote}`;
  }
  for (const [local, value] of add) m += ` ${local}="${escape(value, '"')}"`;
  m += ` d="${d}"`;
  m += n.children.length ? `${n.tail}>${n.children.map((c) => serializeNode(doc, c)).join('')}</${qname}${n.endTail}>` : `${n.tail}/>`;
  const result = insertMarkup(doc, { before: id }, m, apply);
  removeWithSpace(doc, id, apply);
  if (gen.length) undeclareIfUnused(doc, apply);
  return result;
}
