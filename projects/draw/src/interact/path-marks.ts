// The path marks (P1-M3), pure: what the overlay draws for a path in the Node tool, and for the Pen's
// drag, in host px (the overlay model's units), from the engine's geometry in the element's own units
// and the element's measured toHost. SVG Lab's guides:
// - arms (`draw-arm`, the lab's .arm): a C's start → first control and second control → end, a Q's
//   start → control → end, an S's second control → end;
// - mirror guides (`draw-arm draw-arm--mirror` and the dashed dot `draw-mirror`, the lab's .armd and
//   .refl): the control an S or T implies, from the segment's start to it (and on to a T's end), a dot
//   there; nothing when it is the start itself;
// - while the Pen drags a point p to the finger f: both arms, p → f and p → 2p − f.
// S2 (SVG Lab's Arcs lesson):
// - ghost arcs (`draw-ghost`, the lab's .ghost): an arc's three other flag pairs, as cubics through
//   toHost, and a flag label (`draw-flag-label`, the lab's .fl) "L S" beside each arc and the arc's
//   own (`on`); a tap within 22 px of a ghost picks it (ghostAt);
// - direction arrows (`draw-dir`, the lab's .dir, every subpath after the first `draw-dir--in`): the
//   lab's triangle at the parameter midpoint of every drawing segment, along its direction; on a
//   straight segment, whose bend handle is drawn on top at its midpoint, just past that handle;
// - a donut's percentage labels (`draw-donut-label`, the lab's .gt) at each slice's middle angle.

import { apply, type Affine } from '../../../../engine/values/affine.ts';
import type { Mirror, Point as UnitPoint } from '../../../../engine/path/nodes.ts';
import type { AbsSeg } from '../../../../engine/path/abs.ts';
import { arcCenter, arcPoint, arcToCubics } from '../../../../engine/path/arc.ts';
import type { Line } from './overlay-model.ts';
import type { Point, Size } from '../canvas/viewport.ts';

/** A ghost arc in host px: its flags ("L S"), its start, and its cubics (each two controls and an end). */
export interface Ghost {
  flags: string;
  start: Point;
  cubics: [Point, Point, Point][];
}
/** An arc's flag label, host px (the baseline's middle). */
export interface FlagLabel {
  text: string;
  at: Point;
  on: boolean; // the arc's own flags
}
/** A direction arrow: the lab's triangle (tip, then its base's two corners), host px. */
export interface Arrow {
  points: [Point, Point, Point];
  inner: boolean; // a subpath after the first
}
/** A donut's percentage label, host px (its centre). */
export interface DonutLabel {
  text: string;
  at: Point;
}

export interface PathMarks {
  arms: Line[];
  mirrors: Line[]; // dashed arms
  dots: Point[]; // dashed dots at the implied controls
  ghosts: Ghost[];
  flags: FlagLabel[];
  arrows: Arrow[];
  donut: DonutLabel[];
}

export const NO_PATH_MARKS: PathMarks = { arms: [], mirrors: [], dots: [], ghosts: [], flags: [], arrows: [], donut: [] };

const host = (m: Affine, p: UnitPoint): Point => {
  const [x, y] = apply(m, p.x, p.y);
  return { x, y };
};

/** A path's arms and mirror guides (engine/path/nodes.ts, element units) in host px through its toHost. */
export function pathMarks(nodes: { arms: readonly [UnitPoint, UnitPoint][]; mirrors: readonly Mirror[] }, toHost: Affine): PathMarks {
  const line = (a: UnitPoint, b: UnitPoint): Line => ({ from: host(toHost, a), to: host(toHost, b) });
  const mirrors: Line[] = [];
  for (const m of nodes.mirrors) {
    mirrors.push(line(m.from, m.at));
    if (m.to) mirrors.push(line(m.at, m.to));
  }
  return { ...NO_PATH_MARKS, arms: nodes.arms.map(([a, b]) => line(a, b)), mirrors, dots: nodes.mirrors.map((m) => host(toHost, m.at)) };
}

/** The Pen's arms while it drags from p to f (host px): the out-handle and its reflection. */
export function penArms(p: Point, f: Point): Line[] {
  return [
    { from: p, to: f },
    { from: p, to: { x: 2 * p.x - f.x, y: 2 * p.y - f.y } },
  ];
}

// ── arcs: ghosts and flag labels (S2) ──────────────────────────────────────────────────────────

/** An arc segment's parameters, in the element's own units. */
export interface ArcParams {
  x0: number;
  y0: number;
  rx: number;
  ry: number;
  rot: number;
  large: boolean;
  sweep: boolean;
  x: number;
  y: number;
}

