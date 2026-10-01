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
import { parsePath } from '../../../../engine/path/parse.ts';
import { toAbsolute } from '../../../../engine/path/abs.ts';
import { lastClosed } from '../../../../engine/path/segments.ts';
import { tokenizeAttr, tokenizeText } from '../../../../engine/code/tokens.ts';
import { arcCenter, arcPoint, type ArcCenter } from '../../../../engine/path/arc.ts';
import { insideAt } from '../../../../engine/path/winding.ts';
import { donutOf, donutSlices } from '../../../../engine/generators/donut.ts';

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
    // A node placed (Edit source) or taken away: its blocks come and go (P1-M3's pasted path).
    place: (placements) => {
      for (const p of placements) for (const b of p.blocks) listing.set(b.key, b);
    },
    remove: (keys) => {
      for (const k of keys) listing.delete(k);
    },
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
  assert.deepEqual(paintKinds('fill', ['rect']), ['none', 'color', 'linear', 'radial'], 'Fill offers None and Colour (and the gradients)');
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
  assert.deepEqual(paintKinds('stroke', ['line']), ['color', 'linear', 'radial'], 'its stroke has no None');
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
  assert.equal(paintKinds('fill', ['polyline'])?.includes('none'), true, 'a polyline keeps its Fill row, None included');
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

// ── P1-M2 S3: the Style lesson's gradient (lab/style.svg) ────────────────────────────────────────

