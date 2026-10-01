// Closed loops of lines and cubics (P1-M3 S3): what booleans take in and give back, oriented by
// nesting depth and written as §5.9's d.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath } from '../../path/parse.ts';
import { toAbsolute } from '../../path/abs.ts';
import { loopArea, loopsD, loopsToAbs, mapLoops, orientLoops, toLoops, toSubpaths, type Loop } from '../../path/loops.ts';
import { crossingsOf, polygons, windingOf } from '../../path/winding.ts';
import { arcCenter, arcPoint } from '../../path/arc.ts';

const loopsOf = (d: string): Loop[] => toLoops(toAbsolute(parsePath(d)));
const cubicAt = (p0: number[], c1: number[], c2: number[], p1: number[], t: number) => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p1[k]);
};

test('toLoops: only lines and cubics, each subpath closed back to its start (Q raised exactly, A as cubics, H, V, S and T resolved)', () => {
  const [q] = loopsOf('M 0 0 Q 50 100 100 0');
  assert.deepEqual(q.segs.map((s) => s.type), ['C', 'L'], 'the quadratic, then the line that closes it');
  const c = q.segs[0];
  assert.ok(c.type === 'C');
  for (const t of [0.25, 0.5, 0.8]) {
    const u = 1 - t;
    const want = [2 * u * t * 50 + t * t * 100, 2 * u * t * 100];
    const got = cubicAt([0, 0], c.c1, c.c2, c.to, t);
    assert.ok(Math.hypot(got[0] - want[0], got[1] - want[1]) < 1e-9, `the raised cubic leaves the quadratic at t = ${t}`);
  }
  const [a] = loopsOf('M 10 50 A 40 40 0 0 1 90 50 Z');
  assert.ok(a.segs.every((s) => s.type === 'C' || s.type === 'L'));
  assert.equal(a.segs.filter((s) => s.type === 'C').length, 2, 'a half turn is two 90° cubics');
  const arc = arcCenter(10, 50, 40, 40, 0, false, true, 90, 50);
  assert.ok(arc !== 'none' && arc !== 'line');
  let at = a.start;
  for (const s of a.segs) {
    if (s.type !== 'C') continue;
    const mid = cubicAt(at, s.c1, s.c2, s.to, 0.5);
    assert.ok(Math.abs(Math.hypot(mid[0] - 50, mid[1] - 50) - 40) < 0.02, 'each cubic stays on the arc');
    at = s.to;
  }
  assert.ok(arcPoint(arc, arc.t1 + arc.dt / 2)[1] < 50, 'the arc runs over the top (sweep 1)');
  const hvst = loopsOf('m 10 10 h 40 v 20 s 20 20 30 0 t 10 30 H 10 z M 0 0 L 5 0 L 5 5');
  assert.equal(hvst.length, 2);
  assert.deepEqual(hvst[0].segs.map((s) => s.type), ['L', 'L', 'C', 'C', 'L', 'L']);
  assert.deepEqual(hvst[0].segs[1].to, [50, 30]);
  assert.deepEqual(hvst[0].segs[2].type === 'C' && hvst[0].segs[2].c1, [50, 30], 'S after a line reflects nothing: its first control is the current point');
  assert.deepEqual(hvst[1].segs.map((s) => [s.type, ...s.to]), [['L', 5, 0], ['L', 5, 5], ['L', 0, 0]], 'an open subpath is closed back to its start');
});

