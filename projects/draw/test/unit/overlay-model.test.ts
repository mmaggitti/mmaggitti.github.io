// The overlay model (src/interact/overlay-model.ts): where the paper, the grid, the tooltip and the
// coordinate guides go, as plain numbers in host px; and the handles (src/interact/handles.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coordGuides, gridModel, gridStep, localGridModel, paperRect, quadOf, rootToHost, tip, tipBox, unionBox, GRID_MIN_PX, type HandleKind } from '../../src/interact/overlay-model.ts';
import { DIAMOND_PX, HANDLE_PICK_PX, RING_PX, handlesFor, handlesForMany, magneticAngle, pickHandle, scaleStep } from '../../src/interact/handles.ts';
import { CENTRE_DOT_R, HANDLE } from '../../src/canvas/overlay/marks.ts';
import { unionRect } from '../../src/editor.ts';

const HOST = { width: 400, height: 300 };

test('the paper is the artboard through M and the camera box, or the box itself without one', () => {
  // viewBox 0 0 100 50 in a 400 × 300 viewport: M scales by 4 and centres it (50 px down).
  const M = [4, 0, 0, 4, 0, 50] as const;
  const box = { left: 10, top: -20, width: 800, height: 600 }; // zoomed 2×
  assert.deepEqual(paperRect(box, HOST, M, { x: 0, y: 0, width: 100, height: 50 }), { x: 10, y: 80, width: 800, height: 400 });
  assert.deepEqual(paperRect(box, HOST, M, null), { x: 10, y: -20, width: 800, height: 600 }, 'no artboard: the box');
  assert.deepEqual(rootToHost(box, HOST, M, { x: 25, y: 25 }), { x: 210, y: 280 });
});

test('the grid step is the smallest 1, 2 or 5 × 10ⁿ root units at least 12 px apart', () => {
  assert.equal(GRID_MIN_PX, 12);
  const cases: [number, number][] = [[12, 1], [11.9, 2], [6, 2], [5.9, 5], [2.4, 5], [2.3, 10], [1, 20], [0.1, 200], [120, 0.1], [13, 1], [1200, 0.01], [24, 0.5]];
  for (const [pxPerUnit, step] of cases) assert.equal(gridStep(pxPerUnit), step, `${pxPerUnit} px per unit`);
  for (let k = 0.013; k < 4000; k *= 1.37) {
    const s = gridStep(k);
    assert.ok(s * k >= GRID_MIN_PX - 1e-9, `${k}: ${s} is ${s * k} px apart`);
    const finer = [1, 2, 5].flatMap((m) => [-4, -3, -2, -1, 0, 1, 2, 3].map((e) => m * 10 ** e)).filter((x) => x < s - 1e-12);
    assert.ok(finer.every((x) => x * k < GRID_MIN_PX), `${k}: a finer step would do`);
  }
});

test('grid lines sit at multiples of the step in root units, over the paper and inside the host only, every fifth major', () => {
  const M = [1, 0, 0, 1, 0, 0] as const;
  const box = { left: 50, top: 20, width: 300, height: 300 }; // 1 root unit = 3 px (viewport 100 × 100)
  const vp = { width: 100, height: 100 };
  const paper = paperRect(box, vp, M, { x: 0, y: 0, width: 100, height: 100 });
  const step = gridStep(3);
  assert.equal(step, 5);
  const g = gridModel(box, vp, M, HOST, paper, step);
  assert.deepEqual(g.over, { x: 50, y: 20, width: 300, height: 280 }, 'the paper, clipped to the host');
  assert.deepEqual(g.x.map((l) => l.at), Array.from({ length: 21 }, (_, i) => 50 + i * 15));
  assert.ok(g.x.every((l) => l.major === (Math.round((l.at - 50) / 15) % 5 === 0)), 'every fifth line is major');
  assert.equal(g.y.at(-1)!.at, 20 + 18 * 15, 'the last y line inside the host (300 px tall)');
  assert.equal(gridModel(box, vp, M, HOST, { x: 500, y: 0, width: 10, height: 10 }, 5).x.length, 0, 'a paper outside the host: no lines');
});

