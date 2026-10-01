// What a write to a long path costs (the P1-M3 review): time in proportion to the path, never to its
// square. Each case runs on a path and on one 4× as long; linear costs about 4×, so the bound is 6×,
// and a pause of the runner's is forgiven by measuring a miss again (the fastest run of each size
// counts), but never a run past 4× the absolute limit, which no pause explains. Each limit is one the
// quadratic code missed by 5× or more. Its own file, so the deliberate breaks that run
// segments.test.ts don't wait for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, type Doc, type NodeId } from '../../model/doc.ts';
import { parsePath } from '../../path/parse.ts';
import { toAbsolute } from '../../path/abs.ts';
import { reverseSubpath, subpathCount, toggleRelative } from '../../path/segments.ts';
import { planNodeDrag } from '../../path/nodes.ts';
import { TokenEditError } from '../../code/edit.ts';

const ONE = { step: 1, k: 1 };

/** How long act takes (ms). */
function time(act: () => void): number {
  const t = performance.now();
  act();
  return performance.now() - t;
}

/**
 * small, and big (4× the work): big under `most`× small and under `limit` ms, the fastest of up to
 * `runs` runs of each size.
 */
function linear(what: string, small: () => void, big: () => void, limit: number, runs = 3, most = 6): void {
  small(); // warm the engine up
  let s = time(small);
  let b = time(big);
  for (let again = 1; again < runs && (b >= most * s || b >= limit) && b < 4 * limit; again++) {
    s = Math.min(s, time(small));
    b = Math.min(b, time(big));
  }
  assert.ok(b < most * s, `${what}: ${s.toFixed(0)} ms, then ${b.toFixed(0)} ms for 4× the work (×${(b / s).toFixed(1)}; linear is ×4, the most ×${most})`);
  assert.ok(b < limit, `${what}: ${b.toFixed(0)} ms for the larger (the limit is ${limit})`);
}

/** M 0 0 and n lines. */
const lines = (n: number): string => 'M 0 0' + Array.from({ length: n }, (_, i) => ` L ${i % 97} ${(i * 7) % 89}`).join('');

/** A document holding one path with this d, and the path's id. */
function onePath(d: string): { doc: Doc; id: NodeId } {
  const r = parseDoc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${d}"/></svg>`);
  assert.ok(r.ok);
  const path = [...descendants(r.doc, r.doc.root)].find((n) => n.kind === 'element' && n.local === 'path')!;
  return { doc: r.doc, id: path.id };
}

// R3: writeGeometry read the last character written from the growing string once per segment, which
// flattens it every time. Measured in node: linear, about 60 and 230 ms (Relative) and 100 and 240 ms
// (a drag frame) over 16,000 and 64,000 segments; the quadratic code took 5.5 s and 7.4 s over 64,000.
test('a segment rewrite and a node drag frame take linear time: Make relative and one planNodeDrag over 64,000 segments cost under 6× what they cost over 16,000', () => {
  const small = lines(16000);
  const big = lines(64000);
  linear('Make relative (toggleRelative)', () => void toggleRelative(small), () => void toggleRelative(big), 1000);
  const a = onePath(small);
  const b = onePath(big);
  const drag = ({ doc, id }: { doc: Doc; id: NodeId }) => () => {
    const plan = planNodeDrag(doc, id, 'a1', { x: 3, y: 4 }, ONE);
    assert.ok(!('refused' in plan) && plan.edits.length === 1, 'test setup: the drag planned one edit');
  };
  linear('a node drag frame (planNodeDrag)', drag(a), drag(b), 1000);
});

/** n/2 relative subpaths of one line each (m, then l), with decimals: Reverse compensates every m after the first. */
const relativeLines = (n: number): string =>
  Array.from({ length: n / 2 }, (_, i) => `m ${((i % 7) * 0.7 + 0.1).toFixed(1)} ${((i % 5) * 0.3 + 0.2).toFixed(1)} l ${((i % 11) * 0.4 + 1.1).toFixed(1)} ${((i % 3) * 0.9 - 1.3).toFixed(1)}`).join(' ');

/** Every subpath reversed one at a time, each over the last result: what Reverse with no chosen node wrote before it read once. */
function oneByOne(d: string): string {
  let out = d;
  for (let s = 0; s < subpathCount(toAbsolute(parsePath(d))); s++) {
    try {
      out = reverseSubpath(out, s);
    } catch (e) {
      if (!(e instanceof TokenEditError && /no segment to reverse/.test(e.message))) throw e;
    }
  }
  return out;
}

// R2: Reverse with no chosen node read and wrote the whole path once per subpath. Its runs are a few
// ms, so a miss is measured up to four times more. Measured in node: about 6 and 23 ms over 1,000 and
// 4,000 segments (500 and 2,000 subpaths); the quadratic code took 0.5 s and 8.3 s.
test('Reverse with no chosen node takes linear time: over 4,000 segments (2,000 subpaths) it costs under 6× what it costs over 1,000, and writes exactly what reversing each subpath in turn writes', () => {
  const small = relativeLines(1000);
  const big = relativeLines(4000);
  const sample = relativeLines(200);
  assert.equal(reverseSubpath(sample, null), oneByOne(sample), 'one pass and one subpath at a time write the same text');
  assert.ok(reverseSubpath(small, null).startsWith('m 1.2 -1.1 l -1.1 1.3 m 3.4 -1.2 l -1.5 0.4 '), 'test setup: each subpath reversed, the m after each compensated');
  linear('Reverse (reverseSubpath, every subpath)', () => void reverseSubpath(small, null), () => void reverseSubpath(big, null), 1000, 5);
});
