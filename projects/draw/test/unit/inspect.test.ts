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
import { dashPresets, paintKinds } from '../../src/style-edit.ts';
import { colorChoices, styleSlot } from '../../src/color-choices.ts';
import { pickAlpha, pickHue, pickSV, pickerStart, pickerText } from '../../src/color-picker.ts';
import { fakeEditor } from './fakes.ts';

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
  assert.deepEqual(paintKinds('stroke', ['line']), ['color']);
  assert.deepEqual(paintKinds('fill', ['line', 'rect']), ['none', 'color'], 'the rect has a fill');
  assert.deepEqual(paintKinds('stroke', ['line', 'rect']), ['color'], 'none would make the line vanish');
  assert.deepEqual(paintKinds('stroke', ['polyline']), ['none', 'color'], 'only a line drops it');
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
