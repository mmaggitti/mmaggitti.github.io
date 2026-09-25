// Studio end-to-end test, run by scripts/smoke-test.mjs against the built site
// (Chromium in the cloud container, WebKit in CI). Throws on the first failure.
//
// Geometry is asserted, not just content: an overlay can show the right thing in the wrong place
// (the vault's overlay-editor lesson), so the highlight's box must equal the element's box.

const TOLERANCE = 1; // px

export default async function run({ browser, origin }) {
  const context = await browser.newContext({
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console error: ${m.text()}`));

  try {
    await page.goto(`${origin}/studio/?page=/hello/`, { waitUntil: 'networkidle' });
    let view = page.frameLocator('iframe.studio-frame');
    const tree = page.locator('.tree');
    const row = (text) => tree.locator('.tree-label').filter({ hasText: text });

    // 1. The frame loads and the tree shows html › head, body.
    await row(/^body/).first().waitFor();
    must((await row(/^html$/).count()) === 1, 'tree has no html row');
    must((await row(/^head$/).count()) === 1, 'tree has no head row');

    // 2. Select on: a tap selects instead of activating.
    await page.locator('.studio-select').tap();
    await view.locator('#tap').tap();
    await page.locator('.inspect-attrs').waitFor();
    const attrs = await page.locator('.inspect-attrs').innerText();
    must(/id\s+tap/.test(attrs), `inspector should show id=tap, got:\n${attrs}`);
    must(attrs.includes('ds-btn ds-btn--primary'), `inspector should show the class list, got:\n${attrs}`);
    must((await view.locator('#count').innerText()).trim() === '0', 'pick mode let the tap through: the counter changed');

    // 3. Geometry: the highlight sits exactly on the element.
    await sameBox(page.locator('.hl-border'), view.locator('#tap'), 'highlight on #tap');

    // 4. Live updates: select #count, open its row, then (Select off) tap the page's button.
    await pickTap(page, view.locator('#count'));
    await page.locator('.sheet-tabs button', { hasText: 'Tree' }).tap();
    await tree.locator('.tree-row', { has: page.locator('.tree-label', { hasText: /^p#count/ }) }).locator('.tree-toggle').tap();
    await row('"0"').first().waitFor();
    await page.locator('.studio-select').tap(); // Select off
    await view.locator('#tap').tap();
    await waitFor(async () => (await view.locator('#count').innerText()).trim() === '1', 'the page did not count the tap with Select off');
    await row('"1"').first().waitFor({ timeout: 2000 });

    // 5. A tree row selects its element and moves the highlight.
    await row(/^h1\.ds-title/).first().tap();
    await page.locator('.sheet-tabs button', { hasText: 'Inspect' }).tap();
    await waitFor(async () => (await page.locator('.inspect-title').innerText()).startsWith('h1'), 'tree tap did not select h1');
    await sameBox(page.locator('.hl-border'), view.locator('h1.ds-title'), 'highlight on h1 after a tree tap');

    // 6. Another page loads; the highlight follows the frame's scroll.
    await page.locator('.studio-page').selectOption('/ds/');
    await page.waitForFunction(() => location.search.includes(encodeURIComponent('/ds/')));
    view = page.frameLocator('iframe.studio-frame');
    await view.locator('h1.ds-title').waitFor();
    await page.locator('.studio-select').tap(); // Select on
    await view.locator('h1.ds-title').tap();
    await sameBox(page.locator('.hl-border'), view.locator('h1.ds-title'), 'highlight on /ds/ h1');
    const frame = page.frames().find((f) => f.url().includes('/ds/'));
    must(frame, 'no frame for /ds/');
    await frame.evaluate(() => window.scrollBy(0, 40));
    await page.waitForTimeout(100); // two animation frames: scroll event → bump → render
    await sameBox(page.locator('.hl-border'), view.locator('h1.ds-title'), 'highlight after scrolling the frame');

    // 7. A layout change with no DOM mutation (a CSSOM rule) still moves the highlight.
    await frame.evaluate(() => document.styleSheets[0].insertRule('h1.ds-title { margin-top: 5rem }', 0));
    await sameBox(page.locator('.hl-border'), view.locator('h1.ds-title'), 'highlight after a CSSOM-only layout change');

    // 8. An element that isn't rendered (head) gets no highlight, and the inspector says so.
    await page.locator('.sheet-tabs button', { hasText: 'Tree' }).tap();
    await row(/^head$/).first().tap();
    await page.locator('.sheet-tabs button', { hasText: 'Inspect' }).tap();
    await page.locator('.inspect-note').waitFor();
    must((await page.locator('.hl-border').count()) === 0, 'a display:none element was highlighted');

    // 9. After a link inside the frame moves it, the picker can still send it back.
    await page.locator('.studio-select').tap(); // Select off
    await page.locator('.studio-page').selectOption('/');
    view = page.frameLocator('iframe.studio-frame');
    await view.locator('.ds-card', { hasText: 'Hello' }).tap();
    await page.waitForFunction(() => location.search === `?page=${encodeURIComponent('/hello/')}`);
    await page.locator('.studio-page').selectOption('/');
    await waitFor(
      async () => (await page.frameLocator('iframe.studio-frame').locator('h1').first().innerText()) === 'Projects',
      'choosing the launcher again did not navigate the frame back',
      4000,
    );

    // 10. The studio never loads itself, even without the trailing slash.
    await page.goto(`${origin}/studio/?page=/studio`, { waitUntil: 'networkidle' });
    await page.frameLocator('iframe.studio-frame').locator('h1.ds-title', { hasText: 'Hello' }).waitFor();

    must(errors.length === 0, `errors on the page:\n${errors.join('\n')}`);
  } finally {
    await context.close();
  }
}

// Pick mode ignores a touch within 150 ms of a scroll (that is a finger stopping a fling). Playwright
// scrolls a target into view and taps at once, faster than any finger, so scroll first and settle.
async function pickTap(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await locator.tap();
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
  throw new Error(typeof message === 'function' ? message() : message);
}

async function sameBox(overlay, target, what) {
  let a;
  let b;
  await waitFor(
    async () => {
      a = await overlay.boundingBox();
      b = await target.boundingBox();
      return a && b && ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) <= TOLERANCE);
    },
    () => `${what}: overlay ${fmt(a)} ≠ element ${fmt(b)}`,
  );
}

function fmt(r) {
  return r ? `${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}×${r.height.toFixed(1)}` : 'none';
}
