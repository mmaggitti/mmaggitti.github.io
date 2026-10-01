// The Pen (P1-M3, src/interact/pen.ts through the editor): taps add lines, drags curves, the start
// closes; Done, Enter and Escape end; Undo point walks back; the colour cycle is the lab's and shared
// with the Shapes tool. The real Editor over views that draw nothing (M2's fakes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, findAttr, type ElementNode } from '../../../../engine/model/doc.ts';
import { apply } from '../../../../engine/values/affine.ts';
import { Editor } from '../../src/editor.ts';
import { rootToHostMatrix } from '../../src/interact/overlay-model.ts';
import { Keys, type KeyInput } from '../../src/keys.ts';
import { bind, corpus, fakePorts } from './fakes.ts';

const CREATE = corpus('lab/create.svg'); // an empty 100-unit board: "<svg …>\n</svg>\n"

function open(src: string): Editor {
  const ports = fakePorts();
  const editor = bind(ports, new Editor(ports));
  assert.ok(editor.open(src).ok);
  return editor;
}
/** Host px of a root point. */
function host(e: Editor, x: number, y: number) {
  const { box, viewport, M } = e.rootBox;
  const [hx, hy] = apply(rootToHostMatrix(box!, viewport, M), x, y);
  return { x: hx, y: hy };
}
const tap = (e: Editor, x: number, y: number) => {
  const at = host(e, x, y);
  e.pointerDown(at, [], { add: false });
  e.pointerUp(at);
};
/** A drag from (x, y) to (fx, fy), root units, in four frames. */
const drag = (e: Editor, x: number, y: number, fx: number, fy: number) => {
  const a = host(e, x, y);
  const b = host(e, fx, fy);
  e.pointerDown(a, [], { add: false });
  for (let i = 1; i <= 4; i++) e.pointerDrag({ x: a.x + ((b.x - a.x) * i) / 4, y: a.y + ((b.y - a.y) * i) / 4 });
  e.pointerUp(b);
};
const paths = (e: Editor) => [...descendants(e.doc!, e.doc!.root)].filter((n): n is ElementNode => n.kind === 'element' && n.local === 'path');
const d = (e: Editor, i = 0) => findAttr(paths(e)[i], null, 'd')!.raw;
const withPath = (d: string, colour = '#264653', w = '3') => CREATE.replace('\n</svg>', `\n  <path d="${d}" fill="none" stroke="${colour}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>\n</svg>`);
const key = (k: string): KeyInput => ({ key: k, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target: null, preventDefault() {} });

test('Pen taps: the first writes nothing; the second inserts the lab’s path (one "Draw path"), each later one appends " L x y" (one "Add point"), at exactly the snapped points', () => {
  const e = open(CREATE);
  e.pickTool('pen');
  assert.equal(e.tool.get(), 'pen');
  assert.equal(e.notice.get(), 'Tap to add points, or drag to curve.');
  tap(e, 20.3, 79.8);
  assert.equal(e.source(), CREATE, 'one point draws nothing');
  assert.equal(e.pen.get()?.anchors, 1);
  assert.equal(e.history.get().canUndo, false, 'and is no history entry');
  tap(e, 50.2, 20.4);
  assert.equal(e.source(), withPath('M 20 80 L 50 20'), 'rounded to the whole-unit step, as the lab’s pen');
  assert.equal(e.history.get().undoLabel, 'Draw path');
  tap(e, 80, 80);
  assert.equal(e.source(), withPath('M 20 80 L 50 20 L 80 80'));
  assert.equal(e.history.get().undoLabel, 'Add point');
  assert.deepEqual([...e.selection.get()], [paths(e)[0].id], 'the path being drawn is selected');
  assert.equal(e.tool.get(), 'pen', 'the Pen stays on');
});

