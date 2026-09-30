// The Shapes tool (P1-M2), through the real Editor over the fakes (test/unit/fakes.ts, whose measure
// answers from the engine): a tap places SVG Lab's Create default scaled to the artboard, centred on
// the snapped point, in the lab's colour cycle; a drag draws from the snapped start to the snapped
// finger; the new shape goes last among the root's elements with the file's own whitespace; one
// history entry each; the shape is selected and Select is back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NodeId } from '../../../../engine/model/doc.ts';
import { Editor, type EditorPorts } from '../../src/editor.ts';
import { polygonPoints, starPoints } from '../../../../engine/generators/radial.ts';
import { spiralPath } from '../../../../engine/generators/spiral.ts';
import { SHAPE_KINDS, shapeColour, type ShapeKind } from '../../src/interact/shapes-tool.ts';
import { bind, corpus, fakePorts, measureWith } from './fakes.ts';

const D = 'https://mmaggitti.github.io/draw/ns';
const CREATE = corpus('lab/create.svg');

/** The real editor on `text`, with every measure call's ids recorded. */
function open(text: string): { editor: Editor; measured: NodeId[][] } {
  const measured: NodeId[][] = [];
  const ports: EditorPorts = fakePorts();
  const editor = bind(ports, new Editor(ports));
  ports.canvas.measure = (ids) => (measured.push([...ids]), measureWith(editor, ids));
  assert.ok(editor.open(text).ok);
  return { editor, measured };
}
/** Host px of a point in the root's user units. */
function hostOf(e: Editor, x: number, y: number) {
  const { box, viewport, M } = e.rootBox;
  const k = box!.width / viewport.width;
  return { x: box!.left + k * (M[0] * x + M[4]), y: box!.top + k * (M[3] * y + M[5]) };
}
function tap(e: Editor, kind: ShapeKind, x: number, y: number) {
  e.pickTool('shapes');
  e.pickShape(kind);
  const at = hostOf(e, x, y);
  e.pointerDown(at, [], { add: false });
  e.pointerUp(at);
}
/** A drag with the Shapes tool from root (x0, y0) to (x1, y1) in six frames; the tooltip at the last frame. */
function draw(e: Editor, kind: ShapeKind, x0: number, y0: number, x1: number, y1: number, end: 'up' | 'cancel' = 'up'): string | null {
  e.pickTool('shapes');
  e.pickShape(kind);
  const a = hostOf(e, x0, y0);
  const b = hostOf(e, x1, y1);
  e.pointerDown(a, [], { add: false });
  for (let i = 1; i <= 6; i++) e.pointerDrag({ x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6 });
  const tip = e.overlayModel().tip?.text ?? null;
  if (end === 'up') e.pointerUp(b);
  else e.pointerCancel();
  return tip;
}
const added = (file: string, markup: string, draw = false) => {
  const out = file.replace('\n</svg>', `\n  ${markup}\n</svg>`);
  return draw ? out.replace('viewBox="0 0 100 100">', `viewBox="0 0 100 100" xmlns:draw="${D}">`) : out;
};

