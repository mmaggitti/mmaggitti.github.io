// PNG's logic (src/export/png.ts, P1-M5): the source is Clean's file with its text as paths (its notes
// too); each file is clamped to the device's canvas area, 8192² first and then 4096², the cap that
// worked kept for the visit; a refusal says why in its own words; and the names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDoc, type Doc } from '../../../../engine/model/doc.ts';
import { cleanExport } from '../../../../engine/export/clean.ts';
import { NO_FOREIGN_OBJECT, pngCopier } from '../../../../engine/export/png-source.ts';
import { AREA_CAPS, FAILED, FALLBACK_FONT, TAINTED, TOO_LARGE, clampedNote, freshCaps, makePng, pngName, pngSource, textAsText, type Raster } from '../../src/export/png.ts';
import { prepareExport, type ExportDeps } from '../../src/export/svg.ts';
import { openFont, shape } from '../../src/text/outline-lib.ts';
import { LATIN_RANGE, catalogueFamily, faceFile, hasFace } from '../../src/platform/font-catalogue.ts';
import { OFFLINE } from '../../src/text/pipeline.ts';

const file = (slug: string, name: string) => new Uint8Array(readFileSync(new URL(`../../node_modules/@fontsource/${slug}/files/${name}`, import.meta.url)));
let libLoads = 0;
// The editor's deps (editor.ts exportDeps), over the catalogue's files; `lib` counts its loads.
const deps = (lib: () => Promise<{ openFont: typeof openFont; shape: typeof shape }> = async () => ({ openFont, shape })): ExportDeps => ({
  textDeps: (own) => ({
    lib: () => {
      libLoads++;
      return lib();
    },
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
});
const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const TEXTS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <text id="i" x="10" y="20" font-family="Inter, sans-serif" font-weight="700" font-size="12">Inter</text>
  <text id="g" x="10" y="80" font-family="Georgia, serif" font-size="12">Georgia</text>
  <foreignObject width="10" height="10"><p xmlns="http://www.w3.org/1999/xhtml">hi</p></foreignObject>
</svg>
`;

test('the PNG source is Clean’s file with its text as paths, notes and all, plus the fallback font’s; a drawing with no text is Clean’s file, the text library never loaded', async () => {
  const doc = load(TEXTS);
  const want = await prepareExport(doc, 'Card', 'paths', deps());
  assert.ok(!('refused' in want));
  const got = await pngSource(doc, 'Card', deps());
  assert.equal(got.text, new TextDecoder().decode(want.file.bytes), 'As paths, byte for byte');
  assert.match(got.text, /<path id="i" d="M /, 'the Inter text is a path');
  assert.match(got.text, /<text id="g"/, 'Georgia stays text');
  assert.deepEqual(got.notes, [...want.notes, FALLBACK_FONT]);
  assert.ok(got.notes.some((n) => n.startsWith('Kept as text: 1.')), JSON.stringify(got.notes));
  libLoads = 0;
  const plain = load('<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10" inkscape:version="1"><rect width="5" height="5"/></svg>');
  const p = await pngSource(plain, 'Plain', deps(async () => { throw new Error('the text library is not for this'); }));
  assert.deepEqual(p, { text: cleanExport(plain).text, notes: [] });
  assert.doesNotMatch(p.text, /inkscape/, 'Clean’s file: no editor data');
  assert.equal(libLoads, 0, 'no text, no library');
});

test('when the text tools can’t load, the PNG source is Clean’s file with its text as text, and the notes say why', async () => {
  const doc = load(TEXTS);
  const got = await pngSource(doc, 'Card', deps(async () => { throw new Error('offline'); }));
  assert.equal(got.text, cleanExport(doc).text);
  assert.deepEqual(got.notes, [textAsText(OFFLINE), FALLBACK_FONT]);
  assert.equal(textAsText(OFFLINE), 'Draw couldn’t load the text tools. Try again when you’re online. Its text stays text in the PNG.');
});

/** A rasterizer that refuses areas past `max` (as a device's canvas does) and records each call. */
function device(max: number, calls: [number, number][], verdict: (w: number, h: number) => Blob | 'too-large' | 'tainted' | 'failed' = () => new Blob(['png'])): Raster {
  return async (svg, w, h) => {
    calls.push([w, h]);
    assert.match(svg, new RegExp(`width="${w}" height="${h}"`), 'the copy is sized to the file');
    return w * h > max ? 'too-large' : verdict(w, h);
  };
}
const SRC = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 200"><rect width="640" height="200"/></svg>';

test('the clamp: a PNG past 8192² is clamped to it; a device that refuses that gets 4096², and the cap that worked is kept for the visit’s later files', async () => {
  assert.deepEqual(AREA_CAPS, [8192 * 8192, 4096 * 4096]);
  // iOS 18: 8192² works.
  const calls: [number, number][] = [];
  const caps = freshCaps();
  const big = await makePng(pngCopier(SRC), { w: 16000, h: 5000 }, 'Wordmark@3x.png', device(8192 * 8192, calls), caps);
  assert.ok(!('refused' in big));
  assert.deepEqual(big.size, { w: 14654, h: 4579 });
  assert.equal(big.clamped, 8192 * 8192);
  assert.deepEqual(calls, [[14654, 4579]], 'one try, at the first cap');
  assert.equal(clampedNote(big.name, big.size, big.clamped!), 'Wordmark@3x.png is 14654 × 4579: this device makes PNGs up to 67,108,864 pixels.');
  const small = await makePng(pngCopier(SRC), { w: 1920, h: 600 }, 'Wordmark@3x.png', device(8192 * 8192, calls), caps);
  assert.ok(!('refused' in small) && small.clamped === null && small.size.w === 1920, 'a size within the cap is left as it is');
  // iOS 17: 8192² is refused, so 4096², and the next file starts there.
  const older: [number, number][] = [];
  const caps17 = freshCaps();
  const a = await makePng(pngCopier(SRC), { w: 16000, h: 5000 }, 'a.png', device(4096 * 4096, older), caps17);
  assert.ok(!('refused' in a));
  assert.deepEqual(older, [[14654, 4579], [7327, 2289]], 'tried at 8192², then at 4096²');
  assert.equal(a.clamped, 4096 * 4096);
  older.length = 0;
  const b = await makePng(pngCopier(SRC), { w: 9000, h: 9000 }, 'b.png', device(4096 * 4096, older), caps17);
  assert.ok(!('refused' in b));
  assert.deepEqual(older, [[4096, 4096]], 'the next file starts at the cap that worked');
});

test('a PNG the device refuses at 4096² too says it can’t be that big; a tainted canvas and a failed draw refuse in their own words', async () => {
  const calls: [number, number][] = [];
  const refused = await makePng(pngCopier(SRC), { w: 3000, h: 3000 }, 'x.png', device(1000, calls), freshCaps());
  assert.deepEqual(refused, { refused: TOO_LARGE });
  assert.equal(TOO_LARGE, 'This device can’t make a PNG that big.');
  assert.deepEqual(calls, [[3000, 3000], [3000, 3000]], 'within both caps, so the same size twice');
  assert.deepEqual(await makePng(pngCopier(SRC), { w: 64, h: 20 }, 'x.png', device(1e9, [], () => 'tainted'), freshCaps()), { refused: TAINTED });
  assert.deepEqual(await makePng(pngCopier(SRC), { w: 64, h: 20 }, 'x.png', device(1e9, [], () => 'failed'), freshCaps()), { refused: FAILED });
  const fo = await makePng(pngCopier('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><foreignObject/></svg>'), { w: 4, h: 4 }, 'x.png', device(1e9, []), freshCaps());
  assert.ok(!('refused' in fo) && fo.notes.includes(NO_FOREIGN_OBJECT), 'the copy’s note comes with the file');
});

test('the names: <name>-<N>.png for the icon set, <name>.png, <name>@2x.png and <name>@3x.png, sanitized as an export’s name', () => {
  assert.equal(pngName('Wordmark', { icon: 16 }), 'Wordmark-16.png');
  assert.equal(pngName('Wordmark', { icon: 1024 }), 'Wordmark-1024.png');
  assert.equal(pngName('Wordmark', { scale: 1 }), 'Wordmark.png');
  assert.equal(pngName('Wordmark', { scale: 2 }), 'Wordmark@2x.png');
  assert.equal(pngName('Wordmark', { scale: 3 }), 'Wordmark@3x.png');
  assert.equal(pngName('Poster: v2/final', { icon: 64 }), 'Poster- v2-final-64.png');
  assert.equal(pngName('a‮gnp.svg', { scale: 2 }), 'agnp.svg@2x.png', 'no format characters');
  assert.equal(pngName('', { icon: 32 }), 'drawing-32.png');
});
