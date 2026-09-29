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
// initial JS budget. P0-M4 adds files: opening through the file picker (.svg, .svgz, Latin-1), a
// paste, a drop and an #import link, the import report, as-is and clean export byte for byte,
// drafts that survive a reload and lock a second tab out, nothing opened any way running or
// loading, the phone rules on the new sheets, a loud full quota, and the ledger loaded only for
// the Support tab. The P0-M4 review adds: an edit made just before a real reload survives it, and
// hiding the page saves; a link that arrives in an open tab waits for Open, and one only looked at
// is not stored; UTF-16, .svgz and invalid bytes on export; the reminder an export clears; no
// metadata under Editable; a failed save that stays loud across other drawings; a damaged draft
// record and a panel that throws never blank the app; notices over the Files menu; the Files sheet
// above the keyboard; and the Support search first, with each row's name. P0-M5 adds the code
// panel's tools: the legend, Tidy (the file never changes), Copy, the keyboard on tokens, colour
// swatches, read-only code as plain text, a file that isn't well-formed as read-only source, the
// Number sheet's hold-to-repeat and slider, the sheets' Done, dim and Escape (and the opening tap's
// click kept out of them), only the changed token flashing, Play under reduced motion, the theme
// (the system's, or one chosen in Files), a tap on the canvas under 5pt, the code docked beside
// the canvas on wide screens, and a render error caught and drawn again. The P0-M5 review adds: a
// tag's close never alone on a line in Tidy, Play from the top and Pause holding the frame, no
// theme flash on load, the legend verb first with chip samples, Enter closing the Number sheet,
// and Export and the legend over a file shown as source. P1-M0 holds the engine's parser to the
// browser's own: every corpus file parses in both to the same canonical tree (xml-canon.mjs, after
// its KNOWN differences), and probe by probe, what the browser refuses the engine refuses, and what
// the engine refuses as not well-formed the browser refuses too. Every check that passes in every
// call, having asserted something, is a line of the support ledger's e2e evidence (EVIDENCE, below).

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILE_VERSION } from '../../../scripts/lib/svg-profile.mjs';
import { RENDER_SVG_ATTRIBUTES, RENDER_SVG_ELEMENTS, RENDER_XHTML_ATTRIBUTES, RENDER_XHTML_ELEMENTS } from '../../../engine/policy/tables.ts';
import probe from './probe-shadow.mjs';
import rendererPatch from './renderer-patch.mjs';
import { detentHeights } from '../src/detents.ts';
import { encodeImport } from '../src/platform/files.ts';
import { parseDoc } from '../../../engine/model/doc.ts';
import { importReport } from '../../../engine/report/import-report.ts';
import { decodePng } from './probe-helpers/png.mjs';
import { browserCanon, canonDiffs, engineCanon, PROBES } from './probe-helpers/xml-canon.mjs';

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

// The ledger's e2e evidence: one line per check that passed, in this run and this engine. A ledger
// row may cite a check as projects/draw/test/e2e.mjs#<function name>, and
// `ledger-check --e2e-evidence` (after `npm test` in `npm run verify` and in CI, so WebKit there)
// requires every cited check to be here. A check has a line only when every call of it (a check
// run for several heights or themes is called once for each) passed and asserted something; the
// file is written once, when the run ends, and its last line says the run completed.
const EVIDENCE = join(HERE, '../../../.smoke/draw-e2e-evidence.jsonl');
// These two assert in their own modules (renderer-patch.mjs, probe-shadow.mjs), which throw on
// every failure, rather than through must().
const DELEGATES = new Set(['rendererPatchCases', 'shadowRootProbe']);

