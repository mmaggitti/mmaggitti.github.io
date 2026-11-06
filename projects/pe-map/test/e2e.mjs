// PE Map end-to-end test, run by scripts/smoke-test.mjs against the built site
// (Chromium in the cloud container, WebKit in CI). Throws on the first failure.
//
// The page is the built app only: its source lives in Mark's vault. This walks a first study day
// into the second. On the first card, the map icon opens the whole map with that card ringed and
// nothing written on it, and the card is unchanged when the map closes. Then it checks the Map tree:
// every card drawn inside the frame, the legend agreeing with the drawn colours, and a tap on a
// rectangle opening that card. Then the Map's JSON view: View JSON from that card lands on its node,
// search opens the path to a node, and Save hands over the deck file, canonical and without progress.

import { readFileSync } from 'node:fs';

const CARDS = 1296;
const SETTLE = 400; // ms: the app ignores taps for 350 ms after a card appears (double-tap guard)

export default async function run({ browser, origin }) {
  const context = await browser.newContext({
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true, // Save, where there's no share sheet, is a download
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

    // 2b. The map icon (no text, 44pt, on screen) opens the whole map with this card ringed: the
    //     group shown as "?". Groups run clockwise from the top in the list's order.
    const hidden = await page.locator('.pm-cloze li').evaluateAll((lis) => lis.findIndex((li) => li.querySelector('.pm-blank')));
    must(hidden >= 0, 'no group is hidden on the top card');
    const icon = button('Show on the map');
    const ib = await icon.boundingBox();
    must(ib && ib.width >= 44 && ib.height >= 44 && ib.x >= 0 && ib.x + ib.width <= 440 && ib.y >= 0 && ib.y + ib.height <= 956,
      `map icon: off screen or under 44pt (${JSON.stringify(ib)})`);
    must((await icon.innerText()).trim() === '', 'the map icon has text');
    await tap('Show on the map');
    const spot = await mapSheet(page, hidden, 'top card');
    await page.setViewportSize({ width: 440, height: 796 });   // a Safari tab, toolbars showing
    await mapSheet(page, hidden, 'top card at 440×796');
    await page.setViewportSize({ width: 440, height: 956 });

    // 2c. + centres the card; Fit shows the whole map again.
    await tap('Zoom in');
    const zoomed = await sheetGeometry(page);
    must(Math.hypot(zoomed.ring.x - zoomed.mid.x, zoomed.ring.y - zoomed.mid.y) < 2,
      `Zoom in left the card at ${JSON.stringify(zoomed.ring)}, not the map's centre ${JSON.stringify(zoomed.mid)}`);
    await tap('Fit');

    // 2d. Keys don't reach the card behind the map: Space doesn't reveal. Escape closes the map.
    await page.keyboard.press(' ');
    await page.waitForTimeout(100);
    if (await sheetOpen(page)) await page.keyboard.press('Escape');
    await page.locator('dialog.pm-sheet').waitFor({ state: 'detached' });
    must(await button('Show answer').isVisible(), 'Space behind the map revealed the answer');
    await tap('Show on the map');
    await page.keyboard.press('Escape');
    await page.locator('dialog.pm-sheet').waitFor({ state: 'detached' });

    await tap('Show answer');
    for (const name of ['Forgot', 'Remembered']) {
      const b = await button(name).boundingBox();
      must(b && b.height >= 44 && b.y >= 0 && b.y + b.height <= 956 && b.x >= 0 && b.x + b.width <= 440,
        `${name}: off screen or under 44pt (${JSON.stringify(b)})`);
    }

    // 2e. The answer side: the map opens over the revealed card. A window focus (coming back to the
    //     app) keeps it open, 1 grades nothing, and Back to card finds the answer still showing.
    const eyebrowBefore = await page.locator('.pm-card .pm-eyebrow').innerText();
    await tap('Show on the map');
    await page.locator('dialog.pm-sheet').waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(100);
    must(await sheetOpen(page), 'a window focus closed the map');
    await page.keyboard.press('1');
    await page.waitForTimeout(100);
    must(await sheetOpen(page), 'pressing 1 behind the map changed the card');
    await tap('Back to card');
    await page.locator('dialog.pm-sheet').waitFor({ state: 'detached' });
    must(await button('Remembered').isVisible() && await button('Forgot').isVisible(), 'the answer is hidden after the map');
    must((await page.locator('.pm-card .pm-eyebrow').innerText()) === eyebrowBefore, 'the card changed behind the map');
    await tap('Remembered');

    // 2f. The definition intro that follows is the same group: its map rings the same spot.
    await page.getByText('New definition card').waitFor();
    await tap('Show on the map');
    const again = await mapSheet(page, hidden, 'definition intro');
    must(Math.hypot(again.x - spot.x, again.y - spot.y) < 2, `the definition intro rings ${JSON.stringify(again)}, the top card ${JSON.stringify(spot)}`);
    await tap('Back to card');
    await page.locator('dialog.pm-sheet').waitFor({ state: 'detached' });

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

    // 6. View JSON on the tapped card opens the Map's JSON view at that node, on screen.
    const tappedId = await page.locator('.pm-tree-card .ds-mono').innerText();
    const vj = await button('View JSON').boundingBox();
    must(vj && vj.height >= 44, `View JSON is under 44pt: ${JSON.stringify(vj)}`);
    await tap('View JSON');
    must((await button('JSON').getAttribute('aria-pressed')) === 'true', 'View JSON did not switch the Map to JSON');
    const landed = page.locator('[aria-current="true"]');
    await landed.waitFor();
    must((await landed.getAttribute('data-node')) === tappedId, `View JSON landed on ${await landed.getAttribute('data-node')}, not ${tappedId}`);
    const lb = await landed.boundingBox();
    must(lb && lb.y >= 0 && lb.y + lb.height <= 956, `the landed row is off screen: ${JSON.stringify(lb)}`);

    // 7. Search by id: one hit, the path to it opened, its fields shown as the file writes them, and
    //    only what's open drawn (the deck has 1,296 nodes; the widest family 21 children).
    const search = page.locator('.pm-json-search');
    await search.fill('pet.1.c');
    const hits = page.locator('.pm-json-hit');
    must((await hits.count()) === 1, `search pet.1.c: ${await hits.count()} hits`);
    await hits.first().tap();
    must((await page.locator('[data-node="pet.1.c"]').getAttribute('aria-current')) === 'true', 'pet.1.c is not the current row');
    const fields = await page.locator('[aria-current="true"] + .pm-json-fields').innerText();
    must(fields.includes('"id": "pet.1.c"'), `pet.1.c's fields: ${fields.slice(0, 80)}`);
    const drawn = await page.locator('.pm-json-row').count();
    must(drawn < 150, `${drawn} rows drawn: the view should draw only what's open`);
    await search.fill('nuc.1');                    // its source holds a 45-character unbroken token
    await hits.first().tap();
    await noSideways(page, 'json view');

    // 8. Save hands over the whole deck file: canonical, all 1,296 nodes, no progress.
    await page.evaluate(() => { navigator.canShare = () => false; });
    const [download] = await Promise.all([page.waitForEvent('download'), button('Save pe-map-cards.json').tap()]);
    must(download.suggestedFilename() === 'pe-map-cards.json', `saved as ${download.suggestedFilename()}`);
    const text = readFileSync(await download.path(), 'utf8');
    const deck = JSON.parse(text);
    must(JSON.stringify(deck, null, 2) + '\n' === text, 'the saved file is not in canonical form');
    let nodes = 0;
    const walk = (n) => { for (const c of n.children ?? []) { nodes++; walk(c); } };
    walk(deck);
    must(nodes === CARDS, `the saved file holds ${nodes} nodes, not ${CARDS}`);
    must(!text.includes('"progress"'), 'the saved file carries progress');

    // 9. Progress is kept under this project's own name on the shared origin.
    const names = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : null));
    if (names) must(names.length > 0 && names.every((n) => n === 'pe-map'), `IndexedDB databases: ${JSON.stringify(names)}`);

    must(errors.length === 0, errors.join('\n'));
  } finally {
    await context.close();
  }
}

