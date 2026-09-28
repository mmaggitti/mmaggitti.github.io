// Teton Range 3D end-to-end test, run by scripts/smoke-test.mjs against the built site (Chromium in
// the cloud container, WebKit in CI). Throws on the first failure.
//
// What it guards: the terrain draws and its labels land on the stage; the Code toggle lists the
// served file line for line, folds the huge lines and decodes the base64 data; the site rules the
// page was adapted to (44pt tap floor, self-hosted fonts, no sideways scroll, no third-party
// requests); and the no-WebGL and Home Screen paths.

const PHONE = { viewport: { width: 440, height: 956 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const TAP_MIN = 44;
const FOLD = 10000; // the viewer folds lines longer than this, and every base64 line…
const HEAD = 300; // …to their first HEAD characters
const BOOT_MS = 90000; // software WebGL in CI builds 1.5M triangles slowly

export default async function run({ browser, origin, engine }) {
  const file = await (await fetch(`${origin}/tetons/`)).text();
  const lines = file.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const gl = await hasWebgl(browser);
  if (!gl) console.log(`     tetons: ${engine} has no WebGL here — checking the page's no-WebGL path in place of the drawing checks`);

  await loadAndDraw(browser, origin, gl);
  await codeView(browser, origin, file, lines, gl);
  if (gl) await earlyToggle(browser, origin);
  await noWebgl(browser, origin, lines);
  await homeScreenInsets(browser, origin);
}

// 1. Load: fonts from this origin, no third-party requests, no sideways scroll, every control 44pt.
// Then the model: the canvas fills the stage, Grand Teton and the five photo pins sit on it, and each
// pin takes a tap 20pt from its center.
async function loadAndDraw(browser, origin, gl) {
  await withPage(browser, origin, {}, async (page, errors, external) => {
    for (const font of ['400 16px Barlow', '600 16px Barlow', '600 16px "Barlow Semi Condensed"', '600 16px "Barlow Condensed"']) {
      const ok = await page.evaluate((f) => document.fonts.load(f).then((faces) => faces.length > 0 && faces.every((x) => x.status === 'loaded'), () => false), font);
      must(ok, `font ${font} did not load from this origin`);
    }
    await noSidewaysScroll(page, 'on load');
    await tapFloor(page, 'on load');

    if (!gl) {
      must((await page.locator('#loading').innerText()).includes('needs WebGL'), 'no WebGL, and no message saying so');
    } else {
      await booted(page);
      const r = await page.evaluate(() => {
        const s = document.getElementById('stage').getBoundingClientRect();
        const c = document.getElementById('gl').getBoundingClientRect();
        const on = (el) => {
          const b = el.getBoundingClientRect();
          return getComputedStyle(el).visibility === 'visible' && b.width > 0 && b.left >= s.left && b.right <= s.right && b.top >= s.top && b.bottom <= s.bottom;
        };
        const grand = [...document.querySelectorAll('.pk .chip')].find((ch) => ch.firstChild.nodeValue === 'Grand Teton');
        return {
          fill: Math.abs(c.width - s.width) <= 2 && Math.abs(c.height - s.height) <= 2 && c.height > 300,
          grand: !!grand && on(grand),
          peaks: [...document.querySelectorAll('.pk .chip')].filter(on).length,
          // A pin counts as on the stage by its center: the stage may clip the edge of one near its side.
          pins: [...document.querySelectorAll('.vp .num')].filter((el) => {
            const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
            return getComputedStyle(el).visibility === 'visible' && x > s.left && x < s.right && y > s.top && y < s.bottom;
          }).length,
          shown: [...document.querySelectorAll('.vp .num')].filter((el) => getComputedStyle(el).visibility === 'visible').length,
        };
      });
      must(r.fill, 'the canvas does not fill the stage');
      must(r.grand, 'the Grand Teton label is not on the stage');
      must(r.peaks >= 3, `only ${r.peaks} peak labels on the stage`);
      // The opening view leaves the southernmost photo spot just below the stage edge.
      must(r.pins === r.shown && r.pins >= 4, `${r.pins} photo pins on the stage, ${r.shown} shown`);
      // A blank stage screenshots to ~27 KB; the drawn terrain to 200 KB+. Polled: software GL in CI
      // may show its first frame a moment after the loading screen goes.
      let png = 0;
      await waitFor(async () => (png = (await page.locator('#stage').screenshot()).length) > 60000,
        () => `the stage screenshot is ${png} bytes — is the terrain drawn?`, 20000);

      // Probes that would land on or past the stage's edge are skipped: the stage clips there.
      const hits = await page.evaluate(() => {
        const s = document.getElementById('stage').getBoundingClientRect();
        return [...document.querySelectorAll('.vp .num')].filter((n) => getComputedStyle(n).visibility === 'visible').map((n) => {
          const b = n.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
          const probes = [[20, 0], [-20, 0], [0, 20], [0, -20]].map(([dx, dy]) => [x + dx, y + dy]).filter(([px, py]) => px > s.left + 2 && px < s.right - 2 && py > s.top + 2 && py < s.bottom - 2);
          return probes.length >= 3 && probes.every(([px, py]) => document.elementFromPoint(px, py)?.closest('.vp') != null);
        });
      });
      must(hits.length >= 4 && hits.every(Boolean), `a photo pin misses taps 20pt from its center: ${JSON.stringify(hits)}`);

      // Photo mode shows the blend row: its controls are 44pt too.
      await page.locator('#views .tile').nth(1).tap();
      await waitFor(() => page.evaluate(() => !document.getElementById('blend-row').hidden), 'the blend row did not appear in photo mode', 10000);
      await tapFloor(page, 'photo mode');
      await noSidewaysScroll(page, 'photo mode');
    }
    must(external.size === 0, `third-party requests: ${[...external].join(', ')}`);
    must(errors.length === 0, `errors on the page:\n${errors.join('\n')}`);
  });
}

// 2. Code on: the model gives way to the source, which lists every line of the served file — short
// lines whole, long ones folded with Show all — and decodes each base64 line. Code off: the model
// is back, labels and all.
async function codeView(browser, origin, file, lines, gl) {
  await withPage(browser, origin, {}, async (page, errors) => {
    if (gl) await booted(page);
    await page.locator('label[for="code"]').tap();
    await waitFor(() => page.evaluate((n) => document.querySelectorAll('#source .src > li').length === n, lines.length),
      async () => `the code view lists ${await page.evaluate(() => document.querySelectorAll('#source .src > li').length)} lines, the file has ${lines.length}`, 20000);

    const lay = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const shown = (s) => getComputedStyle(document.querySelector(s)).display !== 'none';
      return { stage: shown('#stage'), views: shown('#views'), names: shown('label[for="names"]'), code: shown('label[for="code"]'), src: r('#source'), top: r('.top'), foot: r('.foot-row'), vh: innerHeight };
    });
    must(!lay.stage && !lay.views && !lay.names, 'the model or its controls still show beside the code');
    must(lay.code, 'the Code toggle disappeared with the model');
    must(lay.src.top >= lay.top.bottom && lay.src.bottom <= lay.foot.top && lay.src.bottom <= lay.vh, `the code view is not between the header and the toggles (${JSON.stringify(lay.src)})`);
    must(lay.src.height > lay.vh * 0.6, `the code view is only ${Math.round(lay.src.height)}pt tall`);

    const got = await page.evaluate(() => [...document.querySelectorAll('#source .src > li')].map((li) => ({
      text: li.firstChild && li.firstChild.nodeType === 3 ? li.firstChild.nodeValue : '',
      folded: !!li.querySelector('.fold button'),
    })));
    const folds = (l) => l.length > FOLD || l.startsWith('<script type="text/plain" id="');
    lines.forEach((line, i) => {
      const g = got[i];
      if (folds(line)) {
        must(g.folded && g.text === line.slice(0, HEAD), `line ${i + 1} (${line.length} chars) is not folded to its first ${HEAD}`);
      } else {
        must(!g.folded && g.text === line, `line ${i + 1} differs from the file:\n  file: ${line.slice(0, 120)}\n  view: ${g.text.slice(0, 120)}`);
      }
    });
    must(lines.filter(folds).length === 14, `test setup: expected three.js, pako and 12 base64 lines to fold, got ${lines.filter(folds).length}`);
    await noSidewaysScroll(page, 'code view');
    await tapFloor(page, 'code view');

    // Show all on pako's line puts back every character.
    const pako = lines.findIndex((l, i) => i > 0 && lines[i - 1].includes('pako 2.1.0') && l.length > FOLD);
    must(pako > 0, 'test setup: pako line not found');
    const li = page.locator('#source .src > li').nth(pako);
    await li.locator('.fold button').tap();
    const full = await li.evaluate((el) => ({ text: el.firstChild.nodeValue, fold: !!el.querySelector('.fold') }));
    must(!full.fold && full.text === lines[pako], `Show all left line ${pako + 1} at ${full.text.length} of ${lines[pako].length} chars`);

    // Every base64 JPEG decodes at the size its own header gives; the heightmap draws at the grid size.
    const blobs = [...file.matchAll(/^<script type="text\/plain" id="([\w-]+)"[^>]*>([^<]*)<\/script>$/gm)].map((m) => ({ id: m[1], b64: m[2].trim() }));
    const jpegs = blobs.filter((b) => b.b64.startsWith('/9j/'));
    must(jpegs.length === 11 && blobs.some((b) => b.id === 'dem-data'), `test setup: found ${jpegs.length} JPEGs, dem-data ${blobs.some((b) => b.id === 'dem-data')}`);
    for (const { id, b64 } of jpegs) {
      const [w, h] = jpegSize(Buffer.from(b64, 'base64'));
      const row = page.locator('#source .src > li').nth(lines.findIndex((l) => l.startsWith(`<script type="text/plain" id="${id}"`)));
      await row.locator('figure').scrollIntoViewIfNeeded();
      await waitFor(() => row.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0), `${id}: the decoded image did not load`, 10000);
      const img = await row.locator('img').evaluate((el) => {
        const b = el.getBoundingClientRect(), s = document.getElementById('source').getBoundingClientRect();
        return { w: el.naturalWidth, h: el.naturalHeight, inside: b.left >= s.left && b.right <= s.right && b.width > 100, cap: el.nextElementSibling.textContent };
      });
      must(img.w === w && img.h === h, `${id}: decoded ${img.w}×${img.h}, its header says ${w}×${h}`);
      must(img.inside, `${id}: the image is not drawn inside the code view`);
      must(img.cap === `JPEG · ${w} × ${h}`, `${id}: caption "${img.cap}"`);
    }
    const dem = JSON.parse(file.match(/id="meta-data"[^>]*>([^<]*)</)[1]).dem;
    const demRow = page.locator('#source .src > li').nth(lines.findIndex((l) => l.startsWith('<script type="text/plain" id="dem-data"')));
    await demRow.locator('figure').scrollIntoViewIfNeeded();
    await waitFor(() => demRow.locator('figcaption').evaluate((c) => c.textContent.includes(' m (white)')), 'the heightmap was not drawn', 10000);
    const hm = await demRow.locator('canvas').evaluate((cv) => {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 997) seen.add(d[i]);
      return { w: cv.width, h: cv.height, grays: seen.size };
    });
    must(hm.w === dem.cols && hm.h === dem.rows, `heightmap canvas ${hm.w}×${hm.h}, the grid is ${dem.cols}×${dem.rows}`);
    must(hm.grays > 50, `the heightmap has only ${hm.grays} gray levels — not decoded`);

    // Code off: the model comes back.
    await page.locator('label[for="code"]').tap();
    await waitFor(() => page.evaluate(() => getComputedStyle(document.getElementById('stage')).display !== 'none' && document.getElementById('source').hidden), 'Code off did not bring the model back');
    if (gl) await grandTetonShows(page, 'after Code off');
    must(errors.length === 0, `errors on the page:\n${errors.join('\n')}`);
  });
}

