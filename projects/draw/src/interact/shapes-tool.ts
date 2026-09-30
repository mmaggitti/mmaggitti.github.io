// The Shapes tool's markup, pure: what a tap places and what a drag draws, in the root's user units,
// for SVG Lab's Create defaults (LabCreate.add) scaled to the artboard.
//
// - k = min(W, H) / 100 for a W × H artboard (1 with none): on SVG Lab's 100-unit board the
//   defaults are exactly the lab's. s is the snap step; q(v) is v on the step, written as the step
//   writes it; a length is L(v) = max(s, q(v)).
// - A tap places the lab's default centred on the (snapped) point: a rect 40 × 30, a circle r 18, an
//   ellipse 26 × 14, a line ± (24, −18) about the point with width 4 and round caps; Draw's own
//   generated polygon (5 sides), star (inner 0.4, 5 tips) and spiral (3 turns) at r 20, the spiral
//   with the lab's pen width 3. Each × k.
// - A drag draws from the (snapped) start a to the (snapped) finger b: a rect or an ellipse in their
//   box, a circle, polygon, star or spiral from its centre out, a line end to end.
// - Colours follow the lab's cycle, PAL[[5, 1, 3, 4, 6, 9][n % 6]].
// - The markup is one line, attributes in the lab's order, numbers by fmt; the element takes the
//   root's own prefix (svg:rect under an svg:svg root) and Draw's inputs the prefix declare() gives.

import { fmt } from '../../../../engine/values/number-format.ts';
import { polygonPoints, starPoints } from '../../../../engine/generators/radial.ts';
import { spiralPath } from '../../../../engine/generators/spiral.ts';
import { PALETTE } from '../color-choices.ts';
import { stepDecimals, toStep } from './snap.ts';

export type ShapeKind = 'rect' | 'circle' | 'ellipse' | 'line' | 'polygon' | 'star' | 'spiral';
export const SHAPE_KINDS: readonly ShapeKind[] = ['rect', 'circle', 'ellipse', 'line', 'polygon', 'star', 'spiral'];
/** The kind buttons' names. */
export const SHAPE_NAMES: Readonly<Record<ShapeKind, string>> = { rect: 'Rectangle', circle: 'Circle', ellipse: 'Ellipse', line: 'Line', polygon: 'Polygon', star: 'Star', spiral: 'Spiral' };
/** Each kind's history entry. */
export const SHAPE_LABELS: Readonly<Record<ShapeKind, string>> = { rect: 'Add rectangle', circle: 'Add circle', ellipse: 'Add ellipse', line: 'Add line', polygon: 'Add polygon', star: 'Add star', spiral: 'Add spiral' };

const CYCLE = [5, 1, 3, 4, 6, 9];
/** The n-th shape's colour (n from 0): SVG Lab's Create cycle. */
export const shapeColour = (n: number): string => PALETTE[CYCLE[((n % CYCLE.length) + CYCLE.length) % CYCLE.length]];

export interface Point {
  x: number;
  y: number;
}

export interface ShapeCtx {
  k: number; // min(W, H) / 100 of the artboard, 1 with none
  step: number; // the snap step, root units
  svg: string | null; // the root's prefix (null: the default namespace)
  draw: string; // the prefix Draw's namespace is declared with
  colour: string;
}

/** k for an artboard (1 with none). */
export const boardScale = (board: { width: number; height: number } | null): number => (board && board.width > 0 && board.height > 0 ? Math.min(board.width, board.height) / 100 : 1);

const tag = (c: ShapeCtx, local: string) => (c.svg ? `${c.svg}:${local}` : local);
/** A snapped value written with up to 4 places (a value on the step prints as the step writes it). */
const num = (v: number) => fmt(v, 4);
/** One element, attributes in order, values escaped for double quotes (they are numbers and colours). */
const element = (c: ShapeCtx, local: string, attrs: [string, string][]) => `<${tag(c, local)} ${attrs.map(([n, v]) => `${n}="${v}"`).join(' ')}/>`;

/** The generator inputs of a kind drawn at (cx, cy) with radius r, and its geometry from them. */
function generated(kind: 'polygon' | 'star' | 'spiral', c: ShapeCtx, cx: number, cy: number, r: number): string {
  // The inputs as written, then the geometry from the numbers written: it reads back as generated.
  const [x, y, rr] = [fmt(cx, 2), fmt(cy, 2), fmt(r, 2)];
  const [X, Y, R] = [Number(x), Number(y), Number(rr)];
  const d = (name: string) => `${c.draw}:${name}`;
  const ins: [string, string][] = [[d('gen'), kind], [d('cx'), x], [d('cy'), y], [d('r'), rr]];
  if (kind === 'polygon') return element(c, 'polygon', [['points', polygonPoints(X, Y, R, 5)], ['fill', c.colour], ['stroke', 'none'], ...ins, [d('sides'), '5']]);
  if (kind === 'star') return element(c, 'polygon', [['points', starPoints(X, Y, R, 0.4, 5)], ['fill', c.colour], ['stroke', 'none'], ...ins, [d('inner'), '0.4'], [d('tips'), '5']]);
  const w = fmt(Math.max(c.step, toStep(3 * c.k, c.step)), stepDecimals(c.step));
  return element(c, 'path', [['d', spiralPath(X, Y, R, 3)], ['fill', 'none'], ['stroke', c.colour], ['stroke-width', w], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ...ins, [d('turns'), '3']]);
}

