// Draw's own state (engine/model/draw-state.ts): guides and the grid step in one <draw:state> in the
// file's single <metadata>, declared once on the root, and stripped from the As-is export, Copy and
// the Clean export, byte for byte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDoc, serialize, type Doc } from '../model/doc.ts';
import { Session } from '../commands/session.ts';
import { DRAW_NS, moveGuide, readState, stripDrawState, writeState, type DrawState } from '../model/draw-state.ts';
import { cleanExport } from '../export/clean.ts';

const CORPUS = fileURLToPath(new URL('./fixtures/corpus/', import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.svg') ? [join(dir, e.name)] : []));
const corpus = walk(CORPUS).sort().map((p) => ({ name: relative(CORPUS, p), text: readFileSync(p, 'utf8') }));
const load = (text: string): Doc => {
  const r = parseDoc(text);
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.doc;
};
const state = (guides: DrawState['guides'], grid: number | null = null): DrawState => ({ guides, grid });
const put = (s: Session, label: string, next: DrawState) => s.dispatch(label, (apply) => writeState(s.doc, next, apply));

const PLAIN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="20" height="20"/>
  <circle cx="60" cy="60" r="10"/>
</svg>
`;

test('the first guide in a file with no <metadata> declares the namespace on the root and adds a marked <metadata> with <draw:state>, and nothing else; its removal gives the bytes back; one undo each way', () => {
  const s = new Session(load(PLAIN));
  put(s, 'Add guide', state([{ axis: 'v', at: 40 }]));
  const text = serialize(s.doc);
  assert.equal(text, PLAIN.replace('viewBox="0 0 100 100">\n', `viewBox="0 0 100 100" xmlns:draw="${DRAW_NS}">\n  <metadata draw:made="true"><draw:state version="1" guides="v 40"/></metadata>\n`));
  assert.deepEqual(readState(s.doc), state([{ axis: 'v', at: 40 }]));
  assert.ok(parseDoc(text).ok, 'the strict parser takes it: every draw: prefix is bound');
  s.undo();
  assert.equal(serialize(s.doc), PLAIN, 'one undo');
  s.redo();
  put(s, 'Remove guide', state([]));
  assert.equal(serialize(s.doc), PLAIN, 'removing the last guide gives the file back byte for byte');
  s.undo();
  assert.equal(serialize(s.doc), text);
  // More guides and a grid step: the same one element, its attributes rewritten.
  put(s, 'Add guide', state([{ axis: 'v', at: 40 }, { axis: 'h', at: 25 }], 10));
  assert.match(serialize(s.doc), /<draw:state version="1" guides="v 40 h 25" grid="10"\/>/);
  // Moving a guide rewrites only its number.
  s.dispatch('Move guide', (apply) => moveGuide(s.doc, 1, 30, 0, apply));
  assert.match(serialize(s.doc), /guides="v 40 h 30"/);
  put(s, 'Remove all guides', state([]));
  assert.equal(serialize(s.doc), PLAIN, 'guides and step gone: the file again');
});

test('a file with a <metadata> keeps Draw\'s state in it, never a second one (the five corpus files that have one; a self-closing <metadata/> counts as none)', () => {
  const withMeta = corpus.filter((f) => /<metadata\b/.test(f.text));
  assert.equal(withMeta.length, 5);
  for (const f of withMeta) {
    const s = new Session(load(f.text));
    put(s, 'Add guide', state([{ axis: 'h', at: 12.5 }]));
    const text = serialize(s.doc);
    const own = !/<metadata\b[^>]*\/>/.test(f.text);
    assert.equal((text.match(/<metadata\b/g) ?? []).length, own ? 1 : 2, `${f.name}: ${own ? 'its own <metadata> only' : 'a self-closing one stays as it is'}`);
    assert.equal(text.includes('draw:made'), !own, `${f.name}: ${own ? "the file's own <metadata> is used" : 'Draw adds its own, marked'}`);
    assert.ok(parseDoc(text).ok, `${f.name}: re-parses`);
    assert.deepEqual(readState(s.doc), state([{ axis: 'h', at: 12.5 }]));
    put(s, 'Remove guide', state([]));
    assert.equal(serialize(s.doc), f.text, `${f.name}: removing it gives the bytes back`);
  }
});

test('a draw prefix bound to another namespace makes Draw declare draw1', () => {
  const taken = PLAIN.replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:draw="urn:example:other"');
  const s = new Session(load(taken));
  put(s, 'Add guide', state([{ axis: 'v', at: 5 }]));
  const text = serialize(s.doc);
  assert.ok(text.includes(`xmlns:draw1="${DRAW_NS}"`) && text.includes('<draw1:state'), text);
  assert.ok(parseDoc(text).ok);
  assert.deepEqual(readState(load(text)), state([{ axis: 'v', at: 5 }]));
});

test('stripDrawState gives every corpus file back byte for byte, with Draw state added or as it is', () => {
  let n = 0;
  for (const f of corpus) {
    const doc = load(f.text);
    assert.equal(stripDrawState(doc), serialize(doc), `${f.name}: no Draw state, the file itself`);
    const s = new Session(doc);
    try {
      put(s, 'Add guide', state([{ axis: 'v', at: 1 }, { axis: 'h', at: 2 }], 5));
    } catch {
      continue; // a file whose root the fragment parser can't take a child under (a refused root)
    }
    n++;
    assert.notEqual(serialize(s.doc), f.text);
    assert.equal(stripDrawState(s.doc), f.text, `${f.name}: stripped of Draw state, the original bytes`);
  }
  assert.ok(n >= 250, `${n} corpus files took Draw state`);
});

test('cleanExport of a file with Draw state has no Draw namespace, no Draw-made <metadata> and no xmlns:draw, and is otherwise what it was before', () => {
  for (const f of corpus.filter((x) => x.name.startsWith('tools/'))) {
    const before = cleanExport(load(f.text)).text;
    const s = new Session(load(f.text));
    put(s, 'Add guide', state([{ axis: 'v', at: 3 }]));
    const after = cleanExport(s.doc).text;
    assert.ok(!after.includes(DRAW_NS) && !after.includes('draw:made') && !after.includes('xmlns:draw'), f.name);
    assert.equal(after, before, `${f.name}: otherwise the clean export it was`);
  }
});
