import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metrics, TAP_MIN } from '../../src/core/metrics.ts';

test('METRICS-01 the caption row is small (its touch targets reach the tap floor by overhanging it)', () => {
  assert.equal(metrics(12).caption, 18);
  assert.equal(metrics(16).caption, 24);
  assert.ok(metrics(12).caption < TAP_MIN);
});

test('METRICS-02 panel minimums scale with rem', () => {
  const m = metrics(12);
  assert.equal(m.gap, 6);
  assert.deepEqual(m.panelMin, { w: 90, h: 54 });
});
