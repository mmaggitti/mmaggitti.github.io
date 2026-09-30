// The editor, driven in node with fake views: the plan's data flow (canvas → code → overlay →
// stores, in that order), canvas and code as two live views of one document, scrubbing that
// changes only a token's bytes, the sheets refusing what they can't write, Edit source in one
// transaction, one history entry per gesture, selection, and a view that never touches the file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { descendants, serialize, serializeNode, type Doc, type ElementNode, type NodeId } from '../../../../engine/model/doc.ts';
import { Editor, lineColumn, READ_ONLY, type CanvasPort } from '../../src/editor.ts';
import type { FocusMark, ViewBlock, ViewToken } from '../../src/codeview/code-view.ts';
import { cameraBox, fit, toDoc, toScreen, MAX_BOX } from '../../src/canvas/viewport.ts';
import { artboard, rootViewport } from '../../src/canvas/artboard.ts';
import type { Camera } from '../../src/canvas/renderer.ts';
import { rootTransform } from '../../../../engine/geometry/ctm.ts';
import { mapRect } from '../../../../engine/geometry/bounds.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SAMPLE = readFileSync(`${HERE}../../src/canvas/sample.svg`, 'utf8');
const HOST = { width: 416, height: 528 };

// ── fakes ──────────────────────────────────────────────────────────────────────────────────────

interface Rig {
  editor: Editor;
  log: string[];
  listing: Map<string, ViewBlock>;
  order: string[];
  cameras: (Camera | null)[];
  outlines: NodeId[][];
  selected: ReadonlySet<number>[];
  focused: (FocusMark | null)[];
}

function rig(size = HOST, over: Partial<CanvasPort> = {}): Rig {
  const log: string[] = [];
  const listing = new Map<string, ViewBlock>();
  let order: string[] = [];
  const cameras: (Camera | null)[] = [];
  const outlines: NodeId[][] = [];
  const selected: ReadonlySet<number>[] = [];
  const focused: (FocusMark | null)[] = [];
  const canvas: CanvasPort = {
    render: () => log.push('canvas render'),
    patchAttributes: (id) => log.push(`canvas attrs ${id}`),
    patchSubtree: (id) => log.push(`canvas subtree ${id}`),
    setCamera: (r) => cameras.push(r),
    nodeFor: () => ({}),
    stats: () => ({ rendered: 1, skippedElements: 0, droppedAttributes: 0 }),
    clear: () => log.push('canvas clear'),
    motion: () => 'still',
    play: () => {},
    ...over,
  };
  const r: Rig = {
    log, listing, cameras, outlines, selected, focused,
    get order() {
      return order;
    },
    editor: new Editor({
      canvas,
      code: {
        set: (blocks) => {
          log.push('code set');
          listing.clear();
          for (const b of blocks) listing.set(b.key, b);
          order = blocks.map((b) => b.key);
        },
        patch: (b) => {
          log.push(`code patch ${b.key}`);
          if (listing.has(b.key)) listing.set(b.key, b);
        },
        select: (nodes) => selected.push(new Set(nodes)),
        focus: (mark) => focused.push(mark),
        readOnly: (on) => log.push(`code read-only ${on}`),
        source: (t, at) => {
          log.push(`code source ${at}`);
          listing.clear();
          order = [];
        },
      },
      overlay: { outline: (ids) => (log.push('overlay'), outlines.push([...ids])) },
      hostSize: () => size,
      sinkReady: () => true,
    }),
  };
  r.editor.version.subscribe(() => log.push('stores'));
  return r;
}

const text = (r: Rig) => r.order.map((k) => r.listing.get(k)!.text).join('');
const doc = (r: Rig): Doc => r.editor.doc!;
const element = (d: Doc, pred: (n: ElementNode) => boolean) => [...descendants(d, d.root)].find((n) => n.kind === 'element' && pred(n)) as ElementNode;
const attr = (n: ElementNode, local: string) => n.attrs.find((a) => a.local === local)?.raw;

/** The code view's block and token for an attribute's i-th token of kind `kind`. */
function tokenIn(r: Rig, node: NodeId, kind: ViewToken['kind'], i = 0, after?: string): { block: ViewBlock; token: ViewToken } {
  const block = r.listing.get(`${node}:start`) ?? r.listing.get(`${node}:leaf`)!;
  const from = after ? block.text.indexOf(after) : 0;
  const token = block.tokens.filter((t) => t.kind === kind && t.start >= from)[i];
  assert.ok(token, `no ${kind} token ${i} in ${block.text}`);
  return { block, token };
}

/** `after` equals `before` outside [start, end) of `before`. */
function onlyBetween(before: string, after: string, start: number, end: number): boolean {
  const tail = before.length - end;
  return after.slice(0, start) === before.slice(0, start) && after.slice(after.length - tail) === before.slice(end) && after.length - tail >= start;
}

const circleOf = (r: Rig) => element(doc(r), (n) => n.local === 'circle');

