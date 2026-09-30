// Typed tokens for Draw's code panel: every number, colour, keyword, reference and text run in the
// document's source, located by its span in the RAW text it lives in (an attribute's raw value, or
// a text or CDATA leaf's raw text). An edit rewrites exactly those characters (edit.ts).
//
// - Values are read the way a browser reads them: entity and character references are expanded
//   first, then the attribute's own grammar applies (path data, number lists, transform lists,
//   paint, CSS declarations…). Each token is then mapped back to raw offsets.
// - A token never straddles a reference. A number or colour written partly or wholly as a reference
//   gets no token, and text runs split around references, so an edit can't cut one in half.
// - Only values that parse get tokens. What Draw doesn't read (calc(), inherit, a malformed item) is
//   left as plain text, never guessed at.
// - Keyword option lists live in one table, ENUMS.

import { NS, el, findAttr, attrValue, type Doc, type ElementNode, type LeafNode, type NodeId } from '../model/doc.ts';
import { decode, newBudget } from '../xml/entities.ts';
import { NAME_PATTERN } from '../xml/lex.ts';
import { parseColor, parsePaint, type Color } from '../values/color.ts';
import { decodeFragment } from '../values/url.ts';
import { argSpans, isFlag, parsePath } from '../path/parse.ts';

export type TokenKind = 'number' | 'color' | 'enum' | 'text' | 'ref';

interface Span {
  start: number; // offset in the raw text
  end: number;
  text: string; // raw.slice(start, end)
  prop: string; // the attribute or CSS property the token belongs to ('fill', 'd', 'text'…)
}

export interface NumberToken extends Span {
  kind: 'number';
  value: number;
  decimals: number; // places as written ('1.50' → 2, '1.5e-3' → 4)
  unit?: string; // as written, after the token: 'px', '%', 'deg', 's'…
  min?: number;
  max?: number;
  step?: number; // only where the property has a natural step (opacity 0.01)
}

export interface ColorToken extends Span {
  kind: 'color';
  color: Color | null; // null when the text is one of `keywords` (a paint's 'none')
  keywords: readonly string[]; // the non-colour values this slot takes too
}

export interface EnumToken extends Span {
  kind: 'enum';
  options: readonly string[];
}

export interface RefToken extends Span {
  kind: 'ref';
  id: string; // the id pointed at, percent-decoded as browsers match it
}

export interface TextToken extends Span {
  kind: 'text';
}

export type Token = NumberToken | ColorToken | EnumToken | RefToken | TextToken;

/** Which attribute of an element (by namespace URI and local name). */
export interface AttrRef {
  ns: string | null;
  local: string;
}

// ── option tables ────────────────────────────────────────────────────────────────────────────────

const ALIGN = ['none', 'xMinYMin', 'xMidYMin', 'xMaxYMin', 'xMinYMid', 'xMidYMid', 'xMaxYMid', 'xMinYMax', 'xMidYMax', 'xMaxYMax'];
const UNITS = ['userSpaceOnUse', 'objectBoundingBox'];
const BLEND = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
const ANIMATION = ['animate', 'animateColor', 'animateMotion', 'animateTransform', 'set'];
const RENDERING = ['auto', 'optimizeSpeed'];

/** paint-order: normal, or one to three of fill/stroke/markers in any order. */
function paintOrders(): string[] {
  const k = ['fill', 'stroke', 'markers'];
  const out = ['normal', ...k];
  for (const a of k) for (const b of k) if (a !== b) out.push(`${a} ${b}`);
  for (const a of k) for (const b of k) for (const c of k) if (a !== b && b !== c && a !== c) out.push(`${a} ${b} ${c}`);
  return out;
}

/**
 * Every keyword a token can cycle through. Keys are:
 * - a presentation attribute or CSS property ('stroke-linecap'), or an attribute ('spreadMethod');
 * - 'element/attribute' where the options depend on the element ('feComposite/operator');
 * - 'attribute.part' for one part of a value ('preserveAspectRatio.align', 'd.arcFlag').
 * A value that isn't exactly one of its options gets no token.
 */
