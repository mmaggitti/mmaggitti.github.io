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
import { dashPresets, paintKinds } from '../../src/style-edit.ts';
import { colorChoices, styleSlot, PALETTE } from '../../src/color-choices.ts';

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

// ── P1-M2 S1: the Shapes, Create and Vector goals the Shapes tool and shape handles reach ──────────

/** A tap with the Shapes tool at a root point. */
function place(r: Rig, kind: 'rect' | 'circle' | 'ellipse' | 'line' | 'polygon' | 'star' | 'spiral', x: number, y: number) {
  r.editor.pickTool('shapes');
  r.editor.pickShape(kind);
  const at = hostOf(r, x, y);
  r.editor.pointerDown(at, [], { add: false });
  r.editor.pointerUp(at);
}

test('lab/shapes.svg: the rect’s x, y, width, height and rx tokens each step and scrub, one entry each and only their bytes, and the Number sheet takes the lab’s ranges (x, y −50–150, width and height 0–200, rx 0–100), which the artboard-scaled slider spans', () => {
  const r = open('lab/shapes.svg');
  const rect = element(r, 'rect');
  assert.equal(r.editor.extent(), 100, 'the slider spans −100 to 200 on the 100-unit board');
  for (const [attr, was, lo, hi] of [['x', '20', '-50', '150'], ['y', '25', '-50', '150'], ['width', '60', '0', '200'], ['height', '50', '0', '200'], ['rx', '0', '0', '100']] as const) {
    const t = token(r, rect.id, 'number', `${attr}=`);
    r.editor.tapToken(t.block, t.token);
    r.editor.stepFocus(1);
    assert.equal(r.editor.source(), edited(r.file, `${attr}="${was}"`, `${attr}="${Number(was) + 1}"`), `${attr}: a step`);
    oneEntry(r, r.editor.history.get().undoLabel!);
    r.editor.undo();
    const s = token(r, rect.id, 'number', `${attr}=`);
    r.editor.scrubStart(s.block, s.token);
    r.editor.scrub(3);
    r.editor.scrubEnd(true);
    assert.equal(r.editor.source(), edited(r.file, `${attr}="${was}"`, `${attr}="${Number(was) + 3}"`), `${attr}: a scrub`);
    oneEntry(r, r.editor.history.get().undoLabel!);
    r.editor.undo();
    for (const v of [lo, hi]) {
      setNumber(r, rect.id, `${attr}=`, v);
      assert.equal(r.editor.source(), edited(r.file, `${attr}="${was}"`, `${attr}="${v}"`), `${attr}: the Number sheet takes ${v}`);
      r.editor.undo();
    }
  }
  assert.equal(r.editor.source(), r.file);
});

test('lab goal "Round the corners" (shapes): the rx token’s Number sheet sets 6, one entry', () => {
  const r = open('lab/shapes.svg');
  const rect = element(r, 'rect');
  setNumber(r, rect.id, 'rx=', '6');
  assert.ok(num(r, rect, 'rx') >= 6, 'the goal: rx >= 6');
  assert.equal(r.editor.source(), edited(r.file, 'rx="0"', 'rx="6"'));
  oneEntry(r, r.editor.history.get().undoLabel!);
});

test('lab goal "Ellipse into a circle" (shapes): the Shapes tool places an ellipse, and its ry handle dragged level with rx makes it round; the ellipse selected, one entry each', () => {
  const r = open('lab/shapes.svg');
  place(r, 'ellipse', 50, 50);
  const e = element(r, 'ellipse');
  assert.deepEqual([...r.editor.selection.get()], [e.id], 'the new ellipse is selected');
  assert.equal(r.editor.history.get().undoLabel, 'Add ellipse');
  const placed = r.editor.source();
  assert.equal(placed, edited(r.file, '\n</svg>', '\n  <ellipse cx="50" cy="50" rx="26" ry="14" fill="#e76f51" stroke="none"/>\n</svg>'));
  gesture(r, handleAt(r, 'ry'), hostOf(r, 50, 50 + 26.3));
  assert.ok(near(num(r, e, 'rx'), num(r, e, 'ry'), 0.5), `the goal: rx ${num(r, e, 'rx')} ≈ ry ${num(r, e, 'ry')}`);
  assert.deepEqual([...r.editor.selection.get()], [e.id], 'the ellipse is still selected (the lab’s cur)');
  assert.equal(r.editor.source(), placed.replace('ry="14"', 'ry="26"'), 'only ry changed');
  assert.equal(r.editor.history.get().undoLabel, 'Set ry');
  r.editor.undo();
  assert.equal(r.editor.source(), placed);
});

