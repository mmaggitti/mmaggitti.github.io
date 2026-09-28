// The artboard the canvas fits on open: the root's viewBox, else its size, else none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attrValue, el, parseDoc, type Doc } from '../../../../engine/model/doc.ts';
import { parseViewBox } from '../../../../engine/values/viewbox.ts';
import { artboard, fitsNatively } from '../../src/canvas/artboard.ts';
import { camera, fit, toScreen } from '../../src/canvas/viewport.ts';

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

test('a file whose own root shows the fitted view draws with no camera until the view moves', () => {
  assert.equal(fitsNatively(svg('viewBox="0 0 24 24"')), true);
  assert.equal(fitsNatively(svg('viewBox="0 0 24 24" preserveAspectRatio="xMidYMid"')), true);
  assert.equal(fitsNatively(svg('viewBox="0 0 24 24" preserveAspectRatio="bogus"')), true, 'an invalid value is the default');
  assert.equal(fitsNatively(svg('width="10" height="20"')), true, 'the renderer gives it 0 0 10 20');
  assert.equal(fitsNatively(svg('viewBox="0 0 24 24" preserveAspectRatio="xMinYMin meet"')), false);
  assert.equal(fitsNatively(svg('viewBox="0 0 24 24" preserveAspectRatio="none"')), false);
  assert.equal(fitsNatively(svg('viewBox="0 0 24 24" preserveAspectRatio="xMidYMid slice"')), false);
  assert.equal(fitsNatively(svg('viewBox="x" width="10" height="20"')), false, 'an invalid viewBox: the camera fits the size');
  assert.equal(fitsNatively(svg('')), false);
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
    const view = fit(board, host, 0);
    const k = Math.min(host.width / board.width, host.height / board.height);
    const tl = toScreen(view, host, { x: board.x, y: board.y });
    assert.ok(Math.abs(tl.x - (host.width - board.width * k) / 2) < 1e-6 && Math.abs(tl.y - (host.height - board.height * k) / 2) < 1e-6, rel);
    const c = camera(view, host);
    assert.ok(Math.abs(c.width / c.height - host.width / host.height) < 1e-9, `${rel}: the camera has the host's shape`);
  }
  assert.ok(boxes > 200, `only ${boxes} corpus files have a viewBox`);
});
