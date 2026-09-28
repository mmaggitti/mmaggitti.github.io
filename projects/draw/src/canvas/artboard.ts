// The artboard: the document rectangle the canvas fits on open, in the root's user units. It is
// the root's viewBox, or, without a usable one, its width and height (in user units, at CSS's
// 96 dpi). A document with neither has no artboard: it draws in CSS pixels from the origin, as a
// browser draws it, and the canvas gives its root a viewBox only once you zoom or pan. Pure, so it
// is unit-tested in node; the renderer and the editor both read it.
//
// Most files already place their artboard exactly as the fitted view would (centred, scaled to
// meet): then, until the view moves, the canvas draws them with their own viewBox, byte for byte
// the rendering a browser gives the file on its own.

import { attrValue, el, type Doc, type ElementNode } from '../../../../engine/model/doc.ts';
import { parseLength, toUserUnits } from '../../../../engine/values/length.ts';
import { DEFAULT_PAR, parsePar, parseViewBox } from '../../../../engine/values/viewbox.ts';
import type { Rect } from './viewport.ts';

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

/**
 * Does the file's own root place its artboard exactly as the fitted view does? True when it has a
 * valid viewBox (or, with no viewBox attribute, a size the renderer turns into one) and the default
 * preserveAspectRatio (xMidYMid meet).
 */
export function fitsNatively(doc: Doc): boolean {
  const root = el(doc, doc.root);
  const par = attrValue(doc, root, null, 'preserveAspectRatio');
  const p = (par === null ? null : parsePar(par)) ?? DEFAULT_PAR; // an invalid one is the default
  if (p.align !== DEFAULT_PAR.align || p.meetOrSlice !== DEFAULT_PAR.meetOrSlice) return false;
  const raw = attrValue(doc, root, null, 'viewBox');
  if (raw !== null) {
    const vb = parseViewBox(raw);
    return vb !== null && vb !== 'disabled';
  }
  return rootSize(doc, root) !== null;
}
