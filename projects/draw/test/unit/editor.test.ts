// The editor, driven in node with fake views: the plan's data flow (canvas → code → overlay →
// stores, in that order), canvas and code as two live views of one document, scrubbing that
// changes only a token's bytes, the sheets refusing what they can't write, Edit source in one
// transaction, one history entry per gesture, selection, and a view that never touches the file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { descendants, parseDoc, serialize, serializeNode, type Doc, type ElementNode, type NodeId } from '../../../../engine/model/doc.ts';
import { Editor, LOCKED, lineColumn, READ_ONLY, type CanvasPort } from '../../src/editor.ts';
import type { FocusMark, ViewBlock, ViewToken } from '../../src/codeview/code-view.ts';
import { cameraBox, fit, toDoc, toScreen, MAX_BOX } from '../../src/canvas/viewport.ts';
import { artboard, rootViewport } from '../../src/canvas/artboard.ts';
import type { Camera } from '../../src/canvas/renderer.ts';
import { rootToHostMatrix, type OverlayModel } from '../../src/interact/overlay-model.ts';
import { measureWith } from './fakes.ts';
import { layerRows } from '../../src/panels/layer-rows.ts';
import { rootTransform } from '../../../../engine/geometry/ctm.ts';
import { mapRect } from '../../../../engine/geometry/bounds.ts';
import { starPoints as starPointsOf } from '../../../../engine/generators/radial.ts';

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
  models: OverlayModel[];
  selected: ReadonlySet<number>[];
  focused: (FocusMark | null)[];
}

