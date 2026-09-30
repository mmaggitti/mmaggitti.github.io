// engine/path/segments: the letter cycle (SVG Lab's setSeg), Relative/Absolute, Reverse, and the rule every M3
// write to d follows: only the named segments' text changes, everything else byte for byte, and the
// absolute geometry is what the edit says (toAbsolute, within 1e-9).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { attrValue, descendants, findAttr, parseDoc, serialize, type Doc, type ElementNode } from '../../model/doc.ts';
import { Session } from '../../commands/session.ts';
import { opSetAttrRaw } from '../../commands/ops.ts';
import { argSpans, parsePath } from '../../path/parse.ts';
import { toAbsolute, type AbsSeg } from '../../path/abs.ts';
import { cycleSegment, readsRelative, reverseSubpath, subpathCount, toggleRelative, REFERENCES } from '../../path/segments.ts';
import { evaluator } from './helpers.ts';
import { TokenEditError } from '../../code/edit.ts';

const CORPUS = new URL('../fixtures/corpus/', import.meta.url);
const lab = (f: string): string => readFileSync(new URL(`lab/${f}`, CORPUS), 'utf8');
const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.doc;
};
const firstPath = (doc: Doc): ElementNode => [...descendants(doc, doc.root)].find((n): n is ElementNode => n.kind === 'element' && n.local === 'path')!;
const dOf = (src: string): string => findAttr(firstPath(load(src)), null, 'd')!.raw;
const ONE = { step: 1, k: 1 };

/** Every <path d> of the corpus (not written with references), with its file. */
function corpusPaths(): { file: string; d: string }[] {
  const out: { file: string; d: string }[] = [];
  for (const f of readdirSync(CORPUS, { recursive: true, encoding: 'utf8' }).filter((x) => x.endsWith('.svg')).sort()) {
    const r = parseDoc(readFileSync(new URL(f, CORPUS), 'utf8'));
    if (!r.ok) continue;
    for (const n of descendants(r.doc, r.doc.root)) {
      if (n.kind !== 'element' || n.local !== 'path') continue;
      const a = findAttr(n, null, 'd');
      if (a && !a.raw.includes('&')) out.push({ file: f, d: a.raw });
    }
  }
  return out;
}

/** Each segment's written points in absolute form: the end, and the controls its letter writes (not an S's or T's implied one). */
function written(abs: readonly AbsSeg[], cmds: readonly string[]): number[][] {
  return abs.map((s, i) => {
    const U = cmds[i].toUpperCase();
    const pts = s.type === 'Z' ? [] : [s.x, s.y];
    if (s.type === 'C') pts.push(...(U === 'C' ? [s.x1, s.y1, s.x2, s.y2] : [s.x2, s.y2]));
    if (s.type === 'Q' && U === 'Q') pts.push(s.x1, s.y1);
    if (s.type === 'A') pts.push(s.rx, s.ry, s.rot, Number(s.large), Number(s.sweep));
    return pts;
  });
}
const close = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1e-9);
/** The same drawing: every segment's type, end, controls (implied ones too) and arc within 1e-9. */
function sameGeometry(a: readonly AbsSeg[], b: readonly AbsSeg[]): boolean {
  const flat = (s: AbsSeg) => [s.x, s.y, ...(s.type === 'C' ? [s.x1, s.y1, s.x2, s.y2] : s.type === 'Q' ? [s.x1, s.y1] : s.type === 'A' ? [s.rx, s.ry, s.rot, +s.large, +s.sweep] : [])];
  return a.length === b.length && a.every((s, i) => s.type === b[i].type && close(flat(s), flat(b[i])));
}

// ── the letter cycle ───────────────────────────────────────────────────────────────────────────

