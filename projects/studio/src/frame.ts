import { useSyncExternalStore } from 'react';

// FrameSession owns the framed page: its document, a MutationObserver on it, the signals that
// move things on screen, and pick mode. React reads two versions, bumped at most once per frame:
//   structure — the DOM changed (the tree re-renders)
//   layout    — something may have moved or resized (highlight and inspector re-render)
// Splitting them keeps a scroll from re-rendering the whole tree.
//
// All studio access to the framed page goes through here. The editor phases will add edits as
// commands applied by this class, so it stays the single place that touches the page.
//
// Framed nodes and windows come from another realm, and a window can navigate cross-origin under
// us, after which touching it throws. Hence the try/catch around teardown and the nodeType checks.

type Picker = (el: Element) => void;
export type Channel = 'structure' | 'layout';

/** Movement beyond this between pointerdown and pointerup is a scroll, not a tap. */
const TAP_SLOP = 10;
/** A touch this soon after a scroll is stopping a fling, not picking. */
const FLING_STOP_MS = 150;

/** Blocked while picking so the page never sees the gesture. Passive unless it must cancel. */
const PROPAGATION_ONLY = [
  'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointercancel',
  'touchstart', 'touchmove', 'touchcancel', 'mouseup', 'mouseover', 'mouseout', 'mousemove',
];
const CANCEL = ['touchend', 'mousedown', 'click', 'dblclick', 'submit', 'contextmenu'];

// While picking: no iOS link-preview callout, no text-selection loupe on long-press.
const PICK_CSS = '* { -webkit-touch-callout: none !important; -webkit-user-select: none !important; user-select: none !important; }';

export class FrameSession {
  private frame: HTMLIFrameElement | null = null;
  private doc: Document | null = null;
  private observer: MutationObserver | null = null;
  private teardown: Array<() => void> = [];
  private pickTeardown: Array<() => void> = [];
  private subs = new Set<() => void>();
  private versions: Record<Channel, number> = { structure: 0, layout: 0 };
  private pending = { structure: false, layout: false };
  private raf = 0;
  private loop = 0;
  private picker: Picker | null = null;
  private downAt: { x: number; y: number; t: number } | null = null;
  private lastScrollAt = -Infinity;
  private watched: Element | null = null;
  private watchedRect = '';
  private onDocument: ((doc: Document | null) => void) | null = null;

  /** The structure version at which each node last changed: the tree flashes those rows. */
  readonly changedAt = new WeakMap<Node, number>();

  get document(): Document | null {
    return this.doc;
  }

  get window(): Window | null {
    return this.doc?.defaultView ?? null;
  }

  /**
   * Follow an iframe for its whole life. A new document is picked up as soon as it exists (a rAF
   * check), not at `load`, which waits for every image: until then pick mode would be off and
   * taps would reach the page. The same loop re-measures the selected element each frame, which
   * catches layout moves that are not mutations (images, fonts, CSSOM edits, transitions).
   */
  bind(frame: HTMLIFrameElement, onDocument: (doc: Document | null) => void): void {
    this.unbind();
    this.frame = frame;
    this.onDocument = onDocument;
    const tick = () => {
      this.loop = requestAnimationFrame(tick);
      this.check();
    };
    this.loop = requestAnimationFrame(tick);
    this.check();
  }

  unbind(): void {
    cancelAnimationFrame(this.loop);
    this.loop = 0;
    this.detach();
    this.frame = null;
    this.onDocument = null;
  }

