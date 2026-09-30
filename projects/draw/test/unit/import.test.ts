// The one importer (src/import.ts): bytes or text → decodeSvg → parseDoc → editor.open(doc) → the
// import report, driven through a real Editor over views that draw nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { importReport } from '../../../../engine/report/import-report.ts';
import { drawingName, importSvg } from '../../src/import.ts';
import { MAX_SVG_BYTES } from '../../src/platform/files.ts';
import { fileNameFor } from '../../src/export/svg.ts';
import { corpus, corpusBytes, fakeEditor, SAMPLE } from './fakes.ts';
import { parseDoc } from '../../../../engine/model/doc.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);

test('bytes open through the importer: plain, gzip (.svgz) and Latin-1, each with its report', async () => {
  const ed = fakeEditor();
  const ink = corpus('tools/inkscape-1x-layers.svg');
  const plain = await importSvg(ed, { via: 'file', name: 'layers.svg', bytes: corpusBytes('tools/inkscape-1x-layers.svg') });
  assert.ok(plain.ok, !plain.ok ? plain.message : '');
  assert.equal(ed.source(), ink, 'the editor holds the file, byte for byte');
  assert.equal(plain.name, 'layers');
  assert.deepEqual(plain.report, importReport(ed.doc!));
  assert.ok(plain.report.totals.kept > 0, "Inkscape's data is kept");

  const svgz = await importSvg(ed, { via: 'file', name: 'spin.svgz', bytes: new Uint8Array(gzipSync(corpusBytes('lab/spin--js.svg'))) });
  assert.ok(svgz.ok && svgz.gzip, 'a gzip file opens');
  assert.equal(ed.source(), corpus('lab/spin--js.svg'));
  assert.equal(svgz.name, 'spin');
  assert.ok(svgz.report.totals.preview > 0, 'its script is listed as preview-only');

  const latin = new Uint8Array([...utf8('<?xml version="1.0" encoding="ISO-8859-1"?>\n<svg xmlns="http://www.w3.org/2000/svg"><title>Caf'), 0xe9, ...utf8('</title></svg>')]);
  const l1 = await importSvg(ed, { via: 'drop', name: '', bytes: latin });
  assert.ok(l1.ok && l1.encoding === 'windows-1252', 'a Latin-1 file is decoded from its declaration');
  assert.ok(ed.source().includes('<title>Café</title>'));
  assert.equal(l1.name, 'Café', 'with no file name, the drawing is named by its <title>');
});

test('text opens the same way, before the first await (the sample opens synchronously on mount)', () => {
  const ed = fakeEditor();
  const pending = importSvg(ed, { via: 'sample', name: 'Sample', text: SAMPLE });
  assert.equal(ed.source(), SAMPLE, 'opened before the promise settles');
  return pending.then((r) => assert.ok(r.ok && r.name === 'Sample'));
});

test("a file that isn't well-formed never reaches the editor: it says what and where, carries its text for the source view, and the open drawing stays", async () => {
  const ed = fakeEditor();
  ed.open(SAMPLE);
  const bad = '<svg xmlns="http://www.w3.org/2000/svg">\n  <g>\n    <rect/>\n  </svg>\n';
  const r = await importSvg(ed, { via: 'paste', name: '', text: bad });
  assert.ok(!r.ok);
  assert.equal(r.message, '</svg> closes <g>');
  assert.deepEqual(r.source, { text: bad, at: bad.indexOf('</svg>') }, 'its text, for the read-only source view');
  assert.deepEqual([r.line, r.column], [4, 3]);
  assert.equal(r.excerpt!.text, '  </svg>');
  assert.equal(r.excerpt!.text.slice(r.excerpt!.at), '</svg>', 'the excerpt points at the failure');
  assert.equal(ed.source(), SAMPLE, 'the drawing that was open stays');

  const html = await importSvg(ed, { via: 'file', name: 'page.html', text: '<!-- a page -->\n<html xmlns="http://www.w3.org/1999/xhtml"/>' });
  assert.ok(!html.ok && /root element is <html>/.test(html.message) && html.line === 2, 'a root that is not <svg> is refused before the editor takes it');
  assert.equal(ed.source(), SAMPLE);

  const junk = await importSvg(ed, { via: 'file', name: 'broken.svgz', bytes: new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4]) });
  assert.ok(!junk.ok && /could not be read/.test(junk.message) && junk.line === null, 'a gzip that does not inflate says so');
  assert.equal(ed.source(), SAMPLE);
  assert.equal(html.source, null, 'a root that is not <svg> is not shown as source: it is well-formed');
});

