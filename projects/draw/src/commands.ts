// The command registry (P1-M5): every command Draw offers, once, with its name, its keys, when it
// applies and what it does. The ContextBar's selection buttons, the More sheet's rows, the keyboard
// (src/keys.ts) and the ⌘K palette (panels/Palette.tsx) are all built from it, so every way in runs
// the same code. Framework-free: node's tests run it over a real editor.
//
// - The order here is the palette's. The bar and More keep their own order (BAR, MORE), their labels,
//   classes and visibility exactly as before the registry: only their source changed.
// - A key belongs to a command where its `keysIn` allows: 'canvas', never in a field, the code view or
//   a sheet; 'code', in the code view too (Undo, Redo and the palette's ⌘K). `Mod` is ⌘ or Ctrl.
// - The arrows' nudge is a held gesture, not a command: keys.ts keeps it.
// - The Shapes kinds, the Text tool's font, the Pen's bar and the Node tool's bar are modes and keep
//   their own buttons; their actions are here for the palette.

import { BOOLEAN_LABELS, BOOLEAN_OPS, type Editor, type Tool } from './editor.ts';
import type { Workspace } from './workspace.ts';

export type Where = 'field' | 'code' | 'sheet' | 'canvas';
export type Group = 'Edit' | 'Select' | 'Arrange' | 'Convert' | 'Combine' | 'Path' | 'Pen' | 'Tools' | 'File' | 'View';

/** What the panels own, opened for a command: the palette, the Snap sheet, Copy, the grid. */
export interface Ui {
  /** Open the palette; `focus`: its field takes the focus (⌘K; not a tap, which would raise the keyboard). */
  palette(focus: boolean): void;
  snap(): void;
  copy(): void;
  grid(): void;
}
export interface Ctx {
  editor: Editor;
  /** Null where there is none (the keys' unit tests): the File commands don't apply then. */
  workspace: Workspace | null;
  ui: Ui | null;
}

export interface Command {
  /** Stable kebab-case. */
  id: string;
  /** The bar button's aria-label, More's row and the palette's row. */
  name: string;
  group: Group;
  /** 'Mod+Z', 'Shift+Mod+Z', 'Mod+Y', 'Delete', 'Backspace', 'Escape', 'Enter', 'Mod+A', 'Mod+K'. */
  keys?: readonly string[];
  /** Where its keys act: 'canvas' only, or the code view too ('code'). Never in a field or a sheet. */
  keysIn?: 'canvas' | 'code';
  /** A button on the ContextBar's selection bar. */
  bar?: true;
  /** A row in the More sheet. */
  more?: true;
  /** When the bar or More shows it (always, if absent). */
  shown?(ctx: Ctx): boolean;
  /** Not in the palette (Escape, Enter, the palette's own ⌘K). */
  palette?: false;
  /** Whether it applies now: the palette lists only these; a key runs only these; the bar disables the rest. */
  can(ctx: Ctx): boolean;
  /** Run it. False: it didn't take the key (Enter outside the Pen), so the key isn't prevented. */
  run(ctx: Ctx): boolean | void;
}

// What the commands read.
const doc = (c: Ctx) => c.editor.doc;
const writable = (c: Ctx) => !!doc(c) && !c.editor.readOnly.get();
const selected = (c: Ctx) => c.editor.selection.get().size;
const rootOnly = (c: Ctx) => {
  const ids = [...c.editor.selection.get()];
  return ids.length === 1 && ids[0] === doc(c)?.root;
};
const some = (c: Ctx) => selected(c) > 0;
const someNotRoot = (c: Ctx) => some(c) && !rootOnly(c);
const node = (c: Ctx) => (c.editor.tool.get() === 'node' && selected(c) === 1 ? c.editor.nodeBar() : null);
const pen = (c: Ctx) => (c.editor.tool.get() === 'pen' ? c.editor.pen.get() : null);
const tool = (id: Tool, name: string): Command => ({
  id: `tool-${id}`,
  name,
  group: 'Tools',
  can: (c) => (id === 'select' ? !!doc(c) : writable(c)) && c.editor.tool.get() !== id,
  run: (c) => c.editor.pickTool(id),
});
const ALIGN: [string, string, Parameters<Editor['align']>[0]][] = [
  ['align-left', 'Align left', 'left'],
  ['align-centre', 'Align centre', 'center'],
  ['align-right', 'Align right', 'right'],
  ['align-top', 'Align top', 'top'],
  ['align-middle', 'Align middle', 'middle'],
  ['align-bottom', 'Align bottom', 'bottom'],
];