export const ENUMS: Readonly<Record<string, readonly string[]>> = {
  'stroke-linecap': ['butt', 'round', 'square'],
  'stroke-linejoin': ['miter', 'round', 'bevel', 'miter-clip', 'arcs'],
  'fill-rule': ['nonzero', 'evenodd'],
  'clip-rule': ['nonzero', 'evenodd'],
  'text-anchor': ['start', 'middle', 'end'],
  'dominant-baseline': ['auto', 'text-bottom', 'alphabetic', 'ideographic', 'middle', 'central', 'mathematical', 'hanging', 'text-top'],
  'alignment-baseline': ['auto', 'baseline', 'before-edge', 'text-before-edge', 'middle', 'central', 'after-edge', 'text-after-edge', 'ideographic', 'alphabetic', 'hanging', 'mathematical', 'top', 'center', 'bottom'],
  'font-weight': ['normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
  'font-style': ['normal', 'italic', 'oblique'],
  'text-decoration': ['none', 'underline', 'overline', 'line-through'],
  visibility: ['visible', 'hidden', 'collapse'],
  display: ['inline', 'block', 'none', 'inline-block', 'flex', 'grid', 'contents'],
  overflow: ['visible', 'hidden', 'scroll', 'auto', 'clip'],
  'paint-order': paintOrders(),
  'pointer-events': ['auto', 'bounding-box', 'visiblePainted', 'visibleFill', 'visibleStroke', 'visible', 'painted', 'fill', 'stroke', 'all', 'none'],
  'vector-effect': ['none', 'non-scaling-stroke', 'non-scaling-size', 'non-rotation', 'fixed-position'],
  'shape-rendering': [...RENDERING, 'crispEdges', 'geometricPrecision'],
  'text-rendering': [...RENDERING, 'optimizeLegibility', 'geometricPrecision'],
  'image-rendering': [...RENDERING, 'optimizeQuality', 'pixelated', 'crisp-edges', 'smooth', 'high-quality'],
  'color-interpolation': ['auto', 'sRGB', 'linearRGB'],
  'color-interpolation-filters': ['auto', 'sRGB', 'linearRGB'],
  'mix-blend-mode': BLEND,
  isolation: ['auto', 'isolate'],
  'mask-type': ['luminance', 'alpha'],
  direction: ['ltr', 'rtl'],
  'unicode-bidi': ['normal', 'embed', 'isolate', 'bidi-override', 'isolate-override', 'plaintext'],
  'writing-mode': ['horizontal-tb', 'vertical-rl', 'vertical-lr', 'lr', 'lr-tb', 'rl', 'rl-tb', 'tb', 'tb-rl'],
  spreadMethod: ['pad', 'reflect', 'repeat'],
  gradientUnits: UNITS,
  patternUnits: UNITS,
  patternContentUnits: UNITS,
  clipPathUnits: UNITS,
  maskUnits: UNITS,
  maskContentUnits: UNITS,
  filterUnits: UNITS,
  primitiveUnits: UNITS,
  markerUnits: ['strokeWidth', 'userSpaceOnUse'],
  lengthAdjust: ['spacing', 'spacingAndGlyphs'],
  edgeMode: ['duplicate', 'wrap', 'none'],
  stitchTiles: ['stitch', 'noStitch'],
  xChannelSelector: ['R', 'G', 'B', 'A'],
  yChannelSelector: ['R', 'G', 'B', 'A'],
  calcMode: ['discrete', 'linear', 'paced', 'spline'],
  additive: ['replace', 'sum'],
  accumulate: ['none', 'sum'],
  restart: ['always', 'whenNotActive', 'never'],
  attributeType: ['CSS', 'XML', 'auto'],
  target: ['_self', '_parent', '_top', '_blank'],
  'xml:space': ['default', 'preserve'],
  'feComposite/operator': ['over', 'in', 'out', 'atop', 'xor', 'lighter', 'arithmetic'],
  'feMorphology/operator': ['erode', 'dilate'],
  'feColorMatrix/type': ['matrix', 'saturate', 'hueRotate', 'luminanceToAlpha'],
  'feTurbulence/type': ['fractalNoise', 'turbulence'],
  'animateTransform/type': ['translate', 'scale', 'rotate', 'skewX', 'skewY'],
  ...Object.fromEntries(['feFuncR', 'feFuncG', 'feFuncB', 'feFuncA'].map((e) => [`${e}/type`, ['identity', 'table', 'discrete', 'linear', 'gamma']])),
  'feBlend/mode': BLEND,
  ...Object.fromEntries(ANIMATION.map((e) => [`${e}/fill`, ['freeze', 'remove']])),
  'textPath/method': ['align', 'stretch'],
  'textPath/spacing': ['auto', 'exact'],
  'textPath/side': ['left', 'right'],
  'animateMotion/rotate': ['auto', 'auto-reverse'], // or an angle
  'marker/orient': ['auto', 'auto-start-reverse'], // or an angle
  'preserveAspectRatio.align': ALIGN,
  'preserveAspectRatio.meetOrSlice': ['meet', 'slice'],
  'd.arcFlag': ['0', '1'],
};

const OPTIONS: ReadonlyMap<string, readonly string[]> = new Map(Object.entries(ENUMS));

// ── reading a raw text the way a browser does, keeping the way back ─────────────────────────────

/**
 * The decoded text of a raw value, with each decoded character's raw offset. Characters that came
 * from a reference (or a bare '&', or a CDATA delimiter) are `bad`: no token may include them.
 * Literal characters are one raw code unit each, so a token of good characters maps back exactly.
 */
interface Src {
  raw: string;
  s: string;
  map: number[] | null; // null: s === raw
  bad: Uint8Array | null;
}

const REF = new RegExp(`&(#x[0-9a-fA-F]+|#\\d+|${NAME_PATTERN});`, 'y');

function decodedSrc(doc: Doc, raw: string, attr: boolean): Src {
  if (!raw.includes('&')) return { raw, s: raw, map: null, bad: null };
  let s = '';
  const map: number[] = [];
  const bad: number[] = [];
  let i = 0;
  while (i < raw.length) {
    const amp = raw.indexOf('&', i);
    const lit = amp === -1 ? raw.length : amp;
    s += raw.slice(i, lit);
    for (let k = i; k < lit; k++) {
      map.push(k);
      bad.push(0);
    }
    if (amp === -1) break;
    REF.lastIndex = amp;
    const m = REF.exec(raw);
    const ref = m ? m[0] : '&';
    let out = ref;
    if (m) {
      try {
        out = decode(ref, doc.entities, newBudget(), 0, undefined, attr);
      } catch {
        out = ref; // over budget: parseDoc refuses such files, so this is only a guard
      }
    }
    s += out;
    for (let k = 0; k < out.length; k++) {
      map.push(amp);
      bad.push(1);
    }
    i = amp + ref.length;
  }
  return { raw, s, map, bad: Uint8Array.from(bad) };
}

type Data = { [K in TokenKind]: Omit<Extract<Token, { kind: K }>, 'start' | 'end' | 'text'> }[TokenKind];

/** Emit a token over decoded characters [ds, de); dropped if it includes a bad character. */
type Emit = (ds: number, de: number, data: Data) => void;

function collector(src: Src, out: Token[]): Emit {
  return (ds, de, data) => {
    if (de <= ds) return;
    if (src.bad) for (let i = ds; i < de; i++) if (src.bad[i]) return;
    const t = data as Token; // each grammar makes a fresh data object: complete it in place
    t.start = src.map ? src.map[ds] : ds;
    t.end = src.map ? src.map[de - 1] + 1 : de;
    t.text = src.raw.slice(t.start, t.end);
    out.push(t);
  };
}

// ── grammars: each reads a decoded value `v` that starts at offset `at` of the decoded text ───────

type Grammar = (v: string, at: number, emit: Emit, prop: string) => void;

const isWs = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

function trim(v: string): [number, number] {
  let a = 0;
  let b = v.length;
  while (a < b && isWs(v[a])) a++;
  while (b > a && isWs(v[b - 1])) b--;
  return [a, b];
}

/** Places after the point as written, counting an exponent: '1.5e-3' → 4, '1e3' → 0. */
export function decimalsOf(text: string): number {
  let e = text.length;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === 'e' || text[i] === 'E') {
      e = i;
      break;
    }
  }
  const dot = text.indexOf('.');
  const places = dot === -1 || dot > e ? 0 : e - dot - 1;
  return e === text.length ? places : Math.max(0, places - Number(text.slice(e + 1)));
}