test('the tooltip sits 42 px above the finger, 40 px below it within 64 px of the top, and 4 px inside the canvas', () => {
  const t = tip('x 3, y 4', { x: 200, y: 150 });
  assert.equal(t.below, false);
  assert.deepEqual(tipBox(t, 60, 24, 400), { left: 170, top: 150 - 42 - 24 }, 'centred, its bottom edge 42 px above');
  const near = tip('x 3, y 4', { x: 200, y: 63 });
  assert.equal(near.below, true, 'within 64 px of the top it flips below');
  assert.deepEqual(tipBox(near, 60, 24, 400), { left: 170, top: 63 + 40 }, 'its top edge 40 px below');
  assert.equal(tip('', { x: 0, y: 64 }).below, false, '64 px down is not near');
  assert.equal(tipBox(tip('a', { x: 2, y: 100 }), 60, 24, 400).left, 4, 'kept 4 px inside at the left');
  assert.equal(tipBox(tip('a', { x: 399, y: 100 }), 60, 24, 400).left, 400 - 4 - 60, 'and at the right');
});

test('coordinate guides run from the paper’s left and top edges to the centre; labels show only on guides long enough, the y label flips left near the right edge', () => {
  const paper = { x: 20, y: 30, width: 300, height: 200 };
  const g = coordGuides({ x: 120, y: 130 }, paper, { x: 50, y: 60 }, 0, 400);
  assert.deepEqual(g.lines, [{ from: { x: 20, y: 130 }, to: { x: 120, y: 130 } }, { from: { x: 120, y: 30 }, to: { x: 120, y: 130 } }]);
  assert.deepEqual(g.labels.map((l) => [l.text, l.anchor]), [['x = 50', 'middle'], ['y = 60', 'start']]);
  const short = coordGuides({ x: 20 + 63, y: 30 + 55 }, paper, { x: 1, y: 2 }, 0, 400);
  assert.deepEqual(short.labels, [], 'x guide under 64 px, y guide under 56 px: no labels');
  const edge = coordGuides({ x: 400 - 95, y: 130 }, paper, { x: 1.25, y: 2 }, 2, 400);
  assert.deepEqual(edge.labels.map((l) => [l.text, l.anchor]), [['x = 1.25', 'middle'], ['y = 2', 'end']], 'within 96 px of the right edge the y label goes left');
});

test('quads come from a local box through its matrix, and a union box holds them all', () => {
  const q = quadOf({ x: 0, y: 0, width: 10, height: 20 }, [0, 1, -1, 0, 100, 50]); // turned 90°
  assert.deepEqual(q, [{ x: 100, y: 50 }, { x: 100, y: 60 }, { x: 80, y: 60 }, { x: 80, y: 50 }]);
  assert.deepEqual(unionBox([q, quadOf({ x: 0, y: 0, width: 1, height: 1 }, [1, 0, 0, 1, 0, 0])]), { x: 0, y: 0, width: 100, height: 60 });
  assert.equal(unionBox([]), null);
});

// Every selected shape's corners go into one union box (the P1-M1 follow-up): a spread call such as
// Math.min(...xs) throws past about 150,000 arguments in V8, so both unions are loops.
test('the union boxes take 200,000 boxes without throwing, and hold them all: the overlay’s unionBox and Align’s unionRect', () => {
  // A grid of 1 × 1 boxes (x 0 to 1998 by 2, y 0 to 597 by 3), with the extremes in the middle of the list.
  const boxes = Array.from({ length: 200_000 }, (_, i) => ({ x: (i % 1000) * 2, y: Math.floor(i / 1000) * 3, width: 1, height: 1 }));
  boxes[70_001] = { x: -7.5, y: 12, width: 1, height: 1 };
  boxes[130_002] = { x: 40, y: -3, width: 2, height: 700 };
  const want = { x: -7.5, y: -3, width: 2006.5, height: 700 };
  assert.deepEqual(unionBox(boxes.map((b) => quadOf(b, [1, 0, 0, 1, 0, 0]))), want, 'unionBox over 800,000 corners');
  assert.deepEqual(unionRect(boxes), want, 'unionRect over 200,000 boxes');
});

