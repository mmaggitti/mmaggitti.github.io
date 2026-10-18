// Fractal end-to-end test, run by scripts/smoke-test.mjs against the built site (Chromium in the
// cloud container, WebKit in CI). Every check runs; failures are collected and thrown together, so
// one CI run shows all of them.
//
// Geometry is asserted, not just presence: a framed panel must fill the workspace, nested panels
// must sit inside their host's dock below its band, the next page must sit exactly one workspace
// width plus a gap to the right, and app content must be the same element after moves.

const TOL = 1; // px
const GAP = 6; // 0.5rem at the site's 75% scale

export default async function run({ browser, origin, engine }) {
  const chromium = engine !== 'webkit';
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
    await page.locator('[data-panel="p-group-b"] .fx-zoom').tap();
    await settled(page);
    await framed(page, 'p-group-b');
    const g = await page.evaluate(() => {
      const box = (s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      return {
        tabbar: box('[data-panel="p-group-b"] .fx-tabbar'),
        band: box('[data-app="group-b"]'),
        dock: box('[data-dock="group-b"]'),
        kids: [box('[data-panel="p-teal"]'), box('[data-panel="p-indigo"]')],
      };
    });
    must(Math.abs(g.tabbar.h - 44) <= TOL, `tab bar is ${g.tabbar.h}px tall`);
    for (const k of g.kids) {
      must(inside(k, g.dock), `nested panel ${fmt(k)} is outside the dock ${fmt(g.dock)}`);
      must(k.y >= g.band.y + g.band.h - TOL, `nested panel ${fmt(k)} overlaps the band ${fmt(g.band)}`);
    }
    const crumbs = (await page.locator('.fx-crumbs li').allTextContents()).map((t) => t.trim()); // not innerText: WebKit's includes the ::before separators
    must(crumbs.join('/') === 'Home/Group A/Group B', `crumbs read ${crumbs.join(' › ')}`);
  });

  await check('Back steps out one level, through the host, to the overview', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-teal'));
    await settled(page);
    await framed(page, 'p-teal');
    const back = page.locator('.fx-bottombar').getByRole('button', { name: 'Back', exact: true });
    await back.tap();
    await settled(page);
    await framed(page, 'p-group-b');
    await back.tap();
    await settled(page);
    await framed(page, 'p-group-a');
    await back.tap();
    await settled(page);
    const any = await page.locator('.fx-frame[data-framed]').count();
    must(any === 0, 'still framed after stepping out of the top level');
    must(await back.isDisabled(), 'Back is enabled at the overview');
  });

  await check('neighbours are pages one workspace width apart, reached with ›', async (page) => {
    await page.locator('[data-panel="p-sky"] .fx-zoom').tap();
    await settled(page);
    await framed(page, 'p-sky');
    const vp = await rect(page, '.fx-viewport');
    const next = await rect(page, '[data-panel="p-amber"]');
    must(Math.abs(next.x - (vp.x + vp.w + GAP)) <= TOL && Math.abs(next.w - vp.w) <= TOL, `next page is at ${fmt(next)}, viewport ${fmt(vp)}`);
    await page.getByRole('button', { name: 'Next panel' }).tap();
    await settled(page);
    await framed(page, 'p-amber');
    const page2 = await page.locator('.fx-page').innerText();
    must(page2 === '2/2', `page indicator reads ${page2}`);
  });

  await check('a block is the same element after moving between levels, and blocks differ in colour', async (page) => {
    await page.locator('[data-panel="p-amber"] .fx-zoom').tap();
    await settled(page);
    await page.evaluate(() => (window.__block = document.querySelector('[data-content="amber"] .block')));
    await page.evaluate(() => window.__fractal.frame('p-teal'));
    await settled(page);
    await page.locator('.fx-bottombar').getByRole('button', { name: 'Overview', exact: true }).tap();
    await settled(page);
    await page.evaluate(() => window.__fractal.frame('p-amber'));
    await settled(page);
    const same = await page.evaluate(() => !!window.__block && document.querySelector('[data-content="amber"] .block') === window.__block);
    must(same, 'the block was recreated');
    const fills = await page.evaluate(() =>
      ['sky', 'amber', 'teal'].map((id) => getComputedStyle(document.querySelector(`[data-content="${id}"] .block`)).backgroundColor),
    );
    must(new Set(fills).size === 3 && !fills.some((f) => f === 'rgba(0, 0, 0, 0)' || f === 'transparent'), `block fills are ${fills.join(' | ')}`);
  });

  await check('a pinch over app content frames the panel under the fingers; the page never zooms', async (page) => {
    const c = await centre(page, '[data-panel="p-sky"]');
    await twoFingers(page, chromium, { x: c.x - 25, y: c.y }, { x: c.x + 25, y: c.y }, { x: c.x - 110, y: c.y }, { x: c.x + 110, y: c.y }, 12);
    await settled(page);
    await framed(page, 'p-sky');
    const zoom = await page.evaluate(() => window.visualViewport.scale);
    must(zoom === 1, `the page zoomed to ${zoom}`);
    const prevented = await page.evaluate(() => ['gesturestart', 'gesturechange'].map((type) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      document.querySelector('.fx-content').dispatchEvent(e);
      return e.defaultPrevented;
    }));
    must(prevented.every(Boolean), `Safari's gesture events are not cancelled (${prevented})`);
  });

  await check('a two-finger pan moves to the next page; a pinch out steps out', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-sky'));
    await settled(page);
    await twoFingers(page, chromium, { x: 300, y: 400 }, { x: 300, y: 520 }, { x: 80, y: 400 }, { x: 80, y: 520 }, 12);
    await settled(page);
    await framed(page, 'p-amber');
    await twoFingers(page, chromium, { x: 120, y: 400 }, { x: 320, y: 400 }, { x: 170, y: 400 }, { x: 270, y: 400 }, 12);
    await settled(page);
    const f = await page.locator('.fx-frame[data-framed]').count();
    const crumbs = await page.locator('.fx-crumbs li').count();
    must(crumbs === 2 && f === 0, `after pinching out: ${crumbs} crumbs, ${f} framed panels (expected the row, one level up)`);
  });

  await check('a swipe across the top bar flips to the neighbour', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-amber'));
    await settled(page);
    const bar = await rect(page, '.fx-topbar');
    const y = bar.y + bar.h / 2;
    await oneFinger(page, chromium, { x: 120, y }, { x: 320, y }, 10);
    await settled(page);
    await framed(page, 'p-sky');
  });

  await check('a double-tap on a tab bar frames the panel', async (page) => {
    const tab = await centre(page, '[data-panel="p-sky"] .fx-tab');
    await page.touchscreen.tap(tab.x, tab.y);
    await page.waitForTimeout(60);
    await page.touchscreen.tap(tab.x, tab.y);
    await settled(page);
    await framed(page, 'p-sky');
  });

  await check('an edge swipe goes back and forward through history', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-group-b'));
    await settled(page);
    await page.evaluate(() => window.__fractal.frame('p-teal'));
    await settled(page);
    const vp = await rect(page, '.fx-viewport');
    const y = vp.y + vp.h / 2;
    await oneFinger(page, chromium, { x: vp.x + 4, y }, { x: vp.x + 250, y }, 12);
    await settled(page);
    await framed(page, 'p-group-b');
    await oneFinger(page, chromium, { x: vp.x + vp.w - 4, y }, { x: vp.x + vp.w - 250, y }, 12);
    await settled(page);
    await framed(page, 'p-teal');
  });

  await check('Esc steps out; a trackpad pinch zooms in and snaps', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-group-b'));
    await settled(page);
    await page.keyboard.press('Escape');
    await settled(page);
    await framed(page, 'p-group-a');
    await page.keyboard.press('Escape');
    await settled(page);
    const c = await centre(page, '[data-panel="p-sky"]');
    await page.evaluate(([x, y]) => {
      for (let i = 0; i < 20; i++) {
        const e = new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: -6, ctrlKey: true, bubbles: true, cancelable: true });
        document.elementFromPoint(x, y).dispatchEvent(e);
        if (!e.defaultPrevented) throw new Error('a ctrl-wheel reached the browser (page zoom)');
      }
    }, [c.x, c.y]);
    await page.waitForTimeout(250);
    await settled(page);
    await framed(page, 'p-sky');
  });

  await check('an animated framing settles exactly on the workspace', async (page) => {
    await page.locator('[data-panel="p-group-b"] .fx-zoom').tap();
    await settled(page);
    await framed(page, 'p-group-b');
  }, { motion: true });

  await check('the framing survives a reload', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-indigo'));
    await settled(page);
    await page.waitForTimeout(500); // the save is debounced
    await page.reload({ waitUntil: 'networkidle' });
    await settled(page);
    await framed(page, 'p-indigo');
  });

  // ---------------------------------------------------------------- Arrange (P2)

  await check('Arrange: content stops taking input; dividers appear with a 44px handle', async (page) => {
    const before = await page.evaluate(() => getComputedStyle(document.querySelector('[data-content="sky"]')).pointerEvents);
    must(before !== 'none', 'content takes no input outside Arrange');
    must((await page.locator('.fx-divider').count()) === 0, 'dividers show outside Arrange');
    await page.locator('.fx-bottombar').getByRole('button', { name: 'Arrange', exact: true }).tap();
    await settled(page);
    must((await page.locator('.fx-viewport[data-arranging]').count()) === 1, 'not arranging');
    const after = await page.evaluate(() => getComputedStyle(document.querySelector('[data-content="sky"]')).pointerEvents);
    must(after === 'none', `content pointer-events is ${after} in Arrange`);
    const d = await rect(page, '[data-divider="mid:0"]');
    const sky = await rect(page, '[data-panel="p-sky"]');
    const amber = await rect(page, '[data-panel="p-amber"]');
    must(d.w >= 43.5 && d.h >= 43.5, `the divider handle is ${fmt(d)}`);
    const mid = d.x + d.w / 2;
    must(mid > sky.x + sky.w - TOL && mid < amber.x + TOL, `the divider at ${mid.toFixed(0)} is not on the seam (${(sky.x + sky.w).toFixed(0)}–${amber.x.toFixed(0)})`);
    for (const name of ['Back', 'Undo', 'Redo', 'Done']) must(await page.locator('.fx-bottombar').getByRole('button', { name, exact: true }).isVisible(), `no ${name} button`);
  });

  await check('Arrange: drag a tab beside a panel; the same content element lands there; Undo and Redo', async (page) => {
    await page.evaluate(() => window.__fractal.setArranging(true));
    await settled(page);
    await page.evaluate(() => (window.__rose = document.querySelector('[data-content="rose"]')));
    const a = await centre(page, '[data-tab="rose"]');
    const sky = await rect(page, '[data-panel="p-sky"]');
    await oneFinger(page, chromium, a, { x: sky.x + sky.w * 0.9, y: sky.y + sky.h * 0.6 }, 20);
    await settled(page);
    const rose = await page.evaluate(() => {
      const d = window.__fractal.getDoc();
      const idx = [...document.querySelectorAll('[data-panel]')].find((f) => f.querySelector('[data-tab="rose"]'));
      return { panel: idx?.dataset.panel, amber: d.root.children[1].children.at(-1).tabs };
    });
    must(rose.panel && rose.panel !== 'p-amber', `Rose is still in ${rose.panel}`);
    must(rose.amber.join() === 'amber', `Amber's panel holds ${rose.amber}`);
    const r = await rect(page, `[data-panel="${rose.panel}"]`);
    const s2 = await rect(page, '[data-panel="p-sky"]');
    must(Math.abs(r.y - s2.y) <= TOL && r.x > s2.x + s2.w, `Rose's panel ${fmt(r)} is not right of Sky ${fmt(s2)}`);
    must(await page.evaluate(() => document.querySelector('[data-content="rose"]') === window.__rose), 'the content element was recreated');
    must((await page.locator('[data-lifted]').count()) === 0, 'something is still dimmed');
    must((await page.locator('.fx-card, .fx-drop').count()) === 0, 'the card or outline stayed');
    const bar = page.locator('.fx-bottombar');
    await bar.getByRole('button', { name: 'Undo', exact: true }).tap();
    await settled(page);
    const undone = await page.evaluate(() => [...document.querySelectorAll('[data-panel="p-amber"] .fx-tab')].map((t) => t.dataset.tab).join());
    must(undone === 'amber,rose', `after Undo, Amber's tabs are ${undone}`);
    must(await bar.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), 'Undo is still enabled');
    await bar.getByRole('button', { name: 'Redo', exact: true }).tap();
    await settled(page);
    const redone = await page.evaluate(() => [...document.querySelectorAll('[data-panel="p-amber"] .fx-tab')].map((t) => t.dataset.tab).join());
    must(redone === 'amber', `after Redo, Amber's tabs are ${redone}`);
    await page.waitForTimeout(500); // the save is debounced
    await page.reload({ waitUntil: 'networkidle' });
    await settled(page);
    const kept = await page.evaluate(() => [...document.querySelectorAll('[data-panel="p-amber"] .fx-tab')].map((t) => t.dataset.tab).join());
    must(kept === 'amber', `after a reload, Amber's tabs are ${kept}`);
  });

  await check('Arrange: drag a whole panel onto a tab strip merges the tabs', async (page) => {
    await page.evaluate(() => window.__fractal.setArranging(true));
    await settled(page);
    const from = await centre(page, '[data-app="violet"]');
    const strip = await rect(page, '[data-panel="p-sky"] .fx-tabbar');
    await oneFinger(page, chromium, from, { x: strip.x + strip.w * 0.4, y: strip.y + strip.h / 2 }, 20);
    await settled(page);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-panel="p-sky"] .fx-tab')].map((t) => t.dataset.tab).join());
    must(tabs === 'sky,violet', `Sky's strip holds ${tabs}`);
    must((await page.locator('[data-panel="p-violet"]').count()) === 0, 'the moved panel is still there');
    const f = await rect(page, '[data-panel="p-sky"]');
    const vp = await rect(page, '.fx-viewport');
    must(Math.abs(f.y + f.h - (vp.y + vp.h)) <= TOL, `the merged row should now reach the bottom (${fmt(f)}): Violet's row is gone`);
  });

  await check('Arrange: a drag released over nothing changes nothing', async (page) => {
    await page.evaluate(() => window.__fractal.setArranging(true));
    await settled(page);
    const before = await page.evaluate(() => JSON.stringify(window.__fractal.getDoc().root));
    const a = await centre(page, '[data-tab="rose"]');
    await oneFinger(page, chromium, a, { x: a.x, y: 30 }, 12); // the top bar: no target
    await settled(page);
    const after = await page.evaluate(() => JSON.stringify(window.__fractal.getDoc().root));
    must(before === after, 'the layout changed');
    await page.waitForTimeout(300);
    must((await page.locator('[data-lifted], .fx-card, .fx-drop').count()) === 0, 'the drag left something behind');
  });

  await check('Arrange: a divider drag moves the seam by the dragged amount', async (page) => {
    await page.evaluate(() => window.__fractal.setArranging(true));
    await settled(page);
    const sky = await rect(page, '[data-panel="p-sky"]');
    const d = await centre(page, '[data-divider="mid:0"]');
    await oneFinger(page, chromium, d, { x: d.x + 50, y: d.y }, 10);
    await settled(page);
    const after = await rect(page, '[data-panel="p-sky"]');
    must(Math.abs(after.w - (sky.w + 50)) <= 2, `Sky went from ${sky.w.toFixed(0)} to ${after.w.toFixed(0)} wide, not +50`);
    const e = await centre(page, '[data-divider="mid:0"]');
    must(Math.abs(e.x - (d.x + 50)) <= 2, `the divider is at ${e.x.toFixed(0)}, not ${(d.x + 50).toFixed(0)}`);
  });

  if (failures.length) throw new Error(`fractal e2e: ${failures.length} failure(s)\n  - ${failures.join('\n  - ')}`);
}

