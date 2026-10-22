// Fractal end-to-end test, run by scripts/smoke-test.mjs against the built site (Chromium in the
// cloud container, WebKit in CI). Every check runs; failures are collected and thrown together, so
// one CI run shows all of them.
//
// Geometry is asserted, not just presence: a framed panel must fill the workspace, nested panels
// must sit inside their host's dock below its caption, the next page must sit exactly one workspace
// width plus a gap to the right, and app content must be the same element after moves.

const TOL = 1; // px
// Tap a caption control on its glyph: a caption's 44pt touch box overhangs its small row, so the top
// row's box starts above the screen, and the centre of its visible part would land on the row below.
const GLYPH = { position: { x: 22, y: 22 } };
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
      const sel = '.fx-caption .fx-tab, .fx-capsule button';
      for (const e of document.querySelectorAll(sel)) {
        if (getComputedStyle(e).display === 'none') continue;
        const cap = e.closest('.fx-caption');
        if (cap && (getComputedStyle(cap).visibility === 'hidden' || getComputedStyle(cap).display === 'none')) continue;
        const r = e.getBoundingClientRect();
        // A caption drawn smaller is on a miniature: tapping the miniature zooms instead.
        const scale = cap ? r.height / e.offsetHeight : 1;
        if (scale < 0.999) continue;
        if (r.height < 43.5 || r.width < 43.5) out.push(`${e.className} ${e.textContent.trim().slice(0, 20)} ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
      }
      return out;
    });
    must(!small.length, `targets under 44px: ${small.join(', ')}`);
    // ...while the caption rows themselves stay small: no bars.
    const rows = await page.evaluate(() => [...document.querySelectorAll('.fx-caption')].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.getBoundingClientRect().height));
    must(rows.length > 0 && rows.every((h) => h <= 20), `caption rows are ${rows.map((h) => h.toFixed(0)).join(', ')}px tall`);
  });

  await check('a caption frames a nested group: it fills the workspace, bare, and its tiles sit in its dock', async (page) => {
    await page.locator('[data-caption="p-group-b"] [data-tab="group-b"]').tap();
    await settled(page);
    await framed(page, 'p-group-b');
    must((await page.locator('[data-caption="p-group-b"]').isVisible()) === false, 'the framed group still shows its caption');
    const g = await page.evaluate(() => {
      const box = (s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      return {
        dock: box('[data-dock="group-b"]'),
        kids: [box('[data-panel="p-teal"]'), box('[data-panel="p-indigo"]')],
        caps: [box('[data-caption="p-teal"]'), box('[data-caption="p-indigo"]')],
      };
    });
    g.kids.forEach((k, i) => {
      must(inside(k, g.dock), `nested panel ${fmt(k)} is outside the dock ${fmt(g.dock)}`);
      must(Math.abs(g.caps[i].y - k.y) <= TOL && Math.abs(g.caps[i].h - 18) <= TOL, `caption ${fmt(g.caps[i])} doesn't head its tile ${fmt(k)}`);
    });
    const trail = await levels(page);
    must(trail.join('/') === 'Home/Group A/Group B', `the levels read ${trail.join(' › ')}`);
    must((await page.locator('.fx-capsule-here').textContent()) === 'Group B', 'the capsule does not name Group B');
  });

  await check('the overview is a map: a tap on a tile zooms one level toward it; inside, full-size tiles are live', async (page) => {
    must(await page.evaluate(() => document.querySelector('[data-app="sky"]').hasAttribute('inert')), 'Sky takes input at the overview');
    let c = await centre(page, '[data-app="teal"]');
    await page.touchscreen.tap(c.x, c.y);
    await settled(page);
    await framed(page, 'p-group-a');
    c = await centre(page, '[data-app="teal"]');
    await page.touchscreen.tap(c.x, c.y); // a miniature at this framing: one more level
    await settled(page);
    await framed(page, 'p-group-b');
    must(!(await page.evaluate(() => document.querySelector('[data-app="teal"]').hasAttribute('inert'))), 'Teal is not live at full size');
    c = await centre(page, '[data-app="teal"]');
    await page.touchscreen.tap(c.x, c.y); // live: the tap is the app's
    await page.waitForTimeout(400);
    await settled(page);
    await framed(page, 'p-group-b');
  });

  await check('caption taps: another name switches tab, the shown name zooms, and again steps out', async (page) => {
    await page.locator('[data-tab="rose"]').tap();
    await settled(page);
    must((await page.locator('[data-tab="rose"][aria-selected="true"]').count()) === 1, 'Rose was not selected');
    must((await page.locator('.fx-frame[data-framed]').count()) === 0, 'switching a tab zoomed');
    await page.locator('[data-tab="rose"]').tap();
    await settled(page);
    await framed(page, 'p-amber');
    must(await page.locator('[data-caption="p-amber"]').isVisible(), 'a framed panel with two tabs lost its tab switcher');
    await page.locator('[data-tab="rose"]').tap();
    await settled(page);
    must((await page.locator('.fx-frame[data-framed]').count()) === 0, 'tapping the framed name did not step out');
  });

  await check('Back steps out one level, through the host, to the overview', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-teal'));
    await settled(page);
    await framed(page, 'p-teal');
    const back = page.locator('.fx-capsule [data-nav="back"]');
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
    await page.locator('[data-caption="p-sky"] [data-tab="sky"]').tap();
    await settled(page);
    await framed(page, 'p-sky');
    const vp = await rect(page, '.fx-viewport');
    const next = await rect(page, '[data-panel="p-amber"]');
    must(Math.abs(next.x - (vp.x + vp.w + GAP)) <= TOL && Math.abs(next.w - vp.w) <= TOL, `next page is at ${fmt(next)}, viewport ${fmt(vp)}`);
    must((await page.locator('.fx-dots').getAttribute('aria-label')) === 'Panel 1 of 2', 'the dots do not say page 1 of 2');
    await (await openSheet(page)).getByRole('button', { name: 'Next ›' }).tap();
    await settled(page);
    await framed(page, 'p-amber');
    const page2 = await page.locator('.fx-dots').getAttribute('aria-label');
    must(page2 === 'Panel 2 of 2', `the dots say ${page2}`);
  });

  await check('a block is the same element after moving between levels, and blocks differ in colour', async (page) => {
    await page.locator('[data-caption="p-amber"] [data-tab="amber"]').tap();
    await settled(page);
    await page.evaluate(() => (window.__block = document.querySelector('[data-content="amber"] .block')));
    await page.evaluate(() => window.__fractal.frame('p-teal'));
    await settled(page);
    await (await openSheet(page)).getByRole('button', { name: 'Overview', exact: true }).tap();
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
    const trail = await levels(page);
    must(trail.length === 2 && f === 0, `after pinching out: ${trail.length} levels, ${f} framed panels (expected the row, one level up)`);
  });

  await check('a swipe across the capsule flips to the neighbour, without opening the sheet', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-amber'));
    await settled(page);
    const c = await centre(page, '.fx-capsule-name');
    await oneFinger(page, chromium, { x: c.x - 40, y: c.y }, { x: c.x + 160, y: c.y }, 10);
    await settled(page);
    await framed(page, 'p-sky');
    must((await page.getByRole('dialog', { name: 'Places and actions' }).count()) === 0, 'the swipe opened the sheet');
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
    await page.locator('[data-caption="p-group-b"] [data-tab="group-b"]').tap();
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
    await page.evaluate(() => window.__fractal.frame('p-sky'));
    await settled(page);
    const before = await page.evaluate(() => getComputedStyle(document.querySelector('[data-content="sky"]')).pointerEvents);
    must(before !== 'none', 'framed content takes no input outside Arrange');
    await page.evaluate(() => window.__fractal.frame(null));
    await settled(page);
    must((await page.locator('.fx-divider').count()) === 0, 'dividers show outside Arrange');
    await (await openSheet(page)).getByRole('button', { name: 'Arrange', exact: true }).tap();
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
    for (const name of ['Undo', 'Redo', 'Done']) must(await page.locator('.fx-capsule').getByRole('button', { name, exact: true }).isVisible(), `no ${name} button`);
    must((await page.locator('.fx-capsule [data-nav="back"]').count()) === 1, 'no ‹ in the Arrange capsule');
  });

  await check('Arrange: drag a tab beside a panel; the same content element lands there; Undo and Redo', async (page) => {
    await page.evaluate(() => window.__fractal.setArranging(true));
    await settled(page);
    await page.evaluate(() => (window.__rose = document.querySelector('[data-content="rose"]')));
    const a = await centre(page, '[data-tab="rose"]');
    const sky = await rect(page, '[data-panel="p-sky"]');
    await dragPath(page, chromium, [a, { x: sky.x + sky.w * 0.9, y: sky.y + sky.h * 0.6, hold: 200 }]);
    await settled(page);
    const rose = await page.evaluate(() => {
      const d = window.__fractal.getDoc();
      const cap = document.querySelector('[data-tab="rose"]')?.closest('[data-caption]');
      return { panel: cap?.dataset.caption, amber: d.root.children[1].children.at(-1).tabs };
    });
    must(rose.panel && rose.panel !== 'p-amber', `Rose is still in ${rose.panel}`);
    must(rose.amber.join() === 'amber', `Amber's panel holds ${rose.amber}`);
    const r = await rect(page, `[data-panel="${rose.panel}"]`);
    const s2 = await rect(page, '[data-panel="p-sky"]');
    must(Math.abs(r.y - s2.y) <= TOL && r.x > s2.x + s2.w, `Rose's panel ${fmt(r)} is not right of Sky ${fmt(s2)}`);
    must(await page.evaluate(() => document.querySelector('[data-content="rose"]') === window.__rose), 'the content element was recreated');
    must((await page.locator('[data-lifted]').count()) === 0, 'something is still dimmed');
    must((await page.locator('.fx-card, .fx-drop').count()) === 0, 'the card or outline stayed');
    const bar = page.locator('.fx-capsule');
    await bar.getByRole('button', { name: 'Undo', exact: true }).tap();
    await settled(page);
    const undone = await page.evaluate(() => [...document.querySelectorAll('[data-caption="p-amber"] .fx-tab')].map((t) => t.dataset.tab).join());
    must(undone === 'amber,rose', `after Undo, Amber's tabs are ${undone}`);
    must(await bar.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), 'Undo is still enabled');
    await bar.getByRole('button', { name: 'Redo', exact: true }).tap();
    await settled(page);
    const redone = await page.evaluate(() => [...document.querySelectorAll('[data-caption="p-amber"] .fx-tab')].map((t) => t.dataset.tab).join());
    must(redone === 'amber', `after Redo, Amber's tabs are ${redone}`);
    await page.waitForTimeout(500); // the save is debounced
    await page.reload({ waitUntil: 'networkidle' });
    await settled(page);
    const kept = await page.evaluate(() => [...document.querySelectorAll('[data-caption="p-amber"] .fx-tab')].map((t) => t.dataset.tab).join());
    must(kept === 'amber', `after a reload, Amber's tabs are ${kept}`);
  });

  await check('Arrange: drag a whole panel onto a tab strip merges the tabs', async (page) => {
    await page.evaluate(() => window.__fractal.setArranging(true));
    await settled(page);
    const from = await centre(page, '[data-app="violet"]');
    const strip = await rect(page, '[data-caption="p-sky"]');
    await dragPath(page, chromium, [from, { x: strip.x + strip.w * 0.4, y: strip.y + strip.h / 2, hold: 200 }]);
    await settled(page);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-caption="p-sky"] .fx-tab')].map((t) => t.dataset.tab).join());
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
    const pill = await centre(page, '.fx-capsule');
    await dragPath(page, chromium, [a, { ...pill, hold: 200 }]); // nothing drops onto the capsule
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
    await dragPath(page, chromium, [d, { x: d.x + 50, y: d.y, hold: 200 }]);
    await settled(page);
    const after = await rect(page, '[data-panel="p-sky"]');
    must(Math.abs(after.w - (sky.w + 50)) <= 2, `Sky went from ${sky.w.toFixed(0)} to ${after.w.toFixed(0)} wide, not +50`);
    const e = await centre(page, '[data-divider="mid:0"]');
    must(Math.abs(e.x - (d.x + 50)) <= 2, `the divider is at ${e.x.toFixed(0)}, not ${(d.x + 50).toFixed(0)}`);
  });

  await check('Arrange menu: ⋯ adds a block to the right of a panel', async (page) => {
    await page.evaluate(() => window.__fractal.setArranging(true));
    await settled(page);
    const menuBtn = page.locator('[data-caption="p-violet"] .fx-menu-btn');
    must((await menuBtn.textContent()) === '⋯', 'the panel button is not ⋯ in Arrange');
    await menuBtn.tap();
    const sheet = page.getByRole('dialog', { name: 'Panel menu' });
    await sheet.getByRole('group', { name: 'Add block' }).getByRole('button', { name: 'Right', exact: true }).tap();
    await settled(page);
    must((await sheet.count()) === 0, 'the menu stayed open');
    const tab = page.locator('.fx-tab', { hasText: 'Orange' });
    must((await tab.count()) === 1, 'no Orange block was added');
    const panel = await tab.evaluate((t) => t.closest('[data-caption]').dataset.caption);
    const r = await rect(page, `[data-panel="${panel}"]`);
    const v = await rect(page, '[data-panel="p-violet"]');
    must(Math.abs(r.y - v.y) <= TOL && r.x > v.x + v.w, `Orange ${fmt(r)} is not right of Violet ${fmt(v)}`);
    must(await page.locator('.fx-capsule').getByRole('button', { name: 'Undo', exact: true }).isEnabled(), 'adding is not undoable');
  });

  await check('Arrange menu: closing a group asks first, then removes it and what it holds', async (page) => {
    await page.evaluate(() => window.__fractal.setArranging(true));
    await settled(page);
    await page.locator('[data-caption="p-group-b"] .fx-menu-btn').tap(GLYPH);
    const sheet = page.getByRole('dialog', { name: 'Panel menu' });
    await sheet.getByRole('button', { name: 'Close panel', exact: true }).tap();
    const ask = (await sheet.locator('.fx-menu-title').textContent()) ?? '';
    must(/Group B/.test(ask) && /2 things/.test(ask), `the confirmation reads "${ask}"`);
    must((await page.locator('[data-panel="p-group-b"]').count()) === 1, 'it closed before confirming');
    await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
    await settled(page);
    const gone = await page.evaluate(() => ['group-b', 'teal', 'indigo'].filter((a) => window.__fractal.getDoc().apps[a]));
    must(gone.length === 0, `still there: ${gone}`);
    must((await page.locator('[data-panel="p-group-b"], [data-content="teal"]').count()) === 0, 'its elements stayed');
  });

  await check('Arrange menu: move to the top level, and no group into itself', async (page) => {
    await page.evaluate(() => window.__fractal.setArranging(true));
    await settled(page);
    await page.locator('[data-caption="p-group-a"] .fx-menu-btn').tap(GLYPH);
    const sheet = page.getByRole('dialog', { name: 'Panel menu' });
    await sheet.getByRole('button', { name: 'Move to…', exact: true }).tap();
    must(await sheet.locator('[data-dest="group-b"]').isDisabled(), 'Group A can be moved into Group B, inside itself');
    must(await sheet.locator('[data-dest="group-a"]').isDisabled(), 'Group A can be moved into itself');
    await page.keyboard.press('Escape');
    must((await sheet.count()) === 0, 'Esc did not close the menu');
    must((await page.locator('.fx-viewport[data-arranging]').count()) === 1, 'Esc did more than close the menu');
    await page.locator('[data-caption="p-coral"] .fx-menu-btn').tap(GLYPH);
    await sheet.getByRole('button', { name: 'Move to…', exact: true }).tap();
    await sheet.locator('[data-dest=""]').tap();
    await settled(page);
    const c = await rect(page, '[data-panel="p-coral"]');
    const vp = await rect(page, '.fx-viewport');
    const v = await rect(page, '[data-panel="p-violet"]');
    must(Math.abs(c.y + c.h - (vp.y + vp.h)) <= TOL && c.y > v.y, `Coral ${fmt(c)} is not the new bottom row`);
  });

  await check('Arrange: dragging a group into its own dock is refused', async (page) => {
    await page.evaluate(() => window.__fractal.setArranging(true));
    await settled(page);
    const before = await page.evaluate(() => JSON.stringify(window.__fractal.getDoc().root));
    const from = await centre(page, '[data-tab="group-a"]');
    const t = await rect(page, '[data-panel="p-teal"]');
    // Teal's right edge: a drop any panel takes, miniature or not, so only the cycle rule refuses it.
    await dragPath(page, chromium, [from, { x: t.x + t.w * 0.92, y: t.y + t.h * 0.6, hold: 300 }]);
    await settled(page);
    must(before === (await page.evaluate(() => JSON.stringify(window.__fractal.getDoc().root))), 'Group A moved into itself');
  });

  await check('Arrange: holding a drag over Back steps out, and the drop lands at the new level', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-group-b'));
    await settled(page);
    await page.evaluate(() => window.__fractal.setArranging(true));
    await settled(page);
    const visits = await page.evaluate(() => window.__fractal.getDoc().nav.visits.length);
    const tealTab = await centre(page, '[data-tab="teal"]');
    const back = await centre(page, '.fx-capsule [data-nav="back"]');
    await dragPath(page, chromium, [tealTab, { x: tealTab.x + 30, y: tealTab.y + 30 }, { ...back, hold: 900 }], async () => {
      await settled(page);
      await framed(page, 'p-group-a');
      const coral = await rect(page, '[data-panel="p-coral"]');
      return [{ x: coral.x + coral.w * 0.9, y: coral.y + coral.h * 0.6, hold: 300 }];
    });
    await settled(page);
    await framed(page, 'p-group-a');
    const parent = await page.evaluate(() => {
      const d = window.__fractal.getDoc();
      const find = (n, id, up) => (n.kind === 'panel' ? (n.tabs.includes(id) ? up : null) : n.children.map((c) => find(c, id, n)).find(Boolean) ?? null);
      const row = find(d.apps['group-a'].dock, 'teal', null);
      return row ? row.children.map((c) => c.tabs?.join() ?? c.kind) : null;
    });
    must(parent && parent.indexOf('teal') === parent.indexOf('coral') + 1, `Teal is not right of Coral inside Group A: ${JSON.stringify(parent)}`);
    const after = await page.evaluate(() => window.__fractal.getDoc().nav.visits.length);
    must(after === visits + 1, `history grew by ${after - visits}, not 1 (only the drop's framing is recorded)`);
  });

  await check('an empty workspace offers Add block', async (page) => {
    await page.evaluate(() => {
      const d = window.__fractal.getDoc();
      window.__fractal.setDoc({ ...d, root: null, apps: {} }, { animate: false });
    });
    await settled(page);
    const add = page.locator('.fx-empty').getByRole('button', { name: 'Add block', exact: true });
    await add.tap();
    await settled(page);
    must((await page.locator('.fx-frame').count()) === 1, 'no block was added');
    must((await page.locator('.fx-empty').count()) === 0, 'the empty state stayed');
  });

  // ---------------------------------------------------------------- the capsule (C2)

  await check('no bars: the workspace runs to the bottom edge under a small floating capsule', async (page) => {
    must((await page.locator('.fx-topbar, .fx-bottombar').count()) === 0, 'an old bar is still there');
    await page.evaluate(() => window.__fractal.frame('p-sky'));
    await settled(page);
    const vp = await rect(page, '.fx-viewport');
    const h = await page.evaluate(() => window.innerHeight);
    must(Math.abs(vp.y + vp.h - h) <= TOL, `the workspace ends at ${(vp.y + vp.h).toFixed(0)}, the screen at ${h}`);
    const cap = await rect(page, '.fx-capsule');
    const sky = await rect(page, '[data-panel="p-sky"]');
    must(cap.h >= 43.5 && cap.h <= 52, `the capsule is ${cap.h.toFixed(0)}px tall`);
    must(cap.w < 300 && Math.abs(cap.x + cap.w / 2 - 220) <= 1, `the capsule is ${fmt(cap)}`);
    must(inside(cap, sky), `the capsule ${fmt(cap)} doesn't float over the framed tile ${fmt(sky)}`);
    must((await page.locator('.fx-capsule-here').textContent()) === 'Sky', 'the capsule does not name Sky');
  });

  await check('a mouse drag across the capsule name pages without also opening the sheet', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-amber'));
    await settled(page);
    const n = await rect(page, '.fx-capsule-name');
    must(n.w >= 60, `the name button is only ${n.w.toFixed(0)}px wide`);
    const y = n.y + n.h / 2;
    await page.mouse.move(n.x + 5, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(n.x + 5 + i * 9, y);
    await page.mouse.up(); // still on the name: the browser clicks it
    await settled(page);
    await framed(page, 'p-sky');
    must((await page.getByRole('dialog', { name: 'Places and actions' }).count()) === 0, 'the swipe also opened the sheet');
  });

  await check('the capsule sheet: jump to a level, Overview, history back', async (page) => {
    await page.evaluate(() => window.__fractal.frame('p-teal'));
    await settled(page);
    await (await openSheet(page)).getByRole('button', { name: 'Group A', exact: true }).tap();
    await settled(page);
    await framed(page, 'p-group-a');
    await (await openSheet(page)).getByRole('button', { name: 'Overview', exact: true }).tap();
    await settled(page);
    must((await page.locator('.fx-frame[data-framed]').count()) === 0, 'Overview did not show everything');
    await (await openSheet(page)).getByRole('button', { name: 'Back in history' }).tap();
    await settled(page);
    await framed(page, 'p-group-a');
  });

  await check('long-press a name: Arrange turns on and the drag carries on in one motion', async (page) => {
    const a = await centre(page, '[data-tab="rose"]');
    const sky = await rect(page, '[data-panel="p-sky"]');
    await dragPath(page, chromium, [a, { x: a.x + 2, y: a.y + 1, hold: 800 }, { x: sky.x + sky.w * 0.9, y: sky.y + sky.h * 0.6, hold: 250 }]);
    await settled(page);
    must((await page.locator('.fx-viewport[data-arranging]').count()) === 1, 'the hold did not turn Arrange on');
    const amber = await page.evaluate(() => [...document.querySelectorAll('[data-caption="p-amber"] .fx-tab')].map((t) => t.dataset.tab).join());
    must(amber === 'amber', `Rose didn't move: Amber holds ${amber}`);
  });

  await check('a long-press that ends where it began picks up and drops, and never zooms', async (page) => {
    const a = await centre(page, '[data-tab="sky"]');
    await dragPath(page, chromium, [a, { x: a.x + 1, y: a.y, hold: 800 }]);
    // Neither engine here fires a click after a long press, but a browser may: deliver one. Arrange
    // is on by then, where a name's click only selects, so it must not zoom.
    await page.locator('[data-tab="sky"]').dispatchEvent('click');
    await page.waitForTimeout(300);
    await settled(page);
    must((await page.locator('.fx-viewport[data-arranging]').count()) === 1, 'the hold did not turn Arrange on');
    must((await page.locator('.fx-frame[data-framed]').count()) === 0, 'the held name also zoomed');
  });

  // ---------------------------------------------------------------- looks (C3)

  await check('Style: each look lays out soundly, as specified, and is remembered', async (page) => {
    const spec = { mosaic: { gap: 1, round: false }, layered: { gap: 9, round: true }, bento: { gap: 6, round: true } };
    for (const [look, want] of Object.entries(spec)) {
      const sheet = await openSheet(page);
      await sheet.getByRole('group', { name: 'Style' }).getByRole('button', { name: look[0].toUpperCase() + look.slice(1), exact: true }).tap();
      await settled(page);
      await page.keyboard.press('Escape');
      must((await page.locator(`.fx-viewport[data-look="${look}"]`).count()) === 1, `${look}: not applied`);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      must(sideways === 0, `${look}: the page scrolls sideways by ${sideways}px`);
      const sky = await rect(page, '[data-panel="p-sky"]');
      const amber = await rect(page, '[data-panel="p-amber"]');
      const gap = amber.x - (sky.x + sky.w);
      must(Math.abs(gap - want.gap) <= 0.6, `${look}: Sky and Amber are ${gap.toFixed(1)}px apart, not ${want.gap}`);
      const radius = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-app="sky"]')).borderTopLeftRadius));
      must(want.round ? radius > 0 : radius === 0, `${look}: Sky's corner radius is ${radius}px`);
      const shadow = await page.evaluate(() => getComputedStyle(document.querySelector('[data-panel="p-sky"]'), '::before').boxShadow);
      must((look === 'layered') === (shadow !== 'none'), `${look}: Sky's card shadow is ${shadow}`);
    }
    await (await openSheet(page)).getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Mosaic', exact: true }).tap();
    await settled(page);
    await page.reload({ waitUntil: 'networkidle' });
    await settled(page);
    must((await page.locator('.fx-viewport[data-look="mosaic"]').count()) === 1, 'the look was not remembered');
  });

  if (failures.length) throw new Error(`fractal e2e: ${failures.length} failure(s)\n  - ${failures.join('\n  - ')}`);
}

