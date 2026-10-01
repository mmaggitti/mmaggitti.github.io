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
import { BOOLEAN_LABELS, BOOLEAN_OPS, DETACHED, DRAWING_CHANGED, Editor, LOCKED, lineColumn, READ_ONLY, STYLE_PAINT, type CanvasPort } from '../../src/editor.ts';
import type { FocusMark, ViewBlock, ViewToken } from '../../src/codeview/code-view.ts';
import { cameraBox, fit, toDoc, toScreen, MAX_BOX } from '../../src/canvas/viewport.ts';
import { artboard, rootViewport } from '../../src/canvas/artboard.ts';
import type { Camera } from '../../src/canvas/renderer.ts';
import { rootToHostMatrix, type OverlayModel } from '../../src/interact/overlay-model.ts';
import { measureWith } from './fakes.ts';
import { HANDLE } from '../../src/canvas/overlay/marks.ts';
import { layerRows } from '../../src/panels/layer-rows.ts';
import { rootTransform } from '../../../../engine/geometry/ctm.ts';
import { mapRect } from '../../../../engine/geometry/bounds.ts';
import { starPoints as starPointsOf } from '../../../../engine/generators/radial.ts';
import { arcCenter, arcPoint, type ArcCenter } from '../../../../engine/path/arc.ts';
import { donutSlices } from '../../../../engine/generators/donut.ts';
import { parsePath } from '../../../../engine/path/parse.ts';
import { toAbsolute } from '../../../../engine/path/abs.ts';
import { insideAt, type BoolOp } from '../../../../engine/path/winding.ts';
import { BOX_EFFECT, BOX_GRADIENT, DASHED, MARKERS, NO_STROKE, NON_SCALING, PAINT_ORDER, RULED, UNREADABLE_PAINT, ZERO_WIDTH } from '../../../../engine/path/offset.ts';
import { DRAW_NS } from '../../../../engine/model/draw-ns.ts';
import { OFFLINE, type Libraries } from '../../src/paths/pipeline.ts';
import { combine as pathBoolCombine } from '../../src/paths/booleans.ts';
import { combine as paperCombine } from '../../src/paths/paper-fallback.ts';

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

