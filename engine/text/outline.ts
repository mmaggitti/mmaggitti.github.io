// A text's outline (P1-M4 S2): what Text to path and Export's "As paths" read from a <text>, and the
// path data its glyphs make.
//
// outlineText(doc, id, ctx) reads the text as SVG lays it out (space.ts: its characters run by run,
// under xml:space; a <title> or <desc> child lays nothing out) into chunks of runs:
// - a run is one stretch of characters with one face and one size: its face the FIRST family of its
//   computed font-family (font-faces.ts computedFamilies), which must be the file's own face (a data:
//   @font-face the canvas registers), or one Draw holds (yours, the catalogue: ctx.faces), at exactly
//   its computed weight and style (no nearest match: the canvas would draw a synthetic face, which
//   Draw can't outline); its size the computed font-size in user units (a number or px; the initial
//   medium is 16);
// - a chunk starts at the text and at every element with its own x or y (each one number: user
//   units or px); an element's dx and dy (one number, or em of its own font size) shift the pen
//   before its first character (Draw's lines: each tspan's x, and dy 1.3em). An element with no
//   characters places nothing (as browsers lay text out). Each chunk has its start point and its
//   computed text-anchor (the first character's);
// - the label is the characters as laid out, a chunk's runs joined, the chunks joined by one space.
// Refused, each saying what (the reason names the attribute or property): a position list (two or
// more numbers in x, y, dx, dy or rotate) or a rotation; textLength or lengthAdjust; a textPath; a
// position or size in another unit; letter-spacing or word-spacing other than normal or 0;
// baseline-shift, dominant-baseline or alignment-baseline other than the alphabetic baseline; a
// writing-mode other than horizontal left to right; direction rtl; unicode-bidi other than normal;
// font-variant, font-feature-settings and the like; text-decoration; a family Draw holds no file for;
// a weight or style the family has no face for; runs painted differently (an element inside with its
// own fill, stroke, opacity, filter…); an element inside that a path can't hold (an <animate>, an
// <a>); a value a <style> rule may set (Draw can't read selectors yet: P2), on the text, inside it,
// or on the <path> it would become. What the face can't draw (a character outside its unicode-range,
// or with no glyph) is the shaping's to find (src/text/pipeline.ts, which has the font).
//
// outlineD(text, shaped) writes the glyphs as path data, in the text's own user units: per chunk, its
// advance w = the sum of its glyphs' xAdvance × s (s = size / unitsPerEm) and its runs' dx, the pen
// starting at x − w × 0, ½ or 1 (start, middle, end); each glyph's points (px, py) go to
// (pen + xOffset·s + px·s, y − yOffset·s − py·s) (fonts are y up, SVG y down); commands as
// `M x y`, ` L x y`, ` Q x1 y1 x y`, ` C x1 y1 x2 y2 x y`, ` Z`, numbers fmt(v, 3), glyphs joined
// by one space, a glyph with no contours (a space) writing nothing. The same input gives the same
// bytes (the golden wordmark depends on it).

