// What a write to a long path costs (the P1-M3 review): time in proportion to the path, never to its
// square. Each case runs on a path and on one 4× as long; linear costs about 4×, so the bound is 6×,
// and a pause of the runner's is forgiven by measuring a miss twice more (the fastest run of each size
// counts). Each also has an absolute limit that the quadratic code missed by 5× or more. Its own file,
// so the deliberate breaks that run segments.test.ts don't wait for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, type Doc, type NodeId } from '../../model/doc.ts';
import { toggleRelative } from '../../path/segments.ts';
import { planNodeDrag } from '../../path/nodes.ts';

const ONE = { step: 1, k: 1 };

/** The fastest of `runs` timings of act (ms). */
function fastest(act: () => void, runs = 1): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    act();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

/** small and big (4× the work): under `most`× the time, and big under `limit` ms, the fastest of up to three runs each. */
function linear(what: string, small: () => void, big: () => void, limit: number, most = 6): void {
  small(); // warm the engine up
  let s = fastest(small);
  let b = fastest(big);
  for (let again = 0; again < 2 && (b >= most * s || b >= limit); again++) {
    s = Math.min(s, fastest(small));
    b = Math.min(b, fastest(big));
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
