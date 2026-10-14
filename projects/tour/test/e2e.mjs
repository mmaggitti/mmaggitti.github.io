// Tour end-to-end test, run by the site's scripts/smoke-test.mjs against the built site (Chromium
// in cloud sessions, WebKit in CI). Every check runs; the test throws once, listing all failures,
// so one CI run shows everything WebKit disagrees with.
//
// "Where it draws" comes from the page's own projection (window.__tour.layout()): every corner of
// the shot's box must land on screen, between the header and the controls.

const APP = 'tour';
// The main heat exchanger's centre, in model meters: a part with nothing in front of it in the Iso view.
const MHE = [88.75, 10.5, -6];

export default async function run({ browser, origin, engine }) {
  const failures = [];
  const expect = (ok, message) => {
    if (ok !== true) failures.push(`[${engine}] ${message}`);
  };
  const ctx = await browser.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // Polls from Node, so a slow software renderer only makes it wait longer.
  const until = async (fn, arg, timeout = 30_000) => {
    const end = Date.now() + timeout;
    for (;;) {
      if (await page.evaluate(fn, arg)) return true;
      if (Date.now() > end) return false;
      await page.waitForTimeout(100);
    }
  };
  const title = () => page.textContent('#tTitle');
  const framed = (l) => l.left >= -1 && l.right <= l.width + 1 && l.top >= l.gapTop - 1 && l.bottom <= l.gapBottom + 1;
  const where = (l) =>
    `box ${Math.round(l.left)}–${Math.round(l.right)} × ${Math.round(l.top)}–${Math.round(l.bottom)}, ` +
    `screen width ${l.width}, gap ${Math.round(l.gapTop)}–${Math.round(l.gapBottom)}`;

  await page.goto(`${origin}/${APP}/`, { waitUntil: 'networkidle' });
  await until(() => ['ready', 'unavailable'].includes(document.documentElement.dataset.state));
  const state = await page.evaluate(() => document.documentElement.dataset.state ?? 'none');
  if (state !== 'ready') {
    const said = await page.textContent('#info');
    await ctx.close();
    throw new Error(`[${engine}] the page is not ready (state ${state}): "${said}" ${errors.join(' | ')}`);
  }

  // At rest: the plant draws, all of it between the bars; Start tour in the thumb zone; 44 pt targets.
  const idle = await page.evaluate(() => {
    const d = document.documentElement;
    const shown = [...document.querySelectorAll('button')].filter((b) => b.offsetParent);
    return {
      l: window.__tour.layout(),
      start: document.getElementById('tourBtn').getBoundingClientRect().top,
      height: d.clientHeight,
      overflow: d.scrollWidth - d.clientWidth,
      small: shown.filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim()),
    };
  });
  expect(idle.l.triangles > 50_000, `the plant drew ${idle.l.triangles} triangles`);
  expect(framed(idle.l), `at rest the plant is not between the bars: ${where(idle.l)}`);
  expect(idle.overflow === 0, `sideways scroll of ${idle.overflow}px`);
  expect(idle.small.length === 0, `buttons under the 44 pt floor: ${idle.small.join(', ')}`);
  expect(idle.start > idle.height * 0.75, `Start tour is at y ${Math.round(idle.start)}, above the thumb zone`);

  // Each view button flies to its shot and frames it.
  for (const v of ['front', 'plan', 'columns', 'warm', 'iso']) {
    await page.locator(`#views button[data-view="${v}"]`).tap();
    const arrived = await until(() => window.__tour.settled());
    const l = await page.evaluate(() => window.__tour.layout());
    const pressed = await page.getAttribute(`#views button[data-view="${v}"]`, 'aria-pressed');
    expect(arrived && framed(l), `the ${v} view is not framed between the bars: ${where(l)}`);
    expect(pressed === 'true', `the ${v} button is not shown as the current view`);
  }

  // A tap on a part names it and gives its size.
  const at = await page.evaluate((p) => window.__tour.screenOf(p), MHE);
  await page.touchscreen.tap(at[0], at[1]);
  const named = await until(() => document.getElementById('info').textContent.startsWith('Main heat exchanger ·'), null, 5_000);
  expect(named, `tapping the main heat exchanger at (${Math.round(at[0])}, ${Math.round(at[1])}) showed "${await page.textContent('#info')}"`);

  // The tour, by real taps: it opens on the overview, steps both ways, and wraps at both ends.
  await page.locator('#tourBtn').tap();
  expect(await until(() => document.getElementById('tTitle').textContent === '1. Overview'), `Start tour opened "${await title()}"`);
  const steps = [['#tNext', '2. Intake and compression'], ['#tBack', '1. Overview'], ['#tBack', '12. Products'], ['#tNext', '1. Overview']];
  for (const [button, want] of steps) {
    await page.locator(button).tap();
    expect((await title()) === want, `${button} showed "${await title()}", not "${want}"`);
  }
  const bar = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    return { back: r('tBack'), next: r('tNext'), exit: r('tExit'), height: document.documentElement.clientHeight };
  });
  for (const k of ['back', 'next', 'exit']) {
    expect(bar[k].height >= 44 && bar[k].top > bar.height * 0.75, `${k} is ${Math.round(bar[k].height)}px tall at y ${Math.round(bar[k].top)}: not a thumb-zone target`);
  }

  // Every stage: its caption, its shot framed between the bars, and its parts lit in order.
  const titles = await page.evaluate(() => window.__tour.titles);
  expect(titles.length === 12, `the tour has ${titles.length} stages, not 12`);
  for (let i = 0; i < titles.length; i++) {
    const s = await page.evaluate((k) => {
      window.__tour.go(k);
      return { title: document.getElementById('tTitle').textContent, l: window.__tour.layout(), fades: window.__tour.fades() };
    }, i);
    expect(s.title === `${i + 1}. ${titles[i]}`, `stage ${i + 1} shows "${s.title}"`);
    expect(framed(s.l), `stage ${i + 1} (${titles[i]}) draws outside the gap: ${where(s.l)}`);
    for (const [k, [lo, hi]] of Object.entries(s.fades)) {
      const want = i === 0 ? 1 : Number(k) === i ? 1 : Number(k) < i ? 0.5 : 0.12;
      expect(lo === want && hi === want, `at stage ${i + 1}, the parts of "${titles[k]}" fade to ${lo}–${hi}, not ${want}`);
    }
  }

  // Keys step too; Escape leaves the tour and puts every part back as it was.
  await page.evaluate(() => window.__tour.go(0));
  await page.keyboard.press('ArrowRight');
  expect((await title()) === '2. Intake and compression', `ArrowRight showed "${await title()}"`);
  await page.keyboard.press('ArrowLeft');
  expect((await title()) === '1. Overview', `ArrowLeft showed "${await title()}"`);
  await page.keyboard.press('Escape');
  const after = await page.evaluate(() => ({
    hidden: document.getElementById('tour').hidden,
    views: !document.getElementById('views').hidden,
    restored: window.__tour.restored(),
  }));
  expect(after.hidden && after.views, 'Escape did not close the tour');
  expect(after.restored, 'leaving the tour left some parts faded');

  expect(errors.length === 0, `console errors: ${errors.join(' | ')}`);
  await ctx.close();
  if (failures.length) throw new Error(failures.join('\n'));
}
