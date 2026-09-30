// Draw's boolean pipeline in node (P1-M3 S3). The corpus (booleans-corpus.ts: every pair combined four
// ways) runs through the pipeline as the editor runs it: path-bool first, and paper-core when
// path-bool throws or fails the runtime self-check (32 × 32). Each written result is then scored on a
// 128 × 128 lattice over the inputs' box (samples within 0.2% of its diagonal from an input's outline
// left out): a case passes when that result agrees within 0.2% under both nonzero and evenodd, when
// the operation leaves nothing and Draw says so, or when both libraries fail it and Draw refuses
// (plan revision 9, decision 3). Each library's own score per case is printed as a table, and which
// library wrote each case is pinned (a fault in path-bool's side alone shows as paper-core taking
// over). Then: a primary that throws hands over to the fallback, which loads only then; the libraries
// get lines and cubics only; the results' loops are oriented by nesting depth.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attrValue, descendants, parseDoc, type ElementNode } from '../../../../engine/model/doc.ts';
import { shapeOutline } from '../../../../engine/path/from-shape.ts';
import { loopsToAbs, toLoops, type Loop } from '../../../../engine/path/loops.ts';
import { booleanScore, crossingsOf, polygons, windingOf, type BoolOp, type Score } from '../../../../engine/path/winding.ts';
import { EMPTY, OFFLINE, REFUSED, resultLoops, runPipeline, worst, type BoolInput, type Combine, type Libraries } from '../../src/paths/pipeline.ts';
import { combine as pathBool } from '../../src/paths/booleans.ts';
import { combine as paperCore } from '../../src/paths/paper-fallback.ts';
import { PAIRS, type Pair } from './booleans-corpus.ts';

const OPS: readonly BoolOp[] = ['union', 'difference', 'intersection', 'exclusion'];
const CORPUS = { grid: 128, skip: 0.002, limit: 0.002 };
const ctx = { viewport: { width: 100, height: 100 }, remPx: 12 };
const LIBS: Libraries = { primary: async () => pathBool, fallback: async () => paperCore };