/** The study map sheet: modal, every card drawn, `hidden`'s group ringed, nothing written, nothing
 *  hidden under its controls or scrolled out of reach. Returns the ring's centre on screen. */
async function mapSheet(page, hidden, where) {
  const sheet = page.locator('dialog.pm-sheet');
  await sheet.waitFor();
  const g = await sheetGeometry(page);
  must(g.modal, `${where}: the map is not a modal dialog`);
  must(g.rects === 1296 && g.rings === 1 && g.chains === 1, `${where}: ${g.rects} rectangles, ${g.rings} rings, ${g.chains} paths`);
  const near = g.groups.map((q) => Math.hypot(q.x - g.ring.x, q.y - g.ring.y));
  must(near.indexOf(Math.min(...near)) === hidden && near[hidden] < 2,
    `${where}: the ring is ${near[hidden].toFixed(1)}px from group ${hidden + 1}, nearest group ${near.indexOf(Math.min(...near)) + 1}`);
  must(g.text === '', `${where}: the map shows text: "${g.text.slice(0, 60)}"`);
  must(!overlaps(g.zoom, g.svg), `${where}: the zoom buttons cover the map (${JSON.stringify(g.zoom)} over ${JSON.stringify(g.svg)})`);
  must(g.scroll[0] === 0 && g.scroll[1] === 0, `${where}: the map sheet scrolls by ${g.scroll}`);
  must(g.ctm < 1, `${where}: the svg's screen transform is off by ${g.ctm.toFixed(2)}px, so pinch and drag would miss`);
  const vh = page.viewportSize().height;
  const back = await page.getByRole('button', { name: 'Back to card', exact: true }).boundingBox();
  must(back && back.height >= 44 && back.y >= 0 && back.y + back.height <= vh, `${where}: Back to card is off screen: ${JSON.stringify(back)}`);
  return g.ring;
}