interface Lim {
  min?: number;
  max?: number;
  step?: number;
}
type Limits = (index: number, unit: string) => Lim | undefined;

function numberData(text: string, unit: string, prop: string, lim: Lim | undefined): Omit<NumberToken, 'start' | 'end' | 'text'> | null {
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  const d: Omit<NumberToken, 'start' | 'end' | 'text'> = { kind: 'number', prop, value, decimals: decimalsOf(text) };
  if (unit) d.unit = unit;
  if (lim?.min !== undefined) d.min = lim.min;
  if (lim?.max !== undefined) d.max = lim.max;
  if (lim?.step !== undefined) d.step = lim.step;
  return d;
}

const NUM = /[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/y;
const UNIT = /%|[A-Za-z]+/y;

/**
 * Numbers separated by whitespace and/or commas: points, viewBox, dash arrays, lengths and lists
 * of lengths, filter parameters. As browsers read '0-1' and '0.5.5', a number may be glued to the
 * one before it by its sign or point. An item that isn't made only of numbers (a keyword, calc())
 * gives no tokens.
 */
function numberList(v: string, at: number, emit: Emit, prop: string, units: boolean, lim?: Limits): void {
  let index = 0;
  let i = 0;
  while (i < v.length) {
    while (i < v.length && (isWs(v[i]) || v[i] === ',')) i++;
    if (i >= v.length) return;
    let j = i;
    while (j < v.length && !isWs(v[j]) && v[j] !== ',') j++;
    const found: [number, number, string][] = [];
    let k = i;
    let ok = true;
    while (k < j) {
      NUM.lastIndex = k;
      const m = NUM.exec(v);
      if (!m) {
        ok = false;
        break;
      }
      const e = k + m[0].length;
      let unit = '';
      if (units) {
        UNIT.lastIndex = e;
        const u = UNIT.exec(v);
        if (u && e + u[0].length <= j) unit = u[0];
      }
      found.push([k, e, unit]);
      k = e + unit.length;
      if (k < j && v[k] !== '+' && v[k] !== '-' && v[k] !== '.') {
        ok = false;
        break;
      }
    }
    if (ok) {
      for (const [s, e, unit] of found) {
        const d = numberData(v.slice(s, e), unit, prop, lim?.(index, unit));
        if (d) emit(at + s, at + e, d);
        index++;
      }
    } else index++;
    i = j;
  }
}

const nums =
  (lim?: Limits, units = true): Grammar =>
  (v, at, emit, prop) =>
    numberList(v, at, emit, prop, units, lim);

const ANY = nums();
const PLAIN = nums(undefined, false);
const NONNEG = nums(() => ({ min: 0 }));
const UNIT_INTERVAL: Limits = (_, unit) => (unit === '%' ? { min: 0, max: 100 } : { min: 0, max: 1, step: 0.01 });
const OPACITY = nums(UNIT_INTERVAL);

/** Each ';'-separated item read by one grammar (SMIL values, keyTimes, keySplines, begin). */
const semi =
  (item: Grammar): Grammar =>
  (v, at, emit, prop) => {
    let a = 0;
    for (;;) {
      const e = v.indexOf(';', a);
      item(v.slice(a, e === -1 ? v.length : e), at + a, emit, prop);
      if (e === -1) return;
      a = e + 1;
    }
  };

/** Path data: every argument of every segment parsePath keeps; arc flags cycle 0/1. */
const path: Grammar = (v, at, emit, prop) => {
  let base = at;
  for (const seg of parsePath(v).segs) {
    let spans: { start: number; end: number }[] = [];
    try {
      spans = argSpans(seg);
    } catch {
      spans = [];
    }
    spans.forEach((sp, k) => {
      const d: Data | null = isFlag(seg.cmd, k) ? { kind: 'enum', prop, options: ENUMS['d.arcFlag'] } : numberData(seg.raw.slice(sp.start, sp.end), '', prop, undefined);
      if (d) emit(base + sp.start, base + sp.end, d);
    });
    base += seg.raw.length;
  }
};

const FN = /([A-Za-z][\w-]*)[ \t\n\r\f]*\(/y;

/**
 * Transform lists (SVG's rotate(30 12 12) and CSS's rotate(30deg)): the numbers inside each
 * function. Reading stops at the first thing that isn't a function.
 */
const transform: Grammar = (v, at, emit, prop) => {
  let i = 0;
  for (;;) {
    while (i < v.length && (isWs(v[i]) || v[i] === ',')) i++;
    if (i >= v.length) return;
    FN.lastIndex = i;
    if (!FN.exec(v)) return;
    const open = FN.lastIndex;
    const close = v.indexOf(')', open);
    if (close === -1 || v.slice(open, close).includes('(')) return;
    numberList(v.slice(open, close), at + open, emit, prop, true);
    i = close + 1;
  }
};

const PAINT_KEYWORDS = ['none', 'context-fill', 'context-stroke'];
const FALLBACK_KEYWORDS = ['none'];

/** A colour, or one of `keywords`, filling the whole (trimmed) value. */
function colorValue(v: string, at: number, emit: Emit, prop: string, keywords: readonly string[]): void {
  const [a, b] = trim(v);
  if (a === b) return;
  const t = v.slice(a, b);
  if (keywords.includes(t.toLowerCase())) emit(at + a, at + b, { kind: 'color', prop, color: null, keywords });
  else {
    const color = parseColor(t);
    if (color) emit(at + a, at + b, { kind: 'color', prop, color, keywords });
  }
}

const color: Grammar = (v, at, emit, prop) => colorValue(v, at, emit, prop, []);

const URL_HEAD = /^url\([ \t\n\r\f]*(?:"([^"]*)"|'([^']*)'|([^ \t\n\r\f"'()]+))[ \t\n\r\f]*\)/di;

/** The id inside url(#id), url('#id') or url("#id") at the start of `t`, if there is one. */
function urlRef(t: string, at: number, emit: Emit, prop: string): number {
  const m = URL_HEAD.exec(t);
  if (!m?.indices) return 0;
  const g = m[1] !== undefined ? 1 : m[2] !== undefined ? 2 : 3;
  const [s, e] = m.indices[g]!;
  if (e - s >= 2 && t[s] === '#') emit(at + s + 1, at + e, { kind: 'ref', prop, id: decodeFragment(t.slice(s + 1, e)) });
  return m[0].length;
}

/** fill and stroke: none, a colour, context-fill/-stroke, or url(#id) with a fallback. */
const paint: Grammar = (v, at, emit, prop) => {
  const [a, b] = trim(v);
  const t = v.slice(a, b);
  const p = parsePaint(t);
  if (!p) return;
  if (p.kind !== 'url') return colorValue(v, at, emit, prop, PAINT_KEYWORDS);
  const head = urlRef(t, at + a, emit, prop);
  if (head < t.length) colorValue(t.slice(head), at + a + head, emit, prop, FALLBACK_KEYWORDS);
};

const URL_ANY = /url\([ \t\n\r\f]*(?:"([^"]*)"|'([^']*)'|([^ \t\n\r\f"'()]+))[ \t\n\r\f]*\)/dgi;

/** clip-path, mask, filter and markers: every url(#id) in the value. */
const refs: Grammar = (v, at, emit, prop) => {
  for (const m of v.matchAll(URL_ANY)) urlRef(m[0], at + m.index, emit, prop);
};

/** href="#id": a reference into this document (anything else is a URL, not a token). */
const href: Grammar = (v, at, emit, prop) => {
  const [a, b] = trim(v);
  if (b - a >= 2 && v[a] === '#') emit(at + a + 1, at + b, { kind: 'ref', prop, id: decodeFragment(v.slice(a + 1, b)) });
};

const enumOf =
  (options: readonly string[]): Grammar =>
  (v, at, emit, prop) => {
    const [a, b] = trim(v);
    if (options.includes(v.slice(a, b))) emit(at + a, at + b, { kind: 'enum', prop, options });
  };

/** marker orient and animateMotion rotate: a keyword, or an angle. */
const enumOrAngle =
  (options: readonly string[]): Grammar =>
  (v, at, emit, prop) => {
    const [a, b] = trim(v);
    if (options.includes(v.slice(a, b))) emit(at + a, at + b, { kind: 'enum', prop, options });
    else ANY(v, at, emit, prop);
  };

const PAR = /^[ \t\n\r\f]*(?:defer[ \t\n\r\f]+)?(none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:[ \t\n\r\f]+(meet|slice))?[ \t\n\r\f]*$/d;

/** preserveAspectRatio: the align keyword, and meet/slice when it is written. */
const par: Grammar = (v, at, emit, prop) => {
  const m = PAR.exec(v);
  if (!m?.indices) return;
  const [s, e] = m.indices[1]!;
  emit(at + s, at + e, { kind: 'enum', prop, options: ENUMS['preserveAspectRatio.align'] });
  if (m.indices[2]) emit(at + m.indices[2][0], at + m.indices[2][1], { kind: 'enum', prop, options: ENUMS['preserveAspectRatio.meetOrSlice'] });
};

const CLOCK = /^[ \t\n\r\f]*([+-]?(?:\d*\.\d+|\d+))(h|min|s|ms)?[ \t\n\r\f]*$/d;

/** A SMIL offset or timecount value ('2s', '0.5', '150ms'); full clock values give no token. */
const clock =
  (min?: number): Grammar =>
  (v, at, emit, prop) => {
    const m = CLOCK.exec(v);
    if (!m?.indices) return;
    const [s, e] = m.indices[1]!;
    const d = numberData(m[1], m[2] ?? '', prop, min === undefined ? undefined : { min });
    if (d) emit(at + s, at + e, d);
  };

const viewBox = nums((i) => (i >= 2 ? { min: 0 } : undefined), false);
const UNIT_LIST = semi(nums(UNIT_INTERVAL, false));

// Presentation attributes, which are CSS properties too (in style="" and <style>).
const PROPS: ReadonlyMap<string, Grammar> = new Map<string, Grammar>([
  ['fill', paint],
  ['stroke', paint],
  ...['stop-color', 'flood-color', 'lighting-color', 'color', 'background-color', 'background', 'border-color', 'outline-color', 'text-decoration-color', 'caret-color'].map((p): [string, Grammar] => [p, color]),
  ...['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'flood-opacity'].map((p): [string, Grammar] => [p, OPACITY]),
  ...['stroke-width', 'stroke-dasharray', 'font-size', 'r', 'rx', 'ry', 'width', 'height'].map((p): [string, Grammar] => [p, NONNEG]),
  ['stroke-miterlimit', nums(() => ({ min: 1 }))],
  ...['stroke-dashoffset', 'letter-spacing', 'word-spacing', 'x', 'y', 'cx', 'cy', 'baseline-shift', 'transform-origin'].map((p): [string, Grammar] => [p, ANY]),
  ...['animation-duration', 'animation-delay', 'transition-duration', 'transition-delay'].map((p): [string, Grammar] => [p, ANY]),
  ...['clip-path', 'mask', 'filter', 'marker', 'marker-start', 'marker-mid', 'marker-end'].map((p): [string, Grammar] => [p, refs]),
  ['transform', transform],
]);

// Attributes that are not CSS properties.
const ATTRS: ReadonlyMap<string, Grammar> = new Map<string, Grammar>([
  ['d', path],
  ['path', path],
  ['points', PLAIN],
  ['viewBox', viewBox],
  ['preserveAspectRatio', par],
  ['href', href],
  ['gradientTransform', transform],
  ['patternTransform', transform],
  ...['x1', 'y1', 'x2', 'y2', 'fx', 'fy', 'refX', 'refY', 'dx', 'dy', 'rotate', 'startOffset', 'z', 'azimuth', 'elevation', 'pointsAtX', 'pointsAtY', 'pointsAtZ', 'limitingConeAngle', 'specularConstant', 'specularExponent', 'diffuseConstant', 'surfaceScale', 'k1', 'k2', 'k3', 'k4', 'scale', 'seed', 'order', 'kernelMatrix', 'divisor', 'bias', 'targetX', 'targetY', 'kernelUnitLength', 'amplitude', 'exponent', 'intercept', 'slope', 'tableValues'].map((p): [string, Grammar] => [p, ANY]),
  ...['fr', 'textLength', 'markerWidth', 'markerHeight', 'pathLength', 'numOctaves', 'baseFrequency', 'stdDeviation', 'radius', 'repeatCount'].map((p): [string, Grammar] => [p, NONNEG]),
  ['keyTimes', UNIT_LIST],
  ['keyPoints', UNIT_LIST],
  ['keySplines', UNIT_LIST],
  ['dur', clock(0)],
  ['repeatDur', clock(0)],
  ['begin', semi(clock())],
  ['end', semi(clock())],
]);

/** Attributes whose value is prose, tokenized as text runs. */
const TEXT_ATTRS = new Set(['aria-label', 'aria-description']);

/** Elements whose text content is a run the text sheet edits. */
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'textPath', 'title', 'desc']);

function plainGrammar(name: string): Grammar | null {
  const g = ATTRS.get(name) ?? PROPS.get(name);
  if (g) return g;
  const options = OPTIONS.get(name);
  return options && !name.includes('/') && !name.includes('.') ? enumOf(options) : null;
}

/** SMIL from/to/by/values: each value read as the animated attribute's own grammar. */
function animation(doc: Doc, node: ElementNode, local: string): Grammar | null {
  const each = (item: Grammar): Grammar => (local === 'values' ? semi(item) : item);
  if (node.local === 'animateTransform' || node.local === 'animateMotion') return each(PLAIN);
  const target = attrValue(doc, node, null, 'attributeName')?.trim();
  const item = target ? plainGrammar(target) : null;
  if (!target || !item) return null;
  const g = each(item);
  return (v, at, emit) => g(v, at, emit, target); // tokens belong to the animated property
}

function grammarFor(doc: Doc, node: ElementNode, attr: AttrRef): Grammar | 'text' | null {
  const { ns, local } = attr;
  if (ns === NS.xlink) return local === 'href' ? href : null;
  if (ns === NS.xml) return local === 'space' ? enumOf(ENUMS['xml:space']) : null;
  if (ns !== null) return null;
  if (local === 'style') return cssDeclarations;
  if (node.ns !== NS.svg) return null;
  if (TEXT_ATTRS.has(local)) return 'text';
  const scoped = OPTIONS.get(`${node.local}/${local}`);
  if (scoped) return local === 'rotate' || local === 'orient' ? enumOrAngle(scoped) : enumOf(scoped);
  if (ANIMATION.includes(node.local) && (local === 'values' || local === 'from' || local === 'to' || local === 'by')) return animation(doc, node, local);
  if (local === 'values') return node.local === 'feColorMatrix' ? PLAIN : null;
  if (local === 'offset') return node.local === 'stop' ? OPACITY : ANY;
  return plainGrammar(local);
}

// ── CSS: style="" declarations and <style> sheets ────────────────────────────────────────────────

function skipString(v: string, i: number): number {
  const q = v[i];
  for (let k = i + 1; k < v.length; k++) {
    if (v[k] === '\\') k++;
    else if (v[k] === q) return k + 1;
  }
  return v.length;
}

function skipParens(v: string, i: number): number {
  let depth = 0;
  for (let k = i; k < v.length; ) {
    const c = v[k];
    if (c === '"' || c === "'") k = skipString(v, k);
    else {
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return k + 1;
      k++;
    }
  }
  return v.length;
}

const IMPORTANT = /![ \t\n\r\f]*important[ \t\n\r\f]*$/i;

/**
 * Walk CSS text and read each declaration's value by its property's grammar. `depth` is 1 for a
 * style attribute (already inside a block) and 0 for a sheet. Text before a '{' is a selector or
 * an at-rule prelude and is skipped; strings, parentheses and comments never split a declaration.
 * A declaration holding a comment or an escape gives no tokens.
 */
function css(v: string, at: number, emit: Emit, depth: number): void {
  const decl = (a: number, b: number): void => {
    const colon = v.indexOf(':', a);
    if (colon === -1 || colon >= b) return;
    const name = v.slice(a, colon).replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, '');
    if (!/^[A-Za-z][A-Za-z-]*$/.test(name)) return;
    let value = v.slice(colon + 1, b);
    if (value.includes('/*') || value.includes('\\')) return;
    const imp = IMPORTANT.exec(value);
    if (imp) value = value.slice(0, imp.index);
    const prop = name.toLowerCase();
    const g = PROPS.get(prop) ?? (OPTIONS.has(prop) && /^[a-z-]+$/.test(prop) ? enumOf(OPTIONS.get(prop)!) : null);
    if (g) g(value, at + colon + 1, emit, prop);
  };
  let seg = 0;
  for (let i = 0; i < v.length; ) {
    const c = v[i];
    if (c === '/' && v[i + 1] === '*') {
      const e = v.indexOf('*/', i + 2);
      i = e === -1 ? v.length : e + 2;
    } else if (c === '"' || c === "'") i = skipString(v, i);
    else if (c === '(') i = skipParens(v, i);
    else if (c === '{') {
      depth++;
      seg = ++i;
    } else if (c === '}' || c === ';') {
      if (depth > 0) decl(seg, i);
      if (c === '}') depth = Math.max(0, depth - 1);
      seg = ++i;
    } else i++;
  }
  if (depth > 0) decl(seg, v.length);
}

