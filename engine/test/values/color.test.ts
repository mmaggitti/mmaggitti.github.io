// engine/values/color: CSS Color 4 parsing, conversions against reference values, output styles,
// and SVG paints.
//
// Reference values come from the CSS Color 4 sample conversion code (as implemented by colorjs.io,
// which the spec's editors maintain), checked independently of this module.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAMED_COLORS, clampRgb, formatColor, parseColor, parsePaint, toHex, toOklch, type Color } from '../../values/color.ts';
import { lineFindings } from '../../../scripts/lib/public-rules.mjs';
import { mulberry32 } from './rng.ts';

const rgbOf = (s: string): number[] => {
  const c = parseColor(s);
  assert.ok(c, `parses: ${s}`);
  return [c.r, c.g, c.b, c.alpha];
};

function close(a: readonly number[], b: readonly number[], tol: number, msg = ''): void {
  assert.ok(a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol), `${msg} [${a}] ≠ [${b}]`);
}

// ── hex, names, keywords ─────────────────────────────────────────────────────────────────────────

test('hex in 3, 4, 6 and 8 digits, any case', () => {
  close(rgbOf('#f00'), [1, 0, 0, 1], 0);
  close(rgbOf('#ABC'), [0xaa / 255, 0xbb / 255, 0xcc / 255, 1], 1e-15);
  close(rgbOf('#abcd'), [0xaa / 255, 0xbb / 255, 0xcc / 255, 0xdd / 255], 1e-15);
  close(rgbOf('#102030'), [16 / 255, 32 / 255, 48 / 255, 1], 1e-15);
  close(rgbOf('#10203080'), [16 / 255, 32 / 255, 48 / 255, 128 / 255], 1e-15);
  for (const s of ['#', '#f', '#ff', '#fffff', '#fffffff', '#fffffffff', '#ggg', 'ff0000', '# fff', '#ff 0000']) {
    assert.equal(parseColor(s), null, s);
  }
});

