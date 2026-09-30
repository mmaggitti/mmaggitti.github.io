// engine/generators: the polygon, star and spiral generators, whether an element is generated now,
// and the Session's finish hook that regenerates a shape whose inputs changed and detaches one whose
// geometry was edited by hand, in the same transaction.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attrValue, descendants, parseDoc, serialize, type Doc, type ElementNode, type NodeId } from '../../model/doc.ts';
import { opSetAttr, opSetAttrRaw } from '../../commands/ops.ts';
import { Session } from '../../commands/session.ts';
import { DRAW_NS } from '../../model/draw-ns.ts';
import { finishGenerators, generatorOf } from '../../generators/index.ts';
import { polygonPoints, starPoints } from '../../generators/radial.ts';
import { spiralEnd, spiralPath } from '../../generators/spiral.ts';
import { applyPlan, planMove } from '../../geometry/write.ts';
import { setDrawAttr } from '../../model/draw-state.ts';

const D = 'https://mmaggitti.github.io/draw/ns';
const svg = (body: string, extra = ` xmlns:draw="${D}"`) => `<svg xmlns="http://www.w3.org/2000/svg"${extra} viewBox="0 0 100 100">\n  ${body}\n</svg>\n`;
const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const first = (doc: Doc, local: string): ElementNode => [...descendants(doc, doc.root)].find((n): n is ElementNode => n.kind === 'element' && n.local === local)!;
const ctx = { viewport: { width: 100, height: 100 }, remPx: 12 };
/** A Session whose finish hook is the generators', and the ids each run detached. */
const session = (doc: Doc) => {
  const detached: NodeId[][] = [];
  return { s: new Session(doc, { finish: (d, ops, apply) => void detached.push(finishGenerators(d, ops, apply)) }), detached };
};

const STAR = starPoints(50, 50, 40, 0.5, 5);
const STAR_EL = `<polygon points="${STAR}" fill="#e76f51" stroke="none" draw:gen="star" draw:cx="50" draw:cy="50" draw:r="40" draw:inner="0.5" draw:tips="5"/>`;

test('each generator writes exactly its points or path for fixed inputs: a triangle, a 5-point star, and a 1.5-turn spiral whose first segment is checked by hand', () => {
  assert.equal(polygonPoints(50, 50, 40, 3), '50,10 84.64,70 15.36,70');
  // tip, inner, tip, inner…: the first inner point at −54°, 20 from the centre (61.76, 33.82)
  assert.equal(starPoints(50, 50, 40, 0.5, 5), '50,10 61.76,33.82 88.04,37.64 69.02,56.18 73.51,82.36 50,70 26.49,82.36 30.98,56.18 11.96,37.64 38.24,33.82');
  // Θ = 3π, N = 12 segments of π/4; ρ′ = 30/3π. The first: P(0) = (0, 0), P′(0) = (ρ′, 0), so
  // C₁ = (π/12)·ρ′ = 10/12 across; P(π/4) = 2.5 at 45° = (1.77, 1.77), P′(π/4) = (0.48, 4.02), so
  // C₂ = P(π/4) − (π/12)·P′(π/4) = (1.64, 0.72).
  const d = spiralPath(0, 0, 30, 1.5);
  assert.ok(d.startsWith('M 0 0 C 0.83 0 1.64 0.72 1.77 1.77 C '), d.slice(0, 60));
  assert.equal(d.split(' C ').length - 1, 12, '⌈8 × 1.5⌉ cubic segments');
  const end = spiralEnd(0, 0, 30, 1.5);
  assert.ok(d.endsWith(` ${Math.round(end.x * 100) / 100 || 0} ${Math.round(end.y * 100) / 100 || 0}`), `it ends at P(Θ): ${d.slice(-20)}`);
});

test('lab check: a star with centre (50, 53), r 30, inner 0.4 and 5 tips is lab/vector.svg’s star, and a 5-sided polygon with centre (50, 52), r 35 the Shapes lesson’s pentagon, rounded to whole units', () => {
  const round = (s: string) => s.split(' ').map((p) => p.split(',').map((v) => Math.round(Number(v))).join(',')).join(' ');
  assert.equal(round(starPoints(50, 53, 30, 0.4, 5)), '50,23 57,43 79,44 61,57 68,77 50,65 32,77 39,57 21,44 43,43');
  assert.equal(round(polygonPoints(50, 52, 35, 5)), '50,17 83,41 71,80 29,80 17,41');
});

