// What the Color sheet offers: SVG Lab's 16-colour palette, a chip for each keyword the slot takes
// too (a paint's none, currentColor, context-fill and context-stroke; a stop-color's currentColor),
// which of them is ringed as the current value, and the picker's starting colour. Pure, so the unit
// tests see exactly what the sheet shows; Sheets.tsx only lays it out. A slot is a code token, or a
// style property over the selection (Inspect's style sheet, P1-M2).

import { parseColor, toHex } from '../../../engine/values/color.ts';

// SVG Lab's palette.
export const PALETTE: readonly string[] = [
  '#264653', '#2a9d8f', '#8ab17d', '#e9c46a', '#f4a261', '#e76f51', '#b56576', '#6d597a',
  '#1d3557', '#457b9d', '#a8dadc', '#f1faee', '#ffffff', '#8d99ae', '#2b2d42', '#000000',
];

export interface Choice {
  value: string;
  current: boolean; // ringed: the value the token holds now
}

/** Two colour texts name the same choice when they match ignoring case (#FFD166 and #ffd166, None and none). */
export const sameColor = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** What a colour slot takes: its property, and the non-colour values it takes too (a code token is one). */
export interface ColorSlot {
  prop: string;
  keywords: readonly string[];
}

// currentColor, a colour but offered as a chip, for the slots that paint (before context-fill).
const CURRENT = new Set(['fill', 'stroke', 'stop-color']);

/** The palette's swatches and the slot's keyword chips (currentColor among them for a paint or a stop), with the current value ringed. */
export function colorChoices(slot: ColorSlot, current: string): { swatches: Choice[]; chips: Choice[] } {
  const choice = (value: string): Choice => ({ value, current: sameColor(current, value) });
  const chips = [...slot.keywords];
  if (CURRENT.has(slot.prop)) chips.splice(chips[0] === 'none' ? 1 : 0, 0, 'currentColor');
  return { swatches: PALETTE.map(choice), chips: chips.map(choice) };
}

/**
 * The style sheet's slot for a property over the selected elements (their local names): a paint's
 * keywords for fill and stroke, but no none for a line's stroke (it would vanish: SVG Lab L1885);
 * none for color and stop-color.
 */
export function styleSlot(prop: string, locals: readonly string[]): ColorSlot {
  if (prop === 'fill') return { prop, keywords: ['none', 'context-fill', 'context-stroke'] };
  if (prop === 'stroke') return { prop, keywords: locals.includes('line') ? ['context-fill', 'context-stroke'] : ['none', 'context-fill', 'context-stroke'] };
  return { prop, keywords: [] };
}

/** The picker's starting colour for a value that isn't one: the colour as #rrggbb, or black (none, a keyword). */
export function pickerHex(text: string): string {
  const c = parseColor(text);
  return (c && toHex(c, false)) ?? '#000000';
}
