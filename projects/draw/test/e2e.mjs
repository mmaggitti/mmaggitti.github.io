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
// the engine refuses as not well-formed the browser refuses too. The canvas draws the ledger's
// pattern rows (data-*, aria-*) from P1-M0, and the corpus check allows them as the tables do. The
// P1-M0 review adds: a data-* name the DOM refuses is dropped, never thrown on, in a file and in Edit
// source; and six more parser probes (entity names, an entity declared twice, an unparsed entity).
// P1-M1 adds selection and transform: a drag moves a shape by whole units (the tooltip and the
// coordinate guides on it, two attribute mutations a frame), a marquee takes what it encloses,
// Bring forward, Send back and Delete patch only what moved on the canvas and in the code, the
// arrows nudge only the canvas selection, the grid, the engine's geometry against the browser's,
// and % lengths keeping their size under zoom (the view is the root's own box, never its viewBox);
// the handles (the nearest within 26 pt wins, a rect's corners keep the opposite corner, the ring and
// the diamond on the lab's house) and snapping to guides, shapes, the artboard and the grid; then
// Duplicate (fresh ids, its own references), Group and Ungroup keeping every shape in place, the
// Layers tab (hide, lock, rename), Draw's own state kept out of As-is, Copy and Clean, and the phone
// rules on the selection tools.
// Every check that passes in every call, having asserted something, is a line of the support
// ledger's e2e evidence (EVIDENCE, below).

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILE_VERSION } from '../../../scripts/lib/svg-profile.mjs';
import { RENDER_SVG_ATTRIBUTE_PATTERNS, RENDER_SVG_ATTRIBUTES, RENDER_SVG_ELEMENTS, RENDER_XHTML_ATTRIBUTE_PATTERNS, RENDER_XHTML_ATTRIBUTES, RENDER_XHTML_ELEMENTS } from '../../../engine/policy/tables.ts';
import probe from './probe-shadow.mjs';
import rendererPatch from './renderer-patch.mjs';
import { detentHeights } from '../src/detents.ts';
import { encodeImport } from '../src/platform/files.ts';
import { attrValue, parseDoc } from '../../../engine/model/doc.ts';
import { parsePath } from '../../../engine/path/parse.ts';
import { importReport } from '../../../engine/report/import-report.ts';
import { cleanExport } from '../../../engine/export/clean.ts';
import { rootBounds } from '../../../engine/geometry/bounds.ts';
import { rootViewport } from '../src/canvas/artboard.ts';
import { decodePng } from './probe-helpers/png.mjs';
import { browserCanon, canonDiffs, engineCanon, PROBES, probeProblems } from './probe-helpers/xml-canon.mjs';

const PHONE = { deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const TAP_MIN = 44;
const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '../../../engine/test/fixtures/corpus');
const SAMPLE = readFileSync(join(HERE, '../src/canvas/sample.svg'), 'utf8');
const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
// The generated tables, as the page checks them (Maps travel as entry lists, patterns as sources).
const TABLES = {
  svgElements: [...RENDER_SVG_ELEMENTS],
  xhtmlElements: [...RENDER_XHTML_ELEMENTS],
  svgAttributes: [...RENDER_SVG_ATTRIBUTES],
  xhtmlAttributes: [...RENDER_XHTML_ATTRIBUTES],
  svgPatterns: RENDER_SVG_ATTRIBUTE_PATTERNS.map((re) => re.source),
  xhtmlPatterns: RENDER_XHTML_ATTRIBUTE_PATTERNS.map((re) => re.source),
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
// DRAW_E2E_ONLY=checkA,checkB runs just those checks: tools/prove-breaks.mjs proves a slow break
// against the check it names (a break's `checks`). Such a run never writes the evidence file's last
// line, so ledger-check --e2e-evidence never takes it for a complete run.
const ONLY = process.env.DRAW_E2E_ONLY ? new Set(process.env.DRAW_E2E_ONLY.split(',')) : null;

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
    if (ONLY && !ONLY.has(fn.name)) return;
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
  // P1-M1: selection and transform.
  await check(aDragMovesTheShapeByWholeUnits);
  await check(aMarqueeSelectsWhatItEncloses);
  await check(zOrderAndDeletePatchOnlyWhatMoved);
  await check(arrowsNudgeOnlyTheCanvasSelection);
  await check(theGridToggleShowsTheGrid);
  await check(geometryMatchesTheBrowser);
  await check(percentLengthsKeepTheirSizeUnderZoom);
  await check(theNearestHandleWithin26ptWins);
  await check(rectCornerHandlesKeepTheOppositeCorner);
  await check(rotateAndScaleHandlesEditTheLabHouse);
  await check(movesSnapToGuidesShapesAndTheGrid);
  await check(duplicateGetsFreshIdsAndItsOwnReferences);
  await check(groupAndUngroupKeepEveryShapeInPlace);
  await check(layersHideAndLockShapes);
  await check(drawStateStaysOutOfAsIsAndClean);
  for (const height of [956, 796]) await check(phoneRulesOnTheSelectionTools, height);
  // The P1-M1 review adds these.
  await check(aLargeSelectionDragsWithoutStalling);
  await check(theGridStepFieldIsOneEntry);
  await check(theSnapSheetIsReachableOnThePhone);
  await check(aFilesOwnCssCantMoveItsDrawing);
  const proven = [...passed].filter((name) => !unproven.has(name));
  const lines = [...proven.map((name) => ({ file: 'projects/draw/test/e2e.mjs', name, engine })), ...(ONLY ? [] : [{ complete: true, engine, calls }])];
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
// viewBox is fitted into the drawn root's own box (meet, centred: the camera box, P1-M1), so its
// circle lands exactly where the geometry says. Its paint comes through the sink too: inside the
// frame the sky gradient shows, and in the frame's rounded corner, clipped away, the paper does.
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
        host: svg.getBoundingClientRect().toJSON(), // the drawn root's own box
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
// property (title) is kept: DOMPurify's SANITIZE_DOM is off. So are a data-* and an aria-*
// attribute (pattern rows, drawn from P1-M0): both judges let them through, so a [data-…] selector
// matches on the canvas as it does in the file on its own. The policy refuses the rest: a <style>
// with a url() to another file, the same in a style attribute, an image and a <use> pointing
// outside the document, a <set> of an attribute the tables don't render (cursor), and an animation
// of r on a rect (r renders on circles, not rects). An animation of r whose href names a circle
// renders: it is judged against its target, not its parent.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const EDGES = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">
  <style>.far { fill: url(other.svg#a) }</style>
  <rect id="title" class="near" data-state="on" aria-label="near" width="10" height="10"/>
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
    must(/\bdata-state\b/.test(r.kept) && /\baria-label\b/.test(r.kept), `the canvas has <rect id="title"> as [${r.kept}], without data-state or aria-label: the pattern rows (data-*, aria-*) must pass both judges, the policy and DOMPurify`);
    must(r.kept === 'aria-label class data-state height id width', `the canvas has <rect id="title"> as [${r.kept}], not [aria-label class data-state height id width]: is DOMPurify dropping ordinary ids again (SANITIZE_DOM)?`);
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
  // A data-* name the pattern and DOMPurify admit but the DOM refuses to create (data-😀, data-⁰x in
  // Chromium: setAttribute throws on them) is dropped and counted like any other; the element still
  // draws. Each engine's DOM judges its own names (WebKit's rule is unverified), so the canvas must
  // hold exactly the ones it takes; Chromium's refusals are pinned, so the case can't go vacuous.
  { label: 'data-* names the DOM refuses', text: svgDoc('<rect width="10" height="10" data-\u{1F600}="1" data-\u2070x="1" data-a="1"/>'), attrs: { rect: 'data-a height width' }, dom: { sel: 'rect', names: ['data-\u{1F600}', 'data-\u2070x'], refusedIn: { chromium: 2 } }, skipped: 0 },
  // The document's own CSS can't size the root away from the host.
  { label: 'a root sized by its own CSS', text: svgDoc('<style>svg { width: 48px; height: 48px }</style><rect width="10" height="10"/>', ' style="width: 24px; height: 24px"'), fills: true, skipped: 0 },
  // A size that overflows once converted still renders; it just gets no viewBox.
  { label: 'a root width of 1e308in', text: `<svg xmlns="${SVG_NS}" width="1e308in" height="10"><rect width="5" height="5"/></svg>`, present: 'rect', noViewBox: true, skipped: 0 },
  // A root the canvas can't draw says so instead of showing nothing.
  { label: 'an <svg> with no namespace', text: '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>', refused: 'SVG namespace' },
  { label: 'an XHTML root', text: `<html xmlns="${XHTML_NS}"><body/></html>`, refused: 'SVG namespace' },
];

async function moreEdges(browser, origin) {
  const engine = browser.browserType().name();
  await withPage(browser, origin, 956, async (page, errors, context) => {
    const quiet = watch(page, context, origin);
    const problems = await page.evaluate(({ cases, engine }) => cases.flatMap((c) => {
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
      const attrs = { ...c.attrs };
      if (c.dom) {
        // Names only this engine's DOM can judge: drawn where it takes them, dropped and counted where not.
        const takes = (n) => { try { document.createAttribute(n); return true; } catch { return false; } };
        const refused = c.dom.names.filter((n) => !takes(n)).length;
        attrs[c.dom.sel] = [...attrs[c.dom.sel].split(' '), ...c.dom.names.filter(takes)].sort().join(' ');
        if (stats.droppedAttributes !== refused) out.push(`dropped ${stats.droppedAttributes} attribute(s), not the ${refused} the DOM refuses`);
        if (c.dom.refusedIn[engine] !== undefined && refused !== c.dom.refusedIn[engine]) out.push(`${engine}'s DOM refuses ${refused} of the names, not ${c.dom.refusedIn[engine]}: the case no longer tests the guard`);
      }
      for (const [sel, want] of Object.entries(attrs)) {
        const got = q(sel) ? [...q(sel).attributes].map((a) => a.name).sort().join(' ') : null;
        if (got !== want) out.push(`<${sel}> is on the canvas as [${got}], not [${want}]`);
      }
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
    }), { cases: MORE_EDGES, engine });
    must(problems.length === 0, `the canvas's edges:\n${problems.join('\n')}`);
    await quiet('more edges');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The canvas draws a document as the document, not in the app's theme: currentColor, a font-less
// <text> and a var() fallback compute as they do with the file opened on its own, in light and
// dark; no ds token reaches the document; and the paper is the same light checkerboard in both
// (decision 10), under a host that paints nothing of its own.
async function canvasIgnoresTheTheme(browser, origin) {
  const text = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><path d="M0 0H10V10Z" fill="currentColor"/><text y="20">Hi</text><circle r="5" fill="var(--accent, black)"/></svg>`;
  const papers = {};
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
        return { tokens: names.size, leaked, host: getComputedStyle(document.querySelector('.draw-host')).backgroundColor, paper: getComputedStyle(document.querySelector('.draw-paper')).backgroundImage };
      }, text);
      must(r.tokens >= 25, `test setup: found only ${r.tokens} ds tokens on :root`);
      must(r.leaked.length === 0, `${colorScheme}: ds tokens reach the document on the canvas: ${r.leaked.join(', ')}`);
      must(r.host === 'rgba(0, 0, 0, 0)', `${colorScheme}: the canvas host paints ${r.host}; the paper is the underlay's`);
      must(/rgb\(238, 238, 238\)/.test(r.paper) && /rgb\(255, 255, 255\)/.test(r.paper), `${colorScheme}: the canvas paper is ${r.paper}, not the light checkerboard`);
      papers[colorScheme] = r.paper;
      await page.evaluate((t) => window.drawTest.render(t), text);
      const canvas = await page.evaluate(readStyles, true);
      for (const k of Object.keys(alone)) must(canvas[k] === alone[k], `${colorScheme}: on the canvas the ${k} is ${canvas[k]}, but the file alone has ${alone[k]}`);
    }, { colorScheme });
  }
  must(papers.light === papers.dark, `the canvas paper is ${papers.dark} in dark, not ${papers.light} as in light`);
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
// the canvas area and the browser's own rendering of the same file, an <img> on the same paper
// (a copy of the canvas's underlay), the right half, placed where the drawn root's own box is and
// at its size; one screenshot compares them pixel for pixel inside that box, in light and dark.
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
      // The canvas's own buttons (Grid, Snap) sit over the drawing.
      for (const el of document.querySelectorAll('.draw-canvas .draw-chrome')) el.style.display = 'none';
      const host = document.querySelector('.draw-host');
      const alone = document.createElement('div');
      alone.id = 'alone';
      alone.style.cssText = 'position:relative;overflow:hidden;width:50%;height:100%;background:#fff';
      host.style.width = '50%';
      host.style.overflow = 'hidden'; // what the left half draws past its box stays out of the right half
      host.after(alone);
      document.querySelector('.draw-canvas').style.display = 'flex';
      return [host, alone].map((e) => e.getBoundingClientRect().toJSON());
    });
    must(a.width === b.width && a.height === b.height && a.width > 150 && a.height > 240, `test setup: the halves are ${rect(a)} and ${rect(b)}`);
    const differ = [];
    for (const f of files) {
      const { decoded, box } = await page.evaluate(showBoth, f.text);
      const shot = decodePng(await page.screenshot({ clip: { x: a.x, y: a.y, width: b.x + b.width - a.x, height: a.height } }));
      const dx = Math.round(b.x - a.x);
      // Inside the drawn root's box, clipped to the half: outside it the canvas shows what the file
      // draws past its box on purpose (overflow: visible), where an <img> clips.
      const [x0, x1] = [Math.max(0, Math.ceil(box.left)), Math.min(Math.floor(a.width), Math.floor(box.left + box.width))];
      const [y0, y1] = [Math.max(0, Math.ceil(box.top)), Math.min(shot.height, Math.floor(box.top + box.height))];
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const [p, q] = [shot.rgb(x, y), shot.rgb(x + dx, y)];
          if (p.some((v, k) => Math.abs(v - q[k]) > PIXEL_TOLERANCE)) n++;
        }
      }
      const share = n / Math.max(1, (x1 - x0) * (y1 - y0));
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

