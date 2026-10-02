// Co-write end-to-end test, run by the site's scripts/smoke-test.mjs against the built site
// (Chromium in cloud sessions, WebKit in CI). Every check runs; the test throws once, listing all
// failures, so one CI run shows everything WebKit disagrees with.
//
// The relay is a stand-in (test/relay.mjs) behind Playwright's routeWebSocket: CI never touches
// the public relay. Two people, Anastasia and Benedikt, each in their own browser context (their
// own storage, like two phones), write in one document. Then the layout is checked at the three
// sizes Core & Seams requires (DOCTRINE §4).

import { createRelay } from './relay.mjs';

const APP = 'cowrite';
const SIZES = [
  { name: 'iphone', viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, touch: true },
  { name: 'ipad', viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true, touch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, touch: false },
];
const ANA = { name: 'Anastasia', color: '#e5484d' };
const BEN = { name: 'Benedikt', color: '#0d74ce' };
const CY = { name: 'Cyrilla', color: '#2b9a66' };

// Polls from Node, not inside the page: the app's CSP blocks eval, so a predicate can't be rebuilt
// from source in the page. `read` is a plain function page.evaluate can send.
async function until(page, read, predicate, what, timeout = 20_000) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    last = await page.evaluate(read).catch((e) => `(evaluate failed: ${e.message})`);
    if (predicate(last)) return true;
    if (Date.now() > end) return `${what}: got ${JSON.stringify(last)}`;
    await page.waitForTimeout(100);
  }
}
const areaValue = () => document.querySelector('.cw-area')?.value ?? null;
const status = () => document.querySelector('[data-check="status"]')?.dataset.status ?? null;

async function newDevice(browser, relay, name, size = SIZES[0]) {
  const ctx = await browser.newContext({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch, deviceScaleFactor: 1 });
  await relay.route(ctx, name);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { ctx, page, errors, name };
}

async function setIdentity(page, who) {
  await page.locator('#name').fill(who.name);
  await page.locator(`[data-color="${who.color}"]`).click();
  await page.locator('[data-action="save-identity"]').click();
}

/** Type at the end of the document, key by key, as a person would. */
async function typeAtEnd(page, text) {
  const area = page.locator('.cw-area');
  await area.focus();
  await area.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  await page.keyboard.type(text, { delay: 15 });
}

/** The runs drawn behind the text: author, text, tint and box, per run. */
const runs = () =>
  [...document.querySelectorAll('.cw-mirror .cw-run')].map((r) => {
    const b = r.getBoundingClientRect();
    return { author: r.dataset.author, text: r.textContent, bg: getComputedStyle(r).backgroundColor, top: b.top, left: b.left, height: b.height };
  });
const legend = () => Object.fromEntries([...document.querySelectorAll('[data-check="legend"] [data-author]')].map((e) => [e.textContent, e.dataset.author]));

