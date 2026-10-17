// Pixel metrics for layout, derived from the root font size so they follow --ui-scale like the
// rest of the site. The core takes remPx as an input (it can't read CSS), and the runtime reads it
// from the document once per resize.

export interface Metrics {
  /** CSS px per rem (12 at the site's 75% scale). */
  remPx: number;
  /** Space between panels, and around the outside. */
  gap: number;
  /** Tab bar height: never under the 44pt tap floor. */
  tabbar: number;
  /** Smallest panel: room for a tab and the menu button, plus a little body. */
  panelMin: { w: number; h: number };
}

/** The tap floor (ds.css --tap-min): 44 CSS px at every scale. */
export const TAP_MIN = 44;

export function metrics(remPx: number): Metrics {
  const tabbar = Math.max(TAP_MIN, 3.25 * remPx);
  return {
    remPx,
    gap: 0.5 * remPx,
    tabbar,
    panelMin: { w: 7.5 * remPx, h: tabbar + 3 * remPx },
  };
}
