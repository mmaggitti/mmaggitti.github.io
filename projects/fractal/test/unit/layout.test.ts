import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, distribute, type Box, type RestLayout } from '../../src/core/layout.ts';
import { metrics } from '../../src/core/metrics.ts';
import { defaultLayout } from '../../src/core/defaults.ts';
import { indexDoc } from '../../src/core/tree.ts';
import { frames } from '../../src/core/nav.ts';
import { kindOf } from '../../src/core/kinds.ts';
import type { LayoutDoc, Node } from '../../src/core/types.ts';
import { randomDoc } from './random.ts';

const m = metrics(12);
const PHONE = { w: 440, h: 764 };
const near = (a: number, b: number, eps = 0.5) => Math.abs(a - b) <= eps;
const sameBox = (a: Box, b: Box, eps = 0.5) => near(a.x, b.x, eps) && near(a.y, b.y, eps) && near(a.w, b.w, eps) && near(a.h, b.h, eps);
const inside = (a: Box, b: Box, eps = 0.5) => a.x >= b.x - eps && a.y >= b.y - eps && a.x + a.w <= b.x + b.w + eps && a.y + a.h <= b.y + b.h + eps;

function framedBox(l: RestLayout): Box | undefined {
  return l.frame === null ? undefined : l.nodes.get(l.frame);
}

test('LAYOUT-01 the framed node fills the viewport, for every frame of many random trees', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const doc = randomDoc(seed);
    const idx = indexDoc(doc);
    for (const vp of [PHONE, { w: 956, h: 400 }]) {
      for (const f of frames(doc, idx)) {
        const l = solve(doc, f, vp, m, idx);
        const box = framedBox(l);
        assert.ok(box, `seed ${seed} frame ${f} has a box`);
        assert.ok(sameBox(box!, { x: 0, y: 0, w: vp.w, h: vp.h }), `seed ${seed} frame ${f}: ${JSON.stringify(box)}`);
      }
    }
  }
});

test('LAYOUT-02 the framed node\'s siblings become viewport-sized pages, in order, a gap apart', () => {
  const doc = defaultLayout();
  const l = solve(doc, 'p-sky', PHONE, m);
  const sky = l.nodes.get('p-sky')!;
  const amber = l.nodes.get('p-amber')!;
  assert.ok(sameBox(sky, { x: 0, y: 0, ...PHONE }));
  assert.ok(sameBox(amber, { x: PHONE.w + m.gap, y: 0, ...PHONE }));
  assert.equal(l.splits.get('mid')!.pager, true);
});

test('LAYOUT-03 tab bars are 44px and a host band is exactly its rem size at full scale', () => {
  const doc = defaultLayout();
  const l = solve(doc, 'p-group-b', PHONE, m);
  const p = l.panels.get('p-group-b')!;
  assert.equal(p.s, 1);
  assert.equal(p.tabbar.h, 44);
  const groupB = l.apps.get('group-b')!;
  assert.equal(groupB.surface.h, kindOf('container').bandRem * 12);
});

test('LAYOUT-04 children tile their parent and stay inside their host\'s dock area', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const doc = randomDoc(seed);
    const l = solve(doc, null, PHONE, m);
    for (const app of l.apps.values()) {
      if (!app.dock) continue;
      const dock = doc.apps[app.id].dock;
      if (!dock) continue;
      const inner = l.nodes.get(dock.id)!;
      assert.ok(sameBox(inner, app.dock), `seed ${seed}: dock root fills the dock area`);
    }
    for (const sp of l.splits.values()) {
      const node = indexDoc(doc).nodes.get(sp.id) as Extract<Node, { kind: 'split' }>;
      for (const c of node.children) assert.ok(inside(l.nodes.get(c.id)!, sp.box), `seed ${seed}: ${c.id} inside ${sp.id}`);
    }
  }
});

test('LAYOUT-05 a framed node inside a host sits in the dock, with the band and tab bar above the screen', () => {
  const doc = defaultLayout();
  const l = solve(doc, 'p-teal', PHONE, m);
  const groupB = l.apps.get('group-b')!;
  assert.ok(groupB.surface.y + groupB.surface.h <= 0.5, 'the band is above the viewport');
  assert.ok(inside(l.nodes.get('p-teal')!, groupB.dock!));
});

test('LAYOUT-06 cramped groups draw smaller, and scales multiply down the levels', () => {
  const doc = defaultLayout();
  // At phone size the minimums fit: chrome stays true size and only content draws scaled.
  const phone = solve(doc, null, PHONE, m);
  assert.equal(phone.panels.get('p-teal')!.s, 1);
  assert.ok(phone.apps.get('teal')!.content.scale < 1, 'deep content is a miniature at the overview');
  // In a tiny viewport they don't: the groups scale, and nested scales multiply.
  const tiny = solve(doc, null, { w: 200, h: 260 }, m);
  const outer = tiny.panels.get('p-group-a')!.s;
  const inner = tiny.panels.get('p-teal')!.s;
  assert.ok(outer < 1 && inner < 1, `outer ${outer} inner ${inner}`);
  assert.ok(inner <= outer + 1e-9);
});

test('LAYOUT-07 tabs that are not selected get no boxes, nor do their docks', () => {
  const doc = defaultLayout();
  const l = solve(doc, null, PHONE, m);
  assert.ok(l.apps.has('amber'));
  assert.ok(!l.apps.has('rose'));
});

test('LAYOUT-08 the solve is deterministic and never changes the document', () => {
  const doc = defaultLayout();
  const before = JSON.stringify(doc);
  const a = solve(doc, 'p-group-b', PHONE, m);
  const b = solve(doc, 'p-group-b', PHONE, m);
  assert.deepEqual([...a.nodes], [...b.nodes]);
  assert.equal(JSON.stringify(doc), before);
});

test('LAYOUT-09 framing a sibling is a pure translation of everything', () => {
  const doc = defaultLayout();
  const a = solve(doc, 'p-sky', PHONE, m);
  const b = solve(doc, 'p-amber', PHONE, m);
  const dx = a.nodes.get('p-sky')!.x - b.nodes.get('p-sky')!.x;
  for (const [id, box] of a.nodes) {
    const other = b.nodes.get(id)!;
    assert.ok(near(box.x - other.x, dx) && near(box.y, other.y) && near(box.w, other.w) && near(box.h, other.h), id);
  }
});

test('LAYOUT-10 content smaller than its comfortable size lays out at that size and draws scaled', () => {
  const doc = defaultLayout();
  const l = solve(doc, null, PHONE, m);
  for (const app of l.apps.values()) {
    const s = app.content.scale;
    assert.ok(near(app.content.w * s, app.surface.w, 0.01) && near(app.content.h * s, app.surface.h, 0.01), app.id);
  }
});

test('LAYOUT-11 distribute shares by weight, never below a minimum', () => {
  assert.deepEqual(distribute(100, [0.5, 0.5], [10, 10]), [50, 50]);
  const out = distribute(100, [0.9, 0.1], [10, 30]);
  assert.deepEqual(out, [70, 30]);
  const tight = distribute(30, [0.5, 0.5], [20, 20]);
  assert.ok(near(tight[0] + tight[1], 30, 1e-9));
});

test('LAYOUT-12 an empty document lays out nothing', () => {
  const doc: LayoutDoc = { schema: 2, root: null, apps: {}, nav: { frame: null, visits: [], index: -1 } };
  assert.equal(solve(doc, null, PHONE, m).nodes.size, 0);
});
