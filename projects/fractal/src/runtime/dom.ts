// Small DOM helpers. Rendering runs every animation frame, so style writes go through a cache and
// only touch the DOM when a value changed. (The idea of Trellis's runtime/dom.ts.)

import type { Rect } from '../core/types.ts';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

const cache = new WeakMap<HTMLElement, Record<string, string>>();

export function setStyle(e: HTMLElement, key: string, value: string) {
  let c = cache.get(e);
  if (!c) cache.set(e, (c = {}));
  if (c[key] === value) return;
  c[key] = value;
  e.style.setProperty(key, value);
}

export function setAttr(e: Element, key: string, value: string | null) {
  if (value === null) {
    if (e.hasAttribute(key)) e.removeAttribute(key);
  } else if (e.getAttribute(key) !== value) e.setAttribute(key, value);
}

/** Position an element at a rect, drawn at scale s: it lays out at (w/s × h/s) and is scaled down,
 * so its own contents keep their true sizes. Rounded to whole pixels only at rest. */
export function place(e: HTMLElement, r: Rect, s: number, round: boolean) {
  let { x, y, w, h } = r;
  if (round) {
    const x2 = Math.round(x + w);
    const y2 = Math.round(y + h);
    x = Math.round(x);
    y = Math.round(y);
    w = x2 - x;
    h = y2 - y;
  }
  setStyle(e, 'transform', s === 1 ? `translate(${x}px, ${y}px)` : `translate(${x}px, ${y}px) scale(${s})`);
  setStyle(e, 'width', `${Math.max(0, w / s)}px`);
  setStyle(e, 'height', `${Math.max(0, h / s)}px`);
}
