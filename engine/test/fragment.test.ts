// Edit source: parse an element's edited source into the same document, byte for byte, undoably.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseDoc, serialize, serializeNode, serializeParts, descendants, el, NS, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { parseFragment, replaceContent } from '../model/fragment.ts';
import { ENTITY_BUDGET } from '../xml/entities.ts';
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

// The document declares a bomb of entities that expand to nothing and never uses it, so it opens;
// Edit source then uses it. Expanding costs work as well as output, so the text is refused within
// the document's budget, fast, and a refused text spends nothing (it used to take 34 s here).
test('Edit source refuses an entity bomb that expands to nothing, within the budget', () => {
  let subset = '<!ENTITY e0 "">';
  for (let d = 1; d <= 8; d++) subset += `<!ENTITY e${d} "${`&e${d - 1};`.repeat(10)}">`;
  const r = parseDoc(`<!DOCTYPE svg [${subset}]><svg xmlns="http://www.w3.org/2000/svg"><g/></svg>`);
  assert.ok(r.ok);
  const doc = r.doc;
  assert.ok(parseFragment(doc, doc.root, '<text>&e1;</text>').ok);
  assert.ok(doc.budget.left < ENTITY_BUDGET, 'an expansion to nothing is charged to the document');
  const left = doc.budget.left;
  const t0 = performance.now();
  const f = parseFragment(doc, doc.root, '<text>&e8;</text>');
  const ms = performance.now() - t0;
  assert.ok(!f.ok, 'parsed');
  assert.match(f.error.message, /entity expansion over 1000000 characters/);
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
  assert.equal(doc.budget.left, left, 'a refused text spends nothing');
});

// Put what a fragment parses to at the end of `scope`, as Edit source would (one transaction).
function insertAll(doc: Doc, scope: NodeId, nodes: NodeId[]): void {
  const at = el(doc, scope).children.length;
  new Session(doc).dispatch('insert', (apply) => nodes.forEach((id, i) => apply(opInsert(doc, id, scope, at + i))));
}

test('Edit source spends what the document has left of its limits, so the file always opens again', () => {
  // Entities: the file spends 644,445 of its 1,000,000 on open (what each expansion writes, plus one
  // for it and the references it reads); each &d; costs 44,441 more.
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
  assert.equal(fitted, 8, 'eight fit in what the document had left, and the ninth is refused');
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

// Edit source parses with the same engine, so it refuses what a browser refuses (xml.test.ts has
// every rule), each at its place in the edited text, and what the document declares still counts.
test('Edit source refuses what a browser refuses, at its place in the text, with the document in scope', () => {
  const r = parseDoc(`<!DOCTYPE svg [<!ENTITY brand "Draw">]>${SRC}`);
  assert.ok(r.ok);
  const doc = r.doc;
  const before = serialize(doc);
  for (const [text, at, message] of [
    ['<text>Fish & chips</text>', 11, /a bare &/],
    ['<text>a&nbsp;b</text>', 7, /the entity &nbsp; is not declared/],
    ['<rect x="1" x="2"/>', 12, /attribute x is written twice in <rect>/],
    ['<p:g/>', 1, /the prefix p of <p:g> is not declared/],
    ['<g><!-- a -- b --></g>', 10, /'--' inside a comment/],
    ['<g xmlns:p=""/>', 3, /xmlns:p is empty/],
  ] as const) {
    const f = parseFragment(doc, doc.root, text);
    assert.ok(!f.ok, text);
    assert.equal(f.error.at, at, `${text}: ${f.error.message}`);
    assert.match(f.error.message, message, text);
  }
  // The root's xmlns:q and the DOCTYPE's &brand; are in scope, as they are where the text lands.
  assert.ok(parseFragment(doc, doc.root, '<use q:href="#a"><title>by &brand;</title></use>').ok);
  assert.equal(serialize(doc), before, 'a refused edit changes nothing');
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

// ── P1-M5: Edit the drawing's source (the root's whole content) ────────────────────────────────

const WHOLE = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by hand -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <title>t</title>\n  <rect x="1" y="1" width="2" height="2"/>\n</svg>\n<!-- after -->\n`;

test('serializeParts: an element as its start tag, its content and its end tag, exactly as serialize writes them', () => {
  const p = parseDoc(WHOLE);
  assert.ok(p.ok);
  const doc = p.doc;
  const parts = serializeParts(doc, doc.root);
  assert.deepEqual(parts, { start: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">', content: '\n  <title>t</title>\n  <rect x="1" y="1" width="2" height="2"/>\n', end: '</svg>' });
  assert.equal(parts.start + parts.content + parts.end, serializeNode(doc, doc.root));
  const empty = parseDoc('<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.ok(empty.ok);
  assert.deepEqual(serializeParts(empty.doc, empty.doc.root), { start: '<svg xmlns="http://www.w3.org/2000/svg"/>', content: '', end: '' });
});

test('replaceContent: the root becomes exactly its start tag, the text and its end tag, the prolog and epilog kept, in one entry undo takes back', () => {
  const p = parseDoc(WHOLE);
  assert.ok(p.ok);
  const doc = p.doc;
  const s = new Session(doc);
  const text = '\n  <circle cx="5" cy="5" r="3"/>\n  <!-- a note -->\n';
  s.dispatch('Edit source', (apply) => {
    const r = replaceContent(doc, doc.root, text, apply);
    assert.ok(r.ok);
  });
  assert.equal(serialize(doc), `<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by hand -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${text}</svg>\n<!-- after -->\n`);
  assert.equal(s.undoLabel, 'Edit source');
  s.undo();
  assert.equal(serialize(doc), WHOLE, 'one undo gives the bytes back');
  assert.equal(s.canUndo, false, 'it was one entry');
});

test('replaceContent: text that doesn’t parse changes nothing and says where', () => {
  const p = parseDoc(WHOLE);
  assert.ok(p.ok);
  const doc = p.doc;
  const ops: unknown[] = [];
  const r = replaceContent(doc, doc.root, '\n  <rect x="1"\n', (op) => ops.push(op));
  assert.ok(!r.ok && r.error.at > 0 && r.error.at <= '\n  <rect x="1"\n'.length, JSON.stringify(r));
  assert.equal(ops.length, 0, 'no op');
  assert.equal(serialize(doc), WHOLE);
});
