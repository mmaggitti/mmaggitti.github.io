// Stroke outlines (P1-M4 S0): a stroker's outline, as SVG strokes a path, checked against the geometry
// by hand and against a brute-force reading of the stroke on a lattice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath } from '../../path/parse.ts';
import { toAbsolute } from '../../path/abs.ts';
import { loopArea, loopsToAbs, toSubpaths, type Loop } from '../../path/loops.ts';
import { polygons, windingOf, type Pt } from '../../path/winding.ts';
import { cubicAt, cubicOffsets, miterRatio, offsetAt, strokeLoops, type StrokeStyle } from '../../path/offset.ts';

const style = (over: Partial<StrokeStyle> = {}): StrokeStyle => ({ width: 2, join: 'miter', miterLimit: 4, cap: 'butt', ...over });
const stroke = (d: string, st: StrokeStyle) => strokeLoops(toSubpaths(toAbsolute(parsePath(d))), st);
const polysOf = (groups: readonly Loop[][]) => groups.flat().map((l) => polygons(loopsToAbs([l]), 1e-4)[0] ?? []);
/** Whether the outline fills (x, y) under nonzero, all its loops one input. */
const filler = (groups: readonly Loop[][]) => {
  const polys = polysOf(groups);
  return (x: number, y: number) => windingOf(polys, x, y) !== 0;
};
const pointsOf = (l: Loop): Pt[] => [l.start, ...l.segs.map((s) => s.to)];
const near = (a: Pt, b: Pt, tol = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

// Distance from p to the segment ab.
function segDist(p: Pt, a: Pt, b: Pt): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const polylineDist = (p: Pt, pts: readonly Pt[]) => {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1], pts[i]));
  return d;
};
// A path as a dense polyline (curves at 2,000 points each): the distance to it is the distance to the path.
const dense = (d: string): Pt[] => polygons(toAbsolute(parsePath(d)), 1e-5)[0];

test('a line’s two offsets, exactly, with butt caps: one loop that winds +1 on the line and 0 beyond the half width', () => {
  const groups = stroke('M 0 0 L 10 0', style());
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 1, 'an open subpath is one loop');
  const pts = pointsOf(groups[0][0]);
  assert.ok(groups[0][0].segs.every((s) => s.type === 'L'), 'lines only');
  const want: Pt[] = [[0, 1], [10, 1], [10, -1], [0, -1]];
  assert.equal(pts.length, 5, 'four corners and back');
  for (const w of want) assert.ok(pts.some((p) => near(p, w)), `the outline has (${w})`);
  const polys = polysOf(groups);
  assert.equal(windingOf(polys, 5, 0), 1, 'on the line: +1');
  assert.equal(windingOf(polys, 5, 0.9), 1);
  assert.equal(windingOf(polys, 5, 1.1), 0, 'past the half width: nothing');
  assert.equal(windingOf(polys, 10.5, 0), 0, 'past a butt end: nothing');
});

test('a cubic’s offsets: each piece fitted by one cubic within w/200 of the true offset at 64 samples, starting and ending on it', () => {
  const c: [Pt, Pt, Pt, Pt] = [[0, 0], [20, 40], [60, -20], [80, 20]];
  for (const w of [6, 1]) {
    const h = w / 2;
    const tol = w / 200;
    const o = cubicOffsets(c, h, tol);
    assert.ok(o.pieces >= 1);
    for (const [side, run] of [[h, o.left], [-h, o.right]] as const) {
      // The run as a dense polyline from the offset's start.
      const pts: Pt[] = [offsetAt(c, 0, side)];
      let at = pts[0];
      for (const s of run) {
        assert.equal(s.type, 'C');
        if (s.type !== 'C') continue;
        for (let i = 1; i <= 200; i++) pts.push(cubicAt([at, s.c1, s.c2, s.to], i / 200));
        at = s.to;
      }
      assert.ok(near(at, offsetAt(c, 1, side)), 'the run ends on the offset’s end');
      const truth: Pt[] = Array.from({ length: 4001 }, (_, i) => offsetAt(c, i / 4000, side));
      for (let i = 0; i < 64; i++) {
        const t = (i + 0.5) / 64;
        const d = polylineDist(offsetAt(c, t, side), pts);
        assert.ok(d <= tol, `w ${w}, side ${side}: the true offset at t = ${t} is ${d} from the fitted run (over ${tol})`);
      }
      for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 64))) {
        const d = polylineDist(pts[i], truth);
        assert.ok(d <= tol * 1.01, `w ${w}, side ${side}: a fitted point is ${d} from the true offset (over ${tol})`);
      }
    }
  }
});

