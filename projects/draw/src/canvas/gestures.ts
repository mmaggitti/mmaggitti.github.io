// Who owns a pointer on the canvas. Pure logic over plain pointer inputs (the Canvas feeds it
// Pointer Events), so every rule is unit-tested in node.
//
// - One finger, the mouse, or the Apple Pencil belongs to the current tool: down, then a tap or a
//   drag once it moves more than SLOP pixels.
// - A second finger turns a finger gesture into navigation: the tool gesture is cancelled (the tool
//   undoes its live preview) and the two fingers pinch and pan.
// - The Pencil always draws, and fingers never reach the tool while it is down (palm rejection);
//   two fingers still navigate.
// - A quick two-finger tap that barely moves is undo.
// - A drag that starts after the pointer was held still for HOLD_MS is `held` (the Select tool
//   draws a marquee then, even over shapes and handles).
// - Pen mode (P1-M5): the first pen event, a press or a hover, latches it (`penMode`), until the page
//   reloads or the rail's Pencil button leaves it (leavePenMode). In pen mode the Pencil is the tool
//   and fingers only navigate: one finger pans once it moves past the slop (a resting finger does
//   nothing), two pinch and pan as before, and a two-finger tap is no undo. The Stage reads the latch
//   (the event stream stays as it was, so the gestures before pen mode read exactly as before).
// - A hovering Pencil (a pen move with no button pressed, from a pointer that never went down) is
//   `hover`; it ends (`hover-end`) when the pen leaves or is cancelled, and before any press.

export type PointerKind = 'touch' | 'pen' | 'mouse';

export interface PointerInput {
  type: 'down' | 'move' | 'up' | 'cancel' | 'leave';
  id: number;
  x: number;
  y: number;
  t: number; // ms
  kind: PointerKind;
  /** The buttons pressed (PointerEvent.buttons): 0 for a hovering pen. */
  buttons?: number;
}

export interface Pt {
  x: number;
  y: number;
}

export type GestureEvent =
  | { type: 'tool-down'; at: Pt; kind: PointerKind }
  | { type: 'tool-drag-start'; from: Pt; at: Pt; held: boolean }
  | { type: 'tool-drag'; at: Pt }
  | { type: 'tool-drag-end'; at: Pt }
  | { type: 'tool-tap'; at: Pt; kind: PointerKind }
  | { type: 'tool-cancel' }
  | { type: 'nav-start' }
  | { type: 'nav'; a0: Pt; b0: Pt; a1: Pt; b1: Pt }
  | { type: 'nav-end' }
  | { type: 'two-finger-tap' }
  | { type: 'pan-start' }
  | { type: 'pan'; from: Pt; at: Pt }
  | { type: 'pan-end' }
  | { type: 'hover'; at: Pt }
  | { type: 'hover-end' };

export const SLOP = 5; // px: a tap moves less than this
export const TWO_FINGER_TAP_MS = 300;
export const HOLD_MS = 450; // a drag that starts this long after the press, still inside the slop, is held

interface Track {
  id: number;
  kind: PointerKind;
  start: Pt;
  at: Pt;
  t0: number;
  palm?: boolean; // a finger the Pencil took the tool from: a resting hand, ignored until it lifts
}

export class GestureMachine {
  private tracks = new Map<number, Track>();
  private tool: { id: number; dragging: boolean } | null = null;
  private nav: { a: number; b: number; a0: Pt; b0: Pt; t0: number; moved: boolean } | null = null;
  private idleUntilAllUp = false; // after navigation, leftover fingers do nothing
  private latched = false; // pen mode
  private hovering = false;
  private pan: { id: number; started: boolean; last: Pt } | null = null; // one finger, in pen mode

  /** Pen mode: latched by the first pen event, kept until leavePenMode. */
  get penMode(): boolean {
    return this.latched;
  }

  /** Leave pen mode (the rail's Pencil button): fingers are the tool again, and a two-finger tap undoes. */
  leavePenMode(): void {
    this.latched = false;
  }

  feed(e: PointerInput): GestureEvent[] {
    const out: GestureEvent[] = [];
    const at = { x: e.x, y: e.y };
    if (e.kind === 'pen' && !this.tracks.has(e.id) && e.type !== 'down') {
      // A Pencil above the screen: a move with no button pressed is hover; leaving or a cancel ends it.
      if (e.type === 'move' && e.buttons === 0) {
        this.latched = true;
        this.hovering = true;
        out.push({ type: 'hover', at });
      } else if (e.type !== 'move') this.endHover(out);
      return out;
    }
    if (e.type === 'leave') return out; // a pressed pointer's leave: its up or cancel says what ended
    if (e.type === 'down') {
      this.endHover(out);
      if (e.kind === 'pen') this.latched = true;
      this.tracks.set(e.id, { id: e.id, kind: e.kind, start: at, at, t0: e.t });
      this.onDown(e, at, out);
    } else {
      const tr = this.tracks.get(e.id);
      if (!tr) return out;
      tr.at = at;
      if (e.type === 'move') this.onMove(e, tr, at, out);
      else {
        this.onUp(e, tr, at, out);
        this.tracks.delete(e.id);
        if (!this.tracks.size) this.idleUntilAllUp = false;
      }
    }
    return out;
  }

