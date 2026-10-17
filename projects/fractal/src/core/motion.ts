// Motion: a similarity camera (uniform scale + translate, one CSS transform on the whole layer),
// interpolated in log space, and a critically damped spring for progress. Spring constants start
// from Trellis's runtime/motion.ts (stiffness 210, damping 29); the log-space similarity is Fractal's
// own, so deep zooms move at an even pace.

import type { Rect } from './types.ts';

/** screen = k · layer + (x, y) */
export interface Sim {
  k: number;
  x: number;
  y: number;
}

export const IDENTITY: Sim = { k: 1, x: 0, y: 0 };

export function apply(s: Sim, r: Rect): Rect {
  return { x: s.k * r.x + s.x, y: s.k * r.y + s.y, w: s.k * r.w, h: s.k * r.h };
}

export function invert(s: Sim, r: Rect): Rect {
  return { x: (r.x - s.x) / s.k, y: (r.y - s.y) / s.k, w: r.w / s.k, h: r.h / s.k };
}

export function point(s: Sim, p: { x: number; y: number }) {
  return { x: s.k * p.x + s.x, y: s.k * p.y + s.y };
}

/** The similarity that maps rect `from` onto rect `to` as closely as one scale can: the geometric
 * mean of the two axis ratios, centres aligned. */
export function fit(from: Rect, to: Rect): Sim {
  const k = Math.sqrt((to.w / Math.max(from.w, 1e-9)) * (to.h / Math.max(from.h, 1e-9)));
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  return { k, x: to.x + to.w / 2 - k * cx, y: to.y + to.h / 2 - k * cy };
}

/** Between two cameras at progress p: scale in log space, and the anchor (a layer point) moving in a
 * straight line on screen, so the thing you're zooming toward travels steadily. */
export function between(a: Sim, b: Sim, p: number, anchor: { x: number; y: number }): Sim {
  if (p <= 0) return a;
  if (p >= 1) return b;
  const k = Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * p);
  const pa = point(a, anchor);
  const pb = point(b, anchor);
  const cx = pa.x + (pb.x - pa.x) * p;
  const cy = pa.y + (pb.y - pa.y) * p;
  return { k, x: cx - k * anchor.x, y: cy - k * anchor.y };
}

export function lerpRect(a: Rect, b: Rect, p: number): Rect {
  return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, w: a.w + (b.w - a.w) * p, h: a.h + (b.h - a.h) * p };
}

export function sameRect(a: Rect, b: Rect, eps = 0.01): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.w - b.w) < eps && Math.abs(a.h - b.h) < eps;
}

export const SPRING = { stiffness: 210, damping: 29, maxStep: 0.032, epsilon: 5e-4 };

export interface SpringState {
  p: number;
  v: number;
}

/** One step of the spring toward 1. Returns the next state and whether it has come to rest. */
export function step(s: SpringState, dt: number): { state: SpringState; done: boolean } {
  const t = Math.min(Math.max(dt, 0), SPRING.maxStep) || 0.016;
  const v = s.v + ((1 - s.p) * SPRING.stiffness - s.v * SPRING.damping) * t;
  const p = s.p + v * t;
  const done = Math.abs(1 - p) < SPRING.epsilon && Math.abs(v) < SPRING.epsilon * 20;
  return done ? { state: { p: 1, v: 0 }, done } : { state: { p, v }, done };
}
