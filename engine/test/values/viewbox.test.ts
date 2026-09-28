// engine/values/viewbox: viewBox, preserveAspectRatio, and all 19 viewport transforms.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PAR, parsePar, parseViewBox, viewportTransform, type Align, type Par, type ViewBox } from '../../values/viewbox.ts';
import { apply, type Affine } from '../../values/affine.ts';

test('parseViewBox reads four numbers separated by whitespace and/or commas', () => {
  assert.deepEqual(parseViewBox('0 0 24 24'), { x: 0, y: 0, w: 24, h: 24 });
  assert.deepEqual(parseViewBox('0,0,24,24'), { x: 0, y: 0, w: 24, h: 24 });
  assert.deepEqual(parseViewBox('0, 0, 24, 24'), { x: 0, y: 0, w: 24, h: 24 });
  assert.deepEqual(parseViewBox(' -10 -5\n100.5\t50 '), { x: -10, y: -5, w: 100.5, h: 50 });
  assert.deepEqual(parseViewBox('-10-5 1e2 .5'), { x: -10, y: -5, w: 100, h: 0.5 });
});

test('parseViewBox rejects bad lists and negative sizes', () => {
  for (const s of ['', 'junk', '0 0 24', '0 0 24 24 1', '0 0 -1 24', '0 0 24 -1', '0 0 -1 0', 'a b c d', '0 0 24 24,', ',0 0 24 24', '0 0 24px 24', 'none']) {
    assert.equal(parseViewBox(s), null, JSON.stringify(s));
  }
});

// SVG 2: a negative size invalidates viewBox (render as if absent), but a zero size disables
// rendering, and Chromium draws nothing for viewBox="0 0 0 10". Returning null for both showed it.
test('parseViewBox: a zero width or height disables rendering, unlike an invalid list', () => {
  for (const s of ['0 0 0 24', '0 0 24 0', '0 0 0 0', '5 5 -0 24']) assert.equal(parseViewBox(s), 'disabled', JSON.stringify(s));
});

test('parsePar reads align, meet/slice and the obsolete defer', () => {
  const ok: [string, Par][] = [
    ['xMidYMid meet', { align: 'xMidYMid', meetOrSlice: 'meet' }],
    ['xMinYMax slice', { align: 'xMinYMax', meetOrSlice: 'slice' }],
    ['xMaxYMin', { align: 'xMaxYMin', meetOrSlice: 'meet' }],
    ['none', { align: 'none', meetOrSlice: 'meet' }],
    ['none slice', { align: 'none', meetOrSlice: 'slice' }],
    ['defer xMinYMax slice', { align: 'xMinYMax', meetOrSlice: 'slice' }],
    ['  xMidYMid \t slice\n', { align: 'xMidYMid', meetOrSlice: 'slice' }],
  ];
  for (const [s, want] of ok) assert.deepEqual(parsePar(s), want, JSON.stringify(s));
  for (const s of ['', 'xmidymid', 'XMidYMid', 'xMidYMid meat', 'meet', 'defer', 'deferxMidYMid', 'xMidYMid meet slice', 'xMidYMidmeet', 'xMidYMid, meet']) {
    assert.equal(parsePar(s), null, JSON.stringify(s));
  }
  assert.deepEqual(DEFAULT_PAR, { align: 'xMidYMid', meetOrSlice: 'meet' });
});

