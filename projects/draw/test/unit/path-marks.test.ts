// The path marks (src/interact/path-marks.ts): what the overlay draws for a path in the Node tool and
// for the Pen's drag, in host px, from the engine's geometry and the element's toHost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath } from '../../../../engine/path/parse.ts';
import { toAbsolute } from '../../../../engine/path/abs.ts';
import { nodesOf } from '../../../../engine/path/nodes.ts';
import type { Affine } from '../../../../engine/values/affine.ts';
import { arcGhosts, directionArrows, donutLabels, ghostAt, pathMarks, penArms, type Arrow } from '../../src/interact/path-marks.ts';
import { arcCenter, arcPoint, type ArcCenter } from '../../../../engine/path/arc.ts';

// A test camera: 2 px a unit, the drawing 10 px right and 20 px down.
const TO_HOST: Affine = [2, 0, 0, 2, 10, 20];
const marks = (d: string) => {
  const p = parsePath(d);
  return pathMarks(nodesOf(p, toAbsolute(p)), TO_HOST);
};
const at = (x: number, y: number) => ({ x: 2 * x + 10, y: 2 * y + 20 });
const line = (a: [number, number], b: [number, number]) => ({ from: at(...a), to: at(...b) });

test('arms: a C’s start → first control and second control → end, a Q’s start → control → end, an S’s second control → end; through toHost', () => {
  assert.deepEqual(marks('M 10 55 C 22 20, 40 20, 50 55').arms, [line([10, 55], [22, 20]), line([40, 20], [50, 55])]);
  assert.deepEqual(marks('M 30 44 Q 40 32, 50 44').arms, [line([30, 44], [40, 32]), line([40, 32], [50, 44])]);
  const s = marks('M 10 55 C 22 20, 40 20, 50 55 S 78 90, 90 55');
  assert.deepEqual(s.arms.slice(2), [line([78, 90], [90, 55])], 'the S: its second control only');
  assert.deepEqual(marks('M 0 0 L 10 10 H 20').arms, [], 'lines have none');
});

test('mirror guides: lab/arcs--smooth.svg’s S implies (60, 90), a dashed arm from its start and a dot there; a T’s from its start and on to its end; nothing when the implied control is the start', () => {
  const s = marks('M 10 55\n   C 22 20, 40 20, 50 55\n   S 78 90, 90 55');
  assert.deepEqual(s.mirrors, [line([50, 55], [60, 90])]);
  assert.deepEqual(s.dots, [at(60, 90)]);
  const t = marks('M 0 0 Q 10 20 20 0 T 40 0');
  assert.deepEqual(t.mirrors, [line([20, 0], [30, -20]), line([30, -20], [40, 0])], 'reflected about the segment’s start');
  assert.deepEqual(t.dots, [at(30, -20)]);
  const none = marks('M 0 0 L 10 0 S 20 10 30 0 T 50 0');
  assert.deepEqual([none.mirrors, none.dots], [[], []], 'an S after a line and a T after an S imply their start: nothing drawn');
});

test('the Pen’s drag: both arms from the point, to the finger and to its reflection', () => {
  assert.deepEqual(penArms({ x: 100, y: 100 }, { x: 130, y: 90 }), [
    { from: { x: 100, y: 100 }, to: { x: 130, y: 90 } },
    { from: { x: 100, y: 100 }, to: { x: 70, y: 110 } },
  ]);
});

// ── S2: ghost arcs, flag labels, direction arrows, the donut's labels ──────────────────────────

const ARC = { x0: 24, y0: 50, rx: 30, ry: 30, rot: 0, large: false, sweep: true, x: 76, y: 50 }; // lab/arcs.svg
const near = (p: { x: number; y: number }, q: { x: number; y: number }, tol = 1e-9) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
const bez = (p0: { x: number; y: number }, [c1, c2, p1]: { x: number; y: number }[], t: number) => {
  const u = 1 - t;
  return { x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x, y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y };
};

