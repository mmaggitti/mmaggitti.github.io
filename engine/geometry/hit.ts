// The thin-shape hit test: a finger can't land on a hairline, so a tap near a line counts as a tap
// on it (SVG Lab's hitThin). Thin shapes are lines, polylines, and paths and polygons whose fill is
// none; one is hit when its outline is within `tolerance` screen px plus half its stroke of the
// point. The topmost (last in document order) wins. The point is in the root's user units; `scale`
// is screen px per root user unit, so the tolerance holds on screen at any zoom.

import { NS, attrValue, el, type Doc, type NodeId } from '../model/doc.ts';
import { apply, invert, type Affine } from '../values/affine.ts';
import { parsePath } from '../path/parse.ts';
import { toAbsolute, type AbsSeg } from '../path/abs.ts';
import { nearestPoint } from '../path/nearest.ts';
import { cssSets, inlineDecl } from './css.ts';
import { displayNone, localBounds, pointsOf } from './bounds.ts';
import { lengthAttr, userCtm, type GeoContext } from './ctm.ts';
import { resolveLength } from './lengths.ts';

export interface Point {
  x: number;
  y: number;
}

/** Is this element a thin shape: a line, a polyline, or a path or polygon with fill none? */
export function isThin(doc: Doc, id: NodeId): boolean {
  const n = doc.nodes.get(id);
  if (!n || n.kind !== 'element' || n.ns !== NS.svg) return false;
  if (n.local === 'line' || n.local === 'polyline') return true;
  if (n.local !== 'path' && n.local !== 'polygon') return false;
  if (cssSets(doc, id, 'fill') === 'sheet') return false;
  const fill = inlineDecl(doc, id, 'fill') ?? attrValue(doc, n, null, 'fill');
  return fill?.trim() === 'none';
}

/** The stroke width in the element's user units (default 1; unknown or CSS-set is 1). */
function strokeWidth(doc: Doc, id: NodeId, ctx: GeoContext): number {
  const n = el(doc, id);
  const inline = inlineDecl(doc, id, 'stroke-width');
  const v = inline !== null ? resolveLength(inline, { axis: 'other', fontSize: null, remPx: ctx.remPx, viewport: null }) : lengthAttr(doc, n, 'stroke-width', 'other', ctx, 1);
  return v !== null && v >= 0 ? v : 1;
}

/** The outline as absolute segments in the element's own user units. */
function outline(doc: Doc, id: NodeId, ctx: GeoContext): AbsSeg[] | null {
  const n = el(doc, id);
  const lines = (pts: number[], close: boolean): AbsSeg[] => {
    const out: AbsSeg[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      const prev = out[out.length - 1];
      out.push(i === 0 ? { cmd: 'M', sub: 0, x0: x, y0: y, x, y, type: 'M' } : { cmd: 'L', sub: 0, x0: prev.x, y0: prev.y, x, y, type: 'L' });
    }
    if (close && out.length > 1) out.push({ cmd: 'Z', sub: 0, x0: out[out.length - 1].x, y0: out[out.length - 1].y, x: out[0].x, y: out[0].y, type: 'Z' });
    return out;
  };
  switch (n.local) {
    case 'line': {
      const v = ['x1', 'y1', 'x2', 'y2'].map((a, i) => lengthAttr(doc, n, a, i % 2 ? 'y' : 'x', ctx));
      return v.some((x) => x === null) ? null : lines(v as number[], false);
    }
    case 'polyline':
    case 'polygon':
      return lines(pointsOf(attrValue(doc, n, null, 'points') ?? ''), n.local === 'polygon');
    case 'path':
      return cssSets(doc, id, 'd') !== 'no' ? null : toAbsolute(parsePath(attrValue(doc, n, null, 'd') ?? ''));
  }
  return null;
}

/**
 * The topmost thin shape among `ids` whose outline is within `tolerance / scale` root user units
 * plus half its stroke of `point` (root user units), or null.
 */
export function thinHit(doc: Doc, ids: readonly NodeId[], point: Point, tolerance: number, scale: number, ctx: GeoContext): NodeId | null {
  const order = documentOrder(doc);
  let best: { id: NodeId; at: number } | null = null;
  for (const id of ids) {
    if (!isThin(doc, id) || displayNone(doc, id) !== false || localBounds(doc, id, ctx) === null) continue;
    const m = userCtm(doc, id, ctx, (x) => localBounds(doc, x, ctx));
    const inv = m && invert(m);
    const segs = m && inv && outline(doc, id, ctx);
    if (!m || !inv || !segs || !segs.length) continue;
    const [lx, ly] = apply(inv, point.x, point.y);
    const near = nearestPoint(segs, lx, ly);
    if (!near) continue;
    const [rx, ry] = apply(m, near.x, near.y);
    const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])); // the CTM's mean scale, for the stroke
    const within = tolerance / scale + (strokeWidth(doc, id, ctx) * k) / 2;
    if (Math.hypot(rx - point.x, ry - point.y) > within) continue;
    const at = order.get(id) ?? -1;
    if (!best || at > best.at) best = { id, at };
  }
  return best?.id ?? null;
}

/** Every element's place in document order. */
export function documentOrder(doc: Doc): Map<NodeId, number> {
  const order = new Map<NodeId, number>();
  let i = 0;
  const walk = (id: NodeId) => {
    order.set(id, i++);
    const n = doc.nodes.get(id);
    if (n?.kind === 'element') for (const c of n.children) walk(c);
  };
  walk(doc.root);
  return order;
}

export type { Affine };