test('a file a browser refuses (a bare &, an undefined entity, a duplicate attribute) opens as read-only source at the error', async () => {
  const ed = fakeEditor();
  ed.open(SAMPLE);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">';
  for (const [text, message, line, column, at] of [
    [`${svg}\n  <text>Fish & chips</text>\n</svg>\n`, 'a bare & (write &amp; for the character itself)', 2, 14, '&'],
    [`${svg}\n  <text>a&nbsp;b</text>\n</svg>\n`, 'the entity &nbsp; is not declared', 2, 10, '&nbsp;'],
    [`${svg}\n  <rect fill="red" fill="blue"/>\n</svg>\n`, 'attribute fill is written twice in <rect>', 2, 20, 'fill="blue"'],
  ] as const) {
    const r = await importSvg(ed, { via: 'file', name: 'x.svg', text });
    assert.ok(!r.ok, message);
    assert.equal(r.message, message);
    assert.deepEqual(r.source, { text, at: text.indexOf(at) }, `${message}: its text, for the read-only source view, and where it fails`);
    assert.deepEqual([r.line, r.column], [line, column], message);
    assert.equal(r.excerpt!.text.slice(r.excerpt!.at), text.slice(text.indexOf(at)).split('\n')[0], `${message}: the excerpt points at the failure`);
    assert.equal(ed.source(), SAMPLE, 'the drawing that was open stays');
  }
});

// A browser's parser stops at its first error, so Draw marks its first: a reference or namespace
// error before the place the lexer or the tree stops at is the one reported, in a tag the lexer
// stops inside and in text before a character XML doesn't allow too. Each case's line is
// Chromium's (P1-M0 review, F8).
test("a file with several errors opens as read-only source at the first, where a browser's parser stops", async () => {
  const ed = fakeEditor();
  ed.open(SAMPLE);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">';
  for (const [label, text, message, line, column] of [
    ['a bare & (line 2), then an attribute written twice (line 3)', `${svg}\n  <text>Fish & chips</text>\n  <rect width="4" height="4" fill="red" fill="blue"/>\n</svg>\n`, 'a bare & (write &amp; for the character itself)', 2, 14],
    ['an unbound prefix (line 2), then -- in a comment (line 3)', `${svg}\n  <p:g/>\n  <!-- a -- b -->\n</svg>\n`, 'the prefix p of <p:g> is not declared', 2, 4],
    ['an undeclared entity (line 2), then an unclosed tag (line 3)', `${svg}\n  <text>&nbsp;</text>\n  <g>\n</svg>\n`, 'the entity &nbsp; is not declared', 2, 9],
    ['in one tag, a reference (line 2), then an attribute written twice (line 4)', `${svg}\n  <rect id="&x;"\n        fill="red"\n        fill="blue"/>\n</svg>\n`, 'the entity &x; is not declared', 2, 13],
    ['in one text, a reference (line 2), then U+0001 (line 3)', `${svg}\n  <text>&x;\n    \u0001</text>\n</svg>\n`, 'the entity &x; is not declared', 2, 9],
  ] as const) {
    const r = await importSvg(ed, { via: 'file', name: 'x.svg', text });
    assert.ok(!r.ok, `${label}: opened`);
    assert.equal(r.message, message, label);
    assert.deepEqual([r.line, r.column], [line, column], label);
    assert.equal(r.source?.text, text, `${label}: its text, for the read-only source view`);
    assert.equal(ed.source(), SAMPLE, 'the drawing that was open stays');
  }
});

test("a well-formed file over Draw's limits opens nowhere, not even as source: it says so and where, and the open drawing stays", async () => {
  const ed = fakeEditor();
  ed.open(SAMPLE);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">';
  const deep = `${svg}\n${'<g>'.repeat(300)}${'</g>'.repeat(300)}</svg>`;
  const laughs = `<!DOCTYPE svg [<!ENTITY a "${'x'.repeat(1000)}"><!ENTITY b "${'&a;'.repeat(2000)}">]>\n${svg}<text>&b;</text></svg>`;
  const markup = `<!DOCTYPE svg [<!ENTITY r "<rect/>">]>\n${svg}&r;</svg>`;
  for (const [text, message, line] of [
    [deep, 'nesting deeper than 256 (over Draw’s limits)', 2],
    [laughs, 'entity expansion over 1000000 characters (over Draw’s limits)', 2],
    [markup, 'entity &r; expands to markup (over Draw’s limits)', 2],
  ] as const) {
    const r = await importSvg(ed, { via: 'file', name: 'big.svg', text });
    assert.ok(!r.ok, message);
    assert.equal(r.message, message);
    assert.equal(r.line, line, message);
    assert.equal(r.source, null, `${message}: never shown as source (it isn't "not well-formed")`);
    assert.equal(ed.source(), SAMPLE, 'the drawing that was open stays');
  }
});

test('a document the canvas refuses to draw is open, and says why', async () => {
  const ed = fakeEditor({ refuseRoot: true });
  const r = await importSvg(ed, { via: 'file', name: 'x.svg', text: SAMPLE });
  assert.ok(r.ok && r.problem === 'the canvas refused its root <svg>');
  assert.equal(ed.source(), SAMPLE);
});