/** Open the capsule's sheet; returns it. */
async function openSheet(page) {
  await page.locator('.fx-capsule-name').tap();
  const sheet = page.getByRole('dialog', { name: 'Places and actions' });
  await sheet.waitFor();
  return sheet;
}

/** The level trail, as the capsule's sheet lists it. */
async function levels(page) {
  const sheet = await openSheet(page);
  const out = (await sheet.locator('.fx-levels button').allTextContents()).map((t) => t.trim());
  await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
  return out;
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

// A one-finger drag through points, pausing `hold` ms at any point that has one. `then` runs at the
// end of the path (finger still down) and may return more points. Drops end with a hold, the finger
// at rest, as a real one does: a drag lifted at speed makes Chromium start a fling, and the next
// tap (stopping that fling) then fires no click.
async function dragPath(page, chromium, points, then) {
  const segs = async (send, pts, from) => {
    let prev = from;
    for (const p of pts) {
      for (let i = 1; i <= 8; i++) await send({ x: prev.x + ((p.x - prev.x) * i) / 8, y: prev.y + ((p.y - prev.y) * i) / 8 });
      if (p.hold) await page.waitForTimeout(p.hold);
      prev = p;
    }
    return prev;
  };
  if (chromium) {
    const cdp = await page.context().newCDPSession(page);
    const send = async (p) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
      await page.waitForTimeout(16);
    };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0].x, y: points[0].y, id: 1 }] });
    let last = await segs(send, points.slice(1), points[0]);
    if (then) last = await segs(send, (await then()) ?? [], last);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.evaluate((p) => {
      window.__dragTarget = document.elementFromPoint(p.x, p.y) ?? document.body;
      window.__dragTarget.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true }));
    }, points[0]);
    const send = async (p) => {
      await page.evaluate((p) => window.__dragTarget.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true })), p);
      await page.waitForTimeout(16);
    };
    let last = await segs(send, points.slice(1), points[0]);
    if (then) last = await segs(send, (await then()) ?? [], last);
    await page.evaluate((p) => window.__dragTarget.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true })), last);
  }
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
