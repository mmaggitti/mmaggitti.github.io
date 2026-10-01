// engine/path/winding: the fill's inside-ness under nonzero and evenodd, by exact crossing counts on
// lines and on curves flattened to 0.01 units; the keyhole of lab/arcs--holes.svg, the holes goal;
// and (S3) the booleans' score of a result against its inputs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePath } from '../../path/parse.ts';
import { toAbsolute } from '../../path/abs.ts';
import { booleanScore, crossingsOf, insideAt, opHolds, polygons, windingAt, type BoolOp } from '../../path/winding.ts';
import type { AbsSeg } from '../../path/abs.ts';
import { reverseSubpath } from '../../path/segments.ts';

const abs = (d: string) => toAbsolute(parsePath(d));
const inside = (d: string, x: number, y: number) => ({ nonzero: insideAt(abs(d), x, y, 'nonzero'), evenodd: insideAt(abs(d), x, y, 'evenodd') });
const BOTH = { nonzero: true, evenodd: true };
const NEITHER = { nonzero: false, evenodd: false };
const HOLE_ONLY_NONZERO = { nonzero: true, evenodd: false };

test('lines: a square is inside under both rules, and a vertex on the ray counts once; a square inside a square the same way round is a hole only under evenodd, and the other way round under both', () => {
  const sq = 'M 0 0 L 10 0 L 10 10 L 0 10 Z';
  assert.deepEqual(inside(sq, 5, 5), BOTH);
  assert.deepEqual(inside(sq, 15, 5), NEITHER);
  assert.deepEqual(inside(sq, -5, 0), NEITHER, 'the ray through two corners crosses twice: outside');
  assert.deepEqual(inside(sq, -5, 10), NEITHER);
  assert.equal(Math.abs(windingAt(abs(sq), 5, 5)), 1);
  const same = `${sq} M 3 3 L 7 3 L 7 7 L 3 7 Z`;
  assert.deepEqual(inside(same, 5, 5), HOLE_ONLY_NONZERO, 'both clockwise: nonzero counts 2');
  assert.equal(Math.abs(windingAt(abs(same), 5, 5)), 2);
  assert.deepEqual(inside(same, 1, 5), BOTH);
  const other = `${sq} M 3 3 L 3 7 L 7 7 L 7 3 Z`;
  assert.deepEqual(inside(other, 5, 5), NEITHER, 'the inner one reversed: a hole under both rules');
  assert.deepEqual(inside(other, 1, 5), BOTH);
  // An open subpath is filled as if closed; H and V draw lines.
  assert.deepEqual(inside('M 0 0 H 10 V 10 H 0', 5, 5), BOTH);
});

test('a self-intersecting star: its centre winds twice, so nonzero fills it and evenodd leaves it empty', () => {
  const star = 'M 50 5 L 79 95 L 2 40 L 98 40 L 21 95 Z';
  assert.deepEqual(inside(star, 50, 55), HOLE_ONLY_NONZERO);
  assert.equal(Math.abs(windingAt(abs(star), 50, 55)), 2);
  assert.deepEqual(inside(star, 50, 20), BOTH, 'a tip winds once');
  assert.deepEqual(inside(star, 5, 90), NEITHER);
});

test('curves are flattened to within 0.01 units: a quadratic, a cubic and a circle of two arcs each put the boundary where the curve is', () => {
  // the quadratic's peak is at (50, 50): half of its control's 100
  const q = 'M 0 0 Q 50 100 100 0 Z';
  assert.deepEqual(inside(q, 50, 49.9), BOTH);
  assert.deepEqual(inside(q, 50, 50.1), NEITHER);
  assert.deepEqual(inside(q, 50, -0.1), NEITHER);
  // the cubic's middle is at y = 75 (¾ of its controls' 100)
  const c = 'M 0 0 C 0 100 100 100 100 0 Z';
  assert.deepEqual(inside(c, 50, 74.9), BOTH);
  assert.deepEqual(inside(c, 50, 75.1), NEITHER);
  // a circle of radius 50 about (50, 50), as two arcs
  const circle = 'M 0 50 A 50 50 0 1 1 100 50 A 50 50 0 1 1 0 50 Z';
  assert.deepEqual(inside(circle, 50, 50), BOTH);
  assert.deepEqual(inside(circle, 50, 99.95), BOTH);
  assert.deepEqual(inside(circle, 50, 100.05), NEITHER);
  const r = 50 / Math.SQRT2;
  assert.deepEqual(inside(circle, 50 + r - 0.05, 50 + r - 0.05), BOTH, 'the diagonal, just inside');
  assert.deepEqual(inside(circle, 50 + r + 0.05, 50 + r + 0.05), NEITHER, 'the diagonal, just outside');
  // every flattened point is within 0.01 of the true circle
  for (const p of polygons(abs(circle))) for (const [x, y] of p) assert.ok(Math.abs(Math.hypot(x - 50, y - 50) - 50) < 1e-9, 'the points lie on the curve');
  // a ring of two circles the same way round: a hole under evenodd only
  const ring = `${circle} M 30 50 A 20 20 0 1 1 70 50 A 20 20 0 1 1 30 50 Z`;
  assert.deepEqual(inside(ring, 50, 50), HOLE_ONLY_NONZERO);
  assert.deepEqual(inside(ring, 50, 10), BOTH);
  // a relative arc, an S and a T flatten through toAbsolute like the rest
  // the s curve bulges down to y ≈ 72.2 at most
  assert.deepEqual(inside('M 0 0 h 100 v 50 s -50 50 -100 0 z', 50, 25), BOTH);
  assert.deepEqual(inside('M 0 0 h 100 v 50 s -50 50 -100 0 z', 50, 90), NEITHER);
  // the T mirrors the Q's control (25, −40) about (50, 0): its dip reaches y = 20 at x = 75
  const qt = 'M 0 0 Q 25 -40 50 0 T 100 0 V 50 H 0 Z';
  assert.deepEqual(inside(qt, 25, -5), BOTH, 'under the Q’s hump (its top at y = −20)');
  assert.deepEqual(inside(qt, 75, 5), NEITHER, 'above the T’s dip');
  assert.deepEqual(inside(qt, 75, 25), BOTH, 'below the T’s dip');
});

