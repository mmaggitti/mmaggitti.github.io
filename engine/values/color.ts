// CSS Color 4 colors and SVG paints (fill, stroke, stop-color, flood-color, lighting-color).
//
// - Every notation resolves to sRGB channels that are NOT clamped: a lab() or oklch() color
//   outside sRGB keeps its true value, and oklch() output keeps it exact while its OKLab lightness
//   is within 0..1. oklch() clamps L when read, so a darker or lighter color (possible from lab(),
//   lch() or hsl()) is written clipped instead. clampRgb() clips for display and hex.
// - `spelling` is the text as written (trimmed), so an untouched color is written back verbatim.
// - Conversions follow the spec's sample conversion code: lab()/lch() are CIE Lab under D50 and
//   reach sRGB's D65 through Bradford; oklab()/oklch() are D65.
// - Not supported (they parse as null, so the caller keeps the text as written): color(),
//   color-mix(), relative colors (`from`), calc(), system colors and CSS comments.

import { fmt } from './number-format.ts';
import { decodeFragment } from './url.ts';

export type ColorSpace = 'srgb' | 'hsl' | 'hwb' | 'lab' | 'lch' | 'oklab' | 'oklch';

export interface Color {
  kind: 'color' | 'current'; // 'current' = currentColor, whose value comes from context
  space: ColorSpace; // the notation it was written in; hex, rgb() and names are 'srgb'
  r: number; // sRGB, gamma-encoded; 0..1 when in gamut
  g: number;
  b: number;
  alpha: number; // 0..1
  spelling: string;
}

export type Paint =
  | { kind: 'none' }
  | { kind: 'color'; color: Color }
  | { kind: 'url'; id: string; fallback: Color | 'none' | null } // id is percent-decoded, as browsers match it
  | { kind: 'context-fill' | 'context-stroke' };

export type ColorStyle = 'hex' | 'rgb' | 'hsl' | 'oklch';

// ── parsing ──────────────────────────────────────────────────────────────────────────────────────

// CSS whitespace only (String.prototype.trim also strips NBSP), and a loop rather than a regex:
// `[ws]+$` under /g retries at every whitespace position, quadratic on a hostile attribute.
const WS = ' \t\n\r\f';

function trimWs(s: string): string {
  let i = 0;
  let j = s.length;
  while (i < j && WS.includes(s[i])) i++;
  while (j > i && WS.includes(s[j - 1])) j--;
  return s.slice(i, j);
}

export function parseColor(input: string): Color | null {
  const spelling = trimWs(input);
  const s = spelling.toLowerCase();
  const make = (space: ColorSpace, rgb: readonly number[], alpha: number): Color | null =>
    rgb.every(Number.isFinite) && Number.isFinite(alpha) ? { kind: 'color', space, r: rgb[0], g: rgb[1], b: rgb[2], alpha, spelling } : null;

  if (s === 'currentcolor') return { kind: 'current', space: 'srgb', r: 0, g: 0, b: 0, alpha: 1, spelling };
  if (s === 'transparent') return make('srgb', [0, 0, 0], 0);
  const hex = s[0] === '#' ? s : NAMED_COLORS.get(s);
  if (hex !== undefined) {
    const v = hexChannels(hex.slice(1));
    return v && make('srgb', v, v[3] ?? 1);
  }
  const fn = /^([a-z]+)\(([^()]*)\)$/.exec(s);
  const c = fn && colorFunction(fn[1], fn[2]);
  return c && make(c.space, c.rgb, c.alpha);
}

function hexChannels(h: string): number[] | null {
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = h.replace(/./g, '$&$&');
  else if (h.length !== 6 && h.length !== 8) return null;
  return h.match(/../g)!.map((x) => parseInt(x, 16) / 255);
}

type Arg = { v: number; u: string } | null; // null = `none`

