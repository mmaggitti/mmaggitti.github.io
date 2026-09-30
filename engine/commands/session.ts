// The editing session: the one place a document changes. Every input (a tool, a code scrub, a
// sheet, an import, undo, redo) becomes a named transaction of ops; each dispatch emits exactly one
// ChangeSet to the subscribers (renderer, code view, overlay, store, drafts), in the order they
// subscribed. A drag is a session of its own: its frames apply live and commit as ONE history
// entry, so undo after a drag restores the state before it, byte for byte.

import type { Doc } from '../model/doc.ts';
import { coalesce, emptyChangeSet, noteChange, redoOp, undoOp, type ChangeSet, type Op } from './ops.ts';

export interface Transaction {
  label: string;
  ops: Op[];
}

export type Listener = (changes: ChangeSet, why: { label: string; kind: 'do' | 'undo' | 'redo' | 'drag' }) => void;

/** Builds a transaction: each intent applies immediately and returns its op. */
export type Build = (apply: (op: Op) => void) => void;

export interface Drag {
  /** Apply one frame: the previous frame's ops are replaced by this frame's. */
  update(build: Build): void;
  /** Keep the result as one history entry (nothing if it changed nothing). */
  commit(): void;
  /** Restore the state before the drag. */
  cancel(): void;
}

const HISTORY_LIMIT = 500;

export class Session {
  readonly doc: Doc;
  private done: Transaction[] = [];
  private undone: Transaction[] = [];
  private listeners: Listener[] = [];
  private dragging = false;

  constructor(doc: Doc) {
    this.doc = doc;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  get canUndo(): boolean {
    return this.done.length > 0 && !this.dragging;
  }
  get canRedo(): boolean {
    return this.undone.length > 0 && !this.dragging;
  }
  get undoLabel(): string | null {
    return this.done.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.undone.at(-1)?.label ?? null;
  }

  /** Run a named transaction. If an intent throws, everything it already applied is undone. */
  dispatch(label: string, build: Build): ChangeSet {
    if (this.dragging) throw new Error('dispatch during a drag: commit or cancel it first');
    const ops = this.run(build);
    const kept = coalesce(ops, this.doc);
    if (kept.length) {
      this.done.push({ label, ops: kept });
      if (this.done.length > HISTORY_LIMIT) this.done.shift();
      this.undone = [];
    }
    return this.emit(ops, label, 'do');
  }

  undo(): ChangeSet | null {
    if (!this.canUndo) return null;
    const tx = this.done.pop()!;
    for (let i = tx.ops.length - 1; i >= 0; i--) undoOp(this.doc, tx.ops[i]);
    this.undone.push(tx);
    return this.emit(tx.ops, tx.label, 'undo');
  }

  redo(): ChangeSet | null {
    if (!this.canRedo) return null;
    const tx = this.undone.pop()!;
    for (const op of tx.ops) redoOp(this.doc, op);
    this.done.push(tx);
    return this.emit(tx.ops, tx.label, 'redo');
  }

  /** Start a drag (a scrub, a handle, a pinch-free tool gesture): frames apply live, one undo entry. */
  drag(label: string): Drag {
    if (this.dragging) throw new Error('a drag is already in progress');
    this.dragging = true;
    let frame: Op[] = []; // the applied frame; every frame starts from the state before the drag
    const rollback = () => {
      for (let i = frame.length - 1; i >= 0; i--) undoOp(this.doc, frame[i]);
    };
    let open = true;
    const finish = () => {
      if (!open) throw new Error('this drag has ended');
      open = false;
      this.dragging = false;
    };
    return {
      update: (build) => {
        if (!open) throw new Error('this drag has ended');
        const before = frame;
        rollback();
        frame = this.run(build);
        this.emit([...before, ...frame], label, 'drag');
      },
      commit: () => {
        finish();
        // Earlier frames were rolled back, so the applied frame's ops run from the state before
        // the drag to the state now: they are the one entry to keep.
        const net = coalesce(frame, this.doc);
        if (net.length) {
          this.done.push({ label, ops: net });
          if (this.done.length > HISTORY_LIMIT) this.done.shift();
          this.undone = [];
        }
      },
      cancel: () => {
        finish();
        const was = frame;
        rollback();
        frame = [];
        this.emit(was, label, 'drag');
      },
    };
  }

  private run(build: Build): Op[] {
    const ops: Op[] = [];
    try {
      build((op) => ops.push(op));
    } catch (e) {
      for (let i = ops.length - 1; i >= 0; i--) undoOp(this.doc, ops[i]);
      throw e;
    }
    return ops;
  }

  private emit(ops: readonly Op[], label: string, kind: 'do' | 'undo' | 'redo' | 'drag'): ChangeSet {
    const cs = emptyChangeSet();
    for (const op of ops) noteChange(cs, op);
    for (const l of this.listeners) l(cs, { label, kind });
    return cs;
  }
}
