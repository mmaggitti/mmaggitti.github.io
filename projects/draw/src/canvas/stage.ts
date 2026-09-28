// The canvas's input, framework-free: Pointer Events through the gesture machine, the wheel, and
// the host's size, turned into the editor's navigation and the Select tool.
//
// - One finger, the mouse or the Pencil is the tool: a tap selects what is under it, found with the
//   shadow root's own hit test and mapped back to its NodeId by the renderer.
// - Two fingers pinch and pan the view; a quick two-finger tap is undo.
// - The wheel pans; with ctrl (a trackpad pinch, or ctrl and the wheel) it zooms about the pointer.
// - The page itself never zooms: app.css gives the canvas touch-action: none (and the rest of the
//   app pan-x pan-y), and Safari's own pinch events (gesturestart and friends) are cancelled here,
//   for the whole document.
// It only listens and reads; it makes no DOM (tools/check-sinks.mjs).

import type { Editor } from '../editor.ts';
import { GestureMachine, type GestureEvent, type PointerKind } from './gestures.ts';
import type { Renderer } from './renderer.ts';

/** Wheel pixels per doubling of the zoom (a notch of most mouse wheels). */
export const WHEEL_PER_DOUBLING = 100;

/** The zoom factor for a wheel delta in pixels: up (negative) zooms in. */
export const wheelFactor = (deltaY: number): number => 2 ** (-deltaY / WHEEL_PER_DOUBLING);

const kindOf = (e: PointerEvent): PointerKind => (e.pointerType === 'pen' ? 'pen' : e.pointerType === 'mouse' ? 'mouse' : 'touch');

export class Stage {
  #off: Array<() => void> = [];
  #gestures = new GestureMachine();
  #area: HTMLElement;
  #host: HTMLElement;
  #shadow: ShadowRoot;
  #editor: Editor;
  #renderer: Renderer;

  /** `area` takes the input (the canvas and its margin); `host` holds the drawing's shadow root. */
  constructor(area: HTMLElement, host: HTMLElement, shadow: ShadowRoot, editor: Editor, renderer: Renderer) {
    this.#area = area;
    this.#host = host;
    this.#shadow = shadow;
    this.#editor = editor;
    this.#renderer = renderer;
    const on = <E extends Event>(target: EventTarget, type: string, fn: (e: E) => void, options?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, options);
      this.#off.push(() => target.removeEventListener(type, fn as EventListener, options));
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) on<PointerEvent>(area, type, (e) => this.#pointer(e));
    on<WheelEvent>(area, 'wheel', (e) => this.#wheel(e), { passive: false });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) on<Event>(area.ownerDocument, type, (e) => e.preventDefault(), { passive: false });
    const ro = new ResizeObserver(() => editor.resize(this.size()));
    ro.observe(host);
    this.#off.push(() => ro.disconnect());
  }

  /** The host's size in CSS pixels: the space the view fits. */
  size(): { width: number; height: number } {
    const r = this.#host.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  destroy(): void {
    for (const f of this.#off) f();
    this.#off = [];
  }

  #pointer(e: PointerEvent): void {
    const type = e.type === 'pointerdown' ? 'down' : e.type === 'pointermove' ? 'move' : e.type === 'pointerup' ? 'up' : 'cancel';
    if (type === 'down' && e.pointerType === 'mouse' && e.button !== 0) return;
    if (type === 'down') {
      try {
        this.#area.setPointerCapture(e.pointerId);
      } catch {
        // a synthetic pointer (tests) has nothing to capture
      }
    }
    const box = this.#host.getBoundingClientRect();
    const events = this.#gestures.feed({ type, id: e.pointerId, x: e.clientX - box.left, y: e.clientY - box.top, t: e.timeStamp, kind: kindOf(e) });
    for (const g of events) this.#gesture(g, e);
    if (events.length) e.preventDefault();
  }

  #gesture(g: GestureEvent, e: PointerEvent): void {
    const ed = this.#editor;
    switch (g.type) {
      case 'tool-tap': {
        const hit = this.#shadow.elementFromPoint(e.clientX, e.clientY);
        ed.tapCanvas(this.#renderer.idFor(hit) ?? null);
        return;
      }
      case 'nav-start':
        return ed.navStart();
      case 'nav':
        return ed.navigate(g.a0, g.b0, g.a1, g.b1);
      case 'nav-end':
        return ed.navEnd();
      case 'two-finger-tap':
        return ed.undo();
      // Tool drags belong to P1's tools (move, marquee, pen); Select has none yet.
    }
  }

  #wheel(e: WheelEvent): void {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.size().height : 1;
    const box = this.#host.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) this.#editor.zoomAt({ x: e.clientX - box.left, y: e.clientY - box.top }, wheelFactor(e.deltaY * unit));
    else this.#editor.panBy(-e.deltaX * unit, -e.deltaY * unit);
  }
}