test("a drawing's name: the file's without .svg or .svgz, else its <title>, else the way it came", () => {
  assert.equal(drawingName('Logo Final.SVG', null, 'file'), 'Logo Final');
  assert.equal(drawingName('icon.svgz', null, 'drop'), 'icon');
  assert.equal(drawingName('', null, 'paste'), 'Pasted drawing');
  assert.equal(drawingName('', null, 'link'), 'Linked drawing');
  assert.equal(drawingName('', null, 'new'), 'Untitled');
});

test('a picked or dropped file is read by the importer: one too large is refused unread, and one that fails to read says so', async () => {
  const ed = fakeEditor();
  ed.open(SAMPLE);
  const ok = await importSvg(ed, { via: 'file', name: 'logo.svg', file: new Blob([new Uint8Array(corpusBytes('tools/inkscape-plain-svg.svg'))]) });
  assert.ok(ok.ok && ok.name === 'logo' && ed.source() === corpus('tools/inkscape-plain-svg.svg'));
  ed.open(SAMPLE);
  const big = await importSvg(ed, { via: 'drop', name: 'huge.svg', file: { size: MAX_SVG_BYTES + 1, arrayBuffer: () => assert.fail('it was read') } as unknown as Blob });
  assert.ok(!big.ok && big.message === 'the file is larger than 20 MB' && big.name === 'huge', !big.ok ? big.message : '');
  const gone = await importSvg(ed, { via: 'file', name: 'moved.svg', file: { size: 10, arrayBuffer: async () => { throw new DOMException('The file changed on disk.', 'NotReadableError'); } } as unknown as Blob });
  assert.ok(!gone.ok && gone.message === 'it could not be read (The file changed on disk)', !gone.ok ? gone.message : '');
  assert.equal(ed.source(), SAMPLE, 'the drawing that was open stays');
});

test('a BOM is not a column: a failure on line 1 of a file with one is placed as without it', async () => {
  const ed = fakeEditor();
  const bad = '\uFEFF<svg xmlns="http://www.w3.org/2000/svg"><g></svg>';
  const r = await importSvg(ed, { via: 'file', name: 'x.svg', bytes: new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(bad.slice(1))]) });
  const plain = await importSvg(ed, { via: 'file', name: 'x.svg', text: bad.slice(1) });
  assert.ok(!r.ok && !plain.ok);
  assert.deepEqual([r.line, r.column], [plain.line, plain.column]);
  assert.deepEqual(r.excerpt, plain.excerpt, 'and the excerpt has no BOM in it');
});

test('a drawing name drops format characters, so it shows what it saves as', () => {
  const doc = parseDoc('<svg xmlns="http://www.w3.org/2000/svg"><title>invoice\u202Egnp</title></svg>');
  assert.ok(doc.ok);
  assert.equal(drawingName('', doc.doc, 'paste'), 'invoicegnp');
  assert.equal(drawingName('re\u200Bport\u2066.svg', null, 'file'), 'report');
  assert.equal(fileNameFor('invoice\u202Egnp'), 'invoicegnp.svg', 'nor does an export file name (a draft named before this)');
});

test('bytes that are not valid in their encoding open, and the report says an as-is export writes � there', async () => {
  const ed = fakeEditor();
  const r = await importSvg(ed, { via: 'file', name: 'x.svg', bytes: new Uint8Array([...utf8('<svg xmlns="http://www.w3.org/2000/svg"><text>Caf'), 0xe9, ...utf8('</text></svg>')]) });
  assert.ok(r.ok && r.lossy && r.encoding === 'utf-8');
  assert.equal(r.report.notes[0], 'Some bytes in the file aren’t valid UTF-8: they show as �, and an as-is export writes � there too.');
  const clean = await importSvg(ed, { via: 'file', name: 'x.svg', bytes: corpusBytes('tools/inkscape-plain-svg.svg') });
  assert.ok(clean.ok && !clean.lossy && !clean.report.notes.some((n) => /aren’t valid/.test(n)));
  const pasted = await importSvg(ed, { via: 'paste', name: '', text: SAMPLE });
  assert.ok(pasted.ok && pasted.encoding === null, 'text that came as text has no encoding of its own');
});

test("a file that isn't markup (a PNG, a text file) says so, with no line and column over its bytes", async () => {
  const ed = fakeEditor();
  ed.open(SAMPLE);
  const png = await importSvg(ed, { via: 'file', name: 'photo.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]) });
  assert.ok(!png.ok && png.message === 'this isn’t an SVG file' && png.line === null && png.excerpt === null);
  const txt = await importSvg(ed, { via: 'paste', name: '', text: 'just some words' });
  assert.ok(!txt.ok && txt.message === 'this isn’t an SVG file');
  const spaced = await importSvg(ed, { via: 'paste', name: '', text: '\uFEFF\n  <svg xmlns="http://www.w3.org/2000/svg"/>' });
  assert.ok(spaced.ok, 'a BOM and blank space before the markup are fine');
  assert.equal(ed.source(), '\uFEFF\n  <svg xmlns="http://www.w3.org/2000/svg"/>');
});