test('three nested squares the same way round: the ray’s unsigned crossings and the winding number agree on parity, and evenodd reads the count', () => {
  const d = 'M 0 0 L 10 0 L 10 10 L 0 10 Z M 2 2 L 8 2 L 8 8 L 2 8 Z M 4 4 L 6 4 L 6 6 L 4 6 Z';
  const polys = polygons(abs(d));
  // [x, y, depth, the edges to the right of the point that the ray crosses]
  for (const [x, y, depth, crossed] of [[1, 5, 1, 5], [3, 5, 2, 4], [5, 5, 3, 3]] as const) {
    assert.equal(crossingsOf(polys, x, y), crossed);
    assert.equal(Math.abs(windingAt(abs(d), x, y)), depth);
    assert.equal(insideAt(abs(d), x, y, 'evenodd'), depth % 2 === 1, `evenodd at depth ${depth}`);
    assert.equal(insideAt(abs(d), x, y, 'nonzero'), true);
  }
});

test('lab/arcs--holes.svg, the keyhole: (50, 55) is empty under evenodd, filled under nonzero until the inner subpath is reversed; (50, 20) is filled in all three states', () => {
  const src = readFileSync(new URL('../fixtures/corpus/lab/arcs--holes.svg', import.meta.url), 'utf8');
  const d = /\sd="([^"]*)"/.exec(src)![1];
  assert.deepEqual(inside(d, 50, 55), HOLE_ONLY_NONZERO, 'outer and inner both clockwise');
  assert.deepEqual(inside(d, 50, 20), BOTH);
  const rev = reverseSubpath(d, 1);
  assert.deepEqual(inside(rev, 50, 55), NEITHER, 'the inner reversed: a hole under nonzero too');
  assert.deepEqual(inside(rev, 50, 20), BOTH);
});

// ── the boolean score (P1-M3 S3) ────────────────────────────────────────────────────────────────

const sq = (x: number, y: number, s: number, ccw = false): AbsSeg[] => abs(ccw ? `M ${x} ${y} V ${y + s} H ${x + s} V ${y} Z` : `M ${x} ${y} H ${x + s} V ${y + s} H ${x} Z`);

test('opHolds: what each operation says of a point, from whether each input (the bottom first) holds it', () => {
  const cases: [boolean[], Record<BoolOp, boolean>][] = [
    [[true, false], { union: true, difference: true, intersection: false, exclusion: true }],
    [[false, true], { union: true, difference: false, intersection: false, exclusion: true }],
    [[true, true], { union: true, difference: false, intersection: true, exclusion: false }],
    [[false, false], { union: false, difference: false, intersection: false, exclusion: false }],
    [[true, true, true], { union: true, difference: false, intersection: true, exclusion: true }],
  ];
  for (const [inside, want] of cases) for (const op of Object.keys(want) as BoolOp[]) assert.equal(opHolds(op, inside), want[op], `${op} of ${inside}`);
});

test('booleanScore: a right result misses nothing under either rule; a wrong one misses its share; samples near an input’s outline are left out', () => {
  const a = { abs: sq(0, 0, 60), rule: 'nonzero' as const };
  const b = { abs: sq(40, 40, 60), rule: 'nonzero' as const };
  const union = abs('M 0 0 H 60 V 40 H 100 V 100 H 40 V 60 H 0 Z');
  const right = booleanScore([a, b], 'union', union, 64, 0.005);
  assert.deepEqual([right.nonzero, right.evenodd], [0, 0]);
  const all = booleanScore([a, b], 'union', union, 64, 0);
  assert.equal(all.counted, 64 * 64, 'no skip: every sample counts');
  assert.ok(right.counted < all.counted, 'with a skip, samples near the outlines are left out');
  // The bottom alone for a union misses b’s own part: 3,200 of the box’s 10,000 square units.
  const wrong = booleanScore([a, b], 'union', a.abs, 64, 0.005);
  assert.ok(Math.abs(wrong.nonzero - 0.32) < 0.03 && Math.abs(wrong.evenodd - 0.32) < 0.03, `${JSON.stringify(wrong)}`);
  // A hole written the same way round as its outline: right under evenodd, wrong under nonzero.
  const ring = [...sq(0, 0, 100), ...sq(25, 25, 50)];
  const inner = { abs: sq(25, 25, 50), rule: 'nonzero' as const };
  const s = booleanScore([{ abs: sq(0, 0, 100), rule: 'nonzero' }, inner], 'difference', ring, 64, 0.005);
  assert.equal(s.evenodd, 0);
  assert.ok(Math.abs(s.nonzero - 0.25) < 0.03, `${JSON.stringify(s)}`);
  // Each input’s own rule: under evenodd, the doubled square (a figure written twice) holds nothing.
  const twice = { abs: [...sq(0, 0, 50), ...sq(0, 0, 50)], rule: 'evenodd' as const };
  assert.deepEqual(booleanScore([twice, { abs: sq(25, 25, 50), rule: 'nonzero' }], 'union', sq(25, 25, 50), 32, 0.005).nonzero, 0);
});
