// The workspace runtime: one flat layer for every level, a similarity camera, and residual tweens.
//
// - Every panel frame, host dock area and app surface is a direct child of one layer. App content
//   is created once and never reparented: moving, tabbing and zooming only position it.
// - At rest, elements sit at their rest-layout rects and the layer has no transform.
// - A framing change solves the new rest layout, then animates: the layer's single transform
//   carries the zoom (log space), and each element tweens the residual the zoom can't express
//   (aspect, chrome returning to true size, siblings turning into pages).
// - Content lays out once at its destination size when a transition starts, and app controllers
//   update only when motion settles.
//
// Ideas from Trellis's runtime/workspace.ts (flat layer, placeSurface, settle); no code copied.

import type { LayoutDoc, Rect } from '../core/types.ts';
import { metrics, type Metrics } from '../core/metrics.ts';
import { solve, type RestLayout } from '../core/layout.ts';
import { indexDoc, type TreeIndex } from '../core/tree.ts';
import { kindOf } from '../core/kinds.ts';
import { tierOf, type Tier } from '../core/lod.ts';
import { appTitle, crumbs, framePath, frames, neighbours, parentFrame, type Crumb } from '../core/nav.ts';
import { snap, type Candidate } from '../core/snap.ts';
import { canGo } from '../core/history.ts';
import { goHistory, selectTab, setFrame, toggleOverview } from '../core/ops.ts';
import { apply, between, fit, invert, lerpRect, step, IDENTITY, type Sim, type SpringState } from '../core/motion.ts';
import { el, place, setAttr, setStyle } from './dom.ts';
import { AppController, Store } from './controller.ts';

export interface Surface {
  app: string;
  kind: string;
  content: HTMLElement;
  controller: AppController;
}

export interface ViewState {
  frame: string | null;
  crumbs: Crumb[];
  prev: string | null;
  next: string | null;
  page: { index: number; count: number };
  canBack: boolean;
  canForward: boolean;
  settled: boolean;
}

export interface WorkspaceOptions {
  /** The element the workspace fills (it clips; give it a size). */
  host: HTMLElement;
  doc: LayoutDoc;
  /** Committed document changes (navigation included), for saving. */
  onChange?(doc: LayoutDoc): void;
  /** Reduced motion: jump instead of animating. */
  reducedMotion?(): boolean;
}

interface PanelEl {
  frame: HTMLElement;
  tabbar: HTMLElement;
  tablist: HTMLElement;
  zoom: HTMLButtonElement;
  tile: HTMLElement;
  tabs: Map<string, HTMLButtonElement>;
  tier: Tier;
}

interface AppEl {
  surface: HTMLElement;
  content: HTMLElement;
  dock: HTMLElement | null;
  controller: AppController;
}

/** One positioned element in a layout: its rect (layer px), draw scale and stacking. */
interface Item {
  r: Rect;
  s: number;
  z: number;
}

export interface WorkspaceHandle {
  readonly element: HTMLElement;
  getDoc(): LayoutDoc;
  /** Replace the document (e.g. after an import), animating unless told not to. */
  setDoc(doc: LayoutDoc, opts?: { animate?: boolean }): void;
  frame(id: string | null): void;
  /** Frame a panel, or step out if it is already framed. */
  toggleFrame(id: string): void;
  stepOut(): void;
  neighbour(dir: -1 | 1): void;
  history(step: -1 | 1): void;
  overview(): void;
  selectTab(panel: string, app: string): void;
  surfaces: Store<readonly Surface[]>;
  view: Store<ViewState>;
  /** The current rest layout (for tests and input). */
  layout(): RestLayout;
  /** Two-finger (or trackpad) camera gestures, in client coordinates. */
  camera: {
    start(x: number, y: number): void;
    move(x: number, y: number, scale: number): void;
    /** vx, vy: finger velocity in px per ms. */
    end(x: number, y: number, scale: number, vx: number, vy: number): void;
    readonly active: boolean;
  };
  /** One level in, toward a point (client coordinates). */
  stepIn(x: number, y: number): void;
  destroy(): void;
}

