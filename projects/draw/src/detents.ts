// The split sheet's three heights (peek, half, full) and how a drag of its handle settles between
// them; and how far the on-screen keyboard pushes a modal sheet up. Pure, so it is unit-tested in
// node; the React sheet only measures and applies.
//
// At 440×796 (a Safari tab) the canvas is 557 / 359 / 98 points tall at peek, half and full (the
// plan's 552 at peek assumed a 100pt head; the real one is 95): peek shows the sheet's head only,
// half splits the space, and full leaves a strip of the drawing so a tap on it still selects.

export type Detent = 'peek' | 'half' | 'full';
export type Heights = Readonly<Record<Detent, number>>;

export const DETENTS: readonly Detent[] = ['peek', 'half', 'full'];
export const FULL_CANVAS = 98; // pt of drawing left above the sheet at full
export const HALF = 0.45; // of the canvas-and-sheet space, at half
export const FLICK = 0.5; // pt/ms: a release faster than this goes one detent in its direction
export const TAP_SLOP = 5; // pt: a handle press that moves less is a tap

/** The sheet's height at each detent, given the canvas-and-sheet space and the sheet's head. */
export function detentHeights(space: number, head: number): Heights {
  const peek = Math.max(0, Math.min(head, space));
  const half = Math.max(peek, Math.round(space * HALF));
  const full = Math.max(half, space - FULL_CANVAS);
  return { peek, half, full };
}

/** The sheet's height while its handle is dragged `dy` (down is positive), kept between peek and full. */
export function dragHeight(h: Heights, start: number, dy: number): number {
  return Math.min(h.full, Math.max(h.peek, start - dy));
}

/**
 * Where a released drag settles: one detent on in the flick's direction (upward velocity is
 * negative), else the nearest.
 */
export function settle(h: Heights, height: number, velocity = 0): Detent {
  if (Math.abs(velocity) > FLICK) {
    const up = velocity < 0;
    const order = up ? DETENTS : [...DETENTS].reverse();
    return order.find((d) => (up ? h[d] > height : h[d] < height)) ?? order[order.length - 1];
  }
  let best: Detent = 'peek';
  for (const d of DETENTS) if (Math.abs(h[d] - height) < Math.abs(h[best] - height)) best = d;
  return best;
}

/** A tap on the handle steps up through the detents, then back to peek. */
export function nextDetent(d: Detent): Detent {
  return d === 'peek' ? 'half' : d === 'half' ? 'full' : 'peek';
}

/**
 * How far the on-screen keyboard covers the bottom of the layout viewport (SVG Lab's
 * visualViewport fix): a modal sheet sits this far up so its field stays visible.
 */
export function keyboardInset(innerHeight: number, viewportHeight: number, viewportTop: number): number {
  const off = innerHeight - viewportHeight - viewportTop;
  return off > 1 ? Math.round(off) : 0;
}