export const COMMANDS: readonly Command[] = [
  // Edit
  { id: 'undo', name: 'Undo', group: 'Edit', keys: ['Mod+Z'], keysIn: 'code', can: (c) => c.editor.history.get().canUndo, run: (c) => c.editor.undo() },
  { id: 'redo', name: 'Redo', group: 'Edit', keys: ['Shift+Mod+Z', 'Mod+Y'], keysIn: 'code', can: (c) => c.editor.history.get().canRedo, run: (c) => c.editor.redo() },
  { id: 'delete', name: 'Delete', group: 'Edit', keys: ['Delete', 'Backspace'], keysIn: 'canvas', bar: true, can: someNotRoot, run: (c) => c.editor.delete() },
  { id: 'duplicate', name: 'Duplicate', group: 'Edit', more: true, can: someNotRoot, run: (c) => c.editor.duplicate() },
  { id: 'edit-text', name: 'Edit text', group: 'Edit', bar: true, shown: (c) => c.editor.canEditText(), can: (c) => c.editor.canEditText(), run: (c) => c.editor.editText() },
  { id: 'edit-source', name: 'Edit source', group: 'Edit', more: true, shown: (c) => c.editor.canEditSource(), can: (c) => c.editor.canEditSource(), run: (c) => c.editor.openSource() },
  { id: 'fill', name: 'Fill…', group: 'Edit', more: true, can: someNotRoot, run: (c) => c.editor.openStyleSheet('fill') },
  { id: 'stroke', name: 'Stroke…', group: 'Edit', more: true, can: someNotRoot, run: (c) => c.editor.openStyleSheet('stroke') },
  { id: 'gloss', name: 'Gloss', group: 'Edit', more: true, can: someNotRoot, run: (c) => c.editor.toggleGloss() },
  // Select
  { id: 'deselect', name: 'Deselect', group: 'Select', bar: true, can: some, run: (c) => c.editor.deselect() },
  { id: 'select-more', name: 'Select more', group: 'Select', bar: true, can: (c) => !!doc(c), run: (c) => c.editor.selectMore.set(!c.editor.selectMore.get()) },
  { id: 'select-all', name: 'Select all', group: 'Select', keys: ['Mod+A'], keysIn: 'canvas', more: true, can: (c) => !!doc(c), run: (c) => c.editor.selectAll() },
  { id: 'select-group', name: 'Select group', group: 'Select', more: true, can: someNotRoot, run: (c) => c.editor.selectGroup() },
  // Arrange
  { id: 'bring-forward', name: 'Bring forward', group: 'Arrange', bar: true, can: someNotRoot, run: (c) => c.editor.forward() },
  { id: 'send-back', name: 'Send back', group: 'Arrange', bar: true, can: someNotRoot, run: (c) => c.editor.back() },
  { id: 'group', name: 'Group', group: 'Arrange', more: true, can: someNotRoot, run: (c) => c.editor.group() },
  { id: 'ungroup', name: 'Ungroup', group: 'Arrange', more: true, can: someNotRoot, run: (c) => c.editor.ungroup() },
  ...ALIGN.map(([id, name, kind]): Command => ({ id, name, group: 'Arrange', more: true, can: someNotRoot, run: (c) => c.editor.align(kind) })),
  { id: 'distribute-h', name: 'Distribute horizontally', group: 'Arrange', more: true, can: someNotRoot, run: (c) => c.editor.distribute('h') },
  { id: 'distribute-v', name: 'Distribute vertically', group: 'Arrange', more: true, can: someNotRoot, run: (c) => c.editor.distribute('v') },
  // Convert
  { id: 'stroke-to-path', name: 'Stroke to path', group: 'Convert', more: true, shown: (c) => c.editor.canStrokeToPath(), can: (c) => c.editor.canStrokeToPath(), run: (c) => void c.editor.strokeToPath() },
  { id: 'text-to-path', name: 'Text to path', group: 'Convert', more: true, shown: (c) => c.editor.canTextToPath(), can: (c) => c.editor.canTextToPath(), run: (c) => void c.editor.textToPath() },
  // Combine
  ...BOOLEAN_OPS.map((op): Command => ({
    id: `combine-${op}`,
    name: BOOLEAN_LABELS[op],
    group: 'Combine',
    more: true,
    shown: (c) => selected(c) >= 2,
    can: (c) => selected(c) >= 2,
    run: (c) => void c.editor.combine(op),
  })),
  // Path: the Node tool's bar, for the palette
  { id: 'smooth', name: 'Smooth', group: 'Path', can: (c) => !!node(c)?.smooth, run: (c) => c.editor.toggleSmooth() },
  { id: 'close-path', name: 'Close path', group: 'Path', can: (c) => node(c)?.closed === false, run: (c) => c.editor.toggleClosed() },
  { id: 'open-path', name: 'Open path', group: 'Path', can: (c) => node(c)?.closed === true, run: (c) => c.editor.toggleClosed() },
  { id: 'relative', name: 'Relative', group: 'Path', can: (c) => node(c)?.relative === false, run: (c) => c.editor.toggleRelative() },
  { id: 'absolute', name: 'Absolute', group: 'Path', can: (c) => node(c)?.relative === true, run: (c) => c.editor.toggleRelative() },
  { id: 'reverse', name: 'Reverse', group: 'Path', can: (c) => !!node(c), run: (c) => c.editor.reverse() },
  // Pen: its bar, for the palette
  { id: 'undo-point', name: 'Undo point', group: 'Pen', can: (c) => !!pen(c)?.canUndo, run: (c) => c.editor.undoPoint() },
  { id: 'pen-close', name: 'Close', group: 'Pen', can: (c) => !!pen(c)?.canClose, run: (c) => c.editor.penClose() },
  { id: 'pen-done', name: 'Done', group: 'Pen', can: (c) => !!pen(c), run: (c) => c.editor.penDone() },
  // Tools
  tool('select', 'Select'),
  tool('node', 'Node'),
  tool('pen', 'Pen'),
  tool('shapes', 'Shapes'),
  tool('text', 'Text'),
  // File
  { id: 'new', name: 'New…', group: 'File', can: (c) => !!c.workspace, run: (c) => c.workspace!.show('new') },
  { id: 'files', name: 'Files', group: 'File', can: (c) => !!c.workspace, run: (c) => c.workspace!.show('files') },
  { id: 'export', name: 'Export…', group: 'File', can: (c) => !!c.workspace && !!doc(c), run: (c) => c.workspace!.show('export') },
  { id: 'finish', name: 'Finish…', group: 'File', can: (c) => !!c.workspace && !!doc(c), run: (c) => c.workspace!.show('finish') },
  { id: 'copy', name: 'Copy', group: 'File', can: (c) => !!c.ui && !!doc(c), run: (c) => c.ui!.copy() },
  // View
  { id: 'fit', name: 'Fit', group: 'View', can: (c) => !!doc(c), run: (c) => c.editor.fitToScreen() },
  { id: 'grid', name: 'Grid', group: 'View', can: (c) => !!c.ui && !!doc(c), run: (c) => c.ui!.grid() },
  { id: 'snap', name: 'Snap…', group: 'View', can: (c) => !!c.ui && !!doc(c), run: (c) => c.ui!.snap() },
  { id: 'commands', name: 'Commands', group: 'View', keys: ['Mod+K'], keysIn: 'code', palette: false, can: (c) => !!c.ui, run: (c) => c.ui!.palette(true) },
  // Keys only
  { id: 'escape', name: 'Escape', group: 'Edit', keys: ['Escape'], keysIn: 'canvas', palette: false, can: () => true, run: (c) => c.editor.escape() },
  { id: 'enter', name: 'Enter', group: 'Pen', keys: ['Enter'], keysIn: 'canvas', palette: false, can: () => true, run: (c) => c.editor.enter() },
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));
/** A command by id (throws for an unknown one: the layouts below name only real ones). */
export function command(id: string): Command {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`no command ${id}`);
  return c;
}

