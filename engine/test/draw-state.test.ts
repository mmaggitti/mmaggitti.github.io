// Draw's own state (engine/model/draw-state.ts): guides and the grid step in one <draw:state> in the
// file's single <metadata>, declared once on the root, and stripped from the As-is export, Copy and
// the Clean export, byte for byte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDoc, serialize, type Doc } from '../model/doc.ts';
import { DEFAULT_LIMITS } from '../xml/cst.ts';
import { Session } from '../commands/session.ts';
import { DRAW_NS, MAX_GUIDES, moveGuide, readState, stripDrawState, writeState, type DrawState } from '../model/draw-state.ts';
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

test('stripDrawState of a file with no Draw state is the file itself: it never parses it again (a document read past the default limits still copies)', () => {
  const deep = `<svg xmlns="http://www.w3.org/2000/svg">${'<g>'.repeat(300)}${'</g>'.repeat(300)}</svg>`;
  const r = parseDoc(deep, { ...DEFAULT_LIMITS, maxDepth: 400 });
  assert.ok(r.ok, 'test setup: read with a deeper limit');
  assert.equal(stripDrawState(r.doc), deep);
});

test('only Draw’s own empty <metadata> is taken away: a shape marked draw:made, a draw:made that isn’t exactly "true", and a <metadata> holding text or a comment keep their bytes (As-is, Clean, and a removal of Draw’s state)', () => {
  const NS = `xmlns="http://www.w3.org/2000/svg" xmlns:draw="${DRAW_NS}"`;
  const svg = (body: string) => `<svg ${NS} viewBox="0 0 100 100">\n  ${body}\n  <rect x="10" y="10" width="10" height="10"/>\n</svg>`;
  const plain = (text: string) => text.replace(` xmlns:draw="${DRAW_NS}"`, '');
  // Elements other than <metadata>, and a value other than "true": only the draw: attribute goes.
  for (const el of ['<path draw:made="true" d="M0 0L50 50" stroke="red"/>', '<text draw:made="no" x="5" y="50">Hello</text>', '<metadata draw:made="yes"></metadata>']) {
    const doc = load(svg(el));
    const kept = plain(svg(el.replace(/ draw:made="[^"]*"/, '')));
    assert.equal(stripDrawState(doc), kept, `As-is: ${el}`);
    assert.equal(cleanExport(doc).text, kept, `Clean: ${el}`);
  }
  // A Draw-made <metadata> holding the file's comment or text: only the mark goes.
  for (const inner of ['<!-- (c) Someone, CC-BY -->', 'Licensed CC-BY 4.0', '<![CDATA[x]]>']) {
    const doc = load(svg(`<metadata draw:made="true">${inner}</metadata>`));
    const kept = plain(svg(`<metadata>${inner}</metadata>`));
    assert.equal(stripDrawState(doc), kept, `As-is: ${inner}`);
    assert.equal(cleanExport(doc).text, kept, `Clean: ${inner}`);
  }
  // Only whitespace besides Draw's own state: it is Draw's, and goes with its whitespace.
  const own = load(svg('<metadata draw:made="true">\n    <draw:state version="1" guides="v 5"/>\n  </metadata>'));
  assert.equal(stripDrawState(own), plain(svg('')).replace('\n  \n', '\n'));
  // Removing the last guide: Draw's <draw:state> goes, and the file's text keeps the <metadata>.
  const text = svg('<metadata draw:made="true">Licensed CC-BY 4.0<draw:state version="1" guides="v 5"/></metadata>');
  const s = new Session(load(text));
  put(s, 'Remove guide', state([]));
  assert.equal(serialize(s.doc), svg('<metadata draw:made="true">Licensed CC-BY 4.0</metadata>'), 'the text stays, in its <metadata>');
  // A root with no default namespace (<svg:svg>): Draw's <metadata> is SVG's too, so it is found and taken away.
  const prefixed = `<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <svg:rect width="5" height="5"/>\n</svg:svg>`;
  const p = new Session(load(prefixed));
  put(p, 'Add guide', state([{ axis: 'h', at: 3 }]));
  assert.match(serialize(p.doc), /<svg:metadata draw:made="true"><draw:state version="1" guides="h 3"\/><\/svg:metadata>/);
  assert.deepEqual(readState(p.doc), state([{ axis: 'h', at: 3 }]), 'the state is read back');
  assert.equal(stripDrawState(p.doc), prefixed);
  put(p, 'Remove guide', state([]));
  assert.equal(serialize(p.doc), prefixed);
});

test('a state with 10⁶ guides reads its first 100 in under 50 ms, once per version; Draw’s writes keep the rest byte for byte', () => {
  const guide = (i: number) => `${i % 2 ? 'h' : 'v'} ${i % 997}`;
  const many = Array.from({ length: 1e6 }, (_, i) => guide(i)).join(' ');
  const text = PLAIN.replace('viewBox="0 0 100 100">\n', `viewBox="0 0 100 100" xmlns:draw="${DRAW_NS}">\n  <metadata draw:made="true"><draw:state version="1" guides="${many}"/></metadata>\n`);
  const doc = load(text);
  const t = performance.now();
  const s = readState(doc);
  const ms = performance.now() - t;
  assert.ok(ms < 50, `reading the state took ${ms.toFixed(0)} ms`);
  assert.equal(s.guides.length, MAX_GUIDES);
  assert.deepEqual(s.guides.slice(0, 3), [{ axis: 'v', at: 0 }, { axis: 'h', at: 1 }, { axis: 'v', at: 2 }]);
  assert.equal(s.more, 1e6 - MAX_GUIDES);
  assert.equal(readState(doc), s, 'kept for the version: the next read costs nothing');
  const guides = () => /guides="([^"]*)"/.exec(serialize(session.doc))![1];
  const session = new Session(doc);
  // Remove the first: the 101st shows in its place, and the rest is as it was.
  put(session, 'Remove guide', { ...s, guides: s.guides.slice(1) });
  assert.equal(guides(), many.slice(`${guide(0)} `.length));
  assert.equal(readState(session.doc).guides.at(-1)!.at, 100);
  // Move one: only its number changes.
  session.dispatch('Move guide', (apply) => moveGuide(session.doc, 0, 42, 0, apply));
  assert.equal(guides(), `h 42 ${many.slice(`${guide(0)} ${guide(1)} `.length)}`);
  // Remove all those shown: the rest stays, from its first guide.
  put(session, 'Remove all guides', { ...readState(session.doc), guides: [] });
  assert.equal(guides(), many.split(' ').slice(2 * (MAX_GUIDES + 1)).join(' '));
  session.undo();
  session.undo();
  session.undo();
  assert.equal(serialize(session.doc), text, 'and each undoes to the file');
});
