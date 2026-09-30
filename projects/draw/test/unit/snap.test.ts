// Snapping (src/interact/snap.ts): the step a move rounds to, and the targets within 8 px that take
// a moving box's edges and centre, or a handle's point, each axis on its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SNAP_PX, boxTargets, snapAxis, snapStep, stepDecimals, toStep, type SnapTarget } from '../../src/interact/snap.ts';

test('the snap step: whole units until 1 unit is 32 px on screen, then 0.5, 0.1, 0.05, 0.01; a delta rounds to it', () => {
  assert.deepEqual([1, 18, 31.9, 32, 63, 64, 320, 640, 3200, 1e5].map(snapStep), [1, 1, 1, 1, 1, 0.5, 0.1, 0.05, 0.01, 0.01]);
  assert.deepEqual([1, 0.5, 0.1, 0.05, 0.01].map(stepDecimals), [0, 1, 1, 2, 2]);
  assert.deepEqual([toStep(2.49, 1), toStep(2.5, 1), toStep(-2.26, 0.5), toStep(0.123, 0.05)], [2, 3, -2.5, 0.1]);
});

test('a target within 8 px takes the nearest candidate: guide, then shape, then artboard, then grid on a tie; none near, no snap', () => {
  assert.equal(SNAP_PX, 8);
  const t: SnapTarget[] = [{ at: 40, kind: 'shape' }, { at: 40, kind: 'guide' }, { at: 100, kind: 'artboard' }];
  // A box from 20 to 30 (centre 25), moved by 18: its left edge (38) is the nearest to 40.
  assert.deepEqual(snapAxis([20, 25, 30], 18, t, null, 8), { d: 20, at: 40, kind: 'guide' }, 'the left edge lands on 40, and the guide wins the tie');
  assert.equal(snapAxis([20, 25, 30], 1, t, null, 8), null, 'every candidate more than 8 away: none');
  assert.deepEqual(snapAxis([20, 25, 30], 14, t, null, 8), { d: 15, at: 40, kind: 'guide' }, 'the centre (39) is the nearest');
  assert.deepEqual(snapAxis([97], 0, t, 10, 4), { d: 3, at: 100, kind: 'artboard' }, 'the artboard beats the grid line at the same place');
  assert.deepEqual(snapAxis([12], 5, [], 10, 4), { d: 8, at: 20, kind: 'grid' }, 'the grid: its nearest line (17 is 3 from 20)');
  assert.equal(snapAxis([12], 5, [], null, 4), null, 'no grid shown: nothing');
  const bt = boxTargets([{ x: 10, y: 20, width: 30, height: 40 }], 'shape');
  assert.deepEqual([bt.x.map((x) => x.at), bt.y.map((y) => y.at)], [[10, 25, 40], [20, 40, 60]], 'a box: its edges and centre');
});
