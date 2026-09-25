import { createStore } from './store';

/** The selected element in the framed page, or null. Cleared when the frame navigates. */
export const selection = createStore<Element | null>(null);

/** Select mode: taps on the canvas pick an element instead of reaching the page. */
export const picking = createStore(false);

export type SheetTab = 'tree' | 'inspect';
export const sheetTab = createStore<SheetTab>('tree');

export type SheetSize = 'peek' | 'half' | 'full';
export const sheetSize = createStore<SheetSize>('half');
