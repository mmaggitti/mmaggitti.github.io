// Draw end-to-end test, run by scripts/smoke-test.mjs against the built site (Chromium in the
// cloud container, WebKit in CI). Throws on the first failure.
//
// P0-M0 covers the rails: the CSP backstop, staying off the launcher and the Studio picker, the
// served (empty) library index, and the phone rules. P0-M2 adds the canvas: the sample renders
// whole and where it should, every file in the round-trip corpus renders (and only what the
// ledger's tables allow, with nothing leaving the page), the edges of the policy (DOMPurify's
// second opinion, SMIL judged against the element the browser animates, <switch>, refused roots),
// the canvas drawing each static corpus file exactly as the file looks on its own in light and
// dark, the document's CSS staying inside the canvas, reduced motion, keyed patching
// (renderer-patch.mjs) and the shadow-root probe. Later milestones add the code panel, files and
// drafts.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILE_VERSION } from '../../../scripts/lib/svg-profile.mjs';
import { RENDER_SVG_ATTRIBUTES, RENDER_SVG_ELEMENTS, RENDER_XHTML_ATTRIBUTES, RENDER_XHTML_ELEMENTS } from '../../../engine/policy/tables.ts';
import probe from './probe-shadow.mjs';
import rendererPatch from './renderer-patch.mjs';
import { decodePng } from './probe-helpers/png.mjs';

const PHONE = { deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const TAP_MIN = 44;
const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '../../../engine/test/fixtures/corpus');
const SAMPLE = readFileSync(join(HERE, '../src/canvas/sample.svg'), 'utf8');
const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
// The generated tables, as the page checks them (Maps travel as entry lists).
const TABLES = {
  svgElements: [...RENDER_SVG_ELEMENTS],
  xhtmlElements: [...RENDER_XHTML_ELEMENTS],
  svgAttributes: [...RENDER_SVG_ATTRIBUTES],
  xhtmlAttributes: [...RENDER_XHTML_ATTRIBUTES],
};

// Every check runs even after one fails, and the run fails with all their messages: WebKit runs
// only in CI, so one run should show everything it disagrees with.
export default async function run({ browser, origin }) {
  const failures = [];
  const check = async (fn, ...args) => {
    try {
      await fn(browser, origin, ...args);
    } catch (e) {
      failures.push(`${fn.name}${args.length ? ` (${args.join(', ')})` : ''}: ${e.message}`);
    }
  };
  await check(cspIsFirstAndEnforced);
  await check(unlistedAndNeverFramed);
  await check(libraryIndexServed);
  for (const height of [956, 796]) await check(phoneRules, height);
  await check(sampleRenders);
  await check(corpusStaysInert);
  await check(policyEdges);
  await check(moreEdges);
  await check(canvasIgnoresTheTheme);
  for (const colorScheme of ['light', 'dark']) await check(corpusLooksAsItDoesAlone, colorScheme);
  await check(documentCssStaysInside);
  await check(reducedMotionStopsAnimation);
  await check(function rendererPatchCases(b, o) { return rendererPatch({ browser: b, origin: o }); });
  await check(function shadowRootProbe(b, o) { return probe({ browser: b, origin: o }); });
  if (failures.length) throw new Error(`${failures.length} check(s) failed:\n${failures.join('\n')}`);
}

// The meta CSP is the first element in <head>, so nothing before it can run, and it blocks an
// inline handler that slipped into the page (the backstop behind the render sink).
async function cspIsFirstAndEnforced(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const first = await page.evaluate(() => {
      const el = document.head.firstElementChild;
      return el ? `${el.tagName.toLowerCase()} ${el.getAttribute('http-equiv') ?? ''}` : 'none';
    });
    must(first === 'meta Content-Security-Policy', `first element in <head> is "${first}", not the CSP meta`);
    const csp = await page.evaluate(() => document.head.firstElementChild.getAttribute('content'));
    for (const d of ["script-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "connect-src 'self' https://api.github.com"]) {
      must(csp.includes(d), `CSP lacks ${d}`);
    }
    must(errors.length === 0, `errors on load:\n${errors.join('\n')}`);

    const r = await page.evaluate(async () => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective));
      const img = document.createElement('img');
      img.setAttribute('onerror', 'window.__pwned = "img"');
      img.src = 'data:image/png;base64,broken';
      document.body.append(img);
      const s = document.createElement('script');
      s.textContent = 'window.__pwned = "script"';
      document.body.append(s);
      await new Promise((ok) => setTimeout(ok, 300));
      return { pwned: window.__pwned ?? null, violations };
    });
    must(r.pwned === null, `the CSP let injected script run (${r.pwned})`);
    must(r.violations.some((v) => v.startsWith('script-src')), `no script-src violation was reported (${r.violations.join(', ') || 'none'})`);
  });
}