test('lab goal "Add 3 shapes" (create): three taps with the Shapes tool on lab/create.svg leave three shapes, three entries', () => {
  const r = open('lab/create.svg');
  place(r, 'rect', 30, 30);
  place(r, 'circle', 70, 30);
  place(r, 'line', 50, 70);
  const items = [...descendants(doc(r), doc(r).root)].filter((n) => n.kind === 'element' && n.id !== doc(r).root);
  assert.equal(items.length, 3, 'the goal: items.length >= 3');
  const labels = [];
  while (r.editor.history.get().canUndo) {
    labels.push(r.editor.history.get().undoLabel);
    r.editor.undo();
  }
  assert.deepEqual(labels, ['Add line', 'Add circle', 'Add rectangle'], 'three entries, one per shape');
  assert.equal(r.editor.source(), r.file);
});

test('lab/vector.svg: the circle’s r token steps and its Number sheet reaches 10 and 50 (circle-radius); a two-finger pan moves the view and never the file (pan); a vertex handle on the star, a plain polygon, moves one pair (star-polygon)', () => {
  const r = open('lab/vector.svg');
  const circle = element(r, 'circle');
  const t = token(r, circle.id, 'number', 'r=');
  r.editor.tapToken(t.block, t.token);
  r.editor.stepFocus(-1);
  assert.equal(r.editor.source(), edited(r.file, 'r="42"', 'r="41"'));
  oneEntry(r, r.editor.history.get().undoLabel!);
  r.editor.undo();
  for (const v of ['10', '50']) {
    setNumber(r, circle.id, 'r=', v);
    assert.equal(num(r, circle, 'r'), Number(v));
    r.editor.undo();
  }
  // Pan: two fingers moved together 60 pt right and 30 down.
  const was = r.editor.view;
  r.editor.navStart();
  r.editor.navigate({ x: 150, y: 200 }, { x: 250, y: 200 }, { x: 210, y: 230 }, { x: 310, y: 230 });
  r.editor.navEnd();
  const now = r.editor.view;
  assert.ok(now.cx !== was.cx && now.cy !== was.cy && Math.abs(now.scale - was.scale) < 1e-9, `the view panned: ${JSON.stringify(was)} → ${JSON.stringify(now)}`);
  assert.equal(r.editor.source(), r.file, 'a pan never touches the file');
  r.editor.fitToScreen();
  // The star's second point, a vertex handle, dragged 3 units right and 2 up.
  const star = element(r, 'polygon');
  r.editor.select([star.id]);
  assert.ok(r.editor.overlayModel().handles.some((h) => h.id === 'v9'), 'a handle per vertex (10)');
  const v1 = handleAt(r, 'v1');
  const k = hostOf(r, 1, 0).x - hostOf(r, 0, 0).x;
  gesture(r, v1, { x: v1.x + 3 * k, y: v1.y - 2 * k });
  assert.equal(r.editor.source(), edited(r.file, '50,23 57,43 79,44', '50,23 60,41 79,44'), 'only that pair');
  assert.equal(r.editor.history.get().undoLabel, 'Move point');
});

// ── P1-M2 S2: the goals and style rows Inspect reaches (lab/vector.svg, lab/shapes.svg, lab/style.svg) ──

/** One style edit's entry: its label, and one undo gives `was` back. */
function oneStyleEntry(r: Rig, label: string, was: string) {
  assert.equal(r.editor.history.get().undoLabel, label);
  r.editor.undo();
  assert.equal(r.editor.source(), was, 'one undo gives the file back');
}
/** The Colour sheet over the selection for `prop` (Inspect's swatch): `text` taken, then closed, one entry. */
function sheetSets(r: Rig, prop: string, text: string) {
  r.editor.openStyleSheet(prop);
  assert.equal(r.editor.sheet.get()?.kind, 'style');
  assert.ok('text' in r.editor.sheetInput(text), `${prop}: ${text} is taken`);
  r.editor.closeSheet();
}