function rig(size = HOST, over: Partial<CanvasPort> = {}, booleans?: Libraries): Rig {
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
      booleans,
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

// R4 (the P1-M3 review): a donut whose draw:cy was written as a 309-digit plain decimal made Open throw
// while it built the code view, after the new document and Session were swapped in (the canvas showed
// the new file, the code the old one, and edits went unsaved). The code view's blocks are built first
// now, and the donut's inputs are bounded (donut.test.ts).
test('Open refuses a document whose code view throws while it is built, before anything is swapped: the open drawing, its code, history and selection stay; a donut written with 309-digit inputs opens, plain', () => {
  const r = rig();
  assert.ok(r.editor.open(SAMPLE).ok);
  const poly = element(doc(r), (n) => n.local === 'polyline');
  const { block, token } = tokenIn(r, poly.id, 'enum', 0, 'stroke-linecap');
  r.editor.tapToken(block, token);
  r.editor.select([poly.id]);
  const before = { doc: doc(r), source: r.editor.source(), code: text(r), history: r.editor.history.get(), selection: [...r.editor.selection.get()] };
  // A document whose code view can't be built: a child the model has no node for, so reading its tokens throws.
  const broken = parseDoc('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>');
  assert.ok(broken.ok);
  broken.doc.nodes.delete((broken.doc.nodes.get(broken.doc.root) as ElementNode).children[0]);
  r.log.length = 0;
  const res = r.editor.open(broken.doc);
  assert.ok(!res.ok && /TypeError/.test(res.error ?? ''), JSON.stringify(res));
  assert.deepEqual(r.log, [], 'nothing drawn, listed or shown');
  assert.equal(doc(r), before.doc, 'the open document stays');
  assert.equal(r.editor.source(), before.source);
  assert.equal(text(r), before.code, 'and its code');
  assert.deepEqual(r.editor.history.get(), before.history, 'and its history');
  assert.deepEqual([...r.editor.selection.get()], before.selection, 'and its selection');
  // The review's file: draw:cy written as −1e308 in 309 digits. It opens, its source kept and listed, its comment plain.
  const donut = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:draw="https://mmaggitti.github.io/draw/ns" viewBox="0 0 100 100">\n <g draw:gen="donut" draw:cx="50" draw:cy="-1${'0'.repeat(308)}" draw:r="28">\n  <!-- data: 40, 60 -->\n  <path d="M 0 0"/>\n  <path d="M 0 0"/>\n </g>\n</svg>\n`;
  const opened = r.editor.open(donut);
  assert.ok(opened.ok, opened.error);
  assert.equal(r.editor.source(), donut);
  assert.equal(text(r), donut, 'the code lists it');
  const comment = [...descendants(doc(r), doc(r).root)].find((n) => n.kind === 'comment')!;
  assert.deepEqual(r.listing.get(`${comment.id}:leaf`)!.tokens, [], 'its comment is a plain comment');
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

// ── P1-M3: the Node tool ───────────────────────────────────────────────────────────────────────

const WAVE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path id="w" d="M 30 44 Q 40 32, 50 44 Q 60 56, 70 44" fill="none" stroke="#264653"/>
  <path id="s" d="M 20 75 L 50 30" fill="none" stroke="#264653"/>
  <path id="c" d="M 10 55 C 22 20, 40 20, 50 55 C 60 90, 78 90, 90 55" fill="none" stroke="#264653"/>
  <rect id="r" x="80" y="80" width="10" height="10"/>
</svg>`;
const handleAt = (r: Rig, id: string) => {
  const h = r.editor.overlayModel().handles.find((x) => x.id === id);
  assert.ok(h, `no ${id} handle: ${r.editor.overlayModel().handles.map((x) => x.id)}`);
  return h.at;
};

test('node handles show only in the Node tool, for one selected path, instead of M1’s corners, ring and diamond (the centre stays); Select keeps the corners on a path; Escape from the Node tool returns to Select', () => {
  const r = rig();
  r.editor.open(WAVE);
  r.editor.select([idOf(r, 'w')]);
  const ids = () => r.editor.overlayModel().handles.map((h) => h.id).sort();
  assert.deepEqual(ids(), ['bl', 'br', 'center', 'rot', 'tl', 'tr'].sort().filter((h) => ids().includes(h)), 'Select: M1’s handles');
  assert.ok(!ids().some((h) => /^[abc]\d/.test(h)), 'no node handles in Select');
  r.editor.pickTool('node');
  assert.deepEqual(ids(), ['a0', 'a1', 'a2', 'c1', 'c2', 'center']);
  assert.ok(r.editor.overlayModel().paths!.arms.length === 4, 'the Q arms');
  r.editor.select([idOf(r, 'w'), idOf(r, 's')]);
  assert.deepEqual(ids(), ['center'], 'two selected: M1’s one centre');
  r.editor.select([idOf(r, 'r')]);
  assert.ok(ids().includes('tl') && !ids().some((h) => /^a\d/.test(h)), 'a rect in the Node tool: Select’s handles');
  r.editor.escape();
  assert.equal(r.editor.tool.get(), 'select', 'Escape leaves the Node tool');
  assert.deepEqual([...r.editor.selection.get()], [idOf(r, 'r')], 'and keeps the selection');
});

test('a node drag gathers its snap targets once, when it starts, not on every frame; it is one "Move point" entry and moves only its numbers', () => {
  const measured: NodeId[][] = [];
  const r = rig(HOST, { measure: (ids) => (measured.push([...ids]), measureWith(r.editor, ids, true)) });
  r.editor.open(WAVE);
  const [w, rect] = [idOf(r, 'w'), idOf(r, 'r')];
  r.editor.pickTool('node');
  r.editor.select([w]);
  r.editor.snap.set({ ...NO_SNAP, shapes: true }); // the other shapes are targets (and nothing near (50, 49))
  const a1 = handleAt(r, 'a1');
  measured.length = 0;
  r.editor.pointerDown(a1, [w], { add: false });
  const to = hostAt(r, 50, 49);
  for (let i = 1; i <= 6; i++) r.editor.pointerDrag({ x: a1.x + ((to.x - a1.x) * i) / 6, y: a1.y + ((to.y - a1.y) * i) / 6 });
  r.editor.pointerUp(to);
  assert.equal(r.editor.history.get().undoLabel, 'Move point');
  assert.ok(r.editor.source().includes('d="M 30 44 Q 40 32, 50 49 Q 60 56, 70 44"'), 'the Q controls stay (the lab’s rule)');
  const gathers = measured.filter((ids) => ids.includes(rect)).length;
  assert.ok(gathers > 0 && gathers <= 2, `the other shapes were measured ${gathers} times in a 6-frame drag`);
});

test('a bend tap makes a Q ("Curve") off the midpoint by the lab’s rule, and a bend drag a Q through the finger ("Bend"); a control drag is "Move control"', () => {
  const r = rig();
  r.editor.open(WAVE);
  const s = idOf(r, 's');
  r.editor.pickTool('node');
  r.editor.select([s]);
  const b = handleAt(r, 'b1');
  r.editor.pointerDown(b, [s], { add: false });
  r.editor.pointerUp(b);
  assert.equal(attr(element(doc(r), (n) => n.id === s), 'd'), 'M 20 75 Q 49 62 50 30');
  assert.equal(r.editor.history.get().undoLabel, 'Curve');
  r.editor.undo();
  r.editor.snap.set(NO_SNAP);
  const b2 = handleAt(r, 'b1');
  r.editor.pointerDown(b2, [s], { add: false });
  r.editor.pointerDrag(hostAt(r, 38, 50));
  r.editor.pointerDrag(hostAt(r, 40, 45));
  r.editor.pointerUp(hostAt(r, 40, 45));
  assert.equal(attr(element(doc(r), (n) => n.id === s), 'd'), 'M 20 75 Q 45 38 50 30', '2·(40, 45) − (35, 52.5), the grab kept');
  assert.equal(r.editor.history.get().undoLabel, 'Bend');
  const c = handleAt(r, 'c1');
  r.editor.pointerDown(c, [s], { add: false });
  r.editor.pointerDrag({ x: c.x + 5, y: c.y });
  r.editor.pointerUp({ x: c.x + 5, y: c.y });
  assert.equal(r.editor.history.get().undoLabel, 'Move control');
});

test('a tap on an anchor chooses it (drawn active) and the Node tool’s bar shows Smooth where it applies; Make smooth and Make corner are one entry each; Close/Open and Relative/Absolute act on the path', () => {
  const r = rig();
  r.editor.open(WAVE);
  const c = idOf(r, 'c');
  r.editor.pickTool('node');
  r.editor.select([c]);
  assert.deepEqual(r.editor.nodeBar(), { smooth: null, closed: false, relative: false }, 'no node chosen: no Smooth');
  const a1 = handleAt(r, 'a1');
  r.editor.pointerDown(a1, [c], { add: false });
  r.editor.pointerUp(a1);
  assert.equal(r.editor.chosenNode.get(), 'a1');
  assert.ok(r.editor.overlayModel().handles.find((h) => h.id === 'a1')!.active, 'the chosen node is drawn active');
  assert.equal(r.editor.nodeBar()!.smooth, 'corner', 'a C into a C: Make smooth applies');
  r.editor.toggleSmooth();
  assert.equal(attr(element(doc(r), (n) => n.id === c), 'd'), 'M 10 55 C 22 20, 40 20, 50 55 S 78 90, 90 55');
  assert.equal(r.editor.history.get().undoLabel, 'Make smooth');
  assert.equal(r.editor.nodeBar()!.smooth, 'smooth');
  r.editor.toggleSmooth();
  assert.equal(attr(element(doc(r), (n) => n.id === c), 'd'), 'M 10 55 C 22 20, 40 20, 50 55 C 60 90, 78 90, 90 55', 'Make corner writes the mirror out: the file as it was');
  assert.equal(r.editor.history.get().undoLabel, 'Make corner');
  r.editor.toggleClosed();
  assert.ok(attr(element(doc(r), (n) => n.id === c), 'd')!.endsWith('90 55 Z'));
  assert.equal(r.editor.history.get().undoLabel, 'Close path');
  assert.equal(r.editor.nodeBar()!.closed, true);
  r.editor.toggleClosed();
  assert.equal(r.editor.history.get().undoLabel, 'Open path');
  r.editor.toggleRelative();
  assert.equal(attr(element(doc(r), (n) => n.id === c), 'd'), 'm 10 55 c 12 -35, 30 -35, 40 0 c 10 35, 28 35, 40 0');
  assert.equal(r.editor.history.get().undoLabel, 'Make relative');
  assert.equal(r.editor.nodeBar()!.relative, true);
  r.editor.toggleRelative();
  assert.equal(r.editor.history.get().undoLabel, 'Make absolute');
  r.editor.select([idOf(r, 'w')]);
  assert.equal(r.editor.chosenNode.get(), null, 'another selection: no chosen node');
});

test('a panel edit during a node drag is refused, quietly (M1 fix F3)', () => {
  const r = rig();
  r.editor.open(WAVE);
  const w = idOf(r, 'w');
  r.editor.pickTool('node');
  r.editor.select([w]);
  const a1 = handleAt(r, 'a1');
  r.editor.pointerDown(a1, [w], { add: false });
  r.editor.pointerDrag({ x: a1.x, y: a1.y + 20 });
  const mid = r.editor.source();
  r.editor.toggleRelative(); // a ContextBar button while the finger is down
  r.editor.setStyle('stroke', '#e76f51');
  assert.equal(r.editor.source(), mid, 'nothing written into the drag');
  r.editor.pointerUp({ x: a1.x, y: a1.y + 20 });
  assert.equal(r.editor.history.get().undoLabel, 'Move point');
  r.editor.undo();
  assert.equal(r.editor.source(), WAVE, 'one entry: the drag alone');
});

test('a letter token’s tap cycles its segment ("Set segment"), and a locked path or a d a <style> rule sets refuses with M1’s words', () => {
  const r = rig();
  r.editor.open(WAVE);
  const s = idOf(r, 's');
  const L = tokenIn(r, s, 'enum', 0, 'd=');
  assert.equal(L.block.text.slice(L.token.start, L.token.end), 'L');
  r.editor.tapToken(L.block, L.token);
  assert.equal(attr(element(doc(r), (n) => n.id === s), 'd'), 'M 20 75 Q 49 62 50 30');
  assert.equal(r.editor.history.get().undoLabel, 'Set segment');
  const LOCK = WAVE.replace('<path id="s"', '<path id="s" xmlns:draw="https://mmaggitti.github.io/draw/ns" draw:locked="true"').replace('viewBox', 'xmlns:draw="https://mmaggitti.github.io/draw/ns" viewBox').replace(' xmlns:draw="https://mmaggitti.github.io/draw/ns" draw:locked', ' draw:locked');
  r.editor.open(LOCK);
  const L2 = tokenIn(r, idOf(r, 's'), 'enum', 0, 'd=');
  r.editor.tapToken(L2.block, L2.token);
  assert.equal(r.editor.notice.get(), LOCKED);
  assert.equal(r.editor.source(), LOCK);
  const CSS = WAVE.replace('<path id="w"', '<style>#s { d: path("M 0 0 L 1 1") }</style>\n  <path id="w"');
  r.editor.open(CSS);
  const L3 = tokenIn(r, idOf(r, 's'), 'enum', 0, 'd=');
  r.editor.tapToken(L3.block, L3.token);
  assert.match(r.editor.notice.get() ?? '', /Its d is set by CSS \(a <style> rule\)/);
  assert.equal(r.editor.source(), CSS);
});

// ── P1-M3 S2: arcs, holes and the donut ────────────────────────────────────────────────────────

const LAB_FILE = (f: string) => readFileSync(`${HERE}../../../../engine/test/fixtures/corpus/lab/${f}`, 'utf8');
const pathsOf = (r: Rig) => [...descendants(doc(r), doc(r).root)].filter((n): n is ElementNode => n.kind === 'element' && n.local === 'path').map((n) => n.id);
/** Host px of the midpoint of lab/arcs.svg's arc with these flags. */
const arcMid = (r: Rig, large: boolean, sweep: boolean) => {
  const c = arcCenter(24, 50, 30, 30, 0, large, sweep, 76, 50) as ArcCenter;
  const [x, y] = arcPoint(c, c.t1 + c.dt / 2);
  return hostAt(r, x, y);
};

test('a tap on a ghost arc is one "Set arc flags" entry that sets exactly its two flags (packed flags too), and the old arc becomes a ghost; a tap far from every ghost selects as ever', () => {
  const r = rig();
  const src = LAB_FILE('arcs.svg');
  r.editor.open(src);
  const p = pathsOf(r)[0];
  r.editor.pickTool('node');
  r.editor.select([p]);
  const marks = () => r.editor.overlayModel().paths!;
  assert.deepEqual(marks().ghosts.map((g) => g.flags).sort(), ['0 0', '1 0', '1 1']);
  assert.deepEqual(marks().flags.map((f) => f.text + (f.on ? ' (the arc)' : '')).sort(), ['0 0', '0 1 (the arc)', '1 0', '1 1']);
  tap(r, arcMid(r, true, true), []);
  assert.equal(r.editor.source(), src.replace('A 30 30 0 0 1 76 50', 'A 30 30 0 1 1 76 50'));
  assert.equal(r.editor.history.get().undoLabel, 'Set arc flags');
  assert.deepEqual(marks().ghosts.map((g) => g.flags).sort(), ['0 0', '0 1', '1 0'], 'the old arc is a ghost now');
  tap(r, arcMid(r, false, false), []);
  assert.equal(r.editor.source(), src.replace('A 30 30 0 0 1 76 50', 'A 30 30 0 0 0 76 50'));
  r.editor.undo();
  r.editor.undo();
  assert.equal(r.editor.source(), src, 'one undo each');
  tap(r, hostAt(r, 5, 95), []);
  assert.equal(r.editor.source(), src, 'far from every ghost: nothing written');
  assert.equal(r.editor.selection.get().size, 0, 'and the tap on empty canvas deselects');
  const packed = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path id="a" d="M 24 50 A 30 30 0 01 76 50" fill="none" stroke="#000"/></svg>';
  r.editor.open(packed);
  r.editor.pickTool('node');
  r.editor.select([idOf(r, 'a')]);
  tap(r, arcMid(r, true, false), []);
  assert.equal(r.editor.source(), packed.replace('0 01 76', '0 10 76'), 'packed flags rewritten in place');
});

// R8 (the P1-M3 review): arcs/arc-endpoints and arc-editing say the Node tool's start and end anchors drag
// the arc's ends, its radii, rotation and flags keeping their text, and the ghosts follow; the e2e drags
// the end alone.
test('an arc’s start and end anchors drag its ends: on lab/arcs.svg, a0 (the M) and a1 each write only their own numbers, the radii, rotation and flags keeping their text (one "Move point" each), and the ghosts follow, from the start to the end where they are now', () => {
  const r = rig();
  const src = LAB_FILE('arcs.svg');
  const D = 'M 24 50\n   A 30 30 0 0 1 76 50';
  assert.ok(src.includes(D), 'test setup: lab/arcs.svg’s arc');
  r.editor.open(src);
  r.editor.pickTool('node');
  r.editor.select([pathsOf(r)[0]]);
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
  const CASES: [string, [number, number], [number, number], [number, number], string][] = [
    ['a0', [24, 50], [30, 56], [76, 50], 'M 30 56\n   A 30 30 0 0 1 76 50'],
    ['a1', [76, 50], [70, 40], [24, 50], 'M 24 50\n   A 30 30 0 0 1 70 40'],
  ];
  for (const [h, from, to, other, want] of CASES) {
    const at = handleAt(r, h);
    assert.ok(near(at, hostAt(r, ...from)), `${h} is drawn at (${from})`);
    drag(r, at, hostAt(r, ...to), []);
    assert.equal(r.editor.source(), src.replace(D, want), `${h} dragged to (${to})`);
    assert.equal(r.editor.history.get().undoLabel, 'Move point');
    const [start, end] = h === 'a0' ? [to, other] : [other, to];
    const ghosts = r.editor.overlayModel().paths!.ghosts;
    assert.deepEqual(ghosts.map((g) => g.flags).sort(), ['0 0', '1 0', '1 1']);
    for (const g of ghosts) {
      assert.ok(near(g.start, hostAt(r, ...start)), `${h}: the ${g.flags} ghost starts at (${start})`);
      assert.ok(near(g.cubics.at(-1)![2], hostAt(r, ...end)), `${h}: the ${g.flags} ghost ends at (${end})`);
    }
    r.editor.undo();
    assert.equal(r.editor.source(), src, 'one undo');
  }
});

const HOLE_IN = 'M 43.3 42 A 9 9 0 1 1 56.7 42 L 61 66 L 39 66 Z';
const HOLE_REV = 'M 43.3 42 L 39 66 L 61 66 L 56.7 42 A 9 9 0 1 0 43.3 42 Z';

test('Reverse: with an inner anchor chosen it turns that subpath alone (SVG Lab’s HOLE_REV), with none every subpath; one "Reverse" entry each; the inner bottom line’s arrow turns with it', () => {
  const r = rig();
  const src = LAB_FILE('arcs--holes.svg');
  r.editor.open(src);
  const p = pathsOf(r)[0];
  r.editor.pickTool('node');
  r.editor.select([p]);
  const at = hostAt(r, 50, 66);
  // The arrow nearest (50, 66): its direction, tip minus the middle of its base.
  const arrowX = () => {
    const a = r.editor.overlayModel().paths!.arrows
      .map((x) => ({ x, mid: { x: (x.points[1].x + x.points[2].x) / 2, y: (x.points[1].y + x.points[2].y) / 2 } }))
      .sort((u, v) => Math.hypot(u.mid.x - at.x, u.mid.y - at.y) - Math.hypot(v.mid.x - at.x, v.mid.y - at.y))[0];
    assert.ok(a.x.inner, 'an inner arrow');
    return Math.sign(a.x.points[0].x - a.mid.x);
  };
  assert.equal(arrowX(), -1, 'the inner bottom line runs left before');
  const a6 = handleAt(r, 'a6'); // the end of L 61 66, an inner anchor
  tap(r, a6, [p]);
  assert.equal(r.editor.chosenNode.get(), 'a6');
  r.editor.reverse();
  assert.equal(r.editor.source(), src.replace(HOLE_IN, HOLE_REV));
  assert.equal(r.editor.history.get().undoLabel, 'Reverse');
  assert.equal(arrowX(), 1, 'and right after');
  r.editor.undo();
  assert.equal(r.editor.source(), src);
  r.editor.chosenNode.set(null);
  r.editor.reverse();
  assert.equal(r.editor.source(), src.replace('M 14 50 A 36 36 0 1 1 86 50\n   A 36 36 0 1 1 14 50 Z', 'M 14 50 A 36 36 0 1 0 86 50\n   A 36 36 0 1 0 14 50 Z').replace(HOLE_IN, HOLE_REV), 'every subpath, in its order');
  r.editor.undo();
  assert.equal(r.editor.source(), src, 'one entry');
});

// R9 (the P1-M3 review): a straight segment's arrow sat at its midpoint, where its bend handle is drawn
// on top, so the keyhole's line arrows (the ones Reverse turns) hid under b6 and b7.
test('the direction arrows clear the handles: on lab/arcs--holes.svg in the Node tool no arrow’s centre is within a handle’s radius plus the arrow’s half-size of any handle; the lines’ arrows sit past their bend handles, on the line and along it; the arcs’ stay at their midpoints; a line too short to clear its handles keeps its arrow at its midpoint', () => {
  const S = 4.5; // the arrow's half-size (SVG Lab's s)
  const arrowsOf = (r: Rig) => r.editor.overlayModel().paths!.arrows.map((a) => {
    const base = { x: (a.points[1].x + a.points[2].x) / 2, y: (a.points[1].y + a.points[2].y) / 2 };
    const len = Math.hypot(a.points[0].x - base.x, a.points[0].y - base.y);
    const u = { x: (a.points[0].x - base.x) / len, y: (a.points[0].y - base.y) / len };
    return { at: { x: base.x + S * u.x, y: base.y + S * u.y }, u, inner: a.inner };
  });
  const open = (size = HOST) => {
    const r = rig(size);
    r.editor.open(LAB_FILE('arcs--holes.svg'));
    r.editor.pickTool('node');
    r.editor.select([pathsOf(r)[0]]);
    return r;
  };
  const r = open();
  const handles = r.editor.overlayModel().handles;
  const arrows = arrowsOf(r);
  assert.equal(arrows.length, 6, 'test setup: two arcs, then the keyhole’s arc, two lines and closing line');
  for (const a of arrows) {
    for (const h of handles) {
      const radius = HANDLE[h.kind][h.active ? 2 : 1];
      const d = Math.hypot(a.at.x - h.at.x, a.at.y - h.at.y);
      assert.ok(d >= radius + S, `the arrow at (${a.at.x.toFixed(1)}, ${a.at.y.toFixed(1)}) is ${d.toFixed(1)} px from ${h.id} (radius ${radius} + ${S})`);
    }
  }
  // The keyhole's lines, L 61 66 from (56.7, 42) and L 39 66: each arrow on its line, past its bend handle, pointing along it.
  for (const [from, to, bend] of [[[56.7, 42], [61, 66], 'b6'], [[61, 66], [39, 66], 'b7']] as const) {
    const [p, q] = [hostAt(r, from[0], from[1]), hostAt(r, to[0], to[1])];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    const b = handleAt(r, bend);
    const a = arrows.find((x) => Math.hypot(x.u.x - u.x, x.u.y - u.y) < 1e-6 && Math.abs((x.at.x - p.x) * u.y - (x.at.y - p.y) * u.x) < 1e-6);
    assert.ok(a && a.inner, `an inner arrow on the line to (${to})`);
    const along = (a.at.x - b.x) * u.x + (a.at.y - b.y) * u.y;
    assert.ok(along > HANDLE.bend[2] && (a.at.x - q.x) * u.x + (a.at.y - q.y) * u.y < 0, `${bend}: the arrow is ${along.toFixed(1)} px past its bend handle, before its end`);
  }
  // The arcs keep theirs at their midpoints: SVG Lab's (50, 14) and (50, 86).
  for (const [x, y] of [[50, 14], [50, 86]] as const) assert.ok(arrows.some((a) => !a.inner && Math.hypot(a.at.x - hostAt(r, x, y).x, a.at.y - hostAt(r, x, y).y) < 1e-6), `the ring’s arrow at (${x}, ${y})`);
  // A small canvas: the bottom line is too short to clear its bend handle and its end anchor, so its arrow
  // is drawn at its midpoint (under the bend handle), not moved.
  const small = open({ width: 120, height: 150 });
  const mid = hostAt(small, 50, 66);
  assert.ok(arrowsOf(small).some((a) => a.inner && Math.hypot(a.at.x - mid.x, a.at.y - mid.y) < 1e-6), 'too short: the bottom line’s arrow stays at its midpoint');
});

test('the donut: Edit as donut changes only the holder’s start tag (one entry); a slice then shows only its donut’s boundary handles, in Select and the Node tool alike, and the % labels; a boundary drag is one "Set donut values" entry whose frames regenerate the slices (SVG Lab’s rule, each value at least 1); a slice moved by M1’s drag detaches the donut with M2’s notice, and one undo restores it', () => {
  const r = rig();
  const lab = LAB_FILE('arcs--donut.svg');
  const adopted = lab.replace('viewBox="0 0 100 100">', 'viewBox="0 0 100 100" xmlns:draw="https://mmaggitti.github.io/draw/ns" draw:gen="donut" draw:cx="50" draw:cy="50" draw:r="28">');
  r.editor.open(lab);
  r.editor.select([pathsOf(r)[0]]);
  assert.deepEqual(r.editor.donut(), { holder: doc(r).root, values: [40, 25, 20, 15], recognized: false }, 'Edit as donut is offered');
  r.editor.adoptDonut();
  assert.equal(r.editor.source(), adopted);
  assert.equal(r.editor.history.get().undoLabel, 'Edit as donut');
  assert.equal(r.editor.donut()?.recognized, true);
  const ids = () => r.editor.overlayModel().handles.map((h) => h.id);
  assert.deepEqual(ids(), ['donut-b0', 'donut-b1', 'donut-b2'], 'a slice: its donut’s boundaries only (no corners, ring or centre)');
  assert.deepEqual(r.editor.overlayModel().paths!.donut.map((l) => l.text), ['40%', '25%', '20%', '15%']);
  r.editor.pickTool('node');
  assert.deepEqual(ids(), ['donut-b0', 'donut-b1', 'donut-b2'], 'the Node tool: no node handles on a slice either');
  r.editor.pickTool('select');
  const ring = (f: number) => hostAt(r, 50 + 28 * Math.cos(-Math.PI / 2 + f * 2 * Math.PI), 50 + 28 * Math.sin(-Math.PI / 2 + f * 2 * Math.PI));
  const b0 = handleAt(r, 'donut-b0');
  assert.ok(Math.hypot(b0.x - ring(0.4).x, b0.y - ring(0.4).y) < 1e-6, 'boundary 0 at 40% of the turn');
  r.editor.pointerDown(b0, [], { add: false });
  for (const f of [0.45, 0.5, 0.55, 0.6, 0.65, 0.7]) r.editor.pointerDrag(ring(f));
  assert.equal(r.editor.overlayModel().tip?.text, '64 | 1', 'the tooltip: the two values (64 is capped at the pair − 1)');
  assert.ok(r.editor.source().includes('<!-- data: 64, 1, 20, 15 -->'), 'the frames write the comment');
  r.editor.pointerUp(ring(0.7));
  assert.equal(r.editor.history.get().undoLabel, 'Set donut values');
  assert.deepEqual(r.editor.donut()?.values, [64, 1, 20, 15]);
  const want = donutSlices([64, 1, 20, 15], 50, 50, 28)!;
  assert.deepEqual(pathsOf(r).map((id) => attr(element(doc(r), (n) => n.id === id), 'd')), want, 'the slices regenerated');
  assert.match(want[0], / 0 1 1 /, 'the first slice the long way round');
  r.editor.undo();
  assert.equal(r.editor.source(), adopted, 'one entry');
  // The clamp: boundary 1 dragged back past boundary 0 leaves value 2 at 1.
  const b1 = handleAt(r, 'donut-b1');
  r.editor.pointerDown(b1, [], { add: false });
  for (const f of [0.6, 0.5, 0.4, 0.3]) r.editor.pointerDrag(ring(f));
  r.editor.pointerUp(ring(0.3));
  assert.deepEqual(r.editor.donut()?.values, [40, 1, 44, 15], 'each value at least 1');
  r.editor.undo();
  // A slice moved by M1's move (a press on it that becomes a drag): a hand edit of its d detaches.
  const s1 = pathsOf(r)[1];
  r.editor.select([s1]);
  drag(r, ring(0.525), { x: ring(0.525).x + 40, y: ring(0.525).y }, [s1]);
  assert.equal(r.editor.notice.get(), DETACHED);
  assert.ok(!r.editor.source().includes('draw:'), 'its draw: attributes and xmlns:draw gone');
  assert.equal(r.editor.donut()?.recognized ?? false, false);
  r.editor.undo();
  assert.equal(r.editor.source(), adopted, 'one undo brings the donut back');
});

// R8 (the P1-M3 review): arcs/donut-boundaries and arcs/donut-percent-labels say a selected slice "or its
// holder" shows them, but SVG Lab's own file holds its donut in the root, which showed no handles at all.
test('a donut’s holder selected: the root (SVG Lab’s own file) shows only its boundary handles, and a drag on one is one "Set donut values" entry; a <g> holder shows M1’s handles plus its boundaries; both show the % labels, in Select and the Node tool', () => {
  const r = rig();
  const lab = LAB_FILE('arcs--donut.svg');
  const ns = 'xmlns:draw="https://mmaggitti.github.io/draw/ns"';
  const inRoot = lab.replace('viewBox="0 0 100 100">', `viewBox="0 0 100 100" ${ns} draw:gen="donut" draw:cx="50" draw:cy="50" draw:r="28">`);
  const body = lab.slice(lab.indexOf('>', lab.indexOf('<svg')) + 1, lab.lastIndexOf('</svg>'));
  const inG = lab.replace(/<svg([^>]*)>[\s\S]*<\/svg>/, `<svg$1 ${ns}>\n<g draw:gen="donut" draw:cx="50" draw:cy="50" draw:r="28">${body}</g>\n</svg>`);
  const ids = () => r.editor.overlayModel().handles.map((h) => h.id);
  const labels = () => r.editor.overlayModel().paths?.donut.map((l) => l.text);
  const BOUNDS = ['donut-b0', 'donut-b1', 'donut-b2'];
  const PCT = ['40%', '25%', '20%', '15%'];
  assert.ok(r.editor.open(inRoot).ok);
  r.editor.select([doc(r).root]);
  assert.equal(r.editor.donut()?.recognized, true, 'test setup: the root holds a donut');
  for (const tool of ['select', 'node'] as const) {
    r.editor.pickTool(tool);
    r.editor.select([doc(r).root]);
    assert.deepEqual(ids(), BOUNDS, `${tool}: the root holder shows its boundaries only (the root has no handles of its own)`);
    assert.deepEqual(labels(), PCT, `${tool}: the root holder’s % labels`);
  }
  r.editor.pickTool('select');
  r.editor.select([doc(r).root]);
  const ring = (f: number) => hostAt(r, 50 + 28 * Math.cos(-Math.PI / 2 + f * 2 * Math.PI), 50 + 28 * Math.sin(-Math.PI / 2 + f * 2 * Math.PI));
  r.editor.pointerDown(handleAt(r, 'donut-b0'), [], { add: false });
  for (const f of [0.45, 0.5]) r.editor.pointerDrag(ring(f));
  r.editor.pointerUp(ring(0.5));
  assert.equal(r.editor.history.get().undoLabel, 'Set donut values');
  assert.deepEqual(r.editor.donut()?.values, [50, 15, 20, 15], 'the root holder’s boundary 0 dragged to half the turn');
  r.editor.undo();
  assert.equal(r.editor.source(), inRoot, 'one entry');
  assert.ok(r.editor.open(inG).ok);
  const g = element(doc(r), (n) => n.local === 'g').id;
  for (const tool of ['select', 'node'] as const) {
    r.editor.pickTool(tool);
    r.editor.select([g]);
    assert.equal(r.editor.donut()?.recognized, true, 'test setup: the <g> holds a donut');
    assert.deepEqual(ids(), ['tl', 'tr', 'br', 'bl', 'center', 'rot', ...BOUNDS], `${tool}: a <g> holder shows M1’s handles plus its boundaries`);
    assert.deepEqual(labels(), PCT, `${tool}: the <g> holder’s % labels`);
  }
});

// ── P1-M3 S3: booleans ─────────────────────────────────────────────────────────────────────────

// The libraries themselves, as the chunks give them (node imports them directly).
const LIBS: Libraries = { primary: async () => pathBoolCombine, fallback: async () => paperCombine };
const BOOL_RECT = '<rect id="a" x="10" y="10" width="50" height="50" rx="4" fill="#e76f51" stroke="#264653" opacity="0.9"/>';
const BOOL_CIRCLE = '<circle id="b" cx="0" cy="0" r="25" fill="#2a9d8f" transform="translate(60 60)"/>';
const BOOL_FILE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  ${BOOL_RECT}\n  ${BOOL_CIRCLE}\n  <text id="t" x="10" y="95">Hi</text>\n</svg>`;
/** Whether the fill of `d` holds each point. */
const fills = (d: string, pts: readonly [number, number][]) => pts.map(([x, y]) => insideAt(toAbsolute(parsePath(d)), x, y, 'nonzero'));

test('Union, Subtract, Intersect and Exclude: the result replaces the bottom operand in its place (its attributes in order less its geometry, then d, after its leading whitespace), the others go with theirs, one entry each, the result selected; one undo gives the file back byte for byte', async () => {
  const r = rig(HOST, {}, LIBS);
  r.editor.open(BOOL_FILE);
  const [a, b] = [idOf(r, 'a'), idOf(r, 'b')];
  // In the rect only, in both, in the circle only (centred at (60, 60) by its transform), in neither.
  const PTS: [number, number][] = [[20, 20], [55, 55], [75, 75], [90, 15]];
  const WANT: Record<BoolOp, boolean[]> = {
    union: [true, true, true, false],
    difference: [true, false, false, false],
    intersection: [false, true, false, false],
    exclusion: [true, false, true, false],
  };
  for (const op of BOOLEAN_OPS) {
    r.editor.select([b, a]); // the bottom is the first in the document, whatever the order of the taps
    await r.editor.combine(op);
    const src = r.editor.source();
    const d = /<path id="a" fill="#e76f51" stroke="#264653" opacity="0\.9" d="([^"]+)"\/>/.exec(src)?.[1];
    assert.ok(d, `${op} wrote:\n${src}`);
    assert.equal(src, BOOL_FILE.replace(BOOL_RECT, `<path id="a" fill="#e76f51" stroke="#264653" opacity="0.9" d="${d}"/>`).replace(`\n  ${BOOL_CIRCLE}`, ''), `${op}: the rest of the file as it was`);
    assert.match(d, /^M -?[\d.]+ -?[\d.]+( [LC]( -?[\d.]+)+)* Z( M -?[\d.]+ -?[\d.]+( [LC]( -?[\d.]+)+)* Z)*$/, `${op}: its d is loops of M, L, C and Z`);
    assert.deepEqual(fills(d, PTS), WANT[op], `${op}: where it fills`);
    assert.equal(r.editor.history.get().undoLabel, BOOLEAN_LABELS[op]);
    assert.deepEqual(sel(r), [element(doc(r), (n) => n.local === 'path').id], `${op}: the result is selected`);
    r.editor.undo();
    assert.equal(r.editor.source(), BOOL_FILE, `${op}: one undo gives the file back`);
  }
});

test('a bottom <path> keeps its own element: only its d changes, in place and in its own quotes, and its generator inputs go (Draw’s declaration with them, nothing of Draw’s being left)', async () => {
  const P = `<path id="p" d='M 10 10 H 60 V 60 H 10 Z' draw:gen="spiral" draw:cx="35" draw:cy="35" draw:r="20" draw:turns="2" fill="red"/>`;
  const F = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:draw="${DRAW_NS}" viewBox="0 0 100 100">\n  ${P}\n  <rect x="40" y="40" width="40" height="40"/>\n</svg>`;
  const r = rig(HOST, {}, LIBS);
  r.editor.open(F);
  const p = idOf(r, 'p');
  r.editor.select([p, element(doc(r), (n) => n.local === 'rect').id]);
  await r.editor.combine('union');
  const src = r.editor.source();
  const d = /<path id="p" d='([^']+)' fill="red"\/>/.exec(src)?.[1];
  assert.ok(d, src);
  assert.equal(src, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <path id="p" d='${d}' fill="red"/>\n</svg>`);
  assert.deepEqual(fills(d, [[20, 20], [70, 70], [70, 20]]), [true, true, false]);
  assert.deepEqual(sel(r), [p], 'the same element, selected');
  r.editor.undo();
  assert.equal(r.editor.source(), F);
});

// R8 (the P1-M3 review): feature:booleans says each operand is mapped into the bottom's units through the
// measured matrices; every other test's bottom has no transform of its own, so root units would pass them.
test('a bottom with its own transform: the union is written in its units, so, its transform kept, it fills what the two shapes filled (400 root sample points)', async () => {
  const r = rig(HOST, {}, LIBS);
  const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <rect id="a" x="10" y="10" width="50" height="50" transform="rotate(30 35 35)"/>\n  <circle id="b" cx="65" cy="65" r="20"/>\n</svg>\n';
  r.editor.open(src);
  r.editor.select([idOf(r, 'a'), idOf(r, 'b')]);
  await r.editor.combine('union');
  assert.equal(r.editor.notice.get(), null);
  const path = element(doc(r), (n) => n.local === 'path');
  assert.equal(attr(path, 'transform'), 'rotate(30 35 35)', 'the result keeps the bottom’s transform');
  const abs = toAbsolute(parsePath(attr(path, 'd')!));
  // A root point in the rect's units, and so the result's: rotate(30 35 35) undone.
  const [c, s30] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
  const units = (x: number, y: number): [number, number] => [35 + c * (x - 35) + s30 * (y - 35), 35 - s30 * (x - 35) + c * (y - 35)];
  const wrong: string[] = [];
  for (let y = 2.5; y < 100; y += 5) {
    for (let x = 2.5; x < 100; x += 5) {
      const [u, v] = units(x, y);
      const want = (u > 10 && u < 60 && v > 10 && v < 60) || Math.hypot(x - 65, y - 65) < 20;
      if (insideAt(abs, u, v, 'nonzero') !== want) wrong.push(`(${x}, ${y})`);
    }
  }
  assert.deepEqual(wrong, [], 'root points the result fills differently from the rect and the circle');
});

test('booleans refuse, saying why and writing nothing: one shape, a line, text, a group, a <use>, CSS geometry, a d with an error, a fill-rule a <style> rule may set, a bottom shape a <style> rule may paint (a <path> bottom combines), a bottom with a <title>, a shape the canvas can’t measure, nothing left, and a chunk that can’t load', async () => {
  const W = (body: string, first = '<rect id="a" x="10" y="10" width="50" height="50"/>') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  ${first}\n  ${body}\n</svg>`;
  const cases: [file: string, op: BoolOp, notice: string, libs?: Libraries, over?: (r: () => Rig) => Partial<CanvasPort>][] = [
    [W('<rect id="b" x="40" y="40" width="40" height="40"/>'), 'union', 'Select two shapes or more to combine them.'],
    [W('<line id="b" x1="0" y1="0" x2="50" y2="50" stroke="#000"/>'), 'union', 'A line has no area.'],
    [W('<text id="b" x="10" y="50">Hi</text>'), 'union', 'Convert text to paths first (P1-M4).'],
    [W('<g id="b"><rect x="0" y="0" width="5" height="5"/></g>'), 'union', 'Only shapes combine.'],
    [W('<use id="b" href="#a" x="5"/>'), 'union', 'Only shapes combine.'],
    [W('<circle id="b" cx="50" cy="50" r="10" style="r: 20px"/>'), 'union', 'Its r is set by CSS (its style attribute), which wins over the attribute.'],
    [W('<path id="b" d="M 0 0 L 10 Q"/>'), 'union', 'Its path data has an error at character 12.'],
    [W('<style>circle { fill-rule: evenodd }</style>\n  <circle id="b" cx="50" cy="50" r="10"/>'), 'union', 'A <style> rule may set its fill-rule, which Draw can’t read yet (P2).'],
    // R7 (the P1-M3 review): the rect would become a <path>, which `rect { … }` no longer paints (it turned black).
    [W('<circle id="b" cx="60" cy="60" r="25"/>', '<style>rect { fill: #e76f51 } circle { fill: #2a9d8f }</style>\n  <rect id="a" x="10" y="10" width="50" height="50"/>'), 'union', STYLE_PAINT],
    [W('<rect id="b" x="40" y="40" width="40" height="40"/>', '<rect id="a" x="10" y="10" width="50" height="50"><title>A</title></rect>'), 'union', 'Its <title> would be lost.'],
    [W('<rect id="b" x="40" y="40" width="40" height="40"/>'), 'union', 'Draw can’t tell where it is.', LIBS, (r) => ({
      measure: (ids) => {
        const m = measureWith(r().editor, ids, true);
        m.delete(idOf(r(), 'b'));
        return m;
      },
    })],
    [W('<rect id="b" x="70" y="70" width="20" height="20"/>'), 'intersection', 'Nothing would be left.'],
    [W('<rect id="b" x="40" y="40" width="40" height="40"/>'), 'union', OFFLINE, { primary: () => Promise.reject(new Error('Failed to fetch')), fallback: LIBS.fallback }],
  ];
  for (const [file, op, notice, libs = LIBS, over] of cases) {
    let r!: Rig;
    r = rig(HOST, over ? over(() => r) : {}, libs);
    r.editor.open(file);
    const ids = notice.startsWith('Select two') ? [idOf(r, 'a')] : [idOf(r, 'a'), idOf(r, 'b')];
    r.editor.select(ids);
    await r.editor.combine(op);
    assert.equal(r.editor.notice.get(), notice, `${file}: ${op}`);
    assert.equal(r.editor.source(), file, `${notice}: nothing written`);
    assert.equal(r.editor.history.get().canUndo, false, `${notice}: nothing recorded`);
  }
  // A <path> bottom keeps its element, so a rule that paints it still does: it combines.
  const r = rig(HOST, {}, LIBS);
  r.editor.open(W('<circle id="b" cx="60" cy="60" r="25"/>', '<style>path { fill: #e76f51 }</style>\n  <path id="a" d="M 10 10 H 60 V 60 H 10 Z"/>'));
  r.editor.select([idOf(r, 'a'), idOf(r, 'b')]);
  await r.editor.combine('union');
  assert.equal(r.editor.history.get().undoLabel, 'Union', `a <path> bottom a rule paints: ${r.editor.notice.get()}`);
});

