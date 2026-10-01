// Decision probe for the plan's M2 gate: render documents in a shadow root, or fall back to
// prefixing ids in the light DOM? Draw renders each document into an open ShadowRoot so its ids
// and <style> can't collide with the app's. That only works if same-document references (url(#…),
// href="#…") resolve against the shadow tree exactly as they do in a normal document, and the plan
// flags WebKit as the risk. So on the real /draw/ page, under its CSP, every feature below is
// rendered twice into its own 40×40 box: once in a shadow root and once in the light DOM with
// different ids (the control). Pixel colours are read from one screenshot.
//
// The gate: throw if any feature that works in the light-DOM control fails in the shadow root.
// Chromium runs it here; CI's WebKit run decides. A row whose control fails too proves nothing, so
// that throws as inconclusive (unless the engine is listed in KNOWN_UNSUPPORTED), and so does any
// CSP violation while the probe renders. Four rows test isolation rather than resolution; for
// those the control shows the page-side rule, colour or element is live, so its absence inside (or
// outside) the shadow tree means isolation, not a rule that never applied. The shadow host carries
// the app's .draw-host class, so the inherited-style row tests the canvas as the app hosts it.
//
// Known shadow-root gaps are reported, not gated, in the engines listed for them (a case's `gap`),
// and gated like any other row everywhere else: a document's own @font-face does not register in a
// shadow tree in Chromium (the probe shows it). The decision (P1-M4): Draw registers a document's
// own data: faces on document.fonts (src/platform/fonts.ts), so both engines draw them; this row
// still tests the engine, not Draw, so Chromium's gap stays known here. WebKit, the phone's
// engine, must pass every row.

import { readFileSync } from 'node:fs';
import { decodePng } from './probe-helpers/png.mjs';

const LIME = [0, 255, 0], BLUE = [0, 0, 255], WHITE = [255, 255, 255];
const NAMED = { lime: LIME, blue: BLUE, white: WHITE, black: [0, 0, 0], red: [255, 0, 0] };
const TOLERANCE = 60; // per channel: antialiasing and colour management, not a different colour
// Features whose light-DOM control fails in an engine by design (none today): listed here, they
// are reported instead of making the probe inconclusive.
const KNOWN_UNSUPPORTED = { chromium: [], webkit: [] };
// A font the repo already vendors, as a data: URL a document could embed.
const FONT = `data:font/woff2;base64,${readFileSync(new URL('../../svg-lab/fonts/ibm-plex-mono-latin-500.woff2', import.meta.url)).toString('base64')}`;

const BOX = { width: 40, height: 40 };
const HALF = { width: 20, height: 40 }; // the left half of a box
const LEFT_LIME = [[10, 20, LIME], [30, 20, WHITE]];
const LIME_BLUE = [[10, 20, LIME], [30, 20, BLUE]];
const RADIAL = [[20, 20, LIME], [3, 20, BLUE]];
const RULE_IN = 'probe-page-rule', RULE_OUT = 'probe-shadow-rule', DUP = 'probe-dup';
const PAGE_STYLE = `.${RULE_IN}{fill:blue}`;

// A hard stop halfway: lime before it, blue after, so two samples prove the gradient's geometry.
const stops = () => [['stop', { offset: 0.5, 'stop-color': 'lime' }], ['stop', { offset: 0.5, 'stop-color': 'blue' }]];
const line = (paint) => ['line', { x1: 0, y1: 20, x2: 40, y2: 20, stroke: paint, 'stroke-width': 16 }];
const url = (id) => `url(#${id})`;

