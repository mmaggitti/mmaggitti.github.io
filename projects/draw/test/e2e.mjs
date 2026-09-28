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
// (renderer-patch.mjs) and the shadow-root probe. P0-M3 adds the interaction spine: zoom and pan
// keep the point under the fingers and the page never zooms, the selection outline sits on the
// element at 400%, a scrub changes only its token's bytes and is one attribute mutation per frame
// on a 2,000-node drawing, Edit source, undo and redo, the phone rules on the new layout, and the
// initial JS budget. M4 adds files and drafts.

import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILE_VERSION } from '../../../scripts/lib/svg-profile.mjs';
import { RENDER_SVG_ATTRIBUTES, RENDER_SVG_ELEMENTS, RENDER_XHTML_ATTRIBUTES, RENDER_XHTML_ELEMENTS } from '../../../engine/policy/tables.ts';
import probe from './probe-shadow.mjs';
import rendererPatch from './renderer-patch.mjs';
import { detentHeights } from '../src/detents.ts';
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
  // P0-M3: the interaction spine.
  for (const height of [956, 796]) await check(phoneRulesOnTheNewLayout, height);
  await check(zoomKeepsThePointUnderIt);
  await check(pageNeverZooms);
  await check(outlineOnTheElementAt400);
  await check(scrubChangesOnlyItsBytes);
  await check(scrubFrameIsOneMutation);
  await check(sheetsRefuseWhatTheyCantWrite);
  await check(editSourceRoundTrip);
  await check(undoRedoButtonsAndTwoFingerTap);
  // The P0-M3 review.
  for (const height of [956, 796]) await check(edgeTapsTakeTheTokenUnderTheFinger, height);
  await check(aTapNearAWrappedTokenTakesOnlyWhatIsNear);
  await check(swipesAndPinchesOverTheCodeEditNothing);
  await check(theCodeMarksTheStripsNumber);
  await check(aHandleDragLeavesTheNextTapWorking);
  await check(theOutlineStaysAboveTheDrawing);
  await check(initialJsBudget);
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
// Differences one engine shows because its <img> reference differs from the file opened on its own;
// the canvas is right in each. By browser, then file; `scheme` limits one to light or dark.
const LOOKS_DIFFERENT_IN = {
  webkit: new Map([
    ['lab/media--iframe.svg', { why: 'WebKit draws an <iframe> box inside an SVG <img>; the canvas never renders iframes' }],
    ['tools/svgo-gradient-style-classes.svg', { scheme: 'dark', why: "WebKit's SVG <img> ignores the page's dark preference; the canvas follows it, as the file opened on its own does" }],
  ]),
};
const PIXEL_TOLERANCE = 24; // per channel
const MAX_DIFFERENT = 0.002; // of the pixels; the app's theme leaking in changed 0.4% to 11%

async function corpusLooksAsItDoesAlone(browser, origin, colorScheme) {
  const files = corpusFiles().filter((f) => !/<(animate|set|animateTransform|animateMotion|animateColor|script)\b|@keyframes|transition/.test(f.text));
  must(files.length >= 200, `the fidelity check found only ${files.length} static corpus files`);
  // A small screen whose canvas area splits into two equal halves. The code sheet, the ContextBar
  // and the ToolRail (P0-M3) are put away, so the canvas area is what it was before them. (Chromium
  // rasterizes some edges differently in a viewport 512 or more tall, so the screen stays small.)
  await withPage(browser, origin, 320, async (page) => {
    const [a, b] = await page.evaluate(() => {
      for (const sel of ['.draw-sheet', '.draw-context', '.draw-rail']) document.querySelector(sel).style.display = 'none';
      const host = document.querySelector('.draw-host');
      const alone = document.createElement('div');
      alone.id = 'alone';
      alone.style.cssText = 'width:50%;height:100%;background:#fff';
      host.style.width = '50%';
      host.after(alone);
      document.querySelector('.draw-canvas').style.display = 'flex';
      return [host, alone].map((e) => e.getBoundingClientRect().toJSON());
    });
    must(a.width === b.width && a.height === b.height && a.width > 150 && a.height > 240, `test setup: the halves are ${rect(a)} and ${rect(b)}`);
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
      else if (share > MAX_DIFFERENT && !LOOKS_DIFFERENT.has(f.name) && !knownIn(browser, f.name, colorScheme)) differ.push(`${f.name}: ${(share * 100).toFixed(2)}% of it differs`);
    }
    must(differ.length === 0, `${colorScheme}: ${differ.length} corpus file(s) look different on the canvas than on their own:\n${differ.join('\n')}`);
  }, { colorScheme, viewport: { width: 456, height: 320 } });
}

function knownIn(browser, name, colorScheme) {
  const known = LOOKS_DIFFERENT_IN[browser.browserType().name()]?.get(name);
  return !!known && (!known.scheme || known.scheme === colorScheme);
}

// Runs in the page: the file on the canvas, and beside it the file itself as an <img>, its root
// sized as the renderer sizes it (to fill, with the viewBox the renderer gave it, if any).
async function showBoth(text) {
  window.drawTest.render(text);
  const drawn = document.querySelector('.draw-host').shadowRoot.firstElementChild;
  // A byte-order mark marks the encoding, not content; WebKit's DOMParser refuses one in a string.
  const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ''), 'image/svg+xml');
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

// ── P0-M3: the interaction spine ───────────────────────────────────────────────────────────────

const SITE_DRAW = join(HERE, '../../../_site/draw');

const chromium = (browser) => browser.browserType().name() === 'chromium';
const shadowSvg = () => document.querySelector('.draw-host').shadowRoot.querySelector('svg');

