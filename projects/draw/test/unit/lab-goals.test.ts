// SVG Lab's goals, reached with Draw's own tools on the lab's own corpus file (Mark, 2026-09-29):
// a goal Draw can already reach closes its capability row early, before its lesson's phase. The
// real Editor runs over views that draw nothing but keep the code listing, so a token is tapped
// where the code panel shows it, and each goal is checked as SVG Lab checks it: on the file (a
// value its editor would read back), or for zoom on the view, which never touches the file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attrValue, descendants, textContent, type Doc, type ElementNode, type NodeId } from '../../../../engine/model/doc.ts';
import { Editor } from '../../src/editor.ts';
import type { ViewBlock, ViewToken } from '../../src/codeview/code-view.ts';
import { bind, corpus, fakePorts } from './fakes.ts';

interface Rig {
  editor: Editor;
  file: string;
  listing: Map<string, ViewBlock>;
}

/** The real editor over fake ports that keep the code listing, with a lab corpus file open. */
function open(name: string): Rig {
  const listing = new Map<string, ViewBlock>();
  const ports = fakePorts();
  ports.code = {
    ...ports.code,
    set: (blocks) => {
      listing.clear();
      for (const b of blocks) listing.set(b.key, b);
    },
    patch: (b) => void (listing.has(b.key) && listing.set(b.key, b)),
  };
  const editor = bind(ports, new Editor(ports));
  const file = corpus(name);
  const r = editor.open(file);
  assert.ok(r.ok, r.error);
  return { editor, file, listing };
}

const doc = (r: Rig): Doc => r.editor.doc!;
const element = (r: Rig, local: string): ElementNode =>
  [...descendants(doc(r), doc(r).root)].find((n): n is ElementNode => n.kind === 'element' && n.local === local)!;

/** The code panel's token of `kind` in the block that shows `node` (its start tag, or a leaf), after `after`. */
function token(r: Rig, node: NodeId, kind: ViewToken['kind'], after = ''): { block: ViewBlock; token: ViewToken } {
  const block = r.listing.get(`${node}:start`) ?? r.listing.get(`${node}:leaf`);
  assert.ok(block, `node ${node} has no block in the code`);
  const from = block.text.indexOf(after);
  const t = block.tokens.find((x) => x.kind === kind && x.start >= from);
  assert.ok(t, `no ${kind} token after ${JSON.stringify(after)} in ${block.text}`);
  return { block, token: t };
}

/** The file after an edit that changed only `was` (which occurs once) into `now`. */
function edited(file: string, was: string, now: string): string {
  assert.equal(file.split(was).length, 2, `${JSON.stringify(was)} occurs once`);
  return file.replace(was, now);
}

// Lab goal "Zoom to 8×" (vector): LabVector's zoom is relative to the whole drawing in view, so
// Draw's is the view's scale over the scale that fits the artboard, reached by the wheel's or
// trackpad's zoom and by a pinch.
test('lab goal "Zoom to 8×" (vector): the view zooms to 8× the fitted drawing and more, by zoom and by pinch; the file never changes', () => {
  const r = open('lab/vector.svg');
  const { editor } = r;
  const fit = editor.fitScale;
  const centre = { x: 208, y: 264 };
  editor.zoomAt(centre, 8);
  assert.ok(editor.view.scale / fit >= 8, `zoomed to ${editor.view.scale / fit}×`);
  editor.zoomAt(centre, 2);
  assert.ok(editor.view.scale / fit >= 16, 'and further still');
  editor.fitToScreen();
  assert.equal(editor.view.scale, fit, 'Fit shows the whole drawing again');
  // Two fingers 40 pt apart, spread to 320 pt: eight times.
  editor.navStart();
  editor.navigate({ x: 188, y: 264 }, { x: 228, y: 264 }, { x: 48, y: 264 }, { x: 368, y: 264 });
  editor.navEnd();
  assert.ok(editor.view.scale / fit >= 8 - 1e-9, `pinched to ${editor.view.scale / fit}×`);
  assert.equal(editor.source(), r.file, 'zoom moves the camera, never the file');
});

