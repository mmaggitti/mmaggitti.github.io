// The keyboard on the canvas selection (P1-M1): Delete, Escape, the arrows and ⌘A, handed to the
// editor. Installed once on window by panels/App.tsx; P0's ⌘Z, ⇧⌘Z and ⌘Y stay there (M5's command
// registry takes every key over).
//
// A key never acts when something else has it: a field (input, textarea, select, contenteditable),
// the code view (its tokens take the arrows, Enter and Space themselves), an open sheet
// (.draw-modal), or a handler that already took it (defaultPrevented). Delete and the arrows act
// only on a selection.
//
// The arrows nudge by 1 root user unit, 10 with Shift. Holding them (auto-repeat, or a second
// arrow) is one nudge: the editor opens one 'Nudge' drag on the first keydown, every keydown moves
// it further from the document as it was before, and the keyup of the last held arrow commits it,
// one history entry. If the window loses focus with an arrow held, its keyup never comes, so the
// nudge is kept then.

import type { NodeId } from '../../../engine/model/doc.ts';

/** What the keys drive: the editor. */
export interface KeyEditor {
  readonly selection: { get(): ReadonlySet<NodeId> };
  delete(): void;
  escape(): void;
  selectAll(): void;
  nudge(dx: number, dy: number): void;
  nudgeEnd(commit?: boolean): void;
}

/** The parts of a KeyboardEvent the keys read. */
export interface KeyInput {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
  preventDefault(): void;
}

export const NUDGE = 1; // root user units per arrow press
export const NUDGE_SHIFT = 10;

const ARROWS: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// Where a key belongs to something else: a field, or the code view.
const ELSEWHERE = 'input, textarea, select, .draw-code';

export class Keys {
  #editor: KeyEditor;
  #modal: () => boolean;
  #held = new Set<string>(); // the arrows down now

  /** `modalOpen`: is a sheet (.draw-modal) open? */
  constructor(editor: KeyEditor, modalOpen: () => boolean) {
    this.#editor = editor;
    this.#modal = modalOpen;
  }

  down(e: KeyInput): void {
    if (e.defaultPrevented || this.#elsewhere(e.target)) return;
    const ed = this.#editor;
    const arrow = ARROWS[e.key];
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (arrow) {
      if (!plain || !ed.selection.get().size) return;
      e.preventDefault(); // the page doesn't scroll
      this.#held.add(e.key);
      const n = e.shiftKey ? NUDGE_SHIFT : NUDGE;
      ed.nudge(arrow[0] * n, arrow[1] * n);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!plain || !ed.selection.get().size) return;
      e.preventDefault();
      ed.delete();
    } else if (e.key === 'Escape') {
      ed.escape();
    } else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      ed.selectAll();
    }
  }

  /** An arrow went up: the last one held ends the nudge (wherever the focus went meanwhile). */
  up(e: KeyInput): void {
    if (!this.#held.delete(e.key)) return;
    if (!this.#held.size) this.#editor.nudgeEnd();
  }

  /** The window lost focus: arrows held now send no keyup, so the nudge is kept here. */
  blur(): void {
    if (!this.#held.size) return;
    this.#held.clear();
    this.#editor.nudgeEnd();
  }

  #elsewhere(target: EventTarget | null): boolean {
    const t = target as { closest?(selectors: string): unknown; isContentEditable?: boolean } | null;
    return !!t?.isContentEditable || !!t?.closest?.(ELSEWHERE) || this.#modal();
  }
}

/** Put the keys on `win` (keydown, keyup, blur); returns the way to take them off. */
export function installKeys(editor: KeyEditor, win: Window, modalOpen: () => boolean): () => void {
  const keys = new Keys(editor, modalOpen);
  const down = (e: KeyboardEvent) => keys.down(e);
  const up = (e: KeyboardEvent) => keys.up(e);
  const blur = () => keys.blur();
  win.addEventListener('keydown', down);
  win.addEventListener('keyup', up);
  win.addEventListener('blur', blur);
  return () => {
    win.removeEventListener('keydown', down);
    win.removeEventListener('keyup', up);
    win.removeEventListener('blur', blur);
  };
}
