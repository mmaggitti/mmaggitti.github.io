// The command registry (src/commands.ts) over a real editor: each key names its one command, where it
// may act; the palette's search; and the ContextBar's and More's lists, which the registry builds
// exactly as the bar and the sheet showed them before it existed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, type ElementNode, type NodeId } from '../../../../engine/model/doc.ts';
import { COMMANDS, applicable, barCommands, commandForKey, keyHint, keyName, moreSections, search, type Ctx, type KeyLike, type Where } from '../../src/commands.ts';
import { fakeEditor } from './fakes.ts';

const DOC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect id="a" x="10" y="10" width="10" height="10" fill="#e76f51" stroke="#264653"/>
  <circle id="b" cx="50" cy="50" r="10" fill="#2a9d8f"/>
  <text id="t" x="10" y="90" font-family="Inter" font-size="10">Hi</text>
</svg>`;

function setup() {
  const editor = fakeEditor();
  editor.open(DOC);
  const ctx: Ctx = { editor, workspace: null, ui: null };
  const id = (name: string): NodeId =>
    ([...descendants(editor.doc!, editor.doc!.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === name)) as ElementNode).id;
  return { editor, ctx, id };
}

/** A key as the registry names it ('Shift+Mod+Z'), pressed with ⌘ (or Ctrl, `ctrl`). */
function press(name: string, ctrl = false): KeyLike {
  const parts = name.split('+');
  const key = parts.pop()!;
  return { key: key.length === 1 ? key.toLowerCase() : key, shiftKey: parts.includes('Shift'), altKey: parts.includes('Alt'), metaKey: !ctrl && parts.includes('Mod'), ctrlKey: ctrl && parts.includes('Mod') };
}

test('each key names its one command, ⌘ or Ctrl alike: ⌘Z undoes, ⇧⌘Z and ⌘Y redo, Delete and Backspace delete, ⌘A selects all, ⌘K opens the palette', () => {
  for (const c of COMMANDS) {
    for (const k of c.keys ?? []) {
      for (const ctrl of [false, true]) assert.equal(commandForKey(press(k, ctrl), 'canvas')?.id, c.id, `${k}${ctrl ? ' (Ctrl)' : ''}`);
    }
  }
  const named = (k: KeyLike) => commandForKey(k, 'canvas')?.id ?? null;
  assert.equal(named({ key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }), 'undo');
  assert.equal(named({ key: 'Z', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }), 'redo', '⇧⌘Z (the key reads Z with Shift)');
  assert.equal(named({ key: 'y', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }), 'redo', 'Ctrl-Y');
  assert.equal(named({ key: 'Backspace', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }), 'delete');
  assert.equal(named({ key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }), 'commands');
  assert.equal(named({ key: 'Delete', metaKey: false, ctrlKey: false, shiftKey: false, altKey: true }), null, '⌥Delete is not a command');
  assert.equal(named({ key: 'z', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }), null, 'z alone');
  assert.equal(keyName({ key: 'z', metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }), 'Shift+Mod+Z');
});

test('where a key acts: a field and a sheet take no command’s key; the code view takes Undo, Redo and the palette’s, and nothing of the canvas’s', () => {
  const keyed = COMMANDS.filter((c) => c.keys?.length);
  for (const where of ['field', 'sheet'] as Where[]) for (const c of keyed) for (const k of c.keys!) assert.equal(commandForKey(press(k), where), null, `${k} in a ${where}`);
  const inCode = new Set(keyed.flatMap((c) => c.keys!.map((k) => commandForKey(press(k), 'code')?.id)).filter(Boolean));
  assert.deepEqual([...inCode].sort(), ['commands', 'redo', 'undo'], 'the code view');
  for (const k of ['Delete', 'Backspace', 'Escape', 'Enter', 'Mod+A']) assert.equal(commandForKey(press(k), 'code'), null, `${k} in the code view`);
  for (const c of keyed) for (const k of c.keys!) assert.equal(commandForKey(press(k), 'canvas')?.id, c.id, `${k} on the canvas`);
});

test('the palette’s search: the commands that apply now whose name or group holds every word typed, case folded, in registry order', () => {
  const { editor, ctx, id } = setup();
  editor.select([id('a')]);
  assert.equal(search('dup', ctx)[0]?.name, 'Duplicate', '“dup” leaves Duplicate first');
  assert.deepEqual(search('FORWARD', ctx).map((c) => c.name), ['Bring forward'], 'a word inside a name, in capitals');
  assert.deepEqual(search('align  lef', ctx).map((c) => c.name), ['Align left'], 'two words');
  assert.deepEqual(search('arrange back', ctx).map((c) => c.name), ['Send back'], 'a group’s word');
  assert.deepEqual(search('', ctx).map((c) => c.id), applicable(ctx).map((c) => c.id), 'nothing typed: everything that applies');
  assert.ok(!applicable(ctx).some((c) => c.id === 'commands' || c.id === 'escape' || c.id === 'enter'), 'keys-only commands are not listed');
  assert.ok(!applicable(ctx).some((c) => c.group === 'File'), 'no workspace: no File commands');
  editor.deselect();
  assert.ok(!search('delete', ctx).length, 'Delete with nothing selected does not apply');
  assert.equal(keyHint(COMMANDS.find((c) => c.id === 'undo')!), '⌘Z');
  assert.equal(keyHint(COMMANDS.find((c) => c.id === 'redo')!), '⇧⌘Z');
  assert.equal(keyHint(COMMANDS.find((c) => c.id === 'delete')!), '⌫');
  assert.equal(keyHint(COMMANDS.find((c) => c.id === 'duplicate')!), '');
});

test('the bar and More, from the registry: for a shape, two shapes, a text and the root, the buttons and rows the ContextBar showed, in order', () => {
  const { editor, ctx, id } = setup();
  const bar = () => barCommands(ctx).map((b) => `${b.command.name}${b.disabled ? ' (off)' : ''}`);
  const more = () => moreSections(ctx).map((s) => `${s.head ?? ''}: ${s.rows.map((c) => c.name).join(', ')}`);
  const FIRST = 'Fill…, Stroke…, Gloss, Duplicate, Group, Ungroup, Select group, Select all';
  const ALIGN = 'Align: Align left, Align centre, Align right, Align top, Align middle, Align bottom';
  const DISTRIBUTE = 'Distribute: Distribute horizontally, Distribute vertically';

  editor.select([id('a')]);
  assert.deepEqual(bar(), ['Deselect', 'Select more', 'Bring forward', 'Send back', 'Delete'], 'a shape');
  assert.deepEqual(more(), [`: Edit source, ${FIRST}`, ALIGN, DISTRIBUTE, 'Convert: Stroke to path'], 'a shape');

  editor.select([id('a'), id('b')]);
  assert.deepEqual(bar(), ['Deselect', 'Select more', 'Bring forward', 'Send back', 'Delete'], 'two shapes');
  assert.deepEqual(more(), [`: ${FIRST}`, ALIGN, DISTRIBUTE, 'Combine: Union, Subtract, Intersect, Exclude'], 'two shapes');

  editor.select([id('t')]);
  assert.deepEqual(bar(), ['Deselect', 'Select more', 'Edit text', 'Bring forward', 'Send back', 'Delete'], 'a text');
  assert.deepEqual(more(), [`: Edit source, ${FIRST}`, ALIGN, DISTRIBUTE, 'Convert: Text to path'], 'a text');

  editor.select([editor.doc!.root]);
  assert.deepEqual(bar(), ['Deselect', 'Select more', 'Bring forward (off)', 'Send back (off)', 'Delete (off)'], 'the root: Forward, Back and Delete disabled');
  assert.deepEqual(more(), [`: ${FIRST}`, ALIGN, DISTRIBUTE], 'the root: no Edit source');
});

test('a command runs the editor’s own action: one entry, as the bar’s button does', () => {
  const { editor, ctx, id } = setup();
  editor.select([id('b')]);
  const dup = search('dup', ctx)[0];
  dup.run(ctx);
  assert.equal(editor.history.get().undoLabel, 'Duplicate');
  assert.equal((editor.source().match(/<circle/g) ?? []).length, 2);
  commandForKey(press('Mod+Z'), 'code')!.run(ctx);
  assert.equal((editor.source().match(/<circle/g) ?? []).length, 1, '⌘Z in the code view undoes');
  assert.equal(commandForKey(press('Enter'), 'canvas')!.run(ctx), false, 'Enter outside the Pen is not taken');
});
