// Stroke outlines (P1-M4 S0): the region a stroke paints, as a stroker's outline of lines and cubics,
// and what an element's stroke is (or why Draw can't outline it). Pure and DOM-free.
//
// strokeLoops: for each subpath (loops.ts toSubpaths: closed only by a Z), at width w (h = w/2):
// - each segment's two offsets at ±h along its normal: a line's exactly; a cubic's split where needed,
//   each piece's offsets fitted by one cubic each (Hermite: the true offset's end points and end
//   derivatives), within w/200 of the true offset at 64 samples (or 10 halvings deep);
// - each corner on its outer side: stroke-linejoin's miter up to stroke-miterlimit (the miter length
//   over the width, 1/cos(φ/2) for a turn of φ), past it a bevel, as SVG does; round (an arc of radius h,
//   as cubics); bevel; miter-clip and arcs read as miter. On the inner side the outline goes through the
//   corner itself (Skia's pivot), so it stays one loop whose every piece adds to the fill;
// - an open subpath: one loop, its left offsets forward, the end cap (butt, round: a half disc, square:
//   h further on), its right offsets back, the start cap; a closed one: two loops, its left offsets and
//   its right offsets the other way; a zero-length one: a disc (round) or a square on the user axes
//   (square), as browsers draw it;
// - each subpath's loops turned so its stroke winds +1, so overlapping subpaths add up under nonzero.
// The loops fill the stroke under nonzero, as browsers fill their own stroker's outline: where a curve
// is tighter than h, its inner offset folds past the centre of curvature and the fold winds the other
// way, so the middle of a small circle under a thick stroke stays empty, in Chromium's canvas and here
// alike. A boolean union (paths/pipeline.ts) resolves the overlaps a tight curve or a corner makes.
//
// strokeOf: an element's stroke as Draw outlines it, read where each value lives (style/where.ts:
// its own, an ancestor's, the initial one), or why not, in words: no stroke or none, a width of 0, a
// dash, a non-scaling stroke, a marker, a paint Draw can't read (or a gradient laid out on the box,
// which the outline's box would change), a clip-path, mask or filter (laid out on the box too), a
// paint-order that paints the stroke first on a shape that keeps its fill, and a value a <style> rule
// may decide.

import { attrValue, el, type Doc, type NodeId } from '../model/doc.ts';
import { loopsToAbs, type Loop, type LoopSeg, type Subpath } from './loops.ts';
import { polygons, windingOf, type Pt } from './winding.ts';
import { shownValue, styleSource, ruleWins } from '../style/where.ts';
import { lengthCtx, type GeoContext } from '../geometry/ctm.ts';
import { resolveLength } from '../geometry/lengths.ts';
import { parsePaint } from '../values/color.ts';
import { idMap, isGradient, resolveGradient, valueOf } from '../paint/gradients.ts';

export type LineJoin = 'miter' | 'round' | 'bevel';
export type LineCap = 'butt' | 'round' | 'square';
export interface StrokeStyle {
  width: number;
  join: LineJoin;
  miterLimit: number;
  cap: LineCap;
}

/** How deep a cubic's offset is halved at most. */
const MAX_DEPTH = 10;
/** The samples a fitted offset is checked at. */
export const FIT_SAMPLES = 64;

type Cub = readonly [Pt, Pt, Pt, Pt];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
/** The left normal: the tangent turned a quarter (x, y) → (−y, x). */
const perp = (a: Pt): Pt => [-a[1], a[0]];
const unit = (a: Pt): Pt | null => {
  const l = len(a);
  return l > 0 && Number.isFinite(l) ? [a[0] / l, a[1] / l] : null;
};

