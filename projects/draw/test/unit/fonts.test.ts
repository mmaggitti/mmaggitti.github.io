// src/platform/fonts.ts (P1-M4), with a fake FontFace and document.fonts, fake fetches and memoryKV():
// use registers exactly the faces asked for, each once, the drawing's own first; a failed fetch is
// forgotten; documentFaces replaces the set and [] empties it; the name guard against both ds.css
// stacks, the generics and the CSS-wide keywords; your fonts added, refused, stored, listed,
// removed, a full quota loud, and the drafts list still skipping them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE, LATIN_RANGE, faceFile } from '../../src/platform/font-catalogue.ts';
import { DraftStore, memoryKV, type KV } from '../../src/platform/drafts.ts';
import { ADD_REFUSED, FONT_PREFIX, FONTS_FULL, FontError, MAX_FONT_BYTES, UNREADABLE, appFontName, couldNotLoad, createFonts, namedLikeApp, reservedNames, sniffFont, type FaceLike, type FontDeps, type FontEvent } from '../../src/platform/fonts.ts';
import { familyList, type OwnFace } from '../../../../engine/text/font-faces.ts';
import type { FontInfo } from '../../src/text/load.ts';

class FakeFace implements FaceLike {
  readonly family: string;
  readonly bytes: ArrayBuffer;
  readonly descriptors: Record<string, string>;
  constructor(family: string, bytes: ArrayBuffer, descriptors: Record<string, string>) {
    this.family = family;
    this.bytes = bytes;
    this.descriptors = descriptors;
  }
  load(): Promise<unknown> {
    return new TextDecoder().decode(this.bytes) === 'broken' ? Promise.reject(new Error('bad font')) : Promise.resolve(this);
  }
}

const URLS = Object.fromEntries(CATALOGUE.flatMap((f) => [...f.weights.map((w) => faceFile(f.slug, w, 'normal')), ...f.italics.map((w) => faceFile(f.slug, w, 'italic'))]).map((n) => [n, `/assets/${n}`]));

function rig(over: Partial<FontDeps> = {}) {
  const set = new Set<FakeFace>();
  const fetches: string[] = [];
  const failing = new Set<string>();
  const events: FontEvent[] = [];
  const info = new Map<string, FontInfo>();
  const deps: FontDeps = {
    makeFace: (family, bytes, descriptors) => new FakeFace(family, bytes, descriptors),
    set: { add: (f) => set.add(f as FakeFace), delete: (f) => set.delete(f as FakeFace) },
    fetchBytes: async (url) => {
      fetches.push(url);
      if (failing.has(url)) throw new Error('offline');
      return new TextEncoder().encode(`bytes of ${url}`).buffer;
    },
    urls: async () => URLS,
    kv: memoryKV(),
    sha256: async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()))].map((b) => b.toString(16).padStart(2, '0')).join(''),
    openFont: async (bytes) => {
      const i = info.get(new TextDecoder().decode(bytes));
      if (!i) throw new Error('not a font');
      return i;
    },
    now: () => 1000,
    ...over,
  };
  const fonts = createFonts(deps);
  fonts.subscribe((e) => events.push(e));
  const faces = () => [...set].map((f) => `${f.family} ${f.descriptors.weight} ${f.descriptors.style}${f.descriptors.unicodeRange === LATIN_RANGE ? ' latin' : ''}`).sort();
  return { fonts, set, fetches, failing, events, info, deps, faces };
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};
const own = (family: string, text = 'own bytes', weight = 'normal'): OwnFace => ({ family, weight, style: 'normal', stretch: 'normal', unicodeRange: 'U+0-10FFFF', format: 'woff2', bytes: new TextEncoder().encode(text), styleId: 1 });
const fontFile = (text: string, head = 'wOF2') => new Blob([new TextEncoder().encode(head + text)]);
const INFO = (family: string, weight = 400, italic = false, copyright = 'Copyright 2020 Someone', licence = 'SIL Open Font License 1.1'): FontInfo => ({ family, subfamily: 'Regular', weight, italic, fsType: 0, copyright, licence });

