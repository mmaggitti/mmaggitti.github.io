// engine/geometry/shape-handles.ts: where each shape's handles sit (SVG Lab's KITS), and what a drag
// of one writes: only its own numbers, every other byte kept, lengths on the step and at least 1,
// units kept, M1's refusals in M1's words, a generated shape's inputs only, and a mirror kept.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { descendants, findAttr, parseDoc, serialize, type Attr, type Doc, type ElementNode } from '../../model/doc.ts';
import type { NumberToken } from '../../code/tokens.ts';
import { undoOp, type Op } from '../../commands/ops.ts';
import { DRAW_NS } from '../../model/draw-ns.ts';
import { starPoints } from '../../generators/radial.ts';
import { spiralPath } from '../../generators/spiral.ts';
import { finishGenerators } from '../../generators/index.ts';
import { Session } from '../../commands/session.ts';
import { apply as applyM, invert } from '../../values/affine.ts';
import { userCtm } from '../../geometry/ctm.ts';
import { localBounds } from '../../geometry/bounds.ts';
import { applyPlan } from '../../geometry/write.ts';
import { numberTokens } from '../../geometry/write.ts';
import { planShapeHandle, shapeHandles, takesShapeHandles } from '../../geometry/shape-handles.ts';

const CORPUS = fileURLToPath(new URL('../fixtures/corpus/', import.meta.url));
const ctx = { viewport: { width: 100, height: 100 }, remPx: 12 };
const D = 'https://mmaggitti.github.io/draw/ns';
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:draw="${D}" viewBox="0 0 100 100">${body}</svg>`;
const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const firstEl = (doc: Doc, local: string): ElementNode => [...descendants(doc, doc.root)].find((n): n is ElementNode => n.kind === 'element' && n.local === local)!;
const at = (doc: Doc, n: ElementNode, id: string) => shapeHandles(doc, n.id, ctx)!.find((h) => h.id === id)!.at;
/** Plan a handle drag and apply it: the ops, so a test can undo them. */
function drag(doc: Doc, n: ElementNode, id: string, to: { x: number; y: number }, step = 1): Op[] | string {
  const plan = planShapeHandle(doc, n.id, id, to, { ctx, decimals: 0, step });
  if ('refused' in plan) return plan.refused;
  const ops: Op[] = [];
  applyPlan(doc, plan, (op) => ops.push(op));
  return ops;
}

test('each shape’s handles sit where SVG Lab’s KITS put them, for the Shapes lesson’s own shapes; rect, path, g, text and use take none (they keep the resize corners)', () => {
  const doc = load(svg('<circle cx="50" cy="50" r="30"/><ellipse cx="50" cy="50" rx="38" ry="22"/><line x1="15" y1="80" x2="85" y2="20" stroke="#264653"/><polygon points="50,17 83,41 71,80 29,80 17,41"/><polyline points="14,88 32,68 50,88"/><rect width="5" height="5"/><path d="M0 0h5"/><g/><text>t</text><use href="#x"/>'));
  const hs = (local: string) => shapeHandles(doc, firstEl(doc, local).id, ctx)!.map((h) => `${h.id}:${h.kind}:${h.role}@${h.at.x},${h.at.y} "${h.tip}"`);
  assert.deepEqual(hs('circle'), ['r:anchor:length@80,50 "r 30"', 'center:center:position@50,50 ""']);
  assert.deepEqual(hs('ellipse'), ['rx:anchor:length@88,50 "rx 38"', 'ry:anchor:length@50,72 "ry 22"', 'center:center:position@50,50 ""']);
  assert.deepEqual(hs('line'), ['p1:anchor:position@15,80 "x 15, y 80"', 'p2:anchor:position@85,20 "x 85, y 20"']);
  assert.deepEqual(hs('polygon'), ['v0:anchor:position@50,17 "x 50, y 17"', 'v1:anchor:position@83,41 "x 83, y 41"', 'v2:anchor:position@71,80 "x 71, y 80"', 'v3:anchor:position@29,80 "x 29, y 80"', 'v4:anchor:position@17,41 "x 17, y 41"']);
  assert.equal(hs('polyline').length, 3);
  for (const local of ['rect', 'path', 'g', 'text', 'use']) {
    assert.equal(takesShapeHandles(doc, firstEl(doc, local).id), false, local);
    assert.equal(shapeHandles(doc, firstEl(doc, local).id, ctx), null, local);
  }
  // A plain polygon past 200 points has no vertex handles (the code has them).
  const many = Array.from({ length: 201 }, (_, i) => `${i % 100},${Math.floor(i / 100)}`).join(' ');
  const big = load(svg(`<polygon points="${many}"/>`));
  assert.deepEqual(shapeHandles(big, firstEl(big, 'polygon').id, ctx), []);
  const two = load(svg(`<polygon points="${many.split(' ').slice(0, 200).join(' ')}"/>`));
  assert.equal(shapeHandles(two, firstEl(two, 'polygon').id, ctx)!.length, 200);
});

test('a text’s pos handle (P1-M4) sits at its (x, y) in its own units when it moves by its numbers and has both, tooltip "x N, y N", and keeps the resize corners; its drag moves the text by its numbers, its tspans with it, one undo giving the bytes back', () => {
  const body = '<text x="50" y="55" font-size="14"><tspan x="50" dy="0em">Big</tspan><tspan x="50" dy="1.3em">Idea</tspan></text>';
  const doc = load(svg(body));
  const t = firstEl(doc, 'text');
  assert.deepEqual(shapeHandles(doc, t.id, ctx)!.map((h) => `${h.id}:${h.kind}:${h.role}@${h.at.x},${h.at.y} "${h.tip}"`), ['pos:anchor:position@50,55 "x 50, y 55"']);
  assert.equal(takesShapeHandles(doc, t.id), false, 'it keeps the resize corners');
  const ops = drag(doc, t, 'pos', { x: 60, y: 50 });
  assert.ok(Array.isArray(ops), String(ops));
  assert.equal(serialize(doc), svg('<text x="60" y="50" font-size="14"><tspan x="60" dy="0em">Big</tspan><tspan x="60" dy="1.3em">Idea</tspan></text>'));
  for (const op of [...ops].reverse()) undoOp(doc, op);
  assert.equal(serialize(doc), svg(body));
  for (const other of ['<text x="1 2" y="5">a</text>', '<text y="5">a</text>', '<text x="5" y="5"><textPath href="#p">a</textPath></text>']) {
    const d = load(svg(other));
    assert.equal(shapeHandles(d, firstEl(d, 'text').id, ctx), null, other);
  }
});

test('a drag writes the lab’s numbers: a radius from the distance on the step, rx and ry from their own axis, a line end and a vertex at the point; each at least 1; only that attribute’s number changes', () => {
  const src = svg('<circle cx="30" cy="30" r="10" fill="red"/><ellipse cx="70" cy="30" rx="20" ry="10"/><line x1="10" y1="80" x2="40" y2="60" stroke="#264653"/><polygon points="50,17 83,41 71,80"/>');
  const doc = load(src);
  const c = firstEl(doc, 'circle');
  drag(doc, c, 'r', { x: 45.2, y: 30 });
  assert.equal(serialize(doc), src.replace('r="10"', 'r="15"'), 'r = 15.2 on the whole-unit step');
  drag(doc, c, 'r', { x: 30.2, y: 30.1 });
  assert.equal(serialize(doc), src.replace('r="10"', 'r="1"'), 'at least 1');
  drag(doc, c, 'r', { x: 41.26, y: 30 }, 0.5);
  assert.equal(serialize(doc), src.replace('r="10"', 'r="11.5"'), 'on the half-unit step when zoomed in');
  const e = firstEl(doc, 'ellipse');
  drag(doc, e, 'rx', { x: 70 - 26.4, y: 99 });
  assert.ok(serialize(doc).includes('rx="26" ry="10"'), 'rx from |x − cx| alone, on the step');
  drag(doc, e, 'ry', { x: 12, y: 30.2 });
  assert.ok(serialize(doc).includes('rx="26" ry="1"'), 'ry at least 1');
  const l = firstEl(doc, 'line');
  drag(doc, l, 'p2', { x: 44, y: 55 });
  assert.ok(serialize(doc).includes('<line x1="10" y1="80" x2="44" y2="55"'), serialize(doc));
  const p = firstEl(doc, 'polygon');
  drag(doc, p, 'v1', { x: 90, y: 40.5 });
  assert.ok(serialize(doc).includes('points="50,17 90,40.5 71,80"'), 'only that pair: 90,40.5');
});

test('units stay as written (em, mm), and rem, CSS-set geometry and a transform Draw can’t use are refused with the move and resize planners’ reasons; a radius in ex (unmeasurable) gets no handle', () => {
  const doc = load(svg('<circle cx="10mm" cy="30" r="2em"/><line x1="1in" y1="0" x2="50" y2="50" stroke="#000"/>'));
  const c = firstEl(doc, 'circle');
  const centre = at(doc, c, 'center');
  assert.ok(Math.abs(centre.x - 37.795) < 0.01, `cx 10mm is ${centre.x} user units`);
  drag(doc, c, 'r', { x: centre.x + 48, y: 30 }); // 48 user units: 3em at 16 px
  assert.ok(serialize(doc).includes('r="3em"'), serialize(doc));
  const l = firstEl(doc, 'line');
  drag(doc, l, 'p1', { x: 48, y: 0 }); // 0.5in
  assert.ok(serialize(doc).includes('x1="0.5in"'), serialize(doc));
  const ex = load(svg('<circle cx="5" cy="5" r="2ex"/>'));
  assert.deepEqual(shapeHandles(ex, firstEl(ex, 'circle').id, ctx), [], 'ex is the font’s own x-height: no place to put the handle');
  for (const [markup, why] of [
    ['<circle cx="5" cy="5" r="2rem"/>', /^Its r is in rem, which the canvas measures against/],
    ['<circle cx="5" cy="5" r="2" style="r: 4px"/>', /^Its r is set by CSS \(its style attribute\), which wins over the attribute\.$/],
    ['<circle cx="5" cy="5" r="2" transform="scale(0 1)"/>', /^Its transform flattens it, so its geometry can’t move\.$/],
    ['<circle cx="5" cy="5" r="2" style="transform: rotate(4deg)"/>', /^Its transform is set by CSS, which Draw doesn’t edit yet\.$/],
  ] as const) {
    const d = load(svg(markup));
    const n = firstEl(d, 'circle');
    const got = drag(d, n, 'r', { x: 20, y: 5 });
    assert.ok(typeof got === 'string' && why.test(got), `${markup}: ${JSON.stringify(got)}`);
  }
});

test('a generated shape’s handles write its inputs only: a star’s radius (draw:r, on the step, at least 1) and inner point (draw:inner = the distance ÷ r, 0.01, 0.05–0.95); the spiral’s radius at its end', () => {
  const star = `<polygon points="${starPoints(50, 50, 20, 0.4, 5)}" draw:gen="star" draw:cx="50" draw:cy="50" draw:r="20" draw:inner="0.4" draw:tips="5"/>`;
  const doc = load(svg(star));
  const p = firstEl(doc, 'polygon');
  const hs = shapeHandles(doc, p.id, ctx)!;
  assert.deepEqual(hs.map((h) => h.id), ['r', 'inner', 'center']);
  assert.deepEqual(hs[0].at, { x: 50, y: 30 }, 'the radius handle is on the first tip');
  const inner = hs[1].at;
  assert.ok(Math.abs(Math.hypot(inner.x - 50, inner.y - 50) - 8) < 1e-9 && inner.x > 50 && inner.y < 50, 'the inner handle is on the first inner point, at −54°');
  const ops = drag(doc, p, 'r', { x: 50, y: 17.4 });
  assert.ok(Array.isArray(ops) && ops.every((op) => op.kind === 'attr' && op.ns === DRAW_NS && op.local === 'r'), 'only draw:r');
  assert.equal(findAttr(p, DRAW_NS, 'r')!.raw, '33');
  assert.ok(findAttr(p, null, 'points')!.raw === starPoints(50, 50, 20, 0.4, 5), 'the planner writes inputs only; the finish hook draws it again');
  for (let i = ops.length - 1; i >= 0; i--) undoOp(doc, (ops as Op[])[i]);
  // Through a Session with the finish hook, as the editor drags it: each drag redrawn from its inputs.
  const s = new Session(doc, { finish: (d, o, ap) => void finishGenerators(d, o, ap) });
  const set = (hid: string, to: { x: number; y: number }) => s.dispatch(`Set ${hid}`, (ap) => {
    const plan = planShapeHandle(doc, p.id, hid, to, { ctx, decimals: 0, step: 1 });
    assert.ok(!('refused' in plan), 'refused' in plan ? plan.refused : '');
    applyPlan(doc, plan, ap);
  });
  set('r', { x: 50, y: 50 });
  assert.equal(findAttr(p, DRAW_NS, 'r')!.raw, '1', 'at least 1');
  assert.equal(findAttr(p, null, 'points')!.raw, starPoints(50, 50, 1, 0.4, 5), 'and drawn again from it');
  set('r', { x: 50, y: 30 });
  set('inner', { x: 50, y: 50 - 13 });
  assert.equal(findAttr(p, DRAW_NS, 'inner')!.raw, '0.65', '13 ÷ 20');
  set('inner', { x: 50, y: 50 - 40 });
  assert.equal(findAttr(p, DRAW_NS, 'inner')!.raw, '0.95', 'clamped to 0.95');
  set('inner', { x: 50, y: 50 });
  assert.equal(findAttr(p, DRAW_NS, 'inner')!.raw, '0.05', 'clamped to 0.05');
  assert.equal(findAttr(p, null, 'points')!.raw, starPoints(50, 50, 20, 0.05, 5));
  // The spiral: its radius handle at its end, P(Θ).
  const sp = load(svg(`<path d="${spiralPath(40, 40, 20, 1.25)}" draw:gen="spiral" draw:cx="40" draw:cy="40" draw:r="20" draw:turns="1.25"/>`));
  const path = firstEl(sp, 'path');
  const end = at(sp, path, 'r');
  assert.ok(Math.abs(end.x - 40) < 1e-9 && Math.abs(end.y - 60) < 1e-9, `1.25 turns end straight down: ${JSON.stringify(end)}`);
  drag(sp, path, 'r', { x: 40, y: 70.3 });
  assert.equal(findAttr(path, DRAW_NS, 'r')!.raw, '30');
});

test('mirrored elements keep their mirror: under scale(-1 1) and matrix(-1 0 0 1 100 0), a circle’s, an ellipse’s, a line’s and a star’s handles sit on the mirrored side in the root, a drag outward grows the length, and no sign flips and no transform changes', () => {
  for (const t of ['scale(-1 1)', 'matrix(-1 0 0 1 100 0)']) {
    const star = `<polygon transform="${t}" points="${starPoints(30, 60, 20, 0.4, 5)}" draw:gen="star" draw:cx="30" draw:cy="60" draw:r="20" draw:inner="0.4" draw:tips="5"/>`;
    const doc = load(svg(`<circle transform="${t}" cx="30" cy="30" r="10"/><ellipse transform="${t}" cx="70" cy="30" rx="20" ry="10"/><line transform="${t}" x1="10" y1="80" x2="40" y2="80" stroke="#000"/>${star}`));
    const toRoot = (n: ElementNode) => userCtm(doc, n.id, ctx, (x) => localBounds(doc, x, ctx))!;
    for (const [local, hid, grow] of [['circle', 'r', 5], ['ellipse', 'rx', 5], ['polygon', 'inner', 3]] as const) {
      const n = firstEl(doc, local);
      const m = toRoot(n);
      const h = at(doc, n, hid);
      const c = at(doc, n, 'center');
      const [hx, hy] = applyM(m, h.x, h.y);
      const [cx, cy] = applyM(m, c.x, c.y);
      assert.ok(hx < cx, `${t} ${local}: the ${hid} handle is left of its centre in the root (${hx} < ${cx})`);
      // Outward in the root: `grow` further from the centre, mapped back into its own units.
      const k = grow / Math.hypot(hx - cx, hy - cy);
      const [ox, oy] = applyM(invert(m)!, hx + (hx - cx) * k, hy + (hy - cy) * k);
      const before = serialize(doc);
      drag(doc, n, hid, { x: ox, y: oy });
      const after = serialize(doc);
      assert.ok(after !== before, `${t} ${local}: the drag wrote something`);
      assert.ok(after.includes(`transform="${t}"`) && after.split(`transform="${t}"`).length === 5, `${t} ${local}: every transform kept`);
      const own = local === 'polygon' ? findAttr(n, DRAW_NS, 'inner')!.raw : findAttr(n, null, hid)!.raw;
      assert.ok(Number(own) > (local === 'ellipse' ? 20 : local === 'polygon' ? 0.4 : 10) && !own.startsWith('-'), `${t} ${local}: ${hid} grew and stayed positive (${own})`);
    }
    const line = firstEl(doc, 'line');
    const m = toRoot(line);
    const [e1] = applyM(m, 10, 80);
    const [e2] = applyM(m, 40, 80);
    assert.ok(e1 > e2, `${t}: the line's first end is on the mirrored side`);
  }
});

