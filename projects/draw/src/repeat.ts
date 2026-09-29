// Hold to repeat: SVG Lab's stepper buttons. A press acts at once; held, it acts again after
// HOLD_DELAY and then every HOLD_EVERY until it is let go. Pure over injected timers, so the unit
// tests step through it; the Number sheet's − and + use it.

import { realTimers, type Timers } from './autosave.ts';

export const HOLD_DELAY = 400; // ms before the first repeat's interval starts
export const HOLD_EVERY = 70; // ms between repeats

export class Repeat {
  #timers: Timers;
  #handle: unknown = null;

  constructor(timers: Timers = realTimers) {
    this.#timers = timers;
  }

  /** A press: `fn` now, then again every HOLD_EVERY once HOLD_DELAY has passed, until stop(). */
  start(fn: () => void): void {
    this.stop();
    fn();
    const tick = () => {
      fn();
      this.#handle = this.#timers.set(tick, HOLD_EVERY);
    };
    this.#handle = this.#timers.set(() => (this.#handle = this.#timers.set(tick, HOLD_EVERY)), HOLD_DELAY);
  }

  /** Let go (or the press was cancelled, or left the button). */
  stop(): void {
    if (this.#handle !== null) this.#timers.clear(this.#handle);
    this.#handle = null;
  }
}
