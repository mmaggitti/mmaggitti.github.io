// The input arbiter, as a pure state machine: pointer events in, intents out. No DOM, so node
// --test drives it. The shape follows Draw's src/canvas/gestures.ts; the rules are Fractal's:
//
// - One finger in app content belongs to the app: never claimed.
// - Two fingers anywhere move the camera (pinch and pan). The pair is claimed as soon as the second
//   finger lands; a finger WebKit cancelled (native scroll won) is forgotten.
// - Captions take plain taps (the browser's click): no double-tap there, since a first tap already
//   zooms and a second would step straight back out.
// - One finger across the capsule: a swipe flips to the neighbour.
// - One finger from an edge strip: a swipe walks history (left edge back, right edge forward).
// - In Arrange mode, one finger on a tab, a panel or a divider lifts it once it moves past the slop:
//   a drag (tab or panel) or a resize (divider). A second finger before the lift makes it a camera
//   gesture instead; once lifted, more fingers are ignored. A double-tap on a divider evens it.

export type Region = 'content' | 'chrome' | 'caption' | 'capsule' | 'edge-left' | 'edge-right' | 'tab' | 'panel' | 'divider';

export interface PointerIn {
  id: number;
  x: number;
  y: number;
  t: number;
  touch: boolean;
}

export type Intent =
  | { type: 'camera-start'; x: number; y: number }
  | { type: 'camera-move'; x: number; y: number; scale: number }
  | { type: 'camera-end'; x: number; y: number; scale: number; vx: number; vy: number }
  | { type: 'edge-move'; side: 'left' | 'right'; dx: number }
  | { type: 'edge-end'; side: 'left' | 'right'; commit: boolean }
  | { type: 'bar-swipe'; dir: -1 | 1 }
  /** A long press picked something up outside Arrange: Arrange turns on (a drag-start follows). */
  | { type: 'arrange-on' }
  /** A tab (target: the app) or a panel (target: the panel) lifted; x0, y0 is where it was pressed. */
  | { type: 'drag-start'; region: 'tab' | 'panel'; target: string; x0: number; y0: number; x: number; y: number }
  | { type: 'drag-move'; x: number; y: number }
  | { type: 'drag-end'; x: number; y: number }
  | { type: 'drag-cancel' }
  /** target: the divider's "split:seam" key. */
  | { type: 'resize-start'; target: string; x0: number; y0: number }
  | { type: 'resize-move'; dx: number; dy: number }
  | { type: 'resize-end'; dx: number; dy: number }
  | { type: 'resize-cancel' }
  | { type: 'equalize'; target: string };

export const SLOP = { touch: 10, mouse: 4 };
export const DOUBLE_TAP = { ms: 300, px: 24 };
export const SWIPE = { px: 40, ratio: 1.5, flick: 0.5 };
export const EDGE_COMMIT = 0.3;
/** How long a still press on a caption name or a map tile takes to pick it up. */
export const HOLD_MS = 500;

interface Tracked {
  id: number;
  region: Region;
  target: string;
  /** The panel a tab or caption belongs to. */
  panel: string;
  x0: number;
  y0: number;
  t0: number;
  x: number;
  y: number;
  t: number;
  /** Velocity from recent moves, px/ms. */
  vx: number;
  vy: number;
  touch: boolean;
  moved: boolean;
}

export class GestureMachine {
  private pointers = new Map<number, Tracked>();
  private camera: { d0: number } | null = null;
  /** After a camera gesture, remaining fingers do nothing until all lift. */
  private spent = false;
  private lastTap: { target: string; x: number; y: number; t: number } | null = null;
  /** The pointer carrying a drag or resize, once lifted. */
  private lifted: { id: number; kind: 'drag' | 'resize' } | null = null;
  /** The workspace width, for the edge-swipe commit distance. */
  width = 440;
  /** Arrange mode: tabs, panels and dividers can be lifted. */
  arrange = false;

  get active(): boolean {
    return this.camera !== null;
  }

  /** A drag or resize is under way. */
  get dragging(): boolean {
    return this.lifted !== null;
  }