const cssDeclarations: Grammar = (v, at, emit) => css(v, at, emit, 1);

// ── text runs ────────────────────────────────────────────────────────────────────────────────────

/** Runs of text between references, without their leading and trailing whitespace. */
function textRuns(src: Src, a: number, b: number, emit: Emit, prop: string): void {
  let i = a;
  while (i < b) {
    while (i < b && (src.bad?.[i] || isWs(src.s[i]))) i++;
    let j = i;
    while (j < b && !src.bad?.[j]) j++;
    let e = j;
    while (e > i && isWs(src.s[e - 1])) e--;
    if (e > i) emit(i, e, { kind: 'text', prop });
    i = j;
  }
}

// ── entry points ─────────────────────────────────────────────────────────────────────────────────

/** Tokens in source order (most grammars emit them in order already). */
function inOrder(out: Token[]): Token[] {
  for (let i = 1; i < out.length; i++) if (out[i].start < out[i - 1].start) return out.sort((a, b) => a.start - b.start);
  return out;
}

/** The tokens of an attribute, with offsets into its raw text. [] when it has none (or isn't there). */
export function tokenizeAttr(doc: Doc, nodeId: NodeId, attr: AttrRef): Token[] {
  const node = el(doc, nodeId);
  const a = findAttr(node, attr.ns, attr.local);
  return a ? tokenizeAttrRaw(doc, node, attr, a.raw) : [];
}

