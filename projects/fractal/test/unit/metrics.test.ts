import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metrics, TAP_MIN } from '../../src/core/metrics.ts';

test('METRICS-01 the tab bar never drops under the tap floor', () => {
  for (const rem of [8, 12, 16, 20]) assert.ok(metrics(rem).tabbar >= TAP_MIN);
  assert.equal(metrics(12).tabbar, 44);
  assert.equal(metrics(16).tabbar, 52);
});

test('METRICS-02 panel minimums scale with rem', () => {
  const m = metrics(12);
  assert.equal(m.gap, 6);
  assert.deepEqual(m.panelMin, { w: 90, h: 80 });
});
