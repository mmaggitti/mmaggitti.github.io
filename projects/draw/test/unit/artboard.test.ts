// The artboard the canvas fits on open (the root's viewBox, else its size, else none), and the
// camera box: the root's own box, placed and sized so the view fits the artboard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attrValue, el, parseDoc, type Doc } from '../../../../engine/model/doc.ts';
import { parseViewBox } from '../../../../engine/values/viewbox.ts';
import { artboard, rootViewport } from '../../src/canvas/artboard.ts';
import { cameraBox, fit, toScreen } from '../../src/canvas/viewport.ts';
import { rootTransform } from '../../../../engine/geometry/ctm.ts';
import { mapRect } from '../../../../engine/geometry/bounds.ts';

const SVG = 'http://www.w3.org/2000/svg';
const load = (text: string): Doc => {
  const r = parseDoc(text);
  assert.ok(r.ok);
  return r.doc;
};
const svg = (attrs: string) => load(`<svg xmlns="${SVG}" ${attrs}><rect width="1" height="1"/></svg>`);

test('the artboard is the viewBox, else the size in user units, else none', () => {
  assert.deepEqual(artboard(svg('viewBox="-5 10 24 12" width="99" height="99"')), { x: -5, y: 10, width: 24, height: 12 });
  assert.deepEqual(artboard(svg('width="1in" height="72pt"')), { x: 0, y: 0, width: 96, height: 96 });
  assert.deepEqual(artboard(svg('viewBox="0 0 a b" width="10" height="20"')), { x: 0, y: 0, width: 10, height: 20 }, 'an invalid viewBox is ignored');
  assert.equal(artboard(svg('viewBox="0 0 0 10" width="10" height="20"')), null, 'a zero-size viewBox draws nothing');
  assert.equal(artboard(svg('width="100%" height="10"')), null, 'a percentage has no size of its own');
  assert.equal(artboard(svg('width="1e308in" height="10"')), null, 'a size that overflows is no size');
  assert.equal(artboard(svg('')), null);
});

/** The view at fit and the camera box it gives, composed as the editor composes them. */
function atFit(doc: Doc, host: { width: number; height: number }) {
  const viewport = rootViewport(doc, host);
  const M = rootTransform(doc, viewport);
  const board = artboard(doc);
  const view = fit(board ? mapRect(M, board) : { x: 0, y: 0, width: viewport.width, height: viewport.height }, host, 0);
  return { viewport, M, view, box: cameraBox(view, host, viewport) };
}
const round = (o: object) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));

