// The Finish sheet's numbers (P1-M5), pure: the PNG sizes and the canvas area clamp, and SVG Lab's
// Pixels and vector comparison (LabVector's makeBitmap, paintPx and captions, L1315-1358), so node's
// tests hold each one. The pixels themselves are the browser's (projects/draw/src/platform/raster.ts).
//
// - A PNG is the artboard at an icon size (its longer side N) or at 1×, 2× or 3× its own size.
// - A canvas can't be larger than its device allows, as an area: clampArea gives the largest size of
//   the same shape within it.
// - The comparison fits the artboard into res × res dots, centred (the rest transparent), and SVG Lab
//   outlines every dot with a faint grid once a dot spans 12 or more device pixels.

import { NS, el, type Doc, type NodeId } from '../model/doc.ts';

/** The icon set's sizes, each the PNG's longer side. */
export const ICON_SIZES: readonly number[] = [16, 32, 64, 128, 256, 512, 1024];
/** The scales of the artboard's own size. */
export const SCALES: readonly number[] = [1, 2, 3];
/** The comparison's dots across (SVG Lab's chips), and the first one shown (its res). */
export const DOTS: readonly number[] = [16, 32, 64];
export const FIRST_DOTS = 32;

export interface BoardSize {
  width: number;
  height: number;
}
/** An icon of the set (its longer side), or a scale of the artboard. */
export type PngChoice = { icon: number } | { scale: number };
export interface PixelSize {
  w: number;
  h: number;
}

/**
 * A PNG's size in pixels: an icon size N gives the longer side N and the other its share of N,
 * rounded and at least 1; a scale k gives the artboard's width and height times k, rounded (at least 1).
 */
export function pngSize(board: BoardSize, choice: PngChoice): PixelSize {
  if ('icon' in choice) {
    const n = choice.icon;
    const long = Math.max(board.width, board.height);
    const other = Math.max(1, Math.round((n * Math.min(board.width, board.height)) / long));
    return board.width >= board.height ? { w: n, h: other } : { w: other, h: n };
  }
  return { w: Math.max(1, Math.round(board.width * choice.scale)), h: Math.max(1, Math.round(board.height * choice.scale)) };
}

/**
 * The largest size of the same aspect whose area is at most `max` (each side floored, at least 1),
 * and whether it had to change. A size already within it is kept.
 */
export function clampArea(w: number, h: number, max: number): PixelSize & { clamped: boolean } {
  if (w * h <= max) return { w, h, clamped: false };
  const k = Math.sqrt(max / (w * h));
  let cw = Math.max(1, Math.floor(w * k));
  let ch = Math.max(1, Math.floor(h * k));
  // Rounding (or a side held at 1) can leave it just over: the longer side gives way.
  if (cw * ch > max) {
    if (cw >= ch) cw = Math.max(1, Math.floor(max / ch));
    else ch = Math.max(1, Math.floor(max / cw));
  }
  return { w: cw, h: ch, clamped: true };
}

/** The box the artboard takes in res × res dots: scaled to fit and centred (a square board fills them). */
export function fitInto(board: BoardSize, res: number): { x: number; y: number; w: number; h: number } {
  const s = res / Math.max(board.width, board.height);
  const w = board.width * s;
  const h = board.height * s;
  return { x: (res - w) / 2, y: (res - h) / 2, w, h };
}

/**
 * Does the comparison's pixel grid show? SVG Lab's rule (paintPx): the pane's width in device pixels
 * (rounded, at least 1), over the dots across, is 12 or more.
 */
export function gridShows(paneCssPx: number, devicePixelRatio: number, res: number): boolean {
  return Math.max(1, Math.round(paneCssPx * devicePixelRatio)) / res >= 12;
}

/** The Pixels pane's caption: "32 × 32 = 1,024 dots" (SVG Lab's, L1325). */
export function dotsCaption(res: number): string {
  return `${res} × ${res} = ${(res * res).toLocaleString('en-US')} dots`;
}

/** The Vector pane's caption: "2 shapes, sharp at any size" ("1 shape" for one, where the lab says "1 shapes"). */
export function shapesCaption(n: number): string {
  return `${n} ${n === 1 ? 'shape' : 'shapes'}, sharp at any size`;
}

/** The elements a shape count counts: what the canvas draws as a shape. */
export const SHAPE_ELEMENTS: ReadonlySet<string> = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'image', 'use']);
/** Containers whose content draws only where something references it, never by itself. */
const REFERENCED_ONLY: ReadonlySet<string> = new Set(['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker']);

/**
 * The shapes the canvas draws: every rect, circle, ellipse, line, polyline, polygon, path, text, image
 * and use, but none inside a defs, symbol, clipPath, mask, pattern or marker.
 */
export function shapeCount(doc: Doc): number {
  let n = 0;
  const walk = (id: NodeId): void => {
    const node = el(doc, id);
    for (const c of node.children) {
      const k = doc.nodes.get(c)!;
      if (k.kind !== 'element') continue;
      if (k.ns === NS.svg && REFERENCED_ONLY.has(k.local)) continue;
      if (k.ns === NS.svg && SHAPE_ELEMENTS.has(k.local)) n++;
      walk(c);
    }
  };
  walk(doc.root);
  return n;
}
