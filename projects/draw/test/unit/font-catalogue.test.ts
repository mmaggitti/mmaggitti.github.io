// Draw's fonts (P1-M4): the catalogue against its packages: every face's file exists, no latin face is
// left out, each generic is its package's category, the reserved names are the upstream licences'.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { CATALOGUE, LATIN_RANGE, TEXT_DEFAULTS, catalogueFamily, faceFile } from '../../src/platform/font-catalogue.ts';

const MODULES = new URL('../../node_modules/', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };

test('the catalogue: each family’s every latin .woff2 face, upright and italic, and no other; each from its exactly pinned @fontsource package; 110 faces', () => {
  let faces = 0;
  for (const f of CATALOGUE) {
    assert.equal(pkg.dependencies[`@fontsource/${f.slug}`], '5.3.0', `${f.family}: its package pinned exactly`);
    const files = readdirSync(new URL(`@fontsource/${f.slug}/files/`, MODULES)).filter((n) => new RegExp(`^${f.slug}-latin-\\d+-(normal|italic)\\.woff2$`).test(n)).sort();
    const listed = [...f.weights.map((w) => faceFile(f.slug, w, 'normal')), ...f.italics.map((w) => faceFile(f.slug, w, 'italic'))].sort();
    assert.deepEqual(listed, files, `${f.family}: the catalogue lists exactly the package's latin faces`);
    faces += listed.length;
  }
  assert.equal(faces, 110);
  assert.equal(new Set(CATALOGUE.map((f) => f.family.toLowerCase())).size, CATALOGUE.length, 'no family twice');
});

test('each family’s generic is its package’s category (handwriting as cursive); its copyright line is its LICENSE’s first; the latin range is the packages’ own', () => {
  for (const f of CATALOGUE) {
    const meta = JSON.parse(readFileSync(new URL(`@fontsource/${f.slug}/metadata.json`, MODULES), 'utf8')) as { category: string };
    assert.equal(f.generic, meta.category === 'handwriting' ? 'cursive' : meta.category, f.family);
    const licence = readFileSync(new URL(`@fontsource/${f.slug}/LICENSE`, MODULES), 'utf8');
    assert.ok(licence.startsWith(f.copyright), `${f.family}: its copyright line`);
    const css = readFileSync(new URL(`@fontsource/${f.slug}/400.css`, MODULES), 'utf8');
    const latin = css.slice(css.indexOf(`/* ${f.slug}-latin-400-normal */`)).split('}')[0];
    assert.ok(latin.replace(/\s+/g, '').includes(`unicode-range:${LATIN_RANGE};`), `${f.family}: the latin range`);
  }
});

test('the Reserved Font Names: IBM Plex Mono and IBM Plex Sans reserve "Plex" (IBM’s licence; @fontsource’s leaves it out), DM Serif Display "Source"; the rest none; the Text tool’s two choices are catalogue families', () => {
  const reserved = Object.fromEntries(CATALOGUE.map((f) => [f.family, f.reserved]));
  assert.deepEqual(reserved, {
    Archivo: [], 'IBM Plex Mono': ['Plex'], Inter: [], 'IBM Plex Sans': ['Plex'], 'Space Grotesk': [], 'Bebas Neue': [], Fraunces: [], 'DM Serif Display': ['Source'], Caveat: [], 'JetBrains Mono': [],
  });
  assert.ok(!/Reserved Font Name/.test(readFileSync(new URL('@fontsource/ibm-plex-sans/LICENSE', MODULES), 'utf8').split('\n')[0]), 'the @fontsource LICENSE leaves Plex out: the catalogue is where Draw knows it');
  assert.deepEqual(TEXT_DEFAULTS, ['Archivo', 'Inter']);
  for (const t of TEXT_DEFAULTS) assert.ok(catalogueFamily(t), t);
});
