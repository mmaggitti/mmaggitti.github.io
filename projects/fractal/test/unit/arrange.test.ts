import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBlock, addGroup, closePanel, closeTab, closeCost, move, moveTo, nextBlock, sameLayout, type Payload, type Target } from '../../src/core/arrange.ts';
import { hitTest, zoomTargetAt, EDGE, type Geometry } from '../../src/core/targets.ts';
import { equalize, resizePair } from '../../src/core/resize.ts';
import { recordUndo, undo, redo, EMPTY_UNDO, UNDO_CAP } from '../../src/core/undo.ts';
import { solve } from '../../src/core/layout.ts';
import { metrics } from '../../src/core/metrics.ts';
import { defaultLayout } from '../../src/core/defaults.ts';
import { check, indexDoc } from '../../src/core/tree.ts';
import { setFrame } from '../../src/core/ops.ts';
import type { LayoutDoc, Panel, Split } from '../../src/core/types.ts';
import { randomDoc, rng } from './random.ts';

const m = metrics(12);
const PHONE = { w: 440, h: 764 };
const node = (doc: LayoutDoc, id: string) => indexDoc(doc).nodes.get(id);
const panelOf = (doc: LayoutDoc, app: string) => node(doc, indexDoc(doc).panelOf.get(app)!) as Panel;
const parentOf = (doc: LayoutDoc, id: string) => {
  const o = indexDoc(doc).owner.get(id);
  return o?.type === 'split' ? (node(doc, o.id) as Split) : null;
};
const mustMove = (doc: LayoutDoc, p: Payload, t: Target) => {
  const out = move(doc, p, t);
  assert.ok(out, `move ${JSON.stringify(p)} → ${JSON.stringify(t)} was refused`);
  assert.deepEqual(check(out!), []);
  return out!;
};

// ---------------------------------------------------------------- OPS

test('OPS-01 a tab drops into another tab strip at an index, selected there; its old panel keeps the rest', () => {
  const doc = defaultLayout();
  const out = mustMove(doc, { kind: 'tab', app: 'rose' }, { kind: 'tab', panel: 'p-sky', index: 0 });
  assert.deepEqual(panelOf(out, 'rose').tabs, ['rose', 'sky']);
  assert.equal(panelOf(out, 'rose').selected, 'rose');
  assert.deepEqual((node(out, 'p-amber') as Panel).tabs, ['amber']);
});

test('OPS-02 reordering inside one strip uses indices from before the move (tombstones)', () => {
  let doc = defaultLayout();
  doc = mustMove(doc, { kind: 'tab', app: 'sky' }, { kind: 'tab', panel: 'p-amber', index: 2 }); // amber, rose, sky
  assert.deepEqual((node(doc, 'p-amber') as Panel).tabs, ['amber', 'rose', 'sky']);
  // Move "amber" (index 0) to before "sky" (index 2 on screen): it lands between rose and sky.
  const out = mustMove(doc, { kind: 'tab', app: 'amber' }, { kind: 'tab', panel: 'p-amber', index: 2 });
  assert.deepEqual((node(out, 'p-amber') as Panel).tabs, ['rose', 'amber', 'sky']);
});

test('OPS-03 an edge drop splits the target on that side; the same axis as the parent flattens into it', () => {
  const doc = defaultLayout();
  const right = mustMove(doc, { kind: 'tab', app: 'rose' }, { kind: 'edge', node: 'p-sky', side: 'right' });
  const mid = node(right, 'mid') as Split;
  assert.deepEqual(mid.children.map((c) => c.id).slice(0, 1), ['p-sky']);
  assert.equal(mid.children.length, 3, 'flattened into the row');
  assert.deepEqual((mid.children[1] as Panel).tabs, ['rose']);
  const below = mustMove(doc, { kind: 'tab', app: 'rose' }, { kind: 'edge', node: 'p-sky', side: 'bottom' });
  const wrap = parentOf(below, 'p-sky')!;
  assert.equal(wrap.axis, 'y');
  assert.equal(wrap.children[0].id, 'p-sky');
  assert.deepEqual((wrap.children[1] as Panel).tabs, ['rose']);
});