// build(id, side) returns the children of the case's <svg>; id() makes ids unique per case and
// side. samples are [x, y, colour, box?] (control, when present, replaces them for the control);
// box names the side to read when it isn't the case's own. Every probe <svg> is paused at t=2s, so
// the SMIL rows sample a fixed frame.
const CASES = [
  { feature: 'fill url(#linearGradient)', samples: LIME_BLUE,
    build: (id) => [['linearGradient', { id: id('g') }, ...stops()], ['rect', { ...BOX, fill: url(id('g')) }]] },
  { feature: 'stroke url(#linearGradient)', samples: LIME_BLUE,
    build: (id) => [['linearGradient', { id: id('g'), gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 40, y2: 0 }, ...stops()], line(url(id('g')))] },
  { feature: 'fill url(#radialGradient)', samples: RADIAL,
    build: (id) => [['radialGradient', { id: id('g') }, ...stops()], ['rect', { ...BOX, fill: url(id('g')) }]] },
  { feature: 'stroke url(#radialGradient)', samples: RADIAL,
    build: (id) => [['radialGradient', { id: id('g'), gradientUnits: 'userSpaceOnUse', cx: 20, cy: 20, r: 20 }, ...stops()], line(url(id('g')))] },
  { feature: 'fill url(#pattern)', samples: [[5, 20, LIME], [15, 20, BLUE]],
    build: (id) => [
      ['pattern', { id: id('p'), patternUnits: 'userSpaceOnUse', width: 20, height: 40 },
        ['rect', { width: 10, height: 40, fill: 'lime' }], ['rect', { x: 10, width: 10, height: 40, fill: 'blue' }]],
      ['rect', { ...BOX, fill: url(id('p')) }]] },
  { feature: 'clip-path url(#clipPath)', samples: LEFT_LIME,
    build: (id) => [['clipPath', { id: id('c') }, ['rect', HALF]], ['rect', { ...BOX, fill: 'lime', 'clip-path': url(id('c')) }]] },
  { feature: 'mask url(#mask)', samples: LEFT_LIME,
    build: (id) => [['mask', { id: id('m') }, ['rect', { ...HALF, fill: 'white' }]], ['rect', { ...BOX, fill: 'lime', mask: url(id('m')) }]] },
  { feature: 'filter url(#filter) (feFlood)', samples: LEFT_LIME,
    build: (id) => [
      ['filter', { id: id('f'), filterUnits: 'userSpaceOnUse', x: 0, y: 0, ...HALF }, ['feFlood', { 'flood-color': 'lime' }]],
      ['rect', { ...BOX, fill: 'blue', filter: url(id('f')) }]] },
  { feature: 'marker-end url(#marker)', samples: [[30, 20, LIME], [10, 20, BLUE]],
    build: (id) => [
      ['marker', { id: id('m'), markerUnits: 'userSpaceOnUse', markerWidth: 16, markerHeight: 16, refX: 0, refY: 8 },
        ['rect', { width: 16, height: 16, fill: 'lime' }]],
      ['line', { x1: 2, y1: 20, x2: 22, y2: 20, stroke: 'blue', 'stroke-width': 4, 'marker-end': url(id('m')) }]] },
  { feature: '<use href="#symbol">', samples: LIME_BLUE,
    build: (id) => [
      ['symbol', { id: id('s'), viewBox: '0 0 40 40' }, ['rect', { ...HALF, fill: 'lime' }], ['rect', { ...HALF, x: 20, fill: 'blue' }]],
      ['use', { href: `#${id('s')}`, ...BOX }]] },
  { feature: '<use href="#element">', samples: LEFT_LIME,
    build: (id) => [['defs', {}, ['rect', { id: id('r'), ...HALF, fill: 'lime' }]], ['use', { href: `#${id('r')}` }]] },
  { feature: '<use xlink:href="#element">', samples: LEFT_LIME,
    build: (id) => [['defs', {}, ['rect', { id: id('r'), ...HALF, fill: 'lime' }]], ['use', { 'xlink:href': `#${id('r')}` }]] },
  { feature: '<feImage href="#element">', samples: LEFT_LIME,
    build: (id) => [
      ['defs', {}, ['rect', { id: id('r'), ...HALF, fill: 'lime' }]],
      ['filter', { id: id('f'), filterUnits: 'userSpaceOnUse', x: 0, y: 0, ...BOX }, ['feImage', { href: `#${id('r')}` }]],
      ['rect', { ...BOX, fill: 'blue', filter: url(id('f')) }]] },
  // Laid out along a vertical path at x=20, the glyphs step down instead of across.
  { feature: '<textPath href="#path">', textPath: true,
    build: (id) => [
      ['defs', {}, ['path', { id: id('p'), d: 'M20 2V40' }]],
      ['text', { 'font-size': 8, fill: 'lime' }, ['textPath', { href: `#${id('p')}` }, 'IIII']]] },
  { feature: '<style> styles the tree it is in', samples: [[20, 20, LIME]],
    build: (id) => [['style', {}, `.${id('k')}{fill:lime}`], ['rect', { ...BOX, class: id('k'), fill: 'blue' }]] },
  { feature: 'fill url(#…) from a <style> rule', samples: LIME_BLUE,
    build: (id) => [['style', {}, `.${id('k')}{fill:url(#${id('g')})}`], ['linearGradient', { id: id('g') }, ...stops()], ['rect', { ...BOX, class: id('k') }]] },
  // SMIL references are id lookups too (values, not from/to: the sink drops from/to). At t=2s:
  { feature: '<animate href="#element">', samples: [[30, 20, LIME]],
    build: (id) => [['rect', { id: id('r'), width: 10, height: 40, fill: 'lime' }], ['animate', { href: `#${id('r')}`, attributeName: 'width', values: '40;40', dur: '10s' }]] },
  { feature: '<animateMotion><mpath href="#path">', samples: [[25, 20, LIME], [5, 5, WHITE]],
    build: (id) => [
      ['path', { id: id('p'), d: 'M0 15H40', fill: 'none' }],
      ['rect', { width: 10, height: 10, fill: 'lime' },
        ['animateMotion', { dur: '10s', keyPoints: '0.5;0.5', keyTimes: '0;1', calcMode: 'linear' }, ['mpath', { href: `#${id('p')}` }]]]] },
  // (SMIL reads a '-' in "id.end" as an offset, so this id has none.)
  { feature: 'SMIL begin="id.end"', samples: [[30, 20, LIME]],
    build: (id) => [['rect', { width: 10, height: 40, fill: 'lime' },
      ['animate', { id: id('a').replace('-', '_'), attributeName: 'width', values: '20;20', dur: '1s' }],
      ['animate', { attributeName: 'width', values: '40;40', begin: `${id('a').replace('-', '_')}.end`, dur: '10s' }]]] },
  // A known gap in Chromium (reported there, gated elsewhere): the document's own face, measured
  // against the serif fallback.
  { feature: "@font-face in the document's <style>", gap: ['chromium'], font: true,
    build: (id) => [
      ['style', {}, `@font-face{font-family:${id('f')};src:url(${FONT})}`],
      ['text', { y: 20, 'font-size': 10, 'font-family': `${id('f')}, serif` }, 'iiii'],
      ['text', { y: 36, 'font-size': 10, 'font-family': 'serif' }, 'iiii']] },
  // Isolation. Control: the page's rule styles a light-DOM element. Shadow: it doesn't reach in.
  { feature: 'page style rules do not match inside', isolation: true, samples: [[20, 20, LIME]], control: [[20, 20, BLUE]],
    build: () => [['rect', { ...BOX, class: RULE_IN, fill: 'lime' }]] },
  // Control: the page's colour (blue on the probe overlay) reaches a light-DOM currentColor. Shadow:
  // the canvas host resets inherited styles, so currentColor is the initial black.
  { feature: 'inherited page styles stop at the canvas host', isolation: true, samples: [[20, 20, NAMED.black]], control: [[20, 20, BLUE]],
    build: () => [['rect', { ...BOX, fill: 'currentColor' }]] },
  // Control: the shadow tree's rule styles its own element. Shadow: the page's element with the
  // same class (in the control box) keeps its own fill.
  { feature: 'shadow styles do not leak out', isolation: true, samples: [[20, 20, LIME, 'control']], control: [[20, 20, BLUE, 'shadow']],
    build: (id, side) => [...(side === 'shadow' ? [['style', {}, `.${RULE_OUT}{fill:blue}`]] : []), ['rect', { ...BOX, class: RULE_OUT, fill: 'lime' }]] },
  // Control: the page's own element with this id is live. Shadow: its own id wins over the page's.
  { feature: 'ids resolve in the shadow tree first', isolation: true, samples: [[20, 20, LIME]], control: [[20, 20, BLUE]],
    build: (id, side) => [['linearGradient', { id: DUP }, ['stop', { 'stop-color': side === 'shadow' ? 'lime' : 'blue' }]], ['rect', { ...BOX, fill: url(DUP) }]] },
];

