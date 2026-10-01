// engine/access/metadata.ts: the Access tab's Metadata. SVG Lab's bare markup on lab/access.svg, after
// its <desc>; an RDF file (tools/inkscape-1x-layers.svg) gaining dc:creator and dc:date inside its
// cc:Work, its dc:title edited in place; Matplotlib's dc:creator holding cc:Agent/dc:title
// (tools/matplotlib-line-plot.svg) edited at that title; a fixture declaring dcterms and the legacy cc
// namespace kept byte for byte through an Access edit, served by the profile, never drawn; Draw's own
// draw:made <metadata> shared, and dropped by the exports when nothing of the file's is left in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NS, parseDoc, serialize, type Doc } from '../../model/doc.ts';
import { Session } from '../../commands/session.ts';
import { CC_LEGACY, DCTERMS, metaOf, metadataOn, planMetaText, planMetadata } from '../../access/metadata.ts';
import { planDrawingTitle } from '../../access/model.ts';
import { stripDrawState } from '../../model/draw-state.ts';
import { elementRenders } from '../../policy/render-policy.ts';
import { checkSvg } from '../../../scripts/lib/svg-profile.mjs';

const corpus = (rel: string) => readFileSync(new URL(`../fixtures/corpus/${rel}`, import.meta.url), 'utf8');
const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const LAB = { creator: 'You', date: '2026-09-25' };
// SVG Lab's markup as its code writes it (buildCode: a <metadata> isn't inline, so each child is on a
// line of its own, two spaces deeper).
const DC_MARKUP = '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:creator>You</dc:creator>\n    <dc:date>2026-09-25</dc:date>\n  </metadata>';