/** A pair's operands as the pipeline takes them: each outline as loops, with its own fill rule. */
function inputsOf(p: Pair): BoolInput[] {
  const r = parseDoc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${p.a}${p.b}</svg>`);
  assert.ok(r.ok, p.name);
  const els = [...descendants(r.doc, r.doc.root)].filter((n): n is ElementNode => n.kind === 'element' && n.id !== r.doc.root);
  return els.map((n) => {
    const o = shapeOutline(r.doc, n.id, ctx);
    assert.ok(!('refused' in o), `${p.name}: ${'refused' in o ? o.refused : ''}`);
    return { loops: toLoops(o.abs), rule: attrValue(r.doc, n, null, 'fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero' };
  });
}
const scoreOf = (inputs: readonly BoolInput[], op: BoolOp, loops: readonly Loop[]): Score =>
  booleanScore(inputs.map((i) => ({ abs: loopsToAbs(i.loops), rule: i.rule })), op, loopsToAbs(loops), CORPUS.grid, CORPUS.skip);
/** One library alone on a case, at the corpus's lattice: its score, or why it gave none. */
function alone(combine: Combine, inputs: readonly BoolInput[], op: BoolOp): Score | string {
  try {
    return scoreOf(inputs, op, resultLoops(combine(inputs, op)));
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
const pct = (s: Score | string) => (typeof s === 'string' ? 'threw' : `${(100 * s.nonzero).toFixed(2)}% / ${(100 * s.evenodd).toFixed(2)}%`);
/** Samples where the loops' fill differs between nonzero and evenodd (a lattice over their box, away from their own outline). */
function ruleDisagreements(loops: readonly Loop[], grid = 64): number {
  const polys = polygons(loopsToAbs(loops));
  const pts = polys.flat();
  if (!pts.length) return 0;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let n = 0;
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const x = x0 + ((i + 0.5) * (x1 - x0)) / grid;
      const y = y0 + ((j + 0.5) * (y1 - y0)) / grid;
      if ((windingOf(polys, x, y) !== 0) !== (crossingsOf(polys, x, y) % 2 === 1)) n++;
    }
  }
  return n;
}

// Which library wrote each case, pinned for these library versions (the table in the log shows each
// library's own score): path-bool passes all 64 alone (5 of them leave nothing), so paper-core writes
// none; alone, paper-core misses the evenodd pentagram's intersection and exclusion (it fills the
// pentagram's centre).
const OUTCOMES = { pathBool: 59, paper: 0, empty: 5, refused: [] as string[] };

test('the boolean corpus: every pair combined four ways by Draw’s pipeline (path-bool, then paper-core), each result agreeing within 0.2% under nonzero and evenodd, an empty one said so, and a case refused only when both libraries fail it', async () => {
  const rows: string[] = [];
  const tally = { pathBool: 0, paper: 0, empty: 0, refused: [] as string[] };
  let cases = 0;
  for (const pair of PAIRS) {
    const inputs = inputsOf(pair);
    for (const op of OPS) {
      cases++;
      const name = `${pair.name}: ${op}`;
      const pb = alone(pathBool, inputs, op);
      const pp = alone(paperCore, inputs, op);
      const out = await runPipeline(inputs, op, LIBS);
      let draw: string;
      if ('loops' in out) {
        const s = scoreOf(inputs, op, out.loops);
        assert.ok(worst(s) <= CORPUS.limit, `${name}: Draw wrote a result (by ${out.by}) that misses ${pct(s)} of the samples`);
        draw = out.by;
        if (out.by === 'path-bool') tally.pathBool++;
        else tally.paper++;
      } else if (out.refused === EMPTY) {
        const s = scoreOf(inputs, op, []);
        assert.ok(worst(s) <= CORPUS.limit, `${name}: Draw said nothing would be left, but ${pct(s)} of the samples are filled`);
        draw = 'nothing left';
        tally.empty++;
      } else {
        assert.equal(out.refused, REFUSED, name);
        const fails = (x: Score | string) => typeof x === 'string' || worst(x) > CORPUS.limit;
        assert.ok(fails(pb) && fails(pp), `${name}: refused, though one library passes it (path-bool ${pct(pb)}, paper-core ${pct(pp)})`);
        draw = 'refused';
        tally.refused.push(name);
      }
      rows.push(`${name.padEnd(90)} path-bool ${pct(pb).padEnd(17)} paper-core ${pct(pp).padEnd(17)} → ${draw}`);
    }
  }
  console.log(`\nThe boolean corpus (${cases} cases; the share of samples each library misses, nonzero / evenodd, on a 128 × 128 lattice):\n${rows.join('\n')}\npath-bool wrote ${tally.pathBool}, paper-core ${tally.paper}, nothing left ${tally.empty}, refused ${tally.refused.length}${tally.refused.length ? `: ${tally.refused.join('; ')}` : ''}`);
  assert.equal(cases, PAIRS.length * OPS.length);
  assert.deepEqual(tally, OUTCOMES, 'each case written as pinned (the libraries are pinned too)');
});

test('a path-bool that throws hands the operation to paper-core, whose result is written; paper-core’s chunk loads only then', async () => {
  const inputs = inputsOf(PAIRS[0]); // two overlapping squares
  let fallbacks = 0;
  const counting: Libraries = { primary: async () => pathBool, fallback: async () => (fallbacks++, paperCore) };
  const good = await runPipeline(inputs, 'union', counting);
  assert.ok('loops' in good && good.by === 'path-bool');
  assert.equal(fallbacks, 0, 'path-bool passed: the fallback never loaded');
  const throwing: Combine = () => {
    throw new Error('forced');
  };
  const out = await runPipeline(inputs, 'union', { primary: async () => throwing, fallback: counting.fallback });
  assert.equal(fallbacks, 1);
  assert.ok('loops' in out, `refused: ${'refused' in out ? out.refused : ''}`);
  assert.equal(out.by, 'paper');
  assert.deepEqual(out.tried.map((t) => [t.by, t.error]), [['path-bool', 'forced'], ['paper', null]]);
  assert.deepEqual(out.loops, resultLoops(paperCore(inputs, 'union')), 'the loops written are paper-core’s');
  assert.ok(worst(scoreOf(inputs, 'union', out.loops)) <= CORPUS.limit);
  // Both failing refuses; a chunk that can't load says so.
  assert.deepEqual(await runPipeline(inputs, 'union', { primary: async () => throwing, fallback: async () => throwing }), { refused: REFUSED, tried: [{ by: 'path-bool', score: null, error: 'forced' }, { by: 'paper', score: null, error: 'forced' }] });
  const offline = await runPipeline(inputs, 'union', { primary: () => Promise.reject(new Error('Failed to fetch')), fallback: counting.fallback });
  assert.ok('refused' in offline && offline.refused === OFFLINE);
});

test('the libraries get lines and cubics only: arcs, quadratics, H, V, S and T are converted first', async () => {
  for (const pair of PAIRS) {
    const seen: string[] = [];
    const spy: Combine = (inputs, op) => {
      for (const i of inputs) for (const l of i.loops) for (const s of l.segs) seen.push(s.type);
      return pathBool(inputs, op);
    };
    await runPipeline(inputsOf(pair), 'union', { primary: async () => spy, fallback: async () => paperCore });
    assert.ok(seen.length > 0, pair.name);
    assert.deepEqual([...new Set(seen)].filter((t) => t !== 'L' && t !== 'C'), [], `${pair.name}: every input segment is L or C`);
  }
});

test('the results’ loops are oriented by nesting depth: nonzero and evenodd fill them alike', async () => {
  // A ring written with both loops clockwise, as a library may give it: oriented, the hole stays empty under nonzero too.
  const ring = resultLoops('M 0 0 L 100 0 L 100 100 L 0 100 Z M 25 25 L 75 25 L 75 75 L 25 75 Z');
  assert.equal(ruleDisagreements(ring), 0, 'nonzero and evenodd disagree on the ring');
  // Every result the corpus writes.
  for (const pair of PAIRS) {
    const inputs = inputsOf(pair);
    for (const op of OPS) {
      const out = await runPipeline(inputs, op, LIBS);
      if ('loops' in out) assert.equal(ruleDisagreements(out.loops), 0, `${pair.name}: ${op}: nonzero and evenodd disagree`);
    }
  }
});
