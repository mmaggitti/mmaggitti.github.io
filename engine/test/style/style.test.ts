// engine/style: where Inspect reads a style value and writes it: a style="" declaration's value
// span, the presentation attribute, or a new attribute at the end of the start tag; the <style>
// rule refusals; and the width-2 rule (a stroke given to a shape that had none gets a width).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, serialize, type Doc, type ElementNode, type NodeId } from '../../model/doc.ts';
import { applyPlan } from '../../geometry/write.ts';
import { STYLE_PROPS } from '../../style/props.ts';
import { shownValue, styleSource } from '../../style/where.ts';
import { planStyle, REFERENCE, RULE_IMPORTANT, RULE_SETS, widthOf } from '../../style/write.ts';

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const byId = (doc: Doc, id: string): NodeId => ([...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === id)) as ElementNode).id;
const CTX = { k: 1, step: 1 };

/** The file after `prop` = `value` is planned over the ids and applied, and why any were refused. */
function write(body: string, ids: string[], prop: string, value: string, ctx = CTX) {
  const doc = load(svg(body));
  const plan = planStyle(doc, ids.map((i) => byId(doc, i)), prop, value, ctx);
  applyPlan(doc, plan, () => {});
  return { out: serialize(doc), refused: plan.refused.map((r) => r.why), edits: plan.edits.length };
}

// A value written before and one to write, per property (a stroke that isn't none, so the width-2
// rule stays out of it).
const VALUES: Record<string, [string, string]> = {
  fill: ['#e76f51', 'rgb(42, 157, 143)'],
  stroke: ['red', '#264653'],
  'stroke-width': ['1', '2.5'],
  opacity: ['1', '0.5'],
  'fill-opacity': ['.3', '0.75'],
  'stroke-opacity': ['1', '0'],
  'stroke-linecap': ['butt', 'round'],
  'stroke-linejoin': ['miter', 'bevel'],
  'stroke-miterlimit': ['4', '10'],
  'stroke-dasharray': ['none', '10 6'],
  'stroke-dashoffset': ['0', '3'],
  'paint-order': ['normal', 'stroke'],
  'vector-effect': ['none', 'non-scaling-stroke'],
  'shape-rendering': ['auto', 'crispEdges'],
  color: ['black', 'hsl(12 76% 61%)'],
  'stop-color': ['red', 'oklch(0.66 0.15 36)'],
  'stop-opacity': ['1', '0.5'],
};

test('each property is written where it lives: the style="" declaration’s value alone, the attribute’s value (its quote and spacing kept), or a new attribute at the end of the start tag; every other byte unchanged', () => {
  assert.deepEqual(Object.keys(VALUES).sort(), Object.keys(STYLE_PROPS).sort(), 'every property of the table');
  for (const [prop, [was, now]] of Object.entries(VALUES)) {
    let r = write(`<rect id="a" x="1" style="${prop}: ${was} ; font-weight:bold"/>`, ['a'], prop, now);
    assert.equal(r.out, svg(`<rect id="a" x="1" style="${prop}: ${now} ; font-weight:bold"/>`), `${prop} in style=""`);
    r = write(`<rect id="a" ${prop} = '${was}'  x="1"/>`, ['a'], prop, now);
    assert.equal(r.out, svg(`<rect id="a" ${prop} = '${now}'  x="1"/>`), `${prop} as the attribute`);
    const w = prop === 'stroke' ? ' stroke-width="1"' : ''; // a width, so the width-2 rule stays out
    r = write(`<rect id="a" x="1"${w}/>`, ['a'], prop, now);
    assert.equal(r.out, svg(`<rect id="a" x="1"${w} ${prop}="${now}"/>`), `${prop} added`);
    r = write(`<rect id="a" style="font-weight:bold" ${prop}="${was}"/>`, ['a'], prop, now);
    assert.equal(r.out, svg(`<rect id="a" style="font-weight:bold" ${prop}="${now}"/>`), `${prop}: a style="" without it leaves the attribute to hold it`);
  }
});

