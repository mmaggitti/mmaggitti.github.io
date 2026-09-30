// The overlay model: everything the overlay draws, as plain data in host px (the canvas host's
// own top-left), computed from the editor's state and the canvas's measurements. Pure, no DOM, so
// every rule is unit-tested in node; src/canvas/overlay/ only draws it, reusing its elements
// between frames.
//
// - The paper (the checkerboard underlay) is the artboard's screen rectangle, through M and the
//   view (with no artboard, the root's own box). The grid's lines are at multiples of its step in
//   the root's user units, so snapping and lines agree, drawn over the paper only.
// - The tooltip sits 42 px above the finger, or 40 px below it within 64 px of the canvas's top,
//   clamped 4 px inside the canvas (SVG Lab's Stage tip).
// - While one element moves, coordinate guides run from the artboard's left and top edges to its
//   centre, labelled in the root's user units (SVG Lab's grid lesson, in screen px).

import type { NodeId } from '../../../../engine/model/doc.ts';
import { apply, type Affine } from '../../../../engine/values/affine.ts';
import { fmt } from '../../../../engine/values/number-format.ts';
import type { Point, Rect, Size } from '../canvas/viewport.ts';

export type Quad = [Point, Point, Point, Point];

export type HandleKind = 'center' | 'anchor' | 'start' | 'ctrl' | 'bend' | 'rot' | 'scale';
export interface Handle {
  id: string;
  kind: HandleKind;
  at: Point;
  active: boolean; // being dragged: filled yellow, a size larger
}
export interface Line {
  from: Point;
  to: Point;
}
export interface Label {
  text: string;
  at: Point; // the text's anchor point, on its baseline
  anchor: 'start' | 'middle' | 'end';
}
export interface GridLine {
  at: number; // host px: an x for a vertical line, a y for a horizontal one
  major: boolean; // a multiple of 5 × step
}
export interface Grid {
  step: number; // root user units
  x: GridLine[];
  y: GridLine[];
  over: Rect; // the part of the paper the lines span (inside the host)
}
export interface Tip {
  text: string;
  finger: Point;
  below: boolean; // near the top of the canvas: under the finger
}
export interface Guide {
  index: number; // its place in the file's list of guides (readState), which a pill drag moves
  axis: 'v' | 'h';
  at: number; // host px
  pill: Point; // the centre of its pill at the canvas's edge
  active: boolean;
}

export interface OverlayModel {
  paper: Rect | null;
  grid: Grid | null;
  outlines: { id: NodeId; quad: Quad }[];
  marquee: Rect | null;
  coords: { lines: Line[]; labels: Label[] } | null; // coordinate guides while one element moves
  handles: Handle[];
  rotGuide: Line | null; // from the rotation pivot to the ring
  guides: Guide[]; // the user's guides (S3)
  snapLines: Line[];
  localGrid: { lines: Line[]; axes: Line[]; labels: Label[] } | null;
  /** Edit on canvas (P1-M2): the gradient's guides, host px: its unit box with "0,0" and "1,1" (objectBoundingBox), a linear gradient's line, a radial one's circle and focus arm. */
  gradient: GradientGuides | null;
  tip: Tip | null;
}

export interface GradientGuides {
  box: Point[] | null;
  labels: Label[];
  line: Line | null;
  ring: Point[] | null;
  arm: Line | null;
}

export const EMPTY: OverlayModel = {
  paper: null, grid: null, outlines: [], marquee: null, coords: null, handles: [], rotGuide: null, guides: [], snapLines: [], localGrid: null, gradient: null, tip: null,
};

/** The gradient engine's marks (engine/paint/handles.ts) as the overlay draws them. */
export function gradientGuides(m: { box: Point[] | null; labels: { text: string; at: Point }[]; line: [Point, Point] | null; ring: Point[] | null; arm: [Point, Point] | null }): GradientGuides {
  return {
    box: m.box,
    labels: m.labels.map((l, i) => ({ text: l.text, at: { x: l.at.x + (i ? 4 : -4), y: l.at.y + (i ? 14 : -6) }, anchor: i ? 'start' : 'end' })),
    line: m.line && { from: m.line[0], to: m.line[1] },
    ring: m.ring,
    arm: m.arm && { from: m.arm[0], to: m.arm[1] },
  };
}

// ── the paper and the grid ────────────────────────────────────────────────────────────────────

