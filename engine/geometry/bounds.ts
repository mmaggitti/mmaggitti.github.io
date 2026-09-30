// Bounding boxes as the browser's getBBox gives them: the fill box (no stroke), in the element's
// own user units, and through the CTM in the root's.
//
// - Shapes from their geometry attributes, in user units (lengths.ts): rect, image and
//   foreignObject from x, y, width, height; circle; ellipse (a missing radius is SVG 2's auto, the
//   other one); line; polyline and polygon (points read up to the first error, an odd final
//   coordinate dropped, as browsers do); path (parsePath → toAbsolute → pathBounds, up to the first
//   error).
// - Containers (g, a, the root, a nested <svg> in its own inner units, and a switch's first child
//   that renders) as the union of their displayed children through each child's placement. As
//   Chromium does, a child whose geometry is empty is left out of the union (a rect, circle or
//   ellipse with a zero or negative size, an image with none, an empty path or point list, an
//   empty group), while a line or a lone moveto counts as a point; with nothing left the box is
//   0 0 0 0. Probed in P1-M1.
// - Null when the box is unknown: text, tspan and textPath (it needs the font), use (its target
//   renders in a shadow tree), an image with an href but not both sizes (its own size decides), geometry CSS
//   sets, rem without the page's root size, ex (the font's x-height), a display CSS may set, an
//   element with display="none" (attribute or style), and a container any displayed child of which
//   is unknown.