/** The fitted view and its camera, composed from the pure pieces the editor uses. */
function fitted(d: Doc, host = HOST) {
  const viewport = rootViewport(d, host);
  const M = rootTransform(d, viewport);
  const board = artboard(d);
  const view = fit(board ? mapRect(M, board) : { x: 0, y: 0, width: viewport.width, height: viewport.height }, host, 0);
  return { view, camera: { box: cameraBox(view, host, viewport), viewport } };
}

// ── opening ────────────────────────────────────────────────────────────────────────────────────

test('opening fits the artboard into the host and lists the whole source as code', () => {
  const r = rig();
  const res = r.editor.open(SAMPLE);
  assert.ok(res.ok, res.error);
  assert.equal(r.log.filter((l) => l === 'canvas render').length, 1);
  assert.equal(text(r), SAMPLE, 'the listing is the source, byte for byte');
  // The sample has a viewBox and no size: its own box is the host at fit, pixel for pixel as alone.
  assert.deepEqual(r.cameras.at(-1), { box: { left: 0, top: 0, width: HOST.width, height: HOST.height }, viewport: HOST });
  assert.deepEqual(r.editor.view, fitted(doc(r)).view);
  r.editor.zoomAt({ x: 10, y: 10 }, 1);
  assert.deepEqual(r.cameras.at(-1), fitted(doc(r)).camera, 'the camera stays the fitted view itself');
  assert.equal(r.editor.source(), SAMPLE);
  assert.deepEqual(r.editor.history.get(), { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
  const bad = r.editor.open('<svg');
  assert.ok(!bad.ok && bad.error, 'a file that does not parse says so');
  assert.equal(r.editor.source(), SAMPLE, 'and the open document stays');
});

// ── canvas and code: two live views of one document ────────────────────────────────────────────

test('an edit reaches the canvas, then the code, then the overlay, then the stores; the listing stays the source', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const poly = element(doc(r), (n) => n.local === 'polyline');
  const { block, token } = tokenIn(r, poly.id, 'enum', 0, 'stroke-linecap');
  r.log.length = 0;
  r.editor.tapToken(block, token);
  const i = r.log.indexOf(`canvas attrs ${poly.id}`);
  assert.ok(i >= 0, r.log.join(', '));
  assert.deepEqual(r.log.slice(i, i + 4), [`canvas attrs ${poly.id}`, `code patch ${poly.id}:start`, 'overlay', 'stores']);
  assert.equal(r.log.filter((l) => l.startsWith('canvas')).length, 1, 'one element patched, nothing re-rendered');
  assert.equal(attr(poly, 'stroke-linecap'), 'square');
  assert.equal(text(r), r.editor.source(), 'the code shows exactly the document');
  // Undo and redo take the same road: the canvas follows them first.
  for (const step of ['undo', 'redo'] as const) {
    r.log.length = 0;
    r.editor[step]();
    assert.deepEqual(r.log.slice(0, 4), [`canvas attrs ${poly.id}`, `code patch ${poly.id}:start`, 'overlay', 'stores'], step);
    assert.equal(text(r), r.editor.source(), `${step}: the code shows exactly the document`);
  }

  // A structure change re-renders the parent's subtree and rebuilds the listing.
  r.editor.select([poly.id]);
  r.editor.openSource();
  r.log.length = 0;
  assert.equal(r.editor.applySource(poly.id, '<circle r="3"/>'), null);
  assert.deepEqual(r.log.slice(0, 2), [`canvas subtree ${doc(r).root}`, 'code set']);
  assert.equal(text(r), r.editor.source());
});

test('change listeners (the draft autosave) hear every change last: edits, undo, redo and the end of a drag, never its frames or an open', () => {
  const r = rig();
  r.editor.onChange(() => r.log.push('drafts'));
  r.editor.open(SAMPLE);
  assert.ok(!r.log.includes('drafts'), 'opening is not a change');
  const poly = element(doc(r), (n) => n.local === 'polyline');
  const { block, token } = tokenIn(r, poly.id, 'enum', 0, 'stroke-linecap');
  r.log.length = 0;
  r.editor.tapToken(block, token);
  const i = r.log.indexOf(`canvas attrs ${poly.id}`);
  assert.deepEqual(r.log.slice(i), [`canvas attrs ${poly.id}`, `code patch ${poly.id}:start`, 'overlay', 'stores', 'drafts'], 'after the stores');
  for (const step of ['undo', 'redo'] as const) {
    r.log.length = 0;
    r.editor[step]();
    assert.equal(r.log.at(-1), 'drafts', step);
    assert.equal(r.log.filter((l) => l === 'drafts').length, 1, step);
  }
  const num = tokenIn(r, circleOf(r).id, 'number');
  r.log.length = 0;
  r.editor.scrubStart(num.block, num.token);
  for (const steps of [1, 2, 3]) r.editor.scrub(steps);
  assert.ok(!r.log.includes('drafts'), "a drag's frames are not changes");
  r.editor.scrubEnd(true);
  assert.equal(r.log.filter((l) => l === 'drafts').length, 1, 'its end is one');
  r.log.length = 0;
  r.editor.scrubStart(num.block, num.token);
  r.editor.scrub(5);
  r.editor.scrubEnd(false);
  assert.equal(r.log.filter((l) => l === 'drafts').length, 1, 'a cancelled drag is heard too (the text is back)');
});

test('a read-only document refuses every edit and says why; selection and the view still work', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  r.editor.readOnly.set(true);
  const c = circleOf(r);
  const num = tokenIn(r, c.id, 'number');
  const col = tokenIn(r, c.id, 'color');
  const poly = element(doc(r), (n) => n.local === 'polyline');
  const kw = tokenIn(r, poly.id, 'enum', 0, 'stroke-linecap');
  r.editor.tapToken(kw.block, kw.token);
  assert.equal(r.editor.notice.get(), READ_ONLY);
  r.editor.notice.set(null);
  r.editor.tapToken(col.block, col.token);
  assert.equal(r.editor.sheet.get(), null, 'no sheet opens');
  r.editor.tapToken(num.block, num.token);
  assert.equal(r.editor.focus.get(), null, 'a number is plain text here: no Scrub strip');
  r.editor.stepFocus(1);
  r.editor.keyToken(num.block, num.token, 'up');
  r.editor.keyToken(kw.block, kw.token, 'open');
  r.editor.scrubStart(num.block, num.token);
  r.editor.scrub(4);
  r.editor.scrubEnd(true);
  r.editor.select([c.id]);
  r.editor.openSource();
  assert.equal(r.editor.applySource(c.id, '<circle/>')?.message, READ_ONLY);
  assert.equal(r.editor.source(), SAMPLE, 'nothing was written');
  assert.equal(r.editor.notice.get(), READ_ONLY);
  assert.deepEqual([...r.editor.selection.get()], [c.id], 'selection still works');
  r.editor.zoomAt({ x: 10, y: 10 }, 2);
  assert.equal(r.editor.view.scale, r.editor.fitScale * 2, 'and so does the view');
  assert.ok(r.log.includes('code read-only true'), 'the code shows it as plain text');
  r.editor.readOnly.set(false);
  assert.equal(r.log.at(-1), 'code read-only false');
  r.editor.tapToken(num.block, num.token);
  r.editor.stepFocus(1);
  assert.notEqual(r.editor.source(), SAMPLE, 'editable again');
});