test('use registers exactly the faces asked for, each once (the catalogue’s latin file, its range, fetched once), the drawing’s own first; a family Draw holds no file for, or a weight it has no face at, registers nothing', async () => {
  const r = rig();
  r.fonts.documentFaces([own('Archivo')]);
  r.fonts.use([{ family: 'Inter', weight: 700, style: 'normal' }, { family: 'inter', weight: 700, style: 'normal' }, { family: 'Archivo', weight: 400, style: 'normal' }, { family: 'Georgia', weight: 400, style: 'normal' }, { family: 'Bebas Neue', weight: 700, style: 'normal' }]);
  r.fonts.use([{ family: 'Inter', weight: 700, style: 'normal' }]);
  await settle();
  assert.deepEqual(r.fetches, ['/assets/inter-latin-700-normal.woff2'], 'one file, once: Archivo is the drawing’s own, Georgia isn’t Draw’s, Bebas Neue has no bold');
  assert.deepEqual(r.faces(), ['Archivo normal normal', 'Inter 700 normal latin']);
  assert.ok(r.events.some((e) => e.kind === 'loaded'), 'a listener hears the face arrive');
  r.fonts.use([{ family: 'Fraunces', weight: 700, style: 'italic' }]);
  await settle();
  assert.deepEqual(r.fetches.slice(1), ['/assets/fraunces-latin-700-italic.woff2']);
});

test('a failed fetch is forgotten, says why, and the next use tries again', async () => {
  const r = rig();
  r.failing.add('/assets/caveat-latin-400-normal.woff2');
  r.fonts.use([{ family: 'Caveat', weight: 400, style: 'normal' }]);
  await settle();
  assert.deepEqual(r.faces(), []);
  assert.deepEqual(r.events.filter((e) => e.kind === 'failed'), [{ kind: 'failed', family: 'Caveat' }]);
  assert.equal(couldNotLoad('Caveat'), 'Draw couldn’t load Caveat. Try again when you’re online.');
  r.failing.clear();
  r.fonts.use([{ family: 'Caveat', weight: 400, style: 'normal' }]);
  await settle();
  assert.deepEqual(r.fetches, ['/assets/caveat-latin-400-normal.woff2', '/assets/caveat-latin-400-normal.woff2']);
  assert.deepEqual(r.faces(), ['Caveat 400 normal latin']);
});

test('documentFaces replaces the drawing’s own faces (their descriptors as written), never registers one the name guard refuses, drops one that fails to load, and [] empties it', async () => {
  const r = rig();
  r.fonts.documentFaces([own('Own', 'a', '700'), own('Arial'), own('sans-serif'), own('Broken', 'broken')]);
  await settle();
  assert.deepEqual(r.faces(), ['Own 700 normal'], 'Arial and sans-serif refused; the broken face dropped');
  r.fonts.documentFaces([own('Next')]);
  assert.deepEqual(r.faces(), ['Next normal normal'], 'the last drawing’s faces are gone');
  r.fonts.documentFaces([]);
  assert.deepEqual(r.faces(), []);
});