  down(p: PointerIn, region: Region, target = '', panel = target): Intent[] {
    if (this.lifted) return [];
    this.pointers.set(p.id, { id: p.id, region, target, panel, x0: p.x, y0: p.y, t0: p.t, x: p.x, y: p.y, t: p.t, vx: 0, vy: 0, touch: p.touch, moved: false });
    if (this.pointers.size === 2 && !this.camera && !this.spent) {
      const [a, b] = [...this.pointers.values()];
      this.camera = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
      const c = mid(a, b);
      return [{ type: 'camera-start', x: c.x, y: c.y }];
    }
    return [];
  }

  move(p: PointerIn): Intent[] {
    const tr = this.pointers.get(p.id);
    if (!tr) return [];
    const dt = Math.max(1, p.t - tr.t);
    tr.vx = 0.6 * ((p.x - tr.x) / dt) + 0.4 * tr.vx;
    tr.vy = 0.6 * ((p.y - tr.y) / dt) + 0.4 * tr.vy;
    tr.x = p.x;
    tr.y = p.y;
    tr.t = p.t;
    if (Math.hypot(p.x - tr.x0, p.y - tr.y0) > (tr.touch ? SLOP.touch : SLOP.mouse)) tr.moved = true;
    if (this.lifted) {
      if (p.id !== this.lifted.id) return [];
      return this.lifted.kind === 'drag' ? [{ type: 'drag-move', x: p.x, y: p.y }] : [{ type: 'resize-move', dx: p.x - tr.x0, dy: p.y - tr.y0 }];
    }
    if (this.camera) {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return [];
      const c = mid(a, b);
      return [{ type: 'camera-move', x: c.x, y: c.y, scale: Math.hypot(a.x - b.x, a.y - b.y) / this.camera.d0 }];
    }
    if (this.spent || this.pointers.size !== 1) return [];
    if (this.arrange && tr.moved && (tr.region === 'tab' || tr.region === 'panel')) {
      this.lifted = { id: tr.id, kind: 'drag' };
      return [
        { type: 'drag-start', region: tr.region, target: tr.target, x0: tr.x0, y0: tr.y0, x: p.x, y: p.y },
        { type: 'drag-move', x: p.x, y: p.y },
      ];
    }
    if (this.arrange && tr.moved && tr.region === 'divider') {
      this.lifted = { id: tr.id, kind: 'resize' };
      return [
        { type: 'resize-start', target: tr.target, x0: tr.x0, y0: tr.y0 },
        { type: 'resize-move', dx: p.x - tr.x0, dy: p.y - tr.y0 },
      ];
    }
    if (tr.region === 'edge-left' || tr.region === 'edge-right') {
      const side = tr.region === 'edge-left' ? 'left' : 'right';
      const dx = side === 'left' ? Math.max(0, p.x - tr.x0) : Math.max(0, tr.x0 - p.x);
      return [{ type: 'edge-move', side, dx }];
    }
    return [];
  }

  up(p: PointerIn): Intent[] {
    const tr = this.pointers.get(p.id);
    if (!tr) return [];
    if (p.t > tr.t) this.move(p);
    const out: Intent[] = [];
    if (this.lifted) {
      if (p.id === this.lifted.id) {
        out.push(this.lifted.kind === 'drag' ? { type: 'drag-end', x: tr.x, y: tr.y } : { type: 'resize-end', dx: tr.x - tr.x0, dy: tr.y - tr.y0 });
        this.lifted = null;
        this.spent = this.pointers.size > 1;
      }
    } else if (this.camera) {
      const [a, b] = [...this.pointers.values()];
      const c = b ? mid(a, b) : { x: tr.x, y: tr.y };
      const scale = b ? Math.hypot(a.x - b.x, a.y - b.y) / this.camera.d0 : 1;
      const vx = b ? (a.vx + b.vx) / 2 : tr.vx;
      const vy = b ? (a.vy + b.vy) / 2 : tr.vy;
      out.push({ type: 'camera-end', x: c.x, y: c.y, scale, vx, vy });
      this.camera = null;
      this.spent = true;
    } else if (!this.spent && this.pointers.size === 1) out.push(...this.single(tr, p.t));
    this.pointers.delete(p.id);
    if (!this.pointers.size) this.spent = false;
    return out;
  }

