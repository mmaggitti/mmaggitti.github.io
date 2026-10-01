// The write policy (decision 8): how a move, a resize, a rotation or a scale becomes attribute
// edits, geometry first, every number rewritten in place.
//
// Each planner is pure: it reads the document and returns a Plan, `{ edits }` (the attribute edits
// to make, applied with applyPlan through opSetAttrRaw, or opSetAttr for an attribute that didn't
// exist) or `{ refused }` (why not, in words the editor shows as its notice). A drag re-plans every
// frame from the document as it was before the drag, so rounding never accumulates.
//
// - Move by (dx, dy), in the element's parent's user units. rect, image, foreignObject, use and a
//   nested svg write x and y (an absent one is added); circle and ellipse cx and cy; line both
//   ends; polyline and polygon every point; path the coordinates of its absolute commands only
//   (the first m too, which is absolute), so relative commands keep their bytes and arc radii,
//   rotation and flags never change. g, a and switch edit the numbers of a leading translate(),
//   else prepend `translate(dx dy) ` (a new item, never a collapse), else add
//   transform="translate(dx dy)". A text (P1-M4) moves by its own numbers when its x and y and every
//   x and y on its tspans are single numbers and it has no list (two or more numbers in x, y, dx, dy
//   or rotate) and no textPath: each of those numbers moves in place (a missing x or y on the text
//   is added, as a rect's is), dx and dy never change; else it moves by translate as a group does
//   (decision 8: text with position lists moves by translate). The root never moves. An element with its
//   own transform moves its geometry by L⁻¹·(dx, dy) (L its linear part; with transform-box:
//   fill-box the origin moves with the geometry, so by (dx, dy) itself).
// - Resize: a corner dragged to a point in the element's own units (a nested svg's: its x, y,
//   width and height's), the opposite corner kept, at least 1 user unit a side. rect, image,
//   foreignObject and nested svg write x and y (only for an edge that moves), width and height;
//   circle cx, cy and r (kept square); ellipse cx, cy, rx and ry; lines, points and paths scale
//   every coordinate about the fixed corner (relative ones as deltas, arc radii with them; a tilted
//   arc refuses a stretch). g, use, text, a and switch scale uniformly about the fixed corner of the
//   box the caller measured in the parent's units: a leading `translate(tx ty) scale(k)` pair is
//   edited, else one is prepended, so a second resize edits the same pair.
// - Rotate: an existing rotate() gets its angle rewritten (its own centre kept), else
//   ` rotate(a cx cy)` is appended to the list about the local box's centre less the transform
//   origin. Whole degrees.
// - Scale: only an element whose list has a scale() item: its number(s), the ratio of two kept.
// - A generated shape (a polygon, star or spiral whose inputs are draw:* attributes, P1-M2) moves by
//   its inputs draw:cx and draw:cy (through its own transform, as its geometry would), and the
//   Session's finish hook draws it again: it stays generated.
// - An existing transform list is never collapsed: its items, names and order stay.
// - Units stay as written: user units and px keep their own precision (and the step's); pt, pc,
//   in, cm and mm convert at 96 dpi (4 places); em against the element's font size; % against the
//   nearest viewport. rem is refused until converted (decision 13), and ex (the font's x-height is
//   the browser's to know).
// - CSS-set geometry, a CSS transform, and an origin or box a <style> rule sets are refused with
//   the reason.

