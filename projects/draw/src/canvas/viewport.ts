// The camera over the document: which part of the drawing the canvas shows, and at what zoom.
// Pure math, no DOM, so it is unit-tested in node. The view's space is the root's own box at 100%
// (box px: its viewport W0 × H0, which M maps the root's user units into), and the renderer
// applies it as that box's CSS size and offset (cameraBox): the root's viewBox and the file are
// never changed, vectors stay crisp at every zoom, and getScreenCTM stays exact for the overlay.
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
export const MAX_SCALE_FACTOR = 16; // relative to the fit scale, when that allows more than MAX_SCALE

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

/** Clamp a scale between 1/16 of the fit scale and MAX_SCALE, or 16× the fit scale for an artboard so small that it fits above MAX_SCALE. */
export function clampScale(scale: number, fitScale: number): number {
  return Math.min(Math.max(MAX_SCALE, fitScale * MAX_SCALE_FACTOR), Math.max(fitScale * MIN_SCALE_FACTOR, scale));
}

/** The largest side a camera box may have, in CSS px: past it browsers stop drawing a box whole. */
export const MAX_BOX = 2 ** 24;

/**
 * Can this view be drawn? Near the float limit (a hostile viewBox) its camera overflows to
 * Infinity, and a box over MAX_BOX a side (or at an offset that isn't finite) can't be placed.
 */
export function drawable(view: View, host: Size, viewport?: Size): boolean {
  const c = camera(view, host);
  if (![c.x, c.y, c.width, c.height].every(Number.isFinite)) return false;
  if (!viewport) return true;
  const b = cameraBox(view, host, viewport);
  return [b.left, b.top, b.width, b.height].every(Number.isFinite) && b.width <= MAX_BOX && b.height <= MAX_BOX;
}

/** Where the root's own box goes in the host for this view: its offset and its size (CSS px). */
export function cameraBox(view: View, host: Size, viewport: Size): { left: number; top: number; width: number; height: number } {
  const k = view.scale;
  return { left: host.width / 2 - view.cx * k, top: host.height / 2 - view.cy * k, width: viewport.width * k, height: viewport.height * k };
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
