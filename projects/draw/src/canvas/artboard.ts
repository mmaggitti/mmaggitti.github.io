// The artboard and the root's own box. Pure, so it is unit-tested in node; the renderer and the
// editor both read it.
//
// - The artboard is the document rectangle the canvas fits on open, in the root's user units: the
//   root's viewBox, or, without a usable one, its width and height (in user units, at CSS's
//   96 dpi). A document with neither has no artboard.
// - The root's viewport at 100% (W0 × H0, CSS px) is the box the file gets on its own in a
//   host-sized window: each of the root's width and height attributes alone (absolute units at
//   96 dpi, em and ex against the root's own font size, rem the same, % of the host), else 100% of
//   the host. The root's size from its own CSS is ignored, as the canvas stylesheet always has.
// - The camera is that box scaled and moved (renderer.ts): M, the root's viewBox fitted into
//   W0 × H0 (engine/geometry/ctm.ts rootTransform), maps its user units to the box's px.

import { attrValue, el, type Doc, type ElementNode } from '../../../../engine/model/doc.ts';
import { parseLength, toUserUnits } from '../../../../engine/values/length.ts';
import { parseViewBox } from '../../../../engine/values/viewbox.ts';
import { rootFontSize } from '../../../../engine/geometry/lengths.ts';
import type { Rect, Size } from './viewport.ts';

/** The root's width and height in user units, when both are finite and positive. */
export function rootSize(doc: Doc, node: ElementNode): { width: number; height: number } | null {
  const size = (name: string) => {
    const len = parseLength(attrValue(doc, node, null, name) ?? '');
    const v = len && toUserUnits(len);
    return v != null && Number.isFinite(v) && v > 0 ? v : null;
  };
  const width = size('width'), height = size('height');
  return width && height ? { width, height } : null;
}

/** The artboard, or null (no usable viewBox and no size, or a viewBox that disables rendering). */
export function artboard(doc: Doc): Rect | null {
  const root = el(doc, doc.root);
  const raw = attrValue(doc, root, null, 'viewBox');
  const vb = raw === null ? null : parseViewBox(raw);
  if (vb === 'disabled') return null;
  if (vb) return { x: vb.x, y: vb.y, width: vb.w, height: vb.h };
  const size = rootSize(doc, root);
  return size && { x: 0, y: 0, ...size };
}

/** The root's viewport at 100% in CSS px: what the file's own root box is in a host-sized window. */
export function rootViewport(doc: Doc, host: Size): Size {
  const root = el(doc, doc.root);
  const font = rootFontSize(doc);
  const side = (name: 'width' | 'height', whole: number): number => {
    const len = parseLength(attrValue(doc, root, null, name) ?? '');
    let v: number | null = null;
    if (len?.unit === '%') v = (len.value * whole) / 100;
    else if (len) v = toUserUnits(len, { fontSize: font, remPx: font });
    return v !== null && Number.isFinite(v) && v > 0 ? v : whole;
  };
  return { width: side('width', host.width), height: side('height', host.height) };
}

/** Does the root have a viewBox of its own (valid, or one that disables rendering)? */
export function hasOwnViewBox(doc: Doc): boolean {
  const raw = attrValue(doc, el(doc, doc.root), null, 'viewBox');
  return raw !== null && parseViewBox(raw) !== null;
}