// Every check runs even after one fails, and the run fails with all their messages: WebKit runs
// only in CI, so one run should show everything it disagrees with.
export default async function run({ browser, origin, engine = browser.browserType().name() }) {
  const failures = [];
  const passed = new Set();
  const unproven = new Set(); // failed, or asserted nothing, in at least one call
  let calls = 0;
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, '');
  const check = async (fn, ...args) => {
    calls++;
    const before = asserted;
    try {
      await fn(browser, origin, ...args);
      if (asserted > before || DELEGATES.has(fn.name)) passed.add(fn.name);
      else {
        unproven.add(fn.name);
        console.log(`     draw e2e: ${fn.name}${args.length ? ` (${args.join(', ')})` : ''} asserted nothing, so it is no evidence`);
      }
    } catch (e) {
      unproven.add(fn.name);
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
  // P0-M4: files, drafts and export.
  await check(openThroughTheFilePicker);
  await check(pasteOpensSvg);
  await check(dropOnTheCanvasOpens);
  await check(importLinkRoundTrip);
  await check(importReportBuckets);
  await check(exportIsTheFileByteForByte);
  await check(draftSurvivesReloadAndLocks);
  await check(nothingOpenedRuns);
  for (const height of [956, 796]) await check(phoneRulesOnTheFileSheets, height);
  await check(aFullQuotaIsLoud);
  await check(theLedgerLoadsOnlyForSupport);
  // The P0-M4 review.
  await check(aFailedSaveSurvivesSwitchingDrawings);
  await check(aDamagedDraftNeverBlanksTheApp);
  await check(noticesShowOverTheFilesMenu);
  await check(theFilesSheetStaysAboveTheKeyboard);
  // P0-M5: the code panel's tools, and the shared behaviour SVG Lab's labs have.
  await check(theLegendExplainsTheTokenColours);
  await check(colourTokensShowTheirSwatch);
  await check(theThemeFollowsTheSystemOrTheChoice);
  await check(tidyLaysOutTheCodeAndNeverTheFile);
  await check(tidyKeepsEachCloseWithItsTag);
  await check(copyPutsTheFileOnTheClipboard);
  await check(tokensTakeTheKeyboard);
  await check(readOnlyCodeIsPlainText);
  await check(aMalformedFileOpensAsReadOnlySource);
  await check(theNumberSheetHoldsAndSlides);
  await check(sheetsCloseWithDoneTheDimAndEscape);
  await check(onlyTheChangedTokenFlashes);
  await check(playStartsTheMotionUnderReducedMotion);
  await check(aShortMoveOnTheCanvasIsATap);
  await check(theCodeDocksBesideTheCanvasOnWideScreens);
  await check(aRenderErrorIsCaughtAndRedrawn);
  for (const height of [956, 796]) await check(phoneRulesOnTheCodeTools, height);
  // P1-M0: the engine's parser against the browser's.
  await check(corpusTreesMatchTheBrowsersParser);
  await check(theEngineRefusesWhatTheBrowserRefuses);
  const proven = [...passed].filter((name) => !unproven.has(name));
  const lines = [...proven.map((name) => ({ file: 'projects/draw/test/e2e.mjs', name, engine })), { complete: true, engine, calls }];
  writeFileSync(EVIDENCE, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
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
  // An attribute written twice: browsers refuse such a file, and so does Draw's parser, so it never
  // reaches the canvas (which would refuse the element too: hasDuplicateAttrs).
  { label: 'fill written twice', text: svgDoc('<rect width="10" height="10" fill="red" fill="blue"/>'), unparsed: 'attribute fill is written twice in <rect>' },
  { label: 'attributeName written twice', text: svgDoc('<rect width="10" height="10"><animate attributeName="opacity" attributeName="width" values="1;2" dur="1s"/></rect>'), unparsed: 'attribute attributeName is written twice in <animate>' },
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
      if (c.unparsed) return !stats.ok && stats.error === c.unparsed && stats.rendered === 0 ? [] : [`${c.label}: the canvas reports ${JSON.stringify(stats)}, not the parser's refusal (${c.unparsed})`];
      if (!stats.ok) return [`${c.label}: did not render (${stats.error})`];
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
    const flash = await page.locator('.cv-block', { hasText: '<circle' }).locator('.cv-number').first().evaluate((el) => el.classList.contains('cv-flash'));
    must(flash, "the scrubbed token doesn't flash (cv-flash)");
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

// ── P0-M4: files, drafts and export ────────────────────────────────────────────────────────────

const corpusBytes = (rel) => readFileSync(join(CORPUS, rel));
const corpusText = (rel) => readFileSync(join(CORPUS, rel), 'utf8');
// A file that says ISO-8859-1 (read as windows-1252, as browsers do): é, and 0x80, which is €.
const LATIN1 = Buffer.concat([
  Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><title>Caf'),
  Buffer.from([0xe9]),
  Buffer.from('</title><text x="10" y="25">Caf'),
  Buffer.from([0xe9, 0x20, 0x80]),
  Buffer.from('</text></svg>\n'),
]);
// UTF-16 bytes, in either byte order.
const utf16 = (text, le) => {
  const out = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i++) (le ? out.writeUInt16LE : out.writeUInt16BE).call(out, text.charCodeAt(i), i * 2);
  return out;
};
// Script in every form a file can carry it, and things that would load from elsewhere.
const ACTIVE = `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" onload="window.__pwned='onload'">
  <script>window.__pwned = 'script'</script>
  <rect width="100" height="100" fill="#8ecae6" onclick="window.__pwned='onclick'"/>
  <image href="https://example.com/x.png" width="10" height="10"/>
  <use xlink:href="https://example.com/sprite.svg#a"/>
  <a href="javascript:window.__pwned='link'"><circle cx="50" cy="50" r="20"/></a>
  <foreignObject width="50" height="50"><iframe xmlns="${XHTML_NS}" src="https://example.com/"/></foreignObject>
</svg>`;

const firstIcon = () => 'icons/lucide/' + readdirSync(join(CORPUS, 'icons/lucide')).filter((f) => f.endsWith('.svg')).sort()[0];
const source = (page) => page.evaluate(() => window.drawTest.source());
const drawnCount = (page) => page.evaluate(() => document.querySelector('.draw-host').shadowRoot.querySelectorAll('svg, svg *').length);
const bucketCounts = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.draw-bucket')].map((b) => [b.dataset.bucket, Number(b.dataset.count)])));

async function openFilesMenu(page) {
  await page.locator('.draw-files').tap();
  await page.locator('.draw-open').waitFor();
}

// The Files menu's Open…: the picker's file input (accept lists .svg for iOS).
async function pickFile(page, name, buffer) {
  await openFilesMenu(page);
  const input = page.locator('.draw-modal input[type="file"]');
  must((await input.getAttribute('accept'))?.split(',').includes('.svg'), 'the file input does not list .svg (iOS offers only what it lists)');
  await input.setInputFiles({ name, mimeType: 'image/svg+xml', buffer });
  await page.locator('.draw-bucket, .draw-failure').first().waitFor();
}

async function closeModal(page) {
  await page.locator('.draw-modal-done').tap();
  await page.locator('.draw-modal').waitFor({ state: 'detached' });
}

// Poll from node (the app's CSP blocks string predicates in the page).
async function until(what, fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting until ${what}`);
    await new Promise((ok) => setTimeout(ok, 50));
  }
}

// Runs in the page: a paste event with this clipboard data, where a ⌘V (or the paste menu) sends it.
function firePaste({ selector, data }) {
  const dt = new DataTransfer();
  for (const [type, text] of Object.entries(data)) dt.setData(type, text);
  const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  (selector ? document.querySelector(selector) : document).dispatchEvent(e);
  return e.defaultPrevented;
}

// Runs in the page: a file dropped on the canvas (dragover, then drop). WebKit builds without
// DataTransferItemList.add fall back to the SVG as data, which the drop reads the same way.
function fireDrop({ name, text }) {
  const dt = new DataTransfer();
  let file = true;
  try {
    dt.items.add(new File([text], name, { type: 'image/svg+xml' }));
  } catch {
    file = false;
    dt.setData('image/svg+xml', text);
  }
  const area = document.querySelector('.draw-canvas');
  const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
  area.dispatchEvent(over);
  const drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
  area.dispatchEvent(drop);
  return { file, accepted: over.defaultPrevented, taken: drop.defaultPrevented };
}

// (a) Open… through the file input: a plain .svg, a gzip .svgz and a Latin-1 file each open whole
// (the editor holds the file's text, the canvas draws it), named after the file, with the report.
async function openThroughTheFilePicker(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const cases = [
      ['a plain .svg', 'layers.svg', corpusBytes('tools/inkscape-1x-layers.svg'), corpusText('tools/inkscape-1x-layers.svg')],
      ['a gzip .svgz', 'spinner.svgz', gzipSync(corpusBytes('lab/spin--js.svg')), corpusText('lab/spin--js.svg')],
      ['a Latin-1 file', 'café.svg', LATIN1, new TextDecoder('windows-1252').decode(LATIN1)],
    ];
    for (const [what, name, buffer, text] of cases) {
      await pickFile(page, name, buffer);
      if (await page.locator('.draw-failure').count()) throw new Error(`${what}: ${await page.locator('.draw-failure').textContent()}`);
      must(await source(page) === text, `${what}: the editor does not hold the file's text`);
      must(await page.locator('.draw-name').textContent() === name.replace(/\.svgz?$/, ''), `${what}: the drawing is named ${await page.locator('.draw-name').textContent()}`);
      must(await drawnCount(page) > 1, `${what}: the canvas draws nothing`);
      await closeModal(page);
    }
    const drawn = await page.evaluate(() => document.querySelector('.draw-host').shadowRoot.querySelector('text').textContent);
    must(drawn === 'Café €', `the Latin-1 file's text draws as ${JSON.stringify(drawn)}`);
    // A file that fails opens nowhere: the error and where, and the drawing that was open stays. (One
    // that isn't well-formed opens as read-only source: aMalformedFileOpensAsReadOnlySource.)
    const before = await source(page);
    await pickFile(page, 'page.svg', Buffer.from('<!-- a page -->\n<html xmlns="http://www.w3.org/1999/xhtml"/>'));
    const said = await page.locator('.draw-failure').textContent();
    must(said === 'Line 2, column 1: the root element is <html>, not an <svg> in the SVG namespace.', `a file that fails says ${JSON.stringify(said)}`);
    must(await source(page) === before && await page.locator('.draw-name').textContent() === 'café', 'a file that fails replaced the drawing');
    await closeModal(page);
    // A file that isn't markup at all (a PNG) says so, not "line 1, column 1" over its bytes.
    await pickFile(page, 'photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]));
    const png = await page.locator('.draw-failure').textContent();
    must(png === 'This isn’t an SVG file.', `a PNG says ${JSON.stringify(png)}`);
    must(await page.locator('.draw-excerpt').count() === 0, 'a PNG shows an excerpt of its bytes');
    await closeModal(page);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (b) Paste: the paste event's own clipboard data (no clipboard-read permission prompt). ⌘V outside
// a field opens SVG (image/svg+xml before text/plain) and ignores plain words; the Files menu's
// field takes a long-press paste on the phone; a paste that fails says where and keeps the drawing.
async function pasteOpensSvg(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const icon = corpusText(firstIcon());
    const taken = await page.evaluate(firePaste, { selector: null, data: { 'text/plain': 'just words' } });
    must(!taken && await source(page) === SAMPLE, 'a paste of plain words outside a field did something');
    must(await page.evaluate(firePaste, { selector: null, data: { 'text/plain': 'not this', 'image/svg+xml': icon } }), 'a paste of image/svg+xml was not taken');
    await page.locator('.draw-bucket').first().waitFor();
    must(await source(page) === icon, 'the pasted image/svg+xml did not open');
    must(await page.locator('.draw-name').textContent() === 'Pasted drawing', 'a paste is not named "Pasted drawing"');
    await closeModal(page);

    const figma = corpusText('tools/figma-card-drop-shadow.svg');
    await openFilesMenu(page);
    await page.evaluate(firePaste, { selector: '.draw-paste', data: { 'text/plain': figma } });
    await page.locator('.draw-bucket').first().waitFor();
    must(await source(page) === figma, "the Files menu's paste field did not open what was pasted into it");
    await closeModal(page);

    const bad = '<!-- a page -->\n  <html xmlns="http://www.w3.org/1999/xhtml"><svg/></html>\n';
    await page.evaluate(firePaste, { selector: null, data: { 'text/plain': bad } });
    await page.locator('.draw-failure').waitFor();
    const said = await page.locator('.draw-failure').textContent();
    must(said === 'Line 2, column 3: the root element is <html>, not an <svg> in the SVG namespace.', `a paste that fails says ${JSON.stringify(said)}`);
    must(/<html[^\n]*\n {2}\^$/.test(await page.locator('.draw-excerpt').textContent()), 'the failure does not point at where it failed');
    must(await source(page) === figma, 'a paste that fails changed the drawing');
    await closeModal(page);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (c) A file dropped on the canvas opens (iPad, desktop): the canvas accepts the drag and takes the drop.
async function dropOnTheCanvasOpens(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const text = corpusText('tools/sketch-symbol-mask.svg');
    const r = await page.evaluate(fireDrop, { name: 'dropped-card.svg', text });
    must(r.accepted, 'the canvas does not accept a dragged file (dragover not cancelled)');
    must(r.taken, 'the canvas left the drop to the browser');
    await page.locator('.draw-bucket').first().waitFor();
    must(await source(page) === text, 'the dropped file did not open');
    if (r.file) must(await page.locator('.draw-name').textContent() === 'dropped-card', 'a dropped file is not named after itself');
    must(await drawnCount(page) > 1, 'the canvas draws nothing');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (d) An #import link (SVG Lab's "Open in Draw"): encoded here with the app's own encodeImport, it
// opens on load with its report, and the fragment is gone from the URL at once. Only looked at, it
// is not stored, so a reload shows the sample and imports nothing again; edited, it is a draft that
// a reload reopens. One that arrives in an open tab (a hash change, which a page that opened Draw
// can cause) opens only on Open: until then nothing changes, and Not now keeps the drawing.
async function importLinkRoundTrip(browser, origin) {
  const text = corpusText('tools/figma-gradient-mask-pattern.svg');
  const link = `${origin}/draw/#${await encodeImport(text)}`;
  await withPage(browser, origin, 956, async (page, errors) => {
    await page.goto('about:blank');
    await page.goto(link, { waitUntil: 'networkidle' });
    await page.locator('.draw-bucket').first().waitFor();
    must(await source(page) === text, 'the #import link did not open its file');
    must(await page.evaluate(() => location.hash) === '' && page.url() === `${origin}/draw/`, `the fragment is still in the URL: ${page.url().slice(0, 80)}`);
    await closeModal(page);
    await page.waitForTimeout(300);
    must(await page.locator('.draw-save').count() === 0, 'a link only looked at became a draft');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    must(await source(page) === SAMPLE, 'the reload did not show the sample: it imported the link again, or stored it');
    must(await page.locator('.draw-modal').count() === 0, 'the reload showed a report: it imported the link again');

    // Edited, the link is a draft, and the reload reopens it.
    const linked = SAMPLE.replace('<title>A sun setting over two hills</title>', '<title>A linked sunset</title>');
    await page.goto('about:blank');
    await page.goto(`${origin}/draw/#${await encodeImport(linked)}`, { waitUntil: 'networkidle' });
    await page.locator('.draw-bucket').first().waitFor();
    await closeModal(page);
    await showCode(page);
    await tapToken(page.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-enum').first());
    const edited = await source(page);
    must(edited !== linked, 'test setup: the keyword did not change');
    await page.locator('.draw-save[data-save="saved"]').waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await until('the edited link reopens as a draft', async () => (await source(page)) === edited);
    must(await page.locator('.draw-name').textContent() === 'A linked sunset', 'the draft is not named by its <title>');
    await openFilesMenu(page);
    await page.locator('.draw-draft').first().waitFor();
    must(await page.locator('.draw-draft').count() === 1, `the reload made ${await page.locator('.draw-draft').count()} drafts, not 1`);
    await closeModal(page);

    // A link that arrives in the open tab: offered, cleared from the URL at once, opened only on Open.
    const icon = corpusText(firstIcon());
    for (const t of [text, icon]) await page.evaluate((frag) => (location.hash = frag), await encodeImport(t));
    await page.locator('.draw-link-open').waitFor({ timeout: 3000 }).catch(() => {
      throw new Error('a link that arrived in the open tab was not offered first (Open, Not now)');
    });
    must(await page.evaluate(() => location.hash) === '', 'that fragment stayed in the URL');
    must(await source(page) === edited, 'a link that arrived in the open tab opened without a tap');
    await page.locator('.draw-link-not').tap();
    await page.locator('.draw-modal').waitFor({ state: 'detached' });
    must(await source(page) === edited, 'Not now changed the drawing');
    await page.evaluate((frag) => (location.hash = frag), await encodeImport(icon));
    await page.locator('.draw-link-open').tap();
    await page.locator('.draw-bucket').first().waitFor();
    must(await source(page) === icon, 'Open did not open the link');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (e) The import report after every open: the four buckets with the ledger's counts (the engine's
// importReport, run here on the same file), a script under preview-only, Inkscape's data kept, the
// notes; and the Files menu shows it again.
async function importReportBuckets(browser, origin) {
  const expect = (rel) => {
    const r = parseDoc(corpusText(rel));
    must(r.ok, `test setup: ${rel} does not parse`);
    return importReport(r.doc);
  };
  await withPage(browser, origin, 956, async (page, errors) => {
    for (const [rel, bucket, items] of [['lab/spin--js.svg', 'preview', ['<script>']], ['tools/inkscape-1x-layers.svg', 'kept', ['inkscape:label', '<rdf:RDF>', 'rdf:about']]]) {
      await pickFile(page, rel.split('/').pop(), corpusBytes(rel));
      const want = expect(rel);
      const got = await bucketCounts(page);
      must(JSON.stringify(got) === JSON.stringify(want.totals), `${rel}: the report shows ${JSON.stringify(got)}, not ${JSON.stringify(want.totals)}`);
      must(got[bucket] > 0, `${rel}: nothing is ${bucket}`);
      const listed = await page.locator(`.draw-group[data-bucket="${bucket}"] .draw-item`).allTextContents();
      for (const item of items) must(listed.some((t) => t.startsWith(item)), `${rel}: ${item} is not listed under ${bucket} (${listed.slice(0, 6).join(', ')})`);
      const notes = await page.locator('.draw-notes li').allTextContents();
      must(JSON.stringify(notes) === JSON.stringify(want.notes), `${rel}: the notes are ${JSON.stringify(notes)}`);
      // The file's Creative Commons block (RDF, Dublin Core) is metadata Draw keeps, never edits.
      const editable = await page.locator('.draw-group[data-bucket="editable"] .draw-item .ds-mono').allTextContents();
      const metadata = editable.filter((t) => /^<?(rdf|dc|dcterms|cc):/.test(t));
      must(metadata.length === 0, `${rel}: metadata is listed as editable: ${metadata.join(', ')}`);
      await closeModal(page);
    }
    await openFilesMenu(page);
    await page.locator('.draw-report-again').tap();
    await page.locator('.draw-bucket').first().waitFor();
    must(JSON.stringify(await bucketCounts(page)) === JSON.stringify(expect('tools/inkscape-1x-layers.svg').totals), 'the Files menu does not show the open file\'s report again');
    await closeModal(page);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (f) Export, captured as downloads (the share sheet is taken away, as on a desktop browser): the
// as-is file is byte-identical to the file opened (CRLF and entities, a BOM, Latin-1, UTF-16 in
// either byte order with or without a declaration), Save to Files too for now, and Clean has no
// inkscape: or sodipodi: left and keeps the rest. Each export says so and closes the sheet. A .svgz
// exports as its plain .svg (the sheet says uncompressed); a file with bytes that weren't valid
// says the export differs. After an edit, as-is is what the editor holds; and an export clears
// the draft's "not exported" reminder in the Files menu.
async function exportIsTheFileByteForByte(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await page.evaluate(() => {
      navigator.canShare = undefined;
    });
    const exportAs = async (kind) => {
      await page.locator('.draw-export').tap();
      const go = page.locator(`.draw-export-go[data-kind="${kind}"]`);
      await go.waitFor();
      const [download] = await Promise.all([page.waitForEvent('download'), go.tap()]);
      return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
    };
    // ASCII names: Chromium on Linux names a download "download" when its name can't be written in
    // the system's locale (C in the container and in CI), which is no fault of Draw's.
    for (const [name, bytes] of [['entities-crlf.svg', corpusBytes('tools/illustrator-cs6-entities-pgf.svg')], ['bom.svg', corpusBytes('tools/edge-utf8-bom.svg')], ['cafe-latin1.svg', LATIN1], ['wide-le.svg', utf16(`\uFEFF${SAMPLE}`, true)], ['wide-be.svg', utf16(`\uFEFF<?xml version="1.0" encoding="UTF-16"?>\n${SAMPLE}`, false)]]) {
      await pickFile(page, name, bytes);
      await closeModal(page);
      for (const kind of ['as-is', 'working']) {
        const got = await exportAs(kind);
        must(got.name === name, `${kind}: the file is named ${got.name}, not ${name}`);
        must(got.bytes.equals(bytes), `${name}: the ${kind} export differs from the file opened (${got.bytes.length} bytes, not ${bytes.length})`);
        await page.locator('.draw-modal').waitFor({ state: 'detached' });
        must(await page.locator('.draw-toast').textContent() === `Downloaded ${name}`, `${kind}: no "Downloaded" notice`);
      }
    }
    await pickFile(page, 'poster.svg', corpusBytes('tools/inkscape-1x-layers.svg'));
    await closeModal(page);
    const clean = await exportAs('clean');
    const text = clean.bytes.toString('utf8');
    must(clean.name === 'poster-clean.svg', `the clean file is named ${clean.name}`);
    must(!/inkscape:|sodipodi:/.test(text), 'the clean export still has inkscape: or sodipodi:');
    must(text.includes('<dc:title>Poster</dc:title>') && text.includes('Summer  Fair'), 'the clean export lost more than editor data');

    // A .svgz: as-is is the plain file, and the sheet says so.
    await pickFile(page, 'spinner.svgz', gzipSync(corpusBytes('lab/spin--js.svg')));
    await closeModal(page);
    await page.locator('.draw-export').tap();
    const say = await page.locator('.draw-export-go[data-kind="as-is"] + .draw-export-say').textContent();
    must(/uncompressed/.test(say), `the sheet says "${say}" for a .svgz`);
    await closeModal(page);
    const plain = await exportAs('as-is');
    must(plain.name === 'spinner.svg' && plain.bytes.equals(corpusBytes('lab/spin--js.svg')), `a .svgz exports as ${plain.name}, ${plain.bytes.length} bytes`);

    // A byte that wasn't valid UTF-8 can't be written back: the sheet says the files differ there.
    await pickFile(page, 'bad-byte.svg', Buffer.concat([Buffer.from(`<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><title>Caf`), Buffer.from([0xe9]), Buffer.from('</title></svg>')]));
    must((await page.locator('.draw-notes li').first().textContent()).startsWith('Some bytes in the file aren’t valid UTF-8'), 'the report does not say some bytes were not valid');
    await closeModal(page);
    await page.locator('.draw-export').tap();
    await page.locator('.draw-lossy').waitFor({ timeout: 2000 }).catch(() => {
      throw new Error('the Export sheet does not say the files differ where bytes were not valid');
    });
    await closeModal(page);

    // After an edit, as-is is the edited file, byte for byte; and an export clears the draft's
    // "not exported" reminder (six days on, by the page's clock: set before a reload, so the app
    // reads time from it).
    await page.clock.setFixedTime(new Date());
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => {
      navigator.canShare = undefined;
    });
    await pickFile(page, 'sunset.svg', Buffer.from(SAMPLE));
    await closeModal(page);
    await showCode(page);
    await tapToken(page.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-enum').first());
    const edited = await source(page);
    must(edited !== SAMPLE, 'test setup: the keyword did not change');
    await page.locator('.draw-save[data-save="saved"]').waitFor();
    await page.clock.setFixedTime(new Date(Date.now() + 6 * 86_400_000));
    const reminder = async () => {
      await openFilesMenu(page);
      const row = page.locator('.draw-draft', { hasText: 'sunset' });
      await row.waitFor();
      const said = await row.locator('.draw-draft-remind').textContent({ timeout: 500 }).catch(() => null);
      await closeModal(page);
      return said;
    };
    const before = await reminder();
    must(before === 'Never exported for 6 days', `six days on, the draft says ${JSON.stringify(before)}`);
    const asIs = await exportAs('as-is');
    must(asIs.bytes.toString('utf8') === edited, 'the as-is export is not what the editor holds after an edit');
    await page.locator('.draw-modal').waitFor({ state: 'detached' });
    must(await reminder() === null, 'the draft still says it was not exported, after an export');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (g) Drafts: an opened file is a draft at once, an edit is saved at once on pagehide and when the
// page is hidden (not a second later), and one made just before a real reload (the page unloading,
// as on closing the tab) is there when it reopens (IndexedDB). A second page in the same browser
// opens the same draft read-only (Web Locks): it says so, and refuses an edit with a notice.
async function draftSurvivesReloadAndLocks(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors, context) => {
    await pickFile(page, 'sunset.svg', Buffer.from(SAMPLE));
    await closeModal(page);
    await page.locator('.draw-save[data-save="saved"]').waitFor();
    await showCode(page);
    await tapToken(page.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-enum').first()); // stroke-linecap
    // At once, well inside the debounce: pagehide must save now, not a second after the edit.
    const was = await page.evaluate(() => {
      const was = document.querySelector('.draw-save').dataset.save;
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      return was;
    });
    must(was === 'pending', `an edit did not wait for the debounce (the save state was ${was})`);
    await page.locator('.draw-save[data-save="saved"]').waitFor({ timeout: 600 }).catch(() => {
      throw new Error('pagehide did not save at once (the debounce is 1 s)');
    });
    must(await source(page) === SAMPLE.replace('stroke-linecap="round"', 'stroke-linecap="square"'), 'test setup: the keyword did not change');

    // The page hidden (the app switcher, a locked phone): saved at once too.
    await tapToken(page.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-enum').first());
    const hid = await page.evaluate(() => {
      const was = document.querySelector('.draw-save').dataset.save;
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      return was;
    });
    must(hid === 'pending', `an edit did not wait for the debounce (the save state was ${hid})`);
    await page.locator('.draw-save[data-save="saved"]').waitFor({ timeout: 600 }).catch(() => {
      throw new Error('hiding the page did not save at once (the debounce is 1 s)');
    });
    await page.evaluate(() => delete document.visibilityState);

    // A real unload, right after an edit: the save pagehide starts must land though the page goes.
    await tapToken(page.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-enum').nth(1)); // stroke-linejoin
    const edited = await source(page);
    must(await page.locator('.draw-save').getAttribute('data-save') === 'pending', 'test setup: the last edit is not waiting for the debounce');
    await page.reload({ waitUntil: 'networkidle' });
    await until('the draft reopens after the reload', async () => (await source(page)) === edited).catch(async () => {
      throw new Error(`the edit made just before a real reload was lost (the draft reopened ${(await source(page)) === SAMPLE ? 'as the sample' : 'without it'})`);
    });
    must(await page.locator('.draw-name').textContent() === 'sunset', 'the reopened draft lost its name');

    const second = await context.newPage();
    const errors2 = [];
    second.on('pageerror', (e) => errors2.push(`uncaught: ${e.message}`));
    second.on('console', (m) => m.type() === 'error' && errors2.push(`console error: ${m.text()}`));
    await second.goto(`${origin}/draw/`, { waitUntil: 'networkidle' });
    await until('the second page opens the draft', async () => (await source(second)) === edited);
    await second.locator('.draw-alert', { hasText: 'read-only' }).waitFor({ timeout: 5000 }).catch(() => {
      throw new Error('the second page does not say the drawing is read-only (Web Locks)');
    });
    must(await second.locator('.draw-save').textContent() === 'Read-only', 'the second page does not say Read-only');
    await showCode(second);
    await tapToken(second.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-enum').first());
    must(await source(second) === edited, 'the read-only page wrote an edit');
    must((await second.locator('.draw-toast').textContent()).includes('read-only'), 'the refused edit says nothing');
    await second.close();
    must(errors.length + errors2.length === 0, `errors:\n${[...errors, ...errors2].join('\n')}`);
  });
}

// (h) Nothing opened runs script, loads from elsewhere or violates the CSP, whichever way it comes
// in: the file picker, a paste, a drop and an #import link, each with a script, handlers, a
// javascript: link, and images, a <use> and an iframe pointing at another origin.
async function nothingOpenedRuns(browser, origin) {
  const link = `${origin}/draw/#${await encodeImport(ACTIVE)}`;
  await withPage(browser, origin, 956, async (page, errors, context) => {
    const quiet = watch(page, context, origin);
    const ways = {
      'the file picker': () => pickFile(page, 'active.svg', Buffer.from(ACTIVE)),
      'a paste': () => page.evaluate(firePaste, { selector: null, data: { 'text/plain': ACTIVE } }),
      'a drop': () => page.evaluate(fireDrop, { name: 'active.svg', text: ACTIVE }),
    };
    for (const [way, open] of Object.entries(ways)) {
      await open();
      await page.locator('.draw-bucket').first().waitFor();
      must(await source(page) === ACTIVE, `${way}: the file did not open`);
      await closeModal(page);
      await page.touchscreen.tap(220, 300); // on the drawing: its onclick and its link, if they were there
      const r = await page.evaluate(() => {
        const root = document.querySelector('.draw-host').shadowRoot;
        const bad = [...root.querySelectorAll('*')].filter((el) => /^(script|iframe)$/i.test(el.localName) || [...el.attributes].some((a) => /^on/i.test(a.name) || /javascript:/i.test(a.value)));
        return { pwned: window.__pwned ?? null, bad: bad.map((el) => el.localName) };
      });
      must(r.pwned === null, `${way}: script ran (${r.pwned})`);
      must(r.bad.length === 0, `${way}: the canvas holds ${r.bad.join(', ')}`);
    }
    await quiet('files opened three ways');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
  await withPage(browser, origin, 956, async (page, errors) => {
    await page.goto('about:blank');
    const away = [];
    page.on('request', (r) => !/^(data|blob):/.test(r.url()) && !r.url().startsWith(`${origin}/`) && away.push(r.url().slice(0, 80)));
    await page.goto(link, { waitUntil: 'networkidle' });
    await page.locator('.draw-bucket').first().waitFor();
    must(await source(page) === ACTIVE, 'the #import link did not open');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ pwned: window.__pwned ?? null, violations: window.__violations }));
    must(r.pwned === null, `the #import link ran script (${r.pwned})`);
    must(away.length === 0, `the #import link loaded from elsewhere: ${away.join(', ')}`);
    must(r.violations.length === 0, `the #import link violated the CSP: ${r.violations.join(', ')}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (i) The phone rules on every new sheet and state: the Files menu with drafts, the import report,
// a failed open, Export, the Open link sheet, the Support tab at half and full, and the read-only
// alert; each modal sits inside the screen.
async function phoneRulesOnTheFileSheets(browser, origin, height) {
  await withPage(browser, origin, height, async (page, errors, context) => {
    const problems = [];
    const rules = async (state) => {
      const r = await page.evaluate(rulesNow, TAP_MIN);
      if (r.small.length) problems.push(`${state}: tap targets under ${TAP_MIN}pt: ${r.small.join(', ')}`);
      if (r.fields.length) problems.push(`${state}: field(s) under 16px: ${r.fields.join(', ')}`);
      if (r.sw > r.cw) problems.push(`${state}: scrolls sideways (${r.sw} > ${r.cw})`);
      if (r.sh > r.ch) problems.push(`${state}: the page scrolls (${r.sh} > ${r.ch})`);
      const modal = await page.evaluate(() => document.querySelector('.draw-modal')?.getBoundingClientRect().toJSON() ?? null);
      if (modal && (modal.top < 0 || modal.bottom > r.ch + 0.5 || modal.left < 0 || modal.right > r.cw + 0.5)) problems.push(`${state}: the sheet ${rect(modal)} is not inside the screen`);
    };
    await pickFile(page, 'spinner.svg', corpusBytes('lab/spin--js.svg'));
    await rules('the import report');
    await closeModal(page);
    await pickFile(page, 'layers.svg', corpusBytes('tools/inkscape-1x-layers.svg'));
    await closeModal(page);
    await openFilesMenu(page);
    await page.locator('.draw-draft-delete').first().waitFor();
    await rules('the Files menu with drafts');
    await page.locator('.draw-draft-delete').first().tap();
    must(await page.locator('.draw-draft-delete').first().textContent() === 'Delete?', 'Delete does not ask again first');
    await rules('the Files menu asking to delete');
    await closeModal(page);
    await page.evaluate(firePaste, { selector: null, data: { 'text/plain': '<html xmlns="http://www.w3.org/1999/xhtml"><svg/></html>' } });
    await page.locator('.draw-failure').waitFor();
    await rules('a failed open');
    await closeModal(page);
    await page.locator('.draw-export').tap();
    await page.locator('.draw-export-go').first().waitFor();
    await rules('Export');
    await closeModal(page);
    await page.evaluate((frag) => (location.hash = frag), await encodeImport(SAMPLE));
    await page.locator('.draw-link-open').waitFor();
    await rules('the Open link sheet');
    await page.locator('.draw-link-not').tap();
    await page.locator('.draw-modal').waitFor({ state: 'detached' });
    await page.locator('.draw-handle').tap();
    await page.locator('.draw-tabs button', { hasText: 'Support' }).tap();
    await page.locator('.draw-ledger-row').first().waitFor();
    await rules('the Support tab at half');
    await page.locator('.draw-handle').tap();
    await rules('the Support tab at full');
    const second = await context.newPage();
    await second.goto(`${origin}/draw/`, { waitUntil: 'networkidle' });
    await second.locator('.draw-alert').waitFor();
    const r = await second.evaluate(rulesNow, TAP_MIN);
    if (r.small.length || r.sw > r.cw || r.sh > r.ch) problems.push(`the read-only alert: ${JSON.stringify({ small: r.small, sw: r.sw, cw: r.cw, sh: r.sh, ch: r.ch })}`);
    await second.close();
    must(problems.length === 0, `440×${height}:\n${problems.join('\n')}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// A full quota is loud and stays: when IndexedDB refuses a write for lack of space, an alert under
// the top bar says to export now (with a button that opens Export) and stays through the next
// change, until a save succeeds.
async function aFullQuotaIsLoud(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      window.__full = true;
      IDBObjectStore.prototype.put = function (...args) {
        if (window.__full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return put.apply(this, args);
      };
    });
    await pickFile(page, 'big.svg', Buffer.from(SAMPLE));
    await closeModal(page);
    const alert = page.locator('.draw-alert--loud');
    await alert.waitFor({ timeout: 5000 }).catch(() => {
      throw new Error('a full quota shows no alert');
    });
    must((await alert.textContent()).includes('export this drawing now'), `the alert says ${JSON.stringify(await alert.textContent())}`);
    must((await alert.textContent()).includes('“big”'), `the alert does not say which drawing isn't saved: ${JSON.stringify(await alert.textContent())}`);
    must(await alert.getAttribute('role') === 'alert', 'the quota message is not an alert');
    must(await page.locator('.draw-save').textContent() === 'Not saved', 'the top bar does not say Not saved');
    const r = await page.evaluate(rulesNow, TAP_MIN);
    must(r.small.length === 0 && r.sh <= r.ch && r.sw <= r.cw, `the alert breaks the phone rules: ${JSON.stringify(r.small)} ${r.sw}/${r.cw} ${r.sh}/${r.ch}`);
    await showCode(page);
    await tapToken(page.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-enum').first());
    await page.waitForTimeout(1500);
    must(await alert.isVisible(), 'the alert went away while nothing was saved');
    await page.locator('.draw-alert-go').tap();
    await page.locator('.draw-export-go').first().waitFor();
    await closeModal(page);
    await page.evaluate(() => (window.__full = false));
    await tapToken(page.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-enum').first());
    await page.locator('.draw-save[data-save="saved"]').waitFor();
    must(await alert.count() === 0, 'the alert stayed after a save succeeded');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// (j) The ledger (about 400 KB) is not in the initial JS: it loads when the Support tab first
// opens, which then summarizes it and searches its rows (the search first, each capability and
// feature row with its name).
async function theLedgerLoadsOnlyForSupport(browser, origin) {
  const html = readFileSync(join(SITE_DRAW, 'index.html'), 'utf8');
  const initial = [...html.matchAll(/<script[^>]*\bsrc="([^"]+\.js)"|<link[^>]*rel="modulepreload"[^>]*href="([^"]+\.js)"/g)].map((m) => m[1] ?? m[2]);
  for (const u of initial) must(!readFileSync(join(SITE_DRAW, u.replace(/^\/draw\//, '')), 'utf8').includes('feature:support-tab'), `the ledger is in the initial JS (${u})`);
  await withPage(browser, origin, 956, async (page, errors) => {
    const loaded = [];
    page.on('request', (r) => loaded.push(r.url()));
    await page.waitForTimeout(300);
    const before = loaded.length;
    await page.locator('.draw-handle').tap();
    await page.locator('.draw-tabs button', { hasText: 'Support' }).tap();
    await page.locator('.draw-ledger-row').first().waitFor();
    const fetched = loaded.slice(before).filter((u) => u.endsWith('.js'));
    must(fetched.length >= 1, 'the Support tab showed the ledger without loading it: it was in the initial bundle');
    const phase = await page.locator('.draw-tally[data-tally="phase"] .ds-row').allTextContents();
    must(phase.some((t) => t.startsWith('P0')), `the summary by phase shows ${phase.join(' | ')}`);
    // The search is on the first screen of the tab at half, above the summary, not screens down.
    const at = await page.evaluate(() => {
      const body = document.querySelector('.draw-sheet-body').getBoundingClientRect();
      const field = document.querySelector('.draw-ledger-search').getBoundingClientRect();
      const tally = document.querySelector('.draw-tally').getBoundingClientRect();
      return { fieldBottom: field.bottom - body.top, bodyHeight: body.height, aboveTally: field.bottom <= tally.top };
    });
    must(at.fieldBottom <= at.bodyHeight && at.aboveTally, `the search is ${Math.round(at.fieldBottom)}pt into a ${Math.round(at.bodyHeight)}pt tab, ${at.aboveTally ? 'above' : 'below'} the summary`);
    await page.locator('.draw-ledger-search').fill('feature:support-tab');
    await until('the search narrows the rows', async () => (await page.locator('.draw-ledger-row').count()) === 1);
    const row = await page.locator('.draw-ledger-row').textContent();
    must(row.includes('feature:support-tab') && row.includes('P0'), `the search found ${row}`);
    must(row.includes('the ledger in the app'), `a feature row does not show its name: ${row}`);
    must(await page.locator('.draw-tally').count() === 0, 'the summary stays between the search and the rows it found');
    await page.locator('.draw-ledger-search').fill('capability:code/download');
    await until('the search finds the capability', async () => (await page.locator('.draw-ledger-row').count()) === 1);
    must((await page.locator('.draw-ledger-row').textContent()).includes('Download (shown only when downloads are available'), 'a capability row does not show its name');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The P0-M4 review: a drawing whose save failed stays loud while another is open (the alert names
// it and offers Files), and reopening its draft brings its unsaved changes back; freeing space
// stores them.
async function aFailedSaveSurvivesSwitchingDrawings(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await pickFile(page, 'other.svg', Buffer.from(`<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>`));
    await closeModal(page);
    await pickFile(page, 'mine.svg', Buffer.from(SAMPLE));
    await closeModal(page);
    await page.locator('.draw-save[data-save="saved"]').waitFor();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      window.__full = true;
      IDBObjectStore.prototype.put = function (...args) {
        if (window.__full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return put.apply(this, args);
      };
    });
    await showCode(page);
    await tapToken(page.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-enum').first());
    const unsaved = await source(page);
    const alert = page.locator('.draw-alert--loud');
    await alert.waitFor({ timeout: 5000 });
    await openFilesMenu(page);
    await page.locator('.draw-draft', { hasText: 'other' }).locator('.draw-draft-open').tap();
    await until('the other drawing opens', async () => (await page.locator('.draw-name').textContent()) === 'other');
    await page.waitForTimeout(300);
    must(await alert.isVisible(), 'opening another drawing hid the alert while the first one is not saved');
    const said = await alert.textContent();
    must(said.includes('your last changes to “mine” aren’t saved') && (await page.locator('.draw-alert-go').textContent()) === 'Files', `the alert over another drawing says ${JSON.stringify(said)}`);
    await page.locator('.draw-alert-go').tap();
    await page.locator('.draw-draft', { hasText: 'mine' }).locator('.draw-draft-open').tap();
    await until('the drawing reopens with its unsaved change', async () => (await source(page)) === unsaved).catch(() => {
      throw new Error('reopening the drawing whose save failed lost its change');
    });
    must((await page.locator('.draw-alert-go').textContent()) === 'Export now', 'the alert about the open drawing does not offer Export now');
    must(await page.locator('.draw-save').textContent() !== 'Read-only', 'the drawing reopened read-only (its own lock)');
    await page.evaluate(() => (window.__full = false));
    await tapToken(page.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-enum').first());
    await page.locator('.draw-save[data-save="saved"]').waitFor();
    must(await alert.count() === 0, 'the alert stayed after the save succeeded');
    const kept = await page.evaluate(() => window.drawTest.source());
    await page.reload({ waitUntil: 'networkidle' });
    await until('the saved drawing reopens', async () => (await source(page)) === kept);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The P0-M4 review: IndexedDB is shared by every project on this origin, so a record there that
// isn't a draft Draw wrote must never reach the app: Draw loads, and the Files menu lists it as
// unreadable with Delete only. And a panel that throws while it renders shows a message and Files
// (the error boundary), never a blank page; the drawing stays.
async function aDamagedDraftNeverBlanksTheApp(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await page.evaluate(() => new Promise((ok, bad) => {
      const r = indexedDB.open('draw');
      r.onupgradeneeded = () => r.result.createObjectStore('drafts');
      r.onsuccess = () => {
        const tx = r.result.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put({ id: 'evil', name: { x: 1 }, text: 42, created: 0, updated: 9e15, exported: null, versions: [] }, 'draft:evil');
        tx.oncomplete = () => (r.result.close(), ok());
        tx.onerror = () => bad(tx.error);
      };
      r.onerror = () => bad(r.error);
    }));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    must(await source(page) === SAMPLE && await page.locator('.draw-name').textContent() === 'Sample', 'a damaged record changed what opened');
    await openFilesMenu(page);
    const row = page.locator('.draw-draft[data-unreadable]');
    await row.waitFor();
    must((await row.textContent()).startsWith('Unreadable draft'), `the damaged record is listed as ${JSON.stringify(await row.textContent())}`);
    must(await row.locator('.draw-draft-open').evaluate((el) => el.tagName) !== 'BUTTON', 'an unreadable draft can be opened');
    await row.locator('.draw-draft-delete').tap();
    await row.locator('.draw-draft-delete').tap(); // Delete? — yes
    await row.waitFor({ state: 'detached' });
    await closeModal(page);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);

    // A crash while a sheet renders (injected: the failure sheet's caret throws).
    await page.evaluate(() => {
      const repeat = String.prototype.repeat;
      String.prototype.repeat = function (n) {
        if (window.__crash) throw new Error('injected crash');
        return repeat.call(this, n);
      };
      window.__crash = true;
    });
    errors.length = 0;
    await page.evaluate(firePaste, { selector: null, data: { 'text/plain': '<html xmlns="http://www.w3.org/1999/xhtml"><svg/></html>' } });
    const crash = page.locator('.draw-crash');
    await crash.waitFor({ timeout: 3000 }).catch(() => {
      throw new Error('a panel that threw left no message');
    });
    await page.evaluate(() => (window.__crash = false));
    must((await crash.textContent()).includes('injected crash'), `the message says ${JSON.stringify(await crash.textContent())}`);
    must(await page.evaluate(() => document.getElementById('root').childElementCount) > 0, 'the page went blank');
    must(await source(page) === SAMPLE && await drawnCount(page) > 1, 'the drawing did not stay');
    must(errors.every((e) => e.includes('injected crash') || e.includes('The above error occurred')), `errors other than the injected one:\n${errors.join('\n')}`);
    const r = await page.evaluate(rulesNow, TAP_MIN);
    must(r.small.length === 0 && r.sw <= r.cw && r.sh <= r.ch, `the message breaks the phone rules: ${JSON.stringify(r.small)} ${r.sw}/${r.cw} ${r.sh}/${r.ch}`);
    await crash.locator('.draw-alert-go').tap();
    await page.locator('.draw-open').waitFor({ timeout: 3000 }).catch(() => {
      throw new Error('Files in the message does not open the Files menu');
    });
    must(await crash.count() === 0, 'the message stayed after Files');
  });
}

// The P0-M4 review: a notice raised from inside the Files menu ("That draft is gone") shows above
// the sheet, not hidden under it.
async function noticesShowOverTheFilesMenu(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await pickFile(page, 'gone.svg', Buffer.from(SAMPLE));
    await closeModal(page);
    await pickFile(page, 'kept.svg', Buffer.from(`<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"/>`));
    await closeModal(page);
    await page.locator('.draw-save[data-save="saved"]').waitFor();
    await openFilesMenu(page);
    await page.locator('.draw-draft', { hasText: 'gone' }).waitFor();
    // Another tab deletes it while this menu is open.
    await page.evaluate(() => new Promise((ok) => {
      const r = indexedDB.open('draw');
      r.onsuccess = () => {
        const store = r.result.transaction('drafts', 'readwrite').objectStore('drafts');
        const all = store.getAll();
        all.onsuccess = () => {
          const d = all.result.find((x) => x.name === 'gone');
          store.delete(`draft:${d.id}`).onsuccess = () => (r.result.close(), ok());
        };
      };
    }));
    await page.locator('.draw-draft', { hasText: 'gone' }).locator('.draw-draft-open').tap();
    const toast = page.locator('.draw-toast');
    await toast.waitFor();
    must((await toast.textContent()) === 'That draft is gone', `the notice says ${JSON.stringify(await toast.textContent())}`);
    must(await page.locator('.draw-modal').count() === 1, 'test setup: the Files menu closed');
    const top = await toast.evaluate((el) => {
      const b = el.getBoundingClientRect();
      el.style.pointerEvents = 'auto'; // the notice takes no taps; this only asks what is on top there
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      el.style.pointerEvents = '';
      return hit === el || el.contains(hit) ? null : `${hit?.tagName}.${hit?.className}`;
    });
    must(top === null, `the notice is under ${top}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The P0-M4 review: with the on-screen keyboard up (the visual viewport 336pt shorter, as iOS
// reports it), the Files sheet sits above the keyboard and inside what is left of the screen: its
// Done and its paste field are visible, with ten drafts listed.
async function theFilesSheetStaysAboveTheKeyboard(browser, origin) {
  await withPage(browser, origin, 796, async (page, errors) => {
    await page.evaluate(() => new Promise((ok) => {
      const r = indexedDB.open('draw');
      r.onupgradeneeded = () => r.result.createObjectStore('drafts');
      r.onsuccess = () => {
        const tx = r.result.transaction('drafts', 'readwrite');
        const now = Date.now();
        for (let i = 0; i < 10; i++) {
          const text = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="${i + 1}" height="1"/></svg>`;
          tx.objectStore('drafts').put({ id: `d${i}`, name: `Drawing ${i}`, text, created: now, updated: now - i, exported: null, versions: [{ at: now, text }] }, `draft:d${i}`);
        }
        tx.oncomplete = () => (r.result.close(), ok());
      };
    }));
    await openFilesMenu(page);
    await until('ten drafts are listed', async () => (await page.locator('.draw-draft').count()) === 10);
    await page.locator('.draw-paste').focus();
    const KB = 336;
    await page.evaluate((h) => {
      const vv = window.visualViewport;
      Object.defineProperty(vv, 'height', { get: () => h, configurable: true });
      vv.dispatchEvent(new Event('resize'));
    }, 796 - KB);
    await twoFrames(page);
    const r = await page.evaluate(() => {
      const box = (sel) => document.querySelector(sel).getBoundingClientRect();
      return { modal: box('.draw-modal').toJSON(), done: box('.draw-modal-done').toJSON(), paste: box('.draw-paste').toJSON(), visible: window.visualViewport.height };
    });
    must(r.modal.bottom <= r.visible + 0.5, `the sheet's bottom (${Math.round(r.modal.bottom)}) is under the keyboard (the screen above it is ${r.visible})`);
    for (const [what, b] of [['the sheet', r.modal], ['Done', r.done], ['the paste field', r.paste]]) {
      must(b.top >= 0 && b.bottom <= r.visible + 0.5, `${what} (${Math.round(b.top)}–${Math.round(b.bottom)}) is off the screen left above the keyboard (0–${r.visible})`);
    }
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// ── P0-M5: the code panel's tools ──────────────────────────────────────────────────────────────

const shadowRootOf = () => document.querySelector('.draw-host').shadowRoot;
const rCount = async (page) => Number(/ r="(\d+(?:\.\d+)?)"/.exec(await source(page))[1]);

// The legend over the code explains its colours, verb first: "Drag" a pink number; "Tap" a blue
// word, a colour with its swatch, or amber text (yellow in dark). Each sample is a chip (a tint of
// its colour behind code type, set apart from the words) exactly the colour of the tokens it stands
// for, in light and in dark. It shows with the Code tab only, and takes no taps.
async function theLegendExplainsTheTokenColours(browser, origin) {
  for (const colorScheme of ['light', 'dark']) {
    await withPage(browser, origin, 956, async (page, errors) => {
      await showCode(page);
      const r = await page.evaluate(() => {
        const c = (sel) => getComputedStyle(document.querySelector(sel)).color;
        const legend = document.querySelector('.draw-legend');
        return {
          text: legend?.textContent.replace(/\s+/g, ' ').trim(),
          pairs: [
            ['a number', c('.cv-key--number'), c('.draw-code .cv-number')],
            ['a keyword', c('.cv-key--word'), c('.draw-code .cv-enum')],
            ['a colour', c('.cv-key--word'), c('.draw-code .cv-color')],
            ['text', c('.cv-key--text'), c('.draw-code .cv-text')],
          ],
          swatch: legend?.querySelector('.cv-swatch')?.getBoundingClientRect().width ?? 0,
          chips: [...(legend?.querySelectorAll('.cv-key') ?? [])].map((k) => [getComputedStyle(k).backgroundColor, getComputedStyle(k).fontFamily]),
          words: legend ? getComputedStyle(legend).fontFamily : '',
          taps: legend?.querySelectorAll('button, a, [tabindex]').length ?? -1,
          spread: legend ? (([...t]) => Math.max(...t) - Math.min(...t))([...legend.querySelectorAll('.cv-key')].map((k) => k.getBoundingClientRect().top)) : Infinity,
        };
      });
      must(r.text === 'Drag 12 Tap round coral Hi', `the legend says ${JSON.stringify(r.text)}`);
      must(r.chips.length === 4 && r.chips.every(([bg, font]) => !/^rgba\(0, 0, 0, 0\)$|transparent/.test(bg) && font !== r.words), `${colorScheme}: the samples are not chips in code type apart from the words: ${JSON.stringify(r.chips)} (words: ${r.words})`);
      for (const [what, legend, token] of r.pairs) must(legend === token, `${colorScheme}: the legend shows ${what} as ${legend}, the code as ${token}`);
      must(new Set(r.pairs.map(([, a]) => a)).size === 3, `${colorScheme}: the legend's colours are not three: ${r.pairs.map(([, a]) => a).join(', ')}`);
      must(r.swatch > 0, 'the legend has no colour swatch');
      must(r.taps === 0, 'the legend takes taps');
      must(r.spread < 6, `the legend is on more than one line at 440pt (its samples' tops are ${r.spread.toFixed(1)}pt apart)`);
      await page.locator('.draw-tabs button', { hasText: 'Inspect' }).tap();
      must(!(await page.locator('.draw-legend').isVisible()), 'the legend shows over the Inspect tab');
      must(errors.length === 0, `errors:\n${errors.join('\n')}`);
    }, { colorScheme });
  }
}

// A colour token shows a swatch before its value, in the colour the engine read (#ffd166 is
// rgb(255, 209, 102)); "none" shows a struck-through swatch. The swatch is not text: the token
// still reads as its value.
async function colourTokensShowTheirSwatch(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await showCode(page);
    const r = await page.evaluate(() => {
      const block = (start) => [...document.querySelectorAll('.draw-code .cv-block')].find((b) => b.textContent.startsWith(start));
      const look = (tok) => {
        const sw = tok.querySelector('.cv-swatch');
        const b = sw?.getBoundingClientRect();
        const t = tok.getBoundingClientRect();
        return { text: tok.textContent, before: !!b && b.right <= t.left + b.width + 1 && tok.firstChild === sw, width: b?.width ?? 0, bg: sw ? getComputedStyle(sw).backgroundColor : null, image: sw ? getComputedStyle(sw).backgroundImage : null, none: !!sw?.classList.contains('cv-swatch--none') };
      };
      return { fill: look(block('<circle').querySelector('.cv-color')), none: look(block('<polyline').querySelector('.cv-color')) };
    });
    must(r.fill.text === '#ffd166' && r.fill.before && r.fill.width > 0, `the circle's fill token reads ${JSON.stringify(r.fill.text)}, its swatch ${r.fill.before ? '' : 'not '}before it`);
    must(r.fill.bg === 'rgb(255, 209, 102)', `the #ffd166 swatch is ${r.fill.bg}`);
    must(r.none.text === 'none' && r.none.none && /gradient/.test(r.none.image), `"none" has no struck-through swatch (${JSON.stringify(r.none)})`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The theme follows the system's, and the code recolours the moment it changes (no reload). A theme
// chosen in Files overrides the system's (data-theme on <html>), is kept on this device, and System
// follows it again. The drawing stays on white paper throughout.
async function theThemeFollowsTheSystemOrTheChoice(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await showCode(page);
    const look = () => page.evaluate(() => ({
      number: getComputedStyle(document.querySelector('.draw-code .cv-number')).color,
      word: getComputedStyle(document.querySelector('.draw-code .cv-enum')).color,
      bg: getComputedStyle(document.body).backgroundColor,
      paper: getComputedStyle(document.querySelector('.draw-host')).backgroundColor,
      theme: document.documentElement.dataset.theme ?? null,
    }));
    const light = await look();
    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await look();
    must(dark.number !== light.number && dark.word !== light.word && dark.bg !== light.bg, `the code did not recolour when the system went dark (numbers ${light.number} → ${dark.number})`);
    await openFilesMenu(page);
    await page.locator('.draw-theme button', { hasText: 'Light' }).tap();
    const chosenLight = await look();
    must(chosenLight.theme === 'light' && chosenLight.number === light.number && chosenLight.bg === light.bg, `Light chosen in Files over a dark system shows ${JSON.stringify(chosenLight)}`);
    await page.locator('.draw-theme button', { hasText: 'Dark' }).tap();
    await page.emulateMedia({ colorScheme: 'light' });
    const chosenDark = await look();
    must(chosenDark.theme === 'dark' && chosenDark.number === dark.number && chosenDark.bg === dark.bg, `Dark chosen in Files over a light system shows ${JSON.stringify(chosenDark)}`);
    await closeModal(page);
    // Loading again, the theme on <html> when React first puts the app in the page (a microtask
    // after that commit, so before any paint): the choice must already be there, or the app can
    // paint once in the system's theme first.
    await page.addInitScript(() => {
      new MutationObserver((_, seen) => {
        if (!document.getElementById('root')?.childElementCount) return;
        window.__themeAtFirstDraw = document.documentElement.dataset.theme ?? 'system';
        seen.disconnect();
      }).observe(document, { childList: true, subtree: true });
    });
    await page.reload({ waitUntil: 'networkidle' });
    await showCode(page);
    const first = await page.evaluate(() => window.__themeAtFirstDraw);
    must(first === 'dark', `a load with Dark chosen drew the app in the system's theme first (the theme when the app first went in: ${first})`);
    must((await look()).number === dark.number, 'the theme chosen was not kept on this device');
    await openFilesMenu(page);
    must(await page.locator('.draw-theme button[aria-pressed="true"]').textContent() === 'Dark', 'Files does not show the theme chosen');
    await page.locator('.draw-theme button', { hasText: 'System' }).tap();
    const system = await look();
    must(system.theme === null && system.number === light.number && system.bg === light.bg, 'System does not follow the system again');
    for (const l of [light, dark, chosenLight, chosenDark, system]) must(l.paper === 'rgb(255, 255, 255)', `the canvas paper is ${l.paper}, not white`);
    await closeModal(page);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Tidy (SVG Lab's pretty-print, as a way of showing the code): one element a line, a tag too wide
// for the panel one attribute a line; only whitespace changes, only on screen, so the file is the
// same byte for byte and a tap or a scrub still edits its own token's bytes. The width is measured
// again when the panel changes size, and the choice is kept on this device.
async function tidyLaysOutTheCodeAndNeverTheFile(browser, origin) {
  const MINI = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><g fill="none" stroke="#264653"><rect x="10" y="10" width="30" height="30" rx="4" ry="4" stroke-width="2"/><circle cx="70" cy="30" r="18"/></g></svg>`;
  await withPage(browser, origin, 956, async (page, errors) => {
    await page.evaluate((t) => window.drawTest.render(t), MINI);
    await showCode(page);
    const shown = () => page.locator('.draw-code').evaluate((el) => el.textContent);
    must(await shown() === MINI, 'as written, the code is not the file');
    await page.locator('.draw-tidy').tap();
    must(await page.locator('.draw-tidy').getAttribute('aria-pressed') === 'true', 'Tidy does not show it is on');
    const tidy = (await shown()).split('\n');
    must(tidy[0].startsWith('<svg') && tidy.includes('  <g fill="none" stroke="#264653">') && tidy.includes('    <circle cx="70" cy="30" r="18"/>') && tidy.at(-2) === '  </g>' && tidy.at(-1) === '</svg>', `the tidy view shows:\n${tidy.join('\n')}`);
    const rectLines = tidy.filter((l) => /^ {6}(x|y|width|height|rx|ry|stroke-width)=/.test(l)).length;
    must(tidy.includes('    <rect') && rectLines === 7, `at 440pt the rect's tag is not one attribute a line:\n${tidy.join('\n')}`);
    must(tidy.join('').replace(/\s+/g, '') === MINI.replace(/\s+/g, ''), 'the tidy view shows more than the file, or less');
    must(await source(page) === MINI, 'Tidy changed the file');
    await tapToken(page.locator('.cv-block', { hasText: '<circle' }).locator('.cv-number').first());
    await page.locator('.draw-strip button', { hasText: '+' }).tap();
    must(await source(page) === MINI.replace('cx="70"', 'cx="71"'), 'a token tapped in the tidy view did not edit only its own bytes');
    await page.locator('.draw-done').tap();
    // Wider (an iPad upright): measured again, the rect fits on one line.
    await page.setViewportSize({ width: 760, height: 1024 });
    await twoFrames(page);
    const wide = (await shown()).split('\n');
    must(wide.includes('    <rect x="10" y="10" width="30" height="30" rx="4" ry="4" stroke-width="2"/>'), `at 760pt the rect is not on one line (the width was not measured again):\n${wide.join('\n')}`);
    await page.setViewportSize({ width: 440, height: 956 });
    await twoFrames(page);
    must((await shown()).split('\n').includes('    <rect'), 'back at 440pt the rect is not one attribute a line again');
    const r = await page.evaluate(rulesNow, TAP_MIN);
    must(r.sw <= r.cw && r.small.length === 0, `the tidy view breaks the phone rules: ${JSON.stringify({ small: r.small, sw: r.sw, cw: r.cw })}`);
    await page.reload({ waitUntil: 'networkidle' });
    await showCode(page);
    must(await page.locator('.draw-tidy').getAttribute('aria-pressed') === 'true', 'Tidy was not kept on this device');
    must((await shown()).split('\n').includes('  <title>A sun setting over two hills</title>'), 'the sample does not show tidy after the reload');
    must(await source(page) === SAMPLE, 'the sample changed');
    await page.locator('.draw-tidy').tap();
    must(await shown() === SAMPLE, 'Tidy off does not show the file as written');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Tidy never leaves a tag's close ("/>" or ">") at the start of a line of its own: where a long
// value wraps (a path's d, a transform list), the close stays after the value's last character, as
// in SVG Lab. Every tools/ file in the corpus, at 440pt. (Tags inside text are shown as written.)
async function tidyKeepsEachCloseWithItsTag(browser, origin) {
  const dir = join(CORPUS, 'tools');
  const files = readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
  await withPage(browser, origin, 956, async (page, errors) => {
    await showCode(page);
    if (await page.locator('.draw-tidy').getAttribute('aria-pressed') !== 'true') await page.locator('.draw-tidy').tap();
    const alone = [];
    let closes = 0;
    for (const [name, text] of files) {
      await page.evaluate((t) => window.drawTest.render(t), text);
      await twoFrames(page);
      const r = await page.evaluate(() => {
        const box = (n, i) => {
          const range = document.createRange();
          range.setStart(n, i);
          range.setEnd(n, i + 1);
          const rects = range.getClientRects();
          return rects[rects.length - 1] ?? range.getBoundingClientRect();
        };
        const found = [];
        let n = 0;
        [...document.querySelectorAll('.draw-code .cv-block')].forEach((block, i) => {
          const text = block.textContent;
          // A block laid out on a line of its own starts with its line break (the first with none).
          if (!(text.startsWith('\n') || i === 0) || !/^<[^/!?]/.test(text.trimStart()) || !text.endsWith('>')) return;
          const chars = [];
          const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          while (walk.nextNode()) for (let k = 0; k < walk.currentNode.data.length; k++) chars.push([walk.currentNode, k]);
          const at = (k) => chars[k][0].data[chars[k][1]];
          let close = chars.length - 1;
          if (close > 0 && at(close - 1) === '/') close--;
          let before = close - 1;
          while (before >= 0 && /\s/.test(at(before))) before--;
          if (before < 0) return;
          n++;
          if (box(...chars[close]).top >= box(...chars[before]).bottom - 1) found.push(text.trimStart().slice(0, 40).replace(/\s+/g, ' '));
        });
        return { n, found };
      });
      closes += r.n;
      alone.push(...r.found.map((f) => `${name}: ${f}…`));
    }
    must(closes > 300, `test setup: only ${closes} closes measured`);
    must(alone.length === 0, `${alone.length} tag close(s) start a line of their own in the tidy view:\n${alone.slice(0, 8).join('\n')}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Copy puts the file on the clipboard exactly as it is (its xmlns and viewBox; Tidy never changes
// it), through the Clipboard API's write (it never reads), and says "Copied". Where the clipboard
// is blocked, the text waits in a read-only sheet, and Select all selects all of it.
async function copyPutsTheFileOnTheClipboard(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await page.evaluate(() => {
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (t) => {
            if (window.__blocked) throw new DOMException('blocked here', 'NotAllowedError');
            window.__copied.push(t);
          },
          readText: async () => ((window.__read = true), ''),
          read: async () => ((window.__read = true), []),
        },
      });
    });
    await showCode(page);
    await page.locator('.draw-tidy').tap();
    await page.locator('.draw-copy').tap();
    await page.locator('.draw-toast').waitFor({ timeout: 3000 }).catch(() => {
      throw new Error('Copy said nothing');
    });
    must(await page.locator('.draw-toast').textContent() === 'Copied', `Copy says ${JSON.stringify(await page.locator('.draw-toast').textContent())}`);
    const copied = await page.evaluate(() => window.__copied);
    must(copied.length === 1 && copied[0] === SAMPLE, 'Copy did not put the file on the clipboard byte for byte');
    must(copied[0].startsWith(`<svg xmlns="${SVG_NS}" viewBox="0 0 320 240">`), 'the copied file lost its xmlns or viewBox');
    await page.evaluate(() => (window.__blocked = true));
    await page.locator('.draw-copy').tap();
    const area = page.locator('.draw-copy-text');
    await area.waitFor();
    must(await area.inputValue() === SAMPLE && await area.evaluate((el) => el.readOnly), 'the sheet does not hold the file, read-only');
    await page.locator('.draw-select-all').tap();
    const [a, b, n] = await area.evaluate((el) => [el.selectionStart, el.selectionEnd, el.value.length]);
    must(a === 0 && b === n, `Select all selected ${a} to ${b} of ${n}`);
    const r = await page.evaluate(rulesNow, TAP_MIN);
    must(r.small.length === 0 && r.fields.length === 0 && r.sw <= r.cw && r.sh <= r.ch, `the Copy sheet breaks the phone rules: ${JSON.stringify({ small: r.small, fields: r.fields, sw: r.sw, sh: r.sh })}`);
    await closeModal(page);
    must(!(await page.evaluate(() => window.__read ?? false)), 'Copy read the clipboard');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The keyboard reaches every token: on a number the arrow keys step it (one history entry each,
// and it keeps the focus through the redraw), and Enter or Space opens its Number sheet; on a
// keyword Enter or Space moves it to its next option, wrapping round; on a colour, its sheet.
async function tokensTakeTheKeyboard(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await showCode(page);
    const circle = page.locator('.cv-block', { hasText: '<circle' });
    const cx = circle.locator('.cv-number').first();
    must(await page.locator('.draw-code .cv-tok:not([tabindex="0"])').count() === 0, 'a token cannot be focused');
    await cx.focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    must(await source(page) === SAMPLE.replace('cx="212"', 'cx="214"'), 'ArrowUp and ArrowRight did not step cx up twice');
    const active = await page.evaluate(() => ({ text: document.activeElement?.textContent, number: document.activeElement?.classList.contains('cv-number') }));
    must(active.number && active.text === '214', `after the steps the focus is on ${JSON.stringify(active)}, not the number`);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowLeft');
    must(await source(page) === SAMPLE, 'ArrowDown and ArrowLeft did not step it back');
    must(await page.locator('.draw-tool', { hasText: 'Undo' }).getAttribute('aria-label') === 'Undo Step cx', 'a key step is not its own history entry');
    await page.keyboard.press('Enter');
    await page.locator('.draw-modal input[inputmode="decimal"]').waitFor();
    must(await page.locator('.draw-modal-title').textContent() === 'cx', 'Enter on cx did not open its Number sheet');
    await page.keyboard.press('Escape');
    await page.locator('.draw-modal').waitFor({ state: 'detached' });
    await page.locator('.cv-block', { hasText: '<polyline' }).locator('.cv-enum').first().focus();
    await page.keyboard.press(' ');
    must(await source(page) === SAMPLE.replace('stroke-linecap="round"', 'stroke-linecap="square"'), 'Space on a keyword did not move it on');
    await page.keyboard.press('Enter');
    must(await source(page) === SAMPLE.replace('stroke-linecap="round"', 'stroke-linecap="butt"'), 'Enter on the keyword did not move it on, wrapping round');
    await circle.locator('.cv-color').first().focus();
    await page.keyboard.press('Enter');
    await page.locator('.draw-swatch').first().waitFor({ timeout: 2000 }).catch(() => {
      throw new Error('Enter on a colour did not open its sheet');
    });
    await page.keyboard.press('Escape');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// A drawing another tab has open is read-only here, and its code is plain text: no token is
// coloured, focusable or swatched, the text can be selected, and no tap, drag or key edits it (a tap
// says why).
async function readOnlyCodeIsPlainText(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors, context) => {
    await pickFile(page, 'sunset.svg', Buffer.from(SAMPLE));
    await closeModal(page);
    await page.locator('.draw-save[data-save="saved"]').waitFor();
    const second = await context.newPage();
    const errors2 = [];
    second.on('pageerror', (e) => errors2.push(`uncaught: ${e.message}`));
    second.on('console', (m) => m.type() === 'error' && errors2.push(`console error: ${m.text()}`));
    await second.goto(`${origin}/draw/`, { waitUntil: 'networkidle' });
    await second.locator('.draw-alert', { hasText: 'read-only' }).waitFor({ timeout: 5000 });
    await showCode(second);
    const r = await second.evaluate(() => {
      const code = document.querySelector('.draw-code');
      const plain = getComputedStyle(code).color;
      const toks = [...code.querySelectorAll('.cv-tok')];
      const cs = getComputedStyle(code);
      return {
        n: toks.length,
        coloured: toks.filter((t) => getComputedStyle(t).color !== plain).map((t) => t.textContent),
        focusable: toks.filter((t) => t.hasAttribute('tabindex')).length,
        swatches: [...code.querySelectorAll('.cv-swatch')].filter((w) => w.getBoundingClientRect().width > 0).length,
        select: cs.userSelect || cs.webkitUserSelect,
      };
    });
    must(r.n > 20, `test setup: only ${r.n} tokens`);
    must(r.coloured.length === 0, `read-only tokens are still coloured: ${r.coloured.slice(0, 5).join(', ')}`);
    must(r.focusable === 0 && r.swatches === 0, `read-only tokens: ${r.focusable} focusable, ${r.swatches} swatches shown`);
    must(r.select === 'text', `read-only code can't be selected (user-select ${r.select})`);
    must(await second.locator('.draw-legend').count() === 0, 'the legend explains taps and drags that do nothing here');
    const cx = second.locator('.cv-block', { hasText: '<circle' }).locator('.cv-number').first();
    await tapToken(cx);
    must(await second.locator('.draw-strip').count() === 0, 'a tap on a read-only number opened the Scrub strip');
    must((await second.locator('.draw-toast').textContent()).includes('read-only'), 'a tap on a read-only number does not say why nothing happens');
    await scrubToken(second, cx, 6);
    must(await source(second) === SAMPLE, 'a drag on a read-only number wrote it');
    await second.close();
    must(errors.length + errors2.length === 0, `errors:\n${[...errors, ...errors2].join('\n')}`);
  });
}

// A file that isn't well-formed opens as read-only source, through the one importer: nothing is
// drawn and nothing loads, the code holds its text exactly with the failing line and character
// marked (in view), no token edits it, and it becomes no draft. The canvas and the ContextBar say
// where it fails; Files is the way on, and the drawing before it reopens from there. A file only
// strict well-formedness refuses (a bare &) opens as source the same way.
async function aMalformedFileOpensAsReadOnlySource(browser, origin) {
  const BAD = `<svg xmlns="${SVG_NS}" viewBox="0 0 10 10">\n  <rect width="1" height="1">\n</svg>\n`;
  const STRICT = `<svg xmlns="${SVG_NS}" viewBox="0 0 10 10">\n  <text>Fish & chips</text>\n</svg>\n`;
  await withPage(browser, origin, 956, async (page, errors, context) => {
    const quiet = watch(page, context, origin);
    await pickFile(page, 'sunset.svg', Buffer.from(SAMPLE));
    await closeModal(page);
    await page.locator('.draw-save[data-save="saved"]').waitFor();
    await openFilesMenu(page);
    await page.locator('.draw-modal input[type="file"]').setInputFiles({ name: 'broken.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(BAD) });
    await page.locator('.draw-unparsed').waitFor();
    await twoFrames(page);
    must(await page.locator('.draw-modal').count() === 0, 'a sheet covers the source');
    const r = await page.evaluate(() => {
      const code = document.querySelector('.draw-code');
      const mark = code.querySelector('.cv-error');
      const m = mark?.getBoundingClientRect();
      const body = document.querySelector('.draw-sheet-body').getBoundingClientRect();
      return {
        text: code.textContent,
        drawn: document.querySelector('.draw-host').shadowRoot.childElementCount,
        mark: mark?.textContent ?? null,
        line: code.querySelector('.cv-error-line')?.textContent ?? null,
        inView: !!m && m.top >= body.top && m.bottom <= body.bottom,
        tokens: code.querySelectorAll('.cv-tok').length,
        over: document.querySelector('.draw-unparsed').textContent,
        context: document.querySelector('.draw-context').textContent,
        name: document.querySelector('.draw-name').textContent,
        save: document.querySelector('.draw-save')?.textContent ?? null,
      };
    });
    must(r.drawn === 0, 'the canvas drew a file that is not well-formed');
    must(r.text === BAD, 'the code does not hold the file text exactly');
    must(r.line === '</svg>' && r.mark === '<', `the mark is on ${JSON.stringify(r.mark)} of the line ${JSON.stringify(r.line)}, not the "<" of </svg> on line 3`);
    must(r.inView, 'the marked error is not in view');
    must(r.tokens === 0, `the source has ${r.tokens} tokens to edit`);
    must(await page.locator('.draw-legend').count() === 0, 'the legend shows over source that nothing can edit');
    must(r.over.includes('Line 3, column 1: </svg> closes <rect>.'), `the canvas says ${JSON.stringify(r.over)}`);
    must(r.context.includes('Read-only source · line 3, column 1'), `the ContextBar says ${JSON.stringify(r.context)}`);
    must(r.name === 'broken' && r.save === 'Read-only', `the top bar says ${r.name}, ${r.save}`);
    must(await source(page) === '', 'the editor holds a document');
    must(await page.locator('.draw-tool', { hasText: 'Undo' }).isDisabled(), 'Undo is enabled');
    await page.locator('.draw-code').tap();
    must(await page.locator('.draw-modal, .draw-strip').count() === 0, 'a tap on the source opened something');
    await page.locator('.draw-export').tap();
    const exporting = (await page.locator('.draw-modal').textContent()) ?? '';
    must(exporting.includes('A file that isn’t well-formed can’t be exported; Copy (over the code) has its text.') && await page.locator('.draw-export-go').count() === 0, `Export over the source says ${JSON.stringify(exporting)}`);
    await closeModal(page);
    const rules = await page.evaluate(rulesNow, TAP_MIN);
    must(rules.small.length === 0 && rules.sw <= rules.cw && rules.sh <= rules.ch, `the source view breaks the phone rules: ${JSON.stringify({ small: rules.small, sw: rules.sw, sh: rules.sh })}`);
    // A file only strict well-formedness refuses (a bare &, which browsers refuse too) is source in
    // the same way, marked where the browser's parser stops.
    await openFilesMenu(page);
    await page.locator('.draw-modal input[type="file"]').setInputFiles({ name: 'fish.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(STRICT) });
    await until('the strict file shows as source', async () => (await page.locator('.draw-code').textContent()) === STRICT);
    await twoFrames(page);
    const strict = await page.evaluate(() => ({
      drawn: document.querySelector('.draw-host').shadowRoot.childElementCount,
      mark: document.querySelector('.draw-code .cv-error')?.textContent ?? null,
      line: document.querySelector('.draw-code .cv-error-line')?.textContent ?? null,
      over: document.querySelector('.draw-unparsed')?.textContent ?? '',
      name: document.querySelector('.draw-name').textContent,
    }));
    must(strict.drawn === 0 && strict.name === 'fish', `the strict file was drawn (${strict.drawn}), or is named ${strict.name}`);
    must(strict.line === '  <text>Fish & chips</text>' && strict.mark === '&', `the mark is on ${JSON.stringify(strict.mark)} of the line ${JSON.stringify(strict.line)}, not the bare & on line 2`);
    must(strict.over.includes('Line 2, column 14: a bare & (write &amp; for the character itself).'), `the canvas says ${JSON.stringify(strict.over)}`);
    await page.locator('.draw-source-files').tap();
    await page.locator('.draw-draft').first().waitFor();
    const names = await page.locator('.draw-draft-name').allTextContents();
    must(names.length === 1 && names[0] === 'sunset', `the drafts are ${JSON.stringify(names)}: the source became one, or the drawing before it was lost`);
    await page.locator('.draw-draft', { hasText: 'sunset' }).locator('.draw-draft-open').tap();
    await until('the drawing before it reopens', async () => (await source(page)) === SAMPLE);
    must(await page.locator('.draw-unparsed').count() === 0 && await drawnCount(page) > 1, 'the drawing did not come back on the canvas');
    must((await page.locator('.draw-code').textContent()) === SAMPLE, 'its code did not come back');
    await quiet('a file that is not well-formed opened');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The Number sheet: − and + held down repeat (after 400 ms, every 70 ms) and stop when let go; the
// slider spans the value's range (a radius: 0 to twice the artboard) and writes at the token's
// precision; Enter closes it; the whole visit is one history entry.
async function theNumberSheetHoldsAndSlides(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await showCode(page);
    await tapToken(page.locator('.cv-block', { hasText: '<circle' }).locator('.cv-number').nth(2)); // r="42"
    await page.locator('.draw-strip-value').tap();
    const plus = page.locator('.draw-modal .draw-key[aria-label="Increase"]');
    await plus.waitFor();
    const slider = page.locator('.draw-range');
    const range = await slider.evaluate((el) => [el.min, el.max, el.step, el.value].join());
    must(range === '0,640,1,42', `the slider is ${range}, not 0 to 640 (twice the 320 artboard) by 1, at 42`);
    const b = await plus.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1000);
    await page.mouse.up();
    const held = await rCount(page);
    must(held >= 47 && held <= 56, `holding + for a second wrote r=${held}, not about 51 (one step, then one every 70 ms from 470 ms)`);
    await page.waitForTimeout(300);
    must(await rCount(page) === held, 'the repeat did not stop when + was let go');
    must(await page.locator('.draw-modal input[inputmode="decimal"]').inputValue() === String(held), 'the field does not show what the held + wrote');
    await slider.fill('100');
    must(await rCount(page) === 100, `the slider wrote r=${await rCount(page)}, not 100`);
    must(await page.locator('.draw-modal input[inputmode="decimal"]').inputValue() === '100', 'the field does not follow the slider');
    // Enter in the field closes the sheet, and the change commits on close.
    await page.locator('.draw-modal input[inputmode="decimal"]').press('Enter');
    await page.locator('.draw-modal').waitFor({ state: 'detached', timeout: 2000 }).catch(() => must(false, 'Enter did not close the Number sheet'));
    must(await rCount(page) === 100, `closing with Enter left r=${await rCount(page)}, not 100`);
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    await undo.tap();
    must(await source(page) === SAMPLE && await undo.isDisabled(), 'the visit was not one history entry');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Each sheet slides up over a dimmed drawing, at the bottom of the screen: Escape, a tap on the dim
// and Done each close it and commit its edit as one history entry. The tap that opened a sheet
// never reaches a control in it (its click lands where the sheet now is: here, on a swatch).
async function sheetsCloseWithDoneTheDimAndEscape(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await showCode(page);
    const circle = page.locator('.cv-block', { hasText: '<circle' });
    const shut = (how) => page.locator('.draw-modal').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {
      throw new Error(`${how} did not close the sheet`);
    });
    await tapToken(circle.locator('.cv-number').nth(2)); // r
    await page.locator('.draw-strip-value').tap();
    const g = await page.evaluate(() => {
      const m = document.querySelector('.draw-modal').getBoundingClientRect();
      const dim = document.querySelector('.draw-scrim');
      const d = dim.getBoundingClientRect();
      return { bottom: m.bottom, h: innerHeight, dim: getComputedStyle(dim).backgroundColor, covers: d.top <= 0 && d.bottom >= innerHeight && d.width >= innerWidth };
    });
    must(Math.abs(g.bottom - g.h) < 1, `the Number sheet ends at ${g.bottom}, not the bottom of the screen (${g.h})`);
    must(g.covers && !/rgba\(0, 0, 0, 0\)|transparent/.test(g.dim), `the drawing is not dimmed (${g.dim})`);
    await page.locator('.draw-modal input').first().fill('30');
    await page.keyboard.press('Escape');
    await shut('Escape');
    must((await source(page)).includes(' r="30"'), 'Escape lost the Number sheet edit');
    await page.locator('.draw-done').tap();
    await tapToken(circle.locator('.cv-color').first());
    await page.locator('.draw-swatch').first().waitFor();
    await page.waitForTimeout(100);
    must((await source(page)).includes('fill="#ffd166"'), 'the tap that opened the Color sheet picked a colour in it (its click reached the sheet)');
    await page.locator('.draw-swatch[aria-label="#2a9d8f"]').tap();
    await page.waitForTimeout(400);
    await page.touchscreen.tap(220, 60);
    await shut('a tap on the dim');
    must((await source(page)).includes('fill="#2a9d8f"'), 'a tap on the dim lost the Color sheet edit');
    await tapToken(page.locator('.cv-text', { hasText: /^Draw$/ }));
    await page.locator('.draw-modal input').first().fill('Drawn');
    await page.locator('.draw-modal-done').tap();
    await shut('Done');
    must((await source(page)).includes('>Drawn</text>'), 'Done lost the Text sheet edit');
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    for (let i = 0; i < 3; i++) await undo.tap();
    must(await source(page) === SAMPLE && await undo.isDisabled(), 'the three sheets were not one history entry each');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The live code: an edit redraws its block, and only the token that changed flashes, not the block
// or the tokens beside it. The flash is an animation that runs, except under reduced motion.
async function onlyTheChangedTokenFlashes(browser, origin) {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await withPage(browser, origin, 956, async (page, errors) => {
      await showCode(page);
      await tapToken(page.locator('.cv-block', { hasText: '<circle' }).locator('.cv-number').first()); // cx
      await page.locator('.draw-strip button', { hasText: '+' }).tap();
      const r = await page.evaluate(() => {
        const block = [...document.querySelectorAll('.draw-code .cv-block')].find((b) => b.textContent.startsWith('<circle'));
        const toks = [...block.querySelectorAll('.cv-tok')];
        return {
          block: block.classList.contains('cv-flash'),
          flashing: toks.filter((t) => t.classList.contains('cv-flash')).map((t) => t.textContent),
          running: toks[0].getAnimations().length,
          canvas: document.querySelector('.draw-host').shadowRoot.querySelector('circle').getAttribute('cx'),
        };
      });
      must(r.canvas === '213', `test setup: the canvas's circle has cx=${r.canvas}`);
      must(!r.block && r.flashing.length === 1 && r.flashing[0] === '213', `the flash is on ${r.block ? 'the whole block' : JSON.stringify(r.flashing)}, not only the token that changed`);
      if (reducedMotion === 'reduce') must(r.running === 0, `under reduced motion the flash still runs (${r.running} animation)`);
      else must(r.running === 1, 'the changed token does not flash (no animation runs)');
      must(errors.length === 0, `errors:\n${errors.join('\n')}`);
    }, { reducedMotion });
  }
}

// Reduced motion: a drawing that animates opens paused on the frame where its first cycle ends (a
// fade-in shows, not its empty start), with Play over the canvas. Play runs its SMIL from the top
// (a fade that animates once moves, rather than staying where it froze), and its CSS animations;
// Pause stops both again, holding each on its frame. A still drawing has no Play, and without
// reduced motion nothing waits for it.
async function playStartsTheMotionUnderReducedMotion(browser, origin) {
  const FADE = svgDoc('<rect width="100" height="100" fill="#264653" opacity="0"><animate attributeName="opacity" values="0;1" dur="2s" fill="freeze"/></rect>');
  const SPIN = readFileSync(join(CORPUS, 'lab', 'spin--css.svg'), 'utf8');
  for (const reducedMotion of ['reduce', 'no-preference']) {
    await withPage(browser, origin, 956, async (page, errors) => {
      const open = async (t) => {
        await page.evaluate((x) => window.drawTest.render(x), t);
        await twoFrames(page);
      };
      const state = () => page.evaluate(() => {
        const svg = document.querySelector('.draw-host').shadowRoot.querySelector('svg');
        return { paused: svg.animationsPaused(), t: svg.getCurrentTime(), css: svg.getAnimations({ subtree: true }).length };
      });
      const play = page.locator('.draw-play-btn');
      must(await play.count() === 0, 'the still sample offers Play');
      await open(FADE);
      if (reducedMotion === 'no-preference') {
        const s = await state();
        must(await play.count() === 0 && !s.paused, `without reduced motion the fade ${s.paused ? 'is paused' : 'runs'} and ${await play.count() ? 'offers' : 'needs no'} Play`);
        return;
      }
      must(await play.count() === 1 && await play.textContent() === 'Play', 'an animated drawing under reduced motion offers no Play');
      const still = await state();
      // What shows: the rect's dark teal (#264653) over the host's middle, not the paper.
      const host = await page.locator('.draw-host').boundingBox();
      const px = decodePng(await page.screenshot()).rgb(Math.round(host.x + host.width / 2), Math.round(host.y + host.height / 2));
      must(still.paused && still.t > 1.9 && still.t <= 2 && px[0] + px[1] + px[2] < 300, `paused at ${still.t.toFixed(3)} s showing rgb ${px}: not the frame where the fade has arrived`);
      await play.tap();
      const started = await state();
      must(await play.textContent() === 'Pause' && !started.paused, 'Play did not start the SMIL');
      // It moves: from the top (the fade is still faint where the still showed it arrived), and on.
      const px2 = decodePng(await page.screenshot()).rgb(Math.round(host.x + host.width / 2), Math.round(host.y + host.height / 2));
      await page.waitForTimeout(300);
      const later = await state();
      must(started.t < 1 && px2[0] + px2[1] + px2[2] > px[0] + px[1] + px[2] + 100 && later.t > started.t, `Play shows no motion: at ${started.t.toFixed(3)} s then ${later.t.toFixed(3)} s, rgb ${px2} after rgb ${px} (it has to start again from the top)`);
      await play.tap();
      must((await state()).paused, 'Pause did not stop it');
      await open(SPIN);
      must((await state()).css === 0, 'test setup: the CSS spin runs under reduced motion before Play');
      await play.tap();
      await twoFrames(page);
      must((await state()).css > 0, 'Play did not start the CSS animation');
      await play.tap();
      await twoFrames(page);
      const frames = () => page.evaluate(() => document.querySelector('.draw-host').shadowRoot.querySelector('svg').getAnimations({ subtree: true }).map((a) => [a.playState, a.currentTime]));
      const held = await frames();
      await twoFrames(page);
      const after = JSON.stringify(await frames());
      must(held.length > 0 && held.every(([state, t]) => state === 'paused' && t > 0) && after === JSON.stringify(held), `Pause did not hold the CSS animation on its frame: ${JSON.stringify(held)}, then ${after}`);
      const b = await play.boundingBox();
      must(b.width >= TAP_MIN - 0.5 && b.height >= TAP_MIN - 0.5, `Play is ${Math.round(b.width)}×${Math.round(b.height)}`);
      await open(SAMPLE);
      must(await play.count() === 0, 'Play stayed for a still drawing');
      must(errors.length === 0, `errors:\n${errors.join('\n')}`);
    }, { reducedMotion });
  }
}

// One finger on the canvas: from (at), `dx` points sideways in four moves, then up. Chromium gets
// real touch (CDP); WebKit the same Pointer Events.
async function oneFinger(browser, page, at, dx) {
  if (chromium(browser)) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
    for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x + (dx * i) / 4, y: at.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.evaluate(({ at, dx }) => {
      const area = document.querySelector('.draw-canvas');
      const fire = (type, x) => area.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: at.y, bubbles: true, cancelable: true }));
      fire('pointerdown', at.x);
      for (let i = 1; i <= 4; i++) fire('pointermove', at.x + (dx * i) / 4);
      fire('pointerup', at.x + dx);
    }, { at, dx });
  }
  await page.waitForTimeout(50);
}

// On the canvas, a touch that moves less than 5pt is a tap, which selects what is under it; one
// that moves further is a drag, which (with P0's Select tool) selects nothing.
async function aShortMoveOnTheCanvasIsATap(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const c = await circleCentre(page);
    const selected = () => page.locator('.draw-sel').textContent();
    await oneFinger(browser, page, c, 8);
    must(await selected() === 'nothing selected', 'a touch that moved 8pt selected the circle: it was taken for a tap');
    await oneFinger(browser, page, c, 4);
    must(await selected() === '<circle>', 'a touch that moved 4pt did not select the circle: it was taken for a drag');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Wide screens (an iPad on its side, a desktop) and a phone on its side dock the code beside the
// canvas, at its full height and shown at once; a phone or an iPad upright keeps the sheet under
// the canvas. No size scrolls the page or sideways, and every tap target keeps its floor.
async function theCodeDocksBesideTheCanvasOnWideScreens(browser, origin) {
  const problems = [];
  for (const [width, height, docked] of [[1180, 820, true], [956, 440, true], [1440, 900, true], [820, 1180, false], [440, 956, false]]) {
    const context = await browser.newContext({ ...PHONE, viewport: { width, height } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${origin}/draw/`, { waitUntil: 'networkidle' });
      await twoFrames(page);
      const at = `${width}×${height}`;
      const r = await page.evaluate(() => {
        const b = (sel) => document.querySelector(sel).getBoundingClientRect().toJSON();
        const code = document.querySelector('.draw-code .cv-block');
        return { canvas: b('.draw-canvas'), sheet: b('.draw-sheet'), code: code ? code.getBoundingClientRect().height : 0, handle: getComputedStyle(document.querySelector('.draw-handle')).display, svg: document.querySelector('.draw-host').shadowRoot.querySelector('svg').getBoundingClientRect().width };
      });
      if (docked) {
        if (!(r.sheet.left >= r.canvas.right - 1 && Math.abs(r.sheet.top - r.canvas.top) < 1 && Math.abs(r.sheet.bottom - r.canvas.bottom) < 1)) problems.push(`${at}: the code is not docked beside the canvas (canvas ${rect(r.canvas)}, code ${rect(r.sheet)})`);
        if (!(r.code > 0) || r.handle !== 'none') problems.push(`${at}: the docked code ${r.code > 0 ? '' : 'is not shown at once'}${r.handle !== 'none' ? ' has a handle' : ''}`);
        if (r.canvas.width < r.sheet.width) problems.push(`${at}: the canvas (${Math.round(r.canvas.width)}) is narrower than the code (${Math.round(r.sheet.width)})`);
      } else if (!(r.sheet.top >= r.canvas.bottom - 1)) problems.push(`${at}: the sheet is not under the canvas`);
      if (!(r.svg > 0)) problems.push(`${at}: nothing drawn`);
      const rules = await page.evaluate(rulesNow, TAP_MIN);
      if (rules.small.length) problems.push(`${at}: tap targets under ${TAP_MIN}pt: ${rules.small.join(', ')}`);
      if (rules.sw > rules.cw || rules.sh > rules.ch) problems.push(`${at}: the page scrolls (${rules.sw}/${rules.cw}, ${rules.sh}/${rules.ch})`);
      if (errors.length) problems.push(`${at}: errors: ${errors.join('; ')}`);
    } finally {
      await context.close();
    }
  }
  must(problems.length === 0, problems.join('\n'));
}

// A render error is caught. When the canvas throws while drawing an edit, the whole drawing is drawn
// again from the model, with the edit. When that throws too, the canvas says so (with Files), draws
// nothing, and the file and the code keep the edit; the next change (an undo) draws it again and the
// message goes. Nothing throws uncaught.
async function aRenderErrorIsCaughtAndRedrawn(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await page.evaluate(() => {
      const root = document.querySelector('.draw-host').shadowRoot;
      window.__breaks = 0;
      const trip = () => {
        if (window.__breaks > 0) {
          window.__breaks--;
          throw new Error('injected render error');
        }
      };
      for (const name of ['setAttribute', 'setAttributeNS', 'removeAttributeNode']) {
        const f = Element.prototype[name];
        Element.prototype[name] = function (...a) {
          if (this.getRootNode() === root) trip();
          return f.apply(this, a);
        };
      }
      const replace = ShadowRoot.prototype.replaceChildren;
      ShadowRoot.prototype.replaceChildren = function (...a) {
        if (this === root && a.length) trip();
        return replace.apply(this, a);
      };
    });
    await showCode(page);
    const cxOnCanvas = () => page.evaluate(() => document.querySelector('.draw-host').shadowRoot.querySelector('circle')?.getAttribute('cx') ?? null);
    await tapToken(page.locator('.cv-block', { hasText: '<circle' }).locator('.cv-number').first());
    await page.evaluate(() => (window.__breaks = 1));
    await page.locator('.draw-strip button', { hasText: '+' }).tap();
    must(await page.evaluate(() => window.__breaks) === 0, 'test setup: the injected error did not fire');
    must(await cxOnCanvas() === '213', `after a patch that threw, the canvas has cx=${await cxOnCanvas()}, not the 213 a fresh drawing gives`);
    must(await page.locator('.draw-broken').count() === 0, 'a redraw that worked still shows a message');
    await page.evaluate(() => (window.__breaks = 2));
    await page.locator('.draw-strip button', { hasText: '+' }).tap();
    const broken = page.locator('.draw-broken');
    await broken.waitFor({ timeout: 2000 }).catch(() => {
      throw new Error('a canvas that could not draw says nothing');
    });
    must((await broken.textContent()).includes('injected render error'), `the message says ${JSON.stringify(await broken.textContent())}`);
    must(await broken.locator('.draw-over-go').textContent() === 'Files', 'the message has no Files');
    must(await drawnCount(page) === 0, 'the canvas still shows a drawing that may be half drawn');
    must((await source(page)).includes('cx="214"') && (await page.locator('.cv-block', { hasText: '<circle' }).textContent()).includes('cx="214"'), 'the file or the code lost the edit');
    await page.locator('.draw-done').tap();
    await page.locator('.draw-tool', { hasText: 'Undo' }).tap();
    must(await cxOnCanvas() === '213' && await page.locator('.draw-broken').count() === 0, 'the next change did not draw it again');
    must(errors.length === 0, `errors (none may escape):\n${errors.join('\n')}`);
  });
}

// The phone rules on the code panel's new states: the code bar with Tidy on, at half and at full;
// Play over a paused drawing; a canvas that could not draw.
async function phoneRulesOnTheCodeTools(browser, origin, height) {
  const problems = [];
  const rules = async (page, state) => {
    const r = await page.evaluate(rulesNow, TAP_MIN);
    if (r.small.length) problems.push(`${state}: tap targets under ${TAP_MIN}pt: ${r.small.join(', ')}`);
    if (r.fields.length) problems.push(`${state}: field(s) under 16px: ${r.fields.join(', ')}`);
    if (r.split.length) problems.push(`${state}: token(s) split across lines: ${r.split.slice(0, 5).join(', ')}`);
    if (r.sw > r.cw) problems.push(`${state}: scrolls sideways (${r.sw} > ${r.cw})`);
    if (r.sh > r.ch) problems.push(`${state}: the page scrolls (${r.sh} > ${r.ch})`);
  };
  await withPage(browser, origin, height, async (page, errors) => {
    await showCode(page);
    await rules(page, 'the code bar');
    await page.locator('.draw-tidy').tap();
    await rules(page, 'Tidy at half');
    await page.locator('.draw-handle').tap();
    await rules(page, 'Tidy at full');
    await page.locator('.draw-handle').tap();
    await showCode(page);
    await page.evaluate(() => {
      const root = document.querySelector('.draw-host').shadowRoot;
      const f = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (...a) {
        if (this.getRootNode() === root && window.__break) throw new Error('injected');
        return f.apply(this, a);
      };
      const g = ShadowRoot.prototype.replaceChildren;
      ShadowRoot.prototype.replaceChildren = function (...a) {
        if (this === root && a.length && window.__break) throw new Error('injected');
        return g.apply(this, a);
      };
      window.__break = true;
    });
    await tapToken(page.locator('.cv-block', { hasText: '<circle' }).locator('.cv-number').first());
    await page.locator('.draw-strip button', { hasText: '+' }).tap();
    await page.locator('.draw-broken').waitFor();
    await rules(page, 'a canvas that could not draw');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
  await withPage(browser, origin, height, async (page, errors) => {
    await page.evaluate((t) => window.drawTest.render(t), readFileSync(join(CORPUS, 'tools', 'animated-smil.svg'), 'utf8'));
    await page.locator('.draw-play-btn').waitFor();
    await rules(page, 'Play');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  }, { reducedMotion: 'reduce' });
  must(problems.length === 0, `440×${height}:\n${problems.join('\n')}`);
}

// P1-M0: Draw's parser against the browser's. Every corpus file parses in both to the same
// canonical tree: elements, attributes and their values as read, text, comments and processing
// instructions (probe-helpers/xml-canon.mjs; KNOWN there lists where the two differ on purpose, and
// why). At least 250 files must be compared, and up to 10 differences are shown, by file and path.
async function corpusTreesMatchTheBrowsersParser(browser, origin) {
  const corpus = corpusFiles();
  await withPage(browser, origin, 956, async (page, errors) => {
    const theirs = await page.evaluate(browserCanon, { texts: corpus.map((f) => f.text) });
    const differ = [];
    const shown = [];
    let compared = 0;
    for (const [i, file] of corpus.entries()) {
      const diffs = canonDiffs(engineCanon(file.text), theirs[i]);
      compared++;
      if (!diffs.length) continue;
      differ.push(file.name);
      for (const d of diffs) if (shown.length < 10) shown.push(`${file.name} ${d}`);
    }
    must(compared >= 250, `compared ${compared} of ${corpus.length} corpus files`);
    must(differ.length === 0, `${differ.length} of ${compared} corpus files parse to different trees in the engine and the browser (${differ.join(', ')}); the first ${shown.length} difference(s):\n${shown.join('\n')}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// P1-M0: what the browser's parser refuses (a parsererror in what DOMParser returns, in the
// namespace that '<' shows), Draw's parser refuses, and what Draw's parser refuses as not
// well-formed, the browser refuses too (a refusal over Draw's limits may be well-formed). Each
// probe also says what both give, the browser's verdict per engine, so a verdict that moves is named.
async function theEngineRefusesWhatTheBrowserRefuses(browser, origin) {
  const engine = browser.browserType().name();
  await withPage(browser, origin, 956, async (page, errors) => {
    const theirs = await page.evaluate(browserCanon, { texts: PROBES.map((p) => p.text) });
    const problems = [];
    let checked = 0;
    for (const [i, probe] of PROBES.entries()) {
      checked++;
      const mine = engineCanon(probe.text);
      const draw = mine.refused ? (mine.kind === 'limit' ? 'limit' : 'refuse') : 'accept';
      const verdict = theirs[i].refused ? 'refuse' : 'accept';
      const why = (r) => (r.refused ? ` (${r.message})` : '');
      if (verdict === 'refuse' && draw === 'accept') problems.push(`${probe.label}: ${engine} refuses it, but Draw's parser accepts it`);
      if (draw === 'refuse' && verdict === 'accept') problems.push(`${probe.label}: Draw's parser refuses it as not well-formed${why(mine)}, but ${engine} accepts it`);
      if (draw !== probe.draw) problems.push(`${probe.label}: Draw's parser gives ${draw}, not ${probe.draw} as the probe table says${why(mine)}`);
      if (verdict !== probe.browser[engine]) problems.push(`${probe.label}: ${engine} gives ${verdict}, not ${probe.browser[engine]} as the probe table says${why(theirs[i])}`);
    }
    must(checked > 0 && checked === PROBES.length, `checked ${checked} of ${PROBES.length} probes`);
    must(problems.length === 0, `Draw's parser and ${engine}'s disagree:\n${problems.join('\n')}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
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

// Every assertion counts: a check that made none is no evidence (see run()).
let asserted = 0;
function must(cond, message) {
  asserted++;
  if (!cond) throw new Error(message);
}