const TOKEN = /[ \t\n\r\f]*(?:([,/])|([+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?)(%|[a-z]+)?|(none))[ \t\n\r\f]*/y;

/**
 * Split a function body into three components and an optional alpha. Legacy syntax is
 * comma-separated and has no `none`; modern syntax is space-separated with `/ alpha`.
 */
function readArgs(body: string): { args: Arg[]; alpha: Arg | undefined; legacy: boolean } | null {
  const toks: (Arg | ',' | '/')[] = [];
  for (let i = 0; i < body.length; ) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(body);
    if (!m) return null;
    i = TOKEN.lastIndex;
    toks.push(m[1] ? (m[1] as ',' | '/') : m[4] ? null : { v: Number(m[2]), u: m[3] ?? '' });
  }
  const isValue = (t: Arg | ',' | '/'): t is Arg => t !== ',' && t !== '/';
  if (toks.includes(',')) {
    const vals = toks.filter((_, k) => k % 2 === 0);
    const ok = (toks.length === 5 || toks.length === 7) && toks.every((t, k) => (k % 2 ? t === ',' : isValue(t) && t !== null));
    return ok ? { args: vals.slice(0, 3) as Arg[], alpha: vals[3] as Arg | undefined, legacy: true } : null;
  }
  const slash = toks.indexOf('/');
  const args = slash === -1 ? toks : toks.slice(0, slash);
  const tail = slash === -1 ? [] : toks.slice(slash + 1);
  if (args.length !== 3 || (slash !== -1 && tail.length !== 1) || ![...args, ...tail].every(isValue)) return null;
  return { args: args as Arg[], alpha: tail[0] as Arg | undefined, legacy: false };
}

/** A number, or a percentage of `full`; `none` is 0. NaN marks a wrong unit. */
const pct = (a: Arg, full: number): number => (a === null ? 0 : a.u === '' ? a.v : a.u === '%' ? (a.v * full) / 100 : NaN);

const ANGLE: Record<string, number> = { '': 1, deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };
const hue = (a: Arg): number => (a === null ? 0 : a.v * (ANGLE[a.u] ?? NaN));

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

function colorFunction(name: string, body: string): { space: ColorSpace; rgb: number[]; alpha: number } | null {
  const p = readArgs(body);
  if (!p) return null;
  const [x, y, z] = p.args;
  const alpha = p.alpha === undefined ? 1 : clamp(pct(p.alpha, 1), 0, 1);
  switch (name) {
    case 'rgb':
    case 'rgba': // legacy syntax takes all numbers or all percentages
      if (p.legacy && !(x?.u === y?.u && y?.u === z?.u)) return null;
      return { space: 'srgb', rgb: [x, y, z].map((a) => clamp(pct(a, 255) / 255, 0, 1)), alpha };
    case 'hsl':
    case 'hsla': // legacy syntax takes percentages for saturation and lightness
      if (p.legacy && !(y?.u === '%' && z?.u === '%')) return null;
      return { space: 'hsl', rgb: hslToRgb(hue(x), Math.max(0, pct(y, 100)), pct(z, 100)), alpha };
  }
  if (p.legacy) return null;
  switch (name) {
    case 'hwb':
      return { space: 'hwb', rgb: hwbToRgb(hue(x), pct(y, 100), pct(z, 100)), alpha };
    case 'lab':
      return { space: 'lab', rgb: labToRgb(clamp(pct(x, 100), 0, 100), pct(y, 125), pct(z, 125)), alpha };
    case 'lch': {
      const [a, b] = polar(Math.max(0, pct(y, 150)), hue(z));
      return { space: 'lch', rgb: labToRgb(clamp(pct(x, 100), 0, 100), a, b), alpha };
    }
    case 'oklab':
      return { space: 'oklab', rgb: oklabToRgb(clamp(pct(x, 1), 0, 1), pct(y, 0.4), pct(z, 0.4)), alpha };
    case 'oklch': {
      const [a, b] = polar(Math.max(0, pct(y, 0.4)), hue(z));
      return { space: 'oklch', rgb: oklabToRgb(clamp(pct(x, 1), 0, 1), a, b), alpha };
    }
  }
  return null;
}

