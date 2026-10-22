import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GestureMachine, type Intent } from '../../src/core/gestures.ts';
import { snap, type Candidate } from '../../src/core/snap.ts';

const pt = (id: number, x: number, y: number, t: number, touch = true) => ({ id, x, y, t, touch });
const types = (xs: Intent[]) => xs.map((i) => i.type);

test('GEST-01 taps on a caption are left to the click: no double-tap (a first tap already zooms)', () => {
  const g = new GestureMachine();
  g.down(pt(1, 100, 10, 0), 'caption', 'p1');
  assert.deepEqual(g.up(pt(1, 100, 10, 50)), []);
  g.down(pt(2, 104, 12, 200), 'caption', 'p1');
  assert.deepEqual(g.up(pt(2, 104, 12, 240)), []);
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
  g.down(pt(1, 300, 20, 0), 'capsule');
  g.move(pt(1, 200, 24, 200));
  assert.deepEqual(g.up(pt(1, 200, 24, 400)), [{ type: 'bar-swipe', dir: 1 }]);
  g.down(pt(2, 100, 20, 1000), 'capsule');
  g.move(pt(2, 120, 20, 1300));
  assert.deepEqual(g.up(pt(2, 120, 20, 1600)), []);
  g.down(pt(3, 100, 20, 2000), 'capsule');
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

// ---------------------------------------------------------------- Arrange

test('GEST-ARR-01 in Arrange, a tab lifts past the slop; moves follow; release drops', () => {
  const g = new GestureMachine();
  g.arrange = true;
  assert.deepEqual(g.down(pt(1, 100, 100, 0), 'tab', 'rose', 'p-amber'), []);
  assert.deepEqual(g.move(pt(1, 105, 100, 10)), [], 'inside the slop');
  const lift = g.move(pt(1, 120, 100, 20));
  assert.deepEqual(types(lift), ['drag-start', 'drag-move']);
  assert.ok(lift[0].type === 'drag-start' && lift[0].target === 'rose' && lift[0].region === 'tab' && lift[0].x0 === 100);
  assert.equal(g.dragging, true);
  assert.deepEqual(g.move(pt(1, 200, 150, 30)), [{ type: 'drag-move', x: 200, y: 150 }]);
  assert.deepEqual(g.up(pt(1, 210, 150, 40)), [{ type: 'drag-end', x: 210, y: 150 }]);
  assert.equal(g.dragging, false);
});

test('GEST-ARR-02 outside Arrange the same press never lifts', () => {
  const g = new GestureMachine();
  g.down(pt(1, 100, 100, 0), 'panel', 'p-sky');
  assert.deepEqual(g.move(pt(1, 200, 100, 20)), []);
  assert.deepEqual(g.up(pt(1, 200, 100, 30)), []);
});

test('GEST-ARR-03 a second finger before the lift is a camera gesture; after it, it is ignored', () => {
  const g = new GestureMachine();
  g.arrange = true;
  g.down(pt(1, 100, 100, 0), 'panel', 'p-sky');
  assert.deepEqual(types(g.down(pt(2, 200, 100, 5), 'panel', 'p-sky')), ['camera-start']);
  assert.deepEqual(types(g.move(pt(1, 60, 100, 20))), ['camera-move']);
  g.up(pt(1, 60, 100, 30));
  g.up(pt(2, 200, 100, 30));
  assert.equal(g.dragging, false);

  const h = new GestureMachine();
  h.arrange = true;
  h.down(pt(1, 100, 100, 0), 'panel', 'p-sky');
  h.move(pt(1, 130, 100, 10));
  assert.deepEqual(h.down(pt(2, 300, 300, 20), 'panel', 'p-sky'), []);
  assert.deepEqual(h.move(pt(2, 350, 300, 30)), []);
  assert.deepEqual(h.up(pt(2, 350, 300, 40)), []);
  assert.equal(h.active, false);
  assert.deepEqual(types(h.up(pt(1, 140, 100, 50))), ['drag-end']);
});

test('GEST-ARR-04 a divider resizes by its offset; a double-tap evens it', () => {
  const g = new GestureMachine();
  g.arrange = true;
  g.down(pt(1, 100, 100, 0), 'divider', 'mid:0');
  assert.deepEqual(types(g.move(pt(1, 130, 100, 10))), ['resize-start', 'resize-move']);
  assert.deepEqual(g.up(pt(1, 140, 102, 20)), [{ type: 'resize-end', dx: 40, dy: 2 }]);
  g.down(pt(2, 100, 100, 500), 'divider', 'mid:0');
  g.up(pt(2, 100, 100, 520));
  g.down(pt(3, 102, 100, 600), 'divider', 'mid:0');
  assert.deepEqual(g.up(pt(3, 102, 100, 620)), [{ type: 'equalize', target: 'mid:0' }]);
});

test('GEST-ARR-05 a cancelled pointer or cancelLift abandons the drag', () => {
  const g = new GestureMachine();
  g.arrange = true;
  g.down(pt(1, 100, 100, 0), 'tab', 'sky', 'p-sky');
  g.move(pt(1, 140, 100, 10));
  assert.deepEqual(g.cancel(1), [{ type: 'drag-cancel' }]);
  assert.equal(g.dragging, false);
  g.down(pt(2, 100, 100, 100), 'tab', 'sky', 'p-sky');
  g.move(pt(2, 140, 100, 110));
  assert.deepEqual(g.cancelLift(), [{ type: 'drag-cancel' }]);
  assert.deepEqual(g.move(pt(2, 160, 100, 120)), [], 'the finger still down does nothing more');
  assert.deepEqual(g.up(pt(2, 160, 100, 130)), []);
});

test('GEST-ARR-06 in Arrange a double-tap on a tab is not a gesture either', () => {
  const g = new GestureMachine();
  g.arrange = true;
  g.down(pt(1, 100, 10, 0), 'tab', 'rose', 'p-amber');
  g.up(pt(1, 100, 10, 40));
  g.down(pt(2, 101, 10, 150), 'tab', 'amber', 'p-amber');
  assert.deepEqual(g.up(pt(2, 101, 10, 190)), []);
});

// ---------------------------------------------------------------- long press

test('GEST-HOLD-01 a still press on a caption name, held, turns Arrange on and lifts it in one motion', () => {
  const g = new GestureMachine();
  g.down(pt(1, 100, 10, 0), 'tab', 'rose', 'p-amber');
  g.move(pt(1, 103, 11, 200)); // inside the slop
  const out = g.hold(1);
  assert.deepEqual(types(out), ['arrange-on', 'drag-start']);
  assert.ok(out[1].type === 'drag-start' && out[1].region === 'tab' && out[1].target === 'rose');
  assert.equal(g.arrange, true);
  assert.deepEqual(types(g.move(pt(1, 160, 80, 600))), ['drag-move']);
  assert.deepEqual(types(g.up(pt(1, 160, 80, 650))), ['drag-end']);
});

test('GEST-HOLD-02 a hold does nothing once the finger moved, on live content, with two fingers, or after release', () => {
  const g = new GestureMachine();
  g.down(pt(1, 100, 10, 0), 'tab', 'rose', 'p-amber');
  g.move(pt(1, 130, 10, 100));
  assert.deepEqual(g.hold(1), [], 'moved past the slop');
  g.up(pt(1, 130, 10, 150));
  g.down(pt(2, 100, 300, 1000), 'content');
  assert.deepEqual(g.hold(2), [], 'content belongs to the app');
  g.up(pt(2, 100, 300, 1050));
  g.down(pt(3, 100, 300, 2000), 'panel', 'p-sky');
  g.down(pt(4, 200, 300, 2010), 'panel', 'p-sky');
  assert.deepEqual(g.hold(3), [], 'a second finger made it a camera gesture');
  g.up(pt(3, 100, 300, 2100));
  g.up(pt(4, 200, 300, 2100));
  g.down(pt(5, 100, 300, 3000), 'panel', 'p-sky');
  g.up(pt(5, 100, 300, 3050));
  assert.deepEqual(g.hold(5), [], 'already released');
});

test('GEST-HOLD-03 in Arrange a hold lifts without turning Arrange on again', () => {
  const g = new GestureMachine();
  g.arrange = true;
  g.down(pt(1, 100, 300, 0), 'panel', 'p-sky');
  assert.deepEqual(types(g.hold(1)), ['drag-start']);
});
