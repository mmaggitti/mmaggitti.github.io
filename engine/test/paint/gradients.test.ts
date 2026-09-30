// Gradients (engine/paint/gradients.ts, stops.ts, gloss.ts; P1-M2): the template chain, relative
// URLs never followed, who uses a gradient and when an edit is shared, a new gradient in defs with
// a numbered id and the file's whitespace, the Draw-made predicate, switching back to a colour or
// none, Make unique, the stop editor, and SVG Lab's gloss. Every edit runs through a real Session,
// and taking it back gives the bytes back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { attrValue, descendants, parseDoc, serialize, type Doc, type ElementNode, type NodeId } from '../../model/doc.ts';
import { Session } from '../../commands/session.ts';
import type { Op } from '../../commands/ops.ts';
import { stripDrawState } from '../../model/draw-state.ts';
import { cleanExport } from '../../export/clean.ts';
import { planStyle } from '../../style/write.ts';
import { applyPlan } from '../../geometry/write.ts';
import { gradientUsers, idMap, makeUnique, ownPaint, resolveGradient, setGradientPaint, setPlainPaint, sharedWith, stopColour, valueOf } from '../../paint/gradients.ts';
import { addStop, offsetOp, removeStop, stopOffset, LAST_STOP } from '../../paint/stops.ts';
import { glossOf, glossOff, glossOn, glossable } from '../../paint/gloss.ts';

const CORPUS = fileURLToPath(new URL('../fixtures/corpus/', import.meta.url));
const corpus = (name: string) => readFileSync(CORPUS + name, 'utf8');
const SVG = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
const DRAW = 'xmlns:draw="https://mmaggitti.github.io/draw/ns"';
const CTX = { k: 1, step: 1 };

function load(text: string): Doc {
  const r = parseDoc(text);
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.doc;
}
const byId = (doc: Doc, id: string): NodeId => {
  const n = idMap(doc).get(id);
  assert.ok(n !== undefined, `no #${id}`);
  return n;
};
const first = (doc: Doc, local: string): NodeId => ([...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.local === local) as ElementNode).id;
/** One transaction on a Session over `text`; the Session (undo gives the bytes back, checked). */
function run(text: string, label: string, build: (doc: Doc, apply: (op: Op) => void) => void): Session {
  const s = new Session(load(text));
  s.dispatch(label, (apply) => build(s.doc, apply));
  const after = serialize(s.doc);
  s.undo();
  assert.equal(serialize(s.doc), text, `${label}: one undo gives the bytes back`);
  s.redo();
  assert.equal(serialize(s.doc), after);
  return s;
}

const CHAIN = `<svg ${SVG}>
  <defs>
    <linearGradient id="a" x1="0.1" gradientUnits="userSpaceOnUse" spreadMethod="reflect"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>
    <radialGradient id="rad" cx="0.3" x1="0.9" fx="0.2"><stop offset="0" stop-color="lime"/></radialGradient>
    <linearGradient id="b" xlink:href="#a" x2="0.8"/>
    <linearGradient id="c" href="#rad" xlink:href="#a" y1="0.2"/>
    <linearGradient id="cyc1" href="#cyc2"/>
    <linearGradient id="cyc2" href="#cyc1" x1="0.5"/>
    <linearGradient id="miss" href="#nothing" x1="0.4"/>
    <linearGradient id="notg" href="#r1"/>
    <radialGradient id="rr" href="#rad" r="0.4"/>
  </defs>
  <rect id="r1" width="10" height="10"/>
</svg>`;