// viewBox (10, 20) 100×50 into a 300×300 viewport (scales 3 and 6: meet leaves 150 of vertical
// room, slice overflows 300 horizontally) and a 600×100 one (scales 6 and 2: meet leaves 400 of
// horizontal room, slice overflows 200 vertically). Between them every x and y alignment shows.
const VB: ViewBox = { x: 10, y: 20, w: 100, h: 50 };
const TABLE: [Align, Par['meetOrSlice'], Affine, Affine][] = [
  ['xMinYMin', 'meet', [3, 0, 0, 3, -30, -60], [2, 0, 0, 2, -20, -40]],
  ['xMidYMin', 'meet', [3, 0, 0, 3, -30, -60], [2, 0, 0, 2, 180, -40]],
  ['xMaxYMin', 'meet', [3, 0, 0, 3, -30, -60], [2, 0, 0, 2, 380, -40]],
  ['xMinYMid', 'meet', [3, 0, 0, 3, -30, 15], [2, 0, 0, 2, -20, -40]],
  ['xMidYMid', 'meet', [3, 0, 0, 3, -30, 15], [2, 0, 0, 2, 180, -40]],
  ['xMaxYMid', 'meet', [3, 0, 0, 3, -30, 15], [2, 0, 0, 2, 380, -40]],
  ['xMinYMax', 'meet', [3, 0, 0, 3, -30, 90], [2, 0, 0, 2, -20, -40]],
  ['xMidYMax', 'meet', [3, 0, 0, 3, -30, 90], [2, 0, 0, 2, 180, -40]],
  ['xMaxYMax', 'meet', [3, 0, 0, 3, -30, 90], [2, 0, 0, 2, 380, -40]],
  ['xMinYMin', 'slice', [6, 0, 0, 6, -60, -120], [6, 0, 0, 6, -60, -120]],
  ['xMidYMin', 'slice', [6, 0, 0, 6, -210, -120], [6, 0, 0, 6, -60, -120]],
  ['xMaxYMin', 'slice', [6, 0, 0, 6, -360, -120], [6, 0, 0, 6, -60, -120]],
  ['xMinYMid', 'slice', [6, 0, 0, 6, -60, -120], [6, 0, 0, 6, -60, -220]],
  ['xMidYMid', 'slice', [6, 0, 0, 6, -210, -120], [6, 0, 0, 6, -60, -220]],
  ['xMaxYMid', 'slice', [6, 0, 0, 6, -360, -120], [6, 0, 0, 6, -60, -220]],
  ['xMinYMax', 'slice', [6, 0, 0, 6, -60, -120], [6, 0, 0, 6, -60, -320]],
  ['xMidYMax', 'slice', [6, 0, 0, 6, -210, -120], [6, 0, 0, 6, -60, -320]],
  ['xMaxYMax', 'slice', [6, 0, 0, 6, -360, -120], [6, 0, 0, 6, -60, -320]],
  ['none', 'meet', [3, 0, 0, 6, -30, -120], [6, 0, 0, 2, -60, -40]],
];

test('viewportTransform: all 19 align × meet/slice combinations, numerically', () => {
  assert.equal(TABLE.length, 19);
  assert.equal(new Set(TABLE.map(([a, m]) => `${a} ${m}`)).size, 19);
  for (const [align, meetOrSlice, square, wide] of TABLE) {
    assert.deepEqual(viewportTransform(VB, { align, meetOrSlice }, 300, 300), square, `${align} ${meetOrSlice} 300×300`);
    assert.deepEqual(viewportTransform(VB, { align, meetOrSlice }, 600, 100), wide, `${align} ${meetOrSlice} 600×100`);
  }
  assert.deepEqual(viewportTransform(VB, { align: 'none', meetOrSlice: 'slice' }, 300, 300), [3, 0, 0, 6, -30, -120]);
});

test('viewportTransform: geometry agrees with the table (fit, cover, and the aligned edge)', () => {
  const sizes: [number, number][] = [[300, 300], [600, 100], [37, 91], [1, 1000]];
  for (const [align, mode] of TABLE) {
    if (align === 'none') continue;
    for (const [w, h] of sizes) {
      const m = viewportTransform(VB, { align, meetOrSlice: mode }, w, h);
      const [x0, y0] = apply(m, VB.x, VB.y);
      const [x1, y1] = apply(m, VB.x + VB.w, VB.y + VB.h);
      const eps = 1e-9 * Math.max(w, h);
      assert.ok(Math.abs(m[0] - m[3]) < 1e-12, 'uniform scale');
      if (mode === 'meet') assert.ok(x0 >= -eps && y0 >= -eps && x1 <= w + eps && y1 <= h + eps, 'meet fits inside');
      else assert.ok(x0 <= eps && y0 <= eps && x1 >= w - eps && y1 >= h - eps, 'slice covers');
      const edgeX = align.startsWith('xMin') ? x0 : align.startsWith('xMid') ? (x0 + x1) / 2 : x1;
      const edgeY = align.endsWith('YMin') ? y0 : align.endsWith('YMid') ? (y0 + y1) / 2 : y1;
      const wantX = align.startsWith('xMin') ? 0 : align.startsWith('xMid') ? w / 2 : w;
      const wantY = align.endsWith('YMin') ? 0 : align.endsWith('YMid') ? h / 2 : h;
      assert.ok(Math.abs(edgeX - wantX) < eps && Math.abs(edgeY - wantY) < eps, `${align} ${mode} ${w}×${h}`);
    }
  }
});

test('viewportTransform: a plain icon scale', () => {
  const vb = parseViewBox('0 0 24 24') as ViewBox;
  assert.deepEqual(viewportTransform(vb, DEFAULT_PAR, 48, 48), [2, 0, 0, 2, 0, 0]);
  assert.deepEqual(viewportTransform(vb, parsePar('none')!, 48, 24), [2, 0, 0, 1, 0, 0]);
});