  /** Also called from the iframe's load event, as a backstop for the rAF check. */
  check = (): void => {
    const frame = this.frame;
    if (!frame) return;
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument; // null once the frame is cross-origin
    } catch {
      doc = null;
    }
    // The initial about:blank of a navigating frame is not worth attaching to.
    if (doc && doc.URL === 'about:blank' && frame.getAttribute('src') !== 'about:blank') doc = null;
    if (doc !== this.doc) {
      this.attach(doc);
      this.onDocument?.(doc);
    }
    if (this.watched) {
      const r = this.watched.isConnected ? this.watched.getBoundingClientRect() : null;
      const key = r ? `${r.x},${r.y},${r.width},${r.height}` : '';
      if (key !== this.watchedRect) {
        this.watchedRect = key;
        this.bump('layout');
      }
    }
  };

  private attach(doc: Document | null): void {
    this.detach();
    this.doc = doc;
    const win = doc?.defaultView;
    if (!doc || !win) {
      this.bump('structure');
      return;
    }

    this.observer = new MutationObserver((records) => {
      for (const r of records) this.changedAt.set(r.target, this.versions.structure + 1);
      this.bump('structure');
    });
    this.observer.observe(doc, { childList: true, subtree: true, attributes: true, characterData: true });

    // Capture phase: scroll doesn't bubble, so this sees every scrolling container.
    const onScroll = () => {
      this.lastScrollAt = performance.now();
      this.bump('layout');
    };
    const onResize = () => this.bump('layout');
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
    win.addEventListener('resize', onResize);
    this.teardown.push(
      () => doc.removeEventListener('scroll', onScroll, { capture: true }),
      () => win.removeEventListener('resize', onResize),
    );

    if (this.picker) this.addPickListeners();
    this.bump('structure');
  }

  private detach(): void {
    this.removePickListeners();
    this.observer?.disconnect();
    this.observer = null;
    for (const fn of this.teardown.splice(0)) {
      try {
        fn();
      } catch {
        // The window navigated cross-origin; its listeners went with it.
      }
    }
    this.doc = null;
    this.downAt = null;
  }

  /** Pick mode on (fn) or off (null). Listeners exist only while picking. */
  setPicker(fn: Picker | null): void {
    this.picker = fn;
    this.removePickListeners();
    if (fn) this.addPickListeners();
  }

  private addPickListeners(): void {
    const doc = this.doc;
    const win = doc?.defaultView;
    if (!doc || !win) return;

    const block = (e: Event) => e.stopImmediatePropagation();
    const cancel = (e: Event) => {
      e.stopImmediatePropagation();
      e.preventDefault(); // no click, no focus, no link navigation, no form submit
    };
    const onDown = (e: PointerEvent) => {
      e.stopImmediatePropagation();
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      e.stopImmediatePropagation();
      const d = this.downAt;
      this.downAt = null;
      if (!d || !this.picker) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) return; // a scroll
      if (d.t - this.lastScrollAt < FLING_STOP_MS) return; // stopping a fling
      const el = doc.elementFromPoint(e.clientX, e.clientY);
      if (el) this.picker(el);
    };

    // On the window in the capture phase: the earliest point the studio can intercept, ahead of
    // the page's own document- and element-level listeners.
    const add = (type: string, fn: EventListener, passive: boolean) => {
      win.addEventListener(type, fn, { capture: true, passive });
      this.pickTeardown.push(() => win.removeEventListener(type, fn, { capture: true }));
    };
    add('pointerdown', onDown as EventListener, true);
    add('pointerup', onUp as EventListener, true);
    for (const t of PROPAGATION_ONLY) add(t, block, true);
    for (const t of CANCEL) add(t, cancel, false);

    // The sheet must come from the frame's realm: a studio-realm sheet can't be adopted there.
    try {
      const Sheet = (win as unknown as { CSSStyleSheet: typeof CSSStyleSheet }).CSSStyleSheet;
      const sheet = new Sheet();
      sheet.replaceSync(PICK_CSS);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      this.pickTeardown.push(() => {
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
      });
    } catch {
      // No constructable stylesheets: long-press may show the callout; picking still works.
    }
  }

  private removePickListeners(): void {
    for (const fn of this.pickTeardown.splice(0)) {
      try {
        fn();
      } catch {
        // cross-origin by now
      }
    }
    this.downAt = null;
  }

  /**
   * Scroll the framed page so el is in view. Only the frame's own window scrolls: the element's
   * scrollIntoView() would also scroll the studio's overflow:hidden containers and shift its layout.
   */
  reveal(el: Element): void {
    const win = this.window;
    if (!win || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return; // not rendered
    if (r.top >= 0 && r.bottom <= win.innerHeight) return;
    win.scrollBy({ top: r.top - win.innerHeight / 3, behavior: 'instant' as ScrollBehavior });
  }

  /** The element whose box the loop re-measures each frame (the selection). */
  watch(el: Element | null): void {
    this.watched = el;
    this.watchedRect = '';
  }

  bump = (channel: Channel = 'layout'): void => {
    this.pending[channel] = true;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.pending.structure) this.versions.structure++;
      // Anything that changes structure can also move things.
      if (this.pending.layout || this.pending.structure) this.versions.layout++;
      this.pending = { structure: false, layout: false };
      for (const fn of this.subs) fn();
    });
  };

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };

  version(channel: Channel): number {
    return this.versions[channel];
  }
}

export const session = new FrameSession();

const getters: Record<Channel, () => number> = {
  structure: () => session.version('structure'),
  layout: () => session.version('layout'),
};

export function useFrameVersion(channel: Channel): number {
  return useSyncExternalStore(session.subscribe, getters[channel]);
}