test('a boolean the drawing changes under while its chunk loads refuses, and writes nothing over the change', async () => {
  let release!: () => void;
  const gate = new Promise<void>((ok) => (release = ok));
  const r = rig(HOST, {}, { primary: async () => (await gate, pathBoolCombine), fallback: LIBS.fallback });
  r.editor.open(BOOL_FILE);
  r.editor.select([idOf(r, 'a'), idOf(r, 'b')]);
  const pending = r.editor.combine('union');
  r.editor.select([idOf(r, 't')]);
  r.editor.delete(); // meanwhile, the text goes
  const after = r.editor.source();
  release();
  await pending;
  assert.equal(r.editor.notice.get(), DRAWING_CHANGED);
  assert.equal(r.editor.source(), after, 'nothing written over the change');
  assert.equal(r.editor.history.get().undoLabel, 'Delete');
});

// N1 (the P1-M3 review): the check read the editor's own version, which a tool pick moves and a drag's
// frames don't: a Union resolving mid-drag was dropped with no notice, and a tool picked and put back
// while it loaded refused for nothing. It reads the document's version now, and refuses while an edit
// is live.
test('a boolean whose chunk resolves during a live move drag, or while a press is held, refuses with the notice and writes nothing; one whose load saw only a tool picked and put back is written', async () => {
  const pendingUnion = () => {
    let release!: () => void;
    const gate = new Promise<void>((ok) => (release = ok));
    const r = rig(HOST, {}, { primary: async () => (await gate, pathBoolCombine), fallback: LIBS.fallback });
    r.editor.open(BOOL_FILE);
    r.editor.select([idOf(r, 'a'), idOf(r, 'b')]);
    return { r, pending: r.editor.combine('union'), release };
  };
  // A move drag of the text, live when the chunk resolves.
  const d = pendingUnion();
  const at = hostAt(d.r, 12, 93);
  d.r.editor.pointerDown(at, [idOf(d.r, 't')], { add: false });
  d.r.editor.pointerDrag({ x: at.x + 20, y: at.y });
  d.r.editor.pointerDrag({ x: at.x + 30, y: at.y });
  d.release();
  await d.pending;
  assert.equal(d.r.editor.notice.get(), DRAWING_CHANGED, 'mid-drag: refused, saying so');
  d.r.editor.pointerUp({ x: at.x + 30, y: at.y });
  assert.equal(d.r.editor.history.get().undoLabel, 'Move', 'the drag is one entry of its own');
  assert.ok(!d.r.editor.source().includes('<path'), 'and nothing was combined');
  // A press held (nothing changed yet): an edit is live, so nothing is written into it.
  const h = pendingUnion();
  h.r.editor.pointerDown(hostAt(h.r, 12, 93), [idOf(h.r, 't')], { add: false });
  h.release();
  await h.pending;
  assert.equal(h.r.editor.notice.get(), DRAWING_CHANGED, 'a press held: refused, saying so');
  h.r.editor.pointerUp(hostAt(h.r, 12, 93));
  assert.equal(h.r.editor.history.get().canUndo, false, 'nothing written');
  // A tool picked and put back while it loads: the document never changed, so the Union is written.
  const p = pendingUnion();
  p.r.editor.pickTool('node');
  p.r.editor.pickTool('select');
  p.release();
  await p.pending;
  assert.equal(p.r.editor.notice.get(), null);
  assert.equal(p.r.editor.history.get().undoLabel, 'Union');
});

