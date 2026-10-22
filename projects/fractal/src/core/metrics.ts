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

export function metrics(remPx: number): Metrics {
  const caption = 1.5 * remPx;
  return {
    remPx,
    gap: 0.5 * remPx,
    caption,
    panelMin: { w: 7.5 * remPx, h: caption + 3 * remPx },
  };
}
