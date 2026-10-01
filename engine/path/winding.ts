// Winding numbers and inside-ness of a path's fill (P1-M3): what the holes goal, Reverse's tests and
// the booleans' self-check and corpus score with. Pure and DOM-free.
//
// - The fill of each subpath is closed back to its start, as SVG fills it (an open subpath too).
// - Lines count exactly; quadratics, cubics and arcs are flattened first, each piece subdivided
//   until it is within a tolerance of its chord (at its midpoint and quarter points): 0.01 units by
//   default; a boolean's (its score, and its result's orientation) a share of its geometry's box, so
//   the work follows what is drawn, not the drawing's units (the P1-M3 review, R6).
// - A ray from (x, y) towards +x meets the outline's edges; each crossing is counted half-open at
//   its ends, so a vertex on the ray is counted once. windingAt sums them signed (+1 for an edge
//   going up through the ray, towards −y in SVG's y-down units, −1 for one going down): nonzero
//   fills where that sum isn't 0. crossingsAt counts them unsigned: evenodd fills where the count
//   is odd.
// - booleanScore (S3) scores a boolean's result against its inputs on a lattice of samples, one row
//   at a time (each row's crossings sorted once, then swept).

import type { AbsSeg } from './abs.ts';
import { arcCenter, arcPoint } from './arc.ts';
import { pathBounds } from './bounds.ts';

export type FillRule = 'nonzero' | 'evenodd';
export type Pt = [number, number];

/** How far a flattened piece may stray from its chord, in the path's units (the default). */
export const FLAT = 0.01;
/** A boolean's tolerance: this share of its geometry's box diagonal (far finer than the self-check's 0.5% skip band). */
export const FLAT_SHARE = 1e-4;

/** The flattening tolerance for these paths: FLAT_SHARE of their box's diagonal (FLAT when they have no extent). */
export function flatFor(paths: readonly (readonly AbsSeg[])[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const abs of paths) {
    const b = pathBounds(abs);
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  return diag > 0 && Number.isFinite(diag) ? FLAT_SHARE * diag : FLAT;
}

// A curve flattened into points after its start (the end included), each piece within tol of its chord.
function flatten(f: (t: number) => Pt, out: Pt[], tol: number, depth = 0, t0 = 0, t1 = 1, p0: Pt = f(0), p1: Pt = f(1)): void {
  const tm = (t0 + t1) / 2;
  const pm = f(tm);
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  // a point's distance from the chord (from p0, when the chord has no length)
  const off = (p: Pt) => (len < 1e-12 ? Math.hypot(p[0] - p0[0], p[1] - p0[1]) : Math.abs((p[0] - p0[0]) * dy - (p[1] - p0[1]) * dx) / len);
  // the midpoint and the quarter points: a curve can cross its chord at the middle
  if (depth >= 16 || (depth >= 2 && off(pm) <= tol && off(f((t0 + tm) / 2)) <= tol && off(f((tm + t1) / 2)) <= tol)) {
    out.push(p1);
    return;
  }
  flatten(f, out, tol, depth + 1, t0, tm, p0, pm);
  flatten(f, out, tol, depth + 1, tm, t1, pm, p1);
}

/** The points one absolute segment adds after its start (its end included), curves flattened within tol. */
export function segmentPoints(s: AbsSeg, out: Pt[], tol = FLAT): void {
  if (s.type === 'M') return;
  if (s.type === 'L' || s.type === 'Z') {
    out.push([s.x, s.y]);
    return;
  }
  if (s.type === 'Q') {
    flatten((t) => {
      const u = 1 - t;
      return [u * u * s.x0 + 2 * u * t * s.x1 + t * t * s.x, u * u * s.y0 + 2 * u * t * s.y1 + t * t * s.y];
    }, out, tol);
    return;
  }
  if (s.type === 'C') {
    flatten((t) => {
      const u = 1 - t;
      const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return [a * s.x0 + b * s.x1 + c * s.x2 + d * s.x, a * s.y0 + b * s.y1 + c * s.y2 + d * s.y];
    }, out, tol);
    return;
  }
  const a = arcCenter(s.x0, s.y0, s.rx, s.ry, s.rot, s.large, s.sweep, s.x, s.y);
  if (a === 'none') return; // equal endpoints: the arc is omitted
  if (a === 'line') out.push([s.x, s.y]);
  else flatten((t) => (t === 0 ? [s.x0, s.y0] : t === 1 ? [s.x, s.y] : arcPoint(a, a.t1 + t * a.dt)), out, tol);
}

/** The path's fill outline: each subpath's points, to be closed back to its start (as SVG fills it), curves flattened within tol. */
export function polygons(abs: readonly AbsSeg[], tol = FLAT): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] | null = null;
  for (const s of abs) {
    if (s.type === 'M') {
      if (cur && cur.length > 1) out.push(cur);
      cur = [[s.x, s.y]];
      continue;
    }
    if (!cur) cur = [[s.x0, s.y0]];
    segmentPoints(s, cur, tol);
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

// ── a boolean's score (P1-M3 S3) ───────────────────────────────────────────────────────────────

export type BoolOp = 'union' | 'difference' | 'intersection' | 'exclusion';
export interface ScoreInput {
  abs: readonly AbsSeg[];
  rule: FillRule;
}
export interface Score {
  counted: number; // samples not skipped
  nonzero: number; // the share of them the result gets wrong under nonzero
  evenodd: number; // and under evenodd
}

/** What the operation says of a point, given whether each input (in order, the bottom first) holds it. */
export function opHolds(op: BoolOp, inside: readonly boolean[]): boolean {
  switch (op) {
    case 'union':
      return inside.some(Boolean);
    case 'intersection':
      return inside.length > 0 && inside.every(Boolean);
    case 'difference':
      return inside[0] === true && !inside.slice(1).some(Boolean); // the bottom minus the rest
    default:
      return inside.filter(Boolean).length % 2 === 1; // covered by an odd number of them
  }
}

// One row of the lattice: every edge's crossing with the line at y, as x and the winding it adds to a
// point left of it (the same half-open rule as windingOf), sorted by x.
function rowCrossings(polys: readonly (readonly Pt[])[], y: number): { x: number; s: number }[] {
  const out: { x: number; s: number }[] = [];
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[(i + 1) % p.length];
      if (y0 <= y && y1 > y) out.push({ x: x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), s: -1 });
      else if (y1 <= y && y0 > y) out.push({ x: x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), s: 1 });
    }
  }
  return out.sort((a, b) => a.x - b.x);
}