const PAIRS: readonly [boolean, boolean][] = [[false, false], [false, true], [true, false], [true, true]];
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const flagsText = (large: boolean, sweep: boolean): string => `${+large} ${+sweep}`;

/**
 * The arc's three other flag pairs as ghosts (arcToCubics in its units, every point through toHost:
 * an affine map keeps a cubic a cubic), and a label "L S" for the arc and each ghost at that arc's
 * midpoint, pushed 10 px away from the chord's midpoint (upwards when within 0.5 px of it), 4 px lower
 * for the baseline, and clamped 8 px inside the canvas horizontally, 13 px from its top and 4 px from
 * its bottom. Nothing for an arc that is omitted (equal endpoints) or a line (a zero radius).
 */
export function arcGhosts(a: ArcParams, toHost: Affine, canvas: Size): { ghosts: Ghost[]; flags: FlagLabel[] } {
  const own = arcCenter(a.x0, a.y0, a.rx, a.ry, a.rot, a.large, a.sweep, a.x, a.y);
  if (own === 'none' || own === 'line') return { ghosts: [], flags: [] };
  const h = (x: number, y: number) => host(toHost, { x, y });
  const chord = h((a.x0 + a.x) / 2, (a.y0 + a.y) / 2);
  const ghosts: Ghost[] = [];
  const flags: FlagLabel[] = [];
  for (const [large, sweep] of PAIRS) {
    const on = large === a.large && sweep === a.sweep;
    const text = flagsText(large, sweep);
    if (!on) {
      const cubics = arcToCubics(a.x0, a.y0, a.rx, a.ry, a.rot, large, sweep, a.x, a.y).map(([x1, y1, x2, y2, x, y]): [Point, Point, Point] => [h(x1, y1), h(x2, y2), h(x, y)]);
      ghosts.push({ flags: text, start: h(a.x0, a.y0), cubics });
    }
    const c = arcCenter(a.x0, a.y0, a.rx, a.ry, a.rot, large, sweep, a.x, a.y);
    if (c === 'none' || c === 'line') continue;
    const [mx, my] = arcPoint(c, c.t1 + c.dt / 2);
    const mid = h(mx, my);
    let dx = mid.x - chord.x;
    let dy = mid.y - chord.y;
    const dl = Math.hypot(dx, dy);
    if (dl > 0.5) {
      dx /= dl;
      dy /= dl;
    } else {
      dx = 0;
      dy = -1;
    }
    flags.push({ text, on, at: { x: clamp(mid.x + dx * 10, 8, canvas.width - 8), y: clamp(mid.y + dy * 10 + 4, 13, canvas.height - 4) } });
  }
  return { ghosts, flags };
}

const bez = (p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p1.x, y: a * p0.y + b * c1.y + c * c2.y + d * p1.y };
};

function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The ghost a tap at `at` (host px) picks: the nearest within `within` px of its curve, each cubic flattened to 16 points; else null. */
export function ghostAt(ghosts: readonly Ghost[], at: Point, within = 22): Ghost | null {
  let best: Ghost | null = null;
  let bestD = within;
  for (const g of ghosts) {
    let p0 = g.start;
    for (const [c1, c2, p1] of g.cubics) {
      let prev = p0;
      for (let i = 1; i <= 16; i++) {
        const q = bez(p0, c1, c2, p1, i / 16);
        const d = toSegment(at, prev, q);
        if (d <= bestD) {
          bestD = d;
          best = g;
        }
        prev = q;
      }
      p0 = p1;
    }
  }
  return best;
}

// ── holes: direction arrows (S2) ───────────────────────────────────────────────────────────────

/** At most this many arrows are drawn (the rest aren't). */
export const MAX_ARROWS = 200;
const ARROW = 4.5; // SVG Lab's s, px
// What a straight segment's arrow keeps clear of (the handles' sizes in canvas/overlay/marks.ts,
// HANDLE): its bend handle, a circle of radius 6.5 px when active, and its end anchor, a square of
// half-side 7 px when active (7√2 at 45°), each by the arrow's own reach (its tip, 1.7s from its centre).
const BEND_REACH = 6.5;
const ANCHOR_REACH = 7 * Math.SQRT2;
const ARROW_REACH = 1.7 * ARROW;

