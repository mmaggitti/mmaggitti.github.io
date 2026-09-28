// The scrub rule (SVG Lab's): 7 px and mostly sideways starts a scrub, then one step per pps pixels.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScrubGesture, scrubValue, SCRUB_START } from '../../src/codeview/scrub.ts';

test('a small or vertical move is not a scrub, and ends as a tap', () => {
  const g = new ScrubGesture();
  g.down(100, 100);
  assert.equal(g.move(100 + SCRUB_START - 1, 100), null);
  assert.equal(g.move(103, 140), null, 'vertical: the code scrolls');
  assert.equal(g.up(), 'tap');
});

test('past the threshold, steps count from where the scrub started', () => {
  const g = new ScrubGesture(4);
  g.down(100, 100);
  assert.equal(g.move(108, 101), 0);
  assert.equal(g.move(116, 101), 2);
  assert.equal(g.move(100, 101), -2);
  assert.equal(g.up(), 'scrub');
  g.down(0, 0);
  assert.equal(g.up(true), 'none', 'a cancelled tap opens nothing');
});

test('scrubbed values keep the token precision and clamp', () => {
  assert.equal(scrubValue(12, 3, 0), 15);
  assert.equal(scrubValue(0.5, 2, 1), 0.7);
  assert.equal(scrubValue(0.25, -1, 2), 0.24);
  assert.equal(scrubValue(1, -5, 0, 0), 0);
  assert.equal(scrubValue(0.1, 2, 1), 0.3, 'no floating-point residue');
});