const polar = (c: number, h: number): [number, number] => [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];

/** An SVG paint: none, a color, context-fill/-stroke, or url(#id) with an optional fallback. */
export function parsePaint(input: string): Paint | null {
  const s = trimWs(input);
  const k = s.toLowerCase();
  if (k === 'none') return { kind: 'none' };
  if (k === 'context-fill' || k === 'context-stroke') return { kind: k };
  // The unquoted form is non-empty (url() fails the length check anyway), so no alternative can
  // match nothing between the two whitespace runs: an empty one made backtracking quadratic.
  const u = /^url\([ \t\n\r\f]*(?:"([^"]*)"|'([^']*)'|([^ \t\n\r\f"'()]+))[ \t\n\r\f]*\)([^]*)$/i.exec(s);
  if (!u) {
    const color = parseColor(s);
    return color && { kind: 'color', color };
  }
  // same-document references only: Draw never fetches another file's paint server
  const ref = u[1] ?? u[2] ?? u[3];
  if (ref.length < 2 || ref[0] !== '#') return null;
  const rest = trimWs(u[4]);
  const fallback = rest === '' ? null : rest.toLowerCase() === 'none' ? 'none' : parseColor(rest);
  if (rest && !fallback) return null;
  return { kind: 'url', id: decodeFragment(ref.slice(1)), fallback };
}

// ── output ───────────────────────────────────────────────────────────────────────────────────────

/** The sRGB channels clipped into gamut, for display. */
export function clampRgb(c: Color): { r: number; g: number; b: number } {
  return { r: clamp(c.r, 0, 1), g: clamp(c.g, 0, 1), b: clamp(c.b, 0, 1) };
}

/**
 * '#rrggbb', or '#rrggbbaa' with alpha (by default only when alpha < 1); out-of-gamut channels are
 * clipped. Null for currentColor, which has no value of its own.
 */
export function toHex(c: Color, withAlpha = c.alpha < 1): string | null {
  if (c.kind === 'current') return null;
  const { r, g, b } = clampRgb(c);
  const ch = withAlpha ? [r, g, b, c.alpha] : [r, g, b];
  return '#' + ch.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * Write a color in one style. rgb and hsl use the comma syntax SVG 1.1-era tools read (clipped to
 * sRGB); oklch keeps out-of-gamut colors exact unless their OKLab L is outside 0..1, which oklch()
 * cannot express: those are written clipped, as toHex shows them. currentColor stays 'currentColor'.
 */
export function formatColor(c: Color, style: ColorStyle): string {
  if (c.kind === 'current') return 'currentColor';
  if (style === 'hex') return toHex(c)!;
  const a = c.alpha < 1 ? fmt(c.alpha) : null;
  if (style === 'oklch') {
    // 5 decimals for L and C, 2 for hue: every 8-bit sRGB color comes back to the same hex (checked
    // over all 16.7M; the worst channel error is 0.36/255). With 4, some did not.
    let [l, ch, h] = toOklch(c);
    const lw = Number(fmt(l, 5)); // as written: the raw L of an exact oklch(1 …) drifts past 1
    if (lw < 0 || lw > 1) [l, ch, h] = toOklch({ ...c, ...clampRgb(c) });
    const cs = fmt(ch, 5);
    return `oklch(${fmt(l, 5)} ${cs} ${cs === '0' ? '0' : fmt(h, 2)}${a ? ` / ${a}` : ''})`;
  }
  const { r, g, b } = clampRgb(c);
  const v = style === 'rgb' ? [r, g, b].map((x) => fmt(x * 255, 2)) : rgbToHsl(r, g, b).map((x, i) => fmt(x, 2) + (i ? '%' : ''));
  return a ? `${style}a(${v.join(', ')}, ${a})` : `${style}(${v.join(', ')})`;
}

/** OKLCh: lightness 0..1, chroma, hue in degrees [0, 360). */
export function toOklch(c: Color): [number, number, number] {
  const [l, a, b] = rgbToOklab(c.r, c.g, c.b);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return [l, Math.hypot(a, b), h < 0 ? h + 360 : h];
}

// ── conversions (the spec's sample code) ─────────────────────────────────────────────────────────

type Vec3 = [number, number, number];
type Mat3 = readonly (readonly number[])[];

const mul = (m: Mat3, v: readonly number[]): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

// sRGB's transfer function, extended to negative values by symmetry
const toLinear = (c: number): number => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number): number => (Math.abs(c) > 0.0031308 ? Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055) : 12.92 * c);

