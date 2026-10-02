// The canvas camera and the gesture machine: the zoom invariant, pinch, and who owns a pointer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camera, drawable, fit, pinch, toDoc, toScreen, zoomAbout, panBy, MAX_SCALE, type View } from '../../src/canvas/viewport.ts';
import { GestureMachine, HOLD_MS, SLOP, type GestureEvent, type PointerInput } from '../../src/canvas/gestures.ts';
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

test('zooming in never zooms out: an artboard that fits above MAX_SCALE may still zoom to 16× its fit', () => {
  const tiny = fit({ x: 0, y: 0, width: 1, height: 1 }, HOST, 16); // viewBox="0 0 1 1": 408 px per unit
  assert.ok(tiny.scale > MAX_SCALE, 'test setup: the fit is above MAX_SCALE');
  assert.equal(zoomAbout(tiny, HOST, { x: 220, y: 276 }, 2, tiny.scale).scale, tiny.scale * 2, 'one notch in doubles it');
  assert.equal(zoomAbout(tiny, HOST, { x: 0, y: 0 }, 1e9, tiny.scale).scale, tiny.scale * 16, 'capped at 16× the fit');
  for (const f of [1e-3, 0.5, 1, 16, 255, 256, 257, 1000, 1e5]) {
    const v: View = { cx: 0, cy: 0, scale: f };
    assert.ok(zoomAbout(v, HOST, { x: 0, y: 0 }, 1.5, f).scale > f, `fit ${f}: a zoom in`);
    assert.ok(pinch(v, HOST, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 15, y: 0 }, f).scale > f, `fit ${f}: a pinch out`);
  }
});

