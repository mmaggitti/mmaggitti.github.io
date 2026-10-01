// engine/access/speak.ts: the screen-reader preview. SVG Lab's three sentences on lab/access.svg's
// three states, exactly ("chart" made "drawing"); aria-labelledby naming two ids; stray labels from
// tspans and from text in a group; the titles note with and without role="img"; a hidden root.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descendants, parseDoc, serialize, type Doc, type ElementNode } from '../../model/doc.ts';
import { Session } from '../../commands/session.ts';
import { HIDDEN, speak, strayLabels } from '../../access/speak.ts';
import { planAria, planDrawingDesc, planDrawingTitle, planElementTitle } from '../../access/model.ts';
import { attrValue } from '../../model/doc.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const ACCESS = readFileSync(new URL('../fixtures/corpus/lab/access.svg', import.meta.url), 'utf8');
const svg = (attrs: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${body}</svg>`;

test('SVG Lab’s three sentences on lab/access.svg: its title and description; Title off; then Description off, the month labels read stray', () => {
  const doc = load(ACCESS);
  assert.equal(speak(doc), '“Monthly visitors, image. Bar chart. Visitors rose from 40 in January to 88 in April.”');
  const s = new Session(doc);
  s.dispatch('Title', (apply) => planDrawingTitle(doc, null, apply));
  assert.equal(speak(doc), '“Image. Bar chart. Visitors rose from 40 in January to 88 in April.”');
  s.dispatch('Description', (apply) => planDrawingDesc(doc, null, apply));
  assert.equal(speak(doc), 'no name, so it may skip the drawing or read stray labels: “Jan, Feb, Mar, Apr”');
  assert.equal(speak(load(svg('', '<rect width="5" height="5"/>'))), 'no name, so it may skip the drawing.');
});

test('the name: the texts aria-labelledby names, two ids joined by one space (before an aria-label or a <title>), whitespace collapsed; else the aria-label; else the <title>; the description the same way', () => {
  assert.equal(speak(load(svg(' aria-labelledby="a b" aria-label="no"', '<title>no</title><text id="a">Acme </text><text id="b">  logo\n</text>'))), '“Acme logo, image”');
  assert.equal(speak(load(svg(' aria-labelledby="missing" aria-label="Logo"', '<title>no</title>'))), '“Logo, image”', 'a reference to nothing falls through');
  assert.equal(speak(load(svg('', '<title>  Logo\n  mark </title>'))), '“Logo mark, image”');
  assert.equal(speak(load(svg(' aria-describedby="d"', '<desc>no</desc><text id="d">Bars</text>'))), '“Image. Bars”');
});

test('stray labels: every text’s characters as laid out, in document order, tspans and text in a group alike; none in <defs>; the first 20, then …', () => {
  const doc = load(svg('', '<text>A<tspan> and</tspan><tspan> B</tspan></text><g><g><text>C</text></g></g><defs><text>hidden</text></defs><text>  </text>'));
  assert.deepEqual(strayLabels(doc), ['A and B', 'C']);
  assert.equal(speak(doc), 'no name, so it may skip the drawing or read stray labels: “A and B, C”');
  const many = load(svg('', Array.from({ length: 22 }, (_, i) => `<text>${i}</text>`).join('')));
  assert.equal(speak(many), `no name, so it may skip the drawing or read stray labels: “${Array.from({ length: 20 }, (_, i) => i).join(', ')}, …”`);
});

test('the titles note: a shape’s own <title> shows as a tooltip, which role="img" hides from screen readers; without that role, the short sentence', () => {
  const doc = load(ACCESS);
  new Session(doc).dispatch('t', (apply) => planElementTitle(doc, [...descendants(doc, doc.root)].find((n): n is ElementNode => n.kind === 'element' && n.local === 'rect')!.id, 'Jan: 40', apply));
  assert.match(serialize(doc), /<title>Jan: 40<\/title><\/rect>/);
  assert.equal(speak(doc), '“Monthly visitors, image. Bar chart. Visitors rose from 40 in January to 88 in April.” Titles on shapes show as tooltips on hover, but role="img" hides them from screen readers.');
  assert.equal(speak(load(svg('', '<text>Jan</text><rect><title>Jan: 40</title></rect>'))), 'no name, so it may skip the drawing or read stray labels: “Jan” Titles on shapes show as tooltips on hover.');
});

test('a hidden root says only that it is hidden', () => {
  assert.equal(speak(load(svg(' aria-hidden="true" role="img"', '<title>Logo</title>'))), HIDDEN);
  assert.equal(HIDDEN, 'hidden from screen readers.');
});

test('the preview never reads what a reader never reaches: a text the Access tab hid (aria-hidden="true"), a group hidden so, and the contents of <defs>, <symbol>, <clipPath>, <mask>, <marker> and <pattern>, neither as stray labels nor for the titles note', () => {
  const doc = load(svg(' viewBox="0 0 100 40"', '<defs><symbol id="s"><text x="1" y="9">InSymbol</text></symbol><clipPath id="c"><text x="1" y="9">InClip</text></clipPath></defs><mask id="m"><text x="1" y="9">InMask</text></mask><marker id="k"><text x="1" y="9">InMarker</text></marker><pattern id="p"><text x="1" y="9">InPattern</text></pattern><text id="a" x="1" y="20">Visible</text><text id="b" x="1" y="30">Decoration</text><g aria-hidden="true"><text x="1" y="39">HiddenGroup</text></g>'));
  assert.deepEqual(strayLabels(doc), ['Visible', 'Decoration']);
  const b = [...descendants(doc, doc.root)].find((n): n is ElementNode => n.kind === 'element' && attrValue(doc, n, null, 'id') === 'b')!;
  new Session(doc).dispatch('Hidden from screen readers', (apply) => planAria(doc, b.id, 'aria-hidden', 'true', apply));
  assert.match(serialize(doc), /<text id="b" x="1" y="30" aria-hidden="true">Decoration<\/text>/, 'the Access tab’s own switch');
  assert.equal(speak(doc), 'no name, so it may skip the drawing or read stray labels: “Visible”');
  const titled = (body: string) => speak(load(svg('', `<text>Hi</text>${body}`)));
  for (const body of ['<mask id="m"><rect><title>t</title></rect></mask>', '<g aria-hidden="true"><rect><title>t</title></rect></g>', '<rect aria-hidden="true"><title>t</title></rect>', '<defs><rect id="r"><title>t</title></rect></defs>', '<pattern id="p"><rect><title>t</title></rect></pattern>']) {
    assert.equal(titled(body), 'no name, so it may skip the drawing or read stray labels: “Hi”', body);
  }
  assert.equal(titled('<rect><title>t</title></rect>'), 'no name, so it may skip the drawing or read stray labels: “Hi” Titles on shapes show as tooltips on hover.');
});