test('orientLoops: an outer loop clockwise on screen, a hole the other way, an island in it clockwise again; so nonzero and evenodd agree', () => {
  // All three written clockwise (y down): the square, the hole in it, the island in the hole.
  const d = 'M 0 0 L 100 0 L 100 100 L 0 100 Z M 20 20 L 80 20 L 80 80 L 20 80 Z M 40 40 L 60 40 L 60 60 L 40 60 Z';
  const raw = loopsOf(d);
  assert.ok(raw.every((l) => loopArea(l) > 0), 'the test’s loops are all clockwise to start with');
  const polysRaw = polygons(loopsToAbs(raw));
  assert.notEqual(windingOf(polysRaw, 30, 30) !== 0, crossingsOf(polysRaw, 30, 30) % 2 === 1, 'unoriented, the two rules disagree in the hole');
  const out = orientLoops(raw);
  assert.deepEqual(out.map((l) => Math.sign(loopArea(l))), [1, -1, 1]);
  const polys = polygons(loopsToAbs(out));
  for (let y = 1; y < 100; y += 3.7) {
    for (let x = 1; x < 100; x += 3.7) assert.equal(windingOf(polys, x, y) !== 0, crossingsOf(polys, x, y) % 2 === 1, `(${x}, ${y})`);
  }
  assert.equal(windingOf(polys, 30, 30), 0, 'the hole is empty');
  assert.equal(Math.abs(windingOf(polys, 50, 50)), 1, 'the island is filled, once');
  // A lone loop written counterclockwise is turned clockwise; one already clockwise is kept as it is.
  const [ccw] = orientLoops(loopsOf('M 0 0 L 0 10 L 10 10 L 10 0 Z'));
  assert.ok(loopArea(ccw) > 0);
  assert.deepEqual([ccw.start, ...ccw.segs.map((s) => s.to)], [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], 'reversed: the same corners the other way round');
  const cw = loopsOf('M 0 0 L 10 0 C 12 4 12 6 10 10 L 0 10 Z');
  assert.deepEqual(orientLoops(cw), cw);
});

test('loopsD: every loop M, then L or C, then Z, joined by a space, numbers fmt(v, 3); a last line back to the start is left to the Z', () => {
  const loops = loopsOf('M 0 0 L 10.12345 0 C 12 4 12 6 10 10 L 0 10 Z M 20 20 L 30 20 L 30 30');
  assert.equal(loopsD(loops), 'M 0 0 L 10.123 0 C 12 4 12 6 10 10 L 0 10 Z M 20 20 L 30 20 L 30 30 Z');
  assert.equal(loopsD([]), '');
});

test('mapLoops: every point through an affine map (a cubic stays a cubic)', () => {
  const [l] = mapLoops(loopsOf('M 0 0 C 1 2 3 4 5 6 Z'), [2, 0, 0, 3, 10, 20]);
  assert.deepEqual(l.start, [10, 20]);
  assert.deepEqual(l.segs[0], { type: 'C', c1: [12, 26], c2: [16, 32], to: [20, 38] });
});

// P1-M4 S0: stroke to path strokes each subpath as it is drawn, so only a Z closes one.
test('toSubpaths: each subpath as drawn, closed only by a Z (its closing line added when one is drawn), an open one left open even when it returns to its start; a lone moveto left out, "M x y Z" kept; toLoops unchanged', () => {
  const D = 'M 0 0 L 10 0 L 10 10 Z M 20 0 L 30 0 L 20 0 M 40 0 M 50 0 Z M 60 0 Q 70 10 80 0 A 5 5 0 0 1 90 0';
  const subs = toSubpaths(toAbsolute(parsePath(D)));
  assert.deepEqual(subs.map((s) => s.closed), [true, false, true, false], 'closed by its Z only: the second returns to its start without one');
  assert.deepEqual(subs[0].segs.map((s) => [s.type, ...s.to]), [['L', 10, 0], ['L', 10, 10], ['L', 0, 0]], 'the Z draws its line back to the start');
  assert.deepEqual(subs[1].segs.map((s) => [s.type, ...s.to]), [['L', 30, 0], ['L', 20, 0]], 'no closing line added to an open subpath');
  assert.deepEqual([subs[2].start, subs[2].segs.length], [[50, 0], 0], 'M 50 0 Z: a zero-length subpath (round and square caps draw it); the lone M 40 0 is gone');
  assert.deepEqual(subs[3].segs.map((s) => s.type), ['C', 'C', 'C'], 'the Q raised to one C, the half-turn arc as two');
  // A command after Z starts a subpath at the start point.
  const after = toSubpaths(toAbsolute(parsePath('M 5 5 L 15 5 Z L 5 15')));
  assert.deepEqual(after.map((s) => [s.start, s.closed]), [[[5, 5], true], [[5, 5], false]]);
  // toLoops is what it was: every subpath that draws closed, lone points and zero-length ones gone.
  assert.equal(toLoops(toAbsolute(parsePath(D))).length, 3);
  assert.equal(loopsD(toLoops(toAbsolute(parsePath('M 20 0 L 30 0 L 20 0')))), 'M 20 0 L 30 0 Z');
});