test('Metadata on, on lab/access.svg, writes SVG Lab’s bare markup after the <desc>, before the drawing; off takes it away again; one undo gives the bytes back', () => {
  const src = corpus('lab/access.svg');
  const doc = load(src);
  const s = new Session(doc);
  assert.equal(metadataOn(doc), false);
  s.dispatch('Metadata', (apply) => planMetadata(doc, true, LAB, apply));
  const desc = '<desc id="chart-desc">Bar chart. Visitors rose from 40 in January to 88 in April.</desc>';
  assert.equal(serialize(doc), src.replace(desc, `${desc}\n  ${DC_MARKUP}`));
  assert.deepEqual(metaOf(doc).items.map((i) => [i.key, i.text]), [['dc:creator', 'You'], ['dc:date', '2026-09-25']]);
  s.dispatch('Metadata', (apply) => planMetadata(doc, false, LAB, apply));
  assert.equal(serialize(doc), src, 'off: the items, and the <metadata> holding nothing else');
  s.undo();
  s.undo();
  assert.equal(serialize(doc), src);
  // Before the first element when there's no title or description; in the root's prefix.
  const bare = load('<s:svg xmlns:s="http://www.w3.org/2000/svg">\n  <s:rect/>\n</s:svg>');
  new Session(bare).dispatch('m', (apply) => planMetadata(bare, true, LAB, apply));
  assert.equal(serialize(bare), `<s:svg xmlns:s="http://www.w3.org/2000/svg">\n  <s:metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:creator>You</dc:creator>\n    <dc:date>2026-09-25</dc:date>\n  </s:metadata>\n  <s:rect/>\n</s:svg>`);
  // A file on one line: all on one line; a tab-indented file: its tabs.
  const flat = load('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  new Session(flat).dispatch('m', (apply) => planMetadata(flat, true, LAB, apply));
  assert.equal(serialize(flat), '<svg xmlns="http://www.w3.org/2000/svg"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>You</dc:creator><dc:date>2026-09-25</dc:date></metadata><rect/></svg>');
  const tabs = load('<svg xmlns="http://www.w3.org/2000/svg">\r\n\t<title>T</title>\r\n</svg>');
  new Session(tabs).dispatch('m', (apply) => planMetadata(tabs, true, LAB, apply));
  assert.equal(serialize(tabs), '<svg xmlns="http://www.w3.org/2000/svg">\r\n\t<title>T</title>\r\n\t<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\r\n\t\t<dc:creator>You</dc:creator>\r\n\t\t<dc:date>2026-09-25</dc:date>\r\n\t</metadata>\r\n</svg>');
});

test('Metadata on then off keeps a file’s own <metadata> that holds a comment, text, CDATA or a processing instruction but no element, with all of it (only the dc declaration on added stays); an empty <metadata></metadata> (or one of whitespace) is still taken away by on then off, as before, since nothing of the file’s is lost', () => {
  for (const inner of ['<!-- made by hand, keep -->', 'Created with Hand Tools 2.1', '\n  <!-- a --> text <![CDATA[ x ]]>\n', '<![CDATA[x]]>', '<?app keep?>', '\n  <!-- kept -->\n']) {
    const src = `<svg xmlns="http://www.w3.org/2000/svg"><metadata>${inner}</metadata><rect width="1" height="1"/></svg>`;
    const doc = load(src);
    const s = new Session(doc);
    s.dispatch('on', (apply) => planMetadata(doc, true, LAB, apply));
    assert.match(serialize(doc), /<dc:creator>You<\/dc:creator>/, JSON.stringify(inner));
    s.dispatch('off', (apply) => planMetadata(doc, false, LAB, apply));
    assert.equal(serialize(doc), src.replace('<metadata>', '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'), `${JSON.stringify(inner)}: on then off`);
    s.undo();
    s.undo();
    assert.equal(serialize(doc), src);
  }
  for (const inner of ['', '\n  ']) {
    const doc = load(`<svg xmlns="http://www.w3.org/2000/svg"><metadata>${inner}</metadata><rect width="1" height="1"/></svg>`);
    const s = new Session(doc);
    s.dispatch('on', (apply) => planMetadata(doc, true, LAB, apply));
    s.dispatch('off', (apply) => planMetadata(doc, false, LAB, apply));
    assert.equal(serialize(doc), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>', `${JSON.stringify(inner)}: nothing of the file’s in it`);
  }
});

test('an RDF file (tools/inkscape-1x-layers.svg): dc:creator and dc:date go inside its cc:Work, indented as it is, dc declared already; its dc:title is shown and edited in place; off takes away what the tab shows and keeps the rest', () => {
  const src = corpus('tools/inkscape-1x-layers.svg');
  const doc = load(src);
  assert.deepEqual(metaOf(doc).items.map((i) => [i.key, i.text]), [['dc:title', 'Poster']]);
  const s = new Session(doc);
  s.dispatch('Metadata', (apply) => planMetadata(doc, true, LAB, apply));
  const license = '        <cc:license\n           rdf:resource="http://creativecommons.org/publicdomain/zero/1.0/" />\n';
  assert.equal(serialize(doc), src.replace(`${license}      </cc:Work>`, `${license}        <dc:creator>You</dc:creator>\n        <dc:date>2026-09-25</dc:date>\n      </cc:Work>`));
  const title = metaOf(doc).items.find((i) => i.key === 'dc:title')!;
  s.dispatch('Title', (apply) => planMetaText(doc, title, 'Big poster', apply));
  assert.ok(serialize(doc).includes('        <dc:title>Big poster</dc:title>\n'));
  s.dispatch('Metadata', (apply) => planMetadata(doc, false, LAB, apply));
  const out = serialize(doc);
  assert.ok(!/<dc:(creator|date|title)>/.test(out) && out.includes('<dc:format>image/svg+xml</dc:format>') && out.includes('<cc:license'), 'off: the shown items go; dc:format, dc:type and the licence stay');
  s.undo();
  s.undo();
  s.undo();
  assert.equal(serialize(doc), src);
});

test('Matplotlib’s dc:creator holding cc:Agent/dc:title (tools/matplotlib-line-plot.svg) is read and edited at that title; on adds nothing to a file that has a creator and a date', () => {
  const src = corpus('tools/matplotlib-line-plot.svg');
  const doc = load(src);
  const items = metaOf(doc).items;
  assert.deepEqual(items.map((i) => [i.key, i.text]), [['dc:date', '2026-01-15T09:30:00'], ['dc:creator', 'Matplotlib v3.8.2, https://matplotlib.org/']]);
  const s = new Session(doc);
  s.dispatch('on', (apply) => planMetadata(doc, true, LAB, apply));
  assert.equal(serialize(doc), src, 'nothing to add');
  s.dispatch('Creator', (apply) => planMetaText(doc, items[1], 'Mark & co', apply));
  assert.equal(serialize(doc), src.replace('<dc:title>Matplotlib v3.8.2, https://matplotlib.org/</dc:title>', '<dc:title>Mark &amp; co</dc:title>'));
});

test('a fixture declaring dcterms and the legacy cc namespace: its items are read, kept byte for byte through an Access edit, served by the profile, and never drawn', () => {
  const src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <metadata>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cc="${CC_LEGACY}" xmlns:dcterms="${DCTERMS}">
      <cc:Work rdf:about="">
        <dcterms:created>2020-01-01</dcterms:created>
        <cc:license rdf:resource="http://web.resource.org/cc/PublicDomain"/>
      </cc:Work>
    </rdf:RDF>
  </metadata>
  <rect width="5" height="5"/>
</svg>
`;
  const doc = load(src);
  assert.deepEqual(metaOf(doc).items.map((i) => [i.key, i.text]), [['dcterms:created', '2020-01-01']]);
  new Session(doc).dispatch('Title', (apply) => planDrawingTitle(doc, 'Plan', apply));
  const out = serialize(doc);
  const block = src.slice(src.indexOf('  <metadata>'), src.indexOf('  <rect'));
  assert.ok(out.includes(block), 'the metadata, byte for byte');
  assert.deepEqual(checkSvg(out), [], 'served');
  for (const [ns, local] of [[DCTERMS, 'created'], [CC_LEGACY, 'Work'], [CC_LEGACY, 'license'], ['http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'RDF']]) assert.equal(elementRenders(ns, local, false), false, `${local} never drawn`);
  assert.equal(elementRenders(NS.svg, 'metadata', false), true, 'the <metadata> holding them is placed, and the browser draws nothing for it');
});

test('Draw’s own <metadata draw:made> is shared: the items go into it, the exports keep it while the file’s items are in it, and drop it when nothing of the file’s is left', () => {
  const src = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:draw="https://mmaggitti.github.io/draw/ns" viewBox="0 0 100 100">\n  <metadata draw:made="true"><draw:state version="1" grid="10"/></metadata>\n  <rect width="5" height="5"/>\n</svg>';
  const doc = load(src);
  const s = new Session(doc);
  s.dispatch('on', (apply) => planMetadata(doc, true, LAB, apply));
  assert.equal(serialize(doc), src.replace('<draw:state version="1" grid="10"/></metadata>', '<draw:state version="1" grid="10"/><dc:creator>You</dc:creator><dc:date>2026-09-25</dc:date></metadata>').replace('<metadata draw:made="true">', '<metadata draw:made="true" xmlns:dc="http://purl.org/dc/elements/1.1/">'), 'one <metadata>, shared');
  assert.equal(stripDrawState(doc), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>You</dc:creator><dc:date>2026-09-25</dc:date></metadata>\n  <rect width="5" height="5"/>\n</svg>', 'the export keeps the file’s items');
  s.dispatch('off', (apply) => planMetadata(doc, false, LAB, apply));
  assert.ok(serialize(doc).includes('<draw:state version="1" grid="10"/>'), 'Draw’s state stays');
  assert.equal(stripDrawState(doc), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <rect width="5" height="5"/>\n</svg>', 'nothing of the file’s left: the export drops it');
});
