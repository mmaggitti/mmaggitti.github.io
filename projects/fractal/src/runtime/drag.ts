// Dragging a tab or a panel in Arrange mode. Nothing reflows while the finger moves: the source dims
// in place, a compact card follows the finger, and an outline shows where the drop would land once
// the finger has rested on a target for SETTLE_MS. Release commits whatever target is under the
// finger (settled or not) through the workspace, which glides everything into place; no target, or
// a cancel, flies the card back. (The settle delay and card idea follow Trellis's runtime/drag.ts;
// written fresh.)

import type { WorkspaceHandle } from './workspace.ts';
import { move, type Payload } from '../core/arrange.ts';
import { emptyRootHit, hitTest, type Hit } from '../core/targets.ts';
import { hueOf, kindOf } from '../core/kinds.ts';
import { appTitle } from '../core/nav.ts';
import { el, setAttr, setStyle } from './dom.ts';

export const SETTLE_MS = 150;
const FLY_MS = 180;

export interface DragController {
  start(region: 'tab' | 'panel', target: string, x: number, y: number): void;
  move(x: number, y: number): void;
  end(x: number, y: number): void;
  cancel(): void;
  readonly active: boolean;
}

export function createDrag(opts: { ws: WorkspaceHandle; layerOf: HTMLElement; reducedMotion(): boolean }): DragController {
  const { ws } = opts;
  const host = ws.element;
  let state: {
    payload: Payload;
    card: HTMLElement;
    lifted: HTMLElement[];
    source: DOMRect | null;
    pending: Hit | null;
    shown: Hit | null;
    timer: ReturnType<typeof setTimeout> | undefined;
  } | null = null;
  const outline = el('div', 'fx-drop', { 'aria-hidden': 'true' });

  const keyOf = (h: Hit | null) => (h ? JSON.stringify(h.target) : '');

  function show(h: Hit | null) {
    if (!state) return;
    state.shown = h;
    if (!h) {
      outline.remove();
      return;
    }
    if (!outline.isConnected) host.append(outline);
    setAttr(outline, 'data-style', h.style);
    setStyle(outline, 'transform', `translate(${h.rect.x}px, ${h.rect.y}px)`);
    setStyle(outline, 'width', `${h.rect.w}px`);
    setStyle(outline, 'height', `${h.rect.h}px`);
  }

  function cardFor(payload: Payload): HTMLElement {
    const doc = ws.getDoc();
    const idx = ws.geometry().idx;
    const app = payload.kind === 'tab' ? payload.app : (idx.nodes.get(payload.panel) as { selected: string }).selected;
    const count = payload.kind === 'panel' ? (idx.nodes.get(payload.panel) as { tabs: string[] }).tabs.length : 1;
    const rec = doc.apps[app];
    const card = el('div', 'fx-card', { 'aria-hidden': 'true' });
    const swatch = el('span', 'fx-card-swatch');
    const hue = rec ? hueOf(rec.params) : null;
    if (hue !== null) {
      setStyle(swatch, '--hue', String(hue));
      setAttr(swatch, 'data-hue', String(hue));
    } else swatch.textContent = kindOf(rec?.kind ?? '').glyph;
    const name = el('span', 'fx-card-name');
    name.textContent = appTitle(doc, app);
    card.append(swatch, name);
    if (count > 1) {
      const more = el('span', 'fx-card-more');
      more.textContent = `+${count - 1}`;
      card.append(more);
    }
    return card;
  }

  function place(x: number, y: number) {
    if (!state) return;
    const w = state.card.offsetWidth;
    const h = state.card.offsetHeight;
    // Above the finger, so the finger never hides it; kept on screen.
    const left = Math.min(Math.max(4, x - w / 2), innerWidth - w - 4);
    const top = Math.max(4, y - h - 24);
    setStyle(state.card, 'transform', `translate(${left}px, ${top}px)`);
  }

  function finish() {
    if (!state) return;
    clearTimeout(state.timer);
    for (const e of state.lifted) setAttr(e, 'data-lifted', null);
    outline.remove();
    state = null;
  }

  function flyBack() {
    if (!state) return;
    const { card, source } = state;
    finish();
    if (!source || opts.reducedMotion()) {
      card.remove();
      return;
    }
    setStyle(card, 'transition', `transform ${FLY_MS}ms ease-in, opacity ${FLY_MS}ms ease-in`);
    setStyle(card, 'transform', `translate(${source.left + source.width / 2 - card.offsetWidth / 2}px, ${source.top + source.height / 2 - card.offsetHeight / 2}px)`);
    setStyle(card, 'opacity', '0');
    setTimeout(() => card.remove(), FLY_MS + 20);
  }

  return {
    get active() {
      return state !== null;
    },
    start(region, target, x, y) {
      if (state) flyBack();
      const payload: Payload = region === 'tab' ? { kind: 'tab', app: target } : { kind: 'panel', panel: target };
      const idx = ws.geometry().idx;
      const panelId = payload.kind === 'tab' ? idx.panelOf.get(payload.app) : payload.panel;
      if (!panelId || !idx.nodes.has(panelId)) return;
      const frame = host.querySelector<HTMLElement>(`[data-panel="${CSS.escape(panelId)}"]`);
      const lifted: HTMLElement[] = [];
      if (payload.kind === 'panel') {
        if (frame) lifted.push(frame);
        for (const app of (idx.nodes.get(panelId) as { tabs: string[] }).tabs) {
          const s = host.querySelector<HTMLElement>(`[data-app="${CSS.escape(app)}"]`);
          if (s) lifted.push(s);
        }
      } else {
        const tab = frame?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(payload.app)}"]`);
        if (tab) lifted.push(tab);
        const s = host.querySelector<HTMLElement>(`[data-app="${CSS.escape(payload.app)}"]`);
        if (s) lifted.push(s);
      }
      for (const e of lifted) setAttr(e, 'data-lifted', '');
      const card = cardFor(payload);
      opts.layerOf.append(card);
      const sourceEl = payload.kind === 'tab' ? lifted[0] : frame;
      state = { payload, card, lifted, source: sourceEl?.getBoundingClientRect() ?? null, pending: null, shown: null, timer: undefined };
      host.setAttribute('data-fx-dragging', '');
      place(x, y);
    },
    move: moveTo,
    end(x, y) {
      if (!state) return;
      moveTo(x, y);
      const hit = state.pending;
      host.removeAttribute('data-fx-dragging');
      if (!hit) {
        flyBack();
        return;
      }
      const next = move(ws.getDoc(), state.payload, hit.target);
      state.card.remove();
      finish();
      ws.apply(next);
    },
    cancel() {
      host.removeAttribute('data-fx-dragging');
      flyBack();
    },
  };

  function moveTo(x: number, y: number) {
    if (!state) return;
    place(x, y);
    let hit: Hit | null = null;
    if (ws.settled) {
      const o = host.getBoundingClientRect();
      const pt = { x: x - o.left, y: y - o.top };
      const g = ws.geometry();
      hit = pt.x >= 0 && pt.y >= 0 && pt.x <= o.width && pt.y <= o.height ? (emptyRootHit(g) ?? hitTest(g, pt, state.payload)) : null;
    }
    if (keyOf(hit) === keyOf(state.pending)) return;
    state.pending = hit;
    clearTimeout(state.timer);
    if (!hit) show(null);
    else state.timer = setTimeout(() => state && show(state.pending), SETTLE_MS);
  }
}
