import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GestureMachine, type Intent } from '../../src/core/gestures.ts';
import { snap, type Candidate } from '../../src/core/snap.ts';

const pt = (id: number, x: number, y: number, t: number, touch = true) => ({ id, x, y, t, touch });
const types = (xs: Intent[]) => xs.map((i) => i.type);

test('GEST-01 a double-tap on a tab bar frames its panel; slow or far taps don\'t', () => {
  const g = new GestureMachine();
  g.down(pt(1, 100, 10, 0), 'tabbar', 'p1');
  assert.deepEqual(g.up(pt(1, 100, 10, 50)), []);
  g.down(pt(2, 104, 12, 200), 'tabbar', 'p1');
  const out = g.up(pt(2, 104, 12, 240));
  assert.deepEqual(types(out), ['double-tap']);
  assert.equal(out[0].type === 'double-tap' && out[0].target, 'p1');
  // Too slow
  g.down(pt(3, 100, 10, 1000), 'tabbar', 'p1');
  g.up(pt(3, 100, 10, 1050));
  g.down(pt(4, 100, 10, 1400), 'tabbar', 'p1');
  assert.deepEqual(g.up(pt(4, 100, 10, 1450)), []);
  // A different panel
  g.down(pt(5, 100, 10, 2000), 'tabbar', 'p1');
  g.up(pt(5, 100, 10, 2050));
  g.down(pt(6, 100, 10, 2100), 'tabbar', 'p2');
  assert.deepEqual(g.up(pt(6, 100, 10, 2150)), []);
});

test('GEST-02 one finger in content is never claimed', () => {
  const g = new GestureMachine();
  assert.deepEqual(g.down(pt(1, 100, 100, 0), 'content'), []);
  assert.deepEqual(g.move(pt(1, 100, 300, 50)), []);
  assert.deepEqual(g.up(pt(1, 100, 300, 60)), []);
  assert.equal(g.active, false);
});

test('GEST-03 a second finger claims the camera, even over content; the scale follows the fingers', () => {
  const g = new GestureMachine();
  g.down(pt(1, 100, 100, 0), 'content');
  assert.deepEqual(types(g.down(pt(2, 200, 100, 10), 'content')), ['camera-start']);
  assert.equal(g.active, true);
  const mv = g.move(pt(2, 300, 100, 30));
  assert.equal(mv[0].type === 'camera-move' && mv[0].scale, 2);
  const end = g.up(pt(1, 100, 100, 40));
  assert.deepEqual(types(end), ['camera-end']);
  // The finger still down does nothing until it lifts.
  assert.deepEqual(g.move(pt(2, 320, 100, 50)), []);
  assert.deepEqual(g.up(pt(2, 320, 100, 60)), []);
});

test('GEST-04 a cancelled pointer is forgotten; a cancelled pair ends the camera gesture', () => {
  const g = new GestureMachine();
  g.down(pt(1, 100, 100, 0), 'content');
  assert.deepEqual(g.cancel(1), []);
  assert.deepEqual(g.down(pt(2, 150, 100, 20), 'content'), [], 'one live finger, no camera');
  g.down(pt(3, 250, 100, 30), 'content');
  assert.equal(g.active, true);
  assert.deepEqual(types(g.cancel(3)), ['camera-end']);
  assert.equal(g.active, false);
});

test('GEST-05 a top-bar swipe flips to a neighbour; a short or vertical drag doesn\'t', () => {
  const g = new GestureMachine();
  g.down(pt(1, 300, 20, 0), 'topbar');
  g.move(pt(1, 200, 24, 200));
  assert.deepEqual(g.up(pt(1, 200, 24, 400)), [{ type: 'bar-swipe', dir: 1 }]);
  g.down(pt(2, 100, 20, 1000), 'topbar');
  g.move(pt(2, 120, 20, 1300));
  assert.deepEqual(g.up(pt(2, 120, 20, 1600)), []);
  g.down(pt(3, 100, 20, 2000), 'topbar');
  g.move(pt(3, 160, 120, 2300));
  assert.deepEqual(g.up(pt(3, 160, 120, 2600)), []);
});