test('lab/vector.svg: the star’s fill through Inspect (colors): the Colour sheet over the selection sets it, only its bytes, one entry', () => {
  const r = open('lab/vector.svg');
  const star = element(r, 'polygon');
  r.editor.select([star.id]);
  assert.equal(r.editor.styleRow('fill')?.value, '#f1faee');
  sheetSets(r, 'fill', PALETTE[5]);
  assert.equal(attrValue(doc(r), star, null, 'fill'), '#e76f51', 'the star’s fill differs from #f1faee');
  assert.equal(r.editor.source(), edited(r.file, 'fill="#f1faee"', 'fill="#e76f51"'), 'only its bytes changed');
  oneStyleEntry(r, 'Set fill', r.file);
});

test('lab/shapes.svg: the rect’s fill by a palette swatch, by None and by a colour typed in (fill), one entry each, only its bytes', () => {
  const r = open('lab/shapes.svg');
  const rect = element(r, 'rect');
  r.editor.select([rect.id]);
  assert.deepEqual(paintKinds('fill', ['rect']), ['none', 'color'], 'Fill offers None and Colour');
  sheetSets(r, 'fill', PALETTE[1]);
  assert.equal(r.editor.source(), edited(r.file, 'fill="#f4a261"', 'fill="#2a9d8f"'), 'a swatch');
  oneStyleEntry(r, 'Set fill', r.file);
  r.editor.setStyle('fill', 'none');
  assert.equal(r.editor.source(), edited(r.file, 'fill="#f4a261"', 'fill="none"'), 'None');
  oneStyleEntry(r, 'Set fill', r.file);
  sheetSets(r, 'fill', 'rgb(38 70 83)');
  assert.equal(r.editor.source(), edited(r.file, 'fill="#f4a261"', 'fill="rgb(38 70 83)"'), 'a colour of your own');
  oneStyleEntry(r, 'Set fill', r.file);
});

test('lab/shapes.svg: a line placed with the Shapes tool (line-stroke): Inspect shows it no Fill row, its stroke offers no None (nor does the stroke sheet), and its width and Cap write, one entry each', () => {
  const r = open('lab/shapes.svg');
  place(r, 'line', 50, 50);
  const line = element(r, 'line');
  const placed = r.editor.source();
  assert.deepEqual([...r.editor.selection.get()], [line.id]);
  assert.equal(paintKinds('fill', ['line']), null, 'no Fill row for a line (SVG Lab’s styleAttrs)');
  assert.deepEqual(paintKinds('stroke', ['line']), ['color'], 'its stroke has no None');
  assert.ok(!colorChoices(styleSlot('stroke', ['line']), '#e76f51').chips.some((c) => c.value === 'none'), 'nor has its stroke sheet');
  sheetSets(r, 'stroke', PALETTE[0]);
  assert.equal(r.editor.source(), placed.replace('stroke="#e76f51"', 'stroke="#264653"'));
  oneStyleEntry(r, 'Set stroke', placed);
  r.editor.fieldStart({ kind: 'style', prop: 'stroke-width' });
  assert.equal(r.editor.fieldInput('12'), null);
  r.editor.fieldEnd();
  assert.equal(r.editor.source(), placed.replace('stroke-width="4"', 'stroke-width="12"'), 'the width field (the lab’s 0–40)');
  oneStyleEntry(r, 'Set stroke-width', placed);
  r.editor.setStyle('stroke-linecap', 'butt');
  assert.equal(r.editor.source(), placed.replace('stroke-linecap="round"', 'stroke-linecap="butt"'), 'Cap');
  oneStyleEntry(r, 'Set stroke-linecap', placed);
});