// Lab goal "Change a color" (vector): the circle's or the star's fill differs from its default
// (#2a9d8f and #f1faee), through the colour path: a tap on the fill's colour token opens the
// Color sheet, and what it takes is written.
test('lab goal "Change a color" (vector): a tap on the circle\'s fill opens the Color sheet, and the fill it sets differs from the default', () => {
  const r = open('lab/vector.svg');
  const { editor } = r;
  const circle = element(r, 'circle');
  assert.equal(attrValue(doc(r), circle, null, 'fill'), '#2a9d8f');
  const fill = token(r, circle.id, 'color', 'fill');
  editor.tapToken(fill.block, fill.token);
  assert.equal(editor.sheet.get()?.kind, 'color');
  assert.ok('text' in editor.sheetInput('#e76f51'));
  editor.closeSheet();
  assert.equal(attrValue(doc(r), circle, null, 'fill'), '#e76f51', 'the goal: the fill differs from #2a9d8f');
  assert.equal(attrValue(doc(r), element(r, 'polygon'), null, 'fill'), '#f1faee', 'the star is untouched');
  assert.equal(editor.source(), edited(r.file, 'fill="#2a9d8f"', 'fill="#e76f51"'), 'only its bytes changed');
  assert.equal(editor.history.get().undoLabel, 'Set fill', 'one history entry');
  editor.undo();
  assert.equal(editor.source(), r.file);
});

// Lab goal "Bevel corners" (style): the polyline's stroke-linejoin is bevel. Its keyword token
// cycles through the options (miter, round, bevel, …) one tap at a time, as the lab's does.
test('lab goal "Bevel corners" (style): the linejoin keyword cycles to bevel, one tap and one history entry each', () => {
  const r = open('lab/style.svg');
  const { editor } = r;
  const line = element(r, 'polyline');
  assert.equal(attrValue(doc(r), line, null, 'stroke-linejoin'), 'round');
  let taps = 0;
  while (attrValue(doc(r), line, null, 'stroke-linejoin') !== 'bevel' && taps < 5) {
    const join = token(r, line.id, 'enum', 'stroke-linejoin');
    editor.tapToken(join.block, join.token);
    taps++;
  }
  assert.equal(attrValue(doc(r), line, null, 'stroke-linejoin'), 'bevel', 'the goal: stroke-linejoin is bevel');
  assert.equal(taps, 1, 'round → bevel is one tap');
  assert.equal(editor.source(), edited(r.file, 'stroke-linejoin="round"', 'stroke-linejoin="bevel"'), 'only its bytes changed');
  assert.equal(editor.history.get().undoLabel, 'Set stroke-linejoin', 'one history entry');
});

// Lab goal "Write your own title" (access): the <title> text differs from "Monthly visitors",
// written through the Text sheet (a tap on the title's text run), escaped where it lands.
test('lab goal "Write your own title" (access): the title\'s text, through the Text sheet', () => {
  const r = open('lab/access.svg');
  const { editor } = r;
  const title = element(r, 'title');
  assert.equal(textContent(doc(r), title.id), 'Monthly visitors');
  const run = token(r, title.children[0], 'text');
  editor.tapToken(run.block, run.token);
  assert.equal(editor.sheet.get()?.kind, 'text');
  assert.deepEqual([...editor.selection.get()], [title.id], "the title's element is selected");
  assert.ok('text' in editor.sheetInput('Visitors, January to April & more'));
  editor.closeSheet();
  assert.equal(textContent(doc(r), title.id), 'Visitors, January to April & more', 'the goal: the title text changed');
  assert.equal(editor.source(), edited(r.file, '>Monthly visitors<', '>Visitors, January to April &amp; more<'), 'only its bytes changed, escaped');
  assert.equal(editor.history.get().undoLabel, 'Set title', 'one history entry');
  editor.undo();
  assert.equal(editor.source(), r.file);
});

// ── P1-M1: the goals Draw's handles reach (lab/grid.svg, lab/shapes.svg, lab/transform.svg) ───────