test('OPS-04 a seam drop inserts a new child there', () => {
  const doc = defaultLayout();
  const out = mustMove(doc, { kind: 'tab', app: 'teal' }, { kind: 'seam', split: 'root', index: 1 });
  const root = out.root as Split;
  assert.equal(root.children.length, 4);
  assert.deepEqual((root.children[1] as Panel).tabs, ['teal']);
  assert.ok(Math.abs(root.weights.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('OPS-05 a whole panel keeps its id and tabs; a group carries its dock', () => {
  const doc = defaultLayout();
  const out = mustMove(doc, { kind: 'panel', panel: 'p-amber' }, { kind: 'edge', node: 'p-violet', side: 'left' });
  const p = node(out, 'p-amber') as Panel;
  assert.deepEqual(p.tabs, ['amber', 'rose']);
  assert.equal(parentOf(out, 'p-amber')!.children[1].id, 'p-violet');
  const g = mustMove(doc, { kind: 'panel', panel: 'p-group-b' }, { kind: 'edge', node: 'p-violet', side: 'right' });
  assert.equal(g.apps['group-b'].dock, doc.apps['group-b'].dock, 'the dock moved with its group, untouched');
  assert.equal(indexDoc(g).depth.get('p-teal'), 1, 'one host above Teal now, not two');
});

test('OPS-06 nothing drops into its own dock; dropping onto itself changes nothing', () => {
  const doc = defaultLayout();
  assert.equal(move(doc, { kind: 'panel', panel: 'p-group-a' }, { kind: 'edge', node: 'p-teal', side: 'left' }), null);
  assert.equal(move(doc, { kind: 'tab', app: 'group-a' }, { kind: 'tab', panel: 'p-coral', index: 0 }), null);
  assert.equal(move(doc, { kind: 'tab', app: 'group-b' }, { kind: 'seam', split: 'b-row', index: 1 }), null);
  assert.equal(move(doc, { kind: 'panel', panel: 'p-sky' }, { kind: 'edge', node: 'p-sky', side: 'left' }), doc);
  assert.equal(move(doc, { kind: 'tab', app: 'sky' }, { kind: 'edge', node: 'p-sky', side: 'right' }), doc);
  assert.equal(move(doc, { kind: 'panel', panel: 'p-sky' }, { kind: 'seam', split: 'mid', index: 1 }), doc, 'its own seam');
  assert.equal(move(doc, { kind: 'tab', app: 'nope' }, { kind: 'tab', panel: 'p-sky', index: 0 }), null);
  assert.equal(move(doc, { kind: 'tab', app: 'sky' }, { kind: 'tab', panel: 'p-amber', index: 9 }), null);
});

test('OPS-07 an empty dock takes a drop; a group emptied by a move keeps an empty dock', () => {
  let doc = mustMove(defaultLayout(), { kind: 'panel', panel: 'p-teal' }, { kind: 'edge', node: 'p-violet', side: 'right' });
  doc = mustMove(doc, { kind: 'panel', panel: 'p-indigo' }, { kind: 'edge', node: 'p-violet', side: 'right' });
  assert.equal(doc.apps['group-b'].dock, null);
  const out = mustMove(doc, { kind: 'tab', app: 'rose' }, { kind: 'dock', host: 'group-b' });
  assert.deepEqual((out.apps['group-b'].dock as Panel).tabs, ['rose']);
  assert.equal(move(out, { kind: 'tab', app: 'sky' }, { kind: 'dock', host: 'group-b' }), null, 'only an empty dock');
});

test('OPS-08 close is recursive; closeCost counts what a group takes with it', () => {
  const doc = defaultLayout();
  assert.equal(closeCost(doc, { kind: 'tab', app: 'group-b' }), 2);
  assert.equal(closeCost(doc, { kind: 'panel', panel: 'p-amber' }), 0);
  const out = closeTab(doc, 'group-a')!;
  assert.deepEqual(check(out), []);
  for (const a of ['group-a', 'group-b', 'teal', 'indigo', 'coral', 'lime']) assert.ok(!out.apps[a], `${a} is gone`);
  assert.ok(out.apps.sky);
  const p = closePanel(doc, 'p-amber')!;
  assert.ok(!p.apps.amber && !p.apps.rose);
  assert.deepEqual(check(p), []);
  let all: LayoutDoc | null = doc;
  for (const id of ['p-group-a', 'p-sky', 'p-amber', 'p-violet']) all = closePanel(all!, id);
  assert.equal(all!.root, null);
  assert.deepEqual(Object.keys(all!.apps), []);
});

test('OPS-09 the frame survives a move, or follows its apps when its node is gone', () => {
  let doc = setFrame(defaultLayout(), 'p-sky');
  const kept = mustMove(doc, { kind: 'tab', app: 'rose' }, { kind: 'edge', node: 'p-violet', side: 'right' });
  assert.equal(kept.nav.frame, 'p-sky');
  doc = setFrame(defaultLayout(), 'b-row');
  assert.equal(doc.nav.frame, 'p-group-b');
  const moved = mustMove(doc, { kind: 'panel', panel: 'p-group-b' }, { kind: 'edge', node: 'p-violet', side: 'right' });
  assert.equal(moved.nav.frame, 'p-group-b', 'the panel kept its id');
  const closed = closeTab(setFrame(defaultLayout(), 'p-amber'), 'amber')!;
  assert.equal(closed.nav.frame, 'p-amber', 'Rose is still there');
});

test('OPS-10 add block and group: next colour, fresh ids, valid documents; the empty root takes one', () => {
  const doc = defaultLayout();
  assert.equal(nextBlock(doc).title, 'Orange', 'the first unused palette colour');
  const b = addBlock(doc, { kind: 'edge', node: 'p-sky', side: 'bottom' })!;
  assert.deepEqual(check(b.doc), []);
  assert.equal(b.doc.apps[b.app].kind, 'block');
  assert.equal(b.doc.apps[b.app].title, 'Orange');
  const g = addGroup(b.doc, { kind: 'tab', panel: 'p-violet', index: 1 })!;
  assert.equal(g.doc.apps[g.app].title, 'Group C');
  assert.equal(g.doc.apps[g.app].dock, null);
  assert.deepEqual(check(g.doc), []);
  const empty: LayoutDoc = { ...doc, root: null, apps: {} };
  const first = addBlock(empty, { kind: 'dock', host: null })!;
  assert.equal((first.doc.root as Panel).tabs[0], first.app);
  assert.equal(addBlock(doc, { kind: 'dock', host: null }), null, 'only an empty root');
});

test('OPS-11 move to: the top level as a new last row, or into a group', () => {
  const doc = defaultLayout();
  const top = moveTo(doc, { kind: 'tab', app: 'teal' }, null)!;
  const root = top.root as Split;
  assert.deepEqual((root.children.at(-1) as Panel).tabs, ['teal']);
  const into = moveTo(doc, { kind: 'panel', panel: 'p-violet' }, 'group-b')!;
  assert.equal(indexDoc(into).owner.get('p-violet')?.type, 'split');
  assert.equal(indexDoc(into).depth.get('p-violet'), 2);
  assert.equal(moveTo(doc, { kind: 'tab', app: 'group-a' }, 'group-b'), null, 'a cycle');
});

test('OPS-12 random moves always give valid documents and never lose an app', () => {
  const r = rng(11);
  for (let seed = 1; seed <= 80; seed++) {
    let doc = randomDoc(seed);
    for (let k = 0; k < 6; k++) {
      const idx = indexDoc(doc);
      const apps = [...idx.panelOf.keys()];
      const nodes = [...idx.nodes.values()];
      if (!apps.length) break;
      const app = apps[Math.floor(r() * apps.length)];
      const to = nodes[Math.floor(r() * nodes.length)];
      const sides = ['left', 'right', 'top', 'bottom'] as const;
      const t: Target =
        to.kind === 'panel' && r() < 0.4
          ? { kind: 'tab', panel: to.id, index: Math.floor(r() * (to.tabs.length + 1)) }
          : { kind: 'edge', node: to.id, side: sides[Math.floor(r() * 4)] };
      const p: Payload = r() < 0.5 ? { kind: 'tab', app } : { kind: 'panel', panel: idx.panelOf.get(app)! };
      const out = move(doc, p, t, idx);
      if (!out) continue;
      assert.deepEqual(check(out), [], `seed ${seed} step ${k}`);
      assert.deepEqual(Object.keys(out.apps).sort(), Object.keys(doc.apps).sort());
      doc = out;
    }
  }
});

// ---------------------------------------------------------------- DROP

function geo(doc: LayoutDoc, frame: string | null = null): Geometry {
  const idx = indexDoc(doc);
  return { rest: solve(doc, frame, PHONE, m, idx), doc, idx, remPx: 12 };
}
const centreOf = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

test('DROP-01 over a tab strip: a tab at the index under the point, with a caret', () => {
  const g = geo(defaultLayout(), 'p-amber');
  const p = g.rest.panels.get('p-amber')!;
  const left = hitTest(g, { x: p.tabbar.x + 5, y: p.tabbar.y + 10 }, { kind: 'tab', app: 'sky' });
  assert.deepEqual(left?.target, { kind: 'tab', panel: 'p-amber', index: 0 });
  assert.equal(left?.style, 'caret');
  const right = hitTest(g, { x: p.tabbar.x + p.tabbar.w - 5, y: p.tabbar.y + 10 }, { kind: 'tab', app: 'sky' });
  assert.deepEqual(right?.target, { kind: 'tab', panel: 'p-amber', index: 2 });
  // Measured edges win over equal shares.
  const g2 = { ...g, tabEdges: () => [0, 60, 120] };
  assert.deepEqual(hitTest(g2, { x: 100, y: p.tabbar.y + 10 }, { kind: 'tab', app: 'sky' })?.target, { kind: 'tab', panel: 'p-amber', index: 2 });
});

test('DROP-02 the outer 28% of a panel splits it on that side; the centre adds a tab', () => {
  const g = geo(defaultLayout(), 'p-sky');
  const f = g.rest.panels.get('p-sky')!.frame;
  const pay: Payload = { kind: 'tab', app: 'rose' };
  const at = (fx: number, fy: number) => hitTest(g, { x: f.x + fx * f.w, y: f.y + fy * f.h }, pay);
  assert.deepEqual(at(0.1, 0.5)?.target, { kind: 'edge', node: 'p-sky', side: 'left' });
  assert.deepEqual(at(0.9, 0.5)?.target, { kind: 'edge', node: 'p-sky', side: 'right' });
  assert.deepEqual(at(0.5, 0.9)?.target, { kind: 'edge', node: 'p-sky', side: 'bottom' });
  assert.deepEqual(at(EDGE + 0.02, 0.5)?.target, { kind: 'tab', panel: 'p-sky', index: 1 });
  const r = at(0.9, 0.5)!.rect;
  assert.ok(Math.abs(r.x - (f.x + f.w / 2)) < 0.5 && Math.abs(r.w - f.w / 2) < 0.5, 'the outline is the right half');
});

test('DROP-03 near a seam, a new child goes between; the seam beats the panels beside it', () => {
  const g = geo(defaultLayout());
  const s = g.rest.splits.get('mid')!;
  const sm = s.seams[0];
  const hit = hitTest(g, { x: sm.x + sm.w / 2 + 4, y: sm.y + sm.h / 2 }, { kind: 'tab', app: 'violet' });
  assert.deepEqual(hit?.target, { kind: 'seam', split: 'mid', index: 1 });
  assert.equal(hit?.style, 'bar');
  const far = hitTest(g, { x: sm.x + sm.w / 2 + 20, y: sm.y + sm.h / 2 }, { kind: 'tab', app: 'violet' });
  assert.equal(far?.target.kind, 'edge');
});

test('DROP-04 the pager the framing makes has no seam targets', () => {
  const g = geo(defaultLayout(), 'p-sky');
  assert.equal(g.rest.splits.get('mid')!.pinned, true);
  const sm = g.rest.splits.get('mid')!.seams[0];
  const hit = hitTest(g, { x: sm.x - 2, y: sm.y + 200 }, { kind: 'tab', app: 'violet' });
  assert.notEqual(hit?.target.kind, 'seam');
});

test('DROP-05 refused drops are never offered: its own dock, itself', () => {
  const g = geo(defaultLayout(), 'p-group-a');
  const teal = g.rest.panels.get('p-teal')!;
  assert.equal(hitTest(g, centreOf(teal.body), { kind: 'panel', panel: 'p-group-a' }), null);
  assert.equal(hitTest(g, centreOf(teal.body), { kind: 'panel', panel: 'p-teal' }), null);
});

test('DROP-06 an empty dock takes a drop; a miniature takes only edges, and its centre zooms', () => {
  let doc = mustMove(defaultLayout(), { kind: 'panel', panel: 'p-teal' }, { kind: 'edge', node: 'p-violet', side: 'right' });
  doc = mustMove(doc, { kind: 'panel', panel: 'p-indigo' }, { kind: 'edge', node: 'p-violet', side: 'right' });
  const g = geo(doc, 'p-group-b');
  const dock = g.rest.apps.get('group-b')!.dock!;
  const hit = hitTest(g, centreOf(dock), { kind: 'tab', app: 'sky' });
  assert.deepEqual(hit?.target, { kind: 'dock', host: 'group-b' });
  // A miniature: Group A's panels drawn small at a short, wide viewport.
  const idx = indexDoc(defaultLayout());
  const tiny: Geometry = { doc: defaultLayout(), idx, remPx: 12, rest: solve(defaultLayout(), null, { w: 300, h: 260 }, m, idx) };
  const teal = tiny.rest.panels.get('p-teal')!;
  assert.ok(teal.s < 0.999, 'Teal is a miniature here');
  assert.equal(hitTest(tiny, centreOf(teal.frame), { kind: 'tab', app: 'sky' }), null);
  assert.equal(zoomTargetAt(tiny, centreOf(teal.frame)), 'p-teal');
  const band = geo(defaultLayout()).rest.apps.get('group-a')!.surface;
  assert.equal(zoomTargetAt(geo(defaultLayout()), centreOf(band)), 'p-group-a');
});

// ---------------------------------------------------------------- RESIZE

test('RESIZE-01 a divider moves the pair by the dragged amount, keeps their total, and stops at minimums', () => {
  const doc = defaultLayout();
  const idx = indexDoc(doc);
  const rest = solve(doc, null, PHONE, m, idx);
  const out = resizePair(doc, idx, rest, m, 'mid', 0, 40);
  const after = solve(out, null, PHONE, m);
  const w0 = rest.nodes.get('p-sky')!.w;
  assert.ok(Math.abs(after.nodes.get('p-sky')!.w - (w0 + 40)) < 0.5);
  assert.ok(Math.abs(after.nodes.get('p-amber')!.w - (rest.nodes.get('p-amber')!.w - 40)) < 0.5);
  assert.deepEqual(after.nodes.get('p-violet'), rest.nodes.get('p-violet'), 'the other axis is untouched');
  const far = solve(resizePair(doc, idx, rest, m, 'mid', 0, 2000), null, PHONE, m);
  assert.ok(Math.abs(far.nodes.get('p-amber')!.w - m.panelMin.w) < 0.5, 'Amber stops at its minimum');
  const w = (node(out, 'mid') as Split).weights;
  assert.ok(Math.abs(w[0] + w[1] - 1) < 1e-9);
});

test('RESIZE-02 equalize evens the pair; a no-op returns the same document', () => {
  const doc = defaultLayout();
  const idx = indexDoc(doc);
  const rest = solve(doc, null, PHONE, m, idx);
  const moved = resizePair(doc, idx, rest, m, 'root', 0, -60);
  const even = equalize(moved, indexDoc(moved), 'root', 0);
  const w = (even.root as Split).weights;
  assert.ok(Math.abs(w[0] - w[1]) < 1e-9);
  assert.equal(equalize(even, indexDoc(even), 'root', 0), even);
  assert.equal(resizePair(doc, idx, rest, m, 'mid', 5, 10), doc, 'no such seam');
});

// ---------------------------------------------------------------- UNDO

test('UNDO-01 undo and redo walk arrangements; a new change drops redo; navigation is kept', () => {
  const a = defaultLayout();
  const b = mustMove(a, { kind: 'tab', app: 'rose' }, { kind: 'edge', node: 'p-sky', side: 'right' });
  let u = recordUndo(EMPTY_UNDO, a);
  const framed = setFrame(b, 'p-violet');
  const back = undo(u, framed)!;
  assert.ok(sameLayout(back.doc, a, true));
  assert.equal(back.doc.nav.frame, 'p-violet', 'the frame stays');
  const fwd = redo(back.stack, back.doc)!;
  assert.ok(sameLayout(fwd.doc, b, true));
  assert.equal(redo(fwd.stack, fwd.doc), null);
  u = recordUndo(back.stack, back.doc);
  assert.equal(u.future.length, 0);
  assert.equal(undo(EMPTY_UNDO, a), null);
});

test('UNDO-02 the stack keeps the last 100 entries', () => {
  let u = EMPTY_UNDO;
  const doc = defaultLayout();
  for (let i = 0; i < UNDO_CAP + 20; i++) u = recordUndo(u, doc);
  assert.equal(u.past.length, UNDO_CAP);
});

