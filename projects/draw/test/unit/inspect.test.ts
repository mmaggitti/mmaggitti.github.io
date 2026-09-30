// Inspect's style properties (P1-M2 S2), driven through the real Editor over the fake views
// (fakes.ts): what Inspect reads over the selection (own, inherited "from …", the default, set by a
// <style> rule, Mixed); one history entry per edit (a segment over many shapes, a slider's press, a
// field while it has focus, a Colour-sheet visit); the stroke sheet (its width slider in the same
// visit, the width-2 rule); the Dash presets × k; and linear time over a large selection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, type ElementNode, type NodeId } from '../../../../engine/model/doc.ts';
import type { Editor } from '../../src/editor.ts';
import { RULE_SETS } from '../../../../engine/style/write.ts';
import { checkStyle, dashPresets, paintKinds } from '../../src/style-edit.ts';
import { colorChoices, styleSlot } from '../../src/color-choices.ts';
import { pickAlpha, pickHue, pickSV, pickerStart, pickerText } from '../../src/color-picker.ts';
import { bind, fakeEditor, fakePorts } from './fakes.ts';
import { Editor as EditorClass } from '../../src/editor.ts';
import type { ViewBlock } from '../../src/codeview/code-view.ts';
import { stripDrawState } from '../../../../engine/model/draw-state.ts';

const svg = (body: string, viewBox = '0 0 100 100') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n  ${body}\n</svg>\n`;

function opened(src: string): Editor {
  const e = fakeEditor();
  const r = e.open(src);
  assert.ok(r.ok, r.error);
  return e;
}
const idOf = (e: Editor, id: string): NodeId =>
  ([...descendants(e.doc!, e.doc!.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === id)) as ElementNode).id;
const select = (e: Editor, ...ids: string[]) => e.select(ids.map((id) => idOf(e, id)));

/** The file after edits that changed only each `was` (which occurs once) into its `now`. */
function edited(file: string, ...pairs: [string, string][]): string {
  for (const [was, now] of pairs) {
    assert.equal(file.split(was).length, 2, `${JSON.stringify(was)} occurs once`);
    file = file.replace(was, now);
  }
  return file;
}

const RECT = '<rect id="a" x="5" y="5" width="20" height="20" fill="#e76f51"/>';
const CIRCLE = '<circle id="b" cx="50" cy="15" r="10" style="fill: #2a9d8f ;stroke-width:2 !important"/>';
const ELLIPSE = '<ellipse id="c" cx="80" cy="15" rx="12" ry="6"/>';
const GROUP = '<g id="badge" fill="#264653" stroke-width="3"><circle id="kid" cx="20" cy="60" r="8"/></g>';
const RULED = '<polygon id="k" class="k" points="60,50 80,50 70,68"/>';
const STYLE = '<style>.k { fill: red }</style>';
const FILE = svg([STYLE, RECT, CIRCLE, ELLIPSE, GROUP, RULED].join('\n  '));

test('what Inspect reads: the element’s own value, one inherited from a group ("from <g#badge>"), the default, one a <style> rule may set (disabled with the P2 notice), and Mixed over several', () => {
  const e = opened(FILE);
  select(e, 'a');
  assert.deepEqual(e.styleRow('fill'), { value: '#e76f51', mixed: false, from: 'own', note: '', disabled: null });
  select(e, 'b');
  assert.deepEqual(e.styleRow('fill'), { value: '#2a9d8f', mixed: false, from: 'own', note: '', disabled: null }, 'style="" holds it');
  select(e, 'kid');
  assert.deepEqual(e.styleRow('fill'), { value: '#264653', mixed: false, from: 'ancestor', note: 'from <g#badge>', disabled: null });
  assert.equal(e.styleRow('stroke-width')?.note, 'from <g#badge>');
  assert.deepEqual(e.styleRow('opacity'), { value: '1', mixed: false, from: 'default', note: 'default', disabled: null }, 'opacity doesn’t inherit');
  select(e, 'c');
  assert.deepEqual(e.styleRow('stroke'), { value: 'none', mixed: false, from: 'default', note: 'default', disabled: null });
  select(e, 'k');
  assert.deepEqual(e.styleRow('fill'), { value: '', mixed: false, from: 'rule', note: 'set by a <style> rule', disabled: RULE_SETS('fill') });
  e.setStyle('fill', '#000000');
  assert.equal(e.notice.get(), RULE_SETS('fill'), 'a tap on a rule-set value writes nothing and says why');
  assert.equal(e.source(), FILE);
  assert.equal(e.history.get().canUndo, false, 'and records nothing');
  select(e, 'a', 'b', 'c');
  assert.equal(e.styleRow('fill')?.mixed, true, 'three fills: Mixed');
  select(e, 'a', 'k');
  assert.deepEqual([e.styleRow('fill')?.mixed, e.styleRow('fill')?.disabled], [true, null], 'one of them can take a fill, so the control writes');
  assert.equal(e.styleRow('fill')?.from, 'own', 'the first one’s source');
});

test('a multi-selection edit is one entry: Set fill over three shapes writes each where it lives, one undo gives all three back byte for byte; with a rule-set shape too, the others change and one notice names it', () => {
  const e = opened(FILE);
  select(e, 'a', 'b', 'c');
  e.setStyle('fill', '#e9c46a');
  assert.equal(e.history.get().undoLabel, 'Set fill');
  const set = edited(FILE, [RECT, RECT.replace('#e76f51', '#e9c46a')], [CIRCLE, CIRCLE.replace('#2a9d8f', '#e9c46a')], [ELLIPSE, ELLIPSE.replace('/>', ' fill="#e9c46a"/>')]);
  assert.equal(e.source(), set, 'the attribute, the declaration’s value alone, a new attribute');
  e.undo();
  assert.equal(e.source(), FILE, 'one undo gives all three back');
  assert.equal(e.history.get().canUndo, false, 'it was one entry');
  select(e, 'a', 'b', 'c', 'k');
  e.setStyle('fill', '#e9c46a');
  assert.equal(e.source(), set, 'the rule-set polygon keeps its fill');
  assert.equal(e.notice.get(), `1 of 4 kept their fill (<polygon#k>): ${RULE_SETS('fill')}`);
  e.undo();
  assert.equal(e.source(), FILE);
});

