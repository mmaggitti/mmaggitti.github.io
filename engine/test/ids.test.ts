// engine/model/ids: fresh ids for copies, and renames that carry every reference inside a subtree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { NS, descendants, el, parseDoc, serialize, serializeNode, type Attr, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { parseFragment } from '../model/fragment.ts';
import { buildRefIndex, duplicateIds } from '../model/refs.ts';
import { freshId, idsInUse, renameIdsIn } from '../model/ids.ts';
import { opInsert } from '../commands/ops.ts';
import { Session } from '../commands/session.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.doc;
};
const byId = (doc: Doc, id: string): NodeId => ([...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === id)) as ElementNode).id;

test('freshId never reuses an id, and reserves across one batch', () => {
  const doc = load('<svg xmlns="http://www.w3.org/2000/svg"><rect id="a"/><rect id="a-2"/><rect xml:id="b"/></svg>');
  assert.equal(freshId(doc, 'c'), 'c', 'an unused base is itself');
  assert.equal(freshId(doc, 'a'), 'a-3', 'a and a-2 are taken');
  assert.equal(freshId(doc, 'b'), 'b-2', 'xml:id counts');
  const taken = new Set<string>();
  for (let i = 0; i < 3; i++) taken.add(freshId(doc, 'a', taken));
  assert.deepEqual([...taken], ['a-3', 'a-4', 'a-5'], 'one batch reserves several');
});

test('renameIdsIn rewrites ids and references inside the subtree only, byte-local, and undoes exactly', () => {
  const src = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs><linearGradient id="grad"/></defs>
  <g id="badge"><clipPath id="clip"><rect/></clipPath>
    <rect id="face" clip-path="url(#clip)" style="fill:url(#grad);  stroke: url( '#clip' )" aria-labelledby="t  face"/>
    <use xlink:href="#face"/><animate id="go" begin="face.click; clip.end+1s" end=" go.end"/><text id="t">Hi</text></g>
  <rect clip-path="url(#clip)"/><use href="#face"/>
</svg>`;
  const doc = load(src);
  const s = new Session(doc);
  const g = byId(doc, 'badge');
  const map = new Map([['badge', 'badge-2'], ['clip', 'clip-2'], ['face', 'face-2'], ['go', 'go-2'], ['t', 't-2']]);
  s.dispatch('Rename', (apply) => renameIdsIn(doc, g, map, apply));
  const want = src
    .replace('id="badge"', 'id="badge-2"').replace('id="clip"', 'id="clip-2"')
    .replace('<rect id="face" clip-path="url(#clip)" style="fill:url(#grad);  stroke: url( \'#clip\' )" aria-labelledby="t  face"/>', '<rect id="face-2" clip-path="url(#clip-2)" style="fill:url(#grad);  stroke: url( \'#clip-2\' )" aria-labelledby="t-2  face-2"/>')
    .replace('<use xlink:href="#face"/><animate id="go" begin="face.click; clip.end+1s" end=" go.end"/><text id="t">', '<use xlink:href="#face-2"/><animate id="go-2" begin="face-2.click; clip-2.end+1s" end=" go-2.end"/><text id="t-2">');
  assert.equal(serialize(doc), want, 'every byte but the ids’ own');
  assert.ok(serialize(doc).endsWith('<rect clip-path="url(#clip)"/><use href="#face"/>\n</svg>'), 'references outside keep the originals');
  s.undo();
  assert.equal(serialize(doc), src, 'one undo restores it');
});

test('over the corpus, duplicating an element with ids and renaming them in the copy leaves no duplicate ids where there were none', () => {
  const dir = new URL('fixtures/corpus/', import.meta.url);
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.svg'));
  let copies = 0;
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    const doc0 = load(src);
    if (duplicateIds(buildRefIndex(doc0)).length) continue; // it had duplicates to begin with
    const elements = (d: Doc) => [...descendants(d, d.root)].filter((n): n is ElementNode => n.kind === 'element');
    const isId = (a: Attr) => a.local === 'id' && (a.ns === null || a.ns === NS.xml); // not serif:id
    const places = elements(doc0).flatMap((n, i) => (n.id !== doc0.root && [...descendants(doc0, n.id)].some((d) => d.kind === 'element' && d.attrs.some(isId)) ? [i] : []));
    for (const at of places.slice(0, 6)) {
      const doc = load(src);
      const node = elements(doc)[at];
      const parent = node.parent!;
      const parsed = parseFragment(doc, parent, serializeNode(doc, node.id));
      assert.ok(parsed.ok, `${f}: the copy parses`);
      const copy = parsed.nodes.find((id) => doc.nodes.get(id)!.kind === 'element')!;
      const inCopy = [...descendants(doc, copy)].flatMap((n) => (n.kind === 'element' ? n.attrs.filter(isId).map((a) => a.raw) : []));
      const taken = new Set<string>();
      const map = new Map(inCopy.map((id) => [id, freshId(doc, id, taken)] as const).map(([id, to]) => (taken.add(to), [id, to] as const)));
      new Session(doc).dispatch('Duplicate', (apply) => {
        apply(opInsert(doc, copy, parent, el(doc, parent).children.indexOf(node.id) + 1));
        renameIdsIn(doc, copy, map, apply);
      });
      assert.deepEqual(duplicateIds(buildRefIndex(doc)), [], `${f}: <${node.qname}> #${at}`);
      assert.ok(idsInUse(doc).size >= idsInUse(doc0).size + inCopy.length, `${f}: the copy has its own ids`);
      copies++;
    }
  }
  assert.ok(copies > 100, `only ${copies} copies`);
});
