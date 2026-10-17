// Fractal end-to-end test, run by scripts/smoke-test.mjs against the built site (Chromium in the
// cloud container, WebKit in CI). Every check runs; failures are collected and thrown together, so
// one CI run shows all of them.
//
// Geometry is asserted, not just presence: a framed panel must fill the workspace, nested panels
// must sit inside their host's dock below its band, the next page must sit exactly one workspace
// width plus a gap to the right, and app content must be the same element after moves.

const TOL = 1; // px
const GAP = 6; // 0.5rem at the site's 75% scale

export default async function run({ browser, origin }) {
  const failures = [];
  const check = async (name, fn, opts = {}) => {
    const context = await browser.newContext({
      viewport: { width: 440, height: 956 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      reducedMotion: opts.motion ? 'no-preference' : 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console error: ${m.text()}`));
    try {
      await page.goto(`${origin}/fractal/`, { waitUntil: 'networkidle' });
      await settled(page);
      await fn(page);
      if (errors.length) throw new Error(errors.join('; '));
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
    } finally {
      await context.close();
    }
  };

  await check('loads clean, no sideways scroll, chrome is tappable', async (page) => {
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    must(sideways === 0, `page scrolls sideways by ${sideways}px`);
    const small = await page.evaluate(() => {
      const out = [];
      const sel = '.fx-tab, .fx-zoom, .fx-bar-btn, .fx-crumbs button, .fx-bottombar button';
      for (const e of document.querySelectorAll(sel)) {
        const frame = e.closest('.fx-frame');
        if (frame && (getComputedStyle(frame).visibility === 'hidden' || frame.dataset.tier === 'tile')) continue;
        const r = e.getBoundingClientRect();
        // Chrome inside a group drawn smaller is a miniature: tapping it frames the group instead.
        const scale = frame ? r.height / e.offsetHeight : 1;
        if (scale < 0.999) continue;
        if (r.height < 43.5 || r.width < 43.5) out.push(`${e.className} ${e.textContent.trim().slice(0, 20)} ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
      }
      return out;
    });
    must(!small.length, `targets under 44px: ${small.join(', ')}`);
  });

  await check('the zoom button frames a nested host; it fills the workspace and its apps sit in its dock', async (page) => {
    await page.locator('[data-panel="p-garden"] .fx-zoom').tap();
    await settled(page);
    await framed(page, 'p-garden');
    const g = await page.evaluate(() => {
      const box = (s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      return {
        tabbar: box('[data-panel="p-garden"] .fx-tabbar'),
        band: box('[data-app="garden"]'),
        dock: box('[data-dock="garden"]'),
        kids: [box('[data-panel="p-garden-list"]'), box('[data-panel="p-garden-counter"]')],
      };
    });
    must(Math.abs(g.tabbar.h - 44) <= TOL, `tab bar is ${g.tabbar.h}px tall`);
    for (const k of g.kids) {
      must(inside(k, g.dock), `nested panel ${fmt(k)} is outside the dock ${fmt(g.dock)}`);
      must(k.y >= g.band.y + g.band.h - TOL, `nested panel ${fmt(k)} overlaps the band ${fmt(g.band)}`);
    }
    const crumbs = await page.locator('.fx-crumbs li').allInnerTexts();
    must(crumbs.join('/') === 'Home/Desk/Garden', `crumbs read ${crumbs.join(' › ')}`);
  });

  await check('Back steps out one level, through the host, to the overview', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-garden-list'));
    await settled(page);
    await framed(page, 'p-garden-list');
    const back = page.locator('.fx-bottombar').getByRole('button', { name: 'Back', exact: true });
    await back.tap();
    await settled(page);
    await framed(page, 'p-garden');
    await back.tap();
    await settled(page);
    await framed(page, 'p-home');
    await back.tap();
    await settled(page);
    const any = await page.locator('.fx-frame[data-framed]').count();
    must(any === 0, 'still framed after stepping out of the top level');
    must(await back.isDisabled(), 'Back is enabled at the overview');
  });

  await check('neighbours are pages one workspace width apart, reached with ›', async (page) => {
    await page.locator('[data-panel="p-list"] .fx-zoom').tap();
    await settled(page);
    await framed(page, 'p-list');
    const vp = await rect(page, '.fx-viewport');
    const next = await rect(page, '[data-panel="p-field"]');
    must(Math.abs(next.x - (vp.x + vp.w + GAP)) <= TOL && Math.abs(next.w - vp.w) <= TOL, `next page is at ${fmt(next)}, viewport ${fmt(vp)}`);
    await page.getByRole('button', { name: 'Next panel' }).tap();
    await settled(page);
    await framed(page, 'p-field');
    const page2 = await page.locator('.fx-page').innerText();
    must(page2 === '2/2', `page indicator reads ${page2}`);
  });

  await check('typed text and its element survive moving between levels', async (page) => {
    const ta = page.locator('[data-content="field"] textarea');
    await page.locator('[data-panel="p-field"] .fx-zoom').tap();
    await settled(page);
    await ta.fill('kept across zooms');
    await page.evaluate(() => (window.__ta = document.querySelector('[data-content="field"] textarea')));
    await page.evaluate(() => window.__fractal.frame('p-garden-list'));
    await settled(page);
    await page.locator('.fx-bottombar').getByRole('button', { name: 'Overview', exact: true }).tap();
    await settled(page);
    await page.evaluate(() => window.__fractal.frame('p-field'));
    await settled(page);
    const same = await page.evaluate(() => document.querySelector('[data-content="field"] textarea') === window.__ta);
    must(same, 'the textarea was recreated');
    must((await ta.inputValue()) === 'kept across zooms', 'the typed text was lost');
  });

  await check('an animated framing settles exactly on the workspace', async (page) => {
    await page.locator('[data-panel="p-garden"] .fx-zoom').tap();
    await settled(page);
    await framed(page, 'p-garden');
  }, { motion: true });

  await check('the framing survives a reload', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-garden-counter'));
    await settled(page);
    await page.waitForTimeout(500); // the save is debounced
    await page.reload({ waitUntil: 'networkidle' });
    await settled(page);
    await framed(page, 'p-garden-counter');
  });

  if (failures.length) throw new Error(`fractal e2e: ${failures.length} failure(s)\n  - ${failures.join('\n  - ')}`);
}

async function settled(page) {
  await page.waitForSelector('[data-fx-settled]', { state: 'attached', timeout: 5000 });
}

async function rect(page, selector) {
  return page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
}

/** The panel is the framed one, and fills the workspace exactly. */
async function framed(page, id) {
  const ok = await page.locator(`[data-panel="${id}"][data-framed]`).count();
  must(ok === 1, `${id} is not framed`);
  const vp = await rect(page, '.fx-viewport');
  const f = await rect(page, `[data-panel="${id}"]`);
  must(sameBox(vp, f), `${id} is at ${fmt(f)}, the workspace is ${fmt(vp)}`);
}

function sameBox(a, b) {
  return Math.abs(a.x - b.x) <= TOL && Math.abs(a.y - b.y) <= TOL && Math.abs(a.w - b.w) <= TOL && Math.abs(a.h - b.h) <= TOL;
}
function inside(a, b) {
  return a.x >= b.x - TOL && a.y >= b.y - TOL && a.x + a.w <= b.x + b.w + TOL && a.y + a.h <= b.y + b.h + TOL;
}
function must(cond, message) {
  if (!cond) throw new Error(message);
}
function fmt(r) {
  return `${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}×${r.h.toFixed(0)}`;
}
