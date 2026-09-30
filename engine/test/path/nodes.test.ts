// engine/path/nodes: the node tool's model of a <path> (anchors, controls, bend points, arms and
// mirror guides) and what a drag or tap on one writes; the node types (Smooth and Corner); Close and
// Open. The corpus property: every handle moved by (3, −2) changes only the points its row names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { descendants, findAttr, parseDoc, serialize, type Doc, type ElementNode } from '../../model/doc.ts';
import { Session } from '../../commands/session.ts';
import { applyPlan, type Plan } from '../../geometry/write.ts';
import { parsePath, type ParsedPath } from '../../path/parse.ts';
import { toAbsolute, type AbsSeg } from '../../path/abs.ts';
import { MAX_NODE_HANDLES, nodesOf, pathNodes, planBendTap, planNodeDrag } from '../../path/nodes.ts';
import { closeLast, makeCorner, makeSmooth, nodeType, openLast } from '../../path/segments.ts';
import { cssSets } from '../../geometry/css.ts';
import { TokenEditError } from '../../code/edit.ts';

const CORPUS = new URL('../fixtures/corpus/', import.meta.url);
const lab = (f: string): string => readFileSync(new URL(`lab/${f}`, CORPUS), 'utf8');
const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.doc;
};
const paths = (doc: Doc): ElementNode[] => [...descendants(doc, doc.root)].filter((n): n is ElementNode => n.kind === 'element' && n.local === 'path');
const nodesOfD = (d: string) => {
  const p = parsePath(d);
  return nodesOf(p, toAbsolute(p));
};
const ids = (d: string) => nodesOfD(d).handles.map((h) => `${h.id} ${h.kind} ${h.at.x},${h.at.y}`);
const ONE = { step: 1, k: 1 };
const svgOf = (d: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${d}"/></svg>`;

/** Apply a plan to the first path in one transaction and return its new d. */
function after(doc: Doc, plan: Plan): string {
  assert.ok(!('refused' in plan), 'refused' in plan ? plan.refused : '');
  new Session(doc).dispatch('test', (apply) => applyPlan(doc, plan as { edits: [] }, apply));
  return findAttr(paths(doc)[0], null, 'd')!.raw;
}

// ── the model ──────────────────────────────────────────────────────────────────────────────────

test('pathNodes on the lab’s files: lab/paths.svg’s two anchors and its bend at (35, 52.5); the heart’s start standing for its linked last anchor (4 anchors, 8 controls, no bends); the wave’s 3 anchors and 2 controls; the S’s implied control a mirror guide at (60, 90), not a handle', () => {
  const nodes = (f: string) => {
    const doc = load(lab(f));
    return pathNodes(doc, paths(doc)[0].id)!;
  };
  assert.deepEqual(nodes('paths.svg').handles.map((h) => `${h.id} ${h.kind} ${h.at.x},${h.at.y}`), ['b1 bend 35,52.5', 'a0 start 20,75', 'a1 anchor 50,30']);
  const heart = nodes('create-icon.svg');
  assert.deepEqual(heart.handles.filter((h) => h.kind === 'start' || h.kind === 'anchor').map((h) => `${h.id} ${h.at.x},${h.at.y}`), ['a0 50,40', 'a1 32,37', 'a2 50,70', 'a3 68,37'], 'the fifth (50, 40) is the start');
  assert.equal(heart.handles.filter((h) => h.kind === 'ctrl').length, 8);
  assert.equal(heart.handles.filter((h) => h.kind === 'bend').length, 0);
  assert.equal(heart.arms.length, 8, 'each C: start → first control, second control → end');
  assert.ok(heart.closed);
  const wave = nodes('create-logo.svg');
  assert.deepEqual(wave.handles.map((h) => `${h.id} ${h.kind} ${h.at.x},${h.at.y}`), ['c1 ctrl 40,32', 'c2 ctrl 60,56', 'a0 start 30,44', 'a1 anchor 50,44', 'a2 anchor 70,44']);
  assert.deepEqual(wave.arms, [[{ x: 30, y: 44 }, { x: 40, y: 32 }], [{ x: 40, y: 32 }, { x: 50, y: 44 }], [{ x: 50, y: 44 }, { x: 60, y: 56 }], [{ x: 60, y: 56 }, { x: 70, y: 44 }]], 'a Q: start → control → end');
  const smooth = nodes('arcs--smooth.svg');
  assert.deepEqual(smooth.handles.map((h) => h.id), ['c1.1', 'c1', 'c2', 'a0', 'a1', 'a2'], 'the S has one control handle, its second');
  assert.deepEqual(smooth.mirrors, [{ from: { x: 50, y: 55 }, at: { x: 60, y: 90 }, to: null }]);
  assert.ok(!smooth.handles.some((h) => h.at.x === 60 && h.at.y === 90), 'the implied control is never a handle');
});

test('pathNodes on lab/arcs--holes.svg, a compound path: both subpaths’ anchors (the ring’s start and its arc end, its last anchor linked to the start; the keyhole’s start and its three points), bend handles on the keyhole’s two lines and none on the arcs', () => {
  const doc = load(lab('arcs--holes.svg'));
  const [path] = paths(doc);
  assert.deepEqual(pathNodes(doc, path.id)!.handles.map((h) => `${h.id} ${h.kind} ${h.at.x},${h.at.y}`), [
    'b6 bend 58.85,54', 'b7 bend 50,66',
    'a0 start 14,50', 'a1 anchor 86,50',
    'a4 start 43.3,42', 'a5 anchor 56.7,42', 'a6 anchor 61,66', 'a7 anchor 39,66',
  ]);
  assert.equal(pathNodes(doc, path.id)!.closed, true);
});

test('pathNodes on SVG Lab’s presets (PRESETS) written as paths: the heart (closed, four C), the wave (open, two C) and the check mark (two L)', () => {
  const heart = 'M 50 34 C 50 20, 28 14, 20 28 C 12 42, 26 62, 50 84 C 74 62, 88 42, 80 28 C 72 14, 50 20, 50 34 Z';
  assert.deepEqual(ids(heart).filter((h) => / (start|anchor) /.test(h)), ['a0 start 50,34', 'a1 anchor 20,28', 'a2 anchor 50,84', 'a3 anchor 80,28']);
  assert.equal(ids(heart).filter((h) => h.includes(' ctrl ')).length, 8);
  assert.deepEqual(ids('M 10 50 C 25 22, 35 22, 50 50 C 65 78, 75 78, 90 50'), ['c1.1 ctrl 25,22', 'c1 ctrl 35,22', 'c2.1 ctrl 65,78', 'c2 ctrl 75,78', 'a0 start 10,50', 'a1 anchor 50,50', 'a2 anchor 90,50']);
  assert.deepEqual(ids('M 22 52 L 42 72 L 80 30'), ['b1 bend 32,62', 'b2 bend 61,51', 'a0 start 22,52', 'a1 anchor 42,72', 'a2 anchor 80,30']);
  // T's mirror: a dashed arm from its start to the implied control and on to its end.
  assert.deepEqual(nodesOfD('M 0 0 Q 10 20 20 0 T 40 0').mirrors, [{ from: { x: 20, y: 0 }, at: { x: 30, y: -20 }, to: { x: 40, y: 0 } }]);
  assert.deepEqual(nodesOfD('M 0 0 L 10 0 S 20 10 30 0').mirrors, [], 'nothing is drawn when the implied control is the start itself');
  // At most 400 anchors get handles.
  const many = `M 0 0 ${Array.from({ length: 450 }, (_, i) => `L ${i + 1} ${i % 2}`).join(' ')}`;
  const n = nodesOfD(many);
  assert.equal(n.handles.filter((h) => h.kind === 'start' || h.kind === 'anchor').length, MAX_NODE_HANDLES);
  assert.equal(n.hidden, 451 - MAX_NODE_HANDLES);
});

// ── the corpus property ────────────────────────────────────────────────────────────────────────

/** Each segment's written points in absolute form (the end, the controls its letter writes, an arc's numbers). */
function written(s: AbsSeg, cmd: string): number[] {
  const U = cmd.toUpperCase();
  const pts = s.type === 'Z' ? [] : [s.x, s.y];
  if (s.type === 'C') pts.push(...(U === 'C' ? [s.x1, s.y1, s.x2, s.y2] : [s.x2, s.y2]));
  if (s.type === 'Q' && U === 'Q') pts.push(s.x1, s.y1);
  if (s.type === 'A') pts.push(s.rx, s.ry, s.rot, Number(s.large), Number(s.sweep));
  return pts;
}
const close = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1e-9);
const onStep1 = (v: number) => Math.round(v);