test('over every corpus circle, ellipse, line, polygon and polyline, a handle moved by (3, −2) changes exactly the number tokens it owns, and undoing its ops gives the file back byte for byte', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.svg')) files.push(p);
    }
  };
  walk(CORPUS);
  const OWNS: Record<string, (hid: string) => [string, number[]][]> = {
    circle: () => [['r', [0]]],
    ellipse: (hid) => [[hid, [0]]],
    line: (hid) => (hid === 'p1' ? [['x1', [0]], ['y1', [0]]] : [['x2', [0]], ['y2', [0]]]),
    polygon: (hid) => [['points', [2 * Number(hid.slice(1)), 2 * Number(hid.slice(1)) + 1]]],
    polyline: (hid) => [['points', [2 * Number(hid.slice(1)), 2 * Number(hid.slice(1)) + 1]]],
  };
  let moved = 0, refused = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const parsed = parseDoc(text);
    if (!parsed.ok) continue;
    const doc = parsed.doc;
    for (const n of [...descendants(doc, doc.root)]) {
      if (n.kind !== 'element' || !OWNS[n.local] || n.ns !== 'http://www.w3.org/2000/svg') continue;
      const hs = shapeHandles(doc, n.id, ctx);
      if (!hs) continue;
      for (const h of hs.filter((x) => x.id !== 'center').slice(0, 6)) {
        const el: ElementNode = n;
        const owned: [string, number[]][] = OWNS[el.local](h.id);
        const before = new Map<string, string>(el.attrs.map((a): [string, string] => [`${a.ns} ${a.local}`, a.raw]));
        const tokensBefore = new Map<string, NumberToken[]>(owned.map(([local]): [string, NumberToken[]] => [local, numberTokens(doc, el, local, findAttr(el, null, local)?.raw ?? '')]));
        const ops = drag(doc, el, h.id, { x: h.at.x + 3, y: h.at.y - 2 });
        if (typeof ops === 'string') {
          refused++;
          continue;
        }
        moved++;
        for (const a of el.attrs as Attr[]) {
          const key: string = `${a.ns} ${a.local}`;
          const mine = owned.find(([local]) => a.ns === null && a.local === local);
          if (!mine) {
            assert.equal(a.raw, before.get(key), `${f} <${n.qname}> ${h.id}: ${a.qname} changed`);
            continue;
          }
          const was: NumberToken[] = tokensBefore.get(mine[0])!;
          const now: NumberToken[] = numberTokens(doc, el, mine[0], a.raw);
          assert.equal(now.length, was.length, `${f} <${n.qname}> ${h.id}: ${a.qname}'s numbers`);
          now.forEach((t, i) => {
            if (!mine[1].includes(i)) assert.equal(t.text, was[i].text, `${f} <${n.qname}> ${h.id}: ${a.qname}'s number ${i} changed`);
          });
          assert.equal(a.raw.replace(/-?[\d.]+/g, '#'), before.get(key)!.replace(/-?[\d.]+/g, '#'), `${f} <${n.qname}> ${h.id}: ${a.qname}'s separators changed`);
        }
        for (let i = ops.length - 1; i >= 0; i--) undoOp(doc, ops[i]);
        assert.equal(serialize(doc), text, `${f} <${n.qname}> ${h.id}: undo gives the file back`);
      }
    }
  }
  assert.ok(moved > 100, `moved ${moved} handles (${refused} refused)`);
});