import { NS, attrValue, el, findAttr, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { opSetAttr, opSetAttrRaw, type Op } from '../commands/ops.ts';
import { rewriteNumbers, TokenEditError, type NumberEdit } from '../code/edit.ts';
import { decimalsOf, tokenizeAttrRaw, type NumberToken, type Token } from '../code/tokens.ts';
import { DRAW_NS } from '../model/draw-ns.ts';
import { generatorOf } from '../generators/index.ts';
import { apply, invert, type Affine } from '../values/affine.ts';
import { parseTransform, type TransformFn } from '../values/transform.ts';
import { parseNumberList, fmt } from '../values/number-format.ts';
import { parsePath, type Seg } from '../path/parse.ts';
import { cssSets } from './css.ts';
import { fontSizeOf, rootFontSize, type Axis } from './lengths.ts';
import { lengthCtx, listMatrix, nestedViewport, transformBox, transformOrigin, transformUnknown, type GeoContext } from './ctm.ts';
import { localBounds, pointsOf, type Rect } from './bounds.ts';

export interface AttrEdit {
  id: NodeId;
  ns: string | null;
  local: string;
  raw: string; // the attribute's new raw text (for an added one, its value: numbers need no escaping)
  add: boolean; // the attribute didn't exist
}
export type Plan = { edits: AttrEdit[] } | { refused: string };

export interface WriteOpts {
  ctx: GeoContext;
  /** Decimal places of the snap step in use (0 for whole units). */
  decimals?: number;
}

export type Corner = 'tl' | 'tr' | 'br' | 'bl';
export interface Point {
  x: number;
  y: number;
}

/** Apply a plan's edits as ops (a Session build's `apply`). */
export function applyPlan(doc: Doc, plan: { edits: readonly AttrEdit[] }, applyOp: (op: Op) => void): void {
  for (const e of plan.edits) applyOp(e.add ? opSetAttr(doc, e.id, e.ns, e.local, e.raw) : opSetAttrRaw(doc, e.id, e.ns, e.local, e.raw));
}

export const ROOT_MOVE = 'The artboard doesn’t move; pan the view instead.';
export const FLATTENS = 'Its transform flattens it, so its geometry can’t move.';
const GEOMETRY = new Set(['rect', 'image', 'foreignObject', 'use', 'svg', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path']);
const TRANSLATE = new Set(['g', 'a', 'switch', 'text']);
const CSS_GEOMETRY = new Set(['x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd']);

/** How an element moves: by its own geometry, by a translate() in its transform, or not at all. */
export function movesBy(doc: Doc, id: NodeId): 'geometry' | 'translate' | 'none' {
  const n = doc.nodes.get(id);
  if (!n || n.kind !== 'element' || n.ns !== NS.svg || id === doc.root) return 'none';
  if (GEOMETRY.has(n.local)) return 'geometry';
  return TRANSLATE.has(n.local) ? 'translate' : 'none';
}

const refuse = (why: string): Plan => ({ refused: why });
export const cssWhy = (prop: string, where: 'inline' | 'sheet') => `Its ${prop} is set by CSS (${where === 'inline' ? 'its style attribute' : 'a <style> rule'}), which wins over the attribute.`;

// ── numbers ────────────────────────────────────────────────────────────────────────────────────

/** Decimal places a value needs, as fmt writes it, at most `max`. */
export function placesOf(x: number, max = 4): number {
  const s = fmt(Math.abs(x), 10);
  const dot = s.indexOf('.');
  return Math.min(max, dot === -1 ? 0 : s.length - dot - 1);
}

/** The number tokens of an attribute's raw text, read by its own grammar. */
export function numberTokens(doc: Doc, n: ElementNode, local: string, raw: string): NumberToken[] {
  return tokenizeAttrRaw(doc, n, { ns: null, local }, raw).filter((t): t is NumberToken => t.kind === 'number');
}

const retokenizer = (doc: Doc, n: ElementNode, local: string) => (raw: string): Token[] => tokenizeAttrRaw(doc, n, { ns: null, local }, raw);

/** Rewrite numbers of one attribute, or say why not. */
export function rewrite(doc: Doc, n: ElementNode, local: string, raw: string, edits: NumberEdit[]): AttrEdit | { refused: string } {
  try {
    return { id: n.id, ns: null, local, raw: rewriteNumbers(raw, edits, retokenizer(doc, n, local)), add: false };
  } catch (e) {
    if (e instanceof TokenEditError) return { refused: `Its ${local} can’t take the new numbers: ${e.message}.` };
    throw e;
  }
}

/** User units per one of the length's own units, or why the length can't be written. */
function unitScale(doc: Doc, n: ElementNode, local: string, unit: string, axis: Axis, ctx: GeoContext): number | { refused: string } {
  const u = unit.toLowerCase();
  const abs: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
  if (abs[u] !== undefined) return abs[u];
  if (u === 'rem') {
    const px = ctx.remPx ?? 12;
    return { refused: `Its ${local} is in rem, which the canvas measures against the app’s ${fmt(px)} px root, not this file’s own root font size (${fmt(rootFontSize(doc))} px). Convert rem to user units (Import report) first.` };
  }
  if (u === 'ex') return { refused: `Its ${local} is in ex, the font’s own x-height, which Draw can’t measure.` };
  if (u === 'em') {
    const fs = fontSizeOf(doc, n.id, ctx.remPx);
    return fs === null ? { refused: 'Its size is in em, and a <style> rule sets its font size, so Draw can’t tell what 1em is.' } : fs;
  }
  if (u === '%') {
    const v = lengthCtx(doc, n, axis, ctx).viewport;
    if (!v) return { refused: `Its ${local} is a percentage of a viewport whose size Draw can’t tell.` };
    const base = axis === 'x' ? v.w : axis === 'y' ? v.h : Math.sqrt((v.w * v.w + v.h * v.h) / 2);
    return base / 100;
  }
  return { refused: `Its ${local} has a unit Draw doesn’t write (${unit}).` };
}

/** A number in its unit: user units and px keep precision; converted units get 4 places. */
function writeIn(value: number, unit: string, token: NumberToken | null, delta: number, decimals: number): string {
  if (unit === '' || unit.toLowerCase() === 'px') return fmt(value, Math.max(token?.decimals ?? 0, decimals, placesOf(delta)));
  return fmt(value, 4);
}

/**
 * One length attribute changed: by `delta` user units (a move) or to `to` user units (a resize).
 * An absent attribute is added in user units (only when it changes).
 */
export function lengthEdit(doc: Doc, n: ElementNode, local: string, axis: Axis, change: { delta: number } | { to: number }, opts: WriteOpts): AttrEdit | { refused: string } | null {
  if (CSS_GEOMETRY.has(local)) {
    const set = cssSets(doc, n.id, local);
    if (set !== 'no') return { refused: cssWhy(local, set) };
  }
  const d = opts.decimals ?? 0;
  const a = findAttr(n, null, local);
  if (!a) {
    const v = 'delta' in change ? change.delta : change.to;
    if ('delta' in change && change.delta === 0) return null;
    return { id: n.id, ns: null, local, raw: fmt(v, Math.max(d, placesOf(v))), add: true };
  }
  const tokens = numberTokens(doc, n, local, a.raw);
  if (tokens.length !== 1) return { refused: `Its ${local} isn’t one number Draw can read.` };
  const t = tokens[0];
  const k = unitScale(doc, n, local, t.unit ?? '', axis, opts.ctx);
  if (typeof k !== 'number') return k;
  const nextUser = 'delta' in change ? t.value * k + change.delta : change.to;
  if ('delta' in change && change.delta === 0) return null;
  const text = writeIn(nextUser / k, t.unit ?? '', t, 'delta' in change ? change.delta / k : nextUser / k, d);
  if (text === t.text) return null;
  return rewrite(doc, n, local, a.raw, [{ start: t.start, end: t.end, text }]);
}

// ── transform lists, item by item, with their number tokens ─────────────────────────────────────

interface Item {
  fn: TransformFn;
  args: NumberToken[];
}

/** The transform's items with each argument's token, or null when they can't be told apart. */
function itemsOf(doc: Doc, n: ElementNode): Item[] | null {
  const a = findAttr(n, null, 'transform');
  if (!a) return [];
  const list = parseTransform(attrValue(doc, n, null, 'transform')!);
  if (!list) return null;
  const tokens = numberTokens(doc, n, 'transform', a.raw);
  if (tokens.length !== list.items.reduce((s, it) => s + it.args.length, 0) || tokens.some((t) => t.unit)) return null;
  let i = 0;
  return list.items.map((it) => ({ fn: it.fn, args: tokens.slice(i, (i += it.args.length)) }));
}

const TRANSFORM_UNREADABLE = 'Its transform is written with entity references or units, so Draw can’t edit its numbers.';

/** Why the element's transform can't be edited, or null. */
function transformRefusal(doc: Doc, n: ElementNode): string | null {
  return transformUnknown(doc, n.id) ?? (itemsOf(doc, n) === null ? TRANSFORM_UNREADABLE : null);
}

/** Prepend items to the list (or make the attribute): new items, never a collapse. */
function prepend(doc: Doc, n: ElementNode, text: string): AttrEdit {
  const a = findAttr(n, null, 'transform');
  return a ? { id: n.id, ns: null, local: 'transform', raw: `${text} ${a.raw}`, add: false } : { id: n.id, ns: null, local: 'transform', raw: text, add: true };
}

// ── move ───────────────────────────────────────────────────────────────────────────────────────

/** Move an element by (dx, dy) of its parent's user units. */
export function planMove(doc: Doc, id: NodeId, dx: number, dy: number, opts: WriteOpts): Plan {
  if (id === doc.root) return refuse(ROOT_MOVE);
  const how = movesBy(doc, id);
  const n = el(doc, id);
  if (how === 'none') return refuse(n.ns === NS.svg && (n.local === 'tspan' || n.local === 'textPath') ? 'A text run moves with its text: select the <text> to move it.' : 'It isn’t drawn where it is, so it can’t move on the canvas.');
  if (how === 'translate' && !textByNumbers(doc, n)) return moveByTranslate(doc, n, dx, dy, opts);
  // Geometry: the delta in the element's own units.
  const why = transformUnknown(doc, id);
  if (why) return refuse(why);
  const t = listMatrix(doc, id)!;
  let local: [number, number] = [dx, dy];
  if (!(t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1)) {
    const box = transformBox(doc, id);
    if (box === null) return refuse('Its transform box is set by a <style> rule.');
    if (box === 'view-box') {
      const inv = invert([t[0], t[1], t[2], t[3], 0, 0]);
      if (!inv) return refuse(FLATTENS);
      local = apply(inv, dx, dy);
    }
  }
  const [lx, ly] = local;
  const edits: AttrEdit[] = [];
  const add = (e: AttrEdit | { refused: string } | null): string | null => {
    if (e === null) return null;
    if ('refused' in e) return e.refused;
    edits.push(e);
    return null;
  };
  let problem: string | null = null;
  // A generated shape (engine/generators/) moves by its centre's inputs, draw:cx and draw:cy; the
  // Session's finish hook then draws it again from them, so it stays generated.
  if (generatorOf(doc, id)) {
    if (n.local === 'path' && cssSets(doc, id, 'd') !== 'no') return refuse(cssWhy('d', cssSets(doc, id, 'd') as 'inline' | 'sheet'));
    problem = add(inputEdit(doc, n, 'cx', lx, opts)) ?? add(inputEdit(doc, n, 'cy', ly, opts));
    return problem ? refuse(problem) : { edits };
  }
  switch (n.local) {
    case 'rect':
    case 'image':
    case 'foreignObject':
    case 'use':
    case 'svg':
      problem = add(lengthEdit(doc, n, 'x', 'x', { delta: lx }, opts)) ?? add(lengthEdit(doc, n, 'y', 'y', { delta: ly }, opts));
      break;
    case 'circle':
    case 'ellipse':
      problem = add(lengthEdit(doc, n, 'cx', 'x', { delta: lx }, opts)) ?? add(lengthEdit(doc, n, 'cy', 'y', { delta: ly }, opts));
      break;
    case 'line':
      for (const [a, axis, v] of [['x1', 'x', lx], ['y1', 'y', ly], ['x2', 'x', lx], ['y2', 'y', ly]] as const) problem ??= add(lengthEdit(doc, n, a, axis, { delta: v }, opts));
      break;
    case 'polyline':
    case 'polygon':
      problem = add(movePoints(doc, n, (i, v) => v + (i % 2 ? ly : lx), (i) => (i % 2 ? ly : lx), opts));
      break;
    case 'path':
      problem = add(movePath(doc, n, lx, ly, opts));
      break;
    case 'text': {
      const plan = moveText(doc, n, lx, ly, opts);
      if ('refused' in plan) return plan;
      edits.push(...plan.edits);
      break;
    }
  }
  return problem ? refuse(problem) : { edits };
}

// ── text by its own numbers (P1-M4) ────────────────────────────────────────────────────────────

// The text and its descendant elements.
function* textParts(doc: Doc, n: ElementNode): Generator<ElementNode> {
  yield n;
  for (const c of n.children) {
    const k = doc.nodes.get(c);
    if (k?.kind === 'element') yield* textParts(doc, k);
  }
}

// How many numbers an attribute holds as written (-1: it doesn't read as numbers).
function countNumbers(doc: Doc, n: ElementNode, local: string): number {
  const a = findAttr(n, null, local);
  if (!a) return 0;
  const list = parseNumberList(attrValue(doc, n, null, local)!.replace(/(\d)(px|pt|pc|mm|cm|in|em|ex|rem|%)/gi, '$1'));
  return list === null ? -1 : list.length;
}

/**
 * Does this <text> move by its own numbers: its x and y and every x and y on its tspans one number
 * each, nothing in it with a list (two or more numbers in x, y, dx, dy or rotate), and no textPath?
 */
export function textByNumbers(doc: Doc, n: ElementNode): boolean {
  if (n.ns !== NS.svg || n.local !== 'text') return false;
  for (const p of textParts(doc, n)) {
    if (p.ns === NS.svg && p.local === 'textPath') return false;
    for (const local of ['x', 'y', 'dx', 'dy', 'rotate']) {
      const k = countNumbers(doc, p, local);
      if (k === -1 || k > 1 || (k === 1 && (local === 'x' || local === 'y') && numberTokens(doc, p, local, findAttr(p, null, local)!.raw).length !== 1)) return false;
    }
  }
  return true;
}

/**
 * A text moved by (lx, ly) of its own user units (textByNumbers holds): its x and y (added when
 * missing) and every x and y its tspans have, each number in place.
 */
export function moveText(doc: Doc, n: ElementNode, lx: number, ly: number, opts: WriteOpts): Plan {
  const edits: AttrEdit[] = [];
  for (const p of textParts(doc, n)) {
    const own = p === n;
    if (!own && !(p.ns === NS.svg && p.local === 'tspan')) continue;
    for (const [local, v] of [['x', lx], ['y', ly]] as const) {
      if (!own && !findAttr(p, null, local)) continue;
      const e = lengthEdit(doc, p, local, local, { delta: v }, opts);
      if (e && 'refused' in e) return refuse(e.refused);
      if (e) edits.push(e);
    }
  }
  return { edits };
}

const INPUT_NUMBER = /-?(?:\d*\.\d+|\d+)/;

/** A generator input (a plain decimal in Draw's namespace) moved by `delta`, only its number's characters rewritten. */
function inputEdit(doc: Doc, n: ElementNode, local: string, delta: number, opts: WriteOpts): AttrEdit | null {
  if (delta === 0) return null;
  const a = findAttr(n, DRAW_NS, local)!;
  const m = INPUT_NUMBER.exec(a.raw);
  const value = Number(attrValue(doc, n, DRAW_NS, local)!.trim());
  const text = fmt(value + delta, Math.max(opts.decimals ?? 0, m ? decimalsOf(m[0]) : 0, placesOf(delta)));
  // Written with a reference (&#53;0): the whole value, which needs no escaping.
  const raw = m && !a.raw.includes('&') ? rewriteNumbers(a.raw, [{ start: m.index, end: m.index + m[0].length, text }]) : text;
  return raw === a.raw ? null : { id: n.id, ns: DRAW_NS, local, raw, add: false };
}

function moveByTranslate(doc: Doc, n: ElementNode, dx: number, dy: number, opts: WriteOpts): Plan {
  const why = transformRefusal(doc, n);
  if (why) return refuse(why);
  if (dx === 0 && dy === 0) return { edits: [] };
  const d = Math.max(opts.decimals ?? 0, placesOf(dx), placesOf(dy));
  const items = itemsOf(doc, n)!;
  const first = items[0];
  const a = findAttr(n, null, 'transform');
  if (a && first?.fn === 'translate') {
    const [tx, ty] = first.args;
    const nx = fmt(tx.value + dx, Math.max(d, tx.decimals));
    if (ty) {
      const e = rewrite(doc, n, 'transform', a.raw, [{ start: tx.start, end: tx.end, text: nx }, { start: ty.start, end: ty.end, text: fmt(ty.value + dy, Math.max(d, ty.decimals)) }]);
      return 'refused' in e ? refuse(e.refused) : { edits: [e] };
    }
    if (dy === 0) {
      const e = rewrite(doc, n, 'transform', a.raw, [{ start: tx.start, end: tx.end, text: nx }]);
      return 'refused' in e ? refuse(e.refused) : { edits: [e] };
    }
    // translate(tx) gains its y: the one place a number is added inside an item.
    const raw = `${a.raw.slice(0, tx.start)}${nx} ${fmt(dy, d)}${a.raw.slice(tx.end)}`;
    const back = parseTransform(raw);
    if (!back || back.items.map((i) => i.fn).join() !== items.map((i) => i.fn).join()) return refuse(TRANSFORM_UNREADABLE);
    return { edits: [{ id: n.id, ns: null, local: 'transform', raw, add: false }] };
  }
  return { edits: [prepend(doc, n, `translate(${fmt(dx, d)} ${fmt(dy, d)})`)] };
}

/** Every number of `points` changed by index (even x, odd y). */
function movePoints(doc: Doc, n: ElementNode, next: (i: number, v: number) => number, delta: (i: number) => number, opts: WriteOpts): AttrEdit | { refused: string } | null {
  const a = findAttr(n, null, 'points');
  if (!a) return null;
  const all = parseNumberList(attrValue(doc, n, null, 'points')!);
  const tokens = numberTokens(doc, n, 'points', a.raw);
  if (!all || tokens.length !== all.length) return { refused: 'Its points don’t all read as numbers, so Draw can’t change them.' };
  const d = opts.decimals ?? 0;
  const edits = tokens.map((t, i) => ({ start: t.start, end: t.end, text: fmt(next(i, t.value), Math.max(d, t.decimals, placesOf(delta(i)))) })).filter((e, i) => e.text !== tokens[i].text);
  return edits.length ? rewrite(doc, n, 'points', a.raw, edits) : null;
}

/** The absolute coordinates of a path moved; relative commands keep their bytes. */
function movePath(doc: Doc, n: ElementNode, dx: number, dy: number, opts: WriteOpts): AttrEdit | { refused: string } | null {
  if (cssSets(doc, n.id, 'd') !== 'no') return { refused: cssWhy('d', cssSets(doc, n.id, 'd') as 'inline' | 'sheet') };
  return transformPath(doc, n, (seg, k, abs, v) => {
    if (!abs) return null; // relative: its bytes stay
    const U = seg.cmd.toUpperCase();
    if (U === 'A') return k === 5 ? v + dx : k === 6 ? v + dy : null;
    if (U === 'H') return v + dx;
    if (U === 'V') return v + dy;
    return k % 2 ? v + dy : v + dx;
  }, (seg, k) => {
    const U = seg.cmd.toUpperCase();
    return U === 'H' ? dx : U === 'V' ? dy : U === 'A' ? (k === 5 ? dx : dy) : k % 2 ? dy : dx;
  }, opts);
}

/**
 * Rewrite a path's numbers: `next(seg, argIndex, absolute, value)` gives a number's new value, or
 * null to keep it. `absolute` is true for an absolute command and for the path's first m.
 */
function transformPath(
  doc: Doc, n: ElementNode,
  next: (seg: Seg, k: number, abs: boolean, v: number) => number | null,
  delta: (seg: Seg, k: number) => number,
  opts: WriteOpts,
): AttrEdit | { refused: string } | null {
  const a = findAttr(n, null, 'd');
  if (!a) return null;
  const segs = parsePath(attrValue(doc, n, null, 'd')!).segs;
  // The argument tokens (numbers and arc flags): a <path>'s L, Q and C letters are tokens too (P1-M3).
  const tokens = tokenizeAttrRaw(doc, n, { ns: null, local: 'd' }, a.raw).filter((t) => !(t.kind === 'enum' && t.segment !== undefined));
  const args = segs.reduce((s, g) => s + g.args.length, 0);
  if (tokens.length !== args) return { refused: 'Its path data is written with entity references, so Draw can’t change its numbers.' };
  const d = opts.decimals ?? 0;
  const edits: NumberEdit[] = [];
  let t = 0;
  segs.forEach((seg, i) => {
    const abs = seg.cmd === seg.cmd.toUpperCase() || (i === 0 && seg.cmd === 'm');
    seg.args.forEach((_, k) => {
      const tok = tokens[t++];
      if (tok.kind !== 'number') return; // an arc flag
      const v = next(seg, k, abs, tok.value);
      if (v === null) return;
      const text = fmt(v, Math.max(d, tok.decimals, placesOf(delta(seg, k))));
      if (text !== tok.text) edits.push({ start: tok.start, end: tok.end, text });
    });
  });
  return edits.length ? rewrite(doc, n, 'd', a.raw, edits) : null;
}

// ── resize ─────────────────────────────────────────────────────────────────────────────────────

const OPPOSITE: Record<Corner, Corner> = { tl: 'br', tr: 'bl', br: 'tl', bl: 'tr' };
const cornerOf = (r: Rect, c: Corner): Point => ({ x: c === 'tl' || c === 'bl' ? r.x : r.x + r.width, y: c === 'tl' || c === 'tr' ? r.y : r.y + r.height });

/**
 * The box after dragging `corner` of `box` to `to`, the opposite corner fixed, at least `min` a
 * side (the dragged corner never crosses the fixed one).
 */
export function draggedBox(box: Rect, corner: Corner, to: Point, min = 1): Rect {
  const f = cornerOf(box, OPPOSITE[corner]);
  const right = corner === 'tr' || corner === 'br';
  const down = corner === 'bl' || corner === 'br';
  const x2 = right ? Math.max(to.x, f.x + min) : Math.min(to.x, f.x - min);
  const y2 = down ? Math.max(to.y, f.y + min) : Math.min(to.y, f.y - min);
  return { x: Math.min(f.x, x2), y: Math.min(f.y, y2), width: Math.abs(x2 - f.x), height: Math.abs(y2 - f.y) };
}

export interface ResizeRequest {
  corner: Corner;
  /** Where the dragged corner goes: in the element's own units, or the parent's for a uniform scale. */
  to: Point;
  /** For g, use, text, a and switch: their box in the parent's units, as measured on the canvas. */
  box?: Rect;
}

/** Resize an element by one of its corners (see the header). */
export function planResize(doc: Doc, id: NodeId, req: ResizeRequest, opts: WriteOpts): Plan {
  if (id === doc.root) return refuse('The artboard’s size is the file’s own; Draw doesn’t change it here.');
  const how = movesBy(doc, id);
  const n = el(doc, id);
  if (how === 'none') return refuse('It can’t be resized on the canvas.');
  if (how === 'translate' || n.local === 'use') return resizeUniform(doc, n, req, opts);
  const why = transformUnknown(doc, id);
  if (why) return refuse(why);
  const edits: AttrEdit[] = [];
  let problem: string | null = null;
  const add = (e: AttrEdit | { refused: string } | null) => {
    if (e === null || problem) return;
    if ('refused' in e) problem = e.refused;
    else edits.push(e);
  };
  const set = (local: string, axis: Axis, v: number) => add(lengthEdit(doc, n, local, axis, { to: v }, opts));
  const left = req.corner === 'tl' || req.corner === 'bl';
  const top = req.corner === 'tl' || req.corner === 'tr';
  if (n.local === 'svg') {
    const vp = nestedViewport(doc, n, opts.ctx);
    if (!vp) return refuse('Draw can’t tell its size.');
    const b = draggedBox(vp, req.corner, req.to);
    if (left) set('x', 'x', b.x);
    if (top) set('y', 'y', b.y);
    set('width', 'x', b.width);
    set('height', 'y', b.height);
    return problem ? refuse(problem) : { edits };
  }
  const box = localBounds(doc, id, opts.ctx);
  if (!box) return refuse('Draw can’t tell its size.');
  switch (n.local) {
    case 'rect':
    case 'image':
    case 'foreignObject': {
      const b = draggedBox(box, req.corner, req.to);
      if (left) set('x', 'x', b.x);
      if (top) set('y', 'y', b.y);
      set('width', 'x', b.width);
      set('height', 'y', b.height);
      break;
    }
    case 'circle': {
      const b = draggedBox(box, req.corner, req.to);
      const f = cornerOf(box, OPPOSITE[req.corner]);
      const s = Math.max(b.width, b.height);
      const cx = left ? f.x - s / 2 : f.x + s / 2;
      const cy = top ? f.y - s / 2 : f.y + s / 2;
      set('cx', 'x', cx);
      set('cy', 'y', cy);
      set('r', 'other', s / 2);
      break;
    }
    case 'ellipse': {
      const b = draggedBox(box, req.corner, req.to);
      set('cx', 'x', b.x + b.width / 2);
      set('cy', 'y', b.y + b.height / 2);
      set('rx', 'x', b.width / 2);
      set('ry', 'y', b.height / 2);
      break;
    }
    default: {
      const b = draggedBox(box, req.corner, req.to);
      const f = cornerOf(box, OPPOSITE[req.corner]);
      const sx = box.width > 0 ? b.width / box.width : 1;
      const sy = box.height > 0 ? b.height / box.height : 1;
      const px = (v: number) => f.x + (v - f.x) * sx;
      const py = (v: number) => f.y + (v - f.y) * sy;
      if (n.local === 'line') {
        for (const [a, axis] of [['x1', 'x'], ['y1', 'y'], ['x2', 'x'], ['y2', 'y']] as const) {
          const cur = lengthValue(doc, n, a, axis, opts.ctx);
          if (cur === null) return refuse(`Draw can’t read its ${a}.`);
          set(a, axis, axis === 'x' ? px(cur) : py(cur));
        }
      } else if (n.local === 'polyline' || n.local === 'polygon') {
        add(movePoints(doc, n, (i, v) => (i % 2 ? py(v) : px(v)), () => 0.001, { ...opts, decimals: Math.max(opts.decimals ?? 0, 3) }));
      } else if (n.local === 'path') {
        if (cssSets(doc, id, 'd') !== 'no') return refuse(cssWhy('d', cssSets(doc, id, 'd') as 'inline' | 'sheet'));
        if (Math.abs(sx - sy) > 1e-9 && parsePath(attrValue(doc, n, null, 'd') ?? '').segs.some((s) => (s.cmd === 'A' || s.cmd === 'a') && s.args[2] % 90 !== 0)) {
          return refuse('A tilted arc can’t be stretched; resize it evenly.');
        }
        add(transformPath(doc, n, (seg, k, abs, v) => {
          const U = seg.cmd.toUpperCase();
          if (U === 'A') {
            const quarter = Math.abs(Math.round(seg.args[2] / 90)) % 2 === 1;
            if (k === 0) return v * (quarter ? sy : sx);
            if (k === 1) return v * (quarter ? sx : sy);
            if (k === 2) return null;
            if (k === 5) return abs ? px(v) : v * sx;
            return abs ? py(v) : v * sy;
          }
          const isX = U === 'H' || (U !== 'V' && k % 2 === 0);
          if (!abs) return v * (isX ? sx : sy);
          return isX ? px(v) : py(v);
        }, () => 0.001, { ...opts, decimals: Math.max(opts.decimals ?? 0, 3) }));
      }
    }
  }
  return problem ? refuse(problem) : { edits };
}

/** A length attribute's current value in user units, or null. */
function lengthValue(doc: Doc, n: ElementNode, local: string, axis: Axis, ctx: GeoContext): number | null {
  const a = findAttr(n, null, local);
  if (!a) return 0;
  const t = numberTokens(doc, n, local, a.raw);
  if (t.length !== 1) return null;
  const k = unitScale(doc, n, local, t[0].unit ?? '', axis, ctx);
  return typeof k === 'number' ? t[0].value * k : null;
}

/**
 * The uniform scale for g, use, text, a and switch: s = the larger of the dragged width and height
 * ratios (3 places, at least 0.01, no side under 1 user unit), about the fixed corner.
 */
export function uniformScale(box: Rect, corner: Corner, to: Point): number {
  const b = draggedBox(box, corner, to, 0);
  const rw = box.width > 0 ? b.width / box.width : 0;
  const rh = box.height > 0 ? b.height / box.height : 0;
  const floor = Math.max(0.01, box.width > 0 ? 1 / box.width : 0, box.height > 0 ? 1 / box.height : 0);
  return Number(fmt(Math.max(Math.max(rw, rh), floor), 3));
}

function resizeUniform(doc: Doc, n: ElementNode, req: ResizeRequest, opts: WriteOpts): Plan {
  const why = transformRefusal(doc, n);
  if (why) return refuse(why);
  if (!req.box) return refuse('Draw can’t tell its size.');
  const s = uniformScale(req.box, req.corner, req.to);
  const p = cornerOf(req.box, OPPOSITE[req.corner]); // stays put, in the parent's units
  const origin = transformOrigin(doc, n.id, opts.ctx, () => localBounds(doc, n.id, opts.ctx));
  if ('unknown' in origin) return refuse(origin.unknown);
  const [ox, oy] = origin.at;
  const P = { x: p.x - ox, y: p.y - oy };
  const items = itemsOf(doc, n)!;
  const a = findAttr(n, null, 'transform');
  const [t, k] = items;
  if (a && t?.fn === 'translate' && t.args.length === 2 && k?.fn === 'scale') {
    // The leading pair: k becomes k·s, and the translate keeps the fixed corner put.
    const tx = P.x - s * (P.x - t.args[0].value);
    const ty = P.y - s * (P.y - t.args[1].value);
    const edits: NumberEdit[] = [
      { start: t.args[0].start, end: t.args[0].end, text: fmt(tx, 3) },
      { start: t.args[1].start, end: t.args[1].end, text: fmt(ty, 3) },
      ...k.args.map((arg) => ({ start: arg.start, end: arg.end, text: fmt(arg.value * s, 3) })),
    ].filter((e, i, all) => e.text !== a.raw.slice(all[i].start, all[i].end));
    if (!edits.length) return { edits: [] };
    const e = rewrite(doc, n, 'transform', a.raw, edits);
    return 'refused' in e ? refuse(e.refused) : { edits: [e] };
  }
  const tx = P.x * (1 - s);
  const ty = P.y * (1 - s);
  return { edits: [prepend(doc, n, `translate(${fmt(tx, 3)} ${fmt(ty, 3)}) scale(${fmt(s, 3)})`)] };
}

// ── rotate and scale ───────────────────────────────────────────────────────────────────────────

/**
 * Turn an element to `angle` degrees: an existing rotate() gets the angle, else one is appended
 * about its box's centre. `box` stands in for the local box where the engine can't measure one
 * (text, use: the caller's measurement).
 */
export function planRotate(doc: Doc, id: NodeId, angle: number, opts: WriteOpts & { box?: Rect | null }): Plan {
  if (id === doc.root) return refuse('The artboard doesn’t turn.');
  const n = el(doc, id);
  if (movesBy(doc, id) === 'none') return refuse('It can’t be turned on the canvas.');
  const why = transformRefusal(doc, n);
  if (why) return refuse(why);
  const a = fmt(angle, 0);
  const items = itemsOf(doc, n)!;
  const attr = findAttr(n, null, 'transform');
  const rot = items.find((i) => i.fn === 'rotate');
  if (attr && rot) {
    if (rot.args[0].text === a) return { edits: [] };
    const e = rewrite(doc, n, 'transform', attr.raw, [{ start: rot.args[0].start, end: rot.args[0].end, text: a }]);
    return 'refused' in e ? refuse(e.refused) : { edits: [e] };
  }
  const origin = transformOrigin(doc, id, opts.ctx, () => localBounds(doc, id, opts.ctx));
  if ('unknown' in origin) return refuse(origin.unknown);
  const box = opts.box ?? localBounds(doc, id, opts.ctx);
  if (!box) return refuse('Draw can’t tell where its centre is.');
  const cx = box.x + box.width / 2 - origin.at[0];
  const cy = box.y + box.height / 2 - origin.at[1];
  const item = `rotate(${a} ${fmt(cx, 3)} ${fmt(cy, 3)})`;
  if (!attr) return { edits: [{ id, ns: null, local: 'transform', raw: item, add: true }] };
  const end = attr.raw.lastIndexOf(')') + 1;
  const raw = end > 0 ? `${attr.raw.slice(0, end)} ${item}${attr.raw.slice(end)}` : item + attr.raw;
  return { edits: [{ id, ns: null, local: 'transform', raw, add: false }] };
}

/** Rewrite the number(s) of the element's scale() item to `k` (the ratio of two kept), 2 places. */
export function planScale(doc: Doc, id: NodeId, k: number, _opts: WriteOpts): Plan {
  const n = el(doc, id);
  const why = transformRefusal(doc, n);
  if (why) return refuse(why);
  const item = itemsOf(doc, n)!.find((i) => i.fn === 'scale');
  const attr = findAttr(n, null, 'transform');
  if (!item || !attr) return refuse('It has no scale() to change.');
  const [sx, sy] = item.args;
  const edits: NumberEdit[] = [{ start: sx.start, end: sx.end, text: fmt(k, 2) }];
  if (sy) edits.push({ start: sy.start, end: sy.end, text: fmt(sx.value === 0 ? k : (k * sy.value) / sx.value, 2) });
  const changed = edits.filter((e) => attr.raw.slice(e.start, e.end) !== e.text);
  if (!changed.length) return { edits: [] };
  const e = rewrite(doc, n, 'transform', attr.raw, changed);
  return 'refused' in e ? refuse(e.refused) : { edits: [e] };
}

/** The first scale() item's first number, or null (the diamond shows only when there is one). */
export function scaleOf(doc: Doc, id: NodeId): number | null {
  const n = el(doc, id);
  const item = transformRefusal(doc, n) ? undefined : itemsOf(doc, n)?.find((i) => i.fn === 'scale');
  return item ? item.args[0].value : null;
}

/** The first rotate() item's angle, or 0 when there is none. */
export function rotationOf(doc: Doc, id: NodeId): number {
  const n = el(doc, id);
  const item = transformRefusal(doc, n) ? undefined : itemsOf(doc, n)?.find((i) => i.fn === 'rotate');
  return item ? item.args[0].value : 0;
}

export type { Affine };
