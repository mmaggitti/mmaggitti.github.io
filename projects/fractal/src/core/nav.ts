// Moving through the levels: what a frame can be, its parent, its neighbours and its breadcrumb.

import type { LayoutDoc, Node } from './types.ts';
import { kindOf } from './kinds.ts';
import { appsIn, type TreeIndex } from './tree.ts';
import { resolveFrame } from './layout.ts';

/** The frame one level out: the enclosing split, or the host panel around a dock, or the overview.
 * A dock's root split is never a frame of its own (framing it frames its host panel). */
export function parentFrame(doc: LayoutDoc, idx: TreeIndex, frame: string | null): string | null {
  if (frame === null) return null;
  const owner = idx.owner.get(frame);
  if (!owner || owner.type === 'root') return null;
  if (owner.type === 'dock') return idx.panelOf.get(owner.app) ?? null;
  return resolveFrame(doc, idx, owner.id);
}

/** The chain of frames from the overview (null) down to `frame`. */
export function framePath(doc: LayoutDoc, idx: TreeIndex, frame: string | null): (string | null)[] {
  const path: (string | null)[] = [];
  let cur = resolveFrame(doc, idx, frame);
  for (let guard = 0; guard < 1000; guard++) {
    path.unshift(cur);
    if (cur === null) break;
    cur = parentFrame(doc, idx, cur);
  }
  return path;
}

export function appTitle(doc: LayoutDoc, id: string): string {
  const rec = doc.apps[id];
  if (!rec) return '';
  return rec.title?.trim() || kindOf(rec.kind).title;
}

/** A readable name for a frame: a panel's selected app, or a split's apps joined by " · ". */
export function frameLabel(doc: LayoutDoc, idx: TreeIndex, frame: string | null): string {
  if (frame === null) return 'Home';
  const node = idx.nodes.get(frame);
  if (!node) return '';
  if (node.kind === 'panel') return appTitle(doc, node.selected);
  const names = node.children.map((c: Node) => (c.kind === 'panel' ? appTitle(doc, c.selected) : frameLabel(doc, idx, c.id)));
  return names.join(' · ');
}

export interface Crumb {
  frame: string | null;
  label: string;
}

export function crumbs(doc: LayoutDoc, idx: TreeIndex, frame: string | null): Crumb[] {
  return framePath(doc, idx, frame).map((f) => ({ frame: f, label: frameLabel(doc, idx, f) }));
}

export interface Neighbours {
  prev: string | null;
  next: string | null;
  index: number;
  count: number;
}

/** The framed node's siblings (its pages). A frame with no splitting parent has none. */
export function neighbours(idx: TreeIndex, frame: string | null): Neighbours {
  const none = { prev: null, next: null, index: 0, count: 1 };
  if (frame === null) return none;
  const owner = idx.owner.get(frame);
  if (owner?.type !== 'split') return none;
  const split = idx.nodes.get(owner.id);
  if (split?.kind !== 'split') return none;
  const i = owner.index;
  return {
    prev: i > 0 ? split.children[i - 1].id : null,
    next: i < split.children.length - 1 ? split.children[i + 1].id : null,
    index: i,
    count: split.children.length,
  };
}

/** Every node that can be framed, outermost first. */
export function frames(doc: LayoutDoc, idx: TreeIndex): string[] {
  const out: string[] = [];
  for (const id of idx.nodes.keys()) if (resolveFrame(doc, idx, id) === id) out.push(id);
  return out;
}

/** Apps a frame shows (for history). The overview shows everything. */
export function appsOfFrame(doc: LayoutDoc, idx: TreeIndex, frame: string | null): string[] {
  if (frame === null) return doc.root ? appsIn(doc, doc.root) : [];
  const node = idx.nodes.get(frame);
  return node ? appsIn(doc, node) : [];
}
