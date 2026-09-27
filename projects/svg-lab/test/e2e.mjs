// SVG Lab end-to-end test, run by scripts/smoke-test.mjs against the built site (Chromium in the
// cloud container, WebKit in CI). Throws on the first failure.
//
// What it guards: the site rules the lab was adapted to (0.75 scale, 44pt tap floor, 16px fields,
// no sideways scroll, reduced motion, no third-party requests), and the pasted-SVG sanitizer.
// Every origin-wide rule matters more here than elsewhere: all projects share one origin, so
// script from a pasted file would reach every project's storage.

const PHONE = { viewport: { width: 440, height: 956 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const TAP_MIN = 44;
const SETS = [
  ['Vector', 'Grid', 'Shapes', 'Style', 'Paths', 'Transform', 'Animate', 'Charts', 'Create'],
  ['Arcs', 'Reuse', 'Paint', 'Clip', 'Markers', 'Type', 'CSS', 'Create'],
  ['Motion', 'Timing', 'Spinner', 'Links', 'Create'],
  ['Shadow', 'Color', 'Texture', 'Light', 'Create'],
  ['Size', 'Access', 'Images', 'Media', 'Switch', 'Create'],
];

export default async function run({ browser, origin }) {
  await loadAndWalk(browser, origin);
  await sheetsAndFields(browser, origin);
  await tooltipStaysOnScreen(browser, origin);
  await pastedMarkupIsInert(browser, origin);
  await plantedStorageIsInert(browser, origin);
  await pastedColorsStayColors(browser, origin);
  await exportIsClean(browser, origin);
  await lessonMarkupSurvives(browser, origin);
  await reducedMotion(browser, origin);
}

// 1. Load: fonts from this origin, the site scale, no third-party requests. Then every lab screen:
// no errors, no sideways scroll, every control at least 44pt.
async function loadAndWalk(browser, origin) {
  await withPage(browser, origin, {}, async (page, errors, external) => {
    // fonts.load() starts the load if layout hasn't yet, so this doesn't race the first paint.
    for (const font of ['800 16px Archivo', '400 16px "IBM Plex Mono"']) {
      const ok = await page.evaluate((f) => document.fonts.load(f).then((faces) => faces.length > 0 && faces.every((x) => x.status === 'loaded'), () => false), font);
      must(ok, `font ${font} did not load from this origin`);
    }
    const root = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    must(root === '12px', `root font size is ${root}, not the site's 0.75 scale (12px)`);

    const labs = new Set();
    let modes = 0;
    for (const [s, tabs] of SETS.entries()) {
      for (const tab of tabs) {
        await openLab(page, s, tab);
        labs.add(await page.evaluate(() => document.body.dataset.lab));
        await noSidewaysScroll(page, `set ${s + 1} ${tab}`);
        await tapFloor(page, `set ${s + 1} ${tab}`);
        // Controls that only appear in a lab's other modes (e.g. Arcs → Smooth shows S and T).
        const n = await page.locator('#controls [data-m]').count();
        for (let i = 0; i < n; i++) {
          const chip = page.locator('#controls [data-m]').nth(i);
          const label = (await chip.innerText()).trim();
          await chip.tap();
          await page.waitForTimeout(250);
          modes++;
          await noSidewaysScroll(page, `${tab} mode ${label}`);
          await tapFloor(page, `${tab} mode ${label}`);
        }
      }
    }
    must(labs.size === 29, `reached ${labs.size} distinct labs, expected 29 (28 lessons + Create)`);
    must(modes > 40, `test setup: only ${modes} mode states walked`);
    must(external.size === 0, `third-party requests: ${[...external].join(', ')}`);
    must(errors.length === 0, `errors on the page:\n${errors.join('\n')}`);
  });
}

// 2. The sheets: controls at least 44pt, and fields at 16px or more so iOS doesn't zoom on focus.
async function sheetsAndFields(browser, origin) {
  await withPage(browser, origin, {}, async (page, errors) => {
    await openLab(page, 0, 'Grid');
    await page.locator('pre.src .tk.num').first().tap();
    await sheetOpen(page);
    await tapFloor(page, 'number sheet');
    await fieldFloor(page, '.stepper input', 'number sheet');
    await closeSheet(page);

    await openLab(page, 0, 'Style');
    await page.locator('pre.src .tk.col').first().tap();
    await sheetOpen(page);
    await tapFloor(page, 'color sheet');
    await closeSheet(page);

    await openLab(page, 0, 'Create');
    await page.locator('#controls [data-name]').tap();
    await sheetOpen(page);
    await fieldFloor(page, '.sh-text input', 'text sheet');
    await tapFloor(page, 'text sheet');
    await closeSheet(page);

    await page.locator('#btnEdit').tap();
    await sheetOpen(page);
    await fieldFloor(page, '.sh-area textarea', 'code sheet');
    await tapFloor(page, 'code sheet');
    await page.locator('#sheet [data-x="cancel"]').tap();
    must(errors.length === 0, `errors on the page:\n${errors.join('\n')}`);
  });
}

// 3. Dragging a handle to the screen edge: the tooltip stays on screen, and the page doesn't scroll
// sideways after release (it used to: the tip was centered on the finger with no clamp).
async function tooltipStaysOnScreen(browser, origin) {
  await withPage(browser, origin, {}, async (page) => {
    await openLab(page, 0, 'Grid');
    const hd = await page.locator('#gHnd .hd').first().boundingBox();
    must(hd, 'no handle on the Grid lab');
    const y = hd.y + hd.height / 2;
    await page.mouse.move(hd.x + hd.width / 2, y);
    await page.mouse.down();
    for (let x = hd.x; x <= 436; x += 20) await page.mouse.move(x, y);
    await page.mouse.move(436, y);
    const tip = await page.evaluate(() => {
      const r = document.getElementById('tip').getBoundingClientRect();
      return { on: document.getElementById('tip').classList.contains('on'), left: r.left, right: r.right, cw: document.documentElement.clientWidth };
    });
    must(tip.on, 'test setup: the drag did not show the tooltip');
    must(tip.left >= 0 && tip.right <= tip.cw, `tooltip off screen during the drag: ${tip.left.toFixed(0)}–${tip.right.toFixed(0)} of ${tip.cw}`);
    await page.mouse.up();
    await noSidewaysScroll(page, 'after dragging a handle to the right edge');
  });
}

// 4. Paste attacks into Create → Edit → Apply. Each of these ran script in the original file
// (reproduced in a real browser), or would have. None may run, before or after a reload.
const PAYLOADS = {
  'comment breakout': `<svg xmlns="http://www.w3.org/2000/svg"><g><!--> <img src=x onerror="window.__pwn='comment'"> --><circle cx="50" cy="50" r="10"/></g></svg>`,
  'processing-instruction breakout': `<svg xmlns="http://www.w3.org/2000/svg"><g><?x </g><img src=x onerror="window.__pwn='pi'">?><circle cx="50" cy="50" r="10"/></g></svg>`,
  'CDATA breakout': `<svg xmlns="http://www.w3.org/2000/svg"><g><p/><style><![CDATA[</style><img src=x onerror="window.__pwn='cdata'">]]></style><circle cx="50" cy="50" r="10"/></g></svg>`,
  'tab-split javascript: link': `<svg xmlns="http://www.w3.org/2000/svg"><a href="java&#x09;script:void(window.__pwn='tab')"><rect width="60" height="60" fill="#e76f51"/></a></svg>`,
  'SMIL href retarget': `<svg xmlns="http://www.w3.org/2000/svg"><a href="#ok"><set attributeName="href" to="javascript:void(window.__pwn='smil')" begin="0s"/><rect width="60" height="60"/></a></svg>`,
  'document-wide style': `<svg xmlns="http://www.w3.org/2000/svg"><g><style>body{visibility:hidden}</style><circle cx="50" cy="50" r="20"/></g></svg>`,
  'lab id takeover': `<svg xmlns="http://www.w3.org/2000/svg"><g id="ctx"><circle cx="50" cy="50" r="20"/></g><g id="controls"/></svg>`,
};

async function pastedMarkupIsInert(browser, origin) {
  for (const [name, code] of Object.entries(PAYLOADS)) {
    await withPage(browser, origin, {}, async (page) => {
      await openLab(page, 0, 'Create');
      await pasteCode(page, code);
      await inert(page, name);
      await page.reload({ waitUntil: 'networkidle' });
      await openLab(page, 0, 'Create');
      await landed(page, `${name}, after a reload`);
      await inert(page, `${name}, after a reload`);
    });
  }
}

// 5. Markup planted straight into storage (as a same-origin page could) skips the paste-time
// clean-up entirely; the render-time layer alone must hold.
async function plantedStorageIsInert(browser, origin) {
  const planted = [
    { t: 'raw', markup: `<g><!--> <img src=x onerror="window.__pwn='planted-comment'"> --></g>` },
    { t: 'raw', markup: `<g><img src="x" onerror="window.__pwn='planted-img'"/></g>` },
    { t: 'raw', markup: `<a href="javascript:void(window.__pwn='planted-link')"><rect width="50" height="50"/></a>` },
    { t: 'raw', markup: `<g><style>body{visibility:hidden}</style></g>` },
    // DOMPurify alone lets these through; the lab's own render-time rules must stop them
    { t: 'raw', markup: `<g id="ctx"><circle r="5"/></g>` },
    { t: 'raw', markup: `<g id="controls"/>` },
    { t: 'raw', markup: `<g><set attributeName="onclick" to="window.__pwn='planted-onset'"/><rect width="9" height="9"/></g>` },
    { t: 'raw', markup: `<image href="data:text/html,x" width="9" height="9"/>` },
  ];
  await withPage(browser, origin, { init: planted }, async (page) => {
    await openLab(page, 0, 'Create');
    await landed(page, 'the planted document', planted.length);
    await inert(page, 'markup planted in storage');
  });
  // A modeled item (not raw) whose stored coordinate is markup: selecting it draws guide arms.
  const path = [{ t: 'path', pts: [{ x: 10, y: 80 }, { x: 90, y: 80 }], segs: [{ t: 'Q', a: { x: `"/><img src=x onerror="window.__pwn='arms'">`, y: 20 } }], closed: false, fill: 'none', stroke: '#264653', sw: 4 }];
  await withPage(browser, origin, { init: path }, async (page) => {
    await openLab(page, 0, 'Create');
    await page.locator('pre.src .blk[data-i="0"]').first().tap();
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ pwn: window.__pwn ?? null, img: document.querySelectorAll('#gGuide img, #gHnd img').length }));
    must(r.pwn === null && r.img === 0, `a planted path coordinate reached the guides as markup (${JSON.stringify(r)})`);
  });
}

