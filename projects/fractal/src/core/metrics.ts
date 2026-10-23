// Pixel metrics for layout, derived from the root font size so they follow --ui-scale like the
// rest of the site. The core takes remPx as an input (it can't read CSS), and the runtime reads it
// from the document once per resize.

export interface Metrics {
  /** CSS px per rem (12 at the site's 75% scale). */
  remPx: number;
  /** Space between panels, and around the outside. */
  gap: number;
  /** The caption row above a tile: its name (and tabs). Small on purpose: its touch targets reach
   * the 44pt floor by spilling past the row (see the workspace), not by making the row tall. */
  caption: number;
  /** Smallest panel: a caption, plus a little body. */
  panelMin: { w: number; h: number };
}

/** The tap floor (ds.css --tap-min): 44 CSS px at every scale. */
export const TAP_MIN = 44;

/** The looks Fractal can wear: Mosaic (tiles edge to edge, hairline seams) is the default, Mark's
 * pick (2026-10-22); Bento (rounded tiles, small gaps) and Layered (raised cards, wider gaps) stay
 * selectable. `metrics()` itself defaults to Bento's spacing, which the unit tests are written in. */
export type Look = 'bento' | 'mosaic' | 'layered';
export const LOOKS: readonly Look[] = ['mosaic', 'bento', 'layered'];
export const DEFAULT_LOOK: Look = 'mosaic';

const GAP_REM: Record<Look, number> = { bento: 0.5, mosaic: 0, layered: 0.75 };

export function metrics(remPx: number, look: Look = 'bento'): Metrics {
  const caption = 1.5 * remPx;
  return {
    remPx,
    // Mosaic's seams are a 1px hairline at every scale.
    gap: look === 'mosaic' ? 1 : GAP_REM[look] * remPx,
    caption,
    panelMin: { w: 7.5 * remPx, h: caption + 3 * remPx },
  };
}