// 3. Code opened before the terrain has finished building: the labels were measured on a hidden
// stage. Closing the code view must still show them.
async function earlyToggle(browser, origin) {
  const init = () => document.addEventListener('DOMContentLoaded', () => {
    window.__bootedAtToggle = document.getElementById('loading').hidden;
    document.getElementById('code').click();
  });
  await withPage(browser, origin, { init }, async (page, errors) => {
    must(await page.evaluate(() => window.__bootedAtToggle === false), 'test setup: the model had already booted when Code opened');
    await booted(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.locator('label[for="code"]').tap();
    await grandTetonShows(page, 'after Code was open during boot');
    must(errors.length === 0, `errors on the page:\n${errors.join('\n')}`);
  });
}

// 4. A browser without WebGL: the page says so without a console error, and the code view works.
async function noWebgl(browser, origin, lines) {
  const init = () => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : get.call(this, type, ...rest); };
  };
  await withPage(browser, origin, { init }, async (page, errors) => {
    await waitFor(() => page.evaluate(() => document.getElementById('loading').textContent.includes('needs WebGL')), 'no WebGL, and no message saying so');
    await page.locator('label[for="code"]').tap();
    await waitFor(() => page.evaluate((n) => document.querySelectorAll('#source .src > li').length === n, lines.length), 'the code view did not load without WebGL', 20000);
    must(errors.length === 0, `errors on the page without WebGL:\n${errors.join('\n')}`);
  });
}