function rig(size = HOST, over: Partial<CanvasPort> = {}): Rig {
  const log: string[] = [];
  const listing = new Map<string, ViewBlock>();
  let order: string[] = [];
  const cameras: (Camera | null)[] = [];
  const outlines: NodeId[][] = [];
  const models: OverlayModel[] = [];
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
    measure: (ids) => measureWith(r.editor, ids, true), // as the browser does, defs content too
    ...over,
  };
  const r: Rig = {
    log, listing, cameras, outlines, models, selected, focused,
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
        place: (placements) => {
          log.push(`code place ${placements.flatMap((p) => p.blocks.map((b) => b.key)).join(' ')}`);
          for (const { blocks, before } of placements) {
            const keys = blocks.map((b) => b.key);
            order = order.filter((k) => !keys.includes(k));
            const at = before === null ? order.length : order.indexOf(before);
            order.splice(at === -1 ? order.length : at, 0, ...keys);
            for (const b of blocks) listing.set(b.key, b);
          }
        },
        remove: (keys) => {
          log.push(`code remove ${keys.join(' ')}`);
          order = order.filter((k) => !keys.includes(k));
          for (const k of keys) listing.delete(k);
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
      overlay: {
        show: (model) => {
          log.push('overlay');
          models.push(model);
          outlines.push(model.outlines.map((o) => o.id));
        },
      },
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

  // A structure change (Edit source) takes the old element away and places the new one alone, on
  // the canvas and then in the code: nothing else is drawn again or rebuilt, and the listing stays
  // the source.
  r.editor.select([poly.id]);
  r.editor.openSource();
  r.log.length = 0;
  assert.equal(r.editor.applySource(poly.id, '<circle r="3"/>'), null);
  const made = element(doc(r), (n) => n.local === 'circle' && attr(n, 'r') === '3');
  const parent = made.parent!;
  assert.deepEqual(r.log.slice(0, 4), [`canvas subtree ${poly.id}`, `canvas subtree ${made.id}`, `code remove ${poly.id}:start`, `code place ${made.id}:start`]);
  assert.deepEqual(r.log.slice(4).filter((l) => l.startsWith('canvas') || l.startsWith('code')), [`code patch ${parent}:start`, `code patch ${parent}:end`], 'then its parent’s tags are read again');
  assert.ok(r.log.indexOf('overlay') > r.log.indexOf(`code place ${made.id}:start`), 'the overlay after the code');
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

// ── P1-M1: the pointer (decision 7) ────────────────────────────────────────────────────────────

const SHAPES = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:draw="https://mmaggitti.github.io/draw/ns" viewBox="0 0 100 100">
  <rect id="a" x="10" y="10" width="10" height="10"/>
  <rect id="b" x="40" y="10" width="10" height="10"/>
  <g id="g"><circle id="c" cx="70" cy="70" r="5"/></g>
  <rect id="k" x="10" y="60" width="10" height="10" draw:locked="true"/>
  <line id="l" x1="10" y1="90" x2="90" y2="90" stroke="#000"/>
</svg>`;
const NO_SNAP = { grid: false, guides: false, shapes: false, artboard: false };
const idOf = (r: Rig, id: string): NodeId => element(doc(r), (n) => n.attrs.some((a) => a.local === 'id' && a.raw === id)).id;
/** Host px of a point in the root's user units (the fakes' camera: the root's box, M). */
function hostAt(r: Rig, x: number, y: number) {
  const { box, viewport, M } = r.editor.rootBox;
  const k = box!.width / viewport.width;
  return { x: box!.left + k * (M[0] * x + M[4]), y: box!.top + k * (M[3] * y + M[5]) };
}
const pxPerUnit = (r: Rig) => (r.editor.rootBox.box!.width / r.editor.rootBox.viewport.width) * r.editor.rootBox.M[0];
const sel = (r: Rig) => [...r.editor.selection.get()].sort();
function tap(r: Rig, at: { x: number; y: number }, hits: NodeId[], add = false) {
  r.editor.pointerDown(at, hits, { add });
  r.editor.pointerUp(at);
}
function drag(r: Rig, from: { x: number; y: number }, to: { x: number; y: number }, hits: NodeId[], opts: { held?: boolean; add?: boolean; frames?: number } = {}) {
  r.editor.pointerDown(from, hits, { add: !!opts.add });
  const n = opts.frames ?? 4;
  for (let i = 1; i <= n; i++) r.editor.pointerDrag({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n }, i === 1 && !!opts.held);
  r.editor.pointerUp(to);
}

test('a tap selects the shape itself; Select more or ⇧ toggles it; empty canvas clears (and Select more turns off)', () => {
  const r = rig();
  r.editor.open(SHAPES);
  const [a, b, c] = ['a', 'b', 'c'].map((id) => idOf(r, id));
  tap(r, hostAt(r, 15, 15), [a]);
  assert.deepEqual(sel(r), [a]);
  tap(r, hostAt(r, 70, 70), [c]);
  assert.deepEqual(sel(r), [c], 'the circle itself, not its group (decision 7)');
  tap(r, hostAt(r, 45, 15), [b], true);
  assert.deepEqual(sel(r), [b, c].sort(), '⇧ adds');
  tap(r, hostAt(r, 45, 15), [b], true);
  assert.deepEqual(sel(r), [c], '⇧ again takes it out');
  r.editor.selectMore.set(true);
  tap(r, hostAt(r, 15, 15), [a]);
  assert.deepEqual(sel(r), [a, c].sort(), 'Select more adds');
  tap(r, hostAt(r, 30, 45), []);
  assert.deepEqual(sel(r), [a, c].sort(), 'with Select more an empty tap does nothing');
  r.editor.selectMore.set(false);
  tap(r, hostAt(r, 30, 45), []);
  assert.deepEqual(sel(r), [], 'an empty tap clears');
  assert.equal(r.editor.source(), SHAPES, 'taps change nothing in the file');
  assert.equal(r.editor.history.get().canUndo, false);
});

test('a tap near a hairline takes it (22 px plus half its stroke); locked shapes are skipped', () => {
  const r = rig();
  r.editor.open(SHAPES);
  const near = hostAt(r, 50, 90);
  const reach = 22 + pxPerUnit(r) / 2; // 22 px and half its 1-unit stroke
  tap(r, { x: near.x, y: near.y - reach + 0.5 }, []);
  assert.deepEqual(sel(r), [idOf(r, 'l')], 'within 22 px and half its stroke of the line');
  r.editor.deselect(); // its own handles would take a tap this near (S3)
  tap(r, { x: near.x, y: near.y - reach - 0.5 }, []);
  assert.deepEqual(sel(r), [], 'beyond it, nothing');
  tap(r, hostAt(r, 15, 65), [idOf(r, 'k')]);
  assert.deepEqual(sel(r), [], 'a locked shape takes no tap: the canvas under it is empty');
});

test('a drag on an unselected shape selects and moves it, as one history entry, by whole units', () => {
  const r = rig();
  r.editor.open(SHAPES);
  r.editor.snap.set(NO_SNAP); // whole units alone (snapping to targets has its own tests)
  const a = idOf(r, 'a');
  const from = hostAt(r, 15, 15);
  const k = pxPerUnit(r);
  drag(r, from, { x: from.x + 7.4 * k, y: from.y - 3.6 * k }, [a]);
  assert.deepEqual(sel(r), [a], 'it is selected');
  assert.equal(r.editor.source(), SHAPES.replace('<rect id="a" x="10" y="10"', '<rect id="a" x="17" y="6"'), 'moved by the rounded delta, nothing else changed');
  assert.deepEqual(r.editor.history.get().undoLabel, 'Move');
  r.editor.undo();
  assert.equal(r.editor.source(), SHAPES, 'one undo restores the file byte for byte');
  assert.equal(r.editor.history.get().canUndo, false, 'one entry for the whole gesture');
});

test('a drag on a selected shape moves the whole selection; one inside a selected group moves the group', () => {
  const r = rig();
  r.editor.open(SHAPES);
  const [a, b, g, c] = ['a', 'b', 'g', 'c'].map((id) => idOf(r, id));
  r.editor.select([a, b]);
  const from = hostAt(r, 45, 15);
  const k = pxPerUnit(r);
  drag(r, from, { x: from.x + 5 * k, y: from.y + 5 * k }, [b]);
  assert.equal(r.editor.source(), SHAPES.replace('x="10" y="10"', 'x="15" y="15"').replace('x="40" y="10"', 'x="45" y="15"'));
  assert.deepEqual(sel(r), [a, b].sort());
  r.editor.select([g]);
  const at = hostAt(r, 70, 70);
  drag(r, at, { x: at.x + 2 * k, y: at.y }, [c]);
  assert.deepEqual(sel(r), [g], 'the group stays selected');
  assert.ok(r.editor.source().includes('<g id="g" transform="translate(2 0)">'), 'a group moves by translate');
});

test('an empty-canvas drag and a hold-drag draw a marquee that takes only what it wholly encloses', () => {
  const r = rig();
  r.editor.open(SHAPES);
  const [a, b] = ['a', 'b'].map((id) => idOf(r, id));
  drag(r, hostAt(r, 5, 5), hostAt(r, 25, 25), []);
  assert.deepEqual(sel(r), [a], 'A inside');
  drag(r, hostAt(r, 5, 5), hostAt(r, 45, 25), []);
  assert.deepEqual(sel(r), [a], 'B half inside is not taken');
  r.editor.select([]);
  drag(r, hostAt(r, 42, 12), hostAt(r, 55, 25), [b], { held: true });
  assert.deepEqual(sel(r), [], 'a hold-drag from B draws a marquee (B is not wholly inside it)');
  assert.equal(r.editor.source(), SHAPES, 'and moves nothing');
  drag(r, hostAt(r, 35, 5), hostAt(r, 55, 25), [b], { held: true });
  assert.deepEqual(sel(r), [b], 'one around B takes it');
  drag(r, hostAt(r, 5, 5), hostAt(r, 25, 25), [], { add: true });
  assert.deepEqual(sel(r), [a, b].sort(), 'with ⇧ a second marquee adds');
  drag(r, hostAt(r, 5, 55), hostAt(r, 25, 75), []);
  assert.deepEqual(sel(r), [], 'a locked shape is not taken');
  const at = hostAt(r, 30, 45);
  r.editor.pointerDown(at, [], { add: false });
  r.editor.pointerDrag({ x: at.x + 20, y: at.y + 3 });
  r.editor.pointerUp({ x: at.x + 20, y: at.y + 3 });
  assert.deepEqual(sel(r), [], 'a marquee under 5 px in either direction takes nothing');
  assert.equal(r.editor.history.get().canUndo, false, 'marquees are never history');
});

test('a cancelled move restores the file byte for byte and records nothing; a locked shape drags a marquee', () => {
  const r = rig();
  r.editor.open(SHAPES);
  const a = idOf(r, 'a');
  const from = hostAt(r, 15, 15);
  r.editor.pointerDown(from, [a], { add: false });
  r.editor.pointerDrag({ x: from.x + 30, y: from.y });
  r.editor.pointerDrag({ x: from.x + 60, y: from.y });
  assert.notEqual(r.editor.source(), SHAPES, 'test setup: it moved live');
  r.editor.pointerCancel();
  assert.equal(r.editor.source(), SHAPES);
  assert.equal(r.editor.history.get().canUndo, false);
  drag(r, hostAt(r, 15, 65), hostAt(r, 30, 80), [idOf(r, 'k')]);
  assert.equal(r.editor.source(), SHAPES, 'the locked shape did not move');
  drag(r, hostAt(r, 15, 65), hostAt(r, 30, 80), [idOf(r, 'k'), idOf(r, 'a')]);
  assert.equal(r.editor.source(), SHAPES, 'a drag from a locked shape is a marquee, even with a shape under it: that one did not move either');
  assert.deepEqual(sel(r), [], 'and the marquee took what it enclosed: nothing');
  r.editor.select([idOf(r, 'k')]);
  const k = hostAt(r, 15, 65);
  drag(r, k, { x: k.x + 30, y: k.y }, [idOf(r, 'k')]);
  assert.equal(r.editor.source(), SHAPES, 'selected from the code, it still refuses a move on the canvas');
});

// ── structure: Bring forward, Send back, Delete ────────────────────────────────────────────────

/** The ids of the root's element children, in order. */
const stack = (r: Rig) => (doc(r).nodes.get(doc(r).root) as ElementNode).children.map((c) => doc(r).nodes.get(c)!).filter((n): n is ElementNode => n.kind === 'element').map((n) => attr(n, 'id'));
const spaceBefore = (r: Rig, id: NodeId): NodeId => {
  const kids = (doc(r).nodes.get(doc(r).nodes.get(id)!.parent!) as ElementNode).children;
  return kids[kids.indexOf(id) - 1];
};

test('Bring forward and Send back swap each selected element, with its leading whitespace, past its next or previous element sibling; one entry each, patching only what moved', () => {
  const r = rig();
  r.editor.open(SHAPES);
  const a = idOf(r, 'a');
  const ws = spaceBefore(r, a);
  r.editor.select([a]);
  r.log.length = 0;
  r.editor.forward();
  assert.deepEqual(stack(r), ['b', 'a', 'g', 'k', 'l']);
  assert.equal(r.editor.source(), SHAPES.replace('  <rect id="a" x="10" y="10" width="10" height="10"/>\n  <rect id="b" x="40" y="10" width="10" height="10"/>', '  <rect id="b" x="40" y="10" width="10" height="10"/>\n  <rect id="a" x="10" y="10" width="10" height="10"/>'), 'its indentation moves with it');
  assert.equal(r.editor.history.get().undoLabel, 'Bring forward');
  assert.deepEqual(r.log.filter((l) => l.startsWith('canvas')), [`canvas subtree ${a}`, `canvas subtree ${ws}`], 'the canvas patches the element and its whitespace, last first');
  const places = r.log.filter((l) => l.startsWith('code place'));
  assert.ok(!r.log.includes('code set') && places.length === 1 && places[0].split(' ').includes(`${a}:start`), 'the code places its blocks, in one call; the listing is not rebuilt');
  assert.equal(r.log.filter((l) => l.startsWith('code remove')).length, 1, 'and takes the old ones away in one call');
  assert.equal(text(r), r.editor.source(), 'the code shows exactly the document');
  assert.deepEqual(sel(r), [a], 'it stays selected');
  r.editor.undo();
  assert.equal(r.editor.source(), SHAPES, 'one undo restores the file byte for byte');
  assert.equal(text(r), SHAPES);

  // Several keep their order among themselves; one already last (first) stays.
  r.editor.select([idOf(r, 'a'), idOf(r, 'b')]);
  r.editor.forward();
  assert.deepEqual(stack(r), ['g', 'a', 'b', 'k', 'l']);
  r.editor.forward();
  r.editor.forward();
  assert.deepEqual(stack(r), ['g', 'k', 'l', 'a', 'b']);
  const entries = () => r.editor.history.get().undoLabel;
  const before = r.editor.source();
  r.editor.undo();
  r.editor.redo();
  r.editor.forward();
  assert.equal(r.editor.source(), before, 'already last: nothing moves');
  r.editor.undo();
  assert.deepEqual(stack(r), ['g', 'k', 'a', 'b', 'l'], 'and nothing was recorded (undo goes back one real move)');
  r.editor.redo();
  r.editor.back();
  assert.deepEqual(stack(r), ['g', 'k', 'a', 'b', 'l']);
  assert.equal(entries(), 'Send back');
  assert.equal(text(r), r.editor.source());

  // Back: before the previous element and its whitespace. At the front, nothing to do.
  const r2 = rig();
  r2.editor.open(SHAPES);
  r2.editor.select([idOf(r2, 'b')]);
  r2.editor.back();
  assert.equal(r2.editor.source(), SHAPES.replace('  <rect id="a" x="10" y="10" width="10" height="10"/>\n  <rect id="b" x="40" y="10" width="10" height="10"/>', '  <rect id="b" x="40" y="10" width="10" height="10"/>\n  <rect id="a" x="10" y="10" width="10" height="10"/>'));
  r2.editor.back();
  assert.deepEqual(stack(r2), ['b', 'a', 'g', 'k', 'l']);
  r2.editor.undo();
  assert.equal(r2.editor.source(), SHAPES, 'the second Back recorded nothing');
  assert.equal(r2.editor.history.get().canUndo, false);
  assert.equal(text(r2), SHAPES);

  // Inside a group: past its siblings only. The root, and a locked element, are refused.
  r2.editor.select([doc(r2).root]);
  r2.editor.forward();
  r2.editor.back();
  assert.equal(r2.editor.source(), SHAPES, 'the root has no siblings to pass');
  r2.editor.select([idOf(r2, 'k')]);
  r2.editor.forward();
  assert.equal(r2.editor.notice.get(), LOCKED);
  assert.equal(r2.editor.source(), SHAPES);
  assert.equal(r2.editor.history.get().canUndo, false);
});

test('Delete takes the selection away with its leading whitespace, in one entry; the root and locked elements are refused', () => {
  const r = rig();
  r.editor.open(SHAPES);
  const [a, g, c] = ['a', 'g', 'c'].map((id) => idOf(r, id));
  const ws = spaceBefore(r, a);
  r.editor.select([a, c]);
  r.log.length = 0;
  r.editor.delete();
  assert.equal(r.editor.source(), SHAPES.replace('\n  <rect id="a" x="10" y="10" width="10" height="10"/>', '').replace('<circle id="c" cx="70" cy="70" r="5"/>', ''));
  assert.deepEqual(stack(r), ['b', 'g', 'k', 'l']);
  assert.equal(r.editor.history.get().undoLabel, 'Delete');
  assert.deepEqual(sel(r), [], 'nothing is selected');
  assert.deepEqual(r.log.filter((l) => l.startsWith('canvas')).sort(), [`canvas subtree ${a}`, `canvas subtree ${c}`, `canvas subtree ${ws}`].sort(), 'the canvas takes away only what was deleted');
  assert.ok(!r.log.includes('code set'), 'the listing is not rebuilt');
  assert.equal(text(r), r.editor.source());
  r.editor.undo();
  assert.equal(r.editor.source(), SHAPES, 'one undo restores the file byte for byte');
  assert.equal(text(r), SHAPES);

  // A group and something inside it: the group goes, with everything in it.
  r.editor.select([g, c]);
  r.editor.delete();
  assert.deepEqual(stack(r), ['a', 'b', 'k', 'l']);
  r.editor.undo();

  // The root, and a locked element, are refused and say why; nothing changes.
  r.editor.select([doc(r).root]);
  r.editor.delete();
  assert.equal(r.editor.notice.get(), 'The root <svg> can’t be deleted.');
  r.editor.select([idOf(r, 'b'), idOf(r, 'k')]);
  r.editor.delete();
  assert.equal(r.editor.notice.get(), LOCKED);
  assert.equal(r.editor.source(), SHAPES);
  assert.equal(r.editor.history.get().canUndo, false, 'the refusals recorded nothing');
  assert.equal(r.editor.history.get().redoLabel, 'Delete', 'and left the undone Delete to redo');
});

test('a move snaps to a target within 8 px of the moving box’s edges or centre, and not beyond; a snap line marks it', () => {
  const r = rig();
  r.editor.open(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="a" x="10" y="10" width="10" height="10"/><rect id="b" x="60" y="70" width="10" height="10"/></svg>`);
  r.editor.snap.set({ grid: false, guides: false, shapes: true, artboard: false });
  const k = pxPerUnit(r);
  const a = idOf(r, 'a');
  const from = hostAt(r, 15, 15);
  const src = () => r.editor.source();
  // A's left edge (10) toward B's (60): 50 units less 7 px lands on 60; less 9 px, whole units.
  drag(r, from, { x: from.x + 50 * k - 7, y: from.y }, [a]);
  assert.ok(src().includes('<rect id="a" x="60" y="10"'), `7 px away it snaps: ${src()}`);
  r.editor.undo();
  r.editor.select([]);
  r.editor.pointerDown(from, [a], { add: false });
  r.editor.pointerDrag({ x: from.x + 50 * k - 9, y: from.y });
  assert.equal(r.models.at(-1)?.snapLines.length, 0, 'no snap line 9 px away');
  r.editor.pointerUp({ x: from.x + 50 * k - 9, y: from.y });
  assert.ok(src().includes(`<rect id="a" x="${10 + Math.round(50 - 9 / k)}" y="10"`), `9 px away it moves by whole units: ${src()}`);
  r.editor.undo();
  r.editor.select([]);
  r.editor.pointerDown(from, [a], { add: false });
  r.editor.pointerDrag({ x: from.x + 50 * k - 7, y: from.y });
  assert.equal(r.models.at(-1)?.snapLines.length, 1, 'a snap line while snapped');
  r.editor.pointerCancel();
});