/** What the node rows say a handle moved by (dx, dy) does, as each segment's new written points and letter (computed here, not by nodes.ts). */
function expected(p: ParsedPath, abs: readonly AbsSeg[], id: string, dx: number, dy: number): { pts: number[][]; cmds: string[] } {
  const cmds = p.segs.map((s) => s.cmd);
  const E = abs.map((s) => ({ ...s })) as (AbsSeg & { x1: number; y1: number; x2: number; y2: number })[];
  const k = Number(/\d+/.exec(id)![0]);
  const U = (i: number) => cmds[i].toUpperCase();
  if (id.startsWith('a')) {
    const move = (j: number) => {
      E[j].x += dx;
      E[j].y += dy;
      if (U(j) === 'C' || U(j) === 'S') {
        E[j].x2 += dx;
        E[j].y2 += dy;
      }
      if (j + 1 < abs.length && abs[j + 1].sub === abs[j].sub && U(j + 1) === 'C') {
        E[j + 1].x1 += dx;
        E[j + 1].y1 += dy;
      }
    };
    move(k);
    if (abs[k].type === 'M') {
      // a closed subpath's last explicit anchor on its start moves with it (from 3 anchors)
      let z = k + 1;
      while (z < abs.length && abs[z].sub === abs[k].sub && abs[z].type !== 'Z') z++;
      const count = z - k;
      if (z < abs.length && abs[z].type === 'Z' && count > 2 && Math.abs(abs[z - 1].x - abs[k].x) <= 1e-9 && Math.abs(abs[z - 1].y - abs[k].y) <= 1e-9) move(z - 1);
    }
  } else if (id.startsWith('c')) {
    if (id.endsWith('.1')) [E[k].x1, E[k].y1] = [E[k].x1 + dx, E[k].y1 + dy];
    else if (U(k) === 'Q') [E[k].x1, E[k].y1] = [E[k].x1 + dx, E[k].y1 + dy];
    else [E[k].x2, E[k].y2] = [E[k].x2 + dx, E[k].y2 + dy];
  } else {
    const s = abs[k];
    const [mx, my] = [(s.x0 + s.x) / 2, (s.y0 + s.y) / 2];
    E[k] = { ...E[k], type: 'Q', x1: onStep1(2 * (mx + dx) - mx), y1: onStep1(2 * (my + dy) - my) } as never;
    cmds[k] = cmds[k] === U(k) ? 'Q' : 'q';
    // A T after the bent segment implied its start; it is written out as the Q it drew, so it keeps its shape.
    if (k + 1 < cmds.length && U(k + 1) === 'T') cmds[k + 1] = cmds[k + 1] === 'T' ? 'Q' : 'q';
  }
  return { pts: E.map((s, i) => written(s, cmds[i])), cmds };
}

