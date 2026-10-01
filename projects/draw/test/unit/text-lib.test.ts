// The text library (P1-M4: fontkit 2.0.4, the spike's winner), as the lazy chunk gives it, in node:
// openFont reads each of the catalogue's 110 faces from the file the canvas registers, and refuses a
// file that isn't a font, or one whose header says it unpacks to more than 30 MB (before anything is
// decompressed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { MAX_UNPACKED, openFont, shape, unpackedSize } from '../../src/text/outline-lib.ts';
import { CATALOGUE, faceFile } from '../../src/platform/font-catalogue.ts';

const file = (slug: string, name: string) => new Uint8Array(readFileSync(new URL(`../../node_modules/@fontsource/${slug}/files/${name}`, import.meta.url)));

test('openFont reads the family, weight class and italic flag of each of the catalogue’s 110 faces as its file writes them (some variable-font instances say 250 for Thin and ExtraLight, and some name an instance in their family)', () => {
  let n = 0;
  for (const f of CATALOGUE) {
    for (const [weights, style] of [[f.weights, 'normal'], [f.italics, 'italic']] as const) {
      for (const w of weights) {
        const info = openFont(file(f.slug, faceFile(f.slug, w, style)));
        assert.ok(info.family.startsWith(f.family), `${f.family} ${w} ${style}: family ${info.family}`);
        // A variable font's Thin and ExtraLight instances may say 250 (IBM Plex Mono's say 100 and 200).
        assert.ok(info.weight === w || (w <= 200 && info.weight === 250), `${f.family} ${w} ${style}: weight class ${info.weight}`);
        assert.equal(info.italic, style === 'italic', `${f.family} ${w} ${style}: italic`);
        assert.ok(info.copyright.startsWith('Copyright'), `${f.family}: its copyright string`);
        n++;
      }
    }
  }
  assert.equal(n, 110);
  assert.equal(openFont(file('inter', 'inter-latin-400-normal.woff2')).family, 'Inter', 'the typographic family first');
  assert.match(openFont(file('dm-serif-display', 'dm-serif-display-latin-400-normal.woff2')).copyright, /Reserved Font Name 'Source'/);
});

test('openFont refuses a file that isn’t a font', () => {
  assert.throws(() => openFont(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')));
  assert.throws(() => openFont(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0])), 'a WOFF2 header and nothing else');
});

// A 1,267-byte WOFF2 whose one table (OS/2) declares 768 MB: a Brotli stream of zeros that fills all of it.
const WOFF2_768MB = 'd09GMgABAAAAAATzAAEAADAAAAAAAAS9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABoOAgIAAy///PwAkAOKxQHLv//j//weABEAcFoDu/R////8AkACIwwLQvf/j//8fABIAcVgAuvd//P//A0ACIA4LQPf+j///fwBIAMRhAeje//H//w8ACYA4LADd+z/+//8BIAEQhwWge//H//8/ACQA4rAAdO//+P//B4AEQBwWgO79H////wCQAIjDAtC9/+P//x8AEgBxWAC693/8//8DQAIgDgtA9/6P//9/AEgAxGEB6N7/8f//DwAJgDgsAN37P/7//wEgARCHBaB7/8f//z8AJADisAB07//4//8HgARAHBaA7v0f////AJAAiMMC0L3/4///HwASAHFYALr3f/z//wNAAiAOC0D3/o///38ASADEYQHo3v/x//8PAAmAOCwA3fs//v//ASABEIcFoHv/x///PwAkAOKwAHTv//j//weABEAcFoDu/R////8AkACIwwLQvf/j//8fABIAcVgAuvd//P//A0ACIA4LQPf+j///fwBIAMRhAeje//H//w8ACYA4LADd+z/+//8BIAEQhwWge//H//8/ACQA4rAAdO//+P//B4AEQBwWgO79H////wCQAIjDAtC9/+P//x8AEgBxWAC693/8//8DQAIgDgtA9/6P//9/AEgAxGEB6N7/8f//DwAJgDgsAN37P/7//wEgARCHBaB7/8f//z8AJADisAB07//4//8HgARAHBaA7v0f////AJAAiMMC0L3/4///HwASAHFYALr3f/z//wNAAiAOC0D3/o///38ASADEYQHo3v/x//8PAAmAOCwA3fs//v//ASABEIcFoHv/x///PwAkAOKwAHTv//j//weABEAcFoDu/R////8AkACIwwLQvf/j//8fABIAcVgAuvd//P//A0ACIA4LQPf+j///fwBIAMRhAeje//H//w8ACYA4LADd+z/+//8BIAEQhwWge//H//8/ACQA4rAAdO//+P//B4AEQBwWgO79H////wCQAIjDAtC9/+P//x8AEgBxWAC693/8//8DQAIgDgtA9/6P//9/AEgAxGEB6N7/8f//DwAJgDgsAN37P/7//wEgARCHBaB7/8f//z8AJADisAB07//4//8HgARAHBaA7v0f////AJAAiMMC0L3/4///HwASAHFYALr3f/z//wNAAiAOC0D3/o///38ASADEYQHo3v/x//8PAAmAOCwA3fs//v//ASABEIcFoHv/x///PwAkAOKwAHTv//j//weABEAcFoDu/R////8AkACIwwLQvf/j//8fABIAcVgAuvd//P//A0ACIA4LQPf+j///fwBIAMRhAeje//H//w8ACYA4LADd+z/+//8BIAEQhwWge//H//8/ACQA4rAAdO//+P//B4AEQBwWgO79H////wCQAIjDAtC9/+P//x8AEgBxWAC693/8//8DQAIgDgtA9/6P//9/AEgAxGEB6N7/8f//DwAJgDgsAN37P/7//wEgARCHBaB7/8f//z8AJADisAB07//4//8HgARAHBaA7v0f////AJAAiMMC0L3/4///HwASAHFYALr3f/z//wNAAiAOC0D3/o///38ASADEYQHo3v/x//8PAAmAOCwA3fu//P//AyABEIcFoHv/Bw==';