test('Pen drags: a drag makes a Q leaving the point along the drag (its in-handle 2p − f), two drags a C, a tap after a drag a Q leaving the dragged point; the handles snap to the step', () => {
  const e = open(CREATE);
  e.pickTool('pen');
  tap(e, 20, 80);
  drag(e, 50, 20, 60.2, 10.4); // P = (50, 20), f = (60, 10): the in-handle (40, 30)
  assert.equal(d(e), 'M 20 80 Q 40 30 50 20', 'one control (P’s in-handle): a Q');
  assert.equal(e.history.get().undoLabel, 'Draw path', 'the drag is one entry');
  drag(e, 80, 50, 90, 40); // A’s out (60, 10), P’s in (70, 60): a C
  assert.equal(d(e), 'M 20 80 Q 40 30 50 20 C 60 10 70 60 80 50');
  tap(e, 90, 90); // A (80, 50) was dragged to (90, 40): a Q leaving it that way
  assert.equal(d(e), 'M 20 80 Q 40 30 50 20 C 60 10 70 60 80 50 Q 90 40 90 90');
  // The brief's e2e numbers: a drag from (80, 50) to (90, 40) after (20, 80), (50, 20), (80, 80) appends Q 70 60 80 50.
  const f = open(CREATE);
  f.pickTool('pen');
  tap(f, 20, 80);
  tap(f, 50, 20);
  tap(f, 80, 80);
  drag(f, 80, 50, 90, 40);
  assert.equal(d(f), 'M 20 80 L 50 20 L 80 80 Q 70 60 80 50');
  // A drag on the first point (alone) sets its out-handle: the second tap's segment is then a Q leaving it that way.
  const g = open(CREATE);
  g.pickTool('pen');
  tap(g, 20, 80);
  drag(g, 20, 80, 20, 60);
  assert.equal(g.source(), CREATE, 'still nothing in the file');
  tap(g, 60, 80);
  assert.equal(d(g), 'M 20 80 Q 20 60 60 80');
});

test('Close: from 3 anchors, the bar’s Close and a tap on the start append " Z" (or the closing curve and " Z"), one "Close path", and the Node tool shows the path, selected', () => {
  const e = open(CREATE);
  e.pickTool('pen');
  tap(e, 20, 80);
  tap(e, 50, 20);
  assert.equal(e.pen.get()?.canClose, false, 'two anchors: no Close');
  tap(e, 20, 80); // the start is not taken from 2 anchors: a third point there
  assert.equal(d(e), 'M 20 80 L 50 20 L 20 80');
  e.undoPoint();
  tap(e, 80, 80);
  assert.equal(e.pen.get()?.canClose, true);
  tap(e, 20.4, 80.3); // within 26 px of the start: it closes
  assert.equal(d(e), 'M 20 80 L 50 20 L 80 80 Z');
  assert.equal(e.history.get().undoLabel, 'Close path');
  assert.equal(e.tool.get(), 'node');
  assert.deepEqual([...e.selection.get()], [paths(e)[0].id]);
  assert.ok(e.overlayModel().handles.some((h) => h.id === 'a0' && h.kind === 'start'), 'its anchors are drawn');
  // The bar's Close, after a drag at the start: the closing curve uses the last anchor's out-handle and the start's in-handle.
  const f = open(CREATE);
  f.pickTool('pen');
  drag(f, 20, 80, 30, 80); // the start dragged: out (30, 80), in (10, 80)
  tap(f, 50, 20);
  tap(f, 80, 80);
  f.penClose();
  assert.equal(d(f), 'M 20 80 Q 30 80 50 20 L 80 80 Q 10 80 20 80 Z');
  assert.equal(f.tool.get(), 'node');
});

test('Undo point and ⌘Z walk back through the anchors to nothing, the file then byte for byte what it was; Redo is off while the Pen is on', () => {
  const e = open(CREATE);
  e.pickTool('pen');
  tap(e, 20, 80);
  tap(e, 50, 20);
  drag(e, 80, 80, 90, 70);
  tap(e, 20, 50);
  assert.equal(e.pen.get()?.anchors, 4);
  e.undoPoint();
  assert.equal(d(e), 'M 20 80 L 50 20 Q 70 90 80 80', 'the last point went');
  assert.equal(e.history.get().canRedo, false, 'no Redo while the Pen is on');
  e.redo();
  assert.equal(d(e), 'M 20 80 L 50 20 Q 70 90 80 80', 'Redo does nothing');
  e.undo(); // ⌘Z and the ToolRail's Undo (App's handlers call editor.undo()): the Pen's Undo point
  assert.equal(d(e), 'M 20 80 L 50 20');
  e.undo();
  assert.equal(e.source(), CREATE, 'Draw path undone: back to the first point');
  assert.equal(e.pen.get()?.anchors, 1);
  assert.equal(e.pen.get()?.canUndo, true);
  e.undoPoint();
  assert.equal(e.pen.get()?.anchors, 0, 'Undo point clears the first point');
  assert.equal(e.source(), CREATE);
  assert.equal(e.history.get().canUndo, false, 'every entry the Pen made is undone, one each');
  // Undo point keeps the out-handle each anchor had: after it, the dragged (80, 80) is last again, and a tap leaves it along its drag.
  tap(e, 20, 80);
  tap(e, 50, 20);
  drag(e, 80, 80, 90, 70);
  tap(e, 20, 50);
  e.undoPoint();
  tap(e, 30, 60);
  assert.equal(d(e), 'M 20 80 L 50 20 Q 70 90 80 80 Q 90 70 30 60', 'the dragged anchor keeps its out-handle after an Undo point');
});

