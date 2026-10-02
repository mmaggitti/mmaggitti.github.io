// The e2e's PNG helpers (test/probe-helpers/png.mjs): decodePng reads what a canvas writes (8-bit RGBA,
// every row filter) with its alpha, and pixelShare counts the pixels that differ, colours compared
// premultiplied by their alpha. The golden tests' engine-tolerant tier: alphaMaskShare counts the
// pixels opaque in one image only, and quadrantDeltaE compares each quadrant's mean colour in CIELAB.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { alphaMaskShare, decodePng, deltaE76, pixelShare, quadrantDeltaE, rgbaImage, srgbToLab } from '../probe-helpers/png.mjs';

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

/** A w × h image whose every pixel is `f(x, y)`, RGBA. */
const image = (w: number, h: number, f: (x: number, y: number) => number[]) => rgbaImage(w, h, Array.from({ length: w * h }, (_, i) => f(i % w, Math.floor(i / w))).flat());

test('alphaMaskShare: the share of pixels opaque (alpha 128 or more) in one image and not the other, whatever their colours', () => {
  const a = image(4, 2, (x) => (x < 2 ? [10, 20, 30, 255] : [0, 0, 0, 0]));
  assert.equal(alphaMaskShare(a, a), 0);
  const recoloured = image(4, 2, (x) => (x < 2 ? [200, 0, 0, 128] : [255, 255, 255, 127]));
  assert.equal(alphaMaskShare(a, recoloured), 0, 'alpha 128 is opaque and 127 is not; colour never counts');
  const wider = image(4, 2, (x) => (x < 3 ? [10, 20, 30, 255] : [0, 0, 0, 0]));
  assert.equal(alphaMaskShare(a, wider), 0.25, 'one column of four opaque in one image only');
  assert.throws(() => alphaMaskShare(a, image(2, 2, () => [0, 0, 0, 0])), /4×2 against 2×2/);
});

test('srgbToLab and deltaE76: CIELAB under D65 (white 100 0 0, black 0 0 0, sRGB red 53.24 80.09 67.20), and CIE76 is the straight distance', () => {
  const close = (p: number[], q: number[]) => p.every((v, i) => Math.abs(v - q[i]) < 0.01);
  assert.ok(close(srgbToLab([255, 255, 255]), [100, 0, 0]), `white: ${srgbToLab([255, 255, 255])}`);
  assert.ok(close(srgbToLab([0, 0, 0]), [0, 0, 0]), `black: ${srgbToLab([0, 0, 0])}`);
  assert.ok(close(srgbToLab([255, 0, 0]), [53.24, 80.09, 67.2]), `red: ${srgbToLab([255, 0, 0])}`);
  assert.ok(Math.abs(deltaE76(srgbToLab([255, 255, 255]), srgbToLab([0, 0, 0])) - 100) < 0.01, 'white to black is 100');
  assert.equal(deltaE76([50, 3, 4], [50, 0, 0]), 5);
});

test('quadrantDeltaE: each quadrant’s mean colour over its opaque pixels, compared in CIELAB; a quadrant opaque in neither image is 0, in one only Infinity', () => {
  // Top left red, top right green, bottom left blue, bottom right transparent.
  const quads = (tl: number[], tr: number[], bl: number[], br: number[]) => image(4, 4, (x, y) => (y < 2 ? (x < 2 ? tl : tr) : x < 2 ? bl : br));
  const RED = [255, 0, 0, 255], GREEN = [0, 255, 0, 255], BLUE = [0, 0, 255, 255], NONE = [0, 0, 0, 0];
  const a = quads(RED, GREEN, BLUE, NONE);
  assert.deepEqual(quadrantDeltaE(a, a), [0, 0, 0, 0]);
  // Half the top left's pixels white: its mean is (255, 127.5, 127.5) against red.
  const half = image(4, 4, (x, y) => (y < 2 && x < 2 ? (x === 0 ? [255, 255, 255, 255] : RED) : y < 2 ? GREEN : x < 2 ? BLUE : NONE));
  const d = quadrantDeltaE(a, half);
  assert.ok(Math.abs(d[0] - deltaE76(srgbToLab([255, 0, 0]), srgbToLab([255, 127.5, 127.5]))) < 1e-9, `top left: ${d[0]}`);
  assert.deepEqual(d.slice(1), [0, 0, 0]);
  // Pixels under alpha 128 don't count: a faint wash over the bottom right changes nothing.
  assert.deepEqual(quadrantDeltaE(a, quads(RED, GREEN, BLUE, [255, 255, 255, 127])), [0, 0, 0, 0]);
  // Opaque in one image only.
  assert.equal(quadrantDeltaE(a, quads(RED, GREEN, BLUE, BLUE))[3], Infinity);
  // An odd size: the middle column and row go to the second half.
  const odd = image(3, 3, (x, y) => (x >= 1 && y >= 1 ? BLUE : RED));
  assert.deepEqual(quadrantDeltaE(odd, image(3, 3, (x, y) => (x === 0 || y === 0 ? RED : BLUE))), [0, 0, 0, 0]);
  assert.ok(quadrantDeltaE(odd, image(3, 3, () => RED))[3] > 50, 'the bottom right (the 2 × 2 block) is blue in one, red in the other');
});
