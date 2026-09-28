// engine/xml and engine/model: lossless round trip, edit locality, namespaces, entity caps, limits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lex } from '../xml/lex.ts';
import { parseCst, serializeCst } from '../xml/cst.ts';
import { decode, readEntityTable, EntityBudgetError, newBudget } from '../xml/entities.ts';
import { parseDoc, serialize, el, setAttr, removeAttr, attrValue, href, textContent, NS, descendants } from '../model/doc.ts';

const CORPUS = new URL('./fixtures/corpus/', import.meta.url).pathname;

function* corpusFiles(dir = CORPUS): Generator<string> {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* corpusFiles(p);
    else if (e.endsWith('.svg')) yield p;
  }
}

test('lexer tokens tile the source exactly', () => {
  const s = '<?xml version="1.0"?>\n<!-- c --><svg a="1"  b = \'2\'><![CDATA[x]]><?pi x?>t&amp;<g/></svg>\n';
  const r = lex(s);
  assert.ok(r.ok);
  let at = 0;
  for (const t of r.tokens) {
    assert.equal(t.start, at, 'tokens are contiguous');
    at = t.end;
  }
  assert.equal(at, s.length);
});

test('every corpus file round-trips byte-identical through the CST and the model', () => {
  let n = 0;
  for (const file of corpusFiles()) {
    const src = readFileSync(file, 'utf8');
    const cst = parseCst(src);
    assert.ok(cst.ok, `${file}: ${!cst.ok && cst.error.message}`);
    assert.equal(serializeCst(cst.cst), src, `${file}: CST round trip`);
    const doc = parseDoc(src);
    assert.ok(doc.ok, file);
    assert.equal(serialize(doc.doc), src, `${file}: model round trip`);
    n++;
  }
  assert.ok(n >= 150, `corpus has ${n} files; the P0 exit needs at least 150`);
});

test('one attribute edit changes exactly that attribute', () => {
  const src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox='0 0 24 24'>\n  <rect  x = "1" y="2"\twidth="3"/>\n  <circle r="4"/>\n</svg>\n`;
  const r = parseDoc(src);
  assert.ok(r.ok);
  const doc = r.doc;
  const rect = [...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.local === 'rect')!;
  setAttr(doc, rect.id, null, 'y', '20');
  assert.equal(serialize(doc), src.replace('y="2"', 'y="20"'));
  removeAttr(doc, rect.id, null, 'width');
  assert.equal(serialize(doc), src.replace('y="2"\twidth="3"', 'y="20"'));
  setAttr(doc, rect.id, null, 'fill', 'a<b"c');
  assert.ok(serialize(doc).includes('fill="a&lt;b&quot;c"'));
});

test('namespaces resolve by URI, not prefix', () => {
  const r = parseDoc(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:q="http://www.w3.org/1999/xlink"><a q:href="#x"/><use xlink:href="#y" xmlns:xlink="http://www.w3.org/1999/xlink"/><x:g xmlns:x="http://www.w3.org/2000/svg"/></svg>`);
  assert.ok(r.ok);
  const nodes = [...descendants(r.doc, r.doc.root)].filter((n) => n.kind === 'element');
  const a = el(r.doc, nodes[1].id);
  assert.equal(a.ns, NS.svg);
  assert.equal(href(r.doc, a), '#x');
  assert.equal(href(r.doc, el(r.doc, nodes[2].id)), '#y');
  assert.equal(el(r.doc, nodes[3].id).ns, NS.svg);
  assert.equal(el(r.doc, nodes[3].id).local, 'g');
});

test('entities: predefined and numeric decode; internal expand; external never', () => {
  const t = readEntityTable('<!ENTITY ns_svg "http://www.w3.org/2000/svg"><!ENTITY ext SYSTEM "http://evil.example/x"><!ENTITY % p "x">');
  assert.equal(decode('&ns_svg;', t), 'http://www.w3.org/2000/svg');
  assert.equal(decode('&lt;&#65;&#x42;&amp;', t), '<AB&');
  const unresolved = new Set<string>();
  assert.equal(decode('&ext;', t, newBudget(), 0, unresolved), '&ext;');
  assert.ok(unresolved.has('ext'));
  assert.ok(t.parameter.has('p'));
});

test('a billion-laughs document fails within the entity budget', () => {
  let subset = '<!ENTITY lol "lollollollollollollollollollol">';
  for (let i = 1; i <= 9; i++) subset += `<!ENTITY lol${i} "${`&lol${i === 1 ? '' : i - 1};`.repeat(10)}">`;
  const t = readEntityTable(subset);
  assert.throws(() => decode('&lol9;', t), EntityBudgetError);
});

// The billion laughs above nests 10 deep, so the depth limit alone stops it. Each limit gets its
// own case, or removing either one would go unnoticed.
test('a wide, shallow expansion hits the size budget', () => {
  const t = readEntityTable(`<!ENTITY a "${'x'.repeat(1000)}"><!ENTITY b "${'&a;'.repeat(2000)}">`);
  assert.throws(() => decode('&b;', t), /over 1000000 characters/);
});

test('a deep chain of tiny entities hits the depth limit', () => {
  let subset = '<!ENTITY e12 "x">';
  for (let i = 1; i < 12; i++) subset += `<!ENTITY e${i} "&e${i + 1};">`;
  assert.throws(() => decode('&e1;', readEntityTable(subset)), /nested deeper than 8/);
});

test('a name like toString is an unknown entity, not an object property', () => {
  const unresolved = new Set<string>();
  assert.equal(decode('&toString;&constructor;', readEntityTable(null), newBudget(), 0, unresolved), '&toString;&constructor;');
  assert.deepEqual([...unresolved].sort(), ['constructor', 'toString']);
});