// ── S4: Duplicate, Group, Ungroup, Select group ────────────────────────────────────────────────

const BADGE = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:draw="https://mmaggitti.github.io/draw/ns" viewBox="0 0 100 100">
  <defs><linearGradient id="grad"><stop offset="0" stop-color="#000"/></linearGradient></defs>
  <g id="badge">
    <clipPath id="clip"><circle cx="20" cy="20" r="10"/></clipPath>
    <rect id="face" x="10" y="10" width="20" height="20" clip-path="url(#clip)" style="fill:url(#grad)" draw:locked="true"/>
  </g>
</svg>`;

test('Duplicate: the copy follows its original with its whitespace, fresh ids and its own references, no lock, 5 units right and down; one entry', () => {
  const r = rig();
  r.editor.open(BADGE);
  const badge = idOf(r, 'badge');
  r.editor.select([badge]);
  r.editor.duplicate();
  const src = r.editor.source();
  const copy = `\n  <g id="badge-2" transform="translate(5 5)">
    <clipPath id="clip-2"><circle cx="20" cy="20" r="10"/></clipPath>
    <rect id="face-2" x="10" y="10" width="20" height="20" clip-path="url(#clip-2)" style="fill:url(#grad)"/>
  </g>`;
  assert.equal(src, BADGE.replace('\n  </g>\n', `\n  </g>${copy}\n`), 'the original’s bytes unchanged, the copy after it');
  assert.deepEqual(sel(r), [idOf(r, 'badge-2')], 'the copy is selected');
  assert.equal(r.editor.history.get().undoLabel, 'Duplicate');
  assert.equal(text(r), src, 'the code shows exactly the document');
  r.editor.undo();
  assert.equal(r.editor.source(), BADGE, 'one undo gives the file back');
  assert.equal(text(r), BADGE);
});

test('Group puts the selection in a new <g> where the last one was; Ungroup pushes the group’s transform down and refuses what would change the drawing; Select group climbs one level', () => {
  const r = rig();
  const THREE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect id="a" x="10" y="10" width="10" height="10"/>
  <rect id="b" x="40" y="10" width="10" height="10"/>
  <circle id="c" cx="70" cy="70" r="5"/>
</svg>`;
  r.editor.open(THREE);
  r.editor.select([idOf(r, 'a'), idOf(r, 'c')]);
  r.editor.group();
  assert.equal(r.editor.source(), THREE.replace('\n  <rect id="a" x="10" y="10" width="10" height="10"/>', '').replace('<circle id="c" cx="70" cy="70" r="5"/>', '<g>\n  <rect id="a" x="10" y="10" width="10" height="10"/>\n  <circle id="c" cx="70" cy="70" r="5"/>\n  </g>'));
  assert.equal(r.editor.history.get().undoLabel, 'Group');
  const g = [...r.editor.selection.get()][0];
  assert.equal((doc(r).nodes.get(g) as ElementNode).local, 'g', 'the group is selected');
  assert.equal(text(r), r.editor.source());
  r.editor.select([idOf(r, 'a')]);
  r.editor.selectGroup();
  assert.deepEqual(sel(r), [g], 'Select group climbs to the group');
  r.editor.undo();
  assert.equal(r.editor.source(), THREE);
  // Across parents: refused.
  const r2 = rig();
  r2.editor.open(SHAPES);
  r2.editor.select([idOf(r2, 'a'), idOf(r2, 'c')]);
  r2.editor.group();
  assert.equal(r2.editor.notice.get(), 'Group needs shapes with the same parent.');
  assert.equal(r2.editor.source(), SHAPES);
  // Ungroup: the transform goes down to each child.
  const G = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g transform="translate(10 5) rotate(15)">
    <rect x="1" y="2" width="3" height="4"/>
    <circle cx="5" cy="5" r="2" transform="scale(2)"/>
  </g>
</svg>`;
  const r3 = rig();
  r3.editor.open(G);
  const grp = element(doc(r3), (n) => n.local === 'g');
  r3.editor.select([grp.id]);
  r3.editor.ungroup();
  assert.equal(r3.editor.source(), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect x="1" y="2" width="3" height="4" transform="translate(10 5) rotate(15)"/>
    <circle cx="5" cy="5" r="2" transform="translate(10 5) rotate(15) scale(2)"/>
  \n</svg>`, 'the children keep their bytes and whitespace (the group’s last line break stays); the group and its own whitespace go');
  assert.equal(r3.editor.history.get().undoLabel, 'Ungroup');
  assert.equal(r3.editor.selection.get().size, 2, 'the former children are selected');
  r3.editor.undo();
  assert.equal(r3.editor.source(), G);
  const r4 = rig();
  r4.editor.open(G.replace('<g transform', '<g opacity="0.5" transform'));
  r4.editor.select([element(doc(r4), (n) => n.local === 'g').id]);
  r4.editor.ungroup();
  assert.equal(r4.editor.notice.get(), 'It has opacity, which applies to the group as a whole; ungrouping would change how it looks.');
  assert.equal(r4.editor.history.get().canUndo, false);
});