// 5. Home Screen launch: the safe-area insets pad the root; the page must still fit the screen.
async function homeScreenInsets(browser, origin) {
  await withPage(browser, origin, {}, async (page) => {
    const r = await page.evaluate(() => {
      const el = document.documentElement;
      el.style.paddingTop = '59px';
      el.style.paddingBottom = '34px';
      return { sh: el.scrollHeight, ch: el.clientHeight };
    });
    must(r.sh <= r.ch, `with Home Screen insets the page scrolls by ${r.sh - r.ch}pt`);
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

async function hasWebgl(browser) {
  const context = await browser.newContext(PHONE);
  try {
    const page = await context.newPage();
    return await page.evaluate(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); });
  } finally {
    await context.close();
  }
}

async function withPage(browser, origin, opts, fn) {
  const context = await browser.newContext(PHONE);
  if (opts.init) await context.addInitScript(opts.init);
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
    await page.goto(`${origin}/tetons/`, { waitUntil: 'networkidle' });
    await fn(page, errors, external);
  } finally {
    await context.close();
  }
}

async function booted(page) {
  await waitFor(() => page.evaluate(() => document.getElementById('loading').hidden), 'the terrain did not finish building', BOOT_MS);
  await page.waitForTimeout(500); // a frame or two for labels to place
}