test('generatorOf: generated only with every input present and valid and the geometry exactly what they generate; a reformatted points reads as plain, and reading changes nothing', () => {
  const ok = load(svg(STAR_EL));
  const g = generatorOf(ok, first(ok, 'polygon').id);
  assert.ok(g && g.kind === 'star' && g.attr === 'points');
  assert.deepEqual(g.inputs, { cx: 50, cy: 50, r: 40, inner: 0.5, tips: 5 });
  // A prefix of another name for Draw's namespace is still Draw's (matched by URI).
  const other = load(svg(STAR_EL.replaceAll('draw:', 'q:'), ` xmlns:q="${D}"`));
  assert.ok(generatorOf(other, first(other, 'polygon').id), 'matched by namespace URI, not prefix');
  for (const [why, markup] of [
    ['reformatted by another tool', STAR_EL.replace(STAR, STAR.replace(' ', '  ').replace('61.76,33.82', '61.759,33.82'))],
    ['tips out of range', STAR_EL.replace('draw:tips="5"', 'draw:tips="2"')],
    ['tips not whole', STAR_EL.replace('draw:tips="5"', 'draw:tips="5.5"')],
    ['inner out of range', STAR_EL.replace('draw:inner="0.5"', 'draw:inner="0.99"')],
    ['a unit on r', STAR_EL.replace('draw:r="40"', 'draw:r="40px"')],
    ['an input missing', STAR_EL.replace(' draw:cy="50"', '')],
    ['an unknown generator', STAR_EL.replace('draw:gen="star"', 'draw:gen="donut"')],
    ['another element', STAR_EL.replace('<polygon', '<polyline')],
  ]) {
    const src = svg(markup);
    const doc = load(src);
    const n = [...descendants(doc, doc.root)].find((x): x is ElementNode => x.kind === 'element' && x.id !== doc.root)!;
    assert.equal(generatorOf(doc, n.id), null, why);
    assert.equal(serialize(doc), src, `${why}: reading changed nothing`);
  }
  const plain = load(svg('<polygon points="50,17 83.29,41.18  71,80 29,80 17,41" draw:gen="polygon" draw:cx="50" draw:cy="52" draw:r="35" draw:sides="5"/>'));
  assert.equal(generatorOf(plain, first(plain, 'polygon').id), null, 'the Shapes lesson’s pentagon, spaced twice, is plain');
  const spiral = load(svg(`<path d="${spiralPath(40, 40, 20, 3)}" fill="none" stroke="#264653" draw:gen="spiral" draw:cx="40" draw:cy="40" draw:r="20" draw:turns="3"/>`));
  assert.equal(generatorOf(spiral, first(spiral, 'path').id)?.kind, 'spiral');
});

test('the finish hook: an input edit regenerates and a geometry edit detaches, one transaction each, one undo restoring the bytes; a drag frame that scrubs points away and back detaches nothing', () => {
  const src = svg(STAR_EL);
  const doc = load(src);
  const p = first(doc, 'polygon');
  const { s, detached } = session(doc);
  // An input: the star is drawn again from it, in the same entry.
  s.dispatch('Set tips', (apply) => apply(opSetAttr(doc, p.id, DRAW_NS, 'tips', '6')));
  assert.equal(attrValue(doc, p, null, 'points'), starPoints(50, 50, 40, 0.5, 6));
  assert.equal(serialize(doc), src.replace(STAR, starPoints(50, 50, 40, 0.5, 6)).replace('draw:tips="5"', 'draw:tips="6"'));
  assert.deepEqual(detached.at(-1), []);
  s.undo();
  assert.equal(serialize(doc), src, 'one undo gives back the 5-tip star');
  // The geometry by hand (a code token's edit of one number): the shape is plain now.
  s.dispatch('Scrub points', (apply) => apply(opSetAttrRaw(doc, p.id, null, 'points', STAR.replace('88.04', '90'))));
  assert.deepEqual(detached.at(-1), [p.id]);
  assert.equal(serialize(doc), svg(`<polygon points="${STAR.replace('88.04', '90')}" fill="#e76f51" stroke="none"/>`, ''), 'every draw: input gone, and the declaration with them');
  assert.equal(generatorOf(doc, p.id), null);
  s.undo();
  assert.equal(serialize(doc), src, 'one undo brings the inputs back byte for byte');
  assert.ok(generatorOf(doc, p.id));
  // A drag: a frame away detaches; a frame back where it was detaches nothing.
  const drag = s.drag('Scrub points');
  drag.update((apply) => apply(opSetAttrRaw(doc, p.id, null, 'points', STAR.replace('88.04', '95'))));
  assert.equal(generatorOf(doc, p.id), null, 'the frame away is plain');
  drag.update((apply) => apply(opSetAttrRaw(doc, p.id, null, 'points', STAR)));
  assert.deepEqual(detached.at(-1), [], 'the frame back detached nothing');
  drag.commit();
  assert.equal(serialize(doc), src);
  assert.equal(s.undoLabel, null, 'and it records nothing');
});