test('the chain: href before xlink:href; x1 y1 x2 y2 only from linear gradients (cx cy r fx fy fr only from radial ones); units, transform and spread from the first that has them; the stops from the first with any, of either kind; a cycle, a missing target and an element that isn’t a gradient end it', () => {
  const doc = load(CHAIN);
  const r = (id: string) => resolveGradient(doc, byId(doc, id))!;
  const ids = (list: NodeId[]) => list.map((n) => attrValue(doc, doc.nodes.get(n) as ElementNode, null, 'id'));
  const b = r('b');
  assert.deepEqual(ids(b.chain), ['b', 'a'], 'xlink:href followed');
  assert.deepEqual([b.attrs.get('x1')?.value, b.attrs.get('x1')?.from], ['0.1', byId(doc, 'a')], 'x1 from the template, and where it lives');
  assert.equal(b.attrs.get('x2')?.from, byId(doc, 'b'));
  assert.deepEqual([valueOf(b, 'gradientUnits'), valueOf(b, 'spreadMethod'), valueOf(b, 'y2')], ['userSpaceOnUse', 'reflect', '0%'], 'shared attributes from the template; the rest the defaults');
  assert.deepEqual([b.stopsFrom, b.stops.length], [byId(doc, 'a'), 2], 'the stops from the first that has any');
  const c = r('c');
  assert.deepEqual(ids(c.chain), ['c', 'rad'], 'href wins over xlink:href');
  assert.equal(c.attrs.has('x1'), false, 'a linear gradient never takes x1 from a radial template');
  assert.equal(valueOf(c, 'x1'), '0%');
  assert.deepEqual([c.stopsFrom, c.stops.length], [byId(doc, 'rad'), 1], 'but the stops come from any gradient');
  const rr = r('rr');
  assert.deepEqual([valueOf(rr, 'cx'), valueOf(rr, 'r'), valueOf(rr, 'fx'), valueOf(rr, 'fy')], ['0.3', '0.4', '0.2', '50%'], 'a radial template’s cx and fx; fy defaults to the resolved cy');
  assert.deepEqual(ids(r('cyc1').chain), ['cyc1', 'cyc2'], 'a cycle ends the chain');
  assert.equal(valueOf(r('cyc1'), 'x1'), '0.5');
  assert.deepEqual(ids(r('miss').chain), ['miss'], 'a missing target ends it');
  assert.deepEqual(ids(r('notg').chain), ['notg'], 'an element that isn’t a gradient ends it');
  assert.equal(resolveGradient(doc, byId(doc, 'r1')), null, 'a rect is no gradient');
});

test('a relative URL is not followed: a linearGradient and a radialGradient whose href, and one whose xlink:href, is other.svg#a resolve to themselves alone, with their own attributes or the defaults and no stops from #a, and their paints aren’t counted among #a’s users; an href beside a fragment xlink:href ends the chain too (SVG 2: href wins)', () => {
  const doc = load(`<svg ${SVG}>
  <defs>
    <linearGradient id="a" x1="0.3" x2="0.7"><stop offset="0" stop-color="red"/></linearGradient>
    <radialGradient id="ra" cx="0.2"><stop offset="0" stop-color="red"/></radialGradient>
    <linearGradient id="l1" href="other.svg#a" y2="0.5"/>
    <radialGradient id="r1" href="other.svg#ra"/>
    <linearGradient id="l2" xlink:href="other.svg#a"/>
    <linearGradient id="both" href="other.svg#a" xlink:href="#a"/>
  </defs>
  <rect id="p1" fill="url(#l1)"/>
  <rect id="p2" fill="url(#r1)"/>
  <rect id="p3" fill="url(#l2)"/>
  <rect id="p4" fill="url(#both)"/>
  <rect id="own" fill="url(#a)"/>
</svg>`);
  for (const [id, name, value] of [['l1', 'x1', '0%'], ['l1', 'y2', '0.5'], ['r1', 'cx', '50%'], ['l2', 'x2', '100%'], ['both', 'x1', '0%']] as const) {
    const r = resolveGradient(doc, byId(doc, id))!;
    assert.deepEqual(r.chain, [byId(doc, id)], `${id} resolves to itself alone`);
    assert.equal(valueOf(r, name), value, `${id}'s ${name}: its own or the default`);
    assert.deepEqual([r.stopsFrom, r.stops], [null, []], `${id} takes no stops from #a`);
  }
  const users = gradientUsers(doc);
  assert.deepEqual(users.get(byId(doc, 'a')), [{ el: byId(doc, 'own'), prop: 'fill' }], '#a’s only user is the rect that names it');
  assert.equal(users.get(byId(doc, 'ra')), undefined);
});

