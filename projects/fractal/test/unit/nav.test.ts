import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLayout } from '../../src/core/defaults.ts';
import { indexDoc, check, normalize, normalizeDoc } from '../../src/core/tree.ts';
import { crumbs, neighbours, parentFrame, framePath } from '../../src/core/nav.ts';
import { resolveFrame } from '../../src/core/layout.ts';
import { setFrame, goHistory, toggleOverview } from '../../src/core/ops.ts';
import { record, resolveVisit, HISTORY_CAP } from '../../src/core/history.ts';
import { sanitize } from '../../src/core/sanitize.ts';
import type { LayoutDoc, NavState, Node } from '../../src/core/types.ts';
import { randomDoc, rng } from './random.ts';

test('NAV-01 a dock\'s root split frames its host panel; the root split frames the overview', () => {
  const doc = defaultLayout();
  const idx = indexDoc(doc);
  assert.equal(resolveFrame(doc, idx, 'b-row'), 'p-group-b');
  assert.equal(resolveFrame(doc, idx, 'root'), null);
  assert.equal(resolveFrame(doc, idx, 'nope'), null);
});

test('NAV-02 stepping out goes one level at a time, through host panels, to the overview', () => {
  const doc = defaultLayout();
  const idx = indexDoc(doc);
  assert.deepEqual(framePath(doc, idx, 'p-teal'), [null, 'p-group-a', 'p-group-b', 'p-teal']);
  assert.equal(parentFrame(doc, idx, 'p-coral'), 'a-col');
  assert.equal(parentFrame(doc, idx, 'a-col'), 'p-group-a');
  assert.equal(parentFrame(doc, idx, 'p-group-a'), null);
});

test('NAV-03 crumbs name each level by its apps', () => {
  const doc = defaultLayout();
  const c = crumbs(doc, indexDoc(doc), 'p-teal');
  assert.deepEqual(c.map((x) => x.label), ['Home', 'Group A', 'Group B', 'Teal']);
  const mid = crumbs(doc, indexDoc(doc), 'a-col');
  assert.equal(mid.at(-1)!.label, 'Coral · Lime');
});

test('NAV-04 neighbours are the framed node\'s siblings', () => {
  const doc = defaultLayout();
  const idx = indexDoc(doc);
  assert.deepEqual(neighbours(idx, 'p-sky'), { prev: null, next: 'p-amber', index: 0, count: 2 });
  assert.deepEqual(neighbours(idx, 'p-amber'), { prev: 'p-sky', next: null, index: 1, count: 2 });
  assert.equal(neighbours(idx, null).count, 1);
});

test('NAV-05 framing inside an unselected tab selects the tabs on the way', () => {
  let doc = defaultLayout();
  // Put Group B behind another tab of its panel.
  doc = { ...doc, apps: { ...doc.apps, extra: { kind: 'block', params: {} } } };
  doc = { ...doc, apps: { ...doc.apps, 'group-a': { ...doc.apps['group-a'], dock: swapTab(doc.apps['group-a'].dock!, 'p-group-b', 'extra') } } };
  assert.deepEqual(check(doc), []);
  const out = setFrame(doc, 'p-indigo');
  const panel = indexDoc(out).nodes.get('p-group-b');
  assert.equal(panel?.kind === 'panel' && panel.selected, 'group-b');
  assert.equal(out.nav.frame, 'p-indigo');
});

function swapTab(node: Node, panelId: string, extra: string): Node {
  if (node.kind === 'panel') return node.id === panelId ? { ...node, tabs: [...node.tabs, extra], selected: extra } : node;
  return { ...node, children: node.children.map((c) => swapTab(c, panelId, extra)) };
}

test('HISTORY-01 back and forward walk visits; a new visit drops the forward list', () => {
  let doc = defaultLayout();
  doc = setFrame(doc, 'p-group-a');
  doc = setFrame(doc, 'p-group-b');
  doc = setFrame(doc, 'p-teal');
  doc = goHistory(doc, -1);
  assert.equal(doc.nav.frame, 'p-group-b');
  doc = goHistory(doc, -1);
  assert.equal(doc.nav.frame, 'p-group-a');
  doc = goHistory(doc, 1);
  assert.equal(doc.nav.frame, 'p-group-b');
  doc = setFrame(doc, 'p-sky');
  assert.equal(goHistory(doc, 1), doc, 'no forward history after a new visit');
  assert.equal(doc.nav.visits.at(-1)!.node, 'p-sky');
});

test('HISTORY-02 repeats are not recorded, and history is capped', () => {
  let nav: NavState = { frame: null, visits: [], index: -1 };
  nav = record(nav, { node: 'a', apps: ['x'] });
  assert.equal(record(nav, { node: 'a', apps: ['x'] }), nav);
  for (let i = 0; i < 80; i++) nav = record(nav, { node: `n${i}`, apps: [] });
  assert.equal(nav.visits.length, HISTORY_CAP);
  assert.equal(nav.index, HISTORY_CAP - 1);
});

