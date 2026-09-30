// The overlay model (src/interact/overlay-model.ts): where the paper, the grid, the tooltip and the
// coordinate guides go, as plain numbers in host px.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordGuides, gridModel, gridStep, paperRect, quadOf, rootToHost, tip, tipBox, unionBox, GRID_MIN_PX } from '../../src/interact/overlay-model.ts';

const HOST = { width: 400, height: 300 };

test('the paper is the artboard through M and the camera box, or the box itself without one', () => {
  // viewBox 0 0 100 50 in a 400 × 300 viewport: M scales by 4 and centres it (50 px down).
  const M = [4, 0, 0, 4, 0, 50] as const;
  const box = { left: 10, top: -20, width: 800, height: 600 }; // zoomed 2×
  assert.deepEqual(paperRect(box, HOST, M, { x: 0, y: 0, width: 100, height: 50 }), { x: 10, y: 80, width: 800, height: 400 });
  assert.deepEqual(paperRect(box, HOST, M, null), { x: 10, y: -20, width: 800, height: 600 }, 'no artboard: the box');
  assert.deepEqual(rootToHost(box, HOST, M, { x: 25, y: 25 }), { x: 210, y: 280 });
});

test('the grid step is the smallest 1, 2 or 5 × 10ⁿ root units at least 12 px apart', () => {
  assert.equal(GRID_MIN_PX, 12);
  const cases: [number, number][] = [[12, 1], [11.9, 2], [6, 2], [5.9, 5], [2.4, 5], [2.3, 10], [1, 20], [0.1, 200], [120, 0.1], [13, 1], [1200, 0.01], [24, 0.5]];
  for (const [pxPerUnit, step] of cases) assert.equal(gridStep(pxPerUnit), step, `${pxPerUnit} px per unit`);
  for (let k = 0.013; k < 4000; k *= 1.37) {
    const s = gridStep(k);
    assert.ok(s * k >= GRID_MIN_PX - 1e-9, `${k}: ${s} is ${s * k} px apart`);
    const finer = [1, 2, 5].flatMap((m) => [-4, -3, -2, -1, 0, 1, 2, 3].map((e) => m * 10 ** e)).filter((x) => x < s - 1e-12);
    assert.ok(finer.every((x) => x * k < GRID_MIN_PX), `${k}: a finer step would do`);
  }
});

test('grid lines sit at multiples of the step in root units, over the paper and inside the host only, every fifth major', () => {
  const M = [1, 0, 0, 1, 0, 0] as const;
  const box = { left: 50, top: 20, width: 300, height: 300 }; // 1 root unit = 3 px (viewport 100 × 100)
  const vp = { width: 100, height: 100 };
  const paper = paperRect(box, vp, M, { x: 0, y: 0, width: 100, height: 100 });
  const step = gridStep(3);
  assert.equal(step, 5);
  const g = gridModel(box, vp, M, HOST, paper, step);
  assert.deepEqual(g.over, { x: 50, y: 20, width: 300, height: 280 }, 'the paper, clipped to the host');
  assert.deepEqual(g.x.map((l) => l.at), Array.from({ length: 21 }, (_, i) => 50 + i * 15));
  assert.ok(g.x.every((l) => l.major === (Math.round((l.at - 50) / 15) % 5 === 0)), 'every fifth line is major');
  assert.equal(g.y.at(-1)!.at, 20 + 18 * 15, 'the last y line inside the host (300 px tall)');
  assert.equal(gridModel(box, vp, M, HOST, { x: 500, y: 0, width: 10, height: 10 }, 5).x.length, 0, 'a paper outside the host: no lines');
});

test('the tooltip sits 42 px above the finger, 40 px below it within 64 px of the top, and 4 px inside the canvas', () => {
  const t = tip('x 3, y 4', { x: 200, y: 150 });
  assert.equal(t.below, false);
  assert.deepEqual(tipBox(t, 60, 24, 400), { left: 170, top: 150 - 42 - 24 }, 'centred, its bottom edge 42 px above');
  const near = tip('x 3, y 4', { x: 200, y: 63 });
  assert.equal(near.below, true, 'within 64 px of the top it flips below');
  assert.deepEqual(tipBox(near, 60, 24, 400), { left: 170, top: 63 + 40 }, 'its top edge 40 px below');
  assert.equal(tip('', { x: 0, y: 64 }).below, false, '64 px down is not near');
  assert.equal(tipBox(tip('a', { x: 2, y: 100 }), 60, 24, 400).left, 4, 'kept 4 px inside at the left');
  assert.equal(tipBox(tip('a', { x: 399, y: 100 }), 60, 24, 400).left, 400 - 4 - 60, 'and at the right');
});

test('coordinate guides run from the paper’s left and top edges to the centre; labels show only on guides long enough, the y label flips left near the right edge', () => {
  const paper = { x: 20, y: 30, width: 300, height: 200 };
  const g = coordGuides({ x: 120, y: 130 }, paper, { x: 50, y: 60 }, 0, 400);
  assert.deepEqual(g.lines, [{ from: { x: 20, y: 130 }, to: { x: 120, y: 130 } }, { from: { x: 120, y: 30 }, to: { x: 120, y: 130 } }]);
  assert.deepEqual(g.labels.map((l) => [l.text, l.anchor]), [['x = 50', 'middle'], ['y = 60', 'start']]);
  const short = coordGuides({ x: 20 + 63, y: 30 + 55 }, paper, { x: 1, y: 2 }, 0, 400);
  assert.deepEqual(short.labels, [], 'x guide under 64 px, y guide under 56 px: no labels');
  const edge = coordGuides({ x: 400 - 95, y: 130 }, paper, { x: 1.25, y: 2 }, 2, 400);
  assert.deepEqual(edge.labels.map((l) => [l.text, l.anchor]), [['x = 1.25', 'middle'], ['y = 2', 'end']], 'within 96 px of the right edge the y label goes left');
});

test('quads come from a local box through its matrix, and a union box holds them all', () => {
  const q = quadOf({ x: 0, y: 0, width: 10, height: 20 }, [0, 1, -1, 0, 100, 50]); // turned 90°
  assert.deepEqual(q, [{ x: 100, y: 50 }, { x: 100, y: 60 }, { x: 80, y: 60 }, { x: 80, y: 50 }]);
  assert.deepEqual(unionBox([q, quadOf({ x: 0, y: 0, width: 1, height: 1 }, [1, 0, 0, 1, 0, 0])]), { x: 0, y: 0, width: 100, height: 60 });
  assert.equal(unionBox([]), null);
});
