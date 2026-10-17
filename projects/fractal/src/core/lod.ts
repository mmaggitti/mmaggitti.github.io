// Level of detail: what a panel shows at its size on screen. Thresholds have hysteresis (enter
// below T, leave above 1.15 T) so a size hovering at a threshold doesn't flicker. Content stays
// mounted in every tier; changing tier only toggles attributes. (From the ideas of Trellis's
// frame-only panels, FRAME_ONLY in runtime/workspace.ts, with phone thresholds.)

import type { Rect } from './types.ts';

export type Tier = 'live' | 'scaled' | 'tile';

export const HYSTERESIS = 1.15;

/** Tile below this on-screen size, in rem. */
export const TILE_REM = { w: 7, h: 5.5 };

/** `contentScale` is how much the panel's content is drawn scaled down on screen right now. */
export function tierOf(frame: Rect, contentScale: number, remPx: number, prev?: Tier): Tier {
  const f = prev === 'tile' ? HYSTERESIS : 1;
  if (frame.w < TILE_REM.w * remPx * f || frame.h < TILE_REM.h * remPx * f) return 'tile';
  return contentScale < 0.999 ? 'scaled' : 'live';
}
