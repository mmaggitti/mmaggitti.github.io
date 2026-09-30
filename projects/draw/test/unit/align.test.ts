// Align and distribute: the pure arithmetic (src/interact/align.ts), and the editor's commands over
// the fakes (boxes measured as the canvas measures them, moves through the planner).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, type ElementNode, type NodeId } from '../../../../engine/model/doc.ts';
import { alignDeltas, distributeDeltas } from '../../src/interact/align.ts';
import { fakeEditor } from './fakes.ts';

test('align deltas: each box to the target’s edge or middle; distribute keeps the first and last and evens the gaps', () => {
  const boxes = [{ x: 10, y: 10, width: 10, height: 20 }, { x: 40, y: 50, width: 20, height: 10 }];
  const to = { x: 0, y: 0, width: 100, height: 80 };
  assert.deepEqual(alignDeltas(boxes, to, 'left'), [{ x: -10, y: 0 }, { x: -40, y: 0 }]);
  assert.deepEqual(alignDeltas(boxes, to, 'center'), [{ x: 35, y: 0 }, { x: 0, y: 0 }]);
  assert.deepEqual(alignDeltas(boxes, to, 'right'), [{ x: 80, y: 0 }, { x: 40, y: 0 }]);
  assert.deepEqual(alignDeltas(boxes, to, 'top'), [{ x: 0, y: -10 }, { x: 0, y: -50 }]);
  assert.deepEqual(alignDeltas(boxes, to, 'middle'), [{ x: 0, y: 20 }, { x: 0, y: -15 }]);
  assert.deepEqual(alignDeltas(boxes, to, 'bottom'), [{ x: 0, y: 50 }, { x: 0, y: 20 }]);
  // Distribute: 0..10, 12..22 (moves), 60..70: gaps become (60 − 10 − 10) / 2 = 20.
  const three = [{ x: 60, y: 0, width: 10, height: 5 }, { x: 0, y: 0, width: 10, height: 5 }, { x: 12, y: 0, width: 10, height: 5 }];
  assert.deepEqual(distributeDeltas(three, 'h'), [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 18, y: 0 }]);
  assert.deepEqual(distributeDeltas(three.slice(0, 2), 'h'), [{ x: 0, y: 0 }, { x: 0, y: 0 }], 'two: nothing to even');
});

const ROW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect id="a" x="10" y="10" width="10" height="10"/>
  <rect id="b" x="40" y="30" width="20" height="10"/>
  <circle id="c" cx="75" cy="60" r="5"/>
</svg>`;

test('the editor aligns and distributes the selection in one entry each, to the union box (or, alone, the artboard), exactly', () => {
  const editor = fakeEditor();
  editor.open(ROW);
  const id = (name: string): NodeId => ([...descendants(editor.doc!, editor.doc!.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === name)) as ElementNode).id;
  editor.select([id('a'), id('b'), id('c')]);
  editor.align('left');
  assert.equal(editor.source(), ROW.replace('x="40" y="30"', 'x="10" y="30"').replace('cx="75"', 'cx="15"'));
  assert.equal(editor.history.get().undoLabel, 'Align left');
  editor.undo();
  editor.align('bottom');
  assert.equal(editor.source(), ROW.replace('x="10" y="10"', 'x="10" y="55"').replace('x="40" y="30"', 'x="40" y="55"'), 'to the union box’s bottom (65)');
  editor.undo();
  editor.distribute('h');
  // a 10..20, b 40..60, c 70..80: gaps (70 − 20 − 20) / 2 = 15, so b goes to 35.
  assert.equal(editor.source(), ROW.replace('x="40" y="30"', 'x="35" y="30"'));
  assert.equal(editor.history.get().undoLabel, 'Distribute horizontally');
  editor.undo();
  editor.select([id('a')]);
  editor.align('right');
  assert.equal(editor.source(), ROW.replace('x="10" y="10"', 'x="90" y="10"'), 'one alone: to the artboard');
  editor.select([id('a'), id('b')]);
  editor.distribute('v');
  assert.equal(editor.notice.get(), 'Distribute needs three shapes or more.');
});
