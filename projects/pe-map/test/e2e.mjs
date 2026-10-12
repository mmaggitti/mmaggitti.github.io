// PE Map end-to-end test, run by scripts/smoke-test.mjs against the built site
// (Chromium in the cloud container, WebKit in CI). Throws on the first failure.
//
// The page is the built app only: its source lives in Mark's vault. This walks a first study day
// into the second, then checks the Map tree: every card drawn inside the frame, the legend agreeing
// with the drawn colours, and a tap on a rectangle opening that card.

const CARDS = 1296;
const SETTLE = 400; // ms: the app ignores taps for 350 ms after a card appears (double-tap guard)

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
  const button = (name) => page.getByRole('button', { name, exact: true });
  const tap = async (name) => {
    await button(name).waitFor();
    await page.waitForTimeout(SETTLE);
    await button(name).tap();
  };

  try {
    await page.goto(`${origin}/pe-map/`, { waitUntil: 'networkidle' });

    // 1. A fresh start: the top family's intro, the 7 groups in their fixed order; no sideways scroll.
    await page.getByText('New family · 7 groups').waitFor();
    const groups = await page.locator('.pm-card li').allInnerTexts();
    must(groups.join('|') === 'Public Works|Load-Bearing Design|Machinery & Thermal|Electrotechnology|Process Industries|Built Environment & Operations|Resources & Marine',
      `intro groups: ${groups.join('|')}`);
    await noSideways(page, 'intro');

    // 2. Today ends after the intro; "Start next day" brings the first map card, whose answer
    //    buttons sit on screen and meet the 44pt tap floor.
    await tap('Got it');
    await page.getByText('Done for today').waitFor();
    await tap('Start next day');
    await page.getByText('Top card · name the missing group').waitFor();
    await tap('Show answer');
    for (const name of ['Forgot', 'Remembered']) {
      const b = await button(name).boundingBox();
      must(b && b.height >= 44 && b.y >= 0 && b.y + b.height <= 956 && b.x >= 0 && b.x + b.width <= 440,
        `${name}: off screen or under 44pt (${JSON.stringify(b)})`);
    }
    await tap('Remembered');

    // 3. Map opens on the tree: every card is one rectangle, and the legend counts what is drawn.
    await tap('Map');
    must((await button('Tree').getAttribute('aria-pressed')) === 'true', 'Map does not open on Tree');
    const rects = page.locator('svg.pm-tree-svg rect.pm-n');
    must((await rects.count()) === CARDS, `tree draws ${await rects.count()} rectangles, not ${CARDS}`);
    const legend = await page.locator('.pm-legend').innerText();
    const counted = {};
    for (const [, label, n] of legend.matchAll(/(Remembered|Defining|Placing|Hidden)\s+([\d,]+)/g)) counted[label.toLowerCase()] = Number(n.replace(/,/g, ''));
    must(Object.values(counted).reduce((a, b) => a + b, 0) === CARDS, `legend sums to ${JSON.stringify(counted)}`);
    for (const [status, n] of Object.entries(counted)) {
      const drawn = await page.locator(`svg.pm-tree-svg rect.pm-n--${status}`).count();
      must(drawn === n, `legend says ${n} ${status}, ${drawn} drawn`);
    }
    must(counted.placing >= 1, 'no card is placing after a map card was answered');

    // 4. The whole tree sits inside its frame, and the frame inside the screen.
    const frame = await page.locator('.pm-tree-frame').boundingBox();
    must(frame.x >= 0 && frame.x + frame.width <= 440, `tree frame overflows the screen: ${JSON.stringify(frame)}`);
    const box = await page.evaluate(() => {
      const r = [...document.querySelectorAll('svg.pm-tree-svg rect.pm-n')].map((e) => e.getBoundingClientRect());
      return { l: Math.min(...r.map((b) => b.left)), r: Math.max(...r.map((b) => b.right)), t: Math.min(...r.map((b) => b.top)), b: Math.max(...r.map((b) => b.bottom)) };
    });
    must(box.l >= frame.x - 1 && box.r <= frame.x + frame.width + 1 && box.t >= frame.y - 1 && box.b <= frame.y + frame.height + 1,
      `tree spills out of its frame: ${JSON.stringify(box)} vs ${JSON.stringify(frame)}`);
    await noSideways(page, 'map');

    // 5. Tapping a group's rectangle opens its card and rings that rectangle.
    const group = page.locator('svg.pm-tree-svg rect.pm-n--placing').first();
    const g = await group.boundingBox();
    await page.touchscreen.tap(g.x + g.width / 2, g.y + g.height / 2);
    await page.locator('.pm-tree-card').waitFor();
    const eyebrow = await page.locator('.pm-tree-card .pm-eyebrow').innerText();
    must(/^Placing · a group$/.test(eyebrow), `tapped a placing group, card says "${eyebrow}"`);
    const ring = await page.locator('svg .pm-sel').boundingBox();
    const cx = g.x + g.width / 2, cy = g.y + g.height / 2;
    must(ring && cx >= ring.x && cx <= ring.x + ring.width && cy >= ring.y && cy <= ring.y + ring.height,
      `selection ring ${JSON.stringify(ring)} is not around the tapped rectangle`);
    must(await page.locator('svg .pm-chain').count() === 1, 'no path drawn to the centre');
    for (const name of ['Zoom in', 'Zoom out', 'Fit']) {
      const b = await button(name).boundingBox();
      must(b && b.height >= 44 && b.width >= 44, `${name} is under 44pt: ${JSON.stringify(b)}`);
    }

    // 6. Progress is kept under this project's own name on the shared origin.
    const names = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : null));
    if (names) must(names.length > 0 && names.every((n) => n === 'pe-map'), `IndexedDB databases: ${JSON.stringify(names)}`);

    must(errors.length === 0, errors.join('\n'));
  } finally {
    await context.close();
  }
}

async function noSideways(page, where) {
  const s = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  must(s === 0, `${where}: page scrolls sideways by ${s}px`);
}

function must(ok, message) {
  if (!ok) throw new Error(`pe-map e2e: ${message}`);
}