// R1 (the P1-M3 review): an entry the Pen doesn't own (an Inspect edit, a Layers Hide) stayed under the
// Pen's: Undo point then undid it while dropping an anchor still in the file, and a later one left the
// path in the file, forgotten. Any other entry ends the Pen first now (§5.2: anything else ends it).
test('an entry the Pen doesn’t own ends the Pen first: an Inspect edit, a Layers Hide and an Inspect slider each leave every point drawn in the file and the path in the Node tool; Undo point then undoes nothing, and ⌘Z undoes that entry, then the Pen’s', () => {
  const drawn = withPath('M 20 80 L 50 20 L 80 80');
  const CASES: [string, (e: Editor) => void, string, string][] = [
    ['an Inspect edit', (e) => e.setStyle('stroke-width', '5'), 'Set stroke-width', drawn.replace('stroke-width="3"', 'stroke-width="5"')],
    ['a Layers Hide', (e) => e.setHidden(paths(e)[0].id, true), 'Hide', drawn.replace('stroke-linejoin="round"/>', 'stroke-linejoin="round" display="none"/>')],
    ['an Inspect slider', (e) => {
      assert.ok(e.styleDrag('stroke-width'), 'test setup: the slider pressed');
      e.styleInput('7');
      e.styleDragEnd();
    }, 'Set stroke-width', drawn.replace('stroke-width="3"', 'stroke-width="7"')],
  ];
  for (const [what, act, label, after] of CASES) {
    const e = open(CREATE);
    e.pickTool('pen');
    tap(e, 20, 80);
    tap(e, 50, 20);
    tap(e, 80, 80);
    assert.equal(e.source(), drawn, `${what}: test setup`);
    act(e);
    assert.equal(e.source(), after, `${what}: written`);
    assert.equal(e.history.get().undoLabel, label);
    assert.equal(e.pen.get(), null, `${what}: the Pen is off`);
    assert.equal(e.tool.get(), 'node', `${what}: the path is in the Node tool`);
    assert.deepEqual([...e.selection.get()], [paths(e)[0].id]);
    e.undoPoint();
    assert.equal(e.source(), after, `${what}: Undo point undoes nothing the Pen doesn’t own`);
    e.undo();
    assert.equal(e.source(), drawn, `${what}: ⌘Z undoes the entry`);
    e.undo();
    assert.equal(e.source(), withPath('M 20 80 L 50 20'), `${what}: then the Pen’s, as ordinary entries`);
  }
});

test('Done, Enter and Escape with one anchor leave the file unchanged and return to Select; with a path, Done shows it in the Node tool', () => {
  for (const end of ['done', 'enter', 'escape'] as const) {
    const e = open(CREATE);
    const keys = new Keys(e, () => false);
    e.pickTool('pen');
    tap(e, 20, 80);
    if (end === 'done') e.penDone();
    else keys.down(key(end === 'enter' ? 'Enter' : 'Escape'));
    assert.equal(e.source(), CREATE, end);
    assert.equal(e.tool.get(), 'select', end);
    assert.equal(e.pen.get(), null, end);
  }
  const e = open(CREATE);
  const keys = new Keys(e, () => false);
  e.pickTool('pen');
  tap(e, 20, 80);
  tap(e, 50, 20);
  const k = key('Enter');
  let prevented = false;
  k.preventDefault = () => void (prevented = true);
  keys.down(k);
  assert.ok(prevented, 'Enter is the Pen’s');
  assert.equal(e.tool.get(), 'node');
  assert.deepEqual([...e.selection.get()], [paths(e)[0].id]);
  assert.equal(e.source(), withPath('M 20 80 L 50 20'));
  assert.equal(keys.down(key('Enter')), undefined);
  assert.equal(e.tool.get(), 'node', 'Enter does nothing without the Pen');
});

test('a second finger (or the Pencil, or Escape) during a Pen drag adds nothing; the anchors already added stay', () => {
  const e = open(CREATE);
  e.pickTool('pen');
  tap(e, 20, 80);
  tap(e, 50, 20);
  const was = e.source();
  const a = host(e, 80, 80);
  e.pointerDown(a, [], { add: false });
  e.pointerDrag(host(e, 90, 70));
  assert.equal(d(e), 'M 20 80 L 50 20 Q 70 90 80 80', 'the frame draws live');
  e.pointerCancel();
  assert.equal(e.source(), was, 'cancelled: nothing added');
  assert.equal(e.history.get().undoLabel, 'Draw path');
  assert.equal(e.pen.get()?.anchors, 2);
  e.pointerDown(a, [], { add: false });
  e.pointerDrag(host(e, 90, 70));
  e.escape();
  assert.equal(e.source(), was, 'Escape during the drag cancels it');
  assert.equal(e.tool.get(), 'pen', 'and leaves the Pen on');
});

