// engine/text/outline.ts: what Text to path reads from a text (its chunks of runs, each with its face
// and size, and the label), every refusal by name, and outlineD on hand-made glyph runs: placing,
// scaling by unitsPerEm and flipping y, anchoring a line at start, middle and end, and the same
// input giving the same bytes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descendants, parseDoc, type Doc, type ElementNode } from '../../model/doc.ts';
import { NOT_HELD, NO_CHARACTERS, NO_FACE, PAINTED, RULED, faceName, inUnicodeRange, outlineD, outlineText, type GlyphCommand, type OutlineCtx, type OutlineText, type ShapedRun } from '../../text/outline.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const texts = (doc: Doc): ElementNode[] => [...descendants(doc, doc.root)].filter((n): n is ElementNode => n.kind === 'element' && n.local === 'text');
const ALL = [100, 200, 300, 400, 500, 600, 700, 800, 900];
// The faces Draw holds, as Fonts.faces gives them (a few of the catalogue's).
const HELD: Record<string, { weights: number[]; italics: number[] }> = {
  inter: { weights: ALL, italics: ALL },
  archivo: { weights: ALL, italics: ALL },
  fraunces: { weights: ALL, italics: ALL },
  'bebas neue': { weights: [400], italics: [] },
  'ibm plex mono': { weights: [100, 200, 300, 400, 500, 600, 700], italics: [100, 200, 300, 400, 500, 600, 700] },
};
const ctx: OutlineCtx = { faces: (family) => HELD[family.toLowerCase()] ?? null };
const read = (body: string, i = 0) => {
  const doc = load(svg(body));
  return outlineText(doc, texts(doc)[i].id, ctx);
};
const ok = (r: ReturnType<typeof read>): OutlineText => {
  assert.ok(!('refused' in r), 'refused' in r ? r.refused : '');
  return r as OutlineText;
};

test('outlineText: a line is one chunk at the text’s x and y with its anchor, one run with its face (the first family, at its weight and style) and size; the label is its characters', () => {
  const t = ok(read('<text x="10" y="20" font-family="Inter, sans-serif" font-size="20" font-weight="700" text-anchor="middle">Draw</text>'));
  assert.deepEqual(t, { chunks: [{ x: 10, y: 20, anchor: 'middle', runs: [{ text: 'Draw', face: { family: 'Inter', weight: 700, style: 'normal', own: null }, size: 20, dx: 0, dy: 0 }] }], label: 'Draw' });
  const px = ok(read('<g font-size="12px" font-family="Fraunces" font-style="italic"><text x="5px" y="6">a</text></g>'));
  assert.deepEqual(px.chunks[0], { x: 5, y: 6, anchor: 'start', runs: [{ text: 'a', face: { family: 'Fraunces', weight: 400, style: 'italic', own: null }, size: 12, dx: 0, dy: 0 }] }, 'inherited, in px');
  assert.equal(ok(read('<text font-family="Inter">a</text>')).chunks[0].runs[0].size, 16, 'the initial medium is 16');
});

test('outlineText: Draw’s lines are a chunk per tspan at the text’s x, each 1.3em of its size below the last; the label joins the lines with one space', () => {
  const t = ok(read('<text x="50" y="55" font-size="14" font-family="Archivo, sans-serif" font-weight="700" text-anchor="middle"><tspan x="50" dy="0em">Big</tspan><tspan x="50" dy="1.3em">Idea</tspan></text>'));
  assert.equal(t.chunks.length, 2);
  assert.deepEqual(t.chunks.map((c) => [c.x, c.y, c.anchor, c.runs.map((r) => r.text).join('')]), [[50, 55, 'middle', 'Big'], [50, 55 + 1.3 * 14, 'middle', 'Idea']]);
  assert.equal(t.label, 'Big Idea');
  const empty = ok(read('<text x="5" y="10" font-size="10" font-family="Inter"><tspan x="5" dy="0em">A</tspan><tspan x="5" dy="1.3em"></tspan><tspan x="5" dy="1.3em">C</tspan></text>'));
  assert.deepEqual(empty.chunks.map((c) => c.y), [10, 23], 'an empty line places nothing (browsers lay out no characters for it)');
});