// A segment's point and direction at its parameter midpoint (t = 0.5), in its units; null when it has no length.
function midway(s: AbsSeg): { p: [number, number]; d: [number, number] } | null {
  const chord: [number, number] = [s.x - s.x0, s.y - s.y0];
  if (s.type === 'L' || s.type === 'Z') return chord[0] || chord[1] ? { p: [(s.x0 + s.x) / 2, (s.y0 + s.y) / 2], d: chord } : null;
  if (s.type === 'Q') {
    const p: [number, number] = [0.25 * s.x0 + 0.5 * s.x1 + 0.25 * s.x, 0.25 * s.y0 + 0.5 * s.y1 + 0.25 * s.y];
    const d: [number, number] = [s.x - s.x0, s.y - s.y0];
    return d[0] || d[1] ? { p, d } : s.x1 !== s.x0 || s.y1 !== s.y0 ? { p, d: [s.x1 - s.x0, s.y1 - s.y0] } : null;
  }
  if (s.type === 'C') {
    const p: [number, number] = [0.125 * s.x0 + 0.375 * s.x1 + 0.375 * s.x2 + 0.125 * s.x, 0.125 * s.y0 + 0.375 * s.y1 + 0.375 * s.y2 + 0.125 * s.y];
    const d: [number, number] = [0.75 * (s.x1 - s.x0) + 1.5 * (s.x2 - s.x1) + 0.75 * (s.x - s.x2), 0.75 * (s.y1 - s.y0) + 1.5 * (s.y2 - s.y1) + 0.75 * (s.y - s.y2)];
    if (d[0] || d[1]) return { p, d };
    return chord[0] || chord[1] ? { p, d: chord } : null;
  }
  if (s.type === 'A') {
    const a = arcCenter(s.x0, s.y0, s.rx, s.ry, s.rot, s.large, s.sweep, s.x, s.y);
    if (a === 'none') return null;
    if (a === 'line') return { p: [(s.x0 + s.x) / 2, (s.y0 + s.y) / 2], d: chord };
    const t = a.t1 + a.dt / 2;
    const cos = Math.cos(a.phi);
    const sin = Math.sin(a.phi);
    const k = Math.sign(a.dt);
    return { p: arcPoint(a, t), d: [k * (-cos * a.rx * Math.sin(t) - sin * a.ry * Math.cos(t)), k * (-sin * a.rx * Math.sin(t) + cos * a.ry * Math.cos(t))] };
  }
  return null;
}

/**
 * A path's direction arrows (for a path of two or more subpaths): SVG Lab's triangle (tip (1.7s, 0),
 * base (−s, ±s), s = 4.5 px) at the parameter midpoint of every drawing segment of nonzero length (a
 * Z's closing line too), pointing along the segment there (its derivative through toHost's linear
 * part); every subpath after the first is `inner`. At most MAX_ARROWS. A straight segment (an L, H or
 * V: the Node tool draws its bend handle on top at its midpoint) has its arrow moved along it, towards
 * its end, just clear of that handle, when it is long enough to stay clear of its end anchor too;
 * one shorter keeps it at the midpoint. Curves keep theirs at the midpoint.
 */
export function directionArrows(abs: readonly AbsSeg[], toHost: Affine): Arrow[] {
  const out: Arrow[] = [];
  for (const s of abs) {
    if (out.length >= MAX_ARROWS) break;
    if (s.type === 'M') continue;
    const m = midway(s);
    if (!m) continue;
    const c = host(toHost, { x: m.p[0], y: m.p[1] });
    const dx = toHost[0] * m.d[0] + toHost[2] * m.d[1];
    const dy = toHost[1] * m.d[0] + toHost[3] * m.d[1];
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;
    const ux = dx / len;
    const uy = dy / len;
    const past = BEND_REACH + ARROW_REACH;
    const shift = s.type === 'L' && 'LHV'.includes(s.cmd.toUpperCase()) && len / 2 - past >= ANCHOR_REACH + ARROW_REACH ? past : 0;
    const P = (a: number, b: number): Point => ({ x: c.x + (a + shift) * ux - b * uy, y: c.y + (a + shift) * uy + b * ux });
    out.push({ points: [P(1.7 * ARROW, 0), P(-ARROW, -ARROW), P(-ARROW, ARROW)], inner: s.sub > 0 });
  }
  return out;
}

// ── the donut's percentage labels (S2) ─────────────────────────────────────────────────────────

/** Each slice's share, round(v / total · 100) + "%", at its middle angle on radius r · 43/28 (SVG Lab's 43 for r 28), through the holder's toHost. */
export function donutLabels(d: { values: readonly number[]; cx: number; cy: number; r: number }, toHost: Affine): DonutLabel[] {
  const S = d.values.reduce((a, b) => a + b, 0);
  const R = (d.r * 43) / 28;
  let acc = 0;
  return d.values.map((v) => {
    const mid = -Math.PI / 2 + ((acc + v / 2) / S) * 2 * Math.PI;
    acc += v;
    return { text: `${Math.round((v / S) * 100)}%`, at: host(toHost, { x: d.cx + R * Math.cos(mid), y: d.cy + R * Math.sin(mid) }) };
  });
}