// ── scrubbing ──────────────────────────────────────────────────────────────────────────────────

test('a scrub changes only its token bytes, frame by frame, and is one history entry', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const c = circleOf(r);
  const { block, token } = tokenIn(r, c.id, 'number');
  const at = SAMPLE.indexOf('cx="212"') + 4;
  const before = r.editor.source();
  r.editor.scrubStart(block, token);
  assert.deepEqual([...r.editor.selection.get()], [c.id], 'the scrubbed element is selected');
  const bumps = r.log.filter((l) => l === 'stores').length;
  for (const steps of [1, 2, 5, -3, 40]) {
    r.editor.scrub(steps);
    const now = r.editor.source();
    assert.ok(onlyBetween(before, now, at, at + 3), `steps ${steps}: ${now.slice(at - 10, at + 10)}`);
    assert.equal(now.slice(at, at + String(212 + steps).length), String(212 + steps));
    assert.equal(text(r), now, 'the code follows every frame');
  }
  assert.equal(r.log.filter((l) => l === 'stores').length, bumps, 'no store (no React render) during the scrub');
  r.editor.scrubEnd(true);
  assert.deepEqual(r.editor.history.get(), { canUndo: true, canRedo: false, undoLabel: 'Scrub cx', redoLabel: null });
  const scrubbed = r.editor.source();
  r.editor.undo();
  assert.equal(r.editor.source(), before, 'one undo restores the original byte for byte');
  assert.equal(r.editor.history.get().canUndo, false, 'the scrub was one entry');
  r.editor.redo();
  assert.equal(r.editor.source(), scrubbed);
});

test('a cancelled scrub restores the value and records nothing; undo waits for the scrub to end', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const { block, token } = tokenIn(r, circleOf(r).id, 'number', 2);
  r.editor.scrubStart(block, token);
  r.editor.scrub(9);
  r.editor.undo();
  assert.notEqual(r.editor.source(), SAMPLE, 'undo does nothing mid-scrub');
  r.editor.scrubEnd(false);
  assert.equal(r.editor.source(), SAMPLE);
  assert.equal(r.editor.history.get().canUndo, false);
});