async function grandTetonShows(page, where) {
  await waitFor(() => page.evaluate(() => {
    const s = document.getElementById('stage').getBoundingClientRect();
    const ch = [...document.querySelectorAll('.pk .chip')].find((c) => c.firstChild.nodeValue === 'Grand Teton');
    if (!ch || getComputedStyle(ch).visibility !== 'visible') return false;
    const b = ch.getBoundingClientRect();
    return b.width > 0 && b.left >= s.left && b.right <= s.right && b.top >= s.top && b.bottom <= s.bottom;
  }), `${where}: the Grand Teton label is not on the stage`, 5000);
}

function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length && buf[i] === 0xff) {
    const mk = buf[i + 1];
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('test setup: no JPEG frame header');
}

async function noSidewaysScroll(page, where) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  must(r.sw <= r.cw, `${where}: the page scrolls sideways (${r.sw} > ${r.cw})`);
}

// Every visible control outside the stage is at least 44pt both ways (the stage's pins are checked
// by hit-testing above). A field inside a label is measured by its label, which is what the finger hits.
async function tapFloor(page, where) {
  const small = await page.evaluate((min) => {
    const out = [];
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')) {
      if (el.closest('#stage, [hidden]')) continue;
      const target = el.matches('input') && el.closest('label') ? el.closest('label') : el;
      const r = target.getBoundingClientRect();
      const cs = getComputedStyle(target);
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (r.width < min - 0.5 || r.height < min - 0.5) {
        out.push(`${target.tagName.toLowerCase()}${target.id ? '#' + target.id : ''} "${(target.textContent || target.getAttribute('aria-label') || '').trim().slice(0, 20)}" ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
      }
    }
    return [...new Set(out)];
  }, TAP_MIN);
  must(small.length === 0, `${where}: tap targets under ${TAP_MIN}pt:\n  ${small.join('\n  ')}`);
}

function must(cond, message) {
  if (!cond) throw new Error(message);
}

async function waitFor(fn, message, timeout = 2000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(typeof message === 'function' ? await message() : message);
}
