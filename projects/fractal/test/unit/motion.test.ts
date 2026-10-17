import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, between, fit, invert, lerpRect, sameRect, step, IDENTITY, type SpringState } from '../../src/core/motion.ts';
import { tierOf } from '../../src/core/lod.ts';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test('MOTION-01 fit maps a rect onto another of the same aspect exactly', () => {
  const s = fit({ x: 10, y: 20, w: 40, h: 30 }, { x: 0, y: 0, w: 400, h: 300 });
  assert.ok(sameRect(apply(s, { x: 10, y: 20, w: 40, h: 30 }), { x: 0, y: 0, w: 400, h: 300 }, 1e-9));
  assert.ok(sameRect(invert(s, apply(s, { x: 3, y: 4, w: 5, h: 6 })), { x: 3, y: 4, w: 5, h: 6 }, 1e-9));
});

test('MOTION-02 between: exact endpoints, geometric-mean scale halfway', () => {
  const a = IDENTITY;
  const b = { k: 16, x: -100, y: -50 };
  const anchor = { x: 20, y: 10 };
  assert.deepEqual(between(a, b, 0, anchor), a);
  assert.deepEqual(between(a, b, 1, anchor), b);
  assert.ok(near(between(a, b, 0.5, anchor).k, 4));
});

test('MOTION-03 a pure translation keeps every rect\'s size', () => {
  const a = IDENTITY;
  const b = { k: 1, x: -446, y: 0 };
  const mid = between(a, b, 0.3, { x: 0, y: 0 });
  assert.equal(mid.k, 1);
  const r = apply(mid, { x: 0, y: 0, w: 440, h: 700 });
  assert.equal(r.w, 440);
});

test('MOTION-04 the spring settles exactly at 1, deterministically', () => {
  const run = () => {
    let s: SpringState = { p: 0, v: 0 };
    let frames = 0;
    for (; frames < 600; frames++) {
      const r = step(s, 1 / 60);
      s = r.state;
      if (r.done) break;
    }
    return { s, frames };
  };
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
  assert.equal(a.s.p, 1);
  assert.ok(a.frames < 120, `settles in ${a.frames} frames`);
});

test('MOTION-05 lerpRect interpolates linearly', () => {
  assert.deepEqual(lerpRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 20, w: 30, h: 40 }, 0.5), { x: 5, y: 10, w: 20, h: 25 });
});

test('LOD-01 tiers: tile below the size floor, scaled when content is shrunk, live otherwise', () => {
  assert.equal(tierOf({ x: 0, y: 0, w: 60, h: 300 }, 1, 12), 'tile');
  assert.equal(tierOf({ x: 0, y: 0, w: 300, h: 300 }, 0.5, 12), 'scaled');
  assert.equal(tierOf({ x: 0, y: 0, w: 300, h: 300 }, 1, 12), 'live');
});

test('LOD-02 a size oscillating ±10% around the tile threshold changes tier at most once', () => {
  const t = 7 * 12;
  let tier = tierOf({ x: 0, y: 0, w: t * 1.1, h: 300 }, 1, 12);
  let changes = 0;
  for (let i = 0; i < 40; i++) {
    const w = t * (i % 2 ? 1.1 : 0.9);
    const next = tierOf({ x: 0, y: 0, w, h: 300 }, 1, 12, tier);
    if (next !== tier) changes++;
    tier = next;
  }
  assert.ok(changes <= 1, `${changes} changes`);
});
