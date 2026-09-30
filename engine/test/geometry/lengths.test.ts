// engine/geometry/lengths: lengths where geometry uses them, in user units.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, type Doc, type ElementNode } from '../../model/doc.ts';
import { fontSizeOf, hasRem, remToUserUnits, resolveLength, rootFontSize, type LengthCtx } from '../../geometry/lengths.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok);
  return r.doc;
};
const byId = (doc: Doc, id: string) => [...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === id)) as ElementNode;
const ctx = (over: Partial<LengthCtx> = {}): LengthCtx => ({ axis: 'x', fontSize: null, remPx: null, viewport: null, ...over });
const near = (a: number | null, b: number, msg: string) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

test('lengths resolve in user units at 96 dpi, and a unitless number is user units', () => {
  near(resolveLength('10', ctx()), 10, 'unitless');
  near(resolveLength('10px', ctx()), 10, 'px');
  near(resolveLength('1in', ctx()), 96, 'in');
  near(resolveLength('72pt', ctx()), 96, 'pt');
  near(resolveLength('6pc', ctx()), 96, 'pc');
  near(resolveLength('25.4mm', ctx()), 96, 'mm');
  near(resolveLength('2.54cm', ctx()), 96, 'cm');
  assert.equal(resolveLength('auto', ctx()), null, 'not a length');
  assert.equal(resolveLength('10 20', ctx()), null, 'a list is not one length');
});

test('em is against the font size, and null without one; ex is the font’s own x-height, so unknown', () => {
  near(resolveLength('2em', ctx({ fontSize: 20 })), 40, 'em');
  assert.equal(resolveLength('2em', ctx()), null, 'no font size');
  assert.equal(resolveLength('2ex', ctx({ fontSize: 20 })), null, 'ex: Chromium measures its default font at 0.459em, not 0.5em');
});

test('rem is against the page’s root font size, and null without it', () => {
  near(resolveLength('2rem', ctx({ remPx: 12 })), 24, 'rem at the app’s 12 px root');
  near(resolveLength('1.5REM', ctx({ remPx: 16 })), 24, 'case-insensitive');
  assert.equal(resolveLength('2rem', ctx()), null, 'no remPx');
  assert.equal(resolveLength('2rem', ctx({ fontSize: 20 })), null, 'the element’s font size is not the root’s');
});

test('% is against the nearest viewport: its width for x, its height for y, the normalised diagonal otherwise', () => {
  const viewport = { w: 300, h: 400 };
  near(resolveLength('50%', ctx({ axis: 'x', viewport })), 150, 'x');
  near(resolveLength('50%', ctx({ axis: 'y', viewport })), 200, 'y');
  near(resolveLength('100%', ctx({ axis: 'other', viewport })), Math.sqrt((300 ** 2 + 400 ** 2) / 2), 'r');
  assert.equal(resolveLength('50%', ctx({ axis: 'x' })), null, 'no viewport');
});

test('hasRem finds rem lengths, and remToUserUnits rewrites only the rem numbers', () => {
  assert.ok(hasRem('1rem'));
  assert.ok(hasRem('fill: red; stroke-width: .5rem'));
  assert.ok(hasRem('x:-1.5e1REM'));
  assert.ok(!hasRem('10em'));
  assert.ok(!hasRem('url(#a2rem)'), 'inside an id');
  assert.ok(!hasRem('1remx'), 'a longer unit');
  assert.equal(remToUserUnits('1rem', 16), '16');
  assert.equal(remToUserUnits('font-size: 1.25rem ;  stroke-width:0.1rem;fill:red', 20), 'font-size: 25 ;  stroke-width:2;fill:red');
  assert.equal(remToUserUnits('2em 3rem 4px', 10), '2em 30 4px', 'every other byte stays');
  assert.equal(remToUserUnits('1rem', 13.3333), '13.3333', 'four places');
});

test('rootFontSize: the root’s font-size (the style declaration wins), relative ones against 16, else 16', () => {
  const svg = (attrs: string) => load(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}/>`);
  assert.equal(rootFontSize(svg('')), 16);
  assert.equal(rootFontSize(svg('font-size="20"')), 20);
  assert.equal(rootFontSize(svg('font-size="15pt"')), 20);
  assert.equal(rootFontSize(svg('font-size="2em"')), 32);
  assert.equal(rootFontSize(svg('font-size="large"')), 18);
  assert.equal(rootFontSize(svg('font-size="20" style="font-size: 10px"')), 10, 'the declaration wins');
  assert.equal(rootFontSize(svg('style="font-size: 10"')), 16, 'CSS wants a unit');
  assert.equal(rootFontSize(svg('font-size="bogus"')), 16);
});

test('an element’s font size comes down the tree from the document, and is unknown where a <style> rule may set it', () => {
  const doc = load(`<svg xmlns="http://www.w3.org/2000/svg" font-size="20"><style>.big { font-size: 40px }</style>
    <g id="g" font-size="2em"><rect id="a"/><rect id="b" style="font-size:50%"/></g><rect id="c" class="big"/>
    <g style="font: 12px serif"><rect id="d"/></g></svg>`);
  assert.equal(fontSizeOf(doc, byId(doc, 'g').id, null), 40);
  assert.equal(fontSizeOf(doc, byId(doc, 'a').id, null), 40, 'inherited');
  assert.equal(fontSizeOf(doc, byId(doc, 'b').id, null), 20, 'half its parent’s');
  assert.equal(fontSizeOf(doc, byId(doc, 'c').id, null), null, 'a rule may set it');
  assert.equal(fontSizeOf(doc, byId(doc, 'd').id, null), null, 'the font shorthand set it');
});