test('one entry per editing session, per kind: an Inspect field (stroke-width typed "25"), a slider’s press (opacity), and a Colour-sheet visit (the square, both sliders, a swatch and typed text); one undo gives back the value from before each', () => {
  const F = svg('<rect id="a" x="5" y="5" width="20" height="20" fill="#e76f51" stroke="#264653" stroke-width="1"/>');
  const e = opened(F);
  select(e, 'a');
  // The field: each keystroke that reads is written live, one entry when it lets go.
  e.fieldStart({ kind: 'style', prop: 'stroke-width' });
  assert.equal(e.fieldInput('2'), null);
  assert.equal(e.fieldInput('25'), null);
  assert.equal(e.source(), F.replace('stroke-width="1"', 'stroke-width="25"'), 'written live');
  assert.match(e.fieldInput('25x') ?? '', /is not a number/, 'text that doesn’t read says why');
  assert.equal(e.source(), F.replace('stroke-width="1"', 'stroke-width="25"'), 'and the last good value stays');
  e.fieldEnd();
  assert.equal(e.history.get().undoLabel, 'Set stroke-width');
  e.undo();
  assert.equal(e.source(), F, 'typing "25" was one entry');
  assert.equal(e.history.get().canUndo, false);
  // The slider: one entry per press, however many moves.
  assert.ok(e.styleDrag('opacity'));
  for (const v of ['0.9', '0.7', '0.5']) assert.equal(e.styleInput(v), null);
  e.styleDragEnd();
  assert.equal(e.source(), F.replace('/>', ' opacity="0.5"/>'));
  assert.equal(e.history.get().undoLabel, 'Set opacity');
  e.undo();
  assert.equal(e.source(), F, 'the press was one entry');
  // The Colour sheet: one entry per visit, whatever moved in it.
  e.openStyleSheet('fill');
  assert.deepEqual(e.sheet.get(), { kind: 'style', prop: 'fill', ids: [idOf(e, 'a')], text: '#e76f51' });
  let p = pickerStart('#e76f51');
  for (const next of [pickSV(p, 0.5, 0.5), pickHue(pickSV(p, 0.5, 0.5), 120), pickAlpha(pickHue(pickSV(p, 0.5, 0.5), 120), 0.5)]) {
    p = next;
    assert.ok('text' in e.sheetInput(pickerText(p)));
  }
  assert.ok(e.source().includes('fill="#40804080"'), e.source());
  assert.ok('text' in e.sheetInput('#264653'), 'a swatch');
  assert.ok('text' in e.sheetInput('rgb(1 2 3)'), 'typed text');
  assert.deepEqual(e.sheetInput('nope'), { error: '"nope" is not a colour' }, 'refused text is never written');
  e.closeSheet();
  assert.equal(e.source(), F.replace('#e76f51', 'rgb(1 2 3)'));
  assert.equal(e.history.get().undoLabel, 'Set fill');
  e.undo();
  assert.equal(e.source(), F, 'the visit was one entry');
  assert.equal(e.history.get().canUndo, false);
});

test('the stroke sheet: a stroke given to a shape with none also gets the width-2 rule’s width (2k), and its stroke-width slider writes in the same visit; a width already there is kept', () => {
  const F = svg('<rect id="a" x="5" y="5" width="20" height="20" fill="#e76f51" stroke="none"/>\n  <rect id="w" x="40" y="5" width="20" height="20" stroke="none" stroke-width="5"/>');
  const e = opened(F);
  select(e, 'a');
  e.openStyleSheet('stroke');
  e.sheetInput('#264653');
  assert.equal(e.source(), F.replace('stroke="none"/>', 'stroke="#264653" stroke-width="2"/>'), 'the width-2 rule');
  assert.equal(e.styleRow('stroke-width')?.value, '2', 'the width slider reads it');
  assert.ok('text' in e.sheetInput('7', 'stroke-width'), 'the width slider');
  e.sheetInput('#e9c46a');
  e.closeSheet();
  assert.equal(e.source(), F.replace('stroke="none"/>', 'stroke="#e9c46a" stroke-width="7"/>'), 'the slider’s width stays over the rule’s');
  assert.equal(e.history.get().undoLabel, 'Set stroke');
  e.undo();
  assert.equal(e.source(), F, 'one entry for the visit');
  select(e, 'w');
  e.openStyleSheet('stroke');
  e.sheetInput('#264653');
  e.closeSheet();
  assert.equal(e.source(), F.replace('stroke="none" stroke-width="5"', 'stroke="#264653" stroke-width="5"'), 'a width already there is kept');
  // On a 250-unit artboard, k is 2.5: the rule's width is 5.
  const big = opened(svg('<rect id="a" width="50" height="50" stroke="none"/>', '0 0 250 250'));
  select(big, 'a');
  big.setStyle('stroke', '#264653');
  assert.ok(big.source().includes('stroke="#264653" stroke-width="5"'), big.source());
});

