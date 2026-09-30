// The keyboard (src/keys.ts) over a real editor: each key does its one thing, none acts where the
// key belongs to something else, and a held arrow is one nudge and one history entry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, type ElementNode, type NodeId } from '../../../../engine/model/doc.ts';
import { Keys, NUDGE_SHIFT, type KeyInput } from '../../src/keys.ts';
import type { Editor } from '../../src/editor.ts';
import { fakeEditor } from './fakes.ts';

const SHAPES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect id="a" x="10" y="10" width="10" height="10"/>
  <rect id="b" x="40" y="10" width="10" height="10"/>
</svg>`;

type Key = KeyInput & { prevented: boolean };
/** A keydown or keyup as the browser gives it: on the page's body unless `target` says otherwise. */
function key(k: string, opts: Partial<KeyInput> = {}): Key {
  const e: Key = {
    key: k, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target: null, prevented: false,
    preventDefault() {
      e.prevented = true;
    },
    ...opts,
  };
  return e;
}
/** A target inside elements matching these selectors (as Element.closest answers). */
const inside = (...what: string[]) => ({ closest: (sel: string) => (sel.split(',').some((s) => what.includes(s.trim())) ? {} : null) }) as unknown as EventTarget;

function setup(modal = { open: false }) {
  const editor = fakeEditor();
  editor.open(SHAPES);
  const keys = new Keys(editor, () => modal.open);
  const id = (name: string): NodeId =>
    ([...descendants(editor.doc!, editor.doc!.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === name)) as ElementNode).id;
  const press = (k: string, opts: Partial<KeyInput> = {}) => {
    const e = key(k, opts);
    keys.down(e);
    keys.up(key(k));
    return e;
  };
  return { editor, keys, id, press, modal };
}
/** A rect's x and y as the file says them. */
const x = (editor: Editor, name: string) => new RegExp(`id="${name}" x="([^"]+)" y="([^"]+)"`).exec(editor.source())!.slice(1).map(Number);

test('each key does its one thing: Delete and Backspace delete, Escape deselects, ⌘A and Ctrl-A select all, the arrows nudge by 1 and Shift by 10', () => {
  const { editor, id, press } = setup();
  editor.select([id('a')]);
  assert.ok(press('ArrowRight').prevented, 'an arrow keeps the page from scrolling');
  assert.deepEqual(x(editor, 'a'), [11, 10]);
  press('ArrowDown', { shiftKey: true });
  assert.deepEqual(x(editor, 'a'), [11, 10 + NUDGE_SHIFT], 'Shift moves 10');
  press('ArrowLeft');
  press('ArrowUp');
  assert.deepEqual(x(editor, 'a'), [10, 19]);
  assert.equal(editor.history.get().undoLabel, 'Nudge');

  const e = press('a', { metaKey: true });
  assert.ok(e.prevented);
  assert.deepEqual([...editor.selection.get()].sort(), [id('a'), id('b')].sort(), '⌘A selects all');
  editor.selectMore.set(true);
  press('Escape');
  assert.deepEqual([...editor.selection.get()], [], 'Escape clears the selection');
  assert.equal(editor.selectMore.get(), false, 'and turns Select more off');
  press('A', { ctrlKey: true });
  assert.equal(editor.selection.get().size, 2, 'Ctrl-A too');

  editor.select([id('b')]);
  assert.ok(press('Backspace').prevented);
  assert.equal(editor.source().includes('id="b"'), false, 'Backspace deletes');
  assert.equal(editor.history.get().undoLabel, 'Delete');
  editor.select([id('a')]);
  press('Delete');
  assert.equal(editor.source().includes('id="a"'), false, 'Delete deletes');
  editor.undo();
  editor.undo();
  assert.equal(editor.source().includes('id="a"') && editor.source().includes('id="b"'), true);
});

test('no key acts in a field, in the code view, under a sheet, or once another handler took it; Delete and the arrows need a selection', () => {
  const { editor, id, press, modal } = setup();
  const before = editor.source();
  editor.select([id('a')]);
  const places: [string, EventTarget][] = [
    ['an input', inside('input')],
    ['a textarea', inside('textarea')],
    ['a select', inside('select')],
    ['contenteditable', { isContentEditable: true, closest: () => null } as unknown as EventTarget],
    ['the code view', inside('.draw-code')],
  ];
  for (const [where, target] of places) {
    for (const k of ['ArrowRight', 'Delete', 'Backspace']) assert.equal(press(k, { target }).prevented, false, `${k} in ${where}`);
    press('a', { metaKey: true, target });
    press('Escape', { target });
    assert.deepEqual([...editor.selection.get()], [id('a')], `the selection in ${where}`);
  }
  for (const k of ['ArrowRight', 'Delete']) press(k, { defaultPrevented: true });
  press('Escape', { defaultPrevented: true });
  assert.deepEqual([...editor.selection.get()], [id('a')], 'a key another handler took');
  modal.open = true;
  for (const k of ['ArrowRight', 'Delete', 'Escape']) assert.equal(press(k).prevented, false, `${k} under a sheet`);
  press('a', { metaKey: true });
  assert.deepEqual([...editor.selection.get()], [id('a')], 'under a sheet');
  modal.open = false;
  for (const k of ['ArrowRight', 'Delete']) assert.equal(press(k, { altKey: true }).prevented, false, `⌥${k} is not ours`);
  editor.select([]);
  for (const k of ['ArrowRight', 'Delete', 'Backspace']) assert.equal(press(k).prevented, false, `${k} with nothing selected (the page may scroll)`);
  assert.equal(editor.source(), before, 'nothing changed');
  assert.equal(editor.history.get().canUndo, false);
});

test('a held arrow with its repeats, and a second arrow while it is held, is one nudge and one history entry; Escape cancels one', () => {
  const { editor, keys, id } = setup();
  const before = editor.source();
  editor.select([id('a'), id('b')]);
  keys.down(key('ArrowRight'));
  for (let i = 0; i < 4; i++) keys.down(key('ArrowRight')); // auto-repeat
  keys.down(key('ArrowDown')); // a second arrow, the first still held
  keys.up(key('ArrowRight'));
  assert.equal(editor.history.get().canUndo, false, 'still held: nothing recorded yet');
  keys.down(key('ArrowDown'));
  keys.up(key('ArrowDown'));
  assert.deepEqual(x(editor, 'a'), [15, 12], '5 right, 2 down, from where it was');
  assert.deepEqual(x(editor, 'b'), [45, 12], 'the whole selection');
  editor.undo();
  assert.equal(editor.source(), before, 'one undo takes the whole press-and-hold back');
  assert.equal(editor.history.get().canUndo, false, 'it was one entry');

  keys.down(key('ArrowLeft'));
  keys.down(key('ArrowLeft'));
  keys.down(key('Escape'));
  assert.equal(editor.source(), before, 'Escape cancels the nudge');
  keys.up(key('ArrowLeft'));
  assert.equal(editor.history.get().canUndo, false, 'and it records nothing');
  assert.equal(editor.selection.get().size, 2, 'the selection stays (Escape cancelled the nudge only)');

  keys.down(key('ArrowUp'));
  keys.blur(); // the window lost focus: no keyup will come
  assert.equal(editor.history.get().undoLabel, 'Nudge', 'the nudge is kept');
  assert.equal(editor.busy, false);
});
