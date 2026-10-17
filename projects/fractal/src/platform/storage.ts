// The only code that touches storage. Every project on the site shares this origin, so keys carry
// the `fractal:` prefix and everything read back is sanitized before use.
//
// localStorage, not IndexedDB: the data is small, and a synchronous write survives the page being
// hidden or killed (Draw found WebKit drops IndexedDB writes started during unload).

import type { LayoutDoc } from '../core/types.ts';
import { sanitize } from '../core/sanitize.ts';

const LAYOUT = 'fractal:layout';
const DELAY = 300;

export function loadLayout(): LayoutDoc | null {
  try {
    const raw = localStorage.getItem(LAYOUT);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export type SaveError = (message: string) => void;

/** Debounced saving, flushed when the page is hidden. Returns `save(doc)`. */
export function layoutSaver(onError: SaveError): (doc: LayoutDoc) => void {
  let pending: LayoutDoc | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const doc = pending;
    pending = null;
    try {
      localStorage.setItem(LAYOUT, JSON.stringify(doc));
    } catch {
      onError('Couldn’t save the layout: storage is full or blocked.');
    }
  };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  return (doc) => {
    pending = doc;
    clearTimeout(timer);
    timer = setTimeout(flush, DELAY);
  };
}