test('the colour cycle is SVG Lab’s pen colours, #264653, #1d3557, #b56576, #6d597a, and it is the Shapes tool’s counter: a rect, then a path, gives the pen’s second colour', () => {
  const e = open(CREATE);
  const colours: string[] = [];
  for (let i = 0; i < 4; i++) {
    e.pickTool('pen');
    tap(e, 10 + i * 20, 20);
    tap(e, 10 + i * 20, 80);
    e.penDone();
    colours.push(findAttr(paths(e)[i], null, 'stroke')!.raw);
  }
  assert.deepEqual(colours, ['#264653', '#1d3557', '#b56576', '#6d597a']);
  const f = open(CREATE);
  f.pickTool('shapes');
  f.pickShape('rect');
  tap(f, 50, 50);
  f.pickTool('pen');
  tap(f, 10, 10);
  tap(f, 30, 10);
  assert.equal(findAttr(paths(f)[0], null, 'stroke')!.raw, '#1d3557', 'the rect moved the shared counter');
  // A cancelled Draw path doesn't move it on.
  const g = open(CREATE);
  g.pickTool('pen');
  tap(g, 10, 10);
  const a = host(g, 30, 30);
  g.pointerDown(a, [], { add: false });
  g.pointerDrag({ x: a.x + 10, y: a.y });
  g.pointerCancel();
  tap(g, 30, 10);
  assert.equal(findAttr(paths(g)[0], null, 'stroke')!.raw, '#264653');
});

test('k on a 24 × 24 artboard: the width is L(3k) = L(0.72), so 1 at that board’s whole-unit fit step; a prefixed root writes svg:path; the whitespace of a pretty-printed and an empty root', () => {
  const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n</svg>\n';
  const e = open(ICON);
  e.pickTool('pen');
  tap(e, 4, 4);
  tap(e, 20, 20);
  assert.equal(e.source(), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n  <path d="M 4 4 L 20 20" fill="none" stroke="#264653" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>\n</svg>\n');
  const PREFIXED = '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <svg:rect x="0" y="0" width="10" height="10"/>\n</svg:svg>\n';
  const p = open(PREFIXED);
  p.pickTool('pen');
  tap(p, 20, 20);
  tap(p, 40, 40);
  assert.equal(p.source(), PREFIXED.replace('height="10"/>\n', 'height="10"/>\n  <svg:path d="M 20 20 L 40 40" fill="none" stroke="#264653" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>\n'));
  const EMPTY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"/>';
  const m = open(EMPTY);
  m.pickTool('pen');
  tap(m, 20, 20);
  tap(m, 40, 40);
  assert.equal(m.source(), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 20 20 L 40 40" fill="none" stroke="#264653" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>');
});

test('the Pen continues a selected open path from its end (lab/paths.svg): a tap on its end, then each tap appends " L x y" as one "Add point"; the path keeps its stroke and the colour counter doesn’t move', () => {
  const P = corpus('lab/paths.svg');
  const e = open(P);
  e.select([paths(e)[0].id]);
  e.pickTool('pen');
  const end = e.overlayModel().handles.find((h) => h.id === 'pen-end');
  const at = host(e, 50, 30);
  assert.ok(end && Math.hypot(end.at.x - at.x, end.at.y - at.y) < 1e-6, 'the path’s end is the Pen’s handle');
  e.pointerDown(end.at, [], { add: false });
  e.pointerUp(end.at);
  assert.equal(e.source(), P, 'taking the end writes nothing');
  tap(e, 70, 60);
  tap(e, 80, 30);
  tap(e, 30, 20);
  assert.equal(d(e), 'M 20 75\n   L 50 30 L 70 60 L 80 30 L 30 20');
  assert.equal(e.history.get().undoLabel, 'Add point');
  assert.equal(findAttr(paths(e)[0], null, 'stroke')!.raw, '#264653');
  e.penDone();
  e.pickTool('pen');
  tap(e, 10, 10);
  tap(e, 20, 10);
  assert.equal(findAttr(paths(e)[1], null, 'stroke')!.raw, '#264653', 'continuing moved no colour on');
  // A closed path isn't continued: a press there starts a new one.
  const heart = open(corpus('lab/create-icon.svg'));
  heart.select([paths(heart)[0].id]);
  heart.pickTool('pen');
  assert.ok(!heart.overlayModel().handles.some((h) => h.id === 'pen-end'));
});