/** What the sheet draws, measured on screen. */
async function sheetGeometry(page) {
  return page.evaluate(() => {
    const d = document.querySelector('dialog.pm-sheet');
    const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const mid = (el) => { const b = box(el); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; };
    const svg = d.querySelector('svg.pm-tree-svg');
    const root = mid(d.querySelector('.pm-root'));
    const away = (q) => Math.hypot(q.x - root.x, q.y - root.y);
    const turn = (q) => (Math.atan2(q.y - root.y, q.x - root.x) + (5 * Math.PI) / 2) % (2 * Math.PI);
    const rects = [...d.querySelectorAll('rect.pm-n')];
    // The 7 groups are the rectangles nearest the centre; sorted clockwise from the top.
    const groups = rects.map(mid).sort((a, b) => away(a) - away(b)).slice(0, 7).sort((a, b) => turn(a) - turn(b));
    const bare = d.cloneNode(true);
    bare.querySelectorAll('button').forEach((b) => b.remove());
    const m = svg.getScreenCTM();
    const vb = svg.viewBox.baseVal;
    const s = svg.getBoundingClientRect();
    const tl = new DOMPoint(vb.x, vb.y).matrixTransform(m);
    const br = new DOMPoint(vb.x + vb.width, vb.y + vb.height).matrixTransform(m);
    return {
      modal: d.matches(':modal'),
      rects: rects.length,
      rings: d.querySelectorAll('.pm-sel').length,
      chains: d.querySelectorAll('.pm-chain').length,
      ring: mid(d.querySelector('.pm-sel')),
      mid: mid(svg),
      groups,
      text: bare.textContent.trim(),
      svg: box(svg),
      zoom: box(d.querySelector('.pm-zoom')),
      scroll: [d.scrollWidth - d.clientWidth, d.scrollHeight - d.clientHeight],
      ctm: Math.max(Math.abs(tl.x - s.left), Math.abs(tl.y - s.top), Math.abs(br.x - s.right), Math.abs(br.y - s.bottom)),
    };
  });
}

const sheetOpen = async (page) => (await page.locator('dialog.pm-sheet[open]').count()) === 1;
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

async function noSideways(page, where) {
  const s = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  must(s === 0, `${where}: page scrolls sideways by ${s}px`);
}

function must(ok, message) {
  if (!ok) throw new Error(`pe-map e2e: ${message}`);
}