test('the camera box at fit: a root’s own box is placed and sized so its viewBox shows exactly as the file does alone in a host-sized window, and its viewBox is never replaced', () => {
  const host = { width: 400, height: 300 };
  const vb = 'viewBox="0 0 100 50"';
  // [attributes, W0 × H0, M, the box at fit]
  const cases: [string, [number, number], number[], [number, number, number, number]][] = [
    [vb, [400, 300], [4, 0, 0, 4, 0, 50], [0, 0, 400, 300]], // a viewBox only: the box is the host, pixel for pixel P0's
    [`${vb} width="50" height="50"`, [50, 50], [0.5, 0, 0, 0.5, 0, 12.5], [0, -50, 400, 400]], // a size of another aspect
    [`${vb} preserveAspectRatio="xMinYMin meet"`, [400, 300], [4, 0, 0, 4, 0, 0], [0, 50, 400, 300]], // placed otherwise: the camera centres it
    [`${vb} preserveAspectRatio="xMidYMid slice"`, [400, 300], [6, 0, 0, 6, -100, 0], [66.667, 50, 266.667, 200]],
    [`${vb} preserveAspectRatio="none"`, [400, 300], [4, 0, 0, 6, 0, 0], [0, 0, 400, 300]],
    [`${vb} width="50%"`, [200, 300], [2, 0, 0, 2, 0, 100], [0, -150, 400, 600]], // % of the host's width
    [`${vb} width="2em" font-size="20"`, [40, 300], [0.4, 0, 0, 0.4, 0, 140], [0, -1350, 400, 3000]], // em of the root's own font size
    [`${vb} width="10rem"`, [160, 300], [1.6, 0, 0, 1.6, 0, 110], [0, -225, 400, 750]], // rem on the root's own box: its font size
    ['width="10" height="20"', [10, 20], [1, 0, 0, 1, 0, 0], [125, 0, 150, 300]], // a size only: the renderer gives it 0 0 10 20 while k ≠ 1
    ['', [400, 300], [1, 0, 0, 1, 0, 0], [0, 0, 400, 300]], // neither: as the browser draws it
    ['width="1e308in"', [400, 300], [1, 0, 0, 1, 0, 0], [0, 0, 400, 300]], // a width that overflows is none
  ];
  for (const [attrs, [w, h], M, [left, top, width, height]] of cases) {
    const doc = svg(attrs);
    const f = atFit(doc, host);
    assert.deepEqual(round(f.viewport), { width: w, height: h }, `${attrs}: the root's viewport`);
    assert.deepEqual(round([...f.M]), M, `${attrs}: M is its own viewBox and preserveAspectRatio in that viewport`);
    assert.deepEqual(round(f.box), { left, top, width, height }, `${attrs}: the box at fit`);
    // The artboard lands fitted and centred (meet) in the host, through M and the box.
    const board = artboard(doc);
    if (board) {
      const onScreen = mapRect([f.box.width / f.viewport.width, 0, 0, f.box.height / f.viewport.height, f.box.left, f.box.top], mapRect(f.M, board));
      const k = Math.min(host.width / onScreen.width, host.height / onScreen.height);
      assert.ok(Math.abs(k - 1) < 1e-9, `${attrs}: fitted (meet)`);
      assert.ok(Math.abs(onScreen.x * 2 + onScreen.width - host.width) < 1e-6 && Math.abs(onScreen.y * 2 + onScreen.height - host.height) < 1e-6, `${attrs}: centred`);
    }
    assert.equal(attrValue(doc, el(doc, doc.root), null, 'viewBox'), attrs.includes('viewBox') ? '0 0 100 50' : null, 'the file’s own viewBox is untouched');
  }
});

test('every corpus file opens at its own viewBox, fitted and centred (meet) in the host', () => {
  const dir = fileURLToPath(new URL('../../../../engine/test/fixtures/corpus/', import.meta.url));
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((p) => p.split(sep).join('/')).filter((p) => p.endsWith('.svg'));
  assert.ok(files.length > 250);
  const host = { width: 416, height: 528 };
  let boxes = 0;
  for (const rel of files) {
    const doc = load(readFileSync(dir + rel, 'utf8'));
    const raw = attrValue(doc, el(doc, doc.root), null, 'viewBox');
    const vb = raw === null ? null : parseViewBox(raw);
    const board = artboard(doc);
    if (vb && vb !== 'disabled') {
      boxes++;
      assert.deepEqual(board, { x: vb.x, y: vb.y, width: vb.w, height: vb.h }, rel);
    }
    if (!board) continue;
    // Fitted with no margin, the camera shows the artboard as preserveAspectRatio's default does:
    // scaled to meet the host and centred on it.
    const f = atFit(doc, host);
    const inBox = mapRect(f.M, board);
    const k = Math.min(host.width / inBox.width, host.height / inBox.height);
    const tl = toScreen(f.view, host, { x: inBox.x, y: inBox.y });
    assert.ok(Math.abs(tl.x - (host.width - inBox.width * k) / 2) < 1e-6 && Math.abs(tl.y - (host.height - inBox.height * k) / 2) < 1e-6, rel);
    // The root's box keeps its own shape (W0:H0), and the artboard is fitted and centred in the host.
    assert.ok(Math.abs(f.box.width / f.box.height - f.viewport.width / f.viewport.height) < 1e-9, `${rel}: the box's aspect is W0:H0`);
    const shown = { x: f.box.left + inBox.x * (f.box.width / f.viewport.width), y: f.box.top + inBox.y * (f.box.height / f.viewport.height) };
    assert.ok(Math.abs(shown.x - tl.x) < 1e-6 && Math.abs(shown.y - tl.y) < 1e-6, `${rel}: toScreen(M(artboard)) is where the box puts it`);
  }
  assert.ok(boxes > 200, `only ${boxes} corpus files have a viewBox`);
});
