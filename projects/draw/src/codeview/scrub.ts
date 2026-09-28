// Scrubbing a number in the code: SVG Lab's rule, kept because it feels right on a phone. A drag
// becomes a scrub once it has moved SCRUB_START pixels and more sideways than up or down (so a
// vertical drag still scrolls the code); then every `pps` pixels is one step. Less than that and
// it may be a tap, which Taps decides for every pointer on the code. Pure, so it is unit-tested
// in node.

export const SCRUB_START = 7; // px
export const DEFAULT_PPS = 4; // px per step

export type ScrubOutcome = 'tap' | 'scrub' | 'none';

export class ScrubGesture {
  private x0 = 0;
  private y0 = 0;
  private anchor: number | null = null; // x where the scrub started
  private active = false;
  private readonly pps: number;

  constructor(pps = DEFAULT_PPS) {
    this.pps = pps;
  }

  down(x: number, y: number): void {
    this.x0 = x;
    this.y0 = y;
    this.anchor = null;
    this.active = true;
  }

  /** Steps from the value at the scrub's start, or null while it is not (yet) a scrub. */
  move(x: number, y: number): number | null {
    if (!this.active) return null;
    if (this.anchor === null) {
      const dx = x - this.x0;
      const dy = y - this.y0;
      if (Math.abs(dx) < SCRUB_START || Math.abs(dx) < Math.abs(dy)) return null;
      this.anchor = x;
      return 0;
    }
    return Math.round((x - this.anchor) / this.pps);
  }

  get scrubbing(): boolean {
    return this.anchor !== null;
  }

  up(cancelled = false): ScrubOutcome {
    if (!this.active) return 'none';
    this.active = false;
    if (this.anchor !== null) return 'scrub';
    return cancelled ? 'none' : 'tap';
  }
}

/**
 * Which lifts of a finger (or the mouse) on the code are taps: a pointer that went up within
 * SCRUB_START of where it went down, having never strayed further, with no other pointer down at
 * any time in between. A swipe that ends on a token, or a two-finger pinch over the code, is not a
 * tap on anything.
 */
export class Taps {
  private down = new Map<number, { x: number; y: number; still: boolean }>();

  press(id: number, x: number, y: number): void {
    this.down.delete(id); // a mouse released outside the code never lifted here
    for (const p of this.down.values()) p.still = false;
    this.down.set(id, { x, y, still: this.down.size === 0 });
  }

  move(id: number, x: number, y: number): void {
    const p = this.down.get(id);
    if (p && Math.hypot(x - p.x, y - p.y) >= SCRUB_START) p.still = false;
  }

  /** The pointer lifted (or was cancelled: never a tap). Was it a tap? */
  lift(id: number, x: number, y: number, cancelled = false): boolean {
    this.move(id, x, y);
    const p = this.down.get(id);
    this.down.delete(id);
    return !!p && p.still && !cancelled;
  }
}

/** The value a scrub of `steps` gives: rounded to the token's own precision and clamped. */
export function scrubValue(v0: number, steps: number, decimals: number, min = -Infinity, max = Infinity): number {
  const step = 10 ** -Math.min(decimals, 3);
  const v = Math.round((v0 + steps * step) * 10 ** decimals) / 10 ** decimals;
  return Math.min(max, Math.max(min, v));
}