// ── handles (src/interact/handles.ts) ─────────────────────────────────────────────────────────

test('handles: corners on the quad (hidden under 32 px a side), the centre, the ring 40 px beyond the top edge along the element’s own −y, the diamond 20 px beyond the bottom-right from the scale pivot', () => {
  const quad = quadOf({ x: 0, y: 0, width: 100, height: 60 }, [1, 0, 0, 1, 50, 100]);
  const { handles, rotGuide } = handlesFor({ quad, corners: true, rotPivot: { x: 100, y: 130 }, scalePivot: { x: 50, y: 100 } }, 'tr');
  assert.deepEqual(handles.map((h) => [h.id, h.kind]), [['tl', 'anchor'], ['tr', 'anchor'], ['br', 'anchor'], ['bl', 'anchor'], ['center', 'center'], ['rot', 'rot'], ['scale', 'scale']], 'drawing order: corners, centre, ring, diamond');
  const at = (id: string) => handles.find((h) => h.id === id)!.at;
  assert.deepEqual([at('tl'), at('br'), at('center')], [{ x: 50, y: 100 }, { x: 150, y: 160 }, { x: 100, y: 130 }]);
  assert.deepEqual(at('rot'), { x: 100, y: 100 - RING_PX }, 'above the top edge’s middle');
  const d = at('scale');
  assert.ok(Math.abs(Math.hypot(d.x - 150, d.y - 160) - DIAMOND_PX) < 1e-9 && Math.abs((d.y - 100) / (d.x - 50) - 60 / 100) < 1e-9, 'on the ray from the pivot through the corner, 20 px beyond');
  assert.deepEqual(rotGuide, { from: { x: 100, y: 130 }, to: at('rot') }, 'the guide from the pivot to the ring');
  assert.deepEqual(handles.filter((h) => h.active).map((h) => h.id), ['tr'], 'the dragged one is active');
  // Turned 90°: the ring follows the element's own −y.
  const turned = handlesFor({ quad: quadOf({ x: 0, y: 0, width: 100, height: 60 }, [0, 1, -1, 0, 200, 0]), corners: true, rotPivot: { x: 0, y: 0 }, scalePivot: null }, null);
  assert.deepEqual(turned.handles.find((h) => h.id === 'rot')!.at, { x: 200 + RING_PX, y: 50 });
  assert.ok(!turned.handles.some((h) => h.kind === 'scale'), 'no scale(): no diamond');
  const small = handlesFor({ quad: quadOf({ x: 0, y: 0, width: 31, height: 60 }, [1, 0, 0, 1, 0, 0]), corners: true, rotPivot: null, scalePivot: null }, null);
  assert.deepEqual(small.handles.map((h) => h.id), ['center'], 'a side under 32 px: no corners; no pivot: no ring');
  assert.deepEqual(handlesForMany({ x: 10, y: 20, width: 100, height: 40 }, null).map((h) => [h.id, h.at]), [['center', { x: 60, y: 40 }]], 'several: a centre only');
  // Every style the lab draws exists, M3's among them.
  const kinds: HandleKind[] = ['center', 'anchor', 'start', 'ctrl', 'bend', 'rot', 'scale'];
  assert.equal(new Set(kinds).size, 7);
});

