// Undo and Redo for arranging. A snapshot is the arrangement only (root and apps): navigation never
// enters the stack, and restoring keeps the current frame when it still exists.

import type { LayoutDoc } from './types.ts';
import { finish } from './arrange.ts';

export const UNDO_CAP = 100;

export interface Snapshot {
  root: LayoutDoc['root'];
  apps: LayoutDoc['apps'];
}

export interface UndoStack {
  past: Snapshot[];
  future: Snapshot[];
}

export const EMPTY_UNDO: UndoStack = { past: [], future: [] };

export const snapshot = (doc: LayoutDoc): Snapshot => ({ root: doc.root, apps: doc.apps });

/** Record the arrangement from before a change. A new change drops the redo list. */
export function recordUndo(u: UndoStack, before: LayoutDoc): UndoStack {
  const past = [...u.past, snapshot(before)];
  return { past: past.slice(Math.max(0, past.length - UNDO_CAP)), future: [] };
}

function restore(doc: LayoutDoc, s: Snapshot): LayoutDoc {
  return finish(doc, { ...doc, root: s.root, apps: s.apps });
}

export function undo(u: UndoStack, doc: LayoutDoc): { stack: UndoStack; doc: LayoutDoc } | null {
  const last = u.past.at(-1);
  if (!last) return null;
  return { stack: { past: u.past.slice(0, -1), future: [snapshot(doc), ...u.future] }, doc: restore(doc, last) };
}

export function redo(u: UndoStack, doc: LayoutDoc): { stack: UndoStack; doc: LayoutDoc } | null {
  const next = u.future[0];
  if (!next) return null;
  return { stack: { past: [...u.past, snapshot(doc)], future: u.future.slice(1) }, doc: restore(doc, next) };
}