test('a view near the float limit is not drawable (its camera overflows)', () => {
  assert.ok(drawable({ cx: 1e300, cy: -1e300, scale: 1e-6 }, HOST));
  assert.ok(!drawable({ cx: Infinity, cy: 0, scale: 1 }, HOST), 'a centre that overflowed (viewBox 1.7e308 …)');
  assert.ok(!drawable({ cx: 5e307, cy: 5e307, scale: 2.5e-307 }, HOST), 'a camera wider than the largest double (viewBox 0 0 1e308 1e308, zoomed out)');
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

test('a move under 5 pt is a tap; 5 pt or more, in any direction, is a drag (SVG Lab\'s number, pinned)', () => {
  const tap = ['tool-down', 'tool-tap'];
  for (const [dx, dy] of [[4.9, 0], [0, -4.9], [3, 3.9]]) {
    assert.deepEqual(run([ev('down', 1, 10, 10, 0), ev('move', 1, 10 + dx, 10 + dy, 5), ev('up', 1, 10 + dx, 10 + dy, 9)]), tap, `${dx},${dy}`);
  }
  for (const [dx, dy] of [[5.1, 0], [0, 5], [-3, 4.1]]) {
    assert.deepEqual(run([ev('down', 1, 10, 10, 0), ev('move', 1, 10 + dx, 10 + dy, 5), ev('up', 1, 10 + dx, 10 + dy, 9)]), ['tool-down', 'tool-drag-start', 'tool-drag-end'], `${dx},${dy}`);
  }
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

test('a drag that starts after the pointer was held still for 450 ms is held; a quick one, or one that moved first, is not', () => {
  assert.equal(HOLD_MS, 450);
  const start = (inputs: PointerInput[]) => {
    const m = new GestureMachine();
    return inputs.flatMap((i) => m.feed(i)).find((e): e is Extract<GestureEvent, { type: 'tool-drag-start' }> => e.type === 'tool-drag-start');
  };
  assert.equal(start([ev('down', 1, 10, 10, 0), ev('move', 1, 11, 10, 300), ev('move', 1, 30, 10, 460)])?.held, true, 'held still, then dragged');
  assert.equal(start([ev('down', 1, 10, 10, 0), ev('move', 1, 30, 10, 449)])?.held, false, 'a drag at 449 ms');
  assert.equal(start([ev('down', 1, 10, 10, 0), ev('move', 1, 30, 10, 100), ev('move', 1, 60, 10, 900)])?.held, false, 'moved past the slop at once: an ordinary drag, however long it lasts');
  assert.equal(start([ev('down', 1, 10, 10, 0, 'mouse'), ev('move', 1, 30, 10, 600, 'mouse')])?.held, true, 'the mouse too');
  assert.equal(start([ev('down', 9, 10, 10, 0, 'pen'), ev('move', 9, 30, 10, 500, 'pen')])?.held, true, 'and the Pencil');
});

// ── P1-M5: pen mode, the Pencil's hover, and the Pencil button ──────────────────────────────────

const hover = (type: PointerInput['type'], x: number, y: number, t: number, buttons = 0): PointerInput => ({ type, id: 9, x, y, t, kind: 'pen', buttons });
const feedAll = (m: GestureMachine, inputs: PointerInput[]) => inputs.flatMap((i) => m.feed(i)).map((e) => e.type);

test('pen mode latches on a pen press and on a pen hover, never on a touch or the mouse, and lasts until left', () => {
  const touch = new GestureMachine();
  feedAll(touch, [ev('down', 1, 10, 10, 0), ev('move', 1, 40, 10, 5), ev('up', 1, 40, 10, 9), ev('down', 2, 10, 10, 20, 'mouse'), ev('up', 2, 10, 10, 30, 'mouse')]);
  assert.equal(touch.penMode, false, 'fingers and the mouse');
  const press = new GestureMachine();
  feedAll(press, [ev('down', 9, 10, 10, 0, 'pen'), ev('up', 9, 10, 10, 5, 'pen')]);
  assert.equal(press.penMode, true, 'a pen press');
  feedAll(press, [ev('down', 1, 10, 10, 100), ev('up', 1, 10, 10, 120)]);
  assert.equal(press.penMode, true, 'still on after a finger');
  const hovered = new GestureMachine();
  assert.deepEqual(feedAll(hovered, [hover('move', 10, 10, 0)]), ['hover']);
  assert.equal(hovered.penMode, true, 'a pen hover');
});

test('in pen mode one finger pans once it moves and never becomes the tool; two still pinch; a two-finger tap is no undo', () => {
  const m = new GestureMachine();
  feedAll(m, [ev('down', 9, 50, 50, 0, 'pen'), ev('up', 9, 50, 50, 5, 'pen')]);
  assert.deepEqual(feedAll(m, [ev('down', 1, 100, 100, 10), ev('move', 1, 102, 100, 12), ev('move', 1, 130, 100, 20), ev('move', 1, 140, 110, 30), ev('up', 1, 140, 110, 40)]),
    ['pan-start', 'pan', 'pan', 'pan-end'], 'a one-finger drag pans');
  const pans: GestureEvent[] = [];
  for (const i of [ev('down', 1, 100, 100, 50), ev('move', 1, 130, 100, 60), ev('move', 1, 140, 110, 70)]) pans.push(...m.feed(i));
  assert.deepEqual(pans.filter((e) => e.type === 'pan'), [{ type: 'pan', from: { x: 100, y: 100 }, at: { x: 130, y: 100 } }, { type: 'pan', from: { x: 130, y: 100 }, at: { x: 140, y: 110 } }], 'each pan from where the last left off, the first from the press');
  m.feed(ev('up', 1, 140, 110, 80));
  assert.deepEqual(feedAll(m, [ev('down', 1, 10, 10, 100), ev('up', 1, 11, 10, 120)]), [], 'a one-finger tap does nothing');
  assert.deepEqual(feedAll(m, [ev('down', 1, 10, 10, 200), ev('down', 2, 60, 10, 220), ev('up', 1, 10, 10, 320), ev('up', 2, 60, 10, 330)]), ['nav-start', 'nav-end'], 'a quick two-finger tap: no undo');
  assert.deepEqual(feedAll(m, [ev('down', 1, 10, 10, 400), ev('move', 1, 40, 10, 410), ev('down', 2, 60, 10, 420), ev('move', 2, 90, 10, 430), ev('up', 1, 40, 10, 440), ev('up', 2, 90, 10, 450)]),
    ['pan-start', 'pan', 'pan-end', 'nav-start', 'nav', 'nav-end'], 'a second finger turns a pan into a pinch');
  assert.deepEqual(feedAll(m, [ev('down', 9, 50, 50, 500, 'pen'), ev('down', 1, 200, 200, 510), ev('move', 9, 80, 50, 520, 'pen'), ev('move', 1, 240, 200, 530), ev('move', 9, 90, 50, 540, 'pen'), ev('up', 1, 240, 200, 550), ev('up', 9, 90, 50, 560, 'pen')]),
    ['tool-down', 'tool-drag-start', 'pan-start', 'pan', 'tool-drag', 'pan-end', 'tool-drag-end'], 'a finger pans while the Pencil drags');
});

test('a hovering Pencil: a pen move with no button and no press is hover; it ends on leaving, on a cancel and before any press; a pen move with a button down is no hover', () => {
  const m = new GestureMachine();
  assert.deepEqual(feedAll(m, [hover('move', 10, 10, 0), hover('move', 12, 10, 5), hover('leave', 12, 10, 9)]), ['hover', 'hover', 'hover-end']);
  assert.deepEqual(m.feed(hover('move', 20, 20, 10)), [{ type: 'hover', at: { x: 20, y: 20 } }]);
  assert.deepEqual(feedAll(m, [hover('cancel', 20, 20, 12)]), ['hover-end'], 'a cancel');
  assert.deepEqual(feedAll(m, [hover('move', 20, 20, 20), ev('down', 1, 300, 300, 25), ev('up', 1, 300, 300, 30)]), ['hover', 'hover-end'], 'a finger’s press ends it (and, in pen mode, does nothing else)');
  assert.deepEqual(feedAll(m, [hover('move', 20, 20, 40), ev('down', 9, 20, 20, 45, 'pen'), ev('up', 9, 20, 20, 50, 'pen')]), ['hover', 'hover-end', 'tool-down', 'tool-tap'], 'the pen’s own press');
  assert.deepEqual(feedAll(new GestureMachine(), [hover('move', 10, 10, 0, 1), hover('leave', 10, 10, 5, 1)]), [], 'a button pressed: no hover');
  assert.deepEqual(feedAll(new GestureMachine(), [hover('leave', 10, 10, 0)]), [], 'a leave with no hover says nothing');
});

test('the Pencil button: leaving pen mode gives a finger the tool and the two-finger tap’s undo back; the next pen event latches it again', () => {
  const m = new GestureMachine();
  feedAll(m, [ev('down', 9, 50, 50, 0, 'pen'), ev('up', 9, 50, 50, 5, 'pen')]);
  m.leavePenMode();
  assert.equal(m.penMode, false);
  assert.deepEqual(feedAll(m, [ev('down', 1, 10, 10, 10), ev('move', 1, 40, 10, 20), ev('up', 1, 40, 10, 30)]), ['tool-down', 'tool-drag-start', 'tool-drag-end'], 'a finger draws again');
  assert.deepEqual(feedAll(m, [ev('down', 1, 10, 10, 100), ev('down', 2, 60, 10, 120), ev('up', 1, 10, 10, 220), ev('up', 2, 60, 10, 230)]), ['tool-down', 'tool-cancel', 'nav-start', 'nav-end', 'two-finger-tap'], 'and a two-finger tap undoes');
  feedAll(m, [hover('move', 20, 20, 300), hover('leave', 20, 20, 310)]);
  assert.equal(m.penMode, true, 'a hover latches it again');
});
