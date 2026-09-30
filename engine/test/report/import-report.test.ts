// The import report over the real corpus: every element and attribute lands in exactly one bucket,
// and the buckets say what the ledger says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseDoc, descendants, serialize, type ElementNode } from '../../model/doc.ts';
import { buildRefIndex, duplicateIds } from '../../model/refs.ts';
import { importReport } from '../../report/import-report.ts';
import { classifyAttribute, classifyElement } from '../../policy/classify.ts';

const CORPUS = new URL('../fixtures/corpus/', import.meta.url);
const FILES = readdirSync(CORPUS, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.svg')).sort();
const load = (rel: string) => {
  const r = parseDoc(readFileSync(new URL(rel, CORPUS), 'utf8'));
  assert.ok(r.ok, rel);
  return r.doc;
};

test('every element and attribute of every corpus file is counted once', () => {
  for (const rel of FILES) {
    const doc = load(rel);
    let expected = 0;
    for (const n of descendants(doc, doc.root)) {
      if (n.kind !== 'element') continue;
      const e = n as ElementNode;
      expected += 1 + e.attrs.filter((a) => classifyAttribute(e.ns, e.local, a.ns, a.local) !== null).length;
    }
    const r = importReport(doc);
    const total = Object.values(r.totals).reduce((a, b) => a + b, 0);
    assert.equal(total, expected, rel);
    assert.equal(r.items.reduce((a, i) => a + i.count, 0), total, rel);
  }
});

test('the buckets follow the ledger', () => {
  const svgNs = 'http://www.w3.org/2000/svg';
  assert.deepEqual(classifyElement(svgNs, 'rect'), { cls: 'edit', exact: true });
  assert.deepEqual(classifyElement(svgNs, 'script'), { cls: 'active', exact: true });
  assert.equal(classifyElement(svgNs, 'sparkle').exact, false);
  assert.deepEqual(classifyAttribute(svgNs, 'rect', null, 'onclick'), { cls: 'active', exact: true });
  assert.deepEqual(classifyAttribute(svgNs, 'script', null, 'type'), { cls: 'active', exact: true });
  assert.deepEqual(classifyAttribute(svgNs, 'style', null, 'type'), { cls: 'edit', exact: true });
  assert.equal(classifyAttribute(svgNs, 'g', 'http://www.inkscape.org/namespaces/inkscape', 'label')?.cls, 'preserve-hidden');
  assert.equal(classifyAttribute(svgNs, 'svg', 'http://www.w3.org/2000/xmlns/', 'xlink'), null);
  assert.deepEqual(classifyAttribute(svgNs, 'rect', null, 'data-x'), { cls: 'preserve', exact: true });
  assert.equal(classifyAttribute(svgNs, 'rect', null, 'made-up')?.exact, false);
});

test('reports name what matters in real files', () => {
  const spin = importReport(load('lab/spin--js.svg'));
  assert.ok(spin.totals.preview > 0 && spin.items.some((i) => i.bucket === 'preview' && i.name === 'script'));
  const ink = importReport(load('tools/inkscape-1x-layers.svg'));
  assert.ok(ink.items.some((i) => i.bucket === 'kept' && i.name.startsWith('inkscape:')));
  const unknown = importReport(load('lab/switch--unknown.svg'));
  assert.ok(unknown.items.some((i) => i.bucket === 'unclassified' && i.name === 'sparkle'));
  const legacy = importReport(load('tools/edge-legacy-fonts-tiny-rdfa.svg'));
  assert.ok(legacy.notes.some((n) => n.startsWith('Safari draws')));
  const icon = importReport(load('icons/lucide/' + readdirSync(new URL('icons/lucide/', CORPUS)).find((f) => f.endsWith('.svg'))));
  assert.equal(icon.totals.preview + icon.totals.unclassified, 0, 'a plain icon is all editable or kept');
});

test("what only a fallback row names is listed as unclassified, and the literal <unknown> element as kept", () => {
  const r = parseDoc(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xhtml">
  <sparkle glow="1"/><unknown/><rect made-up="1" width="1"/>
  <foreignObject><x:div><x:marquee>hi</x:marquee></x:div></foreignObject>
</svg>`);
  assert.ok(r.ok);
  const report = importReport(r.doc);
  const find = (kind: string, name: string) => report.items.find((i) => i.kind === kind && i.name === name);
  assert.equal(find('element', 'sparkle')?.bucket, 'unclassified', 'element:svg/*');
  assert.equal(find('element', 'xhtml:marquee')?.bucket, 'unclassified', 'element:xhtml/*');
  assert.equal(find('attribute', 'made-up')?.bucket, 'unclassified', 'attribute:(other)');
  assert.equal(find('attribute', 'glow')?.bucket, 'unclassified');
  assert.equal(find('element', 'unknown')?.bucket, 'kept', 'element:unknown has its own row');
  assert.equal(find('element', 'xhtml:div')?.bucket, 'editable');
  assert.equal(report.totals.unclassified, 4);
  assert.ok(report.notes.includes('Unclassified content is kept byte for byte and never drawn.'));
});

test('external entities a DOCTYPE declares are listed in the notes: never fetched, left as written', () => {
  const r = parseDoc(`<!DOCTYPE svg [
  <!ENTITY logo SYSTEM "logo.xml">
  <!ENTITY ad PUBLIC "-//X//EN" "https://example.com/ad.xml">
  <!ENTITY name "Draw">
]>
<svg xmlns="http://www.w3.org/2000/svg"><text>&name; &logo;</text></svg>`);
  assert.ok(r.ok);
  assert.ok(importReport(r.doc).notes.includes('2 external entities are declared (ad, logo); Draw never fetches them, and references to them stay as written.'));
  const corpusFile = importReport(load('tools/edge-entity-references.svg'));
  assert.ok(corpusFile.notes.some((n) => n.startsWith('1 external entity is declared (ext)')), corpusFile.notes.join(' | '));
  assert.ok(!importReport(load('tools/inkscape-plain-svg.svg')).notes.some((n) => /external entit/.test(n)), 'a file without any says nothing');
});

test('metadata (RDF, Dublin Core, Creative Commons) is kept as-is, never editable', () => {
  const r = parseDoc(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:cc="http://creativecommons.org/ns#" xmlns:ccl="http://web.resource.org/cc/">
  <metadata><rdf:RDF><cc:Work rdf:about=""><dc:format>image/svg+xml</dc:format><dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage"/><dcterms:created>2026</dcterms:created><cc:license rdf:resource="http://creativecommons.org/licenses/by/4.0/"/></cc:Work>
  <cc:License rdf:about="http://creativecommons.org/licenses/by/4.0/"><cc:permits rdf:resource="http://creativecommons.org/ns#Reproduction"/></cc:License><ccl:Work/></rdf:RDF></metadata>
  <rect width="1" height="1"/>
</svg>`);
  assert.ok(r.ok);
  const report = importReport(r.doc);
  const metadata = report.items.filter((i) => /^(rdf|dc|dcterms|cc|ccl):/.test(i.name));
  assert.deepEqual([...new Set(metadata.map((i) => i.bucket))], ['kept'], metadata.map((i) => `${i.name} ${i.bucket}`).join(', '));
  assert.equal(metadata.reduce((n, i) => n + i.count, 0), 14, 'every metadata element (9) and attribute (5) is counted');
  assert.deepEqual(report.items.filter((i) => i.bucket === 'editable').map((i) => i.name).sort(), ['height', 'metadata', 'rect', 'svg', 'width']);

  // A real Inkscape file: its Creative Commons block and its own settings are all kept; nothing is unclassified.
  const ink = importReport(load('tools/inkscape-1x-layers.svg'));
  const editable = ink.items.filter((i) => i.bucket === 'editable').map((i) => i.name);
  assert.deepEqual(editable.filter((n) => /^(rdf|dc|dcterms|cc|inkscape|sodipodi):/.test(n)), [], 'no metadata or editor data under Editable');
  assert.deepEqual(ink.totals, { editable: 93, kept: 72, preview: 0, unclassified: 0 });
});

test("a plain attribute on a foreign element takes that element's class, not an SVG attribute's", () => {
  const svgNs = 'http://www.w3.org/2000/svg';
  const sodipodi = 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd';
  const inkscape = 'http://www.inkscape.org/namespaces/inkscape';
  // Inkscape's page and grid settings are editor data: kept, like the element that holds them.
  assert.deepEqual(classifyAttribute(sodipodi, 'namedview', null, 'pagecolor'), { cls: 'preserve-hidden', exact: true });
  assert.deepEqual(classifyAttribute(inkscape, 'grid', null, 'color'), { cls: 'preserve-hidden', exact: true });
  assert.deepEqual(classifyAttribute(inkscape, 'path-effect', null, 'radius'), { cls: 'preserve-hidden', exact: true });
  // An unknown namespace's element is unclassified, and so are its plain attributes.
  assert.deepEqual(classifyAttribute('https://example.com/ns', 'settings', null, 'x'), { cls: 'preserve-hidden', exact: false });
  // SVG's own attributes are unchanged.
  assert.deepEqual(classifyAttribute(svgNs, 'rect', null, 'x'), { cls: 'edit', exact: true });
  const r = importReport(load('tools/inkscape-092-flowtext-arcs.svg'));
  const pagecolor = r.items.find((i) => i.kind === 'attribute' && i.name === 'pagecolor');
  assert.equal(pagecolor?.bucket, 'kept');
  assert.deepEqual(r.items.filter((i) => i.bucket === 'unclassified').map((i) => i.name).sort(), ['flowPara', 'flowRegion', 'flowRoot'], 'only the SVG 1.2 flow elements no row names');
});

test("what only WebKit draws is flagged, with whether Draw's canvas draws it too", () => {
  // tref and altGlyph render on the canvas (element:tref, element:altGlyph), so Safari shows them
  // in Draw as it does on its own; SVG fonts are kept but never rendered.
  const text = importReport(load('tools/edge-svg11-tref-altglyph.svg'));
  assert.ok(text.notes.includes("Safari draws <altGlyph>, <tref>, and so does Draw's canvas there; Chrome and Firefox do not."), text.notes.join(' | '));
  assert.ok(!text.notes.some((n) => n.includes("Chrome, Firefox and Draw's canvas do not")), 'nothing in it is hidden from the canvas');
  assert.deepEqual(text.items.filter((i) => ['altGlyph', 'tref'].includes(i.name)).map((i) => `${i.name} ${i.bucket} ${i.cls}`).sort(), ['altGlyph kept preserve', 'tref kept preserve']);
  const fonts = importReport(load('tools/edge-legacy-fonts-tiny-rdfa.svg'));
  assert.ok(fonts.notes.includes("Safari draws <font>, <font-face>, <glyph>, <hkern>, <missing-glyph>, <vkern>; Chrome, Firefox and Draw's canvas do not."), fonts.notes.join(' | '));
});

test('duplicate ids are kept as written, and the report names them: browsers use the first', () => {
  // Two Figma icons pasted into one file: each brought its own clip0_12_7 and paint0_linear_12_7.
  const rel = 'tools/figma-pasted-icons-duplicate-ids.svg';
  const src = readFileSync(new URL(rel, CORPUS), 'utf8');
  const doc = load(rel);
  assert.equal(serialize(doc), src, 'kept byte for byte');
  const refs = buildRefIndex(doc);
  assert.deepEqual(duplicateIds(refs), ['paint0_linear_12_7', 'clip0_12_7']);
  for (const id of duplicateIds(refs)) {
    const [first, second] = refs.ids.get(id)!;
    const order = [...descendants(doc, doc.root)].map((n) => n.id);
    assert.ok(order.indexOf(first) < order.indexOf(second), `${id}: the first carrier comes first, as browsers resolve it`);
    assert.equal(refs.refs.get(id)!.length, 2, `${id}: both icons point at it`);
  }
  assert.deepEqual(refs.dangling, []);
  assert.ok(importReport(doc).notes.includes('2 ids are used more than once (paint0_linear_12_7, clip0_12_7); browsers use the first.'), importReport(doc).notes.join(' | '));
  const one = parseDoc('<svg xmlns="http://www.w3.org/2000/svg"><g id="a"/><g id="a"/></svg>');
  assert.ok(one.ok);
  assert.ok(importReport(one.doc).notes.includes('1 id is used more than once (a); browsers use the first.'));
  assert.ok(!importReport(load('tools/figma-card-drop-shadow.svg')).notes.some((n) => /more than once/.test(n)), 'a file without any says nothing');
});

test('rem lengths in attributes and style="" are counted with a note (the canvas measures rem against the app’s root); rem in <style> text is left; a <style> rule on the root’s font size makes them unconvertible', () => {
  const doc = (text: string) => {
    const r = parseDoc(text);
    assert.ok(r.ok);
    return r.doc;
  };
  const text = '<svg xmlns="http://www.w3.org/2000/svg" font-size="20"><rect x="1rem" width="2.5rem" height="10" style="stroke-width: .1rem"/><circle r="4"/><style>circle { r: 1rem }</style></svg>';
  const r = importReport(doc(text));
  assert.deepEqual(r.rem, { count: 3, convertible: true, why: null });
  assert.ok(r.notes.some((n) => n.startsWith('3 rem lengths: the canvas measures rem against the app’s 12 px root, not this file’s own 20 px')), r.notes.join('\n'));
  assert.ok(r.notes.includes('1 rem length inside <style> text is left as written.'));
  assert.deepEqual(importReport(doc('<svg xmlns="http://www.w3.org/2000/svg"><rect x="1"/></svg>')).rem, { count: 0, convertible: true, why: null });
  const ruled = importReport(doc('<svg xmlns="http://www.w3.org/2000/svg"><style>svg { font-size: 10px }</style><rect x="1rem"/></svg>'));
  assert.equal(ruled.rem.convertible, false);
  assert.match(ruled.rem.why!, /^The root’s font size is set by a <style> rule/);
});