// Inter's own .woff, its OS/2 table replaced by `size` zero bytes, deflated (fontkit inflates it whole and reads it).
function woffWithOs2(size: number): Uint8Array {
  const src = Buffer.from(file('inter', 'inter-latin-400-normal.woff'));
  const z = deflateSync(Buffer.alloc(size), { level: 9 });
  const pad = (4 - (src.length % 4)) % 4;
  const out = Buffer.concat([src, Buffer.alloc(pad), z]);
  for (let i = 0; i < out.readUInt16BE(12); i++) {
    const o = 44 + 20 * i;
    if (out.toString('latin1', o, o + 4) !== 'OS/2') continue;
    out.writeUInt32BE(src.length + pad, o + 4);
    out.writeUInt32BE(z.length, o + 8);
    out.writeUInt32BE(size, o + 12);
  }
  out.writeUInt32BE(out.length, 8);
  return new Uint8Array(out);
}

test('a font whose header says it unpacks to more than 30 MB is refused before anything is decompressed: a 1,267-byte WOFF2 declaring 768 MB at once, a WOFF whose OS/2 table inflates to 64 MB; the catalogue’s files, a header that doesn’t read', () => {
  const bomb = new Uint8Array(Buffer.from(WOFF2_768MB, 'base64'));
  assert.equal(bomb.length, 1267);
  assert.equal(unpackedSize(bomb), 768 * 2 ** 20);
  const t = performance.now();
  assert.throws(() => openFont(bomb), /unpacks to/);
  assert.throws(() => shape(bomb, ['Hello']), /unpacks to/);
  const ms = performance.now() - t;
  assert.ok(ms < 300, `refused in ${ms.toFixed(0)} ms, not at once`);
  const woff = woffWithOs2(64 * 2 ** 20);
  assert.ok(unpackedSize(woff) > MAX_UNPACKED);
  assert.throws(() => openFont(woff), /unpacks to/, 'a WOFF whose OS/2 declares 64 MB');
  assert.throws(() => shape(woff, ['Hi']), /unpacks to/);
  assert.equal(openFont(woffWithOs2(96)).family, 'Inter', 'the same file with a small OS/2 table reads');
  // The catalogue's .woff2 and .woff: what they declare is what they unpack to (a sfnt), far under the bound.
  const inter2 = file('inter', 'inter-latin-400-normal.woff2');
  assert.equal(unpackedSize(inter2), new DataView(inter2.buffer, inter2.byteOffset).getUint32(16), 'a WOFF2: its totalSfntSize');
  assert.ok(unpackedSize(file('inter', 'inter-latin-400-normal.woff')) < 1e6);
  const ttf = new Uint8Array([0, 1, 0, 0, 0, 0]);
  assert.equal(unpackedSize(ttf), 6, 'a bare sfnt: its own length');
  assert.throws(() => openFont(bomb.slice(0, 50)), /header/, 'a WOFF2 whose directory is cut short');
  assert.throws(() => unpackedSize(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, ...new Array(28).fill(0), 6, 0x80, 1])), 'a length with a leading zero byte');
});