test('the letter cycle on lab/paths.svg at step 1: L → Q is SVG Lab’s setSeg exactly, Q → C its ⅔ elevation rounded, C → L the file back byte for byte; one undo each', () => {
  const src = lab('paths.svg');
  const doc = load(src);
  const path = firstPath(doc);
  const s = new Session(doc);
  const set = (raw: string) => s.dispatch('Set segment', (apply) => apply(opSetAttrRaw(doc, path.id, null, 'd', raw)));
  const d0 = findAttr(path, null, 'd')!.raw;
  assert.equal(d0, 'M 20 75\n   L 50 30');
  // d = (30, −45), len = √2925, n·off = (45, 30)/len · 0.3·len = (13.5, 9): (48.5, 61.5) rounds half up to (49, 62).
  const q = cycleSegment(d0, 1, ONE);
  assert.equal(q, 'M 20 75\n   Q 49 62 50 30', 'the end keeps its text, the control is on the normal, one space apart');
  set(q);
  // c1 = (20, 75) + ⅔(29, −13) = (39.33, 66.33), c2 = (50, 30) + ⅔(−1, 32) = (49.33, 51.33).
  const c = cycleSegment(q, 1, ONE);
  assert.equal(c, 'M 20 75\n   C 39 66 49 51 50 30');
  set(c);
  const l = cycleSegment(c, 1, ONE);
  assert.equal(l, d0, 'C → L drops the controls: the file’s own bytes');
  set(l);
  assert.equal(serialize(doc), src);
  for (const want of [c, q, d0]) {
    s.undo();
    assert.equal(findAttr(path, null, 'd')!.raw, want === d0 ? d0 : want === q ? q : c);
  }
  s.undo();
  assert.equal(serialize(doc), src, 'three undos, three entries');
});

test('Q → C on lab/create-logo.svg’s first segment keeps the lab’s comma spelling; the next Q is untouched', () => {
  const d = dOf(lab('create-logo.svg'));
  assert.equal(d, 'M 30 44\n   Q 40 32, 50 44\n   Q 60 56, 70 44');
  // c1 = (30, 44) + ⅔(10, −12) = (36.67, 36), c2 = (50, 44) + ⅔(−10, −12) = (43.33, 36).
  assert.equal(cycleSegment(d, 1, ONE), 'M 30 44\n   C 37 36, 43 36, 50 44\n   Q 60 56, 70 44');
});

