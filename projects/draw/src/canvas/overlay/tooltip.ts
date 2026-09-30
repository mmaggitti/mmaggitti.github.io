// The drag tooltip (SVG Lab's Stage tip): dark, 42 px above the finger, 40 px below it within 64 px
// of the canvas's top, kept 4 px inside the canvas at the sides. Where it goes is the model's
// (tipBox); this only measures its text's box and places it.

import { tipBox, type Tip } from '../../interact/overlay-model.ts';
import type { Point } from '../viewport.ts';

export class Tooltip {
  #el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.#el = document.createElement('div');
    this.#el.className = 'draw-tip';
    this.#el.setAttribute('aria-hidden', 'true');
    this.#el.hidden = true;
    parent.append(this.#el);
  }

  /** Show `t` (host px), the host's top-left being `offset` in the overlay's px; null hides it. */
  show(t: Tip | null, offset: Point, hostWidth: number): void {
    const el = this.#el;
    if (!t) {
      if (!el.hidden) el.hidden = true;
      return;
    }
    if (el.textContent !== t.text) el.textContent = t.text;
    el.hidden = false;
    el.classList.toggle('below', t.below);
    const { left, top } = tipBox(t, el.offsetWidth, el.offsetHeight, hostWidth);
    el.style.left = `${Math.round((left + offset.x) * 100) / 100}px`;
    el.style.top = `${Math.round((top + offset.y) * 100) / 100}px`;
  }

  destroy(): void {
    this.#el.remove();
  }
}