test('a line: Inspect offers it no Fill row and its stroke no None, as its stroke sheet offers no none chip (SVG Lab’s styleAttrs and L1885); a selection with a line and a rect keeps Fill, but its stroke still takes no None; the width and Cap write, one entry each', () => {
  assert.equal(paintKinds('fill', ['line']), null);
  assert.deepEqual(paintKinds('stroke', ['line']), ['color', 'linear', 'radial']);
  assert.deepEqual(paintKinds('fill', ['line', 'rect']), ['none', 'color', 'linear', 'radial'], 'the rect has a fill');
  assert.deepEqual(paintKinds('stroke', ['line', 'rect']), ['color', 'linear', 'radial'], 'none would make the line vanish');
  assert.deepEqual(paintKinds('stroke', ['polyline']), ['none', 'color', 'linear', 'radial'], 'only a line drops it');
  const chips = (locals: string[]) => colorChoices(styleSlot('stroke', locals), 'red').chips.map((c) => c.value);
  assert.ok(!chips(['line']).includes('none') && !chips(['rect', 'line']).includes('none') && chips(['rect']).includes('none'));
  const F = svg('<line id="l" x1="10" y1="10" x2="90" y2="60" stroke="#e76f51" stroke-width="4"/>');
  const e = opened(F);
  select(e, 'l');
  e.fieldStart({ kind: 'style', prop: 'stroke-width' });
  assert.equal(e.fieldInput('9'), null);
  e.fieldEnd();
  assert.equal(e.source(), F.replace('stroke-width="4"', 'stroke-width="9"'));
  e.setStyle('stroke-linecap', 'round');
  assert.equal(e.source(), F.replace('stroke-width="4"/>', 'stroke-width="9" stroke-linecap="round"/>'));
  e.undo();
  e.undo();
  assert.equal(e.source(), F, 'one entry each');
});

test('the Dash presets are SVG Lab’s none, "10 6", "2 6" and "16 4 2 4", each number × k', () => {
  assert.deepEqual(dashPresets(1), ['none', '10 6', '2 6', '16 4 2 4']);
  assert.deepEqual(dashPresets(2.5), ['none', '25 15', '5 15', '40 10 5 10']);
  const e = opened(svg('<polyline id="p" points="10,10 200,100" stroke="#264653"/>', '0 0 250 250'));
  select(e, 'p');
  assert.equal(e.styleCtx.k, 2.5);
  e.setStyle('stroke-dasharray', dashPresets(e.styleCtx.k)[1]);
  assert.ok(e.source().includes('stroke-dasharray="25 15"'), e.source());
});

// Over a large selection a style edit costs time in proportion to it: every element is read once,
// and the sheets once per edit (css.ts's cache), not once per element. Measured in node: Set fill
// over 1,000 and 4,000 shapes took about 40 and 150 ms, a slider's press about 80 and 250 ms; with
// the sheets read for every element, 3.2 s and 51 s, and 9.8 s and 137 s.
test('a style edit over a large selection takes linear time: Set fill, and a slider frame, over 4,000 shapes cost about 4× what they cost over 1,000 (under 6×)', () => {
  const many = (n: number): Editor => {
    const side = Math.ceil(Math.sqrt(n));
    const at = (v: number) => ((v * 100) / side).toFixed(2);
    const rules = Array.from({ length: 20 }, (_, i) => `.c${i} { stroke: red }`).join(' ');
    const shapes = Array.from({ length: n }, (_, i) => `<rect id="r${i}" x="${at(i % side)}" y="${at(Math.floor(i / side))}" width="1" height="1"${i % 3 ? ` fill="#264653"` : ''}${i % 5 === 0 ? ' style="fill: blue"' : ''}/>`).join('\n  ');
    const e = opened(svg(`<style>${rules}</style>\n  ${shapes}`));
    e.selectAll();
    assert.equal(e.selection.get().size, n, 'test setup: Select all took every rect');
    return e;
  };
  const acts: [string, string, (e: Editor) => void, number][] = [
    ['Set fill', 'Set fill', (e) => e.setStyle('fill', '#e9c46a'), 1500],
    ['a slider’s press, frame and release', 'Set opacity', (e) => {
      e.styleDrag('opacity');
      e.styleInput('0.5');
      e.styleDragEnd();
    }, 2000],
  ];
  const cost = (n: number, label: string, act: (e: Editor) => void): number => {
    const e = many(n);
    const t = performance.now();
    act(e);
    const ms = performance.now() - t;
    assert.equal(e.history.get().undoLabel, label, `test setup: ${label} did something over ${n} shapes (${e.notice.get()})`);
    return ms;
  };
  for (const [, label, act] of acts) cost(200, label, act); // warm the engine up
  for (const [what, label, act, limit] of acts) {
    // A pause of the runner's can land in one run: a miss is measured twice more, and the fastest
    // run of each size counts. A per-element sheet read costs seconds over 1,000 shapes already, so
    // then 4,000 isn't waited for.
    let small = Infinity;
    let big = Infinity;
    for (let run = 0; run < 3; run++) {
      small = Math.min(small, cost(1000, label, act));
      if (small >= limit / 4) continue;
      big = Math.min(big, cost(4000, label, act));
      if (big < 6 * small && big < limit) break;
    }
    assert.ok(small < limit / 4, `${what}: ${small.toFixed(0)} ms over 1,000 shapes (the limit is ${limit / 4})`);
    assert.ok(big < 6 * small, `${what}: ${small.toFixed(0)} ms over 1,000 shapes, ${big.toFixed(0)} ms over 4,000 (×${(big / small).toFixed(1)}; linear is ×4, the most ×6)`);
    assert.ok(big < limit, `${what}: ${big.toFixed(0)} ms over 4,000 shapes (the limit is ${limit})`);
  }
});

