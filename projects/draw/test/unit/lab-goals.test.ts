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
import { corpus, fakePorts } from './fakes.ts';

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
  const editor = new Editor(ports);
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