export const FEATURES = CASES.map((c) => c.feature);

export default async function probe({ browser, origin }) {
  const started = performance.now();
  const name = `${browser.browserType().name()} ${browser.version()}`;
  const context = await browser.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/draw/`, { waitUntil: 'networkidle' });
    const specs = (side) => CASES.map((c, i) => ['svg', { ...BOX }, ...c.build((n) => `${side[0]}${i}-${n}`, side)]);
    const layout = await page.evaluate(render, { shadow: specs('shadow'), control: specs('control'), pageStyle: PAGE_STYLE });
    const shot = decodePng(await page.screenshot({ clip: { x: 0, y: 0, width: 440, height: layout.bottom } }));

    const judge = (c, i, side) => {
      if (c.textPath) return alongPath(layout.text[side][i]);
      if (c.font) return ownFace(layout.fonts[side][i]);
      const got = (c[side] ?? c.samples).map(([x, y, want, box = side]) => {
        const [left, top] = layout.boxes[box][i];
        const rgb = shot.rgb(Math.round(left + x), Math.round(top + y));
        return { ok: near(rgb, want), name: colourName(rgb) };
      });
      return { ok: got.every((g) => g.ok), detail: got.map((g) => g.name).join(',') };
    };
    const rows = CASES.map((c, i) => ({ ...c, shadow: judge(c, i, 'shadow'), control: judge(c, i, 'control') }));

    const cell = (r) => `${r.ok ? 'ok' : 'FAIL'} (${r.detail})`;
    const cols = (...c) => `  ${c[0].padEnd(name.length + 2)}${c[1].padEnd(46)}${c[2].padEnd(32)}${c[3]}`;
    console.log(`\nprobe-shadow: ${name}, ${CASES.length} features, ${Math.round(performance.now() - started)} ms`);
    console.log(cols('browser', 'feature', 'shadow root', 'light-DOM control'));
    for (const r of rows) console.log(cols(name, r.feature, cell(r.shadow), cell(r.control)));
    const features = (pick) => rows.filter(pick).map((r) => r.feature);
    const engine = browser.browserType().name();
    const known = (r) => (r.gap ?? []).includes(engine); // a known gap in this engine
    const gaps = features((r) => known(r) && r.control.ok && !r.shadow.ok);
    if (gaps.length) console.log(`  known shadow-root gaps in ${engine} (reported, not gated): ${gaps.join('; ')}`);

    const unsupported = KNOWN_UNSUPPORTED[engine] ?? [];
    const inconclusive = features((r) => !r.control.ok && !unsupported.includes(r.feature));
    if (inconclusive.length) throw new Error(`probe inconclusive in ${name}: the light-DOM control fails ${inconclusive.join('; ')}`);
    if (layout.violations.length) throw new Error(`probe: CSP violations in ${name}: ${layout.violations.join(', ')}`);
    const leaks = features((r) => r.isolation && r.control.ok && !r.shadow.ok);
    if (leaks.length) throw new Error(`the canvas is not isolated in ${name}: ${leaks.join('; ')}`);
    const broken = features((r) => !r.isolation && !known(r) && r.control.ok && !r.shadow.ok);
    if (broken.length) {
      throw new Error(`shadow root breaks ${broken.length} feature(s) that work in the light DOM in ${name}: ${broken.join('; ')}. M2 gate: use the light-DOM id-prefix fallback.`);
    }
  } finally {
    await context.close();
  }
}

// Runs in the page. Builds each case's tree with DOM calls (the way the render sink will), lays
// the shadow grid over the control grid in a white overlay, and returns where each box landed.
async function render({ shadow, control, pageStyle }) {
  const SVG = 'http://www.w3.org/2000/svg', XLINK = 'http://www.w3.org/1999/xlink';
  const build = ([tag, attrs, ...kids]) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('xlink:')) el.setAttributeNS(XLINK, k, String(v));
      else el.setAttribute(k, String(v));
    }
    for (const kid of kids) el.append(typeof kid === 'string' ? kid : build(kid));
    return el;
  };
  const violations = [];
  document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective));
  const rule = document.createElement('style');
  rule.textContent = pageStyle;
  document.head.append(rule);

  const div = (css) => Object.assign(document.createElement('div'), { style: css });
  const overlay = div('position:fixed;top:0;left:0;z-index:2147483647;box-sizing:border-box;width:440px;padding:2px;background:#fff;color:blue;display:grid;gap:8px');
  const host = div('display:flex;flex-wrap:wrap;gap:4px');
  host.className = 'draw-host';
  const light = div('display:flex;flex-wrap:wrap;gap:4px');
  overlay.append(host, light);
  document.body.append(overlay);
  const root = host.attachShadow({ mode: 'open' });
  root.append(...shadow.map(build));
  light.append(...control.map(build));
  for (const svg of [...root.children, ...light.children]) {
    svg.pauseAnimations();
    svg.setCurrentTime(2);
  }
  // Let any face the documents declare load before text is measured.
  for (const t of [...root.querySelectorAll('text'), ...light.querySelectorAll('text')]) t.getComputedTextLength();
  await document.fonts.ready;

  const corner = (svg) => {
    const b = svg.getBoundingClientRect();
    return [b.left, b.top];
  };
  const text = (svg) => {
    const t = svg.querySelector('text');
    if (!t || !svg.querySelector('textPath')) return null;
    try {
      const [a, b] = [t.getStartPositionOfChar(0), t.getStartPositionOfChar(2)];
      return { x0: a.x, y0: a.y, x2: b.x, y2: b.y, length: t.getComputedTextLength() };
    } catch (e) {
      return { error: e.name };
    }
  };
  const font = (svg) => {
    const [own, fallback] = svg.querySelectorAll('text');
    return own && fallback ? { own: own.getComputedTextLength(), fallback: fallback.getComputedTextLength() } : null;
  };
  return {
    boxes: { shadow: [...root.children].map(corner), control: [...light.children].map(corner) },
    text: { shadow: [...root.children].map(text), control: [...light.children].map(text) },
    fonts: { shadow: [...root.children].map(font), control: [...light.children].map(font) },
    bottom: Math.ceil(overlay.getBoundingClientRect().bottom),
    violations,
  };
}

function alongPath(m) {
  if (!m || m.error) return { ok: false, detail: m?.error ?? 'no text' };
  const ok = m.length > 0 && Math.abs(m.x0 - 20) < 1.5 && Math.abs(m.x2 - 20) < 1.5 && m.y2 - m.y0 > 2;
  const r = (v) => Math.round(v * 10) / 10;
  return { ok, detail: `glyphs at ${r(m.x0)},${r(m.y0)} → ${r(m.x2)},${r(m.y2)}` };
}

// The document's monospace face draws 'iiii' far wider than the serif fallback does.
function ownFace(m) {
  if (!m) return { ok: false, detail: 'no text' };
  const r = (v) => Math.round(v * 10) / 10;
  return { ok: m.own > m.fallback * 1.5, detail: `${r(m.own)} vs serif ${r(m.fallback)}` };
}

const near = (rgb, want) => rgb.every((v, k) => Math.abs(v - want[k]) <= TOLERANCE);
const colourName = (rgb) => Object.keys(NAMED).find((n) => near(rgb, NAMED[n])) ?? `rgb(${rgb.join(' ')})`;