// Draw is live for testing but not on the launcher, and never offered to the Studio's frame picker
// (an editor that will hold a GitHub token must not run inside another page's frame).
async function unlistedAndNeverFramed(browser, origin) {
  await withPage(browser, origin, 956, async (page) => {
    const launcher = await page.evaluate(async () => (await fetch('/')).text());
    // The launcher links relatively (href="draw/"); match any spelling of the link.
    must(!/href="(?:\.?\/)?draw\/?"/.test(launcher), 'the launcher lists Draw before its release');
    must(/href="(?:\.?\/)?hello\/?"/.test(launcher), 'test setup: the launcher link pattern no longer matches a listed project');
    const pages = await page.evaluate(async () => (await fetch('/pages.json')).json());
    must(!pages.some((p) => p.path === '/draw/'), 'pages.json offers /draw/ to the Studio picker');
  });
}

async function libraryIndexServed(browser, origin) {
  await withPage(browser, origin, 956, async (page) => {
    const idx = await page.evaluate(async () => (await fetch('/draw/library/index.json', { cache: 'no-store' })).json());
    must(idx.profileVersion === PROFILE_VERSION && Array.isArray(idx.items), `bad library index: ${JSON.stringify(idx)}`);
  });
}

// The tap floor, 16px fields and no sideways scroll, plus the canvas filling what the bar leaves:
// below the bar, inside the screen, the drawing's root filling the host, and no page scroll.
async function phoneRules(browser, origin, height) {
  await withPage(browser, origin, height, async (page, errors) => {
    const r = await page.evaluate((min) => {
      const small = [];
      for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')) {
        const b = el.getBoundingClientRect();
        if (b.width && b.height && (b.width < min - 0.5 || b.height < min - 0.5)) small.push(`${el.tagName} ${Math.round(b.width)}×${Math.round(b.height)}`);
      }
      const fields = [...document.querySelectorAll('input, textarea, select')].filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).length;
      const box = (el) => el && el.getBoundingClientRect().toJSON();
      const host = document.querySelector('.draw-host');
      const de = document.documentElement;
      return {
        small, fields, sw: de.scrollWidth, cw: de.clientWidth, sh: de.scrollHeight, ch: de.clientHeight,
        bar: box(document.querySelector('.draw-bar')), host: box(host), svg: box(host?.shadowRoot?.querySelector('svg')),
      };
    }, TAP_MIN);
    must(r.small.length === 0, `440×${height}: tap targets under ${TAP_MIN}pt: ${r.small.join(', ')}`);
    must(r.fields === 0, `440×${height}: ${r.fields} field(s) under 16px`);
    must(r.sw <= r.cw, `440×${height}: scrolls sideways (${r.sw} > ${r.cw})`);
    must(r.sh <= r.ch, `440×${height}: the page scrolls (${r.sh} > ${r.ch}); the canvas should take exactly what is left`);
    must(r.bar && r.host && r.svg, `440×${height}: no bar, canvas host or rendered <svg>`);
    must(r.host.top >= r.bar.bottom - 0.5 && r.host.bottom <= r.ch + 0.5 && r.host.left >= 0 && r.host.right <= r.cw + 0.5, `440×${height}: the canvas host ${rect(r.host)} is not between the bar and the bottom of the screen`);
    must(r.host.height > r.ch / 2, `440×${height}: the canvas is only ${Math.round(r.host.height)} tall`);
    must(same(r.svg, r.host), `440×${height}: the rendered <svg> ${rect(r.svg)} doesn't fill the host ${rect(r.host)}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The built-in sample: every element and attribute in its source reaches the shadow root, and the
// viewBox is fitted into the host (meet, centred), so its circle lands exactly where the geometry
// says. Its paint comes through the sink too: inside the frame the sky gradient shows, and in the
// frame's rounded corner, clipped away, the paper does.
async function sampleRenders(browser, origin) {
  const [vw, vh] = /viewBox="0 0 (\d+) (\d+)"/.exec(SAMPLE).slice(1).map(Number);
  const [cx, cy, radius] = /<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/.exec(SAMPLE).slice(1).map(Number);
  const names = [...SAMPLE.matchAll(/<([A-Za-z]+)/g)].map((m) => m[1]);
  await withPage(browser, origin, 956, async (page, errors) => {
    const stats = await page.evaluate((t) => window.drawTest.render(t), SAMPLE);
    must(stats.ok && stats.skippedElements === 0 && stats.droppedAttributes === 0, `the sample lost part of itself: ${JSON.stringify(stats)}`);
    const r = await page.evaluate(() => {
      const host = document.querySelector('.draw-host');
      const root = host?.shadowRoot;
      const svg = root?.firstElementChild;
      if (!svg) return null;
      return {
        mode: root.mode,
        root: `${svg.namespaceURI} ${svg.localName}`,
        names: [svg, ...svg.querySelectorAll('*')].map((e) => e.localName),
        host: host.getBoundingClientRect().toJSON(),
        circle: root.querySelector('circle').getBoundingClientRect().toJSON(),
        violations: window.__violations,
      };
    });
    must(r, 'the canvas host has no shadow root, or nothing in it');
    must(r.mode === 'open' && r.root === `${SVG_NS} svg`, `the canvas holds ${r.root} in a ${r.mode} shadow root`);
    must(r.names.join() === names.join(), `the sample rendered <${r.names.join('> <')}>, not <${names.join('> <')}>`);
    const k = Math.min(r.host.width / vw, r.host.height / vh);
    const want = { x: r.host.x + (r.host.width - vw * k) / 2 + (cx - radius) * k, y: r.host.y + (r.host.height - vh * k) / 2 + (cy - radius) * k, width: 2 * radius * k, height: 2 * radius * k };
    must(same(r.circle, want), `the sample's circle draws at ${rect(r.circle)}, not ${rect(want)}`);
    const shot = decodePng(await page.screenshot());
    const at = (x, y) => shot.rgb(Math.round(r.host.x + (r.host.width - vw * k) / 2 + x * k), Math.round(r.host.y + (r.host.height - vh * k) / 2 + y * k));
    const [top, middle, corner] = [at(160, 30), at(150, 100), at(18, 18)];
    must(top[2] > top[0] + 20 && top[0] + top[1] + top[2] < 300, `the sky is not dark blue at its top (rgb ${top}): is fill="url(#sky)" still drawn?`);
    must(middle[0] > middle[2] + 40, `the sky is not warm lower down (rgb ${middle}): is fill="url(#sky)" still drawn?`);
    must(corner.every((v) => v > 230), `the frame's rounded corner shows rgb ${corner}, not the paper: is clip-path="url(#frame)" still drawn?`);
    must(r.violations.length === 0, `CSP violations: ${r.violations.join(', ')}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Every corpus file (SVG Lab's exports with <script>, iframe, audio and canvas among them) opens
// through drawTest, and what reaches the shadow root is only what the tables render: allowed
// elements, allowed attributes, no handlers, URLs that stay in the document, SMIL only on
// attributes that render on its target. Across the run nothing loads from anywhere else, nothing
// violates the CSP, and nothing throws, opens a dialog or navigates.
async function corpusStaysInert(browser, origin) {
  const files = corpusFiles();
  must(files.length >= 250, `the corpus check found only ${files.length} files in ${CORPUS}`);
  await withPage(browser, origin, 956, async (page, errors, context) => {
    const quiet = watch(page, context, origin);
    const r = await page.evaluate(renderEach, { files, tables: TABLES });
    must(r.checked === files.length, `the corpus check inspected ${r.checked} of ${files.length} files`);
    must(r.failed === 0, `${r.failed} problem(s) on the canvas${r.failed > r.failures.length ? ` (first ${r.failures.length})` : ''}:\n${r.failures.join('\n')}`);
    must(r.rendered >= 1500, `the corpus drew only ${r.rendered} elements`);
    await quiet('corpus');
    must(errors.length === 0, `errors while rendering the corpus:\n${errors.join('\n')}`);
  });
}

// Ordinary content at the policy's edges, and its fate. The ledger renders three attributes that
// DOMPurify refuses: a data: image on feImage, and SMIL from/to. An id that names a document
// property (title) is kept: DOMPurify's SANITIZE_DOM is off. The policy refuses the rest: a <style>
// with a url() to another file, the same in a style attribute, an image and a <use> pointing
// outside the document, a <set> of an attribute the tables don't render (cursor), and an animation
// of r on a rect (r renders on circles, not rects). An animation of r whose href names a circle
// renders: it is judged against its target, not its parent.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const EDGES = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">
  <style>.far { fill: url(other.svg#a) }</style>
  <rect id="title" class="near" width="10" height="10"/>
  <filter id="f"><feImage width="10" href="data:image/png;base64,${PNG}"/></filter>
  <circle r="5"><animate attributeName="opacity" from="1" to="0.5" dur="1s"/><set attributeName="cursor" to="crosshair"/></circle>
  <rect width="10" height="10" style="fill: url(https://example.com/x.png)"/>
  <image width="10" height="10" href="https://example.com/x.png"/>
  <use width="10" href="other.svg#a"/>
  <rect width="10" height="10"><animate attributeName="r" values="1;2" dur="1s"/></rect>
  <circle id="c" r="5"/><g><animate href="#c" attributeName="r" values="1;2" dur="1s"/></g>
</svg>`;

async function policyEdges(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors, context) => {
    const quiet = watch(page, context, origin);
    const r = await page.evaluate((text) => {
      const stats = window.drawTest.render(text);
      const root = document.querySelector('.draw-host').shadowRoot;
      const attrs = (sel) => {
        const el = root.querySelector(sel);
        return el ? [...el.attributes].map((a) => a.name).sort().join(' ') : null;
      };
      return {
        stats,
        kept: attrs('rect.near'),
        purified: { feImage: attrs('feImage'), animate: attrs('animate') },
        policy: {
          style: attrs('style'), 'rect:not(.near)': attrs('rect:not(.near)'), image: attrs('image'), use: attrs('use'), set: attrs('set'),
          'rect > animate': attrs('rect > animate'), 'g > animate': attrs('g > animate'),
        },
      };
    }, EDGES);
    must(r.stats.ok, `the edge case didn't render: ${r.stats.error}`);
    const want = {
      purified: { feImage: 'width', animate: 'attributeName dur' },
      policy: { style: null, 'rect:not(.near)': 'height width', image: 'height width', use: 'width', set: null, 'rect > animate': null, 'g > animate': 'attributeName dur href values' },
    };
    must(r.kept === 'class height id width', `the canvas has <rect id="title"> as [${r.kept}], not [class height id width]: is DOMPurify dropping ordinary ids again (SANITIZE_DOM)?`);
    for (const [sel, got] of Object.entries(r.purified)) {
      must(got === want.purified[sel], `DOMPurify refuses part of ${sel}, but the canvas has [${got}], not [${want.purified[sel]}]: is the sink still asking DOMPurify?`);
    }
    for (const [sel, got] of Object.entries(r.policy)) {
      must(got === want.policy[sel], `the policy refuses part of ${sel}, but the canvas has [${got}], not [${want.policy[sel]}]`);
    }
    must(r.stats.skippedElements === 3 && r.stats.droppedAttributes === 6, `expected 3 skipped elements and 6 dropped attributes, got ${JSON.stringify(r.stats)}`);
    await quiet('policy edges');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Documents at the canvas's other edges, each opened through drawTest, which must never throw.
const svgDoc = (body, attrs = '') => `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"${attrs}>${body}</svg>`;
const ANIMATE_WIDTH = '<animate href="#t" attributeName="width" values="1;2" dur="1s"/>';
const MORE_EDGES = [
  // An attribute written twice (browsers refuse such a file; the engine doesn't yet): never drawn,
  // whether the canvas refuses the element or, later, the parser refuses the file.
  { label: 'fill written twice', text: svgDoc('<rect width="10" height="10" fill="red" fill="blue"/>'), absent: 'rect', skipped: 1, orUnparsed: true },
  { label: 'attributeName written twice', text: svgDoc('<rect width="10" height="10"><animate attributeName="opacity" attributeName="width" values="1;2" dur="1s"/></rect>'), absent: 'animate', skipped: 1, orUnparsed: true },
  // SMIL is judged against what the browser animates: through the href the canvas keeps, every
  // element the fragment can name (drawn or not), never xml:id, and never "some element".
  { label: 'a dropped href leaves xlink:href to decide', text: svgDoc('<rect width="10" height="10"><animate href="other.svg#t" xlink:href="#t" attributeName="width" values="1;2" dur="1s"/></rect><circle id="t" r="5"/>'), absent: 'animate', skipped: 1 },
  { label: 'an xml:id before the id', text: svgDoc(`<rect xml:id="t" width="10" height="10"/><circle id="t" r="5"/>${ANIMATE_WIDTH}`), absent: 'animate', skipped: 1 },
  { label: 'the first id inside a refused element', text: svgDoc(`<x:g xmlns:x="urn:example:app-data"><rect id="t" width="10" height="10"/></x:g><circle id="t" r="5"/>${ANIMATE_WIDTH}`), absent: 'animate', skipped: 2 },
  { label: 'a fragment that names nothing', text: svgDoc(`<rect width="10" height="10"/>${ANIMATE_WIDTH}`), absent: 'animate', skipped: 1 },
  { label: 'a fragment that names a rect', text: svgDoc(`<rect id="t" width="10" height="10"/>${ANIMATE_WIDTH}`), target: 'rect', skipped: 0 },
  // requiredExtensions: browsers read XHTML as true (the HTML shows) and anything else as false.
  { label: 'a <switch> offering XHTML', text: svgDoc(`<switch><foreignObject requiredExtensions="${XHTML_NS}" width="10" height="10"><div xmlns="${XHTML_NS}">HTML</div></foreignObject><text>Fallback</text></switch>`), present: 'switch > foreignObject > div', skipped: 0 },
  { label: 'a <switch> offering another extension', text: svgDoc(`<switch><foreignObject requiredExtensions="http://example.com/ext" width="10" height="10"><div xmlns="${XHTML_NS}">HTML</div></foreignObject><text>Fallback</text></switch>`), absent: 'foreignObject', skipped: 1 },
  { label: "Illustrator's <switch> shows its artwork, not its private data", text: readFileSync(join(CORPUS, 'tools', 'illustrator-cs6-entities-pgf.svg'), 'utf8'), absent: 'switch > foreignObject', firstInSwitch: 'g' },
  // Ids that happen to name document properties keep working.
  { label: 'ids named blur and close', text: svgDoc('<filter id="blur"><feGaussianBlur stdDeviation="6"/></filter><symbol id="close" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol><use href="#close" width="20" height="20"/><rect width="10" height="10" filter="url(#blur)"/>'), ids: ['blur', 'close'], draws: 'use', skipped: 0 },
  // The document's own CSS can't size the root away from the host.
  { label: 'a root sized by its own CSS', text: svgDoc('<style>svg { width: 48px; height: 48px }</style><rect width="10" height="10"/>', ' style="width: 24px; height: 24px"'), fills: true, skipped: 0 },
  // A size that overflows once converted still renders; it just gets no viewBox.
  { label: 'a root width of 1e308in', text: `<svg xmlns="${SVG_NS}" width="1e308in" height="10"><rect width="5" height="5"/></svg>`, present: 'rect', noViewBox: true, skipped: 0 },
  // A root the canvas can't draw says so instead of showing nothing.
  { label: 'an <svg> with no namespace', text: '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>', refused: 'SVG namespace' },
  { label: 'an XHTML root', text: `<html xmlns="${XHTML_NS}"><body/></html>`, refused: 'SVG namespace' },
];

async function moreEdges(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors, context) => {
    const quiet = watch(page, context, origin);
    const problems = await page.evaluate((cases) => cases.flatMap((c) => {
      const out = [];
      let stats;
      try {
        stats = window.drawTest.render(c.text);
      } catch (e) {
        return [`${c.label}: drawTest.render threw ${e}`];
      }
      const host = document.querySelector('.draw-host');
      const root = host.shadowRoot;
      const q = (sel) => root.querySelector(sel);
      if (c.refused) {
        if (stats.ok || !stats.error?.includes(c.refused)) out.push(`the canvas reports ${JSON.stringify(stats)}, not a refused root (${c.refused})`);
        return out.map((m) => `${c.label}: ${m}`);
      }
      if (!stats.ok) return c.orUnparsed && stats.rendered === 0 && stats.skippedElements === 0 ? [] : [`${c.label}: did not render (${stats.error})`];
      if (c.skipped !== undefined && stats.skippedElements !== c.skipped) out.push(`skipped ${stats.skippedElements} element(s), not ${c.skipped}`);
      if (c.absent && q(c.absent)) out.push(`<${c.absent}> is on the canvas`);
      if (c.present && !q(c.present)) out.push(`<${c.present}> is not on the canvas`);
      if (c.target && q('animate')?.targetElement?.localName !== c.target) out.push(`the animation drives <${q('animate')?.targetElement?.localName}>, not <${c.target}>`);
      if (c.firstInSwitch && q('switch')?.firstElementChild?.localName !== c.firstInSwitch) out.push(`the <switch> starts with <${q('switch')?.firstElementChild?.localName}>`);
      for (const id of c.ids ?? []) if (!root.getElementById(id)) out.push(`id "${id}" was dropped`);
      if (c.draws && !(q(c.draws)?.getBBox().width > 0)) out.push(`<${c.draws}> draws nothing`);
      if (c.fills) {
        const [a, b] = [q('svg').getBoundingClientRect(), host.getBoundingClientRect()];
        if (['x', 'y', 'width', 'height'].some((k) => Math.abs(a[k] - b[k]) >= 1)) out.push(`the root is ${Math.round(a.width)}×${Math.round(a.height)}, not the host's ${Math.round(b.width)}×${Math.round(b.height)}`);
      }
      if (c.noViewBox && q('svg')?.hasAttribute('viewBox')) out.push(`the root got viewBox="${q('svg').getAttribute('viewBox')}"`);
      return out.map((m) => `${c.label}: ${m}`);
    }), MORE_EDGES);
    must(problems.length === 0, `the canvas's edges:\n${problems.join('\n')}`);
    await quiet('more edges');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The canvas draws a document as the document, not in the app's theme: currentColor, a font-less
// <text> and a var() fallback compute as they do with the file opened on its own, in light and
// dark; no ds token reaches the document; and the paper stays white.
async function canvasIgnoresTheTheme(browser, origin) {
  const text = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><path d="M0 0H10V10Z" fill="currentColor"/><text y="20">Hi</text><circle r="5" fill="var(--accent, black)"/></svg>`;
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ ...PHONE, viewport: { width: 440, height: 956 }, colorScheme });
    let alone;
    try {
      const page = await context.newPage();
      await page.goto(`data:image/svg+xml,${encodeURIComponent(text)}`);
      alone = await page.evaluate(readStyles, false);
    } finally {
      await context.close();
    }
    await withPage(browser, origin, 956, async (page) => {
      const r = await page.evaluate((t) => {
        // Every custom property the page's stylesheets define on :root (the ds tokens).
        const names = new Set();
        const walk = (rules) => {
          for (const rule of rules) {
            if (rule.selectorText && /(^|,)\s*:root\s*(,|$)/.test(rule.selectorText)) for (const p of rule.style) if (p.startsWith('--')) names.add(p);
            if (rule.cssRules) walk(rule.cssRules);
          }
        };
        for (const sheet of document.styleSheets) walk(sheet.cssRules);
        // One rect per token, filled from it with a fallback: only an unset token shows the fallback.
        const rects = [...names].map((n) => `<rect id="${n.slice(2)}" style="fill: var(${n}, rgb(1, 2, 3))"/>`).join('');
        window.drawTest.render(`<svg xmlns="http://www.w3.org/2000/svg">${rects}</svg>`);
        const root = document.querySelector('.draw-host').shadowRoot;
        const leaked = [...names].filter((n) => getComputedStyle(root.getElementById(n.slice(2))).fill !== 'rgb(1, 2, 3)');
        return { tokens: names.size, leaked, paper: getComputedStyle(document.querySelector('.draw-host')).backgroundColor };
      }, text);
      must(r.tokens >= 25, `test setup: found only ${r.tokens} ds tokens on :root`);
      must(r.leaked.length === 0, `${colorScheme}: ds tokens reach the document on the canvas: ${r.leaked.join(', ')}`);
      must(r.paper === 'rgb(255, 255, 255)', `${colorScheme}: the canvas paper is ${r.paper}, not white`);
      await page.evaluate((t) => window.drawTest.render(t), text);
      const canvas = await page.evaluate(readStyles, true);
      for (const k of Object.keys(alone)) must(canvas[k] === alone[k], `${colorScheme}: on the canvas the ${k} is ${canvas[k]}, but the file alone has ${alone[k]}`);
    }, { colorScheme });
  }
}

// Runs in the page: the styles canvasIgnoresTheTheme compares, on the canvas or in the file alone.
function readStyles(onCanvas) {
  const root = onCanvas ? document.querySelector('.draw-host').shadowRoot : document;
  const style = (sel) => getComputedStyle(root.querySelector(sel));
  return {
    'currentColor fill': style('path').fill,
    'text font': `${style('text').fontSize} ${style('text').fontFamily}`,
    'text fill': style('text').fill,
    'var() fallback fill': style('circle').fill,
  };
}

// Every static corpus file (no SMIL, script, CSS animation or transition: their frame depends on
// time) looks on the canvas as it does opened on its own. The canvas host takes the left half of
// the canvas area and the browser's own rendering of the same file, an <img> on the same white
// paper, the right half; one screenshot compares them pixel for pixel, in light and dark.
// Differences the canvas makes on purpose are named.
const LOOKS_DIFFERENT = new Map([
  ['lab/media.svg', 'its <video> is refused'],
  ['lab/media--audio.svg', 'its <video> is refused'],
  ['lab/texture--tiles.svg', 'its tile is a data: SVG on feImage, which the canvas does not load'],
]);
const PIXEL_TOLERANCE = 24; // per channel
const MAX_DIFFERENT = 0.002; // of the pixels; the app's theme leaking in changed 0.4% to 11%

async function corpusLooksAsItDoesAlone(browser, origin, colorScheme) {
  const files = corpusFiles().filter((f) => !/<(animate|set|animateTransform|animateMotion|animateColor|script)\b|@keyframes|transition/.test(f.text));
  must(files.length >= 200, `the fidelity check found only ${files.length} static corpus files`);
  // A small screen whose canvas area splits into two equal halves.
  await withPage(browser, origin, 320, async (page) => {
    const [a, b] = await page.evaluate(() => {
      const host = document.querySelector('.draw-host');
      const alone = document.createElement('div');
      alone.id = 'alone';
      alone.style.cssText = 'width:50%;height:100%;background:#fff';
      host.style.width = '50%';
      host.after(alone);
      document.querySelector('.draw-canvas').style.display = 'flex';
      return [host, alone].map((e) => e.getBoundingClientRect().toJSON());
    });
    must(a.width === b.width && a.height === b.height && a.width > 150, `test setup: the halves are ${rect(a)} and ${rect(b)}`);
    const differ = [];
    for (const f of files) {
      const decoded = await page.evaluate(showBoth, f.text);
      const shot = decodePng(await page.screenshot({ clip: { x: a.x, y: a.y, width: b.x + b.width - a.x, height: a.height } }));
      const dx = Math.round(b.x - a.x);
      let n = 0;
      for (let y = 0; y < shot.height; y++) {
        for (let x = 0; x < a.width; x++) {
          const [p, q] = [shot.rgb(x, y), shot.rgb(x + dx, y)];
          if (p.some((v, k) => Math.abs(v - q[k]) > PIXEL_TOLERANCE)) n++;
        }
      }
      const share = n / (a.width * shot.height);
      if (!decoded) differ.push(`${f.name}: test setup: the file did not load as an <img>`);
      else if (share > MAX_DIFFERENT && !LOOKS_DIFFERENT.has(f.name)) differ.push(`${f.name}: ${(share * 100).toFixed(2)}% of it differs`);
    }
    must(differ.length === 0, `${colorScheme}: ${differ.length} corpus file(s) look different on the canvas than on their own:\n${differ.join('\n')}`);
  }, { colorScheme, viewport: { width: 456, height: 320 } });
}

// Runs in the page: the file on the canvas, and beside it the file itself as an <img>, its root
// sized as the renderer sizes it (to fill, with the viewBox the renderer gave it, if any).
async function showBoth(text) {
  window.drawTest.render(text);
  const drawn = document.querySelector('.draw-host').shadowRoot.firstElementChild;
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  if (drawn?.hasAttribute('viewBox')) svg.setAttribute('viewBox', drawn.getAttribute('viewBox'));
  const img = document.createElement('img');
  img.style.cssText = 'display:block;width:100%;height:100%';
  img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  document.getElementById('alone').replaceChildren(img);
  await document.fonts.ready;
  try {
    await img.decode();
    return true;
  } catch {
    return false;
  }
}

// A document's CSS applies inside the shadow root, where it can restyle the host (:host) and fix
// boxes to the viewport. The canvas's containment must keep all of it inside the canvas: nothing
// draws over the top bar, and the root is placed against the canvas, not the screen.
async function documentCssStaysInside(browser, origin) {
  const text = `<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><style>:host { position: fixed; inset: 0; z-index: 10 } svg { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh }</style><rect width="10" height="10"/></svg>`;
  await withPage(browser, origin, 956, async (page, errors) => {
    const r = await page.evaluate((t) => {
      const stats = window.drawTest.render(t);
      const bar = document.querySelector('.draw-bar');
      const b = bar.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return {
        ok: stats.ok && stats.rendered === 3,
        barOnTop: bar.contains(hit),
        svgTop: document.querySelector('.draw-host').shadowRoot.querySelector('svg').getBoundingClientRect().top,
        canvasTop: document.querySelector('.draw-canvas').getBoundingClientRect().top,
      };
    }, text);
    must(r.ok, 'the CSS containment case did not render its <svg>, <style> and <rect>');
    must(r.barOnTop, "a document's CSS put the drawing over the top bar");
    must(r.svgTop >= r.canvasTop - 0.5, `a document's CSS fixed the drawing to the screen (top ${r.svgTop}) instead of the canvas (top ${r.canvasTop})`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// With reduced motion, a document's SMIL animations start paused and its CSS animations don't run
// (SVG Lab's spin export has no reduced-motion rule of its own); without it both run.
async function reducedMotionStopsAnimation(browser, origin) {
  const smil = readFileSync(join(CORPUS, 'tools', 'animated-smil.svg'), 'utf8');
  const css = readFileSync(join(CORPUS, 'lab', 'spin--css.svg'), 'utf8');
  for (const reducedMotion of ['reduce', 'no-preference']) {
    await withPage(browser, origin, 956, async (page) => {
      const r = await page.evaluate(([s, c]) => {
        const svg = () => document.querySelector('.draw-host').shadowRoot.querySelector('svg');
        window.drawTest.render(s);
        const out = { animations: svg().querySelectorAll('animate, animateMotion, animateTransform').length, paused: svg().animationsPaused() };
        window.drawTest.render(c);
        return { ...out, css: svg().getAnimations({ subtree: true }).length };
      }, [smil, css]);
      const reduce = reducedMotion === 'reduce';
      must(r.animations > 0, 'test setup: the animated corpus file rendered no animations');
      must(r.paused === reduce, `reduced motion "${reducedMotion}": the canvas's SMIL animations are ${r.paused ? 'paused' : 'running'}`);
      must(reduce ? r.css === 0 : r.css > 0, `reduced motion "${reducedMotion}": the canvas runs ${r.css} CSS animation(s)`);
    }, { reducedMotion });
  }
}

// Runs in the page: open each file through drawTest, then read what reached the shadow root.
async function renderEach({ files, tables }) {
  const SVG = 'http://www.w3.org/2000/svg', XHTML = 'http://www.w3.org/1999/xhtml';
  const XLINK = 'http://www.w3.org/1999/xlink', XML = 'http://www.w3.org/XML/1998/namespace';
  const elements = { [SVG]: new Set(tables.svgElements), [XHTML]: new Set(tables.xhtmlElements) };
  const attributes = { [SVG]: new Map(tables.svgAttributes), [XHTML]: new Map(tables.xhtmlAttributes) };
  const ACTIVE = new Set(['script', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas']);
  const ANIMATIONS = new Set(['animate', 'set', 'animateTransform', 'animateColor']);
  const LOCAL_URL = /^(#|data:image\/(png|jpeg|gif|webp)[;,])/i;
  const keyOf = (a) => (a.namespaceURI === null ? a.localName : a.namespaceURI === XLINK ? `xlink:${a.localName}` : a.namespaceURI === XML ? `xml:${a.localName}` : null);
  const renders = (el, key) => {
    const scope = attributes[el.namespaceURI]?.get(key);
    return !!scope && !scope.except?.includes(el.localName) && (scope.on === '*' || scope.on.includes(el.localName));
  };
  const inForeignObject = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (p.namespaceURI === SVG && p.localName === 'foreignObject') return true;
    return false;
  };
  const host = document.querySelector('.draw-host');
  const failures = [];
  let checked = 0, rendered = 0;
  for (const { name, text } of files) {
    const fail = (m) => failures.push(`${name}: ${m}`);
    const r = window.drawTest.render(text);
    if (!r.ok) fail(`did not render (${r.error})`);
    const root = host.shadowRoot;
    if (root.firstElementChild?.localName !== 'svg') fail('rendered nothing');
    rendered += r.rendered;
    for (const el of root.querySelectorAll('*')) {
      const tag = `<${el.localName}>`;
      if (ACTIVE.has(el.localName.toLowerCase())) fail(`${tag} is on the canvas`);
      if (!elements[el.namespaceURI]?.has(el.localName) || (el.namespaceURI === XHTML && !inForeignObject(el))) fail(`${tag} (${el.namespaceURI}) is not in the render tables there`);
      for (const a of el.attributes) {
        const key = keyOf(a);
        if (a.localName.toLowerCase().startsWith('on')) fail(`${tag} has the handler ${a.name}`);
        else if (key === null || !renders(el, key)) fail(`${tag} has ${a.name}, which the tables don't render there`);
        if ((a.localName === 'href' || a.localName === 'src') && !LOCAL_URL.test(a.value.replace(/^[\u0000-\u0020]+/, ''))) fail(`${tag} ${a.name} points outside the document`);
      }
      if (el.namespaceURI === SVG && ANIMATIONS.has(el.localName)) {
        // What the browser animates, as it resolved what the canvas kept.
        const target = (el.getAttribute('attributeName') ?? '').trim().replace(/^[^:]*:/, '');
        const on = el.targetElement;
        const ok = !!on && !/^(href|style)$|^on/i.test(target) && renders(on, target);
        if (!ok) fail(`${tag} animates ${target} on ${on ? `<${on.localName}>` : 'nothing'}, where it doesn't render`);
      }
    }
    checked++;
    // Give anything the file started loading time to show up in the request log.
    await new Promise((ok) => setTimeout(ok, 16));
  }
  return { checked, rendered, failed: failures.length, failures: failures.slice(0, 25) };
}

function corpusFiles() {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.svg') ? [p] : [];
  });
  return walk(CORPUS).sort().map((p) => ({ name: relative(CORPUS, p), text: readFileSync(p, 'utf8') }));
}

// Everything the page does that it shouldn't, from now on. The returned function waits for late
// loads to settle, then throws on any request off the test server, CSP violation, dialog,
// navigation or new window.
function watch(page, context, origin) {
  const seen = [];
  page.on('request', (r) => !/^(data|blob):/.test(r.url()) && !r.url().startsWith(`${origin}/`) && seen.push(`request to ${r.url().slice(0, 80)}`));
  page.on('dialog', (d) => seen.push(`${d.type()} dialog`) && d.dismiss());
  page.on('framenavigated', (f) => f === page.mainFrame() && seen.push(`navigated to ${f.url()}`));
  context.on('page', () => seen.push('opened a window'));
  return async (label) => {
    await page.waitForTimeout(300);
    const violations = await page.evaluate(() => window.__violations);
    seen.push(...violations.map((v) => `CSP violation: ${v}`));
    must(seen.length === 0, `${label}: the page did what it shouldn't:\n${seen.join('\n')}`);
  };
}

async function withPage(browser, origin, height, fn, options = {}) {
  const context = await browser.newContext({ ...PHONE, viewport: { width: 440, height }, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console error: ${m.text()}`));
  // Every CSP violation from the first byte, whichever element or shadow root caused it.
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  try {
    await page.goto(`${origin}/draw/`, { waitUntil: 'networkidle' });
    await fn(page, errors, context);
  } finally {
    await context.close();
  }
}

const same = (a, b) => ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) < 1);
const rect = (b) => `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}×${Math.round(b.height)}`;

function must(cond, message) {
  if (!cond) throw new Error(message);
}
