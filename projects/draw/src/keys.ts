// The keyboard (P1-M1, routed through the command registry since P1-M5): every key but the arrows is a
// command (src/commands.ts: Undo ⌘Z, Redo ⇧⌘Z and ⌘Y, Delete and Backspace, Escape, Enter, ⌘A and the
// palette's ⌘K), run where its `keysIn` allows; the arrows' nudge stays here, a held gesture rather than
// a command. Installed once on window by panels/App.tsx.
//
// Where a key was pressed decides what it may do: in a field (input, textarea, select, contenteditable)
// or under an open sheet (.draw-modal) no command takes it; in the code view (its tokens take the
// arrows, Enter and Space themselves) only a 'code' command (Undo, Redo, the palette); elsewhere, the
// canvas's. A key another handler already took (defaultPrevented) is left alone, and a key is prevented
// only when its command ran (Enter only when the Pen took it). Delete and the arrows act only on a
// selection.
//
// The arrows nudge by 1 root user unit, 10 with Shift. Holding them (auto-repeat, or a second
// arrow) is one nudge: the editor opens one 'Nudge' drag on the first keydown, every keydown moves
// it further from the document as it was before, and the keyup of the last held arrow commits it,
// one history entry. If the window loses focus with an arrow held, its keyup never comes, so the
// nudge is kept then.

import type { Editor } from './editor.ts';
import { commandForKey, type Ctx, type Where } from './commands.ts';

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

// A field takes its own keys.
const FIELD = 'input, textarea, select';

export class Keys {
  #editor: Editor;
  #modal: () => boolean;
  #ctx: Ctx;
  #held = new Set<string>(); // the arrows down now

  /** `modalOpen`: is a sheet (.draw-modal) open? `ctx`: what the commands open (the workspace, the panels); the editor alone if absent. */
  constructor(editor: Editor, modalOpen: () => boolean, ctx?: Ctx) {
    this.#editor = editor;
    this.#modal = modalOpen;
    this.#ctx = ctx ?? { editor, workspace: null, ui: null };
  }

  down(e: KeyInput): void {
    if (e.defaultPrevented) return;
    const where = this.#where(e.target);
    const arrow = ARROWS[e.key];
    if (arrow) {
      const ed = this.#editor;
      if (where !== 'canvas' || e.metaKey || e.ctrlKey || e.altKey || !ed.selection.get().size) return;
      e.preventDefault(); // the page doesn't scroll
      this.#held.add(e.key);
      const n = e.shiftKey ? NUDGE_SHIFT : NUDGE;
      ed.nudge(arrow[0] * n, arrow[1] * n);
      return;
    }
    const c = commandForKey(e, where);
    if (!c || !c.can(this.#ctx)) return;
    if (c.run(this.#ctx) !== false) e.preventDefault();
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

  // A field first, then an open sheet, then the code view; else the canvas.
  #where(target: EventTarget | null): Where {
    const t = target as { closest?(selectors: string): unknown; isContentEditable?: boolean } | null;
    if (t?.isContentEditable || t?.closest?.(FIELD)) return 'field';
    if (this.#modal()) return 'sheet';
    return t?.closest?.('.draw-code') ? 'code' : 'canvas';
  }
}

/** Put the keys on `win` (keydown, keyup, blur); returns the way to take them off. */
export function installKeys(editor: Editor, win: Window, modalOpen: () => boolean, ctx?: Ctx): () => void {
  const keys = new Keys(editor, modalOpen, ctx);
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