test('a relative l → q → c → l stays relative, its new numbers offsets from its start, and gives its bytes back', () => {
  const d = 'M 10 10 l 20 0 L 50 50';
  const q = cycleSegment(d, 1, ONE);
  // From (10, 10) to (30, 10): the midpoint (20, 10), n = (0, 1), off = max(8, 6) = 8: control (20, 18), offset (10, 8).
  assert.equal(q, 'M 10 10 q 10 8 20 0 L 50 50');
  const c = cycleSegment(q, 1, ONE);
  assert.ok(/^M 10 10 c [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ 20 0 L 50 50$/.test(c), c);
  assert.equal(cycleSegment(c, 1, ONE), d);
  for (const x of [q, c]) assert.deepEqual(toAbsolute(parsePath(x)).map((s) => [s.x, s.y]), toAbsolute(parsePath(d)).map((s) => [s.x, s.y]), 'every end stays');
  // On a 24-unit board k = 0.24: the least offset is 1.92, not 8.
  assert.equal(cycleSegment('M 0 0 L 2 0', 1, { step: 0.1, k: 0.24 }), 'M 0 0 Q 1 1.9 2 0');
});

test('an implicit segment that followed the cycled one gets its old letter written, so it keeps meaning what it meant', () => {
  assert.equal(cycleSegment('M 0 0 L 10 10 20 20', 1, ONE), 'M 0 0 Q -1 11 10 10 L 20 20');
  assert.equal(cycleSegment('M0,0L10,10,20,20', 1, ONE), 'M0,0Q-1 11, 10 10 L 20,20', 'a comma before a letter would be an error: the letter gets a space');
  // The implicit L of an M: after M it is L; cycling the M's line isn't possible (no letter), but an implicit Q cycles and gets its letter.
  assert.equal(cycleSegment('M 0 0 Q 5 5 10 0 15 -5 20 0', 2, ONE), 'M 0 0 Q 5 5 10 0 C 13 -3 17 -3 20 0');
});

test('a following S or T whose implied control would change is written out (S → C, T → Q), so it keeps its shape', () => {
  const d = dOf(lab('arcs--smooth.svg'));
  assert.equal(d, 'M 10 55\n   C 22 20, 40 20, 50 55\n   S 78 90, 90 55');
  const cToL = cycleSegment(d, 1, ONE);
  assert.equal(cToL, 'M 10 55\n   L 50 55\n   C 60 90, 78 90, 90 55', 'C → L: the S becomes the C it drew, its first control (60, 90) written');
  assert.ok(sameGeometry(toAbsolute(parsePath(cToL)).slice(2), toAbsolute(parsePath(d)).slice(2)), 'the second curve is unchanged');
  // Q → C before a T: after a C, a T would imply its start, so it is written out as the Q it drew.
  const t = 'M 0 0 Q 10 20 20 0 T 40 0';
  const out = cycleSegment(t, 1, ONE);
  assert.equal(out, 'M 0 0 C 7 13 13 13 20 0 Q 30 -20 40 0');
  assert.ok(sameGeometry(toAbsolute(parsePath(out)).slice(2), toAbsolute(parsePath(t)).slice(2)));
});

test('the letter cycle over every corpus path: each written L, Q and C cycled keeps every other segment’s bytes and every end point, and three cycles give back an L with its own end numbers', () => {
  let cycled = 0;
  let lines = 0;
  for (const { file, d } of corpusPaths()) {
    const p = parsePath(d);
    const abs = toAbsolute(p);
    p.segs.forEach((seg, i) => {
      if (seg.implicit || !'LQC'.includes(seg.cmd.toUpperCase())) return;
      let out: string;
      try {
        out = cycleSegment(d, i, ONE);
      } catch (e) {
        assert.ok(e instanceof TokenEditError, `${file}: ${String(e)}`);
        return;
      }
      const q = parsePath(out);
      const now = toAbsolute(q);
      assert.equal(q.segs.length, p.segs.length, `${file}: segment ${i}`);
      assert.equal(q.tail, p.tail);
      now.forEach((s, j) => {
        assert.ok(Math.abs(s.x - abs[j].x) <= 1e-9 && Math.abs(s.y - abs[j].y) <= 1e-9, `${file}: segment ${j}'s end moved when ${i} cycled`);
        if (j === i) return;
        if (j === i + 1 && q.segs[j].cmd !== p.segs[j].cmd && !p.segs[j].implicit) {
          // a following S or T written out as the C or Q it drew
          assert.ok(sameGeometry([s], [abs[j]]), `${file}: the written-out segment ${j} changed shape`);
          return;
        }
        // a letter-less segment after one whose letter changed gets its own letter, and draws what it drew
        if (p.segs[j].implicit && !q.segs[j].implicit && q.segs[j - 1].cmd !== p.segs[j - 1].cmd) return assert.ok(sameGeometry([s], [abs[j]]), `${file}: segment ${j}`);
        // (right after the cycled segment, a space may keep a new number from gluing to it)
        const was = j === i + 1 && q.segs[j].raw === ` ${p.segs[j].raw}` ? q.segs[j].raw : p.segs[j].raw;
        assert.equal(q.segs[j].raw, was, `${file}: segment ${j} kept its bytes`);
        assert.ok(sameGeometry([s], [abs[j]]), `${file}: segment ${j} changed`);
      });
      if (seg.cmd.toUpperCase() === 'L') {
        // L → Q → C → L: an L again, ending on its own number texts.
        const back = parsePath(cycleSegment(cycleSegment(out, i, ONE), i, ONE)).segs[i];
        const ends = (x: typeof seg) => argSpans(x).map((sp) => x.raw.slice(sp.start, sp.end));
        assert.equal(back.cmd, seg.cmd, `${file}: segment ${i} is an ${seg.cmd} again`);
        assert.deepEqual(ends(back), ends(seg), `${file}: segment ${i}'s numbers`);
        lines++;
      }
      cycled++;
    });
  }
  assert.ok(cycled > 900 && lines > 300, `only ${cycled} letters cycled, ${lines} of them L`);
});

// ── Relative and Absolute ──────────────────────────────────────────────────────────────────────

test('Make relative on lab/arcs--smooth.svg writes the lab’s relative spelling exactly; Make absolute gives the file back byte for byte; a relative anchor edited shifts what follows', () => {
  const d = dOf(lab('arcs--smooth.svg'));
  assert.equal(readsRelative(parsePath(d)), false, 'it reads Relative: the toggle makes it relative');
  const rel = toggleRelative(d);
  assert.equal(rel, 'm 10 55\n   c 12 -35, 30 -35, 40 0\n   s 28 35, 40 0', 'every written letter lowercase, the first m too; separators and newlines kept');
  assert.equal(readsRelative(parsePath(rel)), true);
  assert.ok(sameGeometry(toAbsolute(parsePath(rel)), toAbsolute(parsePath(d))), 'the drawing is unchanged');
  assert.equal(toggleRelative(rel), d, 'Make absolute: the file’s own text');
  // The c's end x 40 → 45 (a Number-sheet edit in the relative file) moves the S's end to x 95, then Absolute.
  const moved = rel.replace('40 0\n', '45 0\n');
  assert.equal(toAbsolute(parsePath(moved))[2].x, 95);
  assert.equal(toggleRelative(moved), 'M 10 55\n   C 22 20, 40 20, 55 55\n   S 83 90, 95 55');
});

test('Relative and Absolute on mixed letters, implicit segments, arcs (radii, rotation and flags kept), H, V, h, v, several subpaths and decimals', () => {
  // [as written, Make relative, then Make absolute]
  const cases: [string, string, string][] = [
    ['M 10 10 L 20 20 l 5 5 H 40 v 10', 'm 10 10 l 10 10 l 5 5 h 15 v 10', 'M 10 10 L 20 20 L 25 25 H 40 V 35'], // a mix reads Relative
    ['M 10 10 20 20 30 10', 'm 10 10 10 10 10 -10', 'M 10 10 20 20 30 10'], // implicit segments follow their command's new case
    ['M 10 50 A 30 20 15 0 1 70 50 a 5 5 0 1 0 10 0', 'm 10 50 a 30 20 15 0 1 60 0 a 5 5 0 1 0 10 0', 'M 10 50 A 30 20 15 0 1 70 50 A 5 5 0 1 0 80 50'],
    ['M 0 0 L 10 0 L 10 10 Z M 20 20 L 30 20 Z m 5 5 l 1 1', 'm 0 0 l 10 0 l 0 10 z m 20 20 l 10 0 z m 5 5 l 1 1', 'M 0 0 L 10 0 L 10 10 Z M 20 20 L 30 20 Z M 25 25 L 26 26'], // m after z: from the subpath's start
    ['M 20.25 0.5 L 40 10.5 L 0.5 0', 'm 20.25 0.5 l 19.75 10 l -39.5 -10.5', 'M 20.25 0.5 L 40 10.5 L 0.5 0'], // offsets in 2 places: exact
    ['M 5 5 V 20 H 0', 'm 5 5 v 15 h -5', 'M 5 5 V 20 H 0'],
    ['m64 20 4.2 8.6 9.4 1.4-6.8 6.6z', 'm64 20 4.2 8.6 9.4 1.4-6.8 6.6z', 'M64 20 68.2 28.6 77.6 30 70.8 36.6Z'], // svgo's: reads relative; a sign that glued stays apart
  ];
  for (const [src, rel, abs] of cases) {
    const r = readsRelative(parsePath(src)) ? src : toggleRelative(src);
    assert.equal(r, rel, src);
    assert.ok(sameGeometry(toAbsolute(parsePath(rel)), toAbsolute(parsePath(src))), `${src}: the drawing`);
    assert.equal(toggleRelative(rel), abs, `${rel}: Make absolute`);
    assert.ok(sameGeometry(toAbsolute(parsePath(abs)), toAbsolute(parsePath(src))), `${abs}: the drawing`);
  }
  assert.equal(toggleRelative('M 0 0 l 10 10 L 20 20'), 'm 0 0 l 10 10 l 10 10', 'a mix reads Relative: it is made relative');
  assert.throws(() => toggleRelative('M 0 0 L &#49;0 10'), (e) => e instanceof TokenEditError && e.message === REFERENCES);
});

test('Relative and Absolute over every corpus path: the drawing is unchanged within 1e-9, only letters’ case and numbers change, and the second toggle reads back the first’s case', () => {
  let n = 0;
  for (const { file, d } of corpusPaths()) {
    let rel: string;
    try {
      rel = toggleRelative(d);
    } catch (e) {
      assert.ok(e instanceof TokenEditError, `${file}: ${String(e)}`);
      continue;
    }
    const a = parsePath(d);
    const b = parsePath(rel);
    assert.ok(sameGeometry(toAbsolute(b), toAbsolute(a)), `${file}: ${d.slice(0, 60)} → ${rel.slice(0, 60)}`);
    assert.equal(b.segs.length, a.segs.length);
    assert.equal(b.tail, a.tail, `${file}: the tail`);
    b.segs.forEach((s, i) => {
      assert.equal(s.implicit, a.segs[i].implicit, `${file}: segment ${i} keeps its letter or its lack of one`);
      assert.equal(s.cmd.toUpperCase(), a.segs[i].cmd.toUpperCase());
    });
    const back = toggleRelative(rel);
    assert.ok(sameGeometry(toAbsolute(parsePath(back)), toAbsolute(a)), `${file}: back`);
    n++;
  }
  assert.ok(n > 400, `only ${n} paths`);
});

// ── Reverse ────────────────────────────────────────────────────────────────────────────────────

const HOLE_IN = 'M 43.3 42 A 9 9 0 1 1 56.7 42 L 61 66 L 39 66 Z';
const HOLE_REV = 'M 43.3 42 L 39 66 L 61 66 L 56.7 42 A 9 9 0 1 0 43.3 42 Z'; // SVG Lab's (index.html, LabArcs)

test('Reverse on lab/arcs--holes.svg’s inner subpath gives SVG Lab’s HOLE_REV exactly, every other byte of the file unchanged; a second Reverse gives the file back byte for byte; one undo each', () => {
  const src = lab('arcs--holes.svg');
  const doc = load(src);
  const path = firstPath(doc);
  const s = new Session(doc);
  const d0 = findAttr(path, null, 'd')!.raw;
  assert.ok(d0.endsWith(`\n   ${HOLE_IN}`));
  const rev = reverseSubpath(d0, 1);
  assert.equal(rev, d0.replace(HOLE_IN, HOLE_REV), 'the closing line first, the arc last with its sweep flipped');
  s.dispatch('Reverse', (apply) => apply(opSetAttrRaw(doc, path.id, null, 'd', rev)));
  assert.equal(serialize(doc), src.replace(HOLE_IN, HOLE_REV), 'nothing else in the file changes');
  const back = reverseSubpath(rev, 1);
  assert.equal(back, d0, 'a second Reverse: the file’s own text');
  s.dispatch('Reverse', (apply) => apply(opSetAttrRaw(doc, path.id, null, 'd', back)));
  assert.equal(serialize(doc), src);
  s.undo();
  assert.equal(serialize(doc), src.replace(HOLE_IN, HOLE_REV));
  s.undo();
  assert.equal(serialize(doc), src);
  // Every subpath (no chosen node): the outer ring turns too, its order and newlines kept.
  assert.equal(reverseSubpath(d0, null), 'M 14 50 A 36 36 0 1 0 86 50\n   A 36 36 0 1 0 14 50 Z\n   ' + HOLE_REV);
});

test('Reverse on open and closed subpaths: L, H and V stay, C swaps its controls, Q keeps its control, A flips its sweep, S and T are written out with their implied controls; relative segments stay relative; a relative m after an open subpath keeps its point', () => {
  // [as written, subpath, reversed]
  const cases: [string, number | null, string][] = [
    ['M 10 10 L 20 10 H 30 V 20 Q 40 30 50 20 C 60 10 70 10 80 20', 0, 'M 80 20 C 70 10 60 10 50 20 Q 40 30 30 20 V 10 H 20 L 10 10'],
    // closed: the closing line (100 0 → 0 0) comes first, reversed; the S's implied control (80, −10) and the T's (30, 10) are written out
    ['M 0 0 Q 10 -10 20 0 T 40 0 C 50 10 60 10 70 0 S 90 -10 100 0 Z', 0, 'M 0 0 L 100 0 C 90 -10 80 -10 70 0 C 60 10 50 10 40 0 Q 30 10 20 0 Q 10 -10 0 0 Z'],
    // relative, closed: the first line is left to the z, which draws it
    ['m 10 10 l 10 0 l 0 10 z', 0, 'm 10 10 l 10 10 l 0 -10 z'],
    ['M 0 0 a 10 10 0 0 1 20 0', 0, 'M 20 0 a 10 10 0 0 0 -20 0'],
    ['M 0 0 L 10 0 m 5 5 l 1 1', 0, 'M 10 0 L 0 0 m 15 5 l 1 1'],
    ['M 0 0 L 10 0 m 5 5 l 1 1', 1, 'M 0 0 L 10 0 m 6 6 l -1 -1'],
    ['M 0 0 L 10 0 L 10 10 Z', 0, 'M 0 0 L 10 10 L 10 0 Z'],
    ['M0,0 L10,0 C20,0 20,10 30,10', null, 'M30 10 C20 10, 20 0, 10 0 L0 0'], // commas: SVG Lab's spelling (§5.1), each letter still glued
    ['M 0 0 10 0 10 10 Z', 0, 'M 0 0 L 10 10 L 10 0 Z'], // letter-less segments get their letter
  ];
  // A second Reverse gives the text back, except what the first wrote out: S and T as C and Q, a letter-less segment's letter.
  const twice: Record<string, string> = {
    'M 0 0 Q 10 -10 20 0 T 40 0 C 50 10 60 10 70 0 S 90 -10 100 0 Z': 'M 0 0 Q 10 -10 20 0 Q 30 10 40 0 C 50 10 60 10 70 0 C 80 -10 90 -10 100 0 Z',
    'M 0 0 10 0 10 10 Z': 'M 0 0 L 10 0 L 10 10 Z',
    'M0,0 L10,0 C20,0 20,10 30,10': 'M0 0 L10 0 C20 0, 20 10, 30 10',
  };
  for (const [d, sub, want] of cases) {
    const got = reverseSubpath(d, sub);
    assert.equal(got, want, d);
    assert.equal(reverseSubpath(got, sub), twice[d] ?? d, `${d}: a second Reverse`);
  }
  assert.throws(() => reverseSubpath('M 5 5', 0), (e) => e instanceof TokenEditError && /no segment to reverse/.test(e.message));
  assert.throws(() => reverseSubpath('M 0 0 L &#49;0 10', 0), (e) => e instanceof TokenEditError && e.message === REFERENCES);
});

/** A subpath's points, sampled (each segment at t = ¼, ½, ¾ and 1 after its start, a Z's closing line too), without repeats. */
function samples(abs: readonly AbsSeg[], sub: number): [number, number][] {
  const out: [number, number][] = [];
  const add = (p: [number, number]) => {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-7 || Math.abs(q[1] - p[1]) > 1e-7) out.push(p);
  };
  for (const s of abs) {
    if (s.sub !== sub) continue;
    if (s.type === 'M') {
      add([s.x, s.y]);
      continue;
    }
    if (!out.length) add([s.x0, s.y0]);
    const f = evaluator(s);
    for (const t of [0.25, 0.5, 0.75, 1]) add(f(t));
  }
  return out;
}
const samePoints = (a: readonly [number, number][], b: readonly [number, number][]) => a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) <= 1e-6 && Math.abs(p[1] - b[i][1]) <= 1e-6);

