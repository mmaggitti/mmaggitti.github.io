import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc } from '../model/doc.ts';
import { DEFAULT_LIMITS } from '../xml/cst.ts';
import { buildRefIndex, duplicateIds } from '../model/refs.ts';

const SRC = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:q="http://www.w3.org/1999/xlink" aria-labelledby="t d">
  <title id="t">T</title><desc id="d">D</desc>
  <defs><linearGradient id="g"/><clipPath id="c"/><circle id="dot" r="1"/></defs>
  <rect fill="url(#g)" clip-path="url( '#c' )" style="stroke:url(#g)"/>
  <use href="#dot"/><use q:href="#dot"/><use href="other.svg#x"/>
  <circle id="spin"><animate id="a2" begin="spin.click; a1.end+1s" end="indefinite"/></circle>
  <rect fill="url(#missing)"/><g id="t"/>
</svg>`;

test('ids and every kind of reference are indexed', () => {
  const r = parseDoc(SRC);
  assert.ok(r.ok);
  const idx = buildRefIndex(r.doc);
  assert.deepEqual([...idx.refs.keys()].sort(), ['a1', 'c', 'd', 'dot', 'g', 'missing', 'spin', 't'].sort());
  assert.equal(idx.refs.get('g')!.length, 2); // fill and style
  assert.deepEqual(idx.refs.get('dot')!.map((x) => x.attr), ['href', 'q:href']);
  assert.deepEqual(idx.refs.get('spin')!.map((x) => x.kind), ['smil']);
  assert.deepEqual(idx.dangling.map((x) => x.id).sort(), ['a1', 'missing']);
  assert.deepEqual(duplicateIds(idx), ['t']);
});

test('url() fragments may be quoted with spaces and are percent-decoded, as browsers match ids', () => {
  const r = parseDoc(`<svg xmlns="http://www.w3.org/2000/svg"><g id="a b"/><g id="é"/><rect fill="url('#a b')" stroke="url(#%C3%A9)"/><use href="#a%20b"/></svg>`);
  assert.ok(r.ok);
  const idx = buildRefIndex(r.doc);
  assert.deepEqual(idx.refs.get('a b')!.map((x) => x.kind).sort(), ['href', 'url']);
  assert.equal(idx.refs.get('é')!.length, 1);
  assert.deepEqual(idx.dangling, []);
});

// The dangling list is built by a loop: push(...list) passes each reference as an argument, and a
// call's arguments are capped (V8 throws a RangeError at about 120,000), so a file with that many
// references to one missing id couldn't be indexed at all (P1-M1 follow-up). The file is made here,
// not stored; the parser's node limit is raised for it (200,000 uses and the root are 200,002 nodes).
test('a file with 200,000 references to one missing id builds its reference index', () => {
  const src = `<svg xmlns="http://www.w3.org/2000/svg">${'<use href="#nope"/>'.repeat(200_000)}</svg>`;
  const r = parseDoc(src, { ...DEFAULT_LIMITS, maxNodes: 250_000 });
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  const idx = buildRefIndex(r.doc);
  assert.equal(idx.refs.get('nope')!.length, 200_000);
  assert.equal(idx.dangling.length, 200_000);
  assert.ok(idx.dangling.every((d) => d.id === 'nope' && d.kind === 'href'));
});
