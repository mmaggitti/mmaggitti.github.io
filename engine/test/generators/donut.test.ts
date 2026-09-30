// engine/generators/donut: SVG Lab's donut as a generator whose data lives in a comment. The
// acceptance test (plan §6): regenerating lab/arcs--donut.svg reproduces its paths byte for byte.
// Then recognition and its near misses, Edit as donut's candidate rule, and the finish hook's keep,
// regenerate and detach.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attrValue, descendants, el, parseDoc, serialize, serializeNode, type Doc, type ElementNode, type NodeId } from '../../model/doc.ts';
import { opInsert, opSetAttr, opSetAttrRaw, opSetLeafRaw } from '../../commands/ops.ts';
import { parseFragment } from '../../model/fragment.ts';
import { Session } from '../../commands/session.ts';
import { DRAW_NS } from '../../model/draw-ns.ts';
import { adoptDonut, detachGenerator, finishGenerators } from '../../generators/index.ts';
import { dataRaw, donutCandidate, donutCandidateFor, donutFor, donutOf, donutSlices, readData } from '../../generators/donut.ts';
import { applyPlan, planMove } from '../../geometry/write.ts';

const LAB = readFileSync(new URL('../fixtures/corpus/lab/arcs--donut.svg', import.meta.url), 'utf8');
const ATTRS = ' xmlns:draw="https://mmaggitti.github.io/draw/ns" draw:gen="donut" draw:cx="50" draw:cy="50" draw:r="28"';
const ADOPTED = LAB.replace('viewBox="0 0 100 100">', `viewBox="0 0 100 100"${ATTRS}>`);
const LAB_D = [...LAB.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]);

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const all = (doc: Doc, local: string): ElementNode[] => [...descendants(doc, doc.root)].filter((n): n is ElementNode => n.kind === 'element' && n.local === local);
const commentOf = (doc: Doc, holder: NodeId): NodeId => el(doc, holder).children.find((c) => doc.nodes.get(c)!.kind === 'comment')!;
const dsOf = (doc: Doc) => all(doc, 'path').map((p) => attrValue(doc, p, null, 'd'));
/** A Session whose finish hook is the generators', and the ids each run detached. */
const session = (doc: Doc) => {
  const detached: NodeId[][] = [];
  return { s: new Session(doc, { finish: (d, ops, apply) => void detached.push(finishGenerators(d, ops, apply)) }), detached };
};
/** A donut in a <g> of the root, generated from these values, centre and radius. */
const gDonut = (values: number[], cx: number, cy: number, r: number, attrs = ` draw:gen="donut" draw:cx="${cx}" draw:cy="${cy}" draw:r="${r}"`, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:draw="https://mmaggitti.github.io/draw/ns" viewBox="0 0 100 100">\n  <g id="d"${attrs}>\n    ${dataRaw(values)}\n${donutSlices(values, cx, cy, r).map((d, i) => `    <path d="${d}" stroke="#${i}${i}${i}" stroke-width="10" fill="none"/>\n`).join('')}${extra}  </g>\n</svg>\n`;
/** The holder written with id="d". */
const gOf = (doc: Doc): NodeId => ([...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === 'd')) as ElementNode).id;

test('the acceptance test: generating from lab/arcs--donut.svg’s comment (40, 25, 20, 15) with centre (50, 50) and r 28 gives its four paths byte for byte; Edit as donut adds only the four attributes to the root; a data edit regenerates the slices, and setting the values back gives that file back byte for byte', () => {
  assert.deepEqual(donutSlices([40, 25, 20, 15], 50, 50, 28), LAB_D, 'SVG Lab’s own export, exactly');
  assert.equal(LAB_D[0], 'M 50 22 A 28 28 0 0 1 66.5 72.7');
  const doc = load(LAB);
  assert.equal(donutOf(doc, doc.root), null, 'no draw:gen yet: plain');
  const c = donutCandidate(doc, doc.root);
  assert.deepEqual(c, { holder: doc.root, values: [40, 25, 20, 15], cx: 50, cy: 50, r: 28 });
  const { s, detached } = session(doc);
  s.dispatch('Edit as donut', (apply) => adoptDonut(doc, c!, apply));
  assert.equal(serialize(doc), ADOPTED, 'only the root’s start tag changes: the four path lines byte for byte');
  assert.deepEqual(detached.at(-1), []);
  const d = donutOf(doc, doc.root);
  assert.ok(d, 'a donut now');
  assert.deepEqual(d.values, [40, 25, 20, 15]);
  // A data edit: the slices follow in the same entry.
  const comment = commentOf(doc, doc.root);
  s.dispatch('Set data', (apply) => apply(opSetLeafRaw(doc, comment, '<!-- data: 64, 1, 20, 15 -->')));
  assert.deepEqual(dsOf(doc), donutSlices([64, 1, 20, 15], 50, 50, 28));
  assert.match(dsOf(doc)[0]!, /^M 50 22 A 28 28 0 1 1 /, 'the first slice is over half: large-arc 1');
  assert.ok(donutOf(doc, doc.root));
  s.dispatch('Set data', (apply) => apply(opSetLeafRaw(doc, comment, '<!-- data: 40, 25, 20, 15 -->')));
  assert.equal(serialize(doc), ADOPTED, 'the values set back: the file (plus the four attributes) byte for byte');
  s.undo();
  s.undo();
  assert.equal(serialize(doc), ADOPTED);
  s.undo();
  assert.equal(serialize(doc), LAB, 'one undo takes Edit as donut back');
});

test('exact halves: 50 and 50 give large-arc 0 on both slices (1 only over half); 51 and 49 give 1 then 0', () => {
  const large = (d: string) => d.split(' ')[7]; // M sx sy A R R 0 L 1 ex ey
  assert.deepEqual(donutSlices([50, 50], 50, 50, 28).map(large), ['0', '0']);
  assert.deepEqual(donutSlices([51, 49], 50, 50, 28).map(large), ['1', '0']);
  assert.deepEqual(donutSlices([50, 50], 50, 50, 28), ['M 50 22 A 28 28 0 0 1 50 78', 'M 50 78 A 28 28 0 0 1 50 22']);
});

test('the data comment is exactly “<!-- data: ” + 2 to 12 whole values from 1 to 100 joined by “, ” + “ -->”, each value’s span in its raw text', () => {
  assert.deepEqual(readData('<!-- data: 40, 25, 20, 15 -->'), { values: [40, 25, 20, 15], spans: [{ start: 11, end: 13 }, { start: 15, end: 17 }, { start: 19, end: 21 }, { start: 23, end: 25 }] });
  assert.deepEqual(readData(dataRaw([1, 100]))?.values, [1, 100]);
  assert.equal(readData(dataRaw(Array(12).fill(5)))?.values.length, 12);
  for (const raw of [
    '<!-- data: 40 -->', // one value
    dataRaw(Array(13).fill(5)), // thirteen
    '<!-- data: 0, 25 -->', '<!-- data: 101, 25 -->', '<!-- data: 4.5, 25 -->', '<!-- data: 040, 25 -->', '<!-- data: -4, 25 -->',
    '<!-- data: 40,25 -->', '<!-- data: 40, 25-->', '<!--data: 40, 25 -->', '<!-- data:  40, 25 -->', '<!-- Data: 40, 25 -->', '<!-- data: 40, 25, -->',
  ]) assert.equal(readData(raw), null, raw);
});

test('recognition: a donut only with draw:gen="donut" on a <g> or the root, valid inputs, the data comment first, one slice per value and every d exactly generated; each near miss reads as plain, and reading changes nothing', () => {
  const src = gDonut([30, 30, 40], 60, 40, 20);
  const doc = load(src);
  const d = donutOf(doc, gOf(doc));
  assert.ok(d);
  assert.deepEqual([d.values, d.cx, d.cy, d.r, d.slices.length], [[30, 30, 40], 60, 40, 20, 3]);
  assert.equal(donutFor(doc, d.slices[1])?.holder, gOf(doc), 'a slice finds its donut');
  assert.equal(serialize(doc), src, 'reading changes nothing');
  const plain = (s: string, why: string) => {
    const x = load(s);
    assert.equal(donutOf(x, gOf(x)), null, why);
  };
  const three = donutSlices([30, 30, 40], 60, 40, 20);
  plain(src.replace('<!-- data: 30, 30, 40 -->', '<!-- data: 0, 30, 40 -->'), 'a value of 0');
  plain(src.replace('<!-- data: 30, 30, 40 -->', '<!-- data: 101, 30, 40 -->'), 'a value of 101');
  plain(gDonut(Array(13).fill(5), 60, 40, 20), 'thirteen values');
  plain(src.replace(`    <path d="${three[2]}" stroke="#222" stroke-width="10" fill="none"/>\n`, ''), 'a slice count that differs');
  plain(src.replace(three[1], three[1].replace(' A ', '  A ')), 'a reformatted d');
  plain(src.replace('  </g>', '    <rect width="1" height="1"/>\n  </g>'), 'another child in the holder');
  plain(src.replace(`    ${dataRaw([30, 30, 40])}\n`, '').replace('  </g>', `    ${dataRaw([30, 30, 40])}\n  </g>`), 'the comment not first');
  plain(src.replace('draw:r="20"', 'draw:r="0"'), 'a radius of 0');
  plain(src.replace('draw:cx="60"', 'draw:cx="6e1"'), 'an input that isn’t a plain decimal');
  plain(src.replace('draw:gen="donut"', 'draw:gen="star"'), 'another generator');
  plain(src.replace('<g id="d"', '<a id="d"').replace('</g>', '</a>'), 'a holder that isn’t a <g>');
});

test('Edit as donut’s candidate: a holder without draw:gen whose first slice reads M sx sy A r r 0 L 1 ex ey and whose slices are exactly what (values, sx, sy + r, r) generate; a slice offers its holder; each near miss offers nothing', () => {
  const doc = load(LAB);
  const slice = all(doc, 'path')[2].id;
  assert.equal(donutCandidateFor(doc, slice)?.holder, doc.root, 'a selected slice offers its holder');
  const none = (s: string, why: string, holder = (x: Doc) => x.root) => {
    const x = load(s);
    assert.equal(donutCandidate(x, holder(x)), null, why);
  };
  none(LAB.replace('M 50 22 A 28 28 0 0 1 66.5 72.7', 'm 50 22 a 28 28 0 0 1 16.5 50.7'), 'a relative first slice');
  none(LAB.replace('M 50 22 A 28 28 0 0 1 66.5 72.7', 'M 50 22 A 28 28 5 0 1 66.5 72.7'), 'a rotated one');
  none(LAB.replace('M 27.3 66.5 A 28 28 0 0 1 27.3 33.5', 'M 27.3 66.5 A 28 28 0 0 1 27.3 33.6'), 'a later slice that differs from the generator’s');
  none(LAB.replace('<!-- data: 40, 25, 20, 15 -->', '<!-- data: 40, 25, 20, 16 -->'), 'values the slices don’t draw');
  none(LAB.replace('viewBox="0 0 100 100">', `viewBox="0 0 100 100" xmlns:draw="${DRAW_NS}" draw:gen="donut">`), 'a holder that already has draw:gen');
  const g = load(gDonut([30, 30, 40], 60, 40, 20, ''));
  assert.deepEqual(donutCandidate(g, gOf(g)), { holder: gOf(g), values: [30, 30, 40], cx: 60, cy: 40, r: 20 }, 'a <g> without draw:gen is a candidate too');
});

test('the finish hook: a data edit and an input edit regenerate the slices; a slice’s d edited by hand detaches the donut (its draw: attributes and the declaration gone, the comment plain); one transaction and one undo each', () => {
  const doc = load(ADOPTED);
  const { s, detached } = session(doc);
  const comment = commentOf(doc, doc.root);
  // keep: a transaction that leaves the slices what they generate
  s.dispatch('Set data', (apply) => apply(opSetLeafRaw(doc, comment, '<!-- data: 40, 25, 20, 15 -->')));
  assert.equal(serialize(doc), ADOPTED);
  // regenerate: the data
  s.dispatch('Set data', (apply) => apply(opSetLeafRaw(doc, comment, '<!-- data: 10, 20, 30, 40 -->')));
  assert.deepEqual(dsOf(doc), donutSlices([10, 20, 30, 40], 50, 50, 28));
  assert.deepEqual(detached.at(-1), []);
  s.undo();
  assert.equal(serialize(doc), ADOPTED, 'one undo');
  // regenerate: an input
  s.dispatch('Set r', (apply) => apply(opSetAttr(doc, doc.root, DRAW_NS, 'r', '30')));
  assert.deepEqual(dsOf(doc), donutSlices([40, 25, 20, 15], 50, 50, 30));
  s.undo();
  assert.equal(serialize(doc), ADOPTED);
  // detach: a slice's d by hand (a code token's scrub)
  const slice = all(doc, 'path')[1];
  s.dispatch('Scrub d', (apply) => apply(opSetAttrRaw(doc, slice.id, null, 'd', 'M 66.5 72.7 A 28 28 0 0 1 27.3 66.6')));
  assert.deepEqual(detached.at(-1), [doc.root]);
  assert.equal(serialize(doc), LAB.replace('27.3 66.5" fill="none" stroke="#2a9d8f"', '27.3 66.6" fill="none" stroke="#2a9d8f"'), 'the draw: attributes and xmlns:draw gone; the comment stays, plain');
  assert.equal(donutOf(doc, doc.root), null);
  s.undo();
  assert.equal(serialize(doc), ADOPTED, 'one undo brings the donut back');
  assert.ok(donutOf(doc, doc.root));
  // detach: the data made unreadable in the code (Edit source)
  s.dispatch('Edit source', (apply) => apply(opSetLeafRaw(doc, comment, '<!-- data: 40, 25, 20 and 15 -->')));
  assert.deepEqual(detached.at(-1), [doc.root]);
  s.undo();
  assert.equal(serialize(doc), ADOPTED);
  // Detach on purpose (Inspect's Detach)
  s.dispatch('Detach', (apply) => void detachGenerator(doc, doc.root, apply));
  assert.equal(serialize(doc), LAB);
  s.undo();
  assert.equal(serialize(doc), ADOPTED);
});

test('the finish hook leaves a donut a donut when its <g> is moved, duplicated or recoloured, and when a slice is recoloured, locked or renamed', () => {
  const src = gDonut([30, 30, 40], 60, 40, 20);
  const doc = load(src);
  const { s, detached } = session(doc);
  const g = gOf(doc);
  const ctx = { viewport: { width: 100, height: 100 }, remPx: 12 };
  const move = planMove(doc, g, 5, -3, { ctx, decimals: 2 });
  assert.ok(!('refused' in move));
  s.dispatch('Move', (apply) => applyPlan(doc, move, apply));
  assert.match(attrValue(doc, el(doc, g), null, 'transform')!, /translate/);
  assert.ok(donutOf(doc, g), 'moved');
  const slice = all(doc, 'path')[0].id;
  s.dispatch('Stroke', (apply) => apply(opSetAttr(doc, slice, null, 'stroke', '#e76f51')));
  s.dispatch('Lock', (apply) => apply(opSetAttr(doc, slice, DRAW_NS, 'locked', 'true', 'draw:locked')));
  s.dispatch('Rename', (apply) => apply(opSetAttr(doc, slice, null, 'id', 'first')));
  s.dispatch('Fill', (apply) => apply(opSetAttr(doc, g, null, 'fill', 'none')));
  assert.ok(donutOf(doc, g), 'recoloured, locked, renamed');
  // Duplicate: a copy of the <g> put in (M1 copies draw:*): a new holder, checked, and kept.
  const made = parseFragment(doc, doc.root, serializeNode(doc, g));
  assert.ok(made.ok);
  s.dispatch('Duplicate', (apply) => apply(opInsert(doc, made.nodes[0], doc.root, el(doc, doc.root).children.length)));
  assert.ok(donutOf(doc, made.nodes[0]), 'the copy is a donut');
  assert.ok(detached.every((d) => d.length === 0), 'nothing was detached');
});