test('a declaration among others is rewritten alone: odd spacing, !important, comments and the other declarations stay; the winning one is the last, or the last !important', () => {
  const body = (v: string) => `<circle id="c" style="  fill :  ${v}  !important ;stroke-width:2 ; fill-opacity:.5/* x */"/>`;
  assert.equal(write(body('#2a9d8f'), ['c'], 'fill', '#e76f51').out, svg(body('#e76f51')));
  assert.equal(write(`<circle id="c" style="fill: /*a*/ red /*b*/;stroke:none"/>`, ['c'], 'fill', 'blue').out, svg(`<circle id="c" style="fill: /*a*/ blue /*b*/;stroke:none"/>`), 'comments around the value stay');
  assert.equal(write(`<circle id="c" style="fill:red;fill:green"/>`, ['c'], 'fill', 'blue').out, svg(`<circle id="c" style="fill:red;fill:blue"/>`), 'the last declaration wins');
  assert.equal(write(`<circle id="c" style="fill:red!important;fill:green"/>`, ['c'], 'fill', 'blue').out, svg(`<circle id="c" style="fill:blue!important;fill:green"/>`), 'the last !important one wins');
  assert.equal(write(`<circle id="c" style='fill:red'/>`, ['c'], 'fill', `url('#g') blue`).out, svg(`<circle id="c" style='fill:url(&apos;#g&apos;) blue'/>`), 'escaped for the attribute’s quote');
  assert.equal(write(`<circle id="c" style="font-family:&quot;a; b&quot;;fill:red"/>`, ['c'], 'fill', 'blue').out, svg(`<circle id="c" style="font-family:&quot;a; b&quot;;fill:blue"/>`), 'a reference elsewhere in style="" is kept byte for byte');
});

test('refused, with the reason, and nothing written: a <style> rule that may set it (unless style="" declares it), a rule marking it !important (unless style="" does too), and a character reference in the value', () => {
  const rule = '<style>.k { fill: red } .i { fill: red !important }</style>';
  let r = write(`${rule}<polygon id="p" class="k" fill="blue"/>`, ['p'], 'fill', 'green');
  assert.deepEqual(r.refused, [RULE_SETS('fill')]);
  assert.equal(r.out, svg(`${rule}<polygon id="p" class="k" fill="blue"/>`), 'the attribute isn’t written: the rule would win over it');
  r = write(`${rule}<polygon id="p" class="k" style="fill:blue"/>`, ['p'], 'fill', 'green');
  assert.equal(r.out, svg(`${rule}<polygon id="p" class="k" style="fill:green"/>`), 'style="" wins over the rule, so it is written');
  r = write(`${rule}<polygon id="p" class="i" style="fill:blue"/>`, ['p'], 'fill', 'green');
  assert.deepEqual(r.refused, [RULE_IMPORTANT('fill')], 'a rule’s !important wins over style=""');
  r = write(`${rule}<polygon id="p" class="i"/>`, ['p'], 'fill', 'green');
  assert.deepEqual(r.refused, [RULE_IMPORTANT('fill')]);
  r = write(`${rule}<polygon id="p" class="i" style="fill:blue !important"/>`, ['p'], 'fill', 'green');
  assert.equal(r.out, svg(`${rule}<polygon id="p" class="i" style="fill:green !important"/>`), 'style="" marked !important wins over the rule’s');
  r = write(`<rect id="a" style="fill:&#x72;ed"/>`, ['a'], 'fill', 'blue');
  assert.deepEqual(r.refused, [REFERENCE('fill')]);
  assert.equal(r.out, svg(`<rect id="a" style="fill:&#x72;ed"/>`));
});

test('nothing is written when the value is the one written there now (trimmed)', () => {
  assert.equal(write(`<rect id="a" fill="red"/>`, ['a'], 'fill', ' red ').edits, 0);
  assert.equal(write(`<rect id="a" style="fill:  red "/>`, ['a'], 'fill', 'red').edits, 0);
});