interface Sweep {
  paths: number;
  skipped: number;
  handles: number;
  letters: Set<string>;
  implicit: number;
  subpaths: number;
  upgraded: number;
}
let swept: Sweep | null = null;

// Forms the corpus lacks (it has no T or t at all), beside it in the same sweep: T and t chains and a
// T after an L, packed arc flags, relative H and V with letter-less repeats, S after a Q, and SVG
// Lab's three presets (PRESETS) written as paths.
const EXTRA = [
  'M 0 0 Q 10 20 20 0 T 40 0 t 20 0 L 70 0 T 90 10',
  'M 10 10 A 20 20 0 01 30 30 a5 5 0 1010 10 A 8 4 30 1 0 60 60',
  'M 0 0 h 10 20 v 5 5 H 50 V 50 Z m 5 5 l 5 5 z',
  'M 0 0 Q 10 10 20 0 S 30 -10 40 0 s 10 10 20 0',
  'M 50 34 C 50 20, 28 14, 20 28 C 12 42, 26 62, 50 84 C 74 62, 88 42, 80 28 C 72 14, 50 20, 50 34 Z',
  'M 10 50 C 25 22, 35 22, 50 50 C 65 78, 75 78, 90 50',
  'M 22 52 L 42 72 L 80 30',
];

/**
 * Every handle of every corpus path (and EXTRA's) moved by (3, −2). Paths whose d holds a reference or
 * is set by CSS are skipped, and counted.
 */
