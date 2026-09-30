// Align and distribute, pure: the deltas (root user units) that line boxes up, from the boxes the
// canvas measures (DOM truth). The editor writes them through the move planner, exactly (not
// snapped), 3 places.

import type { Point, Rect } from '../canvas/viewport.ts';

export type AlignKind = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Each box's delta to line up with `to` on one edge or middle. */
export function alignDeltas(boxes: readonly Rect[], to: Rect, kind: AlignKind): Point[] {
  return boxes.map((b) => {
    switch (kind) {
      case 'left':
        return { x: to.x - b.x, y: 0 };
      case 'center':
        return { x: to.x + to.width / 2 - (b.x + b.width / 2), y: 0 };
      case 'right':
        return { x: to.x + to.width - (b.x + b.width), y: 0 };
      case 'top':
        return { x: 0, y: to.y - b.y };
      case 'middle':
        return { x: 0, y: to.y + to.height / 2 - (b.y + b.height / 2) };
      case 'bottom':
        return { x: 0, y: to.y + to.height - (b.y + b.height) };
    }
  });
}

/**
 * Distribute three or more boxes along an axis (h: left to right; v: top to bottom): the first and
 * last stay, and the gaps between neighbours become equal. Deltas in the boxes' order.
 */
export function distributeDeltas(boxes: readonly Rect[], axis: 'h' | 'v'): Point[] {
  const out: Point[] = boxes.map(() => ({ x: 0, y: 0 }));
  if (boxes.length < 3) return out;
  const lo = (b: Rect) => (axis === 'h' ? b.x : b.y);
  const size = (b: Rect) => (axis === 'h' ? b.width : b.height);
  const order = boxes.map((b, i) => i).sort((a, b) => lo(boxes[a]) - lo(boxes[b]));
  const first = boxes[order[0]], last = boxes[order[order.length - 1]];
  const span = lo(last) + size(last) - lo(first);
  const gap = (span - order.reduce((s, i) => s + size(boxes[i]), 0)) / (order.length - 1);
  let at = lo(first) + size(first) + gap;
  for (const i of order.slice(1, -1)) {
    const d = at - lo(boxes[i]);
    out[i] = axis === 'h' ? { x: d, y: 0 } : { x: 0, y: d };
    at += size(boxes[i]) + gap;
  }
  return out;
}