test('outlineText: runs in two fonts and two sizes are one chunk; a tspan’s dx and dy shift the pen inside it; the file’s own data: face is its own; preserve keeps its spaces in the label', () => {
  const t = ok(read('<text x="0" y="10" font-family="Inter" font-size="10">A<tspan font-family="Fraunces" font-size="20" dx="2" dy="-1">B</tspan>C</text>'));
  assert.equal(t.chunks.length, 1);
  assert.deepEqual(t.chunks[0].runs.map((r) => [r.text, r.face.family, r.size, r.dx, r.dy]), [['A', 'Inter', 10, 0, 0], ['B', 'Fraunces', 20, 2, -1], ['C', 'Inter', 10, 0, 0]]);
  const own = ok(read('<style>@font-face{font-family:Own;src:url(data:font/woff2;base64,d09GMg==) format("woff2")}</style><text x="1" y="9" font-family="Own, serif" font-size="10">iii</text>'));
  assert.deepEqual(own.chunks[0].runs[0].face, { family: 'Own', weight: 400, style: 'normal', own: 0 });
  const kept = ok(read('<text x="1" y="9" font-family="IBM Plex Mono" font-size="10" xml:space="preserve">A&amp;V  To</text>'));
  assert.equal(kept.label, 'A&V  To');
});

// tools/edge-text-xml-space-tspans.svg's texts that can't be outlined, and why (its first two lay
// out in sans-serif, a generic family, which Draw holds no file for).
test('outlineText refuses tools/edge-text-xml-space-tspans.svg’s position-list, textPath, textLength and direction texts, naming what', () => {
  const doc = load(readFileSync(new URL('../fixtures/corpus/tools/edge-text-xml-space-tspans.svg', import.meta.url), 'utf8'));
  const all = texts(doc);
  const why = (i: number) => {
    const r = outlineText(doc, all[i].id, ctx);
    assert.ok('refused' in r, `text ${i} was outlined`);
    return r.refused;
  };
  assert.match(why(2), /^Its dx is a list/, 'the third: its tspan’s dx list');
  assert.match(why(3), /^Its x is a list/, 'the fourth: x="10 20 30 40"');
  assert.match(why(6), /^Its direction is rtl/, 'the seventh');
  assert.match(why(7), /^Its <textPath> lays it along a path/, 'the eighth');
  assert.match(why(8), /^Its textLength fits it to a length/, 'the ninth');
  assert.equal(why(0), NOT_HELD('sans-serif'), 'the first: a generic family');
});