test('lab goal "Gradient fill" (style): Inspect’s Linear on the circle writes SVG Lab’s top-to-bottom gradient (x1 0, y1 0, x2 0, y2 1) with a fresh numbered id into a new Draw-made <defs>, the fill url(#linear-1); one entry, and Colour gives the file back', () => {
  const r = open('lab/style.svg');
  const circle = element(r, 'circle');
  r.editor.select([circle.id]);
  const isGradient = () => /^url\(#[^)]+\)$/.test(attrValue(doc(r), circle, null, 'fill') ?? '');
  assert.equal(isGradient(), false, 'the goal is not met at first');
  r.editor.setPaintKind('fill', 'linear');
  assert.ok(isGradient(), 'the goal: the circle’s fill is a gradient');
  const text = r.editor.source();
  assert.ok(text.includes('<defs draw:made="true"><linearGradient id="linear-1" x1="0" y1="0" x2="0" y2="1" draw:made="true"><stop offset="0" stop-color="#e9c46a"/><stop offset="1" stop-color="#e76f51"/></linearGradient></defs>\n  <circle'), text);
  assert.equal(r.editor.paintInfo('fill')?.kind, 'linear', 'Inspect reads it as Linear');
  oneEntry(r, 'Set fill');
  r.editor.setPaintKind('fill', 'color');
  assert.equal(r.editor.source(), r.file, 'Colour: the first stop’s colour, and what Draw made goes');
});

test('lab/style.svg’s gradient stops (gradient-stops): their offsets step by 0.05, one entry each, and their colours take no none (the stop’s Colour sheet offers no none chip and refuses it)', () => {
  const r = open('lab/style.svg');
  r.editor.select([element(r, 'circle').id]);
  r.editor.setPaintKind('fill', 'linear');
  const made = r.editor.source();
  const [a, b] = r.editor.paintInfo('fill')!.stops;
  r.editor.stepStopOffset(a.id, 1);
  r.editor.stepStopOffset(b.id, -1);
  assert.deepEqual(r.editor.paintInfo('fill')!.stops.map((x) => x.offset), [0.05, 0.95]);
  assert.equal(r.editor.source(), made.replace('<stop offset="0" ', '<stop offset="0.05" ').replace('<stop offset="1" ', '<stop offset="0.95" '));
  r.editor.undo();
  r.editor.undo();
  assert.equal(r.editor.source(), made, 'one entry each');
  assert.deepEqual(colorChoices(styleSlot('stop-color', ['stop']), a.colour).chips.map((c) => c.value), ['currentColor'], 'no none chip');
  r.editor.openStyleSheet('stop-color', [a.id]);
  assert.deepEqual(r.editor.sheetInput('none'), { error: '"none" is not a colour' }, 'none is refused');
  assert.ok('text' in r.editor.sheetInput(PALETTE[0]));
  r.editor.closeSheet();
  assert.equal(r.editor.source(), made.replace('stop-color="#e9c46a"', 'stop-color="#264653"'));
  assert.equal(r.editor.history.get().undoLabel, 'Set stop-color');
});

// ── P1-M3 S1: the Paths, Create and Arcs (smooth) goals the Pen and the Node tool reach ─────────

const dOf = (r: Rig) => attrValue(doc(r), element(r, 'path'), null, 'd')!;
const rawD = (r: Rig) => element(r, 'path').attrs.find((a) => a.local === 'd')!.raw;
/** A tap on the canvas at a root point. */
function tapAt(r: Rig, x: number, y: number) {
  const at = hostOf(r, x, y);
  r.editor.pointerDown(at, [], { add: false });
  r.editor.pointerUp(at);
}
/** A tap on a handle where the overlay draws it. */
function tapHandle(r: Rig, id: string) {
  const at = handleAt(r, id);
  r.editor.pointerDown(at, [], { add: false });
  r.editor.pointerUp(at);
}

test('lab/paths.svg, the Paths lesson in order: the Pen continues the path from its end, three taps add three points ("Add 3 points"); Done; the first segment’s bend handle dragged ("Bend a line"); Close ("Close it with Z"); Inspect’s Fill ("Fill it"); one entry each, only the intended bytes', () => {
  const r = open('lab/paths.svg');
  const path = element(r, 'path');
  r.editor.select([path.id]);
  r.editor.pickTool('pen');
  tapHandle(r, 'pen-end');
  assert.equal(r.editor.source(), r.file, 'taking the end writes nothing');
  let added = 0;
  for (const [x, y] of [[70, 70], [80, 30], [40, 20]]) {
    tapAt(r, x, y);
    assert.equal(r.editor.history.get().undoLabel, 'Add point');
    added++;
  }
  assert.ok(added >= 3, 'the goal: added >= 3');
  assert.equal(rawD(r), 'M 20 75\n   L 50 30 L 70 70 L 80 30 L 40 20', 'each tap appends " L x y" after the last segment');
  r.editor.penDone();
  assert.equal(r.editor.tool.get(), 'node', 'Done: the Node tool shows the path');
  // Bend a line: the first segment's bend handle, dragged to (40, 45).
  gesture(r, handleAt(r, 'b1'), hostOf(r, 40, 45));
  assert.equal(r.editor.history.get().undoLabel, 'Bend');
  assert.ok(parsePath(dOf(r)).segs.some((s) => s.cmd !== 'M' && s.cmd.toUpperCase() !== 'L'), 'the goal: a segment that isn’t L');
  assert.equal(rawD(r), 'M 20 75\n   Q 45 38 50 30 L 70 70 L 80 30 L 40 20', '2·(40, 45) − (35, 52.5), rounded');
  // Close it with Z.
  r.editor.toggleClosed();
  assert.equal(r.editor.history.get().undoLabel, 'Close path');
  assert.ok(lastClosed(parsePath(dOf(r))), 'the goal: closed');
  // Fill it: Inspect's fill (the Colour sheet over the selection).
  sheetSets(r, 'fill', PALETTE[5]);
  assert.equal(r.editor.history.get().undoLabel, 'Set fill');
  assert.ok(lastClosed(parsePath(dOf(r))) && attrValue(doc(r), path, null, 'fill') !== 'none', 'the goal: closed and filled');
  assert.equal(r.editor.source(), edited(edited(r.file, 'd="M 20 75\n   L 50 30"', 'd="M 20 75\n   Q 45 38 50 30 L 70 70 L 80 30 L 40 20 Z"'), 'fill="none"', 'fill="#e76f51"'), 'only d and fill changed');
});

test('lab/paths.svg: the path’s numbers are named as SVG Lab’s dParts names them, and the Number sheet opens on "point 1 x" (point-tokens); its L letter cycles (segment-type-cycle)', () => {
  const r = open('lab/paths.svg');
  const path = element(r, 'path');
  const x = token(r, path.id, 'number', 'd=');
  r.editor.tapToken(x.block, x.token);
  r.editor.openNumberSheet();
  const sheet = r.editor.sheet.get();
  assert.ok(sheet?.kind === 'number' && sheet.token.label === 'point 1 x', 'the sheet’s title is the token’s label');
  r.editor.closeSheet();
  const labels = tokenizeAttr(doc(r), path.id, { ns: null, local: 'd' }).map((t) => (t.kind === 'number' ? t.label : t.text));
  assert.deepEqual(labels, ['point 1 x', 'point 1 y', 'L', 'point 2 x', 'point 2 y']);
  const L = token(r, path.id, 'enum', 'd=');
  r.editor.tapToken(L.block, L.token);
  assert.equal(rawD(r), 'M 20 75\n   Q 49 62 50 30', 'L → Q, the lab’s setSeg');
  oneEntry(r, 'Set segment');
});

test('lab/paths.svg: fill or none, stroke or none and width 0–40 by tokens and Inspect (fill-stroke); cap and join by their keyword tokens and Inspect’s Cap and Join (cap-join); one entry each', () => {
  const r = open('lab/paths.svg');
  const path = element(r, 'path');
  r.editor.select([path.id]);
  const fill = token(r, path.id, 'color', 'fill=');
  r.editor.tapToken(fill.block, fill.token);
  assert.ok('text' in r.editor.sheetInput('#2a9d8f'));
  r.editor.closeSheet();
  assert.equal(r.editor.source(), edited(r.file, 'fill="none"', 'fill="#2a9d8f"'), 'the fill token');
  oneEntry(r, 'Set fill');
  r.editor.undo();
  r.editor.setStyle('stroke', 'none');
  assert.equal(r.editor.source(), edited(r.file, 'stroke="#264653"', 'stroke="none"'), 'Inspect: stroke none');
  oneStyleEntry(r, 'Set stroke', r.file);
  setNumber(r, path.id, 'stroke-width=', '40');
  assert.equal(r.editor.source(), edited(r.file, 'stroke-width="3"', 'stroke-width="40"'), 'the width token, to the lab’s 40');
  r.editor.undo();
  r.editor.fieldStart({ kind: 'style', prop: 'stroke-width' });
  assert.equal(r.editor.fieldInput('0'), null);
  r.editor.fieldEnd();
  assert.equal(r.editor.source(), edited(r.file, 'stroke-width="3"', 'stroke-width="0"'), 'Inspect’s width field, to the lab’s 0');
  oneStyleEntry(r, 'Set stroke-width', r.file);
  const cap = token(r, path.id, 'enum', 'stroke-linecap=');
  r.editor.tapToken(cap.block, cap.token);
  assert.equal(r.editor.source(), edited(r.file, 'stroke-linecap="round"', 'stroke-linecap="square"'), 'the cap token cycles');
  r.editor.undo();
  r.editor.setStyle('stroke-linejoin', 'bevel');
  assert.equal(r.editor.source(), edited(r.file, 'stroke-linejoin="round"', 'stroke-linejoin="bevel"'), 'Inspect’s Join');
  oneStyleEntry(r, 'Set stroke-linejoin', r.file);
});

test('SVG Lab’s presets (PRESETS: Heart, Wave, Check mark) reached with Draw’s tools on a 100-unit file: the Pen draws each preset’s anchors, the Node tool drags its controls to the preset’s numbers, and the d reads as exactly the preset (presets)', () => {
  const preset = {
    heart: 'M 50 34 C 50 20, 28 14, 20 28 C 12 42, 26 62, 50 84 C 74 62, 88 42, 80 28 C 72 14, 50 20, 50 34 Z',
    wave: 'M 10 50 C 25 22, 35 22, 50 50 C 65 78, 75 78, 90 50',
    check: 'M 22 52 L 42 72 L 80 30',
  };
  const same = (d: string, want: string) => assert.deepEqual(toAbsolute(parsePath(d)).map(({ cmd: _c, sub: _s, ...g }) => g), toAbsolute(parsePath(want)).map(({ cmd: _c, sub: _s, ...g }) => g));
  const drag = (r: Rig, a: [number, number], b: [number, number]) => gesture(r, hostOf(r, ...a), hostOf(r, ...b));
  // Check mark: three taps.
  let r = open('lab/create.svg');
  r.editor.snap.set({ grid: false, guides: false, shapes: false, artboard: false });
  r.editor.pickTool('pen');
  for (const [x, y] of [[22, 52], [42, 72], [80, 30]]) tapAt(r, x, y);
  r.editor.penDone();
  same(dOf(r), preset.check);
  // Wave: three drags, each point's out-handle the next C's first control (its in-handle the C's second).
  r = open('lab/create.svg');
  r.editor.snap.set({ grid: false, guides: false, shapes: false, artboard: false });
  r.editor.pickTool('pen');
  drag(r, [10, 50], [25, 22]);
  drag(r, [50, 50], [65, 78]); // in-handle 2·(50, 50) − (65, 78) = (35, 22)
  drag(r, [90, 50], [105, 22]); // in-handle (75, 78)
  r.editor.penDone();
  same(dOf(r), preset.wave);
  // Heart: four drags, Close (the start's in-handle its reflection), then the Node tool drags the two corner controls.
  r = open('lab/create.svg');
  r.editor.snap.set({ grid: false, guides: false, shapes: false, artboard: false });
  r.editor.pickTool('pen');
  drag(r, [50, 34], [50, 20]);
  drag(r, [20, 28], [12, 42]); // in (28, 14)
  drag(r, [50, 84], [74, 106]); // in (26, 62)
  drag(r, [80, 28], [72, 14]); // in (88, 42)
  r.editor.penClose();
  assert.equal(r.editor.tool.get(), 'node');
  gesture(r, handleAt(r, 'c3.1'), hostOf(r, 74, 62)); // the bottom point is a corner
  gesture(r, handleAt(r, 'c4'), hostOf(r, 50, 20)); // and so is the top
  same(dOf(r), preset.heart);
  assert.ok(lastClosed(parsePath(dOf(r))), 'closed, with four C');
});

test('lab/create.svg: the Pen’s drag makes a curve, a path with a Q or C (goal "Draw a curve")', () => {
  const r = open('lab/create.svg');
  r.editor.pickTool('pen');
  tapAt(r, 20, 80);
  gesture(r, hostOf(r, 50, 20), hostOf(r, 60, 10));
  r.editor.penDone();
  assert.ok(parsePath(dOf(r)).segs.some((s) => 'QC'.includes(s.cmd.toUpperCase())), 'the goal: a Q or a C');
  assert.equal(r.editor.source(), r.file.replace('\n</svg>', '\n  <path d="M 20 80 Q 40 30 50 20" fill="none" stroke="#264653" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>\n</svg>'));
  oneEntry(r, 'Draw path');
});

test('lab/arcs--smooth.svg: Make corner then Make smooth on the middle node give the file back byte for byte, and the letter cycle plus Make smooth reaches the lab’s T form, "M Q T" (smooth-family); the node handles and the mirror guide (smooth-handles)', () => {
  const r = open('lab/arcs--smooth.svg');
  const path = element(r, 'path');
  r.editor.pickTool('node');
  r.editor.select([path.id]);
  assert.deepEqual(r.editor.overlayModel().handles.map((h) => h.id), ['center', 'c1.1', 'c1', 'c2', 'a0', 'a1', 'a2'], 'the start, middle and end anchors and the controls');
  assert.equal(r.editor.overlayModel().paths!.dots.length, 1, 'the S’s mirror dot');
  tapHandle(r, 'a1');
  assert.equal(r.editor.nodeBar()!.smooth, 'smooth');
  r.editor.toggleSmooth();
  assert.equal(rawD(r), 'M 10 55\n   C 22 20, 40 20, 50 55\n   C 60 90, 78 90, 90 55');
  assert.equal(r.editor.history.get().undoLabel, 'Make corner');
  r.editor.toggleSmooth();
  assert.equal(r.editor.source(), r.file, 'Make smooth: the file back byte for byte');
  // The T form: the letters cycled to Q and Q, then Make smooth.
  const cycle = (k: number) => r.editor.cycleSegment(path.id, k);
  cycle(1); // C → L (the S written out as C)
  cycle(1); // L → Q
  cycle(2); // C → L
  cycle(2); // L → Q
  assert.equal(parsePath(dOf(r)).segs.map((s) => s.cmd).join(' '), 'M Q Q');
  tapHandle(r, 'a1');
  assert.equal(r.editor.nodeBar()!.smooth, 'corner');
  r.editor.toggleSmooth();
  assert.equal(parsePath(dOf(r)).segs.map((s) => s.cmd).join(' '), 'M Q T', 'the lab’s T family');
});

test('lab/arcs--smooth.svg: Make relative writes the lab’s relative spelling exactly (goal "Go relative"); the stroke and width by tokens and Inspect (smooth-stroke)', () => {
  const r = open('lab/arcs--smooth.svg');
  const path = element(r, 'path');
  r.editor.pickTool('node');
  r.editor.select([path.id]);
  r.editor.toggleRelative();
  assert.equal(r.editor.source(), edited(r.file, 'M 10 55\n   C 22 20, 40 20, 50 55\n   S 78 90, 90 55', 'm 10 55\n   c 12 -35, 30 -35, 40 0\n   s 28 35, 40 0'));
  oneEntry(r, 'Make relative');
  assert.equal(r.editor.nodeBar()!.relative, true, 'the goal: relative');
  r.editor.undo();
  sheetSets(r, 'stroke', PALETTE[5]);
  assert.equal(r.editor.source(), edited(r.file, 'stroke="#264653"', 'stroke="#e76f51"'));
  oneStyleEntry(r, 'Set stroke', r.file);
  setNumber(r, path.id, 'stroke-width=', '12');
  assert.equal(r.editor.source(), edited(r.file, 'stroke-width="3"', 'stroke-width="12"'), 'the lab’s width 1–12');
});

test('Edit source takes a pasted path of every command, letter-less, packed and relative, and the Node tool and the tokens edit all of it (Draw keeps it all editable; nothing becomes raw)', () => {
  const r = open('lab/paths.svg');
  const path = element(r, 'path');
  r.editor.select([path.id]);
  const d = 'M0 0 10 10h5v5c1 1 2 2 3 3s1 1 2 2q1 1 2 2t2 2a5 5 0 0110 10z m 5 5 l 1 1 2 2';
  assert.equal(r.editor.applySource(path.id, `<path d="${d}" fill="none" stroke="#000"/>`), null);
  const pasted = element(r, 'path');
  r.editor.pickTool('node');
  r.editor.select([pasted.id]);
  const handles = r.editor.overlayModel().handles.map((h) => h.id);
  const anchors = toAbsolute(parsePath(d)).filter((s) => s.type !== 'Z').length;
  assert.equal(handles.filter((h) => /^a\d/.test(h)).length, anchors, 'every anchor of every command has a handle');
  // The letter tokens (c, q, l) cycle.
  const letters = tokenizeAttr(doc(r), pasted.id, { ns: null, local: 'd' }).filter((t) => t.kind === 'enum' && t.segment !== undefined).map((t) => t.text);
  assert.deepEqual(letters, ['c', 'q', 'l']);
  // An anchor of the letter-less L, the packed arc's end and the second subpath's l: each dragged, one entry.
  for (const id of ['a1', 'a8', 'a11']) {
    const before = dOf(r);
    const at = handleAt(r, id);
    gesture(r, at, { x: at.x + 8, y: at.y + 4 });
    assert.notEqual(dOf(r), before, `${id} moved`);
    assert.equal(r.editor.history.get().undoLabel, 'Move point');
  }
  assert.ok(/h5/.test(d) && /l[-\d.]+ [-\d.]+v5/.test(rawD(r)), 'the h after the moved point left its row: it became an l');
  // The arc's packed flags cycle as tokens.
  const flag = token(r, pasted.id, 'enum', 'a5');
  r.editor.tapToken(flag.block, flag.token);
  assert.equal(r.editor.history.get().undoLabel, 'Set d');
});

// ── P1-M3 S2: the Arcs lesson's arc, holes and donut goals ─────────────────────────────────────

/** The one arc of lab/arcs.svg's path, as the file reads now: its flags "L S". */
const arcFlags = (r: Rig) => {
  const a = toAbsolute(parsePath(dOf(r))).find((s) => s.type === 'A')!;
  return a.type === 'A' ? `${+a.large} ${+a.sweep}` : '';
};

test('lab/arcs.svg: every number of the arc is a token and each flag a keyword token, and its teaching comment has none (arc-command); a tap on a flag token flips it, one entry each (large-arc-flag, sweep-flag); the stroke and its width 1–12 by Inspect and the width token (arc-stroke)', () => {
  const r = open('lab/arcs.svg');
  const path = element(r, 'path');
  const ts = tokenizeAttr(doc(r), path.id, { ns: null, local: 'd' });
  assert.deepEqual(ts.map((t) => (t.kind === 'number' ? t.label : t.text)), ['point 1 x', 'point 1 y', 'rx', 'ry', 'rotation', '0', '1', 'point 2 x', 'point 2 y']);
  assert.deepEqual(ts.filter((t) => t.kind === 'enum').map((t) => t.kind === 'enum' && t.options.join('/')), ['0/1', '0/1']);
  const comment = [...doc(r).nodes.values()].find((n) => n.kind === 'comment')!;
  assert.equal(r.listing.get(`${comment.id}:leaf`)?.tokens.length, 0, 'the comment "A rx ry rotation large-arc sweep x y" stays plain');
  assert.deepEqual(tokenizeText(doc(r), comment.id), []);
  const flag = (i: number) => {
    const block = r.listing.get(`${path.id}:start`)!;
    return { block, token: block.tokens.filter((t) => t.kind === 'enum')[i] };
  };
  const large = flag(0);
  r.editor.tapToken(large.block, large.token);
  assert.equal(r.editor.source(), edited(r.file, 'A 30 30 0 0 1 76 50', 'A 30 30 0 1 1 76 50'), 'the large-arc flag, in place');
  assert.equal(arcFlags(r), '1 1');
  oneEntry(r, 'Set d');
  r.editor.undo();
  const sweep = flag(1);
  r.editor.tapToken(sweep.block, sweep.token);
  assert.equal(r.editor.source(), edited(r.file, 'A 30 30 0 0 1 76 50', 'A 30 30 0 0 0 76 50'), 'the sweep flag, in place');
  oneEntry(r, 'Set d');
  r.editor.undo();
  r.editor.select([path.id]);
  sheetSets(r, 'stroke', PALETTE[5]);
  assert.equal(r.editor.source(), edited(r.file, 'stroke="#264653"', 'stroke="#e76f51"'));
  oneStyleEntry(r, 'Set stroke', r.file);
  setNumber(r, path.id, 'stroke-width=', '12');
  assert.equal(r.editor.source(), edited(r.file, 'stroke-width="3"', 'stroke-width="12"'), 'the lab’s width 12');
  r.editor.undo();
  setNumber(r, path.id, 'stroke-width=', '1');
  assert.equal(r.editor.source(), edited(r.file, 'stroke-width="3"', 'stroke-width="1"'), 'and 1');
});

test('lab/arcs.svg, goal "Try all 4 arcs": in the Node tool a tap on each ghost in turn sets its flag pair, one entry each, and the pairs seen reach 4 (the file starts at 0 1)', () => {
  const r = open('lab/arcs.svg');
  const path = element(r, 'path');
  r.editor.pickTool('node');
  r.editor.select([path.id]);
  const seen = new Set([arcFlags(r)]);
  assert.deepEqual([...seen], ['0 1']);
  for (const want of ['0 0', '1 0', '1 1']) {
    const ghost = r.editor.overlayModel().paths!.ghosts.find((g) => g.flags === want);
    assert.ok(ghost, `a ghost for ${want}`);
    const [L, S] = want.split(' ').map((f) => f === '1');
    const c = arcCenter(24, 50, 30, 30, 0, L, S, 76, 50) as ArcCenter;
    const [x, y] = arcPoint(c, c.t1 + c.dt / 2);
    tapAt(r, x, y);
    assert.equal(r.editor.history.get().undoLabel, 'Set arc flags');
    assert.equal(arcFlags(r), want);
    seen.add(arcFlags(r));
  }
  assert.ok(seen.size >= 4, 'the goal: all four arcs');
  assert.equal(r.editor.source(), edited(r.file, 'A 30 30 0 0 1 76 50', 'A 30 30 0 1 1 76 50'), 'only the flags changed');
});

test('lab/arcs--holes.svg, goal "Cut the hole 2 ways": Inspect’s Fill rule to evenodd empties the keyhole at (50, 55), back to nonzero fills it, and Reverse on the inner subpath empties it again; the fill by its token and Inspect (holes-fill); one entry each', () => {
  const r = open('lab/arcs--holes.svg');
  const path = element(r, 'path');
  const holes = new Set<string>();
  const inside = (x: number, y: number) => insideAt(toAbsolute(parsePath(dOf(r))), x, y, attrValue(doc(r), path, null, 'fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero');
  r.editor.pickTool('node');
  r.editor.select([path.id]);
  assert.ok(inside(50, 55) && inside(50, 20), 'both clockwise, nonzero: the keyhole is filled');
  r.editor.setStyle('fill-rule', 'evenodd');
  assert.equal(r.editor.source(), edited(r.file, 'fill-rule="nonzero"', 'fill-rule="evenodd"'));
  assert.equal(r.editor.history.get().undoLabel, 'Set fill-rule');
  assert.ok(!inside(50, 55) && inside(50, 20), 'evenodd: a hole');
  holes.add('evenodd');
  r.editor.setStyle('fill-rule', 'nonzero');
  assert.equal(r.editor.source(), r.file);
  assert.ok(inside(50, 55), 'nonzero again: filled');
  tapHandle(r, 'a6'); // an inner anchor (the end of L 61 66)
  r.editor.reverse();
  assert.equal(r.editor.source(), edited(r.file, 'M 43.3 42 A 9 9 0 1 1 56.7 42 L 61 66 L 39 66 Z', 'M 43.3 42 L 39 66 L 61 66 L 56.7 42 A 9 9 0 1 0 43.3 42 Z'), 'SVG Lab’s HOLE_REV');
  assert.equal(r.editor.history.get().undoLabel, 'Reverse');
  assert.ok(!inside(50, 55) && inside(50, 20), 'the inner reversed: a hole under nonzero too');
  holes.add('reverse');
  assert.ok(holes.size >= 2, 'the goal: the hole cut two ways');
  r.editor.undo();
  r.editor.undo();
  r.editor.undo();
  assert.equal(r.editor.source(), r.file);
  // The fill: its colour token, and Inspect's swatch.
  const fill = token(r, path.id, 'color', 'fill=');
  r.editor.tapToken(fill.block, fill.token);
  assert.ok('text' in r.editor.sheetInput('#2a9d8f'));
  r.editor.closeSheet();
  assert.equal(r.editor.source(), edited(r.file, 'fill="#264653"', 'fill="#2a9d8f"'));
  oneEntry(r, 'Set fill');
  r.editor.undo();
  r.editor.select([path.id]);
  sheetSets(r, 'fill', PALETTE[5]);
  assert.equal(r.editor.source(), edited(r.file, 'fill="#264653"', 'fill="#e76f51"'));
  oneStyleEntry(r, 'Set fill', r.file);
});

const DONUT_ATTRS = ' xmlns:draw="https://mmaggitti.github.io/draw/ns" draw:gen="donut" draw:cx="50" draw:cy="50" draw:r="28"';

test('lab/arcs--donut.svg, goal "A slice over half": Edit as donut, then boundary 0 dragged round to 70% of the turn: the values read 64, 1, 20, 15 (64 is the pair − 1), the first slice is drawn the long way round, and 64/100 > 0.5; one entry each', () => {
  const r = open('lab/arcs--donut.svg');
  const slices = [...descendants(doc(r), doc(r).root)].filter((n): n is ElementNode => n.kind === 'element' && n.local === 'path');
  r.editor.select([slices[0].id]);
  r.editor.adoptDonut();
  const adopted = edited(r.file, 'viewBox="0 0 100 100">', `viewBox="0 0 100 100"${DONUT_ATTRS}>`);
  assert.equal(r.editor.source(), adopted, 'only the root’s start tag');
  oneEntry(r, 'Edit as donut');
  const ring = (f: number) => hostOf(r, 50 + 28 * Math.cos(-Math.PI / 2 + f * 2 * Math.PI), 50 + 28 * Math.sin(-Math.PI / 2 + f * 2 * Math.PI));
  gesture(r, handleAt(r, 'donut-b0'), ring(0.7));
  assert.equal(r.editor.history.get().undoLabel, 'Set donut values');
  const d = donutOf(doc(r), doc(r).root)!;
  assert.deepEqual(d.values, [64, 1, 20, 15]);
  const total = d.values.reduce((a, b) => a + b, 0);
  assert.ok(d.values.some((v) => v / total > 0.5), 'the goal: a slice over half');
  assert.equal(attrValue(doc(r), slices[0], null, 'd'), donutSlices([64, 1, 20, 15], 50, 50, 28)![0]);
  assert.match(attrValue(doc(r), slices[0], null, 'd')!, /^M 50 22 A 28 28 0 1 1 /, 'large-arc 1');
  r.editor.undo();
  assert.equal(r.editor.source(), adopted, 'one entry');
});

test('lab/arcs--donut.svg: a slice’s colour by its stroke token and by Inspect leaves the donut a donut (donut-colors); after Edit as donut its data comment’s values are number tokens, and a value set by the Number sheet draws the slices again, one entry (donut-data)', () => {
  const r = open('lab/arcs--donut.svg');
  const slices = [...descendants(doc(r), doc(r).root)].filter((n): n is ElementNode => n.kind === 'element' && n.local === 'path');
  r.editor.select([slices[1].id]);
  r.editor.adoptDonut();
  const adopted = r.editor.source();
  const stroke = token(r, slices[1].id, 'color', 'stroke=');
  r.editor.tapToken(stroke.block, stroke.token);
  assert.ok('text' in r.editor.sheetInput('#6d597a'));
  r.editor.closeSheet();
  assert.equal(r.editor.source(), edited(adopted, 'stroke="#2a9d8f"', 'stroke="#6d597a"'), 'the stroke token: only its bytes');
  assert.ok(donutOf(doc(r), doc(r).root), 'still a donut');
  r.editor.undo();
  sheetSets(r, 'stroke', PALETTE[0]);
  assert.equal(r.editor.source(), edited(adopted, 'stroke="#2a9d8f"', `stroke="${PALETTE[0]}"`), 'Inspect’s stroke');
  assert.ok(donutOf(doc(r), doc(r).root), 'still a donut');
  r.editor.undo();
  const comment = [...doc(r).nodes.values()].find((n) => n.kind === 'comment')!;
  const block = r.listing.get(`${comment.id}:leaf`)!;
  assert.deepEqual(block.tokens.map((t) => [t.kind, block.text.slice(t.start, t.end)]), [['number', '40'], ['number', '25'], ['number', '20'], ['number', '15']], 'the comment’s values are tokens now');
  setNumber(r, comment.id, 'data: ', '55');
  assert.ok(r.editor.source().includes('<!-- data: 55, 25, 20, 15 -->'));
  assert.deepEqual(slices.map((s) => attrValue(doc(r), s, null, 'd')), donutSlices([55, 25, 20, 15], 50, 50, 28), 'the slices drawn again from it');
  assert.equal(r.editor.history.get().undoLabel, 'Set data');
  r.editor.undo();
  assert.equal(r.editor.source(), adopted);
});

// ── P1-M4 S1: text (lab/create.svg, lab/create-logo.svg) ──────────────────────────────────────

test('lab/create.svg (add-text): the Text tool’s tap at the middle of the board places exactly SVG Lab’s "Hello" in the Text tool’s font (Archivo), one "Add text" entry, and the lines sheet opens on "Hello"', () => {
  const r = open('lab/create.svg');
  r.editor.pickTool('text');
  r.editor.pointerDown(hostOf(r, 50, 50), [], { add: false });
  r.editor.pointerUp(hostOf(r, 50, 50));
  const hello = '<text x="50" y="55" font-size="14" font-family="Archivo, sans-serif" font-weight="700" text-anchor="middle" fill="#264653">Hello</text>';
  assert.equal(r.editor.source(), edited(r.file, '\n</svg>', `\n  ${hello}\n</svg>`));
  const sheet = r.editor.sheet.get();
  assert.ok(sheet?.kind === 'lines' && sheet.text === 'Hello' && sheet.select, JSON.stringify(sheet));
  r.editor.closeSheet();
  oneEntry(r, 'Add text');
});

test('lab/create-logo.svg (text-attrs): SUNWAVE’s font-size token scrubs and its Number sheet sets 12; its font-family token cycles sans-serif → serif → monospace → sans-serif; its font-weight token cycles from 900; its text-anchor token cycles middle → end; each one entry and only its bytes', () => {
  const r = open('lab/create-logo.svg');
  const text = element(r, 'text');
  const size = token(r, text.id, 'number', 'font-size');
  r.editor.scrubStart(size.block, size.token);
  r.editor.scrub(3);
  r.editor.scrubEnd(true);
  assert.equal(r.editor.source(), edited(r.file, 'font-size="11"', 'font-size="14"'));
  oneEntry(r, 'Scrub font-size');
  r.editor.undo();
  setNumber(r, text.id, 'font-size', '12');
  assert.equal(r.editor.source(), edited(r.file, 'font-size="11"', 'font-size="12"'));
  oneEntry(r, 'Set font-size');
  r.editor.undo();
  for (const [was, now] of [['sans-serif', 'serif'], ['serif', 'monospace'], ['monospace', 'sans-serif']]) {
    const f = token(r, text.id, 'enum', 'font-family');
    assert.equal(f.block.text.slice(f.token.start, f.token.end), was);
    r.editor.tapToken(f.block, f.token);
    assert.equal(attrValue(doc(r), text, null, 'font-family'), now);
    assert.equal(r.editor.history.get().undoLabel, 'Set font-family', 'one entry a tap');
  }
  assert.equal(r.editor.source(), r.file, 'round to the start');
  for (let i = 0; i < 3; i++) r.editor.undo();
  const w = token(r, text.id, 'enum', 'font-weight');
  r.editor.tapToken(w.block, w.token);
  assert.equal(r.editor.source(), edited(r.file, 'font-weight="900"', 'font-weight="normal"'), 'P0’s keyword token: 900, then the first of its options');
  oneEntry(r, 'Set font-weight');
  r.editor.undo();
  const a = token(r, text.id, 'enum', 'text-anchor');
  r.editor.tapToken(a.block, a.token);
  assert.equal(r.editor.source(), edited(r.file, 'text-anchor="middle"', 'text-anchor="end"'));
  oneEntry(r, 'Set text-anchor');
});

test('lab/create-logo.svg: SUNWAVE’s size, weight and anchor through Inspect’s Text section (font-size, font-weight, text-anchor; a generic family offers SVG Lab’s 400, 700 and 900): one entry each, only their bytes', () => {
  const r = open('lab/create-logo.svg');
  const text = element(r, 'text');
  r.editor.select([text.id]);
  assert.equal(r.editor.textSelected(), true);
  assert.equal(r.editor.familyFaces('sans-serif'), null, 'a generic: the lab’s three weights');
  r.editor.fieldStart({ kind: 'style', prop: 'font-size' });
  r.editor.fieldInput('1');
  r.editor.fieldInput('16');
  r.editor.fieldEnd();
  assert.equal(r.editor.source(), edited(r.file, 'font-size="11"', 'font-size="16"'));
  oneEntry(r, 'Set font-size');
  r.editor.undo();
  r.editor.setStyle('font-weight', '400');
  assert.equal(r.editor.source(), edited(r.file, 'font-weight="900"', 'font-weight="400"'));
  oneEntry(r, 'Set font-weight');
  r.editor.undo();
  r.editor.setStyle('text-anchor', 'start');
  assert.equal(r.editor.source(), edited(r.file, 'text-anchor="middle"', 'text-anchor="start"'));
  oneEntry(r, 'Set text-anchor');
});

test('lab/create-logo.svg (edit-text-tool): Edit text writes "SUN" and "WAVE" as two line tspans at the text’s own x, one "Edit text" entry, and one undo gives the file back', () => {
  const r = open('lab/create-logo.svg');
  const text = element(r, 'text');
  r.editor.select([text.id]);
  assert.equal(r.editor.canEditText(), true);
  r.editor.editText();
  const sheet = r.editor.sheet.get();
  assert.ok(sheet?.kind === 'lines' && sheet.text === 'SUNWAVE');
  r.editor.linesInput('SUN');
  r.editor.linesInput('SUN\nWAVE');
  r.editor.closeSheet();
  assert.equal(r.editor.source(), edited(r.file, '>SUNWAVE<', '><tspan x="50" dy="0em">SUN</tspan><tspan x="50" dy="1.3em">WAVE</tspan><'));
  oneEntry(r, 'Edit text');
});
