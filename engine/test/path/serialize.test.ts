// engine/path/serialize: untouched paths are byte-identical, and editArg rewrites exactly one
// segment, keeping it apart from glued neighbours.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, isFlag } from '../../path/parse.ts';
import { serializePath, editArg } from '../../path/serialize.ts';
import { fmt } from '../../values/number-format.ts';
import { corpus, pick, rng } from './helpers.ts';

const edit = (d: string, seg: number, arg: number, v: number, decimals?: number) => serializePath(editArg(parsePath(d), seg, arg, v, decimals));

test('editArg rewrites one segment and keeps its separators, letter and comma style', () => {
  assert.equal(edit('M10,20 L30,40 L50,60', 1, 0, 33.3333), 'M10,20 L33.333,40 L50,60');
  assert.equal(edit('M10 20\n  L 30 40', 1, 1, -4), 'M10 20\n  L 30 -4');
  assert.equal(edit('M1 2C3,4 5,6 7,8', 1, 2, 9), 'M1 2C3,4 9,6 7,8');
  assert.equal(edit('M1 2C3 4,5 6,7 8', 1, 5, 0), 'M1 2C3 4,5 6,7 0');
  assert.equal(edit('M0 0 L1 1 2 2', 2, 0, 5), 'M0 0 L1 1 5 2', 'implicit segment keeps its implicit form');
  assert.equal(edit('M0 0a1 1 0 0110 10', 1, 4, 0), 'M0 0a1 1 0 0 0 10 10', 'packed flags come apart');
  assert.equal(edit('M0 0a1 1 0 0110 10', 1, 5, 7), 'M0 0a1 1 0 0 1 7 10');
  assert.equal(edit('M0 0 L+.50 1E2', 1, 1, 3), 'M0 0 L+.50 3', 'untouched numbers keep their source text');
  assert.equal(edit('M0 0 L1 1', 1, 0, 1.23456, 1), 'M0 0 L1.2 1');
  assert.equal(edit('M0 0 z', 0, 1, 7), 'M0 7 z');
  assert.equal(edit('M0 0 L1 1 x', 1, 0, 2), 'M0 0 L2 1 x', 'the tail stays');
});

test('editArg keeps glued neighbours apart', () => {
  // Implicit segment glued to the previous number: "1-2" must not become "12".
  assert.equal(edit('M0 0L1-1-2-3', 2, 0, 5), 'M0 0L1-1 5 -3');
  assert.deepEqual(parsePath(edit('M0 0L1-1-2-3', 2, 0, 5)).segs.map((s) => s.args), [[0, 0], [1, -1], [5, -3]]);
  assert.equal(edit('M0 0L1-1-2-3', 2, 0, -5), 'M0 0L1-1-5 -3', 'a sign needs no separator');
  // The next segment starts with '.': "2" + ".5" must not become "2.5".
  const d = 'M0 0L1 1.5.5.5';
  assert.deepEqual(parsePath(edit(d, 1, 1, 2)).segs.map((s) => s.args), [[0, 0], [1, 2], [0.5, 0.5]]);
  assert.deepEqual(parsePath(edit(d, 1, 1, 2.25)).segs.map((s) => s.args), [[0, 0], [1, 2.25], [0.5, 0.5]]);
  // Same with the tail.
  const t = parsePath('M0 0 L1 1.5.5x');
  assert.equal(t.tail, '.5x');
  const e = parsePath(serializePath(editArg(t, 1, 1, 3)));
  assert.deepEqual(e.segs.map((s) => s.args), [[0, 0], [1, 3]]);
  assert.equal(e.tail.trim(), '.5x');
  // A segment edited twice regenerates cleanly.
  const once = editArg(parsePath(d), 1, 1, 2);
  assert.equal(serializePath(editArg(once, 1, 1, 4)), 'M0 0L1 4 .5.5');
});

test('editArg keeps an error tail apart and moves its position', () => {
  // The last number's exponent stopped at a second 'e': the tail must not become the new number's.
  const cases: [string, number, number, number, string][] = [
    ['M0 0 L1 1e2E-1 L9 9', 1, 1, 5, 'M0 0 L1 5 E-1 L9 9'],
    ['M0 0 L1 1e2e3', 1, 1, 5, 'M0 0 L1 5 e3'],
    ['M0 0 H1e1e1', 1, 0, 2, 'M0 0 H2 e1'],
    ['M0 0 L1 1 x', 1, 0, 123.456, 'M0 0 L123.456 1 x'],
  ];
  for (const [d, si, ai, v, want] of cases) {
    const p = parsePath(d);
    const q = editArg(p, si, ai, v);
    assert.equal(serializePath(q), want);
    const again = parsePath(want);
    assert.deepEqual(again.segs.map((s) => s.args), q.segs.map((s) => s.args), d);
    assert.deepEqual(again.error, q.error, `${d}: error position follows the edit`);
    assert.equal(again.tail.trimStart(), p.tail.trimStart(), d);
  }
});