// Runs in the page: the file on the canvas, and beside it the file itself as an <img> where the
// drawn root's own box is and at its size (the camera box), its root filling the <img>, on a copy
// of the canvas's underlay (the surround and the checkerboard paper, where they are on the canvas).
// Chromium draws an SVG <img> at a whole-pixel size, so a box a fraction of a pixel tall would be
// scaled by that fraction and every horizontal edge shaded differently: the <img> takes the box
// rounded to whole pixels, and its root the viewBox (preserveAspectRatio none) that maps the file
// exactly as the drawn root's own getScreenCTM does.
async function showBoth(text) {
  window.drawTest.render(text);
  const host = document.querySelector('.draw-host');
  const drawn = host.shadowRoot.firstElementChild;
  const hb = host.getBoundingClientRect();
  const rb = drawn ? drawn.getBoundingClientRect() : hb;
  const box = { left: rb.left - hb.left, top: rb.top - hb.top, width: rb.width, height: rb.height };
  const alone = document.getElementById('alone');
  const parts = [];
  const under = document.querySelector('.draw-under');
  const paper = document.querySelector('.draw-paper');
  if (under && paper) {
    alone.style.background = getComputedStyle(under).backgroundColor;
    const pb = paper.getBoundingClientRect();
    const copy = document.createElement('div');
    copy.style.cssText = `position:absolute;left:${pb.left - hb.left}px;top:${pb.top - hb.top}px;width:${pb.width}px;height:${pb.height}px`;
    copy.style.background = getComputedStyle(paper).background;
    parts.push(copy);
  }
  // A byte-order mark marks the encoding, not content; WebKit's DOMParser refuses one in a string.
  const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ''), 'image/svg+xml');
  const svg = doc.documentElement;
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  const at = { left: Math.round(box.left), top: Math.round(box.top), width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) };
  const m = drawn?.getScreenCTM();
  if (m && m.a > 0 && m.d > 0 && !m.b && !m.c) {
    svg.setAttribute('viewBox', [(hb.left + at.left - m.e) / m.a, (hb.top + at.top - m.f) / m.d, at.width / m.a, at.height / m.d].join(' '));
    svg.setAttribute('preserveAspectRatio', 'none');
  } else if (drawn?.hasAttribute('viewBox')) svg.setAttribute('viewBox', drawn.getAttribute('viewBox'));
  const img = document.createElement('img');
  img.style.cssText = `position:absolute;display:block;left:${at.left}px;top:${at.top}px;width:${at.width}px;height:${at.height}px`;
  img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  alone.replaceChildren(...parts, img);
  await document.fonts.ready;
  try {
    await img.decode();
    return { decoded: true, box };
  } catch {
    return { decoded: false, box };
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

// The Snap sheet with every target off: a move is whole units alone (checks of tap-vs-drag and of
// rounding; movesSnapToGuidesShapesAndTheGrid checks snapping).
async function snapOff(page) {
  await page.locator('.draw-snap-btn').tap();
  for (const name of ['Grid', 'Guides', 'Shapes', 'Artboard']) {
    const b = page.locator('.draw-snap-toggles .ds-btn', { hasText: new RegExp(`^${name}$`) });
    if ((await b.getAttribute('aria-pressed')) === 'true') await b.tap();
  }
  await page.locator('.draw-modal-done').tap();
}

// The ContextBar's More sheet (Edit source, Select all), for what is selected now.
async function openMore(page) {
  await page.locator('.draw-ctx-btn[aria-label="More"]').tap();
  await page.locator('.draw-more').waitFor();
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
    await openMore(page);
    await rules('the More sheet');
    await page.locator('.draw-more .draw-action').tap();
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
// handle and tabs, the code, the ContextBar and its selection buttons, the ToolRail and the canvas's
// Grid button the page stays at scale 1 and Safari's gesture events are cancelled (the pinch is
// real touch, so Chromium only; WebKit can't make it).
async function pageNeverZooms(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const gesturesCancelledOn = (sel) => page.evaluate((sel) => ['gesturestart', 'gesturechange'].map((type) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      document.querySelector(sel).dispatchEvent(e);
      return e.defaultPrevented;
    }), sel);
    const c = await circleCentre(page);
    await page.touchscreen.tap(c.x, c.y); // a selection, so the ContextBar shows its buttons
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
    must(await page.locator('.draw-ctx-btn').count() === 6, 'test setup: the ContextBar shows no selection buttons');
    for (const sel of ['.draw-bar', '.draw-handle', '.draw-tabs', '.draw-code', '.draw-context', '.draw-rail', '.draw-ctx-btn', '.draw-grid-btn']) {
      if (chromium(browser)) {
        const b = await page.locator(sel).first().boundingBox();
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
  const engine = browser.browserType().name();
  await withPage(browser, origin, 956, async (page, errors) => {
    // A tap on the root's end tag selects it, and Edit source, which can't replace the root, is not offered.
    await showCode(page);
    const root = page.locator('.cv-block', { hasText: '</svg>' });
    await root.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await root.tap();
    must(await page.locator('.draw-label').textContent() === '<svg>', "test setup: a tap on the root's code did not select it");
    await openMore(page);
    must(await page.locator('.draw-more .draw-action').count() === 0, 'Edit source is offered for the root <svg>, which it cannot replace');
    await page.locator('.draw-modal-done').tap();
    await page.locator('.draw-more').waitFor({ state: 'detached' });
    const c = await circleCentre(page);
    await page.touchscreen.tap(c.x, c.y);
    await openMore(page);
    await page.locator('.draw-more .draw-action').tap();
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
    // A name the DOM refuses to create (data-😀: the data-* pattern admits it) is kept in the file and
    // left off the canvas, which goes on drawing: it must never blank mid-edit (P1-M0 review, F4).
    await page.touchscreen.tap(c.x, c.y);
    await openMore(page);
    await page.locator('.draw-more .draw-action').tap();
    await area.fill('<circle cx="212" cy="134" r="42" fill="#ffd166" data-\u{1F600}="1"/>');
    await page.locator('.draw-modal .ds-btn', { hasText: 'Apply' }).tap();
    await page.locator('.draw-modal').waitFor({ state: 'detached' });
    const odd = await page.evaluate(() => {
      const c = document.querySelector('.draw-host').shadowRoot.querySelector('circle');
      let takes = true; // this engine's DOM judges the name (Chromium refuses it; WebKit's rule is unverified)
      try {
        document.createAttribute('data-\u{1F600}');
      } catch {
        takes = false;
      }
      return {
        broken: document.querySelector('.draw-broken')?.textContent ?? null,
        circle: c ? [...c.attributes].map((a) => a.name).sort().join(' ') : null,
        kept: window.drawTest.source().includes('data-\u{1F600}="1"'),
        takes,
      };
    });
    const want = odd.takes ? 'cx cy data-\u{1F600} fill r' : 'cx cy fill r';
    must(odd.broken === null && odd.circle === want && odd.kept, `Edit source adding data-\u{1F600}: ${JSON.stringify(odd)}, not the circle drawn as [${want}] with the name kept in the file`);
    must(engine !== 'chromium' || !odd.takes, "Chromium's DOM takes data-\u{1F600} now: the Edit source case no longer tests the guard");
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
        // The left edge's middle: the rotation ring's guide (P1-M1) runs up through the top edge's.
        const pts = outline.getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number));
        const [[x0, y0], [x1, y1]] = [pts[0], pts[3]];
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

// (i) The initial JS (the entry module and what it preloads) is at most 1 MB gzipped (Mark, 2026-09-30,
// raised from 250 KB).
async function initialJsBudget() {
  const html = readFileSync(join(SITE_DRAW, 'index.html'), 'utf8');
  const urls = [...html.matchAll(/<script[^>]*\bsrc="([^"]+\.js)"|<link[^>]*rel="modulepreload"[^>]*href="([^"]+\.js)"/g)].map((m) => m[1] ?? m[2]);
  must(urls.length >= 1, 'test setup: no script in the built index.html');
  const bytes = urls.reduce((n, u) => n + gzipSync(readFileSync(join(SITE_DRAW, u.replace(/^\/draw\//, '')))).length, 0);
  must(bytes <= 1_000_000, `the initial JS is ${(bytes / 1000).toFixed(1)} KB gzipped, over the 1 MB budget`);
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
// follows it again. The drawing stays on the same light checkerboard throughout.
async function theThemeFollowsTheSystemOrTheChoice(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await showCode(page);
    const look = () => page.evaluate(() => ({
      number: getComputedStyle(document.querySelector('.draw-code .cv-number')).color,
      word: getComputedStyle(document.querySelector('.draw-code .cv-enum')).color,
      bg: getComputedStyle(document.body).backgroundColor,
      paper: getComputedStyle(document.querySelector('.draw-paper')).backgroundImage,
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
    for (const l of [light, dark, chosenLight, chosenDark, system]) {
      must(l.paper === light.paper && /rgb\(238, 238, 238\)/.test(l.paper) && /rgb\(255, 255, 255\)/.test(l.paper), `the canvas paper is ${l.paper}, not the light checkerboard it is in light`);
    }
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

// On the canvas, a touch that moves less than 5pt is a tap, which selects what is under it and
// changes nothing. One that moves further is a drag (P1-M1): on a shape it selects the shape and
// moves it by whole units (the snap step at fit: the drawn root's getScreenCTM().a px a unit); on
// empty canvas it draws a marquee, here too thin to take anything.
async function aShortMoveOnTheCanvasIsATap(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const at = await circleCentre(page);
    const c = { x: Math.round(at.x), y: Math.round(at.y) }; // whole points: the 8pt stays 8pt
    const selected = () => page.locator('.draw-sel').textContent();
    const source = () => page.evaluate(() => window.drawTest.source());
    await snapOff(page); // tap against drag, and whole units: nothing to snap to
    must(await page.locator('.draw-sel').textContent() === 'nothing selected', 'a tap in the Snap sheet reached the drawing under it');
    const e = await page.evaluate(screenPoint, { x: 6, y: 6 }); // inside the viewBox, outside the frame: nothing drawn
    await oneFinger(browser, page, { x: Math.round(e.x), y: Math.round(e.y) }, 8);
    must(await selected() === 'nothing selected', 'a touch that moved 8pt on empty canvas selected something');
    must(await source() === SAMPLE, 'a touch that moved 8pt on empty canvas changed the file');
    await oneFinger(browser, page, c, 4);
    must(await selected() === '<circle>', 'a touch that moved 4pt did not select the circle: it was taken for a drag');
    must(await source() === SAMPLE, 'a touch that moved 4pt changed the file');
    await page.locator('.draw-ctx-btn[aria-label="Deselect"]').tap();
    const k = await page.evaluate(() => document.querySelector('.draw-host').shadowRoot.querySelector('svg').getScreenCTM().a);
    const units = Math.round(8 / k);
    await oneFinger(browser, page, c, 8);
    must(await source() === SAMPLE.replace('cx="212"', `cx="${212 + units}"`), `a touch that moved 8pt did not move the circle by ${units} whole unit(s) (${k.toFixed(3)} px a unit): it was taken for a tap`);
    must(await selected() === '<circle>', 'a touch that moved 8pt on the circle did not select it');
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
    const ns = await page.evaluate(() => new DOMParser().parseFromString('<', 'text/xml').getElementsByTagName('parsererror')[0]?.namespaceURI ?? null);
    must(ns !== null, `DOMParser puts no parsererror in what it makes of '<', so a refusal can't be told from a tree`);
    const theirs = await page.evaluate(browserCanon, { texts: PROBES.map((p) => p.text) });
    const problems = [];
    let checked = 0;
    for (const [i, probe] of PROBES.entries()) {
      checked++;
      problems.push(...probeProblems(probe, engine, engineCanon(probe.text), theirs[i]));
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
  const patterns = { [SVG]: tables.svgPatterns.map((s) => new RegExp(s)), [XHTML]: tables.xhtmlPatterns.map((s) => new RegExp(s)) };
  const ACTIVE = new Set(['script', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas']);
  const ANIMATIONS = new Set(['animate', 'set', 'animateTransform', 'animateColor']);
  const LOCAL_URL = /^(#|data:image\/(png|jpeg|gif|webp)[;,])/i;
  const keyOf = (a) => (a.namespaceURI === null ? a.localName : a.namespaceURI === XLINK ? `xlink:${a.localName}` : a.namespaceURI === XML ? `xml:${a.localName}` : null);
  // A key with no row may match a pattern row (data-*, aria-*), which has no namespace (so no prefix).
  const renders = (el, key) => {
    const scope = attributes[el.namespaceURI]?.get(key);
    if (!scope) return !key.includes(':') && !!patterns[el.namespaceURI]?.some((re) => re.test(key));
    return !scope.except?.includes(el.localName) && (scope.on === '*' || scope.on.includes(el.localName));
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

// ── P1-M1: selection and transform ─────────────────────────────────────────────────────────────

// What makes a corpus file's frame depend on time (as corpusLooksAsItDoesAlone filters them).
const ANIMATES = /<(animate|set|animateTransform|animateMotion|animateColor|script)\b|@keyframes|transition/;

// Runs in the page: record the canvas's mutations (the drawing's shadow root) from now on.
function watchCanvas() {
  window.__mo?.disconnect();
  window.__muts = [];
  window.__mo = new MutationObserver((ms) => window.__muts.push(...ms));
  window.__mo.observe(document.querySelector('.draw-host').shadowRoot, { subtree: true, attributes: true, childList: true, characterData: true });
}
// Runs in the page: the canvas's mutations since the last call, counted by type.
function canvasMutations() {
  const ms = window.__muts.splice(0).concat(window.__mo.takeRecords());
  const n = (type) => ms.filter((m) => m.type === type).length;
  return { childList: n('childList'), attributes: n('attributes'), characterData: n('characterData') };
}
// Runs in the page: record where the canvas's pointer events land from now on (the numbers the Stage
// reads), so a check computes what the canvas saw even where an engine rounds a pointer's position.
function watchPointer() {
  window.__pts = [];
  if (window.__ptsOn) return;
  window.__ptsOn = true;
  const area = document.querySelector('.draw-canvas');
  for (const type of ['pointerdown', 'pointermove']) area.addEventListener(type, (e) => window.__pts.push([e.clientX, e.clientY]), true);
}
// Runs in the page: a drawn element's centre in client px.
function drawnCentre(sel) {
  const b = document.querySelector('.draw-host').shadowRoot.querySelector(sel).getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// One pointer on the canvas from `from` by `d` in `steps` moves: the mouse, or (Chromium) a CDP
// touch. `each(i)` runs after each move, before the release.
async function dragOnCanvas(page, way, from, d, steps, each = async () => {}) {
  const at = (i) => ({ x: from.x + (d.x * i) / steps, y: from.y + (d.y * i) / steps });
  if (way === 'touch') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(i)] });
      await each(i);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    return;
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(at(i).x, at(i).y);
    await each(i);
  }
  await page.mouse.up();
}

// The whole user units the canvas moved by: the pointer's travel since it went down (watchPointer),
// through the drawn root's scale, rounded (the snap step at fit is 1).
async function wholeUnits(page) {
  const { pts, a, d } = await page.evaluate(() => {
    const m = document.querySelector('.draw-host').shadowRoot.querySelector('svg').getScreenCTM();
    return { pts: window.__pts, a: m.a, d: m.d };
  });
  const [p, q] = [pts[0], pts[pts.length - 1]];
  return { x: Math.round((q[0] - p[0]) / a), y: Math.round((q[1] - p[1]) / d) };
}

// A drag moves the shape under it by whole user units (the snap step at fit), with the mouse and
// (Chromium) a finger: only its cx and cy change in the file, it is selected, the move is one
// history entry, and undo restores the bytes. While it moves, the tooltip reads where its centre is,
// its bottom edge 42 px above the pointer; the two coordinate guides end at that centre; and each
// frame is at most two attribute mutations on the canvas, never a node made or taken away. Then a
// group selected from its code block moves by its leading translate() alone (the rest of its
// multi-line transform keeps its bytes), and lab/grid.svg's circle moves by whole units.
async function aDragMovesTheShapeByWholeUnits(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    console.log(`     draw: the canvas's hit test is ${await page.evaluate(() => window.drawTest.hitPath())} (${browser.browserType().name()})`);
    const source = () => page.evaluate(() => window.drawTest.source());
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    await snapOff(page); // whole units alone (snapping: movesSnapToGuidesShapesAndTheGrid)
    for (const way of chromium(browser) ? ['mouse', 'touch'] : ['mouse']) {
      const c = await circleCentre(page);
      await page.evaluate(watchPointer);
      await page.evaluate(watchCanvas);
      const frames = [];
      let during = null;
      await dragOnCanvas(page, way, c, { x: 37.3, y: -21.6 }, 8, async (i) => {
        frames.push(await page.evaluate(canvasMutations));
        if (i < 8) return;
        during = await page.evaluate(() => {
          const tip = document.querySelector('.draw-tip');
          const o = document.querySelector('.draw-overlay').getBoundingClientRect();
          const ends = [...document.querySelectorAll('.draw-coord')].filter((l) => l.style.display !== 'none').map((l) => ({ x: o.left + Number(l.getAttribute('x2')), y: o.top + Number(l.getAttribute('y2')) }));
          const b = document.querySelector('.draw-host').shadowRoot.querySelector('circle').getBoundingClientRect();
          const [x, y] = window.__pts[window.__pts.length - 1];
          return { text: tip && !tip.hidden ? tip.textContent : null, bottom: tip ? tip.getBoundingClientRect().bottom : null, pointer: { x, y }, ends, centre: { x: b.x + b.width / 2, y: b.y + b.height / 2 } };
        });
      });
      const u = await wholeUnits(page);
      const [cx, cy] = [212 + u.x, 134 + u.y];
      must(await source() === SAMPLE.replace('cx="212" cy="134"', `cx="${cx}" cy="${cy}"`), `${way}: the drag did not move the circle by (${u.x}, ${u.y}) whole units, and nothing else:\n${await source()}`);
      must(await page.locator('.draw-sel').textContent() === '<circle>', `${way}: the dragged circle is not selected`);
      must(await undo.getAttribute('aria-label') === 'Undo Move', `${way}: the history's last entry is "${await undo.getAttribute('aria-label')}", not "Undo Move"`);
      must(during?.text === `x ${cx}, y ${cy}`, `${way}: during the drag the tooltip read ${JSON.stringify(during?.text)}, not "x ${cx}, y ${cy}"`);
      must(Math.abs(during.pointer.y - during.bottom - 42) <= 2, `${way}: the tooltip's bottom edge is ${(during.pointer.y - during.bottom).toFixed(1)} px above the pointer, not 42`);
      must(during.ends.length === 2 && during.ends.every((p) => Math.hypot(p.x - during.centre.x, p.y - during.centre.y) <= 1), `${way}: the coordinate guides end at ${JSON.stringify(during.ends)}, not at the circle's centre ${JSON.stringify(during.centre)}`);
      must(frames.some((f) => f.attributes > 0), `${way}: test setup: no drag frame moved the circle`);
      must(frames.every((f) => f.childList === 0 && f.characterData === 0 && f.attributes <= 2), `${way}: a drag frame did more than two attribute mutations on the canvas: ${JSON.stringify(frames)}`);
      await undo.tap();
      must(await source() === SAMPLE, `${way}: one undo did not restore the file byte for byte`);
      must(await undo.isDisabled(), `${way}: the drag was more than one history entry`);
      await page.locator('.draw-ctx-btn[aria-label="Deselect"]').tap();
    }
    // A group selected from its code block: a drag on a shape inside it moves the group, by its
    // leading translate() only; the rest of its three-line transform keeps its bytes.
    const T = readFileSync(join(CORPUS, 'lab/transform.svg'), 'utf8');
    must((await page.evaluate((t) => window.drawTest.render(t), T)).ok, 'test setup: lab/transform.svg did not open');
    await showCode(page);
    await twoFrames(page);
    await page.locator('.cv-block', { hasText: '</g>' }).tap();
    must(await page.locator('.draw-sel').textContent() === '<g>', "test setup: a tap on the group's end tag did not select it");
    await page.evaluate(watchPointer);
    await dragOnCanvas(page, 'mouse', await page.evaluate(drawnCentre, 'rect'), { x: 29.6, y: 17.2 }, 8);
    const g = await wholeUnits(page);
    must(g.x !== 0 && await source() === T.replace('translate(50 50)', `translate(${50 + g.x} ${50 + g.y})`), `the group's drag changed more than its translate(50 50) by (${g.x}, ${g.y}):\n${await source()}`);
    // lab/grid.svg: its circle moves by whole units.
    const G = readFileSync(join(CORPUS, 'lab/grid.svg'), 'utf8');
    must((await page.evaluate((t) => window.drawTest.render(t), G)).ok, 'test setup: lab/grid.svg did not open');
    await page.evaluate(watchPointer);
    await dragOnCanvas(page, 'mouse', await page.evaluate(drawnCentre, 'circle'), { x: -23.7, y: 31.1 }, 8);
    const q = await wholeUnits(page);
    must(q.x !== 0 && await source() === G.replace('cx="30" cy="60"', `cx="${30 + q.x}" cy="${60 + q.y}"`), `lab/grid.svg's circle did not move by (${q.x}, ${q.y}) whole units:\n${await source()}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

const THREE_RECTS = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">
  <rect id="A" x="10" y="10" width="15" height="15" fill="#e76f51"/>
  <rect id="B" x="40" y="10" width="15" height="15" fill="#2a9d8f"/>
  <rect id="C" x="70" y="70" width="15" height="15" fill="#264653"/>
</svg>
`;

// A drag from empty canvas draws a marquee in the overlay, from where the pointer went down to
// where it is, and selects what it wholly encloses: A inside it, not B half inside nor C outside. A
// hold-drag (down on B, a 500 ms wait, then a drag) draws a marquee instead of moving B and takes
// what it encloses; with Select more on, a second marquee adds; one under 5 px takes nothing. (Each
// starts clear of the Grid button at the canvas's top-left, which takes its own presses.)
async function aMarqueeSelectsWhatItEncloses(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    must((await page.evaluate((t) => window.drawTest.render(t), THREE_RECTS)).ok, 'test setup: the three rects did not open');
    await showCode(page);
    await twoFrames(page); // the canvas has fitted its new size
    const source = () => page.evaluate(() => window.drawTest.source());
    // What the code view marks as selected, by id.
    const chosen = () => page.evaluate(() => [...document.querySelectorAll('.cv-block.cv-selected')].map((b) => /id="(\w)"/.exec(b.textContent)?.[1]).filter(Boolean).sort().join(''));
    const marquee = async (from, to, hold = false) => {
      const [a, b] = await Promise.all([page.evaluate(screenPoint, from), page.evaluate(screenPoint, to)]);
      let drawn = null;
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      if (hold) await page.waitForTimeout(500);
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
        if (i === 8) drawn = await page.evaluate(() => [...document.querySelectorAll('.draw-marquee')].find((m) => m.style.display !== 'none')?.getBoundingClientRect().toJSON() ?? null);
      }
      await page.mouse.up();
      const want = { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
      return { drawn, want };
    };
    const m1 = await marquee({ x: 47, y: 32 }, { x: 5, y: 5 });
    must(m1.drawn && ['left', 'top', 'right', 'bottom'].every((k) => Math.abs(m1.drawn[k] - m1.want[k]) <= 1.5), `the marquee is drawn at ${JSON.stringify(m1.drawn)}, not from where the pointer went down to where it is (${JSON.stringify(m1.want)})`);
    must(await chosen() === 'A', `a marquee around A, with B half inside it, selected ${(await chosen()) || 'nothing'}`);
    const m2 = await marquee({ x: 47.5, y: 17.5 }, { x: 90, y: 90 }, true);
    must(m2.drawn !== null, 'a hold-drag from B drew no marquee');
    must(await source() === THREE_RECTS, 'a hold-drag from B moved it');
    must(await chosen() === 'C', `a hold-drag from B around C selected ${(await chosen()) || 'nothing'}`);
    await page.locator('.draw-ctx-btn[aria-label="Select more"]').tap();
    await marquee({ x: 32, y: 32 }, { x: 5, y: 5 });
    must(await chosen() === 'AC', `with Select more on, a second marquee around A left ${(await chosen()) || 'nothing'} selected, not A and C`);
    await page.locator('.draw-ctx-btn[aria-label="Deselect"]').tap();
    const e = await page.evaluate(screenPoint, { x: 5, y: 40 });
    await dragOnCanvas(page, 'mouse', e, { x: 60, y: 3 }, 8);
    must(await chosen() === '' && await page.locator('.draw-sel').textContent() === 'nothing selected', `a marquee 3 px tall selected ${await chosen()}`);
    must(await source() === THREE_RECTS, 'marquees changed the file');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Bring forward, Send back and Delete on a 2,000-node drawing (built like scrubFrameIsOneMutation)
// patch only what moved: at most 4 childList records on the canvas (the element and its
// whitespace, out and in) and no attribute record; every other drawn node, and every other block
// of the code view, is the same DOM node as before; and the file changes only by that element and
// its whitespace. Each undo likewise.
async function zOrderAndDeletePatchOnlyWhatMoved(browser, origin) {
  const rects = Array.from({ length: 1999 }, (_, i) => `<rect${i === 1000 ? ' id="m"' : ''} x="${(i % 50) * 40}" y="${Math.floor(i / 50) * 40}" width="30" height="30" fill="#2a9d8f"/>`);
  const svg = (list) => `<svg xmlns="${SVG_NS}" viewBox="0 0 2000 1600">\n${list.join('\n')}\n</svg>\n`;
  const swapped = (i) => svg(rects.map((r, j) => (j === i ? rects[i + 1] : j === i + 1 ? rects[i] : r)));
  const BIG = svg(rects);
  await withPage(browser, origin, 956, async (page, errors) => {
    const stats = await page.evaluate((t) => window.drawTest.render(t), BIG);
    must(stats.ok && stats.rendered === 2000, `test setup: the 2,000-node drawing rendered ${stats.rendered} elements`);
    const m = await page.evaluate(drawnCentre, '#m');
    await page.touchscreen.tap(m.x, m.y);
    must(await page.locator('.draw-label').textContent() === '<rect#m>', 'test setup: a tap on the rect did not select it');
    await showCode(page);
    // Keep every drawn node and every code block now, then see what is new after one step.
    const keep = () => page.evaluate(() => {
      const nodes = (root) => {
        const out = [];
        const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
        return out;
      };
      window.__nodes = nodes;
      window.__kept = new WeakSet([...nodes(document.querySelector('.draw-host').shadowRoot), ...document.querySelectorAll('.draw-code .cv-block')]);
    });
    const fresh = () => page.evaluate(() => {
      const drawn = window.__nodes(document.querySelector('.draw-host').shadowRoot).filter((n) => !window.__kept.has(n));
      const blocks = [...document.querySelectorAll('.draw-code .cv-block')].filter((b) => !window.__kept.has(b));
      const name = (n) => (n.nodeType === 1 ? `<${n.localName}${n.id ? `#${n.id}` : ''}>` : JSON.stringify(n.data));
      return { drawn: drawn.map(name).sort(), blocks: blocks.map((b) => (/^\s+$/.test(b.textContent) ? 'whitespace' : /id="m"/.test(b.textContent) ? '<rect#m>' : b.textContent.slice(0, 40))).sort() };
    });
    const MOVED = { drawn: ['"\\n"', '<rect#m>'], blocks: ['<rect#m>', 'whitespace'] };
    const step = async (label, act, file, made) => {
      await keep();
      await page.evaluate(watchCanvas);
      await act();
      const ms = await page.evaluate(canvasMutations);
      const now = await fresh();
      must(ms.childList > 0 && ms.childList <= 4 && ms.attributes === 0 && ms.characterData === 0, `${label}: the canvas saw ${JSON.stringify(ms)}, not at most 4 childList records and nothing else`);
      must(JSON.stringify(now.drawn) === JSON.stringify(made.drawn), `${label}: new drawn nodes ${JSON.stringify(now.drawn)}, not ${JSON.stringify(made.drawn)} (every other node must stay the same DOM node)`);
      must(JSON.stringify(now.blocks) === JSON.stringify(made.blocks), `${label}: new code blocks ${JSON.stringify(now.blocks)}, not ${JSON.stringify(made.blocks)}`);
      must(await page.evaluate(() => window.drawTest.source()) === file, `${label}: the file changed by more than the element and its whitespace`);
    };
    const tap = (name) => () => page.locator(`.draw-ctx-btn[aria-label="${name}"]`).tap();
    const undo = () => page.locator('.draw-tool', { hasText: 'Undo' }).tap();
    await step('Bring forward', tap('Bring forward'), swapped(1000), MOVED);
    await step('its undo', undo, BIG, MOVED);
    await step('Send back', tap('Send back'), swapped(999), MOVED);
    await step('its undo', undo, BIG, MOVED);
    await step('Delete', tap('Delete'), svg(rects.filter((_, i) => i !== 1000)), { drawn: [], blocks: [] });
    await step('its undo', undo, BIG, MOVED);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// A large selection keeps up (the P1-M1 review, F5): with 2,000 rects selected (⌘A), each frame of
// a drag of them all takes under 380 ms, 5× under the 1.9 s a frame took when every element read the
// whole document's stylesheets again (the fastest of five frames, so a pause of the runner's doesn't
// count; the code at peek, as that was measured), and the drag is one Move. With the code open,
// Delete of them all, and its undo, leave the code listing the file exactly.
async function aLargeSelectionDragsWithoutStalling(browser, origin) {
  const N = 2000;
  const side = Math.ceil(Math.sqrt(N));
  const cell = 1000 / side;
  const at = (v) => (v * cell).toFixed(2);
  const BIG = `<svg xmlns="${SVG_NS}" viewBox="-60 -60 1120 1120">\n${Array.from({ length: N }, (_, i) => `  <rect id="r${i}" x="${at(i % side)}" y="${at(Math.floor(i / side))}" width="${at(0.6)}" height="${at(0.6)}"/>`).join('\n')}\n</svg>\n`;
  await withPage(browser, origin, 956, async (page, errors) => {
    const stats = await page.evaluate((t) => window.drawTest.render(t), BIG);
    must(stats.ok && stats.rendered === N + 1, `test setup: the drawing rendered ${stats.rendered} elements`);
    const listing = () => page.evaluate(() => [...document.querySelectorAll('.draw-code .cv-block')].map((b) => b.textContent).join('') === window.drawTest.source());
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })));
    must(await page.locator('.draw-label').textContent() === `${N} selected`, `test setup: Select all took "${await page.locator('.draw-label').textContent()}"`);
    const frames = await page.evaluate((c) => {
      const svg = document.querySelector('.draw-host').shadowRoot.querySelector('svg');
      const p = new DOMPoint(c * 0.3, c * 0.3).matrixTransform(svg.getScreenCTM());
      const area = document.querySelector('.draw-canvas');
      const fire = (type, x, y) => area.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      fire('pointerdown', p.x, p.y);
      fire('pointermove', p.x + 8, p.y + 3); // past the slop: the move starts
      const ms = [];
      for (let i = 2; i <= 6; i++) {
        const t = performance.now();
        fire('pointermove', p.x + 8 * i, p.y + 3 * i);
        ms.push(performance.now() - t);
      }
      fire('pointerup', p.x + 48, p.y + 18);
      return ms;
    }, cell);
    const fastest = Math.min(...frames);
    must(fastest < 380, `a drag frame over ${N} selected shapes took ${fastest.toFixed(0)} ms at best (${frames.map((f) => f.toFixed(0)).join('/')}), not under 380`);
    must(await page.locator('.draw-tool', { hasText: 'Undo' }).getAttribute('aria-label') === 'Undo Move', 'the drag of them all was not one Move');
    must(await page.evaluate((t) => window.drawTest.source() !== t, BIG), 'the drag moved nothing');
    await page.locator('.draw-tool', { hasText: 'Undo' }).tap();
    must(await page.evaluate((t) => window.drawTest.source() === t, BIG), 'the Move did not undo to the file');
    await showCode(page);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })));
    await page.locator('.draw-ctx-btn[aria-label="Delete"]').tap();
    must(await page.evaluate(() => window.drawTest.source()) === `<svg xmlns="${SVG_NS}" viewBox="-60 -60 1120 1120">\n</svg>\n`, 'Delete of them all left more than the root');
    must(await listing(), 'after Delete of them all, the code listing is not the file');
    await page.locator('.draw-tool', { hasText: 'Undo' }).tap();
    must(await page.evaluate((t) => window.drawTest.source() === t, BIG), 'the Delete did not undo to the file');
    must(await listing(), 'after the undo of Delete, the code listing is not the file');
    console.log(`     draw: a drag frame over ${N} selected shapes: ${fastest.toFixed(0)} ms at best`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The Snap sheet's Grid step field is one history entry however it is typed (the P1-M1 review,
// F11): 25, ⌫ and 0.5 (20.5), then Done, write grid="20.5", and one undo gives Auto back (the file as
// it was); so does 25 closed with the dim while the field still has focus.
async function theGridStepFieldIsOneEntry(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    const source = () => page.evaluate(() => window.drawTest.source());
    const state = async () => /<draw:state[^>]*>/.exec(await source())?.[0] ?? null;
    const start = await source();
    const field = page.locator('.draw-snap-step input');
    await page.locator('.draw-snap-btn').tap();
    await field.tap();
    await page.keyboard.type('25');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('0.5');
    await page.locator('.draw-modal-done').tap();
    must(await state() === '<draw:state version="1" grid="20.5"/>', `typing 25, ⌫, 0.5 then Done wrote ${await state()}`);
    must(await undo.getAttribute('aria-label') === 'Undo Set grid step', `the last entry is ${await undo.getAttribute('aria-label')}`);
    await undo.tap();
    must(await source() === start, `one undo did not give Auto back (${await state()}): the typing was more than one entry`);
    must(await undo.isDisabled(), 'the typing left more than one entry');
    await page.locator('.draw-snap-btn').tap();
    await field.tap();
    await page.keyboard.type('25');
    await page.waitForTimeout(400); // past the dim's guard against the tap that opened the sheet (Sheets.tsx)
    await page.locator('.draw-scrim').tap({ position: { x: 10, y: 10 } });
    await page.locator('.draw-modal').waitFor({ state: 'detached' });
    must(await state() === '<draw:state version="1" grid="25"/>', `typing 25 then the dim wrote ${await state()}`);
    await undo.tap();
    must(await source() === start && await undo.isDisabled(), 'closed with the dim, the typing was more than one entry');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The Snap sheet on the phone (the P1-M1 review, F13): at 440×796 (a Safari tab) with the code at
// half and six guides, the sheet sits in the viewport over everything the canvas draws: Done lies
// inside the viewport; on top at Done's centre and at the Grid step field's are those controls, with
// the overlay's marks made hittable too (the chrome buttons, guides and pills painted over the sheet
// when it lived in the canvas); and Done closes it.
async function theSnapSheetIsReachableOnThePhone(browser, origin) {
  const SIX = `<svg xmlns="${SVG_NS}" xmlns:draw="https://mmaggitti.github.io/draw/ns" viewBox="0 0 100 100">
  <metadata draw:made="true"><draw:state version="1" guides="v 10 v 30 v 50 h 20 h 40 h 60"/></metadata>
  <rect x="10" y="10" width="30" height="30" fill="#2a9d8f"/>
</svg>
`;
  await withPage(browser, origin, 796, async (page, errors) => {
    must((await page.evaluate((t) => window.drawTest.render(t), SIX)).ok, 'test setup: the file did not open');
    await page.locator('.draw-handle').tap();
    must(await page.locator('.draw-sheet--half').count() === 1, 'test setup: the code panel is not at half');
    await page.locator('.draw-snap-btn').tap();
    await page.locator('.draw-snap-step input').waitFor();
    await twoFrames(page);
    must(await page.locator('.draw-guide-row').count() === 6, `test setup: the sheet lists ${await page.locator('.draw-guide-row').count()} guides, not 6`);
    const r = await page.evaluate(() => {
      const marks = [document.querySelector('.draw-marks'), ...document.querySelectorAll('.draw-marks *')];
      for (const m of marks) m.style.pointerEvents = 'auto';
      const on = (el) => {
        const b = el.getBoundingClientRect();
        const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, top: top === el || el.contains(top) ? 'it' : top ? `${top.tagName} ${top.getAttribute('class')}` : 'nothing' };
      };
      const out = { done: on(document.querySelector('.draw-modal-done')), field: on(document.querySelector('.draw-snap-step input')), w: innerWidth, h: innerHeight };
      for (const m of marks) m.style.pointerEvents = '';
      return out;
    });
    const d = r.done;
    must(d.x >= 0 && d.y >= 0 && d.right <= r.w && d.bottom <= r.h, `Done is at ${Math.round(d.x)},${Math.round(d.y)}..${Math.round(d.right)},${Math.round(d.bottom)}, outside the ${r.w}×${r.h} viewport`);
    must(d.top === 'it', `on top of Done is ${d.top}`);
    must(r.field.top === 'it', `on top of the Grid step field is ${r.field.top}`);
    await page.locator('.draw-modal-done').tap();
    await page.locator('.draw-modal').waitFor({ state: 'detached', timeout: 5000 });
    must(await page.locator('.draw-modal').count() === 0, 'Done did not close the Snap sheet');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// A file's own CSS can't move its drawing off the paper (the P1-M1 review, F17): with
// #r { left: 100px !important; top: 50px !important } on its root (an id outranks :host > svg), the
// rect that fills its viewBox still lies exactly on the paper, because the camera's rule is in a
// cascade layer. (A file's own @layer with !important still wins: the engine README's known limits.)
async function aFilesOwnCssCantMoveItsDrawing(browser, origin) {
  const T = `<svg id="r" xmlns="${SVG_NS}" viewBox="0 0 100 100"><style>#r { left: 100px !important; top: 50px !important }</style><rect id="fill" width="100" height="100" fill="#2a9d8f"/></svg>`;
  await withPage(browser, origin, 956, async (page, errors) => {
    must((await page.evaluate((t) => window.drawTest.render(t), T)).ok, 'test setup: the file did not open');
    await twoFrames(page);
    const r = await page.evaluate(() => ({
      drawing: document.querySelector('.draw-host').shadowRoot.getElementById('fill').getBoundingClientRect().toJSON(),
      paper: document.querySelector('.draw-paper').getBoundingClientRect().toJSON(),
    }));
    must(boxNear(r.drawing, r.paper, 1), `the file's #r { left, top !important } moved the drawing to ${rect(r.drawing)}, off its paper at ${rect(r.paper)}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// The arrows nudge the canvas selection: → moves the circle's cx by 1, ⇧→ by 10, and → held with 5
// auto-repeats is one history entry. With a code token focused the arrows are the token's: ↑ steps
// a number (P0), → and ↓ on a colour do nothing, and neither nudges. In the Number sheet's field
// they move the caret, and nothing else.
async function arrowsNudgeOnlyTheCanvasSelection(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const source = () => page.evaluate(() => window.drawTest.source());
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    const c = await circleCentre(page);
    await page.touchscreen.tap(c.x, c.y);
    must(await page.locator('.draw-sel').textContent() === '<circle>', 'test setup: tapping the circle did not select it');
    const at = (cx, r = 42) => SAMPLE.replace('cx="212"', `cx="${cx}"`).replace('r="42"', `r="${r}"`);
    await page.keyboard.press('ArrowRight');
    must(await source() === at(213), '→ did not move the circle by 1');
    await page.keyboard.press('Shift+ArrowRight');
    must(await source() === at(223), '⇧→ did not move the circle by 10');
    await page.keyboard.down('ArrowRight');
    for (let i = 0; i < 5; i++) await page.keyboard.down('ArrowRight'); // auto-repeats
    await page.keyboard.up('ArrowRight');
    must(await source() === at(229), `a held → with 5 auto-repeats did not move the circle by 6:\n${await source()}`);
    must(await undo.getAttribute('aria-label') === 'Undo Nudge', `the history's last entry is "${await undo.getAttribute('aria-label')}", not "Undo Nudge"`);
    await undo.tap();
    must(await source() === at(223), 'one undo did not take the whole held → back: it was more than one entry');
    // A code token with the focus has the arrows.
    await showCode(page);
    const circle = page.locator('.cv-block', { hasText: '<circle' });
    const r = circle.locator('.cv-number').nth(2);
    await r.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await r.focus();
    await page.keyboard.press('ArrowUp');
    must(await source() === at(223, 43), `↑ on the focused r did not step it, or nudged the circle:\n${await source()}`);
    await circle.locator('.cv-color').first().focus();
    for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft']) await page.keyboard.press(k);
    must(await source() === at(223, 43), 'the arrows on a focused colour token nudged the circle');
    // The Number sheet's field: the caret moves, nothing else.
    await tapToken(r);
    await page.locator('.draw-strip-value').tap();
    const field = page.locator('.draw-modal input').first();
    await field.focus();
    await field.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
    const end = await field.evaluate((el) => el.selectionStart);
    await page.keyboard.press('ArrowLeft');
    must(await field.evaluate((el) => el.selectionStart) === end - 1, 'ArrowLeft in the Number sheet did not move the caret');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    must(await source() === at(223, 43), 'the arrows in the Number sheet changed the file');
    await page.locator('.draw-modal-done').tap();
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Runs in the page: the grid as drawn (client px), the paper's rectangle, and each line's place in
// the root's user units (through the drawn root's getScreenCTM).
function gridNow() {
  const svg = document.querySelector('.draw-grid');
  const o = svg.getBoundingClientRect();
  const inv = document.querySelector('.draw-host').shadowRoot.querySelector('svg').getScreenCTM().inverse();
  const paper = document.querySelector('.draw-paper').getBoundingClientRect().toJSON();
  const lines = [...svg.querySelectorAll('line')].filter((l) => l.style.display !== 'none').map((l) => {
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((a) => Number(l.getAttribute(a)));
    const v = x1 === x2;
    const p = new DOMPoint(o.left + x1, o.top + y1).matrixTransform(inv);
    return { v, at: v ? o.left + x1 : o.top + y1, from: v ? o.top + y1 : o.left + x1, to: v ? o.top + y2 : o.left + x2, unit: v ? p.x : p.y, major: l.classList.contains('major') };
  });
  return { step: Number(svg.dataset.step), paper, lines };
}

// The Grid button (44 pt at least) is off at first, and no line is drawn. On, the grid's lines are
// drawn over the paper only, at least 12 px apart, at multiples of a 1, 2 or 5 × 10ⁿ step in the
// root's user units (read back through its getScreenCTM), every fifth major; zoomed ×4 the step is
// finer. The file never changes, and the choice survives a reload; so do the Snap sheet's toggles
// (device preferences too: Guides turned off stays off, the rest on).
async function theGridToggleShowsTheGrid(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const btn = page.locator('.draw-grid-btn');
    const b = await btn.boundingBox();
    must(b && b.width >= TAP_MIN && b.height >= TAP_MIN, `the Grid button is ${b ? `${b.width}×${b.height}` : 'missing'}, under ${TAP_MIN}pt`);
    must(await btn.getAttribute('aria-pressed') === 'false', 'the grid is on at first');
    must((await page.evaluate(gridNow)).lines.length === 0, 'grid lines are drawn while the grid is off');
    await btn.tap();
    must(await btn.getAttribute('aria-pressed') === 'true', 'the Grid button did not turn on');
    const problems = [];
    const judge = (g, when) => {
      const e = 10 ** Math.floor(Math.log10(g.step));
      if (!(g.step > 0) || ![1, 2, 5, 10].some((m) => Math.abs(g.step - m * e) < 1e-9 * g.step)) problems.push(`${when}: the step ${g.step} is not 1, 2 or 5 × 10ⁿ`);
      if (g.lines.length < 4) problems.push(`${when}: only ${g.lines.length} grid line(s)`);
      const p = g.paper;
      for (const [v, name] of [[true, 'vertical'], [false, 'horizontal']]) {
        const ls = g.lines.filter((l) => l.v === v).sort((a, b) => a.at - b.at);
        const [lo, hi, from, to] = v ? [p.left, p.right, p.top, p.bottom] : [p.top, p.bottom, p.left, p.right];
        for (const l of ls) {
          const k = l.unit / g.step;
          if (Math.abs(k - Math.round(k)) > 1e-3) problems.push(`${when}: a ${name} line at ${l.unit} user units is not a multiple of ${g.step}`);
          else if (l.major !== (Math.round(k) % 5 === 0)) problems.push(`${when}: the ${name} line at ${l.unit} is ${l.major ? '' : 'not '}major`);
          if (l.at < lo - 0.5 || l.at > hi + 0.5 || l.from < from - 0.5 || l.to > to + 0.5) problems.push(`${when}: a ${name} line at ${l.at.toFixed(1)} px runs past the paper (${JSON.stringify(p)})`);
        }
        for (let i = 1; i < ls.length; i++) if (ls[i].at - ls[i - 1].at < 12 - 0.01) problems.push(`${when}: ${name} lines ${(ls[i].at - ls[i - 1].at).toFixed(2)} px apart, under 12`);
      }
    };
    const fit = await page.evaluate(gridNow);
    judge(fit, 'at fit');
    const c = await circleCentre(page);
    for (let i = 0; i < 2; i++) await ctrlWheel(page, Math.round(c.x), Math.round(c.y), -100);
    const zoomed = await page.evaluate(gridNow);
    judge(zoomed, 'zoomed ×4');
    must(zoomed.step < fit.step, `zoomed ×4 the step is ${zoomed.step}, not finer than ${fit.step} at fit`);
    must(problems.length === 0, problems.slice(0, 12).join('\n'));
    must(await page.evaluate(() => window.drawTest.source()) === SAMPLE, 'the grid changed the file');
    const snapToggles = async () => {
      await page.locator('.draw-snap-btn').tap();
      const on = {};
      for (const name of ['Grid', 'Guides', 'Shapes', 'Artboard']) on[name] = await page.locator('.draw-snap-toggles .ds-btn', { hasText: new RegExp(`^${name}$`) }).getAttribute('aria-pressed');
      return on;
    };
    must(JSON.stringify(await snapToggles()) === JSON.stringify({ Grid: 'true', Guides: 'true', Shapes: 'true', Artboard: 'true' }), 'test setup: not everything snaps at first');
    await page.locator('.draw-snap-toggles .ds-btn', { hasText: /^Guides$/ }).tap();
    await page.locator('.draw-modal-done').tap();
    must(await page.evaluate(() => window.drawTest.source()) === SAMPLE, 'a Snap toggle changed the file');
    await page.reload({ waitUntil: 'networkidle' });
    await twoFrames(page);
    must(await btn.getAttribute('aria-pressed') === 'true', 'the grid did not stay on across a reload');
    must((await page.evaluate(gridNow)).lines.length > 0, 'after a reload the grid draws nothing');
    const kept = await snapToggles();
    must(JSON.stringify(kept) === JSON.stringify({ Grid: 'true', Guides: 'false', Shapes: 'true', Artboard: 'true' }), `after a reload the Snap toggles are ${JSON.stringify(kept)}, not Guides off and the rest on`);
    await page.locator('.draw-modal-done').tap();
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Synthetic probes for geometryMatchesTheBrowser, beside the corpus: transform-origin with keywords
// and percentages on the view box and the fill box, nested viewports with each preserveAspectRatio,
// and em, ex, rem and % lengths.
const GEOMETRY_PROBES = [
  ['transform-origin on the view box', `<svg xmlns="${SVG_NS}" viewBox="0 0 200 100" width="200" height="100">
  <rect x="10" y="10" width="40" height="20" transform="rotate(30)" transform-origin="left top"/>
  <rect x="60" y="10" width="40" height="20" transform="rotate(30)" transform-origin="50% 50%"/>
  <rect x="110" y="10" width="40" height="20" transform="scale(1.5)" transform-origin="right bottom"/>
  <rect x="10" y="50" width="40" height="20" transform="rotate(-20)" style="transform-origin: 25% 75%"/>
  <rect x="60" y="50" width="40" height="20" transform="skewX(20)" transform-origin="center"/>
</svg>`],
  ['transform-origin on the fill box', `<svg xmlns="${SVG_NS}" viewBox="0 0 200 100" width="200" height="100">
  <rect x="10" y="10" width="40" height="20" transform="rotate(45)" style="transform-box: fill-box; transform-origin: center"/>
  <rect x="60" y="10" width="40" height="20" transform="rotate(45)" style="transform-box: fill-box; transform-origin: 0 100%"/>
  <rect x="110" y="10" width="40" height="20" transform="scale(0.5 2)" style="transform-box: fill-box; transform-origin: right top"/>
  <circle cx="40" cy="70" r="12" transform="scale(1.5)" style="transform-box: fill-box; transform-origin: 25% 25%"/>
  <g transform="rotate(10)" style="transform-box: fill-box; transform-origin: center"><rect x="120" y="50" width="30" height="30"/><rect x="160" y="60" width="20" height="10"/></g>
</svg>`],
  ['nested viewports, each preserveAspectRatio', `<svg xmlns="${SVG_NS}" viewBox="0 0 300 100" width="300" height="100">
  ${['xMinYMin meet', 'xMidYMid meet', 'xMaxYMax meet', 'xMinYMin slice', 'xMidYMid slice', 'xMaxYMax slice', 'none'].map((par, i) => `<svg x="${(i % 4) * 70 + 5}" y="${Math.floor(i / 4) * 50 + 5}" width="60" height="30" viewBox="0 0 10 20" preserveAspectRatio="${par}"><rect x="1" y="2" width="8" height="16"/><circle cx="5" cy="5" r="3"/></svg>`).join('\n  ')}
  <svg x="220" y="60" width="50%" height="30%" viewBox="-5 -5 20 20"><rect width="10" height="10"/></svg>
</svg>`],
  ['curves, arcs and polylines', `<svg xmlns="${SVG_NS}" viewBox="0 0 200 120" width="200" height="120">
  <path d="M10 60 C 20 0, 60 0, 70 60 S 120 120, 130 60"/>
  <path d="M10 100 Q 40 60 70 100 T 130 100"/>
  <path d="M150 20 A 30 15 30 0 1 190 60"/>
  <path d="M150 70 A 30 15 -45 1 0 190 100 Z"/>
  <path d="m20 20 h30 v10 l-10 10 z m40 0 c10 -10 20 10 30 0"/>
  <polyline points="100,10 120,40 110,5 140,30"/>
  <polygon points="160,110 180,80 195,115"/>
  <line x1="5" y1="115" x2="60" y2="112"/>
  <ellipse cx="100" cy="90" rx="15" ry="6" transform="rotate(35 100 90)"/>
  <g transform="translate(5 3) rotate(-10) scale(1.2 0.8)"><path d="M60 20 C 70 10, 80 30, 90 20"/><rect x="60" y="25" width="10" height="5" transform="skewY(15)"/></g>
</svg>`],
  ['em, ex, rem and % lengths', `<svg xmlns="${SVG_NS}" viewBox="0 0 200 100" width="200" height="100" style="font-size: 10px">
  <rect x="1em" y="2em" width="3rem" height="10%" style="font-size: 20px"/>
  <rect x="50%" y="5ex" width="2ex" height="1rem"/>
  <circle cx="25%" cy="50%" r="5%"/>
  <ellipse cx="3em" cy="70" rx="2rem" ry="1em" font-size="8"/>
  <line x1="10%" y1="90%" x2="2em" y2="3rem" stroke="#000"/>
  <svg x="120" y="10" width="4em" height="4em" viewBox="0 0 10 10"><rect width="100%" height="50%"/></svg>
</svg>`],
];

// The engine's geometry against the browser's: the box of every drawn element, from the file in
// node (engine/geometry's rootBounds, with the page's rem) and from the page (drawTest.measureAll:
// each element's getBBox through root.getScreenCTM()⁻¹ · el.getScreenCTM(), in the root's user
// units), within 0.5 user units wherever both give one. Over every static corpus file and the
// synthetic probes above: at least 1,000 elements in 150 files (the static corpus holds about 1,250
// boxes the browser measures, a fifth of them text, which the engine can't). Known, and left out: a
// path with an error in its data, which the engine reads up to where every browser stops
// (engine/path/parse.ts) while Blink and WebKit draw on past a comma before a command.
async function geometryMatchesTheBrowser(browser, origin) {
  const files = [...corpusFiles().filter((f) => !ANIMATES.test(f.text)), ...GEOMETRY_PROBES.map(([name, text]) => ({ name: `probe: ${name}`, text }))];
  await withPage(browser, origin, 956, async (page, errors) => {
    const remPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    const host = await page.evaluate(() => {
      const b = document.querySelector('.draw-host').getBoundingClientRect();
      return { width: b.width, height: b.height };
    });
    let compared = 0, inFiles = 0, known = 0;
    const differ = [];
    const box = (b) => `(${b.map((v) => Math.round(v * 100) / 100).join(', ')})`;
    for (const f of files) {
      const parsed = parseDoc(f.text);
      if (!parsed.ok || !(await page.evaluate((t) => window.drawTest.render(t), f.text)).ok) continue;
      const theirs = new Map((await page.evaluate(() => window.drawTest.measureAll())).map((m) => [m.index, m.box]));
      const doc = parsed.doc;
      const ctx = { viewport: rootViewport(doc, host), remPx };
      const order = [];
      const walk = (id, path) => {
        const n = doc.nodes.get(id);
        if (n?.kind !== 'element') return;
        order.push({ id, path });
        n.children.filter((k) => doc.nodes.get(k)?.kind === 'element').forEach((k, i) => walk(k, `${path} > ${doc.nodes.get(k).qname}:${i + 1}`));
      };
      walk(doc.root, 'svg');
      let here = 0;
      order.forEach(({ id, path }, index) => {
        const b = theirs.get(index);
        const r = b && rootBounds(doc, id, ctx);
        if (!b || !r) return;
        const n = doc.nodes.get(id);
        if (n.local === 'path' && parsePath(attrValue(doc, n, null, 'd') ?? '').error) return void known++;
        here++;
        const mine = [r.x, r.y, r.x + r.width, r.y + r.height];
        if (mine.some((v, i) => Math.abs(v - b[i]) > 0.5)) differ.push(`${f.name} ${path}: engine ${box(mine)}, browser ${box(b)}`);
      });
      compared += here;
      if (here) inFiles++;
    }
    console.log(`     draw: the engine's geometry matched the browser's on ${compared - differ.length} of ${compared} element(s) in ${inFiles} file(s) (${known} known difference(s) left out)`);
    must(compared >= 1000 && inFiles >= 150, `compared ${compared} elements in ${inFiles} files (at least 1,000 in 150 needed)`);
    must(differ.length === 0, `${differ.length} element(s) whose box differs by more than 0.5 user units; the first ${Math.min(10, differ.length)}:\n${differ.slice(0, 10).join('\n')}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// tools/drawio-flowchart-decision.svg's <rect width="100%" height="100%"> measures (0, 0, 161, 261)
// in the root's user units at fit, after a ×8 ctrl-wheel zoom, a pan and a pinch, while its screen
// size follows the zoom: the view is the root's own box, never its viewBox, which stays
// "-0.5 -0.5 161 261". At ×8 the half-unit strip between the box's left edge and the rect (user x
// −0.5 to 0), which only the root's own CSS background covers, is white where the checkerboard alone
// would show #eeeeee squares. The file never changes.
async function percentLengthsKeepTheirSizeUnderZoom(browser, origin) {
  const F = readFileSync(join(CORPUS, 'tools/drawio-flowchart-decision.svg'), 'utf8');
  await withPage(browser, origin, 956, async (page, errors) => {
    must((await page.evaluate((t) => window.drawTest.render(t), F)).ok, 'test setup: the draw.io flowchart did not open');
    const read = () => page.evaluate(() => {
      const root = document.querySelector('.draw-host').shadowRoot.querySelector('svg');
      const rect = root.querySelector(':scope > rect');
      const k = root.getScreenCTM().inverse().multiply(rect.getScreenCTM());
      const b = rect.getBBox();
      const [p, q] = [new DOMPoint(b.x, b.y).matrixTransform(k), new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(k)];
      const s = rect.getBoundingClientRect();
      return { box: [p.x, p.y, q.x - p.x, q.y - p.y], screen: [s.width, s.height], scale: root.getScreenCTM().a, viewBox: root.getAttribute('viewBox') };
    });
    const problems = [];
    const judge = (r, when) => {
      if (r.box.some((v, i) => Math.abs(v - [0, 0, 161, 261][i]) > 0.01)) problems.push(`${when}: the 100% rect measures (${r.box.map((v) => v.toFixed(3)).join(', ')}), not (0, 0, 161, 261)`);
      if (Math.abs(r.screen[0] - 161 * r.scale) > 0.5 || Math.abs(r.screen[1] - 261 * r.scale) > 0.5) problems.push(`${when}: on screen it is ${r.screen.map((v) => v.toFixed(1)).join('×')}, not 161×261 at ${r.scale.toFixed(3)} px a unit`);
      if (r.viewBox !== '-0.5 -0.5 161 261') problems.push(`${when}: the drawn root's viewBox is ${JSON.stringify(r.viewBox)}`);
    };
    const fit = await read();
    judge(fit, 'at fit');
    // ×8 about the drawing's left edge, halfway down.
    const edge = await page.evaluate(screenPoint, { x: 0, y: 130 });
    for (let i = 0; i < 3; i++) await ctrlWheel(page, Math.round(edge.x), Math.round(edge.y), -100);
    const zoomed = await read();
    judge(zoomed, 'zoomed ×8');
    if (Math.abs(zoomed.scale / fit.scale - 8) > 1e-3) problems.push(`the ctrl-wheel zoomed ×${(zoomed.scale / fit.scale).toFixed(4)}, not ×8`);
    // The strip from user x −0.5 to 0, inside (away from its anti-aliased edges), over 40 px of height.
    const [a, b] = await Promise.all([page.evaluate(screenPoint, { x: -0.5, y: 130 }), page.evaluate(screenPoint, { x: 0, y: 130 })]);
    const [x0, x1] = [Math.ceil(a.x) + 1, Math.floor(b.x) - 1];
    if (x1 - x0 < 4) problems.push(`the half-unit strip is only ${x1 - x0} px wide at ×8`);
    else {
      const top = Math.round(a.y) - 20;
      const shot = decodePng(await page.screenshot({ clip: { x: x0, y: top, width: x1 - x0, height: 40 } }));
      let grey = 0;
      for (let y = 0; y < shot.height; y++) for (let x = 0; x < shot.width; x++) if (shot.rgb(x, y).some((v) => v < 254)) grey++;
      if (grey) problems.push(`${grey} of ${shot.width * shot.height} px of the strip between the root's box and the 100% rect are not white: the root's own background does not cover its box`);
    }
    // A pan (the wheel) and a pinch: the rect keeps its size in user units.
    await page.evaluate(([x, y]) => document.querySelector('.draw-canvas').dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaX: 40, deltaY: 60, bubbles: true, cancelable: true })), [200, 300]);
    judge(await read(), 'after a pan');
    await twoFingers(browser, page, { x: 180, y: 300 }, { x: 260, y: 300 }, { x: 150, y: 300 }, { x: 290, y: 300 }, 8);
    judge(await read(), 'after a pinch');
    must(problems.length === 0, problems.join('\n'));
    must(await page.evaluate(() => window.drawTest.source()) === F, 'zooming changed the file');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// ── P1-M1 S3: handles and snapping ─────────────────────────────────────────────────────────────

// Runs in the page: the overlay's handles, each with its id, kind, client centre and fill.
function handlesNow() {
  const o = document.querySelector('.draw-overlay').getBoundingClientRect();
  return [...document.querySelectorAll('.draw-hd[data-handle]')].filter((h) => h.style.display !== 'none').map((h) => {
    const b = h.getBoundingClientRect();
    return { id: h.getAttribute('data-handle'), kind: h.getAttribute('class'), x: b.x + b.width / 2, y: b.y + b.height / 2, fill: getComputedStyle(h).fill, o: o.x };
  });
}
// Runs in the page: a point in a drawn element's own units, on screen (its getScreenCTM).
function elementPoint({ sel, x, y }) {
  const el = document.querySelector('.draw-host').shadowRoot.querySelector(sel);
  const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM());
  return { x: p.x, y: p.y };
}
const SHAPES_SVG = () => readFileSync(join(CORPUS, 'lab/shapes.svg'), 'utf8');
const openAndSelect = async (page, text, sel) => {
  must((await page.evaluate((t) => window.drawTest.render(t), text)).ok, 'test setup: the file did not open');
  await twoFrames(page);
  const c = await page.evaluate(drawnCentre, sel);
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(50);
};

// On lab/shapes.svg's selected rect, a press takes the nearest handle within 26 pt: 20 pt from the
// top-left corner (and further from every other) it drags that corner; 27 pt from every handle it
// moves the rect instead; with two handles 10 and 20 pt away, the nearer wins. The dragged handle
// is yellow while it moves and white after. A guide's pill is picked anywhere in 44 × 44.
async function theNearestHandleWithin26ptWins(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const F = SHAPES_SVG();
    await openAndSelect(page, F, 'rect');
    const source = () => page.evaluate(() => window.drawTest.source());
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    const hs = await page.evaluate(handlesNow);
    const tl = hs.find((h) => h.id === 'tl');
    must(tl && hs.some((h) => h.id === 'center') && hs.some((h) => h.id === 'rot'), `test setup: the rect's handles are ${hs.map((h) => h.id)}`);
    // 20 pt up and left of the top-left corner: that corner, dragged 30 pt further out.
    const p = { x: tl.x - 14.14, y: tl.y - 14.14 };
    let during = null;
    await dragOnCanvas(page, 'mouse', p, { x: -30, y: -30 }, 6, async (i) => {
      if (i === 6) during = (await page.evaluate(handlesNow)).find((h) => h.id === 'tl')?.fill;
    });
    const after = (await page.evaluate(handlesNow)).find((h) => h.id === 'tl')?.fill;
    const moved = await source();
    must(/<rect x="\d+" y="\d+" width="\d+" height="\d+"/.test(moved) && moved !== F && !moved.includes('x="20" y="25"'), `a press 20 pt from the top-left corner did not drag it:\n${moved}`);
    const [x, y, w, h] = /x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/.exec(moved).slice(1).map(Number);
    must(x + w === 80 && y + h === 75, `the corner drag moved the bottom-right corner (${x + w}, ${y + h})`);
    must(during === 'rgb(255, 230, 0)', `the dragged handle is ${during} during the drag, not yellow`);
    must(after === 'rgb(255, 255, 255)', `the handle is ${after} after the drag, not white`);
    await undo.tap();
    // 27 pt from every handle, on the rect: a move.
    const now = await page.evaluate(handlesNow);
    const q = { x: now.find((h) => h.id === 'tl').x + 40, y: now.find((h) => h.id === 'tl').y + 27 };
    must(now.every((hd) => Math.hypot(hd.x - q.x, hd.y - q.y) >= 27), 'test setup: the point is within 27 pt of a handle');
    await dragOnCanvas(page, 'mouse', q, { x: 21, y: 13 }, 6);
    const m = await source();
    must(/width="60" height="50"/.test(m) && !m.includes('x="20" y="25"'), `a press 27 pt from every handle did not move the rect:\n${m}`);
    await undo.tap();
    // Zoomed out, two handles 10 and 20 pt from one point: the top-left corner and the centre.
    const c = await page.evaluate(drawnCentre, 'rect');
    for (let i = 0; i < 2; i++) await ctrlWheel(page, Math.round(c.x), Math.round(c.y), 110);
    const small = await page.evaluate(handlesNow);
    const [a, b] = [small.find((h) => h.id === 'tl'), small.find((h) => h.id === 'center')];
    must(a && b, `test setup: zoomed out the handles are ${small.map((h) => h.id)}`);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const r = { x: a.x + ((b.x - a.x) * 10) / len, y: a.y + ((b.y - a.y) * 10) / len };
    must(len > 25 && len < 40, `test setup: the corner and the centre are ${len.toFixed(1)} pt apart`);
    await dragOnCanvas(page, 'mouse', r, { x: -12, y: -12 }, 6);
    const z = await source();
    must(!z.includes('width="60" height="50"') && /x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/.test(z), `the nearer handle (the corner, 10 pt away) did not win over the centre (${(len - 10).toFixed(1)} pt):\n${z}`);
    await undo.tap();
    // A guide's pill, picked 21 pt off its centre both ways.
    await page.locator('.draw-snap-btn').tap();
    await page.locator('.draw-snap .ds-btn', { hasText: 'Add vertical guide' }).tap();
    await page.locator('.draw-modal-done').tap();
    const pill = await page.evaluate(() => [...document.querySelectorAll('.draw-pill')].filter((p) => p.style.display !== 'none').map((p) => p.getBoundingClientRect().toJSON())[0] ?? null);
    must(pill, 'the guide has no pill');
    const pc = { x: pill.x + pill.width / 2 + 21, y: pill.y + pill.height / 2 + 21 };
    await dragOnCanvas(page, 'mouse', pc, { x: 40, y: 0 }, 6);
    must(!(await source()).includes('guides="v 50"') && /guides="v \d+"/.test(await source()), 'a press 21 pt off the pill in both directions did not take it');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// lab/shapes.svg's rect (x 20, y 25, 60 × 50): its top-left corner dragged to (30, 30) writes x 30,
// y 30, width 50, height 45, the bottom-right staying at (80, 75); dragged past the bottom-right it
// stops at 1 × 1; the bottom-right dragged to (90, 80) writes 70 × 55, the tooltip reading
// "70 × 55"; each one history entry. A rect turned 30° resizes along its own sides (the corner
// lands under the pointer). A group's corner doubles its width by a leading translate() scale()
// pair (its top-left stays put, the tooltip reads its new size); a second drag rewrites that pair,
// and a move then edits its translate.
async function rectCornerHandlesKeepTheOppositeCorner(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const F = SHAPES_SVG();
    await openAndSelect(page, F, 'rect');
    const source = () => page.evaluate(() => window.drawTest.source());
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    const handle = async (id) => (await page.evaluate(handlesNow)).find((h) => h.id === id);
    const to = (x, y) => page.evaluate(screenPoint, { x, y });
    const dragTo = async (id, target) => {
      const h = await handle(id);
      must(h, `test setup: no ${id} handle`);
      let tipText = null;
      await dragOnCanvas(page, 'mouse', h, { x: target.x - h.x, y: target.y - h.y }, 8, async (i) => {
        if (i === 8) tipText = await page.evaluate(() => document.querySelector('.draw-tip:not([hidden])')?.textContent ?? null);
      });
      return tipText;
    };
    await dragTo('tl', await to(30, 30));
    must(await source() === F.replace('x="20" y="25" width="60" height="50"', 'x="30" y="30" width="50" height="45"'), `the top-left corner to (30, 30):\n${await source()}`);
    must(await undo.getAttribute('aria-label') === 'Undo Resize', 'the resize is not one "Resize" entry');
    await undo.tap();
    must(await source() === F, 'one undo did not restore the rect');
    await dragTo('tl', await to(95, 95));
    must(await source() === F.replace('x="20" y="25" width="60" height="50"', 'x="79" y="74" width="1" height="1"'), `dragged past the bottom-right, not 1 × 1:\n${await source()}`);
    await undo.tap();
    const tipText = await dragTo('br', await to(90, 80));
    must(await source() === F.replace('width="60" height="50"', 'width="70" height="55"'), `the bottom-right to (90, 80):\n${await source()}`);
    must(tipText === '70 × 55', `the tooltip read ${JSON.stringify(tipText)}, not "70 × 55"`);
    await undo.tap();
    // Turned 30°: the corner lands under the pointer.
    const R = F.replace('rx="0"', 'rx="0" transform="rotate(30 50 50)"');
    await openAndSelect(page, R, 'rect');
    const want = await page.evaluate(elementPoint, { sel: 'rect', x: 80, y: 70 }); // clear of every snap target
    await dragTo('br', want);
    must(await source() === R.replace('width="60" height="50"', 'width="60" height="45"'), `the turned rect's corner to its own (80, 70):\n${await source()}`);
    const got = await page.evaluate(elementPoint, { sel: 'rect', x: 80, y: 70 });
    must(Math.hypot(got.x - want.x, got.y - want.y) <= 1, `the turned rect's corner landed at ${JSON.stringify(got)}, not under the pointer ${JSON.stringify(want)}`);
    must((await source()).includes('transform="rotate(30 50 50)"') && (await source()).includes('x="20" y="25"'), 'the turned rect moved its top-left or its transform');
    // A group of two shapes: its corner scales it, by one leading pair.
    const G = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">\n  <g id="g"><rect x="10" y="12" width="20" height="10" fill="#2a9d8f"/><circle cx="36" cy="24" r="4" fill="#e76f51"/></g>\n</svg>\n`;
    must((await page.evaluate((t) => window.drawTest.render(t), G)).ok, 'test setup: the group did not open');
    await showCode(page);
    await page.locator('.cv-block', { hasText: '</g>' }).tap();
    await twoFrames(page);
    const tl0 = await handle('tl');
    const br0 = await handle('br');
    const target = { x: tl0.x + 2 * (br0.x - tl0.x), y: tl0.y + 2 * (br0.y - tl0.y) };
    const gTip = await dragTo('br', target);
    const g1 = await source();
    const pair = /<g id="g" transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)">/.exec(g1);
    must(pair && Number(pair[3]) === 2, `doubling the group did not write a leading translate() scale(2) pair:\n${g1}`);
    const tl1 = await handle('tl');
    must(Math.hypot(tl1.x - tl0.x, tl1.y - tl0.y) <= 0.5, `the group's top-left moved from ${JSON.stringify(tl0)} to ${JSON.stringify(tl1)}`);
    must(gTip === '60 × 32', `the group's tooltip read ${JSON.stringify(gTip)}, not "60 × 32"`);
    const br1 = await handle('br');
    await dragTo('br', { x: tl1.x + 1.5 * (br1.x - tl1.x), y: tl1.y + 1.5 * (br1.y - tl1.y) });
    const g2 = await source();
    must(/<g id="g" transform="translate\([-\d.]+ [-\d.]+\) scale\(3\)">/.test(g2), `a second corner drag did not rewrite the same pair:\n${g2}`);
    const c = await handle('center');
    await dragOnCanvas(page, 'mouse', { x: c.x - 3, y: c.y - 3 }, { x: 0, y: 17 }, 6);
    const g3 = await source();
    must(/<g id="g" transform="translate\([-\d.]+ [-\d.]+\) scale\(3\)">/.test(g3) && g3 !== g2, `a move did not edit the leading translate:\n${g3}`);
    must(await undo.getAttribute('aria-label') === 'Undo Move', 'the move is not one entry');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// lab/transform.svg with its <g> selected from the code: the ring dragged to 180° turns rotate(0)
// into rotate(180) and changes no other byte (the list keeps its three lines); a drag ending at 47°
// writes 45 (magnetic); the diamond doubles scale(1) to scale(2), and stops at 0.2 and 4; the centre
// handle moves translate(50 50) by whole units, the tooltip reading "translate(X Y)"; and a line of
// its local grid passes through the screen point of local (10, 0).
async function rotateAndScaleHandlesEditTheLabHouse(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const T = readFileSync(join(CORPUS, 'lab/transform.svg'), 'utf8');
    must((await page.evaluate((t) => window.drawTest.render(t), T)).ok, 'test setup: lab/transform.svg did not open');
    await showCode(page);
    await page.locator('.cv-block', { hasText: '</g>' }).tap();
    await twoFrames(page);
    const source = () => page.evaluate(() => window.drawTest.source());
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    const handle = async (id) => (await page.evaluate(handlesNow)).find((h) => h.id === id);
    const pivot = await page.evaluate(screenPoint, { x: 50, y: 50 });
    const turnTo = async (deg) => {
      const ring = await handle('rot');
      must(ring, 'test setup: no ring');
      const d = Math.hypot(ring.x - pivot.x, ring.y - pivot.y);
      const a = ((deg - 90) * Math.PI) / 180; // the ring starts straight above the pivot
      await dragOnCanvas(page, 'mouse', ring, { x: pivot.x + d * Math.cos(a) - ring.x, y: pivot.y + d * Math.sin(a) - ring.y }, 8);
    };
    await turnTo(180);
    must(await source() === T.replace('rotate(0)', 'rotate(180)'), `the ring at 180° did not write rotate(180) alone:\n${await source()}`);
    await undo.tap();
    await turnTo(47);
    must(await source() === T.replace('rotate(0)', 'rotate(45)'), `a turn to 47° did not write 45:\n${await source()}`);
    await undo.tap();
    const scaleTo = async (k) => {
      const d = await handle('scale');
      must(d, 'test setup: no diamond');
      await dragOnCanvas(page, 'mouse', d, { x: (k - 1) * (d.x - pivot.x), y: (k - 1) * (d.y - pivot.y) }, 8);
    };
    await scaleTo(2);
    must(await source() === T.replace('scale(1)', 'scale(2)'), `the diamond at twice the distance did not write scale(2):\n${await source()}`);
    await undo.tap();
    await scaleTo(0.05);
    must((await source()).includes('scale(0.2)'), 'the diamond went under 0.2');
    await undo.tap();
    await scaleTo(6);
    must((await source()).includes('scale(4)'), 'the diamond went over 4');
    await undo.tap();
    const c = await handle('center');
    const k = await page.evaluate(() => document.querySelector('.draw-host').shadowRoot.querySelector('svg').getScreenCTM().a);
    let tipText = null;
    await dragOnCanvas(page, 'mouse', c, { x: 12.3 * k, y: -7.8 * k }, 8, async (i) => {
      if (i === 8) tipText = await page.evaluate(() => document.querySelector('.draw-tip:not([hidden])')?.textContent ?? null);
    });
    const m = /translate\((\d+) (\d+)\)/.exec(await source());
    must(m && await source() === T.replace('translate(50 50)', `translate(${m[1]} ${m[2]})`) && m[1] !== '50', `the centre handle did not move translate(50 50) by whole units:\n${await source()}`);
    must(tipText === `translate(${m[1]} ${m[2]})`, `the tooltip read ${JSON.stringify(tipText)}, not "translate(${m[1]} ${m[2]})"`);
    await undo.tap();
    const p = await page.evaluate(elementPoint, { sel: 'g', x: 10, y: 0 });
    const lines = await page.evaluate(() => {
      const o = document.querySelector('.draw-overlay').getBoundingClientRect();
      return [...document.querySelectorAll('.draw-local-grid')].filter((l) => l.style.display !== 'none').map((l) => ['x1', 'y1', 'x2', 'y2'].map((a, i) => Number(l.getAttribute(a)) + (i % 2 ? o.y : o.x)));
    });
    const through = lines.some(([x1, y1, x2, y2]) => Math.abs((x2 - x1) * (y1 - p.y) - (x1 - p.x) * (y2 - y1)) / Math.hypot(x2 - x1, y2 - y1) <= 1);
    must(lines.length > 4 && through, `no local-grid line (of ${lines.length}) passes through local (10, 0) at ${JSON.stringify(p)}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

const SNAP_DOC = `<svg xmlns="${SVG_NS}" viewBox="0 0 80 60">
  <rect id="a" x="8" y="6" width="10" height="10" fill="#2a9d8f"/>
  <circle id="c" cx="62" cy="44" r="5" fill="#e76f51"/>
</svg>
`;

// A vertical guide added at x 40 (the Snap sheet, at the artboard's centre) is kept as
// <draw:state version="1" guides="v 40"/> in a Draw-made <metadata>. A rect dragged so its left
// edge comes within 8 pt of the guide lands on 40, with a snap line; with Guides off it doesn't;
// another shape's centre within 8 pt aligns the centres; with the grid shown at step 10, edges land
// on multiples of 10; the artboard's edge snaps; beyond 8 pt of everything the move is in whole
// units. The guide's pill drags it (tooltip "x = N"), and dragged off the canvas it is removed, and
// with it <draw:state>, the Draw-made <metadata> and xmlns:draw: the file comes back byte for byte.
async function movesSnapToGuidesShapesAndTheGrid(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    must((await page.evaluate((t) => window.drawTest.render(t), SNAP_DOC)).ok, 'test setup: the file did not open');
    await twoFrames(page);
    const source = () => page.evaluate(() => window.drawTest.source());
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    // A drag on the shape itself (its edges and centre snap), never on the centre handle of a
    // selection (only the centre snaps there): nothing is selected before each.
    const drag = async (...args) => {
      const x = page.locator('.draw-ctx-btn[aria-label="Deselect"]');
      if (await x.count()) await x.tap();
      return dragOnCanvas(page, ...args);
    };
    const sheet = async (...labels) => {
      await page.locator('.draw-snap-btn').tap();
      for (const l of labels) await page.locator('.draw-snap .ds-btn', { hasText: l }).first().tap();
      await page.locator('.draw-modal-done').tap();
    };
    await sheet('Add vertical guide');
    const withGuide = SNAP_DOC.replace('viewBox="0 0 80 60">\n', 'viewBox="0 0 80 60" xmlns:draw="https://mmaggitti.github.io/draw/ns">\n  <metadata draw:made="true"><draw:state version="1" guides="v 40"/></metadata>\n');
    must(await source() === withGuide, `the guide is not kept as <draw:state version="1" guides="v 40"/> in a Draw-made <metadata>:\n${await source()}`);
    const k = await page.evaluate(() => document.querySelector('.draw-host').shadowRoot.querySelector('svg').getScreenCTM().a);
    const rectX = () => page.evaluate(() => Number(document.querySelector('.draw-host').shadowRoot.querySelector('#a').getAttribute('x')));
    const rectY = () => page.evaluate(() => Number(document.querySelector('.draw-host').shadowRoot.querySelector('#a').getAttribute('y')));
    // Left edge from 8 to 40 − 5 pt: within 8 pt of the guide (the artboard's centre, also at 40,
    // is off here, so the guide alone takes it).
    await sheet('Artboard');
    const a = await page.evaluate(drawnCentre, '#a');
    let lines = 0;
    await drag('mouse', a, { x: 32 * k - 5, y: 0.2 * k }, 8, async (i) => {
      if (i === 8) lines = await page.evaluate(() => [...document.querySelectorAll('.draw-snap-line')].filter((l) => l.style.display !== 'none').length);
    });
    must(await rectX() === 40, `the rect's left edge landed on ${await rectX()}, not the guide at 40`);
    must(lines >= 1, 'no snap line while snapped');
    await undo.tap();
    await sheet('Guides');
    await drag('mouse', a, { x: 32 * k - 5, y: 0.2 * k }, 8);
    must(await rectX() === 39, `with Guides off the rect went to ${await rectX()}, not 39 (whole units)`);
    await undo.tap();
    await sheet('Guides', 'Artboard');
    // The circle's centre is at y 44: the rect's centre (y 11) dragged to within 8 pt aligns.
    await drag('mouse', a, { x: 5.4 * k, y: 33 * k - 6 }, 8);
    must(await rectY() + 5 === 44, `the rect's centre went to y ${await rectY() + 5}, not the circle's 44`);
    await undo.tap();
    // The grid at step 10: edges on multiples of 10.
    await page.locator('.draw-snap-btn').tap();
    await page.locator('.draw-snap .ds-btn', { hasText: 'Grid shown' }).tap();
    await page.locator('.draw-snap-step input').fill('10');
    await page.locator('.draw-modal-done').tap();
    must((await source()).includes('grid="10"'), 'the grid step is not kept in <draw:state>');
    await drag('mouse', a, { x: 13.3 * k, y: 7.4 * k }, 8);
    must((await rectX()) % 10 === 0 || (await rectX() + 10) % 10 === 0, `on the grid, the rect's x is ${await rectX()}`);
    await undo.tap();
    await page.locator('.draw-snap-btn').tap();
    await page.locator('.draw-snap .ds-btn', { hasText: 'Grid shown' }).tap();
    await page.locator('.draw-snap-step input').fill('');
    await page.locator('.draw-modal-done').tap();
    // The artboard's top edge (y 0): the rect's top edge from 6 to within 8 pt of it.
    await drag('mouse', a, { x: 11.3 * k, y: -6 * k + 4 }, 8);
    must(await rectY() === 0, `the rect's top landed on ${await rectY()}, not the artboard's edge`);
    await undo.tap();
    // Beyond 8 pt of everything: whole units.
    await drag('mouse', a, { x: 11.3 * k, y: 10.3 * k }, 8);
    const [x, y] = [await rectX(), await rectY()];
    must(x === 19 && y === 16, `beyond every target the rect went to (${x}, ${y}), not (19, 16)`);
    await undo.tap();
    // The pill drags the guide in whole units; off the canvas it is removed, and the file is back.
    const pill = await page.evaluate(() => [...document.querySelectorAll('.draw-pill')].filter((p) => p.style.display !== 'none').map((p) => p.getBoundingClientRect().toJSON())[0]);
    const pc = { x: pill.x + pill.width / 2, y: pill.y + pill.height / 2 };
    let tipText = null;
    await dragOnCanvas(page, 'mouse', pc, { x: 5.4 * k, y: 30 }, 8, async (i) => {
      if (i === 8) tipText = await page.evaluate(() => document.querySelector('.draw-tip:not([hidden])')?.textContent ?? null);
    });
    must((await source()).includes('guides="v 45"'), `the pill did not drag the guide to 45:\n${await source()}`);
    must(tipText === 'x = 45', `the pill's tooltip read ${JSON.stringify(tipText)}`);
    const host = await page.locator('.draw-host').boundingBox();
    const p2 = await page.evaluate(() => [...document.querySelectorAll('.draw-pill')].filter((p) => p.style.display !== 'none').map((p) => p.getBoundingClientRect().toJSON())[0]);
    await dragOnCanvas(page, 'mouse', { x: p2.x + p2.width / 2, y: p2.y + p2.height / 2 }, { x: host.x + host.width + 30 - (p2.x + p2.width / 2), y: 0 }, 8);
    must(await source() === SNAP_DOC, `a guide dragged off the canvas did not give the file back:\n${await source()}`);
    must(await undo.getAttribute('aria-label') === 'Undo Remove guide', `the last entry is ${await undo.getAttribute('aria-label')}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// ── S4: structure, Layers and Draw state ───────────────────────────────────────────────────────

const DRAW_NS_URI = 'https://mmaggitti.github.io/draw/ns';

// A More sheet command, by its exact name; the sheet closes on it.
async function moreCommand(page, name) {
  await openMore(page);
  await page.locator('.draw-more .ds-btn', { hasText: new RegExp(`^${name}$`) }).tap();
  await page.locator('.draw-modal').waitFor({ state: 'detached' });
}
// Runs in the page: drawn elements' client boxes, by id.
function drawnBoxes(ids) {
  const root = document.querySelector('.draw-host').shadowRoot;
  return Object.fromEntries(ids.map((id) => [id, root.getElementById(id)?.getBoundingClientRect().toJSON() ?? null]));
}
// Runs in the page: the ids of the drawn elements under a client point, topmost first, as the Stage
// asks (elementsFromPoint, else elementFromPoint).
function hitIds({ x, y }) {
  const root = document.querySelector('.draw-host').shadowRoot;
  const els = typeof root.elementsFromPoint === 'function' ? root.elementsFromPoint(x, y) : [root.elementFromPoint(x, y)];
  return els.filter((el) => el && el.id).map((el) => el.id);
}
const boxNear = (a, b, tol = 0.5) => !!a && !!b && ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) <= tol);
// The ContextBar's label (null when nothing is selected: it shows a hint instead).
const label = (page) => page.locator('.draw-label').textContent({ timeout: 2000 }).catch(() => null);
const toast = (page) => page.locator('.draw-toast').textContent({ timeout: 2000 }).catch(() => null);

const BADGE = `<svg xmlns="${SVG_NS}" xmlns:draw="${DRAW_NS_URI}" viewBox="0 0 100 100">
  <defs><linearGradient id="grad"><stop offset="0" stop-color="#e76f51"/><stop offset="1" stop-color="#264653"/></linearGradient></defs>
  <g id="badge">
    <clipPath id="clip"><circle cx="20" cy="20" r="10"/></clipPath>
    <rect id="face" x="10" y="10" width="20" height="20" clip-path="url(#clip)" style="fill:url(#grad)" draw:locked="true"/>
  </g>
</svg>
`;
const BADGE_COPY = `
  <g id="badge-2" transform="translate(5 5)">
    <clipPath id="clip-2"><circle cx="20" cy="20" r="10"/></clipPath>
    <rect id="face-2" x="10" y="10" width="20" height="20" clip-path="url(#clip-2)" style="fill:url(#grad)"/>
  </g>`;

// Duplicate on a group holding a clip and a locked shape that uses it (and a gradient outside the
// group): the copy follows the original with its leading whitespace, with fresh ids (badge-2,
// clip-2, face-2), its clip-path on its own clip, url(#grad) still on the original gradient, no
// draw:locked, and a translate(5 5); the original keeps every byte. On the canvas the copy is drawn
// 5 units right and down, clipped by its own clip. It is selected, one history entry; one undo gives
// the file back byte for byte.
async function duplicateGetsFreshIdsAndItsOwnReferences(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    must((await page.evaluate((t) => window.drawTest.render(t), BADGE)).ok, 'test setup: the badge did not open');
    await showCode(page);
    await twoFrames(page);
    await page.locator('.cv-block', { hasText: '</g>' }).tap();
    must(await label(page) === '<g#badge>', `test setup: a tap on the group's end tag selected ${await label(page)}`);
    const before = await page.evaluate(drawnBoxes, ['face']);
    const k = await page.evaluate(() => document.querySelector('.draw-host').shadowRoot.querySelector('svg').getScreenCTM().a);
    await moreCommand(page, 'Duplicate');
    const got = await source(page);
    const copy = got.slice(got.indexOf('\n  <g id="badge-2"'), got.lastIndexOf('</g>') + 4);
    must(/id="badge-2"/.test(got) && /id="clip-2"/.test(got) && /id="face-2"/.test(got), `the copy's ids are not fresh (badge-2, clip-2, face-2):\n${got}`);
    must(copy.includes('clip-path="url(#clip-2)"') && copy.includes('style="fill:url(#grad)"'), `the copy's references are not its own clip and the original gradient:\n${copy}`);
    must(!copy.includes('draw:locked'), 'the copy kept draw:locked');
    must(got === BADGE.replace('\n  </g>\n', `\n  </g>${BADGE_COPY}\n`), `the copy is not the original, renamed and moved by translate(5 5), right after it with its whitespace (or the original changed):\n${got}`);
    must(await label(page) === '<g#badge-2>', `the copy is not selected (${await label(page)})`);
    await twoFrames(page);
    const after = await page.evaluate(drawnBoxes, ['face', 'face-2']);
    const want = { ...before.face, x: before.face.x + 5 * k, y: before.face.y + 5 * k };
    must(boxNear(after.face, before.face), `the original moved on the canvas: ${rect(before.face)} → ${after.face && rect(after.face)}`);
    must(boxNear(after['face-2'], want), `the copy is drawn at ${after['face-2'] && rect(after['face-2'])}, not 5 units right and down of the original (${rect(want)})`);
    const own = await page.evaluate(() => {
      const root = document.querySelector('.draw-host').shadowRoot;
      return { ref: root.getElementById('face-2')?.getAttribute('clip-path'), inCopy: !!root.getElementById('clip-2')?.closest('#badge-2') };
    });
    must(own.ref === 'url(#clip-2)' && own.inCopy, `the drawn copy's clip is ${own.ref}, ${own.inCopy ? 'inside' : 'not inside'} the copy`);
    // Clipped: inside its circle it is the topmost hit; at its rect's corner, outside the circle, it isn't there.
    const [inside, corner] = await Promise.all([page.evaluate(screenPoint, { x: 25, y: 25 }), page.evaluate(screenPoint, { x: 34, y: 34 })]);
    const [atInside, atCorner] = [await page.evaluate(hitIds, inside), await page.evaluate(hitIds, corner)];
    must(atInside[0] === 'face-2', `inside its clip the copy is not the topmost hit: ${atInside.join(', ')}`);
    must(!atCorner.includes('face-2'), `the copy is not clipped by its own clip: it is hit at its corner (${atCorner.join(', ')})`);
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    must(await undo.getAttribute('aria-label') === 'Undo Duplicate', `the history's last entry is ${await undo.getAttribute('aria-label')}`);
    await undo.tap();
    must(await source(page) === BADGE, 'one undo did not give the file back byte for byte');
    must(await undo.isDisabled(), 'Duplicate was more than one history entry');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

const THREE_LINES = THREE_RECTS.split('\n').slice(1, 4).map((l) => l.trim());
const GROUPED = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">\n  <g>\n  ${THREE_LINES.join('\n  ')}\n  </g>\n</svg>\n`;
const NESTED = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">
  <g id="G"><rect id="P" x="10" y="10" width="20" height="20" fill="#2a9d8f"/></g>
  <rect id="Q" x="60" y="60" width="20" height="20" fill="#e76f51"/>
</svg>
`;
const TURNED = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">
  <g transform="translate(10 5) rotate(15)">
    <rect id="u1" x="20" y="10" width="30" height="20" fill="#2a9d8f"/>
    <circle id="u2" cx="20" cy="30" r="6" fill="#e76f51" transform="scale(2)"/>
  </g>
</svg>
`;
// A group holding a clip and the rect it clips (the P1-M1 review, F16): the clip is used in the
// rect's user space, so on Ungroup only the rect takes the group's transform.
const CLIPPED_GROUP = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">
  <g transform="translate(30 20)">
    <clipPath id="clip"><circle cx="20" cy="20" r="15"/></clipPath>
    <rect id="cr" x="0" y="0" width="40" height="40" fill="#e76f51" clip-path="url(#clip)"/>
  </g>
</svg>
`;
const CLIPPED_UNGROUPED = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">
    <clipPath id="clip"><circle cx="20" cy="20" r="15"/></clipPath>
    <rect id="cr" x="0" y="0" width="40" height="40" fill="#e76f51" clip-path="url(#clip)" transform="translate(30 20)"/>
  \n</svg>
`;
const UNGROUPED = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">
    <rect id="u1" x="20" y="10" width="30" height="20" fill="#2a9d8f" transform="translate(10 5) rotate(15)"/>
    <circle id="u2" cx="20" cy="30" r="6" fill="#e76f51" transform="translate(10 5) rotate(15) scale(2)"/>
  \n</svg>
`;

// Group: three sibling shapes go into one <g> at the last one's place, in their order, and every
// screen box stays where it was (± 0.5 px); the group is selected; one entry. Select group climbs
// from a shape to its group. Shapes with different parents refuse to group. Ungroup pushes a
// translate(10 5) rotate(15) into each child (before a child's own transform) and every screen box
// stays; one entry. A group holding a clip and the rect it clips (the P1-M1 review, F16): only the
// rect takes the transform, its screen box stays, and the clip still covers the clip's centre and
// not the rect's corner. A group with opacity refuses to ungroup, and says why.
async function groupAndUngroupKeepEveryShapeInPlace(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    const open = async (text) => {
      must((await page.evaluate((t) => window.drawTest.render(t), text)).ok, 'test setup: the file did not open');
      await twoFrames(page);
    };
    const tapOn = async (sel) => {
      const c = await page.evaluate(drawnCentre, sel);
      await page.touchscreen.tap(c.x, c.y);
    };
    await open(THREE_RECTS);
    const three = await page.evaluate(drawnBoxes, ['A', 'B', 'C']);
    await tapOn('#A');
    await moreCommand(page, 'Select all');
    must(await label(page) === '3 selected', `test setup: Select all selected ${await label(page)}`);
    await moreCommand(page, 'Group');
    must(await source(page) === GROUPED, `Group did not put the three in one <g> at the last one's place, in order:\n${await source(page)}`);
    must(await label(page) === '<g>', `the new group is not selected (${await label(page)})`);
    must(await undo.getAttribute('aria-label') === 'Undo Group', `the history's last entry is ${await undo.getAttribute('aria-label')}`);
    await twoFrames(page);
    const grouped = await page.evaluate(drawnBoxes, ['A', 'B', 'C']);
    for (const id of ['A', 'B', 'C']) must(boxNear(grouped[id], three[id]), `grouping moved ${id}: ${rect(three[id])} → ${grouped[id] && rect(grouped[id])}`);
    await page.locator('.draw-ctx-btn[aria-label="Deselect"]').tap();
    await tapOn('#B');
    must(await label(page) === '<rect#B>', `test setup: a tap on B selected ${await label(page)}`);
    await moreCommand(page, 'Select group');
    must(await label(page) === '<g>', `Select group did not climb from B to its group (${await label(page)})`);
    await undo.tap();
    must(await source(page) === THREE_RECTS && await undo.isDisabled(), 'one undo did not take the group back: Group was more than one entry');
    // Different parents: refused.
    await open(NESTED);
    await tapOn('#P');
    await page.locator('.draw-ctx-btn[aria-label="Select more"]').tap();
    await tapOn('#Q');
    must(await label(page) === '2 selected', `test setup: P and Q are not both selected (${await label(page)})`);
    await moreCommand(page, 'Group');
    must(await toast(page) === 'Group needs shapes with the same parent.', `shapes with different parents grouped, or said ${JSON.stringify(await toast(page))}`);
    must(await source(page) === NESTED && await undo.isDisabled(), 'a refused Group changed the file or the history');
    // Ungroup: the group's transform pushed down to each child; every screen box stays.
    await open(TURNED);
    const turned = await page.evaluate(drawnBoxes, ['u1', 'u2']);
    await tapOn('#u1');
    await moreCommand(page, 'Select group');
    must(await label(page) === '<g>', `test setup: Select group from u1 selected ${await label(page)}`);
    await moreCommand(page, 'Ungroup');
    must(await source(page) === UNGROUPED, `Ungroup did not push translate(10 5) rotate(15) into each child, keeping their bytes:\n${await source(page)}`);
    must(await label(page) === '2 selected', `the former children are not selected (${await label(page)})`);
    must(await undo.getAttribute('aria-label') === 'Undo Ungroup', `the history's last entry is ${await undo.getAttribute('aria-label')}`);
    await twoFrames(page);
    const flat = await page.evaluate(drawnBoxes, ['u1', 'u2']);
    for (const id of ['u1', 'u2']) must(boxNear(flat[id], turned[id]), `ungrouping moved ${id}: ${rect(turned[id])} → ${flat[id] && rect(flat[id])}`);
    await undo.tap();
    must(await source(page) === TURNED && await undo.isDisabled(), 'one undo did not give the group back: Ungroup was more than one entry');
    // A clip and its user: the drawing doesn't change.
    await open(CLIPPED_GROUP);
    const at = (x, y) => page.evaluate(([ux, uy]) => {
      const p = new DOMPoint(ux, uy).matrixTransform(document.querySelector('.draw-host').shadowRoot.querySelector('svg').getScreenCTM());
      return { x: p.x, y: p.y };
    }, [x, y]);
    const clipHits = async () => ({ centre: (await page.evaluate(hitIds, await at(50, 40))).includes('cr'), corner: (await page.evaluate(hitIds, await at(32, 22))).includes('cr') });
    const clippedBox = (await page.evaluate(drawnBoxes, ['cr'])).cr;
    const before = await clipHits();
    must(before.centre && !before.corner, `test setup: the clip covers its centre ${before.centre}, the rect's corner ${before.corner}`);
    await page.touchscreen.tap((await at(50, 40)).x, (await at(50, 40)).y);
    await moreCommand(page, 'Select group');
    must(await label(page) === '<g>', `test setup: Select group from the clipped rect selected ${await label(page)}`);
    await moreCommand(page, 'Ungroup');
    must(await source(page) === CLIPPED_UNGROUPED, `Ungroup gave the clip the group's transform, or changed more than the rect:\n${await source(page)}`);
    await twoFrames(page);
    must(boxNear((await page.evaluate(drawnBoxes, ['cr'])).cr, clippedBox), 'ungrouping moved the clipped rect');
    const after = await clipHits();
    must(after.centre && !after.corner, `after Ungroup the clip covers its centre ${after.centre}, the rect's corner ${after.corner}: the clip moved`);
    await undo.tap();
    must(await source(page) === CLIPPED_GROUP, 'one undo did not give the clipped group back');
    // A group with opacity: refused, with the reason.
    const FADED = TURNED.replace('<g transform', '<g opacity="0.5" transform');
    await open(FADED);
    await tapOn('#u1');
    await moreCommand(page, 'Select group');
    await moreCommand(page, 'Ungroup');
    must(await toast(page) === 'It has opacity, which applies to the group as a whole; ungrouping would change how it looks.', `a group with opacity ungrouped, or said ${JSON.stringify(await toast(page))}`);
    must(await source(page) === FADED && await undo.isDisabled(), 'a refused Ungroup changed the file or the history');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

const LAYERS = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">
  <defs>
    <radialGradient id="c"><stop offset="0" stop-color="#ffd166"/><stop offset="1" stop-color="#e76f51"/></radialGradient>
    <radialGradient id="glow" href="#c" r="0.3"/>
  </defs>
  <rect id="sky" x="10" y="10" width="50" height="50" fill="#264653"/>
  <circle id="disc" cx="35" cy="35" r="12" fill="url(#c)">
  </circle>
  <rect id="spot" x="70" y="70" width="15" height="15" fill="url(#glow)"/>
</svg>
`;
const LAYER_ROWS = ['#spot', '#disc', '#sky', '<defs>', '#glow', '#c', '<stop>', '<stop>'];

// The Layers tab lists every element topmost first; a row tap selects it (the canvas and the code
// follow). Hide writes exactly display="none" and the shape stops drawing (a tap there takes the
// shape under it); Show gives the file back byte for byte. Lock writes draw:locked="true" and the
// root's xmlns:draw: a tap on the locked shape takes the one beneath, a marquee around it leaves it
// out, a drag from it draws a marquee (the shape beneath stays), and moving it after selecting it
// from its code is refused with the reason; Unlock gives the file back, and the same marquee then
// takes it. Rename c → sun rewrites url(#c) and href="#c". Rows and buttons are at least 44 pt; no
// sideways scroll.
async function layersHideAndLockShapes(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    const entry = () => undo.getAttribute('aria-label');
    const tab = async (name) => {
      await page.locator('.draw-tabs button', { hasText: name }).tap();
      if (name === 'Layers') await page.locator('.draw-layer').first().waitFor();
      await twoFrames(page);
    };
    const deselect = async () => {
      const x = page.locator('.draw-ctx-btn[aria-label="Deselect"]');
      if (await x.count()) await x.tap();
    };
    must((await page.evaluate((t) => window.drawTest.render(t), LAYERS)).ok, 'test setup: the file did not open');
    await tab('Layers');
    const names = await page.locator('.draw-layer-name').allTextContents();
    must(JSON.stringify(names) === JSON.stringify(LAYER_ROWS), `the tree is ${JSON.stringify(names)}, not every element topmost first ${JSON.stringify(LAYER_ROWS)}`);
    await page.locator('.draw-layer-name', { hasText: /^#disc$/ }).tap();
    must(await label(page) === '<circle#disc>', `a tap on the #disc row selected ${await label(page)}`);
    must(await page.evaluate(() => [...document.querySelectorAll('.cv-block.cv-selected')].some((b) => b.textContent.includes('id="disc"'))), "the code doesn't mark the row's element");
    must((await page.evaluate(handlesNow)).length > 0, "the overlay shows no handles for the row's element");
    const discAt = await page.evaluate(screenPoint, { x: 35, y: 35 });
    // Hide and Show.
    await page.locator('[aria-label="Hide #disc"]').tap();
    const HIDDEN = LAYERS.replace('fill="url(#c)">', 'fill="url(#c)" display="none">');
    must(await source(page) === HIDDEN, `Hide did not write exactly display="none":\n${await source(page)}`);
    must(await entry() === 'Undo Hide', `the history's last entry is ${await entry()}`);
    await deselect();
    await page.touchscreen.tap(discAt.x, discAt.y);
    must(await label(page) === '<rect#sky>', `a tap where the hidden disc was took ${await label(page)}, not the sky under it`);
    await page.locator('[aria-label="Show #disc"]').tap();
    must(await source(page) === LAYERS, 'Show did not give the file back byte for byte');
    // Lock.
    await page.locator('[aria-label="Lock #disc"]').tap();
    const LOCKED_FILE = LAYERS.replace('viewBox="0 0 100 100">', `viewBox="0 0 100 100" xmlns:draw="${DRAW_NS_URI}">`).replace('fill="url(#c)">', 'fill="url(#c)" draw:locked="true">');
    must(await source(page) === LOCKED_FILE, `Lock did not write draw:locked="true" and the root's xmlns:draw:\n${await source(page)}`);
    must(await entry() === 'Undo Lock', `the history's last entry is ${await entry()}`);
    await deselect();
    await page.touchscreen.tap(discAt.x, discAt.y);
    must(await label(page) === '<rect#sky>', `a tap on the locked disc took ${await label(page)}, not the sky under it`);
    // A marquee from empty canvas (right of the sky) around the disc: nothing taken.
    const marquee = async (from, to) => {
      await deselect();
      const [a, b] = await Promise.all([page.evaluate(screenPoint, from), page.evaluate(screenPoint, to)]);
      let drawn = false;
      await dragOnCanvas(page, 'mouse', a, { x: b.x - a.x, y: b.y - a.y }, 8, async (i) => {
        if (i === 8) drawn = await page.evaluate(() => [...document.querySelectorAll('.draw-marquee')].some((m) => m.style.display !== 'none'));
      });
      return drawn;
    };
    must(await marquee({ x: 65, y: 50 }, { x: 20, y: 20 }), 'test setup: no marquee from empty canvas');
    const took = await page.locator('.draw-sel').textContent();
    must(took === 'nothing selected', `a marquee around the locked disc took ${took}`);
    must(await marquee({ x: 35, y: 35 }, { x: 55, y: 58 }), 'a drag from the locked disc drew no marquee');
    must(await source(page) === LOCKED_FILE, 'a drag from the locked disc moved something');
    // Selected from its code, it can't be moved.
    await tab('Code');
    await page.locator('.cv-block', { hasText: '</circle>' }).tap();
    must(await label(page) === '<circle#disc>', `test setup: a tap on the disc's end tag selected ${await label(page)}`);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ArrowRight');
    must(await toast(page) === 'It’s locked. Unlock it in Layers first.', `moving the locked disc said ${JSON.stringify(await toast(page))}`);
    must(await source(page) === LOCKED_FILE, 'the locked disc moved');
    await tab('Layers');
    await page.locator('[aria-label="Unlock #disc"]').tap();
    must(await source(page) === LAYERS, 'Unlock did not give the file back byte for byte');
    await marquee({ x: 65, y: 50 }, { x: 20, y: 20 });
    must(await label(page) === '<circle#disc>', `unlocked, the same marquee took ${await label(page)}, not the disc`);
    // Rename c → sun: every reference follows.
    await page.locator('[aria-label="Rename #c"]').tap();
    const field = page.locator('.draw-modal input[aria-label="New id"]');
    await field.fill('sun');
    await page.locator('.draw-rename-go').tap();
    await page.locator('.draw-modal').waitFor({ state: 'detached' });
    must(await source(page) === LAYERS.replace('id="c"', 'id="sun"').replace('href="#c"', 'href="#sun"').replace('url(#c)', 'url(#sun)'), `Rename c → sun left a reference behind, or changed more:\n${await source(page)}`);
    must(await entry() === 'Undo Rename', `the history's last entry is ${await entry()}`);
    // The phone rules on the tab.
    const r = await page.evaluate((min) => {
      const small = [...document.querySelectorAll('.draw-layer, .draw-layer-name, .draw-layer-btn')].map((el) => ({ el, b: el.getBoundingClientRect() })).filter(({ el, b }) => b.height < min - 0.5 || (el.tagName === 'BUTTON' && b.width < min - 0.5)).map(({ el, b }) => `${el.className} ${el.getAttribute('aria-label') ?? el.textContent} ${Math.round(b.width)}×${Math.round(b.height)}`);
      const de = document.documentElement;
      return { small, rows: document.querySelectorAll('.draw-layer').length, sideways: de.scrollWidth - de.clientWidth };
    }, TAP_MIN);
    must(r.rows === LAYER_ROWS.length && r.small.length === 0, `Layers rows or buttons under ${TAP_MIN} pt: ${r.small.join(', ')}`);
    must(r.sideways <= 0, `the Layers tab scrolls sideways by ${r.sideways}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

// Draw's own state stays out of As-is, Copy and Clean: after a guide and a lock, Save to Files holds
// <draw:state, draw:locked and xmlns:draw; the As-is export's bytes and the Copy text hold no draw:
// at all and are the file as opened; Clean holds no Draw namespace and no Draw-made <metadata>, and
// is the Clean export of the file as opened. The working copy re-opens with its guide and its lock,
// and its import report counts draw:state as kept, not unclassified.
async function drawStateStaysOutOfAsIsAndClean(browser, origin) {
  await withPage(browser, origin, 956, async (page, errors) => {
    await page.evaluate(() => {
      navigator.canShare = undefined;
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => void window.__copied.push(t) } });
    });
    const exportAs = async (kind) => {
      await page.locator('.draw-export').tap();
      const go = page.locator(`.draw-export-go[data-kind="${kind}"]`);
      await go.waitFor();
      const [download] = await Promise.all([page.waitForEvent('download'), go.tap()]);
      const bytes = readFileSync(await download.path());
      await page.locator('.draw-modal').waitFor({ state: 'detached' });
      return bytes.toString('utf8');
    };
    await pickFile(page, 'state.svg', Buffer.from(SNAP_DOC));
    await closeModal(page);
    await page.locator('.draw-snap-btn').tap();
    await page.locator('.draw-snap .ds-btn', { hasText: 'Add vertical guide' }).tap();
    await page.locator('.draw-modal-done').tap();
    await page.locator('.draw-handle').tap();
    await page.locator('.draw-tabs button', { hasText: 'Layers' }).tap();
    await page.locator('[aria-label="Lock #a"]').tap();
    const edited = await source(page);
    must(edited.includes('guides="v 40"') && edited.includes('draw:locked="true"'), `test setup: the guide or the lock is missing:\n${edited}`);
    const working = await exportAs('working');
    must(working === edited, 'Save to Files is not the working copy');
    must(working.includes('<draw:state') && working.includes('draw:locked="true"') && working.includes(`xmlns:draw="${DRAW_NS_URI}"`), `Save to Files lacks <draw:state, draw:locked or xmlns:draw:\n${working}`);
    const asIs = await exportAs('as-is');
    must(!asIs.includes('draw:'), `the As-is export holds draw::\n${asIs}`);
    must(asIs === SNAP_DOC, `the As-is export is not the file as opened:\n${asIs}`);
    await page.locator('.draw-tabs button', { hasText: 'Code' }).tap();
    await page.locator('.draw-copy').tap();
    const copied = await until('Copy writes the clipboard', () => page.evaluate(() => window.__copied[0] ?? null));
    must(!copied.includes('draw:') && copied === SNAP_DOC, `Copy holds Draw state, or isn't the file as opened:\n${copied}`);
    const clean = await exportAs('clean');
    must(!clean.includes(DRAW_NS_URI) && !clean.includes('draw:') && !/<metadata\b/.test(clean), `Clean holds the Draw namespace or a Draw-made <metadata>:\n${clean}`);
    const opened = parseDoc(SNAP_DOC);
    must(opened.ok && clean === cleanExport(opened.doc).text, `Clean is not the clean export of the file as opened:\n${clean}`);
    // The working copy opens again with its guide and its lock; its report keeps draw:state.
    await pickFile(page, 'state-working.svg', Buffer.from(working));
    const kept = await page.locator('.draw-group[data-bucket="kept"] .draw-item').allTextContents();
    must(kept.some((t) => t.startsWith('<draw:state>')) && kept.some((t) => t.startsWith('draw:locked')), `the import report doesn't list draw:state and draw:locked as kept: ${kept.join(', ')}`);
    must((await bucketCounts(page)).unclassified === 0, `the import report counts Draw state as unclassified: ${JSON.stringify(await bucketCounts(page))}`);
    await closeModal(page);
    must(await source(page) === working, 'the working copy did not open as saved');
    const pills = await page.evaluate(() => [...document.querySelectorAll('.draw-pill')].filter((p) => p.style.display !== 'none').length);
    must(pills === 1, `the working copy opened with ${pills} guide(s), not its one`);
    await page.locator('.draw-tabs button', { hasText: 'Layers' }).tap();
    must(await page.locator('[aria-label="Unlock #a"]').count() === 1, 'the working copy opened without its lock');
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  });
}

const MOVING = `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">
  <rect id="A" x="10" y="10" width="15" height="15" fill="#e76f51"><animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite"/></rect>
  <rect id="B" x="40" y="10" width="15" height="15" fill="#2a9d8f"/>
  <rect id="C" x="70" y="70" width="15" height="15" fill="#264653"/>
</svg>
`;
const BAR_ORDER = ['Deselect', 'Select more', 'Bring forward', 'Send back', 'Delete', 'More'];
const HANDLE_ENTRY = { tl: 'Resize', tr: 'Resize', br: 'Resize', bl: 'Resize', center: 'Move', rot: 'Rotate', scale: 'Scale' };

// The phone rules on the selection tools (under reduced motion, so an animated drawing shows Play):
// with one and with three shapes selected, the ContextBar is 48 pt high, its label on one line, and
// its six buttons at least 44 × 44 in order; the More sheet, the Snap sheet and the Layers tab keep
// every control at least 44 pt and fields at least 16 px, with no sideways or page scroll; Grid and
// Snap stay clear of Play; and a press 22 pt from each handle takes that handle.
async function phoneRulesOnTheSelectionTools(browser, origin, height) {
  await withPage(browser, origin, height, async (page, errors) => {
    const problems = [];
    const rules = async (state) => {
      const r = await page.evaluate(rulesNow, TAP_MIN);
      if (r.small.length) problems.push(`${state}: tap targets under ${TAP_MIN}pt: ${r.small.join(', ')}`);
      if (r.fields.length) problems.push(`${state}: field(s) under 16px: ${r.fields.join(', ')}`);
      if (r.sw > r.cw) problems.push(`${state}: scrolls sideways (${r.sw} > ${r.cw})`);
      if (r.sh > r.ch) problems.push(`${state}: the page scrolls (${r.sh} > ${r.ch})`);
    };
    const bar = async (state) => {
      const b = await page.evaluate(() => {
        const ctx = document.querySelector('.draw-context');
        const l = ctx.querySelector('.draw-label');
        return {
          h: ctx.getBoundingClientRect().height,
          buttons: [...ctx.querySelectorAll('.draw-ctx-btn')].map((el) => ({ name: el.getAttribute('aria-label'), ...el.getBoundingClientRect().toJSON() })),
          label: l && { text: l.textContent, h: l.getBoundingClientRect().height, font: parseFloat(getComputedStyle(l).fontSize) },
        };
      });
      const names = b.buttons.map((x) => x.name);
      if (JSON.stringify(names) !== JSON.stringify(BAR_ORDER)) problems.push(`${state}: the ContextBar's buttons are ${JSON.stringify(names)}, not ${JSON.stringify(BAR_ORDER)}`);
      for (const x of b.buttons) if (x.width < TAP_MIN - 0.5 || x.height < TAP_MIN - 0.5) problems.push(`${state}: ${x.name} is ${Math.round(x.width)}×${Math.round(x.height)}`);
      if (b.buttons.some((x, i) => i > 0 && x.left < b.buttons[i - 1].right - 0.5)) problems.push(`${state}: the ContextBar's buttons overlap or are out of order`);
      if (!b.label || b.label.h >= 2 * b.label.font) problems.push(`${state}: the label ${JSON.stringify(b.label?.text)} is not on one line`);
      if (Math.abs(b.h - 48) > 0.5) problems.push(`${state}: the ContextBar is ${b.h} high, not 48`);
    };
    must((await page.evaluate((t) => window.drawTest.render(t), MOVING)).ok, 'test setup: the file did not open');
    await twoFrames(page);
    const chrome = await page.evaluate(() => Object.fromEntries(['grid', 'snap', 'play'].map((k) => [k, document.querySelector(`.draw-${k}-btn`)?.getBoundingClientRect().toJSON() ?? null])));
    must(chrome.play, 'test setup: the animated drawing offers no Play under reduced motion');
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const [x, y] of [['grid', 'play'], ['snap', 'play'], ['grid', 'snap']]) if (overlap(chrome[x], chrome[y])) problems.push(`${x} ${rect(chrome[x])} overlaps ${y} ${rect(chrome[y])}`);
    // One selected: the bar, and a press 22 pt from each handle takes it.
    const c = await page.evaluate(drawnCentre, '#C');
    await page.touchscreen.tap(c.x, c.y);
    must(await label(page) === '<rect#C>', `test setup: a tap on C selected ${await label(page)}`);
    await bar('one selected');
    const undo = page.locator('.draw-tool', { hasText: 'Undo' });
    const hs = await page.evaluate(handlesNow);
    must(['tl', 'tr', 'br', 'bl', 'center', 'rot'].every((id) => hs.some((h) => h.id === id)), `test setup: C's handles are ${hs.map((h) => h.id)}`);
    for (const h of hs) {
      let best = null;
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8;
        const p = { x: h.x + 22 * Math.cos(a), y: h.y + 22 * Math.sin(a) };
        const clear = Math.min(...hs.filter((o) => o !== h).map((o) => Math.hypot(o.x - p.x, o.y - p.y)));
        if (!best || clear > best.clear) best = { p, a, clear };
      }
      must(best.clear > 23, `test setup: no point 22 pt from the ${h.id} handle is nearer it than any other`);
      await dragOnCanvas(page, 'mouse', best.p, { x: 30 * Math.cos(best.a), y: 30 * Math.sin(best.a) }, 6);
      const got = await undo.getAttribute('aria-label');
      if (got !== `Undo ${HANDLE_ENTRY[h.id]}`) problems.push(`a press 22 pt from the ${h.id} handle made ${got ?? 'no entry'}, not ${HANDLE_ENTRY[h.id]}`);
      if (!(await undo.isDisabled())) await undo.tap();
      if (await label(page) !== '<rect#C>') await page.touchscreen.tap(c.x, c.y);
    }
    must(await source(page) === MOVING, 'test setup: the handle presses were not all undone');
    // Three selected.
    await moreCommand(page, 'Select all');
    must(await label(page) === '3 selected', `test setup: Select all selected ${await label(page)}`);
    await bar('three selected');
    await openMore(page);
    await rules('the More sheet');
    await closeModal(page);
    await page.locator('.draw-snap-btn').tap();
    await page.locator('.draw-snap-step input').waitFor();
    await rules('the Snap sheet');
    await closeModal(page);
    await page.locator('.draw-handle').tap();
    await page.locator('.draw-tabs button', { hasText: 'Layers' }).tap();
    await page.locator('.draw-layer').first().waitFor();
    await rules('the Layers tab at half');
    await page.locator('.draw-handle').tap();
    await rules('the Layers tab at full');
    must(problems.length === 0, `440×${height}:\n${problems.join('\n')}`);
    must(errors.length === 0, `errors:\n${errors.join('\n')}`);
  }, { reducedMotion: 'reduce' });
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