// 5b. A pasted color is only ever a color: it lands in style="--c:…" in the code view and the
// Create toolbar, where extra declarations would overlay the page and fetch from a third party.
async function pastedColorsStayColors(browser, origin) {
  const fills = [
    `<svg xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="50" height="50" fill="red;position:fixed;inset:0;z-index:2147483647;background:url(https://evil.example/overlay.png) red"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="gloss-0" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="url(https://evil.example/stop.png)"/></radialGradient></defs><rect x="10" y="10" width="50" height="50" fill="url(#gloss-0)"/></svg>`,
  ];
  for (const [i, code] of fills.entries()) {
    await withPage(browser, origin, {}, async (page, errors, external) => {
      await openLab(page, 0, 'Create');
      await pasteCode(page, code);
      for (const when of ['', ', after a reload']) {
        if (when) { await page.reload({ waitUntil: 'networkidle' }); await openLab(page, 0, 'Create'); }
        await page.locator('pre.src .blk[data-i="0"]').first().tap(); // select it: the toolbar shows its colors
        await page.waitForTimeout(300);
        // From the top: selecting scrolls the page, and the sticky artboard then covers the button
        // legitimately. A fixed overlay would cover it at any scroll position.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(100);
        const r = await page.evaluate(() => {
          const fixed = [...document.querySelectorAll('pre.src *, #ctx *')].filter((e) => getComputedStyle(e).position === 'fixed').length;
          const b = document.getElementById('btnEdit').getBoundingClientRect();
          const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
          return { fixed, editReachable: !!hit && hit.closest('#btnEdit') !== null };
        });
        must(r.fixed === 0, `color ${i + 1}${when}: pasted CSS made ${r.fixed} element(s) position:fixed`);
        must(r.editReachable, `color ${i + 1}${when}: something covers the Edit button`);
      }
      must(external.size === 0, `color ${i + 1}: third-party requests: ${[...external].join(', ')}`);
    });
  }
}

