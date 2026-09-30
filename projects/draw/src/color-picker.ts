// The Colour sheet's picker (P1-M2), pure: an HSV colour with alpha, in sRGB (CSS Color 4's other
// spaces are edited through an sRGB preview), and the notation family of the value the sheet opened
// on, which every move is written in (hex for a keyword, currentColor or a value Draw can't read).
// The hue is the picker's own: while saturation or brightness is 0 (grey, black) it stays where it
// was, so a drag through black never loses it. The alpha keeps its own text (0.333, 33.3%) until
// the Alpha slider moves it. A colour outside sRGB starts clipped, and nothing is written until the
// picker moves.

import { alphaIsPercent, alphaTextOf, clampRgb, hsvToRgb, notationOf, parseColor, rgbToHsv, writeColor, type Color, type Notation } from '../../../engine/values/color.ts';
import { pickerHex } from './color-choices.ts';

export interface Picker {
  h: number; // 0–360
  s: number; // 0–1
  v: number; // 0–1
  a: number; // 0–1
  family: Notation;
  percent: boolean; // the opening value's alpha was a percentage
  /** The alpha as written (the opening value's, or typed), kept as it is until the Alpha slider moves; null when none is written. */
  alphaText: string | null;
}

// An alpha's own text, when it is a plain number or percentage (every family writes those; `none`
// isn't one legacy rgba() takes).
const ownAlpha = (c: Color): string | null => {
  const t = alphaTextOf(c);
  return t !== null && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?%?$/.test(t) ? t : null;
};

/** The picker on the value the sheet opened with (black for a value that isn't a colour: none, a keyword). */
export function pickerStart(text: string): Picker {
  const own = parseColor(text);
  const c = own && own.kind === 'color' ? own : parseColor(pickerHex(text))!;
  const { r, g, b } = clampRgb(c);
  const [h, s, v] = rgbToHsv(r, g, b);
  return { h, s, v, a: c.alpha, family: own && own.kind === 'color' ? notationOf(own) : 'hex', percent: own ? alphaIsPercent(own) : false, alphaText: own && own.kind === 'color' ? ownAlpha(own) : null };
}

/** The text a picker state writes: its colour in the opening family. */
export function pickerText(p: Picker): string {
  return writeColor(hsvToRgb(p.h, p.s, p.v), p.a, p.family, p.percent, p.alphaText);
}

const unit = (x: number) => Math.min(1, Math.max(0, x));

/** The square: saturation (left to right) and brightness (bottom to top). */
export const pickSV = (p: Picker, s: number, v: number): Picker => ({ ...p, s: unit(s), v: unit(v) });
/** The Hue slider (degrees). */
export const pickHue = (p: Picker, h: number): Picker => ({ ...p, h: Math.min(360, Math.max(0, h)) });
/** The Alpha slider (0–1): from here on its own value is written. */
export const pickAlpha = (p: Picker, a: number): Picker => ({ ...p, a: unit(a), alphaText: null });

/** A swatch, a chip or typed text taken: the picker follows it (keeping its own hue on a grey or black); the family stays the opening one. */
export function pickText(p: Picker, text: string): Picker {
  const c = parseColor(text);
  if (!c || c.kind !== 'color') return p;
  const { r, g, b } = clampRgb(c);
  const [h, s, v] = rgbToHsv(r, g, b);
  return { ...p, h: s === 0 || v === 0 ? p.h : h, s, v, a: c.alpha, alphaText: ownAlpha(c) };
}

/** The picker's colour as CSS for the preview (in gamut; `withAlpha` false: opaque). */
export function pickerCss(p: Picker, withAlpha = true): string {
  return writeColor(hsvToRgb(p.h, p.s, p.v), withAlpha ? p.a : 1, 'rgb-modern');
}

/** The square's hue: pure, at full saturation and brightness. */
export const hueCss = (h: number): string => writeColor(hsvToRgb(h, 1, 1), 1, 'rgb-modern');
