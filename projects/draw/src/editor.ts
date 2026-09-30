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
// - The Shapes tool (P1-M2): with it on, a tap places SVG Lab's default shape and a drag draws one,
//   snapped as a dragged corner is; the new shape is selected and the tool returns to Select.
// - Generated shapes (engine/generators/): the Session's finish hook regenerates or detaches them in
//   the same transaction as the edit, and a notice says when one became a plain shape.
// - Style (P1-M2, engine/style/): Inspect writes a value over the whole selection where each
//   element holds it, in one entry; a segment is one dispatch, a slider one drag per press, a field
//   one drag while it has focus, and the style sheet (the Colour sheet over the selection) one drag
//   per visit. Elements a <style> rule decides are left as they are, and one notice names them.

import { NS, attrValue, el, parseDoc, serialize, serializeNode, type Doc, type ElementNode, type NodeId } from '../../../engine/model/doc.ts';
import { parseFragment } from '../../../engine/model/fragment.ts';
import { buildRefIndex } from '../../../engine/model/refs.ts';
import { opInsert, opRemove, opSetAttr, opSetAttrRaw, type ChangeSet, type Op } from '../../../engine/commands/ops.ts';
import { REM_UNCONVERTIBLE } from '../../../engine/report/import-report.ts';
import { hasRem, remToUserUnits, rootFontSize } from '../../../engine/geometry/lengths.ts';
import { Session, type Build, type Drag } from '../../../engine/commands/session.ts';
import { blockFor, blocksOf, codeBlocks, endBlockFor, type Block, type BlockToken } from '../../../engine/code/blocks.ts';
import { TokenEditError, rewriteNumbers, type TokenTarget } from '../../../engine/code/edit.ts';
import type { ColorToken, NumberToken, TextToken, Token } from '../../../engine/code/tokens.ts';
import { createStore, type Store } from './panels/store.ts';
import { attached, route, type Route } from './routing.ts';
import { elementOf, outlineable, selectionTarget } from './selectable.ts';
import { blockKey, keyOrder, mixes, subtreeKeys, viewBlock } from './codeview/blocks.ts';
import type { FocusMark, Placement, TokenKey, ViewBlock, ViewToken } from './codeview/code-view.ts';
import { artboard, rootViewport } from './canvas/artboard.ts';
import { cameraBox, drawable, fit, panBy, pinch, zoomAbout, type Point, type Rect, type Size, type View } from './canvas/viewport.ts';
import type { Camera, Motion, RenderStats } from './canvas/renderer.ts';
import { rootTransform, transformOrigin } from '../../../engine/geometry/ctm.ts';
import { mapRect } from '../../../engine/geometry/bounds.ts';
import { IDENTITY, type Affine } from '../../../engine/values/affine.ts';
import { EMPTY, coordGuides, gradientGuides, gridModel, gridStep, localGridModel, paperRect, quadOf, rootToHostMatrix, tip, unionBox, type CameraBox, type Handle, type Line, type OverlayModel, type Quad } from './interact/overlay-model.ts';
import { SNAP_ALL, SNAP_PX, boxTargets, snapAxis, snapStep, stepDecimals, toStep, type SnapPrefs, type SnapTargets } from './interact/snap.ts';
import { applyPlan, movesBy, planMove, planResize, planRotate, planScale, rotationOf, scaleOf, ROOT_MOVE, type Corner, type Plan } from '../../../engine/geometry/write.ts';
import { handlesFor, handlesForMany, magneticAngle, pickHandle, scaleStep } from './interact/handles.ts';
import { documentOrder, isThin, thinHit } from '../../../engine/geometry/hit.ts';
import { duplicate, group, groupRefusal, groupsOf, remove, restack, ungroup, ungroupRefusal, ROOT_DELETE } from './interact/structure.ts';
import { alignDeltas, distributeDeltas, type AlignKind } from './interact/align.ts';
import { displayNone } from '../../../engine/geometry/bounds.ts';
import type { GeoContext } from '../../../engine/geometry/ctm.ts';
import { MAX_GUIDES, NO_STATE, declare, hiddenGuides, isLocked, moveGuide, readState, setDrawAttr, writeState, type DrawState } from '../../../engine/model/draw-state.ts';
import { DRAW_NS } from '../../../engine/model/draw-ns.ts';
import { detachGenerator, finishGenerators, generatorOf, type GeneratorKind } from '../../../engine/generators/index.ts';
import { planShapeHandle, shapeHandleLabel, shapeHandles } from '../../../engine/geometry/shape-handles.ts';
import { insertMarkup } from '../../../engine/model/space.ts';
import { INPUT_UI, SHAPE_LABELS, boardScale, drawMarkup, placeMarkup, shapeColour, type ShapeCtx, type ShapeKind } from './interact/shapes-tool.ts';
import { cssSets, styleNamesId } from '../../../engine/geometry/css.ts';
import { idsInUse, renameIdsIn } from '../../../engine/model/ids.ts';
import { idError } from '../../../engine/code/edit.ts';
import { apply as applyM, invert, multiply, translate as shift } from '../../../engine/values/affine.ts';
import { itemMatrix, parseTransform } from '../../../engine/values/transform.ts';
import { fmt } from '../../../engine/values/number-format.ts';
import { checkColor, checkNumber, checkText, labelFor, negated, nextOption, refOf, stepped, tokenAt, tokenOp, type Checked, type TokenRef } from './token-edit.ts';
import { planStyle, ruleWhy, type StyleCtx } from '../../../engine/style/write.ts';
import { shownValue, styleSource } from '../../../engine/style/where.ts';
import { checkStyle } from './style-edit.ts';
import { GRADIENT_LABELS, gradientHandles, planGradientHandle, type GradientGeo, type GradientHandleId } from '../../../engine/paint/handles.ts';
import { LAB_A, gradientAttrOp, gradientUsers, makeUnique as makeUniqueCopy, ownPaint, resolveGradient, setGradientPaint, setPlainPaint, sharedWith, stopColour, valueOf, type PaintProp } from '../../../engine/paint/gradients.ts';
import { addStop as addStopAfter, offsetOp, removeStop as removeStopOf, stopOffset } from '../../../engine/paint/stops.ts';
import { glossOf, glossOff, glossOn, glossable } from '../../../engine/paint/gloss.ts';
import { nearestViewport, viewportSize } from '../../../engine/geometry/ctm.ts';
import { parsePaint } from '../../../engine/values/color.ts';
import { elementLabel } from './panels/label.ts';

// ── ports: what the editor drives ──────────────────────────────────────────────────────────────

/** An element as the canvas measures it: its box in its own units, and those units → host px. */
export interface Measured {
  box: Rect;
  toHost: Affine;
  /** Hidden by visibility (hidden or collapse): drawn as nothing, so marquees and Select all pass it by, as a tap does. */
  hidden?: boolean;
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
  /** Put each placement's blocks (a node placed or moved, with everything under it) before the block keyed `before` (one placed in the same call, maybe), or at the end: one call per change. */
  place(placements: readonly Placement[]): void;
  /** Take these blocks away: one call per change. */
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
  | { kind: 'source'; node: NodeId; text: string }
  /** The Colour sheet over the selection for a style property (Inspect's swatches, More's Fill… and Stroke…). */
  | { kind: 'style'; prop: string; ids: NodeId[]; text: string };
type TokenSheet = Extract<Sheet, { ref: TokenRef }>;

/** What Inspect shows for a style property over the selection (engine/style/where.ts shownValue). */
export interface StyleRow {
  /** The first selected element's value as written where it comes from ('' when a <style> rule may decide it). */
  value: string;
  /** The selected elements show different values ("Mixed"). */
  mixed: boolean;
  /** Where the first one's comes from: its own, an ancestor's, the default, or a <style> rule's. */
  from: 'own' | 'ancestor' | 'default' | 'rule';
  /** What Inspect says about it: '', "from <g#badge>", "default", "set by a <style> rule". */
  note: string;
  /** When a <style> rule decides it for every selected element: why nothing can be written (the control is disabled). */
  disabled: string | null;
}

/** What Inspect shows about a paint of the first selected element (P1-M2 S3; editor.paintInfo). */
export interface PaintInfo {
  kind: 'none' | 'color' | 'linear' | 'radial' | 'other';
  gradient: NodeId | null; // the gradient its own url(#…) names
  gloss: boolean; // SVG Lab's gloss (a fill only)
  shared: number; // the other shapes that draw with what an edit here writes
  stops: { id: NodeId; offset: number; colour: string; opacity: string }[];
  spread: string;
  units: 'Box' | 'User space';
  fx: string | null; // a radial gradient's, as written (null: not written)
  fy: string | null;
  fr: string | null;
  handles: string | null; // why Edit on canvas can't show its handles, or null
  /**
   * The element's own paint names a gradient, but a <style> rule decides what draws: why the gradient
   * section edits nothing (the P2 notice, shown instead of its controls). Else null.
   */
  ruled: string | null;
}
export const NO_GLOSS = 'Gloss is for rectangles, circles, ellipses, polygons, polylines and paths.';

const NO_STATS: RenderStats = { rendered: 0, skippedElements: 0, droppedAttributes: 0 };
export const READ_ONLY = 'This drawing is open in another tab, so it is read-only here';
const NO_HISTORY: HistoryState = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null };

