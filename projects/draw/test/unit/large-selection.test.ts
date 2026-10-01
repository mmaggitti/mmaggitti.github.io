// A command over a large selection costs time in proportion to it (the P1-M1 review, F5): a drag, a
// held arrow, Align, Duplicate, Delete and Group over 4,000 selected shapes, against 1,000, in node
// with the fake views (fakes.ts); Union (P1-M3); and Text to path, Set font and Inspect's Text section
// (P1-M4). Its own file, so the deliberate breaks that run editor.test.ts don't wait for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../../src/editor.ts';
import { loopsD } from '../../../../engine/path/loops.ts';
import type { Libraries } from '../../src/paths/pipeline.ts';
import { bind, fakeEditor, fakePorts } from './fakes.ts';
import type { TextLib } from '../../src/text/load.ts';
import { descendants } from '../../../../engine/model/doc.ts';
import type { Fonts } from '../../src/platform/fonts.ts';
import { linear, linearAsync } from '../../../../engine/test/timing.ts';

/** An editor on `n` rects in a grid, every one selected (with these boolean libraries, when given). */
function manySelected(n: number, booleans?: Libraries): Editor {
  const side = Math.ceil(Math.sqrt(n));
  const cell = 100 / side;
  const at = (v: number) => (v * cell).toFixed(2);
  const rects = Array.from({ length: n }, (_, i) => `  <rect id="r${i}" x="${at(i % side)}" y="${at(Math.floor(i / side))}" width="${at(0.6)}" height="${at(0.6)}"/>`).join('\n');
  const ports = fakePorts();
  ports.booleans = booleans;
  const e = booleans ? bind(ports, new Editor(ports)) : fakeEditor();
  assert.ok(e.open(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n${rects}\n</svg>`).ok);
  e.selectAll();
  assert.equal(e.selection.get().size, n, 'test setup: Select all took every rect');
  return e;
}

// Each command, what it records, how far its cost over 4,000 shapes may grow against 1,000, and a
// limit over 4,000 (ms) where one separates it from the quadratic code by 5× or more. Measured in
// node: linear costs 3.8× to 4.2× (Duplicate 5.5× and Delete 5.1×: their inserts and removals shift
// arrays and allocate, so they get 8×); the quadratic code cost 7.7× (Group) to about 16×, and over
// 4,000 shapes a drag took about 30 s, Align about 280 s, Duplicate minutes and Delete 570 ms.
const LARGE: [string, string, (e: Editor) => void, number, number | null][] = [
  ['a drag of them all', 'Move', (e) => {
    const { box, viewport, M } = e.rootBox;
    const k = box!.width / viewport.width;
    const at = { x: box!.left + k * M[4], y: box!.top + k * M[5] };
    e.pointerDown(at, [[...e.selection.get()][0]], { add: false });
    for (let i = 1; i <= 4; i++) e.pointerDrag({ x: at.x + 10 * i, y: at.y + 3 * i });
    e.pointerUp({ x: at.x + 40, y: at.y + 12 });
  }, 6, 5000],
  ['a held arrow', 'Nudge', (e) => {
    for (let i = 0; i < 3; i++) e.nudge(1, 0);
    e.nudgeEnd();
  }, 6, 4000],
  ['Align left', 'Align left', (e) => e.align('left'), 6, 5000],
  ['Duplicate', 'Duplicate', (e) => e.duplicate(), 8, 10000],
  ['Delete', 'Delete', (e) => e.delete(), 8, 100],
  ['Group', 'Group', (e) => e.group(), 6, null],
];

test('a command over a large selection takes linear time: a drag, a held arrow, Align, Duplicate, Delete and Group over 4,000 shapes cost about 4× what they cost over 1,000 (under 6×, or 8× for Duplicate and Delete)', () => {
  const cost = (n: number, label: string, act: (e: Editor) => void): number => {
    const e = manySelected(n);
    const t = performance.now();
    act(e);
    const ms = performance.now() - t;
    assert.equal(e.history.get().undoLabel, label, `test setup: ${label} did something over ${n} shapes (${e.notice.get()})`);
    return ms;
  };
  for (const [, label, act] of LARGE) cost(200, label, act); // warm the engine up
  for (const [what, label, act, most, limit] of LARGE) {
    let small = cost(1000, label, act);
    let big = cost(4000, label, act);
    // A pause of the runner's can land in one run: a miss is measured twice more, and the fastest run of each size counts.
    for (let again = 0; again < 2 && (big >= most * small || (limit !== null && big >= limit)); again++) {
      small = Math.min(small, cost(1000, label, act));
      big = Math.min(big, cost(4000, label, act));
    }
    assert.ok(big < most * small, `${what}: ${small.toFixed(0)} ms over 1,000 shapes, ${big.toFixed(0)} ms over 4,000 (×${(big / small).toFixed(1)}; linear is ×4, the most ×${most})`);
    if (limit !== null) assert.ok(big < limit, `${what}: ${big.toFixed(0)} ms over 4,000 shapes (the limit is ${limit})`);
  }
});

// Union (P1-M3 S3) over the same grids: each operand read once (its outline, its measurement, its
// fill-rule), scored, oriented and written once. The libraries are a stand-in that answers at once
// (the union of disjoint squares is the squares), so what is timed is Draw's own work. Measured in
// node: about 110 and 450 ms.
test('Union over a large selection takes linear time: over 4,000 shapes it costs under 6× what it costs over 1,000', async () => {
  const quick: Libraries = {
    primary: async () => (inputs) => inputs.map((i) => loopsD(i.loops)).join(' '),
    fallback: () => Promise.reject(new Error('the stand-in never fails')),
  };
  const cost = async (n: number): Promise<number> => {
    const e = manySelected(n, quick);
    const t = performance.now();
    await e.combine('union');
    const ms = performance.now() - t;
    assert.equal(e.history.get().undoLabel, 'Union', `test setup: Union did something over ${n} shapes (${e.notice.get()})`);
    return ms;
  };
  await cost(200); // warm the engine up
  let small = await cost(1000);
  let big = await cost(4000);
  // A pause of the runner's can land in one run: a miss is measured twice more, and the fastest run of each size counts.
  for (let again = 0; again < 2 && big >= 6 * small; again++) {
    small = Math.min(small, await cost(1000));
    big = Math.min(big, await cost(4000));
  }
  assert.ok(big < 6 * small, `Union: ${small.toFixed(0)} ms over 1,000 shapes, ${big.toFixed(0)} ms over 4,000 (×${(big / small).toFixed(1)}; linear is ×4, the most ×6)`);
});

// Text to path (P1-M4 S2) over the same grids, of short texts: each text read once (outlineText), its
// face shaped once for all of them by a stand-in library (a square per character, at once), and the
// paths written with one fragment parse per parent (engine/text/to-path.ts); then one undo, and every
// text selected again. Then Set font over the selected texts (one entry, then its undo), and what
// Inspect's Text section reads over them (its rows, the family and its faces). What is timed is
// Draw's own work, through engine/test/timing.ts.
const square = { commands: [{ command: 'moveTo', args: [0, 0] }, { command: 'lineTo', args: [500, 0] }, { command: 'lineTo', args: [500, 500] }, { command: 'closePath', args: [] }] as const, xAdvance: 600, xOffset: 0, yOffset: 0 };
const squares: TextLib = {
  openFont: () => {
    throw new Error('not here');
  },
  shape: (_bytes, runs) => ({ unitsPerEm: 1000, runs: runs.map((t) => ({ glyphs: [...t].map(() => ({ ...square, commands: [...square.commands] })), missing: [] })) }),
};
const interOnly: Fonts = {
  use: () => {},
  documentFaces: () => {},
  bytes: async () => new Uint8Array(1),
  holds: (f) => f === 'Inter',
  faces: (f) => (f === 'Inter' ? { weights: [400], italics: [] } : null),
  mine: () => [],
  add: async () => {
    throw new Error('not here');
  },
  remove: async () => {},
  subscribe: () => () => {},
};
/** An editor on `n` short texts in a grid, every one selected, and how to select them again. */
function manyTexts(n: number): { e: Editor; reselect: () => void } {
  const side = Math.ceil(Math.sqrt(n));
  const texts = Array.from({ length: n }, (_, i) => `  <text id="t${i}" x="${((i % side) * 100 / side).toFixed(2)}" y="${(Math.floor(i / side) * 100 / side).toFixed(2)}" font-family="Inter" font-size="1">ab</text>`).join('\n');
  const ports = fakePorts();
  ports.fonts = interOnly;
  ports.text = async () => squares;
  const e = bind(ports, new Editor(ports));
  assert.ok(e.open(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n${texts}\n</svg>`).ok);
  const reselect = () => e.select([...descendants(e.doc!, e.doc!.root)].filter((m) => m.kind === 'element' && m.local === 'text').map((m) => m.id));
  reselect();
  assert.equal(e.selection.get().size, n, 'test setup: every text selected');
  return { e, reselect };
}