test('over the corpus, scrubbing number tokens through the editor changes only their bytes, and undo restores the file', () => {
  const dir = fileURLToPath(new URL('../../../../engine/test/fixtures/corpus/', import.meta.url));
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((p) => p.split(sep).join('/')).filter((p) => p.endsWith('.svg')).sort();
  let scrubs = 0;
  for (const rel of files) {
    const src = readFileSync(dir + rel, 'utf8');
    const r = rig();
    if (!r.editor.open(src).ok) continue;
    // Up to 8 number tokens per file, spread through it.
    const all: { key: string; token: ViewToken; offset: number }[] = [];
    let offset = 0;
    for (const key of r.order) {
      const b = r.listing.get(key)!;
      for (const t of b.tokens) if (t.kind === 'number') all.push({ key, token: t, offset: offset + t.start });
      offset += b.text.length;
    }
    const pick = all.filter((_, i) => i % Math.max(1, Math.floor(all.length / 8)) === 0).slice(0, 8);
    for (const { key, token, offset: at } of pick) {
      const before = r.editor.source();
      const block = r.listing.get(key)!;
      r.editor.scrubStart(block, token);
      r.editor.scrub(3);
      r.editor.scrub(-2);
      const now = r.editor.source();
      // A glued number may gain one separating space inside its own span (engine/code/edit.ts).
      assert.ok(onlyBetween(before, now, at, at + token.end - token.start), `${rel}: scrubbing ${before.slice(at, at + token.end - token.start)} changed other bytes`);
      r.editor.scrubEnd(true);
      r.editor.undo();
      assert.equal(r.editor.source(), before, `${rel}: undo`);
      assert.equal(text(r), before, `${rel}: the code view`);
      scrubs++;
    }
    assert.equal(r.editor.source(), src, `${rel}: the file is back`);
  }
  assert.ok(scrubs > 1000, `only ${scrubs} scrubs`);
});

// ── the Scrub strip and the sheets ────────────────────────────────────────────────────────────

test('the Scrub strip: a tap focuses a number; −, + and ± are one entry each; refused values are not written', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const c = circleOf(r);
  const { block, token } = tokenIn(r, c.id, 'number', 2); // r="42"
  r.editor.tapToken(block, token);
  assert.equal(r.editor.focus.get()?.token.text, '42');
  r.editor.stepFocus(1);
  r.editor.stepFocus(1);
  assert.equal(attr(c, 'r'), '44');
  assert.equal(r.editor.focus.get()?.token.text, '44', 'the strip reads the value now');
  r.editor.negateFocus();
  assert.equal(attr(c, 'r'), '44', 'r has a minimum of 0: the negative is refused');
  assert.match(r.editor.notice.get() ?? '', /below the minimum/);
  r.editor.undo();
  assert.equal(attr(c, 'r'), '43', 'each press was its own entry');
  const cx = tokenIn(r, c.id, 'number', 0);
  r.editor.tapToken(cx.block, cx.token);
  r.editor.negateFocus();
  assert.equal(attr(c, 'cx'), '-212');
});

test('the Scrub strip follows the number being scrubbed, and the code marks the number it holds', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const c = circleOf(r);
  const radius = tokenIn(r, c.id, 'number', 2); // r="42"
  r.editor.tapToken(radius.block, radius.token);
  assert.deepEqual(r.focused.at(-1), { key: radius.block.key, index: radius.block.tokens.indexOf(radius.token) }, 'r is marked');
  const poly = element(doc(r), (n) => n.local === 'polyline');
  const width = tokenIn(r, poly.id, 'number', 0, 'stroke-width'); // 2.5
  r.editor.scrubStart(width.block, width.token);
  r.editor.scrub(2);
  r.editor.scrubEnd(true);
  assert.equal(r.editor.focus.get()?.token.prop, 'stroke-width', 'the strip moved to the scrubbed number');
  r.editor.stepFocus(1);
  assert.equal(attr(c, 'r'), '42', "the circle's r is untouched");
  assert.equal(attr(poly, 'stroke-width'), '2.8', 'the strip steps what was scrubbed');
  assert.deepEqual(r.focused.at(-1), { key: width.block.key, index: width.block.tokens.indexOf(width.token) });
  // Two equal numbers: the mark says which one the strip holds, and stays on it through an edit.
  const first91 = tokenIn(r, poly.id, 'number', 3); // points="64 98 72 91 …"
  const second91 = tokenIn(r, poly.id, 'number', 7); // "… 88 91 …"
  assert.deepEqual([first91.block.text.slice(first91.token.start, first91.token.end), second91.block.text.slice(second91.token.start, second91.token.end)], ['91', '91']);
  r.editor.tapToken(second91.block, second91.token);
  const mark = { key: second91.block.key, index: second91.block.tokens.indexOf(second91.token) };
  assert.deepEqual(r.focused.at(-1), mark);
  r.editor.stepFocus(1);
  assert.match(attr(poly, 'points')!, /^64 98 72 91 80 98 88 92 96 98$/);
  assert.deepEqual(r.focused.at(-1), mark, 'still the same number');
  r.editor.clearFocus();
  assert.equal(r.focused.at(-1), null, 'Done clears the mark');
});

test('Edit source is offered for one element, never the root it cannot replace', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  assert.equal(r.editor.canEditSource(), false, 'nothing selected');
  r.editor.tapBlock(r.listing.get(`${doc(r).root}:start`)!);
  assert.deepEqual([...r.editor.selection.get()], [doc(r).root], 'test setup: a tap on its code selects the root');
  assert.equal(r.editor.canEditSource(), false, 'the root');
  r.editor.tapCanvas(circleOf(r).id);
  assert.equal(r.editor.canEditSource(), true, 'a circle');
});