test('Group refuses to nest a shape past the depth the parser opens, and every file it writes re-parses; Duplicate and Ungroup never nest deeper', () => {
  const reparses = (r: Rig, why: string) => {
    const back = parseDoc(r.editor.source());
    assert.ok(back.ok, `${why}: the file no longer parses (${back.ok ? '' : back.error.message})`);
  };
  const DEEP = (leaf: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${'<g>'.repeat(254)}${leaf}${'</g>'.repeat(254)}</svg>`;
  // A shape with an end tag at depth 256, the most the parser opens: one Group more is refused.
  const r = rig();
  const deep = DEEP('<rect id="d" x="10" y="10" width="10" height="10"></rect>');
  assert.ok(r.editor.open(deep).ok);
  r.editor.select([idOf(r, 'd')]);
  r.editor.group();
  assert.equal(r.editor.notice.get(), 'Grouping would nest it deeper than 256 levels.');
  assert.equal(r.editor.source(), deep, 'nothing was written');
  assert.equal(r.editor.history.get().canUndo, false);
  // Duplicate puts the copy beside it, at its own depth; Ungroup lifts children a level.
  r.editor.duplicate();
  assert.equal(r.editor.history.get().undoLabel, 'Duplicate');
  reparses(r, 'Duplicate at the limit');
  r.editor.undo();
  r.editor.select([doc(r).nodes.get(idOf(r, 'd'))!.parent!]);
  r.editor.ungroup();
  assert.equal(r.editor.history.get().undoLabel, 'Ungroup');
  reparses(r, 'Ungroup at the limit');
  // A shape that closes itself takes no level of its own: the group may go at 256.
  const r2 = rig();
  assert.ok(r2.editor.open(DEEP('<rect id="d" x="10" y="10" width="10" height="10"/>')).ok);
  r2.editor.select([idOf(r2, 'd')]);
  r2.editor.group();
  assert.equal(r2.editor.history.get().undoLabel, 'Group', `${r2.editor.notice.get()}`);
  reparses(r2, 'a group at 256 around a <rect/>');
  // Group after Group (each new group is selected, so the next wraps it) until it is refused.
  const r3 = rig();
  r3.editor.open(SHAPES);
  r3.editor.select([idOf(r3, 'a')]);
  let groups = 0;
  for (; groups < 300; groups++) {
    const before = r3.editor.source();
    r3.editor.group();
    if (r3.editor.source() === before) break;
    reparses(r3, `Group ${groups + 1}`);
  }
  assert.equal(r3.editor.notice.get(), 'Grouping would nest it deeper than 256 levels.', `refused after ${groups} groups`);
  assert.equal(groups, 255, 'the rect closes itself: 255 groups around it (the last at depth 256), then a refusal');
});

test('Ungroup gives the group’s transform only to the children drawn where they sit: a clip, defs and a gradient move out as they are (what uses them carries it); a group with a <title> or <desc> is refused', () => {
  const CLIPPED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g id="g" transform="translate(30 20)">
    <clipPath id="c"><circle cx="20" cy="20" r="15"/></clipPath>
    <defs><linearGradient id="lg"><stop offset="0" stop-color="#e76f51"/></linearGradient></defs>
    <rect id="r" width="40" height="40" fill="url(#lg)" clip-path="url(#c)"/>
    <circle id="d" cx="5" cy="5" r="2" transform="scale(2)"/>
  </g>
</svg>`;
  const r = rig();
  r.editor.open(CLIPPED);
  r.editor.select([idOf(r, 'g')]);
  r.editor.ungroup();
  assert.equal(r.editor.history.get().undoLabel, 'Ungroup', `${r.editor.notice.get()}`);
  assert.equal(r.editor.source(), CLIPPED
    .replace('\n  <g id="g" transform="translate(30 20)">', '')
    .replace('\n  </g>', '\n  ')
    .replace('clip-path="url(#c)"/>', 'clip-path="url(#c)" transform="translate(30 20)"/>')
    .replace('transform="scale(2)"', 'transform="translate(30 20) scale(2)"'), 'the shapes take the transform; the clip, defs and gradient keep their bytes');
  r.editor.undo();
  assert.equal(r.editor.source(), CLIPPED);
  for (const [child, why] of [['<title>The sun</title>', 'Its title names the group; ungrouping would give it to the parent.'], ['<desc>A setting sun</desc>', 'Its desc describes the group; ungrouping would give it to the parent.']]) {
    const named = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="g" transform="translate(1 2)">${child}<rect width="5" height="5"/></g></svg>`;
    const n = rig();
    n.editor.open(named);
    n.editor.select([idOf(n, 'g')]);
    n.editor.ungroup();
    assert.equal(n.editor.notice.get(), why);
    assert.equal(n.editor.source(), named, 'nothing was written');
    assert.equal(n.editor.history.get().canUndo, false);
  }
});

test('Ungroup is refused, with the reason, when the group holds an animation that animates it (one with no href, which animates its parent, or one whose href names the group); one naming another element moves out as it is', () => {
  const WHY = 'It holds an animation that targets the group; ungrouping would retarget it.';
  for (const anim of [
    '<animate attributeName="opacity" to="0" dur="1s"/>',
    '<set attributeName="opacity" to="0" begin="1s"/>',
    '<animateTransform attributeName="transform" type="rotate" to="30" dur="1s"/>',
    '<animateMotion path="M0 0h10" dur="1s"/>',
    '<discard begin="2s"/>',
    '<animate href="#g" attributeName="opacity" to="0" dur="1s"/>',
    '<animate xlink:href="#g" attributeName="opacity" to="0" dur="1s"/>',
  ]) {
    const file = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"><g id="g" transform="translate(1 2)"><rect width="5" height="5"/>${anim}</g></svg>`;
    const r = rig();
    r.editor.open(file);
    r.editor.select([idOf(r, 'g')]);
    r.editor.ungroup();
    assert.equal(r.editor.notice.get(), WHY, anim);
    assert.equal(r.editor.source(), file, `${anim}: nothing was written`);
    assert.equal(r.editor.history.get().canUndo, false, anim);
  }
  // An animation whose href names another element animates it wherever it sits: it moves out as it is.
  const other = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="k" width="5" height="5"/><g id="g" transform="translate(1 2)"><circle r="2"/><animate href="#k" attributeName="x" to="9" dur="1s"/></g></svg>';
  const o = rig();
  o.editor.open(other);
  o.editor.select([idOf(o, 'g')]);
  o.editor.ungroup();
  assert.equal(o.editor.history.get().undoLabel, 'Ungroup', `${o.editor.notice.get()}`);
  assert.equal(o.editor.source(), other.replace('<g id="g" transform="translate(1 2)">', '').replace('</g>', '').replace('<circle r="2"/>', '<circle r="2" transform="translate(1 2)"/>'));
});

test('Ungroup is refused, with the reason, when a use, an href or a url(#…) refers to a child that takes the group’s transform (the child itself); a reference to a shape inside one (Illustrator’s clipPath and use, defined and used in a nested group) ungroups with every screen box in place; not refused when the group has no transform, when what is referred to moves out as it is, or for an ARIA reference', () => {
  const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">${body}</svg>`;
  const refused: [string, string][] = [
    [svg('<g id="g" transform="translate(5 5)"><rect id="k" width="5" height="5"/></g><use href="#k" x="20"/>'), 'k'], // a use elsewhere
    [svg('<g id="g" transform="translate(5 5)"><rect id="k" width="5" height="5"/><use xlink:href="#k" x="20"/></g>'), 'k'], // a use beside it, by xlink:href
    [svg('<g id="g" transform="translate(5 5)"><path id="p" d="M0 0h50"/></g><text><textPath href="#p">on a path</textPath></text>'), 'p'], // a textPath: the path's own transform counts
  ];
  for (const [file, id] of refused) {
    const r = rig();
    r.editor.open(file);
    r.editor.select([idOf(r, 'g')]);
    r.editor.ungroup();
    assert.equal(r.editor.notice.get(), `Something refers to a shape inside it (#${id}); ungrouping would move that reference’s copy too.`, file);
    assert.equal(r.editor.source(), file, `${file}: nothing was written`);
    assert.equal(r.editor.history.get().canUndo, false, file);
  }
  // Every drawn element's screen quad (a clip's or defs' content draws where it is referred to, so it isn't one).
  const quads = (r: Rig): Map<NodeId, number[]> => {
    const d = doc(r);
    const ids = [...descendants(d, d.root)].filter((n) => n.kind === 'element' && n.id !== d.root).map((n) => n.id);
    return new Map([...measureWith(r.editor, ids)].map(([id, m]) => {
      const { x, y, width: w, height: h } = m.box;
      const t = m.toHost;
      return [id, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].flatMap(([px, py]) => [t[0] * px + t[2] * py + t[4], t[1] * px + t[3] * py + t[5]])];
    }));
  };
  const ILLUSTRATOR = svg(`
  <g id="g" transform="translate(10 5) rotate(15)">
    <g>
      <defs><rect id="SVGID_1_" x="0" y="0" width="40" height="30"/></defs>
      <clipPath id="SVGID_2_"><use xlink:href="#SVGID_1_" style="overflow:visible;"/></clipPath>
      <rect x="5" y="5" width="50" height="50" clip-path="url(#SVGID_2_)" fill="#e76f51"/>
      <use href="#dot" x="8" y="4"/>
      <circle id="dot" cx="10" cy="10" r="3"/>
    </g>
  </g>`);
  for (const file of [
    ILLUSTRATOR,
    svg('<g id="g" transform="translate(5 5)"><g><path id="p" d="M0 0h50"/></g></g><text><textPath href="#p">on a path</textPath></text>'), // inside a child: its own transform is what counts
    svg('<g id="g" transform="translate(5 5)"><g><linearGradient id="lg"><stop offset="0"/></linearGradient><rect width="5" height="5"/></g></g><rect width="5" height="5" fill="url(#lg)"/>'), // a url(#…) into a child: used where it is referred to
    svg('<g id="g"><rect id="k" width="5" height="5"/></g><use href="#k" x="20"/>'), // no transform: nothing is pushed
    svg('<g id="g" transform="translate(5 5)"><clipPath id="c"><circle r="3"/></clipPath><rect width="5" height="5" clip-path="url(#c)"/></g>'), // the clip moves out as it is
    svg('<g id="g" transform="translate(5 5)"><rect id="k" width="5" height="5"/></g><text aria-labelledby="k">x</text>'), // an ARIA reference draws nothing
  ]) {
    const r = rig();
    r.editor.open(file);
    const before = quads(r);
    r.editor.select([idOf(r, 'g')]);
    r.editor.ungroup();
    assert.equal(r.editor.history.get().undoLabel, 'Ungroup', `${file}: ${r.editor.notice.get()}`);
    const after = quads(r);
    assert.ok(after.size >= before.size - 1 && after.size > 0, `${file}: test setup: ${after.size} measured after, ${before.size} before`);
    for (const [id, q] of after) {
      const was = before.get(id);
      assert.ok(was && q.every((v, i) => Math.abs(v - was[i]) < 1e-6), `${file}: <${(doc(r).nodes.get(id) as ElementNode).qname}> moved on screen: ${was} → ${q}`);
    }
    r.editor.undo();
    assert.equal(r.editor.source(), file, `${file}: one undo gives the file back`);
  }
});

test('Ungroup is refused, with the reason, when an animateTransform sets the transform of a child that would take the group’s (one inside the child, or one whose href names it); not for one that animates another attribute, names another element, or a group with no transform', () => {
  const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">${body}</svg>`;
  const spin = (extra = '') => `<animateTransform${extra} attributeName="transform" type="rotate" from="0 5 5" to="360 5 5" dur="2s"/>`;
  for (const [file, name] of [
    [svg(`<g id="g" transform="translate(5 5)"><rect id="k" width="10" height="10">${spin()}</rect></g>`), '#k'], // inside the child
    [svg(`<g id="g" transform="translate(5 5)"><rect width="10" height="10">${spin()}</rect></g>`), '<rect>'], // one with no id is named by its tag
    [svg(`<g id="g" transform="translate(5 5)"><rect id="k" width="10" height="10"/></g>${spin(' href="#k"')}`), '#k'], // elsewhere, by href
    [svg(`<g id="g" transform="translate(5 5)"><circle id="k" r="4"/>${spin(' xlink:href="#k"')}</g>`), '#k'], // beside it, by xlink:href
  ]) {
    const r = rig();
    r.editor.open(file);
    r.editor.select([idOf(r, 'g')]);
    r.editor.ungroup();
    assert.equal(r.editor.notice.get(), `An animation on ${name} sets its transform; ungrouping can’t push the group’s into it.`, file);
    assert.equal(r.editor.source(), file, `${file}: nothing was written`);
    assert.equal(r.editor.history.get().canUndo, false, file);
  }
  for (const file of [
    svg('<g id="g" transform="translate(5 5)"><rect id="k" width="10" height="10"><animate attributeName="x" to="9" dur="1s"/></rect></g>'), // another attribute
    svg('<g id="g" transform="translate(5 5)"><rect id="k" width="10" height="10"><animateTransform attributeName="gradientTransform" type="rotate" to="30" dur="1s"/></rect></g>'), // not its transform
    svg(`<rect id="o" width="4" height="4"/><g id="g" transform="translate(5 5)"><rect id="k" width="10" height="10">${spin(' href="#o"')}</rect></g>`), // it names another element
    svg(`<g id="g"><rect id="k" width="10" height="10">${spin()}</rect></g>`), // no transform to push
  ]) {
    const r = rig();
    r.editor.open(file);
    r.editor.select([idOf(r, 'g')]);
    r.editor.ungroup();
    assert.equal(r.editor.history.get().undoLabel, 'Ungroup', `${file}: ${r.editor.notice.get()}`);
  }
});

