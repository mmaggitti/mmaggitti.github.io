// Surprisal NFL Week 7 end-to-end test, run by scripts/smoke-test.mjs against the built site
// (Chromium in the cloud container, WebKit in CI). Throws on the first failure.
//
// What it guards: the "What's a bit?" explainer sits at the top, between the title and the first
// score, and its example matches the feed's #1; the feed ranks and filters; "See the math" lands just
// below the sticky bar; and the site rules the page was adapted to (self-hosted fonts, no third-party
// requests, 44pt tap floor, the text floor, light and dark, no sideways scroll on small phones).

const PHONE = { viewport: { width: 440, height: 956 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const PATH = '/surprisal-nfl-week-7/';
const TAP_MIN = 44;
const TEXT_MIN = 11.25; // --text-sm at the site's 75% scale; this page sizes in rem against a 16px root
const SAFARI_TAB_H = 796; // what a Safari tab leaves of the 956-point screen

export default async function run({ browser, origin }) {
  await load(browser, origin);
  await explainer(browser, origin);
  await feed(browser, origin);
  await seeTheMath(browser, origin);
  await themes(browser, origin);
  await smallPhones(browser, origin);
}

// 1. Load: every face from this origin, nothing from anywhere else, no errors, the floors hold.
async function load(browser, origin) {
  await withPage(browser, origin, {}, async (page, errors, external) => {
    for (const font of ['400 16px Barlow', '600 16px Barlow', '700 16px Barlow', '700 16px "Barlow Condensed"', '400 16px "JetBrains Mono"', '600 16px "JetBrains Mono"']) {
      const ok = await page.evaluate((f) => document.fonts.load(f).then((faces) => faces.length > 0 && faces.every((x) => x.status === 'loaded'), () => false), font);
      must(ok, `font ${font} did not load from this origin`);
    }
    must(external.size === 0, `third-party requests: ${[...external].join(', ')}`);
    must(errors.length === 0, errors.join('\n'));
    await noSidewaysScroll(page, 'on load');
    await tapFloor(page, 'on load');
    await textFloor(page, 'on load');
  });
}

// 2. The explainer: under the title, above the first score, on the first screen of a Safari tab,
// and its worked example is the feed's own #1 by result.
async function explainer(browser, origin) {
  await withPage(browser, origin, {}, async (page) => {
    const r = await page.evaluate(() => {
      const note = document.querySelector('.bit-note');
      const b = note?.getBoundingClientRect();
      const first = document.querySelector('#rows .game');
      return {
        heading: note?.querySelector('h2')?.textContent.trim(),
        text: note?.querySelector('p')?.textContent ?? '',
        note: b && { top: b.top, bottom: b.bottom, left: b.left, right: b.right },
        h1: document.querySelector('.hero h1').getBoundingClientRect().bottom,
        // every score on the page: none may draw above the explainer
        scoreTop: Math.min(...[...document.querySelectorAll('.big b, .g-bits b, .hero-num b, .slate-big b')].map((el) => el.getBoundingClientRect().top)),
        vw: document.documentElement.clientWidth,
        first: first && { team: first.querySelector('.g-team.won .ab').textContent, bits: first.querySelector('.g-bits b').textContent },
      };
    });
    must(r.note, 'no explainer');
    must(r.heading === 'What’s a bit?', `the explainer's heading is "${r.heading}"`);
    must(r.note.top >= r.h1 && r.note.bottom <= r.scoreTop, `the explainer (${r.note.top.toFixed(0)}–${r.note.bottom.toFixed(0)}) is not between the title (${r.h1.toFixed(0)}) and the first score (${r.scoreTop.toFixed(0)})`);
    must(r.note.bottom <= SAFARI_TAB_H, `the explainer ends at ${r.note.bottom.toFixed(0)}px, past a Safari tab's first screen`);
    must(r.note.left >= 0 && r.note.right <= r.vw, 'the explainer runs off the screen');
    must(/is 1 bit/.test(r.text) && /halves the chance/.test(r.text), 'the explainer does not say what one bit is');
    must(r.first?.team === 'NYG' && r.text.includes(`scores ${r.first.bits} bits`),
      `the explainer's example (${r.text.match(/scores [\d.]+ bits/)?.[0]}) is not the feed's #1 (${r.first?.team} ${r.first?.bits})`);
  });
}

// 3. The feed: 13 finals, ranked high to low by either lens; each kickoff window narrows it.
async function feed(browser, origin) {
  await withPage(browser, origin, {}, async (page) => {
    const rows = () => page.evaluate(() => [...document.querySelectorAll('#rows .game')].map((g) => ({
      won: g.querySelector('.g-team.won .ab').textContent,
      bits: Number(g.querySelector('.g-bits b').textContent),
    })));
    const descending = (list) => list.every((x, i) => i === 0 || list[i - 1].bits >= x.bits);
    const pressed = (group) => page.evaluate((g) => [...document.querySelectorAll(`${g} button[aria-pressed="true"]`)].map((b) => b.textContent), group);

    let list = await rows();
    must(list.length === 13, `${list.length} games on load, not 13`);
    must(list[0].won === 'NYG' && list[0].bits === 2.35, `#1 by result is ${list[0].won} ${list[0].bits}`);
    must(descending(list), 'the result ranking is not high to low');
    must(await page.isVisible('#pending'), 'the Monday-night note is hidden under All');

    await page.click('#lens-margin');
    must(JSON.stringify(await pressed('#lenses')) === '["Margin"]', 'Margin is not the pressed lens');
    list = await rows();
    must(list.length === 13 && list[0].won === 'TB' && list[0].bits === 6.11, `#1 by margin is ${list[0].won} ${list[0].bits}`);
    must(descending(list), 'the margin ranking is not high to low');

    for (const [chip, n, text] of [['#win-thu', 1, 'TNF'], ['#win-early', 8, 'Sun early'], ['#win-late', 3, 'Sun late'], ['#win-snf', 1, 'SNF']]) {
      await page.click(chip);
      list = await rows();
      must(list.length === n, `${chip}: ${list.length} games, not ${n}`);
      must(descending(list), `${chip}: not high to low`);
      const shown = await page.textContent('#chaos-label');
      must(shown === `MARGIN CHAOS · WEEK 7 · ${text.toUpperCase()}`, `${chip}: the summary says "${shown}"`);
      must(JSON.stringify(await pressed('#windows')) === JSON.stringify([text]), `${chip}: the wrong chip is pressed`);
      must(!(await page.isVisible('#pending')), `${chip}: the Monday-night note shows outside All`);
    }
    await page.click('#win-all');
    must((await rows()).length === 13, 'All does not bring back the 13 games');
  });
}

// 4. "See the math" on the #1 game lands its worked example just below the sticky bar, not under it.
async function seeTheMath(browser, origin) {
  await withPage(browser, origin, { reducedMotion: 'reduce' }, async (page) => {
    await page.click('#rows .game:first-child .g-link');
    const where = () => page.evaluate(() => {
      const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
      const top = document.getElementById('nyg-hou').getBoundingClientRect().top;
      return { hash: location.hash, bar, top };
    });
    await waitFor(async () => { const w = await where(); return w.hash === '#nyg-hou' && w.top >= w.bar - 1 && w.top <= w.bar + 24; },
      async () => `See the math: ${JSON.stringify(await where())} — the section should start just below the bar`);
  });
}

// 5. Light and dark: the page ground matches the theme-color the status bar is painted with.
async function themes(browser, origin) {
  for (const scheme of ['light', 'dark']) {
    await withPage(browser, origin, { colorScheme: scheme }, async (page) => {
      const r = await page.evaluate((s) => ({
        bg: getComputedStyle(document.body).backgroundColor,
        meta: document.querySelector(`meta[name="theme-color"][media="(prefers-color-scheme: ${s})"]`)?.content ?? '',
      }), scheme);
      const hex = r.meta.replace('#', '');
      const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
      must(r.meta && r.bg === rgb, `${scheme}: the page is ${r.bg}, its theme-color ${r.meta}`);
    });
  }
}

// 6. Smaller phones: no sideways scroll and the tap floor holds at 375 and 320 wide.
async function smallPhones(browser, origin) {
  for (const width of [375, 320]) {
    await withPage(browser, origin, { viewport: { width, height: 700 } }, async (page) => {
      await noSidewaysScroll(page, `${width} wide`);
      await tapFloor(page, `${width} wide`);
    });
  }
}

async function withPage(browser, origin, opts, fn) {
  const context = await browser.newContext({ ...PHONE, ...opts });
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
    await page.goto(origin + PATH, { waitUntil: 'networkidle' });
    await fn(page, errors, external);
  } finally {
    await context.close();
  }
}

async function noSidewaysScroll(page, where) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  must(r.sw <= r.cw, `${where}: the page scrolls sideways (${r.sw} > ${r.cw})`);
}

