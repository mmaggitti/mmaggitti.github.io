// The e2e's PNG helpers (test/probe-helpers/png.mjs): decodePng reads what a canvas writes (8-bit RGBA,
// every row filter) with its alpha, and pixelShare counts the pixels that differ, colours compared
// premultiplied by their alpha.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodePng, pixelShare, rgbaImage } from '../probe-helpers/png.mjs';

/** A PNG of RGBA rows (each row's filter byte given), as an encoder writes one. */
function png(width: number, height: number, rows: { filter: number; bytes: number[] }[]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    return out; // the CRC is never read by decodePng
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.from(rows.flatMap((r) => [r.filter, ...r.bytes]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('decodePng reads an RGBA PNG’s colours and alpha through its row filters', () => {
  // Row 0 unfiltered; row 1 "up" (each byte the one above plus this).
  const img = decodePng(png(2, 2, [{ filter: 0, bytes: [255, 0, 0, 255, 0, 0, 255, 128] }, { filter: 2, bytes: [0, 10, 0, 0, 1, 1, 1, 0] }]));
  assert.equal(img.width, 2);
  assert.equal(img.height, 2);
  assert.deepEqual(img.rgba(0, 0), [255, 0, 0, 255]);
  assert.deepEqual(img.rgba(1, 0), [0, 0, 255, 128]);
  assert.deepEqual(img.rgba(0, 1), [255, 10, 0, 255]);
  assert.deepEqual(img.rgb(1, 1), [1, 1, 0]);
  assert.deepEqual(img.rgba(1, 1), [1, 1, 0, 128]);
});

test('pixelShare: the share of pixels differing by more than the tolerance, premultiplied (a transparent pixel’s colour never counts)', () => {
  const a = rgbaImage(2, 2, [10, 20, 30, 255, 0, 0, 0, 0, 100, 100, 100, 255, 50, 50, 50, 128]);
  assert.equal(pixelShare(a, a), 0);
  const b = rgbaImage(2, 2, [12, 20, 30, 255, 255, 255, 255, 0, 100, 100, 100, 255, 50, 50, 50, 128]);
  assert.equal(pixelShare(a, b), 0, 'within 2, and a transparent pixel of another colour');
  const c = rgbaImage(2, 2, [13, 20, 30, 255, 0, 0, 0, 0, 100, 100, 100, 250, 50, 50, 50, 128]);
  assert.equal(pixelShare(a, c), 0.5, 'one channel 3 off, and an alpha 5 off');
  assert.throws(() => pixelShare(a, rgbaImage(1, 1, [0, 0, 0, 0])), /2×2 against 1×1/);
});