test('a press takes the nearest handle within 26 px, the one drawn last on a tie; the ring is magnetic to 15°, the diamond steps 0.05 from 0.2 to 4', () => {
  const hs = [{ id: 'a', at: { x: 0, y: 0 } }, { id: 'b', at: { x: 30, y: 0 } }, { id: 'c', at: { x: 30, y: 0 } }];
  assert.equal(pickHandle(hs, { x: 10, y: 0 })?.id, 'a', 'the nearest');
  assert.equal(pickHandle(hs, { x: 20, y: 0 })?.id, 'c', 'a tie: the one drawn last');
  assert.equal(pickHandle(hs, { x: 0, y: 26 })?.id, 'a', '26 px is within');
  assert.equal(pickHandle(hs, { x: 0, y: -26.5 }), null, 'beyond 26 px, none');
  assert.equal(HANDLE_PICK_PX, 26);
  assert.deepEqual([47, 49, 41, 40, 181.4, -2, 7, 8].map(magneticAngle), [45, 45, 45, 40, 180, 0, 7, 8]);
  assert.deepEqual([2, 2.02, 2.03, 0.1, 5, 1.234].map(scaleStep), [2, 2, 2.05, 0.2, 4, 1.25]);
});

test('a transformed element’s local grid: lines every 1-2-5 step of its own units through its CTM, over its box grown by one step, and its axes from its origin', () => {
  const box = { x: -18, y: -22, width: 36, height: 38 }; // lab/transform.svg's house
  const g = localGridModel(box, [4, 0, 0, 4, 200, 200]); // translate(50 50), 4 px a unit
  assert.equal(g.step, 5, '5 units are 20 px (2 would be 8, under 12)');
  const xs = g.lines.filter((l) => l.from.x === l.to.x).map((l) => l.from.x);
  assert.ok(xs.includes(240), 'a line through local (10, 0)');
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [100, 300], 'from −25 to 25: the box grown by one step');
  assert.deepEqual(g.axes.map((a) => a.from), [{ x: 200, y: 200 }, { x: 200, y: 200 }], 'the axes start at the local origin');
  assert.deepEqual(g.labels.map((l) => l.text), ['x', 'y']);
  const turned = localGridModel(box, [0, 4, -4, 0, 200, 200]); // rotate(90) about the origin
  assert.ok(turned.lines.some((l) => Math.abs(l.from.y - 240) < 1e-9 && Math.abs(l.to.y - 240) < 1e-9), 'the grid turns with it: local x = 10 is host y = 240');
});

test('the seven handle styles are SVG Lab’s: its sizes (squares, circles, the diamond, the centre’s dot) and colours, the dragged one yellow', () => {
  assert.deepEqual(HANDLE, {
    anchor: ['square', 5.5, 7], start: ['square', 5.5, 7], ctrl: ['circle', 6, 7.5], bend: ['circle', 4.5, 6.5],
    scale: ['diamond', 6.5, 8], center: ['circle', 8, 9.5], rot: ['circle', 8, 9.5],
  });
  assert.equal(CENTRE_DOT_R, 2.2);
  const css = readFileSync(new URL('../../src/app.css', import.meta.url), 'utf8');
  const rule = (selector: string) => {
    const m = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{ ([^}]*) \\}$`, 'm').exec(css);
    return m && Object.fromEntries(m[1].split(';').map((d) => d.split(':').map((x) => x.trim())).filter(([k]) => k));
  };
  assert.deepEqual(rule('.draw-hd'), { fill: '#fff', stroke: '#00a3e0', 'stroke-width': '2' }, 'white, the lab’s blue stroke 2');
  assert.deepEqual(rule('.draw-hd.start'), { fill: '#00a3e0', stroke: '#fff', 'stroke-width': '1.5' });
  assert.deepEqual(rule('.draw-hd.ctrl'), { fill: '#e6007e', stroke: '#fff', 'stroke-width': '1.5' });
  assert.deepEqual(rule('.draw-hd.bend'), { fill: '#fff', stroke: '#00a3e0', 'stroke-width': '1.5', opacity: '0.8' });
  assert.deepEqual(rule('.draw-hd.rot, .draw-hd.scale'), { stroke: '#e6007e' }, 'the ring and the diamond in the lab’s magenta');
  assert.deepEqual(rule('.draw-hd.on'), { fill: '#ffe600' }, 'the dragged one yellow');
  assert.deepEqual(rule('.draw-hd-dot'), { fill: '#00a3e0' });
});
