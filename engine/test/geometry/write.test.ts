// engine/geometry/write: the write policy (decision 8). Geometry first, every number rewritten in
// place, lists never collapsed, units kept, CSS respected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { attrValue, descendants, el, parseDoc, serialize, type Doc, type ElementNode, type NodeId } from '../../model/doc.ts';
import { Session } from '../../commands/session.ts';
import { invert, apply as applyM } from '../../values/affine.ts';
import { parseTransform } from '../../values/transform.ts';
import { parsePath } from '../../path/parse.ts';
import { applyPlan, planMove, planResize, planRotate, planScale, type Plan, type WriteOpts } from '../../geometry/write.ts';
import { listMatrix, placement, type GeoContext } from '../../geometry/ctm.ts';
import { localBounds, mapRect, rootBounds } from '../../geometry/bounds.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.doc;
};
const byId = (doc: Doc, id: string): NodeId => ([...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === id)) as ElementNode).id;
const CTX: GeoContext = { viewport: { width: 440, height: 528 }, remPx: 12 };
const OPTS: WriteOpts = { ctx: CTX };
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">\n${body}\n</svg>\n`;

/** Apply a plan in one transaction; the plan must not be a refusal. */
function run(doc: Doc, plan: Plan): string {
  assert.ok(!('refused' in plan), 'refused' in plan ? plan.refused : '');
  new Session(doc).dispatch('test', (apply) => applyPlan(doc, plan as { edits: [] }, apply));
  return serialize(doc);
}
const refusal = (plan: Plan): string => ('refused' in plan ? plan.refused : `not refused: ${JSON.stringify(plan)}`);