test('the Number sheet: typed values are checked first, live, and the visit is one entry', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const c = circleOf(r);
  const { block, token } = tokenIn(r, c.id, 'number', 2);
  r.editor.tapToken(block, token);
  r.editor.openNumberSheet();
  assert.equal(r.editor.sheet.get()?.kind, 'number');
  assert.ok('error' in r.editor.sheetInput('abc'));
  assert.ok('error' in r.editor.sheetInput('-5'));
  assert.equal(attr(c, 'r'), '42', 'refused input is never written');
  assert.deepEqual(r.editor.sheetInput('50'), { text: '50' });
  assert.equal(attr(c, 'r'), '50', 'good input applies live');
  assert.ok('error' in r.editor.sheetInput('5x'));
  assert.equal(attr(c, 'r'), '50', 'a refused value keeps the last good one');
  r.editor.sheetInput('60');
  r.editor.closeSheet();
  assert.equal(r.editor.sheet.get(), null);
  assert.equal(attr(c, 'r'), '60');
  r.editor.undo();
  assert.equal(r.editor.source(), SAMPLE, 'the whole visit undoes at once');
});

test('the Color and Text sheets: colours must parse; text is escaped where it lands', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const c = circleOf(r);
  const fill = tokenIn(r, c.id, 'color');
  r.editor.tapToken(fill.block, fill.token);
  assert.equal(r.editor.sheet.get()?.kind, 'color');
  assert.ok('error' in r.editor.sheetInput('not a colour'));
  assert.equal(attr(c, 'fill'), '#ffd166');
  r.editor.sheetInput('#e63946');
  r.editor.sheetInput('rebeccapurple');
  r.editor.closeSheet();
  assert.equal(attr(c, 'fill'), 'rebeccapurple');
  assert.equal(r.editor.history.get().undoLabel, 'Set fill');

  const t = element(doc(r), (n) => n.local === 'text');
  const leaf = t.children[0];
  const run = tokenIn(r, leaf, 'text');
  r.editor.tapToken(run.block, run.token);
  assert.equal(r.editor.sheet.get()?.kind, 'text');
  assert.deepEqual([...r.editor.selection.get()], [t.id], "the text's element is selected");
  assert.ok('error' in r.editor.sheetInput('two\nlines'));
  r.editor.sheetInput('Sun & <sea>');
  r.editor.closeSheet();
  assert.equal(serializeNode(doc(r), t.id).includes('>Sun &amp; &lt;sea></text>'), true, serializeNode(doc(r), t.id));
  r.editor.undo();
  r.editor.undo();
  assert.equal(r.editor.source(), SAMPLE);
});

// ── Edit source ────────────────────────────────────────────────────────────────────────────────

test('Edit source replaces the element in one transaction; a parse error says where and changes nothing', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const frame = element(doc(r), (n) => n.local === 'rect' && attr(n, 'stroke') === '#1b1b1b');
  r.editor.select([frame.id]);
  r.editor.openSource();
  const sheet = r.editor.sheet.get();
  assert.ok(sheet?.kind === 'source');
  assert.equal(sheet.text, '<rect x="16" y="16" width="288" height="208" rx="24" fill="none" stroke="#1b1b1b" stroke-width="3"/>');

  const broken = '<rect x="16"\n  y="16" <oops/>';
  const err = r.editor.applySource(frame.id, broken);
  assert.ok(err);
  assert.equal(err.line, 2, JSON.stringify(err));
  assert.ok(err.message.length > 0);
  assert.equal(r.editor.source(), SAMPLE, 'nothing changed');
  assert.equal(r.editor.history.get().canUndo, false, 'and nothing was recorded');
  assert.ok(r.editor.applySource(frame.id, '  <!-- just a comment -->  '), 'no element: refused');
  assert.equal(r.editor.source(), SAMPLE);

  const edited = sheet.text.replace('rx="24"', 'rx="12" opacity="0.5"');
  assert.equal(r.editor.applySource(frame.id, edited), null);
  const after = r.editor.source();
  assert.equal(after, SAMPLE.replace(sheet.text, edited), 'only that element changed');
  assert.equal(r.editor.history.get().undoLabel, 'Edit source');
  assert.equal(r.editor.sheet.get(), null);
  const sel = [...r.editor.selection.get()];
  assert.equal(sel.length, 1);
  assert.equal(serializeNode(doc(r), sel[0]), edited, 'the new element is selected');
  r.editor.undo();
  assert.equal(r.editor.source(), SAMPLE, 'one undo restores it byte for byte');
  assert.equal(r.editor.selection.get().size, 0, 'the element the undo took out is no longer selected');
  assert.equal(r.editor.canEditSource(), false, 'so Edit source is not offered for it');
  r.editor.redo();
  assert.equal(r.editor.source(), after);
  assert.deepEqual(lineColumn('ab\r\ncd\ref', 8), { line: 3, column: 2 });
});

