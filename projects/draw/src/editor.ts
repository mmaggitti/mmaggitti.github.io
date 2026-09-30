// The editor: the framework-free controller between the document and everything that shows it.
//
// It owns the Doc and its Session, the current View (zoom and pan) and the selection, and it
// drives the canvas renderer, the code view and the overlay through small ports, so node's test
// runner can drive it with fakes and the page wires in the real ones (panels/Canvas.tsx). React
// reads it only through its stores; a scrub or a pinch never goes through React.
//
// Every change is a named Session transaction (or a drag: a scrub, or a sheet open for one value,
// which commits as ONE history entry). Each emit is routed in the plan's fixed order: the canvas
// patch, the code view patch, the overlay, the store bumps, then the change listeners (the draft
// autosave, src/workspace.ts). The view is applied as the rendered root's own box (its CSS size and
// offset), never its viewBox and never the file. A draft another tab holds opens read-only: every edit is refused, with a notice, and
// the code shows it as plain text.
//
// - A file that isn't well-formed is shown as its source only (showSource): nothing is drawn and
//   nothing can be edited until another drawing opens.
// - The canvas can fail to draw an edit (a render error): the editor draws the whole document
//   again from the model; if that fails too, the canvas is cleared and says why, while the file,
//   the code and undo carry on. Each later change tries a whole drawing again.
// - Every token takes the keyboard: Enter or Space does what a tap does (a number opens its sheet),
//   and the arrow keys step a number, one history entry each.

import { NS, attrValue, el, parseDoc, serialize, serializeNode, type Doc, type NodeId } from '../../../engine/model/doc.ts';
import { parseFragment } from '../../../engine/model/fragment.ts';
import { buildRefIndex } from '../../../engine/model/refs.ts';
import { opInsert, opRemove, type ChangeSet } from '../../../engine/commands/ops.ts';
import { Session, type Build, type Drag } from '../../../engine/commands/session.ts';
import { blockFor, blocksOf, codeBlocks, endBlockFor, type Block, type BlockToken } from '../../../engine/code/blocks.ts';
import { TokenEditError, type TokenTarget } from '../../../engine/code/edit.ts';
import type { ColorToken, NumberToken, TextToken, Token } from '../../../engine/code/tokens.ts';
import { createStore, type Store } from './panels/store.ts';
import { attached, route, type Route } from './routing.ts';
import { elementOf, outlineable, selectionTarget } from './selectable.ts';
import { blockKey, keyOrder, mixes, subtreeKeys, viewBlock } from './codeview/blocks.ts';
import type { FocusMark, TokenKey, ViewBlock, ViewToken } from './codeview/code-view.ts';
import { artboard, rootViewport } from './canvas/artboard.ts';
import { cameraBox, drawable, fit, panBy, pinch, zoomAbout, type Point, type Rect, type Size, type View } from './canvas/viewport.ts';
import type { Camera, Motion, RenderStats } from './canvas/renderer.ts';
import { rootTransform } from '../../../engine/geometry/ctm.ts';
import { mapRect } from '../../../engine/geometry/bounds.ts';
import { IDENTITY, type Affine } from '../../../engine/values/affine.ts';
import { EMPTY, coordGuides, gridModel, gridStep, paperRect, quadOf, rootToHostMatrix, tip, unionBox, type CameraBox, type OverlayModel, type Quad } from './interact/overlay-model.ts';
import { snapStep, stepDecimals, toStep } from './interact/snap.ts';
import { applyPlan, movesBy, planMove, ROOT_MOVE, type Plan } from '../../../engine/geometry/write.ts';
import { documentOrder, isThin, thinHit } from '../../../engine/geometry/hit.ts';
import { remove, restack, ROOT_DELETE } from './interact/structure.ts';
import { displayNone } from '../../../engine/geometry/bounds.ts';
import type { GeoContext } from '../../../engine/geometry/ctm.ts';
import { isLocked } from '../../../engine/model/draw-state.ts';
import { apply as applyM, invert, multiply } from '../../../engine/values/affine.ts';
import { parseTransform } from '../../../engine/values/transform.ts';
import { fmt } from '../../../engine/values/number-format.ts';
import { checkColor, checkNumber, checkText, labelFor, negated, nextOption, refOf, stepped, tokenAt, tokenOp, type Checked, type TokenRef } from './token-edit.ts';

// ── ports: what the editor drives ──────────────────────────────────────────────────────────────

/** An element as the canvas measures it: its box in its own units, and those units → host px. */
export interface Measured {
  box: Rect;
  toHost: Affine;
}

export interface CanvasPort {
  render(doc: Doc): void;
  patchAttributes(id: NodeId): void;
  patchSubtree(id: NodeId): void;
  /** Place the rendered root's own box (the camera), or null to fill the host. */
  setCamera(camera: Camera | null): void;
  nodeFor(id: NodeId): unknown;
  stats(): RenderStats;
  /** Draw nothing. */
  clear(): void;
  /** Whether the drawing moves, and whether reduced motion has it waiting for Play. */
  motion(): Motion;
  play(on: boolean): void;
  /** Measure drawn elements (getBBox, and getScreenCTM less the host's offset); the rest are left out. */
  measure(ids: readonly NodeId[]): Map<NodeId, Measured>;
}
export interface CodePort {
  set(blocks: readonly ViewBlock[]): void;
  patch(block: ViewBlock): void;
  /** Put these blocks (a node placed or moved, with everything under it) before the block keyed `before`, or at the end. */
  place(blocks: readonly ViewBlock[], before: string | null): void;
  /** Take these blocks away. */
  remove(keys: readonly string[]): void;
  select(nodes: ReadonlySet<number>): void;
  /** Mark the number the Scrub strip holds, or none. */
  focus(mark: FocusMark | null): void;
  /** Show every token as plain text that nothing edits (a read-only drawing), or not. */
  readOnly(on: boolean): void;
  /** Show a file's text as read-only source, with the character at `at` marked (not well-formed). */
  source(text: string, at: number): void;
}
export interface OverlayPort {
  /** Draw the overlay model: outlines, handles, guides, the tooltip, the paper and the grid. */
  show(model: OverlayModel): void;
}
export interface EditorPorts {
  canvas: CanvasPort;
  code: CodePort;
  overlay: OverlayPort;
  /** The canvas host's size in CSS pixels, read when a document opens. */
  hostSize(): Size;
  /** The page's root font size in CSS px (what rem is on the canvas); 12 at Draw's 75% scale if absent. */
  remPx?(): number;
  /** False when the sink can't render (no DOMPurify): then nothing opens. */
  sinkReady(): boolean;
}

// ── state React reads ──────────────────────────────────────────────────────────────────────────

export interface OpenResult extends RenderStats {
  ok: boolean;
  error?: string;
}
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}
/** The number the Scrub strip holds, as it reads now. */
export interface Focus {
  ref: TokenRef;
  token: NumberToken;
}
export interface SourceError {
  message: string;
  at: number; // offset in the edited text
  line: number; // 1-based
  column: number; // 1-based
}
export type Sheet =
  | { kind: 'number'; ref: TokenRef; token: NumberToken }
  | { kind: 'color'; ref: TokenRef; token: ColorToken }
  | { kind: 'text'; ref: TokenRef; token: TextToken }
  | { kind: 'source'; node: NodeId; text: string };
