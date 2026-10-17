// Back and forward through framings. A visit remembers the apps it showed, not just a node id, so
// it still resolves after the layout changes (the idea of Trellis's recordVisit and
// savedFrameDestination in model/spatial.ts).

import type { LayoutDoc, NavState, Visit } from './types.ts';
import type { TreeIndex } from './tree.ts';
import { appsOfFrame, frames } from './nav.ts';
import { resolveFrame } from './layout.ts';

export const HISTORY_CAP = 50;

export function visitOf(doc: LayoutDoc, idx: TreeIndex, frame: string | null): Visit {
  return { node: frame, apps: appsOfFrame(doc, idx, frame) };
}

function same(a: Visit | undefined, b: Visit) {
  return !!a && a.node === b.node && a.apps.length === b.apps.length && a.apps.every((x, i) => x === b.apps[i]);
}

/** Record a visit: repeats aren't recorded, and a new visit after going back drops the forward list. */
export function record(nav: NavState, visit: Visit): NavState {
  if (same(nav.visits[nav.index], visit)) return nav;
  const visits = [...nav.visits.slice(0, nav.index + 1), visit];
  const drop = Math.max(0, visits.length - HISTORY_CAP);
  return { ...nav, visits: visits.slice(drop), index: visits.length - 1 - drop };
}

/** Where a visit leads now: its node if it still exists, else the smallest frame holding every app it
 * showed that still exists, else the overview. */
export function resolveVisit(doc: LayoutDoc, idx: TreeIndex, visit: Visit): string | null {
  if (visit.node !== null && resolveFrame(doc, idx, visit.node) === visit.node) return visit.node;
  const alive = visit.apps.filter((a) => idx.panelOf.has(a));
  if (!alive.length) return null;
  let best: string | null = null;
  let bestCount = Infinity;
  for (const f of frames(doc, idx)) {
    const apps = appsOfFrame(doc, idx, f);
    if (apps.length < bestCount && alive.every((a) => apps.includes(a))) {
      best = f;
      bestCount = apps.length;
    }
  }
  return best;
}

export function canGo(nav: NavState, step: -1 | 1): boolean {
  const i = nav.index + step;
  return i >= 0 && i < nav.visits.length;
}
