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

// The keyword properties' own keywords (CSS reads them in any case): a value that isn't one is
// refused, so no text but a keyword is ever written there (SVG 2's full lists, the segments' too).
const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  'stroke-linecap': ['butt', 'round', 'square'],
  'stroke-linejoin': ['miter', 'miter-clip', 'round', 'bevel', 'arcs'],
  'vector-effect': ['none', 'non-scaling-stroke', 'non-scaling-size', 'non-rotation', 'fixed-position'],
  'shape-rendering': ['auto', 'optimizeSpeed', 'crispEdges', 'geometricPrecision'],
};
// paint-order: normal, or one to three of these, each once.
const PAINT_ORDER = ['fill', 'stroke', 'markers'];

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
  const words = KEYWORDS[prop];
  if (words) return words.some((w) => w.toLowerCase() === text.toLowerCase()) ? { text } : { error: `${JSON.stringify(input)} is not one of ${words.join(', ')}` };
  if (prop === 'paint-order') {
    const parts = text.toLowerCase().split(/[ \t\n\r\f]+/);
    const order = parts.length === 1 && parts[0] === 'normal' ? true : parts.length <= 3 && parts.every((p) => PAINT_ORDER.includes(p)) && new Set(parts).size === parts.length;
    return order ? { text } : { error: `${JSON.stringify(input)} is not normal or an order of fill, stroke and markers` };
  }
  return { text };
}

/** A paint kind Inspect offers: none, a colour, or a new gradient (S3). */
export type PaintKind = 'none' | 'color' | 'linear' | 'radial';

/**
 * The paint kinds Inspect's Fill or Stroke row offers for the selected elements (their local
 * names), or null when it shows no row: a line has no Fill (SVG Lab's styleAttrs, L1104), and its
 * stroke takes no none, which would make it vanish (L1885; the stroke sheet's chips agree,
 * color-choices.ts styleSlot).
 */
export function paintKinds(prop: 'fill' | 'stroke', locals: readonly string[]): PaintKind[] | null {
  const lines = locals.filter((l) => l === 'line').length;
  if (prop === 'fill') return lines && lines === locals.length ? null : ['none', 'color', 'linear', 'radial'];
  return lines ? ['color', 'linear', 'radial'] : ['none', 'color', 'linear', 'radial'];
}

// ── what Inspect's keyword rows show (Inspect.tsx), pure so the unit tests see it ────────────────

/** Line joins and paint orders Inspect offers as segments ([value, label]). */
export const JOINS: readonly [string, string][] = [['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']];
export const ORDERS: readonly [string, string][] = [['normal', 'Fill first'], ['stroke', 'Stroke first']];

/** The Join segments for a row: miter, round and bevel, and miter-clip or arcs only while the value is that one. */
export function joinSegments(row: { value: string; mixed: boolean }): [string, string][] {
  const jv = row.value.toLowerCase();
  return !row.mixed && (jv === 'miter-clip' || jv === 'arcs') ? [...JOINS, [jv, jv]] : [...JOINS];
}

/** Whether the Miter limit field shows: while the join is miter or miter-clip (or Mixed). */
export function showsMiterlimit(row: { value: string; mixed: boolean }): boolean {
  const jv = row.value.toLowerCase();
  return row.mixed || jv === 'miter' || jv === 'miter-clip';
}

/** A keyword row's value when none of its segments is it, shown as written beside them; null when one is (or Mixed). */
export function unlisted(row: { value: string; mixed: boolean }, options: readonly (readonly [string, string])[]): string | null {
  const v = row.mixed ? null : row.value.toLowerCase().replace(/[\s,]+/g, ' ');
  return v !== null && !options.some(([o]) => o.toLowerCase() === v) ? row.value : null;
}

/** The Dash presets on this artboard: none, then SVG Lab's three, each number × k. */
export function dashPresets(k: number): string[] {
  return DASH_PRESETS.map((p) => (p === null ? 'none' : p.map((v) => fmt(v * k, 2)).join(' ')));
}

/** The stroke-width slider: 0 to 20k, by the snap step. */
export function widthRange(ctx: StyleCtx): { min: number; max: number; step: number } {
  return { min: 0, max: Number(fmt(20 * ctx.k, 2)), step: ctx.step };
}
