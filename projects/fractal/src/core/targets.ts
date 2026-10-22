// Drop targets, from rest-layout geometry (never DOM boxes, which are wrong under nested scales).
// Points are in workspace coordinates: the rest layout's own space, which is the screen relative to
// the workspace's top-left while the camera is at rest.
//
// Precedence: a tab strip, then a seam between panels, then the innermost panel under the point
// (its outer 28% splits it on that side, its centre adds a tab), then an empty dock. Panels drawn
// smaller than true size (miniatures) take only edge drops: their centre is a hover-to-zoom target.
// (Geometry ideas from Trellis's model/spatial.ts; written fresh.)

import type { LayoutDoc, Panel, Rect } from './types.ts';
import type { RestLayout, PanelOut } from './layout.ts';
import type { TreeIndex } from './tree.ts';
import { kindOf } from './kinds.ts';
import { move, type Payload, type Side, type Target } from './arrange.ts';

/** A panel's outer band, as a fraction of its size, that splits it rather than adding a tab. */
export const EDGE = 0.28;
/** Half the width of a seam's hit band, in rem. */
export const SEAM_REM = 0.75;

export interface Geometry {
  rest: RestLayout;
  doc: LayoutDoc;
  idx: TreeIndex;
  remPx: number;
  /** A panel's tab boundaries in workspace x, left of the first tab to right of the last (n + 1
   * values). Measured by the runtime; when absent, tabs are taken as equal shares of the strip. */
  tabEdges?(panel: string): number[] | null;
}

export type PreviewStyle = 'caret' | 'bar' | 'area';

export interface Hit {
  target: Target;
  /** The outline: where the drop lands. */
  rect: Rect;
  style: PreviewStyle;
}

const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** At true size, with its content at true size: takes the full set of drops. */
export function isLive(g: Geometry, p: PanelOut): boolean {
  if (p.s < 0.999) return false;
  const node = g.idx.nodes.get(p.id) as Panel | undefined;
  const app = node ? g.rest.apps.get(node.selected) : undefined;
  return !app || app.content.scale >= 0.999;
}

/** The innermost panel under a point. */
export function panelAt(g: Geometry, pt: { x: number; y: number }): PanelOut | null {
  let best: PanelOut | null = null;
  for (const p of g.rest.panels.values()) {
    if (!inside(pt, p.frame)) continue;
    if (!best || p.depth > best.depth || (p.depth === best.depth && p.frame.w * p.frame.h < best.frame.w * best.frame.h)) best = p;
  }
  return best;
}

function edgesOf(g: Geometry, p: PanelOut, count: number): number[] {
  const measured = g.tabEdges?.(p.id);
  if (measured && measured.length === count + 1) return measured;
  return Array.from({ length: count + 1 }, (_, i) => p.caption.x + (p.caption.w * i) / Math.max(1, count));
}

function halfOf(r: Rect, side: Side): Rect {
  switch (side) {
    case 'left':
      return { x: r.x, y: r.y, w: r.w / 2, h: r.h };
    case 'right':
      return { x: r.x + r.w / 2, y: r.y, w: r.w / 2, h: r.h };
    case 'top':
      return { x: r.x, y: r.y, w: r.w, h: r.h / 2 };
    case 'bottom':
      return { x: r.x, y: r.y + r.h / 2, w: r.w, h: r.h / 2 };
  }
}

