// The canvas camera and the gesture machine: the zoom invariant, pinch, and who owns a pointer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camera, fit, pinch, toDoc, toScreen, zoomAbout, panBy, MAX_SCALE, type View } from '../../src/canvas/viewport.ts';
import { GestureMachine, SLOP, type PointerInput } from '../../src/canvas/gestures.ts';
import { mulberry32 } from '../../../../engine/test/values/rng.ts';

const HOST = { width: 440, height: 552 };
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

test('fit shows the whole artboard, centred, inside the margin', () => {
  const v = fit({ x: 0, y: 0, width: 24, height: 24 }, HOST, 16);
  assert.equal(v.scale, (440 - 32) / 24);
  const c = camera(v, HOST);
  assert.ok(c.x <= 0 && c.y <= 0 && c.x + c.width >= 24 && c.y + c.height >= 24);
  assert.ok(close(toScreen(v, HOST, { x: 12, y: 12 }).x, 220));
});

test('the zoom invariant: the document point under the zoom centre stays under it', () => {
  const r = mulberry32(7);
  for (let i = 0; i < 10_000; i++) {
    const v: View = { cx: r() * 200 - 100, cy: r() * 200 - 100, scale: 0.1 + r() * 20 };
    const at = { x: r() * HOST.width, y: r() * HOST.height };
    const under = toDoc(v, HOST, at);
    const z = zoomAbout(v, HOST, at, 0.25 + r() * 4, 0.1);
    const back = toScreen(z, HOST, under);
    assert.ok(close(back.x, at.x, 1e-7) && close(back.y, at.y, 1e-7), `step ${i}: ${JSON.stringify(back)} vs ${JSON.stringify(at)}`);
  }
});

test('pinch keeps the point between the fingers under them and scales with their spread', () => {
  const r = mulberry32(11);
  for (let i = 0; i < 5000; i++) {
    const v: View = { cx: r() * 50, cy: r() * 50, scale: 1 + r() * 10 };
    const a0 = { x: r() * 440, y: r() * 552 };
    const b0 = { x: r() * 440, y: r() * 552 };
    const dx = r() * 60 - 30;
    const dy = r() * 60 - 30;
    const k = 0.5 + r() * 1.5;
    const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
    const a1 = { x: m0.x + (a0.x - m0.x) * k + dx, y: m0.y + (a0.y - m0.y) * k + dy };
    const b1 = { x: m0.x + (b0.x - m0.x) * k + dx, y: m0.y + (b0.y - m0.y) * k + dy };
    const p = pinch(v, HOST, a0, b0, a1, b1, 0.01);
    if (Math.hypot(b0.x - a0.x, b0.y - a0.y) < 1) continue;
    assert.ok(close(p.scale, Math.min(MAX_SCALE, v.scale * k), 1e-9));
    const under = toDoc(v, HOST, m0);
    const now = toScreen(p, HOST, under);
    assert.ok(close(now.x, m0.x + dx, 1e-7) && close(now.y, m0.y + dy, 1e-7), `step ${i}`);
  }
});

test('panning moves the drawing with the finger; scale is clamped', () => {
  const v: View = { cx: 10, cy: 10, scale: 4 };
  const p = panBy(v, 40, -20);
  assert.deepEqual(toScreen(p, HOST, { x: 10, y: 10 }), { x: 220 + 40, y: 276 - 20 });
  assert.equal(zoomAbout(v, HOST, { x: 0, y: 0 }, 1e9).scale, MAX_SCALE);
  assert.equal(zoomAbout(v, HOST, { x: 0, y: 0 }, 1e-9, 4).scale, 4 / 16);
});

// ── gestures ───────────────────────────────────────────────────────────────────────────────────

const ev = (type: PointerInput['type'], id: number, x: number, y: number, t: number, kind: PointerInput['kind'] = 'touch'): PointerInput => ({ type, id, x, y, t, kind });
const run = (inputs: PointerInput[]) => {
  const m = new GestureMachine();
  return inputs.flatMap((i) => m.feed(i)).map((e) => e.type);
};

test('one finger: a tap, or a drag once it moves past the slop', () => {
  assert.deepEqual(run([ev('down', 1, 10, 10, 0), ev('move', 1, 10 + SLOP - 1, 10, 5), ev('up', 1, 12, 10, 9)]), ['tool-down', 'tool-tap']);
  assert.deepEqual(run([ev('down', 1, 10, 10, 0), ev('move', 1, 30, 10, 5), ev('move', 1, 40, 10, 6), ev('up', 1, 40, 10, 9)]),
    ['tool-down', 'tool-drag-start', 'tool-drag', 'tool-drag-end']);
});

test('a second finger cancels the tool gesture and pinches; leftover fingers do nothing', () => {
  assert.deepEqual(run([
    ev('down', 1, 10, 10, 0), ev('move', 1, 30, 10, 5), ev('down', 2, 100, 100, 50), ev('move', 2, 120, 120, 60),
    ev('up', 1, 30, 10, 400), ev('move', 2, 200, 200, 410), ev('down', 3, 5, 5, 420), ev('up', 2, 200, 200, 500), ev('up', 3, 5, 5, 510),
  ]), ['tool-down', 'tool-drag-start', 'tool-cancel', 'nav-start', 'nav', 'nav-end']);
});

test('a quick two-finger tap is undo; a slow or moving one is not', () => {
  assert.deepEqual(run([ev('down', 1, 10, 10, 0), ev('down', 2, 60, 10, 20), ev('up', 1, 10, 10, 120), ev('up', 2, 60, 10, 130)]),
    ['tool-down', 'tool-cancel', 'nav-start', 'nav-end', 'two-finger-tap']);
  assert.ok(!run([ev('down', 1, 10, 10, 0), ev('down', 2, 60, 10, 20), ev('up', 1, 10, 10, 900)]).includes('two-finger-tap'));
  assert.ok(!run([ev('down', 1, 10, 10, 0), ev('down', 2, 60, 10, 20), ev('move', 2, 90, 10, 60), ev('up', 1, 10, 10, 120)]).includes('two-finger-tap'));
});

test('the Pencil draws while fingers navigate, and a resting palm never reaches the tool', () => {
  assert.deepEqual(run([
    ev('down', 9, 50, 50, 0, 'pen'), ev('down', 1, 300, 300, 10), ev('move', 9, 80, 50, 20, 'pen'), ev('move', 9, 90, 50, 30, 'pen'),
    ev('up', 1, 300, 300, 40), ev('up', 9, 90, 50, 50, 'pen'),
  ]), ['tool-down', 'tool-drag-start', 'tool-drag', 'tool-drag-end']);
  assert.deepEqual(run([
    ev('down', 1, 10, 10, 0), ev('down', 9, 50, 50, 5, 'pen'), ev('down', 2, 300, 300, 10), ev('down', 3, 350, 300, 12), ev('move', 3, 380, 300, 20),
  ]), ['tool-down', 'tool-cancel', 'tool-down', 'nav-start', 'nav']);
});

test('a cancelled pointer cancels its gesture; the mouse is a tool pointer', () => {
  assert.deepEqual(run([ev('down', 1, 10, 10, 0), ev('cancel', 1, 10, 10, 5)]), ['tool-down', 'tool-cancel']);
  assert.deepEqual(run([ev('down', 1, 10, 10, 0, 'mouse'), ev('move', 1, 50, 10, 5, 'mouse'), ev('up', 1, 50, 10, 9, 'mouse')]),
    ['tool-down', 'tool-drag-start', 'tool-drag-end']);
});
