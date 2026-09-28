// The camera over the document: which part of the drawing the canvas shows, and at what zoom.
// Pure math, no DOM, so it is unit-tested in node. The renderer applies it by setting the rendered
// root's viewBox (the file itself is never changed), which keeps vectors crisp at every zoom and
// keeps getScreenCTM exact for the overlay.
//
// The zoom invariant: zooming about a screen point keeps the document point under it fixed, so a
// pinch zooms where the fingers are, never towards a corner.

export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The document point at the centre of the canvas, and canvas pixels per document unit. */
export interface View {
  cx: number;
  cy: number;
  scale: number;
}

export const MIN_SCALE_FACTOR = 1 / 16; // relative to the fit scale
export const MAX_SCALE = 256; // canvas pixels per document unit

/** The whole artboard, centred, with a margin (canvas pixels) on every side. */
export function fit(artboard: Rect, host: Size, margin = 16): View {
  const w = Math.max(1, host.width - 2 * margin);
  const h = Math.max(1, host.height - 2 * margin);
  const scale = Math.min(w / artboard.width, h / artboard.height);
  return { cx: artboard.x + artboard.width / 2, cy: artboard.y + artboard.height / 2, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
}

/** The document rectangle the canvas shows: the rendered root's viewBox. */
export function camera(view: View, host: Size): Rect {
  const width = host.width / view.scale;
  const height = host.height / view.scale;
  return { x: view.cx - width / 2, y: view.cy - height / 2, width, height };
}

export function toScreen(view: View, host: Size, p: Point): Point {
  return { x: (p.x - view.cx) * view.scale + host.width / 2, y: (p.y - view.cy) * view.scale + host.height / 2 };
}

export function toDoc(view: View, host: Size, s: Point): Point {
  return { x: (s.x - host.width / 2) / view.scale + view.cx, y: (s.y - host.height / 2) / view.scale + view.cy };
}

/** Clamp a scale between 1/16 of the fit scale and MAX_SCALE. */
export function clampScale(scale: number, fitScale: number): number {
  return Math.min(MAX_SCALE, Math.max(fitScale * MIN_SCALE_FACTOR, scale));
}

/** Zoom by `factor` about a screen point: the document point under it stays under it. */
export function zoomAbout(view: View, host: Size, at: Point, factor: number, fitScale = view.scale): View {
  const anchor = toDoc(view, host, at);
  const scale = clampScale(view.scale * factor, fitScale);
  return { scale, cx: anchor.x - (at.x - host.width / 2) / scale, cy: anchor.y - (at.y - host.height / 2) / scale };
}

/** Pan by a screen distance: the drawing follows the finger. */
export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, cx: view.cx - dx / view.scale, cy: view.cy - dy / view.scale };
}

/**
 * Two-finger pinch and pan: the view at the gesture's start, the two fingers then and now. The
 * document point that was under the fingers' midpoint stays under their midpoint, and the scale
 * follows the change in finger distance.
 */
export function pinch(start: View, host: Size, a0: Point, b0: Point, a1: Point, b1: Point, fitScale = start.scale): View {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const anchor = toDoc(start, host, m0);
  const scale = clampScale(d0 > 0 ? start.scale * (d1 / d0) : start.scale, fitScale);
  return { scale, cx: anchor.x - (m1.x - host.width / 2) / scale, cy: anchor.y - (m1.y - host.height / 2) / scale };
}