  /** WebKit cancelled a pointer (native scrolling won, or the system took the touch). */
  cancel(id: number): Intent[] {
    const tr = this.pointers.get(id);
    if (!tr) return [];
    this.pointers.delete(id);
    const out: Intent[] = [];
    if (this.lifted) {
      if (id === this.lifted.id) {
        out.push({ type: this.lifted.kind === 'drag' ? 'drag-cancel' : 'resize-cancel' });
        this.lifted = null;
        this.spent = this.pointers.size > 0;
      }
    } else if (this.camera) {
      out.push({ type: 'camera-end', x: tr.x, y: tr.y, scale: 1, vx: 0, vy: 0 });
      this.camera = null;
      this.spent = this.pointers.size > 0;
    } else if (tr.region === 'edge-left' || tr.region === 'edge-right') {
      out.push({ type: 'edge-end', side: tr.region === 'edge-left' ? 'left' : 'right', commit: false });
    }
    if (!this.pointers.size) this.spent = false;
    return out;
  }

  /** The runtime's HOLD_MS timer for a press: a single, still press on a tab (a caption name) or a
   * panel (a tile you can't use) picks it up, turning Arrange on. The iOS Home Screen idiom. */
  hold(id: number): Intent[] {
    const tr = this.pointers.get(id);
    if (!tr || tr.moved || this.pointers.size !== 1 || this.camera || this.lifted || this.spent) return [];
    if (tr.region !== 'tab' && tr.region !== 'panel') return [];
    this.lifted = { id, kind: 'drag' };
    const out: Intent[] = this.arrange ? [] : [{ type: 'arrange-on' }];
    this.arrange = true;
    out.push({ type: 'drag-start', region: tr.region, target: tr.target, x0: tr.x0, y0: tr.y0, x: tr.x, y: tr.y });
    return out;
  }

  /** Abandon a drag or resize (Esc, blur, leaving Arrange). */
  cancelLift(): Intent[] {
    if (!this.lifted) return [];
    const kind = this.lifted.kind;
    this.lifted = null;
    this.spent = this.pointers.size > 0;
    return [{ type: kind === 'drag' ? 'drag-cancel' : 'resize-cancel' }];
  }

  private single(tr: Tracked, t: number): Intent[] {
    const dx = tr.x - tr.x0;
    const dy = tr.y - tr.y0;
    if (tr.region === 'edge-left' || tr.region === 'edge-right') {
      const side = tr.region === 'edge-left' ? 'left' : 'right';
      const along = side === 'left' ? dx : -dx;
      const v = side === 'left' ? tr.vx : -tr.vx;
      return [{ type: 'edge-end', side, commit: along > EDGE_COMMIT * this.width || (along > SWIPE.px && v > SWIPE.flick) }];
    }
    if (tr.region === 'capsule') {
      const far = Math.abs(dx) > SWIPE.px && Math.abs(dx) > SWIPE.ratio * Math.abs(dy);
      const flick = Math.abs(tr.vx) > SWIPE.flick && Math.abs(dx) > SWIPE.px / 2 && Math.abs(dx) > Math.abs(dy);
      return far || flick ? [{ type: 'bar-swipe', dir: dx < 0 ? 1 : -1 }] : [];
    }
    if (tr.region === 'divider' && !tr.moved) {
      const last = this.lastTap;
      if (last && last.target === tr.target && t - last.t <= DOUBLE_TAP.ms && Math.hypot(tr.x - last.x, tr.y - last.y) <= DOUBLE_TAP.px) {
        this.lastTap = null;
        return [{ type: 'equalize', target: tr.target }];
      }
      this.lastTap = { target: tr.target, x: tr.x, y: tr.y, t };
    }
    return [];
  }
}

function mid(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
