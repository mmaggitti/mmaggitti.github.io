// The rest-layout solver: where everything sits, in screen pixels, for one framing.
//
// - The framed node fills the viewport exactly, with every tab bar and band at its true size.
// - Its siblings become viewport-sized pages beside it, a gap apart, so a row of panels turns into a
//   workspace wider than the screen. Splits further up are stretched by their weights; hosts above
//   put their band and tab bar above the viewport.
// - Everything else is filled by weights with minimums. A group whose children can't fit is laid
//   out at the size they need and drawn scaled down (s < 1), its chrome with it, so deep levels
//   become miniatures. Scales multiply down the tree.
//
// Weights with minimums and scaled groups follow ideas from Trellis's model/tree.ts (`distribute`,
// `layoutWithMinimums`); the per-framing solve with pages is Fractal's own. Pure and O(n).

import type { LayoutDoc, Node, Panel, Rect } from './types.ts';
import type { Metrics } from './metrics.ts';
import { kindOf } from './kinds.ts';
import { indexDoc, type TreeIndex } from './tree.ts';

export type Box = Rect;

export interface PanelOut {
  id: string;
  frame: Box;
  /** The caption row (its name and tabs) above the body. Zero height on a bare panel. */
  caption: Box;
  body: Box;
  /** Draw scale: 1 at true size, below 1 inside a cramped group. */
  s: number;
  depth: number;
}

export interface AppOut {
  id: string;
  panel: string;
  /** Where the app's own UI goes: the panel body, or a host's band. */
  surface: Box;
  /** A host's dock area (below its band), or null. */
  dock: Box | null;
  s: number;
  depth: number;
  /** The size content lays out at, and the scale it is drawn at, so surface = layout × scale. */
  content: { w: number; h: number; scale: number };
}

export interface SplitOut {
  id: string;
  box: Box;
  axis: 'x' | 'y';
  s: number;
  depth: number;
  /** Children turned into viewport-sized pages (the framed node's parent). */
  pager: boolean;
  /** Sized by the framing (the pager, or a split above the frame stretched by weights): its
   * dividers can't be dragged at this framing. */
  pinned: boolean;
  /** The gaps between children, in order. */
  seams: Box[];
}

export interface RestLayout {
  viewport: Box;
  /** The framed node, or null for the overview. */
  frame: string | null;
  nodes: Map<string, Box>;
  panels: Map<string, PanelOut>;
  apps: Map<string, AppOut>;
  splits: Map<string, SplitOut>;
}

interface Size {
  w: number;
  h: number;
}

/** Below this fraction of its comfortable size, content lays out at that size and draws smaller. */
export const CONTENT_SLACK = 0.85;

/** The framable node a request resolves to: a dock's root split frames its host's panel, which shows
 * the same thing plus the band. Unknown ids frame the overview (null). */
export function resolveFrame(doc: LayoutDoc, idx: TreeIndex, id: string | null): string | null {
  if (id === null) return null;
  const node = idx.nodes.get(id);
  if (!node) return null;
  const owner = idx.owner.get(id)!;
  if (node.kind === 'split' && owner.type === 'dock') return idx.panelOf.get(owner.app) ?? null;
  if (owner.type === 'root' && node.kind === 'split') return null;
  return id;
}