test('lab/style.svg: the circle’s fill (fill), its stroke, None and width (stroke), and its opacity to 0.5 by the slider, whose 0.01 steps hold the lab’s 0.05 ones (opacity); one entry each, only their bytes', () => {
  const r = open('lab/style.svg');
  const circle = element(r, 'circle');
  r.editor.select([circle.id]);
  sheetSets(r, 'fill', PALETTE[1]);
  assert.equal(r.editor.source(), edited(r.file, 'fill="#e9c46a"', 'fill="#2a9d8f"'), 'fill');
  oneStyleEntry(r, 'Set fill', r.file);
  // The stroke sheet: a colour and its width slider (the lab's 0–20), one visit.
  r.editor.openStyleSheet('stroke');
  assert.ok('text' in r.editor.sheetInput(PALETTE[5]));
  assert.ok('text' in r.editor.sheetInput('12', 'stroke-width'));
  r.editor.closeSheet();
  assert.equal(r.editor.source(), edited(edited(r.file, 'stroke="#264653"', 'stroke="#e76f51"'), 'stroke-width="4"', 'stroke-width="12"'), 'stroke and width');
  oneStyleEntry(r, 'Set stroke', r.file);
  r.editor.setStyle('stroke', 'none');
  assert.equal(r.editor.source(), edited(r.file, 'stroke="#264653"', 'stroke="none"'), 'stroke or none');
  oneStyleEntry(r, 'Set stroke', r.file);
  // Opacity: one press of the slider through the lab's steps to 0.5.
  assert.ok(r.editor.styleDrag('opacity'));
  for (const v of ['0.95', '0.8', '0.65', '0.5']) assert.equal(r.editor.styleInput(v), null, `the slider takes ${v}`);
  r.editor.styleDragEnd();
  assert.equal(r.editor.source(), edited(r.file, 'opacity="1"', 'opacity="0.5"'), 'opacity 0.5');
  oneStyleEntry(r, 'Set opacity', r.file);
});

test('lab/style.svg: the polyline’s stroke and width (polyline-stroke) and its Cap (linecap) through Inspect; the Dash presets cycle none → "10 6" → "2 6" → "16 4 2 4" (dasharray), and "Dashed line" is met at "10 6" (goal-dashed); one entry each, only their bytes', () => {
  const r = open('lab/style.svg');
  const line = element(r, 'polyline');
  r.editor.select([line.id]);
  assert.equal(paintKinds('fill', ['polyline'])?.length, 2, 'a polyline keeps its Fill row');
  sheetSets(r, 'stroke', PALETTE[0]);
  assert.equal(r.editor.source(), edited(r.file, 'stroke="#e76f51"', 'stroke="#264653"'), 'stroke');
  oneStyleEntry(r, 'Set stroke', r.file);
  r.editor.fieldStart({ kind: 'style', prop: 'stroke-width' });
  assert.equal(r.editor.fieldInput('2'), null);
  assert.equal(r.editor.fieldInput('20'), null);
  r.editor.fieldEnd();
  assert.equal(r.editor.source(), edited(r.file, 'stroke-width="8"', 'stroke-width="20"'), 'width');
  oneStyleEntry(r, 'Set stroke-width', r.file);
  for (const cap of ['butt', 'square']) {
    r.editor.setStyle('stroke-linecap', cap);
    assert.equal(r.editor.source(), edited(r.file, 'stroke-linecap="round"', `stroke-linecap="${cap}"`), `Cap ${cap}`);
    oneStyleEntry(r, 'Set stroke-linecap', r.file);
  }
  const presets = dashPresets(r.editor.styleCtx.k);
  assert.deepEqual(presets, ['none', '10 6', '2 6', '16 4 2 4'], 'the lab’s presets on its 100-unit board');
  const dash = () => attrValue(doc(r), line, null, 'stroke-dasharray');
  assert.equal(dash(), 'none', 'the goal is not met at first');
  let steps = 0;
  for (const p of presets.slice(1)) {
    r.editor.setStyle('stroke-dasharray', p);
    steps++;
    assert.equal(r.editor.source(), edited(r.file, 'stroke-dasharray="none"', `stroke-dasharray="${p}"`), p);
    assert.equal(r.editor.history.get().undoLabel, 'Set stroke-dasharray');
    if (p === '10 6') assert.ok(dash() !== 'none', 'the goal "Dashed line": dash !== none, at "10 6"');
  }
  assert.equal(steps, 3);
  for (let i = 0; i < 3; i++) r.editor.undo();
  assert.equal(r.editor.source(), r.file, 'one entry each');
});
