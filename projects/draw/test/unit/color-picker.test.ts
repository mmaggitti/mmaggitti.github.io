// The Colour sheet's picker (src/color-picker.ts, P1-M2): where it starts for a colour, a keyword and
// a colour outside sRGB; each move written in the notation the value was written in; alpha written
// below 1 and left out at 1; and the picker's own hue kept through grey and black.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, toHex } from '../../../../engine/values/color.ts';
import { pickAlpha, pickHue, pickSV, pickText, pickerStart, pickerText } from '../../src/color-picker.ts';

test('the picker starts on the colour the sheet opened with, in its family: a colour, a keyword (black, hex), and a colour outside sRGB (clipped; nothing is written until it moves)', () => {
  const p = pickerStart('hsl(12 76% 61%)');
  assert.equal(p.family, 'hsl-modern');
  assert.equal(Math.round(p.h), 12);
  assert.equal(p.a, 1);
  assert.equal(pickerText(p), 'hsl(12 76% 61%)', 'unmoved, it writes back the colour it opened with');
  for (const k of ['none', 'context-fill', 'currentColor']) {
    const q = pickerStart(k);
    assert.deepEqual([q.s, q.v, q.a, q.family], [0, 0, 1, 'hex'], `${k}: black, written as hex`);
  }
  const lab = parseColor('lab(60 120 40)')!;
  const out = pickerStart('lab(60 120 40)');
  assert.equal(out.family, 'lab');
  assert.equal(toHex(parseColor(pickerText(out))!), toHex(lab), 'shown clipped: the colour it would write is the clipped one');
  assert.notEqual(pickerText(out), 'lab(60 120 40)', 'which differs from the file’s, so the sheet writes nothing until the picker moves');
});

test('each move is written in the opening family: the square, the Hue slider and the Alpha slider; a percentage alpha stays one; alpha 1 is left out', () => {
  const cases: [string, RegExp][] = [
    ['#e76f51', /^#[0-9a-f]{8}$/],
    ['rgb(231, 111, 81)', /^rgba\(\d+(\.\d+)?, \d+(\.\d+)?, \d+(\.\d+)?, 0\.5\)$/],
    ['rgb(231 111 81 / 50%)', /^rgb\([\d.]+ [\d.]+ [\d.]+ \/ 50%\)$/],
    ['hsl(12 76% 61%)', /^hsl\([\d.]+ [\d.]+% [\d.]+% \/ 0\.5\)$/],
    ['oklch(0.66 0.15 36)', /^oklch\([\d.]+ [\d.]+ [\d.]+ \/ 0\.5\)$/],
    ['hwb(12 20% 10%)', /^hwb\([\d.]+ [\d.]+% [\d.]+% \/ 0\.5\)$/],
    ['lab(60 40 30)', /^lab\([\d.]+ -?[\d.]+ -?[\d.]+ \/ 0\.5\)$/],
    ['lch(60 50 40)', /^lch\([\d.]+ [\d.]+ [\d.]+ \/ 0\.5\)$/],
    ['oklab(0.6 0.1 0.05)', /^oklab\([\d.]+ -?[\d.]+ -?[\d.]+ \/ 0\.5\)$/],
    ['tomato', /^#[0-9a-f]{8}$/],
    ['transparent', /^#[0-9a-f]{8}$/],
  ];
  for (const [text, pattern] of cases) {
    let p = pickerStart(text);
    p = pickSV(p, 0.7, 0.8);
    p = pickHue(p, 200);
    p = pickAlpha(p, 0.5);
    assert.match(pickerText(p), pattern, `${text} → ${pickerText(p)}`);
    const back = parseColor(pickerText(p))!;
    assert.equal(toHex(back, false), '#3d9ccc', `${text}: hue 200, saturation 0.7, brightness 0.8`);
  }
  const opaque = pickAlpha(pickerStart('rgba(231, 111, 81, 0.4)'), 1);
  assert.equal(pickerText(opaque), 'rgb(231, 111, 81)', 'alpha 1 is left out');
  assert.equal(pickerText(pickAlpha(pickerStart('#e76f51'), 0.5)), '#e76f5180', 'alpha under 1 is written');
});

test('the picker keeps its own hue through grey and black: a drag to saturation or brightness 0 and back, and a grey swatch taken, keep the hue', () => {
  let p = pickHue(pickerStart('#e76f51'), 200);
  p = pickSV(p, 0, 0.5); // grey
  p = pickSV(p, 0.8, 0); // black
  p = pickSV(p, 0.8, 0.8);
  assert.equal(p.h, 200, 'back from black, the hue is where it was');
  p = pickText(p, '#808080');
  assert.equal(p.h, 200, 'a grey swatch keeps it too');
  assert.equal(pickText(p, '#00f').h, 240, 'a colour takes its own');
  assert.equal(pickText(p, 'none'), p, 'a keyword leaves the picker where it was');
});
