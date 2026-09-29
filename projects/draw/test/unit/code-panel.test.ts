// The code panel's pure parts (P0-M5): the code is the whole file in its root <svg>; the tidy view
// lays it out SVG Lab's way while changing only whitespace on screen; colour tokens carry the
// swatch the engine read; an edit flashes only the tokens it changed; the Number sheet's slider and
// hold-to-repeat; and Copy's clipboard write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc, type Doc } from '../../../../engine/model/doc.ts';
import { codeBlocks } from '../../../../engine/code/blocks.ts';
import type { NumberToken } from '../../../../engine/code/tokens.ts';
import { changedTokens, swatchOf, viewBlock } from '../../src/codeview/blocks.ts';
import { columns, MIN_COLS, tidy, tidyText } from '../../src/codeview/layout.ts';
import type { ViewBlock } from '../../src/codeview/code-view.ts';
import { sliderRange, sliderText } from '../../src/token-edit.ts';
import { HOLD_DELAY, HOLD_EVERY, Repeat } from '../../src/repeat.ts';
import { writeClipboard } from '../../src/platform/clipboard.ts';
import { BLANK } from '../../src/workspace.ts';
import { corpus, fakeEditor, FakeTimers, SAMPLE } from './fakes.ts';
import { readdirSync } from 'node:fs';

const parse = (text: string): Doc => {
  const r = parseDoc(text);
  if (!r.ok) throw new Error(r.error.message);
  return r.doc;
};
const blocksOf = (text: string): ViewBlock[] => {
  const doc = parse(text);
  const memo = new Map<number, boolean>();
  return codeBlocks(doc).map((b) => viewBlock(doc, b, memo));
};
/** What the tidy view shows for a whole file at `cols` columns. */
function tidied(text: string, cols: number): string {
  const blocks = blocksOf(text);
  const first = blocks.find((b) => b.flow !== 'hidden')?.key;
  return blocks.filter((b) => b.flow !== 'hidden').map((b) => tidyText(b, tidy(b, cols, b.key === first))).join('');
}
const WS = /^[ \t\r\n]*$/;

// ── the root wrapper ───────────────────────────────────────────────────────────────────────────

test('the code is always the whole file inside its root <svg>: xmlns, viewBox and the accessibility attributes as written, and the viewBox numbers edit the artboard', () => {
  const file = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-labelledby="t" aria-describedby="d">\n  <title id="t">A dot</title>\n  <desc id="d">One circle</desc>\n  <circle cx="12" cy="12" r="6"/>\n</svg>\n';
  const blocks = blocksOf(file);
  assert.equal(blocks.map((b) => b.text).join(''), file, 'the listing is the file, byte for byte');
  const shown = blocks.filter((b) => !WS.test(b.text));
  const root = shown[1];
  assert.equal(shown[0].text, '<?xml version="1.0"?>');
  assert.equal(root.text, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-labelledby="t" aria-describedby="d">', 'the root start tag, with every attribute as written');
  assert.equal(shown.at(-1)!.text, '</svg>', 'and the code ends with the root');
  assert.equal(root.depth, 0);
  assert.ok(shown.slice(2, -1).every((b) => b.depth >= 1), 'everything between is inside the root');
  const vb = root.tokens.filter((t) => t.kind === 'number').map((t) => root.text.slice(t.start, t.end));
  assert.deepEqual(vb, ['0', '0', '24', '24'], "the viewBox's four numbers are tokens");
  // New and every file keep their namespace: an exported or copied file opens anywhere as SVG.
  assert.match(BLANK, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]* viewBox="0 0 800 600">/);

  const ed = fakeEditor();
  ed.open(file);
  assert.equal(ed.extent(), 24, "the artboard's larger side");
  const block = codeBlocks(ed.doc!).find((b) => b.node === ed.doc!.root && b.part === 'start')!;
  const view = viewBlock(ed.doc!, block);
  const width = view.tokens.filter((t) => t.kind === 'number')[2];
  ed.scrubStart(view, width);
  ed.scrub(8);
  ed.scrubEnd(true);
  assert.equal(ed.source(), file.replace('viewBox="0 0 24 24"', 'viewBox="0 0 32 24"'), 'a scrub of the width changes only its bytes');
  assert.equal(ed.extent(), 32, 'and the artboard follows it');
});