test('ghost arcs: lab/arcs.svg’s arc (0 1) gives the three other flag pairs as cubics through toHost, each from the start to the end and on its circle; four labels “L S”, the arc’s own marked, 10 px out from the chord’s midpoint and 4 px lower, clamped inside the canvas; nothing for a line or an omitted arc', () => {
  const { ghosts, flags } = arcGhosts(ARC, TO_HOST, { width: 400, height: 400 });
  assert.deepEqual(ghosts.map((g) => g.flags), ['0 0', '1 0', '1 1']);
  for (const g of ghosts) {
    const [L, S] = g.flags.split(' ').map((f) => f === '1');
    const c = arcCenter(24, 50, 30, 30, 0, L, S, 76, 50) as ArcCenter;
    assert.ok(near(g.start, at(24, 50)), `${g.flags}: from the start`);
    assert.ok(near(g.cubics.at(-1)![2], at(76, 50)), `${g.flags}: to the end`);
    let p0 = g.start;
    for (const cub of g.cubics) {
      const m = bez(p0, cub, 0.5);
      assert.ok(Math.abs(Math.hypot(m.x - (2 * c.cx + 10), m.y - (2 * c.cy + 20)) - 60) < 0.05, `${g.flags}: on its circle (radius 60 px)`);
      p0 = cub[2];
    }
  }
  assert.deepEqual(flags.map((f) => [f.text, f.on]), [['0 0', false], ['0 1', true], ['1 0', false], ['1 1', false]]);
  const chord = at(50, 50);
  for (const f of flags) {
    const [L, S] = f.text.split(' ').map((v) => v === '1');
    const c = arcCenter(24, 50, 30, 30, 0, L, S, 76, 50) as ArcCenter;
    const [mx, my] = arcPoint(c, c.t1 + c.dt / 2);
    const mid = at(mx, my);
    const len = Math.hypot(mid.x - chord.x, mid.y - chord.y);
    const want = { x: mid.x + (10 * (mid.x - chord.x)) / len, y: mid.y + (10 * (mid.y - chord.y)) / len + 4 };
    assert.ok(near(f.at, want, 1e-6), `${f.text}: ${JSON.stringify(f.at)}, not ${JSON.stringify(want)}`);
  }
  // A small canvas: every label clamped 8 px inside horizontally, 13 px from the top, 4 px from the bottom.
  const small = arcGhosts(ARC, [3, 0, 0, 3, -60, -40], { width: 150, height: 150 });
  assert.equal(small.flags.length, 4);
  for (const f of small.flags) assert.ok(f.at.x >= 8 && f.at.x <= 142 && f.at.y >= 13 && f.at.y <= 146, JSON.stringify(f.at));
  assert.ok(small.flags.some((f) => f.at.y === 13), 'the top arc’s label is held 13 px down');
  assert.deepEqual(arcGhosts({ ...ARC, rx: 0 }, TO_HOST, { width: 400, height: 400 }), { ghosts: [], flags: [] }, 'a zero radius: a line');
  assert.deepEqual(arcGhosts({ ...ARC, x: 24, y: 50 }, TO_HOST, { width: 400, height: 400 }), { ghosts: [], flags: [] }, 'equal endpoints: omitted');
});

test('ghostAt: a tap within 22 px of a ghost’s curve picks it, the nearest when two are near; further away, none', () => {
  const { ghosts } = arcGhosts(ARC, TO_HOST, { width: 400, height: 400 });
  for (const g of ghosts) {
    const [L, S] = g.flags.split(' ').map((f) => f === '1');
    const c = arcCenter(24, 50, 30, 30, 0, L, S, 76, 50) as ArcCenter;
    const [mx, my] = arcPoint(c, c.t1 + c.dt / 2);
    assert.equal(ghostAt(ghosts, at(mx, my))?.flags, g.flags);
    assert.equal(ghostAt(ghosts, { x: at(mx, my).x + 21, y: at(mx, my).y })?.flags, g.flags, '21 px off');
  }
  assert.equal(ghostAt(ghosts, at(50, 50)), null, 'the chord’s middle is 30 px from every ghost');
});

