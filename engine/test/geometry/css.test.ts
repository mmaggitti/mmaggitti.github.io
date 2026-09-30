// engine/geometry/css: where CSS may set a property on an element (style="" or a <style> rule).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, type Doc, type ElementNode } from '../../model/doc.ts';
import { cssSets, declarations, inlineDecl } from '../../geometry/css.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.doc;
};
const byId = (doc: Doc, id: string) => ([...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === id)) as ElementNode).id;
const svg = (body: string) => load(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);

test('inline: the element’s own style="" declares the property (the last declaration wins)', () => {
  const doc = svg('<rect id="a" style="fill: red; x: 10px; x:12px !important"/><rect id="b" style="fill:red"/>');
  assert.equal(cssSets(doc, byId(doc, 'a'), 'x'), 'inline');
  assert.equal(inlineDecl(doc, byId(doc, 'a'), 'x'), '12px', 'the last, without !important');
  assert.equal(cssSets(doc, byId(doc, 'b'), 'x'), 'no');
  assert.equal(inlineDecl(doc, byId(doc, 'b'), 'x'), null);
});

test('sheet: a <style> rule that may match the element (its name, *, its id, a class, or none of those)', () => {
  const doc = svg(`<style>
    rect { x: 1px }
    #c { cy: 3px }
    .round { r: 4px }
    g > .deep { transform: rotate(3deg) }
    [data-k] { height: 9px }
    @media (min-width: 1px) { * { width: 5px } }
  </style>
  <rect id="r"/><circle id="c"/><circle id="k" class="big round"/><circle id="d" class="deep"/><ellipse id="e"/>`);
  assert.equal(cssSets(doc, byId(doc, 'r'), 'x'), 'sheet', 'by its name');
  assert.equal(cssSets(doc, byId(doc, 'c'), 'cy'), 'sheet', 'by its id');
  assert.equal(cssSets(doc, byId(doc, 'k'), 'r'), 'sheet', 'by a class');
  assert.equal(cssSets(doc, byId(doc, 'd'), 'transform'), 'sheet', 'by the last compound, after a combinator');
  assert.equal(cssSets(doc, byId(doc, 'e'), 'height'), 'sheet', 'an attribute selector alone may match anything');
  assert.equal(cssSets(doc, byId(doc, 'e'), 'width'), 'sheet', 'inside @media, by *');
  assert.equal(cssSets(doc, byId(doc, 'c'), 'r'), 'no', 'a class the element doesn’t have');
});

test('a rule for another element is no: circle { x: 1 } says nothing about a rect', () => {
  const doc = svg('<style>circle { x: 1px } #other { y: 2px } .nope { width: 1px }</style><rect id="r" class="yes"/>');
  const r = byId(doc, 'r');
  assert.equal(cssSets(doc, r, 'x'), 'no');
  assert.equal(cssSets(doc, r, 'y'), 'no');
  assert.equal(cssSets(doc, r, 'width'), 'no');
});

test('!important, quoted values, comments and strings don’t confuse the scan', () => {
  const doc = svg(`<style>/* rect { x: 1px } */ text { font-family: "a; rect { y: 2px }" } circle { content: 'x:1' }</style>
    <rect id="r" style="font-family: 'x: 1; y: 2'; fill: red !important"/>`);
  const r = byId(doc, 'r');
  assert.equal(cssSets(doc, r, 'x'), 'no', 'a commented-out rule');
  assert.equal(cssSets(doc, r, 'y'), 'no', 'a rule inside a quoted value');
  assert.equal(inlineDecl(doc, r, 'fill'), 'red');
  assert.deepEqual(declarations("a: 'b;c'; d: e(f;g)").map((d) => d.name), ['a', 'd']);
});

test('keyframes set what they animate on an element something animates, and font sets font-size', () => {
  const doc = svg(`<style>@keyframes spin { to { transform: rotate(1turn) } } .s { animation: spin 1s }</style>
    <rect id="a" class="s"/><rect id="b"/><text id="t" style="font: 12px serif"/>`);
  assert.equal(cssSets(doc, byId(doc, 'a'), 'transform'), 'sheet');
  assert.equal(cssSets(doc, byId(doc, 'b'), 'transform'), 'no', 'nothing animates it');
  assert.equal(cssSets(doc, byId(doc, 't'), 'font-size'), 'inline', 'the shorthand');
});