// ── the tidy view (pretty-print) ───────────────────────────────────────────────────────────────

test('the tidy view lays a minified file out one element a line, two spaces a level; a start tag too wide for the measured columns goes one attribute a line', () => {
  const mini = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g fill="none"><rect x="1" y="1" width="2" height="2"/><path d="M0 0L10 10"/></g></svg>';
  assert.equal(
    tidied(mini, 80),
    [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
      '  <g fill="none">',
      '    <rect x="1" y="1" width="2" height="2"/>',
      '    <path d="M0 0L10 10"/>',
      '  </g>',
      '</svg>',
    ].join('\n'),
  );
  assert.equal(
    tidied(mini, 30),
    [
      '<svg',
      '  xmlns="http://www.w3.org/2000/svg"',
      '  viewBox="0 0 10 10">',
      '  <g fill="none">',
      '    <rect',
      '      x="1"',
      '      y="1"',
      '      width="2"',
      '      height="2"/>',
      '    <path d="M0 0L10 10"/>',
      '  </g>',
      '</svg>',
    ].join('\n'),
    'narrower: the tags that no longer fit go one attribute a line; the rest stay on one',
  );
});

test("the tidy view: a value's own line breaks line up under it, a long single attribute wraps under itself, and text, comments and inline children stay compact", () => {
  const file = '<svg xmlns="http://www.w3.org/2000/svg">\n  <!-- a  comment -->\n    <path   d="M0 0\n      L10 10\n  Z"   fill="red" />\n<text x="1">Hello <tspan font-weight="700">world</tspan></text>\n<style>\n  .a { fill: red }\n</style>\n</svg>\n';
  assert.equal(
    tidied(file, 60),
    [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <!-- a  comment -->',
      '  <path',
      '    d="M0 0',
      '       L10 10',
      '       Z"',
      '    fill="red"/>',
      '  <text x="1">Hello <tspan font-weight="700">world</tspan></text>',
      '  <style>',
      '  .a { fill: red }',
      '</style>',
      '</svg>',
    ].join('\n'),
  );
  const long = blocksOf(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${'M0 0L1 1'.repeat(20)}"/></svg>`);
  const path = long.find((b) => b.text.startsWith('<path'))!;
  const t = tidy(path, 40, false);
  assert.deepEqual(t.wraps, [{ at: 6, end: path.text.length, indent: 2 + 6 }], 'one long attribute stays on the line, wrapped under its own start (with the tag\'s close)');
  assert.equal(tidyText(path, t), `\n  ${path.text}`);
});

test("the tidy view keeps a tag's close with its last attribute: the last wrap holds the \"/>\" or \">\", however the value wraps", () => {
  const d = 'M0 0L1 1'.repeat(20);
  for (const [text, cols] of [
    [`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`, 40], // one attribute, on the tag's line
    [`<svg xmlns="http://www.w3.org/2000/svg"><path fill="none" stroke="#264653" d="${d}"   /></svg>`, 40], // one a line
    [`<svg xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#264653" transform="translate(10 10) rotate(45)"><path d="${d}"/></g></svg>`, 30],
  ] as const) {
    for (const b of blocksOf(text).filter((x) => x.part === 'start')) {
      const t = tidy(b, cols, false);
      if (!t.wraps.length) continue;
      assert.equal(t.wraps.at(-1)!.end, b.text.length, `${b.text.slice(0, 30)}…: the close is outside the last wrap`);
      for (const w of t.wraps.slice(0, -1)) assert.ok(w.end < b.text.length);
    }
  }
});

test('the tidy view takes line breaks out of a tag\'s own syntax (around "=", before an end tag\'s ">"), so each attribute reads as one piece', () => {
  assert.equal(
    tidied(corpus('tools/edge-whitespace-in-tags.svg'), 48),
    [
      '<svg',
      '  xmlns = "http://www.w3.org/2000/svg"',
      '  viewBox="0 0 40 40">',
      '  <rect x = "1"/>',
      '  <rect',
      '    x="2"',
      "    y = '3'",
      '    width  =  "10"',
      '    height="10"',
      '    fill="#264653"/>',
      '  <circle',
      '    cx= "20"',
      '    cy ="20"',
      '    r= "4"></circle >',
      '  <g id="group">',
      '    <path d="M0 0L10 10"/>',
      '  </g>',
      '  <line',
      '    x1="0"',
      '    y1="39"',
      '    x2="39"',
      '    y2="39"',
      '    stroke="black"/>',
      '</svg>',
    ].join('\n'),
  );
});

test('the tidy view swaps only whitespace, never inside a token, over the whole corpus: every other character stays where the file has it', () => {
  const files: string[] = [SAMPLE];
  const all = readdirSync(new URL('../../../../engine/test/fixtures/corpus/', import.meta.url), { recursive: true }).map(String).filter((f) => f.endsWith('.svg'));
  for (const f of all) files.push(corpus(f));
  assert.ok(files.length > 260, `test setup: only ${files.length - 1} corpus files`);
  let swaps = 0;
  for (const file of files) {
    for (const cols of [MIN_COLS, 50, 120]) {
      const blocks = blocksOf(file);
      for (const b of blocks) {
        if (b.flow === 'hidden') {
          assert.match(b.text, WS, 'only whitespace between elements is hidden');
          continue;
        }
        const t = tidy(b, cols, false);
        for (const s of t.swaps) {
          swaps++;
          assert.match(b.text.slice(s.at, s.end), WS, `a swap replaces whitespace only: ${JSON.stringify(b.text.slice(s.at, s.end))}`);
          assert.match(s.text, WS);
          assert.ok(!b.tokens.some((k) => k.start < s.end && s.at < k.end), 'never inside a token');
        }
        for (const w of t.wraps) assert.ok(b.tokens.every((k) => k.end <= w.at || k.start >= w.end || (k.start >= w.at && k.end <= w.end)), 'a wrap holds whole tokens');
        assert.equal(tidyText(b, t).replace(/\s+/g, ''), b.text.replace(/\s+/g, ''), 'the rest of the block is its own text');
      }
    }
  }
  assert.ok(swaps > 500, `test setup: only ${swaps} swaps over the corpus`);
});

test('the width is measured in columns of code, SVG Lab-style, so a wider panel fits more on a line', () => {
  assert.equal(columns(400, 8), 48);
  assert.equal(columns(800, 8), 98);
  assert.equal(columns(100, 8), MIN_COLS, 'never narrower than its floor');
  assert.equal(columns(0, 8), 40, 'hidden: a default');
  const mini = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="20" height="20" rx="4"/></svg>';
  assert.ok(tidied(mini, columns(300, 8)).includes('\n    x="1"'), 'narrow: one attribute a line');
  assert.ok(tidied(mini, columns(900, 8)).includes('<rect x="1" y="1"'), 'wide: one line');
});

// ── colour tokens ──────────────────────────────────────────────────────────────────────────────

test('a colour token carries the swatch the engine read, never its text: the colour as hex, none struck through, currentColor and context paints marked', () => {
  const blocks = blocksOf('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#FFD166" stroke="none" color="tomato" stop-color="rgb(0 0 255 / 50%)"/><path fill="currentColor" stroke="context-stroke"/></svg>');
  const swatches = blocks.flatMap((b) => b.tokens.filter((t) => t.kind === 'color').map((t) => [b.text.slice(t.start, t.end), t.swatch]));
  assert.deepEqual(swatches, [['#FFD166', '#ffd166'], ['none', 'none'], ['tomato', '#ff6347'], ['rgb(0 0 255 / 50%)', '#0000ff80'], ['currentColor', 'current'], ['context-stroke', 'context']]);
  assert.ok(blocks.every((b) => b.tokens.every((t) => (t.kind === 'color') === (t.swatch !== undefined))), 'only colours have swatches');
  const hostile = blocksOf('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red;background:url(x)"/></svg>');
  assert.equal(hostile.flatMap((b) => b.tokens).filter((t) => t.kind === 'color').length, 0, 'text that is not a colour gets no token, so no swatch');
  assert.equal(swatchOf({ kind: 'color', color: null, keywords: ['none'], text: 'NONE', start: 0, end: 4, prop: 'fill' }), 'none');
});

// ── the live code's flash ──────────────────────────────────────────────────────────────────────

test('an edit flashes only the tokens it changed; a block whose shape changed flashes whole', () => {
  const [a] = blocksOf('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" fill="red"/>');
  const [b] = blocksOf('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 10" fill="blue"/>');
  assert.deepEqual(changedTokens(a, b), [2, 4], 'the viewBox width and the fill');
  assert.deepEqual(changedTokens(a, a), [], 'nothing changed');
  const [c] = blocksOf('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" fill="red" opacity="1"/>');
  assert.equal(changedTokens(a, c), null, 'a token more: the block is new');
  const [d] = blocksOf('<svg xmlns="http://www.w3.org/2000/svg"  viewBox="0 0 10 10" fill="red"/>');
  assert.equal(changedTokens(a, d), null, 'text between the tokens changed: the block is new');
});

// ── the Number sheet ───────────────────────────────────────────────────────────────────────────

const num = (value: number, extra: Partial<NumberToken> = {}): NumberToken => ({ kind: 'number', value, decimals: 0, text: String(value), start: 0, end: 1, prop: 'x', ...extra });

test("the Number sheet's slider: the token's own range where it has one, else -1× to 2× the artboard (SVG Lab's -100 to 200), always reaching the value, one step at a time", () => {
  assert.deepEqual(sliderRange(num(40), 100), { min: -100, max: 200, step: 1 }, "SVG Lab's range on its 100-unit canvas");
  assert.deepEqual(sliderRange(num(212), 320), { min: -320, max: 640, step: 1 }, 'scaled to the artboard');
  assert.deepEqual(sliderRange(num(0.5, { min: 0, max: 1, step: 0.01, decimals: 1 }), 320), { min: 0, max: 1, step: 0.01 }, 'opacity: its own range and step');
  assert.deepEqual(sliderRange(num(42, { min: 0 }), 320), { min: 0, max: 640, step: 1 }, 'a radius never goes below 0');
  assert.deepEqual(sliderRange(num(50, { unit: '%' }), 800), { min: -100, max: 200, step: 1 }, 'a percentage keeps -100 to 200');
  assert.deepEqual(sliderRange(num(5000), 320), { min: -320, max: 5000, step: 1 }, 'a value outside still fits');
  assert.equal(sliderRange(num(1.25, { decimals: 2 }), 10).step, 0.01, 'a step of its last written place');
  assert.equal(sliderText(num(0.5, { min: 0, max: 1, step: 0.01, decimals: 1 }), 0.30000000000000004), '0.3', 'a slider position is written at the token precision');
  assert.equal(sliderText(num(42, { min: 0 }), -3), '0', 'and within its range');
});

test('hold to repeat: a press steps at once, then again every 70 ms once 400 ms have passed, until it is let go', () => {
  const timers = new FakeTimers();
  const r = new Repeat(timers);
  let n = 0;
  r.start(() => n++);
  assert.equal(n, 1, 'at once');
  timers.tick(HOLD_DELAY);
  assert.equal(n, 1, 'nothing more before the delay and one interval');
  timers.tick(HOLD_EVERY);
  assert.equal(n, 2);
  for (let i = 0; i < 5; i++) timers.tick(HOLD_EVERY);
  assert.equal(n, 7, 'every 70 ms');
  r.stop();
  timers.tick(1000);
  assert.equal(n, 7, 'let go: it stops');
  assert.equal(timers.pending, 0);
  r.start(() => n++);
  timers.tick(100);
  r.start(() => (n += 10));
  timers.tick(HOLD_DELAY);
  timers.tick(HOLD_EVERY);
  assert.equal(n, 8 + 10 + 10, 'a new press replaces the old one');
  r.stop();
});

// ── Copy ───────────────────────────────────────────────────────────────────────────────────────

test("Copy writes the clipboard (never reads it): true when the text is there, false where the clipboard is missing, the page isn't secure, or the write is refused", async () => {
  const written: string[] = [];
  assert.equal(await writeClipboard('<svg/>', { clipboard: { writeText: async (t) => void written.push(t) } }, true), true);
  assert.deepEqual(written, ['<svg/>']);
  assert.equal(await writeClipboard('x', {}, true), false, 'no clipboard');
  assert.equal(await writeClipboard('x', undefined, true), false, 'no navigator');
  assert.equal(await writeClipboard('x', { clipboard: { writeText: async () => void written.push('insecure') } }, false), false, 'not a secure context');
  assert.equal(await writeClipboard('x', { clipboard: { writeText: () => Promise.reject(new DOMException('no', 'NotAllowedError')) } }, true), false, 'refused (no user activation)');
  assert.deepEqual(written, ['<svg/>']);
});