// ── S3: gradients, the stop editor and gloss ─────────────────────────────────────────────────────

const GRAD = svg(`<defs>
    <linearGradient id="shared"><stop offset="0" stop-color="#e76f51"/><stop offset="1" stop-color="#264653"/></linearGradient>
    <radialGradient id="rad" cx="0.5" cy="0.5" r="0.4" fx="0.4"><stop offset="0" style="stop-color:#ffffff;stop-opacity:1"/><stop offset="1" stop-color="#2a9d8f"/></radialGradient>
  </defs>
  <rect id="a" x="5" y="5" width="20" height="20" fill="#e9c46a"/>
  <rect id="b" x="30" y="5" width="20" height="20" fill="url(#shared)"/>
  <rect id="c" x="55" y="5" width="20" height="20" fill="url(#shared)"/>
  <circle id="d" cx="20" cy="60" r="10" fill="url(#rad)"/>`);

test('gradients through Inspect, one entry each: Linear writes SVG Lab’s gradient and Colour after it gives the bytes back; Radial, then None, likewise; a shared gradient says so and Make unique gives this shape its own; Spread, Add stop and Remove stop; Gloss on and off', () => {
  const e = opened(GRAD);
  const one = (label: string, was: string) => {
    assert.equal(e.history.get().undoLabel, label);
    const now = e.source();
    e.undo();
    assert.equal(e.source(), was, `${label}: one undo`);
    e.redo();
    assert.equal(e.source(), now);
  };
  select(e, 'a');
  assert.equal(e.paintInfo('fill')?.kind, 'color');
  e.setPaintKind('fill', 'linear');
  assert.ok(e.source().includes('<linearGradient id="linear-1" x1="0" y1="0" x2="0" y2="1" draw:made="true"><stop offset="0" stop-color="#e9c46a"/><stop offset="1" stop-color="#e76f51"/></linearGradient>'), e.source());
  assert.equal(e.paintInfo('fill')?.kind, 'linear');
  one('Set fill', GRAD);
  e.setPaintKind('fill', 'color');
  assert.equal(e.source(), GRAD, 'Colour after Linear: the first stop’s colour back, the gradient gone, xmlns:draw gone');
  e.setPaintKind('fill', 'radial');
  assert.equal(e.paintInfo('fill')?.kind, 'radial');
  e.setPaintKind('fill', 'none');
  assert.equal(e.source(), GRAD.replace('fill="#e9c46a"', 'fill="none"'), 'None takes the Draw-made gradient away');
  e.undo();
  e.undo();
  assert.equal(e.source(), GRAD);
  // Shared: b's gradient is c's too; Make unique gives b its own.
  select(e, 'b');
  const info = e.paintInfo('fill')!;
  assert.deepEqual([info.kind, info.shared, info.stops.map((x) => x.colour), info.spread, info.units], ['linear', 1, ['#e76f51', '#264653'], 'pad', 'Box']);
  e.makeUnique('fill');
  assert.ok(e.source().includes('fill="url(#linear-1)"') && e.source().includes('<rect id="c" x="55" y="5" width="20" height="20" fill="url(#shared)"/>'), e.source());
  assert.equal(e.paintInfo('fill')?.shared, 0, 'unique now');
  one('Make unique', GRAD);
  e.undo();
  // Spread, Add stop, Remove stop on the shared gradient (the file's own: it stays).
  e.setSpread('fill', 'reflect');
  assert.equal(e.source(), GRAD.replace('<linearGradient id="shared">', '<linearGradient id="shared" spreadMethod="reflect">'));
  one('Set spreadMethod', GRAD);
  e.undo();
  e.addStop('fill', e.paintInfo('fill')!.stops[0].id);
  assert.ok(e.source().includes('stop-color="#e76f51"/><stop offset="0.5" stop-color="#875b52"/><stop offset="1"'), e.source());
  one('Add stop', GRAD);
  e.undo();
  e.removeStop('fill', e.paintInfo('fill')!.stops[1].id);
  assert.equal(e.source(), GRAD.replace('<stop offset="1" stop-color="#264653"/>', ''));
  one('Remove stop', GRAD);
  e.undo();
  // Gloss on a plain rect, then off: byte for byte.
  select(e, 'a');
  assert.equal(e.glossState(), 'off');
  e.toggleGloss();
  assert.ok(e.source().includes('<radialGradient id="gloss-1" cx="0.35" cy="0.3" r="0.8" draw:made="true">') && e.glossState() === 'on');
  assert.equal(e.paintInfo('fill')?.gloss, true);
  one('Gloss', GRAD);
  e.toggleGloss();
  assert.equal(e.source(), GRAD, 'Gloss off gives the file back');
  assert.equal(e.history.get().undoLabel, 'Gloss off');
});