export function createWorkspace(opts: WorkspaceOptions): WorkspaceHandle {
  const { host } = opts;
  const layer = el('div', 'fx-layer');
  host.classList.add('fx-viewport');
  host.append(layer);

  let doc = opts.doc;
  let idx: TreeIndex = indexDoc(doc);
  let m: Metrics = metrics(remPx());
  let viewport = { w: host.clientWidth, h: host.clientHeight };
  let rest: RestLayout = solve(doc, doc.nav.frame, viewport, m, idx);
  const panels = new Map<string, PanelEl>();
  const apps = new Map<string, AppEl>();
  const surfaces = new Store<readonly Surface[]>([]);
  const view = new Store<ViewState>(viewState(true));
  let destroyed = false;

  function remPx() {
    return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }

  // ------------------------------------------------------------------ elements
  function ensurePanel(id: string): PanelEl {
    let p = panels.get(id);
    if (p) return p;
    const frame = el('div', 'fx-frame', { 'data-panel': id });
    const tabbar = el('div', 'fx-tabbar');
    const tablist = el('div', 'fx-tabs', { role: 'tablist' });
    const zoom = el('button', 'fx-zoom', { type: 'button', 'aria-label': 'Zoom to this panel' });
    zoom.textContent = '⤢';
    tabbar.append(tablist, zoom);
    const tile = el('div', 'fx-tile', { 'aria-hidden': 'true' });
    frame.append(tabbar, tile);
    layer.append(frame);
    zoom.addEventListener('click', () => handle.toggleFrame(id));
    // A tap on a panel that isn't live (a miniature or tile) frames it.
    frame.addEventListener('click', (e) => {
      const p = panels.get(id);
      if (p && p.tier !== 'live' && !(e.target as Element).closest('.fx-tabbar')) handle.frame(id);
    });
    p = { frame, tabbar, tablist, zoom, tile, tabs: new Map(), tier: 'live' };
    panels.set(id, p);
    return p;
  }

  function ensureApp(id: string): AppEl {
    let a = apps.get(id);
    if (a) return a;
    const surface = el('div', 'fx-surface', { 'data-app': id });
    const content = el('div', 'fx-content', { 'data-content': id });
    surface.append(content);
    layer.append(surface);
    a = { surface, content, dock: null, controller: new AppController(id) };
    apps.set(id, a);
    return a;
  }

  function ensureDock(a: AppEl, id: string) {
    if (a.dock) return a.dock;
    a.dock = el('div', 'fx-dock', { 'data-dock': id, 'aria-hidden': 'true' });
    layer.append(a.dock);
    return a.dock;
  }

  /** Create or drop elements so they match the document, and fill in tab bars. */
  function sync() {
    const livePanels = new Set<string>();
    for (const [id, node] of idx.nodes) {
      if (node.kind !== 'panel') continue;
      livePanels.add(id);
      const p = ensurePanel(id);
      // Tabs, in order.
      for (const [app, b] of p.tabs) if (!node.tabs.includes(app)) {
        b.remove();
        p.tabs.delete(app);
      }
      node.tabs.forEach((app, i) => {
        let b = p.tabs.get(app);
        if (!b) {
          b = el('button', 'fx-tab', { type: 'button', role: 'tab', 'data-tab': app });
          b.addEventListener('click', () => {
            const owner = panels.get(id) && idx.panelOf.get(app);
            if (owner) handle.selectTab(owner, app);
          });
          p.tabs.set(app, b);
        }
        if (p.tablist.children[i] !== b) p.tablist.insertBefore(b, p.tablist.children[i] ?? null);
        b.textContent = appTitle(doc, app);
        setAttr(b, 'aria-selected', node.selected === app ? 'true' : 'false');
      });
      const sel = doc.apps[node.selected];
      const info = kindOf(sel?.kind ?? '');
      p.tile.textContent = '';
      const glyph = el('span', 'fx-tile-glyph');
      glyph.textContent = info.glyph;
      const name = el('span', 'fx-tile-name');
      name.textContent = appTitle(doc, node.selected);
      p.tile.append(glyph, name);
    }
    for (const [id, p] of panels) if (!livePanels.has(id)) {
      p.frame.remove();
      panels.delete(id);
    }
    const liveApps = new Set<string>();
    let changed = false;
    for (const [id] of idx.panelOf) {
      liveApps.add(id);
      if (!apps.has(id)) changed = true;
      const a = ensureApp(id);
      setAttr(a.surface, 'data-kind', doc.apps[id]?.kind ?? null);
    }
    for (const [id, a] of apps) if (!liveApps.has(id)) {
      a.surface.remove();
      a.dock?.remove();
      apps.delete(id);
      changed = true;
    }
    if (changed) {
      surfaces.set([...apps].map(([app, a]) => ({ app, kind: doc.apps[app]?.kind ?? '', content: a.content, controller: a.controller })));
    }
  }

  // ------------------------------------------------------------------ layout → items
  function itemsOf(l: RestLayout): Map<string, Item> {
    const items = new Map<string, Item>();
    for (const p of l.panels.values()) items.set(`f:${p.id}`, { r: p.frame, s: p.s, z: p.depth * 10 });
    for (const a of l.apps.values()) {
      items.set(`s:${a.id}`, { r: a.surface, s: a.content.scale, z: a.depth * 10 + 3 });
      if (a.dock) items.set(`d:${a.id}`, { r: a.dock, s: a.s, z: a.depth * 10 + 2 });
    }
    return items;
  }

  function elementOf(key: string): HTMLElement | null {
    const id = key.slice(2);
    if (key[0] === 'f') return panels.get(id)?.frame ?? null;
    const a = apps.get(id);
    if (!a) return null;
    if (key[0] === 's') return a.surface;
    return a.dock ? a.dock : ensureDock(a, id);
  }

  // ------------------------------------------------------------------ drawing
  let sim: Sim = IDENTITY;
  let shown = new Set<string>();

  function drawLayer(s: Sim) {
    sim = s;
    const identity = s.k === 1 && s.x === 0 && s.y === 0;
    setStyle(layer, 'transform', identity ? 'none' : `translate(${s.x}px, ${s.y}px) scale(${s.k})`);
  }

  /** Draw items at their rects. `fade` gives per-key opacity during a transition. */
  function drawItems(items: Map<string, Item>, round: boolean, fade?: Map<string, number>) {
    const next = new Set<string>();
    for (const [key, it] of items) {
      const e = elementOf(key);
      if (!e) continue;
      next.add(key);
      const screen = apply(sim, it.r);
      const onscreen = screen.x < viewport.w && screen.y < viewport.h && screen.x + screen.w > 0 && screen.y + screen.h > 0 && it.r.w > 0.5 && it.r.h > 0.5;
      setStyle(e, 'visibility', onscreen ? 'visible' : 'hidden');
      setStyle(e, 'z-index', String(it.z));
      const o = fade?.get(key);
      setStyle(e, 'opacity', o === undefined || o >= 1 ? '' : String(o));
      if (key[0] === 's') {
        // Surfaces are positioned at their true size; their content is scaled inside.
        place(e, it.r, 1, round);
        const a = apps.get(key.slice(2))!;
        const lw = parseFloat(a.content.style.width) || 1;
        const lh = parseFloat(a.content.style.height) || 1;
        const k = Math.max(it.r.w / lw, it.r.h / lh);
        setStyle(a.content, 'transform', Math.abs(k - 1) < 1e-4 ? 'none' : `scale(${k})`);
      } else place(e, it.r, it.s, round);
    }
    for (const key of shown) if (!next.has(key)) {
      const e = elementOf(key);
      if (e) setStyle(e, 'visibility', 'hidden');
    }
    shown = next;
  }

  /** Lay content out at its size in a layout (at most 2× the viewport, scaled beyond that). */
  function sizeContent(l: RestLayout) {
    for (const a of l.apps.values()) {
      const e = apps.get(a.id);
      if (!e) continue;
      const cap = Math.max(1, a.content.w / (2 * viewport.w), a.content.h / (2 * viewport.h));
      setStyle(e.content, 'width', `${a.content.w / cap}px`);
      setStyle(e.content, 'height', `${a.content.h / cap}px`);
    }
  }

  // ------------------------------------------------------------------ rest and settle
  function settle() {
    drawLayer(IDENTITY);
    sizeContent(rest);
    drawItems(itemsOf(rest), true);
    // Tiers, inertness and what each app may know. A tile hides its content (still mounted).
    const visibleApps = new Set<string>();
    for (const p of rest.panels.values()) {
      const pe = panels.get(p.id);
      if (!pe) continue;
      const node = idx.nodes.get(p.id);
      const selected = node?.kind === 'panel' ? node.selected : '';
      const app = rest.apps.get(selected);
      const tier = tierOf(p.frame, app?.content.scale ?? 1, m.remPx, pe.tier);
      pe.tier = tier;
      setAttr(pe.frame, 'data-tier', tier);
      setAttr(pe.frame, 'data-framed', rest.frame === p.id ? '' : null);
      setStyle(pe.tabbar, 'height', `${m.tabbar}px`);
      if (app) {
        const a = apps.get(app.id);
        if (a) {
          setAttr(a.surface, 'data-tier', tier);
          if (tier === 'tile') setStyle(a.surface, 'visibility', 'hidden');
          const live = tier === 'live';
          setAttr(a.surface, 'inert', live ? null : '');
          const onscreen = app.surface.x < viewport.w && app.surface.y < viewport.h && app.surface.x + app.surface.w > 0 && app.surface.y + app.surface.h > 0;
          if (onscreen) visibleApps.add(app.id);
          a.controller.update({
            visible: onscreen && tier !== 'tile',
            tier,
            size: { w: Math.round(app.content.w), h: Math.round(app.content.h) },
            scale: Math.round(app.content.scale * 1000) / 1000,
            interactive: live,
          });
        }
      }
    }
    for (const [id, a] of apps) {
      if (!rest.apps.has(id)) {
        setAttr(a.surface, 'inert', '');
        a.controller.update({ visible: false, interactive: false });
      }
    }
    setAttr(host, 'data-fx-settled', '');
    view.set(viewState(true));
  }

  function viewState(settled: boolean): ViewState {
    const frame = doc.nav.frame;
    const n = neighbours(idx, frame);
    return {
      frame,
      crumbs: crumbs(doc, idx, frame),
      prev: n.prev,
      next: n.next,
      page: { index: n.index, count: n.count },
      canBack: canGo(doc.nav, -1),
      canForward: canGo(doc.nav, 1),
      settled,
    };
  }

  // ------------------------------------------------------------------ transitions
  let raf = 0;
  let anim: { from: Map<string, Item>; to: Map<string, Item>; start: Sim; end: Sim; anchor: { x: number; y: number }; spring: SpringState; last: number } | null = null;

  function reduced() {
    return opts.reducedMotion?.() ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Commit a new document: re-solve, then animate from what's on screen now to the new rest. */
  function commit(next: LayoutDoc, animate = true, force = false) {
    if (next === doc && !force) return;
    const prevRest = rest;
    const fromItems = currentItems();
    const changed = next !== doc;
    doc = next;
    if (changed) {
      idx = indexDoc(doc);
      sync();
      rest = solve(doc, doc.nav.frame, viewport, m, idx);
      opts.onChange?.(doc);
    }
    if (!animate || reduced()) {
      cancelAnimationFrame(raf);
      anim = null;
      settle();
      return;
    }
    // Map the new frame's box in the current picture onto the viewport: that is the zoom. Everything
    // else tweens the residual.
    const target = rest.frame;
    const V: Rect = { x: 0, y: 0, w: viewport.w, h: viewport.h };
    const fromBox = boxIn(prevRest, fromItems, target);
    const end = fromBox ? fit(fromBox, V) : IDENTITY;
    // Targets in layer coordinates under the end camera, so the camera carries the zoom.
    const to = new Map<string, Item>();
    for (const [key, it] of itemsOf(rest)) to.set(key, { ...it, r: invert(end, it.r), s: it.s / end.k });
    const from = new Map<string, Item>();
    for (const [key, it] of to) from.set(key, fromItems.get(key) ?? it);
    for (const [key, it] of fromItems) if (!to.has(key)) from.set(key, it);
    sizeContent(rest);
    setAttr(host, 'data-fx-settled', null);
    view.set(viewState(false));
    // Start from what's on screen now, at an identity camera.
    drawLayer(IDENTITY);
    anim = {
      from,
      to,
      start: IDENTITY,
      end,
      anchor: fromBox ? { x: fromBox.x + fromBox.w / 2, y: fromBox.y + fromBox.h / 2 } : { x: viewport.w / 2, y: viewport.h / 2 },
      spring: { p: 0, v: 0 },
      last: performance.now(),
    };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  /** The rects on screen right now (screen coordinates: as if the camera were the identity). */
  function currentItems(): Map<string, Item> {
    const out = new Map<string, Item>();
    if (!anim) for (const [key, it] of itemsOf(rest)) out.set(key, it);
    else {
      const p = anim.spring.p;
      for (const [key, to] of anim.to) {
        const from = anim.from.get(key) ?? to;
        out.set(key, { r: lerpRect(from.r, to.r, p), s: from.s + (to.s - from.s) * p, z: to.z });
      }
    }
    for (const [key, it] of out) out.set(key, { ...it, r: apply(sim, it.r), s: it.s * sim.k });
    return out;
  }

  /** A frame's box in a set of items (its panel frame, or the union of a split's panels). */
  function boxIn(l: RestLayout, items: Map<string, Item>, frame: string | null): Rect | null {
    if (frame === null) {
      const root = doc.root && l.nodes.get(doc.root.id);
      return root ? unionOf(items) ?? root : null;
    }
    const direct = items.get(`f:${frame}`);
    if (direct) return direct.r;
    // A split: the union of its descendants' frames that were on screen.
    const node = idx.nodes.get(frame);
    if (node?.kind === 'split') {
      const keys: string[] = [];
      const walk = (id: string) => {
        const n = idx.nodes.get(id);
        if (!n) return;
        if (n.kind === 'panel') keys.push(`f:${n.id}`);
        else n.children.forEach((c) => walk(c.id));
      };
      walk(frame);
      const u = unionOf(new Map(keys.filter((k) => items.has(k)).map((k) => [k, items.get(k)!])));
      if (u) return u;
    }
    // Not on screen before (e.g. inside a tab that was hidden): zoom from its nearest visible frame.
    const up = parentFrame(doc, idx, frame);
    return up === frame ? null : boxIn(l, items, up);
  }

  function unionOf(items: Map<string, Item>): Rect | null {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [key, it] of items) {
      if (key[0] !== 'f') continue;
      x1 = Math.min(x1, it.r.x);
      y1 = Math.min(y1, it.r.y);
      x2 = Math.max(x2, it.r.x + it.r.w);
      y2 = Math.max(y2, it.r.y + it.r.h);
    }
    return x1 === Infinity ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function tick(now: number) {
    raf = 0;
    if (!anim || destroyed) return;
    const dt = (now - anim.last) / 1000;
    anim.last = now;
    const r = step(anim.spring, dt);
    anim.spring = r.state;
    const p = r.state.p;
    drawLayer(between(anim.start, anim.end, p, anim.anchor));
    const items = new Map<string, Item>();
    const fade = new Map<string, number>();
    for (const [key, from] of anim.from) {
      const to = anim.to.get(key);
      if (!to) {
        items.set(key, from);
        fade.set(key, 1 - p);
        continue;
      }
      items.set(key, { r: lerpRect(from.r, to.r, p), s: from.s + (to.s - from.s) * p, z: to.z });
    }
    drawItems(items, false, fade);
    if (r.done) {
      anim = null;
      settle();
    } else raf = requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------------ resize
  const ro = new ResizeObserver(() => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w === viewport.w && h === viewport.h && remPx() === m.remPx) return;
    viewport = { w, h };
    m = metrics(remPx());
    rest = solve(doc, doc.nav.frame, viewport, m, idx);
    cancelAnimationFrame(raf);
    anim = null;
    settle();
  });
  ro.observe(host);

  // ------------------------------------------------------------------ camera gestures
  // While fingers are down the whole picture follows them: one transform on the layer, no layout.
  // On release, snap() picks a frame and an ordinary transition carries on from the current camera.
  let gesture: { anchor: { x: number; y: number }; last: { x: number; y: number; scale: number } } | null = null;

  function local(x: number, y: number) {
    const b = host.getBoundingClientRect();
    return { x: x - b.left, y: y - b.top };
  }

  function cameraStart(x: number, y: number) {
    if (anim) {
      // Finish any transition first: gestures start from a rest layout.
      cancelAnimationFrame(raf);
      anim = null;
      settle();
    }
    const p = local(x, y);
    gesture = { anchor: { x: (p.x - sim.x) / sim.k, y: (p.y - sim.y) / sim.k }, last: { ...p, scale: 1 } };
    setAttr(host, 'data-fx-gesture', '');
    setAttr(host, 'data-fx-settled', null);
  }

  function cameraMove(x: number, y: number, scale: number) {
    if (!gesture) return;
    const p = local(x, y);
    const k = Math.min(Math.max(scale, 0.05), 60);
    gesture.last = { ...p, scale: k };
    drawLayer({ k, x: p.x - k * gesture.anchor.x, y: p.y - k * gesture.anchor.y });
  }

  function cameraEnd(x: number, y: number, scale: number, vx: number, vy: number) {
    if (!gesture) return;
    cameraMove(x, y, scale);
    const g = gesture;
    gesture = null;
    setAttr(host, 'data-fx-gesture', null);
    const V: Rect = { x: 0, y: 0, w: viewport.w, h: viewport.h };
    const view = invert(sim, V);
    const focal = { x: (g.last.x - sim.x) / sim.k, y: (g.last.y - sim.y) / sim.k };
    const target = snap(candidates(doc.nav.frame), { scale: g.last.scale, focal, view, vx: -vx / sim.k, vy: -vy / sim.k });
    if (target === doc.nav.frame) commit(doc, true, true);
    else commit(setFrame(doc, target));
  }

  /** Snap candidates around the current frame, with their rest boxes. */
  function candidates(frame: string | null): Candidate[] {
    const out: Candidate[] = [];
    const boxOf = (f: string | null) => (f === null ? (doc.root ? rest.nodes.get(doc.root.id) : undefined) : rest.nodes.get(f));
    const self = boxOf(frame);
    if (self) out.push({ id: frame, box: self, relation: 'self' });
    const up = framePath(doc, idx, frame).slice(0, -1);
    up.forEach((f, i) => {
      const b = boxOf(f);
      if (b) out.push({ id: f, box: b, relation: 'ancestor', levels: up.length - i });
    });
    for (const f of frames(doc, idx)) {
      if (f === frame) continue;
      const path = framePath(doc, idx, f);
      const b = rest.nodes.get(f);
      const at = path.indexOf(frame);
      if (b && at >= 0 && at < path.length - 1) out.push({ id: f, box: b, relation: 'descendant', levels: path.length - 1 - at });
    }
    const n = neighbours(idx, frame);
    if (n.count > 1 && frame !== null) {
      const owner = idx.owner.get(frame);
      const split = owner?.type === 'split' ? idx.nodes.get(owner.id) : undefined;
      if (split?.kind === 'split') for (const c of split.children) {
        const b = rest.nodes.get(c.id);
        if (c.id !== frame && b) out.push({ id: c.id, box: b, relation: 'page' });
      }
    }
    return out;
  }

  /** The frame one level inside `frame` that contains a point (rest coordinates). */
  function childToward(frame: string | null, p: { x: number; y: number }): string | null {
    for (const f of frames(doc, idx)) {
      const b = rest.nodes.get(f);
      if (!b || p.x < b.x || p.y < b.y || p.x > b.x + b.w || p.y > b.y + b.h) continue;
      if (parentFrame(doc, idx, f) === frame) return f;
    }
    return null;
  }

  // ------------------------------------------------------------------ handle
  const handle: WorkspaceHandle = {
    element: host,
    getDoc: () => doc,
    setDoc(next, o = {}) {
      commit(next, o.animate !== false);
    },
    frame(id) {
      commit(setFrame(doc, id));
    },
    toggleFrame(id) {
      if (doc.nav.frame === id) handle.stepOut();
      else handle.frame(id);
    },
    stepOut() {
      if (doc.nav.frame === null) return;
      commit(setFrame(doc, parentFrame(doc, idx, doc.nav.frame)));
    },
    neighbour(dir) {
      const n = neighbours(idx, doc.nav.frame);
      const id = dir < 0 ? n.prev : n.next;
      if (id) handle.frame(id);
    },
    history(stepBy) {
      commit(goHistory(doc, stepBy));
    },
    overview() {
      commit(toggleOverview(doc));
    },
    selectTab(panel, app) {
      commit(selectTab(doc, idx, panel, app));
    },
    surfaces,
    view,
    layout: () => rest,
    camera: {
      start: cameraStart,
      move: cameraMove,
      end: cameraEnd,
      get active() {
        return gesture !== null;
      },
    },
    stepIn(x, y) {
      const p = local(x, y);
      const target = childToward(doc.nav.frame, invert(sim, { ...p, w: 0, h: 0 }));
      if (target) handle.frame(target);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      layer.remove();
      host.classList.remove('fx-viewport');
    },
  };

  sync();
  settle();
  return handle;
}