test('Layers: Hide writes display="none" and Show gives the bytes back; Lock writes draw:locked with the declaration and Unlock gives the bytes back; Rename rewrites every reference, and refuses a bad or taken id', () => {
  const F = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <circle id="c" cx="20" cy="20" r="5"/>\n  <use href="#c" x="10"/>\n  <rect id="r" x="1" y="1" width="5" height="5" fill="url(#c)"/>\n</svg>`;
  const r = rig();
  r.editor.open(F);
  const [c, rect] = [idOf(r, 'c'), idOf(r, 'r')];
  r.editor.setHidden(c, true);
  assert.equal(r.editor.source(), F.replace('r="5"/>', 'r="5" display="none"/>'), 'Hide: exactly display="none"');
  assert.equal(r.editor.history.get().undoLabel, 'Hide');
  r.editor.setHidden(c, false);
  assert.equal(r.editor.source(), F, 'Show: the file back');
  r.editor.setLocked(rect, true);
  assert.equal(r.editor.source(), F.replace('viewBox="0 0 100 100">', 'viewBox="0 0 100 100" xmlns:draw="https://mmaggitti.github.io/draw/ns">').replace('fill="url(#c)"/>', 'fill="url(#c)" draw:locked="true"/>'));
  assert.equal(r.editor.history.get().undoLabel, 'Lock');
  r.editor.setLocked(rect, false);
  assert.equal(r.editor.source(), F, 'Unlock: the file back, the declaration gone with the last Draw item');
  assert.equal(r.editor.rename(c, 'sun'), null);
  assert.equal(r.editor.source(), F.replace('id="c"', 'id="sun"').replace('href="#c"', 'href="#sun"').replace('url(#c)', 'url(#sun)'), 'every reference follows');
  assert.equal(r.editor.history.get().undoLabel, 'Rename');
  assert.equal(r.editor.rename(rect, '1bad'), '"1bad" is not an id');
  assert.equal(r.editor.rename(rect, 'sun'), 'Another element already has the id "sun".');
  assert.equal(r.editor.history.get().undoLabel, 'Rename', 'the refusals recorded nothing');
});

test('Rename refuses a name XML can’t hold as an id, an id two elements share and an id a <style> rule names; every ARIA id reference follows it, and every file it writes re-parses', () => {
  const S = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
  const renamed = (text: string, to: string, nth = 0) => {
    const r = rig();
    assert.ok(r.editor.open(text).ok);
    const e = [...descendants(doc(r), doc(r).root)].filter((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === 'c'))[nth];
    const why = r.editor.rename(e.id, to);
    const back = parseDoc(r.editor.source());
    assert.ok(back.ok, `rename to ${JSON.stringify(to)}: the file no longer parses (${back.ok ? '' : back.error.message})`);
    return { why, source: r.editor.source(), entries: r.editor.history.get().canUndo };
  };
  const one = S('<rect id="c" width="5" height="5"/>');
  // Characters XML can't hold anywhere (U+FFFE, U+FFFF, lone surrogates): refused, nothing written.
  for (const [to, code] of [['a\uFFFE', 'FFFE'], ['a\uFFFF', 'FFFF'], ['a\uD800', 'D800'], ['b\uDFFF', 'DFFF']]) {
    const r = renamed(one, to);
    assert.equal(r.why, `XML can't hold the character U+${code}`, JSON.stringify(to));
    assert.equal(r.source, one);
    assert.equal(r.entries, false);
  }
  // Names the lexer reads are fine, astral ones included; a colon or a leading digit is not a name.
  for (const to of ['é', 'a·b', '\u{1F600}', 'a\uFDD0']) assert.equal(renamed(one, to).why, null, JSON.stringify(to));
  for (const to of ['x:y', '1abc', 'a b', '']) assert.equal(renamed(one, to).why, `${JSON.stringify(to)} is not an id`);
  // Two elements share the id: which one a reference means is the file's to settle.
  const twice = S('<rect id="c" width="5" height="5"/><circle id="c" r="3"/><use href="#c"/>');
  for (const nth of [0, 1]) {
    const r = renamed(twice, 'sun', nth);
    assert.equal(r.why, 'Another element has this id; fix the duplicate in the code first.');
    assert.equal(r.source, twice);
  }
  // A <style> rule names it (by #c, escaped, or url(#c)): renaming would change how it looks.
  for (const css of ['#c { fill: red }', '.x { fill: url(#c) }', '#\\63 { fill: red }', 'rect#c, g { fill: red }']) {
    const text = S(`<style>${css}</style><rect id="c" width="5" height="5"/>`);
    const r = renamed(text, 'sun');
    assert.equal(r.why, 'A <style> rule uses #c; rename it in the code.', css);
    assert.equal(r.source, text);
  }
  assert.equal(renamed(S('<style>#cc { fill: red } /* #c */</style><rect id="c" width="5" height="5"/>'), 'sun').why, null, 'another id, and a comment, are not a rule for #c');
  // Every ARIA attribute that holds ids follows; a reference into another file doesn't.
  const aria = ['aria-activedescendant', 'aria-controls', 'aria-describedby', 'aria-details', 'aria-errormessage', 'aria-flowto', 'aria-labelledby', 'aria-owns'];
  const r = renamed(S(`<rect id="c" width="5" height="5"/><g ${aria.map((a) => `${a}="c t"`).join(' ')}/><use href="other.svg#c"/>`), 'sun');
  assert.equal(r.why, null);
  assert.equal(r.source, S(`<rect id="sun" width="5" height="5"/><g ${aria.map((a) => `${a}="sun t"`).join(' ')}/><use href="other.svg#c"/>`));
});

test('a lock on the root is not Draw’s: its shapes can still be tapped, dragged and taken by a marquee; a shape in a locked group reads locked in Layers, naming the group', () => {
  const ROOT_LOCKED = SHAPES.replace('viewBox="0 0 100 100">', 'viewBox="0 0 100 100" draw:locked="true">');
  const r = rig();
  r.editor.open(ROOT_LOCKED);
  r.editor.snap.set(NO_SNAP);
  const a = idOf(r, 'a');
  tap(r, hostAt(r, 15, 15), [a]);
  assert.deepEqual(sel(r), [a], 'a tap takes the shape');
  drag(r, hostAt(r, 15, 15), hostAt(r, 18, 15), [a]);
  assert.equal(r.editor.history.get().undoLabel, 'Move', `a drag moves it (${r.editor.notice.get()})`);
  r.editor.undo();
  drag(r, hostAt(r, 5, 5), hostAt(r, 25, 25), []);
  assert.deepEqual(sel(r), [a], 'a marquee takes it');
  // A locked group: the shapes in it are locked by it, and Layers says so.
  const GROUP_LOCKED = SHAPES.replace('<g id="g">', '<g id="g" draw:locked="true">');
  const g = rig();
  g.editor.open(GROUP_LOCKED);
  const rows = new Map(layerRows(doc(g)).map((row) => [row.name, row]));
  assert.deepEqual([rows.get('#g')!.locked, rows.get('#g')!.lockedBy], [true, null], 'the group holds its own lock');
  assert.deepEqual([rows.get('#c')!.locked, rows.get('#c')!.lockedBy], [false, '#g'], 'the circle in it reads locked, by the group');
  assert.deepEqual([rows.get('#a')!.locked, rows.get('#a')!.lockedBy], [false, null], 'a shape outside it is free');
  assert.deepEqual([rows.get('#k')!.locked, rows.get('#k')!.lockedBy], [true, null]);
  tap(g, hostAt(g, 70, 70), [idOf(g, 'c')]);
  assert.deepEqual(sel(g), [], 'and a tap passes it by');
  assert.deepEqual(layerRows(doc(r)).map((row) => row.lockedBy).filter(Boolean), [], 'the root’s lock locks no row');
});

test('an edit from a panel during a handle or guide drag is refused quietly, and the drag carries on to one entry', () => {
  const r = rig();
  r.editor.open(SHAPES);
  const [a, b] = ['a', 'b'].map((id) => idOf(r, id));
  r.editor.select([a]);
  const corner = r.editor.overlayModel().handles.find((h) => h.kind === 'anchor')!;
  r.editor.pointerDown(corner.at, [a], { add: false });
  r.editor.pointerDrag({ x: corner.at.x + 20, y: corner.at.y + 20 });
  const panel = () => {
    r.editor.setHidden(b, true);
    r.editor.setLocked(b, true);
    r.editor.addGuide('v');
    r.editor.setGridStep(5);
  };
  assert.doesNotThrow(panel, 'Hide, Lock, a guide and the grid step during a handle drag');
  r.editor.pointerUp({ x: corner.at.x + 20, y: corner.at.y + 20 });
  assert.equal(r.editor.history.get().undoLabel, 'Resize');
  r.editor.undo();
  assert.equal(r.editor.source(), SHAPES, 'the resize was the only entry; nothing else was written');
  // A guide's pill drag likewise.
  r.editor.addGuide('v');
  const withGuide = r.editor.source();
  const pill = r.editor.overlayModel().guides[0].pill;
  r.editor.pointerDown(pill, [], { add: false });
  r.editor.pointerDrag({ x: pill.x + 30, y: pill.y + 5 });
  assert.doesNotThrow(panel, 'the same during a guide drag');
  r.editor.pointerUp({ x: pill.x + 30, y: pill.y + 5 });
  assert.equal(r.editor.history.get().undoLabel, 'Move guide');
  r.editor.undo();
  assert.equal(r.editor.source(), withGuide);
});

test('a corner drag gathers its snap targets once, when it starts, not on every frame', () => {
  const measured: NodeId[][] = [];
  const r = rig(HOST, { measure: (ids) => (measured.push([...ids]), measureWith(r.editor, ids, true)) });
  r.editor.open(SHAPES);
  const [a, b] = ['a', 'b'].map((id) => idOf(r, id));
  r.editor.select([a]);
  const corner = r.editor.overlayModel().handles.find((h) => h.kind === 'anchor')!;
  measured.length = 0;
  r.editor.pointerDown(corner.at, [a], { add: false });
  for (let i = 1; i <= 6; i++) r.editor.pointerDrag({ x: corner.at.x + 3 * i, y: corner.at.y + 2 * i });
  r.editor.pointerUp({ x: corner.at.x + 18, y: corner.at.y + 12 });
  assert.equal(r.editor.history.get().undoLabel, 'Resize');
  // Only the snap targets measure the other shapes (the overlay measures the selection).
  const gathers = measured.filter((ids) => ids.includes(b)).length;
  assert.ok(gathers > 0 && gathers <= 2, `the other shapes were measured ${gathers} times in a 6-frame drag`);
});