import { NS, attrValue, el, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { textRuns } from './space.ts';
import { GENERIC_FAMILIES, appFontName, computedFamilies, computedStyle, computedWeight, fontFaces, type FaceRequest } from './font-faces.ts';
import { ruleWins, shownValue, styleSource } from '../style/where.ts';
import { sheetProps, sheetSets } from '../geometry/css.ts';
import { fmt } from '../values/number-format.ts';

/** Why a value a <style> rule may set refuses (M2's P2 wording). */
export const RULED = 'A <style> rule may paint it, which Draw can’t read yet (P2).';
export const ruledProp = (prop: string) => `A <style> rule may set its ${prop}, which Draw can’t read yet (P2).`;
export const NOT_HELD = (family: string) => `Draw can outline only its own fonts, yours and this file’s own; ${family} isn’t one of them.`;
export const NO_FACE = (family: string, weight: number, style: 'normal' | 'italic') => `${family} has no ${faceName(weight, style)} face: the canvas draws a synthetic one, which Draw can’t outline.`;
export const NO_GLYPH = (family: string, ch: string) => `${family} has no glyph for “${ch}”.`;
export const PAINTED = 'Its runs are painted differently; Draw outlines a text of one paint (P3 does the rest).';
export const NO_CHARACTERS = 'It has no characters to outline.';

/** A face's weight and style in words: bold, italic, 600 italic, regular. */
export function faceName(weight: number, style: 'normal' | 'italic'): string {
  const w = weight === 700 ? 'bold' : weight === 400 ? '' : String(weight);
  return [w, style === 'italic' ? 'italic' : ''].filter(Boolean).join(' ') || 'regular';
}

/** A run's face: the file's own (its index in fontFaces(doc).faces), or one Draw holds (yours, the catalogue's). */
export interface OutlineFace extends FaceRequest {
  own: number | null;
}
export interface OutlineRun {
  text: string;
  face: OutlineFace;
  size: number; // user units
  dx: number; // pen shifts before its first character (0 for a chunk's first run: the chunk's start holds them)
  dy: number;
}
export interface OutlineChunk {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  runs: OutlineRun[];
}
export interface OutlineText {
  chunks: OutlineChunk[];
  /** The characters as laid out, the chunks joined by one space (the path's aria-label). */
  label: string;
}
export interface OutlineCtx {
  /** The real faces Draw holds for a family (yours and the catalogue's), or null (Fonts.faces). */
  faces(family: string): { weights: readonly number[]; italics: readonly number[] } | null;
}

/** One glyph as the text library shapes it: its outline in font units (y up), its advance and offsets. */
export interface GlyphCommand {
  command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
  args: readonly number[];
}
export interface ShapedGlyph {
  commands: readonly GlyphCommand[];
  xAdvance: number;
  xOffset: number;
  yOffset: number;
}
export interface ShapedRun {
  unitsPerEm: number;
  glyphs: readonly ShapedGlyph[];
}

type Refused = { refused: string };

// ── values ──────────────────────────────────────────────────────────────────────────────────────

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

/** One length: a number, px, or (`em` given) em of that font size; a list or another unit refuses. */
function oneLength(name: string, raw: string, em: number | null): number | Refused {
  const items = raw.trim().split(/[\s,]+/).filter(Boolean);
  if (items.length > 1) return { refused: name === 'rotate' ? 'Its rotate turns each character, which Draw can’t outline yet.' : `Its ${name} is a list (a position for each character), which Draw can’t outline yet.` };
  const t = items[0] ?? '';
  const m = NUMBER.exec(t);
  if (!m) return { refused: `Its ${name} is ${t}, which Draw can’t outline.` };
  const n = Number(m[0]);
  const unit = t.slice(m[0].length).toLowerCase();
  if (unit === '' || unit === 'px') return n;
  if (unit === 'em' && em !== null) return n * em;
  return { refused: `Its ${name} is ${t}; Draw outlines ${em === null ? 'user units or px' : 'user units, px or em'} there.` };
}

/** The computed font-size (user units), or why not. */
function fontSize(doc: Doc, id: NodeId): number | Refused {
  const s = shownValue(doc, id, 'font-size');
  if (s.value === null) return { refused: ruledProp('font-size') };
  const v = s.value.trim().toLowerCase();
  if (v === 'medium') return 16; // the initial value, which browsers draw at 16 px
  const n = oneLength('font-size', v, null);
  if (typeof n === 'number' && !(n > 0)) return { refused: `Its font-size is ${s.value}: there is nothing to outline.` };
  return n;
}

// A property's computed value where it is inherited (the element's own, else the nearest ancestor's;
// 'rule' when a <style> rule may decide it), or its own value where it isn't.
function valueOf(doc: Doc, id: NodeId, prop: string, inherited: boolean): string | 'rule' | null {
  for (let n: NodeId | null = id; n !== null; n = el(doc, n).parent) {
    const s = styleSource(doc, n, prop);
    if (s.sheet !== 'no' && (ruleWins(s) || s.at === 'none')) return 'rule';
    if (s.value !== null && s.value.toLowerCase() !== 'inherit') return s.value;
    if (!inherited && s.value === null) return null;
  }
  return null;
}

// The text properties a path can't keep, and the values that need nothing (compared lower-case). An
// inherited one is read where each run is; a decoration also from the text's ancestors (it reaches
// the text from them); the others on the text and the elements inside it.
const ZERO = /^[+-]?0*\.?0+(?:px|em|ex|%)?$/;
type Reach = 'inherited' | 'own' | 'propagates';
const TEXT_PROPS: { prop: string; reach: Reach; ok: (v: string) => boolean }[] = [
  { prop: 'letter-spacing', reach: 'inherited', ok: (v) => v === 'normal' || ZERO.test(v) },
  { prop: 'word-spacing', reach: 'inherited', ok: (v) => v === 'normal' || ZERO.test(v) },
  { prop: 'baseline-shift', reach: 'own', ok: (v) => v === 'baseline' || ZERO.test(v) },
  { prop: 'dominant-baseline', reach: 'inherited', ok: (v) => v === 'auto' || v === 'alphabetic' },
  { prop: 'alignment-baseline', reach: 'own', ok: (v) => v === 'auto' || v === 'alphabetic' || v === 'baseline' },
  { prop: 'writing-mode', reach: 'inherited', ok: (v) => v === 'horizontal-tb' || v === 'lr' || v === 'lr-tb' },
  { prop: 'direction', reach: 'inherited', ok: (v) => v === 'ltr' },
  { prop: 'unicode-bidi', reach: 'own', ok: (v) => v === 'normal' },
  { prop: 'font-variant', reach: 'inherited', ok: (v) => v === 'normal' },
  { prop: 'font-variant-ligatures', reach: 'inherited', ok: (v) => v === 'normal' },
  { prop: 'font-variant-caps', reach: 'inherited', ok: (v) => v === 'normal' },
  { prop: 'font-variant-numeric', reach: 'inherited', ok: (v) => v === 'normal' },
  { prop: 'font-variant-position', reach: 'inherited', ok: (v) => v === 'normal' },
  { prop: 'font-feature-settings', reach: 'inherited', ok: (v) => v === 'normal' },
  { prop: 'font-variation-settings', reach: 'inherited', ok: (v) => v === 'normal' },
  { prop: 'font-kerning', reach: 'inherited', ok: (v) => v === 'auto' || v === 'normal' },
  { prop: 'font-size-adjust', reach: 'inherited', ok: (v) => v === 'none' },
  { prop: 'text-decoration', reach: 'propagates', ok: (v) => v === 'none' },
  { prop: 'text-decoration-line', reach: 'propagates', ok: (v) => v === 'none' },
];

// What an element inside the text may set only as the text does (its runs would be painted differently).
const PAINT = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'paint-order', 'opacity', 'filter', 'mask', 'clip-path', 'color', 'visibility', 'display'];