test('the width-2 rule: a stroke given to a shape whose stroke was none, and whose own stroke-width is absent or 0, also writes stroke-width = 2k on the step; not when it has a width, keeps none, or inherits a stroke', () => {
  const s = '#264653';
  assert.equal(write(`<rect id="a" stroke="none"/>`, ['a'], 'stroke', s).out, svg(`<rect id="a" stroke="${s}" stroke-width="2"/>`));
  assert.equal(write(`<rect id="a"/>`, ['a'], 'stroke', s).out, svg(`<rect id="a" stroke="${s}" stroke-width="2"/>`), 'none by default');
  assert.equal(write(`<rect id="a" stroke="none" stroke-width="0"/>`, ['a'], 'stroke', s).out, svg(`<rect id="a" stroke="${s}" stroke-width="2"/>`), 'a width of 0');
  assert.equal(write(`<rect id="a" stroke="none" stroke-width="3"/>`, ['a'], 'stroke', s).out, svg(`<rect id="a" stroke="${s}" stroke-width="3"/>`), 'a width is kept');
  assert.equal(write(`<rect id="a" stroke="red"/>`, ['a'], 'stroke', s).out, svg(`<rect id="a" stroke="${s}"/>`), 'a stroke that wasn’t none');
  assert.equal(write(`<g stroke="red"><rect id="a"/></g>`, ['a'], 'stroke', s).out, svg(`<g stroke="red"><rect id="a" stroke="${s}"/></g>`), 'an inherited stroke');
  assert.equal(write(`<rect id="a"/>`, ['a'], 'stroke', 'none').out, svg(`<rect id="a" stroke="none"/>`), 'none gets no width');
  assert.equal(write(`<rect id="a" style="stroke:none;stroke-width:0"/>`, ['a'], 'stroke', s).out, svg(`<rect id="a" style="stroke:${s};stroke-width:2"/>`), 'both in style="", in one edit');
  assert.equal(write(`<rect id="a" style="stroke: none" stroke-width="0"/>`, ['a'], 'stroke', s).out, svg(`<rect id="a" style="stroke: ${s}" stroke-width="2"/>`));
  assert.equal(write(`<rect id="a"/>`, ['a'], 'stroke', s, { k: 2.5, step: 1 }).out, svg(`<rect id="a" stroke="${s}" stroke-width="5"/>`), 'k: a 250-unit artboard');
  assert.equal(widthOf(2, { k: 0.24, step: 0.05 }), '0.5', 'on the step: 0.48 → 0.5');
  assert.equal(widthOf(2, { k: 0.001, step: 0.01 }), '0.01', 'at least one step');
});

test('a plan over several elements writes each where it lives and names the one a rule sets', () => {
  const r = write(`<style>.k { fill: red }</style><rect id="a" fill="blue"/><rect id="k" class="k"/><circle id="b" style="fill:blue"/>`, ['a', 'k', 'b'], 'fill', '#e9c46a');
  assert.equal(r.out, svg(`<style>.k { fill: red }</style><rect id="a" fill="#e9c46a"/><rect id="k" class="k"/><circle id="b" style="fill:#e9c46a"/>`));
  assert.deepEqual(r.refused, [RULE_SETS('fill')]);
  assert.equal(r.edits, 2);
});

test('what Inspect shows: the element’s own value (style="" over the attribute), else an inherited one from the nearest ancestor that writes it, else the default; a value a <style> rule may set is never guessed', () => {
  const doc = load(svg(`<style>.k { fill: red } g.r { stroke: red }</style>
    <rect id="own" fill="red" style="fill: green"/>
    <g id="g" fill="blue" opacity="0.5"><rect id="kid"/><rect id="inh" fill="inherit"/></g>
    <rect id="plain"/><rect id="k" class="k" fill="blue"/>
    <g id="rg" class="r"><rect id="under"/></g>`));
  const shown = (id: string, prop: string) => shownValue(doc, byId(doc, id), prop);
  assert.deepEqual(shown('own', 'fill'), { value: 'green', from: 'own', holder: null });
  assert.equal(styleSource(doc, byId(doc, 'own'), 'fill').at, 'style');
  assert.deepEqual(shown('kid', 'fill'), { value: 'blue', from: 'ancestor', holder: byId(doc, 'g') }, 'inherited from the group');
  assert.deepEqual(shown('inh', 'fill'), { value: 'blue', from: 'ancestor', holder: byId(doc, 'g') }, 'inherit reads the group');
  assert.deepEqual(shown('kid', 'opacity'), { value: '1', from: 'default', holder: null }, 'opacity doesn’t inherit');
  assert.deepEqual(shown('plain', 'fill'), { value: 'black', from: 'default', holder: null });
  assert.deepEqual(shown('plain', 'stroke'), { value: 'none', from: 'default', holder: null });
  assert.deepEqual(shown('k', 'fill'), { value: null, from: 'rule', holder: null }, 'a rule may set it');
  assert.deepEqual(shown('under', 'stroke'), { value: null, from: 'ancestor', holder: byId(doc, 'rg') }, 'the group’s stroke is a rule’s');
});
