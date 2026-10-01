// engine/text/lines.ts: the lines model. What readLines accepts and refuses, exactly as the module's
// header lists them; planLines writing one line and three in SVG Lab's spelling with nothing between the
// tspans; escaping; a character XML can't hold refused; one undo giving the bytes back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, serialize, type Doc, type ElementNode } from '../../model/doc.ts';
import { Session } from '../../commands/session.ts';
import { TokenEditError } from '../../code/edit.ts';
import { NO_X, NOT_LINES, linesError, planLines, readLines } from '../../text/lines.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const text = (doc: Doc): ElementNode => [...descendants(doc, doc.root)].find((n): n is ElementNode => n.kind === 'element' && n.local === 'text')!;
const lines = (body: string) => {
  const doc = load(svg(body));
  return readLines(doc, text(doc).id);
};
const L2 = '<tspan x="50" dy="0em">Big</tspan><tspan x="50" dy="1.3em">Idea</tspan>';

test('readLines accepts an empty text, one text node with no line break, and Draw’s line tspans (each empty or one text node, x the text’s own single x, dy 0em then 1.3em, nothing between them)', () => {
  assert.deepEqual(lines('<text x="5" y="5"/>'), ['']);
  assert.deepEqual(lines('<text x="5" y="5"></text>'), ['']);
  assert.deepEqual(lines('<text x="5" y="5">Hello</text>'), ['Hello']);
  assert.deepEqual(lines('<text>Fish &amp; chips &lt;3 ]]&gt;</text>'), ['Fish & chips <3 ]]>'], 'the references P0’s Text sheet writes');
  assert.deepEqual(lines(`<text x="50" y="55">${L2}</text>`), ['Big', 'Idea']);
  assert.deepEqual(lines('<text x="50" y="55"><tspan x="50" dy="0em">A</tspan><tspan x="50" dy="1.3em"></tspan><tspan x="50" dy="1.3em">C</tspan></text>'), ['A', '', 'C'], 'an empty line');
  assert.deepEqual(lines('<text x="5mm" y="5"><tspan x="5mm" dy="0em">A</tspan><tspan x="5mm" dy="1.3em">B</tspan></text>'), ['A', 'B'], 'x with a unit, the same text');
});

test('readLines refuses anything else: a line break, CDATA, another reference, another element, a tspan with other attributes (SVG Lab’s Typography: fonts and fills), whitespace between the tspans, another x or dy, a position list (x, y, dx, dy or rotate), two text nodes', () => {
  assert.equal(lines('<text>a\nb</text>'), null, 'a line break');
  assert.equal(lines('<text><![CDATA[a]]></text>'), null, 'CDATA');
  assert.equal(lines('<text>a&#38;b</text>'), null, 'a character reference Draw would respell');
  assert.equal(lines('<text>a&gt;b</text>'), null, 'a &gt; Draw wouldn’t write back');
  assert.equal(lines('<text x="50"><tspan x="50" dy="0em">A</tspan><tspan x="50" dy="1.3em" fill="red">B</tspan></text>'), null, 'a tspan with a fill');
  assert.equal(lines('<text x="50"><tspan x="50" dy="0em" font-size="14">A</tspan></text>'), null, 'a tspan with a font');
  assert.equal(lines('<text x="50"><tspan x="50" dy="0em">A</tspan> <tspan x="50" dy="1.3em">B</tspan></text>'), null, 'a space between the tspans');
  assert.equal(lines('<text x="50"><tspan dy="0em" x="50">A</tspan></text>'), null, 'dy before x');
  assert.equal(lines('<text x="50"><tspan x="40" dy="0em">A</tspan></text>'), null, 'another x');
  assert.equal(lines('<text x="50"><tspan x="50" dy="1em">A</tspan></text>'), null, 'another dy');
  assert.equal(lines('<text x="50"><tspan x="50" dy="0em">A</tspan><tspan x="50" dy="0em">B</tspan></text>'), null, 'a second line’s dy 0em');
  assert.equal(lines('<text x="10 20"><tspan x="10 20" dy="0em">A</tspan></text>'), null, 'an x list');
  assert.equal(lines('<text x="10 20 30" y="9">ABC</text>'), null, 'an x list on one line: it places each character');
  assert.equal(lines('<text x="1" y="9" rotate="0 10">AB</text>'), null, 'a rotate list');
  assert.deepEqual(lines('<text x="1" y="9" dx="2">AB</text>'), ['AB'], 'one dx is no list');
  assert.equal(lines('<text><tspan x="50" dy="0em">A</tspan></text>'), null, 'no x of its own');
  assert.equal(lines('<text x="50"><tspan x="50" dy="0em">A<!--c--></tspan></text>'), null, 'two nodes in a line');
  assert.equal(lines('<text x="50"><tspan x="50" dy="0em"><tspan>A</tspan></tspan></text>'), null, 'a nested tspan');
  assert.equal(lines('<text x="50">A<tspan x="50" dy="0em">B</tspan></text>'), null, 'text beside a tspan');
  const ent = load('<!DOCTYPE svg [<!ENTITY b "brand">]><svg xmlns="http://www.w3.org/2000/svg"><text>&b;</text></svg>');
  assert.equal(readLines(ent, text(ent).id), null, 'an entity Draw can’t write back');
});

