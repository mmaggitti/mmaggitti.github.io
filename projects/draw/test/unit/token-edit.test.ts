// The rules the Scrub strip and the Number, Color and Text sheets apply before anything is written,
// and token references that survive the edits they make.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, serialize, type Doc, type ElementNode, type NodeId } from '../../../../engine/model/doc.ts';
import { tokenizeAttr, type ColorToken, type EnumToken, type NumberToken, type TextToken } from '../../../../engine/code/tokens.ts';
import { TokenEditError } from '../../../../engine/code/edit.ts';
import {
  checkColor, checkNumber, checkText, negated, nextOption, refOf, stepOf, stepped, steppedFrom, tokenAt, tokenOp, tokensAt,
} from '../../src/token-edit.ts';

const SRC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="1.5" r="4" fill="#ffd166" opacity="0.5" stroke-linecap="round"/><text>Hi</text></svg>`;
const load = (src = SRC): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok);
  return r.doc;
};
const circle = (doc: Doc): NodeId => ([...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.local === 'circle') as ElementNode).id;
const tok = <T>(doc: Doc, local: string, i = 0) => tokenizeAttr(doc, circle(doc), { ns: null, local })[i] as T;

test('numbers: a step is the token own step, else one unit of its last place', () => {
  const doc = load();
  assert.equal(stepOf(tok<NumberToken>(doc, 'cx')), 1);
  assert.equal(stepOf(tok<NumberToken>(doc, 'cy')), 0.1);
  assert.equal(stepOf(tok<NumberToken>(doc, 'opacity')), 0.01);
  assert.equal(stepped(tok<NumberToken>(doc, 'cx'), 3), '15');
  assert.equal(stepped(tok<NumberToken>(doc, 'cy'), -2), '1.3');
  assert.equal(stepped(tok<NumberToken>(doc, 'opacity'), 60), '1', 'clamped to the maximum');
  assert.equal(stepped(tok<NumberToken>(doc, 'r'), -9), '0', 'clamped to the minimum');
  assert.equal(steppedFrom(tok<NumberToken>(doc, 'cx'), '2.25', 1), '3.25', 'the typed value and its places');
});

test('numbers: the keypad text is checked, and refused text says why', () => {
  const doc = load();
  const r = tok<NumberToken>(doc, 'r');
  const cx = tok<NumberToken>(doc, 'cx');
  assert.deepEqual(checkNumber(cx, ' 7.5 '), { text: '7.5' });
  assert.deepEqual(checkNumber(cx, '7,5'), { text: '7.5' }, 'a decimal comma');
  assert.deepEqual(checkNumber(cx, '−3'), { text: '-3' }, 'a typographic minus');
  assert.deepEqual(checkNumber(cx, '+3'), { text: '3' });
  for (const bad of ['', 'abc', '1e3', '1.2.3', '--1', 'Infinity']) assert.ok('error' in checkNumber(cx, bad), bad);
  assert.match((checkNumber(r, '-1') as { error: string }).error, /below the minimum/);
  assert.equal(negated('5'), '-5');
  assert.equal(negated('-5'), '5');
  assert.equal(negated('+5'), '-5');
  assert.equal(negated('0'), '0');
});

test('colours must parse (CSS Color 4) or be one of the slot keywords; keywords cycle; text is one line', () => {
  const doc = load();
  const fill = tok<ColorToken>(doc, 'fill');
  for (const ok of ['#000', 'rebeccapurple', 'rgb(1 2 3 / 50%)', 'oklch(0.7 0.1 200)', 'none']) assert.deepEqual(checkColor(fill, ok), { text: ok }, ok);
  for (const bad of ['', 'nope', '#12', 'url(#x)', 'rgb(1,2)']) assert.ok('error' in checkColor(fill, bad), bad);
  const cap = tok<EnumToken>(doc, 'stroke-linecap');
  assert.equal(nextOption(cap), 'square');
  assert.equal(nextOption({ ...cap, text: 'square' }), 'butt', 'wraps round');
  const text = { kind: 'text', text: 'Hi', prop: 'text', start: 0, end: 2 } as TextToken;
  assert.deepEqual(checkText(text, 'a & <b>'), { text: 'a & <b>' });
  assert.ok('error' in checkText(text, 'two\nlines'));
});

test('the Text sheet refuses, with a message, a character XML cannot hold', () => {
  const text = { kind: 'text', text: 'Hi', prop: 'text', start: 0, end: 2 } as TextToken;
  for (const bad of ['Dr\u0001aw', 'Dr\u000Baw', 'Dr\uFFFEaw', 'Dr\uDC00aw']) {
    const c = checkText(text, bad);
    assert.ok('error' in c && /^XML can't hold the character U\+[0-9A-F]{4}$/.test(c.error), JSON.stringify(c));
  }
  for (const good of ['Draw', 'a\tb', 'Dr😀aw']) assert.deepEqual(checkText(text, good), { text: good });
  assert.deepEqual(checkText(text, 'two\nlines'), { error: 'Text here is a single line' });
});

test('a token reference survives the edits it makes, and an edit changes only its bytes', () => {
  const doc = load();
  const id = circle(doc);
  const target = { attr: { ns: null, local: 'cy' } };
  const ref = refOf(doc, id, target, tokensAt(doc, id, target)[0])!;
  assert.ok(ref);
  for (const text of ['2', '-3.25', '100']) {
    const before = serialize(doc);
    tokenOp(doc, ref, text);
    assert.equal(serialize(doc), before.replace(/cy="[^"]*"/, `cy="${text}"`));
    assert.equal(tokenAt(doc, ref)?.text, text);
  }
  assert.throws(() => tokenOp(doc, ref, 'x'), TokenEditError, 'refused text writes nothing');
  assert.equal(tokenAt(doc, { ...ref, index: 5 }), null);
});