// The elements a <text> may hold: tspans lay out, and its own <title> and <desc> move into the path.
const KEEPS = new Set(['title', 'desc']);

// The tspans inside the text, or the first element a path couldn't hold (a <textPath> named as such).
function tspansOf(doc: Doc, id: NodeId): ElementNode[] | Refused {
  const out: ElementNode[] = [];
  const walk = (parent: NodeId): Refused | null => {
    for (const c of el(doc, parent).children) {
      const n = doc.nodes.get(c)!;
      if (n.kind !== 'element') continue;
      if (n.ns === NS.svg && n.local === 'textPath') return { refused: 'Its <textPath> lays it along a path, which Draw can’t outline yet.' };
      if (parent === id && n.ns === NS.svg && KEEPS.has(n.local)) continue;
      if (n.ns !== NS.svg || n.local !== 'tspan') return { refused: `Its <${n.qname}> would be lost.` };
      out.push(n);
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  return walk(id) ?? out;
}

// ── faces ───────────────────────────────────────────────────────────────────────────────────────

// An own face's weight descriptor as a range, or null.
function weightRange(desc: string): [number, number] | null {
  const t = desc.trim().toLowerCase();
  if (t === 'normal') return [400, 400];
  if (t === 'bold') return [700, 700];
  const parts = t.split(/\s+/).map(Number);
  return parts.length <= 2 && parts.every((n) => Number.isFinite(n)) ? [parts[0], parts[parts.length - 1]] : null;
}
const styleOf = (desc: string): 'normal' | 'italic' => (/^(italic|oblique)\b/i.test(desc.trim()) ? 'italic' : 'normal');

// A run's face, or why not (the module header).
function faceOf(doc: Doc, owner: NodeId, ctx: OutlineCtx): OutlineFace | Refused {
  const families = computedFamilies(doc, owner);
  const weight = computedWeight(doc, owner);
  const style = computedStyle(doc, owner);
  if (families === null) return { refused: ruledProp('font-family') };
  if (weight === null) return { refused: ruledProp('font-weight') };
  if (style === null) return { refused: ruledProp('font-style') };
  const family = families[0];
  if (family === undefined) return { refused: NOT_HELD('the browser’s default font') };
  if (GENERIC_FAMILIES.has(family.toLowerCase())) return { refused: NOT_HELD(family) };
  // The file's own faces win for their family (src/platform/fonts.ts registers them first), unless
  // the name guard keeps one off the page.
  const own = fontFaces(doc).faces.map((f, i) => ({ f, i })).filter(({ f }) => f.family.toLowerCase() === family.toLowerCase() && !appFontName(f.family));
  if (own.length) {
    const hit = own.find(({ f }) => {
      const w = weightRange(f.weight);
      return w !== null && weight >= w[0] && weight <= w[1] && styleOf(f.style) === style;
    });
    return hit ? { family: hit.f.family, weight, style, own: hit.i } : { refused: NO_FACE(family, weight, style) };
  }
  const held = ctx.faces(family);
  if (!held) return { refused: NOT_HELD(family) };
  if (!(style === 'italic' ? held.italics : held.weights).includes(weight)) return { refused: NO_FACE(family, weight, style) };
  return { family, weight, style, own: null };
}

// ── the reader ──────────────────────────────────────────────────────────────────────────────────

/** The text as chunks of runs (the module header), or why it can't be outlined. */
export function outlineText(doc: Doc, id: NodeId, ctx: OutlineCtx): OutlineText | Refused {
  const text = el(doc, id);
  if (text.ns !== NS.svg || text.local !== 'text') return { refused: 'Only a <text> turns into a path.' };
  // What a path can't hold or keep, and what a <style> rule may set on the text or on its <path>.
  const inside = tspansOf(doc, id);
  if ('refused' in inside) return inside;
  for (const n of [text, ...inside]) {
    for (const name of ['x', 'y', 'dx', 'dy']) {
      const raw = attrValue(doc, n, null, name);
      if (raw !== null && raw.trim().split(/[\s,]+/).length > 1) return { refused: `Its ${name} is a list (a position for each character), which Draw can’t outline yet.` };
    }
    for (const name of ['textLength', 'lengthAdjust']) {
      if (attrValue(doc, n, null, name) !== null) return { refused: `Its ${name} fits it to a length, which Draw can’t outline yet.` };
    }
    const rotate = attrValue(doc, n, null, 'rotate');
    if (rotate !== null) {
      const r = oneLength('rotate', rotate, null);
      if (typeof r !== 'number') return r;
      if (r !== 0) return { refused: 'Its rotate turns each character, which Draw can’t outline yet.' };
    }
  }
  for (const n of inside) {
    for (const p of PAINT) {
      const s = styleSource(doc, n.id, p);
      if (s.value !== null) return { refused: PAINTED };
      if (s.sheet !== 'no') return { refused: RULED };
    }
  }
  // A rule that reaches the text but not a <path> in its place (a `text` selector) would miss the
  // path, and one that reaches the path but not the text (`path`) would newly style it.
  for (const p of sheetProps(doc)) {
    if ((sheetSets(doc, id, p) === 'no') !== (sheetSets(doc, id, p, { local: 'path', bare: false }) === 'no')) return { refused: RULED };
  }
  // Glyphs are drawn nonzero: the path gets fill-rule="nonzero" (to-path.ts), except where a rule or
  // the text's own style="" says evenodd, which Draw doesn't rewrite.
  const rule = shownValue(doc, id, 'fill-rule').value;
  if (rule === null) return { refused: ruledProp('fill-rule') };
  if (rule.trim().toLowerCase() === 'evenodd' && styleSource(doc, id, 'fill-rule').at === 'style') return { refused: 'Its style="" sets fill-rule: evenodd, but glyphs are drawn nonzero (P2 edits the declaration).' };
  const up = ancestors(doc, id);
  for (const { prop, reach, ok } of TEXT_PROPS) {
    for (const n of reach === 'propagates' ? [text, ...inside, ...up] : [text, ...inside]) {
      const v = valueOf(doc, n.id, prop, reach === 'inherited');
      if (v === 'rule') return { refused: ruledProp(prop) };
      if (v !== null && !ok(v.trim().toLowerCase())) return { refused: `Its ${prop} is ${v.trim()}, which Draw can’t outline yet.` };
    }
  }
  const chunks: OutlineChunk[] = [];
  const placed = new Set<NodeId>();
  let pen = { x: 0, y: 0 };
  for (const run of textRuns(doc, id)) {
    if (!run.text) continue;
    // The elements from the text down to the run's, each placing its first character.
    const chain: NodeId[] = [];
    for (let n: NodeId = run.owner; ; n = el(doc, n).parent!) {
      chain.unshift(n);
      if (n === id) break;
    }
    let x: number | null = null;
    let y: number | null = null;
    let dx = 0;
    let dy = 0;
    for (const e of chain) {
      if (placed.has(e)) continue;
      placed.add(e);
      const n = el(doc, e);
      for (const name of ['x', 'y', 'dx', 'dy'] as const) {
        const raw = attrValue(doc, n, null, name);
        if (raw === null) continue;
        let em: number | null = null;
        if ((name === 'dx' || name === 'dy') && /em\s*$/i.test(raw)) {
          const size = fontSize(doc, e);
          if (typeof size !== 'number') return size;
          em = size;
        }
        const v = oneLength(name, raw, name === 'dx' || name === 'dy' ? (em ?? 0) : null);
        if (typeof v !== 'number') return v;
        if (name === 'x') x = v;
        else if (name === 'y') y = v;
        else if (name === 'dx') dx += v;
        else dy += v;
      }
    }
    const face = faceOf(doc, run.owner, ctx);
    if ('refused' in face) return face;
    const size = fontSize(doc, run.owner);
    if (typeof size !== 'number') return size;
    // A later chunk starting at y alone would start where the glyphs before it end, which only the
    // shaping knows.
    if (chunks.length && x === null && y !== null) return { refused: 'It starts a line at a new y with no x, which Draw can’t outline yet.' };
    if (!chunks.length || x !== null || y !== null) {
      const anchor = shownValue(doc, run.owner, 'text-anchor').value;
      if (anchor === null) return { refused: ruledProp('text-anchor') };
      const a = anchor.trim().toLowerCase();
      pen = { x: (x ?? pen.x) + dx, y: (y ?? pen.y) + dy };
      chunks.push({ x: pen.x, y: pen.y, anchor: a === 'middle' || a === 'end' ? a : 'start', runs: [{ text: run.text, face, size, dx: 0, dy: 0 }] });
    } else {
      pen = { x: pen.x + dx, y: pen.y + dy };
      chunks[chunks.length - 1].runs.push({ text: run.text, face, size, dx, dy });
    }
  }
  if (!chunks.length) return { refused: NO_CHARACTERS };
  return { chunks, label: chunks.map((c) => c.runs.map((r) => r.text).join('')).join(' ') };
}

function ancestors(doc: Doc, id: NodeId): ElementNode[] {
  const out: ElementNode[] = [];
  for (let n = el(doc, id).parent; n !== null; n = el(doc, n).parent) out.push(el(doc, n));
  return out;
}

// ── unicode-range ───────────────────────────────────────────────────────────────────────────────

/** Is the code point inside a unicode-range descriptor (U+41, U+0-7F, U+4??)? */
export function inUnicodeRange(range: string, cp: number): boolean {
  for (const item of range.split(',')) {
    const m = /^\s*u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?\s*$/i.exec(item);
    if (!m) continue;
    const lo = parseInt(m[1].replace(/\?/g, '0'), 16);
    const hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, 'f'), 16);
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

// ── the outline ─────────────────────────────────────────────────────────────────────────────────

/** The glyphs of `text` (shaped[chunk][run], as outlineText gave them) as path data (the module header). */
export function outlineD(text: OutlineText, shaped: readonly (readonly ShapedRun[])[]): string {
  const out: string[] = [];
  text.chunks.forEach((chunk, c) => {
    let w = 0;
    chunk.runs.forEach((run, r) => {
      const s = run.size / shaped[c][r].unitsPerEm;
      w += run.dx;
      for (const g of shaped[c][r].glyphs) w += g.xAdvance * s;
    });
    let pen = chunk.x - w * (chunk.anchor === 'middle' ? 0.5 : chunk.anchor === 'end' ? 1 : 0);
    let y = chunk.y;
    chunk.runs.forEach((run, r) => {
      const s = run.size / shaped[c][r].unitsPerEm;
      pen += run.dx;
      y += run.dy;
      for (const g of shaped[c][r].glyphs) {
        const d = glyphD(g.commands, pen + g.xOffset * s, y - g.yOffset * s, s);
        if (d) out.push(d);
        pen += g.xAdvance * s;
      }
    });
  });
  return out.join(' ');
}

// One glyph's commands, its origin at (ox, oy), scaled by s and flipped.
function glyphD(commands: readonly GlyphCommand[], ox: number, oy: number, s: number): string {
  const p = (x: number, y: number) => `${fmt(ox + x * s, 3)} ${fmt(oy - y * s, 3)}`;
  let d = '';
  for (const { command, args: a } of commands) {
    if (command === 'moveTo') d += `${d ? ' ' : ''}M ${p(a[0], a[1])}`;
    else if (command === 'lineTo') d += ` L ${p(a[0], a[1])}`;
    else if (command === 'quadraticCurveTo') d += ` Q ${p(a[0], a[1])} ${p(a[2], a[3])}`;
    else if (command === 'bezierCurveTo') d += ` C ${p(a[0], a[1])} ${p(a[2], a[3])} ${p(a[4], a[5])}`;
    else if (command === 'closePath') d += ' Z';
  }
  return d;
}