// ── history ────────────────────────────────────────────────────────────────────────────────────

test('history: one entry per gesture, and the stores say what undo and redo would do', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const c = circleOf(r);
  const cx = tokenIn(r, c.id, 'number');
  r.editor.scrubStart(cx.block, cx.token);
  for (let i = 1; i <= 30; i++) r.editor.scrub(i);
  r.editor.scrubEnd(true);
  const poly = element(doc(r), (n) => n.local === 'polyline');
  const cap = tokenIn(r, poly.id, 'enum', 0, 'stroke-linecap');
  r.editor.tapToken(cap.block, cap.token);
  const labels: string[] = [];
  while (r.editor.history.get().canUndo) {
    labels.push(r.editor.history.get().undoLabel!);
    r.editor.undo();
  }
  assert.deepEqual(labels, ['Set stroke-linecap', 'Scrub cx']);
  assert.equal(r.editor.source(), SAMPLE);
  assert.deepEqual(r.editor.history.get(), { canUndo: false, canRedo: true, undoLabel: null, redoLabel: 'Scrub cx' });
  r.editor.redo();
  r.editor.redo();
  assert.equal(r.editor.history.get().canRedo, false);
});

// ── selection ──────────────────────────────────────────────────────────────────────────────────

test('selection: a canvas tap takes the nearest element that draws; the code and the overlay follow', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const d = doc(r);
  const c = circleOf(r);
  r.editor.tapCanvas(c.id);
  assert.deepEqual([...r.editor.selection.get()], [c.id]);
  assert.deepEqual(r.selected.at(-1), new Set([c.id]), 'the code view marks its block');
  assert.deepEqual(r.outlines.at(-1), [c.id], 'the overlay outlines it');
  const text = element(d, (n) => n.local === 'text');
  r.editor.tapCanvas(text.children[0]);
  assert.deepEqual([...r.editor.selection.get()], [text.id], 'text selects its element');
  const stop = element(d, (n) => n.local === 'stop');
  r.editor.tapCanvas(stop.id);
  assert.deepEqual([...r.editor.selection.get()], [], 'defs content is never selected');
  const clipRect = element(d, (n) => n.local === 'rect' && d.nodes.get(n.parent!)?.kind === 'element' && (d.nodes.get(n.parent!) as ElementNode).local === 'clipPath');
  r.editor.tapCanvas(clipRect.id);
  assert.deepEqual([...r.editor.selection.get()], [], 'nor a shape that only draws where it is referenced');
  r.editor.tapCanvas(c.id);
  r.editor.tapCanvas(d.root);
  assert.deepEqual([...r.editor.selection.get()], [], 'the root (empty canvas) clears');
  const clip = element(d, (n) => n.local === 'clipPath');
  r.editor.tapBlock(r.listing.get(`${clip.id}:end`)!);
  assert.deepEqual([...r.editor.selection.get()], [clip.id], 'a code block selects its element');
  assert.deepEqual(r.outlines.at(-1), [], 'which is outlined only if it draws');
  r.editor.tapBlock(r.listing.get(`${clipRect.id}:start`)!);
  assert.deepEqual([...r.editor.selection.get()], [clipRect.id]);
  assert.deepEqual(r.outlines.at(-1), [], 'a shape inside a clipPath draws only where it is used: no outline');
});

// ── the view ───────────────────────────────────────────────────────────────────────────────────

test('zoom and pan move the camera about the point, never the file', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const at = { x: 300, y: 120 };
  const under = toDoc(r.editor.view, HOST, at);
  r.editor.zoomAt(at, 4);
  const v = r.editor.view;
  assert.ok(Math.abs(v.scale / r.editor.fitScale - 4) < 1e-9);
  const back = toScreen(v, HOST, under);
  assert.ok(Math.abs(back.x - at.x) < 1e-9 && Math.abs(back.y - at.y) < 1e-9, 'the zoom invariant');
  assert.deepEqual(r.cameras.at(-1), { box: cameraBox(v, HOST, HOST), viewport: HOST }, 'the root’s box, scaled and moved');
  r.editor.navStart();
  const a0 = { x: 100, y: 100 }, b0 = { x: 200, y: 200 };
  r.editor.navigate(a0, b0, { x: 90, y: 90 }, { x: 210, y: 210 });
  const mid = toDoc(v, HOST, { x: 150, y: 150 });
  const now = toScreen(r.editor.view, HOST, mid);
  assert.ok(Math.abs(now.x - 150) < 1e-9 && Math.abs(now.y - 150) < 1e-9, 'a pinch keeps the point between the fingers');
  r.editor.navEnd();
  r.editor.panBy(10, -5);
  assert.equal(r.editor.source(), SAMPLE, 'the file is never touched');
  // After the user moved the view, a resize keeps it; a fitted view fits again.
  const kept = r.editor.view;
  r.editor.resize({ width: 416, height: 300 });
  assert.deepEqual(r.editor.view, kept);
  r.editor.fitToScreen();
  r.editor.resize({ width: 416, height: 528 });
  assert.deepEqual(r.editor.view, fitted(doc(r), { width: 416, height: 528 }).view);
});