type TokenSheet = Extract<Sheet, { ref: TokenRef }>;

const NO_STATS: RenderStats = { rendered: 0, skippedElements: 0, droppedAttributes: 0 };
export const READ_ONLY = 'This drawing is open in another tab, so it is read-only here';
const NO_HISTORY: HistoryState = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null };

/** 1-based line and column of an offset (CRLF, CR and LF each end a line). */
export function lineColumn(text: string, at: number): { line: number; column: number } {
  const lines = text.slice(0, at).split(/\r\n|\r|\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

interface Live {
  drag: Drag;
  ref: TokenRef;
  token: Token; // as it read before the drag: every frame starts from there
  last: string | null; // the last text written, kept when a later one is refused
}

export class Editor {
  readonly history: Store<HistoryState> = createStore(NO_HISTORY);
  readonly selection: Store<ReadonlySet<NodeId>> = createStore<ReadonlySet<NodeId>>(new Set());
  readonly focus: Store<Focus | null> = createStore<Focus | null>(null);
  readonly sheet: Store<Sheet | null> = createStore<Sheet | null>(null);
  readonly notice: Store<string | null> = createStore<string | null>(null);
  /** Bumped on every change to the document (the Inspect tab and labels re-read it). */
  readonly version: Store<number> = createStore(0);
  /** True while another tab holds this document's draft: every edit is refused. */
  readonly readOnly: Store<boolean> = createStore(false);
  /** Why the canvas can't show the document now (a render error), or null. */
  readonly canvasError: Store<string | null> = createStore<string | null>(null);
  /** Whether the drawing moves, and whether it waits for Play (reduced motion). */
  readonly motion: Store<Motion> = createStore<Motion>('still');
  /** Whether the grid is shown (a device preference the canvas sets, never in the file). */
  readonly grid: Store<boolean> = createStore(false);
  /** Select more: taps and marquees add to the selection (a ContextBar toggle). */
  readonly selectMore: Store<boolean> = createStore(false);
  #nudge: { move: MoveState; d: Point } | null = null; // arrows held (keys.ts)

  #ports: EditorPorts;
  #doc: Doc | null = null;
  #session: Session | null = null;
  #blocks = new Map<string, Block>(); // the engine's blocks, by the code view's keys
  #live: Live | null = null;
  #size: Size = { width: 0, height: 0 };
  #board: Rect | null = null;
  #rootHost: Size = { width: 1, height: 1 }; // the host size the root's viewport was read against
  #viewport: Size = { width: 1, height: 1 }; // the root's viewport at 100% (W0 × H0, CSS px)
  #M: Affine = IDENTITY; // the root's user units → its box px at 100%
  #view: View = { cx: 0, cy: 0, scale: 1 }; // in box px
  #box: CameraBox | null = null; // the root's box in the host now, or null (no usable host)
  #fitScale = 1;
  #fitted = true; // true until the user zooms or pans: a resize then fits again
  #navStart: View | null = null;
  #listeners = new Set<() => void>();
  #gesture: Gesture | null = null; // the pointer's, from down to up

  constructor(ports: EditorPorts) {
    this.#ports = ports;
    this.focus.subscribe(() => this.#markFocus());
    this.readOnly.subscribe(() => this.#ports.code.readOnly(this.readOnly.get()));
    this.grid.subscribe(() => this.#show());
    // Select more lasts until it is tapped off, Deselect, Escape, or the selection empties.
    this.selection.subscribe(() => {
      if (!this.selection.get().size && this.selectMore.get()) this.selectMore.set(false);
    });
  }

  get doc(): Doc | null {
    return this.#doc;
  }
  get view(): View {
    return { ...this.#view };
  }
  get fitScale(): number {
    return this.#fitScale;
  }

  /** The whole document's source, exactly as it would be saved. */
  source(): string {
    return this.#doc ? serialize(this.#doc) : '';
  }

  /**
   * Hear every change to the open document, after the canvas, the code, the overlay and the
   * stores: each committed edit, undo and redo, and the end of a drag (a scrub, a sheet), never a
   * drag's frames or an open. Returns the unsubscribe.
   */
  onChange(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #changed(): void {
    for (const fn of [...this.#listeners]) fn();
  }

  // ── opening ────────────────────────────────────────────────────────────────────────────────

  /**
   * Open a document: the engine's parser (src/import.ts parses first and passes the Doc), then the
   * renderer and the sink. A file that can't be drawn says so: one that fails to parse or throws
   * while drawing (the previous document and drawing stay), and one whose root the canvas refuses
   * (nothing would show).
   */
  open(input: string | Doc): OpenResult {
    if (!this.#ports.sinkReady()) return { ok: false, error: 'DOMPurify is unavailable, so nothing renders', ...NO_STATS };
    let doc: Doc;
    if (typeof input === 'string') {
      const parsed = parseDoc(input);
      if (!parsed.ok) return { ok: false, error: parsed.error.message, ...NO_STATS };
      doc = parsed.doc;
    } else doc = input;
    this.#endLive(false);
    const canvas = this.#ports.canvas;
    try {
      canvas.render(doc);
    } catch (e) {
      return { ok: false, error: String(e), ...NO_STATS };
    }
    this.#doc = doc;
    this.canvasError.set(null);
    this.#session = new Session(doc);
    this.#wire(this.#session);
    this.#board = artboard(doc);
    this.#size = this.#ports.hostSize();
    this.#fitView();
    this.selection.set(new Set());
    this.focus.set(null);
    this.sheet.set(null);
    this.#resetCode();
    this.#bump();
    try {
      this.#applyView();
    } catch (e) {
      return { ok: false, error: String(e), ...canvas.stats() };
    }
    const root = el(doc, doc.root);
    if (!canvas.nodeFor(root.id)) {
      const svg = root.ns === NS.svg && root.local === 'svg';
      return { ok: false, error: svg ? 'the canvas refused its root <svg>' : 'the root element is not an <svg> in the SVG namespace', ...canvas.stats() };
    }
    return { ok: true, ...canvas.stats() };
  }

  // The fixed order of the plan's data flow: canvas → code view → overlay → stores → drafts.
  #wire(session: Session): void {
    let r: Route = { attrs: [], subtrees: [], moved: [], code: { reset: false, blocks: [], moved: [], parents: [] } };
    session.subscribe((cs: ChangeSet) => {
      r = route(session.doc, cs);
      if (cs.attrs.has(session.doc.root)) this.#artboardChanged();
      const canvas = this.#ports.canvas;
      if (this.canvasError.get() !== null) return this.#redraw(); // it failed before: the whole drawing, again
      try {
        for (const id of r.subtrees) canvas.patchSubtree(id);
        for (const id of r.moved) canvas.patchSubtree(id);
        for (const id of r.attrs) canvas.patchAttributes(id);
      } catch {
        this.#redraw();
      }
    });
    session.subscribe(() => {
      if (r.code.reset) return this.#resetCode();
      if ((r.code.moved.length || r.code.parents.length) && !this.#placeCode(r.code.moved, r.code.parents)) return this.#resetCode();
      for (const id of r.code.blocks) this.#patchCode(id);
    });
    session.subscribe(() => {
      const kept = [...this.selection.get()].filter((id) => attached(session.doc, id));
      if (kept.length !== this.selection.get().size) this.selection.set(new Set(kept));
      if (!kept.length && this.selectMore.get()) this.selectMore.set(false);
      this.#show();
    });
    // A drag's frames change no store: a scrub renders nothing in React until it ends.
    session.subscribe((_cs, why) => {
      if (why.kind !== 'drag') this.#bump();
    });
    // Last, the change listeners (the draft autosave). A drag tells them when it ends (#endLive).
    session.subscribe((_cs, why) => {
      if (why.kind !== 'drag') this.#changed();
    });
  }

  #resetCode(): void {
    const doc = this.#doc!;
    const blocks = codeBlocks(doc);
    this.#blocks = new Map(blocks.map((b) => [blockKey(b.node, b.part), b]));
    const memo = new Map<NodeId, boolean>();
    this.#ports.code.set(blocks.map((b) => viewBlock(doc, b, memo)));
    this.#ports.code.select(this.selection.get());
  }

  /**
   * The canvas couldn't draw a change: draw the whole document from the model (a fresh render equals
   * a patched one). If that fails too, the canvas is cleared and says why; the file, the code and
   * the history are untouched, and the next change tries again.
   */
  #redraw(): void {
    const doc = this.#doc;
    if (!doc) return;
    const canvas = this.#ports.canvas;
    try {
      canvas.render(doc);
      this.canvasError.set(null);
      this.#applyView();
    } catch (e) {
      try {
        canvas.clear();
      } catch {
        // nothing more to take away
      }
      this.canvasError.set(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * A structure change in the code: each moved node's blocks taken away, and the attached ones
   * placed again (last first, each before the next block already in the listing); then the start
   * and end blocks of the parents whose children changed are read again (a <g/> that gains a child
   * gets an end tag). Every other block keeps its DOM node. False when a block can't be placed, or
   * when a moved leaf of real text changes how its parent's other blocks flow (mixed content): the
   * listing is then rebuilt.
   */
  #placeCode(moved: readonly NodeId[], parents: readonly NodeId[]): boolean {
    const doc = this.#doc!;
    const code = this.#ports.code;
    if (moved.some((id) => mixes(doc.nodes.get(id)))) return false;
    const order = keyOrder(doc);
    const index = new Map(order.map((k, i) => [k, i]));
    const next = (key: string): string | null => {
      const at = index.get(key);
      if (at === undefined) return null;
      for (let i = at + 1; i < order.length; i++) if (this.#blocks.has(order[i])) return order[i];
      return null;
    };
    for (const id of moved) {
      const keys = subtreeKeys(doc, id).filter((k) => this.#blocks.has(k));
      if (!keys.length) continue;
      code.remove(keys);
      for (const k of keys) this.#blocks.delete(k);
    }
    const memo = new Map<NodeId, boolean>();
    for (const id of moved) {
      if (!attached(doc, id)) continue;
      const blocks = blocksOf(doc, id);
      const last = blockKey(blocks[blocks.length - 1].node, blocks[blocks.length - 1].part);
      if (!index.has(last)) return false;
      const before = next(last);
      for (const b of blocks) this.#blocks.set(blockKey(b.node, b.part), b);
      code.place(blocks.map((b) => viewBlock(doc, b, memo)), before);
    }
    for (const p of parents) {
      if (!attached(doc, p) || doc.nodes.get(p)?.kind !== 'element') continue;
      this.#patchCode(p);
      const end = endBlockFor(doc, p);
      const key = blockKey(p, 'end');
      if (end && this.#blocks.has(key)) {
        this.#blocks.set(key, end);
        code.patch(viewBlock(doc, end));
      } else if (end) {
        const before = next(key);
        this.#blocks.set(key, end);
        code.place([viewBlock(doc, end)], before);
      } else if (this.#blocks.has(key)) {
        code.remove([key]);
        this.#blocks.delete(key);
      }
    }
    code.select(this.selection.get());
    return true;
  }

  #patchCode(id: NodeId): void {
    const doc = this.#doc!;
    if (!doc.nodes.has(id)) return;
    const b = blockFor(doc, id);
    const key = blockKey(b.node, b.part);
    if (!this.#blocks.has(key)) return; // not in the listing (detached)
    this.#blocks.set(key, b);
    this.#ports.code.patch(viewBlock(doc, b));
  }

  // The code view marks the number the Scrub strip holds: its block and its index there, read again
  // after every change (the focus store is refreshed then).
  #markFocus(): void {
    const f = this.focus.get();
    const key = f && blockKey(f.ref.node, 'attr' in f.ref.target ? 'start' : 'leaf');
    const index = f && key ? this.#blocks.get(key)?.tokens.findIndex((bt) => sameTarget(bt.target, f.ref.target) && bt.token.start === f.token.start && bt.token.end === f.token.end) ?? -1 : -1;
    this.#ports.code.focus(key && index !== -1 ? { key, index } : null);
  }

  #bump(): void {
    const s = this.#session;
    const h: HistoryState = s ? { canUndo: s.canUndo, canRedo: s.canRedo, undoLabel: s.undoLabel, redoLabel: s.redoLabel } : NO_HISTORY;
    const was = this.history.get();
    if (h.canUndo !== was.canUndo || h.canRedo !== was.canRedo || h.undoLabel !== was.undoLabel || h.redoLabel !== was.redoLabel) this.history.set(h);
    const f = this.focus.get();
    if (f) {
      // The focused number as it reads now; gone when its element left the document (an undo).
      const doc = this.#doc;
      const token = doc && attached(doc, f.ref.node) ? tokenAt(doc, f.ref) : null;
      this.focus.set(token?.kind === 'number' ? { ref: f.ref, token } : null);
    }
    this.motion.set(this.#doc && !this.canvasError.get() ? this.#ports.canvas.motion() : 'still');
    this.version.set(this.version.get() + 1);
  }

  // ── selection ──────────────────────────────────────────────────────────────────────────────

  select(ids: Iterable<NodeId>): void {
    const next = new Set([...ids].filter((id) => this.#doc && attached(this.#doc, id)));
    const cur = this.selection.get();
    if (next.size !== cur.size || [...next].some((id) => !cur.has(id))) {
      this.selection.set(next);
      this.#ports.code.select(next);
    }
    if (!next.size && this.selectMore.get()) this.selectMore.set(false); // it stays on until the selection empties
    this.#show();
  }

  /** A tap on the canvas: `hit` is the drawn node under it (null: nothing drawn there). */
  tapCanvas(hit: NodeId | null): void {
    if (!this.#doc || this.#live || this.#gesture) return;
    const target = selectionTarget(this.#doc, hit);
    this.#tap(target !== null && isLocked(this.#doc, target) ? null : target, this.selectMore.get());
  }

  /** A tap on a code block's plain text selects the element it belongs to. */
  tapBlock(block: ViewBlock): void {
    if (!this.#doc || this.#live) return;
    this.focus.set(null);
    const id = elementOf(this.#doc, block.node);
    this.select(id === null ? [] : [id]);
  }

  /** Bring the selection's code into view again (the code panel was hidden). */
  revealSelection(): void {
    this.#ports.code.select(this.selection.get());
  }

  // ── the overlay ────────────────────────────────────────────────────────────────────────────

  /** The overlay model now: the paper and the grid, the selection's outlines, and the gesture's marks. */
  overlayModel(): OverlayModel {
    const doc = this.#doc;
    const box = this.#box;
    if (!doc || !box) return EMPTY;
    const vp = this.#viewport;
    const paper = paperRect(box, vp, this.#M, this.#board);
    const ids = [...this.selection.get()].filter((id) => attached(doc, id) && outlineable(doc, id));
    const measured = this.#ports.canvas.measure(ids);
    const outlines = ids.flatMap((id) => {
      const m = measured.get(id);
      return m ? [{ id, quad: quadOf(m.box, m.toHost) }] : [];
    });
    const model: OverlayModel = { ...EMPTY, paper, grid: this.grid.get() ? gridModel(box, vp, this.#M, this.#size, paper, this.gridStep()) : null, outlines };
    this.#gestureMarks(model, paper);
    return model;
  }

  /** The grid's step in the root's user units: the smallest 1-2-5 step at least 12 px apart. */
  gridStep(): number {
    const box = this.#box;
    if (!box) return 1;
    const k = box.width / this.#viewport.width;
    return gridStep(k * Math.min(Math.abs(this.#M[0]), Math.abs(this.#M[3])));
  }

  #show(): void {
    this.#ports.overlay.show(this.overlayModel());
  }

  // ── the pointer: select, move, marquee (decision 7) ───────────────────────────────────────

  /** Geometry's context: the root's viewport at 100% and the page's rem. */
  get geo(): GeoContext {
    return { viewport: this.#viewport, remPx: this.#ports.remPx?.() ?? 12 };
  }

  /** Deselect (the ContextBar's ×, Escape): the selection empties and Select more turns off. */
  deselect(): void {
    this.focus.set(null);
    this.select([]);
    this.selectMore.set(false);
  }

  /**
   * A pointer went down on the canvas at `at` (host px) over `hits` (drawn nodes, topmost first).
   * Nothing happens until it moves or lifts: a tap selects, a drag moves or draws a marquee.
   */
  pointerDown(at: Point, hits: readonly NodeId[], mods: { add: boolean }): void {
    const doc = this.#doc;
    if (!doc || this.#live || this.#gesture || this.#nudge) return;
    const all = this.#withThin(at, hits);
    const target = all.map((id) => selectionTarget(doc, id)).find((t): t is NodeId => t !== null && !isLocked(doc, t)) ?? null;
    this.#gesture = { at0: at, at, target, add: mods.add || this.selectMore.get(), mode: 'pending', move: null };
  }

  /** The pointer moved past the slop (the first call starts the drag; `held`: after a hold). */
  pointerDrag(at: Point, held = false): void {
    const g = this.#gesture;
    if (!g || !this.#doc) return;
    g.at = at;
    if (g.mode === 'pending') this.#startDrag(g, held);
    if (g.mode === 'move') this.#moveFrame(g);
    else this.#show();
  }

  /** The pointer lifted: a tap, or the end of a drag (one history entry for a move). */
  pointerUp(at: Point): void {
    const g = this.#gesture;
    if (!g) return;
    g.at = at;
    this.#gesture = null;
    if (g.mode === 'pending') this.#tap(g.target, g.add);
    else if (g.mode === 'move') this.#endMove(g, true);
    else if (g.mode === 'marquee') this.#endMarquee(g);
    this.#show();
  }

  /** Another finger or the Pencil took over: a move is undone, a marquee disappears. */
  pointerCancel(): void {
    const g = this.#gesture;
    if (!g) return;
    this.#gesture = null;
    if (g.mode === 'move') this.#endMove(g, false);
    this.#show();
  }

  /** Is a pointer gesture, a scrub or a nudge under way (Escape cancels one)? */
  get busy(): boolean {
    return !!this.#live || !!this.#gesture?.move || !!this.#nudge;
  }

  /** Escape: cancel a live drag if one is running, else deselect. */
  escape(): void {
    if (this.#gesture) return this.pointerCancel();
    if (this.#live) return this.#endLive(false);
    if (this.#nudge) return this.nudgeEnd(false);
    this.deselect();
  }

  /** Select all: what a marquee around the whole document would take. */
  selectAll(): void {
    if (!this.#doc || this.#live || this.#gesture) return;
    this.focus.set(null);
    this.select(this.#leaves(null));
  }

  // ── structure: Bring forward, Send back, Delete ────────────────────────────────────────────

  /** Bring forward: each selected element after its next element sibling, with its leading whitespace. One entry; nothing to do records nothing. */
  forward(): void {
    this.#restack('Bring forward', 1);
  }

  /** Send back: each selected element before its previous element sibling, with its leading whitespace. */
  back(): void {
    this.#restack('Send back', -1);
  }

  /** Delete the selected elements, each with its leading whitespace, in one entry. The root is refused. */
  delete(): void {
    const doc = this.#doc;
    const sel = [...this.selection.get()];
    if (!doc || !sel.length || this.#live || this.#gesture) return;
    if (sel.includes(doc.root)) return void this.notice.set(ROOT_DELETE);
    const ids = this.#acted(sel);
    if (!ids?.length || !this.#dispatch('Delete', (apply) => remove(doc, ids, apply))) return;
    this.focus.set(null);
    this.select([]);
  }

  #restack(label: string, dir: 1 | -1): void {
    const doc = this.#doc;
    if (!doc || this.#live || this.#gesture) return;
    const ids = this.#acted([...this.selection.get()].filter((id) => id !== doc.root));
    if (ids?.length) this.#dispatch(label, (apply) => restack(doc, ids, dir, apply));
  }

  // What a structure command acts on: the attached selected elements (never the root), none inside
  // another that is acted on, in document order. A locked one refuses the command, and says so.
  #acted(sel: readonly NodeId[]): NodeId[] | null {
    const doc = this.#doc!;
    const order = documentOrder(doc);
    const ids = sel.filter((id) => id !== doc.root && order.has(id) && !sel.some((o) => o !== id && isInside(doc, id, o)));
    if (ids.some((id) => isLocked(doc, id))) {
      this.notice.set(LOCKED);
      return null;
    }
    return ids.sort((a, b) => order.get(a)! - order.get(b)!);
  }

  // A tap: the target is selected (with Select more, or ⇧/⌘, toggled); empty canvas deselects
  // (with Select more, or ⇧/⌘, nothing happens).
  #tap(target: NodeId | null, add: boolean): void {
    this.focus.set(null);
    if (target === null) {
      if (!add) this.deselect();
      return;
    }
    const sel = this.selection.get();
    if (!add) return this.select([target]);
    this.select(sel.has(target) ? [...sel].filter((id) => id !== target) : [...sel, target]);
  }

  // The DOM's hits and the engine's thin-shape hit (22 px plus half the stroke): before the first
  // DOM hit when it paints above it (later in document order), else after it.
  #withThin(at: Point, hits: readonly NodeId[]): NodeId[] {
    const doc = this.#doc!;
    const box = this.#box;
    const out = [...hits];
    if (!box) return out;
    const toHost = rootToHostMatrix(box, this.#viewport, this.#M);
    const inv = invert(toHost);
    if (!inv) return out;
    const [x, y] = applyM(inv, at.x, at.y);
    const scale = Math.sqrt(Math.abs(toHost[0] * toHost[3] - toHost[1] * toHost[2]));
    const thin = [...this.#elements()].filter((id) => isThin(doc, id) && outlineable(doc, id));
    const hit = thinHit(doc, thin, { x, y }, THIN_PX, scale, this.geo);
    if (hit === null || out.includes(hit)) return out;
    const first = out[0];
    if (first === undefined) return [hit];
    const order = this.#order();
    return (order.get(hit) ?? -1) > (order.get(first) ?? -1) ? [hit, ...out] : [first, hit, ...out.slice(1)];
  }

  *#elements(): Generator<NodeId> {
    const doc = this.#doc!;
    const walk = function* (id: NodeId): Generator<NodeId> {
      const n = doc.nodes.get(id);
      if (n?.kind !== 'element') return;
      yield id;
      for (const c of n.children) yield* walk(c);
    };
    yield* walk(doc.root);
  }

  #order(): Map<NodeId, number> {
    const m = new Map<NodeId, number>();
    let i = 0;
    for (const id of this.#elements()) m.set(id, i++);
    return m;
  }

  #startDrag(g: Gesture, held: boolean): void {
    const doc = this.#doc!;
    if (held || g.target === null) {
      g.mode = 'marquee';
      return;
    }
    // On a selected shape (it or an ancestor is selected) the whole selection moves; on another,
    // it is selected first (added, with Select more or ⇧/⌘), in the same gesture.
    const sel = this.selection.get();
    let selected = false;
    for (let n: NodeId | null = g.target; n !== null; n = doc.nodes.get(n)?.parent ?? null) if (sel.has(n)) selected = true;
    if (!selected) this.select(g.add ? [...sel, g.target] : [g.target]);
    this.focus.set(null);
    if (!this.#writable()) {
      g.mode = 'none';
      return;
    }
    this.#startMove(g, [...this.selection.get()], 'Move');
  }

  // A move: the elements (none inside another that moves, never the root), each parent's host px
  // → its units (from the canvas's own measurement, so a CSS transform on an ancestor still lands
  // under the finger), and one drag for the whole gesture.
  #startMove(g: Gesture, selection: NodeId[], label: string): void {
    g.move = this.#openMove(selection, label);
    g.mode = g.move ? 'move' : 'none';
  }

  // The move's state, or null (a read-only drawing, the root alone, a locked element: the notice
  // says why).
  #openMove(selection: NodeId[], label: string, step?: number): MoveState | null {
    const doc = this.#doc!;
    if (!this.#writable()) return null;
    const ids = selection.filter((id) => id !== doc.root && attached(doc, id) && !selection.some((o) => o !== id && isInside(doc, id, o)));
    if (!ids.length || !this.#session) {
      if (selection.includes(doc.root)) this.notice.set(ROOT_MOVE);
      return null;
    }
    const locked = ids.find((id) => isLocked(doc, id));
    if (locked !== undefined) {
      this.notice.set(LOCKED);
      return null;
    }
    const parents = [...new Set(ids.map((id) => doc.nodes.get(id)!.parent!))];
    const measured = this.#ports.canvas.measure([doc.root, ...parents]);
    const root = measured.get(doc.root)?.toHost ?? (this.#box ? rootToHostMatrix(this.#box, this.#viewport, this.#M) : null);
    const rootInv = root && invert(linear(root));
    if (!root || !rootInv) return null;
    const toParent = new Map<NodeId, Affine | null>();
    for (const p of parents) {
      const m = measured.get(p)?.toHost;
      toParent.set(p, m ? multiply(invert(linear(m)) ?? [0, 0, 0, 0, 0, 0], linear(root)) : null);
    }
    const px = Math.sqrt(Math.abs(root[0] * root[3] - root[1] * root[2]));
    return { drag: this.#session.drag(label), ids, toParent, rootInv, step: step ?? snapStep(px), delta: null, refused: null };
  }

  // The delta from where the pointer went down (so the slop's first 5 px count), in root units,
  // rounded to the snap step.
  #moveFrame(g: Gesture): void {
    const m = g.move!;
    const [rx, ry] = applyM(m.rootInv, g.at.x - g.at0.x, g.at.y - g.at0.y);
    this.#applyMove(m, { x: toStep(rx, m.step), y: toStep(ry, m.step) });
  }

  // Every frame re-plans from the document as it was before the drag (the drag rolls the last
  // frame back first), so rounding never accumulates. A refused element stays; the first reason
  // is the notice.
  #applyMove(m: MoveState, d: Point): void {
    if (m.delta && m.delta.x === d.x && m.delta.y === d.y) return this.#show();
    m.delta = d;
    const doc = this.#doc!;
    const opts = { ctx: this.geo, decimals: stepDecimals(m.step) };
    m.drag.update((apply) => {
      for (const id of m.ids) {
        const t = m.toParent.get(doc.nodes.get(id)!.parent!);
        if (!t) continue;
        const [pdx, pdy] = applyM(t, d.x, d.y);
        const plan: Plan = planMove(doc, id, pdx, pdy, opts);
        if ('refused' in plan) m.refused ??= plan.refused;
        else applyPlan(doc, plan, apply);
      }
    });
    if (m.refused && this.notice.get() !== m.refused) this.notice.set(m.refused);
  }

  #endMove(g: Gesture, commit: boolean): void {
    const m = g.move;
    if (!m) return;
    g.move = null;
    this.#finishMove(m, commit);
  }

  #finishMove(m: MoveState, commit: boolean): void {
    if (commit) m.drag.commit();
    else m.drag.cancel();
    this.#bump();
    this.#changed();
  }

  // ── the arrow keys: a nudge (src/keys.ts) ──────────────────────────────────────────────────

  /**
   * An arrow went down (or repeated): the selection moves (dx, dy) root user units further from
   * where it was when the first arrow went down, re-planned from that document. The drag stays open
   * until nudgeEnd (the last arrow up), so a press-and-hold is one history entry.
   */
  nudge(dx: number, dy: number): void {
    if (!this.#doc || this.#live || this.#gesture) return;
    if (!this.#nudge) {
      const move = this.#openMove([...this.selection.get()], 'Nudge', 1);
      if (!move) return;
      this.#nudge = { move, d: { x: 0, y: 0 } };
    }
    const n = this.#nudge;
    n.d = { x: n.d.x + dx, y: n.d.y + dy };
    this.#applyMove(n.move, n.d);
    this.#show();
  }

  /** The last arrow went up: the nudge is kept as one entry (or, `commit` false, undone). */
  nudgeEnd(commit = true): void {
    const n = this.#nudge;
    if (!n) return;
    this.#nudge = null;
    this.#finishMove(n.move, commit);
    this.#show();
  }

  /** Is a nudge open (an arrow held)? */
  get nudging(): boolean {
    return this.#nudge !== null;
  }

  #endMarquee(g: Gesture): void {
    const r = rectOf(g.at0, g.at);
    if (r.width < SLOP_PX || r.height < SLOP_PX) return;
    const inside = this.#leaves(r);
    const sel = this.selection.get();
    this.focus.set(null);
    this.select(g.add ? [...new Set([...sel, ...inside])] : inside);
  }

  // The leaf shapes a marquee can take (not a container, not a text's own parts), rendered,
  // displayed and not locked, whose screen box lies inside `r` (host px; null: anywhere).
  #leaves(r: Rect | null): NodeId[] {
    const doc = this.#doc!;
    const ids = [...this.#elements()].filter((id) => {
      const n = doc.nodes.get(id);
      return n?.kind === 'element' && id !== doc.root && selectionTarget(doc, id) === id && !CONTAINERS.has(n.local) && !TEXT_PARTS.has(n.local) && displayNone(doc, id) !== true && !isLocked(doc, id);
    });
    const measured = this.#ports.canvas.measure(ids);
    return ids.filter((id) => {
      const m = measured.get(id);
      if (!m) return false;
      if (!r) return true;
      const b = unionBox([quadOf(m.box, m.toHost)])!;
      return b.x >= r.x - 0.5 && b.y >= r.y - 0.5 && b.x + b.width <= r.x + r.width + 0.5 && b.y + b.height <= r.y + r.height + 0.5;
    });
  }

  // The gesture's marks: the marquee, or while moving the tooltip and (for one element) the
  // coordinate guides from the artboard's edges.
  #gestureMarks(model: OverlayModel, paper: Rect): void {
    const g = this.#gesture;
    const doc = this.#doc!;
    if (!g) return;
    if (g.mode === 'marquee') {
      model.marquee = rectOf(g.at0, g.at);
      return;
    }
    const m = g.move;
    if (g.mode !== 'move' || !m || !m.delta) return;
    const measured = this.#ports.canvas.measure(m.ids);
    const quads = m.ids.flatMap((id) => {
      const x = measured.get(id);
      return x ? [quadOf(x.box, x.toHost)] : ([] as Quad[]);
    });
    const u = unionBox(quads);
    if (!u) return;
    const centre = { x: u.x + u.width / 2, y: u.y + u.height / 2 };
    const box = this.#box!;
    const inv = invert(rootToHostMatrix(box, this.#viewport, this.#M));
    if (!inv) return;
    const [cx, cy] = applyM(inv, centre.x, centre.y);
    const dec = stepDecimals(m.step);
    let text = `x ${fmt(cx, dec)}, y ${fmt(cy, dec)}`;
    if (m.ids.length === 1 && movesBy(doc, m.ids[0]) === 'translate') {
      const raw = attrValueOf(doc, m.ids[0], 'transform');
      const first = raw === null ? null : parseTransform(raw)?.items[0];
      if (first?.fn === 'translate') text = `translate(${fmt(first.args[0], 3)} ${fmt(first.args[1] ?? 0, 3)})`;
    }
    model.tip = tip(text, g.at);
    if (m.ids.length === 1) model.coords = coordGuides(centre, paper, { x: cx, y: cy }, dec, this.#size.width);
  }

  // ── history ────────────────────────────────────────────────────────────────────────────────

  undo(): void {
    if (this.#live || !this.#session?.canUndo || !this.#writable()) return;
    this.#session.undo();
  }

  redo(): void {
    if (this.#live || !this.#session?.canRedo || !this.#writable()) return;
    this.#session.redo();
  }

  // A read-only document refuses every edit, and says why.
  #writable(): boolean {
    if (!this.readOnly.get()) return true;
    this.notice.set(READ_ONLY);
    return false;
  }

  /** Run one named transaction; a refused edit becomes the notice and changes nothing. */
  #dispatch(label: string, build: Build): boolean {
    if (!this.#session || this.#live || this.#gesture?.move || this.#nudge || !this.#writable()) return false;
    try {
      this.#session.dispatch(label, build);
      return true;
    } catch (e) {
      if (!(e instanceof TokenEditError)) throw e;
      this.notice.set(e.message);
      return false;
    }
  }

  // ── tokens: taps, scrubs, the Scrub strip and the sheets ─────────────────────────────────────

  /** The engine token behind a code view token, and a reference to it. */
  #resolve(block: ViewBlock, token: ViewToken): { bt: BlockToken; ref: TokenRef } | null {
    const doc = this.#doc;
    const b = this.#blocks.get(block.key);
    const bt = b?.tokens.find((t) => t.start === token.start && t.end === token.end);
    const ref = doc && bt ? refOf(doc, b!.node, bt.target, bt.token) : null;
    return bt && ref ? { bt, ref } : null;
  }

  /**
   * A tap on a token: a number focuses the Scrub strip, a colour or text opens its sheet, a
   * keyword moves to its next option, and a reference selects what it names. The token's element
   * is selected too, so the canvas shows what is being edited.
   */
  tapToken(block: ViewBlock, token: ViewToken): void {
    const doc = this.#doc;
    if (!doc || this.#live) return;
    const hit = this.#resolve(block, token);
    if (!hit) return;
    const { ref, bt } = hit;
    const t = bt.token;
    this.focus.set(null);
    const own = elementOf(doc, ref.node);
    if (t.kind !== 'ref' && own !== null) this.select([own]);
    if (t.kind !== 'ref' && !this.#writable()) return; // read-only: plain text, and a tap says why
    switch (t.kind) {
      case 'number':
        this.focus.set({ ref, token: t });
        return;
      case 'enum':
        this.#dispatch(labelFor('Set', t), (apply) => apply(tokenOp(doc, ref, nextOption(t))));
        return;
      case 'color':
        return this.#openSheet({ kind: 'color', ref, token: t });
      case 'text':
        return this.#openSheet({ kind: 'text', ref, token: t });
      case 'ref': {
        const target = buildRefIndex(doc).ids.get(t.id)?.[0];
        if (target === undefined) this.notice.set(`Nothing here has the id "${t.id}"`);
        else this.select([target]);
      }
    }
  }

  /** The Scrub strip's −, + (steps) and ± keys: one history entry each. */
  stepFocus(steps: number): void {
    const f = this.focus.get();
    const doc = this.#doc;
    if (!f || !doc) return;
    this.#dispatch(labelFor('Step', f.token), (apply) => apply(tokenOp(doc, f.ref, stepped(f.token, steps))));
  }

  /**
   * A key on a focused token: Enter or Space does what a tap does (a number opens its Number
   * sheet), and an arrow steps a number (one history entry each, and the Scrub strip follows it).
   */
  keyToken(block: ViewBlock, token: ViewToken, key: TokenKey): void {
    const doc = this.#doc;
    if (!doc || this.#live) return;
    if (key === 'open') {
      this.tapToken(block, token);
      if (this.focus.get()) this.openNumberSheet();
      return;
    }
    const hit = this.#resolve(block, token);
    const t = hit?.bt.token;
    if (!hit || t?.kind !== 'number') return;
    const own = elementOf(doc, hit.ref.node);
    if (own !== null) this.select([own]);
    if (!this.#writable()) return;
    this.focus.set({ ref: hit.ref, token: t });
    this.stepFocus(key === 'up' ? 1 : -1);
  }

  negateFocus(): void {
    const f = this.focus.get();
    const doc = this.#doc;
    if (!f || !doc) return;
    const c = checkNumber(f.token, negated(f.token.text));
    if ('error' in c) return void this.notice.set(c.error);
    this.#dispatch(labelFor('Negate', f.token), (apply) => apply(tokenOp(doc, f.ref, c.text)));
  }

  clearFocus(): void {
    this.focus.set(null);
  }

  /** The Scrub strip's value opens the Number sheet for the focused number. */
  openNumberSheet(): void {
    const f = this.focus.get();
    if (f) this.#openSheet({ kind: 'number', ref: f.ref, token: f.token });
  }

  // A scrub (the code view's sideways drag) is a drag: every frame rewrites the token from its
  // value before the scrub, and the release commits one history entry.
  scrubStart(block: ViewBlock, token: ViewToken): void {
    const doc = this.#doc;
    if (!doc || this.#live || this.#nudge || !this.#session) return;
    const hit = this.#resolve(block, token);
    const t = hit?.bt.token;
    if (!hit || t?.kind !== 'number' || !this.#writable()) return;
    const own = elementOf(doc, hit.ref.node);
    if (own !== null) this.select([own]);
    this.focus.set({ ref: hit.ref, token: t }); // the Scrub strip follows the number being scrubbed
    this.#live = { drag: this.#session.drag(labelFor('Scrub', t)), ref: hit.ref, token: t, last: null };
  }

  scrub(steps: number): void {
    const live = this.#live;
    if (live?.token.kind !== 'number') return;
    this.#write(stepped(live.token, steps));
  }

  scrubEnd(committed: boolean): void {
    this.#endLive(committed);
  }

  #openSheet(sheet: TokenSheet): void {
    if (!this.#session || this.#live || this.#nudge || !this.#writable()) return;
    this.#live = { drag: this.#session.drag(labelFor('Set', sheet.token)), ref: sheet.ref, token: sheet.token, last: null };
    this.sheet.set(sheet);
    this.#bump();
  }

  /**
   * A value typed or picked in the open Number, Color or Text sheet. It is checked against the
   * token first; refused text is never written (the message says why) and the last good value
   * stays. The sheet's edits are one history entry, committed when it closes.
   */
  sheetInput(input: string): Checked {
    const live = this.#live;
    const sheet = this.sheet.get();
    if (!live || !sheet || sheet.kind === 'source') return { error: 'No value is open' };
    const t = live.token;
    const c = t.kind === 'number' ? checkNumber(t, input) : t.kind === 'color' ? checkColor(t, input) : t.kind === 'text' ? checkText(t, input) : { error: 'This value has no sheet' };
    if ('error' in c) return c;
    const why = this.#write(c.text);
    return why ? { error: why } : c;
  }

  /** Close the open sheet (Done, the scrim, Escape): its edits commit as one entry. */
  closeSheet(): void {
    const s = this.sheet.get();
    if (s && s.kind !== 'source') this.#endLive(true);
    this.sheet.set(null);
  }

  // Write one frame of the live drag. A refused edit writes the last good text again.
  #write(text: string): string | null {
    const live = this.#live;
    const doc = this.#doc;
    if (!live || !doc) return 'Nothing is being edited';
    let why: string | null = null;
    live.drag.update((apply) => {
      try {
        apply(tokenOp(doc, live.ref, text));
        live.last = text;
      } catch (e) {
        if (!(e instanceof TokenEditError)) throw e;
        why = e.message;
        if (live.last !== null) apply(tokenOp(doc, live.ref, live.last));
      }
    });
    return why;
  }

  #endLive(commit: boolean): void {
    const live = this.#live;
    if (!live) return;
    this.#live = null;
    if (commit) live.drag.commit();
    else live.drag.cancel();
    this.#bump();
    this.#changed();
  }

  // ── Edit source ────────────────────────────────────────────────────────────────────────────

  /** Is Edit source offered: one element selected, and not the root (which it can't replace yet)? */
  canEditSource(): boolean {
    const ids = [...this.selection.get()];
    return !!this.#doc && ids.length === 1 && ids[0] !== this.#doc.root;
  }

  /** Open the selected element's source (one element, not the root). */
  openSource(): void {
    const doc = this.#doc;
    const ids = [...this.selection.get()];
    if (!doc || this.#live || ids.length !== 1 || !this.#writable()) return;
    if (ids[0] === doc.root) return void this.notice.set('The root <svg> can’t be replaced here yet');
    this.focus.set(null);
    this.sheet.set({ kind: 'source', node: ids[0], text: serializeNode(doc, ids[0]) });
  }

  /**
   * Replace an element with markup, in ONE transaction (remove it, insert what the text parses
   * to at its place), so one undo restores it byte for byte. Markup that doesn't parse, or holds
   * no element, changes nothing and says where.
   */
  applySource(node: NodeId, text: string): SourceError | null {
    const doc = this.#doc;
    const n = doc?.nodes.get(node);
    if (!doc || !n || n.parent === null || !attached(doc, node)) return { message: 'That element is no longer in the document', at: 0, line: 1, column: 1 };
    if (this.readOnly.get()) return { message: READ_ONLY, at: 0, line: 1, column: 1 };
    const parent = n.parent;
    const parsed = parseFragment(doc, parent, text);
    if (!parsed.ok) return { message: parsed.error.message, at: parsed.error.at, ...lineColumn(text, parsed.error.at) };
    const made = parsed.nodes;
    const first = made.find((id) => doc.nodes.get(id)?.kind === 'element');
    if (first === undefined) {
      for (const id of made) forget(doc, id);
      return { message: 'There is no element here to put in its place', at: 0, line: 1, column: 1 };
    }
    const index = el(doc, parent).children.indexOf(node);
    try {
      if (!this.#session || this.#live || this.#nudge) throw new Error('Finish the edit in progress first');
      this.#session.dispatch('Edit source', (apply) => {
        apply(opRemove(doc, node));
        made.forEach((id, i) => apply(opInsert(doc, id, parent, index + i)));
      });
    } catch (e) {
      for (const id of made) forget(doc, id);
      return { message: e instanceof Error ? e.message : String(e), at: 0, line: 1, column: 1 };
    }
    this.sheet.set(null);
    this.select([first]);
    return null;
  }

  closeSource(): void {
    if (this.sheet.get()?.kind === 'source') this.sheet.set(null);
  }

  /** The artboard's larger side (the Number sheet's slider spans from minus it to twice it), or 100. */
  extent(): number {
    const b = this.#board;
    return b && b.width > 0 && b.height > 0 ? Math.max(b.width, b.height) : 100;
  }

  /** Play or pause a drawing that reduced motion opened paused. */
  togglePlay(): void {
    const m = this.motion.get();
    if (m !== 'paused' && m !== 'playing') return;
    this.#ports.canvas.play(m === 'paused');
    this.motion.set(this.#ports.canvas.motion());
  }

  /**
   * A file that isn't well-formed: its text as read-only source in the code, with the error's
   * place marked, and nothing on the canvas. The document that was open closes (as when another
   * opens), and nothing here can be edited until another drawing opens.
   */
  showSource(text: string, at: number): void {
    this.#endLive(false);
    this.#doc = null;
    this.#session = null;
    this.#blocks = new Map();
    this.#board = null;
    this.canvasError.set(null);
    this.sheet.set(null);
    this.focus.set(null);
    this.selection.set(new Set());
    this.#ports.canvas.clear();
    this.#ports.code.source(text, at);
    this.#box = null;
    this.#show();
    this.#bump();
  }

  // ── the view: zoom and pan (the rendered root's own box, never its viewBox or the file) ───────

  /** The root's viewport at 100% (W0 × H0), M (its user units → box px), and the camera box now. */
  get rootBox(): { viewport: Size; M: Affine; box: CameraBox | null } {
    return { viewport: { ...this.#viewport }, M: this.#M, box: this.#box && { ...this.#box } };
  }

  // The root's box at 100% and M, read against the host size the view last fitted (a document
  // opening, a resize while fitted, Fit), and again after an edit of the root's own attributes.
  #measureRoot(): void {
    const doc = this.#doc!;
    this.#viewport = rootViewport(doc, this.#rootHost);
    this.#M = rootTransform(doc, this.#viewport);
  }

  // An edit of the root's viewBox, size or preserveAspectRatio moves the artboard or the box: a
  // fitted view fits it again; a moved view keeps its place and draws the root's box anew.
  #artboardChanged(): void {
    const board = artboard(this.#doc!);
    const same = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
    const was = { viewport: this.#viewport, M: this.#M };
    this.#measureRoot();
    const moved = !same(board, this.#board);
    this.#board = board;
    if (moved && this.#fitted) this.#fitView();
    else if (!moved && was.viewport.width === this.#viewport.width && was.viewport.height === this.#viewport.height && was.M.every((v, i) => v === this.#M[i])) return;
    this.#applyView();
  }

  #fitView(): void {
    const s = this.#size;
    this.#rootHost = { width: Math.max(1, s.width), height: Math.max(1, s.height) };
    this.#measureRoot();
    const vp = this.#viewport;
    this.#view = fit(this.#board ? mapRect(this.#M, this.#board) : { x: 0, y: 0, width: vp.width, height: vp.height }, s, 0);
    this.#fitScale = this.#view.scale;
    this.#fitted = true;
  }

  #applyView(): void {
    const s = this.#size;
    const usable = s.width > 0 && s.height > 0;
    this.#box = usable ? cameraBox(this.#view, s, this.#viewport) : null;
    this.#ports.canvas.setCamera(this.#box && { box: this.#box, viewport: this.#viewport });
    this.#show();
  }

  /** The canvas host changed size: fit again unless the user has moved the view. */
  resize(size: Size): void {
    if (size.width === this.#size.width && size.height === this.#size.height) return;
    const was = this.#size;
    this.#size = size;
    if (!this.#doc) return;
    if (this.#fitted || !(was.width > 0 && was.height > 0)) this.#fitView();
    this.#applyView();
  }

  /** Show the whole artboard again. */
  fitToScreen(): void {
    if (!this.#doc) return;
    this.#fitView();
    this.#applyView();
  }

  /** Zoom by `factor` about a point in the host (wheel, trackpad pinch). */
  zoomAt(at: Point, factor: number): void {
    if (!this.#doc || !(factor > 0) || !Number.isFinite(factor)) return;
    this.#move(zoomAbout(this.#view, this.#size, at, factor, this.#fitScale));
  }

  panBy(dx: number, dy: number): void {
    if (!this.#doc || (!dx && !dy)) return;
    this.#move(panBy(this.#view, dx, dy));
  }

  // The user moved the view. One whose camera would overflow (a viewBox near the float limit, a box
  // too big to draw) can't be drawn, so the view stays where it was.
  #move(next: View): void {
    if (!drawable(next, this.#size, this.#viewport)) return;
    this.#view = next;
    this.#fitted = false;
    this.#applyView();
  }

  /** Two fingers went down: pinches are measured from the view now. */
  navStart(): void {
    this.#navStart = { ...this.#view };
  }

  /** Two fingers moved: from where they started (a0, b0) to where they are (a1, b1), in the host. */
  navigate(a0: Point, b0: Point, a1: Point, b1: Point): void {
    if (!this.#doc || !this.#navStart) return;
    this.#move(pinch(this.#navStart, this.#size, a0, b0, a1, b1, this.#fitScale));
  }

  navEnd(): void {
    this.#navStart = null;
  }

}

/** Screen px within which a tap takes a thin shape (plus half its stroke): SVG Lab's hitThin. */
export const THIN_PX = 22;
const SLOP_PX = 5; // a marquee under this in either direction takes nothing
export const LOCKED = 'It’s locked. Unlock it in Layers first.';
const CONTAINERS = new Set(['g', 'a', 'switch', 'svg']);
const TEXT_PARTS = new Set(['tspan', 'textPath']);

interface MoveState {
  drag: Drag;
  ids: NodeId[];
  toParent: Map<NodeId, Affine | null>; // root units → each parent's units (linear)
  rootInv: Affine; // host px → root units (linear)
  step: number;
  delta: Point | null; // the snapped delta the last frame wrote
  refused: string | null;
}
interface Gesture {
  at0: Point; // host px where the pointer went down
  at: Point;
  target: NodeId | null; // what a tap selects: the topmost hit's selectable element that isn't locked
  add: boolean; // Select more, or ⇧/⌘ on the press
  mode: 'pending' | 'move' | 'marquee' | 'none';
  move: MoveState | null;
}

const linear = (m: Affine): Affine => [m[0], m[1], m[2], m[3], 0, 0];
const rectOf = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });

function isInside(doc: Doc, id: NodeId, ancestor: NodeId): boolean {
  for (let n = doc.nodes.get(id)?.parent ?? null; n !== null; n = doc.nodes.get(n)?.parent ?? null) if (n === ancestor) return true;
  return false;
}

function attrValueOf(doc: Doc, id: NodeId, local: string): string | null {
  const n = doc.nodes.get(id);
  return n?.kind === 'element' ? attrValue(doc, n, null, local) : null;
}

const sameTarget = (a: TokenTarget, b: TokenTarget): boolean =>
  'attr' in a ? 'attr' in b && a.attr.ns === b.attr.ns && a.attr.local === b.attr.local : !('attr' in b);

// Take nodes made by parseFragment out of the document again (nothing referenced them yet).
function forget(doc: Doc, id: NodeId): void {
  const n = doc.nodes.get(id);
  if (n?.kind === 'element') for (const c of n.children) forget(doc, c);
  doc.nodes.delete(id);
}