test('fuzz: edits of compact paths with error tails keep the model and the text in step', () => {
  const r = rng(11);
  const tokens = ['M', 'L', 'H', 'C', 'A', 'l', 'a', 'z', '0', '1', '12', '.5', '-3', '1e2', 'e1', 'E-1', 'e', '.', ' ', ' ', ',', 'x'];
  let tails = 0;
  for (let n = 0; n < 8000; n++) {
    let d = 'M0 0';
    for (let k = Math.floor(r() * 16); k > 0; k--) d += pick(r, tokens);
    const p = parsePath(d);
    const si = Math.floor(r() * p.segs.length);
    const seg = p.segs[si];
    if (!seg?.args.length) continue; // 'M0 0.' keeps no segment
    const ai = Math.floor(r() * seg.args.length);
    const value = isFlag(seg.cmd, ai) ? (seg.args[ai] ? 0 : 1) : pick(r, [5, -2, 0.25, 123.456, 0]);
    const q = editArg(p, si, ai, value);
    const out = serializePath(q);
    const again = parsePath(out);
    assert.deepEqual(again.segs.map((s) => s.args), q.segs.map((s) => s.args), `${d} -> ${out}`);
    assert.deepEqual(again.error, q.error, `${d} -> ${out}`);
    assert.equal(again.tail.trimStart(), p.tail.trimStart(), `${d} -> ${out}`);
    if (p.tail.trim()) tails++;
  }
  assert.ok(tails > 4000, `most edits carry an error tail (${tails})`);
});

test('editArg refuses what it cannot write', () => {
  const p = parsePath('M0 0 a1 1 0 0 1 5 5');
  assert.throws(() => editArg(p, 9, 0, 1), RangeError);
  assert.throws(() => editArg(p, 1, 7, 1), RangeError);
  assert.throws(() => editArg(p, 1, 0.5, 1), RangeError);
  assert.throws(() => editArg(p, 1, 3, 2), RangeError, 'a flag is 0 or 1');
  assert.throws(() => editArg(p, 1, 0, NaN), RangeError);
  assert.throws(() => editArg(p, 1, 0, Infinity), RangeError);
  assert.throws(() => editArg(p, 1, 0, 1e39), RangeError, 'past float range');
  assert.equal(serializePath(p), 'M0 0 a1 1 0 0 1 5 5', 'the input is not mutated');
});

test('fuzz: random edits of real paths change only the edited segment', () => {
  const r = rng(3);
  const { icons, lab } = corpus();
  const paths = [...icons, ...lab];
  for (let n = 0; n < 4000; n++) {
    const d = pick(r, paths);
    const p = parsePath(d);
    const si = Math.floor(r() * p.segs.length);
    const seg = p.segs[si];
    if (!seg.args.length) continue;
    const ai = Math.floor(r() * seg.args.length);
    const value = isFlag(seg.cmd, ai) ? (seg.args[ai] ? 0 : 1) : pick(r, [0, -1, 0.5, 1e-4, -0.0004, 12.34567, 999999.5, -3e7, r() * 200 - 100]);
    const decimals = Math.floor(r() * 5);
    const q = editArg(p, si, ai, value, decimals);
    const out = serializePath(q);

    // Every other segment keeps its exact raw text (the same string object, even).
    q.segs.forEach((s, k) => {
      if (k !== si) assert.equal(s, p.segs[k]);
    });
    assert.equal(q.tail, p.tail);
    // The text reparses to the edited values; only the edited segment's and (by a separator
    // space it may gain) the next segment's raw text differ.
    const again = parsePath(out);
    assert.equal(again.error, null, out);
    assert.deepEqual(again.segs.map((s) => [s.cmd, s.implicit]), p.segs.map((s) => [s.cmd, s.implicit]));
    assert.deepEqual(again.segs.map((s) => s.args), q.segs.map((s) => s.args), out);
    assert.equal(q.segs[si].args[ai], isFlag(seg.cmd, ai) ? value : Number(fmt(value, decimals)));
    again.segs.forEach((s, k) => {
      if (k === si) return;
      if (k === si + 1 && s.raw !== p.segs[k].raw) assert.equal(s.raw, ' ' + p.segs[k].raw);
      else assert.equal(s.raw, p.segs[k].raw);
    });
  }
});