/** `arranging`: every panel shows its caption (they are the drag handles), even the framed one. */
export function solve(doc: LayoutDoc, frameId: string | null, viewport: Size, m: Metrics, idx = indexDoc(doc), opts: { arranging?: boolean } = {}): RestLayout {
  const V: Box = { x: 0, y: 0, w: viewport.w, h: viewport.h };
  const out: RestLayout = { viewport: V, frame: null, nodes: new Map(), panels: new Map(), apps: new Map(), splits: new Map() };
  if (!doc.root) return out;
  const frame = resolveFrame(doc, idx, frameId);
  out.frame = frame;

  const band = (app: string) => kindOf(doc.apps[app]?.kind ?? '').bandRem * m.remPx;
  // A panel on the framed path shows the tab that leads to the frame, whatever it has selected.
  const forced = new Map<string, string>();
  const selectedOf = (panel: Panel) => forced.get(panel.id) ?? panel.selected;
  const minSize = minSizer(doc, m, selectedOf);

  // ---- pin the path from the framed node up to the root ----
  // pinned: node id → its box at true scale. Splits on the path record how their children go.
  const pinned = new Map<string, Box>();
  const pagerOf = new Set<string>();
  const byWeight = new Set<string>();
  let rootBox: Box = V;
  if (frame !== null) {
    let cur = frame;
    let curBox = V;
    pinned.set(cur, curBox);
    let first = true;
    for (;;) {
      const owner = idx.owner.get(cur)!;
      if (owner.type === 'root') {
        rootBox = curBox;
        break;
      }
      if (owner.type === 'split') {
        const split = idx.nodes.get(owner.id) as Extract<Node, { kind: 'split' }>;
        const i = owner.index;
        const n = split.children.length;
        const along = split.axis === 'x' ? 'w' : 'h';
        const pos = split.axis === 'x' ? 'x' : 'y';
        let box: Box;
        if (first) {
          // The framed node's parent becomes a pager of viewport-sized pages.
          pagerOf.add(split.id);
          const page = curBox[along];
          box = { ...curBox };
          box[pos] = curBox[pos] - i * (page + m.gap);
          box[along] = n * page + (n - 1) * m.gap;
        } else {
          byWeight.add(split.id);
          const frac = split.weights[i];
          const avail = curBox[along] / frac;
          const before = split.weights.slice(0, i).reduce((a, b) => a + b, 0);
          box = { ...curBox };
          box[pos] = curBox[pos] - before * avail - i * m.gap;
          box[along] = avail + (n - 1) * m.gap;
        }
        cur = split.id;
        curBox = box;
        pinned.set(cur, curBox);
        first = false;
        continue;
      }
      // The current node is the root of an app's dock: wrap it in the host panel's chrome.
      const panelId = idx.panelOf.get(owner.app)!;
      forced.set(panelId, owner.app);
      const b = band(owner.app);
      const box: Box = {
        x: curBox.x - m.gap,
        y: curBox.y - m.gap - b - m.caption,
        w: curBox.w + 2 * m.gap,
        h: curBox.h + 2 * m.gap + b + m.caption,
      };
      cur = panelId;
      curBox = box;
      pinned.set(cur, curBox);
      first = false;
    }
  }

  // ---- bare panels: the framed panel and the pages beside it, when each holds one tab, show no
  // caption (the capsule names them). A panel with several tabs keeps its caption: it is the tab
  // switcher. In Arrange every caption shows.
  const bare = new Set<string>();
  if (frame !== null && !opts.arranging) {
    const single = (n: Node | undefined) => n?.kind === 'panel' && n.tabs.length === 1;
    if (single(idx.nodes.get(frame))) bare.add(frame);
    for (const id of pagerOf) {
      const split = idx.nodes.get(id);
      if (split?.kind === 'split') for (const c of split.children) if (single(c)) bare.add(c.id);
    }
  }

  // ---- fill top-down ----
  const place = (node: Node, box: Box, s: number, depth: number) => {
    out.nodes.set(node.id, box);
    if (node.kind === 'panel') return placePanel(node, box, s, depth);
    const n = node.children.length;
    const x = node.axis === 'x';
    const pager = pagerOf.has(node.id);
    const weighted = byWeight.has(node.id);
    let scale = s;
    let extents: number[];
    let gap = m.gap * s;
    if (pager || weighted) {
      scale = 1;
      gap = m.gap;
      const total = (x ? box.w : box.h) - (n - 1) * gap;
      extents = pager ? node.children.map(() => total / n) : node.weights.map((w) => w * total);
    } else {
      // Cramped? Lay the group out at the size its children need, drawn at a smaller scale.
      const need = minSize(node);
      const k = Math.min(1, box.w / s / need.w, box.h / s / need.h);
      scale = s * k;
      gap = m.gap * scale;
      const total = (x ? box.w : box.h) - (n - 1) * gap;
      const mins = node.children.map((c) => (x ? minSize(c).w : minSize(c).h) * scale);
      extents = distribute(total, node.weights, mins);
    }
    const seams: Box[] = [];
    let at = x ? box.x : box.y;
    node.children.forEach((child, i) => {
      const e = extents[i];
      const childBox: Box = x ? { x: at, y: box.y, w: e, h: box.h } : { x: box.x, y: at, w: box.w, h: e };
      const pin = pinned.get(child.id);
      place(child, pin ?? childBox, pin ? 1 : scale, depth);
      at += e;
      if (i < n - 1) {
        seams.push(x ? { x: at, y: box.y, w: gap, h: box.h } : { x: box.x, y: at, w: box.w, h: gap });
        at += gap;
      }
    });
    out.splits.set(node.id, { id: node.id, box, axis: node.axis, s: scale, depth, pager, pinned: pager || weighted, seams });
  };

  const placePanel = (panel: Panel, frameBox: Box, s: number, depth: number) => {
    const ch = (bare.has(panel.id) ? 0 : m.caption) * s;
    const caption: Box = { x: frameBox.x, y: frameBox.y, w: frameBox.w, h: Math.min(ch, frameBox.h) };
    const body: Box = { x: frameBox.x, y: frameBox.y + caption.h, w: frameBox.w, h: Math.max(0, frameBox.h - caption.h) };
    out.panels.set(panel.id, { id: panel.id, frame: frameBox, caption, body, s, depth });
    const id = selectedOf(panel);
    const rec = doc.apps[id];
    if (!rec) return;
    const info = kindOf(rec.kind);
    if (info.hosts) {
      const bh = Math.min(band(id) * s, body.h);
      const surface: Box = { x: body.x, y: body.y, w: body.w, h: bh };
      const g = m.gap * s;
      const dock: Box = {
        x: body.x + g,
        y: body.y + bh + g,
        w: Math.max(0, body.w - 2 * g),
        h: Math.max(0, body.h - bh - 2 * g),
      };
      out.apps.set(id, { id, panel: panel.id, surface, dock, s, depth, content: { w: surface.w / s, h: surface.h / s, scale: s } });
      if (rec.dock) {
        const pin = pinned.get(rec.dock.id);
        place(rec.dock, pin ?? dock, pin ? 1 : s, depth + 1);
      }
      return;
    }
    const min = { w: info.minRem.w * m.remPx, h: info.minRem.h * m.remPx };
    const w = body.w / s;
    const h = body.h / s;
    let k = Math.min(1, w / min.w, h / min.h);
    if (k >= CONTENT_SLACK) k = 1;
    const content = { w: w / k, h: h / k, scale: s * k };
    out.apps.set(id, { id, panel: panel.id, surface: body, dock: null, s, depth, content });
  };

  place(doc.root, pinned.get(doc.root.id) ?? rootBox, 1, 0);
  return out;
}