test('the name guard (fonts.ts’s appFontName) refuses ds.css’s --font-ui and --font-mono names as ds.css writes them, the generic families and the CSS-wide keywords', () => {
  const ds = readFileSync(new URL('../../../../ds/ds.css', import.meta.url), 'utf8');
  for (const name of ['--font-ui', '--font-mono']) {
    const stack = new RegExp(`${name}:\\s*([^;]+);`).exec(ds)![1];
    for (const f of familyList(stack)) assert.equal(appFontName(f), true, `${name}: ${f}`);
  }
  for (const f of ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default']) assert.equal(appFontName(f), true, f);
  assert.equal(appFontName('Archivo'), false);
});

test('your fonts: added (format sniffed, family and weight read by openFont, reserved names from its strings), stored under draw:font:<sha-256>, listed, registered when used, removed; a file over 10 MB, of another format or unreadable, or named like the app’s fonts is refused', async () => {
  const r = rig();
  r.info.set('wOF2mine', INFO('My Sans', 700, true, 'Copyright 2024 Me, with Reserved Font Name "Mine"'));
  r.info.set('wOF2arial', INFO('Arial'));
  const f = await r.fonts.add(fontFile('mine'), 'MySans-BoldItalic.woff2');
  assert.deepEqual([f.family, f.weight, f.style, f.format, f.fileName, f.reserved, f.added], ['My Sans', 700, 'italic', 'woff2', 'MySans-BoldItalic.woff2', ['Mine'], 1000]);
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('wOF2mine')))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(f.id, sha);
  assert.deepEqual(await r.deps.kv.keys(), [`${FONT_PREFIX}${sha}`]);
  assert.deepEqual(r.fonts.mine().map((m) => m.family), ['My Sans']);
  assert.equal(r.fonts.holds('my sans'), true);
  assert.deepEqual(r.fonts.faces('My Sans'), { weights: [], italics: [700] });
  r.fonts.use([{ family: 'My Sans', weight: 700, style: 'italic' }]);
  await settle();
  assert.deepEqual(r.faces(), ['My Sans 700 italic'], 'registered from its own bytes');
  assert.deepEqual(r.fetches, [], 'no network for it');
  await assert.rejects(r.fonts.add(new Blob([new Uint8Array(MAX_FONT_BYTES + 1)]), 'big.woff2'), new FontError(ADD_REFUSED));
  await assert.rejects(r.fonts.add(new Blob([new TextEncoder().encode('<svg/>')]), 'x.woff2'), new FontError(ADD_REFUSED));
  await assert.rejects(r.fonts.add(fontFile('nope'), 'nope.ttf'), new FontError(UNREADABLE));
  await assert.rejects(r.fonts.add(fontFile('arial'), 'arial.woff2'), new FontError(namedLikeApp('Arial')));
  await r.fonts.remove(f.id);
  assert.deepEqual(r.fonts.mine(), []);
  assert.deepEqual(await r.deps.kv.keys(), []);
  assert.deepEqual(r.faces(), [], 'its face is gone from the page too');
  // Another tab, later: the font is read back from storage.
  r.info.set('wOF2again', INFO('Again'));
  await r.fonts.add(fontFile('again'), 'again.woff2');
  const later = createFonts(r.deps);
  const heard: FontEvent[] = [];
  later.subscribe((e) => heard.push(e));
  await settle();
  assert.deepEqual(later.mine().map((m) => m.family), ['Again']);
  assert.deepEqual(heard, [{ kind: 'mine' }]);
});

test('a full quota is loud, and the drafts list still skips the fonts’ keys', async () => {
  const kv = memoryKV();
  const full: KV = { ...kv, set: async () => { throw new DOMException('full', 'QuotaExceededError'); } };
  const r = rig({ kv: full });
  r.info.set('wOF2x', INFO('X'));
  await assert.rejects(r.fonts.add(fontFile('x'), 'x.woff2'), new FontError(FONTS_FULL));
  const ok = rig({ kv });
  ok.info.set('wOF2x', INFO('X'));
  await ok.fonts.add(fontFile('x'), 'x.woff2');
  const drafts = new DraftStore(kv, () => 0);
  assert.deepEqual(await drafts.list(), [], 'a font is no draft');
  assert.equal((await kv.keys()).length, 1);
});

test('the format comes from the first four bytes; reserved names from a copyright or licence string', () => {
  const b = (s: string | number[]) => (typeof s === 'string' ? new TextEncoder().encode(s) : new Uint8Array(s));
  assert.equal(sniffFont(b('wOF2....')), 'woff2');
  assert.equal(sniffFont(b('wOFF....')), 'woff');
  assert.equal(sniffFont(b('OTTO....')), 'opentype');
  assert.equal(sniffFont(b('true....')), 'truetype');
  assert.equal(sniffFont(b([0, 1, 0, 0, 9])), 'truetype');
  assert.equal(sniffFont(b('<svg')), null);
  assert.deepEqual(reservedNames('Copyright 2014 - 2017 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name \'Source\'. Copyright 2019 Google LLC.'), ['Source']);
  assert.deepEqual(reservedNames('with Reserved Font Names “Alpha” and “Beta”', 'no names here'), ['Alpha', 'Beta']);
  assert.deepEqual(reservedNames('Copyright 2017 IBM Corp. All rights reserved.'), []);
});