test('on a mirrored element the scale diamond keeps the mirror, and the ring turns the shape the way the finger turns', () => {
  const open = (t: string) => {
    const r = rig();
    r.editor.open(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <g id="g" transform="${t}"><rect x="30" y="30" width="40" height="20"/></g>\n</svg>`);
    r.editor.snap.set(NO_SNAP);
    r.editor.select([idOf(r, 'g')]);
    return r;
  };
  const transformOf = (r: Rig) => /transform="([^"]*)"/.exec(r.editor.source())![1];
  // The diamond, 1.5× as far from the scale's pivot (the root's origin here): the mirror stays.
  for (const [t, want] of [['scale(-1 1)', 'scale(-1.5 1.5)'], ['scale(-1)', 'scale(-1.5)'], ['scale(1 -1)', 'scale(1.5 -1.5)']]) {
    const r = open(t);
    const diamond = r.editor.overlayModel().handles.find((h) => h.kind === 'scale')!;
    const o = hostAt(r, 0, 0);
    drag(r, diamond.at, { x: o.x + 1.5 * (diamond.at.x - o.x), y: o.y + 1.5 * (diamond.at.y - o.y) }, [], { frames: 6 });
    assert.equal(transformOf(r), want, `the diamond on ${t}`);
  }
  // The ring, turned +30° by the finger about its pivot: the shape turns +30° on screen.
  const screenAngle = (r: Rig) => {
    const q = r.editor.overlayModel().outlines[0].quad;
    return (Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x) * 180) / Math.PI;
  };
  for (const t of ['rotate(0)', 'scale(-1 1) rotate(0)', 'translate(100 0) scale(-1 1)', 'matrix(-1 0 0 1 100 0)']) {
    const r = open(t);
    const before = screenAngle(r);
    const model = r.editor.overlayModel();
    const ring = model.handles.find((h) => h.kind === 'rot')!;
    const pivot = model.rotGuide!.from;
    const radius = Math.hypot(ring.at.x - pivot.x, ring.at.y - pivot.y);
    const a0 = Math.atan2(ring.at.y - pivot.y, ring.at.x - pivot.x);
    const at = (deg: number) => ({ x: pivot.x + radius * Math.cos(a0 + (deg * Math.PI) / 180), y: pivot.y + radius * Math.sin(a0 + (deg * Math.PI) / 180) });
    r.editor.pointerDown(ring.at, [], { add: false });
    for (let d = 5; d <= 30; d += 5) r.editor.pointerDrag(at(d));
    r.editor.pointerUp(at(30));
    const turned = ((screenAngle(r) - before + 540) % 360) - 180;
    assert.ok(Math.abs(turned - 30) < 1, `the ring on ${t} turned the shape ${turned.toFixed(1)}° for the finger's 30° (${transformOf(r)})`);
  }
});

test('the Snap sheet’s Grid step field is one history entry while it is typed in: one undo after typing 25 gives Auto back', () => {
  const r = rig();
  r.editor.open(SHAPES);
  // "2", "25": each written live, as the grid follows; one entry when the field lets go.
  r.editor.gridStepStart();
  for (const v of [2, 25]) {
    r.editor.gridStepInput(v);
    assert.equal(r.editor.drawState.grid, v, 'the grid follows the field as it is typed');
  }
  r.editor.gridStepEnd();
  assert.match(r.editor.source(), /<draw:state version="1" grid="25"\/>/);
  assert.equal(r.editor.history.get().undoLabel, 'Set grid step');
  r.editor.undo();
  assert.equal(r.editor.drawState.grid, null, 'one undo: Auto again');
  assert.equal(r.editor.source(), SHAPES, 'and the file as it was');
  assert.equal(r.editor.history.get().canUndo, false, 'typing 25 was one entry');
  // "25", ⌫, "0.5" (20.5), a value that isn't a step (left out), then the field emptied: Auto, one entry, nothing written.
  r.editor.redo();
  r.editor.gridStepStart();
  for (const v of [2, 20, 20.5, 0, null]) r.editor.gridStepInput(v);
  r.editor.gridStepEnd();
  assert.equal(r.editor.drawState.grid, null);
  r.editor.undo();
  assert.equal(r.editor.drawState.grid, 25, 'one undo gives the step before the field was typed in');
  // Nothing else writes while the field holds its entry.
  r.editor.gridStepStart();
  r.editor.gridStepInput(5);
  r.editor.addGuide('v');
  r.editor.gridStepEnd();
  assert.deepEqual(r.editor.drawState.guides, [], 'no guide was added into the middle of the entry');
  assert.equal(r.editor.drawState.grid, 5);
});

test('Hide and Show are refused, with the reason, when CSS sets display (a <style> rule, or the element’s own style=""), and nothing is written', () => {
  const T = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>#a { display: inline }</style>
  <rect id="a" width="10" height="10"/><rect id="b" style="display: inline" x="20" width="10" height="10"/><rect id="c" x="40" width="10" height="10" display="none"/>
</svg>`;
  const r = rig();
  r.editor.open(T);
  for (const [name, hide] of [['a', true], ['b', true]] as const) {
    r.editor.notice.set(null);
    r.editor.setHidden(idOf(r, name), hide);
    assert.equal(r.editor.notice.get(), 'Its display is set by CSS.', name);
  }
  assert.equal(r.editor.source(), T, 'nothing was written');
  assert.equal(r.editor.history.get().canUndo, false);
  r.editor.setHidden(idOf(r, 'c'), false);
  assert.equal(r.editor.history.get().undoLabel, 'Show', 'a display the attribute sets is Draw’s to change');
});

test('a drag moves a rect, an image, a use, a foreignObject and a nested svg by their own x and y', () => {
  const XY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><circle id="dot" r="4"/></defs>
  <rect id="r" x="10" y="10" width="10" height="10"/>
  <image id="i" x="30" y="10" width="10" height="10" href="data:image/png;base64,iVBORw0KGgo="/>
  <use id="u" href="#dot" x="55" y="15"/>
  <foreignObject id="f" x="70" y="10" width="10" height="10"/>
  <svg id="s" x="10" y="40" width="20" height="20" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>
</svg>`;
  const moved: Record<string, [string, string]> = {
    r: ['<rect id="r" x="10" y="10"', '<rect id="r" x="13" y="12"'],
    i: ['<image id="i" x="30" y="10"', '<image id="i" x="33" y="12"'],
    u: ['<use id="u" href="#dot" x="55" y="15"', '<use id="u" href="#dot" x="58" y="17"'],
    f: ['<foreignObject id="f" x="70" y="10"', '<foreignObject id="f" x="73" y="12"'],
    s: ['<svg id="s" x="10" y="40"', '<svg id="s" x="13" y="42"'],
  };
  for (const [name, [from, to]] of Object.entries(moved)) {
    const r = rig();
    r.editor.open(XY);
    r.editor.snap.set(NO_SNAP);
    const k = pxPerUnit(r);
    const at = hostAt(r, 50, 50);
    drag(r, at, { x: at.x + 3 * k, y: at.y + 2 * k }, [idOf(r, name)]);
    assert.equal(r.editor.source(), XY.replace(from, to), `${name}: moved by its x and y, nothing else`);
    assert.equal(r.editor.history.get().undoLabel, 'Move');
  }
});

test('the centre handle moves the shape by whole units, with the tooltip "x N, y N" at the shape’s new centre', () => {
  const r = rig();
  r.editor.open(SHAPES);
  r.editor.snap.set(NO_SNAP);
  const a = idOf(r, 'a');
  r.editor.select([a]);
  const centre = r.editor.overlayModel().handles.find((h) => h.kind === 'center')!;
  const k = pxPerUnit(r);
  const to = { x: centre.at.x + 7.4 * k, y: centre.at.y + 3.2 * k };
  r.editor.pointerDown(centre.at, [a], { add: false });
  r.editor.pointerDrag({ x: (centre.at.x + to.x) / 2, y: (centre.at.y + to.y) / 2 });
  r.editor.pointerDrag(to);
  const tip = r.editor.overlayModel().tip;
  r.editor.pointerUp(to);
  assert.equal(tip?.text, 'x 22, y 18', 'the centre (15, 15) moved by (7, 3)');
  assert.equal(r.editor.source(), SHAPES.replace('<rect id="a" x="10" y="10"', '<rect id="a" x="17" y="13"'));
  assert.equal(r.editor.history.get().undoLabel, 'Move');
});

test('a dragged corner snaps to a guide within 8 px, with a snap line on it, and not from further away', () => {
  const corner = (r: Rig, x: number) => {
    const a = idOf(r, 'a');
    r.editor.select([a]);
    const br = r.editor.overlayModel().handles.find((h) => h.id === 'br')!;
    const to = hostAt(r, x, 20);
    r.editor.pointerDown(br.at, [a], { add: false });
    r.editor.pointerDrag({ x: (br.at.x + to.x) / 2, y: to.y });
    r.editor.pointerDrag(to);
    const lines = r.editor.overlayModel().snapLines;
    r.editor.pointerUp(to);
    return lines;
  };
  const r = rig();
  r.editor.open(SHAPES);
  r.editor.addGuide('v'); // at x 50, the artboard's centre
  const withGuide = r.editor.source();
  const k = pxPerUnit(r);
  const lines = corner(r, 49.1); // 0.9 units short: 3.7 px on screen
  assert.ok(0.9 * k < 8, 'test setup: within 8 px');
  assert.match(r.editor.source(), /<rect id="a" x="10" y="10" width="40" height="10"\/>/, 'the corner landed on the guide');
  const guideX = hostAt(r, 50, 0).x;
  assert.ok(lines.some((l) => Math.abs(l.from.x - guideX) < 0.01 && Math.abs(l.to.x - guideX) < 0.01), 'a snap line along the guide');
  r.editor.undo();
  assert.equal(r.editor.source(), withGuide);
  corner(r, 47.6); // 2.4 units short: 10 px
  assert.ok(2.4 * k > 8, 'test setup: beyond 8 px');
  assert.match(r.editor.source(), /<rect id="a" x="10" y="10" width="38" height="10"\/>/, 'beyond 8 px: whole units, no snap');
});

test('a marquee and Select all pass by a shape visibility hides (inherited; a child can show itself again), as the canvas draws nothing there; Layers never writes visibility', () => {
  const V = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect id="a" x="10" y="10" width="10" height="10"/>
  <rect id="h" x="30" y="10" width="10" height="10" visibility="hidden"/>
  <g visibility="hidden"><rect id="gh" x="50" y="10" width="10" height="10"/><rect id="gv" x="70" y="10" width="10" height="10" style="visibility: visible"/></g>
</svg>`;
  const r = rig();
  r.editor.open(V);
  r.editor.snap.set(NO_SNAP);
  drag(r, hostAt(r, 5, 5), hostAt(r, 95, 30), []);
  assert.deepEqual(sel(r), [idOf(r, 'a'), idOf(r, 'gv')].sort(), 'the marquee takes what draws: not h, nor gh under its hidden group');
  r.editor.selectAll();
  assert.deepEqual(sel(r), [idOf(r, 'a'), idOf(r, 'gv')].sort(), 'Select all likewise');
  r.editor.setHidden(idOf(r, 'a'), true);
  assert.equal(r.editor.source(), V.replace('<rect id="a" x="10" y="10" width="10" height="10"/>', '<rect id="a" x="10" y="10" width="10" height="10" display="none"/>'), 'Hide writes display, never visibility');
});

test('no raw items: every rendered element, use, image, foreignObject and text included, is selected by a tap, duplicated, reordered, deleted and moved (text by a translate), one entry each', () => {
  const RAW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><circle id="dot" r="4"/></defs>
  <use id="u" href="#dot" x="10" y="10"/>
  <image id="i" x="20" y="20" width="10" height="10" href="data:image/png;base64,iVBORw0KGgo="/>
  <foreignObject id="f" x="40" y="40" width="20" height="10"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
  <text id="t" x="60" y="80">Hi</text>
</svg>`;
  const nudged: Record<string, [string, string]> = {
    u: ['<use id="u" href="#dot" x="10" y="10"/>', '<use id="u" href="#dot" x="11" y="10"/>'],
    i: ['<image id="i" x="20"', '<image id="i" x="21"'],
    f: ['<foreignObject id="f" x="40"', '<foreignObject id="f" x="41"'],
    t: ['<text id="t" x="60" y="80">', '<text id="t" x="60" y="80" transform="translate(1 0)">'],
  };
  const copied: Record<string, string> = {
    u: '<use id="u-2" href="#dot" x="15" y="15"/>',
    i: '<image id="i-2" x="25" y="25"',
    f: '<foreignObject id="f-2" x="45" y="45"',
    t: '<text id="t-2" x="60" y="80" transform="translate(5 5)">',
  };
  for (const name of ['u', 'i', 'f', 't']) {
    const r = rig();
    r.editor.open(RAW);
    const id = idOf(r, name);
    tap(r, hostAt(r, 50, 50), [id]);
    assert.deepEqual(sel(r), [id], `${name}: a tap on it selects it`);
    const step = (label: string, act: () => void, ok: (src: string) => boolean) => {
      act();
      const src = r.editor.source();
      assert.equal(r.editor.history.get().undoLabel, label, `${name}: ${label} is one entry (${r.editor.notice.get()})`);
      assert.ok(ok(src), `${name}: ${label}:\n${src}`);
      r.editor.undo();
      assert.equal(r.editor.source(), RAW, `${name}: ${label} undone`);
      r.editor.select([id]);
    };
    step('Duplicate', () => r.editor.duplicate(), (s) => s.includes(copied[name]));
    step('Send back', () => r.editor.back(), (s) => s !== RAW && s.replace(/\s/g, '').length === RAW.replace(/\s/g, '').length);
    step('Delete', () => r.editor.delete(), (s) => !s.includes(`id="${name}"`));
    step('Nudge', () => {
      r.editor.nudge(1, 0);
      r.editor.nudgeEnd();
    }, (s) => s === RAW.replace(nudged[name][0], nudged[name][1]));
  }
});

// ── P1-M2 S1: the Shapes tool, shape handles and generated shapes ────────────────────────────────

const STAR5 = (cx = 50, cy = 50, r = 20) => `<polygon id="s" points="${starPointsOf(cx, cy, r, 0.4, 5)}" fill="#e76f51" stroke="none" draw:gen="star" draw:cx="${cx}" draw:cy="${cy}" draw:r="${r}" draw:inner="0.4" draw:tips="5"/>`;
const GEN = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:draw="https://mmaggitti.github.io/draw/ns" viewBox="0 0 100 100">\n  ${body}\n</svg>`;
const handleIds = (r: Rig) => r.editor.overlayModel().handles.map((h) => h.id);

test('the overlay gives circles, ellipses, lines, polygons, polylines and generated shapes their own handles and no corners; rect, image, foreignObject, nested svg, path, g, use and text keep the corners', () => {
  // The engine doesn't measure a use or a text (the browser's getBBox does): a stand-in box for those.
  const r: Rig = rig(HOST, {
    measure: (ids) => {
      const m = measureWith(r.editor, ids, true);
      const { box, viewport, M } = r.editor.rootBox;
      for (const id of ids) {
        const n = doc(r).nodes.get(id);
        if (!m.has(id) && n?.kind === 'element' && (n.local === 'use' || n.local === 'text')) m.set(id, { box: { x: 50, y: 85, width: 20, height: 12 }, toHost: rootToHostMatrix(box!, viewport, M) });
      }
      return m;
    },
  });
  r.editor.open(GEN(`<circle id="c" cx="20" cy="20" r="8"/><ellipse id="e" cx="50" cy="20" rx="12" ry="6"/><line id="l" x1="70" y1="10" x2="90" y2="30" stroke="#000"/><polygon id="p" points="10,40 30,40 20,55"/><polyline id="q" points="40,40 50,55 60,40" fill="none" stroke="#000"/>${STAR5(80, 50, 10)}<rect id="r" x="5" y="65" width="20" height="20"/><image id="i" x="30" y="65" width="20" height="20" href="data:image/png;base64,AAAA"/><foreignObject id="f" x="55" y="65" width="20" height="20"/><svg id="n" x="78" y="62" width="20" height="20"><rect width="20" height="20"/></svg><path id="d" d="M5 90h20v8H5z"/><g id="g"><rect x="30" y="90" width="20" height="8"/></g><use id="u" href="#r" x="50"/><text id="t" x="60" y="96">Hi</text>`));
  const corners = ['tl', 'tr', 'br', 'bl'];
  for (const [id, own] of [['c', ['r']], ['e', ['rx', 'ry']], ['l', ['p1', 'p2']], ['p', ['v0', 'v1', 'v2']], ['q', ['v0', 'v1', 'v2']], ['s', ['r', 'inner']]] as const) {
    r.editor.select([idOf(r, id)]);
    const ids = handleIds(r);
    assert.ok(own.every((h) => ids.includes(h)) && ids.includes('center'), `#${id}: ${ids}`);
    assert.ok(!ids.some((h) => corners.includes(h)), `#${id} has no corners: ${ids}`);
  }
  for (const id of ['r', 'i', 'f', 'n', 'd', 'g', 'u', 't']) {
    r.editor.select([idOf(r, id)]);
    assert.ok(corners.every((h) => handleIds(r).includes(h)), `#${id} keeps its corners: ${handleIds(r)}`);
  }
  // The star's centre handle sits on its own centre (draw:cx, draw:cy), not its box's.
  r.editor.select([idOf(r, 's')]);
  const c = r.editor.overlayModel().handles.find((h) => h.id === 'center')!.at;
  const want = hostAt(r, 80, 50);
  assert.ok(Math.hypot(c.x - want.x, c.y - want.y) < 0.01, `the star's centre handle ${JSON.stringify(c)} is on (80, 50) ${JSON.stringify(want)}`);
  // With the Shapes tool on, no handles at all.
  r.editor.pickTool('shapes');
  assert.deepEqual(handleIds(r), []);
});