/** The point at t on a cubic. */
export function cubicAt(c: Cub, t: number): Pt {
  const u = 1 - t;
  const [a, b, cc, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [a * c[0][0] + b * c[1][0] + cc * c[2][0] + d * c[3][0], a * c[0][1] + b * c[1][1] + cc * c[2][1] + d * c[3][1]];
}
const d1 = (c: Cub, t: number): Pt => {
  const u = 1 - t;
  const [a, b, d] = [3 * u * u, 6 * u * t, 3 * t * t];
  return [a * (c[1][0] - c[0][0]) + b * (c[2][0] - c[1][0]) + d * (c[3][0] - c[2][0]), a * (c[1][1] - c[0][1]) + b * (c[2][1] - c[1][1]) + d * (c[3][1] - c[2][1])];
};
const d2 = (c: Cub, t: number): Pt => {
  const u = 1 - t;
  return [6 * u * (c[2][0] - 2 * c[1][0] + c[0][0]) + 6 * t * (c[3][0] - 2 * c[2][0] + c[1][0]), 6 * u * (c[2][1] - 2 * c[1][1] + c[0][1]) + 6 * t * (c[3][1] - 2 * c[2][1] + c[1][1])];
};
const scaleOf = (c: Cub) => Math.max(1, ...c.flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]));

/** The cubic's unit tangent at t; where its derivative vanishes (a control on its end), the direction it leaves or arrives in. */
export function cubicTangent(c: Cub, t: number): Pt | null {
  const eps = 1e-12 * scaleOf(c);
  const v = d1(c, t);
  if (len(v) > eps) return unit(v);
  const probe = d1(c, t < 0.5 ? t + 1e-6 : t - 1e-6);
  if (len(probe) > eps * 1e-6) return unit(probe);
  return unit(sub(c[3], c[0]));
}

/** The offset point at t, h along the left normal (−h: the right). */
export function offsetAt(c: Cub, t: number, h: number): Pt {
  const tan = cubicTangent(c, t) ?? [1, 0];
  return add(cubicAt(c, t), mul(perp(tan), h));
}

// The offset's derivative at t: B′ + h·n′, n = perp(B′)/|B′|; numerically where |B′| vanishes.
function offsetDerivative(c: Cub, t: number, h: number): Pt {
  const v = d1(c, t);
  const l = len(v);
  if (l > 1e-9 * scaleOf(c)) {
    const a = d2(c, t);
    const k = dot(v, a) / (l * l * l);
    const dn: Pt = sub(mul(perp(a), 1 / l), mul(perp(v), k));
    return add(v, mul(dn, h));
  }
  const e = 1e-6;
  return mul(sub(offsetAt(c, Math.min(1, t + e), h), offsetAt(c, Math.max(0, t - e), h)), 1 / (Math.min(1, t + e) - Math.max(0, t - e)));
}

/** The offset of c between t0 and t1 at h, as one cubic (Hermite: its end points and derivatives). */
export function fitOffset(c: Cub, t0: number, t1: number, h: number): [Pt, Pt, Pt, Pt] {
  const p0 = offsetAt(c, t0, h);
  const p3 = offsetAt(c, t1, h);
  const k = (t1 - t0) / 3;
  return [p0, add(p0, mul(offsetDerivative(c, t0, h), k)), sub(p3, mul(offsetDerivative(c, t1, h), k)), p3];
}

/** How far the fitted cubic strays from the true offset: the largest distance between them at FIT_SAMPLES matching parameters (never less than the curves' own distance). */
export function fitError(c: Cub, t0: number, t1: number, h: number, fit: Cub): number {
  let worst = 0;
  for (let i = 0; i < FIT_SAMPLES; i++) {
    const u = (i + 0.5) / FIT_SAMPLES;
    worst = Math.max(worst, len(sub(cubicAt(fit, u), offsetAt(c, t0 + u * (t1 - t0), h))));
  }
  return worst;
}

// ── the outline ────────────────────────────────────────────────────────────────────────────────

const lineLoop = (pts: readonly Pt[]): Loop => ({ start: pts[0], segs: pts.slice(1).map((to): LoopSeg => ({ type: 'L', to })) });

// A circular arc as cubics (at most a quarter each), from angle a0 by `delta` (radians, signed).
function arcSegs(c: Pt, r: number, a0: number, delta: number): LoopSeg[] {
  const n = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const d = delta / n;
  const k = (4 / 3) * Math.tan(d / 4);
  const out: LoopSeg[] = [];
  for (let i = 0; i < n; i++) {
    const t = a0 + i * d;
    const u = t + d;
    out.push({
      type: 'C',
      c1: [c[0] + r * (Math.cos(t) - k * Math.sin(t)), c[1] + r * (Math.sin(t) + k * Math.cos(t))],
      c2: [c[0] + r * (Math.cos(u) + k * Math.sin(u)), c[1] + r * (Math.sin(u) - k * Math.cos(u))],
      to: [c[0] + r * Math.cos(u), c[1] + r * Math.sin(u)],
    });
  }
  return out;
}