test('the stop editor, one entry per editing session: an offset typed then left, its − and + one each, a stop-opacity press, a stop’s Colour-sheet visit (no none chip), and a radial gradient’s fx field; one undo gives back the value from before each', () => {
  const e = opened(GRAD);
  select(e, 'd');
  const stops = e.paintInfo('fill')!.stops;
  // The offset field: typed "0.3", then "0.35", then left.
  e.fieldStart({ kind: 'offset', stop: stops[1].id });
  assert.equal(e.fieldInput('0.3'), null);
  assert.equal(e.fieldInput('0.35'), null);
  assert.match(e.fieldInput('1.5') ?? '', /not an offset/, 'out of 0–1: refused, the last good one stays');
  e.fieldEnd();
  assert.equal(e.source(), GRAD.replace('<stop offset="1" stop-color="#2a9d8f"/>', '<stop offset="0.35" stop-color="#2a9d8f"/>'));
  assert.equal(e.history.get().undoLabel, 'Set offset');
  e.undo();
  assert.equal(e.source(), GRAD, 'typing was one entry');
  e.stepStopOffset(stops[0].id, 1);
  e.stepStopOffset(stops[0].id, 1);
  assert.equal(e.source(), GRAD.replace('<stop offset="0" style=', '<stop offset="0.1" style='));
  e.undo();
  assert.equal(e.source(), GRAD.replace('<stop offset="0" style=', '<stop offset="0.05" style='), '− and + one entry each');
  e.undo();
  // stop-opacity: one press, in the stop's style="".
  assert.ok(e.styleDrag('stop-opacity', [stops[0].id]));
  for (const v of ['0.8', '0.5']) assert.equal(e.styleInput(v), null);
  e.styleDragEnd();
  assert.equal(e.source(), GRAD.replace('stop-opacity:1"', 'stop-opacity:0.5"'));
  e.undo();
  assert.equal(e.source(), GRAD, 'the press was one entry');
  // The stop's colour: the Colour sheet over the stop, one visit, no none.
  e.openStyleSheet('stop-color', [stops[1].id]);
  assert.deepEqual(e.sheet.get(), { kind: 'style', prop: 'stop-color', ids: [stops[1].id], text: '#2a9d8f' });
  assert.ok('text' in e.sheetInput('#e9c46a'));
  assert.ok('text' in e.sheetInput('#264653'));
  e.closeSheet();
  assert.equal(e.source(), GRAD.replace('stop-color="#2a9d8f"', 'stop-color="#264653"'));
  e.undo();
  assert.equal(e.source(), GRAD, 'the visit was one entry');
  // fx: one entry while typed.
  e.fieldStart({ kind: 'gradient', prop: 'fill', name: 'fx' });
  assert.equal(e.fieldInput('0.3'), null);
  assert.equal(e.fieldInput('0.35'), null);
  e.fieldEnd();
  assert.equal(e.source(), GRAD.replace('fx="0.4"', 'fx="0.35"'));
  e.undo();
  assert.equal(e.source(), GRAD);
  assert.equal(e.history.get().canUndo, false);
});

