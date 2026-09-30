// Snapping, pure. A move is rounded to the snap step: whole root user units at the fit, finer only
// once the view is well zoomed in, so a drag lands on numbers a person would write. Before that, a
// target within 8 px on screen takes it (S3): guides, other shapes' edges and centres, the artboard's
// edges and centre, and the grid's lines while the grid is shown, each as the Snap sheet allows.
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

// ── snapping to targets (S3) ──────────────────────────────────────────────────────────────────

export const SNAP_PX = 8; // on screen: a target this near takes the point

export type SnapKind = 'guide' | 'shape' | 'artboard' | 'grid';
const RANK: Record<SnapKind, number> = { guide: 0, shape: 1, artboard: 2, grid: 3 };

export interface SnapTarget {
  at: number; // root user units: an x for a vertical target, a y for a horizontal one
  kind: SnapKind;
}
/** What a move or a handle can snap to, per axis, in root user units; `grid` is the step while the grid is shown and snapped to. */
export interface SnapTargets {
  x: SnapTarget[];
  y: SnapTarget[];
  grid: number | null;
}
/** Which targets are on (the Snap sheet's toggles, a device preference). */
export interface SnapPrefs {
  grid: boolean;
  guides: boolean;
  shapes: boolean;
  artboard: boolean;
}
export const SNAP_ALL: SnapPrefs = { grid: true, guides: true, shapes: true, artboard: true };

/**
 * One axis: the candidates (a box's low edge, middle and high edge, or one point) moved by `d`,
 * against the targets and the grid's lines. The nearest within `tol` wins (ties: guide, shape,
 * artboard, grid), and the delta that lands the candidate on it comes back with the target; null
 * when none is near.
 */
export function snapAxis(candidates: readonly number[], d: number, targets: readonly SnapTarget[], grid: number | null, tol: number): { d: number; at: number; kind: SnapKind } | null {
  let best: { d: number; at: number; kind: SnapKind; dist: number } | null = null;
  const consider = (p: number, at: number, kind: SnapKind) => {
    const dist = Math.abs(at - p);
    if (dist > tol) return;
    if (!best || dist < best.dist - 1e-9 || (Math.abs(dist - best.dist) <= 1e-9 && RANK[kind] < RANK[best.kind])) best = { d: d + at - p, at, kind, dist };
  };
  for (const c of candidates) {
    const p = c + d;
    for (const t of targets) consider(p, t.at, t.kind);
    if (grid && grid > 0) consider(p, Math.round(p / grid) * grid, 'grid');
  }
  if (!best) return null;
  const b = best as { d: number; at: number; kind: SnapKind };
  return { d: b.d, at: b.at, kind: b.kind };
}

/** A target set's edges and centres of boxes (root units), as vertical and horizontal targets. */
export function boxTargets(boxes: readonly { x: number; y: number; width: number; height: number }[], kind: SnapKind): { x: SnapTarget[]; y: SnapTarget[] } {
  const x: SnapTarget[] = [];
  const y: SnapTarget[] = [];
  for (const b of boxes) {
    x.push({ at: b.x, kind }, { at: b.x + b.width / 2, kind }, { at: b.x + b.width, kind });
    y.push({ at: b.y, kind }, { at: b.y + b.height / 2, kind }, { at: b.y + b.height, kind });
  }
  return { x, y };
}
