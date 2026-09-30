// What Inspect and the style sheet take for each style property (P1-M2), pure so the unit tests see
// exactly what the controls write: a paint for fill and stroke, a colour for color and stop-color,
// a plain number (within its range) for the lengths and opacities, and one of the options for the
// keywords. What doesn't read is refused with why, and never written. Also the Dash presets on
// this artboard, and the slider ranges that scale with it.

import { parseColor, parsePaint } from '../../../engine/values/color.ts';
import { fmt } from '../../../engine/values/number-format.ts';
import { DASH_PRESETS } from '../../../engine/style/props.ts';
import type { StyleCtx } from '../../../engine/style/write.ts';
import type { Checked } from './token-edit.ts';

const NUMBER = /^-?(?:\d+|\d*\.\d+)$/; // a plain decimal, as Draw writes one
// A character outside XML 1.0's Char: no escape can write one.
const NOT_XML_CHAR = /[^\t\n\r\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;

/** The number properties and their ranges. */
export const STYLE_NUMBERS: Readonly<Record<string, { min: number; max?: number }>> = {
  'stroke-width': { min: 0 },
  'stroke-miterlimit': { min: 1 },
  'stroke-dashoffset': { min: -Infinity },
  opacity: { min: 0, max: 1 },
  'fill-opacity': { min: 0, max: 1 },
  'stroke-opacity': { min: 0, max: 1 },
  'stop-opacity': { min: 0, max: 1 },
};

/** The keyword properties' segments (a value outside them is shown as written, and kept). */
export const STYLE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  'stroke-linecap': ['butt', 'round', 'square'],
  'stroke-linejoin': ['miter', 'round', 'bevel'],
  'paint-order': ['normal', 'stroke'],
  'vector-effect': ['none', 'non-scaling-stroke'],
  'shape-rendering': ['auto', 'crispEdges', 'geometricPrecision', 'optimizeSpeed'],
};

/** The text a control writes for `prop`, or why it can't (never written). */
export function checkStyle(prop: string, input: string): Checked {
  const text = input.trim().replace(/^−/, '-');
  if (text === '') return { error: `Type a ${prop === 'fill' || prop === 'stroke' || prop.endsWith('color') ? 'colour' : 'value'}` };
  const bad = NOT_XML_CHAR.exec(text);
  if (bad) return { error: `XML can't hold the character U+${bad[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` };
  if (prop === 'fill' || prop === 'stroke') return parsePaint(text) ? { text } : { error: `${JSON.stringify(input)} is not a colour` };
  if (prop === 'color' || prop === 'stop-color') return parseColor(text) ? { text } : { error: `${JSON.stringify(input)} is not a colour` };
  const range = STYLE_NUMBERS[prop];
  if (range) {
    if (!NUMBER.test(text)) return { error: `${JSON.stringify(input)} is not a number` };
    const v = Number(text);
    if (v < range.min || (range.max !== undefined && v > range.max)) {
      return { error: range.max !== undefined ? `${prop} takes numbers from ${range.min} to ${range.max}` : `${prop} takes numbers from ${range.min}` };
    }
    return { text: fmt(v, 10) };
  }
  if (prop === 'stroke-dasharray') {
    if (text === 'none') return { text };
    const parts = text.split(/[\s,]+/);
    return parts.every((p) => NUMBER.test(p) && Number(p) >= 0) ? { text } : { error: `${JSON.stringify(input)} is not a dash list` };
  }
  return { text };
}

/** A paint kind Inspect offers (S3 adds the gradients). */
export type PaintKind = 'none' | 'color';

/**
 * The paint kinds Inspect's Fill or Stroke row offers for the selected elements (their local
 * names), or null when it shows no row: a line has no Fill (SVG Lab's styleAttrs, L1104), and its
 * stroke takes no none, which would make it vanish (L1885; the stroke sheet's chips agree,
 * color-choices.ts styleSlot).
 */
export function paintKinds(prop: 'fill' | 'stroke', locals: readonly string[]): PaintKind[] | null {
  const lines = locals.filter((l) => l === 'line').length;
  if (prop === 'fill') return lines && lines === locals.length ? null : ['none', 'color'];
  return lines ? ['color'] : ['none', 'color'];
}

/** The Dash presets on this artboard: none, then SVG Lab's three, each number × k. */
export function dashPresets(k: number): string[] {
  return DASH_PRESETS.map((p) => (p === null ? 'none' : p.map((v) => fmt(v * k, 2)).join(' ')));
}

/** The stroke-width slider: 0 to 20k, by the snap step. */
export function widthRange(ctx: StyleCtx): { min: number; max: number; step: number } {
  return { min: 0, max: Number(fmt(20 * ctx.k, 2)), step: ctx.step };
}
