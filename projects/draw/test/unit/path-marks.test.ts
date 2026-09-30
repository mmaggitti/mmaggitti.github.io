// The path marks (src/interact/path-marks.ts): what the overlay draws for a path in the Node tool and
// for the Pen's drag, in host px, from the engine's geometry and the element's toHost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath } from '../../../../engine/path/parse.ts';
import { toAbsolute } from '../../../../engine/path/abs.ts';
import { nodesOf } from '../../../../engine/path/nodes.ts';
import type { Affine } from '../../../../engine/values/affine.ts';
import { pathMarks, penArms } from '../../src/interact/path-marks.ts';

// A test camera: 2 px a unit, the drawing 10 px right and 20 px down.
const TO_HOST: Affine = [2, 0, 0, 2, 10, 20];
const marks = (d: string) => {
  const p = parsePath(d);
  return pathMarks(nodesOf(p, toAbsolute(p)), TO_HOST);
};
const at = (x: number, y: number) => ({ x: 2 * x + 10, y: 2 * y + 20 });
const line = (a: [number, number], b: [number, number]) => ({ from: at(...a), to: at(...b) });

test('arms: a C’s start → first control and second control → end, a Q’s start → control → end, an S’s second control → end; through toHost', () => {
  assert.deepEqual(marks('M 10 55 C 22 20, 40 20, 50 55').arms, [line([10, 55], [22, 20]), line([40, 20], [50, 55])]);
  assert.deepEqual(marks('M 30 44 Q 40 32, 50 44').arms, [line([30, 44], [40, 32]), line([40, 32], [50, 44])]);
  const s = marks('M 10 55 C 22 20, 40 20, 50 55 S 78 90, 90 55');
  assert.deepEqual(s.arms.slice(2), [line([78, 90], [90, 55])], 'the S: its second control only');
  assert.deepEqual(marks('M 0 0 L 10 10 H 20').arms, [], 'lines have none');
});

test('mirror guides: lab/arcs--smooth.svg’s S implies (60, 90), a dashed arm from its start and a dot there; a T’s from its start and on to its end; nothing when the implied control is the start', () => {
  const s = marks('M 10 55\n   C 22 20, 40 20, 50 55\n   S 78 90, 90 55');
  assert.deepEqual(s.mirrors, [line([50, 55], [60, 90])]);
  assert.deepEqual(s.dots, [at(60, 90)]);
  const t = marks('M 0 0 Q 10 20 20 0 T 40 0');
  assert.deepEqual(t.mirrors, [line([20, 0], [30, -20]), line([30, -20], [40, 0])], 'reflected about the segment’s start');
  assert.deepEqual(t.dots, [at(30, -20)]);
  const none = marks('M 0 0 L 10 0 S 20 10 30 0 T 50 0');
  assert.deepEqual([none.mirrors, none.dots], [[], []], 'an S after a line and a T after an S imply their start: nothing drawn');
});

test('the Pen’s drag: both arms from the point, to the finger and to its reflection', () => {
  assert.deepEqual(penArms({ x: 100, y: 100 }, { x: 130, y: 90 }), [
    { from: { x: 100, y: 100 }, to: { x: 130, y: 90 } },
    { from: { x: 100, y: 100 }, to: { x: 70, y: 110 } },
  ]);
});