const CORPUS = new URL('../fixtures/corpus/', import.meta.url);
const FILES = readdirSync(CORPUS, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.svg')).sort();
const SOURCES = FILES.map((f) => [f, readFileSync(new URL(f, CORPUS), 'utf8')] as const);

test('per element, a move writes exactly the attributes in the table and changes no other byte', () => {
  const cases: [string, string, string][] = [
    ['<rect id="e" x="10" y="20" width="5" height="5"/>', '<rect id="e" x="13" y="18" width="5" height="5"/>', 'rect: x and y'],
    ['<image id="e" x="1.5" width="5" height="5"/>', '<image id="e" x="4.5" width="5" height="5" y="-2"/>', 'image: an absent y is added last'],
    ['<foreignObject id="e" x="0" y="0" width="5" height="5"/>', '<foreignObject id="e" x="3" y="-2" width="5" height="5"/>', 'foreignObject'],
    ['<use id="e" href="#x" x="1" y="1"/>', '<use id="e" href="#x" x="4" y="-1"/>', 'use: x and y'],
    ['<svg id="e" x="5" y="5" width="10" height="10"/>', '<svg id="e" x="8" y="3" width="10" height="10"/>', 'a nested svg: x and y'],
    ['<circle id="e" cx="50" cy="50" r="4"/>', '<circle id="e" cx="53" cy="48" r="4"/>', 'circle: cx and cy'],
    ['<ellipse id="e" cx="50" cy="50" rx="4" ry="2"/>', '<ellipse id="e" cx="53" cy="48" rx="4" ry="2"/>', 'ellipse'],
    ['<line id="e" x1="0" y1="0" x2="10" y2="10"/>', '<line id="e" x1="3" y1="-2" x2="13" y2="8"/>', 'line: both ends'],
    ['<polyline id="e" points="0,0 10,10\n  20,0"/>', '<polyline id="e" points="3,-2 13,8\n  23,-2"/>', 'polyline: every point, separators kept'],
    ['<path id="e" d="M10 10 l5 5 L 20,20 H30 v5 C1 2 3 4 5 6 A5 5 0 0 1 40 40 z m1 1"/>', '<path id="e" d="M13 8 l5 5 L 23,18 H33 v5 C4 0 6 2 8 4 A5 5 0 0 1 43 38 z m1 1"/>', 'path: absolute coordinates only'],
    ['<path id="e" d="m10 10 5 5"/>', '<path id="e" d="m13 8 5 5"/>', 'path: the first m is absolute, its implicit l is not'],
    ['<g id="e" transform="translate(5 5) rotate(10)"/>', '<g id="e" transform="translate(8 3) rotate(10)"/>', 'g: the leading translate'],
    ['<g id="e" transform="rotate(10)"/>', '<g id="e" transform="translate(3 -2) rotate(10)"/>', 'g: a translate is prepended'],
    ['<g id="e"/>', '<g id="e" transform="translate(3 -2)"/>', 'g: a transform is added'],
    ['<text id="e" x="1 2 3" y="4">Hi</text>', '<text id="e" x="1 2 3" y="4" transform="translate(3 -2)">Hi</text>', 'text moves by translate, its x list untouched'],
    ['<g id="e" transform="translate(5)"/>', '<g id="e" transform="translate(8 -2)"/>', 'translate(tx) gains its y'],
  ];
  for (const [was, want, what] of cases) {
    const src = svg(`<g id="keep" fill="red"/>${was}<rect id="also" x="1"/>`);
    const doc = load(src);
    assert.equal(run(doc, planMove(doc, byId(doc, 'e'), 3, -2, OPTS)), src.replace(was, want), what);
  }
  const doc = load(svg('<rect id="e"/>'));
  assert.equal(refusal(planMove(doc, doc.root, 1, 1, OPTS)), 'The artboard doesn’t move; pan the view instead.');
});

test('a path move leaves relative commands byte for byte, over every corpus path, and moves each absolute coordinate by exactly (dx, dy)', () => {
  let paths = 0;
  let absolute = 0;
  for (const [f, src] of SOURCES) {
    const doc = load(src);
    for (const n of [...descendants(doc, doc.root)]) {
      if (n.kind !== 'element' || n.local !== 'path' || attrValue(doc, n, null, 'd') === null) continue;
      const plan = planMove(doc, n.id, 7, -3, OPTS);
      if ('refused' in plan) continue;
      const before = parsePath(attrValue(doc, n, null, 'd')!);
      const t = listMatrix(doc, n.id)!;
      const inv = invert([t[0], t[1], t[2], t[3], 0, 0])!;
      const [dx, dy] = applyM(inv, 7, -3);
      const s = new Session(doc);
      s.dispatch('move', (apply) => applyPlan(doc, plan, apply));
      const after = parsePath(attrValue(doc, n, null, 'd')!);
      assert.equal(after.segs.length, before.segs.length, `${f}: segments`);
      before.segs.forEach((seg, i) => {
        const now = after.segs[i];
        const abs = seg.cmd === seg.cmd.toUpperCase() || (i === 0 && seg.cmd === 'm');
        if (!abs) return assert.equal(now.raw, seg.raw, `${f}: relative segment ${i} keeps its bytes`);
        const U = seg.cmd.toUpperCase();
        seg.args.forEach((v, k) => {
          const d = U === 'A' ? (k === 5 ? dx : k === 6 ? dy : 0) : U === 'H' ? dx : U === 'V' ? dy : k % 2 ? dy : dx;
          assert.ok(Math.abs(now.args[k] - (v + d)) < 1e-3 * Math.max(1, Math.abs(v)), `${f}: segment ${i} argument ${k}: ${v} → ${now.args[k]}, not by ${d}`);
          absolute++;
        });
      });
      s.undo();
      assert.equal(serialize(doc), src, `${f}: undo restores the file`);
      paths++;
    }
  }
  assert.ok(paths > 300 && absolute > 3000, `only ${paths} paths, ${absolute} absolute numbers`);
});

test('a transform list is never collapsed: over every corpus transform, moves, turns and scales keep its items, bar one prepended translate or appended rotate', () => {
  let lists = 0;
  for (const [f, src] of SOURCES) {
    const names = (doc: Doc, id: NodeId) => parseTransform(attrValue(doc, el(doc, id), null, 'transform') ?? '')?.items.map((i) => i.fn).join(' ') ?? 'unreadable';
    // NodeIds are new in every parse: find each element again by its place in document order.
    const elements = (doc: Doc) => [...descendants(doc, doc.root)].filter((n): n is ElementNode => n.kind === 'element');
    const doc0 = load(src);
    const places = elements(doc0).flatMap((n, i) => (attrValue(doc0, n, null, 'transform') !== null ? [i] : []));
    for (const at of places) {
      const was = names(doc0, elements(doc0)[at].id);
      if (was === 'unreadable') continue;
      for (const make of [(d: Doc, id: NodeId) => planMove(d, id, 3, 4, OPTS), (d: Doc, id: NodeId) => planRotate(d, id, 33, { ...OPTS, box: { x: 0, y: 0, width: 10, height: 10 } }), (d: Doc, id: NodeId) => planScale(d, id, 1.5, OPTS)]) {
        const doc = load(src);
        const id = elements(doc)[at].id;
        const plan = make(doc, id);
        if ('refused' in plan) continue;
        run(doc, plan);
        const now = names(doc, id);
        assert.ok(now === was || now === `translate ${was}` || now === `${was} rotate`, `${f}: "${was}" became "${now}"`);
        lists++;
      }
    }
  }
  assert.ok(lists >= 80, `only ${lists} transform lists edited (the corpus has 37 elements with a transform)`);
});

test('a written length keeps its unit: px, pt, mm, in, em and % convert back; rem and ex are refused', () => {
  const doc = load(svg(`<rect id="px" x="10px" y="0"/><rect id="pt" x="30pt"/><rect id="mm" x="10mm"/><rect id="in" x="1in"/>
    <g font-size="20"><rect id="em" x="1em"/></g><rect id="pct" x="10%"/><rect id="rem" x="1rem"/><rect id="ex" x="1ex"/>`));
  const move = (id: string) => {
    const plan = planMove(doc, byId(doc, id), 12, 0, OPTS);
    return 'refused' in plan ? plan.refused : plan.edits.map((e) => `${e.local}=${e.raw}`).join(' ');
  };
  assert.equal(move('px'), 'x=22px');
  assert.equal(move('pt'), 'x=39pt', '12 user units are 9pt');
  assert.equal(move('mm'), 'x=13.175mm');
  assert.equal(move('in'), 'x=1.125in');
  assert.equal(move('em'), 'x=1.6em', 'against the 20 of its font size');
  assert.equal(move('pct'), 'x=16%', 'of the viewBox’s 200 wide');
  assert.match(move('rem'), /^Its x is in rem, which the canvas measures against the app’s 12 px root, not this file’s own root font size \(16 px\)\. Convert rem to user units \(Import report\) first\.$/);
  assert.match(move('ex'), /x-height/);
});

test('CSS-controlled geometry and transforms are refused with their reasons; transform-origin shifts the written rotate pivot', () => {
  const doc = load(svg(`<style>.k { cx: 4px } .t { transform: none } .o { transform-origin: 1px 1px } .f { font-size: 9px }</style>
    <rect id="inline" style="x: 3px" width="4" height="4"/><circle id="sheet" class="k" r="3"/><g id="t" class="t"/><rect id="css" style="transform: rotate(1deg)" width="1" height="1"/>
    <rect id="o" class="o" width="10" height="10"/><rect id="em" class="f" x="1em"/>
    <rect id="origin" x="10" y="10" width="20" height="10" transform-origin="5 5"/>
    <rect id="flat" x="1" y="1" width="4" height="4" transform="matrix(1 1 1 1 0 0)"/><rect id="zero" x="1" y="1" width="4" height="4" transform="scale(0)"/>`));
  assert.equal(refusal(planMove(doc, byId(doc, 'inline'), 1, 1, OPTS)), 'Its x is set by CSS (its style attribute), which wins over the attribute.');
  assert.equal(refusal(planMove(doc, byId(doc, 'sheet'), 1, 1, OPTS)), 'Its cx is set by CSS (a <style> rule), which wins over the attribute.');
  assert.equal(refusal(planMove(doc, byId(doc, 't'), 1, 1, OPTS)), 'Its transform is set by CSS, which Draw doesn’t edit yet.');
  assert.equal(refusal(planRotate(doc, byId(doc, 'css'), 30, OPTS)), 'Its transform is set by CSS, which Draw doesn’t edit yet.');
  assert.equal(refusal(planRotate(doc, byId(doc, 'o'), 30, OPTS)), 'Its transform origin is set by a <style> rule.');
  assert.equal(refusal(planMove(doc, byId(doc, 'em'), 1, 0, OPTS)), 'Its size is in em, and a <style> rule sets its font size, so Draw can’t tell what 1em is.');
  // A transform that flattens it (no inverse): its geometry can't be moved to land where it should.
  for (const id of ['flat', 'zero']) assert.equal(refusal(planMove(doc, byId(doc, id), 1, 1, OPTS)), 'Its transform flattens it, so its geometry can’t move.', id);
  // The box's centre is (20, 15); with the origin at (5, 5) the rotate item's own centre is (15, 10).
  const out = run(doc, planRotate(doc, byId(doc, 'origin'), 30, OPTS));
  assert.match(out, /transform-origin="5 5" transform="rotate\(30 15 10\)"/);
  const rect = byId(doc, 'origin');
  const m = placement(doc, rect, CTX)!;
  const c = applyM(m, 20, 15);
  assert.ok(Math.abs(c[0] - 20) < 1e-9 && Math.abs(c[1] - 15) < 1e-9, `the centre stays put: ${c}`);
});

test('a transformed element’s move lands exactly (dx, dy) away in its parent', () => {
  const doc = load(svg(`<rect id="r" x="10" y="10" width="20" height="10" transform="rotate(30)"/>
    <rect id="s" x="10" y="10" width="20" height="10" transform="scale(2 3) skewX(20)"/>
    <circle id="o" cx="10" cy="10" r="5" transform="rotate(45)" transform-origin="50 50"/>
    <ellipse id="f" cx="10" cy="10" rx="5" ry="2" transform="rotate(70)" style="transform-box: fill-box; transform-origin: center"/>
    <path id="p" d="M0 0 L10 5 l3 3" transform="matrix(1 0.5 -0.5 1 3 4)"/><polygon id="q" points="0 0 10 0 5 5" transform="scale(-1 1)"/>
    <g id="g" transform="rotate(20) scale(3)"><rect width="4" height="4"/></g>`));
  for (const id of ['r', 's', 'o', 'f', 'p', 'q', 'g']) {
    const n = byId(doc, id);
    const before = rootBounds(doc, n, CTX)!;
    run(doc, planMove(doc, n, 7, -3, OPTS));
    const after = rootBounds(doc, n, CTX)!;
    assert.ok(Math.abs(after.x - before.x - 7) < 1e-3 && Math.abs(after.y - before.y + 3) < 1e-3, `${id}: moved by ${after.x - before.x}, ${after.y - before.y}`);
  }
});

test('a group resize keeps its fixed corner and edits a leading translate() scale() pair rather than adding another', () => {
  const doc = load(svg('<g id="g" transform="rotate(5)"><rect x="10" y="10" width="20" height="10"/></g>'));
  const g = byId(doc, 'g');
  const inParent = () => mapRect(placement(doc, g, CTX)!, localBounds(doc, g, CTX)!);
  const box = inParent();
  const fixed = { x: box.x, y: box.y };
  run(doc, planResize(doc, g, { corner: 'br', to: { x: box.x + box.width * 2, y: box.y + box.height }, box }, OPTS));
  assert.match(attrValue(doc, el(doc, g), null, 'transform')!, /^translate\(-?[\d.]+ -?[\d.]+\) scale\(2\) rotate\(5\)$/, 'a pair is prepended');
  const once = inParent();
  assert.ok(Math.abs(once.x - fixed.x) < 1e-3 && Math.abs(once.y - fixed.y) < 1e-3, `the top-left stays: ${JSON.stringify(once)} vs ${JSON.stringify(fixed)}`);
  assert.ok(Math.abs(once.width - box.width * 2) < 1e-2, 'twice as wide');
  run(doc, planResize(doc, g, { corner: 'br', to: { x: once.x + once.width * 1.5, y: once.y + once.height }, box: once }, OPTS));
  assert.match(attrValue(doc, el(doc, g), null, 'transform')!, /^translate\(-?[\d.]+ -?[\d.]+\) scale\(3\) rotate\(5\)$/, 'the same pair is edited: no third item');
  const twice = inParent();
  assert.ok(Math.abs(twice.x - fixed.x) < 1e-2 && Math.abs(twice.y - fixed.y) < 1e-2, 'the top-left still stays');
  run(doc, planMove(doc, g, 5, 5, OPTS));
  assert.match(attrValue(doc, el(doc, g), null, 'transform')!, /^translate\(-?[\d.]+ -?[\d.]+\) scale\(3\) rotate\(5\)$/, 'and a move edits that leading translate');
});

test('corner resizes: a rect keeps its opposite corner, at least 1 a side; a circle stays round; a tilted arc refuses a stretch', () => {
  const doc = load(svg(`<rect id="r" x="20" y="25" width="60" height="50"/><circle id="c" cx="50" cy="50" r="10"/>
    <path id="p" d="M0 0 A5 5 30 0 1 10 10"/><path id="q" d="M0 0 A5 3 90 0 1 10 10 l4 4"/><line id="l" x1="0" y1="0" x2="10" y2="20"/>`));
  const r = byId(doc, 'r');
  const out = run(doc, planResize(doc, r, { corner: 'tl', to: { x: 30, y: 30 } }, OPTS));
  assert.match(out, /<rect id="r" x="30" y="30" width="50" height="45"\/>/, 'the top-left moved; the bottom-right stayed at 80, 75');
  run(doc, planResize(doc, r, { corner: 'tl', to: { x: 200, y: 200 } }, OPTS));
  assert.match(serialize(doc), /<rect id="r" x="79" y="74" width="1" height="1"\/>/, 'past the fixed corner it stops at 1');
  run(doc, planResize(doc, r, { corner: 'br', to: { x: 90, y: 80 } }, OPTS));
  assert.match(serialize(doc), /<rect id="r" x="79" y="74" width="11" height="6"\/>/, 'the bottom-right: x and y untouched');
  run(doc, planResize(doc, byId(doc, 'c'), { corner: 'br', to: { x: 70, y: 62 } }, OPTS));
  assert.match(serialize(doc), /<circle id="c" cx="55" cy="55" r="15"\/>/, 'square, from the fixed top-left (40, 40)');
  assert.equal(refusal(planResize(doc, byId(doc, 'p'), { corner: 'br', to: { x: 20, y: 11 } }, OPTS)), 'A tilted arc can’t be stretched; resize it evenly.');
  run(doc, planResize(doc, byId(doc, 'q'), { corner: 'br', to: { x: 28, y: 14 } }, OPTS));
  // Its box is 0 0 14 14, stretched to 28 wide: sx 2, sy 1. The arc turned 90° has its rx along y.
  assert.match(serialize(doc), /d="M0 0 A5 6 90 0 1 20 10 l8 4"/, 'a quarter-turned arc swaps which radius each axis stretches; relative deltas scale');
  run(doc, planResize(doc, byId(doc, 'l'), { corner: 'tl', to: { x: -10, y: -20 } }, OPTS));
  assert.match(serialize(doc), /<line id="l" x1="-10" y1="-20" x2="10" y2="20"\/>/, 'a line scales about the fixed corner');
});

test('corner resizes of a nested svg, an image and a foreignObject write x, y, width and height, the opposite corner kept', () => {
  for (const el of ['<svg id="e" x="5" y="5" width="20" height="10" viewBox="0 0 10 5"/>', '<image id="e" x="5" y="5" width="20" height="10"/>', '<foreignObject id="e" x="5" y="5" width="20" height="10"/>']) {
    const doc = load(svg(el));
    const out = run(doc, planResize(doc, byId(doc, 'e'), { corner: 'tl', to: { x: 1, y: 2 } }, OPTS));
    assert.ok(out.includes(el.replace('x="5" y="5" width="20" height="10"', 'x="1" y="2" width="24" height="13"')), `the top-left of ${el} to (1, 2), the bottom-right kept at (25, 15):\n${out}`);
    const back = load(svg(el));
    const br = run(back, planResize(back, byId(back, 'e'), { corner: 'br', to: { x: 40, y: 30 } }, OPTS));
    assert.ok(br.includes(el.replace('width="20" height="10"', 'width="35" height="25"')), `the bottom-right of ${el}: x and y untouched:\n${br}`);
  }
});

test('rotate rewrites an existing angle; scale rewrites scale() and keeps the ratio of two; both say why not', () => {
  const doc = load(svg('<g id="h" transform="translate(50 50)\n    rotate(0)\n    scale(1)"/><g id="s" transform="scale(1 2)"/><g id="n"/>'));
  const h = byId(doc, 'h');
  run(doc, planRotate(doc, h, 180, OPTS));
  run(doc, planScale(doc, h, 2, OPTS));
  assert.ok(serialize(doc).includes('transform="translate(50 50)\n    rotate(180)\n    scale(2)"'), 'each number in place, the lines kept');
  run(doc, planScale(doc, byId(doc, 's'), 3, OPTS));
  assert.equal(attrValue(doc, el(doc, byId(doc, 's')), null, 'transform'), 'scale(3 6)');
  assert.equal(refusal(planScale(doc, byId(doc, 'n'), 2, OPTS)), 'It has no scale() to change.');
});

// P1-M3: a <path>'s L, Q and C letters are tokens too; the move, resize and rotate planners count only
// the argument tokens (numbers and arc flags) against the path's arguments, so they work as before.
test('a path whose letters are tokens still moves, resizes and rotates as before', async () => {
  const { tokenizeAttr } = await import('../../code/tokens.ts');
  const src = svg('<path id="p" d="M 10 10 L 20 20 Q 30 10 40 20 C 50 30 60 30 70 20 l 5 5 A 5 5 0 0 1 90 30 Z"/>');
  const doc = load(src);
  const id = byId(doc, 'p');
  const letters = tokenizeAttr(doc, id, { ns: null, local: 'd' }).filter((t) => t.kind === 'enum' && t.segment !== undefined).map((t) => t.text);
  assert.deepEqual(letters, ['L', 'Q', 'C', 'l'], 'the test path has letter tokens');
  assert.equal(run(doc, planMove(doc, id, 5, -5, OPTS)), svg('<path id="p" d="M 15 5 L 25 15 Q 35 5 45 15 C 55 25 65 25 75 15 l 5 5 A 5 5 0 0 1 95 25 Z"/>'), 'moved: every absolute coordinate, the relative l as it was');
  const doc2 = load(src);
  const resized = planResize(doc2, byId(doc2, 'p'), { corner: 'br', to: { x: 100, y: 40 } }, OPTS);
  assert.ok('edits' in resized && resized.edits.length === 1, refusal(resized));
  const doc3 = load(src);
  const turned = planRotate(doc3, byId(doc3, 'p'), 30, OPTS);
  assert.ok('edits' in turned && turned.edits[0].local === 'transform', refusal(turned));
});