test('Reverse over every subpath of every corpus path: the subpath draws the same points the other way round, every other segment keeps its bytes and its geometry (a relative m after it compensated), and a second Reverse draws the original', () => {
  let n = 0;
  let skipped = 0;
  for (const { file, d } of corpusPaths()) {
    const p = parsePath(d);
    const abs = toAbsolute(p);
    for (let sub = 0; sub < subpathCount(abs); sub++) {
      const idx = abs.flatMap((s, i) => (s.sub === sub ? [i] : []));
      if (!abs.some((s) => s.sub === sub && s.type !== 'M' && s.type !== 'Z')) {
        assert.throws(() => reverseSubpath(d, sub), TokenEditError);
        skipped++;
        continue;
      }
      const rev = reverseSubpath(d, sub);
      const q = parsePath(rev);
      const qa = toAbsolute(q);
      const at = `${file}: ${d.slice(0, 50)}… subpath ${sub}`;
      const first = idx[0];
      const after = p.segs.length - idx[idx.length - 1] - 1;
      assert.equal(q.tail, p.tail, `${at}: the tail`);
      assert.equal(subpathCount(qa), subpathCount(abs), `${at}: the subpaths`);
      // Before it: the same bytes. After it: the same bytes (a compensated m keeps its point) and the same geometry.
      for (let i = 0; i < first; i++) assert.equal(q.segs[i].raw, p.segs[i].raw, `${at}: segment ${i}`);
      for (let k = 1; k <= after; k++) {
        const a = p.segs[p.segs.length - k];
        const b = q.segs[q.segs.length - k];
        const ga = abs[abs.length - k];
        const gb = qa[qa.length - k];
        assert.ok(Math.abs(ga.x - gb.x) <= 1e-9 && Math.abs(ga.y - gb.y) <= 1e-9, `${at}: ${a.raw.trim()} → ${b.raw.trim()} moved`);
        if (!(k === after && a.cmd === 'm')) assert.equal(b.raw, a.raw, `${at}: a segment after it changed its bytes`);
      }
      // Its points, backwards.
      assert.ok(samePoints(samples(qa, sub), samples(abs, sub).reverse()), `${at}: ${rev.slice(0, 120)}`);
      for (let o = 0; o < subpathCount(abs); o++) if (o !== sub) assert.ok(samePoints(samples(qa, o), samples(abs, o)), `${at}: subpath ${o} moved`);
      const again = toAbsolute(parsePath(reverseSubpath(rev, sub)));
      assert.ok(samePoints(samples(again, sub), samples(abs, sub)), `${at}: a second Reverse`);
      n++;
    }
  }
  assert.ok(n > 700, `only ${n} subpaths reversed (${skipped} had nothing to reverse)`);
});