// For points xs (ascending) on one row: the winding number and the crossing count to the right of each.
function sweep(crossings: readonly { x: number; s: number }[], xs: readonly number[]): { w: number; n: number }[] {
  let w = crossings.reduce((a, c) => a + c.s, 0);
  let n = crossings.length;
  let k = 0;
  return xs.map((x) => {
    while (k < crossings.length && crossings[k].x <= x) {
      w -= crossings[k].s;
      n--;
      k++;
    }
    return { w, n };
  });
}

/**
 * How a boolean's result agrees with the operation on its inputs: a grid × grid lattice of cell
 * centres over the inputs' union box, samples within `skip` (a share of the box's diagonal) of any
 * input's outline left out; for the rest, the share where the result's fill, under nonzero and under
 * evenodd, differs from the operation on the inputs' fills (each under its own rule). Every curve is
 * flattened within FLAT_SHARE of the inputs' box diagonal.
 */
export function booleanScore(inputs: readonly ScoreInput[], op: BoolOp, result: readonly AbsSeg[], grid: number, skip: number): Score {
  const flat = flatFor(inputs.map((i) => i.abs));
  const ins = inputs.map((i) => polygons(i.abs, flat));
  const res = polygons(result, flat);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const polys of ins) for (const p of polys) for (const [x, y] of p) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!(maxX > minX && maxY > minY)) return { counted: 0, nonzero: 0, evenodd: 0 };
  const cw = (maxX - minX) / grid;
  const ch = (maxY - minY) / grid;
  const tol = skip * Math.hypot(maxX - minX, maxY - minY);
  const xs = Array.from({ length: grid }, (_, i) => minX + (i + 0.5) * cw);
  // Samples near an outline: each edge marks the cells within tol of it.
  const near = new Uint8Array(grid * grid);
  for (const polys of ins) for (const p of polys) for (let e = 0; e < p.length; e++) {
    const [ax, ay] = p[e];
    const [bx, by] = p[(e + 1) % p.length];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - tol - minX) / cw - 0.5));
    const i1 = Math.min(grid - 1, Math.ceil((Math.max(ax, bx) + tol - minX) / cw - 0.5));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - tol - minY) / ch - 0.5));
    const j1 = Math.min(grid - 1, Math.ceil((Math.max(ay, by) + tol - minY) / ch - 0.5));
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    for (let j = j0; j <= j1; j++) {
      const y = minY + (j + 0.5) * ch;
      for (let i = i0; i <= i1; i++) {
        if (near[j * grid + i]) continue;
        const x = xs[i];
        const t = len > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
        if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) < tol) near[j * grid + i] = 1;
      }
    }
  }
  let counted = 0;
  let nz = 0;
  let eo = 0;
  for (let j = 0; j < grid; j++) {
    const y = minY + (j + 0.5) * ch;
    const each = ins.map((polys) => sweep(rowCrossings(polys, y), xs));
    const got = sweep(rowCrossings(res, y), xs);
    for (let i = 0; i < grid; i++) {
      if (near[j * grid + i]) continue;
      counted++;
      const want = opHolds(op, each.map((c, k) => (inputs[k].rule === 'evenodd' ? c[i].n % 2 === 1 : c[i].w !== 0)));
      if ((got[i].w !== 0) !== want) nz++;
      if ((got[i].n % 2 === 1) !== want) eo++;
    }
  }
  return { counted, nonzero: counted ? nz / counted : 0, evenodd: counted ? eo / counted : 0 };
}
