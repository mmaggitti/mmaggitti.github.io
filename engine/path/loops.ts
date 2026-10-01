// Closed loops of lines and cubics (P1-M3 S3): what a boolean takes in and gives back. Pure and
// DOM-free.
//
// - toLoops: absolute path data as closed loops of lines and cubics only (as the plan says): a Q is
//   raised to a C exactly, an arc becomes arcToCubics' cubics (at most 90° each); S and T are already
//   resolved and H and V already lines (toAbsolute); each subpath is closed back to its start, as a
//   fill closes it.
// - orientLoops: each loop turned so its direction says what it is, by how many of the other loops
//   hold it: an outer loop clockwise on screen (a positive shoelace area in SVG's y-down units), a
//   hole the other way, a hole's island clockwise again; so the loops fill alike under nonzero and
//   evenodd.
// - loopsD: the loops as d, each "M x y", then " L x y" or " C x1 y1 x2 y2 x y", then " Z", joined by
//   one space, numbers fmt(v, 3); a last line back to the start is left to the Z.

import type { AbsSeg } from './abs.ts';
import { arcToCubics } from './arc.ts';
import { fmt } from '../values/number-format.ts';
import { apply, type Affine } from '../values/affine.ts';
import { flatFor, polygons, windingOf, type Pt } from './winding.ts';

export type LoopSeg = { type: 'L'; to: Pt } | { type: 'C'; c1: Pt; c2: Pt; to: Pt };
export interface Loop {
  start: Pt;
  segs: LoopSeg[];
}

const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) <= 1e-9 && Math.abs(a[1] - b[1]) <= 1e-9;

/** Absolute path data as closed loops of lines and cubics (a subpath that draws nothing is left out). */
export function toLoops(abs: readonly AbsSeg[]): Loop[] {
  const out: Loop[] = [];
  let cur: Loop | null = null;
  const flush = (next: Loop | null) => {
    if (cur && cur.segs.length) {
      if (!same(cur.segs[cur.segs.length - 1].to, cur.start)) cur.segs.push({ type: 'L', to: cur.start });
      out.push(cur);
    }
    cur = next;
  };
  for (const s of abs) {
    if (s.type === 'M') {
      flush({ start: [s.x, s.y], segs: [] });
      continue;
    }
    if (s.type === 'Z') {
      flush({ start: [s.x, s.y], segs: [] }); // a command after Z starts a new subpath at the start
      continue;
    }
    if (!cur) cur = { start: [s.x0, s.y0], segs: [] };
    const segs: LoopSeg[] = (cur as Loop).segs;
    if (s.type === 'L') segs.push({ type: 'L', to: [s.x, s.y] });
    else if (s.type === 'C') segs.push({ type: 'C', c1: [s.x1, s.y1], c2: [s.x2, s.y2], to: [s.x, s.y] });
    else if (s.type === 'Q') {
      // degree elevation: the same curve, exactly
      segs.push({ type: 'C', c1: [s.x0 + (2 / 3) * (s.x1 - s.x0), s.y0 + (2 / 3) * (s.y1 - s.y0)], c2: [s.x + (2 / 3) * (s.x1 - s.x), s.y + (2 / 3) * (s.y1 - s.y)], to: [s.x, s.y] });
    } else {
      for (const [x1, y1, x2, y2, x, y] of arcToCubics(s.x0, s.y0, s.rx, s.ry, s.rot, s.large, s.sweep, s.x, s.y)) segs.push({ type: 'C', c1: [x1, y1], c2: [x2, y2], to: [x, y] });
    }
  }
  flush(null);
  return out;
}

/** Loops through an affine map (a cubic stays a cubic). */
export function mapLoops(loops: readonly Loop[], m: Affine): Loop[] {
  const f = (p: Pt): Pt => apply(m, p[0], p[1]);
  return loops.map((l) => ({ start: f(l.start), segs: l.segs.map((s): LoopSeg => (s.type === 'L' ? { type: 'L', to: f(s.to) } : { type: 'C', c1: f(s.c1), c2: f(s.c2), to: f(s.to) })) }));
}

/** Loops as toAbsolute's absolute path data (what winding.ts reads). */
export function loopsToAbs(loops: readonly Loop[]): AbsSeg[] {
  const out: AbsSeg[] = [];
  loops.forEach((l, sub) => {
    let [x0, y0] = l.start;
    out.push({ cmd: 'M', sub, type: 'M', x0, y0, x: x0, y: y0 });
    for (const s of l.segs) {
      const [x, y] = s.to;
      if (s.type === 'L') out.push({ cmd: 'L', sub, type: 'L', x0, y0, x, y });
      else out.push({ cmd: 'C', sub, type: 'C', x0, y0, x1: s.c1[0], y1: s.c1[1], x2: s.c2[0], y2: s.c2[1], x, y });
      [x0, y0] = [x, y];
    }
    out.push({ cmd: 'Z', sub, type: 'Z', x0, y0, x: l.start[0], y: l.start[1] });
  });
  return out;
}

