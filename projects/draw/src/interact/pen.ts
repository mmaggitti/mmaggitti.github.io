// The Pen's path data, pure (P1-M3): what each gesture appends to a <path>'s d, in the path's own
// units, from SVG Lab's pen (LabCreate.startPen, tap, endPen) and Draw's own drag.
//
// - An anchor is a point with an out-handle (a drag set it: the finger) and an in-handle (its
//   reflection about the point, 2p − f); a tap gives neither.
// - The segment into a new anchor P from the previous anchor A uses the controls that exist: A's
//   out-handle and P's in-handle. Both: ` C a.x a.y i.x i.y P.x P.y`; one: ` Q c.x c.y P.x P.y`; none:
//   ` L P.x P.y`. So taps make lines, a drag makes a curve that leaves P along the drag, and a tap after
//   a drag makes a Q that leaves A along A's drag.
// - Closing: the segment from the last anchor to the start (its in-handle the reflection of the
//   start's out-handle, when the start was dragged) by the same rule, then ` Z`; with no controls,
//   ` Z` alone.
// - Numbers are on the snap step, written as the step writes them; single spaces.
// - The new path: `<path d="M x y SEG" fill="none" stroke="C" stroke-width="W" stroke-linecap="round"
//   stroke-linejoin="round"/>` in the root's prefix, W = L(3k) (SVG Lab's width 3 on its 100-unit
//   board) and C the lab's pen colours, PALETTE[[0, 8, 6, 7][n % 4]], n shared with the Shapes tool.

import { fmt } from '../../../../engine/values/number-format.ts';
import { PALETTE } from '../color-choices.ts';
import { stepDecimals, toStep } from './snap.ts';

export interface Point {
  x: number;
  y: number;
}

/** A pen anchor: its point and, when a drag placed it, its out-handle (the finger). */
export interface PenAnchor {
  at: Point;
  out: Point | null;
}

/** The in-handle a dragged anchor has: its out-handle reflected about it. */
export const inHandle = (a: PenAnchor): Point | null => (a.out ? { x: 2 * a.at.x - a.out.x, y: 2 * a.at.y - a.out.y } : null);

const CYCLE = [0, 8, 6, 7];
/** The n-th path's colour (n from 0, the Shapes tool's counter): SVG Lab's pen colours. */
export const penColour = (n: number): string => PALETTE[CYCLE[((n % CYCLE.length) + CYCLE.length) % CYCLE.length]];

/** A number on the step, as the step writes it. */
export const penNumber = (v: number, step: number): string => fmt(toStep(v, step), stepDecimals(step));

const pair = (p: Point, step: number) => `${penNumber(p.x, step)} ${penNumber(p.y, step)}`;

/** The segment from anchor `a` into anchor `p`: C with both controls, Q with one, L with none (a leading space). */
export function segmentInto(a: PenAnchor, p: PenAnchor, step: number): string {
  const c1 = a.out;
  const c2 = inHandle(p);
  if (c1 && c2) return ` C ${pair(c1, step)} ${pair(c2, step)} ${pair(p.at, step)}`;
  const c = c1 ?? c2;
  if (c) return ` Q ${pair(c, step)} ${pair(p.at, step)}`;
  return ` L ${pair(p.at, step)}`;
}

/** Closing: the curve back to the start when a control exists, then ` Z`. */
export function closingText(last: PenAnchor, start: PenAnchor, step: number): string {
  if (!last.out && !start.out) return ' Z';
  return `${segmentInto(last, start, step)} Z`;
}

export interface PathCtx {
  svg: string | null; // the root's prefix
  k: number; // the artboard's scale (min(W, H) / 100)
  step: number;
  colour: string;
}

/** The new path's markup (its first two anchors). */
export function penPathMarkup(first: PenAnchor, second: PenAnchor, c: PathCtx): string {
  const w = fmt(Math.max(c.step, toStep(3 * c.k, c.step)), stepDecimals(c.step));
  const tag = c.svg ? `${c.svg}:path` : 'path';
  const d = `M ${pair(first.at, c.step)}${segmentInto(first, second, c.step)}`;
  return `<${tag} d="${d}" fill="none" stroke="${c.colour}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A d with `text` appended right after its last segment (before its trailing whitespace or error text). */
export function appendSegment(raw: string, tailLength: number, text: string): string {
  return raw.slice(0, raw.length - tailLength) + text + raw.slice(raw.length - tailLength);
}