/** Host px of a point in the root's user units (the fakes' camera: the root's box, M). */
function hostOf(r: Rig, x: number, y: number) {
  const { box, viewport, M } = r.editor.rootBox;
  const k = box!.width / viewport.width;
  return { x: box!.left + k * (M[0] * x + M[4]), y: box!.top + k * (M[3] * y + M[5]) };
}
const handleAt = (r: Rig, id: string) => {
  const h = r.editor.overlayModel().handles.find((x) => x.id === id);
  assert.ok(h, `no ${id} handle: ${r.editor.overlayModel().handles.map((x) => x.id)}`);
  return h.at;
};
/** One pointer gesture on the canvas: down at `from`, moved to `to` in 6 frames, up. */
function gesture(r: Rig, from: { x: number; y: number }, to: { x: number; y: number }) {
  r.editor.pointerDown(from, [], { add: false });
  for (let i = 1; i <= 6; i++) r.editor.pointerDrag({ x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 });
  r.editor.pointerUp(to);
}
/** The goal reached by one gesture: one history entry, and one undo gives the file back. */
function oneEntry(r: Rig, label: string) {
  assert.equal(r.editor.history.get().undoLabel, label);
  const now = r.editor.source();
  r.editor.undo();
  assert.equal(r.editor.source(), r.file, 'one undo gives the file back');
  assert.equal(r.editor.history.get().canUndo, false, 'it was one entry');
  r.editor.redo();
  assert.equal(r.editor.source(), now);
}
/** A number token set through its Number sheet (the strip's value), one entry. */
function setNumber(r: Rig, node: NodeId, after: string, value: string) {
  const t = token(r, node, 'number', after);
  r.editor.tapToken(t.block, t.token);
  r.editor.openNumberSheet();
  assert.equal(r.editor.sheet.get()?.kind, 'number');
  assert.ok('text' in r.editor.sheetInput(value));
  r.editor.closeSheet();
}
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const num = (r: Rig, n: ElementNode, local: string) => Number(attrValue(doc(r), n, null, local));

test('lab goals "Go to x 80, y 20" and "Go to x 10, y 90" (grid): the centre handle moves the circle there by whole units, one entry each', () => {
  const r = open('lab/grid.svg');
  const c = element(r, 'circle');
  r.editor.select([c.id]);
  for (const [x, y] of [[80, 20], [10, 90]]) {
    const before = r.editor.source();
    gesture(r, handleAt(r, 'center'), hostOf(r, x, y));
    assert.ok(near(num(r, c, 'cx'), x) && near(num(r, c, 'cy'), y), `the circle is at (${num(r, c, 'cx')}, ${num(r, c, 'cy')})`);
    assert.equal(r.editor.source(), before.replace(/cx="[^"]*" cy="[^"]*"/, `cx="${num(r, c, 'cx')}" cy="${num(r, c, 'cy')}"`), 'only cx and cy changed');
    assert.equal(r.editor.history.get().undoLabel, 'Move');
  }
  assert.deepEqual([num(r, c, 'cx'), num(r, c, 'cy')], [10, 90], 'whole units, on the point');
});

test('lab goal "Set r to 20" (grid), and cx, cy, r and fill by their tokens (edit-center, edit-radius, edit-fill)', () => {
  const r = open('lab/grid.svg');
  const c = element(r, 'circle');
  setNumber(r, c.id, 'r=', '20');
  assert.equal(num(r, c, 'r'), 20, 'the goal: r === 20');
  assert.equal(r.editor.source(), edited(r.file, 'r="5"', 'r="20"'));
  oneEntry(r, r.editor.history.get().undoLabel!);
  setNumber(r, c.id, 'cx=', '45');
  setNumber(r, c.id, 'cy=', '55');
  const fill = token(r, c.id, 'color');
  r.editor.tapToken(fill.block, fill.token);
  assert.ok('text' in r.editor.sheetInput('#2a9d8f'));
  r.editor.closeSheet();
  assert.equal(r.editor.source(), r.file.replace('cx="30" cy="60" r="5" fill="#e76f51"', 'cx="45" cy="55" r="20" fill="#2a9d8f"'));
});

