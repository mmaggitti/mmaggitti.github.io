// A shape's outline as path data (P1-M3 S3): what booleans take in. Each outline is checked where it
// draws (winding samples), not only by its text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, type Doc, type ElementNode } from '../../model/doc.ts';
import { shapeOutline, type Outline } from '../../path/from-shape.ts';
import { insideAt, polygons } from '../../path/winding.ts';
import type { AbsSeg } from '../../path/abs.ts';

const ctx = { viewport: { width: 100, height: 100 }, remPx: 12 };

function outlineOf(markup: string, style = ''): { doc: Doc; o: Outline } {
  const r = parseDoc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${style}${markup}</svg>`);
  assert.ok(r.ok, markup);
  const n = [...descendants(r.doc, r.doc.root)].find((x): x is ElementNode => x.kind === 'element' && x.id !== r.doc.root && x.local !== 'style')!;
  return { doc: r.doc, o: shapeOutline(r.doc, n.id, ctx) };
}
const absOf = (markup: string): { abs: AbsSeg[]; open: boolean } => {
  const { o } = outlineOf(markup);
  assert.ok(!('refused' in o), `${markup}: ${'refused' in o ? o.refused : ''}`);
  return o;
};
const inside = (abs: readonly AbsSeg[], x: number, y: number) => insideAt(abs, x, y, 'nonzero');
/** The shoelace area of the first subpath's flattened outline (positive: clockwise on screen). */
const area = (abs: readonly AbsSeg[]): number => {
  const [p] = polygons(abs);
  let a = 0;
  for (let i = 0; i < p.length; i++) a += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
  return a / 2;
};
const arcs = (abs: readonly AbsSeg[]) => abs.filter((s) => s.type === 'A').map((s) => s.type === 'A' && [s.rx, s.ry]);

test('a rect: its four sides clockwise, and rx and ry as SVG resolves them (a missing one takes the other, each clamped to half its side)', () => {
  const plain = absOf('<rect x="10" y="20" width="30" height="40"/>');
  assert.deepEqual(plain.abs.map((s) => [s.type, s.x, s.y]), [['M', 10, 20], ['L', 40, 20], ['L', 40, 60], ['L', 10, 60], ['Z', 10, 20]]);
  assert.equal(plain.open, false);
  assert.ok(area(plain.abs) > 0, 'clockwise on screen');
  assert.ok(inside(plain.abs, 12, 22) && !inside(plain.abs, 9, 22));

  // rx alone: ry takes it; the corner (10, 20) is cut, a point just inside the curve is not.
  const round = absOf('<rect x="10" y="20" width="30" height="40" rx="8"/>');
  assert.deepEqual(arcs(round.abs), [[8, 8], [8, 8], [8, 8], [8, 8]]);
  assert.ok(!inside(round.abs, 10.5, 20.5), 'the rounded corner is not filled');
  assert.ok(inside(round.abs, 18, 21) && inside(round.abs, 25, 40), 'the rest is');
  assert.ok(area(round.abs) > 0, 'clockwise on screen');

  // Clamped: rx 25 is more than half of 30, ry 50 more than half of 40.
  assert.deepEqual(arcs(absOf('<rect x="10" y="20" width="30" height="40" rx="25" ry="50"/>').abs), [[15, 20], [15, 20], [15, 20], [15, 20]]);
  // ry alone, and auto (SVG 2's default) as if absent.
  assert.deepEqual(arcs(absOf('<rect x="10" y="20" width="30" height="40" ry="6"/>').abs), [[6, 6], [6, 6], [6, 6], [6, 6]]);
  assert.deepEqual(arcs(absOf('<rect x="10" y="20" width="30" height="40" rx="auto" ry="6"/>').abs), [[6, 6], [6, 6], [6, 6], [6, 6]]);
  // A zero size has no outline.
  assert.deepEqual(absOf('<rect x="10" y="20" width="0" height="40" rx="3"/>').abs, []);
});

test('a circle and an ellipse: four quarter arcs clockwise from the right, an ellipse’s missing radius taking the other', () => {
  const c = absOf('<circle cx="50" cy="50" r="20"/>');
  assert.deepEqual(c.abs.map((s) => [s.type, s.x, s.y]), [['M', 70, 50], ['A', 50, 70], ['A', 30, 50], ['A', 50, 30], ['A', 70, 50], ['Z', 70, 50]]);
  assert.ok(area(c.abs) > 0, 'clockwise on screen');
  assert.ok(inside(c.abs, 50 + 19.8 * Math.SQRT1_2, 50 + 19.8 * Math.SQRT1_2) && !inside(c.abs, 50 + 20.2 * Math.SQRT1_2, 50 + 20.2 * Math.SQRT1_2), 'the fill ends at the radius, between the arcs’ ends too');
  const e = absOf('<ellipse cx="50" cy="50" rx="30"/>');
  assert.deepEqual(arcs(e.abs), [[30, 30], [30, 30], [30, 30], [30, 30]]);
  const e2 = absOf('<ellipse cx="50" cy="50" rx="30" ry="10"/>');
  assert.ok(inside(e2.abs, 79, 50) && !inside(e2.abs, 50, 61));
});

test('polygon and polyline points: a polygon closed, a polyline open (its fill closes it); a line open', () => {
  const pg = absOf('<polygon points="10,10 90,10 50,80"/>');
  assert.deepEqual(pg.abs.map((s) => s.type), ['M', 'L', 'L', 'Z']);
  assert.equal(pg.open, false);
  const pl = absOf('<polyline points="10 10, 90 10, 50 80, 99"/>'); // an odd number: the last one dropped, as SVG does
  assert.deepEqual(pl.abs.map((s) => [s.type, s.x, s.y]), [['M', 10, 10], ['L', 90, 10], ['L', 50, 80]]);
  assert.equal(pl.open, true);
  assert.ok(inside(pl.abs, 50, 30), 'the fill closes it');
  const ln = absOf('<line x1="0" y1="0" x2="10" y2="5"/>');
  assert.deepEqual(ln.abs.map((s) => [s.type, s.x, s.y]), [['M', 0, 0], ['L', 10, 5]]);
  assert.equal(ln.open, true);
});

test('a path’s outline is its own d; a d with an error, geometry CSS sets, and anything else are refused, saying why', () => {
  assert.deepEqual(absOf('<path d="M 0 0 h 10 v 10 z"/>').abs.map((s) => [s.type, s.x, s.y]), [['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['Z', 0, 0]]);
  const bad = outlineOf('<path d="M 0 0 L 10 Q"/>').o; // L needs a y; the Q (character 12) is where it goes wrong
  assert.deepEqual(bad, { refused: 'Its path data has an error at character 12.' });
  assert.deepEqual(outlineOf('<rect x="0" y="0" width="10" height="10" style="width: 20px"/>').o, { refused: 'Its width is set by CSS (its style attribute), which wins over the attribute.' });
  assert.deepEqual(outlineOf('<circle cx="0" cy="0" r="10"/>', '<style>circle { r: 5px }</style>').o, { refused: 'Its r is set by CSS (a <style> rule), which wins over the attribute.' });
  assert.deepEqual(outlineOf('<text x="0" y="10">Hi</text>').o, { refused: 'Only shapes have an outline.' });
});
