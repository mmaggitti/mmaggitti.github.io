// The split sheet's detents and the keyboard inset of a modal sheet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detentHeights, dragHeight, keyboardInset, nextDetent, settle, FULL_CANVAS } from '../../src/detents.ts';

// The real layout at 440×796 (a Safari tab), as e2e phoneRulesOnTheNewLayout measures it: the
// TopBar (44), the ContextBar (48) and the ToolRail (52) leave 652 for canvas and sheet, and the
// sheet's head (its handle and the tab row) is 95.
const SPACE = 652;
const HEAD = 95;

test('three heights: the head at peek, a split at half, a strip of drawing left at full', () => {
  const h = detentHeights(SPACE, HEAD);
  assert.deepEqual(h, { peek: 95, half: 293, full: SPACE - FULL_CANVAS });
  assert.equal(SPACE - h.peek, 557, 'a 557pt canvas at peek (the plan said 552, from a 100pt head)');
  assert.equal(SPACE - h.half, 359, 'and 359 at half');
  assert.equal(SPACE - h.full, 98, 'and about 98 at full');
  const tiny = detentHeights(120, HEAD);
  assert.ok(tiny.peek <= tiny.half && tiny.half <= tiny.full, 'ordered even when there is no room');
});

test('a drag follows the finger between peek and full, and settles on the nearest detent or goes with a flick', () => {
  const h = detentHeights(SPACE, HEAD);
  assert.equal(dragHeight(h, h.peek, -50), h.peek + 50, 'up grows the sheet');
  assert.equal(dragHeight(h, h.peek, 400), h.peek, 'never below peek');
  assert.equal(dragHeight(h, h.full, -400), h.full, 'never above full');
  assert.equal(settle(h, 220), 'half');
  assert.equal(settle(h, 120), 'peek');
  assert.equal(settle(h, 500), 'full');
  assert.equal(settle(h, 120, -1), 'half', 'a flick up goes one on');
  assert.equal(settle(h, 280, 1), 'peek', 'a flick down goes one back');
  assert.equal(settle(h, h.full, -2), 'full', 'no detent above full');
  assert.deepEqual(['peek', 'half', 'full'].map((d) => nextDetent(d as 'peek')), ['half', 'full', 'peek'], 'a tap steps round');
});

test('the on-screen keyboard pushes a modal sheet up by what it covers', () => {
  assert.equal(keyboardInset(796, 796, 0), 0);
  assert.equal(keyboardInset(796, 460, 0), 336);
  assert.equal(keyboardInset(796, 460, 40), 296, 'the visual viewport scrolled');
  assert.equal(keyboardInset(796, 795.5, 0), 0, 'rounding noise is not a keyboard');
});
