// engine/text/font-faces.ts: a document's own @font-face faces (read from the <style> the canvas
// renders, from the first usable data: source, within the size limits), the name guard, and the
// faces a drawing's text asks for (usedFaces: inheritance, bolder and lighter, a generic first).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDoc, type Doc } from '../../model/doc.ts';
import { FACE_MAX, FACES_MAX, UI_STACKS, appFontName, familyList, fontFaces, usedFaces } from '../../text/font-faces.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const b64 = (s: string) => btoa(s);
const face = (family: string, src: string, more = '') => `@font-face{font-family:${family};src:${src}${more}}`;

test('a data: face is read with its descriptors as written (weight, style, stretch, unicode-range, format), its base64 decoded with whitespace ignored, the <style> that declares it named', () => {
  const data = `url("data:font/woff2;base64,${b64('wOF2abcd').replace(/(.{4})/g, '$1 \t')}") format('woff2')`;
  const doc = load(svg(`<style>${face("'Own Face'", data, ';font-weight:700;font-style:italic;font-stretch:condensed;unicode-range:U+0-FF')} @media screen { ${face('Own2', `url("data:font/ttf;base64,${b64('\0\x01\0\0')}")`)} }</style><text>x</text>`));
  const { faces, over } = fontFaces(doc);
  assert.deepEqual(over, []);
  assert.deepEqual(faces.map((f) => [f.family, f.weight, f.style, f.stretch, f.unicodeRange, f.format, new TextDecoder().decode(f.bytes)]), [
    ['Own Face', '700', 'italic', 'condensed', 'U+0-FF', 'woff2', 'wOF2abcd'],
    ['Own2', 'normal', 'normal', 'normal', 'U+0-10FFFF', null, '\0\x01\0\0'],
  ]);
  assert.equal(doc.nodes.get(faces[0].styleId)!.kind, 'element');
});

test('the first usable source is taken: local() and a data: URL that isn’t base64 or another format are skipped; a <style> the canvas refuses (a remote or relative url(), @import) gives nothing', () => {
  const ok = `url(data:font/woff;base64,${b64('wOFF')})`;
  let doc = load(svg(`<style>${face('A', `local(Arial), url(data:font/woff2,abc), url(data:font/woff2;base64,${b64('x')}) format('svg'), ${ok} format("woff"), url(data:font/woff2;base64,${b64('later')})`)}</style>`));
  assert.deepEqual(fontFaces(doc).faces.map((f) => [f.family, f.format, new TextDecoder().decode(f.bytes)]), [['A', 'woff', 'wOFF']]);
  doc = load(svg(`<style>${face('B', `url(https://example.com/b.woff2), ${ok}`)}</style>`));
  assert.deepEqual(fontFaces(doc).faces, [], 'a remote url(): the canvas refuses the whole <style>');
  doc = load(svg(`<style>${face('C', `url(c.woff2), ${ok}`)}</style>`));
  assert.deepEqual(fontFaces(doc).faces, [], 'a relative url() too');
  doc = load(svg(`<style>@import "x.css"; ${face('E', ok)}</style>`));
  assert.deepEqual(fontFaces(doc).faces, [], 'an @import');
  doc = load(svg(`<style>${face('D', 'local(Arial)')}${face('', ok)}</style>`));
  assert.deepEqual(fontFaces(doc).faces, [], 'no data: source, and no family');
});

test('the size limits, 5 MB a face and 20 MB in all (here a test’s smaller ones): a face over the one, and faces past the other, are counted by family and not read', () => {
  assert.equal(FACE_MAX, 5_000_000);
  assert.equal(FACES_MAX, 20_000_000);
  const big = `url(data:font/woff2;base64,${'A'.repeat(4000)})`;
  const small = `url(data:font/woff2;base64,${'A'.repeat(400)})`;
  const doc = load(svg(`<style>${face('Big', big)}${face('S1', small)}${face('S2', small)}${face('S3', small)}</style>`));
  const read = fontFaces(doc, { face: 2000, total: 700 });
  assert.deepEqual(read.faces.map((f) => [f.family, f.bytes.length]), [['S1', 300], ['S2', 300]]);
  assert.deepEqual(read.over, ['Big', 'S3']);
  assert.equal(fontFaces(doc).faces.length, 4, 'the usual limits take them all');
});

test('the name guard refuses ds.css’s --font-ui and --font-mono names, the CSS generic families and the CSS-wide keywords, case and quotes aside; the stacks are ds.css’s own', () => {
  const ds = readFileSync(new URL('../../../ds/ds.css', import.meta.url), 'utf8');
  const prop = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(ds)![1].trim();
  assert.deepEqual(UI_STACKS.slice(0, 2), [prop('--font-ui'), prop('--font-mono')], 'the guard reads the app’s two stacks exactly');
  for (const stack of [prop('--font-ui'), prop('--font-mono')]) for (const f of familyList(stack)) assert.equal(appFontName(f), true, f);
  for (const f of ['Arial', 'arial', '"Segoe UI"', "'Helvetica Neue'", 'menlo', 'serif', 'SANS-SERIF', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default', '-webkit-standard']) assert.equal(appFontName(f), true, f);
  for (const f of ['Own', 'Archivo', 'Inter', 'IBM Plex Mono', 'Arial Black']) assert.equal(appFontName(f), false, f);
});

test('usedFaces: each text run’s first family Draw holds (the drawing’s own first), its weight and style computed through inheritance (bold 700, bolder and lighter against the parent’s: 700 gives 900 and 400), a generic first needing nothing, a rule’s value skipped', () => {
  const own = `<style>${face('Own', `url(data:font/woff2;base64,${b64('x')})`)}</style>`;
  const doc = load(svg(`${own}
    <g font-family="Georgia, Inter, sans-serif" font-weight="bold">
      <text>Bold<tspan font-weight="bolder">er</tspan><tspan font-weight="lighter" font-style="oblique 10deg">light</tspan></text>
      <text font-family="Own, Archivo" style="font-weight: 300">mine</text>
    </g>
    <text font-family="serif, Archivo">generic first</text>
    <text font-family="'Archivo'"> </text>
    <text font-family="Archivo"></text>`));
  const held = (f: string) => ['inter', 'archivo'].includes(f.toLowerCase());
  assert.deepEqual(usedFaces(doc, held), [
    { family: 'Inter', weight: 700, style: 'normal' },
    { family: 'Inter', weight: 900, style: 'normal' },
    { family: 'Inter', weight: 400, style: 'italic' },
    { family: 'Own', weight: 300, style: 'normal' },
  ]);
  const ruled = load(svg('<style>text { font-family: Inter }</style><text font-family="Inter">a</text>'));
  assert.deepEqual(usedFaces(ruled, held), [], 'a <style> rule may decide its family: P2');
  assert.deepEqual(usedFaces(doc), [{ family: 'Own', weight: 300, style: 'normal' }], 'nothing held but the drawing’s own');
});