// A right angle, (10, 0) its corner, turning towards +y: its outer corner is at (11, −1) as a miter.
const ELL = 'M 0 0 L 10 0 L 10 10';
test('joins: a miter up to stroke-miterlimit, past it a bevel; round; bevel', () => {
  assert.ok(Math.abs(miterRatio(0) - Math.SQRT2) < 1e-12, 'a right angle’s miter is √2 times the width');
  const miter = stroke(ELL, style());
  assert.ok(miter.flat().some((l) => pointsOf(l).some((p) => near(p, [11, -1]))), 'the miter point');
  let fills = filler(miter);
  assert.ok(fills(10.9, -0.9) && !fills(11.1, -1.1), 'the miter’s corner is filled, and nothing past it');
  // A limit under √2: the same corner is a bevel, from (10, −1) to (11, 0).
  const past = stroke(ELL, style({ miterLimit: 1.2 }));
  assert.ok(!past.flat().some((l) => pointsOf(l).some((p) => near(p, [11, -1]))), 'no miter point past the limit');
  fills = filler(past);
  assert.ok(fills(10.3, -0.3) && !fills(10.9, -0.9), 'cut by the bevel past the limit');
  const bevel = filler(stroke(ELL, style({ join: 'bevel' })));
  assert.ok(bevel(10.3, -0.3) && !bevel(10.6, -0.6), 'a bevel');
  const round = filler(stroke(ELL, style({ join: 'round' })));
  assert.ok(round(10.6, -0.6) && round(10.7, -0.7) && !round(10.75, -0.75), 'round: within the half width of the corner');
  for (const f of [miter, past].map(filler).concat([bevel, round])) assert.ok(f(9.5, 0.5) && f(10, 5) && !f(8, 2), 'the inner side of the corner is filled once, and nothing inside the angle beyond the half width');
});

test('caps: butt stops at the end, round adds a half disc, square half the width more', () => {
  const butt = filler(stroke('M 0 0 L 10 0', style()));
  assert.ok(butt(9.9, 0) && !butt(10.1, 0) && !butt(-0.1, 0));
  const round = filler(stroke('M 0 0 L 10 0', style({ cap: 'round' })));
  assert.ok(round(10.9, 0) && round(10.6, 0.6) && !round(10.75, 0.75) && round(-0.9, 0) && !round(-1.1, 0), 'a half disc at each end');
  const square = filler(stroke('M 0 0 L 10 0', style({ cap: 'square' })));
  assert.ok(square(10.9, 0.9) && !square(11.1, 0) && square(-0.9, -0.9) && !square(-1.1, 0), 'a half width further on at each end');
  // A zero-length subpath: a dot for round and square caps, nothing for butt.
  assert.equal(stroke('M 5 5 Z', style()).length, 0);
  assert.ok(filler(stroke('M 5 5 Z', style({ cap: 'round' })))(5.6, 5.6) === true);
  assert.ok(filler(stroke('M 5 5 L 5 5', style({ cap: 'square' })))(5.9, 4.1) === true);
});

test('a closed subpath: an outer and an inner loop, turned against each other, filling only the band', () => {
  const groups = stroke('M 0 0 L 10 0 L 10 10 L 0 10 Z', style());
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2, 'two loops');
  const [a, b] = groups[0].map(loopArea);
  assert.ok(a * b < 0, 'they run opposite ways');
  const polys = polysOf(groups);
  assert.equal(windingOf(polys, 5, 0), 1, 'on the path');
  assert.equal(windingOf(polys, 5, 5), 0, 'inside the square, past the band');
  assert.equal(windingOf(polys, 5, -1.5), 0, 'outside');
  assert.equal(windingOf(polys, -0.9, -0.9), 1, 'the closing corner is mitered: no caps on a closed subpath');
});

// The lattice: every sample the outline fills under nonzero is one the stroke paints, and the other way
// round, samples within 2% of the half width from the stroke's edge left out (the fit's w/200 and the
// flattening).
function lattice(d: string, st: StrokeStyle, paints: (p: Pt) => number, box: [number, number, number, number], step: number): { checked: number; wrong: string[] } {
  const fills = filler(stroke(d, st));
  const h = st.width / 2;
  const wrong: string[] = [];
  let checked = 0;
  for (let y = box[1]; y <= box[3]; y += step) {
    for (let x = box[0]; x <= box[2]; x += step) {
      const edge = paints([x, y]); // signed: < 0 inside the stroke, by how far from its edge
      if (Math.abs(edge) < 0.02 * h) continue;
      checked++;
      if (fills(x, y) !== edge < 0) wrong.push(`(${x.toFixed(2)}, ${y.toFixed(2)}) ${edge < 0 ? 'painted, not filled' : 'filled, not painted'}`);
    }
  }
  return { checked, wrong };
}

test('the outline fills the stroke: round joins and caps paint exactly what lies within w/2 of the path (the lab’s polyline, a curve, a closed curve)', () => {
  const cases: [string, number, [number, number, number, number]][] = [
    ['M 14 88 L 32 68 L 50 88 L 68 68 L 86 88', 8, [5, 59, 95, 97]],
    ['M 10 60 C 20 20, 60 100, 90 40', 6, [3, 25, 97, 85]],
    ['M 50 40 C 50 32, 37 28, 32 37 C 27 45, 36 57, 50 70 C 64 57, 73 45, 68 37 C 63 28, 50 32, 50 40 Z', 2, [27, 27, 73, 73]],
  ];
  for (const [d, w, box] of cases) {
    const pts = dense(d);
    const { checked, wrong } = lattice(d, style({ width: w, join: 'round', cap: 'round' }), (p) => polylineDist(p, pts) - w / 2, box, 0.37);
    assert.ok(checked > 3000, `${d}: ${checked} samples`);
    assert.deepEqual(wrong.slice(0, 5), [], `${d}: ${wrong.length} of ${checked} samples`);
  }
});