const circleLoop = (c: Pt, r: number): Loop => ({ start: [c[0] + r, c[1]], segs: arcSegs(c, r, 0, 2 * Math.PI) });

/** The miter's length over the stroke's width at a turn whose tangents' dot product is `cos`: 1/cos(φ/2). */
export const miterRatio = (cos: number): number => 1 / Math.sqrt((1 + cos) / 2);

/**
 * A corner at P on one side of the outline (`side` +1: the left offsets, at +h·n; −1: the right), from
 * the incoming unit tangent t1 to the outgoing t2, walked from the incoming offset's end `from` to the
 * outgoing one's start (`back`: walked the other way, from the outgoing offset's start to the incoming
 * one's end, as the right side is). On the inner side it goes through P (Skia's pivot), so the outline
 * stays one loop whose pieces each add to the fill; on the outer side it is the join: a miter up to the
 * limit, else a bevel; a round arc of radius h; a bevel. Returns the segments after `from`.
 */
export function corner(P: Pt, t1: Pt, t2: Pt, h: number, side: 1 | -1, back: boolean, style: StrokeStyle): LoopSeg[] {
  const cr = cross(t1, t2);
  const cos = Math.max(-1, Math.min(1, dot(t1, t2)));
  const n1 = perp(t1);
  const n2 = perp(t2);
  const A = add(P, mul(n1, side * h)); // the incoming offset's end on this side
  const B = add(P, mul(n2, side * h)); // the outgoing offset's start
  const [from, to] = back ? [B, A] : [A, B];
  if (Math.abs(cr) < 1e-12 && cos > 0) return len(sub(to, from)) > 0 ? [{ type: 'L', to }] : []; // straight on
  // This side is outer when the path turns away from it (a turn right round: the left is outer).
  const outer = Math.abs(cr) < 1e-12 ? side === 1 : (cr > 0 ? -1 : 1) === side;
  if (!outer) return [{ type: 'L', to: P }, { type: 'L', to }];
  if (style.join === 'round') {
    const a0 = Math.atan2(from[1] - P[1], from[0] - P[0]);
    let delta = Math.atan2(cross(sub(from, P), sub(to, P)), dot(sub(from, P), sub(to, P)));
    // Turned right round (only the left side, walked forward, is outer then): the half disc ahead,
    // from P + h·n1 through P + h·t1 (n1 turned back a quarter).
    if (Math.abs(cr) < 1e-12) delta = -Math.PI;
    return arcSegs(P, h, a0, delta);
  }
  if (style.join === 'miter' && Math.abs(cr) >= 1e-12 && miterRatio(cos) <= style.miterLimit) {
    const M = add(P, mul(add(n1, n2), (side * h) / (1 + cos)));
    return [{ type: 'L', to: M }, { type: 'L', to }];
  }
  return [{ type: 'L', to }];
}

/** A cap at an open end E leaving in the unit direction t (outwards), from E + h·perp(t) to E − h·perp(t). */
export function cap(E: Pt, t: Pt, h: number, kind: LineCap): LoopSeg[] {
  const n = perp(t);
  const L = add(E, mul(n, h));
  const R = sub(E, mul(n, h));
  if (kind === 'butt') return [{ type: 'L', to: R }];
  if (kind === 'square') return [{ type: 'L', to: add(L, mul(t, h)) }, { type: 'L', to: add(R, mul(t, h)) }, { type: 'L', to: R }];
  return arcSegs(E, h, Math.atan2(n[1], n[0]), -Math.PI); // through E + h·t
}

/** A cubic's two offsets (left at +h, right at −h), split until each piece's fits within tol: each a run of cubics from its start. */
export function cubicOffsets(c: Cub, h: number, tol: number): { left: LoopSeg[]; right: LoopSeg[]; pieces: number } {
  const left: LoopSeg[] = [];
  const right: LoopSeg[] = [];
  let pieces = 0;
  const rec = (t0: number, t1: number, depth: number) => {
    const L = fitOffset(c, t0, t1, h);
    const R = fitOffset(c, t0, t1, -h);
    if (depth < MAX_DEPTH && (fitError(c, t0, t1, h, L) > tol || fitError(c, t0, t1, -h, R) > tol)) {
      const m = (t0 + t1) / 2;
      rec(t0, m, depth + 1);
      rec(m, t1, depth + 1);
      return;
    }
    pieces++;
    left.push({ type: 'C', c1: L[1], c2: L[2], to: L[3] });
    right.push({ type: 'C', c1: R[1], c2: R[2], to: R[3] });
  };
  rec(0, 1, 0);
  return { left, right, pieces };
}

