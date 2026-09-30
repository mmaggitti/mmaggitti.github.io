// engine/geometry/css: where CSS may set a property on an element (style="" or a <style> rule).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, el, parseDoc, type Doc, type ElementNode } from '../../model/doc.ts';
import { cssSets, declarations, inlineDecl, sheetSets } from '../../geometry/css.ts';
import { opInsert, opRemove, opSetAttr, opSetLeafRaw, undoOp } from '../../commands/ops.ts';
import { parseFragment } from '../../model/fragment.ts';

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

test('the sheets are read again whenever what a <style> says can change (its text; a <style>, or text in one, coming or going; each undone), and never for any other edit', () => {
  const doc = svg('<style id="s">rect { x: 1px }</style><rect id="r"/><g id="g"/>');
  const [r, s, g] = ['r', 's', 'g'].map((id) => byId(doc, id));
  const text = el(doc, s).children[0];
  assert.equal(cssSets(doc, r, 'x'), 'sheet');
  // Every other edit keeps the sheets as they were read: a move of 4,000 shapes asks about each one.
  const version = doc.styleVersion;
  undoOp(doc, opSetAttr(doc, r, null, 'width', '5'));
  undoOp(doc, opSetAttr(doc, s, null, 'media', 'print'));
  const away = opRemove(doc, g);
  undoOp(doc, opInsert(doc, g, doc.root, 0));
  undoOp(doc, away);
  assert.equal(doc.styleVersion, version, 'attributes, and a move of an element holding no <style>, leave the sheets alone');
  const edit = opSetLeafRaw(doc, text, 'circle { x: 1px }');
  assert.equal(cssSets(doc, r, 'x'), 'no', 'its text edited');
  undoOp(doc, edit);
  assert.equal(cssSets(doc, r, 'x'), 'sheet', 'and undone');
  const out = opRemove(doc, s);
  assert.equal(cssSets(doc, r, 'x'), 'no', 'the <style> taken away');
  undoOp(doc, out);
  assert.equal(cssSets(doc, r, 'x'), 'sheet', 'and put back');
  const leaf = opRemove(doc, text);
  assert.equal(cssSets(doc, r, 'x'), 'no', 'its text taken away');
  undoOp(doc, leaf);
  assert.equal(cssSets(doc, r, 'x'), 'sheet', 'and put back');
  const made = parseFragment(doc, g, '<g><style>rect { y: 2px }</style></g>');
  assert.ok(made.ok);
  assert.equal(cssSets(doc, r, 'y'), 'no', 'parsed in, not yet in the document');
  const put = opInsert(doc, made.nodes[0], g, 0);
  assert.equal(cssSets(doc, r, 'y'), 'sheet', 'a group holding a <style> inserted');
  undoOp(doc, put);
  assert.equal(cssSets(doc, r, 'y'), 'no', 'and taken out again');
});

test('declarations: each value’s span in the text given (trimmed; !important and the comments around it left out) and its importance', () => {
  const css = '  fill :  #2a9d8f  !important ;stroke-width:2 ; x: /*a*/ 1 /*b*/;y:;z: a/*c*/b ! IMPORTANT';
  const ds = declarations(css);
  assert.deepEqual(ds.map((d) => [d.name, d.value, d.important, css.slice(d.start, d.end)]), [
    ['fill', '#2a9d8f', true, '#2a9d8f'],
    ['stroke-width', '2', false, '2'],
    ['x', '1', false, '1'],
    ['y', '', false, ''],
    ['z', 'a b', true, 'a/*c*/b'],
  ]);
  assert.equal(ds[3].start, css.indexOf('y:;') + 2, 'an empty value sits right after its colon');
});

test('sheetSets: whether a <style> rule may set the property whatever style="" says, and whether one that may marks it !important', () => {
  const doc = svg(`<style>.k { fill: red } .i { fill: red !important } .i2 { fill: blue } #other { stroke: red !important } .s { stroke: red }
    text { font: 12px serif !important } @keyframes spin { to { opacity: 0 } } .a { animation: spin 1s }</style>
    <rect id="k" class="k" style="fill:blue"/><rect id="i" class="i i2"/><rect id="s" class="s"/><text id="t"/><rect id="a" class="a"/><rect id="n"/>`);
  assert.equal(cssSets(doc, byId(doc, 'k'), 'fill'), 'inline', 'cssSets answers style="" first, as before');
  assert.equal(sheetSets(doc, byId(doc, 'k'), 'fill'), 'rule', 'the sheets alone');
  assert.equal(sheetSets(doc, byId(doc, 'i'), 'fill'), 'important', 'a later rule without !important doesn’t hide it');
  assert.equal(sheetSets(doc, byId(doc, 's'), 'stroke'), 'rule', 'an !important rule for another element is not one');
  assert.equal(sheetSets(doc, byId(doc, 't'), 'font-size'), 'important', 'through a shorthand');
  assert.equal(sheetSets(doc, byId(doc, 'a'), 'opacity'), 'rule', 'an animation counts as a rule');
  assert.equal(sheetSets(doc, byId(doc, 'n'), 'fill'), 'no');
  assert.equal(cssSets(doc, byId(doc, 'i'), 'fill'), 'sheet', 'cssSets keeps its answers');
});