// The exact stroke of a polyline: each segment's rectangle, each corner's join on its outer side, each
// end's cap, as polygons.
function polylineStroke(pts: readonly Pt[], st: StrokeStyle): Pt[][] {
  const h = st.width / 2;
  const out: Pt[][] = [];
  const dir = (a: Pt, b: Pt): Pt => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const off = (p: Pt, t: Pt, k: number): Pt => [p[0] - t[1] * k, p[1] + t[0] * k];
  for (let i = 1; i < pts.length; i++) {
    const t = dir(pts[i - 1], pts[i]);
    out.push([off(pts[i - 1], t, h), off(pts[i], t, h), off(pts[i], t, -h), off(pts[i - 1], t, -h)]);
  }
  for (let i = 1; i + 1 < pts.length; i++) {
    const [t1, t2] = [dir(pts[i - 1], pts[i]), dir(pts[i], pts[i + 1])];
    const s = t1[0] * t2[1] - t1[1] * t2[0] > 0 ? -1 : 1;
    const [A, B] = [off(pts[i], t1, s * h), off(pts[i], t2, s * h)];
    const cos = t1[0] * t2[0] + t1[1] * t2[1];
    if (st.join === 'miter' && 1 / Math.sqrt((1 + cos) / 2) <= st.miterLimit) {
      const k = (s * h) / (1 + cos);
      out.push([pts[i], A, [pts[i][0] + k * (-t1[1] - t2[1]), pts[i][1] + k * (t1[0] + t2[0])], B]);
    } else out.push([pts[i], A, B]);
  }
  if (st.cap === 'square') {
    for (const [e, t] of [[pts[pts.length - 1], dir(pts[pts.length - 2], pts[pts.length - 1])], [pts[0], dir(pts[1], pts[0])]] as [Pt, Pt][]) {
      out.push([off(e, t, h), [off(e, t, h)[0] + t[0] * h, off(e, t, h)[1] + t[1] * h], [off(e, t, -h)[0] + t[0] * h, off(e, t, -h)[1] + t[1] * h], off(e, t, -h)]);
    }
  }
  return out;
}
const inPolygon = (p: Pt, poly: readonly Pt[]) => windingOf([poly], p[0], p[1]) !== 0;

test('the outline fills the stroke: miter and bevel joins, butt and square caps paint exactly their polygons (the lab’s polyline, a sharp zigzag past the miter limit)', () => {
  const cases: [Pt[], StrokeStyle][] = [
    [[[14, 88], [32, 68], [50, 88], [68, 68], [86, 88]], style({ width: 8, join: 'miter', cap: 'square' })],
    [[[14, 88], [32, 68], [50, 88], [68, 68], [86, 88]], style({ width: 8, join: 'bevel', cap: 'butt' })],
    [[[10, 90], [30, 20], [50, 90], [70, 20]], style({ width: 6, join: 'miter', miterLimit: 4, cap: 'butt' })], // the sharp turns pass the limit
    [[[10, 90], [30, 20], [50, 90], [70, 20]], style({ width: 6, join: 'miter', miterLimit: 10, cap: 'square' })],
  ];
  for (const [pts, st] of cases) {
    const polys = polylineStroke(pts, st);
    const d = `M ${pts.map((p) => p.join(' ')).join(' L ')}`;
    const edges = polys.flatMap((poly) => poly.map((p, i): [Pt, Pt] => [p, poly[(i + 1) % poly.length]]));
    const { checked, wrong } = lattice(d, st, (p) => {
      const inside = polys.some((poly) => inPolygon(p, poly));
      const e = Math.min(...edges.map(([a, b]) => segDist(p, a, b)));
      return inside ? -e : e; // edges between the polygons too: only more samples left out
    }, [0, 0, 100, 100], 0.41);
    assert.ok(checked > 3000, `${d}: ${checked} samples`);
    assert.deepEqual(wrong.slice(0, 5), [], `${d} (${st.join}, ${st.cap}, limit ${st.miterLimit}): ${wrong.length} of ${checked} samples`);
  }
});

test('a curve tighter than half the width folds: a circle of radius 2 under a stroke 8 wide fills its ring out to 6 and leaves its middle (within 2 of the centre) empty under nonzero, as Chromium draws it', () => {
  const fills = filler(stroke('M 52 50 A 2 2 0 0 1 50 52 A 2 2 0 0 1 48 50 A 2 2 0 0 1 50 48 A 2 2 0 0 1 52 50 Z', style({ width: 8 })));
  assert.ok(fills(55.5, 50) && fills(50, 44.5) && fills(47.5, 50), 'the ring from 2 to 6 about the centre');
  assert.ok(!fills(50, 50) && !fills(51, 50.5), 'the middle, where the folded inner offset winds the other way');
  assert.ok(!fills(56.5, 50), 'nothing past 6');
});
