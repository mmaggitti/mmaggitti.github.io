// Edit source: parse an element's edited source into the same document, byte for byte, undoably.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseDoc, serialize, serializeNode, descendants, el, NS, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
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

// Put what a fragment parses to at the end of `scope`, as Edit source would (one transaction).
function insertAll(doc: Doc, scope: NodeId, nodes: NodeId[]): void {
  const at = el(doc, scope).children.length;
  new Session(doc).dispatch('insert', (apply) => nodes.forEach((id, i) => apply(opInsert(doc, id, scope, at + i))));
}

test('Edit source spends what the document has left of its limits, so the file always opens again', () => {
  // Entities: the file spends 600,000 of its 1,000,000 on open; each &d; costs 40,000 more.
  const ten = (n: string) => `&${n};`.repeat(10);
  const subset = `<!ENTITY a "aaaaaaaaaa"><!ENTITY b "${ten('a')}"><!ENTITY c "${ten('b')}"><!ENTITY d "${ten('c')}"><!ENTITY e "${ten('d')}"><!ENTITY f "&e;">`;
  const r = parseDoc(`<!DOCTYPE svg [${subset}]><svg xmlns="http://www.w3.org/2000/svg"><desc>&f;</desc></svg>`);
  assert.ok(r.ok);
  const doc = r.doc;
  let fitted = 0;
  for (; fitted < 20; fitted++) {
    const f = parseFragment(doc, doc.root, '<desc>&d;</desc>');
    if (!f.ok) {
      assert.match(f.error.message, /entity expansion over 1000000 characters/);
      break;
    }
    insertAll(doc, doc.root, f.nodes);
  }
  assert.equal(fitted, 10, 'ten fit in what the document had left, and the eleventh is refused');
  const again = parseDoc(serialize(doc));
  assert.ok(again.ok, `the saved file reopens: ${!again.ok && again.error.message}`);
  // Depth: from where the text goes in, not from the fragment's own top.
  const deep = parseDoc(`<svg xmlns="http://www.w3.org/2000/svg">${'<g>'.repeat(200)}${'</g>'.repeat(200)}</svg>`);
  assert.ok(deep.ok);
  let inner = deep.doc.root;
  while (el(deep.doc, inner).children.length) inner = el(deep.doc, inner).children[0]; // depth 201
  const nest = (n: number) => '<g>'.repeat(n) + '</g>'.repeat(n);
  const tooDeep = parseFragment(deep.doc, inner, nest(56));
  assert.ok(!tooDeep.ok && tooDeep.error.message === 'the document would nest deeper than 256', 'depth 257 is refused');
  const fits = parseFragment(deep.doc, inner, nest(55));
  assert.ok(fits.ok, 'depth 256 fits');
  insertAll(deep.doc, inner, fits.nodes);
  assert.ok(parseDoc(serialize(deep.doc)).ok, 'and the saved file reopens');
  // Nodes: the parser counts every node and each end tag (100,000 elements here are 199,992 tokens).
  const many = parseDoc(`<svg xmlns="http://www.w3.org/2000/svg">${'<g></g>'.repeat(99_995)}</svg>`);
  assert.ok(many.ok);
  const over = parseFragment(many.doc, many.doc.root, '<g/>'.repeat(9));
  assert.ok(!over.ok && over.error.message === 'the document would have more than 200000 nodes', 'a 200,001st node is refused');
  const room = parseFragment(many.doc, many.doc.root, '<g/>'.repeat(8));
  assert.ok(room.ok, 'the 200,000th fits');
  insertAll(many.doc, many.doc.root, room.nodes);
  assert.ok(parseDoc(serialize(many.doc)).ok, 'and the saved file reopens');
  // Size: 20 MB in all.
  const shell = '<svg xmlns="http://www.w3.org/2000/svg"><desc></desc></svg>';
  const big = parseDoc(shell.replace('<desc>', `<desc>${'x'.repeat(20e6 - shell.length - 10)}`));
  assert.ok(big.ok);
  const desc = el(big.doc, big.doc.root).children[0];
  const large = parseFragment(big.doc, desc, 'y'.repeat(11));
  assert.ok(!large.ok && large.error.message === 'the document would be larger than 20 MB', 'a byte over 20 MB is refused');
  const small = parseFragment(big.doc, desc, 'y'.repeat(10));
  assert.ok(small.ok, 'exactly 20 MB fits');
  insertAll(big.doc, desc, small.nodes);
  assert.ok(parseDoc(serialize(big.doc)).ok, 'and the saved file reopens');
});

test('Edit source cannot bring in a DOCTYPE or an XML declaration (a browser refuses either there)', () => {
  const r = parseDoc(SRC);
  assert.ok(r.ok);
  const before = serialize(r.doc);
  for (const [text, message] of [
    ['<!DOCTYPE svg [<!ENTITY x "y">]><rect/>', 'a DOCTYPE is allowed only before the root element'],
    ['<rect/><?xml version="1.0"?>', 'the XML declaration is allowed only at the start of the document'],
  ]) {
    const f = parseFragment(r.doc, r.doc.root, text);
    assert.ok(!f.ok, text);
    assert.equal(f.error.message, message);
    assert.equal(f.error.at, text.indexOf('<!DOCTYPE') === 0 ? 0 : text.indexOf('<?xml'), 'at its own position in the text');
  }
  assert.ok(parseFragment(r.doc, r.doc.root, '<?xml-stylesheet href="a.css"?><rect/>').ok, 'another processing instruction is fine');
  assert.equal(serialize(r.doc), before);
});
