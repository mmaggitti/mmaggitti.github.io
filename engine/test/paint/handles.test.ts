// Gradient handles (engine/paint/handles.ts, P1-M2): for objectBoundingBox and userSpaceOnUse, with
// no gradientTransform, rotate(30 0.5 0.5), skewX(20) and scale(1 0.5), on a 3:1 box and on an
// element that is itself mirrored (scale(-1 1)): every handle sits at toHost · U · T · p; a drag to a
// host point writes numbers whose forward map lands on it within the rounding; fixF pulls a focus
// back inside 0.96 r; the radius clamps; a percentage stays one; gradientTransform keeps its bytes;
// and the refusals (no box, a flat transform, font-relative lengths).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAttr, parseDoc, serialize, type Doc, type ElementNode } from '../../model/doc.ts';
import { Session } from '../../commands/session.ts';
import { apply as applyM, multiply, type Affine } from '../../values/affine.ts';
import { parseTransform } from '../../values/transform.ts';
import { applyPlan } from '../../geometry/write.ts';
import { idMap, resolveGradient } from '../../paint/gradients.ts';
import { FLATTENED, FONT_RELATIVE, NO_BOX, gradientHandles, planGradientHandle, type GradientGeo, type GradientHandleId } from '../../paint/handles.ts';

const SVG = 'xmlns="http://www.w3.org/2000/svg"';
function load(text: string): Doc {
  const r = parseDoc(text);
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.doc;
}
const g = (doc: Doc) => resolveGradient(doc, idMap(doc).get('g')!)!;
const BOX = { x: 10, y: 20, width: 90, height: 30 }; // 3:1
const PLAIN: Affine = [2, 0, 0, 2, 5, 7];
const MIRRORED: Affine = [-2, 0, 0, 2, 300, 7]; // the element itself under scale(-1 1)
const geo = (toHost: Affine, box = BOX): GradientGeo => ({ box, toHost, viewport: { w: 200, h: 100 }, step: 1 });

