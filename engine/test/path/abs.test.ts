// engine/path/abs: absolute resolution of every command against hand-computed values.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath } from '../../path/parse.ts';
import { toAbsolute, type AbsSeg } from '../../path/abs.ts';
import { corpus } from './helpers.ts';

const abs = (d: string) => toAbsolute(parsePath(d));
// A compact view: type, end point, then any control points.
const ends = (segs: AbsSeg[]) => segs.map((s) => [s.type, s.x, s.y]);

test('M, L, H, V and Z, absolute and relative', () => {
  assert.deepEqual(ends(abs('M10 20 h5 v5 H0 V0 z')), [
    ['M', 10, 20],
    ['L', 15, 20],
    ['L', 15, 25],
    ['L', 0, 25],
    ['L', 0, 0],
    ['Z', 10, 20],
  ]);
  // A first relative moveto is from the origin; its implicit pairs are relative lines.
  assert.deepEqual(ends(abs('m5 5 10 0 0 10')), [
    ['M', 5, 5],
    ['L', 15, 5],
    ['L', 15, 15],
  ]);
  assert.deepEqual(ends(abs('M5 5 10 0')), [
    ['M', 5, 5],
    ['L', 10, 0],
  ]);
  const s = abs('M1 2 L3 4');
  assert.deepEqual([s[1].x0, s[1].y0], [1, 2], 'x0, y0 is the current point before the segment');
});

test('Z returns to the subpath start; what follows starts a new subpath there', () => {
  const s = abs('M10 10 l5 0 l0 5 z l0 5 m1 1 L0 0 Z M20 20 z');
  assert.deepEqual(ends(s), [
    ['M', 10, 10],
    ['L', 15, 10],
    ['L', 15, 15],
    ['Z', 10, 10],
    ['L', 10, 15], // relative to the closed subpath's start
    ['M', 11, 16],
    ['L', 0, 0],
    ['Z', 11, 16],
    ['M', 20, 20],
    ['Z', 20, 20],
  ]);
  assert.deepEqual(s.map((x) => x.sub), [0, 0, 0, 0, 1, 2, 2, 2, 3, 3]);
  assert.deepEqual(s.map((x) => x.cmd), ['M', 'l', 'l', 'z', 'l', 'm', 'L', 'Z', 'M', 'z']);
});

test('C and S: the reflected first control point, only after C or S', () => {
  const s = abs('M0 0 C10 0 20 10 20 20 S30 40 40 40 s10 0 10 10');
  assert.equal(s[2].type, 'C');
  if (s[2].type !== 'C' || s[3].type !== 'C') return;
  assert.deepEqual([s[2].x1, s[2].y1, s[2].x2, s[2].y2, s[2].x, s[2].y], [20, 30, 30, 40, 40, 40]);
  // s after S: reflect (30, 40) about (40, 40) → (50, 40); relative control and end.
  assert.deepEqual([s[3].x1, s[3].y1, s[3].x2, s[3].y2, s[3].x, s[3].y], [50, 40, 50, 40, 50, 50]);
  // After anything else the first control point is the current point.
  for (const d of ['M0 0 L10 10 S20 20 30 30', 'M0 0 Q5 5 10 10 S20 20 30 30', 'M10 10 S20 20 30 30']) {
    const t = abs(d).at(-1)!;
    assert.ok(t.type === 'C' && t.x1 === t.x0 && t.y1 === t.y0, d);
  }
  const r = abs('M1 1 c1 2 3 4 5 6 7 8 9 10 11 12'); // implicit c repeats: relative to each new point
  assert.ok(r[2].type === 'C' && r[2].x1 === 13 && r[2].y1 === 15 && r[2].x === 17 && r[2].y === 19);
});

test('Q and T: the reflected control point chains through T', () => {
  const s = abs('M0 0 Q10 10 20 0 T40 0 t20 0');
  const q = s.map((x) => (x.type === 'Q' ? [x.x1, x.y1, x.x, x.y] : null));
  assert.deepEqual(q, [null, [10, 10, 20, 0], [30, -10, 40, 0], [50, 10, 60, 0]]);
  for (const d of ['M0 0 L10 0 T20 0', 'M0 0 C1 1 2 2 10 0 T20 0', 'M10 0 T20 0']) {
    const t = abs(d).at(-1)!;
    assert.ok(t.type === 'Q' && t.x1 === t.x0 && t.y1 === t.y0, d);
  }
});

test('A keeps its parameters and resolves its end point', () => {
  const [, a, b] = abs('M5 5 a-3 4 30 1 0 10 0 A 2 2 0 0 1 1 1');
  assert.ok(a.type === 'A' && b.type === 'A');
  assert.deepEqual([a.rx, a.ry, a.rot, a.large, a.sweep, a.x, a.y], [-3, 4, 30, true, false, 15, 5]);
  assert.deepEqual([b.x0, b.y0, b.large, b.sweep, b.x, b.y], [15, 5, false, true, 1, 1]);
});

test('every real path resolves to finite geometry, one AbsSeg per Seg', () => {
  const { icons, lab } = corpus();
  for (const d of [...icons, ...lab]) {
    const p = parsePath(d);
    const s = toAbsolute(p);
    assert.equal(s.length, p.segs.length);
    for (const x of s) assert.ok(Object.values(x).every((v) => typeof v !== 'number' || Number.isFinite(v)), d.slice(0, 60));
  }
});