  private endHover(out: GestureEvent[]): void {
    if (!this.hovering) return;
    this.hovering = false;
    out.push({ type: 'hover-end' });
  }

  private penDown(): boolean {
    return [...this.tracks.values()].some((t) => t.kind === 'pen');
  }

  private onDown(e: PointerInput, at: Pt, out: GestureEvent[]): void {
    if (e.kind === 'pen') {
      // The Pencil takes the tool from a finger that had it.
      const had = this.tool && this.tracks.get(this.tool.id);
      if (had && had.kind !== 'pen') {
        out.push({ type: 'tool-cancel' });
        if (had.kind === 'touch') had.palm = true;
        this.tool = null;
      }
      if (!this.tool) {
        this.tool = { id: e.id, dragging: false };
        out.push({ type: 'tool-down', at, kind: 'pen' });
      }
      return;
    }
    if (e.kind === 'mouse') {
      if (!this.tool && !this.nav) {
        this.tool = { id: e.id, dragging: false };
        out.push({ type: 'tool-down', at, kind: 'mouse' });
      }
      return;
    }
    // a finger
    const fingers = [...this.tracks.values()].filter((t) => t.kind === 'touch' && !t.palm);
    if (this.nav || this.idleUntilAllUp) return;
    if (this.latched && fingers.length === 1) {
      // Pen mode: one finger only ever pans, once it moves (even while the Pencil holds the tool).
      this.pan = { id: e.id, started: false, last: at };
      return;
    }
    if (fingers.length === 1 && !this.tool && !this.penDown()) {
      this.tool = { id: e.id, dragging: false };
      out.push({ type: 'tool-down', at, kind: 'touch' });
      return;
    }
    if (fingers.length === 2) {
      if (this.tool && this.tracks.get(this.tool.id)?.kind === 'touch') {
        out.push({ type: 'tool-cancel' });
        this.tool = null;
      }
      if (this.pan?.started) out.push({ type: 'pan-end' });
      this.pan = null;
      const [a, b] = fingers;
      this.nav = { a: a.id, b: b.id, a0: a.at, b0: b.at, t0: Math.min(a.t0, b.t0), moved: false };
      out.push({ type: 'nav-start' });
    }
  }

  private onMove(e: PointerInput, tr: Track, at: Pt, out: GestureEvent[]): void {
    if (this.tool && this.tool.id === e.id) {
      if (!this.tool.dragging && Math.hypot(at.x - tr.start.x, at.y - tr.start.y) >= SLOP) {
        // Every move before this one stayed inside the slop, or the drag would have started then.
        this.tool.dragging = true;
        out.push({ type: 'tool-drag-start', from: tr.start, at, held: e.t - tr.t0 >= HOLD_MS });
      } else if (this.tool.dragging) out.push({ type: 'tool-drag', at });
      return;
    }
    if (this.pan && this.pan.id === e.id) {
      if (!this.pan.started) {
        if (Math.hypot(at.x - tr.start.x, at.y - tr.start.y) < SLOP) return;
        this.pan.started = true;
        out.push({ type: 'pan-start' });
        this.pan.last = tr.start; // the first pan takes the slop's way too
      }
      out.push({ type: 'pan', from: this.pan.last, at });
      this.pan.last = at;
      return;
    }
    if (this.nav && (e.id === this.nav.a || e.id === this.nav.b)) {
      const a = this.tracks.get(this.nav.a)!;
      const b = this.tracks.get(this.nav.b)!;
      if (Math.hypot(a.at.x - a.start.x, a.at.y - a.start.y) >= SLOP || Math.hypot(b.at.x - b.start.x, b.at.y - b.start.y) >= SLOP) this.nav.moved = true;
      out.push({ type: 'nav', a0: this.nav.a0, b0: this.nav.b0, a1: a.at, b1: b.at });
    }
  }

  private onUp(e: PointerInput, tr: Track, at: Pt, out: GestureEvent[]): void {
    if (this.tool && this.tool.id === e.id) {
      if (e.type === 'cancel') out.push({ type: 'tool-cancel' });
      else if (this.tool.dragging) out.push({ type: 'tool-drag-end', at });
      else out.push({ type: 'tool-tap', at, kind: tr.kind });
      this.tool = null;
      return;
    }
    if (this.pan && this.pan.id === e.id) {
      if (this.pan.started) out.push({ type: 'pan-end' });
      this.pan = null;
      return;
    }
    if (this.nav && (e.id === this.nav.a || e.id === this.nav.b)) {
      const quick = e.t - this.nav.t0 <= TWO_FINGER_TAP_MS;
      const tap = !this.latched && e.type === 'up' && quick && !this.nav.moved; // no undo in pen mode
      out.push({ type: 'nav-end' });
      if (tap) out.push({ type: 'two-finger-tap' });
      this.nav = null;
      this.idleUntilAllUp = true;
    }
  }
}
