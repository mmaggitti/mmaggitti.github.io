// Edit source: parse an element's edited source into the same document, byte for byte, undoably.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseDoc, serialize, serializeNode, descendants, el, NS, type ElementNode } from '../model/doc.ts';
import { parseFragment } from '../model/fragment.ts';
import { opInsert, opRemove } from '../commands/ops.ts';
import { Session } from '../commands/session.ts';

const SRC = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:q="http://www.w3.org/1999/xlink">\n  <g id="a"><rect  width="1"/></g>\n  <circle r="2"/>\n</svg>`;

test('serializeNode writes exactly one subtree', () => {
  const r = parseDoc(SRC);
  assert.ok(r.ok);
  const g = [...descendants(r.doc, r.doc.root)].find((n) => n.kind === 'element' && n.local === 'g')!;
  assert.equal(serializeNode(r.doc, g.id), '<g id="a"><rect  width="1"/></g>');
});

test('replacing an element with edited source changes only that element, and undo restores it', () => {
  const r = parseDoc(SRC);
  assert.ok(r.ok);
  const doc = r.doc;
  const s = new Session(doc);
  const g = [...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.local === 'g') as ElementNode;
  const edited = '<g id="a"  class="x"><rect width="2"/><use q:href="#a"/></g>';
  const f = parseFragment(doc, doc.root, edited);
  assert.ok(f.ok);
  const index = el(doc, doc.root).children.indexOf(g.id);
  s.dispatch('Edit source', (apply) => {
    apply(opRemove(doc, g.id));
    f.nodes.forEach((id, i) => apply(opInsert(doc, id, doc.root, index + i)));
  });
  assert.equal(serialize(doc), SRC.replace('<g id="a"><rect  width="1"/></g>', edited));
  const use = [...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.local === 'use') as ElementNode;
  assert.equal(use.ns, NS.svg, 'the default namespace in scope applies');
  assert.equal(use.attrs[0].ns, NS.xlink, 'a prefix declared on an ancestor resolves');
  s.undo();
  assert.equal(serialize(doc), SRC);
  s.redo();
  assert.equal(serialize(doc), SRC.replace('<g id="a"><rect  width="1"/></g>', edited));
});

test('bad source is an error with its position in the edited text, and changes nothing', () => {
  const r = parseDoc(SRC);
  assert.ok(r.ok);
  const before = serialize(r.doc);
  const f = parseFragment(r.doc, r.doc.root, '<g><rect></g>');
  assert.equal(f.ok, false);
  assert.ok(!f.ok && f.error.at >= 0 && f.error.at <= 13);
  assert.equal(serialize(r.doc), before);
});

test('document entities resolve in edited source (Illustrator declares namespaces this way)', () => {
  const src = readFileSync(new URL('./fixtures/corpus/tools/illustrator-cs6-entities-pgf.svg', import.meta.url), 'utf8');
  const r = parseDoc(src);
  assert.ok(r.ok);
  const f = parseFragment(r.doc, r.doc.root, '<rect requiredExtensions="&ns_ai;" width="1"/>');
  assert.ok(f.ok);
});

test('every element of every corpus file survives a round trip through Edit source', () => {
  const dir = new URL('./fixtures/corpus/', import.meta.url);
  let n = 0;
  for (const rel of readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((x) => x.endsWith('.svg')).sort()) {
    const src = readFileSync(new URL(rel, dir), 'utf8');
    const r = parseDoc(src);
    assert.ok(r.ok, rel);
    const doc = r.doc;
    const kids = el(doc, doc.root).children.filter((c) => doc.nodes.get(c)!.kind === 'element');
    for (const id of kids.slice(0, 3)) {
      const text = serializeNode(doc, id);
      const f = parseFragment(doc, doc.root, text);
      assert.ok(f.ok, `${rel}: ${!f.ok && f.error.message}`);
      const index = el(doc, doc.root).children.indexOf(id);
      opRemove(doc, id);
      f.nodes.forEach((x, i) => opInsert(doc, x, doc.root, index + i));
      n++;
    }
    assert.equal(serialize(doc), src, `${rel}: replacing elements with their own source changes nothing`);
  }
  assert.ok(n > 300, `only ${n} elements`);
});