/** The ContextBar's selection buttons, in order (then More). */
export const BAR: readonly string[] = ['deselect', 'select-more', 'edit-text', 'bring-forward', 'send-back', 'delete'];

/** The More sheet: its first rows, then the subheaded grids, each shown when one of its rows is. */
export const MORE: readonly { head: string | null; ids: readonly string[] }[] = [
  { head: null, ids: ['edit-source', 'fill', 'stroke', 'gloss', 'duplicate', 'group', 'ungroup', 'select-group', 'select-all'] },
  { head: 'Align', ids: ALIGN.map(([id]) => id) },
  { head: 'Distribute', ids: ['distribute-h', 'distribute-v'] },
  { head: 'Convert', ids: ['stroke-to-path', 'text-to-path'] },
  { head: 'Combine', ids: BOOLEAN_OPS.map((op) => `combine-${op}`) },
];

const isShown = (c: Command, ctx: Ctx) => !c.shown || c.shown(ctx);

/** The bar's buttons for the selection now: each shown command, disabled where it doesn't apply. */
export function barCommands(ctx: Ctx): { command: Command; disabled: boolean }[] {
  return BAR.map(command).filter((c) => isShown(c, ctx)).map((c) => ({ command: c, disabled: !c.can(ctx) }));
}

/** More's sections for the selection now: each with the rows it shows, a section with none left out. */
export function moreSections(ctx: Ctx): { head: string | null; rows: Command[] }[] {
  return MORE.map((s) => ({ head: s.head, rows: s.ids.map(command).filter((c) => isShown(c, ctx)) })).filter((s) => s.rows.length > 0);
}

