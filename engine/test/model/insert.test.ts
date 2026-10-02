// The Insert tool's plan (model/insert.ts): one <g> holding the inserted file's content, its ids made
// fresh with their references, the root's attributes that still mean something on a <g>, and a
// placement centred on the canvas at the file's own size; one larger than the artboard is scaled down
// to 80% of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc, serialize, type Doc } from '../../model/doc.ts';
import { planInsert, type InsertPlan } from '../../model/insert.ts';
import { insertMarkup } from '../../model/space.ts';
import { Session } from '../../commands/session.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BOARD = { width: 100, height: 100 };
const AT = { x: 50, y: 50 };
const open = (text: string): Doc => {
  const p = parseDoc(text);
  if (!p.ok) throw new Error(p.error.message);
  return p.doc;
};
const DOC = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">\n  <rect id="a" x="10" y="10" width="10" height="10"/>\n</svg>\n`;
const plan = (text: string, doc = open(DOC), at = AT, board: { width: number; height: number } | null = BOARD): InsertPlan => {
  const p = planInsert(doc, text, at, board);
  if ('refused' in p) throw new Error(p.refused);
  return p;
};

test('a fragment with no <svg> is wrapped as SVG Lab wraps a paste, and lands as written in one <g>', () => {
  assert.equal(plan('<circle cx="5" cy="5" r="2"/>').markup, '<g><circle cx="5" cy="5" r="2"/></g>');
  assert.equal(plan('  <rect width="3" height="4"/>\n  <circle r="1"/>').markup, '<g>  <rect width="3" height="4"/>\n  <circle r="1"/></g>', 'every child, the whitespace too');
});

test('a file that isn’t well-formed is refused with the parser’s words, its line and its column; a root that isn’t <svg> is refused', () => {
  const bad = planInsert(open(DOC), `<svg xmlns="${SVG_NS}">\n  <rect x="1"\n</svg>`, AT, BOARD);
  assert.ok('refused' in bad && /line 3, column 1\b/.test(bad.refused) && /can’t be read/.test(bad.refused), JSON.stringify(bad));
  const wrapped = planInsert(open(DOC), '<rect>\n<circle/>', AT, BOARD);
  assert.ok('refused' in wrapped && /line 2, column/.test(wrapped.refused), `a wrapped fragment's place is in the pasted text: ${JSON.stringify(wrapped)}`);
  const html = planInsert(open(DOC), '<svg xmlns="http://www.w3.org/1999/xhtml"><p/></svg>', AT, BOARD);
  assert.ok('refused' in html && /Only SVG/.test(html.refused), JSON.stringify(html));
});

test('an id the drawing already uses gets a fresh one, and its references in the insert’s attributes follow it (url(#…) in any attribute and in style="", href, ARIA id lists, SMIL begin and end); others stay', () => {
  const p = plan(`<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><defs><linearGradient id="a"/><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><rect id="b" fill="url(#a)" clip-path="url(#c)" width="4" height="4"/><use href="#a"/></svg>`);
  assert.equal(p.renamed, 1);
  assert.ok(p.markup.includes('<linearGradient id="a-2"/>') && p.markup.includes('fill="url(#a-2)"') && p.markup.includes('href="#a-2"'), p.markup);
  assert.ok(p.markup.includes('id="c"') && p.markup.includes('url(#c)') && p.markup.includes('id="b"'), 'ids the drawing doesn’t use stay as written');
  const doc = open(`<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><linearGradient id="g"/><text id="t">x</text><rect id="r" width="1" height="1"/></svg>`);
  const q = plan(`<svg xmlns="${SVG_NS}" viewBox="0 0 24 24"><linearGradient id="g"/><text id="t">label</text><rect id="r" width="24" height="24" style="fill:url(#g)" aria-labelledby="t r"><animate id="an" attributeName="x" begin="r.click;t.end" end="t.begin" dur="1s"/></rect></svg>`, doc);
  assert.equal(q.renamed, 3);
  for (const want of ['id="g-2"', 'id="t-2"', 'id="r-2"', 'style="fill:url(#g-2)"', 'aria-labelledby="t-2 r-2"', 'begin="r-2.click;t-2.end"', 'end="t-2.begin"', 'id="an"']) assert.ok(q.markup.includes(want), `${want} in ${q.markup}`);
});