test('a file placed otherwise (preserveAspectRatio) opens with the camera fitting it; a viewBox edit fits again', () => {
  const r = rig();
  r.editor.open('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20" preserveAspectRatio="xMinYMin"><rect width="10" height="10"/></svg>');
  // Alone the artboard sits at the host's left (xMinYMin); the camera box moves the root's box right to centre it.
  assert.deepEqual(r.cameras.at(-1), { box: { left: 76, top: 0, width: 416, height: 528 }, viewport: HOST });
  assert.deepEqual(r.cameras.at(-1), fitted(doc(r)).camera);
  const root = doc(r).root;
  const { block, token } = tokenIn(r, root, 'number', 2); // viewBox width
  r.editor.tapToken(block, token);
  r.editor.stepFocus(10);
  assert.deepEqual(r.cameras.at(-1), { box: { left: 0, top: 56, width: 416, height: 528 }, viewport: HOST }, 'a fitted view follows the artboard');
  r.editor.zoomAt({ x: 0, y: 0 }, 2);
  const zoomed = r.cameras.at(-1);
  r.editor.stepFocus(-5);
  assert.deepEqual(r.cameras.at(-1), zoomed, 'a view the user moved stays');
});

test('a hostile viewBox near the float limit: zoom, pinch and pan keep a view whose camera can be drawn', () => {
  // A viewBox near the float limit, and a root so wide that zooming in would make its box too big
  // to draw (over MAX_BOX CSS px a side): every camera the renderer is given can be placed.
  for (const attrs of ['viewBox="1.7e308 1.7e308 1.7e308 1.7e308"', 'viewBox="0 0 1e308 1e308"', 'width="1e30" height="1e30"']) {
    const r = rig();
    assert.ok(r.editor.open(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="10" height="10"/></svg>`).ok, attrs);
    r.editor.zoomAt({ x: 10, y: 10 }, 1 / 16);
    r.editor.zoomAt({ x: 10, y: 10 }, 2);
    for (let i = 0; i < 60; i++) r.editor.zoomAt({ x: 10, y: 10 }, 4);
    r.editor.navStart();
    r.editor.navigate({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 140, y: 100 }, { x: 160, y: 100 });
    r.editor.navEnd();
    r.editor.panBy(40, 40);
    const bad = r.cameras.filter((c) => c !== null && (![c.box.left, c.box.top, c.box.width, c.box.height].every(Number.isFinite) || c.box.width > MAX_BOX || c.box.height > MAX_BOX));
    assert.deepEqual(bad, [], `${attrs}: a camera the renderer can't place`);
    assert.ok(r.cameras.length > 3, `${attrs}: the view moved`);
  }
});

test('a document with no artboard draws as the browser draws it until the view moves', () => {
  const r = rig();
  r.editor.open('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
  // At fit its box is the host at scale 1, so the renderer supplies no viewBox: as the browser draws it.
  assert.deepEqual(r.cameras.at(-1), { box: { left: 0, top: 0, width: HOST.width, height: HOST.height }, viewport: HOST });
  r.editor.zoomAt({ x: 0, y: 0 }, 2);
  assert.deepEqual(r.cameras.at(-1), { box: { left: 0, top: 0, width: HOST.width * 2, height: HOST.height * 2 }, viewport: HOST }, 'the scale leaves 1 only when the view moves');
});

// ── P0-M5: the keyboard, the source view, render errors ────────────────────────────────────────

test('the keyboard: Enter or Space on a number opens its Number sheet and the arrows step it, one entry each; on any other token Enter does what a tap does', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const c = circleOf(r);
  const cx = tokenIn(r, c.id, 'number');
  r.editor.keyToken(cx.block, cx.token, 'up');
  assert.ok(r.editor.source().includes('cx="213"'), 'an arrow up steps the number');
  r.editor.keyToken(cx.block, cx.token, 'down');
  r.editor.keyToken(cx.block, cx.token, 'down');
  assert.equal(r.editor.source(), SAMPLE.replace('cx="212"', 'cx="211"'), 'and down steps it back, changing only its bytes');
  assert.equal(r.editor.focus.get()?.token.text, '211', 'the Scrub strip follows the number the keys step');
  assert.deepEqual([...r.editor.selection.get()], [c.id], 'and its element is selected');
  let entries = 0;
  while (r.editor.history.get().canUndo) {
    entries++;
    r.editor.undo();
  }
  assert.equal(entries, 3, 'one history entry a key');
  assert.equal(r.editor.source(), SAMPLE);
  r.editor.keyToken(cx.block, cx.token, 'open');
  assert.equal(r.editor.sheet.get()?.kind, 'number', 'Enter or Space on a number opens its Number sheet');
  r.editor.closeSheet();
  const poly = element(doc(r), (n) => n.local === 'polyline');
  const cap = tokenIn(r, poly.id, 'enum', 0, 'stroke-linecap');
  r.editor.keyToken(cap.block, cap.token, 'open');
  const cycled = SAMPLE.replace('stroke-linecap="round"', 'stroke-linecap="square"');
  assert.equal(r.editor.source(), cycled, 'Enter on a keyword moves it to its next option, as a tap does');
  const square = tokenIn(r, poly.id, 'enum', 0, 'stroke-linecap');
  r.editor.keyToken(square.block, square.token, 'up');
  assert.equal(r.editor.source(), cycled, 'an arrow on a keyword changes nothing');
  r.editor.keyToken(square.block, square.token, 'open');
  assert.equal(r.editor.source(), SAMPLE.replace('stroke-linecap="round"', 'stroke-linecap="butt"'), 'and wraps round');
  const fill = tokenIn(r, c.id, 'color');
  r.editor.keyToken(fill.block, fill.token, 'open');
  assert.equal(r.editor.sheet.get()?.kind, 'color', 'Enter on a colour opens its sheet');
  r.editor.closeSheet();
});

test('a file shown as source: its text in the code with the error marked, nothing drawn, and nothing to edit until another opens', () => {
  const r = rig();
  r.editor.open(SAMPLE);
  const c = circleOf(r);
  const cx = tokenIn(r, c.id, 'number');
  r.editor.tapToken(cx.block, cx.token);
  r.editor.keyToken(cx.block, cx.token, 'up');
  assert.ok(r.editor.focus.get() && r.editor.history.get().canUndo, 'test setup: a number is focused and there is history');
  const bad = '<svg xmlns="http://www.w3.org/2000/svg">\n<g>\n</svg>\n';
  r.log.length = 0;
  r.editor.showSource(bad, 46);
  assert.deepEqual(r.log.slice(0, 2), ['canvas clear', 'code source 46'], 'the canvas draws nothing, and the code shows the text');
  assert.equal(r.editor.doc, null);
  assert.equal(r.editor.source(), '');
  assert.equal(r.editor.selection.get().size, 0);
  assert.equal(r.editor.focus.get(), null);
  assert.deepEqual(r.editor.history.get(), { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
  // Nothing edits it: taps, keys, scrubs, undo, Edit source.
  r.editor.tapToken(cx.block, cx.token);
  r.editor.keyToken(cx.block, cx.token, 'open');
  r.editor.scrubStart(cx.block, cx.token);
  r.editor.scrub(3);
  r.editor.scrubEnd(true);
  r.editor.undo();
  r.editor.openSource();
  r.editor.tapCanvas(c.id);
  assert.equal(r.editor.sheet.get(), null);
  assert.equal(r.editor.focus.get(), null);
  assert.equal(r.editor.selection.get().size, 0);
  assert.equal(r.editor.source(), '');
  assert.equal(r.editor.motion.get(), 'still');
  r.editor.open(SAMPLE);
  assert.equal(text(r), SAMPLE, 'the next drawing that opens lists its code again');
});

test('a render error: the whole drawing is drawn again from the model; if that fails too, the canvas is cleared and says why, and the file, the code and undo carry on', () => {
  let failPatch = 0;
  let failRender = 0;
  const r: Rig = rig(HOST, {
    patchAttributes: (id) => {
      r.log.push(`canvas attrs ${id}`);
      if (failPatch-- > 0) throw new Error('patch broke');
    },
    render: () => {
      r.log.push('canvas render');
      if (failRender-- > 0) throw new Error('render broke');
    },
  });
  r.editor.open(SAMPLE);
  const c = circleOf(r);
  const cx = tokenIn(r, c.id, 'number');
  failPatch = 1;
  r.log.length = 0;
  r.editor.keyToken(cx.block, cx.token, 'up');
  assert.ok(r.log.includes('canvas render'), 'a patch that threw: the whole drawing is drawn again');
  assert.equal(r.editor.canvasError.get(), null, 'and nothing needs saying');
  assert.ok(r.editor.source().includes('cx="213"'), 'the edit is in the file');
  assert.equal(text(r), r.editor.source(), 'and in the code');
  failPatch = 1;
  failRender = 1;
  r.log.length = 0;
  r.editor.keyToken(cx.block, cx.token, 'up');
  assert.equal(r.editor.canvasError.get(), 'render broke', 'drawing it again failed too: the canvas says why');
  assert.ok(r.log.includes('canvas clear'), 'and draws nothing rather than half a drawing');
  assert.ok(r.editor.source().includes('cx="214"'), 'the file has the edit');
  assert.equal(text(r), r.editor.source(), 'and so does the code');
  assert.equal(r.editor.motion.get(), 'still');
  r.log.length = 0;
  r.editor.undo();
  assert.ok(r.log.includes('canvas render'), 'the next change draws the whole drawing again');
  assert.equal(r.editor.canvasError.get(), null, 'which works now, so the message goes');
  assert.ok(r.editor.source().includes('cx="213"'), 'undo carried on through it');
});