test('a handle drag keeps the grab: a radius handle or a corner grabbed 20 px off moves by the finger’s movement, never jumping to it', () => {
  const r = rig();
  const F = GEN('<circle id="c" cx="30" cy="30" r="10"/>\n  <rect id="a" x="50" y="50" width="30" height="30"/>');
  r.editor.open(F);
  r.editor.snap.set(NO_SNAP);
  const k = pxPerUnit(r);
  r.editor.select([idOf(r, 'c')]);
  const h = r.editor.overlayModel().handles.find((x) => x.id === 'r')!.at;
  const press = { x: h.x + 0.5 * k, y: h.y + 20 }; // off the handle, still within 26 px
  r.editor.pointerDown(press, [], { add: false });
  r.editor.pointerDrag({ x: press.x + 3 * k, y: press.y });
  r.editor.pointerUp({ x: press.x + 3 * k, y: press.y });
  assert.equal(r.editor.history.get().undoLabel, 'Set r');
  assert.ok(r.editor.source().includes('r="13"'), `the radius moved by the finger's 3 units: ${r.editor.source()}`);
  r.editor.undo();
  r.editor.select([idOf(r, 'a')]);
  const br = r.editor.overlayModel().handles.find((x) => x.id === 'br')!.at;
  const p2 = { x: br.x + 14, y: br.y + 14 }; // 20 px off, down and right
  r.editor.pointerDown(p2, [], { add: false });
  r.editor.pointerDrag({ x: p2.x - 5 * k, y: p2.y - 5 * k });
  r.editor.pointerUp({ x: p2.x - 5 * k, y: p2.y - 5 * k });
  assert.equal(r.editor.history.get().undoLabel, 'Resize');
  assert.ok(r.editor.source().includes('<rect id="a" x="50" y="50" width="25" height="25"/>'), `the corner moved by the finger's (−5, −5), not to the finger: ${r.editor.source()}`);
});

test('shape handles: a circle’s radius from the distance, a line end on the snapped point, a star’s radius redrawn from draw:r; one entry each, the tooltip saying the value', () => {
  const F = GEN(`<circle id="c" cx="30" cy="30" r="10"/>\n  <line id="l" x1="10" y1="80" x2="40" y2="80" stroke="#000"/>\n  ${STAR5(70, 60, 15)}`);
  const r = rig();
  r.editor.open(F);
  r.editor.addGuide('v'); // x 50
  const withGuide = r.editor.source();
  const drag = (id: string, handle: string, to: { x: number; y: number }) => {
    r.editor.select([idOf(r, id)]);
    const h = r.editor.overlayModel().handles.find((x) => x.id === handle)!.at;
    r.editor.pointerDown(h, [], { add: false });
    r.editor.pointerDrag({ x: (h.x + to.x) / 2, y: (h.y + to.y) / 2 });
    r.editor.pointerDrag(to);
    const tip = r.editor.overlayModel().tip?.text;
    r.editor.pointerUp(to);
    return tip;
  };
  assert.equal(drag('c', 'r', hostAt(r, 45.2, 30)), 'r 15');
  assert.equal(r.editor.source(), withGuide.replace('r="10"', 'r="15"'));
  assert.equal(r.editor.history.get().undoLabel, 'Set r');
  r.editor.undo();
  assert.equal(drag('l', 'p2', hostAt(r, 49.2, 76.3)), 'x 50, y 76');
  assert.equal(r.editor.source(), withGuide.replace('x2="40" y2="80"', 'x2="50" y2="76"'), 'the end snapped to the guide at x 50, whole units in y');
  assert.equal(r.editor.history.get().undoLabel, 'Move end');
  r.editor.undo();
  assert.equal(drag('s', 'r', hostAt(r, 70, 60 - 25.3)), 'r 25');
  assert.equal(r.editor.source(), withGuide.replace(STAR5(70, 60, 15), STAR5(70, 60, 25)), 'draw:r and the points it generates, one entry');
  assert.equal(r.editor.history.get().undoLabel, 'Set r');
  r.editor.undo();
  assert.equal(r.editor.source(), withGuide);
});