// Two fingers on the canvas, from (a0, b0) to (a1, b1) in `steps` moves (0: a tap), in client
// points. Chromium gets real touch input (CDP), which is what the browser's own page zoom reacts
// to; WebKit can't synthesize multi-touch, so there the canvas gets the same Pointer Events.
async function twoFingers(browser, page, a0, b0, a1, b1, steps) {
  const at = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
  if (chromium(browser)) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (a, b) => [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(a0, b0) });
    for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(at(a0, a1, i / steps), at(b0, b1, i / steps)) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.evaluate(({ a0, b0, a1, b1, steps }) => {
      const area = document.querySelector('.draw-canvas');
      const fire = (type, id, p) => area.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true }));
      const at = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
      fire('pointerdown', 1, a0);
      fire('pointerdown', 2, b0);
      for (let i = 1; i <= steps; i++) {
        fire('pointermove', 1, at(a0, a1, i / steps));
        fire('pointermove', 2, at(b0, b1, i / steps));
      }
      fire('pointerup', 1, steps ? a1 : a0);
      fire('pointerup', 2, steps ? b1 : b0);
    }, { a0, b0, a1, b1, steps });
  }
  await page.waitForTimeout(50);
}

// A trackpad pinch or ctrl and the wheel, about a client point: a wheel event with ctrlKey, as
// both browsers send it (dispatched, so it is the same in both engines).
async function ctrlWheel(page, x, y, deltaY) {
  await page.evaluate(([x, y, deltaY]) => {
    const e = new WheelEvent('wheel', { clientX: x, clientY: y, deltaY, ctrlKey: true, bubbles: true, cancelable: true });
    document.querySelector('.draw-canvas').dispatchEvent(e);
    if (!e.defaultPrevented) throw new Error('the canvas let the browser have a ctrl-wheel (page zoom)');
  }, [x, y, deltaY]);
}

// Runs in the page: the document point under a client point, and back, through the drawn root.
function docPoint([x, y]) {
  const m = document.querySelector('.draw-host').shadowRoot.querySelector('svg').getScreenCTM().inverse();
  const p = new DOMPoint(x, y).matrixTransform(m);
  return { x: p.x, y: p.y };
}
function screenPoint({ x, y }) {
  const p = new DOMPoint(x, y).matrixTransform(document.querySelector('.draw-host').shadowRoot.querySelector('svg').getScreenCTM());
  return { x: p.x, y: p.y };
}

// The code sheet at half, so the code is on screen.
async function showCode(page) {
  if ((await page.locator('.draw-handle').getAttribute('aria-expanded')) !== 'true') await page.locator('.draw-handle').tap();
  await page.locator('.draw-code .cv-block').first().waitFor();
}

// Two frames: the page has laid out and delivered its ResizeObserver callbacks (the canvas's view
// follows its new size there), which a forced layout alone does not wait for.
const twoFrames = (page) => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));

// A code token, brought to the middle of the code panel first (a token at the panel's edge sits
// under the ContextBar), then tapped.
async function tapToken(token) {
  await token.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await token.tap();
}

const circleCentre = (page) => page.evaluate(() => {
  const b = document.querySelector('.draw-host').shadowRoot.querySelector('circle').getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});

// Runs in the page: the phone rules over what is on screen now.
function rulesNow(min) {
  const small = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')) {
    const b = el.getBoundingClientRect();
    if (b.width && b.height && (b.width < min - 0.5 || b.height < min - 0.5)) small.push(`${el.tagName} ${el.getAttribute('aria-label') ?? el.textContent.trim()} ${Math.round(b.width)}×${Math.round(b.height)}`);
  }
  const fields = [...document.querySelectorAll('input, textarea, select')].filter((el) => el.getBoundingClientRect().width && parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.getAttribute('aria-label'));
  const de = document.documentElement;
  const host = document.querySelector('.draw-host');
  // A number, colour or keyword broken across two lines of the code (a text run may wrap).
  const split = [...document.querySelectorAll('.cv-number, .cv-color, .cv-enum, .cv-ref')].filter((t) => t.getClientRects().length > 1).map((t) => t.textContent);
  return {
    small, fields, split, sw: de.scrollWidth, cw: de.clientWidth, sh: de.scrollHeight, ch: de.clientHeight,
    hidden: host.getAttribute('aria-hidden'),
    touch: [getComputedStyle(host).touchAction, getComputedStyle(document.querySelector('.draw-canvas')).touchAction],
  };
}