function sweep(): Sweep {
  if (swept) return swept;
  const out: Sweep = { paths: 0, skipped: 0, handles: 0, letters: new Set(), implicit: 0, subpaths: 0, upgraded: 0 };
  const files = readdirSync(CORPUS, { recursive: true, encoding: 'utf8' }).filter((x) => x.endsWith('.svg')).sort().map((f) => [f, readFileSync(new URL(f, CORPUS), 'utf8')] as const);
  for (const [f, src] of [...files, ...EXTRA.map((d, i) => [`EXTRA[${i}]`, svgOf(d)] as const)]) {
    const r = parseDoc(src);
    if (!r.ok) continue;
    const doc = r.doc;
    for (const n of paths(doc)) {
      const a = findAttr(n, null, 'd');
      if (!a) continue;
      if (a.raw.includes('&') || cssSets(doc, n.id, 'd') !== 'no') {
        out.skipped++;
        continue;
      }
      const p = parsePath(a.raw);
      const abs = toAbsolute(p);
      for (const s of p.segs) {
        out.letters.add(s.cmd.toUpperCase());
        if (s.implicit) out.letters.add('implicit');
        if (s.cmd !== s.cmd.toUpperCase()) out.letters.add('relative');
      }
      if (p.segs.some((s) => s.implicit)) out.implicit++;
      if (new Set(abs.map((s) => s.sub)).size > 1) out.subpaths++;
      for (const h of pathNodes(doc, n.id)!.handles) {
        const plan = planNodeDrag(doc, n.id, h.id, { x: h.at.x + 3, y: h.at.y - 2 }, ONE);
        assert.ok(!('refused' in plan), `${f}: ${h.id} refused: ${'refused' in plan ? plan.refused : ''}`);
        const s = new Session(doc);
        s.dispatch('drag', (apply) => applyPlan(doc, plan, apply));
        const q = parsePath(findAttr(n, null, 'd')!.raw);
        const now = toAbsolute(q);
        const want = expected(p, abs, h.id, 3, -2);
        assert.equal(q.segs.length, p.segs.length, `${f}: ${h.id}`);
        assert.equal(q.tail, p.tail, `${f}: ${h.id}: the tail`);
        q.segs.forEach((seg, i) => {
          const was = p.segs[i];
          if (seg.cmd !== want.cmds[i]) {
            // only an H or V that would leave its row or column becomes an L (h, v an l)
            assert.ok('HV'.includes(was.cmd.toUpperCase()) && seg.cmd === (was.cmd === was.cmd.toUpperCase() ? 'L' : 'l'), `${f}: ${h.id}: segment ${i} ${was.cmd} became ${seg.cmd}`);
            const row = was.cmd.toUpperCase() === 'H' ? Math.abs(now[i].y - now[i].y0) : Math.abs(now[i].x - now[i].x0);
            assert.ok(row > 1e-9, `${f}: ${h.id}: segment ${i} became a line when it didn't have to`);
            out.upgraded++;
          }
          assert.ok(close(written(now[i], seg.cmd), want.pts[i]), `${f}: ${h.id}: segment ${i} (${was.raw.trim()} → ${seg.raw.trim()}) is ${written(now[i], seg.cmd)}, not ${want.pts[i]}`);
          // Bytes: a segment whose points, start and letter are unchanged keeps its raw (a space may keep a new number before it apart).
          const moved = !close(written(abs[i], was.cmd), want.pts[i]) || Math.abs(now[i].x0 - abs[i].x0) > 1e-9 || Math.abs(now[i].y0 - abs[i].y0) > 1e-9 || seg.cmd !== was.cmd || seg.implicit !== was.implicit;
          if (!moved) assert.ok(seg.raw === was.raw || seg.raw === ` ${was.raw}`, `${f}: ${h.id}: segment ${i} changed its bytes: ${JSON.stringify(was.raw)} → ${JSON.stringify(seg.raw)}`);
        });
        s.undo();
        assert.equal(serialize(doc), src, `${f}: ${h.id}: one undo gives the bytes back`);
        out.handles++;
      }
      out.paths++;
    }
  }
  swept = out;
  return out;
}

