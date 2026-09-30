// engine/geometry/ctm: the root transform M, each element's own transform with its origin, and the
// CTM through nested viewports (the numbers are Chromium's, probed in P1-M1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, type Doc, type ElementNode } from '../../model/doc.ts';
import { apply, multiply, rotate, scale, skewX, skewY, translate, type Affine } from '../../values/affine.ts';
import { elementCtm, ownTransform, rootTransform, userCtm, type GeoContext } from '../../geometry/ctm.ts';
import { localBounds } from '../../geometry/bounds.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.doc;
};
const byId = (doc: Doc, id: string) => ([...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === id)) as ElementNode).id;
const CTX: GeoContext = { viewport: { width: 440, height: 528 }, remPx: 12 };
const svg = (body: string, attrs = 'viewBox="0 0 100 100"') => load(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`);
const close = (a: Affine | null, b: Affine, msg: string) => {
  assert.ok(a, `${msg}: null`);
  assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-9), `${msg}: ${a} ≠ ${b}`);
};
const at = (m: Affine | null, x: number, y: number) => {
  assert.ok(m);
  return apply(m, x, y).map((v) => Math.round(v * 1e6) / 1e6);
};

test('every transform function, and lists in the order written', () => {
  const doc = svg(`<g id="m" transform="matrix(1 2 3 4 5 6)"/><g id="t" transform="translate(5)"/><g id="s" transform="scale(2 3)"/>
    <g id="r" transform="rotate(30 10 20)"/><g id="x" transform="skewX(10)"/><g id="y" transform="skewY(20)"/>
    <g id="l" transform="translate(10 20) rotate(90) scale(2)"/>`);
  close(ownTransform(doc, byId(doc, 'm'), CTX), [1, 2, 3, 4, 5, 6], 'matrix');
  close(ownTransform(doc, byId(doc, 't'), CTX), translate(5, 0), 'translate(tx)');
  close(ownTransform(doc, byId(doc, 's'), CTX), scale(2, 3), 'scale');
  close(ownTransform(doc, byId(doc, 'r'), CTX), rotate(30, 10, 20), 'rotate about a point');
  close(ownTransform(doc, byId(doc, 'x'), CTX), skewX(10), 'skewX');
  close(ownTransform(doc, byId(doc, 'y'), CTX), skewY(20), 'skewY');
  const l = ownTransform(doc, byId(doc, 'l'), CTX);
  close(l, multiply(multiply(translate(10, 20), rotate(90)), scale(2)), 'a list, right to left on points');
  assert.deepEqual(at(l, 1, 0), [10, 22], 'scale first, then rotate, then translate');
});

test('transform-origin: keywords, lengths and % under view-box (the viewBox’s size at the origin) and fill-box', () => {
  // Chromium, P1-M1: the rect 10,10 20×10 turned 90° about each origin, in root user units.
  const doc = svg(`<rect id="a" x="10" y="10" width="20" height="10" transform="rotate(90)" transform-origin="20 15"/>
    <rect id="b" x="10" y="10" width="20" height="10" transform="rotate(90)" style="transform-box:fill-box;transform-origin:50% 50%"/>
    <rect id="c" x="10" y="10" width="20" height="10" transform="rotate(90)" transform-box="fill-box" transform-origin="50% 50%"/>
    <rect id="e" x="10" y="10" width="20" height="10" transform="rotate(90)" transform-origin="left top"/>
    <rect id="f" x="10" y="10" width="20" height="10" transform="rotate(90)" transform-origin="right bottom"/>
    <rect id="g" x="10" y="10" width="20" height="10" transform="rotate(90)" style="transform-box:fill-box;transform-origin:right 5px"/>
    <rect id="h" x="10" y="10" width="20" height="10" transform="translate(3 4)" style="transform-origin:0px 0px 7px"/>`);
  const bounds = (id: string) => () => localBounds(doc, byId(doc, id), CTX);
  const own = (id: string) => ownTransform(doc, byId(doc, id), CTX, bounds(id));
  assert.deepEqual(at(own('a'), 10, 10), [25, 5], 'origin 20 15 (the attribute)');
  assert.deepEqual(at(own('b'), 10, 10), [25, 5], 'fill-box 50% 50%: the box’s centre (20, 15)');
  assert.deepEqual(at(own('c'), 10, 10), [90, 10], 'a transform-box attribute is ignored, as browsers do: 50% of the viewBox');
  assert.deepEqual(at(own('e'), 10, 10), [-10, 10], 'left top is 0 0');
  assert.deepEqual(at(own('f'), 0, 0), [200, 0], 'right bottom: (100, 100)');
  assert.deepEqual(at(own('g'), 30, 15), [30, 15], 'fill-box right 5px: (30, 15) stays');
  assert.deepEqual(at(own('g'), 30, 10), [35, 15], 'and turns what is around it');
  close(own('h'), translate(3, 4), 'an origin changes nothing for a translation');
});

test('nested viewports place their content through x, y and the viewBox, with each preserveAspectRatio', () => {
  // The rect at inner (2, 3) lands at (21, 29) in Chromium: viewBox 0 0 10 10 met into 40 × 30 at (10, 20).
  const doc = svg(`<svg id="n" x="10" y="20" width="40" height="30" viewBox="0 0 10 10"><rect id="r" x="2" y="3" width="4" height="5"/></svg>
    <svg id="t" x="10" y="20" width="40" height="30" viewBox="0 0 10 10" transform="translate(5 5)"><rect id="rt"/></svg>
    ${['xMinYMin meet', 'xMaxYMax meet', 'xMidYMid slice', 'none'].map((p, i) => `<svg id="p${i}" width="40" height="20" viewBox="0 0 10 10" preserveAspectRatio="${p}"><rect id="q${i}"/></svg>`).join('')}
    <svg id="auto" x="1"><rect id="ra"/></svg><svg id="pct" width="50%" height="10" viewBox="0 0 10 10"><rect id="rp"/></svg>`);
  const u = (id: string) => userCtm(doc, byId(doc, id), CTX);
  assert.deepEqual(at(u('r'), 2, 3), [21, 29]);
  assert.deepEqual(at(u('r'), 6, 8), [33, 44]);
  assert.deepEqual(at(u('rt'), 2, 3), [26, 34], 'its own transform before x and y (Chromium)');
  assert.deepEqual(at(u('q0'), 10, 10), [20, 20], 'xMinYMin meet');
  assert.deepEqual(at(u('q1'), 0, 0), [20, 0], 'xMaxYMax meet');
  assert.deepEqual(at(u('q2'), 0, 0), [0, -10], 'xMidYMid slice');
  assert.deepEqual(at(u('q3'), 10, 10), [40, 20], 'none stretches');
  assert.deepEqual(at(u('ra'), 0, 0), [1, 0], 'no viewBox: x and y only');
  assert.deepEqual(at(u('rp'), 10, 10), [30, 10], '50% of the root’s viewBox width (50), the viewBox met and centred in it');
});

test('null where a part is unknown: a CSS transform, units, a <style> origin, and content that draws only where referenced', () => {
  const doc = svg(`<style>.o { transform-origin: 1px 2px } .k { transform: rotate(1deg) }</style>
    <rect id="css" style="transform: rotate(10deg)"/><rect id="units" transform="rotate(10deg)"/><rect id="sheet" class="k"/>
    <rect id="origin" class="o" transform="rotate(10)"/><rect id="plain" class="o" transform="translate(1 2)"/>
    <g transform="rotate(5)" style="transform: none"><rect id="under"/></g><defs><rect id="def"/></defs>`);
  assert.equal(ownTransform(doc, byId(doc, 'css'), CTX), null, 'style="transform: …"');
  assert.equal(ownTransform(doc, byId(doc, 'units'), CTX), null, 'CSS units in the attribute');
  assert.equal(ownTransform(doc, byId(doc, 'sheet'), CTX), null, 'a <style> rule');
  assert.equal(ownTransform(doc, byId(doc, 'origin'), CTX), null, 'an origin a <style> rule sets');
  close(ownTransform(doc, byId(doc, 'plain'), CTX), translate(1, 2), 'which a translation ignores');
  assert.equal(userCtm(doc, byId(doc, 'under'), CTX), null, 'an ancestor’s CSS transform');
  assert.equal(userCtm(doc, byId(doc, 'def'), CTX), null, 'defs content');
});

test('M, the root’s viewBox fitted into its viewport at 100%: the identity without a valid viewBox', () => {
  const vp = { width: 400, height: 200 };
  close(rootTransform(svg('', 'viewBox="0 0 100 100"'), vp), [2, 0, 0, 2, 100, 0], 'meet, centred');
  close(rootTransform(svg('', 'viewBox="-10 -10 20 10" preserveAspectRatio="none"'), vp), [20, 0, 0, 20, 200, 200], 'none');
  close(rootTransform(svg('', 'viewBox="0 0 100 100" preserveAspectRatio="xMinYMin slice"'), vp), [4, 0, 0, 4, 0, 0], 'slice');
  close(rootTransform(svg('', 'viewBox="0 0 100 100" preserveAspectRatio="bogus"'), vp), [2, 0, 0, 2, 100, 0], 'an invalid pAR is the default');
  close(rootTransform(svg('', 'width="10" height="20"'), vp), [1, 0, 0, 1, 0, 0], 'a size only');
  close(rootTransform(svg('', 'viewBox="0 0 a b"'), vp), [1, 0, 0, 1, 0, 0], 'invalid');
  close(rootTransform(svg('', 'viewBox="0 0 0 10"'), vp), [1, 0, 0, 1, 0, 0], 'disabled: nothing draws');
  const doc = svg('<rect id="r" transform="translate(5 5)"/>');
  close(elementCtm(doc, byId(doc, 'r'), { viewport: vp, remPx: 12 }), [2, 0, 0, 2, 110, 10], 'elementCtm is M·userCtm');
});