const shoelace = (p: readonly Pt[]): number => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};

/** The loop's signed area over its flattened outline: positive is clockwise on screen (y down). */
export const loopArea = (l: Loop): number => shoelace(polygons(loopsToAbs([l]))[0] ?? []);

const reversed = (l: Loop): Loop => {
  const pts: Pt[] = [l.start, ...l.segs.map((s) => s.to)];
  const segs: LoopSeg[] = [];
  for (let i = l.segs.length - 1; i >= 0; i--) {
    const s = l.segs[i];
    segs.push(s.type === 'L' ? { type: 'L', to: pts[i] } : { type: 'C', c1: s.c2, c2: s.c1, to: pts[i] });
  }
  return { start: pts[pts.length - 1], segs };
};

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const boxOf = (p: readonly Pt[]): Box => {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of p) {
    b.x0 = Math.min(b.x0, x);
    b.y0 = Math.min(b.y0, y);
    b.x1 = Math.max(b.x1, x);
    b.y1 = Math.max(b.y1, y);
  }
  return b;
};

// The loops that may hold loop i, found through a uniform grid over all the boxes (about √n × √n
// cells): each loop is listed in every cell its box covers, and a loop that holds loop i covers i's
// box, so it is listed in the cell of that box's corner. So n small disjoint loops cost n, not n².
function holdersOf(boxes: readonly Box[]): (i: number) => readonly number[] {
  const all = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const b of boxes) {
    if (!(b.x0 <= b.x1)) continue; // no points
    all.x0 = Math.min(all.x0, b.x0);
    all.y0 = Math.min(all.y0, b.y0);
    all.x1 = Math.max(all.x1, b.x1);
    all.y1 = Math.max(all.y1, b.y1);
  }
  const g = Math.max(1, Math.ceil(Math.sqrt(boxes.length)));
  const cw = (all.x1 - all.x0) / g || 1;
  const ch = (all.y1 - all.y0) / g || 1;
  const col = (x: number) => Math.min(g - 1, Math.max(0, Math.floor((x - all.x0) / cw)));
  const row = (y: number) => Math.min(g - 1, Math.max(0, Math.floor((y - all.y0) / ch)));
  const cells: number[][] = Array.from({ length: g * g }, () => []);
  boxes.forEach((b, j) => {
    if (!(b.x0 <= b.x1)) return;
    for (let r = row(b.y0); r <= row(b.y1); r++) for (let c = col(b.x0); c <= col(b.x1); c++) cells[r * g + c].push(j);
  });
  return (i) => (boxes[i].x0 <= boxes[i].x1 ? cells[row(boxes[i].y0) * g + col(boxes[i].x0)] : []);
}

// How many of the other loops hold loop i: a few points along it (its edges' midpoints) tested
// against each loop whose box holds its box, the majority deciding (a point on another loop's outline
// can't decide alone).
function depthOf(polys: readonly Pt[][], boxes: readonly Box[], holders: readonly number[], i: number): number {
  const me = polys[i];
  if (me.length < 2) return 0;
  const probes: Pt[] = [];
  const step = Math.max(1, Math.floor(me.length / 7));
  for (let k = 0; k < me.length && probes.length < 7; k += step) {
    const [a, b] = [me[k], me[(k + 1) % me.length]];
    probes.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  const bi = boxes[i];
  let depth = 0;
  for (const j of holders) {
    const bj = boxes[j];
    if (j === i || polys[j].length < 3 || bj.x0 > bi.x0 || bj.y0 > bi.y0 || bj.x1 < bi.x1 || bj.y1 < bi.y1) continue;
    const inside = probes.filter(([x, y]) => windingOf([polys[j]], x, y) !== 0).length;
    if (inside * 2 > probes.length) depth++;
  }
  return depth;
}

/** The loops turned by nesting depth: even depths clockwise on screen, odd ones the other way (curves flattened within FLAT_SHARE of the loops' box). */
export function orientLoops(loops: readonly Loop[]): Loop[] {
  const flat = flatFor([loopsToAbs(loops)]);
  const polys = loops.map((l) => polygons(loopsToAbs([l]), flat)[0] ?? []);
  const boxes = polys.map(boxOf);
  const holders = holdersOf(boxes);
  return loops.map((l, i) => ((shoelace(polys[i]) > 0) === (depthOf(polys, boxes, holders(i), i) % 2 === 0) ? l : reversed(l)));
}

/** The loops as d (the header's spelling). */
export function loopsD(loops: readonly Loop[]): string {
  const p = (q: Pt) => `${fmt(q[0], 3)} ${fmt(q[1], 3)}`;
  return loops
    .map((l) => {
      const segs = l.segs.slice();
      const last = segs[segs.length - 1];
      if (last && last.type === 'L' && same(last.to, l.start)) segs.pop();
      return `M ${p(l.start)}${segs.map((s) => (s.type === 'L' ? ` L ${p(s.to)}` : ` C ${p(s.c1)} ${p(s.c2)} ${p(s.to)}`)).join('')} Z`;
    })
    .join(' ');
}
