// What the commands open that the panels own (src/commands.ts Ui): the palette and the Snap sheet,
// as stores their panels read (so a command, a key or a button opens them alike), Copy, and the
// grid's toggle. Made once by App.

import type { Ui } from '../commands.ts';
import { createStore, type Store } from './store.ts';

export interface PanelUi extends Ui {
  /** The palette while it is open, and whether its field took the focus (⌘K) or not (a tap: no keyboard over the list). */
  readonly paletteOpen: Store<{ focus: boolean } | null>;
  /** The Snap sheet is open. */
  readonly snapOpen: Store<boolean>;
}

export function panelUi(copy: () => void, grid: () => void): PanelUi {
  const paletteOpen = createStore<{ focus: boolean } | null>(null);
  const snapOpen = createStore(false);
  return {
    paletteOpen,
    snapOpen,
    palette: (focus) => paletteOpen.set({ focus }),
    snap: () => snapOpen.set(true),
    copy,
    grid,
  };
}
