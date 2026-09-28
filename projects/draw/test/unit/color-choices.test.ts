// What the Color sheet offers: SVG Lab's palette, the slot's keyword chips, the ringed current value
// and the native picker's starting colour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, type ElementNode } from '../../../../engine/model/doc.ts';
import { tokenizeAttr, type ColorToken } from '../../../../engine/code/tokens.ts';
import { parseColor } from '../../../../engine/values/color.ts';
import { colorChoices, pickerHex, PALETTE } from '../../src/color-choices.ts';

const r = parseDoc('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#E76F51" stroke="none"/><stop stop-color="red"/></svg>');
assert.ok(r.ok);
const doc = r.doc;
const colour = (local: string, attr: string): ColorToken => {
  const n = [...descendants(doc, doc.root)].find((x) => x.kind === 'element' && x.local === local) as ElementNode;
  return tokenizeAttr(doc, n.id, { ns: null, local: attr })[0] as ColorToken;
};
const ringed = (c: ReturnType<typeof colorChoices>) => [...c.swatches, ...c.chips].filter((x) => x.current).map((x) => x.value);

test('the Color sheet: a 16-colour palette, a chip for each keyword the slot takes, and the current value ringed', () => {
  assert.equal(PALETTE.length, 16);
  assert.equal(new Set(PALETTE).size, 16, 'no colour twice');
  for (const c of PALETTE) assert.ok(parseColor(c), `${c} is a colour`);

  const fill = colour('rect', 'fill'); // #E76F51
  const choices = colorChoices(fill, fill.text);
  assert.deepEqual(choices.swatches.map((s) => s.value), [...PALETTE], 'the whole palette, in order');
  assert.deepEqual(choices.chips.map((c) => c.value), ['none', 'context-fill', 'context-stroke'], "a paint's keywords");
  assert.deepEqual(ringed(choices), ['#e76f51'], 'the current value is ringed, whatever its case');

  const stroke = colour('rect', 'stroke'); // none
  assert.deepEqual(ringed(colorChoices(stroke, stroke.text)), ['none'], 'none rings its chip');
  assert.deepEqual(ringed(colorChoices(fill, 'rebeccapurple')), [], 'a colour of your own rings nothing');
  assert.deepEqual(colorChoices(colour('stop', 'stop-color'), 'red').chips, [], 'a stop-color takes no none, so it has no chips');

  assert.equal(pickerHex('#E76F51'), '#e76f51', 'the native picker starts on the current colour');
  assert.equal(pickerHex('red'), '#ff0000');
  assert.equal(pickerHex('none'), '#000000', 'or black when there is no colour');
});