test('corpus property: every handle of every corpus path, moved by (3, −2), changes only the points its row names; relative segments keep every later point; H and V become L only when they must; every other segment keeps its bytes; one undo gives the file back', () => {
  const s = sweep();
  assert.ok(s.paths > 440 && s.handles > 7000, `${s.paths} paths, ${s.handles} handles`);
  assert.ok(s.upgraded > 0, 'some H or V had to become a line');
  assert.ok(s.skipped < 10, `${s.skipped} paths skipped (a reference, or CSS sets their d)`);
});

test('the sweep covers every command: M, L, H, V, Z, C, S, Q, T and A, relative letters, letter-less (implicit) segments and paths of several subpaths', () => {
  const s = sweep();
  for (const c of ['M', 'L', 'H', 'V', 'Z', 'C', 'S', 'Q', 'T', 'A', 'relative', 'implicit']) assert.ok(s.letters.has(c), `no ${c} in the sweep: ${[...s.letters]}`);
  assert.ok(s.implicit > 50 && s.subpaths > 50, `${s.implicit} paths with implicit segments, ${s.subpaths} with several subpaths`);
});

// ── the lab's numbers ──────────────────────────────────────────────────────────────────────────

test('the lab’s numbers: a bend drag writes Q with control 2·f − mid; a bend tap max(8k, 0.3·len) off the midpoint along the normal; an anchor drag moves C controls with it and not Q ones; the start drags its linked closing anchor', () => {
  const src = lab('paths.svg');
  // Dragged to (40, 45): 2·(40, 45) − (35, 52.5) = (45, 37.5), rounded half up.
  let doc = load(src);
  assert.equal(after(doc, planNodeDrag(doc, paths(doc)[0].id, 'b1', { x: 40, y: 45 }, ONE)), 'M 20 75\n   Q 45 38 50 30');
  doc = load(src);
  assert.equal(after(doc, planBendTap(doc, paths(doc)[0].id, 'b1', ONE)), 'M 20 75\n   Q 49 62 50 30', 'the tap: 0.3·len beats 8');
  doc = load(svgOf('M 0 0 H 10'));
  assert.equal(after(doc, planBendTap(doc, paths(doc)[0].id, 'b1', ONE)), 'M 0 0 Q 5 8 10 0', 'a short one: 8k beats 0.3·len; an H becomes Q');
  doc = load(svgOf('M 0 0 H 10'));
  assert.equal(after(doc, planBendTap(doc, paths(doc)[0].id, 'b1', { step: 0.1, k: 0.24 })), 'M 0 0 Q 5 3 10 0', 'k = 0.24: max(1.92, 3)');
  // The wave's middle anchor: its Q controls stay.
  doc = load(lab('create-logo.svg'));
  assert.equal(after(doc, planNodeDrag(doc, paths(doc)[0].id, 'a1', { x: 50, y: 49 }, ONE)), 'M 30 44\n   Q 40 32, 50 49\n   Q 60 56, 70 44');
  // The heart's second anchor: its C controls follow, incoming and outgoing, by the same delta.
  doc = load(lab('create-icon.svg'));
  assert.equal(after(doc, planNodeDrag(doc, paths(doc)[0].id, 'a1', { x: 30, y: 40 }, ONE)), 'M 50 40\n   C 50 32, 35 31, 30 40\n   C 25 48, 36 57, 50 70\n   C 64 57, 73 45, 68 37\n   C 63 28, 50 32, 50 40\n   Z');
  // The heart's start carries the linked last anchor (and both C controls on it).
  doc = load(lab('create-icon.svg'));
  assert.equal(after(doc, planNodeDrag(doc, paths(doc)[0].id, 'a0', { x: 53, y: 38 }, ONE)), 'M 53 38\n   C 53 30, 37 28, 32 37\n   C 27 45, 36 57, 50 70\n   C 64 57, 73 45, 68 37\n   C 63 28, 53 30, 53 38\n   Z');
  // A relative segment after the moved anchor keeps its end; an H after it that would leave its row becomes an L.
  doc = load(svgOf('M 0 0 L 10 10 l 5 0 H 30 m 5 5'));
  assert.equal(after(doc, planNodeDrag(doc, paths(doc)[0].id, 'a1', { x: 12, y: 8 }, ONE)), 'M 0 0 L 12 8 l 3 2 H 30 m 5 5');
  doc = load(svgOf('M 0 0 L 10 10 H 30'));
  assert.equal(after(doc, planNodeDrag(doc, paths(doc)[0].id, 'a1', { x: 12, y: 8 }, ONE)), 'M 0 0 L 12 8 L 30 10');
  // A control drag: an S after it follows (its implied control is the mirror).
  doc = load(lab('arcs--smooth.svg'));
  assert.equal(after(doc, planNodeDrag(doc, paths(doc)[0].id, 'c1', { x: 40, y: 25 }, ONE)), 'M 10 55\n   C 22 20, 40 25, 50 55\n   S 78 90, 90 55');
  // What nodes.ts refuses: a d set by CSS, a d written with a reference.
  doc = load('<svg xmlns="http://www.w3.org/2000/svg"><path style="d: path(\'M 0 0 L 1 1\')" d="M 0 0 L 5 5"/></svg>');
  assert.match((planNodeDrag(doc, paths(doc)[0].id, 'a1', { x: 1, y: 1 }, ONE) as { refused: string }).refused, /set by CSS/);
  doc = load('<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 L 5 &#53;"/></svg>');
  assert.match((planNodeDrag(doc, paths(doc)[0].id, 'a1', { x: 1, y: 1 }, ONE) as { refused: string }).refused, /entity references/);
});

