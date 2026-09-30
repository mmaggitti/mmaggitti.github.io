// The selection's handles (SVG Lab's Stage handles): where each goes for the element's screen quad,
// and which one a press takes. Pure, no DOM: the editor measures, this places, the overlay draws
// (src/canvas/overlay/marks.ts, SVG Lab's sizes and colours).
//
// For one selected element (not the root, not locked):
// - resize corners ('anchor') at the quad's four corners, when the element takes them and both
//   sides of the quad are at least 32 px (the centre and the ring stay; the pick rule settles the
//   rest);
// - the centre ('center') at the quad's centre: dragging it is a move;
// - the rotation ring ('rot') 40 px beyond the middle of the quad's top edge, along the element's
//   own −y axis (it turns with the element), with a guide line from the pivot;
// - the scale diamond ('scale'), only when its list has a scale(), 20 px beyond the quad's
//   bottom-right corner on the ray from the scale pivot.
// For several, only a centre handle at the union box's centre (a move of all).
// A press takes the nearest handle whose centre is within 26 px; on a tie, the one drawn last
// (drawing order: corners, centre, ring, diamond).

import type { Handle, Line, Quad } from './overlay-model.ts';
import type { Point, Rect } from '../canvas/viewport.ts';

export const HANDLE_PICK_PX = 26;
export const CORNER_MIN_PX = 32;
export const RING_PX = 40;
export const DIAMOND_PX = 20;

/** The four corners, in quad order: top-left, top-right, bottom-right, bottom-left (local axes). */
export const CORNERS = ['tl', 'tr', 'br', 'bl'] as const;
export type CornerId = (typeof CORNERS)[number];

export interface HandleFrame {
  quad: Quad; // the element's local box through its CTM, in host px
  corners: boolean; // the element takes resize corners
  rotPivot: Point | null; // host px; null: no ring
  scalePivot: Point | null; // host px; null: no diamond (no scale() item)
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (from: Point, to: Point, fallback: Point): Point => {
  const d = dist(from, to);
  return d > 1e-9 ? { x: (to.x - from.x) / d, y: (to.y - from.y) / d } : fallback;
};
const centreOf = (q: Quad): Point => ({ x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 });

/** One element's handles in drawing order, the active one marked, and the ring's guide line. */
export function handlesFor(f: HandleFrame, active: string | null): { handles: Handle[]; rotGuide: Line | null } {
  const q = f.quad;
  const handles: Handle[] = [];
  const add = (id: string, kind: Handle['kind'], at: Point) => handles.push({ id, kind, at, active: id === active });
  if (f.corners && dist(q[0], q[1]) >= CORNER_MIN_PX && dist(q[0], q[3]) >= CORNER_MIN_PX) CORNERS.forEach((c, i) => add(c, 'anchor', q[i]));
  const centre = centreOf(q);
  add('center', 'center', centre);
  let rotGuide: Line | null = null;
  if (f.rotPivot) {
    const up = unit(q[3], q[0], { x: 0, y: -1 }); // the element's own −y, on screen
    const top = { x: (q[0].x + q[1].x) / 2, y: (q[0].y + q[1].y) / 2 };
    const ring = { x: top.x + RING_PX * up.x, y: top.y + RING_PX * up.y };
    add('rot', 'rot', ring);
    rotGuide = { from: f.rotPivot, to: ring };
  }
  if (f.scalePivot) {
    const out = unit(f.scalePivot, q[2], unit(centre, q[2], { x: Math.SQRT1_2, y: Math.SQRT1_2 }));
    add('scale', 'scale', { x: q[2].x + DIAMOND_PX * out.x, y: q[2].y + DIAMOND_PX * out.y });
  }
  return { handles, rotGuide };
}

/** Several selected: one centre handle at the union box's centre. */
export function handlesForMany(box: Rect, active: string | null): Handle[] {
  return [{ id: 'center', kind: 'center', at: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, active: active === 'center' }];
}

/** The handle a press at `at` takes: the nearest within 26 px, the one drawn last on a tie. */
export function pickHandle<T extends { at: Point }>(handles: readonly T[], at: Point, radius = HANDLE_PICK_PX): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const h of handles) {
    const d = dist(h.at, at);
    if (d <= radius && d <= bestD + 1e-9) {
      best = h;
      bestD = Math.min(d, bestD);
    }
  }
  return best;
}

/** Whole degrees, magnetic: within 4° of a multiple of 15, that multiple. */
export function magneticAngle(a: number): number {
  const r = Math.round(a);
  const m = Math.round(r / 15) * 15;
  return (Math.abs(r - m) <= 4 ? m : r) + 0; // + 0: never −0, which would be written "-0"
}

/** The scale diamond's value: steps of 0.05, from 0.2 to 4 in size, keeping its sign (a mirror stays one). */
export function scaleStep(k: number): number {
  if (k < 0) return -scaleStep(-k);
  const s = Math.round(k / 0.05) * 0.05;
  return Math.min(4, Math.max(0.2, Number(s.toFixed(2))));
}
