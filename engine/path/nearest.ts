// The point on a path nearest to (x, y), for tap-to-select and insert-a-node. Lines project
// exactly. Curves and arcs are sampled coarsely, then every sampled local minimum is refined by
// golden-section search on the squared distance, so a curve that doubles back is not caught on the
// wrong branch. t is the segment's own parameter (arcs: fraction of the sweep angle).

import type { AbsSeg } from './abs.ts';
import { arcCenter, arcPoint } from './arc.ts';

export interface Nearest {
  segIndex: number;
  t: number;
  x: number;
  y: number;
  distance: number;
}

type Curve = (t: number) => [number, number];

const SAMPLES = 64;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

export function nearestPoint(abs: readonly AbsSeg[], x: number, y: number): Nearest | null {
  let best: Nearest | null = null;
  const consider = (segIndex: number, t: number, [px, py]: [number, number]) => {
    const distance = Math.hypot(px - x, py - y);
    if (!best || distance < best.distance) best = { segIndex, t, x: px, y: py, distance };
  };
  abs.forEach((s, i) => {
    if (s.type === 'M') {
      // A drawing segment after a moveto covers its point; a moveto followed by one replaces it.
      if (i === abs.length - 1) consider(i, 1, [s.x, s.y]);
    } else if (s.type === 'L' || s.type === 'Z') {
      consider(i, ...projectLine(s.x0, s.y0, s.x, s.y, x, y));
    } else if (s.type === 'Q') {
      const f: Curve = (t) => {
        const u = 1 - t;
        return [u * u * s.x0 + 2 * u * t * s.x1 + t * t * s.x, u * u * s.y0 + 2 * u * t * s.y1 + t * t * s.y];
      };
      const t = minimize(f, x, y);
      consider(i, t, f(t));
    } else if (s.type === 'C') {
      const f: Curve = (t) => {
        const u = 1 - t;
        const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
        return [a * s.x0 + b * s.x1 + c * s.x2 + d * s.x, a * s.y0 + b * s.y1 + c * s.y2 + d * s.y];
      };
      const t = minimize(f, x, y);
      consider(i, t, f(t));
    } else {
      const a = arcCenter(s.x0, s.y0, s.rx, s.ry, s.rot, s.large, s.sweep, s.x, s.y);
      if (a === 'none') consider(i, 0, [s.x0, s.y0]);
      else if (a === 'line') consider(i, ...projectLine(s.x0, s.y0, s.x, s.y, x, y));
      else {
        // Pin the ends to the exact endpoints; the angle form reproduces them only to rounding.
        const f: Curve = (t) => (t === 0 ? [s.x0, s.y0] : t === 1 ? [s.x, s.y] : arcPoint(a, a.t1 + t * a.dt));
        const t = minimize(f, x, y);
        consider(i, t, f(t));
      }
    }
  });
  return best;
}

function projectLine(x0: number, y0: number, x1: number, y1: number, px: number, py: number): [number, [number, number]] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - x0) * dx + (py - y0) * dy) / len2));
  return [t, [x0 + t * dx, y0 + t * dy]];
}

// Parameter in [0, 1] of the curve point nearest (px, py).
function minimize(f: Curve, px: number, py: number): number {
  const d2 = (t: number) => {
    const [x, y] = f(t);
    return (x - px) ** 2 + (y - py) ** 2;
  };
  const d: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) d.push(d2(i / SAMPLES));
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    if ((i > 0 && d[i - 1] < d[i]) || (i < SAMPLES && d[i + 1] < d[i])) continue; // not a local minimum
    let lo = Math.max(0, (i - 1) / SAMPLES);
    let hi = Math.min(1, (i + 1) / SAMPLES);
    let m1 = hi - GOLDEN * (hi - lo);
    let m2 = lo + GOLDEN * (hi - lo);
    let f1 = d2(m1);
    let f2 = d2(m2);
    while (hi - lo > 1e-12) {
      if (f1 <= f2) {
        hi = m2;
        m2 = m1;
        f2 = f1;
        m1 = hi - GOLDEN * (hi - lo);
        f1 = d2(m1);
      } else {
        lo = m1;
        m1 = m2;
        f1 = f2;
        m2 = lo + GOLDEN * (hi - lo);
        f2 = d2(m2);
      }
    }
    // The search never evaluates the bracket's ends, and the minimum may sit exactly on a sample.
    const mid = (lo + hi) / 2;
    for (const [t, v] of [[i / SAMPLES, d[i]], [mid, d2(mid)]]) {
      if (v < bestD) {
        bestD = v;
        bestT = t;
      }
    }
  }
  return bestT;
}
