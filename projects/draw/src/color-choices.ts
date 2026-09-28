// What the Color sheet offers: SVG Lab's 16-colour palette, a chip for each keyword the slot takes
// too (a paint's none, context-fill and context-stroke; a stop-color has none of them), which of
// them is ringed as the current value, and the native picker's starting colour. Pure, so the unit
// tests see exactly what the sheet shows; Sheets.tsx only lays it out.

import { parseColor, toHex } from '../../../engine/values/color.ts';
import type { ColorToken } from '../../../engine/code/tokens.ts';

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

/** The palette's swatches and the slot's keyword chips, with the current value ringed. */
export function colorChoices(token: ColorToken, current: string): { swatches: Choice[]; chips: Choice[] } {
  const choice = (value: string): Choice => ({ value, current: sameColor(current, value) });
  return { swatches: PALETTE.map(choice), chips: token.keywords.map(choice) };
}

/** The native picker's value: the colour as #rrggbb, or black when the text isn't a colour (none). */
export function pickerHex(text: string): string {
  const c = parseColor(text);
  return (c && toHex(c, false)) ?? '#000000';
}