test('outlineText refuses, each saying what: lists, rotate, units, spacing, baselines, writing-mode, bidi, font-variant, features, decoration, a family or face Draw doesn’t hold, paint inside, an element a path can’t hold, rules, no characters', () => {
  const T = (attrs: string, inner = 'Hi') => `<text x="1" y="9" font-family="Inter" font-size="10"${attrs}>${inner}</text>`;
  const cases: [string, string | RegExp][] = [
    [T('').replace('y="9"', 'y="1 2"'), /^Its y is a list/],
    [T('', '<tspan dy="1 2">Hi</tspan>'), /^Its dy is a list/],
    [T(' rotate="15"'), 'Its rotate turns each character, which Draw can’t outline yet.'],
    [T(' rotate="10 20"'), 'Its rotate turns each character, which Draw can’t outline yet.'],
    [T(' x="10%"').replace('x="1" ', ''), /^Its x is 10%; Draw outlines user units or px there\.$/],
    [T(' lengthAdjust="spacing"'), /^Its lengthAdjust fits it to a length/],
    [T(' letter-spacing="2"'), 'Its letter-spacing is 2, which Draw can’t outline yet.'],
    [T(' style="word-spacing: 1em"'), 'Its word-spacing is 1em, which Draw can’t outline yet.'],
    [T('', '<tspan baseline-shift="super">Hi</tspan>'), /^Its baseline-shift is super/],
    [T(' dominant-baseline="middle"'), /^Its dominant-baseline is middle/],
    [T('', '<tspan alignment-baseline="central">Hi</tspan>'), /^Its alignment-baseline is central/],
    [`<g writing-mode="tb">${T('')}</g>`, /^Its writing-mode is tb/],
    [T(' unicode-bidi="bidi-override"'), /^Its unicode-bidi is bidi-override/],
    [T(' font-variant="small-caps"'), /^Its font-variant is small-caps/],
    [T(` style="font-feature-settings: 'liga' 0"`), /^Its font-feature-settings is 'liga' 0/],
    [`<g text-decoration="underline">${T('')}</g>`, /^Its text-decoration is underline/],
    [T('').replace('font-size="10"', 'font-size="1.2em"'), /^Its font-size is 1\.2em; Draw outlines user units or px there\.$/],
    [T('').replace('font-family="Inter"', 'font-family="Georgia, Inter, serif"'), 'Draw can outline only its own fonts, yours and this file’s own; Georgia isn’t one of them.'],
    [T('').replace(' font-family="Inter"', ''), NOT_HELD('the browser’s default font')],
    [T(' font-weight="700"').replace('Inter', 'Bebas Neue'), 'Bebas Neue has no bold face: the canvas draws a synthetic one, which Draw can’t outline.'],
    [T(' font-style="italic"').replace('Inter', 'Bebas Neue'), NO_FACE('Bebas Neue', 400, 'italic')],
    [T(' font-weight="900"').replace('Inter', 'IBM Plex Mono'), NO_FACE('IBM Plex Mono', 900, 'normal')],
    [T('', '<tspan fill="#e76f51">Hi</tspan>'), PAINTED],
    [T('', '<tspan style="opacity:.5">Hi</tspan>'), PAINTED],
    [T('', 'Hi<animate attributeName="x" to="5" dur="1s"/>'), 'Its <animate> would be lost.'],
    [T('', '<a href="#x">Hi</a>'), 'Its <a> would be lost.'],
    [T('', '<tspan><title>Tip</title>Hi</tspan>'), 'Its <title> would be lost.'],
    [`<style>text { fill: red }</style>${T('')}`, RULED],
    [`<style>path { fill: red }</style>${T('')}`, RULED],
    [`<style>tspan { fill: red }</style>${T('', '<tspan>Hi</tspan>')}`, RULED],
    [`<style>text { font-family: Inter }</style>${T('')}`, RULED],
    [`<g fill-rule="evenodd">${T(' style="fill-rule: evenodd"')}</g>`, /^Its style="" sets fill-rule: evenodd/],
    [T('', ''), NO_CHARACTERS],
    [T('', '   '), NO_CHARACTERS],
    [T('', '<tspan x="1" dy="0em">a</tspan><tspan y="20">b</tspan>'), /^It starts a line at a new y with no x/],
  ];
  for (const [body, expect] of cases) {
    const r = read(body);
    assert.ok('refused' in r, `outlined: ${body}`);
    if (typeof expect === 'string') assert.equal(r.refused, expect, body);
    else assert.match(r.refused, expect, body);
  }
  // What doesn't refuse: a class rule that reaches the text and its path alike, zero spacing, the
  // alphabetic baseline, an explicit ltr, rotate 0, and a fill on the text itself.
  for (const body of [
    `<style>.logo { fill: red }</style>${T(' class="logo"')}`,
    T(' letter-spacing="0" word-spacing="normal" dominant-baseline="alphabetic" direction="ltr" rotate="0" fill="#264653"'),
    `<g fill-rule="evenodd">${T('')}</g>`,
  ]) {
    const r = read(body);
    assert.ok(!('refused' in r), `refused ${'refused' in r ? r.refused : ''}: ${body}`);
  }
  assert.equal(faceName(700, 'italic'), 'bold italic');
  assert.equal(faceName(400, 'normal'), 'regular');
  assert.equal(faceName(600, 'normal'), '600');
});

test('inUnicodeRange reads U+41, U+0-7F and U+4?? and lists of them', () => {
  const latin = 'U+0000-00FF,U+0131,U+0152-0153,U+2000-206F';
  assert.equal(inUnicodeRange(latin, 0x41), true);
  assert.equal(inUnicodeRange(latin, 0x151), false, 'ő');
  assert.equal(inUnicodeRange(latin, 0x2014), true);
  assert.equal(inUnicodeRange('U+4??', 0x4ff), true);
  assert.equal(inUnicodeRange('U+4??', 0x500), false);
});

