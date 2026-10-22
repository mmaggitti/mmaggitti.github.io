// The DOM side of input: pointer, touch, WebKit gesture, wheel and key events in; workspace actions
// out, through core/gestures.ts. One listener set for every level, so no gesture is ever handled
// twice (nested Trellis workspaces each handled the same pinch).
//
// iOS policy (vault lessons, and Draw's src/canvas/stage.ts):
// - Pointer Events are the tracking input, listened for on the whole app in the capture phase.
// - A non-passive touchstart claims a second finger before WebKit can start a two-finger scroll;
//   touchmove is prevented only while a camera gesture runs.
// - gesture* events are always prevented, on document in the capture phase (they don't bubble), so
//   the page never zooms. Their scale drives the camera only when no touch pointer is down: the Mac
//   trackpad.

import { GestureMachine, type Intent, type Region } from '../core/gestures.ts';
import type { WorkspaceHandle } from './workspace.ts';
import type { DragController } from './drag.ts';

export interface InputOptions {
  app: HTMLElement;
  ws: WorkspaceHandle;
  /** Arrange mode's drag controller. */
  drag?: DragController;
  /** Edge-swipe feedback: how far (0–1) a history swipe has gone, per side. */
  onEdge?(side: 'left' | 'right', amount: number): void;
}

