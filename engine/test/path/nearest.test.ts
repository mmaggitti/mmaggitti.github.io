// engine/path/nearest: hand cases, then agreement with brute force (dense sampling refined twice)
// over random and real paths, to 1e-6 of the path's size.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath } from '../../path/parse.ts';
import { toAbsolute, type AbsSeg } from '../../path/abs.ts';
import { nearestPoint } from '../../path/nearest.ts';
import { pathBounds } from '../../path/bounds.ts';
import { corpus, evaluator, pick, randomPath, rng } from './helpers.ts';

const near = (d: string, x: number, y: number) => nearestPoint(toAbsolute(parsePath(d)), x, y);
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('hand cases', () => {
  let n = near('M0 0 L10 0', 4, 3)!;
  assert.ok(n.segIndex === 1 && close(n.t, 0.4) && close(n.x, 4) && close(n.y, 0) && close(n.distance, 3));
  n = near('M0 0 L10 0', -3, 4)!;
  assert.ok(n.t === 0 && close(n.distance, 5), 'clamped to the start');
  n = near('M0 0 L10 0 L10 10 Z', 2, 5)!; // Z is the diagonal back from (10,10) to (0,0)
  assert.ok(n.segIndex === 3 && close(n.t, 0.65) && close(n.x, 3.5) && close(n.y, 3.5) && close(n.distance, 3 / Math.SQRT2));
  n = near('M0 0 A5 5 0 0 1 10 0', 5, 0)!;
  assert.ok(close(n.distance, 5), 'from the center every point is at the radius');
  n = near('M0 0 A5 5 0 0 1 10 0', 5, -20)!;
  assert.ok(close(n.x, 5) && close(n.y, -5) && close(n.t, 0.5) && close(n.distance, 15));
  // A radius that is zero as a 32-bit float is a line (rx² underflows in the second).
  n = near('M0 0 A1e-50 5 0 0 1 10 0', 1, 5)!;
  assert.ok(close(n.distance, 5) && close(n.x, 1) && n.y === 0);
  n = near('M0 0 A1e-200 5 0 0 1 0 10', 1, 5)!;
  assert.ok(close(n.distance, 1) && close(n.y, 5));
  n = near('M0 0 C0 10 10 10 10 0', 5, 20)!;
  assert.ok(close(n.t, 0.5) && close(n.y, 7.5) && close(n.distance, 12.5));
  // A curve that doubles back: the nearest branch is not the one with the best coarse sample, and
  // a coarse sampling misses it entirely (brute force with 2e6 samples agrees).
  assert.ok(Math.abs(near('M0 0 C82 2160 -14 2580 14 -1980', -47, 59)!.distance - 49.17817966) < 1e-6);
  assert.ok(Math.abs(near('M0 0 C33 -56 -47 42 -39 -5', 4, -15)!.distance - 1.2921485) < 1e-6);
  n = near('M0 0 M5 5', 0, 0)!;
  assert.ok(n.segIndex === 1 && close(n.distance, Math.hypot(5, 5)), 'a replaced moveto is not a point');
  assert.equal(near('', 1, 1), null);
});

// Brute force: sample each segment, then refine twice around its best sample. `first` is the first
// level's sample count: a curve that doubles back needs it dense, or the best sample may sit on
// the wrong branch.
function brute(abs: AbsSeg[], x: number, y: number, first = 512): number {
  let best = Infinity;
  abs.forEach((s, i) => {
    if (s.type === 'M' && i !== abs.length - 1) return;
    const f = evaluator(s);
    const dist = (t: number) => {
      const [px, py] = f(t);
      return Math.hypot(px - x, py - y);
    };
    let lo = 0;
    let hi = 1;
    for (let level = 0; level < 3; level++) {
      const N = level ? 512 : first;
      let bt = lo;
      let bd = Infinity;
      for (let k = 0; k <= N; k++) {
        const t = lo + ((hi - lo) * k) / N;
        const d = dist(t);
        if (d < bd) [bd, bt] = [d, t];
      }
      best = Math.min(best, bd);
      const w = (hi - lo) / N;
      [lo, hi] = [Math.max(0, bt - w), Math.min(1, bt + w)];
    }
  });
  return best;
}

function agree(d: string, x: number, y: number, first?: number) {
  const abs = toAbsolute(parsePath(d));
  const n = nearestPoint(abs, x, y);
  assert.ok(n, d);
  const b = pathBounds(abs)!;
  const scale = Math.max(1, b.maxX - b.minX, b.maxY - b.minY, Math.abs(x - b.minX), Math.abs(y - b.minY));
  // The answer is a real point of that segment, at that distance.
  const [px, py] = evaluator(abs[n.segIndex])(n.t);
  assert.ok(n.t >= 0 && n.t <= 1);
  assert.ok(Math.hypot(px - n.x, py - n.y) <= 1e-9 * scale, `${d}: point is on the segment`);
  assert.ok(Math.abs(n.distance - Math.hypot(n.x - x, n.y - y)) <= 1e-12 * scale);
  const want = brute(abs, x, y, first);
  assert.ok(Math.abs(n.distance - want) <= 1e-6 * scale, `${d} @ ${x},${y}: ${n.distance} vs brute ${want}`);
}

test('random paths: matches brute force within 1e-6', () => {
  const r = rng(7);
  for (let n = 0; n < 400; n++) {
    const d = randomPath(r);
    for (let q = 0; q < 5; q++) agree(d, r() * 300 - 150, r() * 300 - 150);
  }
});

test('wild cubics that double back: matches brute force within 1e-6, near the curve', () => {
  const r = rng(9);
  for (let n = 0; n < 100; n++) {
    // Endpoints within 50 of the origin, control points 20 to 50 times further out.
    const c = () => (r() * 2 - 1) * 50 * (20 + r() * 30);
    const e = () => Math.round((r() * 2 - 1) * 50);
    const d = `M${e()} ${e()} C${c()} ${c()} ${c()} ${c()} ${e()} ${e()}`;
    const abs = toAbsolute(parsePath(d));
    const size = Math.max(...Object.values(pathBounds(abs)!).map(Math.abs));
    for (let q = 0; q < 4; q++) {
      const [x, y] = evaluator(abs[1])(r());
      agree(d, x + (r() * 2 - 1) * size * 0.02, y + (r() * 2 - 1) * size * 0.02, 50_000);
    }
  }
});

test('real paths: matches brute force within 1e-6, near and on the curve', () => {
  const r = rng(8);
  const { icons, lab } = corpus();
  const paths = [...icons, ...lab];
  for (let n = 0; n < 60; n++) {
    const d = pick(r, paths);
    const b = pathBounds(toAbsolute(parsePath(d)))!;
    for (let q = 0; q < 4; q++) agree(d, b.minX + (b.maxX - b.minX) * (r() * 1.4 - 0.2), b.minY + (b.maxY - b.minY) * (r() * 1.4 - 0.2));
  }
  // Points on the path come back at distance ~0.
  const abs = toAbsolute(parsePath(icons[0]));
  abs.forEach((s) => {
    if (s.type === 'M') return;
    const [x, y] = evaluator(s)(0.37);
    assert.ok(nearestPoint(abs, x, y)!.distance < 1e-9);
  });
});