// ── node types, Close and Open ─────────────────────────────────────────────────────────────────

test('Make smooth and Make corner on the three forms: C → S and back, Q → T and back, a relative c → s; only the dropped control moves (to the mirror), and a T after it is written out', () => {
  const d = 'M 10 55\n   C 22 20, 40 20, 50 55\n   S 78 90, 90 55';
  const p = parsePath(d);
  assert.equal(nodeType(p, 1), 'smooth', 'an S after a C');
  const corner = makeCorner(d, 1);
  assert.equal(corner, 'M 10 55\n   C 22 20, 40 20, 50 55\n   C 60 90, 78 90, 90 55', 'the implied control written out: nothing moves');
  assert.equal(nodeType(parsePath(corner), 1), 'corner');
  assert.equal(makeSmooth(corner, 1), d, 'and back, byte for byte');
  // A C → S whose first control wasn't the mirror: that control moves to the mirror, nothing else.
  const bent = 'M 0 0 C 0 10, 10 10, 20 0 C 25 -5, 30 -10, 40 0';
  const sm = makeSmooth(bent, 1);
  assert.equal(sm, 'M 0 0 C 0 10, 10 10, 20 0 S 30 -10, 40 0');
  assert.deepEqual(toAbsolute(parsePath(sm))[2], { ...toAbsolute(parsePath(bent))[2], cmd: 'S', x1: 30, y1: -10 });
  // Q → T and back; a T after the new T would change, so it is written out.
  const qq = 'M 0 0 Q 10 20 20 0 Q 25 -10 40 0 T 60 0';
  assert.equal(nodeType(parsePath(qq), 1), 'corner');
  const qt = makeSmooth(qq, 1);
  // The new T's control is the mirror (30, −20); the T after it implied (55, 10) and would imply (50, 20): written out as that Q.
  assert.equal(qt, 'M 0 0 Q 10 20 20 0 T 40 0 Q 55 10 60 0');
  assert.equal(makeCorner(qt, 1), 'M 0 0 Q 10 20 20 0 Q 30 -20 40 0 Q 55 10 60 0', 'and back to a corner: the mirror written out, nothing moves');
  // Relative: c → s keeps its own numbers (the second control and the end, from the same start).
  const rel = 'm 10 55 c 12 -35 30 -35 40 0 c 10 35 28 35 40 0';
  assert.equal(makeSmooth(rel, 1), 'm 10 55 c 12 -35 30 -35 40 0 s 28 35 40 0');
  assert.equal(makeCorner(makeSmooth(rel, 1), 1), rel);
  // No toggle where neither form applies: an L into a C, an end with nothing after it, a Q into a C.
  for (const [x, k] of [['M 0 0 L 10 0 C 20 0 30 10 40 0', 1], ['M 0 0 C 1 1 2 2 3 3', 1], ['M 0 0 Q 1 1 2 2 C 3 3 4 4 5 5', 1]] as const) assert.equal(nodeType(parsePath(x), k), null, x);
  assert.throws(() => makeSmooth('M 0 0 L 10 0 C 20 0 30 10 40 0', 1), TokenEditError);
});