test('a tap places SVG Lab’s default for each kind on lab/create.svg (k = 1), centred on the point, in the lab’s colour cycle: one entry each, the new shape selected and Select back', () => {
  const { editor } = open(CREATE);
  const want: [ShapeKind, string, string, boolean][] = [
    ['rect', 'Add rectangle', '<rect x="30" y="35" width="40" height="30" rx="0" fill="#e76f51" stroke="none"/>', false],
    ['circle', 'Add circle', '<circle cx="50" cy="50" r="18" fill="#2a9d8f" stroke="none"/>', false],
    ['ellipse', 'Add ellipse', '<ellipse cx="50" cy="50" rx="26" ry="14" fill="#e9c46a" stroke="none"/>', false],
    ['line', 'Add line', '<line x1="26" y1="68" x2="74" y2="32" stroke="#f4a261" stroke-width="4" stroke-linecap="round"/>', false],
    ['polygon', 'Add polygon', `<polygon points="${polygonPoints(50, 50, 20, 5)}" fill="#b56576" stroke="none" draw:gen="polygon" draw:cx="50" draw:cy="50" draw:r="20" draw:sides="5"/>`, true],
    ['star', 'Add star', `<polygon points="${starPoints(50, 50, 20, 0.4, 5)}" fill="#457b9d" stroke="none" draw:gen="star" draw:cx="50" draw:cy="50" draw:r="20" draw:inner="0.4" draw:tips="5"/>`, true],
    ['spiral', 'Add spiral', `<path d="${spiralPath(50, 50, 20, 3)}" fill="none" stroke="#e76f51" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" draw:gen="spiral" draw:cx="50" draw:cy="50" draw:r="20" draw:turns="3"/>`, true],
  ];
  assert.deepEqual(want.map(([k]) => k), [...SHAPE_KINDS]);
  for (const [kind, label, markup, gen] of want) {
    tap(editor, kind, 50, 50);
    assert.equal(editor.source(), added(CREATE, markup, gen), kind);
    assert.equal(editor.history.get().undoLabel, label);
    assert.equal(editor.tool.get(), 'select', `${kind}: Select is back`);
    const sel = [...editor.selection.get()];
    assert.equal(sel.length, 1);
    assert.equal(editor.doc!.nodes.get(sel[0])?.kind === 'element' && (editor.doc!.nodes.get(sel[0]) as { local: string }).local, markup.slice(1, markup.indexOf(' ')), `${kind}: the new shape is selected`);
    editor.undo();
    assert.equal(editor.source(), CREATE, `${kind}: one undo gives the file back`);
    assert.equal(editor.history.get().canUndo, false, `${kind}: one entry`);
  }
  // The cycle goes on past an undo, and wraps after six.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(shapeColour), ['#e76f51', '#2a9d8f', '#e9c46a', '#f4a261', '#b56576', '#457b9d', '#e76f51']);
  // A new document starts the cycle again.
  editor.open(CREATE);
  tap(editor, 'circle', 50, 50);
  assert.ok(editor.source().includes('fill="#e76f51"'), 'opening a document restarts the cycle');
});

test('on a 24 × 24 artboard (k = 0.24) a tap places a 10 × 7 rect at the fit’s whole-unit step, and a line’s width is 1', () => {
  const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n</svg>\n';
  const { editor } = open(ICON);
  tap(editor, 'rect', 12, 12);
  assert.equal(editor.source(), ICON.replace('\n</svg>', '\n  <rect x="7" y="9" width="10" height="7" rx="0" fill="#e76f51" stroke="none"/>\n</svg>'));
  editor.undo();
  tap(editor, 'line', 12, 12);
  assert.ok(editor.source().includes('<line x1="6" y1="16" x2="18" y2="8" stroke="#2a9d8f" stroke-width="1" stroke-linecap="round"/>'), editor.source());
});

test('a tap point snaps: a guide within 8 px on screen takes it, one further away does not (whole units then)', () => {
  const GUIDED = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:draw="${D}" viewBox="0 0 100 100">\n  <metadata><draw:state version="1" guides="v 40"/></metadata>\n</svg>\n`;
  const { editor } = open(GUIDED);
  const k = editor.rootBox.box!.width / 100;
  assert.ok(1.5 * k < 8 && 2.4 * k > 8, `test setup: ${k} px a unit`);
  tap(editor, 'circle', 41.5, 60.2);
  assert.ok(editor.source().includes('<circle cx="40" cy="60" r="18"'), `the guide took x: ${editor.source()}`);
  editor.undo();
  tap(editor, 'circle', 42.4, 60.2);
  assert.ok(editor.source().includes('<circle cx="42" cy="60" r="18"'), `beyond 8 px, whole units: ${editor.source()}`);
});

test('a drag draws each kind from the snapped start to the snapped finger, up and to the left too, with its tooltip; one entry each', () => {
  const { editor } = open(CREATE);
  const check = (kind: ShapeKind, from: [number, number], to: [number, number], markup: string, tip: string, gen = false) => {
    const got = draw(editor, kind, ...from, ...to);
    assert.equal(editor.source(), added(CREATE, markup, gen), `${kind} from ${from} to ${to}`);
    assert.equal(got, tip, `${kind}: the tooltip`);
    assert.equal(editor.history.get().undoLabel, `Add ${kind === 'rect' ? 'rectangle' : kind}`);
    assert.equal(editor.tool.get(), 'select');
    editor.undo();
    assert.equal(editor.source(), CREATE);
  };
  const rect = '<rect x="20" y="30" width="40" height="40" rx="0" fill="#e76f51" stroke="none"/>';
  check('rect', [20.2, 30.3], [60.4, 70.1], rect, '40 × 40');
  check('rect', [60.4, 70.1], [20.2, 30.3], rect.replace('#e76f51', '#2a9d8f'), '40 × 40');
  check('ellipse', [20.2, 30.3], [60.4, 76.1], '<ellipse cx="40" cy="53" rx="20" ry="23" fill="#e9c46a" stroke="none"/>', '40 × 46');
  check('circle', [30.1, 30.2], [30.3, 44.8], '<circle cx="30" cy="30" r="15" fill="#f4a261" stroke="none"/>', 'r 15');
  check('line', [10.3, 80.4], [40.2, 60.1], '<line x1="10" y1="80" x2="40" y2="60" stroke="#b56576" stroke-width="4" stroke-linecap="round"/>', 'x 40, y 60');
  check('star', [30.1, 30.2], [30.2, 10.4], `<polygon points="${starPoints(30, 30, 20, 0.4, 5)}" fill="#457b9d" stroke="none" draw:gen="star" draw:cx="30" draw:cy="30" draw:r="20" draw:inner="0.4" draw:tips="5"/>`, 'r 20', true);
  check('spiral', [30.1, 30.2], [42.3, 30.4], `<path d="${spiralPath(30, 30, 12, 3)}" fill="none" stroke="#e76f51" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" draw:gen="spiral" draw:cx="30" draw:cy="30" draw:r="12" draw:turns="3"/>`, 'r 12', true);
});