async function settled(page) {
  await page.waitForSelector('[data-fx-settled]', { state: 'attached', timeout: 5000 });
}


async function centre(page, selector) {
  const r = await rect(page, selector);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// Touch input: Chromium gets real touches (CDP), which is what the browser's own scrolling and
// zooming react to; WebKit can't synthesize multi-touch, so it gets the same Pointer Events
// dispatched on whatever is under each finger (Draw's twoFingers pattern).
async function twoFingers(page, chromium, a0, b0, a1, b1, steps) {
  const at = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
  if (chromium) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (a, b) => [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(a0, b0) });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(at(a0, a1, i / steps), at(b0, b1, i / steps)) });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else await synthetic(page, [[a0, a1], [b0, b1]], steps);
  await page.waitForTimeout(50);
}

async function oneFinger(page, chromium, a0, a1, steps) {
  const at = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
  if (chromium) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a0.x, y: a0.y, id: 1 }] });
    for (let i = 1; i <= steps; i++) {
      const p = at(a0, a1, i / steps);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else await synthetic(page, [[a0, a1]], steps);
  await page.waitForTimeout(50);
}

async function synthetic(page, fingers, steps) {
  await page.evaluate(async ({ fingers, steps }) => {
    const at = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
    const targets = fingers.map(([a]) => document.elementFromPoint(a.x, a.y) ?? document.body);
    const fire = (type, i, p) =>
      targets[i].dispatchEvent(new PointerEvent(type, { pointerId: i + 1, pointerType: 'touch', isPrimary: i === 0, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true }));
    fingers.forEach(([a], i) => fire('pointerdown', i, a));
    for (let s = 1; s <= steps; s++) {
      fingers.forEach(([a, b], i) => fire('pointermove', i, at(a, b, s / steps)));
      await new Promise((r) => setTimeout(r, 16));
    }
    fingers.forEach(([, b], i) => fire('pointerup', i, b));
  }, { fingers, steps });
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