test('users and sharing: every paint whose chain includes a gradient uses it (fill and stroke, attribute and style="", through templates); an edit is shared when another element draws with what it writes', () => {
  const doc = load(`<svg ${SVG}>
  <linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient>
  <linearGradient id="t" href="#g" x2="0.5"/>
  <rect id="p" fill="url(#g)"/>
  <rect id="q" style="fill: url('#g')" stroke="url(#g) red"/>
  <circle id="u" fill="url(#t)"/>
</svg>`);
  const [g, t, p, q, u] = ['g', 't', 'p', 'q', 'u'].map((id) => byId(doc, id));
  const users = gradientUsers(doc);
  assert.deepEqual(users.get(g), [{ el: p, prop: 'fill' }, { el: q, prop: 'fill' }, { el: q, prop: 'stroke' }, { el: u, prop: 'fill' }]);
  assert.deepEqual(users.get(t), [{ el: u, prop: 'fill' }]);
  assert.deepEqual(sharedWith(users, [g], { el: p, prop: 'fill' }).sort(), [q, u].sort(), 'p’s stop edit changes q and u too');
  assert.deepEqual(sharedWith(users, [g], { el: q, prop: 'fill' }).sort(), [p, u].sort(), 'q’s own stroke is no other shape');
  assert.deepEqual(sharedWith(users, [t], { el: u, prop: 'fill' }), [], 'u’s x2 lives on t, which only u uses');
  assert.deepEqual(ownPaint(doc, q, 'stroke'), { value: 'url(#g) red', gradient: g, url: 'g', fallback: ' red' });
});

const STYLE_LAB = () => corpus('lab/style.svg');

test('Linear on lab/style.svg’s circle: SVG Lab’s top-to-bottom gradient, id linear-1, in a Draw-made <defs> before the circle with the file’s whitespace, the fill url(#linear-1); Colour gives the first stop’s colour back and takes the gradient, the <defs> and xmlns:draw away: the file as it was', () => {
  const F = STYLE_LAB();
  const s = run(F, 'Set fill', (doc, apply) => assert.deepEqual(setGradientPaint(doc, [first(doc, 'circle')], 'fill', 'linearGradient', CTX, apply), []));
  const want = F.replace('viewBox="0 0 100 100">', `viewBox="0 0 100 100" ${DRAW}>`)
    .replace('\n  <circle', '\n  <defs draw:made="true"><linearGradient id="linear-1" x1="0" y1="0" x2="0" y2="1" draw:made="true"><stop offset="0" stop-color="#e9c46a"/><stop offset="1" stop-color="#e76f51"/></linearGradient></defs>\n  <circle')
    .replace('fill="#e9c46a"', 'fill="url(#linear-1)"');
  assert.equal(serialize(s.doc), want);
  // The polyline's stroke too: linear-2, in the same <defs>.
  const two = new Session(load(want));
  two.dispatch('Set stroke', (apply) => setGradientPaint(two.doc, [first(two.doc, 'polyline')], 'stroke', 'linearGradient', CTX, apply));
  assert.match(serialize(two.doc), /<\/linearGradient><linearGradient id="linear-2" x1="0" y1="0" x2="0" y2="1" draw:made="true"><stop offset="0" stop-color="#e76f51"\/><stop offset="1" stop-color="#f4a261"\/><\/linearGradient><\/defs>/, 'a first colour of #e76f51 takes #f4a261 second');
  // Colour on the circle: its first stop's colour, and linear-1 goes; then linear-2 goes too.
  two.dispatch('Set fill', (apply) => setPlainPaint(two.doc, [first(two.doc, 'circle')], 'fill', () => '#e9c46a', CTX, apply));
  assert.ok(!serialize(two.doc).includes('linear-1') && serialize(two.doc).includes('<defs draw:made="true"><linearGradient id="linear-2"'), 'linear-1 went; the <defs> stays for linear-2');
  two.dispatch('Set stroke', (apply) => setPlainPaint(two.doc, [first(two.doc, 'polyline')], 'stroke', () => '#e76f51', CTX, apply));
  assert.equal(serialize(two.doc), F, 'with linear-2 gone, the <defs> and xmlns:draw go: the file byte for byte');
});