/** Minimum sizes at true scale: chrome only, since content scales instead. `selectedOf` says which
 * tab a panel shows (the solver forces the tabs on the framed path). Memoized per call. */
export function minSizer(doc: LayoutDoc, m: Metrics, selectedOf: (panel: Panel) => string = (p) => p.selected): (node: Node) => Size {
  const band = (app: string) => kindOf(doc.apps[app]?.kind ?? '').bandRem * m.remPx;
  const hostOf = (panel: Panel) => {
    const id = selectedOf(panel);
    const app = doc.apps[id];
    return app && kindOf(app.kind).hosts ? id : null;
  };
  const cache = new Map<string, Size>();
  const minSize = (node: Node): Size => {
    const hit = cache.get(node.id);
    if (hit) return hit;
    let size: Size;
    if (node.kind === 'panel') {
      const host = hostOf(node);
      const dock = host ? doc.apps[host].dock : null;
      if (host && dock) {
        const inner = minSize(dock);
        size = {
          w: Math.max(m.panelMin.w, inner.w + 2 * m.gap),
          h: m.caption + band(host) + inner.h + 2 * m.gap,
        };
      } else if (host) {
        size = { w: m.panelMin.w, h: m.caption + band(host) + 3 * m.remPx };
      } else size = { ...m.panelMin };
    } else {
      const sizes = node.children.map(minSize);
      const gaps = (node.children.length - 1) * m.gap;
      size =
        node.axis === 'x'
          ? { w: sizes.reduce((a, s) => a + s.w, 0) + gaps, h: Math.max(...sizes.map((s) => s.h)) }
          : { w: Math.max(...sizes.map((s) => s.w)), h: sizes.reduce((a, s) => a + s.h, 0) + gaps };
    }
    cache.set(node.id, size);
    return size;
  };
  return minSize;
}

/** Share `total` by weight, but give no child less than its minimum: children that would fall short
 * are pinned at their minimum and the rest is shared again. If even the minimums don't fit, they are
 * scaled to fit (callers avoid that by scaling the group). */
export function distribute(total: number, weights: number[], mins: number[]): number[] {
  const n = weights.length;
  const minSum = mins.reduce((a, b) => a + b, 0);
  if (minSum >= total) return mins.map((v) => (minSum ? (v * total) / minSum : total / n));
  const fixed = new Array<boolean>(n).fill(false);
  const out = new Array<number>(n).fill(0);
  for (;;) {
    let remaining = total;
    let wsum = 0;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) remaining -= mins[i];
      else wsum += weights[i];
    }
    let pinnedAny = false;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      const e = (remaining * weights[i]) / wsum;
      if (e < mins[i]) {
        fixed[i] = true;
        pinnedAny = true;
      }
    }
    if (pinnedAny) continue;
    for (let i = 0; i < n; i++) out[i] = fixed[i] ? mins[i] : (remaining * weights[i]) / wsum;
    return out;
  }
}
