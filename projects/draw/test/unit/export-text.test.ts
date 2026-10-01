// Export's text choices for Clean (P1-M4 S2, src/export/svg.ts prepareExport), with the real fontkit in
// node and the faces' files from node_modules, on a drawing with a title and four texts: Inter 700, IBM
// Plex Sans 400, DM Serif Display 400 and Georgia.
// - As paths converts the three in Draw's fonts and keeps Georgia, saying why.
// - With fonts embeds Inter (the exact @font-face text, its base64 decoding to the package's file) in
//   one <style> right after the <title>; IBM Plex Sans ("Plex") and DM Serif Display ("Source") have
//   Reserved Font Names, so their texts are written as paths, saying so; Georgia stays text.
// - As-is and Save to Files are unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDoc, serialize, type Doc } from '../../../../engine/model/doc.ts';
import { exportFile, embeddable, keptAsText, notDraws, prepareExport, reservesName, type ExportDeps, type Prepared } from '../../src/export/svg.ts';
import { openFont, shape } from '../../src/text/outline-lib.ts';
import { LATIN_RANGE, catalogueFamily, faceFile, hasFace } from '../../src/platform/font-catalogue.ts';
import { NOT_HELD } from '../../../../engine/text/outline.ts';
import { cssAllowed } from '../../../../scripts/lib/svg-profile.mjs';

const file = (slug: string, name: string) => new Uint8Array(readFileSync(new URL(`../../node_modules/@fontsource/${slug}/files/${name}`, import.meta.url)));
// The editor's deps (editor.ts exportDeps), over the catalogue's files.
const deps: ExportDeps = {
  textDeps: (own) => ({
    lib: async () => ({ openFont, shape }),
    bytes: async (f) => {
      if (f.own !== null) return own[f.own]?.bytes ?? null;
      const c = catalogueFamily(f.family);
      return c ? file(c.slug, faceFile(c.slug, f.weight, f.style)) : null;
    },
    range: (f) => (f.own !== null ? (own[f.own]?.unicodeRange ?? null) : LATIN_RANGE),
  }),
  faces: (family) => catalogueFamily(family) ?? null,
  held: (f) => {
    const c = catalogueFamily(f.family);
    return c && hasFace(c, f.weight, f.style) ? { family: c.family, reserved: c.reserved, copyright: c.copyright, licence: null, format: 'woff2' } : null;
  },
};
const SRC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <title>Fonts</title>
  <text id="i" x="10" y="20" font-family="Inter, sans-serif" font-weight="700" font-size="12">Inter</text>
  <text id="p" x="10" y="40" font-family="IBM Plex Sans, sans-serif" font-size="12">Plex</text>
  <text id="d" x="10" y="60" font-family="DM Serif Display, serif" font-size="12">Serif</text>
  <text id="g" x="10" y="80" font-family="Georgia, serif" font-size="12">Georgia</text>
</svg>
`;
const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const text = (p: Prepared) => new TextDecoder().decode(p.file.bytes);
const prepared = async (choice: 'paths' | 'fonts'): Promise<Prepared> => {
  const out = await prepareExport(load(SRC), 'fonts', choice, deps);
  assert.ok(!('refused' in out), 'refused' in out ? out.refused : '');
  return out as Prepared;
};

test('As paths: the three texts in Draw’s fonts become paths keeping their ids and their characters as aria-labels; Georgia stays text, and the notes say why', async () => {
  const p = await prepared('paths');
  const out = text(p);
  for (const [id, label] of [['i', 'Inter'], ['p', 'Plex'], ['d', 'Serif']]) assert.match(out, new RegExp(`<path id="${id}" d="M [^"]+" aria-label="${label}"/>`), id);
  assert.match(out, /<text id="g" x="10" y="80" font-family="Georgia, serif" font-size="12">Georgia<\/text>/);
  assert.equal((out.match(/<text /g) ?? []).length, 1);
  assert.deepEqual(p.notes, [keptAsText(1, [NOT_HELD('Georgia')])]);
  assert.equal(p.file.kind, 'clean');
  assert.equal(p.file.fileName, 'fonts-clean.svg');
});

