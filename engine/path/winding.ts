// Winding numbers and inside-ness of a path's fill (P1-M3): what the holes goal, Reverse's tests and
// the boolean corpus score with. Pure and DOM-free.
//
// - The fill of each subpath is closed back to its start, as SVG fills it (an open subpath too).
// - Lines count exactly; quadratics, cubics and arcs are flattened first, each piece subdivided
//   until it is within 0.01 units of its chord (at its midpoint and quarter points).
// - A ray from (x, y) towards +x meets the outline's edges; each crossing is counted half-open at
//   its ends, so a vertex on the ray is counted once. windingAt sums them signed (+1 for an edge
//   going up through the ray, towards −y in SVG's y-down units, −1 for one going down): nonzero
//   fills where that sum isn't 0. crossingsAt counts them unsigned: evenodd fills where the count
//   is odd.

import type { AbsSeg } from './abs.ts';
import { arcCenter, arcPoint } from './arc.ts';

export type FillRule = 'nonzero' | 'evenodd';
export type Pt = [number, number];

/** How far a flattened piece may stray from its chord, in the path's units. */
export const FLAT = 0.01;

// A curve flattened into points after its start (the end included), each piece within FLAT of its chord.
function flatten(f: (t: number) => Pt, out: Pt[], depth = 0, t0 = 0, t1 = 1, p0: Pt = f(0), p1: Pt = f(1)): void {
  const tm = (t0 + t1) / 2;
  const pm = f(tm);
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  // a point's distance from the chord (from p0, when the chord has no length)
  const off = (p: Pt) => (len < 1e-12 ? Math.hypot(p[0] - p0[0], p[1] - p0[1]) : Math.abs((p[0] - p0[0]) * dy - (p[1] - p0[1]) * dx) / len);
  // the midpoint and the quarter points: a curve can cross its chord at the middle
  if (depth >= 16 || (depth >= 2 && off(pm) <= FLAT && off(f((t0 + tm) / 2)) <= FLAT && off(f((tm + t1) / 2)) <= FLAT)) {
    out.push(p1);
    return;
  }
  flatten(f, out, depth + 1, t0, tm, p0, pm);
  flatten(f, out, depth + 1, tm, t1, pm, p1);
}

/** The points one absolute segment adds after its start (its end included), curves flattened. */
export function segmentPoints(s: AbsSeg, out: Pt[]): void {
  if (s.type === 'M') return;
  if (s.type === 'L' || s.type === 'Z') {
    out.push([s.x, s.y]);
    return;
  }
  if (s.type === 'Q') {
    flatten((t) => {
      const u = 1 - t;
      return [u * u * s.x0 + 2 * u * t * s.x1 + t * t * s.x, u * u * s.y0 + 2 * u * t * s.y1 + t * t * s.y];
    }, out);
    return;
  }
  if (s.type === 'C') {
    flatten((t) => {
      const u = 1 - t;
      const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return [a * s.x0 + b * s.x1 + c * s.x2 + d * s.x, a * s.y0 + b * s.y1 + c * s.y2 + d * s.y];
    }, out);
    return;
  }
  const a = arcCenter(s.x0, s.y0, s.rx, s.ry, s.rot, s.large, s.sweep, s.x, s.y);
  if (a === 'none') return; // equal endpoints: the arc is omitted
  if (a === 'line') out.push([s.x, s.y]);
  else flatten((t) => (t === 0 ? [s.x0, s.y0] : t === 1 ? [s.x, s.y] : arcPoint(a, a.t1 + t * a.dt)), out);
}

/** The path's fill outline: each subpath's points, to be closed back to its start (as SVG fills it). */
export function polygons(abs: readonly AbsSeg[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] | null = null;
  for (const s of abs) {
    if (s.type === 'M') {
      if (cur && cur.length > 1) out.push(cur);
      cur = [[s.x, s.y]];
      continue;
    }
    if (!cur) cur = [[s.x0, s.y0]];
    segmentPoints(s, cur);
    if (s.type === 'Z') {
      out.push(cur);
      cur = [[s.x, s.y]]; // a command after Z starts a new subpath at the same point
    }
  }
  if (cur && cur.length > 1) out.push(cur);
  return out;
}

/** The signed crossings of a ray from (x, y) towards +x with the closed outline: its winding number. */
export function windingOf(polys: readonly (readonly Pt[])[], x: number, y: number): number {
  let w = 0;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[(i + 1) % p.length];
      if (y0 <= y && y1 > y) {
        if (x0 + ((y - y0) / (y1 - y0)) * (x1 - x0) > x) w--; // going down (y-down units)
      } else if (y1 <= y && y0 > y) {
        if (x0 + ((y - y0) / (y1 - y0)) * (x1 - x0) > x) w++; // going up
      }
    }
  }
  return w;
}

/** How many of the closed outline's edges a ray from (x, y) towards +x crosses, unsigned. */
export function crossingsOf(polys: readonly (readonly Pt[])[], x: number, y: number): number {
  let n = 0;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[(i + 1) % p.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        if (x0 + ((y - y0) / (y1 - y0)) * (x1 - x0) > x) n++;
      }
    }
  }
  return n;
}

/** Is (x, y) inside the outline under `rule`? */
export function insideOf(polys: readonly (readonly Pt[])[], x: number, y: number, rule: FillRule): boolean {
  return rule === 'evenodd' ? crossingsOf(polys, x, y) % 2 === 1 : windingOf(polys, x, y) !== 0;
}

/** The winding number of a path's fill around (x, y) (the nonzero rule's count). */
export function windingAt(abs: readonly AbsSeg[], x: number, y: number): number {
  return windingOf(polygons(abs), x, y);
}

/** Is (x, y) inside the path's fill under `rule`? */
export function insideAt(abs: readonly AbsSeg[], x: number, y: number, rule: FillRule): boolean {
  return insideOf(polygons(abs), x, y, rule);
}
