// engine/xml and engine/model: lossless round trip, edit locality, namespaces, entity caps, limits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lex } from '../xml/lex.ts';
import { parseCst, serializeCst } from '../xml/cst.ts';
import { decode, readEntityTable, EntityBudgetError, EntityWellFormednessError, newBudget, ENTITY_BUDGET } from '../xml/entities.ts';
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

// An element's namespace declarations hold for it and what it holds, and no further: the one map in
// scope is set on the way in and put back on the way out. It used to be copied for every element
// that declares one: 255 nested elements declaring 150 prefixes each took 1.4 s, 600 each 7 s.
test('namespace declarations hold for their element only, at no cost per element', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:p="urn:outer">';
  const r = parseDoc(`${svg}<g xmlns:p="urn:inner" xmlns="urn:x"><p:a/><b/></g><p:c/><d/></svg>`);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  const ns = Object.fromEntries([...descendants(r.doc, r.doc.root)].flatMap((n) => (n.kind === 'element' ? [[n.local, n.ns]] : [])));
  assert.deepEqual(ns, { svg: NS.svg, g: 'urn:x', a: 'urn:inner', b: 'urn:x', c: 'urn:outer', d: NS.svg }, 'each resolves in its own scope');
  const out = parseDoc(`${svg}<g xmlns:q="urn:q"/><q:e/></svg>`);
  assert.ok(!out.ok && out.error.message === 'the prefix q of <q:e> is not declared', 'a declaration ends with its element');
  for (const [k, limit] of [[150, 1000], [600, 1500]]) {
    let open = '', close = '';
    for (let d = 0; d < 255; d++) {
      let x = '';
      for (let j = 0; j < k; j++) x += ` xmlns:q${d}_${j}="urn:${d}"`;
      open += `<g${x}>`;
      close += '</g>';
    }
    const src = `<svg xmlns="http://www.w3.org/2000/svg">${open}<q254_0:rect q0_0:k="1"/>${close}</svg>`;
    const t0 = performance.now();
    const deep = parseDoc(src);
    const ms = performance.now() - t0;
    assert.ok(deep.ok, !deep.ok ? deep.error.message : '');
    const rect = [...descendants(deep.doc, deep.doc.root)].find((n) => n.kind === 'element' && n.local === 'rect');
    assert.ok(rect?.kind === 'element' && rect.ns === 'urn:254' && rect.attrs[0].ns === 'urn:0', 'the innermost declaration, and one from the top');
    assert.ok(ms < limit, `255 nested elements declaring ${k} prefixes each took ${ms.toFixed(0)} ms`);
  }
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

// XML lets a parameter entity in the internal subset declare more entities. Draw records them and
// never expands one (neither do browsers: they refuse such a DOCTYPE), so nothing a parameter
// entity declares ever reaches a value; a reference to an entity one may declare is over Draw's
// limits (the next test), and a parameter entity is no general entity of the same name.
test('parameter entities are recorded and never expanded: in the DOCTYPE, in text or in values', () => {
  const src = `<!DOCTYPE svg [
  <!ENTITY % decl "<!ENTITY name 'Draw'>">
  %decl;
  <!ENTITY % fill "red">
  <!ENTITY % extra SYSTEM "extra.dtd">
  %extra;
  <!ENTITY brand "Draw">
]>
<svg xmlns="http://www.w3.org/2000/svg"><text>Made by &brand;</text><rect fill="%fill;"/></svg>`;
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  const { entities } = r.doc;
  assert.deepEqual([...entities.parameter].sort(), ['decl', 'extra', 'fill'], 'recorded');
  assert.ok(entities.hasPERefs, '%decl; and %extra; are references');
  assert.deepEqual([...entities.internal.keys()], ['brand'], 'what %decl; would declare is never declared');
  assert.deepEqual([...entities.external], [], 'an external parameter entity is not a general one either');
  const [text, rect] = [...descendants(r.doc, r.doc.root)].filter((n) => n.kind === 'element').slice(1).map((n) => el(r.doc, n.id));
  assert.equal(textContent(r.doc, text.id), 'Made by Draw');
  assert.equal(attrValue(r.doc, rect, null, 'fill'), '%fill;', 'outside the DTD, % is only text');
  const unresolved = new Set<string>();
  assert.equal(decode('&decl;&extra;', entities, newBudget(), 0, unresolved), '&decl;&extra;', 'a parameter entity is not a general entity of the same name');
  assert.deepEqual([...unresolved].sort(), ['decl', 'extra']);
  assert.equal(serialize(r.doc), src, 'the DOCTYPE and every reference are kept byte for byte');
  for (const [from, to] of [['Made by &brand;', '&name;'], ['fill="%fill;"', 'fill="&fill;"']]) {
    const refused = parseDoc(src.replace(from, to));
    assert.ok(!refused.ok && refused.error.kind === 'limit', `${to}: what %decl; would declare, or a parameter entity's name, is never a general entity`);
  }
});

test("an entity a parameter entity may declare is over Draw's limits, not malformed", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">';
  const subset = `<!DOCTYPE svg [<!ENTITY % decl "<!ENTITY name 'Draw'>"> %decl;]>`;
  for (const body of ['<text>by &name;</text>', '<g id="&name;"/>']) {
    const src = `${subset}${svg}${body}</svg>`;
    const r = parseDoc(src);
    assert.ok(!r.ok, body);
    assert.equal(r.error.kind, 'limit', body);
    assert.equal(r.error.at, src.indexOf('&name;'), body);
    assert.match(r.error.message, /&name; is not declared; it may be declared by a parameter entity, which Draw doesn't expand/);
  }
  // Only a reference counts: a parameter entity declared and never referenced, or %decl; inside a
  // literal or a comment, declares nothing, so &name; is simply not declared.
  for (const doctype of [`<!DOCTYPE svg [<!ENTITY % decl "<!ENTITY name 'Draw'>">]>`, `<!DOCTYPE svg [<!ENTITY a "%decl;"><!-- %decl; --><?pi %decl;?>]>`]) {
    const src = `${doctype}${svg}<text>&name;</text></svg>`;
    const r = parseDoc(src);
    assert.ok(!r.ok && r.error.kind === undefined && r.error.at === src.indexOf('&name;'), doctype);
    assert.equal(readEntityTable(doctype.slice(15, -2)).hasPERefs, false, doctype);
  }
});

// Under a DOCTYPE that names an XHTML DTD (XHTML_DTDS), browsers supply HTML's named references
// themselves, so &nbsp; is well-formed to them there; Draw neither reads DTDs nor knows HTML's
// references, so such a file is over its limits. Under any other DOCTYPE, &nbsp; is not declared,
// and browsers refuse it (e2e theEngineRefusesWhatTheBrowserRefuses has both).
test("an entity an XHTML DOCTYPE brings is over Draw's limits, not malformed", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">';
  for (const doctype of [
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD XHTML 1.1 plus MathML 2.0 plus SVG 1.1//EN" "http://www.w3.org/2002/04/xhtml-math-svg/xhtml-math-svg.dtd">',
    "<!DOCTYPE html PUBLIC '-//W3C//DTD XHTML 1.0 Strict//EN' 'xhtml1-strict.dtd' [<!ENTITY brand 'Draw'>]>",
  ]) {
    for (const body of ['<text>a&nbsp;b</text>', '<g id="&copy;"/>']) {
      const src = `${doctype}${svg}${body}</svg>`;
      const r = parseDoc(src);
      assert.ok(!r.ok, `${doctype} ${body}`);
      assert.equal(r.error.kind, 'limit', body);
      assert.equal(r.error.at, src.indexOf('&', doctype.length), body);
      assert.match(r.error.message, /is not declared; a browser takes it from the XHTML DTD the DOCTYPE names, which Draw doesn't read/);
    }
    const ok = parseDoc(`${doctype}${svg}<text>&lt;&#160;${doctype.includes('brand') ? '&brand;' : ''}</text></svg>`);
    assert.ok(ok.ok, 'what the document declares, the predefined entities and character references read as ever');
  }
  // Any other DOCTYPE supplies nothing, the SVG DTD's included: &nbsp; there is not declared.
  const src = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${svg}<text>&nbsp;</text></svg>`;
  const r = parseDoc(src);
  assert.ok(!r.ok);
  assert.equal(r.error.kind, undefined);
  assert.equal(r.error.at, src.indexOf('&nbsp;'));
});

test('a billion-laughs document fails within the entity budget', () => {
  let subset = '<!ENTITY lol "lollollollollollollollollollol">';
  for (let i = 1; i <= 9; i++) subset += `<!ENTITY lol${i} "${`&lol${i === 1 ? '' : i - 1};`.repeat(10)}">`;
  const t = readEntityTable(subset);
  assert.throws(() => decode('&lol9;', t), EntityBudgetError);
});

// An expansion that makes nothing still costs (one for it, and the replacement text it reads for
// references), so a bomb of empty entities fails as fast as one that makes text. It used to run
// fan^depth expansions without spending anything: 34 s for this 535-byte file.
test('an entity bomb that expands to nothing fails within the entity budget', () => {
  let subset = '<!ENTITY e0 "">';
  for (let d = 1; d <= 8; d++) subset += `<!ENTITY e${d} "${`&e${d - 1};`.repeat(10)}">`;
  const budget = newBudget();
  assert.equal(decode('&e1;', readEntityTable(subset), budget), '');
  assert.ok(budget.left < ENTITY_BUDGET, 'an expansion to nothing is charged to the budget');
  for (const body of ['<text>&e8;</text>', '<g id="&e8;"/>']) {
    const src = `<!DOCTYPE svg [${subset}]><svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
    const t0 = performance.now();
    const r = parseDoc(src);
    const ms = performance.now() - t0;
    assert.ok(!r.ok, `${body}: parsed`);
    assert.equal(r.error.kind, 'limit', body);
    assert.match(r.error.message, /entity expansion over 1000000 characters/, body);
    assert.ok(ms < 1000, `${body}: took ${ms.toFixed(0)} ms`);
  }
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

test("a limit failure says so (kind 'limit'), in the CST and through parseDoc's entity checks; a well-formedness error does not", () => {
  for (const [src, limits, message] of [
    ['<svg/>'.padEnd(2e6), { maxBytes: 1e6, maxNodes: 10, maxDepth: 10 }, 'file is larger than 1 MB'],
    ['<svg>' + '<g/>'.repeat(20) + '</svg>', { maxBytes: 1e6, maxNodes: 10, maxDepth: 10 }, 'more than 10 nodes'],
    ['<g>'.repeat(20) + '</g>'.repeat(20), { maxBytes: 1e6, maxNodes: 1e5, maxDepth: 10 }, 'nesting deeper than 10'],
  ] as const) {
    const r = parseCst(src, limits);
    assert.ok(!r.ok && r.error.kind === 'limit' && r.error.message === message, !r.ok ? r.error.message : 'parsed');
  }
  const entity = (decl: string, body: string) => parseDoc(`<!DOCTYPE svg [${decl}]><svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  for (const r of [entity(`<!ENTITY a "${'x'.repeat(1000)}"><!ENTITY b "${'&a;'.repeat(2000)}">`, '<text>&b;</text>'), entity('<!ENTITY r "<rect/>">', '&r;')]) {
    assert.ok(!r.ok && r.error.kind === 'limit', !r.ok ? r.error.message : 'parsed');
  }
  for (const src of ['<svg><g></svg>', '<svg a="1" a="2"', '<svg/><svg/>', '<svg>&#x3c;</g></svg>']) {
    const r = parseDoc(src);
    assert.ok(!r.ok && r.error.kind === undefined, src);
  }
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
  const strict = ['<svg a="1" a="2"/>', '<svg>&</svg>', '<svg>&nbsp;</svg>', '<svg>&#0;</svg>', '<svg><!-- a -- b --></svg>', '<a:svg/>', '<!doctype svg><svg/>', '\f<svg/>', '<svg>]]></svg>', '<svg xmlns:p=""/>', '<svg x:="1"/>'];
  for (const bad of ['', '<', '<svg', '<svg a=1/>', '<svg></g>', '<svg/><svg/>', 'x<svg/>', '<svg><!-- x', '<svg a="1" a2></svg>', '<svg>\u0000</svg', ...strict]) {
    const r = parseDoc(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.error.at >= 0 && r.error.at <= bad.length, JSON.stringify(bad));
  }
});

// What a browser's XML parser refuses, Draw's refuses: each case is not well-formed (no kind), and
// fails where the browser's does. The browsers' own verdicts are checked in e2e
// theEngineRefusesWhatTheBrowserRefuses.
test('strict well-formedness: what a browser refuses, Draw refuses, each with its place', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">';
  const ns = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:a="urn:x" xmlns:b="urn:x">';
  const ext = '<!DOCTYPE svg [<!ENTITY ext SYSTEM "ext.xml">]>';
  const bad = (entity: string) => `<!DOCTYPE svg [${entity}]>`;
  const cases: [label: string, src: string, at: (src: string) => number, message: RegExp][] = [
    ['an attribute written twice', `${svg}<rect fill="red" fill="blue"/></svg>`, (s) => s.lastIndexOf('fill'), /attribute fill is written twice in <rect>/],
    ['two prefixes of one namespace', `${ns}<rect a:k="1" b:k="2"/></svg>`, (s) => s.indexOf('b:k'), /a:k and b:k of <rect> are one attribute/],
    ['a bare & in text', `${svg}<text>Fish & chips</text></svg>`, (s) => s.indexOf('&'), /a bare &/],
    ['a bare & in a value', `${svg}<g id="a & b"/></svg>`, (s) => s.indexOf('&'), /a bare &/],
    ['a reference without ;', `${svg}<text>&amp chips</text></svg>`, (s) => s.indexOf('&'), /&amp has no closing ;/],
    ['&#0;', `${svg}<text>a&#0;</text></svg>`, (s) => s.indexOf('&'), /&#0; names a character XML doesn't allow/],
    ['&#x1F; in a value', `${svg}<g id="&#x1F;"/></svg>`, (s) => s.indexOf('&'), /&#x1F;/],
    ['a surrogate', `${svg}<g id="a&#xD800;"/></svg>`, (s) => s.indexOf('&'), /&#xD800;/],
    ['&#xFFFE;', `${svg}<text>&#xFFFE;</text></svg>`, (s) => s.indexOf('&'), /&#xFFFE;/],
    ['past U+10FFFF', `${svg}<text>&#1114112;</text></svg>`, (s) => s.indexOf('&'), /&#1114112;/],
    ['&nbsp; with no DTD', `${svg}<text>a&nbsp;b</text></svg>`, (s) => s.indexOf('&'), /the entity &nbsp; is not declared/],
    ['&nbsp; with an external DTD', `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${svg}<text>&nbsp;</text></svg>`, (s) => s.indexOf('&nbsp;'), /&nbsp; is not declared/],
    ['an undeclared entity in a value', `${bad('<!ENTITY a "x">')}${svg}<g id="&b;"/></svg>`, (s) => s.indexOf('&b;'), /&b; is not declared/],
    ['an external entity in a value', `${ext}${svg}<g id="&ext;"/></svg>`, (s) => s.indexOf('&ext;'), /the external entity &ext; can't be used in an attribute value/],
    ['an entity that expands to a bare &', `${bad('<!ENTITY a "x &#38; y">')}${svg}<text>&a;</text></svg>`, (s) => s.indexOf('&a;'), /&a; expands to text that isn't well-formed: a bare &/],
    ['an entity that expands to &#0;', `${bad('<!ENTITY a "&#38;#0;">')}${svg}<g id="&a;"/></svg>`, (s) => s.indexOf('&a;'), /&a; expands to text that isn't well-formed: &#0;/],
    ['an entity that refers to itself', `${bad('<!ENTITY a "&b;"><!ENTITY b "&a;">')}${svg}<text>&a;</text></svg>`, (s) => s.indexOf('&a;', 60), /&a; refers to itself/],
    ['an entity that brings ]]> into text', `${bad('<!ENTITY a "x]]>">')}${svg}<text>&a;</text></svg>`, (s) => s.indexOf('&a;'), /]]>/],
    ['-- in a comment', `${svg}<!-- a -- b --></svg>`, (s) => s.indexOf('--', s.indexOf('<!--') + 4), /'--' inside a comment/],
    ['a comment that ends in ---', `<!-- a --->${svg}</svg>`, () => 7, /'--' inside a comment/],
    ['a lowercase <!doctype', `<!doctype svg>${svg}</svg>`, () => 0, /capitals/],
    // A form feed is no XML character at all, so it is refused as one, wherever it stands.
    ['a form feed before the root', `\f${svg}</svg>`, () => 0, /the character U\+000C is not allowed in XML/],
    ['a no-break space before the root', `\u{A0}${svg}</svg>`, () => 0, /text outside the root/],
    ['a no-break space after the root', `${svg}</svg>\n\u{A0}`, (s) => s.length - 1, /text outside the root/],
    ['a BOM that is not first', ` \u{FEFF}${svg}</svg>`, () => 1, /text outside the root/],
    ['an unbound element prefix', `${svg}<p:g/></svg>`, (s) => s.indexOf('p:g'), /the prefix p of <p:g> is not declared/],
    ['an unbound attribute prefix', `${svg}<g p:k="1"/></svg>`, (s) => s.indexOf('p:k'), /the prefix p of attribute p:k is not declared/],
    ['xmlns:p=""', `${svg}<g xmlns:p=""/></svg>`, (s) => s.indexOf('xmlns:p'), /xmlns:p is empty/],
    ['xml bound elsewhere', `${svg}<g xmlns:xml="urn:x"/></svg>`, (s) => s.indexOf('xmlns:xml'), /the prefix xml is bound to/],
    ['another prefix for the XML namespace', `${svg}<g xmlns:p="http://www.w3.org/XML/1998/namespace"/></svg>`, (s) => s.indexOf('xmlns:p'), /only the prefix xml may name/],
    ['the xmlns prefix declared', `${svg}<g xmlns:xmlns="urn:x"/></svg>`, (s) => s.indexOf('xmlns:xmlns'), /the prefix xmlns is reserved/],
    ['a prefix for the xmlns namespace', `${svg}<g xmlns:p="http://www.w3.org/2000/xmlns/"/></svg>`, (s) => s.indexOf('xmlns:p'), /no prefix may name/],
    ['a leading colon', `${svg}<:g/></svg>`, (s) => s.indexOf(':g'), /:g is not a valid name/],
    ['a trailing colon', `${svg}<g k:="1"/></svg>`, (s) => s.indexOf('k:'), /k: is not a valid name/],
    ['two colons', `${ns}<a:b:c/></svg>`, (s) => s.indexOf('a:b:c'), /a:b:c is not a valid name/],
    ['a local name that starts with a digit', `${ns}<a:1b/></svg>`, (s) => s.indexOf('a:1b'), /a:1b is not a valid name/],
    ['U+0001 in text', `${svg}<text>a\x01</text></svg>`, (s) => s.indexOf('\x01'), /the character U\+0001 is not allowed in XML/],
    ['U+FFFE in a value', `${svg}<g id="\u{FFFE}"/></svg>`, (s) => s.indexOf('\u{FFFE}'), /U\+FFFE/],
    ['a lone surrogate in a comment', `${svg}<!-- \u{D800} --></svg>`, (s) => s.indexOf('\u{D800}'), /U\+D800/],
    [']]> in text', `${svg}<text>a ]]> b</text></svg>`, (s) => s.indexOf(']]>'), /']]>' in text/],
  ];
  for (const [label, src, at, message] of cases) {
    const r = parseDoc(src);
    assert.ok(!r.ok, `${label}: parsed`);
    assert.equal(r.error.kind, undefined, `${label}: ${r.error.message} is not a limit`);
    assert.equal(r.error.at, at(src), `${label}: ${r.error.message}`);
    assert.match(r.error.message, message, label);
  }
  // decode refuses to expand such an entity too, wherever it is called from.
  assert.throws(() => decode('&a;', readEntityTable('<!ENTITY a "x &#38; y">')), EntityWellFormednessError);
  // What is well-formed stays so: -, ]] and > where they are allowed, the xml prefix, and xml bound to its own namespace.
  for (const src of [`${svg}<!-- a - b --><text id="a]]>b" xml:lang="en">a ]] > b &#x9;&#xA;&#xD;</text></svg>`, `${svg}<g xmlns:xml="http://www.w3.org/XML/1998/namespace" xml:space="preserve"/></svg>`, `\u{FEFF}${svg}</svg>`]) {
    const r = parseDoc(src);
    assert.ok(r.ok, !r.ok ? `${r.error.message} in ${JSON.stringify(src)}` : '');
  }
});

test('a processing instruction in the DOCTYPE may hold ] and quotes', () => {
  const src = `<!DOCTYPE svg [\n  <?draw a ] b ' c " d?>\n  <!-- ] ' -->\n  <!ENTITY e "ok">\n  <?draw <!ENTITY x "no"> ?>\n]>\n<svg xmlns="http://www.w3.org/2000/svg"><text>&e;</text></svg>`;
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  assert.equal(textContent(r.doc, r.doc.root), 'ok');
  assert.deepEqual([...r.doc.entities.internal.keys()], ['e'], 'an <!ENTITY> inside a processing instruction declares nothing');
  assert.equal(serialize(r.doc), src);
  const x = parseDoc(src.replace('&e;', '&x;'));
  assert.ok(!x.ok && /&x; is not declared/.test(x.error.message));
});

test('text content decodes entities and CDATA', () => {
  const r = parseDoc('<svg><text>a &amp; b<![CDATA[ <c> ]]></text></svg>');
  assert.ok(r.ok);
  const text = [...descendants(r.doc, r.doc.root)].find((n) => n.kind === 'element' && n.local === 'text')!;
  assert.equal(textContent(r.doc, text.id), 'a & b <c> ');
  assert.equal(attrValue(r.doc, el(r.doc, r.doc.root), null, 'x'), null);
});

// Declarations that never close used to send the entity-declaration scan on to the end of the
// subset from every one: quadratic (1 MB took about 100 s). Refused or not, it is linear now.
test('a DOCTYPE full of unterminated entity declarations is read in linear time', () => {
  const unit = '<!ENTITY a SYSTEM ';
  for (const kb of [250, 1000]) {
    const src = `<!DOCTYPE svg [${unit.repeat(Math.ceil((kb * 1000) / unit.length))}]><svg xmlns="http://www.w3.org/2000/svg"/>`;
    const t0 = performance.now();
    parseDoc(src);
    const ms = performance.now() - t0;
    assert.ok(ms < 2000, `${kb} KB of unterminated declarations took ${ms.toFixed(0)} ms`);
  }
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
