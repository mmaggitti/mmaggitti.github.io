// engine/path/arc: endpoint-to-center conversion against hand-computed cases, the out-of-range
// rules, and the cubic approximation's accuracy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcCenter, arcPoint, arcToCubics, type ArcCenter } from '../../path/arc.ts';
import { bezier, rng, type Pt } from './helpers.ts';

const PI = Math.PI;
const close = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), `${msg ?? ''} ${a} ≠ ${b}`);
function center(...args: Parameters<typeof arcCenter>): ArcCenter {
  const c = arcCenter(...args);
  assert.ok(typeof c === 'object', `expected an arc, got ${c}`);
  return c;
}
const norm = (t: number) => ((t % (2 * PI)) + 2 * PI) % (2 * PI);

test('half circle: center between the endpoints, sweep 1 goes through negative y', () => {
  const c = center(0, 0, 5, 5, 0, false, true, 10, 0);
  close(c.cx, 5);
  close(c.cy, 0);
  close(c.rx, 5);
  close(norm(c.t1), PI);
  close(c.dt, PI);
  const mid = arcPoint(c, c.t1 + c.dt / 2);
  close(mid[0], 5);
  close(mid[1], -5);
  const other = center(0, 0, 5, 5, 0, false, false, 10, 0);
  close(other.dt, -PI);
  close(arcPoint(other, other.t1 + other.dt / 2)[1], 5);
});

test('quarter circle: the four flag combinations pick the four arcs', () => {
  // From (0,0) to (10,10) with r = 10 the centers are (10,0) and (0,10).
  const cases: [boolean, boolean, number, number, number][] = [
    // large, sweep, cx, cy, dt
    [false, false, 10, 0, -PI / 2],
    [false, true, 0, 10, PI / 2],
    [true, false, 0, 10, -3 * PI / 2],
    [true, true, 10, 0, 3 * PI / 2],
  ];
  for (const [large, sweep, cx, cy, dt] of cases) {
    const c = center(0, 0, 10, 10, 0, large, sweep, 10, 10);
    close(c.cx, cx, 'cx');
    close(c.cy, cy, 'cy');
    close(c.dt, dt, 'dt');
    const [sx, sy] = arcPoint(c, c.t1);
    const [ex, ey] = arcPoint(c, c.t1 + c.dt);
    assert.ok(Math.hypot(sx, sy) < 1e-9 && Math.hypot(ex - 10, ey - 10) < 1e-9, 'endpoints on the arc');
  }
});

test('radii too small scale up uniformly until they just span the endpoints', () => {
  const c = center(0, 0, 1, 1, 0, false, true, 10, 0);
  close(c.rx, 5);
  close(c.ry, 5);
  close(c.cx, 5);
  close(c.cy, 0);
  close(Math.abs(c.dt), PI);
  const e = center(0, 0, 2, 1, 0, true, false, 10, 0); // Λ = 25/4 → ×2.5
  close(e.rx, 5);
  close(e.ry, 2.5);
  close(e.cx, 5);
  close(e.cy, 0);
  // Rotated 90°: the ellipse's x axis is vertical, so only ry spans the chord (Λ = 25 → ×5).
  const r = center(0, 0, 2, 1, 90, false, true, 10, 0);
  close(r.rx, 10);
  close(r.ry, 5);
  close(r.cx, 5);
  assert.ok(Math.abs(r.cy) < 1e-9);
  close(Math.abs(r.dt), PI);
});

test('out-of-range parameters: zero radius is a line, equal endpoints omit, negatives and turns fold', () => {
  assert.equal(arcCenter(0, 0, 0, 5, 0, false, true, 10, 0), 'line');
  assert.equal(arcCenter(0, 0, 5, 0, 0, false, true, 10, 0), 'line');
  assert.equal(arcCenter(3, 4, 5, 5, 0, true, true, 3, 4), 'none');
  assert.deepEqual(arcToCubics(3, 4, 5, 5, 0, true, true, 3, 4), []);
  assert.deepEqual(arcToCubics(0, 0, 0, 0, 0, false, false, 9, 3), [[3, 1, 6, 2, 9, 3]]);
  assert.deepEqual(center(0, 0, -5, -5, 0, false, true, 10, 0), center(0, 0, 5, 5, 0, false, true, 10, 0));
  const a = center(0, 0, 8, 4, 30, false, true, 10, 3);
  const b = center(0, 0, 8, 4, 390, false, true, 10, 3);
  for (const k of ['cx', 'cy', 'rx', 'ry', 'dt'] as const) close(a[k], b[k], k);
});