test('With fonts: one <style> right after the <title> embeds Inter 700 whole (its exact @font-face, after its copyright and licence comment, its base64 the package’s file); IBM Plex Sans and DM Serif Display, whose fonts reserve names, are written as paths, saying so; Georgia stays text; the served profile takes the <style>', async () => {
  const p = await prepared('fonts');
  const out = text(p);
  const style = /<title>Fonts<\/title>\n {2}<style>([^<]*)<\/style>\n {2}<text id="i"/.exec(out);
  assert.ok(style, `the <style> is the root's first element child after the <title>:\n${out.slice(0, 400)}`);
  const inter = Buffer.from(file('inter', 'inter-latin-700-normal.woff2')).toString('base64');
  assert.equal(style[1], `/* Inter. Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter). SIL Open Font License 1.1, https://openfontlicense.org */@font-face{font-family:'Inter';font-weight:700;font-style:normal;src:url(data:font/woff2;base64,${inter}) format('woff2')}`);
  assert.equal((out.match(/@font-face/g) ?? []).length, 1, 'one face: Inter 700, and no Plex or DM Serif');
  assert.match(out, /<text id="i" x="10" y="20" font-family="Inter, sans-serif" font-weight="700" font-size="12">Inter<\/text>/);
  assert.match(out, /<path id="p" d="M [^"]+" aria-label="Plex"\/>/);
  assert.match(out, /<path id="d" d="M [^"]+" aria-label="Serif"\/>/);
  assert.match(out, /<text id="g" [^>]*>Georgia<\/text>/);
  assert.deepEqual(p.notes, [reservesName('IBM Plex Sans', 'Plex'), reservesName('DM Serif Display', 'Source'), notDraws('Georgia')]);
  assert.equal(reservesName('IBM Plex Sans', 'Plex'), 'IBM Plex Sans reserves the name “Plex”, so its text is written as paths.');
  assert.ok(cssAllowed(style[1]), 'the served profile’s CSS guard takes it');
});

test('As-is and Save to Files are unchanged by the text choices; Clean as text is the clean file', async () => {
  const doc = load(SRC);
  assert.equal(new TextDecoder().decode(exportFile(doc, 'fonts', 'as-is').bytes), SRC);
  assert.equal(new TextDecoder().decode(exportFile(doc, 'fonts', 'working').bytes), serialize(doc));
  await prepareExport(doc, 'fonts', 'fonts', deps);
  assert.equal(serialize(doc), SRC, 'the drawing itself never changes');
  assert.match(new TextDecoder().decode(exportFile(doc, 'fonts', 'clean').bytes), /<text id="i"/);
});

test('embedding by OS/2 fsType: bitmapOnly never; editable always; otherwise only when neither noEmbedding nor viewOnly is set (noSubsetting doesn’t matter)', () => {
  assert.equal(embeddable(0), true);
  assert.equal(embeddable(0x2), false, 'noEmbedding');
  assert.equal(embeddable(0x4), false, 'viewOnly');
  assert.equal(embeddable(0x8), true, 'editable');
  assert.equal(embeddable(0x2 | 0x8), true, 'editable wins');
  assert.equal(embeddable(0x100), true, 'noSubsetting');
  assert.equal(embeddable(0x8 | 0x200), false, 'bitmapOnly');
});

test('a text library that won’t load refuses (the sheet falls back to As text)', async () => {
  const off: ExportDeps = { ...deps, textDeps: (own) => ({ ...deps.textDeps(own), lib: () => Promise.reject(new Error('offline')) }) };
  for (const choice of ['paths', 'fonts'] as const) {
    const out = await prepareExport(load(SRC), 'fonts', choice, off);
    assert.deepEqual(out, { refused: 'Draw couldn’t load the text tools. Try again when you’re online.' }, choice);
  }
});

test('the file’s own @font-face rules are kept as written in As paths and With fonts; its own face’s text is outlined from the file’s own bytes in As paths', async () => {
  const face = Buffer.from(file('space-grotesk', 'space-grotesk-latin-400-normal.woff2')).toString('base64');
  const style = `<style>@font-face{font-family:Own;src:url(data:font/woff2;base64,${face}) format("woff2")}</style>`;
  const src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  ${style}\n  <text id="o" x="10" y="50" font-family="Own, serif" font-size="12">Own</text>\n</svg>\n`;
  for (const choice of ['paths', 'fonts'] as const) {
    const out = await prepareExport(load(src), 'own', choice, deps);
    assert.ok(!('refused' in out), 'refused' in out ? out.refused : '');
    const t = text(out as Prepared);
    assert.ok(t.includes(`\n  ${style}\n`), `${choice}: the file’s own rule kept as written`);
    assert.equal((t.match(/@font-face/g) ?? []).length, 1, `${choice}: nothing added for the file’s own face`);
    if (choice === 'paths') assert.match(t, /<path id="o" d="M [^"]+" aria-label="Own"\/>/);
    else assert.match(t, /<text id="o" /, 'With fonts: its text stays text, drawn by its own face');
  }
});
