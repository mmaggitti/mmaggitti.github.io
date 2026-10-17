// Turn anything read from storage or an import into a valid document, or null when it isn't one at
// all. Never throws. Every project on the site shares the origin's storage, so nothing read back is
// trusted. (The idea of Trellis's model/document.ts `sanitize`; written fresh.)

import type { AppRecord, LayoutDoc, NavState, Node, Selection, Visit } from './types.ts';
import { isKnownKind, kindOf } from './kinds.ts';
import { indexDoc, normalizeDoc } from './tree.ts';
import { resolveFrame } from './layout.ts';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const MAX_NODES = 2000;

export function sanitize(input: unknown): LayoutDoc | null {
  try {
    return sanitizeOrThrow(input);
  } catch {
    return null;
  }
}

function sanitizeOrThrow(input: unknown): LayoutDoc | null {
  if (!isObj(input) || input.schema !== 1 || !isObj(input.apps)) return null;
  const rawApps = input.apps;
  const apps: Record<string, AppRecord> = {};
  const ids = new Set<string>();
  const placed = new Set<string>();
  let budget = MAX_NODES;

  const app = (id: string): AppRecord | null => {
    const r = rawApps[id];
    if (!Object.hasOwn(rawApps, id) || !isObj(r) || !isStr(r.kind) || !isKnownKind(r.kind)) return null;
    const rec: AppRecord = { kind: r.kind, params: isObj(r.params) ? structuredClone(r.params) : {} };
    if (typeof r.title === 'string' && r.title.length <= 200) rec.title = r.title;
    if (isStr(r.follows)) rec.follows = r.follows;
    if (isObj(r.selection) && isStr(r.selection.type) && isStr(r.selection.id)) {
      rec.selection = { type: r.selection.type, id: r.selection.id } satisfies Selection;
    }
    return rec;
  };

  const node = (raw: unknown): Node | null => {
    if (!isObj(raw) || !isStr(raw.id) || ids.has(raw.id) || --budget < 0) return null;
    if (raw.kind === 'split') {
      if (raw.axis !== 'x' && raw.axis !== 'y') return null;
      ids.add(raw.id);
      const rawChildren = Array.isArray(raw.children) ? raw.children : [];
      const rawWeights = Array.isArray(raw.weights) ? raw.weights : [];
      const children: Node[] = [];
      const weights: number[] = [];
      rawChildren.forEach((c, i) => {
        const n = node(c);
        if (!n) return;
        children.push(n);
        const w = rawWeights[i];
        weights.push(typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 1);
      });
      return { kind: 'split', id: raw.id, axis: raw.axis, children, weights };
    }
    if (raw.kind !== 'panel' || !Array.isArray(raw.tabs)) return null;
    ids.add(raw.id);
    const tabs: string[] = [];
    for (const t of raw.tabs) {
      if (!isStr(t) || placed.has(t) || ids.has(t)) continue;
      const rec = app(t);
      if (!rec) continue;
      placed.add(t);
      apps[t] = rec;
      tabs.push(t);
      const r = rawApps[t] as Record<string, unknown>;
      if (kindOf(rec.kind).hosts) rec.dock = r.dock == null ? null : node(r.dock);
    }
    for (const t of tabs) ids.add(t);
    const selected = isStr(raw.selected) && tabs.includes(raw.selected) ? raw.selected : (tabs[0] ?? '');
    return { kind: 'panel', id: raw.id, tabs, selected };
  };

  const root = input.root == null ? null : node(input.root);

  // Follow links: to a live app, never itself, never in a cycle.
  for (const [id, rec] of Object.entries(apps)) {
    if (rec.follows === undefined) continue;
    if (rec.follows === id || !apps[rec.follows]) delete rec.follows;
  }
  for (const id of Object.keys(apps)) {
    const seen = new Set([id]);
    let cur = apps[id].follows;
    while (cur !== undefined) {
      if (seen.has(cur)) {
        delete apps[id].follows;
        break;
      }
      seen.add(cur);
      cur = apps[cur]?.follows;
    }
  }

  let doc: LayoutDoc = normalizeDoc({ schema: 1, root, apps, nav: { frame: null, visits: [], index: -1, overviewReturn: null } });
  const idx = indexDoc(doc);
  const nav = isObj(input.nav) ? input.nav : {};
  const visit = (v: unknown): Visit | null => {
    if (!isObj(v) || !Array.isArray(v.apps)) return null;
    const node = v.node === null ? null : isStr(v.node) ? v.node : undefined;
    if (node === undefined) return null;
    return { node, apps: v.apps.filter((a): a is string => isStr(a) && Object.hasOwn(apps, a)).slice(0, 500) };
  };
  const visits = (Array.isArray(nav.visits) ? nav.visits : []).map(visit).filter((v): v is Visit => v !== null).slice(-50);
  const index = typeof nav.index === 'number' && Number.isInteger(nav.index) ? Math.min(Math.max(nav.index, -1), visits.length - 1) : visits.length - 1;
  const frame = isStr(nav.frame) ? resolveFrame(doc, idx, nav.frame) : null;
  const next: NavState = { frame, visits, index, overviewReturn: visit(nav.overviewReturn) };
  doc = { ...doc, nav: next };
  return doc;
}