test('a new gradient in the file’s own <defs> goes last in it with its whitespace, numbered past the ids in use; None takes it away again byte for byte; several shapes get one each, N rising in document order; a colour that isn’t one (none, currentColor) starts SVG Lab’s', () => {
  const F = `<svg ${SVG} viewBox="0 0 100 100">
  <defs>
    <linearGradient id="linear-1"><stop offset="0" stop-color="red"/></linearGradient>
  </defs>
  <rect id="a" width="10" height="10" fill="none"/>
  <circle id="b" r="5" fill="currentColor"/>
</svg>`;
  const s = run(F, 'Set fill', (doc, apply) => setGradientPaint(doc, [byId(doc, 'a'), byId(doc, 'b')], 'fill', 'radialGradient', CTX, apply));
  const text = serialize(s.doc);
  assert.ok(text.includes(`</linearGradient>
    <radialGradient id="radial-1" cx="0.5" cy="0.5" r="0.5" draw:made="true"><stop offset="0" stop-color="#f4a261"/><stop offset="1" stop-color="#e76f51"/></radialGradient>
    <radialGradient id="radial-2" cx="0.5" cy="0.5" r="0.5" draw:made="true">`), text);
  assert.ok(text.includes('fill="url(#radial-1)"') && text.includes('fill="url(#radial-2)"'));
  const lin = run(F, 'Set fill', (doc, apply) => setGradientPaint(doc, [byId(doc, 'a')], 'fill', 'linearGradient', CTX, apply));
  assert.ok(serialize(lin.doc).includes('<linearGradient id="linear-2" '), 'linear-1 is taken: linear-2');
  lin.dispatch('Set fill', (apply) => setPlainPaint(lin.doc, [byId(lin.doc, 'a')], 'fill', () => 'none', CTX, apply));
  assert.equal(serialize(lin.doc), F, 'None takes it away with its whitespace, and the file’s <defs> stays');
});

test('the Draw-made predicate: only a <defs> or gradient with draw:made exactly "true" is Draw’s; a gradient holding a comment, a <defs> holding one, and draw:made="yes" stay with their content through Draw’s removals, and As-is and Clean take only their draw:* attributes', () => {
  const svg = (defs: string) => `<svg ${SVG} ${DRAW} viewBox="0 0 100 100">\n  ${defs}\n  <rect id="r" width="10" height="10" fill="url(#g-1)"/>\n</svg>`;
  const G = (made: string, inner = '') => `<linearGradient id="g-1" draw:made="${made}">${inner}<stop offset="0" stop-color="red"/></linearGradient>`;
  const none = (text: string) => {
    const s = new Session(load(text));
    s.dispatch('Set fill', (apply) => setPlainPaint(s.doc, [byId(s.doc, 'r')], 'fill', () => 'none', CTX, apply));
    return serialize(s.doc);
  };
  // Draw's own: the gradient and its <defs> go, and xmlns:draw with them.
  const own = svg(`<defs draw:made="true">${G('true')}</defs>`);
  assert.equal(none(own), svg('').replace(` ${DRAW}`, '').replace('\n  \n', '\n').replace('url(#g-1)', 'none'));
  // A comment in the <defs>: the gradient goes, the <defs> keeps the comment (and stays Draw-marked).
  assert.equal(none(svg(`<defs draw:made="true"><!-- mine -->${G('true')}</defs>`)), svg('<defs draw:made="true"><!-- mine --></defs>').replace('url(#g-1)', 'none'));
  // A comment in the gradient, or a mark that isn't exactly "true": nothing goes.
  for (const g of [G('true', '<!-- keep -->'), G('yes'), G(' true'), G('True')]) {
    const text = svg(`<defs draw:made="true">${g}</defs>`);
    assert.equal(none(text), text.replace('fill="url(#g-1)"', 'fill="none"'), g);
  }
  // The exports keep a gradient Draw made (it is drawing content), dropping only its draw:made; an
  // empty Draw-made <defs> goes; one holding a comment keeps its content.
  const kept = `<svg ${SVG} viewBox="0 0 100 100">\n  <defs><linearGradient id="g-1"><stop offset="0" stop-color="red"/></linearGradient></defs>\n  <rect id="r" width="10" height="10" fill="url(#g-1)"/>\n</svg>`;
  assert.equal(stripDrawState(load(own)), kept, 'As-is');
  assert.equal(cleanExport(load(own)).text, kept, 'Clean');
  const empty = svg('<defs draw:made="true">\n  </defs>');
  assert.equal(stripDrawState(load(empty)), svg('').replace(` ${DRAW}`, '').replace('\n  \n', '\n'), 'an empty Draw-made <defs> goes with its whitespace');
  const yes = svg(`<defs draw:made="yes">${G('yes')}</defs>`);
  assert.equal(stripDrawState(load(yes)), kept, 'draw:made="yes": only the attributes go');
});