// 5c. What the lab saves and exports is clean too, not just what it draws: a javascript: link
// hidden behind any namespace prefix bound to xlink, and XHTML elements, are dropped at paste.
async function exportIsClean(browser, origin) {
  const code = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:q="http://www.w3.org/1999/xlink" xmlns:h="http://www.w3.org/1999/xhtml"><a q:href="javascript:void(window.__pwn='prefixed')"><rect width="50" height="50"/></a><g><h:img src="x"/></g><use q:href="#keep"/></svg>`;
  await withPage(browser, origin, {}, async (page) => {
    await openLab(page, 0, 'Create');
    await pasteCode(page, code);
    await page.locator('#btnEdit').tap();
    await sheetOpen(page);
    const out = await page.locator('.sh-area textarea').inputValue();
    const flat = out.replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase();
    must(!flat.includes('javascript:'), `the exported file keeps a javascript: link:\n${out}`);
    must(!/<h:img|xhtml/i.test(out), `the exported file keeps an XHTML element:\n${out}`);
    // any prefix: serializers may rename the one bound to xlink (WebKit writes xlink:)
    must(/(^|[\s:])href="#keep"/.test(out), `the sanitizer dropped a safe prefixed href:\n${out}`);
  });
}

// 6. The render-time layer must not strip what the lab teaches: SMIL, <use>, filters, and text with
// a no-break space. And the Edit round trip (export → parse) must still work.
async function lessonMarkupSurvives(browser, origin) {
  const lesson = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><filter id="soft"><feGaussianBlur stdDeviation="2"/></filter><circle id="dot" r="4" fill="#264653"/></defs>
  <g><rect x="10" y="10" width="20" height="20"><animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite"/></rect></g>
  <circle cx="50" cy="50" r="10"><set attributeName="fill" to="#e76f51" begin="click"/><animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="3s" repeatCount="indefinite"/></circle>
  <use href="#dot" x="70" y="70"/>
  <rect x="60" y="10" width="20" height="20" filter="url(#soft)"/>
  <g><text x="10" y="90">a&#160;b</text></g>
</svg>`;
  await withPage(browser, origin, {}, async (page, errors) => {
    await openLab(page, 0, 'Create');
    await pasteCode(page, lesson);
    const got = await page.evaluate(() => {
      const art = document.getElementById('gArt');
      const names = new Set([...art.querySelectorAll('*')].map((e) => e.localName));
      const at = [...art.querySelectorAll('*')].find((e) => e.localName === 'animateTransform');
      const use = [...art.querySelectorAll('*')].find((e) => e.localName === 'use');
      return {
        names: [...names],
        from: at && at.getAttribute('from'),
        to: at && at.getAttribute('to'),
        href: use && (use.getAttribute('href') || use.getAttribute('xlink:href')),
        text: [...art.querySelectorAll('*')].filter((e) => e.localName === 'text').map((e) => e.textContent).join('|'),
      };
    });
    for (const tag of ['animate', 'set', 'animateTransform', 'use', 'filter', 'feGaussianBlur', 'text']) {
      must(got.names.includes(tag), `the sanitizer stripped <${tag}> from lesson markup (kept: ${got.names.join(' ')})`);
    }
    must(got.from === '0 50 50' && got.to === '360 50 50', `animateTransform lost from/to: ${got.from} → ${got.to}`);
    must(got.href === '#dot', `<use> lost its href: ${got.href}`);
    must(got.text.includes('a b'), `text lost its no-break space: ${JSON.stringify(got.text)}`);

    // Round trip: the exported code parses as XML, and applying it again succeeds.
    await page.locator('#btnEdit').tap();
    await sheetOpen(page);
    const xmlOk = await page.evaluate(() => {
      const doc = new DOMParser().parseFromString(document.querySelector('.sh-area textarea').value, 'image/svg+xml');
      return doc.getElementsByTagName('parsererror').length === 0;
    });
    must(xmlOk, 'the exported code is not well-formed XML');
    await page.locator('#sheet [data-x="apply"]').tap();
    await waitFor(() => page.evaluate(() => !document.getElementById('sheet').classList.contains('on')), () => 'Edit → Apply of the exported code failed (sheet stayed open)');
    must(errors.length === 0, `errors on the page:\n${errors.join('\n')}`);
  });
}