test('a shape-handle drag gathers its snap targets once, when it starts, not on every frame', () => {
  const measured: NodeId[][] = [];
  const r = rig(HOST, { measure: (ids) => (measured.push([...ids]), measureWith(r.editor, ids, true)) });
  r.editor.open(SHAPES);
  const [l, b] = ['l', 'b'].map((id) => idOf(r, id));
  r.editor.select([l]);
  const end = r.editor.overlayModel().handles.find((h) => h.id === 'p2')!;
  measured.length = 0;
  r.editor.pointerDown(end.at, [l], { add: false });
  for (let i = 1; i <= 6; i++) r.editor.pointerDrag({ x: end.at.x - 3 * i, y: end.at.y - 2 * i });
  r.editor.pointerUp({ x: end.at.x - 18, y: end.at.y - 12 });
  assert.equal(r.editor.history.get().undoLabel, 'Move end');
  const gathers = measured.filter((ids) => ids.includes(b)).length;
  assert.ok(gathers > 0 && gathers <= 2, `the other shapes were measured ${gathers} times in a 6-frame drag`);
});

test('on a mirrored element, and inside a mirrored group, a radius or end handle stays under the finger and its length grows outward, with no sign flipped and no transform changed', () => {
  const F = GEN('<circle id="c" cx="-30" cy="30" r="10" transform="scale(-1 1)"/>\n  <g transform="matrix(-1 0 0 1 100 0)"><line id="l" x1="10" y1="80" x2="40" y2="80" stroke="#000"/></g>');
  const r = rig();
  r.editor.open(F);
  r.editor.snap.set(NO_SNAP);
  const drag = (id: string, handle: string, to: { x: number; y: number }) => {
    r.editor.select([idOf(r, id)]);
    const h = r.editor.overlayModel().handles.find((x) => x.id === handle)!.at;
    r.editor.pointerDown(h, [], { add: false });
    r.editor.pointerDrag(to);
    r.editor.pointerUp(to);
    return r.editor.overlayModel().handles.find((x) => x.id === handle)!.at;
  };
  // The circle is drawn at x 30; its radius handle on its left (the mirror), dragged further left.
  const c0 = r.editor.overlayModel();
  r.editor.select([idOf(r, 'c')]);
  const rh = r.editor.overlayModel().handles.find((x) => x.id === 'r')!.at;
  assert.ok(Math.abs(rh.x - hostAt(r, 20, 30).x) < 0.01, 'the radius handle sits on the mirrored side, at x 20');
  void c0;
  const to = hostAt(r, 15, 30);
  const after = drag('c', 'r', to);
  assert.ok(r.editor.source().includes('<circle id="c" cx="-30" cy="30" r="15" transform="scale(-1 1)"/>'), r.editor.source());
  assert.ok(Math.hypot(after.x - to.x, after.y - to.y) < 0.5, `the handle ${JSON.stringify(after)} is under the finger ${JSON.stringify(to)}`);
  // The line in the mirrored group: its second end is drawn at x 60.
  const end = hostAt(r, 55, 70);
  const got = drag('l', 'p2', end);
  assert.ok(r.editor.source().includes('<line id="l" x1="10" y1="80" x2="45" y2="70" stroke="#000"/>'), r.editor.source());
  assert.ok(Math.hypot(got.x - end.x, got.y - end.y) < 0.5, `the end ${JSON.stringify(got)} is under the finger ${JSON.stringify(end)}`);
  assert.ok(r.editor.source().includes('transform="scale(-1 1)"') && r.editor.source().includes('transform="matrix(-1 0 0 1 100 0)"'), 'the transforms are as written');
});

test('an edit from a panel during a draw or a shape-handle drag is refused quietly, and the gesture carries on to one entry', () => {
  const r = rig();
  const F = GEN('<circle id="c" cx="30" cy="30" r="10"/>\n  <rect id="b" x="60" y="60" width="10" height="10"/>');
  r.editor.open(F);
  const b = idOf(r, 'b');
  const panel = () => {
    r.editor.setHidden(b, true);
    r.editor.setLocked(b, true);
    r.editor.addGuide('v');
    r.editor.setGridStep(5);
    r.editor.stepInput('tips', 1);
  };
  r.editor.pickTool('shapes');
  const a = hostAt(r, 20, 60);
  r.editor.pointerDown(a, [], { add: false });
  r.editor.pointerDrag(hostAt(r, 40, 80));
  assert.doesNotThrow(panel, 'Hide, Lock, a guide, the grid step and a generator input during a draw');
  r.editor.pointerUp(hostAt(r, 40, 80));
  assert.equal(r.editor.history.get().undoLabel, 'Add rectangle');
  r.editor.undo();
  assert.equal(r.editor.source(), F, 'the draw was the only entry');
  r.editor.select([idOf(r, 'c')]);
  const h = r.editor.overlayModel().handles.find((x) => x.id === 'r')!.at;
  r.editor.pointerDown(h, [], { add: false });
  r.editor.pointerDrag({ x: h.x + 20, y: h.y });
  assert.doesNotThrow(panel, 'the same during a shape-handle drag');
  r.editor.pointerUp({ x: h.x + 20, y: h.y });
  assert.equal(r.editor.history.get().undoLabel, 'Set r');
  r.editor.undo();
  assert.equal(r.editor.source(), F);
});

test('with the Shapes tool on, a press never selects or moves, a second finger cancels a draw (the file as it was, nothing recorded), and Escape ends a draw first, then the tool', () => {
  const r = rig();
  r.editor.open(SHAPES);
  const a = idOf(r, 'a');
  r.editor.pickTool('shapes');
  assert.equal(r.editor.notice.get(), 'Tap to place, or drag to draw.');
  const on = hostAt(r, 15, 15); // on rect a
  r.editor.pointerDown(on, [a], { add: false });
  r.editor.pointerDrag(hostAt(r, 30, 30));
  r.editor.pointerCancel(); // the Stage's second finger
  assert.equal(r.editor.source(), SHAPES, 'a second finger cancels the draw');
  assert.equal(r.editor.history.get().canUndo, false);
  assert.equal(r.editor.selection.get().size, 0, 'nothing was selected');
  r.editor.pointerDown(on, [a], { add: false });
  r.editor.pointerDrag(hostAt(r, 30, 30));
  r.editor.escape();
  assert.equal(r.editor.source(), SHAPES, 'Escape cancels the draw in progress');
  assert.equal(r.editor.tool.get(), 'shapes', 'and keeps the tool');
  r.editor.escape();
  assert.equal(r.editor.tool.get(), 'select', 'a second Escape returns to Select');
});

test('generated shapes: the Tips field, typed "12", draws 24 points after each keystroke that reads and is one "Set tips" entry that one undo takes back; − and + are one entry each; a hand edit of the points detaches with a notice; Detach does it on purpose', () => {
  const F = GEN(STAR5());
  const r = rig();
  r.editor.open(F);
  const s = idOf(r, 's');
  r.editor.select([s]);
  assert.equal(r.editor.generated()?.label, 'Star');
  assert.deepEqual(r.editor.generated()!.inputs.map((i) => `${i.name}=${i.text}`), ['cx=50', 'cy=50', 'r=20', 'inner=0.4', 'tips=5']);
  const points = () => (doc(r).nodes.get(s) as ElementNode).attrs.find((x) => x.local === 'points')!.raw.split(' ').length;
  r.editor.fieldStart({ kind: 'input', name: 'tips' });
  assert.match(r.editor.fieldInput('1') ?? '', /^Tips takes whole numbers from 3 to 24$/, '"1" doesn\'t read');
  assert.equal(points(), 10, 'the last good value stays (the 5-tip star)');
  assert.equal(r.editor.fieldInput('12'), null);
  assert.equal(points(), 24, '"12" draws 24 points at once');
  r.editor.fieldEnd();
  assert.equal(r.editor.history.get().undoLabel, 'Set tips');
  assert.equal(r.editor.source(), F.replace(STAR5(), STAR5().replace(starPointsOf(50, 50, 20, 0.4, 5), starPointsOf(50, 50, 20, 0.4, 12)).replace('draw:tips="5"', 'draw:tips="12"')));
  r.editor.undo();
  assert.equal(r.editor.source(), F, 'one undo gives back the 5-tip star');
  // Keystrokes that each read: the Inner field typed 0.6, then 0.65, is still one entry.
  r.editor.fieldStart({ kind: 'input', name: 'inner' });
  for (const text of ['0', '0.', '0.6', '0.65']) r.editor.fieldInput(text);
  r.editor.fieldEnd();
  assert.ok(r.editor.source().includes('draw:inner="0.65"'), `the Inner field wrote ${r.editor.source()}`);
  assert.equal(r.editor.history.get().undoLabel, 'Set inner');
  r.editor.undo();
  assert.equal(r.editor.source(), F, 'one undo gives back the inner radius from before the field: typing in it was one entry');
  r.editor.stepInput('tips', 1);
  r.editor.stepInput('inner', -1);
  assert.equal(r.editor.history.get().undoLabel, 'Set inner');
  assert.ok(r.editor.source().includes('draw:inner="0.35" draw:tips="6"'), r.editor.source());
  r.editor.undo();
  r.editor.undo();
  assert.equal(r.editor.source(), F, '− and + are one entry each');
  // A code scrub of one of its numbers: plain, with the notice, in that one entry.
  const t = tokenIn(r, s, 'number', 2);
  r.editor.scrubStart(t.block, t.token);
  r.editor.scrub(3);
  r.editor.scrubEnd(true);
  assert.equal(r.editor.generated(), null, 'plain now');
  assert.ok(!r.editor.source().includes('draw:'), 'every draw: input gone, and the declaration with them');
  assert.equal(r.editor.notice.get(), 'It’s a plain shape now: its generator inputs were dropped.');
  r.editor.undo();
  assert.equal(r.editor.source(), F, 'one undo brings the inputs back byte for byte');
  r.editor.notice.set(null);
  r.editor.detach();
  assert.equal(r.editor.history.get().undoLabel, 'Detach');
  assert.equal(r.editor.source(), F.replace(' draw:gen="star" draw:cx="50" draw:cy="50" draw:r="20" draw:inner="0.4" draw:tips="5"', '').replace(' xmlns:draw="https://mmaggitti.github.io/draw/ns"', ''));
  // A move keeps it generated: only draw:cx, draw:cy and the points.
  r.editor.undo();
  r.editor.snap.set(NO_SNAP);
  const c = r.editor.overlayModel().handles.find((x) => x.id === 'center')!.at;
  const k = pxPerUnit(r);
  r.editor.pointerDown(c, [s], { add: false });
  r.editor.pointerDrag({ x: c.x + 7 * k, y: c.y - 3 * k });
  r.editor.pointerUp({ x: c.x + 7 * k, y: c.y - 3 * k });
  assert.equal(r.editor.source(), F.replace(STAR5(), STAR5(57, 47)));
  assert.ok(r.editor.generated(), 'still generated');
});
