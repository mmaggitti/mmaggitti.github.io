// Seams probe end-to-end test, run by the site's scripts/smoke-test.mjs against the built site
// (Chromium in cloud sessions, WebKit in CI). Every check runs; the test throws once, listing all
// failures, so one CI run shows everything WebKit disagrees with.
//
// It proves each seam once, at the three sizes Core & Seams requires (DOCTRINE §4):
//   iPhone 440×956 and iPad 834×1194 with touch; desktop 1440×900 with no touch emulation.

const APP = 'cs-probe';
const SIZES = [
  { name: 'iphone', viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, touch: true },
  { name: 'ipad', viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true, touch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, touch: false },
];
const text = (page, check) => page.locator(`[data-check="${check}"]`).innerText();
// Polls from Node, not inside the page: the app's CSP blocks eval, so a predicate can't be
// rebuilt from source in the page (waitForFunction passes only its first, protocol-run check).
const until = async (page, check, predicate, what, timeout = 20_000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const t = await page.evaluate((c) => document.querySelector(`[data-check="${c}"]`)?.textContent ?? null, check);
    if (t !== null && predicate(t)) return true;
    if (Date.now() > end) return `${what}: got ${JSON.stringify(t ?? '(missing)')}`;
    await page.waitForTimeout(100);
  }
};

export default async function run({ browser, origin, engine }) {
  const failures = [];
  const expect = (ok, message) => { if (ok !== true) failures.push(typeof ok === 'string' ? ok : message); };

  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const at = (msg) => `[${engine} ${size.name}] ${msg}`;
    await page.goto(`${origin}/${APP}/`, { waitUntil: 'networkidle' });

    // The core: a known Adler-32 through Worker → WASM → back.
    expect(await until(page, 'core', (t) => t === '11e60398', at('core checksum')), '');
    expect(await until(page, 'version', (t) => t === '1 · 2 · 3', at('version parse')), '');

    // Density follows input; the tap floor holds wherever touch exists.
    const layout = await page.evaluate(() => {
      const btn = document.querySelector('[data-action="export"]').getBoundingClientRect();
      const row = document.querySelector('.cs-row').getBoundingClientRect();
      const value = document.querySelector('[data-check="core"]').getBoundingClientRect();
      const d = document.documentElement;
      return { btnH: btn.height, rowH: row.height, valueRight: value.right, valueLeft: value.left, width: d.clientWidth, overflow: d.scrollWidth - d.clientWidth };
    });
    expect(await text(page, 'density') === (size.touch ? 'comfortable' : 'compact'), at(`density reads ${await text(page, 'density')}`));
    if (size.touch) expect(layout.btnH >= 44 && layout.rowH >= 44, at(`touch targets under 44px (button ${layout.btnH}, row ${layout.rowH})`));
    else expect(layout.btnH < 44, at(`desktop controls not compact (button ${layout.btnH})`));
    expect(layout.overflow === 0, at(`sideways scroll of ${layout.overflow}px`));
    expect(layout.valueLeft >= 0 && layout.valueRight <= layout.width, at(`core value drawn outside the viewport (${layout.valueLeft}–${layout.valueRight})`));

    if (size.name === 'iphone') {
      // The core's typed error crosses the boundary as { kind, message }.
      await page.fill('#ver', '1.x.3');
      expect(await until(page, 'version', (t) => t.startsWith('parse:'), at('typed error')), '');

      // A trap kills the instance; the client replaces the worker and the next call works.
      await page.click('[data-action="trap"]');
      expect(await until(page, 'trap', (t) => t.startsWith('recovered (restarts: 1)'), at('trap recovery')), '');

      // The module host: a call, a runaway call stopped by the watchdog, a refused memory limit.
      await page.click('[data-action="plugin"]');
      expect(await until(page, 'plugin', (t) => t.includes('add(2,3) = 5') && t.includes('spin: timeout') && t.includes('max 0 pages: limits'), at('module host')), '');

      // Storage: write, read back, and still there after a reload.
      expect(await until(page, 'storage', (t) => /^(opfs|indexeddb); persisted: (true|false)$/.test(t), at('storage opened')), '');
      await page.click('[data-action="save"]');
      expect(await until(page, 'saved', (t) => t.startsWith('saved '), at('note saved')), '');
      const saved = await text(page, 'saved');
      await page.reload({ waitUntil: 'networkidle' });
      expect(await until(page, 'saved', (t) => t.length > 0, at('note after reload')), '');
      expect(await text(page, 'saved') === saved, at(`note changed across reload (${await text(page, 'saved')} vs ${saved})`));
      console.log(`  ${APP}: storage backend ${(await text(page, 'storage')).split(';')[0]} (${engine})`);

      // The service worker, where the engine offers one, is scoped to this app's folder only.
      const scope = await page.evaluate(async () => (await navigator.serviceWorker?.getRegistration?.())?.scope ?? null);
      if (scope !== null) expect(new URL(scope).pathname === `/${APP}/`, at(`service worker scope ${scope}`));

      // The CSP backstop is in the built page and allows WebAssembly.
      const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
      expect(Boolean(csp?.includes("'wasm-unsafe-eval'")), at('CSP meta missing or without wasm-unsafe-eval'));
    }

    expect(errors.length === 0, at(`console errors: ${errors.join(' | ')}`));
    await ctx.close();
  }
  if (failures.length) throw new Error(`${APP} e2e: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`);
}