test('all 148 named colors, case-insensitive', () => {
  assert.equal(NAMED_COLORS.size, 148);
  for (const [name, hex] of NAMED_COLORS) {
    assert.match(name, /^[a-z]+$/);
    assert.match(hex, /^#[0-9a-f]{6}$/);
    assert.equal(toHex(parseColor(name)!), hex, name);
    assert.equal(toHex(parseColor(name.toUpperCase())!), hex, name);
  }
  // spot checks against the spec's table
  const spot: [string, string][] = [
    ['rebeccapurple', '#663399'], ['RebeccaPurple', '#663399'], ['aliceblue', '#f0f8ff'], ['cornflowerblue', '#6495ed'],
    ['gray', '#808080'], ['grey', '#808080'], ['darkslategrey', '#2f4f4f'], ['lightgoldenrodyellow', '#fafad2'],
    ['yellowgreen', '#9acd32'], ['aqua', '#00ffff'], ['cyan', '#00ffff'], ['fuchsia', '#ff00ff'], ['green', '#008000'],
    ['lime', '#00ff00'], ['navajowhite', '#ffdead'], ['papayawhip', '#ffefd5'],
  ];
  for (const [name, hex] of spot) assert.equal(toHex(parseColor(name)!), hex, name);
  for (const s of ['bluish', 'red1', 'light-blue', 'none', 'inherit', 'initial', '']) assert.equal(parseColor(s), null, s);
});

test('currentColor and transparent', () => {
  const cur = parseColor('currentColor')!;
  assert.equal(cur.kind, 'current');
  assert.equal(parseColor('CURRENTCOLOR')!.kind, 'current');
  assert.equal(toHex(cur), null, 'currentColor has no hex of its own (never silently black)');
  assert.equal(formatColor(cur, 'hex'), 'currentColor');
  assert.equal(formatColor(cur, 'oklch'), 'currentColor');
  const tr = parseColor('Transparent')!;
  assert.equal(tr.kind, 'color');
  close([tr.r, tr.g, tr.b, tr.alpha], [0, 0, 0, 0], 0);
  assert.equal(toHex(tr), '#00000000');
});

test('spelling keeps the text as written, trimmed', () => {
  assert.equal(parseColor('  Red\n')!.spelling, 'Red');
  assert.equal(parseColor('\trgb(1 2 3 / 50%) ')!.spelling, 'rgb(1 2 3 / 50%)');
  assert.equal(parseColor('#ABC')!.spelling, '#ABC');
  assert.equal(parseColor('red')!.space, 'srgb');
  assert.equal(parseColor('oklch(0.5 0.1 30)')!.space, 'oklch');
  assert.equal(parseColor('hsla(0, 0%, 0%, 1)')!.space, 'hsl');
});

// ── rgb() ────────────────────────────────────────────────────────────────────────────────────────

test('rgb(): legacy comma syntax', () => {
  close(rgbOf('rgb(255,0,0)'), [1, 0, 0, 1], 0);
  close(rgbOf('rgb( 255 , 128 , 0 )'), [1, 128 / 255, 0, 1], 1e-15);
  close(rgbOf('RGB(100%, 50%, 0%)'), [1, 0.5, 0, 1], 1e-15);
  close(rgbOf('rgba(255, 0, 0, .5)'), [1, 0, 0, 0.5], 0);
  close(rgbOf('rgba(255, 0, 0, 25%)'), [1, 0, 0, 0.25], 0);
  close(rgbOf('rgb(255, 0, 0, 0.5)'), [1, 0, 0, 0.5], 0);
  close(rgbOf('rgba(255, 0, 0)'), [1, 0, 0, 1], 0);
  close(rgbOf('rgb(1e2, 0, 0)'), [100 / 255, 0, 0, 1], 1e-15);
  close(rgbOf('rgb(127.5, 0, 0)'), [0.5, 0, 0, 1], 1e-15);
});

test('rgb(): modern space syntax with / alpha, mixing, none', () => {
  close(rgbOf('rgb(255 0 0)'), [1, 0, 0, 1], 0);
  close(rgbOf('rgb(255 0 0 / 50%)'), [1, 0, 0, 0.5], 0);
  close(rgbOf('rgb(255 0 0/0.25)'), [1, 0, 0, 0.25], 0);
  close(rgbOf('rgba(255 0 0 / .5)'), [1, 0, 0, 0.5], 0);
  close(rgbOf('rgb(100% 0 50%)'), [1, 0, 0.5, 1], 1e-15);
  close(rgbOf('rgb(none 255 none)'), [0, 1, 0, 1], 0);
  close(rgbOf('rgb(255 0 0 / none)'), [1, 0, 0, 0], 0);
  close(rgbOf('rgb(\n255\t0 0 )'), [1, 0, 0, 1], 0);
});

test('rgb(): out-of-range channels and alpha clamp, as CSS does at parse time', () => {
  close(rgbOf('rgb(300 -10 0)'), [1, 0, 0, 1], 0);
  close(rgbOf('rgb(120% 0% 0% / 2)'), [1, 0, 0, 1], 0);
  close(rgbOf('rgba(0, 0, 0, -1)'), [0, 0, 0, 0], 0);
});

test('rgb(): malformed arguments are null', () => {
  for (const s of [
    'rgb()',
    'rgb(255 0)',
    'rgb(255 0 0 0)',
    'rgb(255, 0%, 0)', // legacy mixes numbers and percentages
    'rgb(255, 0, 0 / 0.5)',
    'rgb(255 0 0, 0.5)',
    'rgb(255, 0 0)',
    'rgb(none, 0, 0)', // none is modern-only
    'rgb(255,0,0,)',
    'rgb(,255,0,0)',
    'rgb(255 0 0 /)',
    'rgb(255 0 0 / 1 / 1)',
    'rgb(255 / 0 0)',
    'rgb(255deg 0 0)',
    'rgb(255px 0 0)',
    'rgb(255 0 0',
    'rgb 255 0 0',
    'rgb(255 0 0) red',
    'rgb(255 0 0))',
    'rgb(calc(255) 0 0)',
    'rgb(255 0 0 /* c */)',
    'rgb(from red r g b)',
    'rgb(1. 0 0)',
    'rgbx(255 0 0)',
    'rgb (255 0 0)',
  ]) {
    assert.equal(parseColor(s), null, s);
  }
});

// ── hsl() and hwb() ──────────────────────────────────────────────────────────────────────────────

test('hsl(): legacy and modern, hue units, clamped saturation', () => {
  close(rgbOf('hsl(0, 100%, 50%)'), [1, 0, 0, 1], 1e-12);
  close(rgbOf('hsl(120 100% 25%)'), [0, 0.5, 0, 1], 1e-12);
  close(rgbOf('hsl(120deg 100% 50%)'), [0, 1, 0, 1], 1e-12);
  close(rgbOf('hsl(0.5turn 100% 50%)'), [0, 1, 1, 1], 1e-12);
  close(rgbOf('hsl(200grad 100% 50%)'), [0, 1, 1, 1], 1e-12);
  close(rgbOf(`hsl(${Math.PI}rad 100% 50%)`), [0, 1, 1, 1], 1e-12);
  close(rgbOf('hsl(-120 100% 50%)'), [0, 0, 1, 1], 1e-12);
  close(rgbOf('hsl(480 100% 50%)'), [0, 1, 0, 1], 1e-12);
  close(rgbOf('hsla(240, 100%, 50%, 0.3)'), [0, 0, 1, 0.3], 1e-12);
  close(rgbOf('hsl(240 100 50 / 30%)'), [0, 0, 1, 0.3], 1e-12); // modern takes plain numbers
  close(rgbOf('hsl(none 0% 50%)'), [0.5, 0.5, 0.5, 1], 1e-12);
  close(rgbOf('hsl(0 -50% 50%)'), [0.5, 0.5, 0.5, 1], 1e-12);
  close(rgbOf('hsl(270 50% 40%)'), [0.4, 0.2, 0.6, 1], 1e-12); // rebeccapurple
  for (const s of ['hsl(120, 100, 50)', 'hsl(120, 100%, 50)', 'hsl(120%, 100%, 50%)', 'hsl(120 100% 50% 1)', 'hsl(120px 100% 50%)', 'hsl(120, none, 50%)']) {
    assert.equal(parseColor(s), null, s);
  }
});

test('hwb(): whiteness and blackness, normalized when they exceed 100%', () => {
  close(rgbOf('hwb(0 0% 0%)'), [1, 0, 0, 1], 0);
  close(rgbOf('hwb(120 0% 49.8039%)'), [0, 128 / 255, 0, 1], 1e-6); // green
  close(rgbOf('hwb(270 20% 40%)'), [0.4, 0.2, 0.6, 1], 1e-12); // rebeccapurple
  close(rgbOf('hwb(0 100% 0%)'), [1, 1, 1, 1], 0);
  close(rgbOf('hwb(0 60% 60%)'), [0.5, 0.5, 0.5, 1], 1e-12);
  close(rgbOf('hwb(90 0 100 / 0.5)'), [0, 0, 0, 0.5], 0);
  assert.equal(parseColor('hwb(0, 0%, 0%)'), null, 'hwb has no legacy syntax');
});

// ── lab(), lch(), oklab(), oklch() ─────────────────────────────────────────────────────────────

// [color, lab, lch, oklab, oklch], from the CSS Color 4 sample code
const REFERENCE: [string, number[], number[], number[], number[]][] = [
  ['red', [54.2905, 80.8049, 69.891], [54.2905, 106.8372, 40.8577], [0.627955, 0.224863, 0.125846], [0.627955, 0.257683, 29.23388]],
  ['green', [46.2777, -47.5524, 48.5863], [46.2777, 67.9842, 134.3839], [0.519752, -0.140302, 0.107676], [0.519752, 0.176858, 142.495345]],
  ['blue', [29.5683, 68.2874, -112.0297], [29.5683, 131.2014, 301.3643], [0.452014, -0.032457, -0.311528], [0.452014, 0.313214, 264.052023]],
  ['rebeccapurple', [32.3927, 38.423, -47.6911], [32.3927, 61.2435, 308.8571], [0.440272, 0.088177, -0.133864], [0.440272, 0.160296, 303.372988]],
  ['#ffcc00', [84.7597, 8.2409, 84.7909], [84.7597, 85.1904, 84.4488], [0.865209, -0.001178, 0.176824], [0.865209, 0.176828, 90.381556]],
];

test('lab/lch/oklab/oklch reference values land on their sRGB colors', () => {
  for (const [name, lab, lch, oklab, oklch] of REFERENCE) {
    const want = rgbOf(name);
    close(rgbOf(`lab(${lab.join(' ')})`), want, 2e-5, `lab ${name}`);
    close(rgbOf(`lch(${lch.join(' ')})`), want, 2e-5, `lch ${name}`);
    close(rgbOf(`oklab(${oklab.join(' ')})`), want, 2e-5, `oklab ${name}`);
    close(rgbOf(`oklch(${oklch.join(' ')})`), want, 2e-5, `oklch ${name}`);
    close(toOklch(parseColor(name)!), oklch, 1e-5, `toOklch ${name}`);
  }
});

test('the task examples: oklch(0.628 0.2577 29.23) and hwb(0 0% 0%) are red; lab(53.24 80.09 67.2) only nearly', () => {
  assert.equal(toHex(parseColor('oklch(0.628 0.2577 29.23)')!), '#ff0000');
  close(rgbOf('oklch(0.628 0.2577 29.23)'), [1, 0, 0, 1], 5e-4);
  assert.equal(toHex(parseColor('hwb(0 0% 0%)')!), '#ff0000');
  // 53.24 80.09 67.2 is red's Lab under D65. CSS lab() is D50 (red is lab(54.29 80.8 69.89)), so
  // this reads as a slightly darker red, as it does in browsers.
  close(rgbOf('lab(53.24 80.09 67.2)'), [0.98233544795921, -0.020057241584623853, 0.025915162237184507, 1], 1e-12);
  assert.equal(toHex(parseColor('lab(53.24 80.09 67.2)')!), '#fa0007');
  assert.equal(toHex(parseColor('lab(54.29 80.8 69.89)')!), '#ff0000');
});

test('lab/lch/oklab/oklch: percentages, none, clamping, and white/black', () => {
  close(rgbOf('lab(100 0 0)'), [1, 1, 1, 1], 1e-12);
  close(rgbOf('lab(100% 0 0)'), [1, 1, 1, 1], 1e-12);
  close(rgbOf('lab(150 0 0)'), [1, 1, 1, 1], 1e-12); // L clamps to 100
  close(rgbOf('lab(-5 0 0)'), [0, 0, 0, 1], 1e-12);
  close(rgbOf('lab(50 64.64% 55.9128%)'), rgbOf('lab(50 80.8 69.891)'), 1e-12); // 100% = 125
  close(rgbOf('lch(50 70% 40.8577)'), rgbOf('lch(50 105 40.8577)'), 1e-12); // 100% = 150
  close(rgbOf('lch(50 -10 40)'), rgbOf('lch(50 0 0)'), 1e-12); // chroma clamps at 0
  close(rgbOf('lch(50 30 0.5turn)'), rgbOf('lch(50 30 180)'), 1e-12);
  close(rgbOf('oklab(1 0 0)'), [1, 1, 1, 1], 1e-12);
  close(rgbOf('oklab(100% 0 0)'), [1, 1, 1, 1], 1e-12);
  close(rgbOf('oklab(0.5 50% -50%)'), rgbOf('oklab(0.5 0.2 -0.2)'), 1e-12); // 100% = 0.4
  close(rgbOf('oklch(62.7955% 64.42075% 29.23388)'), [1, 0, 0, 1], 1e-5);
  close(rgbOf('oklch(0 0 0)'), [0, 0, 0, 1], 1e-12);
  close(rgbOf('oklch(1 0 none)'), [1, 1, 1, 1], 1e-12);
  close(rgbOf('oklch(0.5 none 120 / 25%)'), rgbOf('oklch(0.5 0 0 / 0.25)'), 1e-12);
  close(rgbOf('OKLCH(0.5 0.1 120DEG)'), rgbOf('oklch(0.5 0.1 120)'), 0);
  close(rgbOf('lab(1e999 0 0)'), [1, 1, 1, 1], 1e-12); // a huge L clamps like any other
  for (const s of ['lab(50, 0, 0)', 'oklch(0.5, 0.1, 120)', 'lch(50 30 20%)', 'oklab(0.5deg 0 0)', 'oklch(0.5 0.1)', 'oklch(0.5 0.1 120 0.5)']) {
    assert.equal(parseColor(s), null, s);
  }
});

test('out-of-gamut colors keep their true, unclamped channels; clampRgb clips for display', () => {
  const c = parseColor('oklch(0.7 0.4 150)')!;
  close([c.r, c.g, c.b], [-0.6039537272288714, 0.8386540866488099, -0.3269410312499139], 1e-12);
  close(rgbOf('lab(50 -100 -100)'), [-0.8213302768966118, 0.6174083734612414, 1.150699799291283, 1], 1e-12);
  close(rgbOf('lch(60 200 300)'), [0.10078323095548009, 0.2368277763928633, 1.8366672857978175, 1], 1e-12);
  assert.deepEqual(clampRgb(c), { r: 0, g: c.g, b: 0 });
  assert.equal(toHex(c), '#00d600');
  assert.equal(formatColor(c, 'oklch'), 'oklch(0.7 0.4 150)');
});

// oklch() clamps L when read, so writing an OKLab L outside 0..1 wrote a different color (white
// came back cyan). Those are written clipped, as toHex shows them; Chromium renders the same hexes.
test('formatColor oklch: a color whose OKLab L is outside 0..1 is written clipped, as displayed', () => {
  const cases: [string, string, string][] = [
    ['hsl(0 100% 150%)', '#ffffff', 'oklch(1 0 0)'], // L 1.579 was written, read back as #00ffff
    ['lch(99.53545869793743 107.24855354055762 290.3135888557881)', '#e0ebff', 'oklch(0.9373 0.02979 263.44)'], // was #d8e1ff
    ['lab(0.3843 -7.3045 84.334)', '#230200', 'oklch(0.16636 0.0605 33.55)'], // L -0.076, was #3f0000
  ];
  for (const [src, hex, want] of cases) {
    const c = parseColor(src)!;
    assert.equal(toHex(c), hex, src);
    assert.equal(formatColor(c, 'oklch'), want, src);
    assert.equal(toHex(parseColor(want)!), hex, src);
  }
  // an exact L of 0 or 1 drifts past the bound in conversion; it must not be clipped for that
  for (const s of ['oklch(1 0.1 120)', 'oklch(0 0.2 30)', 'oklch(1 0.3 200 / 0.5)']) assert.equal(formatColor(parseColor(s)!, 'oklch'), s);
});

// ── output ───────────────────────────────────────────────────────────────────────────────────────

test('toHex: 6 digits, 8 with alpha (by default only when alpha < 1)', () => {
  const red = parseColor('red')!;
  const half = parseColor('rgb(255 0 0 / 0.5)')!;
  assert.equal(toHex(red), '#ff0000');
  assert.equal(toHex(red, true), '#ff0000ff');
  assert.equal(toHex(half), '#ff000080');
  assert.equal(toHex(half, false), '#ff0000');
  assert.equal(toHex(parseColor('hsl(120 100% 25%)')!), '#008000');
  assert.equal(toHex(parseColor('#ABCDEF')!), '#abcdef');
});

test('formatColor: each style, with and without alpha', () => {
  const red = parseColor('red')!;
  assert.equal(formatColor(red, 'hex'), '#ff0000');
  assert.equal(formatColor(red, 'rgb'), 'rgb(255, 0, 0)');
  assert.equal(formatColor(red, 'hsl'), 'hsl(0, 100%, 50%)');
  assert.equal(formatColor(red, 'oklch'), 'oklch(0.62796 0.25768 29.23)');
  const c = parseColor('rgba(51, 102, 153, 0.25)')!;
  assert.equal(formatColor(c, 'hex'), '#33669940');
  assert.equal(formatColor(c, 'rgb'), 'rgba(51, 102, 153, 0.25)');
  assert.equal(formatColor(c, 'hsl'), 'hsla(210, 50%, 40%, 0.25)');
  assert.equal(formatColor(c, 'oklch'), 'oklch(0.49931 0.09866 250.43 / 0.25)');
  // grays: no hue noise from conversion residue
  assert.equal(formatColor(parseColor('lab(100 0 0)')!, 'hsl'), 'hsl(0, 0%, 100%)');
  assert.equal(formatColor(parseColor('white')!, 'oklch'), 'oklch(1 0 0)');
  assert.equal(formatColor(parseColor('gray')!, 'oklch'), 'oklch(0.59987 0 0)');
});

test('property: every output style parses back to the same color', () => {
  const rnd = mulberry32(5);
  const tol = { hex: 0.5 / 255 + 1e-12, rgb: 0.005 / 255 + 1e-12, hsl: 0.1 / 255, oklch: 0.5 / 255 };
  for (let i = 0; i < 5000; i++) {
    const src = `rgb(${rnd() * 255} ${rnd() * 255} ${rnd() * 255} / ${rnd() < 0.5 ? 1 : rnd()})`;
    const c = parseColor(src)!;
    for (const style of ['hex', 'rgb', 'hsl', 'oklch'] as const) {
      const s = formatColor(c, style);
      assert.deepEqual(lineFindings(s), [], s);
      const back = parseColor(s);
      assert.ok(back, `${style}: ${s}`);
      close([back.r, back.g, back.b], [c.r, c.g, c.b], tol[style], `${style}: ${src} → ${s}`);
      assert.ok(Math.abs(back.alpha - c.alpha) <= (style === 'hex' ? 0.5 / 255 : 5e-4), `${style} alpha: ${s}`);
    }
  }
});

test('property: 8-bit colors keep their hex through every style', () => {
  const rnd = mulberry32(8);
  const byte = (): number => Math.floor(rnd() * 256);
  const corners = [0, 1, 254, 255].flatMap((r) => [0, 1, 254, 255].flatMap((g) => [0, 1, 254, 255].map((b) => [r, g, b])));
  const all = [...corners, ...Array.from({ length: 20000 }, () => [byte(), byte(), byte()])];
  for (const [r, g, b] of all) {
    const c = parseColor(`rgb(${r} ${g} ${b})`)!;
    for (const style of ['hex', 'rgb', 'hsl', 'oklch'] as const) {
      const s = formatColor(c, style);
      assert.equal(toHex(parseColor(s)!), toHex(c), `${toHex(c)} → ${s}`);
    }
  }
});

test('property: lab, lch and hsl colors, in gamut or far out, display the same through every style', () => {
  // Far outside sRGB (OKLab chroma up to ~1.6), 5-decimal oklch moves a displayed channel by up to
  // 0.66/255 (worst of 600k samples); the lossy-L bug moved them by 8/255 to 255/255.
  const rnd = mulberry32(9);
  const tol = { hex: 0.5 / 255 + 1e-12, rgb: 0.005 / 255 + 1e-12, hsl: 0.1 / 255, oklch: 1 / 255 };
  const gen = [
    () => `lab(${rnd() * 100} ${rnd() * 320 - 160} ${rnd() * 320 - 160})`,
    () => `lch(${rnd() * 100} ${rnd() * 230} ${rnd() * 360})`,
    () => `hsl(${rnd() * 360} ${rnd() * 100}% ${rnd() * 200 - 50}%)`,
  ];
  for (let i = 0; i < 6000; i++) {
    const src = gen[i % 3]();
    const c = parseColor(src)!;
    const shown = clampRgb(c);
    for (const style of ['hex', 'rgb', 'hsl', 'oklch'] as const) {
      const s = formatColor(c, style);
      const back = parseColor(s);
      assert.ok(back, `${style}: ${s}`);
      const b = clampRgb(back);
      close([b.r, b.g, b.b], [shown.r, shown.g, shown.b], tol[style], `${style}: ${src} → ${s}`);
    }
  }
});

test('property: oklch → sRGB → oklch is lossless, in gamut or not', () => {
  const rnd = mulberry32(6);
  for (let i = 0; i < 5000; i++) {
    const [l, ch, h] = [rnd(), rnd() * 0.4, rnd() * 360];
    const [l2, ch2, h2] = toOklch(parseColor(`oklch(${l} ${ch} ${h})`)!);
    close([l2, ch2], [l, ch], 1e-6, `oklch(${l} ${ch} ${h})`); // far outside sRGB the cube roots cost a few digits
    if (ch > 1e-6) assert.ok(Math.abs(((h2 - h + 540) % 360) - 180) < 1e-4, `hue of oklch(${l} ${ch} ${h})`);
  }
});

test('property: sRGB → lab/oklab text → sRGB round trips through every space', () => {
  const rnd = mulberry32(7);
  for (let i = 0; i < 2000; i++) {
    const c = parseColor(`rgb(${rnd() * 255} ${rnd() * 255} ${rnd() * 255})`)!;
    const [l, ch, h] = toOklch(c);
    const viaOklab = parseColor(`oklab(${l} ${ch * Math.cos((h * Math.PI) / 180)} ${ch * Math.sin((h * Math.PI) / 180)})`)!;
    close([viaOklab.r, viaOklab.g, viaOklab.b], [c.r, c.g, c.b], 1e-9, 'oklab');
  }
});

// ── paint ────────────────────────────────────────────────────────────────────────────────────────

test('parsePaint: none, colors, context paints', () => {
  assert.deepEqual(parsePaint('none'), { kind: 'none' });
  assert.deepEqual(parsePaint(' NONE '), { kind: 'none' });
  assert.deepEqual(parsePaint('context-fill'), { kind: 'context-fill' });
  assert.deepEqual(parsePaint('Context-Stroke'), { kind: 'context-stroke' });
  const p = parsePaint('#ff0000');
  assert.ok(p && p.kind === 'color');
  assert.equal(toHex(p.color), '#ff0000');
  const cur = parsePaint('currentColor');
  assert.ok(cur && cur.kind === 'color' && cur.color.kind === 'current');
  for (const s of ['', 'inherit', 'bogus', 'context-fil', 'url', 'rgb(1 2)']) assert.equal(parsePaint(s), null, s);
});

test('parsePaint: url(#id), quoted or not, with an optional fallback', () => {
  const url = (s: string) => {
    const p = parsePaint(s);
    return p && p.kind === 'url' ? { id: p.id, fallback: p.fallback === null || p.fallback === 'none' ? p.fallback : toHex(p.fallback) } : p;
  };
  assert.deepEqual(url('url(#grad)'), { id: 'grad', fallback: null });
  assert.deepEqual(url('url("#grad")'), { id: 'grad', fallback: null });
  assert.deepEqual(url("url('#grad')"), { id: 'grad', fallback: null });
  assert.deepEqual(url('url( #grad )'), { id: 'grad', fallback: null });
  assert.deepEqual(url('URL(#Grad-1.a_b)'), { id: 'Grad-1.a_b', fallback: null });
  assert.deepEqual(url('url("#a b")'), { id: 'a b', fallback: null });
  assert.deepEqual(url('url(#g) none'), { id: 'g', fallback: 'none' });
  assert.deepEqual(url('url(#g) red'), { id: 'g', fallback: '#ff0000' });
  assert.deepEqual(url('url(#g)  rgb(0 0 255 / 50%) '), { id: 'g', fallback: '#0000ff80' });
  const cur = parsePaint('url(#g) currentColor');
  assert.ok(cur && cur.kind === 'url' && cur.fallback !== null && cur.fallback !== 'none' && cur.fallback.kind === 'current');
  for (const s of [
    'url()',
    'url(#)',
    'url(grad)',
    'url(other.svg#grad)', // Draw never fetches another file's paint server
    'url(https://example.com/x.svg#g)',
    'url(#a b)',
    'url("#g)',
    'url(#g) bogus',
    'url(#g) red blue',
    'url(#g',
    'url (#g)',
  ]) {
    assert.equal(parsePaint(s), null, s);
  }
});

// Browsers percent-decode the fragment before matching an id: fill="url(#a%20b)" paints id="a b"
// in Chromium and never id="a%20b". Keeping the escapes pointed refs at the wrong def.
test('parsePaint: the url fragment is percent-decoded, as browsers match ids', () => {
  const id = (s: string) => {
    const p = parsePaint(s);
    return p && p.kind === 'url' ? p.id : p;
  };
  assert.equal(id('url(#a%20b)'), 'a b');
  assert.equal(id('url(#%C3%A9)'), 'é');
  assert.equal(id('url("#a%20b")'), 'a b');
  assert.equal(id('url(#100%25)'), '100%');
  assert.equal(id('url(#a+b)'), 'a+b');
  // malformed escapes, and a run that is not UTF-8, stay as written
  assert.equal(id('url(#a%zz)'), 'a%zz');
  assert.equal(id('url(#a%20b%)'), 'a b%');
  assert.equal(id('url(#%2)'), '%2');
  assert.equal(id('url(#%C3)'), '%C3');
});

// A 100 KB attribute of whitespace took 9 s (parseColor) and 31 s (parsePaint): the old trim regex
// and the url() regex backtracked quadratically. Linear parsing does each in about a millisecond.
test('parsing is linear: 1e5-space values of every shape finish fast', () => {
  const sp = ' '.repeat(1e5);
  const cases: [string, () => unknown][] = [
    ['color: a sp b', () => parseColor('a' + sp + 'b')],
    ['color: red sp x', () => parseColor('red' + sp + 'x')],
    ['color: sp red sp', () => parseColor(sp + 'red' + sp)],
    ['color: rgb( sp )', () => parseColor('rgb(' + sp + ')')],
    ['color: rgb(1 sp x)', () => parseColor('rgb(1' + sp + 'x)')],
    ['paint: url( sp "', () => parsePaint('url(' + sp + '"')],
    ["paint: url( sp '", () => parsePaint('url(' + sp + "'")],
    ['paint: url( sp', () => parsePaint('url(' + sp)],
    ['paint: url(#g sp x', () => parsePaint('url(#g' + sp + 'x')],
    ['paint: url( sp "#g" sp x', () => parsePaint('url(' + sp + '"#g"' + sp + 'x')],
    ['paint: url(#g) sp red sp x', () => parsePaint('url(#g)' + sp + 'red' + sp + 'x')],
    ['paint: url(#%41…)', () => parsePaint('url(#' + '%41'.repeat(1e5) + ')')],
  ];
  for (const [label, run] of cases) {
    const t = performance.now();
    run();
    const ms = performance.now() - t;
    assert.ok(ms < 100, `${label}: ${ms.toFixed(0)} ms`);
  }
});