export function attachInput({ app, ws, drag, onEdge }: InputOptions): () => void {
  const machine = new GestureMachine();
  const ac = new AbortController();
  const on = <K extends keyof WindowEventMap>(target: EventTarget, type: K | string, fn: (e: any) => void, o: AddEventListenerOptions = {}) =>
    target.addEventListener(type, fn, { ...o, signal: ac.signal });
  const touchIds = new Set<number>();

  const regionOf = (t: EventTarget | null): { region: Region; target: string; panel?: string } => {
    const e = t instanceof Element ? t : null;
    const edge = e?.closest('.fx-edge') as HTMLElement | null;
    if (edge) return { region: edge.dataset.side === 'right' ? 'edge-right' : 'edge-left', target: '' };
    if (e?.closest('.fx-menu-btn')) return { region: 'chrome', target: '' };
    const caption = e?.closest('.fx-caption') as HTMLElement | null;
    const captionPanel = caption?.dataset.caption ?? '';
    if (ws.arranging) {
      const divider = e?.closest('.fx-divider') as HTMLElement | null;
      if (divider) return { region: 'divider', target: divider.dataset.divider ?? '' };
      const tab = e?.closest('.fx-tab') as HTMLElement | null;
      if (tab) return { region: 'tab', target: tab.dataset.tab ?? '', panel: captionPanel };
      // The rest of a caption carries the whole panel.
      if (caption) return { region: 'panel', target: captionPanel };
      const surface = e?.closest('.fx-surface') as HTMLElement | null;
      if (surface) {
        const panel = ws.layout().apps.get(surface.dataset.app ?? '')?.panel;
        if (panel) return { region: 'panel', target: panel };
      }
      const frame = e?.closest('.fx-frame') as HTMLElement | null;
      if (frame) return { region: 'panel', target: frame.dataset.panel ?? '' };
    }
    if (caption) return { region: 'caption', target: captionPanel };
    if (e?.closest('.fx-content')) return { region: 'content', target: '' };
    if (e?.closest('.fx-topbar')) return { region: 'topbar', target: '' };
    return { region: 'chrome', target: '' };
  };

  const act = (intents: Intent[]) => {
    for (const it of intents) {
      switch (it.type) {
        case 'camera-start':
          ws.camera.start(it.x, it.y);
          break;
        case 'camera-move':
          ws.camera.move(it.x, it.y, it.scale);
          break;
        case 'camera-end':
          ws.camera.end(it.x, it.y, it.scale, it.vx, it.vy);
          break;
        case 'bar-swipe':
          ws.neighbour(it.dir);
          break;
        case 'edge-move':
          onEdge?.(it.side, Math.min(1, it.dx / (0.3 * app.clientWidth)));
          break;
        case 'edge-end':
          onEdge?.(it.side, 0);
          if (it.commit) ws.history(it.side === 'left' ? -1 : 1);
          break;
        case 'drag-start':
          drag?.start(it.region, it.target, it.x, it.y);
          break;
        case 'drag-move':
          drag?.move(it.x, it.y);
          break;
        case 'drag-end':
          drag?.end(it.x, it.y);
          break;
        case 'drag-cancel':
          drag?.cancel();
          break;
        case 'resize-start':
          ws.resize.start(it.target);
          break;
        case 'resize-move':
          ws.resize.move(it.dx, it.dy);
          break;
        case 'resize-end':
          ws.resize.move(it.dx, it.dy);
          ws.resize.end(true);
          break;
        case 'resize-cancel':
          ws.resize.end(false);
          break;
        case 'equalize':
          ws.equalize(it.target);
          break;
      }
    }
  };

  const p = (e: PointerEvent) => ({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, touch: e.pointerType === 'touch' });

  on(app, 'pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    machine.width = app.clientWidth;
    machine.arrange = ws.arranging;
    const { region, target, panel } = regionOf(e.target);
    if (e.pointerType === 'touch') touchIds.add(e.pointerId);
    // Arrange: no text selection or native drag from a press that may become a drag.
    if (ws.arranging && (region === 'tab' || region === 'panel' || region === 'divider') && e.pointerType === 'mouse') e.preventDefault();
    if (region === 'edge-left' || region === 'edge-right' || region === 'topbar') {
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointers (tests) can't be captured */
      }
    }
    act(machine.down(p(e), region, target, panel));
  }, { capture: true });
  on(window, 'pointermove', (e: PointerEvent) => act(machine.move(p(e))), { capture: true });
  on(window, 'pointerup', (e: PointerEvent) => {
    touchIds.delete(e.pointerId);
    act(machine.up(p(e)));
  }, { capture: true });
  on(window, 'pointercancel', (e: PointerEvent) => {
    touchIds.delete(e.pointerId);
    act(machine.cancel(e.pointerId));
  }, { capture: true });

  // Claim two fingers before WebKit starts a two-finger scroll; hold them while the camera moves.
  on(app, 'touchstart', (e: TouchEvent) => {
    if (e.touches.length >= 2) e.preventDefault();
  }, { passive: false, capture: true });
  on(app, 'touchmove', (e: TouchEvent) => {
    if (machine.active || ws.camera.active) e.preventDefault();
  }, { passive: false, capture: true });

  // WebKit's own pinch: never let it zoom the page. Drive the camera from it only for a trackpad.
  let safari: { base: number } | null = null;
  on(document, 'gesturestart', (e: any) => {
    e.preventDefault();
    if (touchIds.size === 0 && !ws.camera.active && Number.isFinite(e.clientX) && Number.isFinite(e.scale)) {
      safari = { base: 1 };
      ws.camera.start(e.clientX, e.clientY);
    }
  }, { passive: false, capture: true });
  on(document, 'gesturechange', (e: any) => {
    e.preventDefault();
    if (safari) ws.camera.move(e.clientX, e.clientY, safari.base * e.scale);
  }, { passive: false, capture: true });
  on(document, 'gestureend', (e: any) => {
    e.preventDefault();
    if (safari) {
      ws.camera.end(e.clientX, e.clientY, safari.base * e.scale, 0, 0);
      safari = null;
    }
  }, { passive: false, capture: true });

  // Ctrl+wheel is a trackpad pinch in Chromium (zoom about the pointer); a notched mouse wheel with
  // Ctrl steps a level instead (the isNotchedWheel idea from Trellis's runtime/gestures.ts).
  let wheel: { scale: number; timer: ReturnType<typeof setTimeout> | undefined; x: number; y: number } | null = null;
  on(ws.element, 'wheel', (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const notched = e.deltaMode !== 0 || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
    if (notched && !wheel) {
      if (e.deltaY > 0) ws.stepOut();
      else ws.stepIn(e.clientX, e.clientY);
      return;
    }
    if (!wheel) {
      wheel = { scale: 1, timer: undefined, x: e.clientX, y: e.clientY };
      ws.camera.start(e.clientX, e.clientY);
    }
    wheel.scale *= Math.exp(-Math.max(-50, Math.min(50, e.deltaY)) * 0.01);
    ws.camera.move(wheel.x, wheel.y, wheel.scale);
    clearTimeout(wheel.timer);
    wheel.timer = setTimeout(() => {
      if (!wheel) return;
      ws.camera.end(wheel.x, wheel.y, wheel.scale, 0, 0);
      wheel = null;
    }, 180);
  }, { passive: false });

  on(window, 'blur', () => act(machine.cancelLift()));

  on(window, 'keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (machine.dragging) {
      act(machine.cancelLift());
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"]')) return;
    ws.stepOut();
  });

  return () => ac.abort();
}
