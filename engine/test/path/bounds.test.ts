// engine/path/bounds: exact boxes for hand-computed cases, and agreement with dense sampling over
// real and random paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath } from '../../path/parse.ts';
import { toAbsolute, type AbsSeg } from '../../path/abs.ts';
import { pathBounds, type Box } from '../../path/bounds.ts';
import { corpus, evaluator, randomPath, rng, type Pt } from './helpers.ts';

const box = (d: string) => pathBounds(toAbsolute(parsePath(d)));
const near = (b: Box | null, want: [number, number, number, number], d: string) => {
  assert.ok(b, d);
  [b.minX, b.minY, b.maxX, b.maxY].forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9, `${d}: ${[b.minX, b.minY, b.maxX, b.maxY]}`));
};

test('hand-computed boxes', () => {
  near(box('M0 0 C0 10 10 10 10 0'), [0, 0, 10, 7.5], 'cubic peak at t = 0.5');
  near(box('M0 0 Q5 10 10 0'), [0, 0, 10, 5], 'quadratic peak');
  near(box('M0 0 A5 5 0 0 1 10 0'), [0, -5, 10, 0], 'half circle, sweep 1');
  near(box('M0 0 A5 5 0 0 0 10 0'), [0, 0, 10, 5], 'half circle, sweep 0');
  near(box('M0 0 A1 1 0 0 0 10 0'), [0, 0, 10, 5], 'radius scaled up');
  near(box('M0 0 A0 5 0 0 0 10 0'), [0, 0, 10, 0], 'zero radius is a line');
  near(box('M0 0 A1e-50 5 0 0 1 10 0'), [0, 0, 10, 0], 'a radius that is zero as a float is a line (Chromium)');
  near(box('M0 0 A1e-50 1e-50 0 0 1 10 0'), [0, 0, 10, 0], 'both radii zero as floats');
  near(box('M0 0 h10 v10 h-10 z'), [0, 0, 10, 10], 'square');
  // A rotated ellipse from two half arcs: half-widths √(rx²cos²φ + ry²sin²φ) and √(rx²sin²φ + ry²cos²φ).
  const [px, py] = [10 * Math.cos(Math.PI / 6), 10 * Math.sin(Math.PI / 6)];
  const hw = Math.sqrt(100 * 0.75 + 16 * 0.25);
  const hh = Math.sqrt(100 * 0.25 + 16 * 0.75);
  near(box(`M${px} ${py} A10 4 30 0 1 ${-px} ${-py} A10 4 30 0 1 ${px} ${py}`), [-hw, -hh, hw, hh], 'rotated ellipse');
  // Movetos: a point box, the pen's start is not geometry, and a moveto replaced by another is gone.
  near(box('M3 4'), [3, 4, 3, 4], 'lone moveto');
  near(box('M1 1 M2 2'), [2, 2, 2, 2], 'moveto replaced');
  near(box('m5 5 l1 1'), [5, 5, 6, 6], 'from the origin, not including it');
  near(box('M0 0 L10 10 M20 20'), [0, 0, 20, 20], 'a trailing moveto counts');
  assert.equal(box(''), null);
});

// Sample every segment densely, then again around its extreme samples, so the sampled box is within
// ~1e-8 of the true one. Movetos follow the same rule as pathBounds.
function sampledPoints(abs: AbsSeg[]): Pt[] {
  const pts: Pt[] = [];
  const N = 256;
  abs.forEach((s, i) => {
    if (s.type === 'M') {
      if (abs[i + 1]?.type !== 'M') pts.push([s.x, s.y]);
      return;
    }
    const f = evaluator(s);
    const coarse = Array.from({ length: N + 1 }, (_, k) => f(k / N));
    pts.push(...coarse);
    for (const key of [(p: Pt) => p[0], (p: Pt) => -p[0], (p: Pt) => p[1], (p: Pt) => -p[1]]) {
      let best = 0;
      coarse.forEach((p, k) => {
        if (key(p) > key(coarse[best])) best = k;
      });
      for (let k = 0; k <= N; k++) pts.push(f(Math.min(1, Math.max(0, (best - 1 + (2 * k) / N) / N))));
    }
  });
  return pts;
}

function agree(d: string) {
  const abs = toAbsolute(parsePath(d));
  const b = pathBounds(abs);
  assert.ok(b);
  const pts = sampledPoints(abs);
  const s: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of pts) {
    s.minX = Math.min(s.minX, x);
    s.minY = Math.min(s.minY, y);
    s.maxX = Math.max(s.maxX, x);
    s.maxY = Math.max(s.maxY, y);
  }
  const scale = Math.max(1, s.maxX - s.minX, s.maxY - s.minY);
  // Sound: no sampled point lies outside. Tight: each edge is a sampled extreme.
  assert.ok(b.minX <= s.minX + 1e-9 * scale && b.minY <= s.minY + 1e-9 * scale, d.slice(0, 80));
  assert.ok(b.maxX >= s.maxX - 1e-9 * scale && b.maxY >= s.maxY - 1e-9 * scale, d.slice(0, 80));
  for (const [ours, sampled] of [[b.minX, s.minX], [b.minY, s.minY], [b.maxX, s.maxX], [b.maxY, s.maxY]]) {
    assert.ok(Math.abs(ours - sampled) <= 1e-6 * scale, `${d.slice(0, 80)}: ${ours} vs sampled ${sampled}`);
  }
}

test('real paths: bounds equal dense sampling within 1e-6', () => {
  const { icons, lab } = corpus();
  for (const d of [...icons, ...lab]) agree(d);
});

test('random paths of every command: bounds equal dense sampling within 1e-6', () => {
  const r = rng(6);
  for (let n = 0; n < 1500; n++) agree(randomPath(r));
});