// A unit square glyph (0,0)-(upem,upem) with its advance one em, and a space (no contours).
const square = (upem: number): ShapedRun['glyphs'][number] => ({
  commands: [
    { command: 'moveTo', args: [0, 0] },
    { command: 'lineTo', args: [upem, 0] },
    { command: 'lineTo', args: [upem, upem] },
    { command: 'lineTo', args: [0, upem] },
    { command: 'closePath', args: [] },
  ] satisfies GlyphCommand[],
  xAdvance: upem,
  xOffset: 0,
  yOffset: 0,
});
const space = (upem: number): ShapedRun['glyphs'][number] => ({ commands: [], xAdvance: upem / 2, xOffset: 0, yOffset: 0 });
const line = (anchor: 'start' | 'middle' | 'end', x = 5, y = 20): OutlineText => ({
  chunks: [{ x, y, anchor, runs: [{ text: 'a', face: { family: 'F', weight: 400, style: 'normal', own: null }, size: 10, dx: 0, dy: 0 }] }],
  label: 'a',
});

test('outlineD places a glyph at the pen, scales it by size ÷ unitsPerEm (1000 and 2048 alike) and flips y: a unit square at font-size 10 is 10 × 10 above the baseline', () => {
  for (const upem of [1000, 2048]) {
    assert.equal(outlineD(line('start'), [[{ unitsPerEm: upem, glyphs: [square(upem)] }]]), 'M 5 20 L 15 20 L 15 10 L 5 10 Z', `unitsPerEm ${upem}`);
  }
});

test('outlineD anchors a line at start, middle and end by its advance; a space advances and writes nothing; glyphs join with one space; offsets and curves are spelled', () => {
  const run: ShapedRun = { unitsPerEm: 1000, glyphs: [square(1000), space(1000), square(1000)] }; // advance 25 at size 10
  assert.equal(outlineD(line('start'), [[run]]), 'M 5 20 L 15 20 L 15 10 L 5 10 Z M 20 20 L 30 20 L 30 10 L 20 10 Z');
  assert.equal(outlineD(line('middle'), [[run]]), 'M -7.5 20 L 2.5 20 L 2.5 10 L -7.5 10 Z M 7.5 20 L 17.5 20 L 17.5 10 L 7.5 10 Z');
  assert.equal(outlineD(line('end'), [[run]]), 'M -20 20 L -10 20 L -10 10 L -20 10 Z M -5 20 L 5 20 L 5 10 L -5 10 Z');
  const curves: ShapedRun = {
    unitsPerEm: 1000,
    glyphs: [{ commands: [{ command: 'moveTo', args: [0, 0] }, { command: 'quadraticCurveTo', args: [500, 1000, 1000, 0] }, { command: 'bezierCurveTo', args: [1000, -500, 0, -500, 0, 0] }, { command: 'closePath', args: [] }], xAdvance: 1000, xOffset: 100, yOffset: 200 }],
  };
  assert.equal(outlineD(line('start', 0, 0), [[curves]]), 'M 1 -2 Q 6 -12 11 -2 C 11 3 1 3 1 -2 Z', 'xOffset right, yOffset up, Q and C');
  const twice = outlineD(line('middle', 1 / 3, 2 / 3), [[run]]);
  assert.equal(outlineD(line('middle', 1 / 3, 2 / 3), [[run]]), twice, 'the same input gives the same bytes');
  assert.ok(!/-0(?![.\d])/.test(outlineD(line('start', 0, 0), [[{ unitsPerEm: 1000, glyphs: [square(1000)] }]])), 'no -0');
});

test('outlineD: a chunk’s runs advance in turn with their own scale and dx/dy; each chunk anchors by its own advance', () => {
  const t: OutlineText = {
    chunks: [
      { x: 0, y: 10, anchor: 'start', runs: [
        { text: 'a', face: { family: 'F', weight: 400, style: 'normal', own: null }, size: 10, dx: 0, dy: 0 },
        { text: 'b', face: { family: 'G', weight: 400, style: 'normal', own: null }, size: 20, dx: 1, dy: -2 },
      ] },
      { x: 50, y: 30, anchor: 'end', runs: [{ text: 'c', face: { family: 'F', weight: 400, style: 'normal', own: null }, size: 10, dx: 0, dy: 0 }] },
    ],
    label: 'ab c',
  };
  const d = outlineD(t, [[{ unitsPerEm: 1000, glyphs: [square(1000)] }, { unitsPerEm: 2048, glyphs: [square(2048)] }], [{ unitsPerEm: 1000, glyphs: [square(1000)] }]]);
  assert.equal(d, 'M 0 10 L 10 10 L 10 0 L 0 0 Z M 11 8 L 31 8 L 31 -12 L 11 -12 Z M 40 30 L 50 30 L 50 20 L 40 20 Z');
});