interface Piece {
  from: Pt;
  to: Pt;
  ts: Pt; // unit tangent where it starts
  te: Pt; // and where it ends
  left: LoopSeg[]; // its left offset after its start (+h)
  right: LoopSeg[]; // its right offset after its start (−h)
  l0: Pt; // where each starts
  r0: Pt;
  mid: Pt; // a point on the path inside it (orientation)
}

// A run of segments from `start` walked backwards: each segment's own reversal, the last first.
function reversedRun(start: Pt, segs: readonly LoopSeg[]): LoopSeg[] {
  const pts: Pt[] = [start, ...segs.map((s) => s.to)];
  const out: LoopSeg[] = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    out.push(s.type === 'L' ? { type: 'L', to: pts[i] } : { type: 'C', c1: s.c2, c2: s.c1, to: pts[i] });
  }
  return out;
}

const reversedLoop = (l: Loop): Loop => {
  const segs = reversedRun(l.start, l.segs);
  return { start: segs.length ? l.segs[l.segs.length - 1].to : l.start, segs };
};

// The pieces of a subpath: each segment that draws something, with its offsets.
function piecesOf(sp: Subpath, h: number, tol: number): Piece[] {
  const pieces: Piece[] = [];
  let at = sp.start;
  for (const seg of sp.segs) {
    const from = at;
    at = seg.to;
    if (seg.type === 'L') {
      const t = unit(sub(seg.to, from));
      if (!t || !(len(sub(seg.to, from)) > 1e-9 * Math.max(1, Math.abs(from[0]), Math.abs(from[1])))) continue;
      const n = mul(perp(t), h);
      pieces.push({ from, to: seg.to, ts: t, te: t, left: [{ type: 'L', to: add(seg.to, n) }], right: [{ type: 'L', to: sub(seg.to, n) }], l0: add(from, n), r0: sub(from, n), mid: mul(add(from, seg.to), 0.5) });
      continue;
    }
    const c: Cub = [from, seg.c1, seg.c2, seg.to];
    if (!(Math.max(...c.map((p) => len(sub(p, from)))) > 1e-9 * scaleOf(c))) continue; // all four points at one place
    const ts = cubicTangent(c, 0);
    const te = cubicTangent(c, 1);
    if (!ts || !te) continue;
    const o = cubicOffsets(c, h, tol);
    pieces.push({ from, to: seg.to, ts, te, left: o.left, right: o.right, l0: offsetAt(c, 0, h), r0: offsetAt(c, 0, -h), mid: cubicAt(c, 0.5) });
  }
  return pieces;
}

/**
 * The stroke of these subpaths as loops that fill it under nonzero (see the header), one array per
 * subpath that draws: an open subpath's one loop (its left offsets forward with their corners, the end
 * cap, its right offsets back, the start cap), a closed one's two (its left offsets, and its right
 * offsets the other way), each turned so its stroke winds +1, so overlapping subpaths add up.
 */