// The tap floor, 16px fields and no sideways (or page) scroll in every state M3 adds: the code
// sheet at half and full with a selection, the Scrub strip, the Number, Color and Text sheets, and
// Edit source. The canvas host is hidden from assistive tech (the code is the document's
// accessible view) and gives every finger to Draw (touch-action: none). No number, colour or
// keyword breaks across lines of the code. The bars are the plan's 44, 48 and 52, and the sheet
// sits at the heights detents.ts gives for the real space and head.
async function phoneRulesOnTheNewLayout(browser, origin, height) {
  await withPage(browser, origin, height, async (page, errors) => {
    const problems = [];
    const layout = () => page.evaluate(() => {
      const h = (s) => document.querySelector(s).getBoundingClientRect().height;
      return { bar: h('.draw-bar'), context: h('.draw-context'), rail: h('.draw-rail'), sheet: h('.draw-sheet'), split: h('.draw-split') };
    });
    const peek = await layout();
    if (peek.bar !== 44 || peek.context !== 48 || peek.rail !== 52) problems.push(`the TopBar, ContextBar and ToolRail are ${peek.bar}, ${peek.context} and ${peek.rail}, not 44, 48 and 52`);
    const want = detentHeights(peek.split, peek.sheet);
    const sheetAt = async (detent) => {
      const got = (await layout()).sheet;
      if (Math.abs(got - want[detent]) > 0.5) problems.push(`the sheet is ${got} at ${detent}, not ${want[detent]} (detents.ts, from a ${peek.split} space and a ${peek.sheet} head)`);
    };
    const rules = async (state) => {
      const r = await page.evaluate(rulesNow, TAP_MIN);
      if (r.small.length) problems.push(`${state}: tap targets under ${TAP_MIN}pt: ${r.small.join(', ')}`);
      if (r.fields.length) problems.push(`${state}: field(s) under 16px: ${r.fields.join(', ')}`);
      if (r.split.length) problems.push(`${state}: ${r.split.length} token(s) split across lines of the code: ${r.split.slice(0, 5).join(', ')}`);
      if (r.sw > r.cw) problems.push(`${state}: scrolls sideways (${r.sw} > ${r.cw})`);
      if (r.sh > r.ch) problems.push(`${state}: the page scrolls (${r.sh} > ${r.ch})`);
      if (r.hidden !== 'true') problems.push(`${state}: the canvas host is not aria-hidden`);
      if (r.touch.some((t) => t !== 'none')) problems.push(`${state}: touch-action on the canvas is ${r.touch.join(', ')}, not none`);
    };
    const c = await circleCentre(page);
    await page.touchscreen.tap(c.x, c.y);
    await showCode(page);
    must(await page.locator('.draw-sel').textContent() === '<circle>', 'test setup: tapping the circle did not select it');
    await rules('the code sheet at half, with a selection');
    await sheetAt('half');
    const circle = page.locator('.cv-block', { hasText: '<circle' });
    await tapToken(circle.locator('.cv-number').nth(2));
    await page.locator('.draw-strip').waitFor();
    await rules('the Scrub strip');
    await page.locator('.draw-strip-value').tap();
    await page.locator('.draw-modal input').first().waitFor();
    await rules('the Number sheet');
    await page.locator('.draw-modal-done').tap();
    await tapToken(circle.locator('.cv-color').first());
    await page.locator('.draw-swatch').first().waitFor();
    await rules('the Color sheet');
    await page.locator('.draw-modal-done').tap();
    await tapToken(page.locator('.cv-block', { hasText: 'A sun setting' }).locator('.cv-text').first());
    await page.locator('.draw-modal input').first().waitFor();
    await rules('the Text sheet');
    await page.locator('.draw-modal-done').tap();
    const c2 = await circleCentre(page); // the canvas fitted again when the sheet opened
    await page.touchscreen.tap(c2.x, c2.y);
    await page.locator('.draw-action').tap();
    await page.locator('.draw-source').waitFor();
    await rules('Edit source');
    await page.locator('.draw-modal .ds-btn', { hasText: 'Cancel' }).tap();
    await page.locator('.draw-handle').tap();
    await rules('the code sheet at full');
    await sheetAt('full');
    must(problems.length === 0, `440×${height}:\n${problems.join('\n')}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (a) The zoom invariant on the real canvas: a ctrl-wheel about a point, and a two-finger pinch,
// keep the document point under it (read through the drawn root's getScreenCTM) under it. The code
// sheet is opened first, so the canvas has changed size and the view must have followed it. (Whole
// points: Chromium truncates a synthetic WheelEvent's clientX and clientY.)
async function zoomKeepsThePointUnderIt(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await showCode(page);
    await twoFrames(page);
    const S = [300, 260];
    const P = await page.evaluate(docPoint, S);
    const v0 = await page.evaluate(() => window.drawTest.view());
    await ctrlWheel(page, S[0], S[1], -100);
    const v1 = await page.evaluate(() => window.drawTest.view());
    must(Math.abs(v1.scale / v0.scale - 2) < 1e-9, `a ctrl-wheel of -100 zoomed ×${v1.scale / v0.scale}, not ×2`);
    const back = await page.evaluate(screenPoint, P);
    must(Math.hypot(back.x - S[0], back.y - S[1]) < 0.5, `after the wheel zoom the document point ${JSON.stringify(P)} is at ${JSON.stringify(back)}, not ${S}`);
    // A pinch about its midpoint: the fingers spread three times as far apart.
    const M = { x: 220, y: 420 };
    const Q = await page.evaluate(docPoint, [M.x, M.y]);
    await twoFingers(browser, page, { x: M.x - 30, y: M.y }, { x: M.x + 30, y: M.y }, { x: M.x - 90, y: M.y }, { x: M.x + 90, y: M.y }, 12);
    const v2 = await page.evaluate(() => window.drawTest.view());
    must(Math.abs(v2.scale / v1.scale - 3) < 0.05, `the pinch zoomed ×${(v2.scale / v1.scale).toFixed(3)}, not ×3`);
    const now = await page.evaluate(screenPoint, Q);
    must(Math.hypot(now.x - M.x, now.y - M.y) < 1, `after the pinch the point under the fingers is at ${JSON.stringify(now)}, not ${JSON.stringify(M)}`);
    must(await page.evaluate(() => window.drawTest.source()) === SAMPLE, 'zooming changed the file');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (b) The page never zooms: a two-finger pinch on the canvas (real touch in Chromium) zooms the
// drawing, and the page's visual viewport stays at scale 1. Safari's own pinch events are
// cancelled on the canvas too. So is a pinch anywhere else in the app: on the TopBar, the sheet's
// handle and tabs, the code, the ContextBar and the ToolRail the page stays at scale 1 and Safari's
// gesture events are cancelled (the pinch is real touch, so Chromium only; WebKit can't make it).
async function pageNeverZooms(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const gesturesCancelledOn = (sel) => page.evaluate((sel) => ['gesturestart', 'gesturechange'].map((type) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      document.querySelector(sel).dispatchEvent(e);
      return e.defaultPrevented;
    }), sel);
    const before = await page.evaluate(() => window.drawTest.view().scale);
    await twoFingers(browser, page, { x: 180, y: 400 }, { x: 260, y: 400 }, { x: 60, y: 400 }, { x: 380, y: 400 }, 16);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const prevented = ['gesturestart', 'gesturechange'].map((type) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        document.querySelector('.draw-canvas').dispatchEvent(e);
        return e.defaultPrevented;
      });
      return { scale: window.visualViewport.scale, view: window.drawTest.view().scale, prevented };
    });
    must(r.scale === 1, `the page zoomed to ${r.scale} under a pinch on the canvas`);
    must(r.view > before * 2, `test setup: the pinch did not reach the canvas (view scale ${before} → ${r.view})`);
    must(r.prevented.every(Boolean), `Safari's gesture events are not cancelled on the canvas (${r.prevented})`);
    await showCode(page);
    for (const sel of ['.draw-bar', '.draw-handle', '.draw-tabs', '.draw-code', '.draw-context', '.draw-rail']) {
      if (chromium(browser)) {
        const b = await page.locator(sel).boundingBox();
        const m = { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 60) };
        await twoFingers(browser, page, { x: m.x - 20, y: m.y }, { x: m.x + 20, y: m.y }, { x: m.x - 120, y: m.y }, { x: m.x + 120, y: m.y }, 16);
        await page.waitForTimeout(300);
        const scale = await page.evaluate(() => window.visualViewport.scale);
        must(scale === 1, `a pinch on ${sel} zoomed the page to ${scale}`);
      }
      const prevented = await gesturesCancelledOn(sel);
      must(prevented.every(Boolean), `Safari's gesture events are not cancelled on ${sel} (${prevented})`);
    }
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (c) The selection outline sits on the element: at 400% zoom, each corner of the overlay's
// outline is within 1pt of the element's box through its getScreenCTM, and of its client rect.
async function outlineOnTheElementAt400(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const c = await circleCentre(page);
    await page.touchscreen.tap(c.x, c.y);
    const before = await page.locator('.draw-outline').first().getAttribute('points');
    must(before && before.trim(), 'tapping the circle drew no outline');
    await ctrlWheel(page, c.x, c.y, -100);
    await ctrlWheel(page, c.x, c.y, -100);
    const r = await page.evaluate(() => {
      const circle = document.querySelector('.draw-host').shadowRoot.querySelector('circle');
      const box = circle.getBBox();
      const m = circle.getScreenCTM();
      const want = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      const o = document.querySelector('.draw-overlay').getBoundingClientRect();
      const got = document.querySelector('.draw-outline').getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number)).map(([x, y]) => ({ x: x + o.left, y: y + o.top }));
      const cr = circle.getBoundingClientRect();
      const view = window.drawTest.view();
      return { want: want.map((p) => ({ x: p.x, y: p.y })), got, cr: cr.toJSON(), zoom: view.scale / view.fitScale };
    });
    must(Math.abs(r.zoom - 4) < 1e-9, `test setup: the zoom is ${r.zoom * 100}%, not 400%`);
    const err = Math.max(...r.want.map((p, i) => Math.hypot(p.x - r.got[i].x, p.y - r.got[i].y)));
    must(err <= 1, `at 400% the outline is ${err.toFixed(2)}pt off the circle's getScreenCTM box`);
    const [tl, , br] = r.got;
    const off = Math.max(Math.abs(tl.x - r.cr.left), Math.abs(tl.y - r.cr.top), Math.abs(br.x - r.cr.right), Math.abs(br.y - r.cr.bottom));
    must(off <= 1, `at 400% the outline is ${off.toFixed(2)}pt off the circle's client rect`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Drag a code token sideways with the mouse: past the 7px threshold, then `frames` moves of one
// step (4px) each. `each` runs after every step's move.
async function scrubToken(page, token, frames, each = async () => {}) {
  await token.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const b = await token.boundingBox();
  const y = b.y + b.height / 2;
  let x = b.x + b.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  x += 8;
  await page.mouse.move(x, y);
  for (let i = 1; i <= frames; i++) {
    x += 4;
    await page.mouse.move(x, y);
    await each(i);
  }
  await page.mouse.up();
}

// (d) Scrubbing a number in the code changes only that token's bytes in the file, and one undo
// (the Undo button) restores the original byte for byte.
async function scrubChangesOnlyItsBytes(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await showCode(page);
    const original = await page.evaluate(() => window.drawTest.source());
    must(original === SAMPLE, 'test setup: the sample is not what opened');
    const at = SAMPLE.indexOf('cx="212"') + 4;
    const token = page.locator('.cv-block', { hasText: '<circle' }).locator('.cv-number').first();
    must(await token.textContent() === '212', 'test setup: the first number in the circle is not cx');
    const seen = [];
    await scrubToken(page, token, 6, async () => seen.push(await page.evaluate(() => window.drawTest.source())));
    const after = await page.evaluate(() => window.drawTest.source());
    for (const [i, s] of [...seen, after].entries()) {
      const tail = SAMPLE.length - (at + 3);
      must(s.slice(0, at) === SAMPLE.slice(0, at) && s.slice(s.length - tail) === SAMPLE.slice(at + 3), `frame ${i + 1}: bytes outside cx's token changed`);
    }
    must(after.slice(at, at + 3) === '218', `six steps of cx=212 wrote ${after.slice(at, at + 3)}, not 218`);
    const cx = await page.evaluate(() => document.querySelector('.draw-host').shadowRoot.querySelector('circle').getAttribute('cx'));
    must(cx === '218', `the canvas's circle has cx=${cx}, not 218`);
    const flash = await page.locator('.cv-block', { hasText: '<circle' }).evaluate((el) => el.classList.contains('cv-flash'));
    must(flash, "the scrubbed block doesn't flash (cv-flash)");
    // The outline followed the scrub: its corners are on the circle where it is drawn now.
    const off = await page.evaluate(() => {
      const cr = document.querySelector('.draw-host').shadowRoot.querySelector('circle').getBoundingClientRect();
      const o = document.querySelector('.draw-overlay').getBoundingClientRect();
      const [tl, , br] = document.querySelector('.draw-outline').getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number));
      return Math.max(Math.abs(o.left + tl[0] - cr.left), Math.abs(o.top + tl[1] - cr.top), Math.abs(o.left + br[0] - cr.right), Math.abs(o.top + br[1] - cr.bottom));
    });
    must(off <= 1, `after the scrub the outline is ${off.toFixed(2)}pt off the circle`);
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    must(!(await undo.isDisabled()), 'the scrub left nothing to undo');
    await undo.tap();
    must(await page.evaluate(() => window.drawTest.source()) === original, 'one undo did not restore the file byte for byte');
    must(await undo.isDisabled(), 'the scrub was more than one history entry');
    const back = await page.evaluate(() => document.querySelector('.draw-host').shadowRoot.querySelector('circle').getAttribute('cx'));
    must(back === '212', `the canvas's circle has cx=${back} after the undo, not 212`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (e) On a 2,000-node drawing, every frame of a scrub is exactly one attribute mutation in the
// canvas's shadow root (a MutationObserver counts them).
async function scrubFrameIsOneMutation(browser, origin) {
  const rects = Array.from({ length: 1999 }, (_, i) => `<rect x="${(i % 50) * 40}" y="${Math.floor(i / 50) * 40}" width="30" height="30" fill="#2a9d8f"/>`);
  const BIG = `<svg xmlns="${SVG_NS}" viewBox="0 0 2000 1600">\n${rects.join('\n')}\n</svg>\n`;
  await withPage(browser, origin, 956, async (page, errors) => {
    const stats = await page.evaluate((t) => window.drawTest.render(t), BIG);
    must(stats.ok && stats.rendered === 2000, `test setup: the 2,000-node drawing rendered ${stats.rendered} elements`);
    await showCode(page);
    const token = page.locator('.cv-block', { hasText: '<rect' }).nth(3).locator('.cv-number').first();
    await token.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.evaluate(() => {
      window.__muts = [];
      window.__mo = new MutationObserver((ms) => window.__muts.push(...ms));
      window.__mo.observe(document.querySelector('.draw-host').shadowRoot, { subtree: true, attributes: true, childList: true, characterData: true });
    });
    // Each frame's mutations: those delivered to the observer since the last frame, and any queued.
    const frame = () => page.evaluate(() => window.__muts.splice(0).concat(window.__mo.takeRecords()).map((m) => `${m.type} ${m.attributeName ?? ''}`));
    const counts = [];
    await scrubToken(page, token, 12, async () => counts.push(await frame()));
    must(counts.length === 12 && counts.every((c) => c.length === 1 && c[0] === 'attributes x'), `mutations per scrub frame: ${JSON.stringify(counts)}`);
    console.log(`     draw: a scrub frame on 2,000 nodes is ${counts[0].length} attribute mutation (${counts.length} frames)`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The Scrub strip and the sheets refuse what they can't write: a negative radius, a word in the
// Number sheet, a colour that doesn't parse, a character XML can't hold in the Text sheet. Each
// says why, and the file keeps its last good value. Enter closes the Text sheet.
async function sheetsRefuseWhatTheyCantWrite(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await showCode(page);
    const circle = page.locator('.cv-block', { hasText: '<circle' });
    const src = () => page.evaluate(() => window.drawTest.source());
    await tapToken(circle.locator('.cv-number').nth(2)); // r="42"
    await page.locator('.draw-strip').waitFor();
    await page.locator('.draw-strip button', { hasText: '+' }).tap();
    must((await src()).includes('r="43"'), 'the strip\'s + did not step r');
    await page.locator('.draw-strip button', { hasText: '±' }).tap();
    must((await page.locator('.draw-toast').textContent()).includes('minimum'), 'a negative radius was not refused with a message');
    must((await src()).includes('r="43"'), 'a refused value was written');
    await page.locator('.draw-strip-value').tap();
    const field = page.locator('.draw-modal input').first();
    await field.fill('4o');
    must(await page.locator('.draw-problem').isVisible(), 'the Number sheet took "4o" without a word');
    must((await src()).includes('r="43"'), 'the Number sheet wrote "4o"');
    await field.fill('12.5');
    must((await src()).includes('r="12.5"'), 'the Number sheet did not write 12.5 live');
    await page.locator('.draw-modal-done').tap();
    await tapToken(circle.locator('.cv-color').first());
    const custom = page.locator('.draw-custom input').first();
    await custom.fill('not-a-colour');
    await page.locator('.draw-use').tap();
    must(await page.locator('.draw-problem').isVisible(), 'the Color sheet took "not-a-colour" without a word');
    must((await src()).includes('fill="#ffd166"'), 'the Color sheet wrote a colour that does not parse');
    await page.locator('.draw-swatch[aria-label="#e76f51"]').tap();
    must((await src()).includes('fill="#e76f51"'), 'a swatch did not apply');
    await page.locator('.draw-modal-done').tap();
    const fill = await page.evaluate(() => document.querySelector('.draw-host').shadowRoot.querySelector('circle').getAttribute('fill'));
    must(fill === '#e76f51', `the canvas's circle has fill=${fill}`);
    // The Text sheet refuses a character XML can't hold, and Enter closes it.
    await tapToken(page.locator('.cv-text', { hasText: /^Draw$/ }));
    const text = page.locator('.draw-modal input').first();
    await text.fill('Dr\u0001aw');
    must(await page.locator('.draw-problem').isVisible(), 'the Text sheet took a control character without a word');
    must((await src()).includes('>Draw</text>'), 'the Text sheet wrote a character XML cannot hold');
    await text.fill('Drawn');
    await text.press('Enter');
    await page.waitForTimeout(100);
    must(await page.locator('.draw-modal').count() === 0, 'Enter did not close the Text sheet');
    must((await src()).includes('>Drawn</text>'), 'the Text sheet did not write "Drawn"');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (f) Edit source: the selected element's source in a sheet; Apply replaces it in one
// transaction (one undo restores it byte for byte); markup that doesn't parse says where and
// changes nothing.
async function editSourceRoundTrip(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    // A tap on the root's end tag selects it, and Edit source, which can't replace the root, is not offered.
    await showCode(page);
    const root = page.locator('.cv-block', { hasText: '</svg>' });
    await root.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await root.tap();
    must(await page.locator('.draw-label').textContent() === '<svg>', "test setup: a tap on the root's code did not select it");
    must(await page.locator('.draw-action').count() === 0, 'Edit source is offered for the root <svg>, which it cannot replace');
    const c = await circleCentre(page);
    await page.touchscreen.tap(c.x, c.y);
    await page.locator('.draw-action').tap();
    const area = page.locator('.draw-source');
    const text = await area.inputValue();
    must(text === '<circle cx="212" cy="134" r="42" fill="#ffd166"/>', `Edit source shows ${JSON.stringify(text)}`);
    await area.fill('<circle cx="212"\n  cy="134" r=42/>');
    await page.locator('.draw-modal .ds-btn', { hasText: 'Apply' }).tap();
    const problem = await page.locator('.draw-problem').textContent();
    must(/^Line 2, column \d+: /.test(problem), `the parse error says ${JSON.stringify(problem)}`);
    must(await page.evaluate(() => window.drawTest.source()) === SAMPLE, 'markup that does not parse changed the file');
    const edited = '<circle cx="212" cy="134" r="30" fill="#ffd166" opacity="0.8"/>';
    await area.fill(edited);
    await page.locator('.draw-modal .ds-btn', { hasText: 'Apply' }).tap();
    await page.locator('.draw-modal').waitFor({ state: 'detached' });
    const after = await page.evaluate(() => window.drawTest.source());
    must(after === SAMPLE.replace('<circle cx="212" cy="134" r="42" fill="#ffd166"/>', edited), 'Apply changed more than the element');
    const drawn = await page.evaluate(() => {
      const c = document.querySelector('.draw-host').shadowRoot.querySelector('circle');
      return `${c.getAttribute('r')} ${c.getAttribute('opacity')}`;
    });
    must(drawn === '30 0.8', `the canvas draws the new circle as r/opacity ${drawn}`);
    must(await page.locator('.draw-sel').textContent() === '<circle>', 'the new element is not selected');
    await page.locator('.draw-tool', { hasText: 'Undo' }).tap();
    must(await page.evaluate(() => window.drawTest.source()) === SAMPLE, 'one undo did not restore the element byte for byte');
    must(await page.locator('.draw-sel').textContent() === 'nothing selected', 'the element the undo took out is still selected');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (g) Undo and Redo from the ToolRail follow the history, and a quick two-finger tap on the
// canvas is undo.
async function undoRedoButtonsAndTwoFingerTap(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    const redo = page.locator('.draw-tool', { hasText: 'Redo' });
    const src = () => page.evaluate(() => window.drawTest.source());
    must(await undo.isDisabled() && await redo.isDisabled(), 'Undo or Redo is enabled with no history');
    await showCode(page);
    await tapToken(page.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-enum').first()); // stroke-linecap="round"
    const edited = await src();
    must(edited === SAMPLE.replace('stroke-linecap="round"', 'stroke-linecap="square"'), 'tapping a keyword did not move it to its next option');
    must(!(await undo.isDisabled()), 'Undo is disabled after an edit');
    const cap = () => page.evaluate(() => document.querySelector('.draw-host').shadowRoot.querySelector('polyline').getAttribute('stroke-linecap'));
    await undo.tap();
    must(await src() === SAMPLE, 'Undo did not restore the file');
    must(await cap() === 'round', `after Undo the canvas's polyline has stroke-linecap=${await cap()}, not round`);
    must(!(await redo.isDisabled()), 'Redo is disabled after an undo');
    await redo.tap();
    must(await src() === edited, 'Redo did not re-apply the edit');
    must(await cap() === 'square', `after Redo the canvas's polyline has stroke-linecap=${await cap()}, not square`);
    await twoFingers(browser, page, { x: 160, y: 300 }, { x: 260, y: 300 }, null, null, 0);
    must(await src() === SAMPLE, 'a two-finger tap on the canvas did not undo');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// ── The P0-M3 review ───────────────────────────────────────────────────────────────────────────

// A token at the code panel's edge takes a tap on it. Selecting on the canvas scrolls its block
// into view at the panel's bottom edge; the scroll padding keeps the block a finger's width off the
// ContextBar, so a tap on it lands on the token, not on the Scrub strip. (tapToken scrolls tokens
// to the middle first; this one taps them where they are.)
async function edgeTapsTakeTheTokenUnderTheFinger(browser, origin, height) {
  await withPage(browser, origin, height, async (page, errors) => {
    const c = await circleCentre(page);
    await page.touchscreen.tap(c.x, c.y);
    await showCode(page);
    await page.waitForTimeout(100);
    const gap = await page.evaluate(() => {
      const body = document.querySelector('.draw-sheet-body').getBoundingClientRect();
      const block = [...document.querySelectorAll('.cv-block')].find((b) => b.textContent.startsWith('<circle')).getBoundingClientRect();
      return body.bottom - block.bottom;
    });
    must(gap >= TAP_MIN - 1, `the selected block was scrolled to ${gap.toFixed(1)}pt from the panel's bottom edge, under a finger's width`);
    const circle = page.locator('.cv-block', { hasText: '<circle' });
    must(await circle.evaluate((el) => el.classList.contains('cv-selected')), "the selected circle's block is not marked (cv-selected)");
    const tapWhereItIs = async (token) => {
      const b = await token.boundingBox();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    };
    await tapWhereItIs(circle.locator('.cv-number').nth(2));
    must(await page.locator('.draw-strip-name').textContent() === 'r', 'test setup: a tap on r did not open the Scrub strip for r');
    await tapWhereItIs(circle.locator('.cv-number').first());
    const name = await page.locator('.draw-strip-name').textContent();
    const sheet = await page.locator('.draw-modal').count();
    must(name === 'cx' && sheet === 0, `a tap on cx at the panel's edge ${sheet ? 'opened a sheet' : `left the strip on ${name}`}: it reached the Scrub strip`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// A tap near a token that wraps takes it only when near one of its lines. A text run broken by a
// line end has a box on each line, and the one box around both also covers the next line's
// </text>: a tap on that end tag, 40pt from the run, selects the element and opens nothing.
async function aTapNearAWrappedTokenTakesOnlyWhatIsNear(browser, origin) {
  const WRAPPED = `<svg xmlns="${SVG_NS}">\n<text xmlns="${SVG_NS}">aaaa\nb</text>\n</svg>\n`;
  await withPage(browser, origin, 956, async (page, errors) => {
    const opened = await page.evaluate((t) => window.drawTest.render(t), WRAPPED);
    must(opened.ok, `test setup: ${opened.error}`);
    await showCode(page);
    const r = await page.evaluate(() => {
      const run = document.querySelector('.draw-code .cv-text');
      const tag = [...document.querySelectorAll('.cv-block')].find((b) => b.textContent === '</text>').getBoundingClientRect();
      const lines = new Set([...run.getClientRects()].map((q) => Math.round(q.top))).size;
      return { lines, box: run.getBoundingClientRect().toJSON(), at: { x: tag.right - 2, y: tag.top + tag.height / 2 } };
    });
    must(r.lines === 2, `test setup: the text run is on ${r.lines} line(s), not 2`);
    must(r.at.x > r.box.left && r.at.x < r.box.right && r.at.y > r.box.top && r.at.y < r.box.bottom, 'test setup: the tap is not inside the box around the wrapped run');
    await page.touchscreen.tap(r.at.x, r.at.y);
    await page.waitForTimeout(100);
    must(await page.locator('.draw-modal').count() === 0, 'a tap on </text>, 40pt from the wrapped text run, opened its Text sheet');
    must(await page.locator('.draw-sel').textContent() === '<text>', 'the tap on </text> did not select its element');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Only a finger that stayed put, alone, is a tap on the code: a swipe that ends on a colour or a
// keyword, and two fingers down together on two tokens, open nothing and write nothing.
async function swipesAndPinchesOverTheCodeEditNothing(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await showCode(page);
    const src = () => page.evaluate(() => window.drawTest.source());
    const nothing = async (what) => {
      await page.waitForTimeout(50);
      const opened = (await page.locator('.draw-modal').count()) + (await page.locator('.draw-strip').count());
      must(opened === 0, `${what} opened a sheet or the Scrub strip`);
      must(await src() === SAMPLE, `${what} changed the file`);
    };
    // From a block's first characters (plain text, "<circle"), with the mouse, onto a token.
    const swipe = async (block, token) => {
      await block.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const from = await block.evaluate((el) => {
        const q = el.getClientRects()[0];
        return { x: q.left + 3, y: q.top + q.height / 2 };
      });
      const b = await token.boundingBox();
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
      await page.mouse.up();
    };
    const circle = page.locator('.cv-block', { hasText: '<circle' });
    await swipe(circle, circle.locator('.cv-color').first());
    await nothing('a swipe that ends on a colour');
    const polyline = page.locator('.cv-block', { hasText: '<polyline' });
    await swipe(polyline, polyline.locator('.cv-enum').first());
    await nothing('a swipe that ends on a keyword');
    await circle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.evaluate(() => {
      const block = [...document.querySelectorAll('.cv-block')].find((b) => b.textContent.startsWith('<circle'));
      const fire = (el, type, id) => {
        const q = el.getBoundingClientRect();
        el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 21, clientX: q.x + q.width / 2, clientY: q.y + q.height / 2, bubbles: true, cancelable: true }));
      };
      const r = block.querySelectorAll('.cv-number')[2];
      const fill = block.querySelector('.cv-color');
      fire(r, 'pointerdown', 21);
      fire(fill, 'pointerdown', 22);
      fire(r, 'pointerup', 21);
      fire(fill, 'pointerup', 22);
    });
    await nothing('two fingers down together on r and fill');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The code marks the number the Scrub strip is editing: of the polyline's two 91s, the one tapped,
// through a step of the strip and while the Number sheet edits it, until Done.
async function theCodeMarksTheStripsNumber(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await showCode(page);
    const numbers = page.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-number');
    must(await numbers.nth(3).textContent() === '91' && await numbers.nth(7).textContent() === '91', 'test setup: the polyline does not have two 91s');
    await tapToken(numbers.nth(7));
    await page.locator('.draw-strip').waitFor();
    const marked = () => page.evaluate(() => {
      const marks = document.querySelectorAll('.draw-code .cv-focus');
      const block = [...document.querySelectorAll('.cv-block')].find((b) => b.textContent.startsWith('<polyline'));
      return { count: marks.length, index: [...block.querySelectorAll('.cv-number')].indexOf(marks[0]), text: marks[0]?.textContent ?? null };
    });
    let m = await marked();
    must(m.count === 1 && m.index === 7, `the code marks ${m.count} number(s) (number ${m.index} of the polyline), not the second 91 the strip holds`);
    await page.locator('.draw-strip button', { hasText: '+' }).tap();
    m = await marked();
    must(m.count === 1 && m.index === 7 && m.text === '92', `after + the mark is ${JSON.stringify(m)}, not on the 92 it wrote`);
    await page.locator('.draw-strip-value').tap();
    await page.locator('.draw-modal input').first().fill('95');
    m = await marked();
    must(m.count === 1 && m.index === 7 && m.text === '95', `while the Number sheet writes 95 the mark is ${JSON.stringify(m)}`);
    await page.locator('.draw-modal-done').tap();
    await page.locator('.draw-done').tap();
    must((await marked()).count === 0, 'Done left a number marked');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// After a touch drag of the code sheet's handle (which the browser follows with no click), the
// next tap on the handle still steps the detent. Chromium drags with real touch (CDP); WebKit gets
// the same Pointer Events, as pointer 1 (the mouse's, the one a synthetic event may capture). The
// tap waits out the double-tap window: in it, Chromium sends a tap after a touch drag no click.
async function aHandleDragLeavesTheNextTapWorking(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const handle = page.locator('.draw-handle');
    const detent = () => page.locator('.draw-sheet').evaluate((el) => /draw-sheet--(\w+)/.exec(el.className)[1]);
    const b = await handle.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    if (chromium(browser)) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 20 * i }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await handle.evaluate((el, [x, y]) => {
        const fire = (type, dy) => el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y - dy, bubbles: true, cancelable: true }));
        fire('pointerdown', 0);
        for (let i = 1; i <= 10; i++) fire('pointermove', 20 * i);
        fire('pointerup', 200);
      }, [x, y]);
    }
    await page.waitForTimeout(800);
    const dragged = await detent();
    must(dragged !== 'peek', `test setup: a 200pt drag up left the sheet at ${dragged}`);
    await handle.tap();
    const after = await detent();
    must(after !== dragged, `a tap on the handle after a drag left the sheet at ${after}: the drag swallowed it`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The selection outline stays above the drawing. A document that lifts its root (a style on it, or
// a :host rule in its own <style>, as high as z-index goes) could otherwise paint over the outline
// and draw a fake one elsewhere. The test makes the marks hittable to read what paints on top at
// the outline's own edge.
async function theOutlineStaysAboveTheDrawing(browser, origin) {
  const RECT = '<rect x="20" y="30" width="60" height="40" fill="#0f0"/>';
  const cases = {
    'a style on its root': svgDoc(RECT, ' style="position:relative;z-index:1"'),
    'a :host rule': svgDoc(`<style>:host{position:relative!important;z-index:2147483647!important}</style>${RECT}`),
  };
  for (const [name, text] of Object.entries(cases)) {
    await withPage(browser, origin, 956, async (page, errors) => {
      const opened = await page.evaluate((t) => window.drawTest.render(t), text);
      must(opened.ok, `test setup (${name}): ${opened.error}`);
      const c = await page.evaluate(() => {
        const b = document.querySelector('.draw-host').shadowRoot.querySelector('rect').getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      await page.touchscreen.tap(c.x, c.y);
      const top = await page.evaluate(() => {
        const outline = document.querySelector('.draw-outline');
        const [[x0, y0], [x1, y1]] = outline.getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number));
        const o = document.querySelector('.draw-overlay').getBoundingClientRect();
        for (const el of [document.querySelector('.draw-marks'), document.querySelector('.draw-overlay')]) el.style.pointerEvents = 'auto';
        outline.style.pointerEvents = 'stroke';
        const hit = document.elementFromPoint(o.left + (x0 + x1) / 2, o.top + (y0 + y1) / 2);
        return hit === outline ? 'outline' : hit?.className || hit?.localName;
      });
      must(top === 'outline', `with ${name} lifted, the drawing (${top}) paints over the selection outline`);
      must(errors.length === 0, `errors:\n${errors.join('\n')}`);
    });
  }
}

// (i) The initial JS (the entry module and what it preloads) is at most 250 KB gzipped.
async function initialJsBudget() {
  const html = readFileSync(join(SITE_DRAW, 'index.html'), 'utf8');
  const urls = [...html.matchAll(/<script[^>]*\bsrc="([^"]+\.js)"|<link[^>]*rel="modulepreload"[^>]*href="([^"]+\.js)"/g)].map((m) => m[1] ?? m[2]);
  must(urls.length >= 1, 'test setup: no script in the built index.html');
  const bytes = urls.reduce((n, u) => n + gzipSync(readFileSync(join(SITE_DRAW, u.replace(/^\/draw\//, '')))).length, 0);
  must(bytes <= 250_000, `the initial JS is ${(bytes / 1000).toFixed(1)} KB gzipped, over the 250 KB budget`);
  console.log(`     draw: initial JS ${(bytes / 1000).toFixed(1)} KB gzipped (${urls.length} file${urls.length === 1 ? '' : 's'})`);
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