test('Make unique: a standalone copy right after the gradient (id linear-1, draw:made), every attribute the chain resolves copied as written in the lab’s order but no href, the stops byte for byte; only this paint’s url(#…) id re-pointed (its fallback and the element’s other paint left as they were)', () => {
  const F = `<svg ${SVG} viewBox="0 0 100 100">
  <defs>
    <linearGradient id="a"><stop offset="0" stop-color="#e76f51"/>
      <stop offset="1" stop-color="#264653"/></linearGradient>
    <linearGradient id="b" xlink:href="#a" y2="1em" x1="0" gradientUnits="userSpaceOnUse" gradientTransform="rotate(30)"/>
  </defs>
  <rect id="p" width="10" height="10" fill="url(#b)" stroke="url(#b)"/>
  <rect id="q" width="10" height="10" style="fill: url('#b') red"/>
</svg>`;
  const s = run(F, 'Make unique', (doc, apply) => assert.equal(typeof makeUnique(doc, byId(doc, 'p'), 'fill', apply), 'number'));
  const text = serialize(s.doc);
  assert.ok(text.includes(`gradientTransform="rotate(30)"/>
    <linearGradient id="linear-1" x1="0" y2="1em" gradientUnits="userSpaceOnUse" gradientTransform="rotate(30)" draw:made="true"><stop offset="0" stop-color="#e76f51"/>
      <stop offset="1" stop-color="#264653"/></linearGradient>
  </defs>`), text);
  assert.ok(text.includes('fill="url(#linear-1)" stroke="url(#b)"'), 'only the fill re-pointed; the stroke stays shared');
  assert.ok(!/id="linear-1"[^>]*href/.test(text), 'no href on the copy');
  s.dispatch('Make unique', (apply) => makeUnique(s.doc, byId(s.doc, 'q'), 'fill', apply));
  assert.ok(serialize(s.doc).includes(`style="fill: url('#linear-2') red"`), 'in style="": the id’s characters only, the quotes and fallback kept');
  assert.equal(stripDrawState(s.doc).includes('draw:'), false);
});

test('the stop editor: a stop added after another sits at the midpoint, coloured as the gradient is there (sRGB, the first neighbour’s notation), with its whitespace; after the last, between it and 1 in its colour; a % offset stays one; an offset rewrites only its number; Remove takes a stop with its whitespace but never the last; stop-color in a stop’s style="" is rewritten there', () => {
  const F = `<svg ${SVG}>
  <linearGradient id="g">
    <stop offset="0" stop-color="#000000"/>
    <stop offset="1" stop-color="#ffffff"/>
  </linearGradient>
  <linearGradient id="p"><stop offset="0%" stop-color="rgb(255, 0, 0)"/><stop offset="50%" stop-color="rgb(0, 0, 255)" stop-opacity="0.5"/></linearGradient>
  <linearGradient id="one"><stop offset="0.5" style="stop-color:#ffffff;stop-opacity:1"/></linearGradient>
</svg>`;
  const r = (doc: Doc, id: string) => resolveGradient(doc, byId(doc, id))!;
  const mid = run(F, 'Add stop', (doc, apply) => addStop(doc, r(doc, 'g'), r(doc, 'g').stops[0], apply));
  assert.equal(serialize(mid.doc), F.replace('<stop offset="0" stop-color="#000000"/>', '<stop offset="0" stop-color="#000000"/>\n    <stop offset="0.5" stop-color="#808080"/>'));
  const end = run(F, 'Add stop', (doc, apply) => addStop(doc, r(doc, 'p'), null, apply));
  assert.ok(serialize(end.doc).includes('stop-opacity="0.5"/><stop offset="75%" stop-color="rgb(0, 0, 255)" stop-opacity="0.5"/>'), serialize(end.doc));
  const pct = run(F, 'Add stop', (doc, apply) => addStop(doc, r(doc, 'p'), r(doc, 'p').stops[0], apply));
  assert.ok(serialize(pct.doc).includes('<stop offset="25%" stop-color="rgb(127.5, 0, 127.5)" stop-opacity="0.75"/>'), serialize(pct.doc));
  const off = run(F, 'Set offset', (doc, apply) => apply(offsetOp(doc, r(doc, 'p').stops[1], 0.3)));
  assert.equal(serialize(off.doc), F.replace('offset="50%"', 'offset="30%"'));
  assert.equal(stopOffset(off.doc, r(off.doc, 'p').stops[1]), 0.3);
  const gone = run(F, 'Remove stop', (doc, apply) => removeStop(doc, r(doc, 'g'), r(doc, 'g').stops[1], apply));
  assert.equal(serialize(gone.doc), F.replace('\n    <stop offset="1" stop-color="#ffffff"/>', ''));
  const s = new Session(load(F));
  assert.throws(() => s.dispatch('Remove stop', (apply) => removeStop(s.doc, r(s.doc, 'one'), r(s.doc, 'one').stops[0], apply)), (e: Error) => e.message === LAST_STOP);
  assert.equal(serialize(s.doc), F, 'refused: nothing written');
  const colour = run(F, 'Set stop-color', (doc, apply) => applyPlan(doc, planStyle(doc, r(doc, 'one').stops, 'stop-color', '#123456', CTX), apply));
  assert.equal(serialize(colour.doc), F.replace('stop-color:#ffffff;', 'stop-color:#123456;'));
  assert.equal(stopColour(colour.doc, r(colour.doc, 'one').stops[0]), '#123456');
});