// The expected mapping, written out here: toHost · U · T.
function forward(toHost: Affine, obb: boolean, T: string, box = BOX): Affine {
  const U: Affine = obb ? [box.width, 0, 0, box.height, box.x, box.y] : [1, 0, 0, 1, 0, 0];
  return multiply(toHost, multiply(U, parseTransform(T)!.matrix));
}
const near = (a: { x: number; y: number }, b: { x: number; y: number }, tol: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
const at = (m: Affine, x: number, y: number) => {
  const [hx, hy] = applyM(m, x, y);
  return { x: hx, y: hy };
};
/** The largest stretch of the matrix: host px per gradient unit at most. */
const stretch = (m: Affine) => Math.hypot(m[0], m[1]) + Math.hypot(m[2], m[3]);

for (const T of ['', 'rotate(30 0.5 0.5)', 'skewX(20)', 'scale(1 0.5)']) {
  test(`linear and radial handles sit at toHost · U · T · p and a drag lands where it was dropped, in objectBoundingBox and userSpaceOnUse, plain and mirrored (gradientTransform "${T}")`, () => {
    for (const obb of [true, false]) {
      const units = obb ? '' : ' gradientUnits="userSpaceOnUse"';
      const [x1, y1, x2, y2, cx, cy, r, fx, fy] = obb ? ['0.1', '0.5', '0.4', '0.5', '0.5', '0.5', '0.3', '0.6', '0.45'] : ['20', '30', '60', '35', '50', '35', '12', '55', '33'];
      const tf = T ? ` gradientTransform="${T}"` : '';
      for (const toHost of [PLAIN, MIRRORED]) {
        for (const kind of ['linear', 'radial'] as const) {
          const text = kind === 'linear'
            ? `<svg ${SVG}><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${units}${tf}/></svg>`
            : `<svg ${SVG}><radialGradient id="g" cx="${cx}" cy="${cy}" r="${r}" fx="${fx}" fy="${fy}"${units}${tf}/></svg>`;
          const doc = load(text);
          const M = forward(toHost, obb, T);
          const out = gradientHandles(g(doc), geo(toHost));
          assert.ok(!('refused' in out), JSON.stringify(out));
          const want: [GradientHandleId, number, number][] = kind === 'linear'
            ? [['g-start', +x1, +y1], ['g-end', +x2, +y2]]
            : [['g-centre', +cx, +cy], ['g-radius', +cx + +r, +cy], ['g-focus', +fx, +fy]];
          for (const [id, x, y] of want) {
            const h = out.handles.find((k) => k.id === id);
            assert.ok(h && near(h.at, at(M, x, y), 1e-9), `${kind} ${id} (${obb ? 'OBB' : 'USOU'}, ${toHost === MIRRORED ? 'mirrored' : 'plain'}): ${JSON.stringify(h?.at)} is not M·p ${JSON.stringify(at(M, x, y))}`);
          }
          // A drag of each handle (not the radius, a length) to a host point: what is written maps back onto it.
          for (const [id] of want.filter(([h]) => h !== 'g-radius')) {
            const target = at(M, obb ? 0.3 : 40, obb ? 0.62 : 28);
            const s = new Session(load(text));
            const plan = planGradientHandle(s.doc, g(s.doc), id, target, geo(toHost));
            assert.ok(!('refused' in plan), JSON.stringify(plan));
            s.dispatch('drag', (apply) => applyPlan(s.doc, plan, apply));
            const moved = gradientHandles(g(s.doc), geo(toHost));
            assert.ok(!('refused' in moved));
            const h = moved.handles.find((k) => k.id === id)!;
            const tol = stretch(M) * (obb ? 0.005 : 0.5) * Math.SQRT2 + 1e-9; // half the rounding, along both axes
            assert.ok(near(h.at, target, tol), `${kind} ${id} dropped at ${JSON.stringify(target)} draws at ${JSON.stringify(h.at)} (tolerance ${tol})`);
            const tAttr = findAttr(s.doc.nodes.get(idMap(s.doc).get('g')!) as ElementNode, null, 'gradientTransform');
            assert.equal(tAttr?.raw ?? '', T, 'gradientTransform is never written');
          }
        }
      }
    }
  });
}

test('fixF: after a radius, centre or focus drag, a written focus farther than 0.96 r from the centre is pulled onto that circle (to 0.01 of the box); the radius clamps to 0.02–2 of the box, and to the snap step in user space; a percentage stays one', () => {
  const text = `<svg ${SVG}><radialGradient id="g" cx="0.5" cy="0.5" r="0.3" fx="0.75" fy="0.5"/></svg>`;
  const doc = load(text);
  const M = forward(PLAIN, true, '');
  const drag = (d: Doc, id: GradientHandleId, x: number, y: number) => {
    const plan = planGradientHandle(d, g(d), id, at(M, x, y), geo(PLAIN));
    assert.ok(!('refused' in plan));
    const s = new Session(d);
    s.dispatch('drag', (apply) => applyPlan(s.doc, plan, apply));
    return serialize(s.doc);
  };
  assert.equal(drag(doc, 'g-radius', 0.6, 0.5), `<svg ${SVG}><radialGradient id="g" cx="0.5" cy="0.5" r="0.1" fx="0.6" fy="0.5"/></svg>`, 'the focus pulled to 0.96 × 0.1 from the centre');
  assert.equal(drag(load(text), 'g-radius', 0.505, 0.5), `<svg ${SVG}><radialGradient id="g" cx="0.5" cy="0.5" r="0.02" fx="0.52" fy="0.5"/></svg>`, 'at least 0.02');
  assert.ok(drag(load(text), 'g-radius', 3, 0.5).includes('r="2"'), 'at most 2');
  assert.equal(drag(load(text), 'g-focus', 0.95, 0.5), `<svg ${SVG}><radialGradient id="g" cx="0.5" cy="0.5" r="0.3" fx="0.79" fy="0.5"/></svg>`, 'a focus dragged outside is pulled back');
  const usou = load(`<svg ${SVG}><radialGradient id="g" cx="50" cy="40" r="10" gradientUnits="userSpaceOnUse"/></svg>`);
  const Mu = forward(PLAIN, false, '');
  const p = planGradientHandle(usou, g(usou), 'g-radius', at(Mu, 50.2, 40), geo(PLAIN));
  assert.ok(!('refused' in p) && p.edits.length === 1 && p.edits[0].raw === '1', `the step at least: ${JSON.stringify(p)}`);
  const pct = load(`<svg ${SVG}><linearGradient id="g" x1="10%" y1="0%" x2="90%"/></svg>`);
  const plan = planGradientHandle(pct, g(pct), 'g-start', at(forward(PLAIN, true, ''), 0.25, 0.5), geo(PLAIN));
  assert.ok(!('refused' in plan));
  assert.deepEqual(plan.edits.map((e) => [e.local, e.raw]), [['x1', '25%'], ['y1', '50%']], 'written as percentages, only their numbers changed');
  const upct = load(`<svg ${SVG}><linearGradient id="g" x1="10%" y1="0%" gradientUnits="userSpaceOnUse"/></svg>`);
  const uplan = planGradientHandle(upct, g(upct), 'g-start', at(forward(PLAIN, false, ''), 50, 25), geo(PLAIN));
  assert.ok(!('refused' in uplan));
  assert.deepEqual(uplan.edits.map((e) => [e.local, e.raw]), [['x1', '25%'], ['y1', '25%']], 'in user space, a percentage of the viewport (200 × 100)');
});

test('refused: a bounding-box gradient on a box with no width or height, a gradientTransform that flattens it, and font-relative lengths; each with its reason', () => {
  const lin = (attrs: string) => load(`<svg ${SVG}><linearGradient id="g" ${attrs}/></svg>`);
  const flatBox = { x: 0, y: 5, width: 40, height: 0 };
  assert.deepEqual(gradientHandles(g(lin('x1="0"')), geo(PLAIN, flatBox)), { refused: NO_BOX });
  assert.ok(!('refused' in gradientHandles(g(lin('gradientUnits="userSpaceOnUse"')), geo(PLAIN, flatBox))), 'user space needs no box');
  assert.deepEqual(gradientHandles(g(lin('gradientTransform="scale(1 0)"')), geo(PLAIN)), { refused: FLATTENED });
  assert.deepEqual(gradientHandles(g(lin('x1="1em"')), geo(PLAIN)), { refused: FONT_RELATIVE });
  const d = lin('x2="2rem"');
  assert.deepEqual(planGradientHandle(d, g(d), 'g-end', { x: 50, y: 50 }, geo(PLAIN)), { refused: FONT_RELATIVE });
});