test('a drag gathers its snap targets once, when it starts, not on every frame', () => {
  const { editor, measured } = open('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <rect width="10" height="10"/>\n</svg>\n');
  const other = [...editor.doc!.nodes.values()].find((n) => n.kind === 'element' && n.local === 'rect')!.id;
  measured.length = 0;
  draw(editor, 'rect', 30, 30, 70, 60);
  assert.equal(editor.history.get().undoLabel, 'Add rectangle');
  const gathers = measured.filter((ids) => ids.includes(other)).length;
  assert.ok(gathers >= 1 && gathers <= 2, `the other shapes were measured ${gathers} times in a 6-frame draw`);
});

test('the new shape goes last among the root’s elements with the file’s whitespace: a pretty-printed, a one-line, a self-closing and an empty root; a prefixed root writes svg:rect', () => {
  for (const [file, want] of [
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <rect id="a" width="5" height="5"/>\n</svg>', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <rect id="a" width="5" height="5"/>\n  <circle cx="50" cy="50" r="18" fill="#e76f51" stroke="none"/>\n</svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="a" width="5" height="5"/><!--end--></svg>', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="a" width="5" height="5"/><circle cx="50" cy="50" r="18" fill="#e76f51" stroke="none"/><!--end--></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"/>', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="18" fill="#e76f51" stroke="none"/></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\r\n</svg>', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\r\n  <circle cx="50" cy="50" r="18" fill="#e76f51" stroke="none"/>\r\n</svg>'],
    ['<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n</svg:svg>', '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <svg:circle cx="50" cy="50" r="18" fill="#e76f51" stroke="none"/>\n</svg:svg>'],
  ]) {
    const { editor } = open(file);
    tap(editor, 'circle', 50, 50);
    assert.equal(editor.source(), want, file);
    editor.undo();
    assert.equal(editor.source(), file, `${file}: undo gives the bytes back`);
  }
  // A generated shape in a prefixed root: the root gains Draw's declaration, the shape its prefix.
  const P = '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n</svg:svg>';
  const { editor } = open(P);
  tap(editor, 'star', 50, 50);
  assert.equal(editor.source(), P.replace('viewBox="0 0 100 100">', `viewBox="0 0 100 100" xmlns:draw="${D}">`).replace('\n</svg:svg>', `\n  <svg:polygon points="${starPoints(50, 50, 20, 0.4, 5)}" fill="#e76f51" stroke="none" draw:gen="star" draw:cx="50" draw:cy="50" draw:r="20" draw:inner="0.4" draw:tips="5"/>\n</svg:svg>`));
});

test('a cancelled drag restores the file byte for byte, records nothing and doesn’t move the colour cycle on; Escape leaves the tool, and a read-only drawing refuses it', () => {
  const { editor } = open(CREATE);
  draw(editor, 'rect', 20, 30, 60, 70, 'cancel');
  assert.equal(editor.source(), CREATE, 'cancelled: the file as it was');
  assert.equal(editor.history.get().canUndo, false, 'and nothing recorded');
  assert.equal(editor.tool.get(), 'shapes', 'the tool stays on after a cancel');
  tap(editor, 'rect', 50, 50);
  assert.ok(editor.source().includes('fill="#e76f51"'), 'the first colour still');
  editor.pickTool('shapes');
  editor.escape();
  assert.equal(editor.tool.get(), 'select', 'Escape returns to Select');
  assert.equal(editor.selection.get().size, 1, 'and keeps the selection');
  editor.readOnly.set(true);
  editor.pickTool('shapes');
  assert.equal(editor.tool.get(), 'select', 'a read-only drawing has no Shapes tool');
});