// Every visible button and link is at least 44pt both ways.
async function tapFloor(page, where) {
  const small = await page.evaluate((min) => {
    const out = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest('[hidden]')) continue;
      if (r.width < min - 0.5 || r.height < min - 0.5) {
        out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}" ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
      }
    }
    return [...new Set(out)];
  }, TAP_MIN);
  must(small.length === 0, `${where}: tap targets under ${TAP_MIN}pt:\n  ${small.join('\n  ')}`);
}

// Every rendered piece of text draws at TEXT_MIN or more; chart labels are measured as drawn, after
// the chart's viewBox has scaled them.
async function textFloor(page, where) {
  const small = await page.evaluate((min) => {
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!n.nodeValue.trim() || !el || el.closest('script, style') || !el.getClientRects().length) continue;
      let size = parseFloat(getComputedStyle(el).fontSize);
      if (el instanceof SVGElement) {
        const m = el.getScreenCTM();
        size *= m ? Math.hypot(m.a, m.b) : 1;
      }
      if (size < min - 0.01) out.push(`${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''} "${n.nodeValue.trim().slice(0, 24)}" ${size.toFixed(2)}px`);
    }
    return [...new Set(out)];
  }, TEXT_MIN);
  must(small.length === 0, `${where}: text under ${TEXT_MIN}px:\n  ${small.join('\n  ')}`);
}

function must(cond, message) {
  if (!cond) throw new Error(message);
}

async function waitFor(fn, message, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(typeof message === 'function' ? await message() : message);
}
