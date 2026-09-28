// Scrubbing a number in the code: SVG Lab's rule, kept because it feels right on a phone. A drag
// becomes a scrub once it has moved SCRUB_START pixels and more sideways than up or down (so a
// vertical drag still scrolls the code); then every `pps` pixels is one step. Less than that and
// it was a tap, which opens the Number sheet instead. Pure, so it is unit-tested in node.

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

/** The value a scrub of `steps` gives: rounded to the token's own precision and clamped. */
export function scrubValue(v0: number, steps: number, decimals: number, min = -Infinity, max = Infinity): number {
  const step = 10 ** -Math.min(decimals, 3);
  const v = Math.round((v0 + steps * step) * 10 ** decimals) / 10 ** decimals;
  return Math.min(max, Math.max(min, v));
}