/** planLines in one transaction; the file after, and one undo’s. */
function write(body: string, next: string[]) {
  const doc = load(svg(body));
  const s = new Session(doc);
  s.dispatch('Edit text', (apply) => planLines(doc, text(doc).id, next, apply));
  const out = serialize(doc);
  s.undo();
  assert.equal(serialize(doc), svg(body), 'one undo gives the bytes back');
  return out;
}

test('planLines: one line is one text node (the node kept), two or more are SVG Lab’s tspans at the text’s own x with nothing between them; the text’s own attributes stay; an empty field leaves the text empty', () => {
  const hello = '<text x="50" y="55" font-size="14" text-anchor="middle">Hello</text>';
  assert.equal(write(hello, ['Hi']), svg('<text x="50" y="55" font-size="14" text-anchor="middle">Hi</text>'));
  assert.equal(write(hello, ['Big', 'Idea']), svg(`<text x="50" y="55" font-size="14" text-anchor="middle">${L2}</text>`));
  assert.equal(write(hello, ['One', 'Two', 'Three']), svg('<text x="50" y="55" font-size="14" text-anchor="middle"><tspan x="50" dy="0em">One</tspan><tspan x="50" dy="1.3em">Two</tspan><tspan x="50" dy="1.3em">Three</tspan></text>'));
  assert.equal(write(`<text x="50" y="55">${L2}</text>`, ['Big Idea']), svg('<text x="50" y="55">Big Idea</text>'), 'back to one line');
  assert.equal(write(hello, ['']), svg('<text x="50" y="55" font-size="14" text-anchor="middle"></text>'), 'empty: the element stays');
  assert.equal(write('<text x="5" y="5"></text>', ['A']), svg('<text x="5" y="5">A</text>'));
  const prefixed = '<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><s:text x="9" y="9">a</s:text></s:svg>';
  const doc = load(prefixed);
  new Session(doc).dispatch('t', (apply) => planLines(doc, text(doc).id, ['a', 'b'], apply));
  assert.equal(serialize(doc), '<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><s:text x="9" y="9"><s:tspan x="9" dy="0em">a</s:tspan><s:tspan x="9" dy="1.3em">b</s:tspan></s:text></s:svg>', 'the text’s own prefix');
});

test('planLines escapes each line as P0’s Text sheet does, refuses a character XML can’t hold (P0’s words) and lines in a text Draw doesn’t edit as lines, and writes nothing for the lines it holds now', () => {
  assert.equal(write('<text x="1" y="1">a</text>', ['Fish & <chips> ]]>', 'x']), svg('<text x="1" y="1"><tspan x="1" dy="0em">Fish &amp; &lt;chips> ]]&gt;</tspan><tspan x="1" dy="1.3em">x</tspan></text>'));
  const doc = load(svg('<text x="1" y="1">a</text>'));
  assert.equal(linesError(doc, text(doc).id, ['a￾b']), 'XML can\'t hold the character U+FFFE');
  assert.throws(() => planLines(doc, text(doc).id, ['￾'], () => assert.fail('nothing is written')), TokenEditError);
  const none = load(svg('<text y="1">a</text>'));
  assert.equal(linesError(none, text(none).id, ['a', 'b']), NO_X, 'two lines need the text’s own x');
  assert.equal(linesError(none, text(none).id, ['b']), null, 'one line doesn’t');
  const lab = load(svg('<text x="50"><tspan x="50" dy="0em" fill="red">A</tspan></text>'));
  assert.equal(linesError(lab, text(lab).id, ['A']), NOT_LINES);
  const same = load(svg('<text x="1" y="1">a</text>'));
  let ops = 0;
  planLines(same, text(same).id, ['a'], () => ops++);
  assert.equal(ops, 0, 'the lines it holds: nothing written');
});