const ICON = () => corpus('lab/create-icon.svg');

test('Gloss on lab/create-icon.svg’s rect: SVG Lab’s radialGradient gloss-1 (cx 0.35, cy 0.3, r 0.8; white to the rect’s own #264653) in a Draw-made <defs>, the fill url(#gloss-1); Gloss off gives the file back byte for byte, in a file with <defs> too; one kept by a comment stays', () => {
  const F = ICON();
  const rect = (doc: Doc) => first(doc, 'rect');
  const on = run(F, 'Gloss', (doc, apply) => assert.deepEqual(glossOn(doc, [rect(doc)], CTX, apply), []));
  const text = serialize(on.doc);
  assert.ok(text.includes('<defs draw:made="true"><radialGradient id="gloss-1" cx="0.35" cy="0.3" r="0.8" draw:made="true"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#264653"/></radialGradient></defs>\n  <rect'), text);
  assert.ok(text.includes('fill="url(#gloss-1)"'));
  assert.equal(glossOf(on.doc, rect(on.doc)), byId(on.doc, 'gloss-1'));
  on.dispatch('Gloss off', (apply) => glossOff(on.doc, [rect(on.doc)], CTX, apply));
  assert.equal(serialize(on.doc), F, 'on then off: byte for byte');
  // A file with its own <defs>; two shapes: gloss-1, gloss-2 in document order; a fill that isn't a colour takes #e76f51.
  const D = `<svg ${SVG} viewBox="0 0 100 100">\n  <defs>\n    <clipPath id="c"><rect width="5" height="5"/></clipPath>\n  </defs>\n  <circle id="a" r="5" fill="#2a9d8f"/>\n  <path id="b" d="M0 0L9 9" fill="none"/>\n</svg>`;
  const two = run(D, 'Gloss', (doc, apply) => glossOn(doc, [byId(doc, 'a'), byId(doc, 'b')], CTX, apply));
  const t2 = serialize(two.doc);
  assert.ok(t2.includes('<radialGradient id="gloss-1" cx="0.35" cy="0.3" r="0.8" draw:made="true"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#2a9d8f"/></radialGradient>\n    <radialGradient id="gloss-2"'), t2);
  assert.ok(t2.includes('<stop offset="1" stop-color="#e76f51"/>'), 'no colour: SVG Lab’s');
  two.dispatch('Gloss off', (apply) => glossOff(two.doc, [byId(two.doc, 'a'), byId(two.doc, 'b')], CTX, apply));
  assert.equal(serialize(two.doc), D.replace('fill="none"', 'fill="#e76f51"'), 'off gives the end colour back, and takes both gradients away');
  // Someone commented Draw's gloss gradient: off keeps it.
  const kept = new Session(load(text.replace('<stop offset="0"', '<!-- tweaked --><stop offset="0"')));
  kept.dispatch('Gloss off', (apply) => glossOff(kept.doc, [rect(kept.doc)], CTX, apply));
  assert.ok(serialize(kept.doc).includes('<!-- tweaked -->') && serialize(kept.doc).includes('fill="#264653"'));
  // Not for a line, text, a group or the root.
  const doc = load(`<svg ${SVG}><line x2="5"/><text>t</text><g/><rect/></svg>`);
  assert.deepEqual(['line', 'text', 'g', 'rect'].map((l) => glossable(doc, first(doc, l))), [false, false, false, true]);
  assert.equal(glossable(doc, doc.root), false);
});
