// engine/text/space.ts: the characters a <text> lays out, run by run, under the nearest xml:space
// (SVG 1.1: default drops newlines, makes tabs spaces, trims the whole text's ends and collapses runs
// of spaces across runs; preserve makes newlines and tabs spaces and keeps every space).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descendants, parseDoc, type Doc, type ElementNode } from '../../model/doc.ts';
import { preserves, renderedText, textRuns } from '../../text/space.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const texts = (doc: Doc): ElementNode[] => [...descendants(doc, doc.root)].filter((n): n is ElementNode => n.kind === 'element' && n.local === 'text');
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;

test('tools/edge-text-xml-space-tspans.svg: its first text (preserve) keeps both spaces and makes the tab and the newline spaces; its second (default) collapses its runs of spaces', () => {
  const doc = load(readFileSync(new URL('../fixtures/corpus/tools/edge-text-xml-space-tspans.svg', import.meta.url), 'utf8'));
  const [first, second] = texts(doc);
  assert.equal(renderedText(doc, first.id), 'Two  spaces, a tab, and a newline kept.');
  assert.equal(renderedText(doc, second.id), 'Collapsed by default');
  assert.equal(preserves(doc, first.id), true);
  assert.equal(preserves(doc, second.id), false);
});

test('default: newlines dropped, tabs as spaces, the whole text’s ends trimmed, runs of spaces collapsed across runs; each run keeps its own element', () => {
  const doc = load(svg('<text id="t">  lead  and\ttab  <tspan id="s"> b</tspan>  c\nd  </text><text id="u"><title>no</title>Hi<desc>nor</desc></text>'));
  const [t, u] = texts(doc);
  assert.equal(renderedText(doc, t.id), 'lead and tab b cd');
  const runs = textRuns(doc, t.id);
  assert.deepEqual(runs.map((r) => r.text), ['lead and tab ', 'b', ' cd']);
  assert.equal(runs[1].owner, [...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.local === 'tspan')!.id, 'a tspan’s run is its own');
  assert.equal(renderedText(doc, u.id), 'Hi', 'a <title> or <desc> lays nothing out');
  const blank = load(svg('<text>   </text>'));
  assert.equal(renderedText(blank, texts(blank)[0].id), '', 'only spaces: nothing');
});

test('preserve: newlines and tabs as spaces and every space kept, inherited from an ancestor and switched back by a nearer xml:space', () => {
  const doc = load(svg('<g xml:space="preserve"><text> a\n\tb  </text><text>x<tspan xml:space="default">  y  </tspan>z</text></g><text>p<tspan xml:space="preserve">  q  </tspan>r</text>'));
  const [a, b, c] = texts(doc);
  assert.equal(renderedText(doc, a.id), ' a  b  ', 'inherited from the <g>: nothing trimmed');
  assert.equal(renderedText(doc, b.id), 'x y z', 'a tspan back under default collapses its own spaces');
  assert.equal(renderedText(doc, c.id), 'p  q  r', 'a preserved run between default ones');
});