// An arrow's centre and direction: its tip is 1.7s ahead of the centre, its base s behind.
const arrowAt = (a: Arrow) => {
  const base = { x: (a.points[1].x + a.points[2].x) / 2, y: (a.points[1].y + a.points[2].y) / 2 };
  const len = Math.hypot(a.points[0].x - base.x, a.points[0].y - base.y);
  const u = { x: (a.points[0].x - base.x) / len, y: (a.points[0].y - base.y) / len };
  return { at: { x: base.x + 4.5 * u.x, y: base.y + 4.5 * u.y }, u, len, width: Math.hypot(a.points[1].x - a.points[2].x, a.points[1].y - a.points[2].y) };
};

test('direction arrows: lab/arcs--holes.svg’s outer arrows at (50, 14) pointing +x and (50, 86) pointing −x (SVG Lab’s places), one per drawing segment of nonzero length, every inner one inner; the lab’s triangle', () => {
  const d = 'M 14 50 A 36 36 0 1 1 86 50\n   A 36 36 0 1 1 14 50 Z\n   M 43.3 42 A 9 9 0 1 1 56.7 42 L 61 66 L 39 66 Z';
  const arrows = directionArrows(toAbsolute(parsePath(d)), TO_HOST);
  const outer = arrows.filter((a) => !a.inner).map(arrowAt);
  assert.equal(outer.length, 2, 'the two arcs (the outer Z closes nothing)');
  assert.ok(near(outer[0].at, at(50, 14), 1e-6) && near(outer[0].u, { x: 1, y: 0 }, 1e-9), JSON.stringify(outer[0]));
  assert.ok(near(outer[1].at, at(50, 86), 1e-6) && near(outer[1].u, { x: -1, y: 0 }, 1e-9), JSON.stringify(outer[1]));
  const inner = arrows.filter((a) => a.inner).map(arrowAt);
  assert.equal(inner.length, 4, 'the inner arc, its two lines and its closing line, each inner');
  const bottom = inner.find((a) => near(a.at, at(50, 66), 1e-6))!;
  assert.ok(bottom && near(bottom.u, { x: -1, y: 0 }, 1e-9), 'the bottom line runs left');
  for (const a of [...outer, ...inner]) {
    assert.ok(Math.abs(a.len - 2.7 * 4.5) < 1e-9 && Math.abs(a.width - 9) < 1e-9, 'tip (1.7s, 0), base (−s, ±s), s = 4.5 px');
  }
  assert.equal(directionArrows(toAbsolute(parsePath('M 0 0 L 10 0 L 10 0')), TO_HOST).length, 1, 'a segment of no length gets none');
});

test('the donut’s labels: 40%, 25%, 20%, 15% at each slice’s middle angle on radius 43 about (50, 50) (SVG Lab’s 43 for r 28), through toHost', () => {
  const labels = donutLabels({ values: [40, 25, 20, 15], cx: 50, cy: 50, r: 28 }, TO_HOST);
  assert.deepEqual(labels.map((l) => l.text), ['40%', '25%', '20%', '15%']);
  const mids = [0.2, 0.525, 0.75, 0.925];
  labels.forEach((l, i) => {
    const a = -Math.PI / 2 + mids[i] * 2 * Math.PI;
    assert.ok(near(l.at, at(50 + 43 * Math.cos(a), 50 + 43 * Math.sin(a)), 1e-9), `${l.text} at ${JSON.stringify(l.at)}`);
  });
  assert.deepEqual(donutLabels({ values: [1, 2], cx: 0, cy: 0, r: 28 }, TO_HOST).map((l) => l.text), ['33%', '67%'], 'rounded');
});