/** The parts of a KeyboardEvent a key's name reads. */
export interface KeyLike {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** A key's name as the registry writes it: 'Shift+', 'Alt+' and 'Mod+' (⌘ or Ctrl), then the key, a letter in capitals. */
export function keyName(e: KeyLike): string {
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return `${e.shiftKey ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${e.metaKey || e.ctrlKey ? 'Mod+' : ''}${k}`;
}

/** Which commands' keys act where: a field and a sheet take none; the code view only 'code' ones; the canvas both. */
const ACTS: Readonly<Record<Where, readonly ('canvas' | 'code')[]>> = { field: [], sheet: [], code: ['code'], canvas: ['canvas', 'code'] };

/** The command a key names where it was pressed, or null. */
export function commandForKey(e: KeyLike, where: Where): Command | null {
  const name = keyName(e);
  return COMMANDS.find((c) => c.keys?.includes(name) && ACTS[where].includes(c.keysIn ?? 'canvas')) ?? null;
}

/** The commands the palette lists now (applicable, and in it), in registry order. */
export function applicable(ctx: Ctx): Command[] {
  return COMMANDS.filter((c) => c.palette !== false && c.can(ctx));
}

/** The palette's search: the applicable commands whose name or group holds every word typed (case folded), in registry order. */
export function search(query: string, ctx: Ctx): Command[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return applicable(ctx).filter((c) => {
    const text = `${c.name} ${c.group}`.toLocaleLowerCase();
    return words.every((w) => text.includes(w));
  });
}

const HINTS: Record<string, string> = { Shift: '⇧', Alt: '⌥', Mod: '⌘', Backspace: '⌫', Delete: '⌦', Escape: 'esc', Enter: '↩' };
/** A command's key as the palette shows it: "⌘Z", "⇧⌘Z", "⌫" (the key an Apple keyboard calls delete, where both are its). */
export function keyHint(c: Command): string {
  const key = c.keys?.includes('Backspace') ? 'Backspace' : c.keys?.[0];
  return key ? key.split('+').map((p) => HINTS[p] ?? p).join('') : '';
}