test('the finish hook: a move rewrites only draw:cx, draw:cy and the geometry, and the shape stays generated; a fill change or a Lock on an inconsistent element changes none of its draw:*; the last input’s removal takes xmlns:draw with it unless another Draw item remains', () => {
  const src = svg(STAR_EL);
  const doc = load(src);
  const p = first(doc, 'polygon');
  const { s } = session(doc);
  s.dispatch('Move', (apply) => {
    const plan = planMove(doc, p.id, 7, -3, { ctx, decimals: 0 });
    assert.ok(!('refused' in plan), 'refused' in plan ? plan.refused : '');
    assert.deepEqual(plan.edits.map((e) => [e.ns, e.local, e.raw]), [[DRAW_NS, 'cx', '57'], [DRAW_NS, 'cy', '47']], 'the plan writes the centre’s inputs only');
    applyPlan(doc, plan, apply);
  });
  assert.equal(serialize(doc), src.replace(STAR, starPoints(57, 47, 40, 0.5, 5)).replace('draw:cx="50" draw:cy="50"', 'draw:cx="57" draw:cy="47"'));
  assert.ok(generatorOf(doc, p.id), 'still generated');
  s.undo();
  // A mirrored star moves its centre through its own transform, as its geometry would.
  const mirrored = load(svg(STAR_EL.replace('<polygon ', '<polygon transform="scale(-1 1)" ')));
  const mp = first(mirrored, 'polygon');
  const plan = planMove(mirrored, mp.id, 7, -3, { ctx, decimals: 0 });
  assert.ok(!('refused' in plan) && plan.edits.map((e) => e.raw).join() === '43,47', 'a mirror sends the move the other way in its own units');
  // An inconsistent element: its points reformatted, its inputs kept as unknown editor data.
  const stale = svg(STAR_EL.replace(STAR, STAR.replace(' ', '  ')));
  const sdoc = load(stale);
  const sp = first(sdoc, 'polygon');
  const t = session(sdoc);
  t.s.dispatch('Set fill', (apply) => apply(opSetAttr(sdoc, sp.id, null, 'fill', '#264653')));
  assert.equal(serialize(sdoc), stale.replace('fill="#e76f51"', 'fill="#264653"'), 'a fill change leaves its draw: attributes as they are');
  t.s.dispatch('Lock', (apply) => setDrawAttr(sdoc, sp.id, 'locked', 'true', apply));
  assert.equal(serialize(sdoc), stale.replace('fill="#e76f51"', 'fill="#264653"').replace('draw:tips="5"', 'draw:tips="5" draw:locked="true"'), 'so does a Lock');
  // The last input removed: the rest of the generator's attributes go, and the declaration with them.
  const lone = load(src);
  const lp = first(lone, 'polygon');
  const u = session(lone);
  u.s.dispatch('Edit', (apply) => apply(opSetAttr(lone, lp.id, DRAW_NS, 'tips', null)));
  assert.equal(serialize(lone), svg(`<polygon points="${STAR}" fill="#e76f51" stroke="none"/>`, ''));
  // … unless another Draw item remains: a lock on another shape keeps xmlns:draw.
  const two = load(svg(`${STAR_EL}\n  <rect width="5" height="5" draw:locked="true"/>`));
  const tp = first(two, 'polygon');
  const w = session(two);
  w.s.dispatch('Edit', (apply) => apply(opSetAttr(two, tp.id, DRAW_NS, 'tips', null)));
  assert.equal(serialize(two), svg(`<polygon points="${STAR}" fill="#e76f51" stroke="none"/>\n  <rect width="5" height="5" draw:locked="true"/>`));
});