/** The drop under a point for this payload, or null. Only allowed drops are returned. */
export function hitTest(g: Geometry, pt: { x: number; y: number }, payload: Payload): Hit | null {
  const ok = (t: Target) => {
    const out = move(g.doc, payload, t, g.idx);
    return out !== null && out !== g.doc;
  };
  const caret = g.remPx / 4;

  // 1. A caption (its tab strip) at true size.
  const panel = panelAt(g, pt);
  if (panel && panel.s >= 0.999 && panel.caption.h > 0 && inside(pt, panel.caption)) {
    const node = g.idx.nodes.get(panel.id) as Panel;
    const edges = edgesOf(g, panel, node.tabs.length);
    let index = 0;
    for (let i = 0; i < node.tabs.length; i++) if (pt.x > (edges[i] + edges[i + 1]) / 2) index = i + 1;
    const t: Target = { kind: 'tab', panel: panel.id, index };
    if (ok(t)) return { target: t, style: 'caret', rect: { x: edges[index] - caret / 2, y: panel.caption.y, w: caret, h: panel.caption.h } };
  }

  // 2. A seam of a split at true size that the framing doesn't size.
  const tol = SEAM_REM * g.remPx;
  const splits = [...g.rest.splits.values()].filter((s) => !s.pinned && s.s >= 0.999).sort((a, b) => b.depth - a.depth);
  for (const s of splits) {
    for (let i = 0; i < s.seams.length; i++) {
      const sm = s.seams[i];
      const hitBox = s.axis === 'x' ? { x: sm.x + sm.w / 2 - tol, y: sm.y, w: 2 * tol, h: sm.h } : { x: sm.x, y: sm.y + sm.h / 2 - tol, w: sm.w, h: 2 * tol };
      if (!inside(pt, hitBox)) continue;
      const t: Target = { kind: 'seam', split: s.id, index: i + 1 };
      if (!ok(t)) continue;
      const rect = s.axis === 'x' ? { x: sm.x + sm.w / 2 - caret / 2, y: sm.y, w: caret, h: sm.h } : { x: sm.x, y: sm.y + sm.h / 2 - caret / 2, w: sm.w, h: caret };
      return { target: t, style: 'bar', rect };
    }
  }

  if (!panel) return null;

  // 3. An empty dock inside a group.
  const node = g.idx.nodes.get(panel.id) as Panel;
  const app = g.rest.apps.get(node.selected);
  if (app?.dock && inside(pt, app.dock) && kindOf(g.doc.apps[app.id]?.kind ?? '').hosts) {
    if (!g.doc.apps[app.id].dock) {
      const t: Target = { kind: 'dock', host: app.id };
      if (ok(t)) return { target: t, style: 'area', rect: app.dock };
    }
    return null;
  }

  // 4. The panel itself: an edge splits it, the centre adds a tab.
  const f = panel.frame;
  const d: [Side, number][] = [
    ['left', (pt.x - f.x) / f.w],
    ['right', (f.x + f.w - pt.x) / f.w],
    ['top', (pt.y - f.y) / f.h],
    ['bottom', (f.y + f.h - pt.y) / f.h],
  ];
  d.sort((a, b) => a[1] - b[1]);
  if (d[0][1] < EDGE) {
    const t: Target = { kind: 'edge', node: panel.id, side: d[0][0] };
    if (ok(t)) return { target: t, style: 'area', rect: halfOf(f, d[0][0]) };
    return null;
  }
  if (!isLive(g, panel)) return null;
  const t: Target = { kind: 'tab', panel: panel.id, index: node.tabs.length };
  return ok(t) ? { target: t, style: 'area', rect: f } : null;
}

/** What holding a drag over this point zooms into: a miniature, or a group's band (not the framed
 * panel itself). Null when there's nothing to zoom to. */
export function zoomTargetAt(g: Geometry, pt: { x: number; y: number }): string | null {
  const panel = panelAt(g, pt);
  if (!panel || panel.id === g.rest.frame) return null;
  if (!isLive(g, panel)) return panel.id;
  const node = g.idx.nodes.get(panel.id) as Panel;
  const app = g.rest.apps.get(node.selected);
  if (app?.dock && inside(pt, app.surface)) return panel.id;
  return null;
}

/** The outline for the empty top level: the whole workspace. */
export function emptyRootHit(g: Geometry): Hit | null {
  if (g.doc.root) return null;
  return { target: { kind: 'dock', host: null }, style: 'area', rect: g.rest.viewport };
}