import { NS, attrValue, el, href, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { apply, type Affine } from '../values/affine.ts';
import { parsePath } from '../path/parse.ts';
import { toAbsolute } from '../path/abs.ts';
import { pathBounds } from '../path/bounds.ts';
import { extensionsSupported } from '../policy/render-policy.ts';
import { decodeAttr } from '../xml/entities.ts';
import { cssSets, inlineDecl } from './css.ts';
import { lengthAttr, placement, userCtm, type GeoContext } from './ctm.ts';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Box {
  box: Rect;
  empty: boolean; // left out of a container's union
}

// SVG's graphics elements that have a box, and the containers that group them.
const SHAPES = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'image', 'foreignObject']);
const GROUPS = new Set(['g', 'a', 'svg', 'switch']);
const UNKNOWN = new Set(['text', 'tspan', 'textPath', 'use']);
/** Geometry properties CSS may set, per element (SVG 2). */
export const GEOMETRY_PROPS: Readonly<Record<string, readonly string[]>> = {
  rect: ['x', 'y', 'width', 'height'],
  image: ['x', 'y', 'width', 'height'],
  foreignObject: ['x', 'y', 'width', 'height'],
  svg: ['x', 'y', 'width', 'height'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  path: ['d'],
  use: ['x', 'y', 'width', 'height'],
};

/** Is this element display: none (attribute or style=""), or null when a <style> rule may say? */
export function displayNone(doc: Doc, id: NodeId): boolean | null {
  if (cssSets(doc, id, 'display') === 'sheet') return null;
  const inline = inlineDecl(doc, id, 'display');
  if (inline !== null && inline.trim() !== '') return inline.trim().toLowerCase() === 'none';
  return attrValue(doc, el(doc, id), null, 'display')?.trim() === 'none';
}

/** The fill box in the element's own user units, as getBBox gives it, or null when unknown. */
export function localBounds(doc: Doc, id: NodeId, ctx: GeoContext): Rect | null {
  const n = doc.nodes.get(id);
  if (!n || n.kind !== 'element' || n.ns !== NS.svg) return null;
  if (displayNone(doc, id) !== false) return null;
  return own(doc, n, ctx)?.box ?? null;
}

/** The element's box in the root's user units (its four corners through userCtm), or null. */
export function rootBounds(doc: Doc, id: NodeId, ctx: GeoContext): Rect | null {
  const b = localBounds(doc, id, ctx);
  const m = b && userCtm(doc, id, ctx, (x) => localBounds(doc, x, ctx));
  return b && m ? mapRect(m, b) : null;
}

/** The box around a rectangle's four corners through a matrix. */
export function mapRect(m: Affine, r: Rect): Rect {
  const pts = [apply(m, r.x, r.y), apply(m, r.x + r.width, r.y), apply(m, r.x + r.width, r.y + r.height), apply(m, r.x, r.y + r.height)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function own(doc: Doc, n: ElementNode, ctx: GeoContext): Box | null {
  const local = n.local;
  if (UNKNOWN.has(local)) return null;
  if (GROUPS.has(local) || n.id === doc.root) return group(doc, n, ctx);
  if (!SHAPES.has(local)) return null;
  for (const p of GEOMETRY_PROPS[local] ?? []) if (cssSets(doc, n.id, p) !== 'no') return null;
  const len = (name: string, axis: 'x' | 'y' | 'other', fallback: number | null = 0) => lengthAttr(doc, n, name, axis, ctx, fallback);
  switch (local) {
    case 'rect':
    case 'foreignObject':
    case 'image': {
      const x = len('x', 'x'), y = len('y', 'y');
      // An image's own size decides a missing one; one with nothing to show has none.
      const auto = local === 'image' && href(doc, n) !== null ? null : 0;
      const w = len('width', 'x', auto), h = len('height', 'y', auto);
      if (x === null || y === null || w === null || h === null) return null;
      const width = Math.max(0, w), height = Math.max(0, h);
      return { box: { x, y, width, height }, empty: width <= 0 || height <= 0 };
    }
    case 'circle': {
      const cx = len('cx', 'x'), cy = len('cy', 'y'), r = len('r', 'other');
      if (cx === null || cy === null || r === null) return null;
      const rr = Math.max(0, r);
      return { box: { x: cx - rr, y: cy - rr, width: 2 * rr, height: 2 * rr }, empty: rr <= 0 };
    }
    case 'ellipse': {
      const cx = len('cx', 'x'), cy = len('cy', 'y');
      const hasRx = attrValue(doc, n, null, 'rx') !== null, hasRy = attrValue(doc, n, null, 'ry') !== null;
      let rx = hasRx ? len('rx', 'x') : null;
      let ry = hasRy ? len('ry', 'y') : null;
      if (cx === null || cy === null || (hasRx && rx === null) || (hasRy && ry === null)) return null;
      rx ??= ry ?? 0; // auto: the other radius
      ry ??= rx;
      rx = Math.max(0, rx);
      ry = Math.max(0, ry);
      return { box: { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry }, empty: rx <= 0 || ry <= 0 };
    }
    case 'line': {
      const x1 = len('x1', 'x'), y1 = len('y1', 'y'), x2 = len('x2', 'x'), y2 = len('y2', 'y');
      if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
      return { box: { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }, empty: false };
    }
    case 'polyline':
    case 'polygon': {
      const pts = pointsOf(attrValue(doc, n, null, 'points') ?? '');
      if (pts.length < 2) return { box: { x: 0, y: 0, width: 0, height: 0 }, empty: true };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        minX = Math.min(minX, pts[i]);
        maxX = Math.max(maxX, pts[i]);
        minY = Math.min(minY, pts[i + 1]);
        maxY = Math.max(maxY, pts[i + 1]);
      }
      return { box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, empty: false };
    }
    case 'path': {
      const d = attrValue(doc, n, null, 'd') ?? '';
      const b = pathBounds(toAbsolute(parsePath(d)));
      if (!b) return { box: { x: 0, y: 0, width: 0, height: 0 }, empty: true };
      return { box: { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY }, empty: false };
    }
  }
  return null;
}

const NUM = /[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/y;
const WSP = /[ \t\n\r\f]*/y;
const COMMA_WSP = /[ \t\n\r\f]*,?[ \t\n\r\f]*/y;

/** The numbers of a points list, read up to the first error (every complete pair before it kept). */
export function pointsOf(s: string): number[] {
  const out: number[] = [];
  WSP.lastIndex = 0;
  WSP.exec(s);
  let i = WSP.lastIndex;
  while (i < s.length) {
    if (out.length) {
      COMMA_WSP.lastIndex = i;
      COMMA_WSP.exec(s);
      i = COMMA_WSP.lastIndex;
    }
    NUM.lastIndex = i;
    const m = NUM.exec(s);
    if (!m || !Number.isFinite(Number(m[0]))) break;
    out.push(Number(m[0]));
    i = NUM.lastIndex;
    WSP.lastIndex = i;
    WSP.exec(s);
    const next = WSP.lastIndex;
    if (next === s.length) break;
    i = next;
  }
  // Only complete pairs render; an error mid-pair drops the pair's first half too.
  return out.length % 2 ? out.slice(0, -1) : out;
}

/** Does this element take part in its parent's box at all (a graphics element or a container)? */
function graphic(n: ElementNode): boolean {
  return n.ns === NS.svg && (SHAPES.has(n.local) || GROUPS.has(n.local) || UNKNOWN.has(n.local));
}

/** The children a container draws: every displayed graphic, or for a switch the first that renders. */
function drawnChildren(doc: Doc, n: ElementNode): ElementNode[] | null {
  const kids = n.children.map((c) => doc.nodes.get(c)!).filter((c): c is ElementNode => c.kind === 'element' && graphic(c));
  if (n.ns === NS.svg && n.local === 'switch') {
    for (const k of kids) {
      if (attrValue(doc, k, null, 'systemLanguage') !== null) return null; // the reader's language decides
      const ext = k.attrs.find((a) => a.ns === null && a.local === 'requiredExtensions');
      if (ext && !extensionsSupported(decodeAttr(ext.raw, doc.entities))) continue;
      return [k];
    }
    return [];
  }
  return kids;
}

function group(doc: Doc, n: ElementNode, ctx: GeoContext): Box | null {
  const kids = drawnChildren(doc, n);
  if (!kids) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of kids) {
    const hidden = displayNone(doc, k.id);
    if (hidden === null) return null;
    if (hidden) continue;
    const b = own(doc, k, ctx);
    if (!b) return null;
    if (b.empty) continue;
    const m = placement(doc, k.id, ctx, () => localBounds(doc, k.id, ctx));
    if (!m) return null;
    const r = mapRect(m, b.box);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (minX === Infinity) return { box: { x: 0, y: 0, width: 0, height: 0 }, empty: true };
  return { box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, empty: false };
}