// Measured in node: Text to path and its undo about 160 to 220 and 520 to 700 ms over 1,000 and 4,000
// texts; Set font and its undo 40 and 130 to 200 ms; four reads of Inspect's Text section 20 and 80 to
// 130 ms. The limits leave four times that or more.
test('Text to path over a large selection takes linear time: over 4,000 short texts it (and its undo) costs under 6× what it costs over 1,000, and under 3 s', async () => {
  const run = (n: number) => {
    const { e, reselect } = manyTexts(n);
    return async () => {
      await e.textToPath();
      assert.equal(e.history.get().undoLabel, 'Text to path', `test setup: Text to path did something over ${n} texts (${e.notice.get()})`);
      e.undo();
      reselect();
    };
  };
  await linearAsync('Text to path, then its undo, over 1,000 and 4,000 texts', run(1000), run(4000), { limit: 3000 });
});

test('Set font and Inspect’s Text section over a large selection take linear time: over 4,000 texts each costs under 6× what it costs over 1,000', () => {
  const small = manyTexts(1000).e;
  const big = manyTexts(4000).e;
  const setFont = (e: Editor) => () => {
    e.setFont('Inter');
    assert.equal(e.history.get().undoLabel, 'Set font', `test setup: Set font did something (${e.notice.get()})`);
    e.undo();
  };
  linear('Set font, then its undo, over 1,000 and 4,000 texts', setFont(small), setFont(big), { limit: 1500 });
  const inspect = (e: Editor) => () => {
    for (const prop of ['font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor']) assert.ok(e.styleRow(prop), prop);
    const fam = e.textFamily();
    assert.equal(fam?.family, 'Inter');
    assert.ok(e.familyFaces('Inter'));
    e.canEditText();
  };
  linear('Inspect’s Text section, over 1,000 and 4,000 texts', inspect(small), inspect(big), { limit: 1000, reps: 4 });
});
