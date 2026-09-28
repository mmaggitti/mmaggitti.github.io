// Exact geometric bounding box of an absolute path (no stroke): segment endpoints, plus each curve's
// interior extrema, found where its derivative is zero (quadratic: linear root; cubic: quadratic
// roots; arc: the angles where the rotated ellipse turns in x or y). A moveto's point counts unless
// another moveto replaces it at once ("M1 1 M2 2" is the point 2,2), which is what Chromium's
// getBBox does; a lone "M x y" has a point box.

import type { AbsSeg } from './abs.ts';
import { arcCenter, arcPoint } from './arc.ts';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function pathBounds(abs: readonly AbsSeg[]): Box | null {
  if (!abs.length) return null;
  const b: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  };
  abs.forEach((s, i) => {
    if (s.type === 'M') {
      if (abs[i + 1]?.type !== 'M') add(s.x, s.y);
      return;
    }
    add(s.x0, s.y0);
    add(s.x, s.y);
    if (s.type === 'Q') {
      for (const t of [quadRoot(s.x0, s.x1, s.x), quadRoot(s.y0, s.y1, s.y)]) {
        if (t > 0 && t < 1) add(quad(s.x0, s.x1, s.x, t), quad(s.y0, s.y1, s.y, t));
      }
    } else if (s.type === 'C') {
      for (const t of [...cubicRoots(s.x0, s.x1, s.x2, s.x), ...cubicRoots(s.y0, s.y1, s.y2, s.y)]) {
        add(cubic(s.x0, s.x1, s.x2, s.x, t), cubic(s.y0, s.y1, s.y2, s.y, t));
      }
    } else if (s.type === 'A') {
      const a = arcCenter(s.x0, s.y0, s.rx, s.ry, s.rot, s.large, s.sweep, s.x, s.y);
      if (typeof a === 'string') return; // a line or nothing: the endpoints cover it
      const cos = Math.cos(a.phi);
      const sin = Math.sin(a.phi);
      const tx = Math.atan2(-a.ry * sin, a.rx * cos); // dx/dt = 0
      const ty = Math.atan2(a.ry * cos, a.rx * sin); // dy/dt = 0
      for (const t of [tx, tx + Math.PI, ty, ty + Math.PI]) {
        // how far along the sweep, in its own direction, this angle is
        const along = mod2pi((t - a.t1) * Math.sign(a.dt));
        if (along < Math.abs(a.dt)) add(...arcPoint(a, t));
      }
    }
  });
  return b;
}

const mod2pi = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

const quad = (p0: number, p1: number, p2: number, t: number) => (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;

const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

// Where the quadratic's derivative is zero (NaN or out of range when it has no interior extremum).
const quadRoot = (p0: number, p1: number, p2: number) => (p0 - p1) / (p0 - 2 * p1 + p2);

// Interior roots of the cubic's derivative, a t² + b t + c (divided by 3). The q form is
// cancellation-free and degrades to the linear root when a = 0.
function cubicRoots(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(disc)) / 2;
  return [q / a, c / q].filter((t) => t > 0 && t < 1);
}