/** The markup a tap places, centred on `p` (root units, snapped). */
export function placeMarkup(kind: ShapeKind, p: Point, c: ShapeCtx): string {
  const s = c.step;
  const q = (v: number) => toStep(v, s);
  const L = (v: number) => Math.max(s, q(v));
  const w = (v: number) => fmt(v, stepDecimals(s));
  switch (kind) {
    case 'rect': {
      const [width, height] = [L(40 * c.k), L(30 * c.k)];
      return element(c, 'rect', [['x', w(q(p.x - width / 2))], ['y', w(q(p.y - height / 2))], ['width', w(width)], ['height', w(height)], ['rx', '0'], ['fill', c.colour], ['stroke', 'none']]);
    }
    case 'circle':
      return element(c, 'circle', [['cx', w(q(p.x))], ['cy', w(q(p.y))], ['r', w(L(18 * c.k))], ['fill', c.colour], ['stroke', 'none']]);
    case 'ellipse':
      return element(c, 'ellipse', [['cx', w(q(p.x))], ['cy', w(q(p.y))], ['rx', w(L(26 * c.k))], ['ry', w(L(14 * c.k))], ['fill', c.colour], ['stroke', 'none']]);
    case 'line':
      return element(c, 'line', [
        ['x1', w(q(p.x - 24 * c.k))], ['y1', w(q(p.y + 18 * c.k))], ['x2', w(q(p.x + 24 * c.k))], ['y2', w(q(p.y - 18 * c.k))],
        ['stroke', c.colour], ['stroke-width', w(L(4 * c.k))], ['stroke-linecap', 'round'],
      ]);
    default:
      return generated(kind, c, q(p.x), q(p.y), L(20 * c.k));
  }
}

/** The markup a drag from `a` to `b` (root units, both snapped) draws, and its tooltip. */
export function drawMarkup(kind: ShapeKind, a: Point, b: Point, c: ShapeCtx): { markup: string; tip: string } {
  const s = c.step;
  const w = (v: number) => fmt(v, stepDecimals(s));
  if (kind === 'rect' || kind === 'ellipse') {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.max(s, Math.abs(b.x - a.x));
    const height = Math.max(s, Math.abs(b.y - a.y));
    const tip = `${num(width)} × ${num(height)}`;
    if (kind === 'rect') return { markup: element(c, 'rect', [['x', num(x)], ['y', num(y)], ['width', num(width)], ['height', num(height)], ['rx', '0'], ['fill', c.colour], ['stroke', 'none']]), tip };
    const r = (v: number) => w(Math.max(s, toStep(v / 2, s)));
    return { markup: element(c, 'ellipse', [['cx', num(x + width / 2)], ['cy', num(y + height / 2)], ['rx', r(width)], ['ry', r(height)], ['fill', c.colour], ['stroke', 'none']]), tip };
  }
  if (kind === 'line') {
    const markup = element(c, 'line', [
      ['x1', num(a.x)], ['y1', num(a.y)], ['x2', num(b.x)], ['y2', num(b.y)],
      ['stroke', c.colour], ['stroke-width', w(Math.max(s, toStep(4 * c.k, s)))], ['stroke-linecap', 'round'],
    ]);
    return { markup, tip: `x ${num(b.x)}, y ${num(b.y)}` };
  }
  const r = Math.max(s, toStep(Math.hypot(b.x - a.x, b.y - a.y), s));
  const tip = `r ${w(r)}`;
  if (kind === 'circle') return { markup: element(c, 'circle', [['cx', num(a.x)], ['cy', num(a.y)], ['r', w(r)], ['fill', c.colour], ['stroke', 'none']]), tip };
  return { markup: generated(kind, c, a.x, a.y, r), tip };
}

/** Inspect's Generator fields: each input's name there, range, and the step its − and + take ('snap': the snap step). */
export const INPUT_UI: Readonly<Record<string, { label: string; min: number; max: number; step: number | 'snap'; integer?: boolean }>> = {
  cx: { label: 'Centre x', min: -Infinity, max: Infinity, step: 'snap' },
  cy: { label: 'Centre y', min: -Infinity, max: Infinity, step: 'snap' },
  r: { label: 'Radius', min: 1, max: Infinity, step: 'snap' },
  sides: { label: 'Sides', min: 3, max: 24, step: 1, integer: true },
  tips: { label: 'Tips', min: 3, max: 24, step: 1, integer: true },
  inner: { label: 'Inner', min: 0.05, max: 0.95, step: 0.05 },
  turns: { label: 'Turns', min: 0.5, max: 10, step: 0.25 },
};
