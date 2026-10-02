// The Finish sheet's numbers (engine/export/raster.ts): PNG sizes, the canvas area clamp, and SVG Lab's
// Pixels and vector comparison (the fit, the 12-device-pixel grid rule, the two captions).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOTS, FIRST_DOTS, ICON_SIZES, SCALES, clampArea, dotsCaption, fitInto, gridShows, pngSize, shapeCount, shapesCaption } from '../../export/raster.ts';
import { parseDoc, type Doc } from '../../model/doc.ts';

const doc = (text: string): Doc => {
  const r = parseDoc(text);
  assert.ok(r.ok);
  return r.doc;
};
const LAB = (f: string) => readFileSync(new URL(`../fixtures/corpus/lab/${f}`, import.meta.url), 'utf8');

test('pngSize: an icon size is the longer side, the other its rounded share (at least 1); a scale multiplies the artboard', () => {
  assert.deepEqual(ICON_SIZES, [16, 32, 64, 128, 256, 512, 1024]);
  assert.deepEqual(SCALES, [1, 2, 3]);
  assert.deepEqual(pngSize({ width: 100, height: 100 }, { icon: 64 }), { w: 64, h: 64 });
  assert.deepEqual(pngSize({ width: 640, height: 200 }, { icon: 16 }), { w: 16, h: 5 });
  assert.deepEqual(pngSize({ width: 640, height: 200 }, { icon: 1024 }), { w: 1024, h: 320 });
  assert.deepEqual(pngSize({ width: 200, height: 640 }, { icon: 1024 }), { w: 320, h: 1024 }, 'a tall board: N is its height');
  assert.deepEqual(pngSize({ width: 1, height: 1000 }, { icon: 16 }), { w: 1, h: 16 }, 'never less than 1');
  assert.deepEqual(pngSize({ width: 1000, height: 1 }, { icon: 1024 }), { w: 1024, h: 1 });
  assert.deepEqual(pngSize({ width: 640, height: 200 }, { scale: 3 }), { w: 1920, h: 600 });
  assert.deepEqual(pngSize({ width: 24.4, height: 0.2 }, { scale: 1 }), { w: 24, h: 1 });
  assert.deepEqual(pngSize({ width: 100, height: 100 }, { scale: 2 }), { w: 200, h: 200 });
});

test('clampArea: the largest size of the same aspect within the area (floored, at least 1), and only when it must', () => {
  const cap = 8192 * 8192;
  assert.deepEqual(clampArea(3072, 3072, cap), { w: 3072, h: 3072, clamped: false }, "a 1024 icon at 3× never needs it");
  assert.deepEqual(clampArea(8192, 8192, cap), { w: 8192, h: 8192, clamped: false }, 'an exact cap is kept');
  assert.deepEqual(clampArea(8192, 1024, 4096 * 4096), { w: 8192, h: 1024, clamped: false }, 'a cap on area, not on a side');
  const a = clampArea(30000, 9375, cap); // 3.2:1
  assert.ok(a.clamped && a.w * a.h <= cap && a.w === 14654 && a.h === 4579, JSON.stringify(a));
  const b = clampArea(6000, 6000, 4096 * 4096);
  assert.deepEqual(b, { w: 4096, h: 4096, clamped: true });
  const c = clampArea(1, 1e9, 4096 * 4096);
  assert.ok(c.clamped && c.w === 1 && c.h === 4096 * 4096, `a side held at 1 leaves the other the whole area: ${JSON.stringify(c)}`);
  for (const [w, h] of [[10000, 7001], [99999, 3], [12345, 6789], [65535, 65535]]) {
    const r = clampArea(w, h, cap);
    assert.ok(r.w * r.h <= cap && r.w >= 1 && r.h >= 1, `${w} × ${h} → ${r.w} × ${r.h}`);
    assert.ok(Math.abs(r.w / r.h - w / h) / (w / h) < 0.01 || r.w === 1 || r.h === 1, `${w} × ${h} keeps its shape: ${r.w} × ${r.h}`);
  }
});

test('fitInto: the artboard scaled to fit res × res and centred; a square board fills it', () => {
  assert.deepEqual(fitInto({ width: 100, height: 100 }, 32), { x: 0, y: 0, w: 32, h: 32 });
  assert.deepEqual(fitInto({ width: 640, height: 200 }, 64), { x: 0, y: 22, w: 64, h: 20 });
  assert.deepEqual(fitInto({ width: 1, height: 1000 }, 16), { x: 7.992, y: 0, w: 0.016, h: 16 });
});

test('gridShows: SVG Lab’s rule, a dot spanning 12 device pixels or more (the pane’s width × devicePixelRatio ÷ dots)', () => {
  assert.deepEqual(DOTS, [16, 32, 64]);
  assert.equal(FIRST_DOTS, 32);
  // A 202 px pane, as the Finish sheet's at 440 pt.
  assert.equal(gridShows(202, 1, 16), true);
  assert.equal(gridShows(202, 1, 32), false);
  assert.equal(gridShows(202, 3, 32), true);
  assert.equal(gridShows(202, 1, 64), false);
  assert.equal(gridShows(202, 3, 64), false);
  assert.equal(gridShows(192, 1, 16), true, 'exactly 12');
  assert.equal(gridShows(191, 1, 16), false);
  assert.equal(gridShows(128, 2, 16), true, 'the devicePixelRatio counts');
});

test('the captions are SVG Lab’s: “32 × 32 = 1,024 dots” and “2 shapes, sharp at any size” (“1 shape” for one)', () => {
  assert.equal(dotsCaption(32), '32 × 32 = 1,024 dots');
  assert.equal(dotsCaption(16), '16 × 16 = 256 dots');
  assert.equal(dotsCaption(64), '64 × 64 = 4,096 dots');
  assert.equal(shapesCaption(2), '2 shapes, sharp at any size');
  assert.equal(shapesCaption(1), '1 shape, sharp at any size');
  assert.equal(shapesCaption(0), '0 shapes, sharp at any size');
});

test('shapeCount: what the canvas draws as shapes, never what waits in defs, a symbol, a clipPath, a mask, a pattern or a marker; lab/vector.svg has the lab’s 2', () => {
  assert.equal(shapeCount(doc(LAB('vector.svg'))), 2);
  assert.equal(shapesCaption(shapeCount(doc(LAB('vector.svg')))), '2 shapes, sharp at any size');
  const kinds = ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'image', 'use'].map((k) => `<${k}/>`).join('');
  assert.equal(shapeCount(doc(`<svg xmlns="http://www.w3.org/2000/svg"><g>${kinds}</g><title>t</title><g><g><rect/></g></g></svg>`)), 11);
  const hidden = ['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker'].map((c) => `<${c} id="${c}"><rect/><path/></${c}>`).join('');
  assert.equal(shapeCount(doc(`<svg xmlns="http://www.w3.org/2000/svg">${hidden}<use href="#symbol"/></svg>`)), 1);
  assert.equal(shapeCount(doc('<svg xmlns="http://www.w3.org/2000/svg"><text>a<tspan>b</tspan></text></svg>')), 1, 'a tspan is part of its text');
  assert.equal(shapeCount(doc(LAB('create.svg'))), 0);
});