export function strokeLoops(subpaths: readonly Subpath[], style: StrokeStyle): Loop[][] {
  const h = style.width / 2;
  const tol = style.width / 200;
  const out: Loop[][] = [];
  if (!(h > 0) || !Number.isFinite(h)) return out;
  for (const sp of subpaths) {
    const pieces = piecesOf(sp, h, tol);
    if (!pieces.length) {
      // A zero-length subpath: round and square caps draw it (on the user axes for a square).
      const [x, y] = sp.start;
      if (style.cap === 'round') out.push([circleLoop(sp.start, h)]);
      else if (style.cap === 'square') out.push([lineLoop([[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]])]);
      continue;
    }
    const loops: Loop[] = [];
    const n = pieces.length;
    if (sp.closed) {
      const left: LoopSeg[] = [];
      for (let i = 0; i < n; i++) {
        left.push(...pieces[i].left, ...corner(pieces[(i + 1) % n].from, pieces[i].te, pieces[(i + 1) % n].ts, h, 1, false, style));
      }
      loops.push({ start: pieces[0].l0, segs: left });
      // The right offsets walked back from the first piece's start: the corner at the start first.
      const right: LoopSeg[] = [];
      for (let i = n - 1; i >= 0; i--) {
        const next = pieces[(i + 1) % n];
        right.push(...corner(next.from, pieces[i].te, next.ts, h, -1, true, style), ...reversedRun(pieces[i].r0, pieces[i].right));
      }
      loops.push({ start: pieces[0].r0, segs: right });
    } else {
      const segs: LoopSeg[] = [];
      for (let i = 0; i < n; i++) {
        segs.push(...pieces[i].left);
        if (i < n - 1) segs.push(...corner(pieces[i + 1].from, pieces[i].te, pieces[i + 1].ts, h, 1, false, style));
      }
      const last = pieces[n - 1];
      segs.push(...cap(last.to, last.te, h, style.cap));
      for (let i = n - 1; i >= 0; i--) {
        segs.push(...reversedRun(pieces[i].r0, pieces[i].right));
        if (i > 0) segs.push(...corner(pieces[i].from, pieces[i - 1].te, pieces[i].ts, h, -1, true, style));
      }
      segs.push(...cap(pieces[0].from, mul(pieces[0].ts, -1), h, style.cap));
      loops.push({ start: pieces[0].l0, segs });
    }
    // Turned so the stroke winds +1 at a point on the path (a positive area is clockwise on screen).
    const w = windingOf(loops.map((l) => polygons(loopsToAbs([l]))[0] ?? []), pieces[0].mid[0], pieces[0].mid[1]);
    out.push(w < 0 ? loops.map(reversedLoop) : loops);
  }
  return out;
}

// ── an element's stroke ────────────────────────────────────────────────────────────────────────

export const NO_STROKE = 'It has no stroke.';
export const ZERO_WIDTH = 'Its stroke has no width.';
export const DASHED = 'Dashed strokes aren’t converted yet.';
export const NON_SCALING = 'A non-scaling stroke changes with the zoom, so it has no one outline.';
export const MARKERS = 'Its markers would be lost.';
export const UNREADABLE_PAINT = 'Draw can’t read its stroke’s paint.';
export const BOX_GRADIENT = 'Its stroke’s gradient is laid out on its box, which the outline would change.';
export const PAINT_ORDER = 'It paints its stroke under its fill, which a path over it can’t keep.';
export const RULED = 'A <style> rule may paint it, which Draw can’t read yet (P2).';
export const BOX_EFFECT = (prop: string) => `Its ${prop} is laid out on its box, which the outline would change.`;

export interface StrokeOf {
  style: StrokeStyle;
  /** The stroke's paint as written (a colour or url(#…)). */
  paint: string;
  /** Where the paint comes from: the element's own value, or an ancestor's (the result then writes stroke="none"). */
  inherited: boolean;
  /** The stroke-opacity it draws with, as written ('1' when none is). */
  opacity: string;
  /** The fill-opacity it would draw a fill with now, as written ('1' when none is). */
  fillOpacity: string;
  /** Whether it keeps a fill (its fill computes to something other than none, and it isn't a line). */
  filled: boolean;
}

// A value as it draws on the element, or null when a <style> rule may decide it.
const value = (doc: Doc, id: NodeId, prop: string): string | null => shownValue(doc, id, prop).value;

// A non-inherited property set on the element itself (attribute or style=""), or one a rule may set.
function ownSet(doc: Doc, id: NodeId, prop: string): 'no' | 'yes' | 'rule' {
  const s = styleSource(doc, id, prop);
  if (s.sheet !== 'no') return 'rule';
  return s.value !== null && s.value.toLowerCase() !== 'none' ? 'yes' : 'no';
}

