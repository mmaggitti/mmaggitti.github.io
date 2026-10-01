// The Text tool's markup (P1-M4, src/interact/text-tool.ts): SVG Lab's "Hello" scaled to the
// artboard as the Shapes tool scales its shapes, its middle at the tap (the 0.35·S offset), under the
// root's prefix; and a family written as the Font sheet writes one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT_FILL, cssFamilyName, fontValue, textMarkup } from '../../src/interact/text-tool.ts';

test('a tap on a 100-unit board places SVG Lab’s "Hello" exactly: size 14, its baseline 0.35·S below the tap (y 55 for a tap at 50), attributes in KITS.text’s order', () => {
  assert.equal(textMarkup({ x: 50, y: 50 }, { k: 1, step: 1, svg: null, family: 'Archivo, sans-serif' }), `<text x="50" y="55" font-size="14" font-family="Archivo, sans-serif" font-weight="700" text-anchor="middle" fill="${TEXT_FILL}">Hello</text>`);
  assert.equal(TEXT_FILL, '#264653', 'SVG Lab’s colour');
  assert.equal(textMarkup({ x: 20, y: 80 }, { k: 1, step: 1, svg: null, family: 'Inter, sans-serif' }), '<text x="20" y="85" font-size="14" font-family="Inter, sans-serif" font-weight="700" text-anchor="middle" fill="#264653">Hello</text>');
});

test('on a 24 × 24 board (k 0.24, step 0.1) the size is L(14k) on the step and the offset 0.35·S; under an s:svg root the element is s:text; a family’s quotes are escaped for the attribute', () => {
  assert.equal(textMarkup({ x: 12, y: 12 }, { k: 0.24, step: 0.1, svg: null, family: 'Archivo, sans-serif' }), '<text x="12" y="13.2" font-size="3.4" font-family="Archivo, sans-serif" font-weight="700" text-anchor="middle" fill="#264653">Hello</text>');
  assert.equal(textMarkup({ x: 1, y: 1 }, { k: 0.01, step: 0.5, svg: 's', family: 'serif' }), '<s:text x="1" y="1" font-size="0.5" font-family="serif" font-weight="700" text-anchor="middle" fill="#264653">Hello</s:text>', 'at least one step');
  assert.match(textMarkup({ x: 0, y: 0 }, { k: 1, step: 1, svg: null, family: '"Odd" & Co' }), / font-family="&quot;Odd&quot; &amp; Co" /);
});

test('a family is written bare when every word is an identifier and none a keyword, else single-quoted; with its generic, or a generic alone', () => {
  assert.equal(cssFamilyName('Archivo'), 'Archivo');
  assert.equal(cssFamilyName('IBM Plex Sans'), 'IBM Plex Sans');
  assert.equal(cssFamilyName('Source Sans 3'), "'Source Sans 3'", 'a word that isn’t an identifier');
  assert.equal(cssFamilyName('My serif'), "'My serif'", 'a keyword');
  assert.equal(cssFamilyName("Jo's Font"), "'Jo\\'s Font'");
  assert.equal(fontValue('Archivo', 'sans-serif'), 'Archivo, sans-serif');
  assert.equal(fontValue('Source Sans 3', 'sans-serif'), "'Source Sans 3', sans-serif");
  assert.equal(fontValue('serif', null), 'serif');
});