test('GEST-06 an edge swipe walks history when it goes far enough or is flicked', () => {
  const g = new GestureMachine();
  g.width = 400;
  g.down(pt(1, 5, 300, 0), 'edge-left');
  g.move(pt(1, 60, 300, 400));
  assert.deepEqual(g.up(pt(1, 60, 300, 800)), [{ type: 'edge-end', side: 'left', commit: false }]);
  g.down(pt(2, 5, 300, 1000), 'edge-left');
  g.move(pt(2, 160, 300, 1300));
  assert.deepEqual(g.up(pt(2, 160, 300, 1500)), [{ type: 'edge-end', side: 'left', commit: true }]);
  g.down(pt(3, 395, 300, 2000), 'edge-right');
  g.move(pt(3, 330, 300, 2040));
  assert.deepEqual(g.up(pt(3, 320, 300, 2060)), [{ type: 'edge-end', side: 'right', commit: true }], 'a flick');
});

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const V = box(0, 0, 440, 800);

test('SNAP-01 pinching into a big panel near the middle frames that panel, not the overview', () => {
  // The Trellis regression: the overview is the root; the big panel takes 3/4 of the width.
  const c: Candidate[] = [
    { id: null, box: V, relation: 'self' },
    { id: 'big', box: box(0, 0, 330, 800), relation: 'descendant' },
    { id: 'side', box: box(336, 0, 104, 800), relation: 'descendant' },
  ];
  const view = box(170, 260, 100, 180); // zoomed ×4.4 around (220, 350)
  assert.equal(snap(c, { scale: 4.4, focal: { x: 220, y: 350 }, view, vx: 0, vy: 0 }), 'big');
});

test('SNAP-02 pinching out steps out to an ancestor', () => {
  const c: Candidate[] = [
    { id: 'p', box: V, relation: 'self' },
    { id: 'split', box: box(-446, 0, 1332, 800), relation: 'ancestor' },
    { id: null, box: box(-1340, -1800, 4000, 5200), relation: 'ancestor' },
  ];
  assert.equal(snap(c, { scale: 0.5, focal: { x: 220, y: 400 }, view: box(-220, -400, 880, 1600), vx: 0, vy: 0 }), 'split');
});

test('SNAP-03 a pan moves to the next page past a quarter width, or on a flick; otherwise stays', () => {
  const c: Candidate[] = [
    { id: 'a', box: V, relation: 'self' },
    { id: 'b', box: box(446, 0, 440, 800), relation: 'page' },
  ];
  const stay = snap(c, { scale: 1, focal: { x: 0, y: 0 }, view: box(60, 0, 440, 800), vx: 0, vy: 0 });
  assert.equal(stay, 'a');
  const go = snap(c, { scale: 1, focal: { x: 0, y: 0 }, view: box(200, 0, 440, 800), vx: 0, vy: 0 });
  assert.equal(go, 'b');
  const flick = snap(c, { scale: 1, focal: { x: 0, y: 0 }, view: box(40, 0, 440, 800), vx: 1, vy: 0 });
  assert.equal(flick, 'b');
});

test('SNAP-05 a moderate pinch out goes one level; a strong one goes further', () => {
  // Framed: a page of a two-page row; above it the root column, three times the row's height.
  const c: Candidate[] = [
    { id: 'page', box: V, relation: 'self' },
    { id: 'row', box: box(0, 0, 886, 800), relation: 'ancestor', levels: 1 },
    { id: null, box: box(0, -1600, 886, 2412), relation: 'ancestor', levels: 2 },
  ];
  const view = (k: number) => box(220 - 220 / k, 400 - 400 / k, 440 / k, 800 / k);
  assert.equal(snap(c, { scale: 0.5, focal: { x: 220, y: 400 }, view: view(0.5), vx: 0, vy: 0 }), 'row');
  assert.equal(snap(c, { scale: 0.2, focal: { x: 220, y: 400 }, view: view(0.2), vx: 0, vy: 0 }), null);
});

test('SNAP-04 every zoom-in candidate contains the focal point', () => {
  const c: Candidate[] = [
    { id: 'p', box: V, relation: 'self' },
    { id: 'left', box: box(0, 0, 200, 800), relation: 'descendant' },
    { id: 'right', box: box(206, 0, 234, 800), relation: 'descendant' },
  ];
  assert.equal(snap(c, { scale: 2, focal: { x: 300, y: 400 }, view: box(190, 200, 220, 400), vx: 0, vy: 0 }), 'right');
});