test('lab goal "Make a square" (shapes): a corner handle, the opposite corner kept, one entry', () => {
  const r = open('lab/shapes.svg');
  const rect = element(r, 'rect');
  r.editor.select([rect.id]);
  gesture(r, handleAt(r, 'br'), hostOf(r, 80, 85));
  assert.ok(near(num(r, rect, 'width'), num(r, rect, 'height'), 0.5), `${num(r, rect, 'width')} × ${num(r, rect, 'height')} is a square`);
  assert.equal(r.editor.source(), edited(r.file, 'height="50"', 'height="60"'), 'the top-left corner kept: only the height');
  oneEntry(r, 'Resize');
});

test('lab goals "Turn it upside down", "Double the size" and "Park it top right" (transform): the ring, the diamond and the centre handle on the house, each number in place', () => {
  const r = open('lab/transform.svg');
  const g = element(r, 'g');
  r.editor.select([g.id]);
  const list = () => attrValue(doc(r), g, null, 'transform')!;
  // The ring: from above the pivot (the translate(50 50) point) to below it, 180°.
  const pivot = hostOf(r, 50, 50);
  const ring = handleAt(r, 'rot');
  gesture(r, ring, { x: pivot.x, y: pivot.y + Math.hypot(ring.x - pivot.x, ring.y - pivot.y) });
  assert.equal(r.editor.source(), edited(r.file, 'rotate(0)', 'rotate(180)'), 'upside down: rotate(180), and the list keeps its three lines');
  oneEntry(r, 'Rotate');
  // The diamond: twice as far from the scale pivot.
  const d = handleAt(r, 'scale');
  const sp = hostOf(r, 50, 50);
  gesture(r, d, { x: sp.x + 2 * (d.x - sp.x), y: sp.y + 2 * (d.y - sp.y) });
  assert.equal(r.editor.source(), edited(edited(r.file, 'rotate(0)', 'rotate(180)'), 'scale(1)', 'scale(2)'), 'double the size: scale(2)');
  assert.equal(r.editor.history.get().undoLabel, 'Scale');
  // The centre handle: to the top right.
  const c = handleAt(r, 'center');
  const { box, viewport, M } = r.editor.rootBox;
  const k = (box!.width / viewport.width) * M[0];
  gesture(r, c, { x: c.x + 30 * k, y: c.y - 30 * k });
  const t = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(list())!;
  assert.ok(Number(t[1]) >= 75 && Number(t[2]) <= 25, `parked at translate(${t[1]} ${t[2]})`);
  assert.equal(r.editor.source(), edited(edited(edited(r.file, 'rotate(0)', 'rotate(180)'), 'scale(1)', 'scale(2)'), 'translate(50 50)', `translate(${t[1]} ${t[2]})`), 'only the translate numbers moved');
  assert.equal(r.editor.history.get().undoLabel, 'Move');
});

test('the house\'s transform tokens scrub, and its three children\'s fills change by their colour tokens (transform-tokens, child-colors)', () => {
  const r = open('lab/transform.svg');
  const g = element(r, 'g');
  const tx = token(r, g.id, 'number', 'translate(');
  r.editor.scrubStart(tx.block, tx.token);
  r.editor.scrub(5);
  r.editor.scrubEnd(true);
  assert.equal(r.editor.source(), edited(r.file, 'translate(50 50)', 'translate(55 50)'), 'the scrub changed only its number');
  const kids = [...descendants(doc(r), g.id)].filter((n): n is ElementNode => n.kind === 'element' && n.id !== g.id);
  assert.equal(kids.length, 3);
  for (const [i, kid] of kids.entries()) {
    const f = token(r, kid.id, 'color');
    r.editor.tapToken(f.block, f.token);
    assert.ok('text' in r.editor.sheetInput(['#111111', '#222222', '#333333'][i]));
    r.editor.closeSheet();
  }
  assert.deepEqual(kids.map((k) => attrValue(doc(r), k, null, 'fill')), ['#111111', '#222222', '#333333']);
});