test('HISTORY-03 a visit whose node is gone resolves to the smallest frame holding its apps', () => {
  const doc = defaultLayout();
  const idx = indexDoc(doc);
  assert.equal(resolveVisit(doc, idx, { node: 'gone', apps: ['teal', 'indigo'] }), 'p-group-b');
  assert.equal(resolveVisit(doc, idx, { node: 'gone', apps: ['teal'] }), 'p-teal');
  assert.equal(resolveVisit(doc, idx, { node: 'gone', apps: ['nobody'] }), null);
});

test('HISTORY-04 Overview toggles to the overview and back', () => {
  let doc = setFrame(defaultLayout(), 'p-group-b');
  doc = toggleOverview(doc);
  assert.equal(doc.nav.frame, null);
  doc = toggleOverview(doc);
  assert.equal(doc.nav.frame, 'p-group-b');
});

test('MODEL-01 normalize collapses single children, flattens same-axis splits and keeps identity', () => {
  const p = (id: string): Node => ({ kind: 'panel', id, tabs: [id + 'a'], selected: id + 'a' });
  const nested: Node = {
    kind: 'split', id: 's', axis: 'x', weights: [0.5, 0.5],
    children: [p('a'), { kind: 'split', id: 't', axis: 'x', weights: [0.5, 0.5], children: [p('b'), p('c')] }],
  };
  const flat = normalize(nested);
  assert.ok(flat?.kind === 'split' && flat.children.length === 3);
  assert.deepEqual(flat.kind === 'split' && flat.weights.map((w) => Math.round(w * 100)), [50, 25, 25]);
  assert.equal(normalize(flat), flat);
  const single: Node = { kind: 'split', id: 'u', axis: 'y', weights: [1], children: [p('d')] };
  assert.equal(normalize(single)?.id, 'd');
});

test('MODEL-02 random documents are valid, and normalizing them changes nothing', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const doc = randomDoc(seed);
    assert.deepEqual(check(doc), [], `seed ${seed}`);
    assert.equal(normalizeDoc(doc), doc);
  }
});

test('MODEL-03 sanitize keeps a valid document and survives garbage without throwing', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const doc = setFrame(randomDoc(seed), null);
    const back = sanitize(JSON.parse(JSON.stringify(doc)));
    assert.ok(back);
    assert.deepEqual(check(back!), []);
    assert.deepEqual(back!.root, doc.root);
  }
  const r = rng(7);
  const junk = [null, 1, 'x', [], { schema: 3 }, { schema: 2 }, { schema: 2, apps: [] }, { ...defaultLayout(), schema: 1 }];
  for (const j of junk) assert.equal(sanitize(j), null);
  for (let seed = 1; seed <= 300; seed++) {
    const doc = JSON.parse(JSON.stringify(randomDoc(seed))) as LayoutDoc;
    mutate(doc, r);
    const out = sanitize(doc);
    if (out) assert.deepEqual(check(out), [], `mutated seed ${seed}`);
  }
});

test('MODEL-04 sanitize drops an app placed inside its own dock, and follow cycles', () => {
  const doc: LayoutDoc = {
    schema: 2,
    root: { kind: 'panel', id: 'p', tabs: ['h'], selected: 'h' },
    apps: {
      h: { kind: 'container', params: {}, dock: { kind: 'panel', id: 'q', tabs: ['h', 'x'], selected: 'h' }, follows: 'x' },
      x: { kind: 'block', params: {}, follows: 'h' },
    },
    nav: { frame: null, visits: [], index: -1 },
  };
  const out = sanitize(doc)!;
  assert.deepEqual(check(out), []);
  const q = indexDoc(out).nodes.get('q');
  assert.deepEqual(q?.kind === 'panel' && q.tabs, ['x']);
  assert.ok(!(out.apps.h.follows && out.apps.x.follows), 'the follow cycle is broken');
});

// Damage a document at random: delete apps, duplicate tabs, break weights, inject cycles.
function mutate(doc: LayoutDoc, r: () => number) {
  const ids = Object.keys(doc.apps);
  const pick = () => ids[Math.floor(r() * ids.length)];
  const nodes: Node[] = [];
  const walk = (n: Node | null | undefined) => {
    if (!n) return;
    nodes.push(n);
    if (n.kind === 'split') n.children.forEach(walk);
    else n.tabs.forEach((t) => walk(doc.apps[t]?.dock));
  };
  walk(doc.root);
  for (let i = 0; i < 3; i++) {
    const n = nodes[Math.floor(r() * nodes.length)];
    const roll = r();
    if (roll < 0.2) delete doc.apps[pick()];
    else if (roll < 0.4 && n.kind === 'panel') n.tabs.push(pick());
    else if (roll < 0.55 && n.kind === 'split') n.weights[0] = -1;
    else if (roll < 0.7) (doc.apps[pick()] ?? {}).follows = pick();
    else if (roll < 0.85) {
      const host = Object.values(doc.apps).find((a) => a.kind === 'container');
      if (host && doc.root) host.dock = doc.root;
    } else if (n.kind === 'split') (n as { axis: string }).axis = 'z';
  }
}