const LRGB_TO_XYZ: Mat3 = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const XYZ_TO_LRGB: Mat3 = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];
const D50_TO_D65: Mat3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const D50: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const KAPPA = 24389 / 27;

const XYZ_TO_LMS: Mat3 = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_XYZ: Mat3 = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];
const LMS_TO_OKLAB: Mat3 = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const OKLAB_TO_LMS: Mat3 = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];

const linearToRgb = (v: Vec3): Vec3 => [toGamma(v[0]), toGamma(v[1]), toGamma(v[2])];

function hslToRgb(h: number, s: number, l: number): Vec3 {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function hwbToRgb(h: number, w: number, b: number): Vec3 {
  w /= 100;
  b /= 100;
  if (w + b >= 1) {
    const gray = w / (w + b);
    return [gray, gray, gray];
  }
  return hslToRgb(h, 100, 50).map((c) => c * (1 - w - b) + w) as Vec3;
}

function labToRgb(l: number, a: number, b: number): Vec3 {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (f: number): number => (f > 24 / 116 ? f ** 3 : (116 * f - 16) / KAPPA);
  const xyz = [inv(fx) * D50[0], (l > 8 ? fy ** 3 : l / KAPPA) * D50[1], inv(fz) * D50[2]];
  return linearToRgb(mul(XYZ_TO_LRGB, mul(D50_TO_D65, xyz)));
}

function oklabToRgb(l: number, a: number, b: number): Vec3 {
  const lms = mul(OKLAB_TO_LMS, [l, a, b]).map((c) => c ** 3);
  return linearToRgb(mul(XYZ_TO_LRGB, mul(LMS_TO_XYZ, lms)));
}

function rgbToOklab(r: number, g: number, b: number): Vec3 {
  const lms = mul(XYZ_TO_LMS, mul(LRGB_TO_XYZ, [toLinear(r), toLinear(g), toLinear(b)]));
  return mul(LMS_TO_OKLAB, lms.map(Math.cbrt));
}

/** [hue 0..360, saturation %, lightness %]; hue is 0 for grays. Expects in-gamut channels. */
function rgbToHsl(r: number, g: number, b: number): Vec3 {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return [0, 0, l * 100]; // a gray, allowing for residue from other spaces
  const s = l === 0 || l === 1 ? 0 : (max - l) / Math.min(l, 1 - l);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

// ── the 148 named colors (CSS Color 4 §6.1) ─────────────────────────────────────────────────────

export const NAMED_COLORS: ReadonlyMap<string, string> = (() => {
  const w = `aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc
    bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a
    burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50
    cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b
    darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b
    darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000
    darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f
    darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff
    dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0
    forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700
    goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0
    hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa
    lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080
    lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3
    lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa
    lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00
    limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa
    mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371
    mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585
    midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead
    navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500
    orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093
    papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6
    purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1
    saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee
    sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090
    snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8
    tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5
    yellow ffff00 yellowgreen 9acd32`.split(/\s+/);
  const map = new Map<string, string>();
  for (let i = 0; i < w.length; i += 2) map.set(w[i], '#' + w[i + 1]);
  return map;
})();