/** 1-based line and column of an offset (CRLF, CR and LF each end a line). */
export function lineColumn(text: string, at: number): { line: number; column: number } {
  const lines = text.slice(0, at).split(/\r\n|\r|\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

// A drag held open on the history: a code token's scrub or sheet, or a style edit (a slider's
// press, or a style sheet's visit).
interface TokenLive {
  kind: 'token';
  drag: Drag;
  ref: TokenRef;
  token: Token; // as it read before the drag: every frame starts from there
  last: string | null; // the last text written, kept when a later one is refused
}
interface StyleLive {
  kind: 'style';
  drag: Drag;
  prop: string;
  ids: NodeId[];
  last: Map<string, string>; // each property's last good value in this drag (the stroke sheet's width joins its stroke)
  refused: { id: NodeId; why: string }[]; // the last frame's
}
type Live = TokenLive | StyleLive;

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
  /** What moves and handles snap to (the Snap sheet's toggles, a device preference). */
  readonly snap: Store<SnapPrefs> = createStore<SnapPrefs>(SNAP_ALL);
  /** The tool: Select, or Shapes (a tap places, a drag draws); Select again after each shape. */
  readonly tool: Store<Tool> = createStore<Tool>('select');
  /** The Shapes tool's kind, kept for the session (never in the file or storage). */
  readonly shapeKind: Store<ShapeKind> = createStore<ShapeKind>('rect');
  /** Edit on canvas (P1-M2): the paint of the one selected element whose gradient handles the overlay shows instead of the shape's; off when the selection changes. */
  readonly editGradient: Store<PaintProp | null> = createStore<PaintProp | null>(null);
  #shapes = 0; // shapes placed or drawn since the document opened: the colour cycle's n
  #detached: NodeId[] = []; // what the finish hook detached in the latest run (the notice, after a commit)
  #field: FieldSession | null = null; // an Inspect field being typed in: one entry while it has focus
  #nudge: { move: MoveState; d: Point } | null = null; // arrows held (keys.ts)
  #stepDrag: { drag: Drag; from: DrawState } | null = null; // the Snap sheet's Grid step field, while it is being typed in

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
      if (this.editGradient.get() !== null) this.editGradient.set(null); // Edit on canvas ends with the selection
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
    this.#stepDrag = null; // the field's entry belonged to the document that is closing
    this.#field = null;
    const canvas = this.#ports.canvas;
    try {
      canvas.render(doc);
    } catch (e) {
      return { ok: false, error: String(e), ...NO_STATS };
    }
    this.#doc = doc;
    this.canvasError.set(null);
    this.#session = new Session(doc, { finish: (d, ops, apply) => void (this.#detached = finishGenerators(d, ops, apply)) });
    this.#detached = [];
    this.#shapes = 0;
    this.tool.set('select');
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
      const memo = new Map<NodeId, boolean>(); // one change: each parent's mixed content is read once
      for (const id of r.code.blocks) this.#patchCode(id, memo);
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
   * gets an end tag). Every other block keeps its DOM node. Whatever goes is one removal and
   * whatever comes is one placement, so a change that moves 2,000 nodes is two calls, not 4,000.
   * False when a block can't be placed, or when a moved leaf of real text changes how its parent's
   * other blocks flow (mixed content): the listing is then rebuilt.
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
    const gone: string[] = [];
    for (const id of moved) for (const k of subtreeKeys(doc, id)) if (this.#blocks.delete(k)) gone.push(k);
    // A parent left with no end tag (it closes itself again) loses its end block.
    const live = parents.filter((p) => attached(doc, p) && doc.nodes.get(p)?.kind === 'element');
    for (const p of live) {
      const key = blockKey(p, 'end');
      if (!endBlockFor(doc, p) && this.#blocks.delete(key)) gone.push(key);
    }
    if (gone.length) code.remove(gone);
    const memo = new Map<NodeId, boolean>();
    const placements: Placement[] = [];
    for (const id of moved) {
      if (!attached(doc, id)) continue;
      const blocks = blocksOf(doc, id);
      const last = blockKey(blocks[blocks.length - 1].node, blocks[blocks.length - 1].part);
      if (!index.has(last)) return false;
      const before = next(last);
      for (const b of blocks) this.#blocks.set(blockKey(b.node, b.part), b);
      placements.push({ blocks: blocks.map((b) => viewBlock(doc, b, memo)), before });
    }
    const patches: ViewBlock[] = [];
    for (const p of live) {
      const end = endBlockFor(doc, p);
      if (!end) continue;
      const key = blockKey(p, 'end');
      if (this.#blocks.has(key)) patches.push(viewBlock(doc, end, memo));
      else placements.push({ blocks: [viewBlock(doc, end, memo)], before: next(key) });
      this.#blocks.set(key, end);
    }
    if (placements.length) code.place(placements);
    for (const p of live) this.#patchCode(p, memo);
    for (const b of patches) code.patch(b);
    code.select(this.selection.get());
    return true;
  }

  #patchCode(id: NodeId, memo?: Map<NodeId, boolean>): void {
    const doc = this.#doc!;
    if (!doc.nodes.has(id)) return;
    const b = blockFor(doc, id);
    const key = blockKey(b.node, b.part);
    if (!this.#blocks.has(key)) return; // not in the listing (detached)
    this.#blocks.set(key, b);
    this.#ports.code.patch(viewBlock(doc, b, memo));
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
    const gv = this.#gradientView(ids, measured);
    if (gv && !('refused' in gv.out)) model.gradient = gradientGuides(gv.out.marks);
    const hs = this.#handleSet(ids, measured, outlines.map((o) => o.quad), gv);
    model.handles = hs.handles;
    model.rotGuide = hs.rotGuide;
    model.guides = this.#guideMarks();
    // One transformed element: its own grid, through its CTM.
    const one = ids.length === 1 ? measured.get(ids[0]) : undefined;
    const own = one && attrValueOf(doc, ids[0], 'transform');
    const list = own ? parseTransform(own) : null;
    if (one && list && list.items.length && !isIdentity(list.matrix)) {
      const lg = localGridModel(one.box, one.toHost);
      model.localGrid = { lines: lg.lines, axes: lg.axes, labels: lg.labels };
    }
    this.#gestureMarks(model, paper, measured);
    return model;
  }

  /** The grid's step in the root's user units: the Snap sheet's, else the smallest 1-2-5 step at least 12 px apart. */
  gridStep(): number {
    const chosen = this.#doc ? readState(this.#doc).grid : null;
    if (chosen) return chosen; // the Snap sheet's step, kept in the file
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
    if (!doc || this.#live || this.#gesture || this.#nudge || this.#field) return;
    // The Shapes tool: every one-finger gesture places or draws, never selects or moves.
    if (this.tool.get() === 'shapes') {
      if (!this.#writable()) return;
      this.#gesture = { at0: at, at, target: null, onLocked: false, add: false, mode: 'pending', move: null, handle: null, handleAt: null, hd: null, snapLines: [], guide: null, gd: null, draw: { kind: this.shapeKind.get(), step: this.#rootStep(), targets: null, a: null, drag: null, id: null, tip: null } };
      return;
    }
    const all = this.#withThin(at, hits);
    const targets = all.map((id) => selectionTarget(doc, id)).filter((t): t is NodeId => t !== null);
    const target = targets.find((t) => !isLocked(doc, t)) ?? null;
    // A guide's pill, then a handle within 26 px, take the press before any shape does.
    const model = this.overlayModel();
    const pill = pickPill(model.guides, at);
    const picked = pill === null ? pickHandle(model.handles, at) : null;
    const onLocked = targets.length > 0 && isLocked(doc, targets[0]);
    this.#gesture = { at0: at, at, target, onLocked, add: mods.add || this.selectMore.get(), mode: 'pending', move: null, handle: picked?.id ?? null, handleAt: picked?.at ?? null, hd: null, snapLines: [], guide: pill, gd: null, draw: null };
  }

  /** The pointer moved past the slop (the first call starts the drag; `held`: after a hold). */
  pointerDrag(at: Point, held = false): void {
    const g = this.#gesture;
    if (!g || !this.#doc) return;
    g.at = at;
    if (g.draw) return this.#drawFrame(g);
    if (g.mode === 'pending') this.#startDrag(g, held);
    if (g.mode === 'move') this.#moveFrame(g);
    else if (g.mode === 'handle') this.#handleFrame(g);
    else if (g.mode === 'guide') this.#guideFrame(g);
    else this.#show();
  }

  /** The pointer lifted: a tap, or the end of a drag (one history entry for a move). */
  pointerUp(at: Point): void {
    const g = this.#gesture;
    if (!g) return;
    g.at = at;
    this.#gesture = null;
    if (g.draw) this.#endDraw(g, true);
    else if (g.mode === 'pending') {
      if (g.handle === null && g.guide === null) this.#tap(g.target, g.add); // a tap on a handle or a pill does nothing in M1
    } else if (g.mode === 'move') this.#endMove(g, true);
    else if (g.mode === 'handle') this.#endHandle(g, true);
    else if (g.mode === 'guide') this.#endGuide(g, true);
    else if (g.mode === 'marquee') this.#endMarquee(g);
    this.#show();
  }

  /** Another finger or the Pencil took over: a move is undone, a marquee disappears. */
  pointerCancel(): void {
    const g = this.#gesture;
    if (!g) return;
    this.#gesture = null;
    if (g.draw) this.#endDraw(g, false);
    else if (g.mode === 'move') this.#endMove(g, false);
    else if (g.mode === 'handle') this.#endHandle(g, false);
    else if (g.mode === 'guide') this.#endGuide(g, false);
    this.#show();
  }

  /** Is a pointer gesture, a scrub or a nudge under way (Escape cancels one)? */
  get busy(): boolean {
    return !!this.#live || !!this.#gesture?.move || !!this.#gesture?.hd || !!this.#gesture?.gd || !!this.#gesture?.draw?.drag || !!this.#nudge || !!this.#field;
  }

  /** Escape: cancel a live drag if one is running, else leave the Shapes tool, else deselect. */
  escape(): void {
    if (this.#gesture) return this.pointerCancel();
    if (this.#live) return this.#endLive(false);
    if (this.#nudge) return this.nudgeEnd(false);
    if (this.tool.get() === 'shapes') return this.pickTool('select');
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

  /** Duplicate the selection: each copy just after its original, 5 units right and down, selected. */
  duplicate(): void {
    const doc = this.#doc;
    if (!doc || this.#live || this.#gesture) return;
    const ids = this.#acted([...this.selection.get()].filter((id) => id !== doc.root));
    if (!ids?.length) return;
    let copies: NodeId[] = [];
    const refused: string[] = [];
    const toParent = this.#rootDeltas(ids); // a copy's parent is its original's
    const ok = this.#dispatch('Duplicate', (apply) => {
      copies = duplicate(doc, ids, apply);
      const opts = { ctx: this.geo, decimals: 3 };
      for (const c of copies) {
        const d = toParent(c, { x: 5, y: 5 });
        const plan = d ? planMove(doc, c, d.x, d.y, opts) : { refused: 'Draw can’t tell where it is.' };
        if ('refused' in plan) refused.push(plan.refused);
        else applyPlan(doc, plan, apply);
      }
    });
    if (!ok) return;
    this.select(copies);
    if (refused.length) this.notice.set(`Duplicated in place: ${refused[0]}`);
  }

  /** Group the selection (one parent) in a new <g>, which is then selected. */
  group(): void {
    const doc = this.#doc;
    if (!doc || this.#live || this.#gesture) return;
    const sel = [...this.selection.get()];
    const order = documentOrder(doc);
    const ids = outermost(doc, sel).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const why = groupRefusal(doc, ids);
    if (why) return void this.notice.set(why);
    let g: NodeId | null = null;
    if (this.#dispatch('Group', (apply) => (g = group(doc, ids, apply)))) this.select([g!]);
  }

  /** Ungroup the selected group: its children take its place, its transform pushed down to each. */
  ungroup(): void {
    const doc = this.#doc;
    const sel = [...this.selection.get()];
    if (!doc || this.#live || this.#gesture || sel.length !== 1) return void (doc && sel.length !== 1 && this.notice.set('Select one group to ungroup.'));
    const why = ungroupRefusal(doc, sel[0]);
    if (why) return void this.notice.set(why);
    let kids: NodeId[] = [];
    if (this.#dispatch('Ungroup', (apply) => (kids = ungroup(doc, sel[0], apply)))) this.select(kids);
  }

  /** Select group: each selected element's nearest container that isn't the root. */
  selectGroup(): void {
    const doc = this.#doc;
    if (!doc || this.#live || this.#gesture) return;
    this.focus.set(null);
    this.select(groupsOf(doc, [...this.selection.get()]));
  }

  /** Align the selection (two or more: to their union box; one: to the artboard), one entry. */
  align(kind: AlignKind): void {
    const names: Record<AlignKind, string> = { left: 'Align left', center: 'Align centre', right: 'Align right', top: 'Align top', middle: 'Align middle', bottom: 'Align bottom' };
    this.#arrange(names[kind], (boxes) => {
      const to = boxes.length > 1 ? unionRect(boxes) : this.#board;
      return to ? alignDeltas(boxes, to, kind) : null;
    });
  }

  /** Distribute three or more: the first and last stay, the gaps between them become equal. */
  distribute(axis: 'h' | 'v'): void {
    this.#arrange(axis === 'h' ? 'Distribute horizontally' : 'Distribute vertically', (boxes) => (boxes.length >= 3 ? distributeDeltas(boxes, axis) : null));
  }

  // Align and distribute: the selection's boxes as the canvas measures them (root units), the
  // deltas, then each move through the planner, exactly (3 places). Refused ones stay and are named.
  #arrange(label: string, deltas: (boxes: Rect[]) => Point[] | null): void {
    const doc = this.#doc;
    const box = this.#box;
    if (!doc || !box || this.#live || this.#gesture) return;
    const ids = this.#acted([...this.selection.get()].filter((id) => id !== doc.root));
    if (!ids?.length) return;
    const inv = invert(rootToHostMatrix(box, this.#viewport, this.#M));
    const measured = this.#ports.canvas.measure(ids);
    const have = ids.filter((id) => measured.has(id));
    if (!inv || !have.length) return;
    const boxes = have.map((id) => rectInRoot(inv, unionBox([quadOf(measured.get(id)!.box, measured.get(id)!.toHost)])!));
    const ds = deltas(boxes);
    if (!ds) return void this.notice.set(label.startsWith('Distribute') ? 'Distribute needs three shapes or more.' : 'There is nothing to align to.');
    const refused: string[] = [];
    const toParent = this.#rootDeltas(have);
    this.#dispatch(label, (apply) => {
      const opts = { ctx: this.geo, decimals: 3 };
      have.forEach((id, i) => {
        if (Math.abs(ds[i].x) < 1e-9 && Math.abs(ds[i].y) < 1e-9) return;
        const d = toParent(id, ds[i]);
        const plan = d ? planMove(doc, id, d.x, d.y, opts) : { refused: 'Draw can’t tell where it is.' };
        if ('refused' in plan) refused.push(elementName(doc, id));
        else applyPlan(doc, plan, apply);
      });
    });
    if (refused.length) this.notice.set(`${refused.length} shape${refused.length === 1 ? '' : 's'} couldn’t move: ${refused.join(', ')}`);
  }

  // A delta in root user units, in an element's parent's units (through the canvas's measurements),
  // for these elements (and any with the same parents): the root and each parent measured once for
  // the whole command, not once per element.
  #rootDeltas(ids: readonly NodeId[]): (id: NodeId, d: Point) => Point | null {
    const doc = this.#doc!;
    const parents = [...new Set(ids.map((id) => doc.nodes.get(id)!.parent!))].filter((p) => p !== doc.root);
    const m = this.#ports.canvas.measure([doc.root, ...parents]);
    const root = m.get(doc.root)?.toHost ?? (this.#box ? rootToHostMatrix(this.#box, this.#viewport, this.#M) : null);
    return (id, d) => {
      const parent = doc.nodes.get(id)!.parent!;
      const p = parent === doc.root ? root : m.get(parent)?.toHost;
      const inv = p && invert(linear(p));
      if (!root || !inv) return null;
      const [x, y] = applyM(multiply(inv, linear(root)), d.x, d.y);
      return { x, y };
    };
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
    const ids = outermost(doc, sel).filter((id) => id !== doc.root && order.has(id));
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
    if (!held && g.guide !== null) return this.#startGuide(g);
    if (!held && g.handle !== null) return this.#startHandle(g);
    if (held || g.target === null || g.onLocked) {
      g.mode = 'marquee'; // a drag from a locked shape is a marquee, whatever is under it
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
    const ids = outermost(doc, selection).filter((id) => id !== doc.root && attached(doc, id));
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
      const m = p === doc.root ? root : measured.get(p)?.toHost; // the root's own units are the camera's, measured or not
      toParent.set(p, m ? multiply(invert(linear(m)) ?? [0, 0, 0, 0, 0, 0], linear(root)) : null);
    }
    const px = Math.sqrt(Math.abs(root[0] * root[3] - root[1] * root[2]));
    // What snaps (a pointer's move, not a nudge): the moving box, in root units, and the targets.
    let box: Rect | null = null;
    if (step === undefined) {
      const quads = [...this.#ports.canvas.measure(ids).values()].map((m) => quadOf(m.box, m.toHost));
      const u = unionBox(quads);
      const inv = invert(root);
      if (u && inv) box = rectInRoot(inv, u);
    }
    const targets = step === undefined ? this.#snapTargets(ids) : null;
    return { drag: this.#drag(label), ids, toParent, rootInv, step: step ?? snapStep(px), delta: null, refused: null, box, centre: false, targets, px };
  }

  // The delta from where the pointer went down (so the slop's first 5 px count), in root units,
  // rounded to the snap step.
  #moveFrame(g: Gesture): void {
    const m = g.move!;
    const [rx, ry] = applyM(m.rootInv, g.at.x - g.at0.x, g.at.y - g.at0.y);
    const s = this.#snapDelta(m, rx, ry);
    g.snapLines = s.lines;
    this.#applyMove(m, s.d);
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

  // ── handles (src/interact/handles.ts) and snapping (src/interact/snap.ts) ──────────────────

  // The selection's handles: one element's set (not the root, not locked), or a centre for
  // several; none during a marquee.
  #handleSet(ids: readonly NodeId[], measured: Map<NodeId, Measured>, quads: readonly Quad[], gv: GradientView | null = null): { handles: Handle[]; rotGuide: Line | null } {
    const doc = this.#doc!;
    const g = this.#gesture;
    const none = { handles: [], rotGuide: null };
    if (g?.mode === 'marquee' || this.tool.get() === 'shapes' || !ids.length || ids.some((id) => id === doc.root || isLocked(doc, id))) return none;
    const active = g?.hd?.handle ?? (g?.mode === 'move' && g.handle === 'center' ? 'center' : null);
    // Edit on canvas: the gradient's handles instead of the shape's (none when they can't be placed).
    if (gv) return 'refused' in gv.out ? none : { handles: gv.out.handles.map((h) => ({ id: h.id, kind: h.kind, at: h.at, active: h.id === active })), rotGuide: null };
    if (ids.length > 1) {
      const u = unionBox(quads);
      return u ? { handles: handlesForMany(u, active), rotGuide: null } : none;
    }
    const m = measured.get(ids[0]);
    if (!m) return none;
    const n = doc.nodes.get(ids[0]) as ElementNode;
    const p = this.#pivots(ids[0], m);
    // Circles, ellipses, lines, polygons, polylines and generated shapes: their own handles (engine/
    // geometry/shape-handles.ts) instead of the corners, placed through their own CTM; the centre on
    // the shape's own centre.
    const sh = shapeHandles(doc, n.id, this.geo);
    const base = handlesFor({ quad: quadOf(m.box, m.toHost), corners: sh === null && RESIZABLE.has(n.local), rotPivot: movesBy(doc, n.id) === 'none' ? null : p.rot, scalePivot: p.scale }, active);
    if (!sh) return base;
    const host = (q: Point): Point => {
      const [x, y] = applyM(m.toHost, q.x, q.y);
      return { x, y };
    };
    const centre = sh.find((h) => h.kind === 'center');
    const own: Handle[] = sh.filter((h) => h.kind !== 'center').map((h) => ({ id: h.id, kind: h.kind, at: host(h.at), active: h.id === active }));
    return { handles: [...own, ...base.handles.map((h) => (h.id === 'center' && centre ? { ...h, at: host(centre.at) } : h))], rotGuide: base.rotGuide };
  }

  // The rotation pivot (an existing rotate()'s own centre, through the list's items before it;
  // else the box's centre) and the scale pivot (where the items before scale() send the origin),
  // in host px.
  #pivots(id: NodeId, m: Measured): { rot: Point; scale: Point | null } {
    const doc = this.#doc!;
    const [cx, cy] = applyM(m.toHost, m.box.x + m.box.width / 2, m.box.y + m.box.height / 2);
    const centre = { x: cx, y: cy };
    const raw = attrValueOf(doc, id, 'transform');
    const list = raw === null ? null : parseTransform(raw);
    const parent = doc.nodes.get(id)!.parent!;
    const toHost = this.#ports.canvas.measure([parent]).get(parent)?.toHost;
    if (!list || !toHost) return { rot: centre, scale: null };
    const origin = transformOrigin(doc, id, this.geo, () => m.box);
    const o = 'at' in origin ? origin.at : [0, 0];
    const through = (i: number, x: number, y: number): Point => {
      let t = multiply(toHost, shift(o[0], o[1]));
      for (let k = 0; k < i; k++) t = multiply(t, itemMatrix(list.items[k]));
      const [hx, hy] = applyM(t, x, y);
      return { x: hx, y: hy };
    };
    const r = list.items.findIndex((it) => it.fn === 'rotate');
    const s = list.items.findIndex((it) => it.fn === 'scale');
    return {
      rot: r === -1 ? centre : through(r, list.items[r].args[1] ?? 0, list.items[r].args[2] ?? 0),
      scale: s === -1 || scaleOf(doc, id) === null ? null : through(s, 0, 0),
    };
  }

  // A drag on a handle: the centre moves the selection; a corner resizes, the ring turns and the
  // diamond scales the one selected element, each one drag.
  #startHandle(g: Gesture): void {
    const doc = this.#doc!;
    const sel = [...this.selection.get()];
    if (g.handle === 'center') {
      this.#startMove(g, sel, 'Move');
      if (g.move) g.move.centre = true;
      return;
    }
    g.mode = 'none';
    const id = sel[0];
    if (sel.length !== 1 || !this.#session || !this.#writable()) return;
    if (isLocked(doc, id)) return void this.notice.set(LOCKED);
    const n = doc.nodes.get(id) as ElementNode;
    const parent = n.parent!;
    const measured = this.#ports.canvas.measure([id, parent]);
    const m = measured.get(id);
    const pm = measured.get(parent);
    if (!m || !pm) return;
    const kind = g.handle === 'rot' ? 'Rotate' : g.handle === 'scale' ? 'Scale' : CORNERS.has(g.handle!) ? 'Resize' : 'Shape';
    // The offset from the finger to the handle at the press: the handle moves by the finger's
    // movement, never jumping to it (26 pt pick radius).
    const grab = g.handleAt ? { x: g.handleAt.x - g.at0.x, y: g.handleAt.y - g.at0.y } : { x: 0, y: 0 };
    const hd: HandleDrag = { handle: g.handle!, id, drag: null as unknown as Drag, corner: null, toUnits: null, box: null, uniform: false, step: 1, pivot: g.at0, a0: 0, flip: 1, local: m.box, tip: null, refused: null, targets: null, shape: null, gradient: null, grab };
    if (g.handle!.startsWith('g-')) {
      // A gradient handle (Edit on canvas): raw, no snapping (as in the lab), so no targets.
      const gv = this.#gradientView([id], measured);
      if (!gv || 'refused' in gv.out) return;
      hd.gradient = { prop: gv.prop, geo: gv.geo, handle: g.handle as GradientHandleId };
      hd.drag = this.#drag(GRADIENT_LABELS[g.handle as GradientHandleId]);
      g.hd = hd;
      g.mode = 'handle';
      return;
    }
    if (kind === 'Shape') {
      const sh = shapeHandles(doc, id, this.geo)?.find((h) => h.id === g.handle);
      const toUnits = invert(m.toHost);
      if (!sh || !toUnits) return;
      hd.shape = { id: sh.id, role: sh.role };
      hd.toUnits = toUnits;
      const [a, b, c, d] = toUnits;
      hd.step = snapStep(1 / Math.sqrt(Math.abs(a * d - b * c)));
      if (sh.role === 'position') hd.targets = this.#snapTargets([id]); // once for the drag
      hd.drag = this.#drag(shapeHandleLabel(sh.id));
      g.hd = hd;
      g.mode = 'handle';
      return;
    }
    if (kind === 'Resize') {
      hd.corner = g.handle as Corner;
      hd.uniform = movesBy(doc, id) === 'translate' || n.local === 'use';
      const toParent = invert(pm.toHost);
      if (!toParent) return;
      if (hd.uniform) {
        hd.toUnits = toParent;
        hd.box = rectInRoot(toParent, unionBox([quadOf(m.box, m.toHost)])!);
      } else hd.toUnits = n.local === 'svg' ? toParent : invert(m.toHost);
      if (!hd.toUnits) return;
      const [a, b, c, d] = hd.toUnits;
      hd.step = snapStep(1 / Math.sqrt(Math.abs(a * d - b * c)));
      hd.targets = this.#snapTargets([id]); // once for the drag, as a move gathers them
    } else {
      const p = this.#pivots(id, m);
      if (kind === 'Scale' && !p.scale) return;
      hd.pivot = kind === 'Rotate' ? p.rot : p.scale!;
      hd.a0 = kind === 'Rotate' ? rotationOf(doc, id) : scaleOf(doc, id)!;
      // A mirror before the rotate() it turns (the parent's, or in the list's items before it; the
      // whole list when one will be appended) turns the written angle the other way on screen.
      const raw = attrValueOf(doc, id, 'transform');
      const list = raw === null ? null : parseTransform(raw);
      const r = list ? list.items.findIndex((it) => it.fn === 'rotate') : -1;
      let before = linear(pm.toHost);
      for (const it of list ? (r === -1 ? list.items : list.items.slice(0, r)) : []) before = multiply(before, itemMatrix(it));
      hd.flip = before[0] * before[3] - before[1] * before[2] < 0 ? -1 : 1;
    }
    hd.drag = this.#drag(kind);
    g.hd = hd;
    g.mode = 'handle';
  }

  // One frame of a handle drag, re-planned from the document as it was before the drag.
  #handleFrame(g: Gesture): void {
    const hd = g.hd!;
    const doc = this.#doc!;
    const opts = { ctx: this.geo, decimals: stepDecimals(hd.step) };
    let plan: () => Plan;
    const f = { x: g.at.x + hd.grab.x, y: g.at.y + hd.grab.y }; // where the handle goes (the grab kept)
    if (hd.gradient) {
      const gh = hd.gradient;
      plan = () => {
        const own = ownPaint(doc, hd.id, gh.prop);
        const r = own.gradient === null ? null : resolveGradient(doc, own.gradient);
        return r ? planGradientHandle(doc, r, gh.handle, f, gh.geo) : { refused: 'Its paint is no longer a gradient.' };
      };
      g.snapLines = [];
    } else if (hd.shape) {
      const shape = hd.shape;
      let to: Point;
      if (shape.role === 'position') to = this.#cornerPoint(g, hd, f);
      else {
        const [ux, uy] = applyM(hd.toUnits!, f.x, f.y);
        to = { x: ux, y: uy };
        g.snapLines = [];
      }
      plan = () => planShapeHandle(doc, hd.id, shape.id, to, { ...opts, step: hd.step });
    } else if (hd.corner) {
      const to = this.#cornerPoint(g, hd, f);
      plan = () => planResize(doc, hd.id, { corner: hd.corner!, to, box: hd.box ?? undefined }, opts);
    } else if (hd.handle === 'rot') {
      const turn = (Math.atan2(g.at.y - hd.pivot.y, g.at.x - hd.pivot.x) - Math.atan2(g.at0.y - hd.pivot.y, g.at0.x - hd.pivot.x)) * (180 / Math.PI);
      const a = magneticAngle(hd.a0 + hd.flip * turn);
      hd.tip = `rotate(${fmt(a, 0)})`;
      plan = () => planRotate(doc, hd.id, a, { ctx: this.geo, box: hd.local });
    } else {
      const from = Math.hypot(g.at0.x - hd.pivot.x, g.at0.y - hd.pivot.y);
      const k = scaleStep(from > 0 ? (hd.a0 * Math.hypot(g.at.x - hd.pivot.x, g.at.y - hd.pivot.y)) / from : hd.a0);
      hd.tip = `scale(${fmt(k, 2)})`;
      plan = () => planScale(doc, hd.id, k, opts);
    }
    hd.drag.update((apply) => {
      const p = plan();
      if ('refused' in p) hd.refused ??= p.refused;
      else applyPlan(doc, p, apply);
    });
    if (hd.corner) hd.tip = this.#sizeTip(hd);
    if (hd.shape) hd.tip = shapeHandles(doc, hd.id, this.geo)?.find((h) => h.id === hd.shape!.id)?.tip ?? null;
    if (hd.gradient) {
      const own = ownPaint(doc, hd.id, hd.gradient.prop);
      const r = own.gradient === null ? null : resolveGradient(doc, own.gradient);
      const out = r && gradientHandles(r, hd.gradient.geo);
      hd.tip = out && !('refused' in out) ? (out.handles.find((h) => h.id === hd.gradient!.handle)?.tip ?? null) : null;
    }
    if (hd.refused && this.notice.get() !== hd.refused) this.notice.set(hd.refused);
    this.#show();
  }

  // Where a dragged corner (or a position handle) goes, in the units it is written in, for the point
  // `at` (host px: the finger plus the grab offset): a target within 8 px takes it (in root units),
  // else it is rounded to the snap step there.
  #cornerPoint(g: Gesture, hd: HandleDrag, at: Point): Point {
    const [ux, uy] = applyM(hd.toUnits!, at.x, at.y);
    let to = { x: toStep(ux, hd.step), y: toStep(uy, hd.step) };
    g.snapLines = [];
    const box = this.#box;
    const toHost = box && rootToHostMatrix(box, this.#viewport, this.#M);
    const inv = toHost && invert(toHost);
    const targets = hd.targets;
    if (!toHost || !inv || !targets) return to;
    const [rx, ry] = applyM(inv, at.x, at.y);
    const tol = SNAP_PX / Math.sqrt(Math.abs(toHost[0] * toHost[3]));
    const sx = snapAxis([rx], 0, targets.x, targets.grid, tol);
    const sy = snapAxis([ry], 0, targets.y, targets.grid, tol);
    if (!sx && !sy) return to;
    const [hx, hy] = applyM(toHost, sx ? sx.at : rx, sy ? sy.at : ry);
    const [sxu, syu] = applyM(hd.toUnits!, hx, hy);
    to = { x: sx ? sxu : to.x, y: sy ? syu : to.y };
    g.snapLines = this.#snapLines(sx?.at ?? null, sy?.at ?? null);
    return to;
  }

  // "W × H": a corner's new size, in the element's own units (its parent's for a uniform scale).
  #sizeTip(hd: HandleDrag): string | null {
    const doc = this.#doc!;
    const n = doc.nodes.get(hd.id)!;
    const parent = n.parent!;
    const measured = this.#ports.canvas.measure([hd.id, parent]);
    const m = measured.get(hd.id);
    if (!m) return null;
    let b: Rect = m.box;
    if (hd.uniform) {
      const inv = measured.get(parent) && invert(measured.get(parent)!.toHost);
      if (!inv) return null;
      b = rectInRoot(inv, unionBox([quadOf(m.box, m.toHost)])!);
    }
    const d = stepDecimals(hd.step);
    return `${fmt(b.width, d)} × ${fmt(b.height, d)}`;
  }

  #endHandle(g: Gesture, commit: boolean): void {
    const hd = g.hd;
    if (!hd) return;
    g.hd = null;
    if (commit) hd.drag.commit();
    else hd.drag.cancel();
    this.#bump();
    this.#changed();
  }

  // What a pointer's move snaps to, in root units: guides, the other shapes' edges and centres (at
  // most the 500 nearest the view), the artboard's edges and centre, and the grid's lines while it
  // is shown; each as the Snap sheet allows.
  #snapTargets(moving: readonly NodeId[]): SnapTargets {
    const doc = this.#doc!;
    const prefs = this.snap.get();
    const out: SnapTargets = { x: [], y: [], grid: prefs.grid && this.grid.get() ? this.gridStep() : null };
    if (prefs.guides) for (const g of readState(doc).guides) (g.axis === 'v' ? out.x : out.y).push({ at: g.at, kind: 'guide' });
    const box = this.#box;
    const toHost = box && rootToHostMatrix(box, this.#viewport, this.#M);
    const inv = toHost && invert(toHost);
    if (prefs.shapes && inv) {
      // A moving element, one inside it, or one it is inside: each element's ancestors are walked once.
      const inMoving = new Set(moving);
      const holdsMoving = new Set<NodeId>();
      for (const m of moving) for (let p = doc.nodes.get(m)?.parent ?? null; p !== null && !holdsMoving.has(p); p = doc.nodes.get(p)?.parent ?? null) holdsMoving.add(p);
      const skip = (id: NodeId) => inMoving.has(id) || holdsMoving.has(id) || hasAncestorIn(doc, id, inMoving);
      const ids = this.#leaves(null).filter((id) => !skip(id));
      const measured = this.#ports.canvas.measure(ids);
      const c = { x: this.#size.width / 2, y: this.#size.height / 2 };
      const boxes = [...measured.values()].map((m) => unionBox([quadOf(m.box, m.toHost)])!).sort((a, b) => Math.hypot(a.x + a.width / 2 - c.x, a.y + a.height / 2 - c.y) - Math.hypot(b.x + b.width / 2 - c.x, b.y + b.height / 2 - c.y)).slice(0, 500);
      const t = boxTargets(boxes.map((b) => rectInRoot(inv, b)), 'shape');
      out.x.push(...t.x);
      out.y.push(...t.y);
    }
    if (prefs.artboard && this.#board) {
      const t = boxTargets([this.#board], 'artboard');
      out.x.push(...t.x);
      out.y.push(...t.y);
    }
    return out;
  }

  // A move's delta: each axis on its own, snapped to the nearest target within 8 px (the box's low
  // edge, centre and high edge, or the centre alone for the centre handle), else rounded to the step.
  #snapDelta(m: MoveState, rx: number, ry: number): { d: Point; lines: Line[] } {
    const d = { x: toStep(rx, m.step), y: toStep(ry, m.step) };
    const t = m.targets;
    const b = m.box;
    if (!t || !b) return { d, lines: [] };
    const tol = SNAP_PX / m.px;
    const xs = m.centre ? [b.x + b.width / 2] : [b.x, b.x + b.width / 2, b.x + b.width];
    const ys = m.centre ? [b.y + b.height / 2] : [b.y, b.y + b.height / 2, b.y + b.height];
    const sx = snapAxis(xs, rx, t.x, t.grid, tol);
    const sy = snapAxis(ys, ry, t.y, t.grid, tol);
    return { d: { x: sx ? sx.d : d.x, y: sy ? sy.d : d.y }, lines: this.#snapLines(sx?.at ?? null, sy?.at ?? null) };
  }

  // A snap line across the canvas at a root x (vertical) and a root y (horizontal), in host px.
  #snapLines(x: number | null, y: number | null): Line[] {
    const box = this.#box;
    if (!box) return [];
    const toHost = rootToHostMatrix(box, this.#viewport, this.#M);
    const out: Line[] = [];
    if (x !== null) {
      const [hx] = applyM(toHost, x, 0);
      out.push({ from: { x: hx, y: 0 }, to: { x: hx, y: this.#size.height } });
    }
    if (y !== null) {
      const [, hy] = applyM(toHost, 0, y);
      out.push({ from: { x: 0, y: hy }, to: { x: this.#size.width, y: hy } });
    }
    return out;
  }

  // ── the Shapes tool and generated shapes (P1-M2) ───────────────────────────────────────────

  /** Pick a tool: Shapes (a tap places, a drag draws) or Select. The Shapes tool says how it works. */
  pickTool(tool: Tool): void {
    if (tool === 'shapes' && (!this.#doc || this.readOnly.get())) return;
    if (this.#gesture) this.pointerCancel();
    if (this.tool.get() === tool) return;
    this.tool.set(tool);
    if (tool === 'shapes') {
      this.focus.set(null);
      this.notice.set('Tap to place, or drag to draw.');
    }
    this.#show();
  }

  /** The kind the Shapes tool places. */
  pickShape(kind: ShapeKind): void {
    this.shapeKind.set(kind);
  }

  // A drag on the Session whose commit shows the notice when the finish hook made a generated shape
  // plain in its last frame, and whose cancel forgets that.
  #drag(label: string): Drag {
    const d = this.#session!.drag(label);
    return {
      update: (build) => d.update(build),
      commit: () => {
        d.commit();
        this.#noteDetached();
      },
      cancel: () => {
        d.cancel();
        this.#detached = [];
      },
    };
  }

  // After a transaction (or a drag's commit): one notice when a generated shape became plain.
  #noteDetached(): void {
    if (this.#detached.length) this.notice.set(DETACHED);
    this.#detached = [];
  }

  // The snap step in the root's user units at this zoom.
  #rootStep(): number {
    const box = this.#box;
    if (!box) return 1;
    const m = rootToHostMatrix(box, this.#viewport, this.#M);
    return snapStep(Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])));
  }

  // A host point in the root's user units, snapped as a dragged corner is: a target within 8 px on
  // screen takes each axis, else it is rounded to the step. `targets` null: the step alone.
  #snapRoot(at: Point, targets: SnapTargets | null, step: number): { p: Point; lines: Line[] } {
    const box = this.#box;
    const toHost = box && rootToHostMatrix(box, this.#viewport, this.#M);
    const inv = toHost && invert(toHost);
    if (!toHost || !inv) return { p: { x: 0, y: 0 }, lines: [] };
    const [rx, ry] = applyM(inv, at.x, at.y);
    const tol = SNAP_PX / Math.sqrt(Math.abs(toHost[0] * toHost[3]));
    const sx = targets && snapAxis([rx], 0, targets.x, targets.grid, tol);
    const sy = targets && snapAxis([ry], 0, targets.y, targets.grid, tol);
    return { p: { x: sx ? sx.at : toStep(rx, step), y: sy ? sy.at : toStep(ry, step) }, lines: this.#snapLines(sx?.at ?? null, sy?.at ?? null) };
  }

  // The new shape's markup, built inside the transaction (a generated one declares Draw's namespace
  // first, for its prefix), put last among the root's element children by the insertion rule.
  #addShape(apply: (op: Op) => void, kind: ShapeKind, step: number, markupFor: (c: ShapeCtx) => string): NodeId {
    const doc = this.#doc!;
    const draw = kind === 'polygon' || kind === 'star' || kind === 'spiral' ? declare(doc, apply) : 'draw';
    const c: ShapeCtx = { k: boardScale(this.#board), step, svg: el(doc, doc.root).prefix, draw, colour: shapeColour(this.#shapes) };
    return insertMarkup(doc, { last: doc.root }, markupFor(c), apply);
  }

  // A drag with the Shapes tool: the snap targets gathered once when it starts; each frame inserts
  // the shape afresh from the document as it was before the drag, from the snapped start to the
  // snapped finger. One entry when it lifts; a cancel restores the file and adds nothing.
  #drawFrame(g: Gesture): void {
    const d = g.draw!;
    if (g.mode === 'pending') {
      if (!this.#session) return;
      g.mode = 'draw';
      d.targets = this.#snapTargets([]);
      d.a = this.#snapRoot(g.at0, d.targets, d.step).p;
      d.drag = this.#drag(SHAPE_LABELS[d.kind]);
    }
    const drag = d.drag;
    const a = d.a;
    if (g.mode !== 'draw' || !drag || !a) return;
    const b = this.#snapRoot(g.at, d.targets, d.step);
    g.snapLines = b.lines;
    let tipText: string | null = null;
    try {
      drag.update((apply) => {
        d.id = this.#addShape(apply, d.kind, d.step, (c) => {
          const made = drawMarkup(d.kind, a, b.p, c);
          tipText = made.tip;
          return made.markup;
        });
      });
    } catch (e) {
      if (!(e instanceof TokenEditError)) throw e;
      this.notice.set(e.message);
    }
    d.tip = tipText;
    this.#show();
  }

  // The end of a Shapes gesture: a tap places the lab's default at the snapped point; a drag keeps
  // what it drew. Either way the new shape is selected and the tool returns to Select.
  #endDraw(g: Gesture, commit: boolean): void {
    const d = g.draw!;
    if (g.mode === 'pending') {
      if (!commit) return;
      const p = this.#snapRoot(g.at0, this.#snapTargets([]), d.step).p;
      let id: NodeId | null = null;
      if (this.#dispatch(SHAPE_LABELS[d.kind], (apply) => (id = this.#addShape(apply, d.kind, d.step, (c) => placeMarkup(d.kind, p, c))))) this.#placed(id!);
      return;
    }
    const drag = d.drag;
    if (!drag) return;
    d.drag = null;
    if (commit) drag.commit();
    else drag.cancel();
    this.#bump();
    this.#changed();
    if (commit && d.id !== null && attached(this.#doc!, d.id)) this.#placed(d.id);
  }

  // A shape was placed or drawn: the colour cycle moves on, it is selected, and Select is back.
  #placed(id: NodeId): void {
    this.#shapes++;
    this.tool.set('select');
    this.focus.set(null);
    this.select([id]);
  }

  /** The one selected element's generator, when it is a generated shape now (Inspect's Generator section). */
  generated(): { id: NodeId; kind: GeneratorKind; label: string; inputs: { name: string; text: string; integer: boolean }[] } | null {
    const doc = this.#doc;
    const ids = [...this.selection.get()];
    if (!doc || ids.length !== 1) return null;
    const g = generatorOf(doc, ids[0]);
    if (!g) return null;
    const n = el(doc, ids[0]);
    return { id: ids[0], kind: g.kind, label: g.generator.label, inputs: g.generator.inputs.map((i) => ({ name: i.name, text: attrValue(doc, n, DRAW_NS, i.name)!.trim(), integer: !!i.integer })) };
  }

  // The op that writes a generator input: only its number's characters (the whole value when it is
  // written with a reference); the finish hook then draws the shape again from it.
  #inputOp(id: NodeId, name: string, v: number): Op {
    const doc = this.#doc!;
    const n = el(doc, id);
    const a = n.attrs.find((x) => x.ns === DRAW_NS && x.local === name)!;
    const text = fmt(v, INPUT_UI[name]?.integer ? 0 : 2);
    const m = /-?(?:\d*\.\d+|\d+)/.exec(a.raw);
    return m && !a.raw.includes('&') ? opSetAttrRaw(doc, id, DRAW_NS, name, rewriteNumbers(a.raw, [{ start: m.index, end: m.index + m[0].length, text }])) : opSetAttr(doc, id, DRAW_NS, name, text);
  }

  // A value for an input, or why it isn't one: a plain decimal the generator takes, in the field's range.
  #inputValue(name: string, text: string): number | string {
    const g = this.generated();
    const input = g && generatorOf(this.#doc!, g.id)!.generator.inputs.find((i) => i.name === name);
    const ui = INPUT_UI[name];
    if (!g || !input || !ui) return 'Nothing generated is selected';
    const t = text.trim();
    if (!/^-?(?:\d+|\d*\.\d+)$/.test(t)) return `${JSON.stringify(text)} is not a number`;
    const v = Number(t);
    if (!input.valid(v) || v < ui.min || v > ui.max) return `${ui.label} takes ${ui.integer ? 'whole numbers' : 'numbers'}${Number.isFinite(ui.min) ? ` from ${fmt(ui.min, 2)}` : ''}${Number.isFinite(ui.max) ? ` to ${fmt(ui.max, 2)}` : ''}`;
    return v;
  }

  /** The Generator section's − and +: one input a step down or up, one entry ("Set tips"). */
  stepInput(name: string, dir: 1 | -1): void {
    const g = this.generated();
    const ui = INPUT_UI[name];
    if (!g || !ui) return;
    const step = ui.step === 'snap' ? this.#rootStep() : ui.step;
    const now = generatorOf(this.#doc!, g.id)!.inputs[name];
    const next = Math.min(ui.max, Math.max(ui.min, Number(fmt(now + dir * step, 4))));
    const v = this.#inputValue(name, fmt(next, 4));
    if (typeof v === 'string') return void this.notice.set(v);
    if (v !== now) this.#dispatch(`Set ${name}`, (apply) => apply(this.#inputOp(g.id, name, v)));
  }

  /** Detach on purpose: the generator's attributes removed, the shape keeps its geometry ("Detach"). */
  detach(): void {
    const doc = this.#doc;
    const g = this.generated();
    if (doc && g) this.#dispatch('Detach', (apply) => void detachGenerator(doc, g.id, apply));
  }

  /**
   * An Inspect field took focus: what is typed there, until it lets go (Done, Enter, the dim, Escape
   * or a blur), is one history entry, written live as each keystroke that reads is typed.
   */
  fieldStart(field: Field): void {
    if (!this.#session || this.#field || this.#stepDrag || this.#live || this.#gesture || this.#nudge) return;
    const ids =
      field.kind === 'input' ? [this.generated()?.id].filter((id) => id !== undefined)
      : field.kind === 'style' ? (field.ids ?? this.#styleIds())
      : field.kind === 'offset' ? [field.stop].filter((id) => this.#doc && attached(this.#doc, id))
      : this.#styleIds().slice(0, 1);
    if (!ids.length || !this.#writable()) return;
    if (field.kind === 'style' && this.styleRow(field.prop, field.ids)?.disabled) return;
    const ruled = field.kind === 'gradient' ? this.#paintRuled(field.prop) : field.kind === 'offset' ? this.#stopRuled(field.stop) : null;
    if (ruled) return void this.notice.set(ruled);
    if (field.kind === 'gradient' && !this.paintInfo(field.prop)?.gradient) return;
    const label = field.kind === 'input' ? field.name : field.kind === 'style' ? field.prop : field.kind === 'offset' ? 'offset' : field.name;
    this.#field = { field, ids, drag: this.#drag(`Set ${label}`), refused: [] };
  }

  /** Text typed in the focused field: written into its entry when it reads as a value; else why not (the last good value stays). */
  fieldInput(text: string): string | null {
    const f = this.#field;
    if (!f) return 'No field is being edited';
    if (f.field.kind === 'style') {
      const c = checkStyle(f.field.prop, text);
      if ('error' in c) return c.error;
      f.refused = this.#styleFrame(f.drag, f.ids, new Map([[f.field.prop, c.text]]));
      return null;
    }
    if (f.field.kind === 'offset') {
      const t = text.trim();
      if (!/^(?:\d+|\d*\.\d+)$/.test(t) || Number(t) > 1) return `${JSON.stringify(text)} is not an offset from 0 to 1`;
      const doc = this.#doc!;
      f.drag.update((apply) => apply(offsetOp(doc, f.ids[0], Number(t))));
      this.#show();
      return null;
    }
    if (f.field.kind === 'gradient') {
      const g = f.field;
      const t = text.trim();
      if (!/^-?(?:\d+|\d*\.\d+)%?$/.test(t)) return `${JSON.stringify(text)} is not a number or a percentage`;
      if (g.name === 'fr' && t.startsWith('-')) return 'fr takes numbers from 0';
      const doc = this.#doc!;
      const id = f.ids[0];
      f.drag.update((apply) => {
        const own = ownPaint(doc, id, g.prop);
        const r = own.gradient === null ? null : resolveGradient(doc, own.gradient);
        if (r) apply(gradientAttrOp(doc, r, g.name, t));
      });
      this.#show();
      return null;
    }
    const name = f.field.name;
    const v = this.#inputValue(name, text);
    if (typeof v === 'string') return v;
    f.drag.update((apply) => apply(this.#inputOp(f.ids[0], name, v)));
    this.#show();
    return null;
  }

  /** The field let go: its one entry kept (or, `commit` false, undone). */
  fieldEnd(commit = true): void {
    const f = this.#field;
    if (!f) return;
    this.#field = null;
    if (commit) f.drag.commit();
    else f.drag.cancel();
    if (commit && f.field.kind === 'style') this.#kept(f.field.prop, f.ids, f.refused);
    this.#bump();
    this.#changed();
    this.#show();
  }

  // ── style: Inspect's properties, its sliders and fields, and the style sheet (P1-M2) ─────────

  // What Inspect's properties edit: every selected element.
  #styleIds(): NodeId[] {
    const doc = this.#doc;
    return doc ? [...this.selection.get()].filter((id) => doc.nodes.get(id)?.kind === 'element') : [];
  }

  /** k (the artboard's min(W, H) / 100) and the snap step at this zoom: the width-2 rule, the width slider and the Dash presets scale by them. */
  get styleCtx(): StyleCtx {
    return { k: boardScale(this.#board), step: this.#rootStep() };
  }

  /**
   * What Inspect shows for `prop` over the selection: the first element's value and where it comes
   * from, whether the others differ (Mixed), and, when a <style> rule decides it for every one of
   * them, why nothing can be written. Null with nothing selected.
   */
  styleRow(prop: string, only?: readonly NodeId[]): StyleRow | null {
    const doc = this.#doc;
    const ids = only ? [...only] : this.#styleIds();
    if (!doc || !ids.length) return null;
    const first = shownValue(doc, ids[0], prop);
    const key = (v: string | null) => (v === null ? null : v.toLowerCase());
    let mixed = false;
    let ruled = first.from === 'rule';
    for (let i = 1; i < ids.length; i++) {
      const s = shownValue(doc, ids[i], prop);
      if (key(s.value) !== key(first.value)) mixed = true;
      if (s.from !== 'rule') ruled = false;
      if (mixed && !ruled) break;
    }
    const label = first.holder === null ? null : elementLabel(doc, first.holder);
    const note = first.from === 'ancestor' ? (first.value === null ? `from ${label}, set by a <style> rule` : `from ${label}`) : first.from === 'default' ? 'default' : first.from === 'rule' ? 'set by a <style> rule' : '';
    return { value: first.value ?? '', mixed, from: first.from, note: mixed ? '' : note, disabled: ruled ? ruleWhy(styleSource(doc, ids[0], prop), prop) : null };
  }

  /** A segment, preset or switch in Inspect: `prop` = `value` over the selection, one entry ("Set fill"); the elements a rule decides keep theirs, and one notice names them. */
  setStyle(prop: string, value: string, only?: readonly NodeId[]): void {
    const doc = this.#doc;
    const ids = only ? [...only] : this.#styleIds();
    if (!doc || !ids.length) return;
    const ruled = this.#stopsRuled(prop, ids);
    if (ruled) return void this.notice.set(ruled);
    const c = checkStyle(prop, value);
    if ('error' in c) return void this.notice.set(c.error);
    let refused: { id: NodeId; why: string }[] = [];
    const ctx = this.styleCtx;
    const done = this.#dispatch(`Set ${prop}`, (apply) => {
      const plan = planStyle(doc, ids, prop, c.text, ctx);
      refused = plan.refused;
      applyPlan(doc, plan, apply);
    });
    if (done) this.#kept(prop, ids, refused);
  }

  /** A slider pressed (opacity, stroke-width): one entry per press ("Set opacity"), each move written live by styleInput from the file as it was before the press, kept by styleDragEnd. */
  styleDrag(prop: string, only?: readonly NodeId[]): boolean {
    const ids = only ? [...only] : this.#styleIds();
    if (!this.#session || this.#live || this.#field || this.#stepDrag || this.#gesture || this.#nudge || !ids.length || !this.#writable()) return false;
    if (this.styleRow(prop, only)?.disabled) return false;
    const ruled = this.#stopsRuled(prop, ids);
    if (ruled) return void this.notice.set(ruled), false;
    this.#live = { kind: 'style', drag: this.#drag(`Set ${prop}`), prop, ids, last: new Map(), refused: [] };
    return true;
  }

  /** A slider's move: its value written into the press's entry; else why not (the last good value stays). */
  styleInput(value: string): string | null {
    const live = this.#live;
    if (live?.kind !== 'style' || this.sheet.get()?.kind === 'style') return 'No slider is held';
    const r = this.#styleInput(live, live.prop, value);
    return 'error' in r ? r.error : null;
  }

  /** The slider let go: its one entry kept (or, `commit` false, undone). */
  styleDragEnd(commit = true): void {
    if (this.#live?.kind === 'style' && this.sheet.get()?.kind !== 'style') this.#endLive(commit);
  }

  /** Inspect's swatch, or the More sheet's Fill… and Stroke…: the Colour sheet for `prop` over the selection, one entry per visit. */
  openStyleSheet(prop: string, only?: readonly NodeId[]): void {
    const doc = this.#doc;
    const ids = only ? [...only] : this.#styleIds();
    if (!doc || !this.#session || this.#live || this.#field || this.#stepDrag || this.#gesture || this.#nudge || !ids.length || !this.#writable()) return;
    const row = this.styleRow(prop, ids)!;
    if (row.disabled) return void this.notice.set(row.disabled);
    const ruled = this.#stopsRuled(prop, ids);
    if (ruled) return void this.notice.set(ruled);
    this.focus.set(null);
    this.#live = { kind: 'style', drag: this.#drag(`Set ${prop}`), prop, ids, last: new Map(), refused: [] };
    this.sheet.set({ kind: 'style', prop, ids, text: row.value || (STYLE_INITIAL[prop] ?? '') });
    this.#bump();
  }

  // A value for the style drag held open: checked, then every value of the drag written again.
  #styleInput(live: StyleLive, prop: string, input: string): Checked {
    const c = checkStyle(prop, input);
    if ('error' in c) return c;
    live.last.set(prop, c.text);
    live.refused = this.#styleFrame(live.drag, live.ids, live.last);
    return c;
  }

  // One frame of a style drag: each value (in the order first written) planned over the elements
  // from the file as it was before the drag, so a later value sees the earlier one's edit (the
  // width-2 rule, then the width slider). Returns the frame's refusals.
  #styleFrame(drag: Drag, ids: readonly NodeId[], values: ReadonlyMap<string, string>): { id: NodeId; why: string }[] {
    const doc = this.#doc!;
    const ctx = this.styleCtx;
    const refused: { id: NodeId; why: string }[] = [];
    drag.update((apply) => {
      refused.length = 0;
      for (const [prop, value] of values) {
        const plan = planStyle(doc, ids, prop, value, ctx);
        for (const r of plan.refused) if (!refused.some((x) => x.id === r.id)) refused.push(r);
        applyPlan(doc, plan, apply);
      }
    });
    this.#show();
    return refused;
  }

  // After a style edit: one notice naming what kept its value ("1 of 4 kept their fill (<polygon#k>): why"), or the reason when all did.
  #kept(prop: string, ids: readonly NodeId[], refused: readonly { id: NodeId; why: string }[]): void {
    if (!refused.length) return;
    if (refused.length === ids.length) return void this.notice.set(refused[0].why);
    const doc = this.#doc!;
    const names = refused.slice(0, 3).map((r) => elementLabel(doc, r.id)).join(', ') + (refused.length > 3 ? ', …' : '');
    this.notice.set(`${refused.length} of ${ids.length} kept their ${prop} (${names}): ${refused[0].why}`);
  }

  // ── gradients, the stop editor and gloss (P1-M2 S3, engine/paint/) ─────────────────────────

  /**
   * What Inspect shows about the first selected element's own fill or stroke: its kind, the
   * gradient it names (resolved through its templates), whether it is SVG Lab's gloss, how many
   * other shapes draw with what an edit here would write, the stops, spread, units and a radial
   * gradient's fx, fy and fr as written, and why Edit on canvas can't show its handles.
   */
  paintInfo(prop: PaintProp): PaintInfo | null {
    const doc = this.#doc;
    const id = this.#styleIds()[0];
    if (!doc || id === undefined) return null;
    const own = ownPaint(doc, id, prop);
    const why = this.#paintRuled(prop, id);
    if (why) return { kind: 'other', gradient: null, gloss: false, shared: 0, stops: [], spread: 'pad', units: 'Box', fx: null, fy: null, fr: null, handles: null, ruled: own.gradient === null ? null : why };
    const r = own.gradient === null ? null : resolveGradient(doc, own.gradient);
    const shown = shownValue(doc, id, prop).value;
    const p = shown === null ? null : parsePaint(shown);
    const kind: PaintInfo['kind'] = r ? (r.kind === 'linearGradient' ? 'linear' : 'radial') : p?.kind === 'none' ? 'none' : p?.kind === 'color' ? 'color' : 'other';
    const out: PaintInfo = { kind, gradient: r?.id ?? null, gloss: prop === 'fill' && glossOf(doc, id) !== null, shared: 0, stops: [], spread: 'pad', units: 'Box', fx: null, fy: null, fr: null, handles: null, ruled: null };
    if (!r) return out;
    out.shared = sharedWith(gradientUsers(doc), [...r.chain], { el: id, prop }).length;
    out.stops = r.stops.map((s) => ({ id: s, offset: stopOffset(doc, s), colour: stopColour(doc, s), opacity: styleSource(doc, s, 'stop-opacity').value ?? '1' }));
    out.spread = valueOf(r, 'spreadMethod');
    out.units = valueOf(r, 'gradientUnits') === 'userSpaceOnUse' ? 'User space' : 'Box';
    if (r.kind === 'radialGradient') for (const n of ['fx', 'fy', 'fr'] as const) out[n] = r.attrs.get(n)?.value ?? null;
    const gv = this.#gradientView([id], this.#ports.canvas.measure([id]), prop);
    out.handles = !gv ? 'The canvas doesn’t draw it now.' : 'refused' in gv.out ? gv.out.refused : null;
    return out;
  }

  // The gradient Edit on canvas shows for one selected element (`prop`, else the store's), where
  // the canvas measured it: null when it is off, several are selected, or the paint isn't a gradient.
  #gradientView(ids: readonly NodeId[], measured: ReadonlyMap<NodeId, Measured>, prop: PaintProp | null = this.editGradient.get()): GradientView | null {
    const doc = this.#doc;
    if (!doc || prop === null || ids.length !== 1 || this.#paintRuled(prop, ids[0])) return null;
    const m = measured.get(ids[0]);
    const own = ownPaint(doc, ids[0], prop);
    const r = own.gradient === null ? null : resolveGradient(doc, own.gradient);
    const inv = m && invert(m.toHost);
    if (!m || !r || !inv) return null;
    const step = snapStep(1 / Math.sqrt(Math.abs(inv[0] * inv[3] - inv[1] * inv[2])));
    const geo: GradientGeo = { box: m.box, toHost: m.toHost, viewport: viewportSize(doc, nearestViewport(doc, ids[0]), this.geo), step };
    return { prop, geo, out: gradientHandles(r, geo) };
  }

  /** Edit on canvas for `prop`: on (the gradient's handles instead of the shape's), or off again. */
  toggleEditGradient(prop: PaintProp): void {
    const ruled = this.editGradient.get() === prop ? null : this.#paintRuled(prop);
    if (ruled) return void this.notice.set(ruled);
    this.editGradient.set(this.editGradient.get() === prop ? null : prop);
    this.#show();
  }

  /**
   * Inspect's paint kinds over the selection, one entry each ("Set fill"): None; Colour (a
   * gradient gives back its first stop's colour, else the Colour sheet opens); Linear and Radial (a
   * new gradient each, SVG Lab's, in defs). A gradient Draw made that nothing uses any more goes.
   */
  setPaintKind(prop: PaintProp, kind: 'none' | 'color' | 'linear' | 'radial'): void {
    const doc = this.#doc;
    const ids = this.#styleIds();
    if (!doc || !ids.length) return;
    const ctx = this.styleCtx;
    let refused: { id: NodeId; why: string }[] = [];
    let done: boolean;
    if (kind === 'color') {
      const graded = ids.filter((id) => ownPaint(doc, id, prop).gradient !== null);
      if (!graded.length) return this.openStyleSheet(prop);
      const first = (id: NodeId) => {
        const r = resolveGradient(doc, ownPaint(doc, id, prop).gradient!)!;
        return r.stops.length ? stopColour(doc, r.stops[0]) : LAB_A;
      };
      done = this.#dispatch(`Set ${prop}`, (apply) => (refused = setPlainPaint(doc, graded, prop, first, ctx, apply)));
      if (done) this.#kept(prop, graded, refused);
      return;
    }
    done = this.#dispatch(`Set ${prop}`, (apply) => {
      refused = kind === 'none' ? setPlainPaint(doc, ids, prop, () => 'none', ctx, apply) : setGradientPaint(doc, ids, prop, kind === 'linear' ? 'linearGradient' : 'radialGradient', ctx, apply);
    });
    if (done) this.#kept(prop, ids, refused);
  }

  /** Make unique: the first selected element's `prop` draws with a standalone copy of its gradient ("Make unique"). */
  makeUnique(prop: PaintProp): void {
    const doc = this.#doc;
    const id = this.#styleIds()[0];
    if (!doc || id === undefined) return;
    const ruled = this.#paintRuled(prop, id);
    if (ruled) return void this.notice.set(ruled);
    this.#dispatch('Make unique', (apply) => {
      const r = makeUniqueCopy(doc, id, prop, apply);
      if (typeof r !== 'number') throw new TokenEditError(r.refused);
    });
  }

  /** Gloss (More, Inspect): on for each selected shape that can take one, or off when every one has it ("Gloss", "Gloss off"), one entry. */
  toggleGloss(): void {
    const doc = this.#doc;
    if (!doc) return;
    const order = documentOrder(doc);
    const ids = this.#styleIds().filter((id) => glossable(doc, id)).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    if (!ids.length) return void this.notice.set(NO_GLOSS);
    const on = ids.every((id) => glossOf(doc, id) !== null);
    const ctx = this.styleCtx;
    let refused: { id: NodeId; why: string }[] = [];
    const done = this.#dispatch(on ? 'Gloss off' : 'Gloss', (apply) => {
      refused = on ? glossOff(doc, ids, ctx, apply) : glossOn(doc, ids.filter((id) => glossOf(doc, id) === null), ctx, apply);
    });
    if (done) this.#kept('fill', ids, refused);
  }

  /** Whether the selection's gloss is on (every shape that can take one has it), off, or not offered (none can). */
  glossState(): 'on' | 'off' | null {
    const doc = this.#doc;
    if (!doc) return null;
    const ids = this.#styleIds().filter((id) => glossable(doc, id));
    return !ids.length ? null : ids.every((id) => glossOf(doc, id) !== null) ? 'on' : 'off';
  }

  // The first selected element's gradient for `prop`, resolved now; null, with the notice, when a
  // <style> rule decides that paint.
  #gradientOf(prop: PaintProp): { doc: Doc; gradient: NodeId } | null {
    const doc = this.#doc;
    const id = this.#styleIds()[0];
    const ruled = doc && id !== undefined ? this.#paintRuled(prop, id) : null;
    if (ruled) return this.notice.set(ruled), null;
    const g = doc && id !== undefined ? ownPaint(doc, id, prop).gradient : null;
    return doc && g !== null ? { doc, gradient: g } : null;
  }

  // Why the gradient section can't edit an element's own `prop` gradient (the first selected, by
  // default): a <style> rule decides that paint, and wins over what the element names, so an edit
  // of that gradient would change nothing it draws (P2 edits stylesheets). Null when no rule does.
  #paintRuled(prop: PaintProp, id: NodeId | undefined = this.#styleIds()[0]): string | null {
    const doc = this.#doc;
    return doc && id !== undefined ? ruleWhy(styleSource(doc, id, prop), prop) : null;
  }

  // Why a stop can't be edited through Inspect (its offset, colour or opacity): the first selected
  // element's own gradient draws with it for a paint a <style> rule decides (#paintRuled), and none
  // of its paints the rules leave alone does. Null otherwise.
  #stopRuled(stop: NodeId): string | null {
    const doc = this.#doc;
    const id = this.#styleIds()[0];
    if (!doc || id === undefined) return null;
    let why: string | null = null;
    for (const prop of ['fill', 'stroke'] as const) {
      const g = ownPaint(doc, id, prop).gradient;
      if (g === null || !resolveGradient(doc, g)!.stops.includes(stop)) continue;
      const ruled = this.#paintRuled(prop, id);
      if (!ruled) return null;
      why ??= ruled;
    }
    return why;
  }

  // #stopRuled over a stop property's elements (stop-color, stop-opacity), else null.
  #stopsRuled(prop: string, ids: readonly NodeId[]): string | null {
    if (prop !== 'stop-color' && prop !== 'stop-opacity') return null;
    for (const id of ids) {
      const why = this.#stopRuled(id);
      if (why) return why;
    }
    return null;
  }

  /** Spread (Pad, Reflect, Repeat), written where it lives in the chain, one entry. */
  setSpread(prop: PaintProp, value: 'pad' | 'reflect' | 'repeat'): void {
    const at = this.#gradientOf(prop);
    if (!at) return;
    const r = resolveGradient(at.doc, at.gradient)!;
    if (valueOf(r, 'spreadMethod') === value) return;
    this.#dispatch('Set spreadMethod', (apply) => apply(gradientAttrOp(at.doc, r, 'spreadMethod', value)));
  }

  /** A stop's offset − or + (SVG Lab's 0.05), one entry each; kept within 0–1. */
  stepStopOffset(stop: NodeId, dir: 1 | -1): void {
    const doc = this.#doc;
    if (!doc || !attached(doc, stop)) return;
    const ruled = this.#stopRuled(stop);
    if (ruled) return void this.notice.set(ruled);
    const v = Math.min(1, Math.max(0, Number(fmt(stopOffset(doc, stop) + dir * 0.05, 4))));
    if (v !== stopOffset(doc, stop)) this.#dispatch('Set offset', (apply) => apply(offsetOp(doc, stop, v)));
  }

  /** Add stop: after `after` (else the last), at the midpoint, coloured as the gradient is there ("Add stop"). */
  addStop(prop: PaintProp, after: NodeId | null): void {
    const at = this.#gradientOf(prop);
    if (at) this.#dispatch('Add stop', (apply) => void addStopAfter(at.doc, resolveGradient(at.doc, at.gradient)!, after, apply));
  }

  /** Remove a stop with its whitespace ("Remove stop"); never the last one. */
  removeStop(prop: PaintProp, stop: NodeId): void {
    const at = this.#gradientOf(prop);
    if (at) this.#dispatch('Remove stop', (apply) => removeStopOf(at.doc, resolveGradient(at.doc, at.gradient)!, stop, apply));
  }

  // ── rem (decision 13) ────────────────────────────────────────────────────────────────────────

  /**
   * Convert rem to user units: every rem number in an attribute or style="" becomes user units
   * against the file's own root font size, in one "Convert rem" entry (rem in <style> text stays).
   * The reason it can't, or null.
   */
  convertRem(): string | null {
    const doc = this.#doc;
    if (!doc) return null;
    if (cssSets(doc, doc.root, 'font-size') === 'sheet') return REM_UNCONVERTIBLE;
    const font = rootFontSize(doc);
    const edits: { id: NodeId; ns: string | null; local: string; raw: string }[] = [];
    for (const id of this.#elements()) {
      const n = doc.nodes.get(id) as ElementNode;
      for (const a of n.attrs) if (hasRem(a.raw)) edits.push({ id, ns: a.ns, local: a.local, raw: remToUserUnits(a.raw, font, a.ns === null && a.local === 'style') });
    }
    if (!edits.length) return null;
    const ok = this.#dispatch('Convert rem', (apply) => {
      for (const e of edits) apply(opSetAttrRaw(doc, e.id, e.ns, e.local, e.raw));
    });
    return ok ? null : this.notice.get();
  }

  // ── Layers: hide, lock, rename ───────────────────────────────────────────────────────────────

  /** Hide an element (display="none", "Hide") or show it again (that attribute removed, "Show"). */
  setHidden(id: NodeId, hidden: boolean): void {
    const doc = this.#doc;
    const n = doc?.nodes.get(id);
    if (!doc || n?.kind !== 'element' || id === doc.root) return;
    if (cssSets(doc, id, 'display') !== 'no') return void this.notice.set('Its display is set by CSS.');
    const none = attrValue(doc, n, null, 'display')?.trim() === 'none';
    if (none === hidden) return;
    this.#dispatch(hidden ? 'Hide' : 'Show', (apply) => apply(opSetAttr(doc, id, null, 'display', hidden ? 'none' : null)));
  }

  /** Lock an element (draw:locked="true", with the declaration if it is the file's first Draw state), or unlock it. */
  setLocked(id: NodeId, locked: boolean): void {
    const doc = this.#doc;
    const n = doc?.nodes.get(id);
    if (!doc || n?.kind !== 'element' || id === doc.root) return;
    const has = n.attrs.some((a) => a.ns === DRAW_NS && a.local === 'locked');
    if (has === locked) return;
    this.#dispatch(locked ? 'Lock' : 'Unlock', (apply) => setDrawAttr(doc, id, 'locked', locked ? 'true' : null, apply));
    if (locked && this.selection.get().has(id)) this.#show(); // its handles go
  }

  /**
   * Rename an element's id, and every reference to it in the document ("Rename"); the reason it
   * can't, or null. Refused: a name XML can't hold as an id, one another element has, an id two
   * elements share (which one the references mean is the file's to settle), and an id a <style> rule
   * names (Draw doesn't rewrite CSS, and the rule would stop matching).
   */
  rename(id: NodeId, next: string): string | null {
    const doc = this.#doc;
    const n = doc?.nodes.get(id);
    if (!doc || n?.kind !== 'element') return 'That element is no longer in the document';
    if (this.readOnly.get()) return READ_ONLY;
    const was = attrValue(doc, n, null, 'id');
    if (next === was) return null;
    const bad = idError(next);
    if (bad) return bad;
    if (idsInUse(doc).has(next)) return `Another element already has the id "${next}".`;
    if (was !== null && (buildRefIndex(doc).ids.get(was)?.length ?? 0) > 1) return 'Another element has this id; fix the duplicate in the code first.';
    if (was !== null && styleNamesId(doc, was)) return `A <style> rule uses #${was}; rename it in the code.`;
    const ok = this.#dispatch('Rename', (apply) => {
      if (was === null) apply(opSetAttr(doc, id, null, 'id', next));
      else renameIdsIn(doc, doc.root, new Map([[was, next]]), apply);
    });
    return ok ? null : this.notice.get();
  }

  // ── Draw's own state: guides and the grid step (engine/model/draw-state.ts) ──────────────────

  /** The guides and the grid step the file keeps. */
  get drawState(): DrawState {
    return this.#doc ? readState(this.#doc) : NO_STATE;
  }

  /** How many guides the file lists past those Draw shows (the Snap sheet says so). */
  get hiddenGuides(): number {
    return this.#doc ? hiddenGuides(this.#doc) : 0;
  }

  /** Add a guide through the artboard's centre (v: at its centre x; h: at its centre y). */
  addGuide(axis: 'v' | 'h'): void {
    const doc = this.#doc;
    if (!doc) return;
    const b = this.#board ?? { x: 0, y: 0, width: 0, height: 0 };
    const at = Number(fmt(axis === 'v' ? b.x + b.width / 2 : b.y + b.height / 2, 4));
    const s = readState(doc);
    if (s.guides.length >= MAX_GUIDES) return void this.notice.set(`Draw shows ${MAX_GUIDES} guides at most; remove one first.`);
    this.#dispatch('Add guide', (apply) => writeState(doc, { ...s, guides: [...s.guides, { axis, at }] }, apply));
  }

  /** Remove one guide (by its place in the list), or every guide. */
  removeGuide(index: number | 'all'): void {
    const doc = this.#doc;
    if (!doc) return;
    const s = readState(doc);
    const guides = index === 'all' ? [] : s.guides.filter((_, i) => i !== index);
    if (guides.length === s.guides.length) return;
    this.#dispatch(index === 'all' ? 'Remove all guides' : 'Remove guide', (apply) => writeState(doc, { ...s, guides }, apply));
  }

  /**
   * The Snap sheet's Grid step field took focus: what is typed there, until it lets go (Done, the dim,
   * Escape, a blur), is one "Set grid step", as a sheet open on one value is.
   */
  gridStepStart(): void {
    const doc = this.#doc;
    if (!doc || !this.#session || this.#stepDrag || this.#live || this.#gesture || this.#nudge || !this.#writable()) return;
    this.#stepDrag = { drag: this.#drag('Set grid step'), from: readState(doc) };
  }

  /** A step typed in the field (null: automatic), written live into the field's one entry; a value that isn't a step is left out. */
  gridStepInput(step: number | null): void {
    const doc = this.#doc;
    if (!this.#stepDrag) this.gridStepStart();
    const d = this.#stepDrag;
    if (!doc || !d || (step !== null && !(step > 0 && Number.isFinite(step)))) return;
    d.drag.update((apply) => writeState(doc, { ...d.from, grid: step }, apply));
    this.#show();
  }

  /** The field let go: its entry is kept (or, `commit` false, undone). */
  gridStepEnd(commit = true): void {
    const d = this.#stepDrag;
    if (!d) return;
    this.#stepDrag = null;
    if (commit) d.drag.commit();
    else d.drag.cancel();
    this.#bump();
    this.#changed();
    this.#show();
  }

  /** The grid's step in root user units, kept in the file; null: automatic (1-2-5). */
  setGridStep(step: number | null): void {
    const doc = this.#doc;
    if (!doc || (step !== null && !(step > 0 && Number.isFinite(step)))) return;
    const s = readState(doc);
    if (s.grid === step) return;
    this.#dispatch('Set grid step', (apply) => writeState(doc, { ...s, grid: step }, apply));
    this.#show();
  }

  // The guides in view, in host px, each with its pill at the canvas's top edge (vertical) or left
  // edge, and its place in the file's list (what a pill drag moves).
  #guideMarks(): OverlayModel['guides'] {
    const doc = this.#doc;
    const box = this.#box;
    if (!doc || !box) return [];
    const toHost = rootToHostMatrix(box, this.#viewport, this.#M);
    const g = this.#gesture;
    return readState(doc).guides.flatMap((gd, i) => {
      const [hx, hy] = applyM(toHost, gd.at, gd.at);
      const at = gd.axis === 'v' ? hx : hy;
      if (!(at >= 0 && at <= (gd.axis === 'v' ? this.#size.width : this.#size.height))) return []; // out of view: not drawn
      return [{ index: i, axis: gd.axis, at, pill: gd.axis === 'v' ? { x: at, y: PILL_LONG / 2 } : { x: PILL_LONG / 2, y: at }, active: g?.guide === i && g.mode === 'guide' }];
    });
  }

  #startGuide(g: Gesture): void {
    g.mode = 'none';
    if (!this.#session || !this.#writable()) return;
    const box = this.#box;
    if (!box) return;
    const toHost = rootToHostMatrix(box, this.#viewport, this.#M);
    g.gd = { drag: this.#drag('Move guide'), step: snapStep(Math.abs(toHost[0])), tip: null };
    g.mode = 'guide';
  }

  // A pill drag: the guide follows the pointer in whole units (the snap step).
  #guideFrame(g: Gesture): void {
    const doc = this.#doc!;
    const gd = g.gd!;
    const inv = invert(rootToHostMatrix(this.#box!, this.#viewport, this.#M));
    const guide = readState(doc).guides[g.guide!];
    if (!inv || !guide) return;
    const [rx, ry] = applyM(inv, g.at.x, g.at.y);
    const at = toStep(guide.axis === 'v' ? rx : ry, gd.step);
    gd.drag.update((apply) => moveGuide(doc, g.guide!, at, stepDecimals(gd.step), apply));
    gd.tip = `${guide.axis === 'v' ? 'x' : 'y'} = ${fmt(at, stepDecimals(gd.step))}`;
    this.#show();
  }

  // The end of a pill drag: one "Move guide", or, dropped off the canvas, one "Remove guide".
  #endGuide(g: Gesture, commit: boolean): void {
    const gd = g.gd;
    if (!gd) return;
    g.gd = null;
    const off = g.at.x < 0 || g.at.y < 0 || g.at.x > this.#size.width || g.at.y > this.#size.height;
    if (commit && !off) gd.drag.commit();
    else gd.drag.cancel();
    if (commit && off) this.removeGuide(g.guide!);
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
  // displayed, visible and not locked, whose screen box lies inside `r` (host px; null: anywhere).
  #leaves(r: Rect | null): NodeId[] {
    const doc = this.#doc!;
    const ids = [...this.#elements()].filter((id) => {
      const n = doc.nodes.get(id);
      return n?.kind === 'element' && id !== doc.root && selectionTarget(doc, id) === id && !CONTAINERS.has(n.local) && !TEXT_PARTS.has(n.local) && displayNone(doc, id) !== true && !isLocked(doc, id);
    });
    const measured = this.#ports.canvas.measure(ids);
    return ids.filter((id) => {
      const m = measured.get(id);
      if (!m || m.hidden) return false;
      if (!r) return true;
      const b = unionBox([quadOf(m.box, m.toHost)])!;
      return b.x >= r.x - 0.5 && b.y >= r.y - 0.5 && b.x + b.width <= r.x + r.width + 0.5 && b.y + b.height <= r.y + r.height + 0.5;
    });
  }

  // The gesture's marks: the marquee, or while moving the tooltip and (for one element) the
  // coordinate guides from the artboard's edges. `measured`: what the model measured this frame (the
  // selection), so a move of 2,000 shapes isn't measured twice.
  #gestureMarks(model: OverlayModel, paper: Rect, measured: ReadonlyMap<NodeId, Measured>): void {
    const g = this.#gesture;
    const doc = this.#doc!;
    if (!g) return;
    if (g.mode === 'marquee') {
      model.marquee = rectOf(g.at0, g.at);
      return;
    }
    model.snapLines = g.snapLines;
    if (g.mode === 'draw' && g.draw?.tip) model.tip = tip(g.draw.tip, g.at);
    if (g.mode === 'handle' && g.hd?.tip) model.tip = tip(g.hd.tip, g.at);
    if (g.mode === 'guide' && g.gd?.tip) model.tip = tip(g.gd.tip, g.at);
    const m = g.move;
    if (g.mode !== 'move' || !m || !m.delta) return;
    const missing = m.ids.filter((id) => !measured.has(id));
    const more = missing.length ? this.#ports.canvas.measure(missing) : null;
    const quads = m.ids.flatMap((id) => {
      const x = measured.get(id) ?? more?.get(id);
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

  /**
   * Run one named transaction; a refused edit becomes the notice and changes nothing. While a drag
   * holds the history (a scrub or sheet, a move, a handle or guide drag, a nudge) it does nothing: a
   * second finger on a panel can't write into the middle of it.
   */
  #dispatch(label: string, build: Build): boolean {
    if (!this.#session || this.#live || this.#gesture?.move || this.#gesture?.hd || this.#gesture?.gd || this.#gesture?.draw?.drag || this.#nudge || this.#stepDrag || this.#field || !this.#writable()) return false;
    try {
      this.#session.dispatch(label, build);
      this.#noteDetached();
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
    this.#live = { kind: 'token', drag: this.#drag(labelFor('Scrub', t)), ref: hit.ref, token: t, last: null };
  }

  scrub(steps: number): void {
    const live = this.#live;
    if (live?.kind !== 'token' || live.token.kind !== 'number') return;
    this.#write(stepped(live.token, steps));
  }

  scrubEnd(committed: boolean): void {
    this.#endLive(committed);
  }

  #openSheet(sheet: TokenSheet): void {
    if (!this.#session || this.#live || this.#nudge || !this.#writable()) return;
    this.#live = { kind: 'token', drag: this.#drag(labelFor('Set', sheet.token)), ref: sheet.ref, token: sheet.token, last: null };
    this.sheet.set(sheet);
    this.#bump();
  }

  /**
   * A value typed or picked in the open Number, Color or Text sheet, or the style sheet. It is
   * checked against the token (or the property) first; refused text is never written (the message
   * says why) and the last good value stays. The sheet's edits are one history entry, committed
   * when it closes. `prop` names another property the style sheet writes in the same visit (the
   * stroke sheet's stroke-width slider).
   */
  sheetInput(input: string, prop?: string): Checked {
    const live = this.#live;
    const sheet = this.sheet.get();
    if (!live || !sheet || sheet.kind === 'source') return { error: 'No value is open' };
    if (live.kind === 'style') return this.#styleInput(live, prop ?? live.prop, input);
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

  // Write one frame of the live token drag. A refused edit writes the last good text again.
  #write(text: string): string | null {
    const live = this.#live;
    const doc = this.#doc;
    if (live?.kind !== 'token' || !doc) return 'Nothing is being edited';
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
    if (commit && live.kind === 'style') this.#kept(live.prop, live.ids, live.refused);
    this.#bump();
    this.#changed();
    if (live.kind === 'style') this.#show();
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
      this.#noteDetached();
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
    this.#stepDrag = null;
    this.#field = null;
    this.tool.set('select');
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
/** The tools the ToolRail offers now. */
export type Tool = 'select' | 'shapes';
/** The notice when an edit makes a generated shape plain. */
export const DETACHED = 'It’s a plain shape now: its generator inputs were dropped.';
// A style sheet opened on a value a rule may decide for the first element starts from the initial one.
const STYLE_INITIAL: Readonly<Record<string, string>> = { fill: 'black', stroke: 'none', color: 'black', 'stop-color': 'black' };
/** An Inspect field that is one history entry while it is typed in: a generator input (S1), or a style property over the selection (S2). */
export type Field =
  | { kind: 'input'; name: string }
  | { kind: 'style'; prop: string; ids?: NodeId[] }
  /** A stop's offset (S3): typed as 0–1, written in its own unit. */
  | { kind: 'offset'; stop: NodeId }
  /** A radial gradient's fx, fy or fr (S3), where it lives in the chain. */
  | { kind: 'gradient'; prop: PaintProp; name: 'fx' | 'fy' | 'fr' };
interface FieldSession {
  field: Field;
  ids: NodeId[]; // the generated shape, or the selection
  drag: Drag;
  refused: { id: NodeId; why: string }[]; // a style field's last frame's
}
const CORNERS = new Set(['tl', 'tr', 'br', 'bl']);
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
  box: Rect | null; // the moving box at the start, root units (what snaps: its edges and centre)
  centre: boolean; // the centre handle's move: only the centre snaps
  targets: SnapTargets | null; // null: no snapping (a nudge)
  px: number; // screen px per root unit
}
interface Gesture {
  at0: Point; // host px where the pointer went down
  at: Point;
  target: NodeId | null; // what a tap selects: the topmost hit's selectable element that isn't locked
  onLocked: boolean; // the topmost hit is locked: a drag from it is a marquee
  add: boolean; // Select more, or ⇧/⌘ on the press
  mode: 'pending' | 'move' | 'marquee' | 'handle' | 'guide' | 'draw' | 'none';
  move: MoveState | null;
  handle: string | null; // the handle the press took (handles.ts), if any
  handleAt: Point | null; // where that handle was, host px (the grab offset)
  draw: DrawGesture | null; // the Shapes tool's gesture
  hd: HandleDrag | null; // a resize, rotate or scale drag
  guide: number | null; // the guide whose pill the press took, by index
  gd: { drag: Drag; step: number; tip: string | null } | null; // a guide's drag
  snapLines: Line[]; // host px: the targets the last frame snapped to
}
// A handle drag: a corner (resize), the ring (rotate) or the diamond (scale), on one element.
interface HandleDrag {
  handle: string;
  id: NodeId;
  drag: Drag;
  corner: Corner | null;
  toUnits: Affine | null; // host px → the units a corner is written in (its own, or its parent's for a uniform scale)
  box: Rect | null; // a uniform scale's box, in the parent's units
  uniform: boolean;
  step: number; // the snap step in those units
  pivot: Point; // host px (rotate, scale)
  a0: number; // the angle, or the scale, when the drag began
  flip: number; // −1 where the parent mirrors, so an angle reads the other way on screen
  local: Rect | null; // the element's own box at the start (rotate's pivot for text and use)
  tip: string | null;
  refused: string | null;
  targets: SnapTargets | null; // a corner's or a position handle's snap targets, gathered once when the drag starts
  shape: { id: string; role: 'position' | 'length' } | null; // a shape handle (engine/geometry/shape-handles.ts)
  gradient: { prop: PaintProp; geo: GradientGeo; handle: GradientHandleId } | null; // a gradient handle (engine/paint/handles.ts), Edit on canvas
  grab: Point; // the handle's offset from the finger at the press, host px: kept for the whole drag
}
// Edit on canvas: the painted element's gradient, where the canvas measured it, and its handles
// and guides (or why they can't be placed).
interface GradientView {
  prop: PaintProp;
  geo: GradientGeo;
  out: ReturnType<typeof gradientHandles>;
}
// The Shapes tool's gesture: a tap places, a drag draws.
interface DrawGesture {
  kind: ShapeKind;
  step: number; // the snap step in root units, at the press
  targets: SnapTargets | null; // gathered once, when the drag starts
  a: Point | null; // the snapped start, root units
  drag: Drag | null;
  id: NodeId | null; // the shape the last frame inserted
  tip: string | null;
}

const linear = (m: Affine): Affine => [m[0], m[1], m[2], m[3], 0, 0];
/** The box around boxes (Align's target), by a loop: a spread call's arguments are capped (overlay-model's unionBox). */
export const unionRect = (bs: readonly Rect[]): Rect => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bs) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};
/** How the notices name an element: its id, else its tag. */
function elementName(doc: Doc, id: NodeId): string {
  const n = doc.nodes.get(id) as ElementNode;
  const own = attrValue(doc, n, null, 'id');
  return own ? `#${own}` : `<${n.qname}>`;
}
const isIdentity = (m: Affine): boolean => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
const PILL_LONG = 44; // px: a guide's pill, 44 along its guide and 20 across, picked over 44 × 44
/** The guide (its place in the file's list) whose pill a press at `at` takes: within its 44 × 44 pick area, the nearest. */
function pickPill(guides: OverlayModel['guides'], at: Point): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const g of guides) {
    const d = Math.max(Math.abs(at.x - g.pill.x), Math.abs(at.y - g.pill.y));
    if (d <= PILL_LONG / 2 && d < bestD) [best, bestD] = [g.index, d];
  }
  return best;
}
// Elements the overlay gives resize corners (§5.3's table): rect, image, foreignObject, nested svg and
// path, and g, use and text by a uniform scale. Circles, ellipses, lines, polygons, polylines and
// generated shapes take their own shape handles instead (P1-M2); planResize still covers them.
const RESIZABLE = new Set(['rect', 'image', 'foreignObject', 'svg', 'path', 'g', 'use', 'text', 'a', 'switch']);
/** The box around a host-px rectangle's corners through `inv` (host px → some units). */
function rectInRoot(inv: Affine, r: Rect): Rect {
  const pts = [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]].map(([x, y]) => applyM(inv, x, y));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
const rectOf = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });

/** Is one of `id`'s ancestors in `set`? */
function hasAncestorIn(doc: Doc, id: NodeId, set: ReadonlySet<NodeId>): boolean {
  for (let n = doc.nodes.get(id)?.parent ?? null; n !== null; n = doc.nodes.get(n)?.parent ?? null) if (set.has(n)) return true;
  return false;
}

/** The elements of `sel` that aren't inside another element of `sel` (each one's ancestors walked once, against a Set). */
function outermost(doc: Doc, sel: readonly NodeId[]): NodeId[] {
  const set = new Set(sel);
  return sel.filter((id) => !hasAncestorIn(doc, id, set));
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