test('a <style> the insert brings is kept, and a renamed id’s url(#…) and #id selectors in it follow; strings, comments and colours stay as written', () => {
  const doc = open(`<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><linearGradient id="g"/><rect id="r" class="st0" width="1" height="1"/><style>.st0{fill:#264653}</style></svg>`);
  const css = `#r{fill:url(#g)} .k{stroke:url( "#g" )} .a #r:hover,:is(#g){fill:#g} .k:not(#r) { #g { opacity: .5 } } /* #r url(#g) */ [data-x="#r"]::after{content:"url(#g)"}`;
  const p = plan(`<svg xmlns="${SVG_NS}" viewBox="0 0 24 24"><style>${css}</style><linearGradient id="g"/><rect id="r" class="k st0" width="24" height="24"/></svg>`, doc);
  assert.equal(p.renamed, 2);
  const want = `#r-2{fill:url(#g-2)} .k{stroke:url( "#g-2" )} .a #r-2:hover,:is(#g-2){fill:#g} .k:not(#r-2) { #g-2 { opacity: .5 } } /* #r url(#g) */ [data-x="#r"]::after{content:"url(#g)"}`;
  assert.ok(p.markup.includes(`<style>${want}</style>`), p.markup);
  const cdata = plan(`<svg xmlns="${SVG_NS}"><style><![CDATA[#r > rect{fill:url(#g)}]]></style><rect id="r"/></svg>`, doc);
  assert.ok(cdata.markup.includes('<style><![CDATA[#r-2 > rect{fill:url(#g)}]]></style>'), `a CDATA section too, and only mapped ids: ${cdata.markup}`);
  const escaped = plan(`<svg xmlns="${SVG_NS}"><style>#\\72 {fill:url(#\\67)} a&gt;#r{}</style><rect id="r"/><path id="g"/></svg>`, doc);
  assert.ok(escaped.markup.includes('<style>#r-2{fill:url(#g-2)} a>#r-2{}</style>'), `an escaped id is read as CSS reads it, and text with a reference is written decoded and escaped: ${escaped.markup}`);
});

test('the <g> takes the root’s attributes but its namespace declarations, id, size, place, viewBox, preserveAspectRatio, version and baseProfile', () => {
  const p = plan(`<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" id="icon" version="1.1" baseProfile="full" x="1" y="2" width="24" height="24" viewBox="0 0 24 24" preserveAspectRatio="xMinYMin" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide"><path d="M4 4h16"/><use xlink:href="#x"/></svg>`);
  const g = /^<g[^>]*>/.exec(p.markup)![0];
  assert.equal(g, '<g xmlns:xlink="http://www.w3.org/1999/xlink" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide" transform="translate(38 38)">');
  const bound = plan(`<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#x"/></svg>`, open(`<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"/>`));
  assert.equal(bound.markup, '<g><use xlink:href="#x"/></g>', 'a namespace the drawing binds the same way isn’t declared again');
});

test('placement: a 24 × 24 viewBox at its own size, centred; a 2000 × 2000 one scaled down to 80% of the artboard; one the artboard’s size keeps it; the identity writes no transform', () => {
  const icon = plan(`<svg xmlns="${SVG_NS}" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0h24"/></svg>`);
  assert.ok(icon.markup.startsWith('<g transform="translate(38 38)">'), icon.markup);
  const big = plan(`<svg xmlns="${SVG_NS}" viewBox="0 0 2000 2000"><rect width="2000" height="2000"/></svg>`);
  assert.ok(big.markup.startsWith('<g transform="translate(10 10) scale(0.04)">'), big.markup);
  const same = plan(`<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><circle cx="50" cy="40" r="24"/></svg>`);
  assert.ok(same.markup.startsWith('<g>'), `the lab's 100-unit board into a 100-unit artboard at its centre: ${same.markup}`);
  const doubled = plan(`<svg xmlns="${SVG_NS}" width="48" height="48" viewBox="0 0 24 24"><path d="M0 0h24"/></svg>`);
  assert.ok(doubled.markup.startsWith('<g transform="translate(26 26) scale(2)">'), `its own size is its width and height: ${doubled.markup}`);
  const small = plan(`<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`, open(DOC), AT, { width: 5000, height: 5000 });
  assert.ok(small.markup.startsWith('<g transform="translate(45 45)">'), `a small one is never scaled up: ${small.markup}`);
  const moved = plan(`<svg xmlns="${SVG_NS}" viewBox="0 0 10 10" transform="rotate(5)"><rect width="10" height="10"/></svg>`);
  assert.ok(moved.markup.startsWith('<g transform="translate(45 45) rotate(5)">'), `a root's own transform comes after the placement: ${moved.markup}`);
});

test('the plan inserts as one transaction that undo takes back, within what the drawing has left of its limits', () => {
  const doc = open(DOC);
  const s = new Session(doc);
  const p = plan(`<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><circle cx="50" cy="40" r="24"/></svg>`, doc);
  s.dispatch('Insert', (apply) => insertMarkup(doc, { last: doc.root }, p.markup, apply));
  assert.equal(serialize(doc), DOC.replace('</svg>', '  <g><circle cx="50" cy="40" r="24"/></g>\n</svg>'));
  s.undo();
  assert.equal(serialize(doc), DOC);
  // 255 nested groups parse alone (depth 256) but not inside the drawing's root and the insert's <g>.
  const deep = `<svg xmlns="${SVG_NS}">${'<g>'.repeat(255)}${'</g>'.repeat(255)}</svg>`;
  const d = plan(deep, doc);
  assert.throws(() => s.dispatch('Insert', (apply) => insertMarkup(doc, { last: doc.root }, d.markup, apply)), /nest deeper than 256/);
  assert.equal(serialize(doc), DOC, 'nothing written');
});