/** The tokens `raw` would have as the value of this attribute (edit.ts checks an edit with it). */
export function tokenizeAttrRaw(doc: Doc, node: ElementNode, attr: AttrRef, raw: string): Token[] {
  const g = grammarFor(doc, node, attr);
  if (!g) return [];
  const src = decodedSrc(doc, raw, true);
  const out: Token[] = [];
  const emit = collector(src, out);
  if (g === 'text') textRuns(src, 0, src.s.length, emit, attr.local);
  else g(src.s, 0, emit, attr.local);
  return inOrder(out);
}

/**
 * The tokens of a text or CDATA leaf, with offsets into its raw text (which, for CDATA, includes
 * the delimiters): CSS values in <style>, and text runs in <text>, <tspan>, <textPath>, <title>
 * and <desc> (and an <a> inside text).
 */
export function tokenizeText(doc: Doc, leafId: NodeId): Token[] {
  const n = doc.nodes.get(leafId);
  return n && (n.kind === 'text' || n.kind === 'cdata') ? tokenizeLeafRaw(doc, n, n.raw) : [];
}

/** The tokens `raw` would have as this leaf's text (edit.ts checks an edit with it). */
export function tokenizeLeafRaw(doc: Doc, leaf: LeafNode, raw: string): Token[] {
  const parent = leaf.parent === null ? undefined : doc.nodes.get(leaf.parent);
  if (!parent || parent.kind !== 'element') return [];
  const mode = leafMode(doc, parent);
  if (!mode) return [];
  let src: Src;
  let a = 0;
  let b: number;
  if (leaf.kind === 'cdata') {
    if (!raw.startsWith('<![CDATA[') || !raw.endsWith(']]>') || raw.length < 12) return [];
    const bad = new Uint8Array(raw.length);
    bad.fill(1, 0, 9);
    bad.fill(1, raw.length - 3);
    src = { raw, s: raw, map: null, bad };
    a = 9;
    b = raw.length - 3;
  } else if (leaf.kind === 'text') {
    src = decodedSrc(doc, raw, false);
    b = src.s.length;
  } else return [];
  const out: Token[] = [];
  const emit = collector(src, out);
  if (mode === 'css') css(src.s.slice(a, b), a, emit, 0);
  else textRuns(src, a, b, emit, parent.local);
  return inOrder(out);
}

function leafMode(doc: Doc, parent: ElementNode): 'css' | 'text' | null {
  if (parent.local === 'style' && (parent.ns === NS.svg || parent.ns === NS.xhtml)) return 'css';
  if (parent.ns !== NS.svg) return null;
  if (TEXT_ELEMENTS.has(parent.local)) return 'text';
  if (parent.local !== 'a') return null;
  // a link inside text is part of the run
  for (let p = parent.parent; p !== null; ) {
    const n = doc.nodes.get(p);
    if (!n || n.kind !== 'element') return null;
    if (n.ns === NS.svg && (n.local === 'text' || n.local === 'tspan' || n.local === 'textPath')) return 'text';
    p = n.parent;
  }
  return null;
}