// ── P1-M4 S0: Stroke to path ───────────────────────────────────────────────────────────────────

const STP = (body: string, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  ${defs}${body}\n</svg>`;
/** Where `d` fills (nonzero) at each point. */
const fillsAt = (d: string, pts: readonly [number, number][]) => pts.map(([x, y]) => insideAt(toAbsolute(parsePath(d)), x, y, 'nonzero'));

test('Stroke to path: a line becomes a filled <path> in its place keeping its id (its stroke attributes gone, fill the stroke’s paint), one "Stroke to path" entry, the outline selected; it fills the stroke and nothing past it; one undo gives the file back byte for byte', async () => {
  const LINE = '<line id="l" x1="20" y1="75" x2="50" y2="30" stroke="#264653" stroke-width="3" stroke-linecap="round"/>';
  const F = STP(LINE);
  const r = rig(HOST, {}, LIBS);
  r.editor.open(F);
  r.editor.select([idOf(r, 'l')]);
  assert.equal(r.editor.canStrokeToPath(), true);
  await r.editor.strokeToPath();
  assert.equal(r.editor.notice.get(), null);
  const src = r.editor.source();
  const d = /<path id="l" fill="#264653" d="([^"]+)"\/>/.exec(src)?.[1];
  assert.ok(d, src);
  assert.equal(src, F.replace(LINE, `<path id="l" fill="#264653" d="${d}"/>`));
  assert.equal(r.editor.history.get().undoLabel, 'Stroke to path');
  assert.deepEqual(sel(r), [idOf(r, 'l')]);
  // On the line, at its round ends, and just past the half width (1.5) and the caps.
  const along = (t: number, off: number): [number, number] => {
    const [dx, dy] = [30 / Math.hypot(30, 45), -45 / Math.hypot(30, 45)];
    return [20 + 30 * t - dy * off, 75 - 45 * t + dx * off];
  };
  assert.deepEqual(fillsAt(d, [along(0.5, 0), along(0.5, 1.3), along(0.5, -1.3), along(1, 0), [20 - 1.3 * 30 / Math.hypot(30, 45), 75 + 1.3 * 45 / Math.hypot(30, 45)]]), [true, true, true, true, true], 'the stroke and its round caps');
  assert.deepEqual(fillsAt(d, [along(0.5, 1.7), along(0.5, -1.7), [20 - 1.7 * 30 / Math.hypot(30, 45), 75 + 1.7 * 45 / Math.hypot(30, 45)]]), [false, false, false], 'nothing past them');
  r.editor.undo();
  assert.equal(r.editor.source(), F);
});

test('Stroke to path: a filled shape keeps its fill, its stroke written none where it lives, and the outline goes right after it with its transform and opacity; a <path> keeps its element, only its d, fill and stroke attributes changing (its style="" losing only its stroke declarations)', async () => {
  const RECT = '<rect id="r" x="20" y="20" width="40" height="30" fill="#e9c46a" stroke="#264653" stroke-width="4" opacity="0.8" transform="rotate(10 40 35)"/>';
  const F = STP(RECT);
  const r = rig(HOST, {}, LIBS);
  r.editor.open(F);
  r.editor.select([idOf(r, 'r')]);
  await r.editor.strokeToPath();
  const src = r.editor.source();
  const d = /<path transform="rotate\(10 40 35\)" opacity="0\.8" fill="#264653" d="([^"]+)"\/>/.exec(src)?.[1];
  assert.ok(d, src);
  assert.equal(src, F.replace(RECT, `${RECT.replace('stroke="#264653"', 'stroke="none"')}\n  <path transform="rotate(10 40 35)" opacity="0.8" fill="#264653" d="${d}"/>`));
  // In the rect's own units: the band ±2 about its edges, and not its middle.
  assert.deepEqual(fillsAt(d, [[20, 35], [21.5, 35], [18.5, 35], [40, 20], [40, 50], [60, 21]]), [true, true, true, true, true, true]);
  assert.deepEqual(fillsAt(d, [[40, 35], [17.5, 35], [22.5, 35], [15, 15]]), [false, false, false, false]);
  r.editor.undo();
  assert.equal(r.editor.source(), F);
  // A <path>: the same element, its d replaced in place, fill="none" now the stroke's paint, its own
  // stroke attributes and style declarations gone, and Draw's generator inputs with them.
  const P = '<path id="p" d="M 10 10 L 50 50" fill="none" stroke="red" stroke-width="2" style="stroke-linecap: round; opacity: 0.5"/>';
  const G = STP(P);
  const q = rig(HOST, {}, LIBS);
  q.editor.open(G);
  const p = idOf(q, 'p');
  q.editor.select([p]);
  await q.editor.strokeToPath();
  const out = q.editor.source();
  const pd = /<path id="p" d="([^"]+)" fill="red" style="opacity: 0\.5"\/>/.exec(out)?.[1];
  assert.ok(pd, out);
  assert.equal(out, G.replace(P, `<path id="p" d="${pd}" fill="red" style="opacity: 0.5"/>`));
  assert.deepEqual(sel(q), [p], 'the same element, selected');
  q.editor.undo();
  assert.equal(q.editor.source(), G);
  // A stroke from an ancestor: the result says stroke="none", so the group's stroke doesn't outline it again.
  const INH = '<g stroke="#264653" stroke-width="2" fill="none"><line id="k" x1="10" y1="10" x2="90" y2="10"/></g>';
  const w = rig(HOST, {}, LIBS);
  w.editor.open(STP(INH));
  w.editor.select([idOf(w, 'k')]);
  await w.editor.strokeToPath();
  assert.match(w.editor.source(), /<g stroke="#264653" stroke-width="2" fill="none"><path id="k" fill="#264653" stroke="none" d="[^"]+"\/><\/g>/);
});

test('Stroke to path refuses, saying why and writing nothing: no stroke, none, a width of 0, a dash, a non-scaling stroke, a marker, a paint it can’t read, a gradient laid out on the box, a clip-path, the stroke painted under a kept fill, a stroke a <style> rule decides, a <path> rule that would paint the result, a d with an error, and text; a dasharray of none converts', async () => {
  const S = 'stroke="#264653" stroke-width="2"';
  const cases: [body: string, notice: string, defs?: string][] = [
    ['<line id="a" x1="10" y1="10" x2="90" y2="90"/>', NO_STROKE],
    [`<line id="a" x1="10" y1="10" x2="90" y2="90" stroke="none"/>`, NO_STROKE],
    [`<line id="a" x1="10" y1="10" x2="90" y2="90" stroke="#000" stroke-width="0"/>`, ZERO_WIDTH],
    [`<line id="a" x1="10" y1="10" x2="90" y2="90" ${S} stroke-dasharray="4 2"/>`, DASHED],
    [`<line id="a" x1="10" y1="10" x2="90" y2="90" ${S} vector-effect="non-scaling-stroke"/>`, NON_SCALING],
    [`<line id="a" x1="10" y1="10" x2="90" y2="90" ${S} marker-end="url(#m)"/>`, MARKERS, '<marker id="m"><path d="M 0 0 L 5 5"/></marker>\n  '],
    [`<line id="a" x1="10" y1="10" x2="90" y2="90" stroke="context-stroke" stroke-width="2"/>`, UNREADABLE_PAINT],
    [`<line id="a" x1="10" y1="10" x2="90" y2="90" stroke="url(#g)" stroke-width="2"/>`, BOX_GRADIENT, '<linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient>\n  '],
    [`<line id="a" x1="10" y1="10" x2="90" y2="90" ${S} clip-path="url(#c)"/>`, BOX_EFFECT('clip-path'), '<clipPath id="c"><rect width="50" height="50"/></clipPath>\n  '],
    [`<rect id="a" x="10" y="10" width="50" height="50" fill="#e9c46a" ${S} paint-order="stroke"/>`, PAINT_ORDER],
    [`<line id="a" x1="10" y1="10" x2="90" y2="90" stroke-width="2"/>`, RULED, '<style>line { stroke: #264653 }</style>\n  '],
    [`<line id="a" x1="10" y1="10" x2="90" y2="90" ${S}/>`, RULED, '<style>path { fill: #2a9d8f }</style>\n  '],
    [`<path id="a" d="M 0 0 L 10 Q" ${S}/>`, 'Its path data has an error at character 12.'],
    [`<text id="a" x="10" y="50" ${S}>Hi</text>`, 'Only shapes have an outline.'],
  ];
  for (const [body, notice, defs] of cases) {
    const F = STP(body, defs);
    const r = rig(HOST, {}, LIBS);
    r.editor.open(F);
    r.editor.select([idOf(r, 'a')]);
    await r.editor.strokeToPath();
    assert.equal(r.editor.notice.get(), notice, body);
    assert.equal(r.editor.source(), F, `${notice}: nothing written`);
    assert.equal(r.editor.history.get().canUndo, false);
  }
  // lab/style.svg's polyline says stroke-dasharray="none": not dashed. A gradient in user space converts.
  for (const [body, defs] of [
    ['<polyline id="a" points="14,88 32,68 50,88" fill="none" stroke="#e76f51" stroke-width="8" stroke-dasharray="none"/>', ''],
    ['<line id="a" x1="10" y1="10" x2="90" y2="90" stroke="url(#u)" stroke-width="2"/>', '<linearGradient id="u" gradientUnits="userSpaceOnUse" x1="0" x2="100"><stop offset="0" stop-color="red"/></linearGradient>\n  '],
  ]) {
    const r = rig(HOST, {}, LIBS);
    r.editor.open(STP(body, defs));
    r.editor.select([idOf(r, 'a')]);
    await r.editor.strokeToPath();
    assert.equal(r.editor.history.get().undoLabel, 'Stroke to path', `${body}: ${r.editor.notice.get()}`);
  }
});

test('Stroke to path on a circle, an ellipse, a polygon and a polyline with no fill: each a filled <path> keeping its id, filling the band of its stroke and not its middle', async () => {
  const cases: [string, [number, number][], [number, number][]][] = [
    ['<circle id="a" cx="50" cy="50" r="20" fill="none" stroke="#264653" stroke-width="4"/>', [[70, 50], [71.5, 50], [50, 28.5]], [[50, 50], [72.5, 50], [67.5, 50]]],
    ['<ellipse id="a" cx="50" cy="50" rx="30" ry="15" fill="none" stroke="#264653" stroke-width="4"/>', [[80, 50], [50, 36.5], [50, 63.5]], [[50, 50], [82.5, 50], [50, 32.5]]],
    ['<polygon id="a" points="20,20 80,20 50,80" fill="none" stroke="#264653" stroke-width="4"/>', [[50, 20], [50, 18.5], [20, 20]], [[50, 40], [50, 17.5], [50, 22.5]]],
    ['<polyline id="a" points="20,20 80,20 80,80" fill="none" stroke="#264653" stroke-width="4"/>', [[50, 20], [80, 50], [81.5, 50]], [[50, 50], [20, 80], [50, 22.5]]],
  ];
  for (const [body, inside, outside] of cases) {
    const F = STP(body);
    const r = rig(HOST, {}, LIBS);
    r.editor.open(F);
    r.editor.select([idOf(r, 'a')]);
    await r.editor.strokeToPath();
    const d = /<path id="a" fill="#264653" d="([^"]+)"\/>/.exec(r.editor.source())?.[1];
    assert.ok(d, `${body}:\n${r.editor.source()}`);
    assert.deepEqual(fillsAt(d, inside), inside.map(() => true), `${body}: the stroke`);
    assert.deepEqual(fillsAt(d, outside), outside.map(() => false), `${body}: nothing else`);
    r.editor.undo();
    assert.equal(r.editor.source(), F);
  }
});

test('a Stroke to path the drawing changes under while its chunk loads refuses, and writes nothing over the change', async () => {
  let release!: () => void;
  const gate = new Promise<void>((ok) => (release = ok));
  const r = rig(HOST, {}, { primary: async () => (await gate, pathBoolCombine), fallback: LIBS.fallback });
  r.editor.open(STP('<line id="a" x1="10" y1="10" x2="90" y2="90" stroke="#000" stroke-width="2"/>\n  <rect id="b" width="5" height="5"/>'));
  r.editor.select([idOf(r, 'a')]);
  const pending = r.editor.strokeToPath();
  r.editor.select([idOf(r, 'b')]);
  r.editor.delete();
  const after = r.editor.source();
  release();
  await pending;
  assert.equal(r.editor.notice.get(), DRAWING_CHANGED);
  assert.equal(r.editor.source(), after);
  assert.equal(r.editor.history.get().undoLabel, 'Delete');
});

// The P1-M4 S0 follow-up (M3's fixer): a rule that paints a <path> may repaint the <path> that takes a
// shape's place, so both conversions refuse it (pathRuleRefusal, shared).
test('a boolean whose bottom shape would become a <path> a <style> rule may paint refuses (a rule for <path> only); the same rule refuses Stroke to path on a line', async () => {
  const F = STP('<rect id="a" x="10" y="10" width="50" height="50" fill="#e76f51"/>\n  <circle id="b" cx="60" cy="60" r="25" fill="#e76f51"/>', '<style>path { fill: #2a9d8f }</style>\n  ');
  const r = rig(HOST, {}, LIBS);
  r.editor.open(F);
  r.editor.select([idOf(r, 'a'), idOf(r, 'b')]);
  await r.editor.combine('union');
  assert.equal(r.editor.notice.get(), STYLE_PAINT);
  assert.equal(r.editor.source(), F);
  const G = STP('<line id="a" x1="10" y1="10" x2="90" y2="90" stroke="#264653" stroke-width="2"/>', '<style>path { fill: #2a9d8f }</style>\n  ');
  const q = rig(HOST, {}, LIBS);
  q.editor.open(G);
  q.editor.select([idOf(q, 'a')]);
  await q.editor.strokeToPath();
  assert.equal(q.editor.notice.get(), STYLE_PAINT);
  assert.equal(q.editor.source(), G);
});
