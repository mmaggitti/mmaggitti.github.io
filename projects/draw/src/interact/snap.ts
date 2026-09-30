// Snapping, pure. A move is rounded to the snap step: whole root user units at the fit, finer only
// once the view is well zoomed in, so a drag lands on numbers a person would write.
//
// The snap step is the smallest of 1, 0.5, 0.1, 0.05 and 0.01 root user units whose on-screen length
// is at least SNAP_STEP_MIN_PX, and never coarser than 1: a 24 × 24 icon at the fit on a phone is
// about 18 px a unit, so it moves by whole units; 0.5 appears at about 4×.

import { fmt } from '../../../../engine/values/number-format.ts';

export const SNAP_STEP_MIN_PX = 32;
const STEPS = [0.01, 0.05, 0.1, 0.5, 1];

/** The snap step in root user units for `pxPerUnit` screen px per root user unit. */
export function snapStep(pxPerUnit: number): number {
  for (const s of STEPS) if (s * pxPerUnit >= SNAP_STEP_MIN_PX) return s;
  return 1;
}

/** The decimal places a step is written with (1 → 0, 0.5 → 1, 0.05 → 2). */
export function stepDecimals(step: number): number {
  const s = fmt(step, 10);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** A value rounded to the step (written as the step would write it). */
export function toStep(v: number, step: number): number {
  return Number(fmt(Math.round(v / step) * step, stepDecimals(step)));
}