/** The camera box: the root's own box in the host (its offset on whole px). */
export interface CameraBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The matrix from the root's user units to host px: M, then the camera box's scale and offset. */
export function rootToHostMatrix(box: CameraBox, viewport: Size, M: Affine): Affine {
  const kx = box.width / viewport.width;
  const ky = box.height / viewport.height;
  return [kx * M[0], ky * M[1], kx * M[2], ky * M[3], kx * M[4] + box.left, ky * M[5] + box.top];
}

/** Host px of a point in the root's user units. */
export function rootToHost(box: CameraBox, viewport: Size, M: Affine, p: Point): Point {
  const [x, y] = apply(rootToHostMatrix(box, viewport, M), p.x, p.y);
  return { x, y };
}

/** The artboard's screen rectangle (with no artboard, the root's own box), in host px. */
export function paperRect(box: CameraBox, viewport: Size, M: Affine, board: Rect | null): Rect {
  if (!board) return { x: box.left, y: box.top, width: box.width, height: box.height };
  const a = rootToHost(box, viewport, M, { x: board.x, y: board.y });
  const b = rootToHost(box, viewport, M, { x: board.x + board.width, y: board.y + board.height });
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export const GRID_MIN_PX = 12;

/** The automatic grid step: the smallest 1, 2 or 5 × 10ⁿ root units at least GRID_MIN_PX apart on screen. */
export function gridStep(pxPerUnit: number): number {
  if (!(pxPerUnit > 0) || !Number.isFinite(pxPerUnit)) return 1;
  const want = GRID_MIN_PX / pxPerUnit;
  let e = 10 ** Math.floor(Math.log10(want));
  for (;;) {
    for (const m of [1, 2, 5]) if (m * e >= want - 1e-12 * want) return Number((m * e).toPrecision(12));
    e *= 10;
  }
}

/**
 * The grid over the paper: lines at multiples of `step` root units (every fifth, a multiple of
 * 5 × step, major), inside the paper and the host. M is axis-aligned (a viewport transform).
 */
export function gridModel(box: CameraBox, viewport: Size, M: Affine, host: Size, paper: Rect, step: number): Grid {
  const over = intersect(paper, { x: 0, y: 0, width: host.width, height: host.height });
  if (!over) return { step, x: [], y: [], over: { x: 0, y: 0, width: 0, height: 0 } };
  const grid: Grid = { step, x: [], y: [], over };
  const m = rootToHostMatrix(box, viewport, M);
  const lines = (lo: number, hi: number, scale: number, offset: number, out: GridLine[]) => {
    if (!(scale !== 0)) return;
    // host px → root units along this axis, then every multiple of the step in between
    const [u0, u1] = [(lo - offset) / scale, (hi - offset) / scale].sort((p, q) => p - q);
    const first = Math.ceil(u0 / step - 1e-9);
    const last = Math.floor(u1 / step + 1e-9);
    for (let i = first; i <= last && out.length < 2000; i++) out.push({ at: i * step * scale + offset, major: i % 5 === 0 });
  };
  lines(over.x, over.x + over.width, m[0], m[4], grid.x);
  lines(over.y, over.y + over.height, m[3], m[5], grid.y);
  return grid;
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width), t = Math.min(a.y + a.height, b.y + b.height);
  return r > x && t > y ? { x, y, width: r - x, height: t - y } : null;
}

// ── the tooltip ───────────────────────────────────────────────────────────────────────────────

export const TIP_ABOVE = 42; // px from the finger to the tooltip's bottom edge
export const TIP_BELOW = 40; // px from the finger to its top edge, when it flips below
export const TIP_FLIP = 64; // within this far of the canvas's top, it flips below
export const TIP_INSET = 4; // px it keeps inside the canvas at the sides

/** The tooltip for text at a finger (host px): above it, or below it near the top. */
export function tip(text: string, finger: Point): Tip {
  return { text, finger, below: finger.y < TIP_FLIP };
}

/** Where a tooltip `width` wide centres (x) and where its box starts (y), inside a host `hostWidth` wide. */
export function tipBox(t: Tip, width: number, height: number, hostWidth: number): { left: number; top: number } {
  const half = width / 2;
  const x = Math.min(Math.max(t.finger.x, half + TIP_INSET), Math.max(half + TIP_INSET, hostWidth - half - TIP_INSET));
  return { left: x - half, top: t.below ? t.finger.y + TIP_BELOW : t.finger.y - TIP_ABOVE - height };
}

