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

import { NS, el, parseDoc, serialize, serializeNode, type Doc, type NodeId } from '../../../engine/model/doc.ts';
import { parseFragment } from '../../../engine/model/fragment.ts';
import { buildRefIndex } from '../../../engine/model/refs.ts';
import { opInsert, opRemove, type ChangeSet } from '../../../engine/commands/ops.ts';
import { Session, type Build, type Drag } from '../../../engine/commands/session.ts';
import { blockFor, codeBlocks, type Block, type BlockToken } from '../../../engine/code/blocks.ts';
import { TokenEditError, type TokenTarget } from '../../../engine/code/edit.ts';
import type { ColorToken, NumberToken, TextToken, Token } from '../../../engine/code/tokens.ts';
import { createStore, type Store } from './panels/store.ts';
import { attached, route, type Route } from './routing.ts';
import { elementOf, outlineable, selectionTarget } from './selectable.ts';
import { blockKey, viewBlock } from './codeview/blocks.ts';
import type { FocusMark, TokenKey, ViewBlock, ViewToken } from './codeview/code-view.ts';
import { artboard, rootViewport } from './canvas/artboard.ts';
import { cameraBox, drawable, fit, panBy, pinch, zoomAbout, type Point, type Rect, type Size, type View } from './canvas/viewport.ts';
import type { Camera, Motion, RenderStats } from './canvas/renderer.ts';
import { rootTransform } from '../../../engine/geometry/ctm.ts';
import { mapRect } from '../../../engine/geometry/bounds.ts';
import { IDENTITY, type Affine } from '../../../engine/values/affine.ts';
import { EMPTY, gridModel, gridStep, paperRect, quadOf, type CameraBox, type OverlayModel } from './interact/overlay-model.ts';
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

  constructor(ports: EditorPorts) {
    this.#ports = ports;
    this.focus.subscribe(() => this.#markFocus());
    this.readOnly.subscribe(() => this.#ports.code.readOnly(this.readOnly.get()));
    this.grid.subscribe(() => this.#show());
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
    let r: Route = { attrs: [], subtrees: [], code: { reset: false, blocks: [] } };
    session.subscribe((cs: ChangeSet) => {
      r = route(session.doc, cs);
      if (cs.attrs.has(session.doc.root)) this.#artboardChanged();
      const canvas = this.#ports.canvas;
      if (this.canvasError.get() !== null) return this.#redraw(); // it failed before: the whole drawing, again
      try {
        for (const id of r.subtrees) canvas.patchSubtree(id);
        for (const id of r.attrs) canvas.patchAttributes(id);
      } catch {
        this.#redraw();
      }
    });
    session.subscribe(() => {
      if (r.code.reset) return this.#resetCode();
      for (const id of r.code.blocks) this.#patchCode(id);
    });
    session.subscribe(() => {
      const kept = [...this.selection.get()].filter((id) => attached(session.doc, id));
      if (kept.length !== this.selection.get().size) this.selection.set(new Set(kept));
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
    this.#show();
  }

  /** A tap on the canvas: `hit` is the drawn node under it (null: nothing drawn there). */
  tapCanvas(hit: NodeId | null): void {
    if (!this.#doc || this.#live) return;
    this.focus.set(null);
    const target = selectionTarget(this.#doc, hit);
    this.select(target === null ? [] : [target]);
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
    return { ...EMPTY, paper, grid: this.grid.get() ? gridModel(box, vp, this.#M, this.#size, paper, this.gridStep()) : null, outlines };
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
    if (!this.#session || this.#live || !this.#writable()) return false;
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
    if (!doc || this.#live || !this.#session) return;
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
    if (!this.#session || this.#live || !this.#writable()) return;
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
      if (!this.#session || this.#live) throw new Error('Finish the edit in progress first');
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

const sameTarget = (a: TokenTarget, b: TokenTarget): boolean =>
  'attr' in a ? 'attr' in b && a.attr.ns === b.attr.ns && a.attr.local === b.attr.local : !('attr' in b);

// Take nodes made by parseFragment out of the document again (nothing referenced them yet).
function forget(doc: Doc, id: NodeId): void {
  const n = doc.nodes.get(id);
  if (n?.kind === 'element') for (const c of n.children) forget(doc, c);
  doc.nodes.delete(id);
}
