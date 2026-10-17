// Where the camera settles when a pinch or pan is released. This replaces Trellis's bestFit
// (log-size + 2.5 × centre distance, model/spatial.ts), which in testing sprang back to the overview
// when pinching into a big panel near the middle of the layout. Here every candidate contains the
// focal point, the direction of the gesture picks the set, and size alone picks within it.

import type { Rect } from './types.ts';

export type Relation = 'ancestor' | 'descendant' | 'self' | 'page';

export interface Candidate {
  id: string | null;
  box: Rect;
  relation: Relation;
  /** Levels from the current frame (1 = parent or child). */
  levels?: number;
}

export interface Release {
  /** Scale since the gesture began (>1 zoomed in). */
  scale: number;
  /** The gesture's focal point, in rest-layout coordinates. */
  focal: { x: number; y: number };
  /** What the screen shows now, in rest-layout coordinates. */
  view: Rect;
  /** Pan velocity in rest-layout px per ms. */
  vx: number;
  vy: number;
}

export const ZOOM_OUT = 0.8;
export const ZOOM_IN = 1.25;
export const PAGE_COMMIT = 0.25;
export const FLICK = 0.5;
export const PROJECT_MS = 120;
/** Each level skipped costs this much score: a moderate pinch moves one level, a strong one more. */
export const LEVEL_COST = 0.35;

const contains = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** How far a candidate's size is from what the screen shows, by area: frames have every aspect
 * (a row of pages is wide and short) while a pinch zooms uniformly, so per-axis ratios would punish
 * the parent you meant. */
export function sizeScore(box: Rect, view: Rect): number {
  return Math.abs(Math.log((box.w * box.h) / (view.w * view.h)));
}

/** Pick the frame to settle on. Returns the current frame's candidate when nothing else wins. */
export function snap(candidates: Candidate[], r: Release): string | null {
  const self = candidates.find((c) => c.relation === 'self');
  const fallback = self ? self.id : null;
  const best = (list: Candidate[]) => {
    let out: Candidate | null = null;
    let score = Infinity;
    for (const c of list) {
      const s = sizeScore(c.box, r.view) + LEVEL_COST * Math.max(0, (c.levels ?? 1) - 1);
      if (s < score) {
        score = s;
        out = c;
      }
    }
    return out;
  };
  if (r.scale < ZOOM_OUT) {
    const ups = candidates.filter((c) => c.relation === 'ancestor');
    return ups.length ? best(ups)!.id : fallback;
  }
  if (r.scale > ZOOM_IN) {
    const downs = candidates.filter((c) => c.relation === 'descendant' && contains(c.box, r.focal));
    return downs.length ? best(downs)!.id : fallback;
  }
  // A pan: move to the page nearest the projected view centre, if it moved far enough or was flicked.
  if (!self) return fallback;
  const cx = r.view.x + r.view.w / 2 + r.vx * PROJECT_MS;
  const cy = r.view.y + r.view.h / 2 + r.vy * PROJECT_MS;
  const sx = self.box.x + self.box.w / 2;
  const sy = self.box.y + self.box.h / 2;
  const movedX = (cx - sx) / self.box.w;
  const movedY = (cy - sy) / self.box.h;
  const flicked = Math.hypot(r.vx, r.vy) > FLICK;
  if (Math.max(Math.abs(movedX), Math.abs(movedY)) < PAGE_COMMIT && !flicked) return fallback;
  // Move in the gesture's direction: to the page nearest the projected centre among those that lie
  // that way. A pan past a quarter width, or a flick, always moves at least one page.
  const dir = flicked
    ? { x: Math.abs(r.vx) >= Math.abs(r.vy) ? Math.sign(r.vx) : 0, y: Math.abs(r.vy) > Math.abs(r.vx) ? Math.sign(r.vy) : 0 }
    : { x: Math.abs(movedX) >= Math.abs(movedY) ? Math.sign(movedX) : 0, y: Math.abs(movedY) > Math.abs(movedX) ? Math.sign(movedY) : 0 };
  let out: Candidate = self;
  let dist = Infinity;
  for (const c of candidates) {
    if (c.relation !== 'page') continue;
    const ox = Math.sign(c.box.x - self.box.x);
    const oy = Math.sign(c.box.y - self.box.y);
    if (!((dir.x !== 0 && ox === dir.x) || (dir.y !== 0 && oy === dir.y))) continue;
    const d = Math.hypot(c.box.x + c.box.w / 2 - cx, c.box.y + c.box.h / 2 - cy);
    if (d < dist) {
      dist = d;
      out = c;
    }
  }
  return out.id;
}