test('relative URLs keep their bytes: a relative gradient href, a relative xlink:href and a relative paint url() are never touched by Linear on another shape, a stop edit, Make unique of a gradient another shape shares, Colour back, or the As-is export; a Text-sheet edit of the href token rewrites only the URL’s characters, one entry one undo takes back', () => {
  const F = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>
    <linearGradient id="rel" href="other.svg#a"/>
    <radialGradient id="relx" xlink:href="lib/other.svg#b"/>
  </defs>
  <rect id="p" width="10" height="10" fill="url(#g)"/>
  <rect id="q" x="20" width="10" height="10" fill="url(#g)"/>
  <rect id="r" x="40" width="10" height="10" fill="url(other.svg#g) red"/>
  <rect id="s" x="60" width="10" height="10" fill="#e9c46a"/>
</svg>
`;
  const listing = new Map<string, ViewBlock>();
  const ports = fakePorts();
  ports.code = { ...ports.code, set: (bs) => { listing.clear(); for (const b of bs) listing.set(b.key, b); }, patch: (b) => void (listing.has(b.key) && listing.set(b.key, b)) };
  const e = bind(ports, new EditorClass(ports));
  assert.ok(e.open(F).ok);
  const RELS = ['href="other.svg#a"', 'xlink:href="lib/other.svg#b"', 'fill="url(other.svg#g) red"'];
  const kept = (what: string) => {
    for (const r of RELS) assert.ok(e.source().includes(r), `${what}: ${r} kept byte for byte`);
  };
  select(e, 's');
  e.setPaintKind('fill', 'linear');
  kept('Linear on another shape');
  select(e, 'p');
  e.addStop('fill', null);
  kept('a stop edit');
  e.makeUnique('fill');
  kept('Make unique of a shared gradient');
  select(e, 's');
  e.setPaintKind('fill', 'color');
  kept('Colour back');
  assert.ok(stripDrawState(e.doc!).includes(RELS.join('') === '' ? '' : RELS[0]) && RELS.every((r) => stripDrawState(e.doc!).includes(r)), 'the As-is export keeps them');
  // The href token (text) through the Text sheet: only the URL's characters.
  const before = e.source();
  const rel = idOf(e, 'rel');
  const block = listing.get(`${rel}:start`) ?? listing.get(`${rel}:leaf`);
  assert.ok(block);
  const token = block.tokens.find((t) => t.kind === 'text');
  assert.ok(token, `the relative href is a text token: ${JSON.stringify(block.tokens)}`);
  e.tapToken(block, token);
  assert.equal(e.sheet.get()?.kind, 'text');
  assert.ok('text' in e.sheetInput('#g'));
  e.closeSheet();
  assert.equal(e.source(), before.replace('href="other.svg#a"', 'href="#g"'), 'only the URL’s characters');
  e.undo();
  assert.equal(e.source(), before, 'one entry');
});

test('Edit on canvas: the gradient’s handles instead of the shape’s, with its box and line; a drag of the end is one "Gradient end" that writes x2 and y2 on the gradient the paint names; it ends when the selection changes', () => {
  const e = opened(GRAD);
  select(e, 'b');
  assert.ok(e.overlayModel().handles.some((h) => h.id === 'tl'), 'test setup: a rect’s corners');
  e.toggleEditGradient('fill');
  assert.equal(e.editGradient.get(), 'fill');
  const m = e.overlayModel();
  assert.deepEqual(m.handles.map((h) => h.id), ['g-start', 'g-end'], 'only the gradient’s handles');
  assert.ok(m.gradient?.box?.length === 4 && m.gradient.line && m.gradient.labels.map((l) => l.text).join() === '0,0,1,1');
  const end = m.handles.find((h) => h.id === 'g-end')!.at;
  const start = m.handles.find((h) => h.id === 'g-start')!.at;
  assert.ok(Math.abs(end.y - start.y) < 1e-6 && end.x > start.x, 'the default: left to right across the box');
  const to = { x: (start.x + end.x) / 2, y: end.y + (end.x - start.x) / 2 };
  e.pointerDown(end, [], { add: false });
  for (let i = 1; i <= 4; i++) e.pointerDrag({ x: end.x + ((to.x - end.x) * i) / 4, y: end.y + ((to.y - end.y) * i) / 4 });
  e.pointerUp(to);
  assert.equal(e.history.get().undoLabel, 'Gradient end');
  assert.match(e.source(), /<linearGradient id="shared" x2="0\.5" y2="0\.5">/, e.source());
  e.undo();
  assert.equal(e.source(), GRAD, 'one entry');
  select(e, 'a');
  assert.equal(e.editGradient.get(), null, 'a new selection ends it');
});

// Gloss, Gloss off, Linear and None over a large selection read every shape before writing, and put
// every new gradient in with one fragment parse (which reads the whole document), so they cost time
// in proportion to the selection. Measured in node over 1,000 and 4,000 rects: Gloss about 0.12 and
// 0.27 s, Gloss off 0.12 and 0.25 s, Linear 0.09 and 0.34 s, None 0.06 and 0.17 s; with a fragment
// parse and an id map per shape, 1.5 and 37 s, 0.6 and 12 s, 1.7 and 39 s, 0.6 and 13 s.
test('Gloss, Gloss off, Linear and None over a large selection take linear time: over 4,000 rects each costs under 6× what it costs over 1,000, and under 2 s', () => {
  const rects = (n: number, fill: (i: number) => string) => Array.from({ length: n }, (_, i) => `<rect x="${(i % 100) * 10}" y="${Math.floor(i / 100) * 10}" width="8" height="8" fill="${fill(i)}"/>`).join('\n  ');
  const box = (n: number) => `0 0 1000 ${Math.ceil(n / 100) * 10}`;
  const plain = (n: number) => svg(rects(n, () => '#e76f51'), box(n));
  const gloss = (i: number) => `<radialGradient id="gloss-${i + 1}" cx="0.35" cy="0.3" r="0.8" draw:made="true"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e76f51"/></radialGradient>`;
  const glossed = (n: number) => svg(`<defs draw:made="true">${Array.from({ length: n }, (_, i) => gloss(i)).join('')}</defs>\n  ${rects(n, (i) => `url(#gloss-${i + 1})`)}`, box(n)).replace('<svg ', '<svg xmlns:draw="https://mmaggitti.github.io/draw/ns" ');
  const acts: [string, string, (n: number) => string, (e: Editor) => void][] = [
    ['Gloss', 'Gloss', plain, (e) => e.toggleGloss()],
    ['Gloss off', 'Gloss off', glossed, (e) => e.toggleGloss()],
    ['Linear', 'Set fill', plain, (e) => e.setPaintKind('fill', 'linear')],
    ['None', 'Set fill', glossed, (e) => e.setPaintKind('fill', 'none')],
  ];
  const LIMIT = 2000;
  const cost = (n: number, file: (n: number) => string, label: string, act: (e: Editor) => void): number => {
    const e = opened(file(n));
    e.selectAll();
    assert.equal(e.selection.get().size, n, 'test setup: Select all took every rect');
    const t = performance.now();
    act(e);
    const ms = performance.now() - t;
    assert.equal(e.history.get().undoLabel, label, `test setup: ${label} did something over ${n} rects (${e.notice.get()})`);
    return ms;
  };
  for (const [, label, file, act] of acts) cost(200, file, label, act); // warm the engine up
  for (const [what, label, file, act] of acts) {
    // A pause of the runner's can land in one run: a miss is measured twice more, and the fastest
    // run of each size counts. A quadratic command costs over a second at 1,000 already, so then
    // 4,000 isn't waited for.
    let small = Infinity;
    let big = Infinity;
    for (let run = 0; run < 3; run++) {
      small = Math.min(small, cost(1000, file, label, act));
      if (small >= LIMIT / 4) continue;
      big = Math.min(big, cost(4000, file, label, act));
      if (big < 6 * small && big < LIMIT) break;
    }
    assert.ok(small < LIMIT / 4, `${what}: ${small.toFixed(0)} ms over 1,000 rects (the limit is ${LIMIT / 4})`);
    assert.ok(big < 6 * small, `${what}: ${small.toFixed(0)} ms over 1,000 rects, ${big.toFixed(0)} ms over 4,000 (×${(big / small).toFixed(1)}; linear is ×4, the most ×6)`);
    assert.ok(big < LIMIT, `${what}: ${big.toFixed(0)} ms over 4,000 rects (the limit is ${LIMIT})`);
  }
});

test('Gloss, Gloss off, Linear and None over a selection write exactly what they write one shape at a time: five shapes with a mix of fills (a colour attribute, a colour in style="", none, no fill, a gradient), in a file with its own <defs> and in one without', () => {
  const SHAPES = [
    '<rect id="s1" x="5" y="5" width="20" height="20" fill="#e76f51"/>',
    '<circle id="s2" cx="50" cy="15" r="10" style="stroke: #264653; fill: #2a9d8f"/>',
    '<ellipse id="s3" cx="80" cy="15" rx="12" ry="6"/>',
    '<path id="s4" d="M5 40H25V60Z" fill="none"/>',
    '<polygon id="s5" points="40,40 60,40 50,60" fill="url(#g)"/>',
  ].join('\n  ');
  const G = '<linearGradient id="g"><stop offset="0" stop-color="#e9c46a"/><stop offset="1" stop-color="#f4a261"/></linearGradient>';
  const files = [svg(`<defs>\n    ${G}\n  </defs>\n  ${SHAPES}`), svg(`${SHAPES}\n  ${G}`)];
  const ids = ['s1', 's2', 's3', 's4', 's5'];
  const commands: [string, (e: Editor) => void][] = [
    ['Gloss', (e) => e.toggleGloss()],
    ['Linear', (e) => e.setPaintKind('fill', 'linear')],
    ['Radial', (e) => e.setPaintKind('fill', 'radial')],
  ];
  for (const file of files) {
    for (const [what, act] of commands) {
      const all = opened(file);
      select(all, ...ids);
      act(all);
      const one = opened(file);
      for (const id of ids) {
        select(one, id);
        act(one);
      }
      assert.equal(all.source(), one.source(), `${what}: over the selection as one shape at a time`);
      assert.notEqual(all.source(), file, `test setup: ${what} wrote something`);
      // And back: Gloss off, or None, over the selection and one shape at a time, from there.
      const back: [string, (e: Editor) => void] = what === 'Gloss' ? ['Gloss off', (e) => e.toggleGloss()] : ['None', (e) => e.setPaintKind('fill', 'none')];
      select(all, ...ids);
      back[1](all);
      for (const id of ids) {
        select(one, id);
        back[1](one);
      }
      assert.equal(all.source(), one.source(), `${back[0]} after ${what}: over the selection as one shape at a time`);
      assert.equal(all.history.get().undoLabel, back[0] === 'Gloss off' ? 'Gloss off' : 'Set fill');
    }
  }
});

test('a <style> rule that decides the paint wins over the gradient the element names, so Inspect’s gradient section edits nothing and says why (Make unique, Spread, Add stop, Remove stop, a stop’s offset, − and +, colour and opacity, fx, Edit on canvas), and Edit on canvas shows no gradient handles; the rect beside it that no rule decides still edits the same gradient', () => {
  const F = svg(`<style>.k { fill: url(#h) }</style>
  <defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><linearGradient id="h"><stop offset="0" stop-color="green"/></linearGradient></defs>
  <rect id="r" class="k" x="10" y="10" width="50" height="50" fill="url(#g)"/>
  <rect id="o" x="70" y="10" width="20" height="20" fill="url(#g)"/>`);
  const e = opened(F);
  select(e, 'o');
  const stops = e.paintInfo('fill')!.stops.map((s) => s.id);
  assert.equal(stops.length, 2, 'test setup: #g’s stops, read through the rect no rule decides');
  select(e, 'r');
  const why = RULE_SETS('fill');
  const info = e.paintInfo('fill')!;
  assert.deepEqual([info.gradient, info.ruled, info.stops, info.shared], [null, why, [], 0], 'no gradient: the rule’s reason instead');
  const nothing = (what: string, act: () => void) => {
    e.notice.set(null);
    act();
    assert.equal(e.source(), F, `${what} writes nothing`);
    assert.equal(e.notice.get(), why, `${what} says why`);
  };
  nothing('Make unique', () => e.makeUnique('fill'));
  nothing('Spread', () => e.setSpread('fill', 'reflect'));
  nothing('Add stop', () => e.addStop('fill', null));
  nothing('Remove stop', () => e.removeStop('fill', stops[1]));
  nothing('a stop’s offset field', () => {
    e.fieldStart({ kind: 'offset', stop: stops[0] });
    e.fieldInput('0.3');
    e.fieldEnd();
  });
  nothing('a stop’s −', () => e.stepStopOffset(stops[1], -1));
  nothing('a stop’s +', () => e.stepStopOffset(stops[0], 1));
  nothing('a stop’s colour', () => {
    e.openStyleSheet('stop-color', [stops[0]]);
    if (e.sheet.get()) {
      e.sheetInput('#00ff00');
      e.closeSheet();
    }
  });
  nothing('a stop’s opacity slider', () => {
    if (e.styleDrag('stop-opacity', [stops[0]])) {
      e.styleInput('0.5');
      e.styleDragEnd();
    }
  });
  nothing('a stop’s opacity by a key', () => e.setStyle('stop-opacity', '0.5', [stops[0]]));
  nothing('fx', () => {
    e.fieldStart({ kind: 'gradient', prop: 'fill', name: 'fx' });
    e.fieldInput('0.3');
    e.fieldEnd();
  });
  nothing('Edit on canvas', () => e.toggleEditGradient('fill'));
  assert.equal(e.editGradient.get(), null, 'Edit on canvas stays off');
  e.editGradient.set('fill');
  assert.deepEqual(e.overlayModel().handles.filter((h) => h.id.startsWith('g-')).map((h) => h.id), [], 'and even turned on, it shows no gradient handles');
  e.editGradient.set(null);
  // The rect beside it, whose fill no rule decides, still edits #g.
  select(e, 'o');
  e.setSpread('fill', 'reflect');
  assert.equal(e.source(), F.replace('<linearGradient id="g">', '<linearGradient id="g" spreadMethod="reflect">'));
});

// The CSS tokenizer reads a backslash as an escape: url(#a\) in style="" would run the url on to the
// end of the attribute, so the stroke after it would compute as none while Inspect still read blue.
test('a typed paint with a backslash inside url() is refused and writes nothing, in checkStyle and typed into the fill sheet over style="fill:red;stroke:blue"', () => {
  for (const text of ['url(#a\\)', "url('#a\\') red", 'url("#a\\")', 'url(#a\\62 )']) {
    assert.ok('error' in checkStyle('fill', text), `${text} is refused`);
  }
  assert.deepEqual(checkStyle('fill', 'url(#a) red'), { text: 'url(#a) red' }, 'test setup: a paint without one is taken');
  const F = svg('<rect id="r" width="10" height="10" style="fill:red;stroke:blue"/>');
  const e = opened(F);
  select(e, 'r');
  e.openStyleSheet('fill');
  for (const text of ['url(#a\\)', "url('#a\\') red"]) assert.ok('error' in e.sheetInput(text), `the sheet refuses ${text}`);
  e.closeSheet();
  assert.equal(e.source(), F, 'nothing written');
  assert.equal(e.styleRow('stroke')?.value, 'blue');
});

// A relative URL inside a paint's url() is a text token, and the Text sheet writes what is typed
// there: it must stay a URL, or the url() ends early and what follows is CSS (fill:url(#x);stroke:none).
test('the relative URL inside a paint’s url() holds a URL and nothing else: #x);stroke:none typed into its token is refused and writes nothing, in style="" and in a fill attribute; a quote or a backslash where it would end the url() is refused too; other.svg#h is written, one entry', () => {
  const F = svg(`<rect id="r" width="10" height="10" style="fill:url(other.svg#g);stroke:blue"/>
  <rect id="s" x="20" width="10" height="10" fill="url('lib/other.svg#g') red"/>`);
  const listing = new Map<string, ViewBlock>();
  const ports = fakePorts();
  ports.code = { ...ports.code, set: (bs) => { listing.clear(); for (const b of bs) listing.set(b.key, b); }, patch: (b) => void (listing.has(b.key) && listing.set(b.key, b)) };
  const e = bind(ports, new EditorClass(ports));
  assert.ok(e.open(F).ok);
  const tap = (id: string) => {
    const n = idOf(e, id);
    const block = listing.get(`${n}:start`) ?? listing.get(`${n}:leaf`);
    const token = block?.tokens.find((t) => t.kind === 'text');
    assert.ok(block && token, `test setup: #${id}'s relative URL is a text token`);
    e.tapToken(block, token);
    assert.equal(e.sheet.get()?.kind, 'text');
  };
  for (const [id, bad] of [['r', ['#x);stroke:none', 'a b', "a'", 'a"', 'a(', 'a\\']], ['s', ["#x') red;stroke:none", 'a\\', "a'b", 'a\nb']]] as const) {
    tap(id);
    for (const text of bad) assert.ok('error' in e.sheetInput(text), `#${id}: ${JSON.stringify(text)} is refused`);
    e.closeSheet();
    assert.equal(e.source(), F, `#${id}: nothing written`);
  }
  assert.equal(e.history.get().canUndo, false, 'no entry either');
  tap('r');
  assert.ok('text' in e.sheetInput('other.svg#h'));
  e.closeSheet();
  assert.equal(e.source(), F.replace('fill:url(other.svg#g)', 'fill:url(other.svg#h)'), 'only the URL’s characters');
  tap('s');
  assert.ok('text' in e.sheetInput('a"b'), 'a double quote inside single quotes is a URL character');
  e.closeSheet();
  assert.ok(e.source().includes(`fill="url('a&quot;b') red"`), e.source());
  e.undo();
  e.undo();
  assert.equal(e.source(), F, 'one entry each');
});