test('Close and Open: Close appends “ Z” after the last segment, before its trailing whitespace (an implicit last segment too); Open takes the final Z away with the separators before it; only the last subpath', () => {
  assert.equal(closeLast('M 0 0 L 10 0 L 10 10'), 'M 0 0 L 10 0 L 10 10 Z');
  assert.equal(closeLast('M 0 0 L 10 0 L 10 10\n  '), 'M 0 0 L 10 0 L 10 10 Z\n  ', 'the trailing whitespace stays last');
  assert.equal(closeLast('M 0 0 10 0 10 10'), 'M 0 0 10 0 10 10 Z', 'after an implicit segment');
  assert.equal(closeLast('M 0 0 L 5 5 Z M 20 20 L 30 30'), 'M 0 0 L 5 5 Z M 20 20 L 30 30 Z', 'the last subpath');
  assert.equal(openLast('M 0 0 L 10 0 L 10 10 Z'), 'M 0 0 L 10 0 L 10 10');
  assert.equal(openLast('M 0 0 L 10 0 L 10 10\n   Z\n'), 'M 0 0 L 10 0 L 10 10\n', 'with the line break before it');
  assert.equal(openLast(closeLast('M 0 0 L 10 0 L 10 10\n  ')), 'M 0 0 L 10 0 L 10 10\n  ', 'Close then Open: the bytes back');
  assert.throws(() => closeLast('M 0 0 L 1 1 Z'), /closed already/);
  assert.throws(() => openLast('M 0 0 L 1 1'), /open already/);
  // The heart: open, then closed again, byte for byte.
  const heart = parsePath('M 50 40 C 50 32, 37 28, 32 37 C 27 45, 36 57, 50 70 C 64 57, 73 45, 68 37 C 63 28, 50 32, 50 40 Z');
  const d = heart.segs.map((s) => s.raw).join('');
  assert.equal(closeLast(openLast(d)), d);
});