test('a radius that is zero as a 32-bit float is a line, as browsers draw it', () => {
  // Chromium's getBBox for 'M0 0 A1e-50 5 0 0 1 10 0' is the line [0, 0, 10, 0].
  assert.equal(arcCenter(0, 0, 1e-50, 5, 0, false, true, 10, 0), 'line');
  assert.equal(arcCenter(0, 0, 1e-50, 1e-50, 0, false, true, 10, 0), 'line');
  assert.equal(arcCenter(0, 0, 1e-160, 5, 0, false, true, 10, 0), 'line', 'rx would scale to Infinity');
  assert.deepEqual(arcToCubics(0, 0, 1e-200, 5, 0, false, true, 0, 10), [[0, 10 / 3, 0, 20 / 3, 0, 10]], 'rx² would underflow');
  // Backstop: endpoints a denormal apart make the center math non-finite.
  assert.equal(arcCenter(0, 0, 5, 5, 0, false, true, 1e-320, 0), 'line');
});

test('random arcs: endpoints lie on the ellipse, flags choose the sweep', () => {
  const r = rng(4);
  for (let n = 0; n < 2000; n++) {
    const [x1, y1, x2, y2] = [r() * 200 - 100, r() * 200 - 100, r() * 200 - 100, r() * 200 - 100];
    const [rx, ry, rot] = [r() * 120 + 0.01, r() * 120 + 0.01, r() * 720 - 360];
    const [large, sweep] = [r() < 0.5, r() < 0.5];
    const c = center(x1, y1, rx, ry, rot, large, sweep, x2, y2);
    const scale = Math.max(1, Math.abs(x1), Math.abs(x2), Math.abs(y1), Math.abs(y2), c.rx);
    const [sx, sy] = arcPoint(c, c.t1);
    const [ex, ey] = arcPoint(c, c.t1 + c.dt);
    assert.ok(Math.hypot(sx - x1, sy - y1) < 1e-9 * scale && Math.hypot(ex - x2, ey - y2) < 1e-9 * scale, 'endpoints');
    assert.equal(c.dt > 0, sweep, 'sweep flag = positive angle direction');
    const scaled = c.rx > Math.abs(rx) * (1 + 1e-12);
    if (!scaled) assert.equal(Math.abs(c.dt) > PI, large, 'large-arc flag');
    else close(Math.abs(c.dt), PI, 'a scaled arc is exactly half the ellipse');
    close(c.rx / c.ry, rx / ry, 'aspect kept');
  }
});

// Deviation of a point from the ellipse, measured in the circle it is the image of.
function deviation(c: ArcCenter, [x, y]: Pt): number {
  const dx = x - c.cx;
  const dy = y - c.cy;
  const u = (Math.cos(c.phi) * dx + Math.sin(c.phi) * dy) / c.rx;
  const v = (-Math.sin(c.phi) * dx + Math.cos(c.phi) * dy) / c.ry;
  return Math.abs(Math.hypot(u, v) - 1);
}

test('arcToCubics: pieces of at most 90°, deviation under 1e-3 of the radius', () => {
  const r = rng(5);
  let worst = 0;
  for (let n = 0; n < 500; n++) {
    const [x1, y1, x2, y2] = [r() * 200 - 100, r() * 200 - 100, r() * 200 - 100, r() * 200 - 100];
    const [rx, ry, rot] = [r() * 150 + 1, r() * 150 + 1, r() * 360];
    const [large, sweep] = [r() < 0.5, r() < 0.5];
    const c = center(x1, y1, rx, ry, rot, large, sweep, x2, y2);
    const cubics = arcToCubics(x1, y1, rx, ry, rot, large, sweep, x2, y2);
    assert.equal(cubics.length, Math.ceil(Math.abs(c.dt) / (PI / 2) - 1e-9));
    assert.deepEqual(cubics.at(-1)!.slice(4), [x2, y2], 'lands exactly on the endpoint');
    let start: Pt = [x1, y1];
    let angle = c.t1;
    for (const q of cubics) {
      const pts: Pt[] = [start, [q[0], q[1]], [q[2], q[3]], [q[4], q[5]]];
      for (let i = 0; i <= 64; i++) {
        // Normalized deviation × the larger radius bounds the true distance to the ellipse.
        const d = deviation(c, bezier(pts, i / 64)) * Math.max(c.rx, c.ry);
        worst = Math.max(worst, d / Math.max(c.rx, c.ry));
        assert.ok(d < 1e-3 * Math.max(c.rx, c.ry));
      }
      // The piece's midpoint sits at the middle angle: the cubic follows the right side.
      angle += c.dt / cubics.length;
      const mid = bezier(pts, 0.5);
      const want = arcPoint(c, angle - c.dt / cubics.length / 2);
      assert.ok(Math.hypot(mid[0] - want[0], mid[1] - want[1]) < 1e-3 * Math.max(c.rx, c.ry));
      start = [q[4], q[5]];
    }
  }
  assert.ok(worst < 3e-4, `worst normalized deviation ${worst}`);
});