/** An element's stroke as Draw outlines it (see the header), or why not. */
export function strokeOf(doc: Doc, id: NodeId, ctx: GeoContext): StrokeOf | { refused: string } {
  const n = el(doc, id);
  const shown = shownValue(doc, id, 'stroke');
  if (shown.value === null) return { refused: RULED };
  const paint = parsePaint(shown.value);
  if (paint?.kind === 'none') return { refused: NO_STROKE };
  if (!paint || paint.kind === 'context-fill' || paint.kind === 'context-stroke') return { refused: UNREADABLE_PAINT };
  if (paint.kind === 'url') {
    const g = idMap(doc).get(paint.id);
    const node = g === undefined ? undefined : doc.nodes.get(g);
    if (!isGradient(node)) return { refused: UNREADABLE_PAINT };
    const r = resolveGradient(doc, node.id);
    if (!r || valueOf(r, 'gradientUnits') !== 'userSpaceOnUse') return { refused: BOX_GRADIENT };
  }
  const props = ['stroke-width', 'stroke-linejoin', 'stroke-linecap', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-opacity', 'fill', 'fill-opacity', 'paint-order', 'vector-effect'];
  const v: Record<string, string> = {};
  for (const p of props) {
    const x = value(doc, id, p);
    if (x === null) return { refused: RULED };
    v[p] = x.trim();
  }
  const width = resolveLength(v['stroke-width'], lengthCtx(doc, n, 'other', ctx, v['stroke-width']));
  if (width === null || !Number.isFinite(width) || width < 0) return { refused: 'Draw can’t read its stroke-width.' };
  if (width === 0) return { refused: ZERO_WIDTH };
  const dash = v['stroke-dasharray'].toLowerCase();
  if (dash !== 'none') {
    const parts = dash.split(/[\s,]+/).filter(Boolean).map(Number);
    if (parts.some((x) => !Number.isFinite(x) || x < 0)) return { refused: 'Draw can’t read its stroke-dasharray.' };
    if (parts.some((x) => x > 0)) return { refused: DASHED };
  }
  if (v['vector-effect'].toLowerCase() === 'non-scaling-stroke') return { refused: NON_SCALING };
  // Markers inherit: the element's own, or an ancestor's.
  for (const m of ['marker', 'marker-start', 'marker-mid', 'marker-end']) {
    for (let a: NodeId | null = id; a !== null; a = el(doc, a).parent) {
      const s = styleSource(doc, a, m);
      if (ruleWins(s) || s.sheet !== 'no') return { refused: RULED };
      if (s.value !== null && s.value.toLowerCase() !== 'inherit') {
        if (s.value.toLowerCase() !== 'none') return { refused: MARKERS };
        break;
      }
    }
  }
  for (const p of ['clip-path', 'mask', 'filter']) {
    const set = ownSet(doc, id, p);
    if (set === 'rule') return { refused: RULED };
    if (set === 'yes') return { refused: BOX_EFFECT(p) };
  }
  const joinWord = v['stroke-linejoin'].toLowerCase();
  const join: LineJoin | null = joinWord === 'round' ? 'round' : joinWord === 'bevel' ? 'bevel' : ['miter', 'miter-clip', 'arcs'].includes(joinWord) ? 'miter' : null;
  if (!join) return { refused: 'Draw can’t read its stroke-linejoin.' };
  const capWord = v['stroke-linecap'].toLowerCase();
  const cap: LineCap | null = capWord === 'butt' || capWord === 'round' || capWord === 'square' ? capWord : null;
  if (!cap) return { refused: 'Draw can’t read its stroke-linecap.' };
  const miterLimit = Number(v['stroke-miterlimit']);
  if (!Number.isFinite(miterLimit) || miterLimit < 1) return { refused: 'Draw can’t read its stroke-miterlimit.' };
  const fill = parsePaint(v.fill);
  const filled = n.local !== 'line' && fill?.kind !== 'none';
  if (filled && v['paint-order'].toLowerCase() !== 'normal' && !/^fill(\s|$)/i.test(v['paint-order'])) return { refused: PAINT_ORDER };
  return {
    style: { width, join, miterLimit, cap },
    paint: shown.value.trim(),
    inherited: shown.from === 'ancestor',
    opacity: v['stroke-opacity'],
    fillOpacity: v['fill-opacity'],
    filled,
  };
}

/** The element's own attribute, if it has one (for a write that copies it). */
export const ownAttr = (doc: Doc, id: NodeId, local: string): string | null => attrValue(doc, el(doc, id), null, local);