export default async function run({ browser, origin, engine }) {
  const failures = [];
  const expect = (ok, message) => { if (ok !== true) failures.push(typeof ok === 'string' ? ok : message); };
  const relay = createRelay();
  const at = (who, msg) => `[${engine} ${who}] ${msg}`;
  const devices = [];

  try {
    // ── Anastasia starts a document ───────────────────────────────────────────────────────────
    const a = await newDevice(browser, relay, 'ana');
    devices.push(a);
    await a.page.goto(`${origin}/${APP}/`, { waitUntil: 'networkidle' });
    await setIdentity(a.page, ANA);
    expect(await until(a.page, () => document.querySelector('[data-check="me"]')?.textContent, (t) => t === ANA.name, at('ana', 'identity saved')), '');
    await a.page.locator('[data-action="new"]').click();
    expect(await until(a.page, status, (s) => s === 'online', at('ana', 'relay online')), '');
    await typeAtEnd(a.page, 'Hello from Anastasia.');
    expect(await until(a.page, () => document.querySelector('[data-check="title"]')?.textContent, (t) => t === 'Hello from Anastasia.', at('ana', 'title follows the first line')), '');
    const link = a.page.url();
    expect(/#d=[1-9A-HJ-NP-Za-km-z]+&k=[A-Za-z0-9_-]{43}$/.test(link), at('ana', `share link shape: ${link}`));

    // ── Benedikt opens the link on his own device ─────────────────────────────────────────────
    const b = await newDevice(browser, relay, 'ben');
    devices.push(b);
    await b.page.goto(link, { waitUntil: 'networkidle' });
    await setIdentity(b.page, BEN);
    expect(await until(b.page, areaValue, (v) => v === 'Hello from Anastasia.', at('ben', 'the document arrives')), '');
    const ids = await b.page.evaluate(legend).catch(() => ({}));
    const anaId = ids[ANA.name];
    const benId = ids[BEN.name];
    expect(Boolean(anaId && benId), at('ben', `legend names both authors: ${JSON.stringify(ids)}`));
    const benRuns = await b.page.evaluate(runs);
    expect(benRuns.length === 1 && benRuns[0].author === anaId && benRuns[0].text === 'Hello from Anastasia.', at('ben', `Anastasia's run: ${JSON.stringify(benRuns)}`));
    expect(/^rgba?\(229, 72, 77/.test(benRuns[0]?.bg ?? '') || /color\(srgb 0\.89/.test(benRuns[0]?.bg ?? ''), at('ben', `run tinted in Anastasia's red: ${benRuns[0]?.bg}`));

    // Where it draws: the run starts at the textarea's first line, inside its padding.
    const box = await b.page.evaluate(() => {
      const t = document.querySelector('.cw-area');
      const r = t.getBoundingClientRect();
      const cs = getComputedStyle(t);
      return { top: r.top + parseFloat(cs.paddingTop), left: r.left + parseFloat(cs.paddingLeft), line: parseFloat(cs.lineHeight) };
    });
    const first = benRuns[0] ?? { top: NaN, left: NaN };
    expect(Math.abs(first.top - box.top) < box.line / 2 && Math.abs(first.left - box.left) < 2, at('ben', `run drawn at ${first.left},${first.top}, text starts at ${box.left},${box.top}`));

    // ── Both write; each sees the other, attributed ───────────────────────────────────────────
    await typeAtEnd(b.page, ' And Benedikt.');
    const both = 'Hello from Anastasia. And Benedikt.';
    expect(await until(a.page, areaValue, (v) => v === both, at('ana', "Benedikt's edit arrives")), '');
    const aRuns = await a.page.evaluate(runs);
    expect(aRuns.some((r) => r.author === benId && r.text === ' And Benedikt.') && aRuns.some((r) => r.author === anaId), at('ana', `runs by both: ${JSON.stringify(aRuns.map((r) => [r.author, r.text]))}`));

    // The text and its tints line up exactly: draw only the mirror's letters, then only the
    // textarea's, and the two pictures must match pixel for pixel (wrapping included).
    await typeAtEnd(a.page, '\nA second line that is long enough to wrap at the width of an iPhone, so wrapping is compared too.');
    expect(await until(b.page, areaValue, (v) => v?.endsWith('compared too.'), at('ben', 'long line arrives')), '');
    await b.page.locator('.cw-area').evaluate((el) => el.blur());
    const shot = () => b.page.locator('.cw-editor').screenshot({ animations: 'disabled', caret: 'hide' });
    const mirrorOnly = await b.page.addStyleTag({ content: '.cw-mirror{color:var(--ink)!important}.cw-area{color:transparent!important}.cw-run{background:none!important;box-shadow:none!important}' });
    const m = await shot();
    await mirrorOnly.evaluate((el) => el.remove());
    const areaOnly = await b.page.addStyleTag({ content: '.cw-run{background:none!important;box-shadow:none!important}' });
    const t = await shot();
    await areaOnly.evaluate((el) => el.remove());
    expect(Buffer.compare(m, t) === 0, at('ben', 'mirror letters and textarea letters do not land in the same pixels'));

    // ── Benedikt's caret stays put when Anastasia types before it ─────────────────────────────
    const len = ((await b.page.evaluate(areaValue)) ?? '').length;
    await b.page.locator('.cw-area').focus();
    await b.page.locator('.cw-area').evaluate((el) => el.setSelectionRange(6, 6)); // after "Hello "
    await a.page.locator('.cw-area').focus();
    await a.page.locator('.cw-area').evaluate((el) => el.setSelectionRange(0, 0));
    await a.page.keyboard.type('Hi! ', { delay: 15 });
    expect(await until(b.page, areaValue, (v) => v?.startsWith('Hi! Hello') && v.length === len + 4, at('ben', 'the insertion arrives')), '');
    const caret = await b.page.locator('.cw-area').evaluate((el) => [el.selectionStart, el.selectionEnd]);
    expect(caret[0] === 10 && caret[1] === 10, at('ben', `caret moved with its text to 10, is ${caret}`));

    // ── The toggle hides the tints, and the legend ────────────────────────────────────────────
    await b.page.locator('[data-action="authors"]').click();
    const hidden = await b.page.evaluate(() => ({
      plain: document.querySelector('.cw-editor')?.classList.contains('cw-editor--plain'),
      tints: [...document.querySelectorAll('.cw-mirror .cw-run')].map((r) => getComputedStyle(r).backgroundColor),
      legend: Boolean(document.querySelector('[data-check="legend"]')),
      pressed: document.querySelector('[data-action="authors"]')?.getAttribute('aria-pressed'),
    }));
    expect(hidden.plain && hidden.tints.length > 0 && hidden.tints.every((c) => c === 'rgba(0, 0, 0, 0)') && !hidden.legend && hidden.pressed === 'false', at('ben', `authors hidden: ${JSON.stringify(hidden)}`));
    await b.page.locator('[data-action="authors"]').click();
    expect(await until(b.page, () => getComputedStyle(document.querySelector('.cw-mirror .cw-run')).backgroundColor, (c) => c !== 'rgba(0, 0, 0, 0)', at('ben', 'authors shown again')), '');

    // ── A reload keeps the text and who wrote it, from this device's own storage ──────────────
    const beforeReload = await b.page.evaluate(areaValue);
    expect(await until(b.page, () => document.querySelector('[data-check="editor"]')?.dataset.saved, (v) => v === 'true', at('ben', 'saved on the device')), '');
    relay.block('ben', true);
    await b.page.reload({ waitUntil: 'networkidle' });
    expect(await until(b.page, areaValue, (v) => v === beforeReload, at('ben', 'text after reload, relay unreachable')), '');
    const reloadedRuns = await b.page.evaluate(runs);
    expect(reloadedRuns.some((r) => r.author === anaId) && reloadedRuns.some((r) => r.author === benId), at('ben', 'authorship after reload'));
    expect(await until(b.page, status, (s) => s === 'offline' || s === 'connecting', at('ben', 'reported offline')), '');

    // ── Offline edits merge on reconnect ──────────────────────────────────────────────────────
    await typeAtEnd(b.page, ' [offline]');
    await typeAtEnd(a.page, ' [online]');
    relay.block('ben', false);
    await b.ctx.setOffline(true);
    await b.ctx.setOffline(false); // the "online" event wakes the reconnect at once
    const merged = (v) => typeof v === 'string' && v.includes('[offline]') && v.includes('[online]');
    expect(await until(b.page, areaValue, merged, at('ben', 'merged after reconnect'), 30_000), '');
    expect(await until(a.page, areaValue, merged, at('ana', 'merged after reconnect'), 30_000), '');
    const [va, vb] = [await a.page.evaluate(areaValue), await b.page.evaluate(areaValue)];
    expect(va === vb, at('both', `converged: ${JSON.stringify(va)} vs ${JSON.stringify(vb)}`));

    // ── The relay loses everything; Anastasia's device refills it; a newcomer gets it all ─────
    await b.ctx.close();
    devices.splice(devices.indexOf(b), 1);
    relay.wipe();
    expect(await until(a.page, status, (s) => s === 'online', at('ana', 'back online after the wipe'), 30_000), '');
    const c = await newDevice(browser, relay, 'cy');
    devices.push(c);
    await c.page.goto(link, { waitUntil: 'networkidle' });
    await setIdentity(c.page, CY);
    expect(await until(c.page, areaValue, (v) => v === va, at('cy', 'the whole document after the wipe'), 30_000), '');
    const cRuns = await c.page.evaluate(runs);
    expect(cRuns.some((r) => r.author === anaId) && cRuns.some((r) => r.author === benId), at('cy', `authorship after the wipe: ${JSON.stringify(cRuns.map((r) => r.author))}`));

    // ── Nothing readable ever crossed the wire ────────────────────────────────────────────────
    const wire = Buffer.concat(relay.frames.map((f) => Buffer.from(f)));
    const secrets = ['Hello from', 'Benedikt', 'Anastasia', 'Cyrilla', '[offline]', 'compared too', ANA.color, BEN.color];
    const leaked = secrets.filter((s) => wire.includes(Buffer.from(s)));
    expect(leaked.length === 0 && relay.frames.length > 10, at('relay', `plaintext on the wire: ${JSON.stringify(leaked)} (${relay.frames.length} frames)`));

    for (const d of devices) expect(d.errors.length === 0, at(d.name, `console errors: ${d.errors.join(' | ')}`));
  } finally {
    for (const d of devices) await d.ctx.close().catch(() => {});
  }

  // ── Layout at the three sizes: no sideways scroll, the tap floor, actions in the thumb zone ──
  for (const size of SIZES) {
    const relay2 = createRelay();
    const d = await newDevice(browser, relay2, size.name, size);
    const where = (msg) => `[${engine} ${size.name}] ${msg}`;
    try {
      await d.page.goto(`${origin}/${APP}/`, { waitUntil: 'networkidle' });
      await setIdentity(d.page, ANA);
      await d.page.locator('[data-action="new"]').click();
      await d.page.locator('.cw-area').waitFor();
      await typeAtEnd(d.page, 'A line long enough to need wrapping on a phone, to check nothing pushes the page sideways at all.');
      expect(await until(d.page, () => document.querySelectorAll('.cw-mirror .cw-run').length, (n) => n > 0, where('run drawn')), '');
      const layout = await d.page.evaluate(() => {
        const el = document.documentElement;
        const r = (s) => document.querySelector(s)?.getBoundingClientRect();
        const share = r('[data-action="share"]');
        const toggle = r('[data-action="authors"]');
        const editor = r('.cw-editor');
        return { overflow: el.scrollWidth - el.clientWidth, width: el.clientWidth, height: innerHeight, share: share && { h: share.height, bottom: share.bottom }, toggleH: toggle?.height, editor: editor && { left: editor.left, right: editor.right } };
      });
      expect(layout.overflow === 0, where(`sideways scroll of ${layout.overflow}px`));
      expect(layout.editor && layout.editor.left >= 0 && layout.editor.right <= layout.width, where(`editor outside the viewport: ${JSON.stringify(layout.editor)}`));
      if (size.touch) expect(layout.share?.h >= 44 && layout.toggleH >= 44, where(`tap targets under 44px (share ${layout.share?.h}, toggle ${layout.toggleH})`));
      expect(layout.share && layout.share.bottom > layout.height * 0.75 && layout.share.bottom <= layout.height, where(`Share not in the thumb zone: bottom ${layout.share?.bottom} of ${layout.height}`));
      expect(d.errors.length === 0, where(`console errors: ${d.errors.join(' | ')}`));
    } finally {
      await d.ctx.close();
    }
  }

  if (failures.length) throw new Error(`${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
}