// 7. Reduced motion: looping labs open paused with a Play button, on a frame that shows the drawing.
async function reducedMotion(browser, origin) {
  // Set when the context is created: the lab reads the setting once, at load.
  await withPage(browser, origin, { reducedMotion: 'reduce' }, async (page, errors) => {
    await openLab(page, 0, 'Animate');
    must(await stagePaused(page), 'Animation lab is moving under reduced motion');
    must((await page.locator('#controls [data-a="pause"]').innerText()).trim() === 'Play', 'Animation lab: the chip should offer Play');
    // Play from a still starts the motion from the top (resuming at the parked end-of-cycle frame
    // would end a finite animation at once).
    await page.locator('#controls [data-a="pause"]').tap();
    await waitFor(
      () => page.evaluate(() => !document.getElementById('stage').animationsPaused() && document.getElementById('stage').getCurrentTime() < 1),
      'Animation lab: Play did not start the motion from the top',
    );

    await openLab(page, 1, 'Clip');
    await page.locator('#controls [data-m="wipe"]').tap();
    await waitFor(() => stagePaused(page), 'Clip wipe is moving under reduced motion');
    must((await page.locator('#controls [data-a="play"]').innerText()).trim() === 'Play', 'Clip wipe: no Play control');
    await page.locator('#controls [data-a="play"]').tap();
    await waitFor(async () => !(await stagePaused(page)), 'Clip wipe: Play did not start the motion');

    await openLab(page, 2, 'Spinner');
    must(await stagePaused(page), 'Spinner is moving under reduced motion');

    // Create: paused shapes are drawn whole; the animation stays in the code.
    await openLab(page, 0, 'Create');
    await pasteCode(page, `<svg xmlns="http://www.w3.org/2000/svg"><path d="M 10 50 L 90 50" fill="none" stroke="#264653" stroke-width="4" pathLength="100" stroke-dasharray="100"><animate attributeName="stroke-dashoffset" values="100;0" dur="2s" repeatCount="indefinite"/></path></svg>`);
    const drawn = await page.evaluate(() => {
      const p = [...document.getElementById('gArt').querySelectorAll('path')].find((e) => e.getAttribute('stroke-dasharray') === '100');
      return p ? { anim: p.querySelector('animate') !== null, offset: getComputedStyle(p).strokeDashoffset } : null;
    });
    must(drawn, 'test setup: the draw path did not render');
    must(!drawn.anim && parseFloat(drawn.offset) === 0, `Create draw path is not shown whole while paused: ${JSON.stringify(drawn)}`);
    must((await page.locator('pre.src').innerText()).includes('stroke-dashoffset'), 'the animation should stay in the code');
    must(errors.length === 0, `errors on the page:\n${errors.join('\n')}`);
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

async function withPage(browser, origin, opts, fn) {
  const context = await browser.newContext({ ...PHONE, reducedMotion: opts.reducedMotion ?? 'no-preference' });
  if (opts.init) {
    await context.addInitScript((doc) => {
      if (!sessionStorage.getItem('planted')) { localStorage.setItem('svg-lab:doc', JSON.stringify(doc)); sessionStorage.setItem('planted', '1'); }
    }, opts.init);
  }
  const page = await context.newPage();
  const errors = [];
  const external = new Set();
  const host = new URL(origin).host;
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console error: ${m.text()}`));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/^https?:$/.test(u.protocol) && u.host !== host) external.add(u.host);
  });
  try {
    await page.goto(`${origin}/svg-lab/`, { waitUntil: 'networkidle' });
    await fn(page, errors, external);
  } finally {
    await context.close();
  }
}

async function openLab(page, set, tab) {
  await page.locator('#setBtn').tap();
  await page.locator('.setrow').nth(set).tap();
  await page.locator('#tabs .tab', { hasText: tab }).first().tap();
  await waitFor(
    () => page.evaluate((t) => (document.querySelector('#tabs .tab[aria-current="true"]')?.textContent ?? '').trim().endsWith(t), tab),
    `could not open ${tab} in set ${set + 1}`,
  );
  await page.waitForTimeout(350); // the lab renders on the next frame; sheets slide for 0.22s
}

async function sheetOpen(page) {
  await waitFor(() => page.evaluate(() => document.getElementById('sheet').classList.contains('on')), 'the sheet did not open');
  await page.waitForTimeout(300);
}

async function closeSheet(page) {
  await page.locator('#shDone').tap();
  await page.waitForTimeout(300);
}

// Paste through Create → Edit → Apply, and prove it landed: the sheet closed without an error and
// the artboard holds one group per stored item. A paste that silently failed would make every
// "nothing bad happened" check below pass for the wrong reason.
async function pasteCode(page, code) {
  await page.locator('#btnEdit').tap();
  await sheetOpen(page);
  await page.locator('.sh-area textarea').fill(code);
  await page.locator('#sheet [data-x="apply"]').tap();
  await waitFor(
    () => page.evaluate(() => !document.getElementById('sheet').classList.contains('on')),
    async () => `Apply failed: ${await page.locator('.sh-area .err').innerText().catch(() => '?')}`,
  );
  await page.waitForTimeout(300);
  await landed(page, 'the paste');
}

async function landed(page, what, expected) {
  const r = await page.evaluate(() => ({
    drawn: document.querySelectorAll('#gArt [data-i]').length,
    stored: (JSON.parse(localStorage.getItem('svg-lab:doc') || '[]') || []).length,
  }));
  must(r.stored > 0 && r.drawn === r.stored, `${what} did not land: ${r.drawn} drawn, ${r.stored} stored`);
  if (expected != null) must(r.drawn === expected, `${what}: ${r.drawn} items drawn, expected ${expected}`);
}

async function inert(page, what) {
  // Follow every link on the artboard, as a tap would.
  await page.evaluate(() => {
    document.querySelectorAll('#gArt a').forEach((a) => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })));
  });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const art = document.getElementById('gArt');
    if (!art) return { replaced: true, pwn: window.__pwn ?? null };
    const all = [...art.querySelectorAll('*')];
    const clean = (v) => v.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
    return {
      pwn: window.__pwn ?? null,
      html: all.filter((e) => /^(img|style|script|foreignobject|iframe)$/i.test(e.localName)).map((e) => e.localName),
      smil: all.filter((e) => /^(set|animate\w*)$/i.test(e.localName) && /(^|:)href$|^on/i.test((e.getAttribute('attributeName') || '').trim())).length,
      js: all.flatMap((e) => [...e.attributes]).filter((a) => clean(a.value).startsWith('javascript:')).map((a) => a.name),
      data: all.filter((e) => [...e.attributes].some((a) => /^(href|xlink:href)$/i.test(a.name) && clean(a.value).startsWith('data:') && !clean(a.value).startsWith('data:image/'))).map((e) => e.localName),
      ids: ['ctx', 'controls', 'over', 'goals'].filter((id) => document.getElementById(id)?.closest('#gArt')),
      visible: getComputedStyle(document.body).visibility,
    };
  });
  must(!r.replaced, `${what}: the page was replaced (a javascript: link ran)`);
  must(r.pwn === null, `${what}: script ran (${r.pwn})`);
  must(r.html.length === 0, `${what}: <${r.html.join('>, <')}> reached the artboard`);
  must(r.smil === 0, `${what}: an animation retargets href or a handler`);
  must(r.js.length === 0, `${what}: a javascript: URL is still in ${r.js.join(', ')}`);
  must(r.data.length === 0, `${what}: a non-image data: URL is still on <${r.data.join('>, <')}>`);
  must(r.ids.length === 0, `${what}: pasted markup took over the lab's #${r.ids.join(', #')}`);
  must(r.visible === 'visible', `${what}: pasted CSS restyled the page`);
}

async function stagePaused(page) {
  return page.evaluate(() => document.getElementById('stage').animationsPaused());
}

async function noSidewaysScroll(page, where) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  must(r.sw <= r.cw, `${where}: the page scrolls sideways (${r.sw} > ${r.cw})`);
}

// Every visible control outside the artboard content and the code listing is at least 44pt both
// ways. Code tokens are the documented exception (the sheet they open has full-size controls). A
// field inside a label is measured by its label, which is what the finger hits.
async function tapFloor(page, where) {
  const small = await page.evaluate((min) => {
    const out = [];
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')) {
      if (el.closest('#stage, .pane, #duo2, pre.src, .legend, .tip, [hidden]')) continue;
      const target = el.matches('input') && el.closest('label') ? el.closest('label') : el;
      const r = target.getBoundingClientRect();
      const cs = getComputedStyle(target);
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (target.closest('.sheet') && !target.closest('.sheet.on')) continue;
      if (r.width < min - 0.5 || r.height < min - 0.5) {
        out.push(`${target.tagName.toLowerCase()}${target.className ? '.' + String(target.className).trim().split(/\s+/).join('.') : ''} "${(target.textContent || target.getAttribute('aria-label') || '').trim().slice(0, 20)}" ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
      }
    }
    return [...new Set(out)];
  }, TAP_MIN);
  must(small.length === 0, `${where}: tap targets under ${TAP_MIN}pt:\n  ${small.join('\n  ')}`);
}

async function fieldFloor(page, sel, where) {
  const px = await page.locator(sel).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  must(px >= 16, `${where}: ${sel} is ${px}px; iOS zooms the page into fields under 16px`);
}

function must(cond, message) {
  if (!cond) throw new Error(message);
}

async function waitFor(fn, message, timeout = 2000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(typeof message === 'function' ? await message() : message);
}
