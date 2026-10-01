// The Text tool's markup (P1-M4), pure: SVG Lab's "Hello" (LabCreate.add('text'), L1830-1841), scaled
// to the artboard as the Shapes tool scales its shapes (shapes-tool.ts: k, the snap step s, q and L).
//
// - A tap at p (root units, snapped) places
//   <text x="X" y="Y" font-size="S" font-family="F" font-weight="700" text-anchor="middle" fill="#264653">Hello</text>,
//   attributes in KITS.text's order (L1258): S = L(14k), X = q(p.x), Y = q(p.y + 0.35·S) (the lab's
//   centre, L1261, puts a text's middle 0.35·S above its baseline, so the tap lands in the word's
//   middle). F is the Text tool's font (Mark, 2026-10-01: Archivo or Inter, a device preference),
//   written as the Font sheet writes a family: `Archivo, sans-serif`. The fill is the lab's #264653.
// - The element takes the root's own prefix.

import { fmt } from '../../../../engine/values/number-format.ts';
import { stepDecimals, toStep } from './snap.ts';
import type { Point } from './shapes-tool.ts';

/** The history entry a placed text makes. */
export const TEXT_LABEL = 'Add text';
/** What the Text tool says when it is picked, and again after a drag (which places nothing). */
export const TEXT_NOTICE = 'Tap to place text.';
/** SVG Lab's text colour (L1838). */
export const TEXT_FILL = '#264653';

export interface TextCtx {
  k: number; // min(W, H) / 100 of the artboard, 1 with none
  step: number; // the snap step, root units
  svg: string | null; // the root's prefix
  family: string; // the font-family value to write (fontValue)
}

/** The markup a tap places at `p` (root units, snapped). */
export function textMarkup(p: Point, c: TextCtx): string {
  const s = c.step;
  const q = (v: number) => toStep(v, s);
  const w = (v: number) => fmt(v, stepDecimals(s));
  const size = Math.max(s, q(14 * c.k));
  const tag = c.svg ? `${c.svg}:text` : 'text';
  const family = c.family.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<${tag} x="${w(q(p.x))}" y="${w(q(p.y + 0.35 * size))}" font-size="${w(size)}" font-family="${family}" font-weight="700" text-anchor="middle" fill="${TEXT_FILL}">Hello</${tag}>`;
}

/** A family name as CSS writes it in a list: bare when every word is an identifier and none is a keyword, else single-quoted. */
export function cssFamilyName(family: string): string {
  const words = family.trim().split(/\s+/);
  const KEYWORDS = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong|inherit|initial|unset|revert|revert-layer|default)$/i;
  // A name character is ASCII's, or any from U+00A0 up to U+FFFD: U+FFFE and U+FFFF are characters XML
  // can't hold, so they are never name characters (and Set font refuses a value holding one).
  const ident = (w: string) => /^-?(?:[_a-zA-Z\u00A0-\uFFFD])[-_a-zA-Z0-9\u00A0-\uFFFD]*$/.test(w) && !/^--/.test(w);
  return words.every((w) => ident(w) && !KEYWORDS.test(w)) ? words.join(' ') : `'${family.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The font-family value for a family with its generic (`Archivo, sans-serif`), or a generic alone. */
export function fontValue(family: string, generic: string | null): string {
  return generic === null ? family : `${cssFamilyName(family)}, ${generic}`;
}
