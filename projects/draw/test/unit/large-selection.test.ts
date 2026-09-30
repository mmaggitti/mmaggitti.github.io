// A command over a large selection costs time in proportion to it (the P1-M1 review, F5): a drag, a
// held arrow, Align, Duplicate, Delete and Group over 4,000 selected shapes, against 1,000, in node
// with the fake views (fakes.ts). Its own file, so the deliberate breaks that run editor.test.ts
// don't wait for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Editor } from '../../src/editor.ts';
import { fakeEditor } from './fakes.ts';

/** An editor on `n` rects in a grid, every one selected. */
function manySelected(n: number): Editor {
  const side = Math.ceil(Math.sqrt(n));
  const cell = 100 / side;
  const at = (v: number) => (v * cell).toFixed(2);
  const rects = Array.from({ length: n }, (_, i) => `  <rect id="r${i}" x="${at(i % side)}" y="${at(Math.floor(i / side))}" width="${at(0.6)}" height="${at(0.6)}"/>`).join('\n');
  const e = fakeEditor();
  assert.ok(e.open(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n${rects}\n</svg>`).ok);
  e.selectAll();
  assert.equal(e.selection.get().size, n, 'test setup: Select all took every rect');
  return e;
}

// Each command, what it records, how far its cost over 4,000 shapes may grow against 1,000, and a
// limit over 4,000 (ms) where one separates it from the quadratic code by 5× or more. Measured in
// node: linear costs 3.8× to 4.2× (Duplicate 5.5× and Delete 5.1×: their inserts and removals shift
// arrays and allocate, so they get 8×); the quadratic code cost 7.7× (Group) to about 16×, and over
// 4,000 shapes a drag took about 30 s, Align about 280 s, Duplicate minutes and Delete 570 ms.
const LARGE: [string, string, (e: Editor) => void, number, number | null][] = [
  ['a drag of them all', 'Move', (e) => {
    const { box, viewport, M } = e.rootBox;
    const k = box!.width / viewport.width;
    const at = { x: box!.left + k * M[4], y: box!.top + k * M[5] };
    e.pointerDown(at, [[...e.selection.get()][0]], { add: false });
    for (let i = 1; i <= 4; i++) e.pointerDrag({ x: at.x + 10 * i, y: at.y + 3 * i });
    e.pointerUp({ x: at.x + 40, y: at.y + 12 });
  }, 6, 5000],
  ['a held arrow', 'Nudge', (e) => {
    for (let i = 0; i < 3; i++) e.nudge(1, 0);
    e.nudgeEnd();
  }, 6, 4000],
  ['Align left', 'Align left', (e) => e.align('left'), 6, 5000],
  ['Duplicate', 'Duplicate', (e) => e.duplicate(), 8, 10000],
  ['Delete', 'Delete', (e) => e.delete(), 8, 100],
  ['Group', 'Group', (e) => e.group(), 6, null],
];

test('a command over a large selection takes linear time: a drag, a held arrow, Align, Duplicate, Delete and Group over 4,000 shapes cost about 4× what they cost over 1,000 (under 6×, or 8× for Duplicate and Delete)', () => {
  const cost = (n: number, label: string, act: (e: Editor) => void): number => {
    const e = manySelected(n);
    const t = performance.now();
    act(e);
    const ms = performance.now() - t;
    assert.equal(e.history.get().undoLabel, label, `test setup: ${label} did something over ${n} shapes (${e.notice.get()})`);
    return ms;
  };
  for (const [, label, act] of LARGE) cost(200, label, act); // warm the engine up
  for (const [what, label, act, most, limit] of LARGE) {
    let small = cost(1000, label, act);
    let big = cost(4000, label, act);
    // A pause of the runner's can land in one run: a miss is measured twice more, and the fastest run of each size counts.
    for (let again = 0; again < 2 && (big >= most * small || (limit !== null && big >= limit)); again++) {
      small = Math.min(small, cost(1000, label, act));
      big = Math.min(big, cost(4000, label, act));
    }
    assert.ok(big < most * small, `${what}: ${small.toFixed(0)} ms over 1,000 shapes, ${big.toFixed(0)} ms over 4,000 (×${(big / small).toFixed(1)}; linear is ×4, the most ×${most})`);
    if (limit !== null) assert.ok(big < limit, `${what}: ${big.toFixed(0)} ms over 4,000 shapes (the limit is ${limit})`);
  }
});