// ── coordinate guides while one element moves ─────────────────────────────────────────────────

export const X_LABEL_MIN = 64; // px: the x label shows only on a horizontal guide at least this long
export const Y_LABEL_MIN = 56; // px: the y label, on a vertical guide at least this long
export const Y_LABEL_FLIP = 96; // px: within this of the canvas's right edge, the y label goes left

/**
 * Dashed guides from the artboard's left and top edges to the centre (host px), labelled with the
 * centre in the root's user units (`decimals` places, the snap step's).
 */
export function coordGuides(centre: Point, paper: Rect, inRoot: Point, decimals: number, hostWidth: number): { lines: Line[]; labels: Label[] } {
  const lines: Line[] = [
    { from: { x: paper.x, y: centre.y }, to: centre },
    { from: { x: centre.x, y: paper.y }, to: centre },
  ];
  const labels: Label[] = [];
  const across = Math.abs(centre.x - paper.x);
  const down = Math.abs(centre.y - paper.y);
  if (across >= X_LABEL_MIN) labels.push({ text: `x = ${fmt(inRoot.x, decimals)}`, at: { x: (paper.x + centre.x) / 2, y: centre.y - 6 }, anchor: 'middle' });
  if (down >= Y_LABEL_MIN) {
    const left = hostWidth - centre.x < Y_LABEL_FLIP;
    labels.push({ text: `y = ${fmt(inRoot.y, decimals)}`, at: { x: centre.x + (left ? -8 : 8), y: (paper.y + centre.y) / 2 + 4 }, anchor: left ? 'end' : 'start' });
  }
  return { lines, labels };
}

// ── the local grid of a transformed element ─────────────────────────────────────────────────────

/**
 * A transformed element's own grid (SVG Lab LabMove's guides), through its CTM to host px: lines
 * every step of its local units (the 1-2-5 rule at ≥ 12 px, measured through the CTM) over its box
 * grown by one step, and its x and y axes from its local origin, labelled.
 */
export function localGridModel(box: Rect, toHost: Affine): { lines: Line[]; axes: Line[]; labels: Label[]; step: number } {
  const px = Math.sqrt(Math.abs(toHost[0] * toHost[3] - toHost[1] * toHost[2]));
  const step = gridStep(px);
  const at = (x: number, y: number): Point => {
    const [hx, hy] = apply(toHost, x, y);
    return { x: hx, y: hy };
  };
  const x0 = Math.floor((box.x - step) / step) * step, x1 = Math.ceil((box.x + box.width + step) / step) * step;
  const y0 = Math.floor((box.y - step) / step) * step, y1 = Math.ceil((box.y + box.height + step) / step) * step;
  const lines: Line[] = [];
  for (let i = 0, x = x0; x <= x1 + step * 1e-9 && i < 500; i++, x = x0 + i * step) lines.push({ from: at(x, y0), to: at(x, y1) });
  for (let i = 0, y = y0; y <= y1 + step * 1e-9 && i < 500; i++, y = y0 + i * step) lines.push({ from: at(x0, y), to: at(x1, y) });
  const ax = Math.max(x1, step), ay = Math.max(y1, step);
  const axes: Line[] = [{ from: at(0, 0), to: at(ax, 0) }, { from: at(0, 0), to: at(0, ay) }];
  const labels: Label[] = [
    { text: 'x', at: at(ax + (12 / px), 0), anchor: 'middle' },
    { text: 'y', at: at(0, ay + (12 / px)), anchor: 'middle' },
  ];
  return { lines, axes, labels, step };
}

/** A quad's four corners from a local box through a matrix to host px. */
export function quadOf(box: Rect, toHost: Affine): Quad {
  const at = (x: number, y: number): Point => {
    const [px, py] = apply(toHost, x, y);
    return { x: px, y: py };
  };
  return [at(box.x, box.y), at(box.x + box.width, box.y), at(box.x + box.width, box.y + box.height), at(box.x, box.y + box.height)];
}

/**
 * The axis-aligned box around quads (host px), or null. A loop, not Math.min(...all): a call's
 * arguments are capped (V8 throws at about 150,000), and a large selection has four corners a shape.
 */
export function unionBox(quads: readonly Quad[]): Rect | null {
  let n = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of quads) {
    for (const p of q) {
      n++;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  return n ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