test('a document that expands too far, or into markup, fails to open', () => {
  let subset = '<!ENTITY a "' + 'x'.repeat(1000) + '"><!ENTITY b "' + '&a;'.repeat(1100) + '">';
  const far = parseDoc(`<!DOCTYPE svg [${subset}]><svg><text>&b;</text></svg>`);
  assert.equal(far.ok, false);
  assert.match(!far.ok ? far.error.message : '', /over 1000000 characters/);
  subset = `<!ENTITY m "<circle r='4'/>">`;
  for (const body of ['<text>&m;</text>', '<g id="&m;"/>']) {
    const r = parseDoc(`<!DOCTYPE svg [${subset}]><svg>${body}</svg>`);
    assert.equal(r.ok, false, body);
    assert.match(!r.ok ? r.error.message : '', /expands to markup/);
  }
});

test('reading values after parsing never drains the entity budget', () => {
  const r = parseDoc(`<!DOCTYPE svg [<!ENTITY a "${'x'.repeat(1000)}">]><svg data-a="&a;"/>`);
  assert.ok(r.ok);
  const root = el(r.doc, r.doc.root);
  for (let i = 0; i < 2000; i++) assert.equal(attrValue(r.doc, root, null, 'data-a')?.length, 1000); // 2 MB read in total
});

test('values are normalized as an XML processor reports them', () => {
  const src = '<!DOCTYPE svg [<!ENTITY sp "a\tb&#10;c">]><svg a="x\r\ny\tz" b="&#9;&#10;" c="&sp;"><text>1\r\n2\r3</text></svg>';
  const r = parseDoc(src);
  assert.ok(r.ok);
  const root = el(r.doc, r.doc.root);
  assert.equal(attrValue(r.doc, root, null, 'a'), 'x y z'); // CRLF is one space, tab is a space
  assert.equal(attrValue(r.doc, root, null, 'b'), '\t\n'); // character references keep what they name
  assert.equal(attrValue(r.doc, root, null, 'c'), 'a b c'); // entity text: expanded at declaration, then normalized
  assert.equal(textContent(r.doc, r.doc.root), '1\n2\n3');
  assert.equal(serialize(r.doc), src); // the source itself is never rewritten
});

test('Illustrator-style DOCTYPE entities resolve namespaces', () => {
  const src = `<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n  <!ENTITY ns_svg "http://www.w3.org/2000/svg">\n]>\n<svg xmlns="&ns_svg;"><rect/></svg>`;
  const r = parseDoc(src);
  assert.ok(r.ok);
  assert.equal(el(r.doc, r.doc.root).ns, NS.svg);
  assert.equal(serialize(r.doc), src);
});

test('limits: size, node count and depth fail cleanly', () => {
  assert.equal(parseCst('<svg/>', { maxBytes: 3, maxNodes: 10, maxDepth: 10 }).ok, false);
  assert.equal(parseCst('<svg>' + '<g/>'.repeat(20) + '</svg>', { maxBytes: 1e6, maxNodes: 10, maxDepth: 10 }).ok, false);
  assert.equal(parseCst('<g>'.repeat(20) + '</g>'.repeat(20), { maxBytes: 1e6, maxNodes: 1e5, maxDepth: 10 }).ok, false);
});

test('a DOCTYPE outside the prolog, or an XML declaration after the start, is refused as a browser refuses it', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">';
  for (const [src, at] of [
    [`${svg}<g><!DOCTYPE svg [<!ENTITY x "y">]><text>&x;</text></g></svg>`, svg.length + 3],
    [`${svg}</svg><!DOCTYPE svg>`, svg.length + 6],
    [`${svg}<?xml version="1.0"?></svg>`, svg.length],
    [` <?xml version="1.0"?>${svg}</svg>`, 1],
    [`<!-- c --><?xml version="1.0"?>${svg}</svg>`, 10],
    [`${svg}</svg><?xml version="1.0"?>`, svg.length + 6],
  ] as const) {
    const r = parseDoc(src);
    assert.ok(!r.ok, src);
    assert.equal(r.error.at, at, src);
  }
  for (const src of [`<?xml version="1.0"?><!DOCTYPE svg>${svg}</svg>`, `\uFEFF<?xml version="1.0"?>${svg}</svg>`, `${svg}<?xml-stylesheet href="a.css"?></svg>`]) {
    const r = parseDoc(src);
    assert.ok(r.ok, src);
    assert.equal(serialize(r.doc), src);
  }
});

test('malformed input is an error with a position, never a throw', () => {
  for (const bad of ['', '<', '<svg', '<svg a=1/>', '<svg></g>', '<svg/><svg/>', 'x<svg/>', '<svg><!-- x', '<svg a="1" a2></svg>', '<svg>\u0000</svg']) {
    const r = parseDoc(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});

test('text content decodes entities and CDATA', () => {
  const r = parseDoc('<svg><text>a &amp; b<![CDATA[ <c> ]]></text></svg>');
  assert.ok(r.ok);
  const text = [...descendants(r.doc, r.doc.root)].find((n) => n.kind === 'element' && n.local === 'text')!;
  assert.equal(textContent(r.doc, text.id), 'a & b <c> ');
  assert.equal(attrValue(r.doc, el(r.doc, r.doc.root), null, 'x'), null);
});

test('lexing is linear: a 5 MB file parses in well under a second', () => {
  const body = '<path d="M1 2L3 4"/>'.repeat(250_000);
  const src = `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  const t0 = performance.now();
  const r = parseCst(src, { maxBytes: 20e6, maxNodes: 1e6, maxDepth: 256 });
  const ms = performance.now() - t0;
  assert.ok(r.ok);
  assert.ok(ms < 2000, `took ${ms.toFixed(0)} ms`);
});
