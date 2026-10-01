// Text to path's pipeline (P1-M4 S2) with the real fontkit in node, over the catalogue's own files:
// "Hello" outlines in each of the ten families' 400 faces; a character outside a face refuses (outside
// its latin unicode-range, or with no glyph); Bebas Neue at 700 refuses (no bold face); and what is
// read is the .woff2 the canvas registers (Archivo's differs from its .woff), each face once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openFont, shape } from '../../src/text/outline-lib.ts';
import { CATALOGUE, LATIN_RANGE, catalogueFamily, faceFile } from '../../src/platform/font-catalogue.ts';
import { EMPTY, OFFLINE, cantOutline, faceUnloaded, faceUnreadable, outlineTexts, type Outlined, type TextDeps } from '../../src/text/pipeline.ts';
import type { TextLib } from '../../src/text/load.ts';
import { NO_FACE, NO_GLYPH, outlineText, type OutlineText } from '../../../../engine/text/outline.ts';
import { descendants, parseDoc, type Doc, type ElementNode } from '../../../../engine/model/doc.ts';

const file = (slug: string, name: string) => new Uint8Array(readFileSync(new URL(`../../node_modules/@fontsource/${slug}/files/${name}`, import.meta.url)));
const ctx = { faces: (family: string) => catalogueFamily(family) ?? null };
// The faces' files as the app fetches them: the catalogue's file for the face (font-files.ts by faceFile).
const read: string[] = [];
const deps = (over: Partial<TextDeps> = {}): TextDeps => ({
  lib: async () => ({ openFont, shape }),
  bytes: async (f) => {
    const c = catalogueFamily(f.family)!;
    read.push(faceFile(c.slug, f.weight, f.style));
    return file(c.slug, faceFile(c.slug, f.weight, f.style));
  },
  range: () => LATIN_RANGE,
  ...over,
});
const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const texts = (doc: Doc): ElementNode[] => [...descendants(doc, doc.root)].filter((n): n is ElementNode => n.kind === 'element' && n.local === 'text');
const outlines = (body: string): OutlineText[] => {
  const doc = load(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`);
  return texts(doc).map((t) => {
    const r = outlineText(doc, t.id, ctx);
    assert.ok(!('refused' in r), 'refused' in r ? r.refused : '');
    return r as OutlineText;
  });
};
const results = async (body: string, over?: Partial<TextDeps>): Promise<Outlined[]> => {
  const out = await outlineTexts(outlines(body), deps(over));
  assert.ok(Array.isArray(out), !Array.isArray(out) ? out.refused : '');
  return out as Outlined[];
};

test('"Hello" outlines in each of the ten families’ 400 faces without throwing (fontkit, from the catalogue’s .woff2)', async () => {
  const ten = CATALOGUE.filter((f) => f.weights.includes(400));
  assert.equal(ten.length, 10);
  read.length = 0;
  const body = ten.map((f, i) => `<text x="10" y="${10 + 8 * i}" font-family="${f.family}" font-size="8">Hello</text>`).join('');
  const out = await results(body);
  out.forEach((o, i) => {
    assert.ok('d' in o, `${ten[i].family}: ${'refused' in o ? o.refused : ''}`);
    assert.match((o as { d: string }).d, /^M -?\d[\d.]* -?\d[\d.]* [LQC] /, ten[i].family);
    assert.ok((o as { d: string }).d.split('M ').length >= 6, `${ten[i].family}: at least one contour a letter`);
  });
  assert.deepEqual(read, ten.map((f) => faceFile(f.slug, 400, 'normal')), 'each face read once, in the order the texts use them');
});

test('a character a face can’t draw refuses, naming it: outside the face’s latin unicode-range (ő), or with no glyph in the file (日, for a face of yours with no range)', async () => {
  const [o] = await results('<text x="1" y="9" font-family="Archivo" font-size="10">Gő</text>');
  assert.deepEqual(o, { refused: NO_GLYPH('Archivo', 'ő') });
  assert.equal(NO_GLYPH('Archivo', 'ő'), 'Archivo has no glyph for “ő”.');
  const [n] = await results('<text x="1" y="9" font-family="Inter" font-size="10">a日b</text>', { range: () => null });
  assert.deepEqual(n, { refused: NO_GLYPH('Inter', '日') }, 'left on .notdef: never outlined as its box');
});

test('Bebas Neue at 700 refuses before anything loads (it has no bold face: the canvas draws a synthetic one)', () => {
  const doc = load('<svg xmlns="http://www.w3.org/2000/svg"><text font-family="Bebas Neue" font-weight="700">A</text></svg>');
  assert.deepEqual(outlineText(doc, texts(doc)[0].id, ctx), { refused: NO_FACE('Bebas Neue', 700, 'normal') });
});

test('what is read is the .woff2 the canvas registers: Archivo’s outlines come from it, not from its .woff (eight of their printable glyphs differ, $?@MNWas; their advances agree)', async () => {
  read.length = 0;
  const [o] = await results('<text x="0" y="50" font-family="Archivo" font-size="50">Was</text>');
  assert.deepEqual(read, ['archivo-latin-400-normal.woff2']);
  const by = (bytes: Uint8Array) => shape(bytes, ['a']).runs[0].glyphs[0];
  const two = by(file('archivo', 'archivo-latin-400-normal.woff2'));
  const one = by(file('archivo', 'archivo-latin-400-normal.woff'));
  assert.equal(two.xAdvance, one.xAdvance, 'test setup: the advances agree');
  assert.notDeepEqual(two.commands, one.commands, 'test setup: the outlines differ');
  const [fromWoff] = await results('<text x="0" y="50" font-family="Archivo" font-size="50">Was</text>', { bytes: async () => file('archivo', 'archivo-latin-400-normal.woff') });
  assert.notEqual((o as { d: string }).d, (fromWoff as { d: string }).d, 'the .woff would outline another Was');
});

test('the library that won’t load refuses everything (OFFLINE); a face whose file can’t be had refuses its texts only; spaces alone draw nothing', async () => {
  const two = outlines('<text x="1" y="9" font-family="Inter" font-size="10">a</text><text x="1" y="19" font-family="Fraunces" font-size="10">b</text>');
  assert.deepEqual(await outlineTexts(two, deps({ lib: () => Promise.reject(new Error('offline')) })), { refused: OFFLINE });
  const out = (await outlineTexts(two, deps({ bytes: async (f) => (f.family === 'Fraunces' ? null : file('inter', 'inter-latin-400-normal.woff2')) }))) as Outlined[];
  assert.ok('d' in out[0]);
  assert.deepEqual(out[1], { refused: faceUnloaded('Fraunces') });
  const [sp] = await results('<text x="1" y="9" font-family="Inter" font-size="10" xml:space="preserve">   </text>');
  assert.deepEqual(sp, { refused: EMPTY });
});

// A text library that reads any file as a face of this unitsPerEm: one box per character, `advance` wide.
const stubLib = (unitsPerEm: number, advance = 500): TextLib => ({
  openFont,
  shape: (_bytes, runs) => ({
    unitsPerEm,
    runs: runs.map((t) => ({ glyphs: [...t].map(() => ({ commands: [{ command: 'moveTo', args: [0, 0] }, { command: 'lineTo', args: [advance, 0] }, { command: 'lineTo', args: [advance, 700] }, { command: 'closePath', args: [] }], xAdvance: advance, xOffset: 0, yOffset: 0 })), missing: [] })),
  }),
});

test('a face whose unitsPerEm is outside 16 to 16384 is unreadable (0, 15, 16385, 1.5 refuse, saying so); 16 and 16384 outline; glyph numbers that can’t be written (a NaN advance) refuse the text, naming it', async () => {
  const one = outlines('<text x="1" y="9" font-family="Inter" font-size="10">Hello</text>');
  for (const u of [0, 15, 16385, 1.5]) assert.deepEqual(await outlineTexts(one, deps({ lib: async () => stubLib(u) })), [{ refused: faceUnreadable('Inter') }], `unitsPerEm ${u}`);
  for (const u of [16, 16384]) {
    const [o] = (await outlineTexts(one, deps({ lib: async () => stubLib(u) }))) as Outlined[];
    assert.ok('d' in o, `unitsPerEm ${u}: ${'refused' in o ? o.refused : ''}`);
  }
  assert.deepEqual(await outlineTexts(one, deps({ lib: async () => stubLib(1000, NaN) })), [{ refused: cantOutline('Hello') }]);
  assert.equal(cantOutline('Hello'), 'Draw can’t outline “Hello”.');
  assert.equal(cantOutline('x'.repeat(41)), `Draw can’t outline “${'x'.repeat(40)}…”.`, 'its first 40 characters');
});
