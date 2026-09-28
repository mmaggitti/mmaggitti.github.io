// Flashcards end-to-end test, run by the site's scripts/smoke-test.mjs against the built site
// (Chromium in cloud sessions, WebKit in CI). Every check runs; the test throws once, listing all
// failures, so one CI run shows everything an engine disagrees with.
//
// At each size (iPhone 440×956 and iPad 834×1194 with touch; desktop 1440×900 without): import the
// made-up sample deck from Files, run a whole session (one "Again" comes back), reload and find the
// grades kept, back up, and restore the backup into a fresh browser profile.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP = 'srs';
const FIXTURE = fileURLToPath(new URL('./fixtures/sample-deck.jsonl', import.meta.url));
const BAD = fileURLToPath(new URL('./fixtures/bad-deck.jsonl', import.meta.url));
const DECK = readFileSync(FIXTURE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
// New cards come in deck order; card 2 is graded Again and comes back four cards later.
const ORDER = [0, 1, 2, 3, 4, 1, 5, 6, 7];
const SIZES = [
  { name: 'iphone', viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, touch: true },
  { name: 'ipad', viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true, touch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, touch: false },
];
// The app's CSP blocks eval, so every wait polls from Node rather than inside the page.
const read = (page, check) => page.evaluate((c) => document.querySelector(`[data-check="${c}"]`)?.textContent ?? null, check);
const until = async (page, check, predicate, what, timeout = 15_000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const t = await read(page, check);
    if (t !== null && predicate(t)) return true;
    if (Date.now() > end) return `${what}: got ${JSON.stringify(t ?? '(missing)')}`;
    await page.waitForTimeout(100);
  }
};
const shown = (page, selector) => page.evaluate((s) => !!document.querySelector(s), selector);

/** Import through the real file picker; returns its `accept` filter. */
async function importFile(page, path) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action="import"]')]);
  const accept = await chooser.element().getAttribute('accept');
  await chooser.setFiles(path);
  return accept;
}

/** Where the review screen draws: the card inside the viewport, the bar pinned to its bottom. */
function layout(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    const bar = document.querySelector('.srs-bar')?.getBoundingClientRect();
    const front = document.querySelector('[data-check="front"]')?.getBoundingClientRect();
    const buttons = [...document.querySelectorAll('.srs-bar > button')].map((b) => b.getBoundingClientRect());
    return {
      overflow: d.scrollWidth - d.clientWidth,
      height: window.innerHeight,
      width: d.clientWidth,
      barBottom: bar?.bottom ?? -1,
      frontTop: front?.top ?? -1,
      frontBottom: front?.bottom ?? -1,
      buttons: buttons.map((r) => ({ h: r.height, left: r.left, right: r.right, top: r.top })),
      codeFont: getComputedStyle(document.querySelector('[data-check="front"] code') ?? document.body).fontFamily,
    };
  });
}

export default async function run({ browser, origin, engine }) {
  const failures = [];
  const expect = (ok, message) => { if (ok !== true) failures.push(typeof ok === 'string' ? ok : message); };

  for (const size of SIZES) {
    const at = (msg) => `[${engine} ${size.name}] ${msg}`;
    const ctx = await browser.newContext({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch, deviceScaleFactor: 1, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${origin}/${APP}/`, { waitUntil: 'networkidle' });

    // Empty, then the sample deck imported through the file picker.
    expect(await until(page, 'empty', (t) => t.includes('No cards yet'), at('empty state')), '');
    // No type filter: iOS greys out .jsonl in Files under any accept list (it has no type for it).
    const accept = await importFile(page, FIXTURE);
    expect(!accept, at(`the import picker filters by type (${accept}); iOS would grey out .jsonl decks`));
    expect(await until(page, 'cards', (t) => t === String(DECK.length), at('cards after import')), '');
    expect(await read(page, 'new') === String(DECK.length), at(`new after import: ${await read(page, 'new')}`));
    expect(await read(page, 'due') === '0', at(`due after import: ${await read(page, 'due')}`));
    expect(Boolean((await read(page, 'message'))?.startsWith('Imported sample-deck.jsonl: 8 new')), at(`import message: ${await read(page, 'message')}`));
    const backend = (await page.locator('.cs-hint').innerText()).match(/Stored here in (.+)\.$/)?.[1];
    if (size.name === 'iphone') console.log(`  ${APP}: storage ${backend} (${engine})`);

    // A session through the whole deck (see ORDER).
    await page.click('[data-action="start"]');
    const grades = [];
    let firstLayout = null;
    for (let step = 0; step < 20; step++) {
      if (await shown(page, '[data-check="done-reviewed"]')) break;
      expect(await until(page, 'front', (t) => t.length > 0, at(`card ${step + 1} shown`)), '');
      const front = await read(page, 'front');
      if (step < ORDER.length) {
        const want = DECK[ORDER[step]].fields.front.replaceAll('`', '');
        expect(front === want, at(`card ${step + 1} front: ${JSON.stringify(front)}, want ${JSON.stringify(want)}`));
      }
      if (size.touch) await page.tap('[data-action="reveal"]');
      else await page.keyboard.press('Space');
      expect(await until(page, 'back', (t) => t.length > 0, at(`answer ${step + 1} shown`)), '');
      if (step === 2) firstLayout = await layout(page); // the card with a `code` span
      const grade = step === 1 ? 1 : step % 3 === 0 ? 4 : 3;
      grades.push(grade);
      if (size.touch) await page.tap(`[data-action="grade-${grade}"]`);
      else await page.keyboard.press(String(grade));
      const next = Date.now() + 10_000;
      while (Date.now() < next && !(await shown(page, '[data-action="reveal"]')) && !(await shown(page, '[data-check="done-reviewed"]'))) await page.waitForTimeout(50);
    }
    const reviewed = grades.length;
    expect(reviewed === DECK.length + 1, at(`session reviewed ${reviewed} cards, want ${DECK.length + 1} (the Again card once more)`));
    expect(await until(page, 'done-reviewed', (t) => t === String(DECK.length + 1), at('summary count')), '');
    expect(await read(page, 'done-again') === '1', at(`summary again: ${await read(page, 'done-again')}`));

    if (firstLayout) {
      const L = firstLayout;
      expect(L.overflow === 0, at(`sideways scroll of ${L.overflow}px on the review screen`));
      expect(Math.abs(L.barBottom - L.height) <= 1, at(`grade bar not on the bottom edge (bottom ${L.barBottom}, viewport ${L.height})`));
      expect(L.frontTop >= 0 && L.frontBottom <= L.height, at(`question drawn outside the viewport (${L.frontTop}–${L.frontBottom})`));
      expect(L.buttons.length === 4, at(`${L.buttons.length} grade buttons`));
      expect(L.buttons.every((b) => b.left >= 0 && b.right <= L.width), at('a grade button runs off the screen'));
      expect(L.buttons.every((b, i, all) => Math.abs(b.top - all[0].top) < 1), at('grade buttons not in one row'));
      if (size.touch) expect(L.buttons.every((b) => b.h >= 44), at(`grade buttons under 44px: ${L.buttons.map((b) => b.h).join(', ')}`));
      expect(/mono|menlo|courier|consolas/i.test(L.codeFont), at(`backticked text not in the mono face: ${L.codeFont}`));
    } else expect(false, at('no layout captured'));

    // Grades survive a reload: they are in the append-only log.
    await page.click('[data-action="home"]');
    await page.reload({ waitUntil: 'networkidle' });
    expect(await until(page, 'reviews', (t) => t === String(DECK.length + 1), at('reviews after reload')), '');
    expect(await read(page, 'new') === '0', at(`new after reload: ${await read(page, 'new')}`));
    expect(await shown(page, '[data-check="backup-reminder"]'), at('no backup reminder with unsaved reviews'));

    // Back up, then restore into a fresh profile: same cards, same reviews.
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }).catch(() => null), page.click('[data-action="backup-home"]')]);
    let backup = '';
    if (!download) expect(false, at('backup did not produce a download'));
    else {
      backup = readFileSync(await download.path(), 'utf8');
      const rows = backup.trim().split('\n').map((l) => JSON.parse(l));
      expect(rows[0]?.kind === 'srs-backup' && rows[0].cards === DECK.length && rows[0].reviews === DECK.length + 1, at(`backup header ${JSON.stringify(rows[0])}`));
      expect(rows.filter((r) => r.kind === 'review').map((r) => r.grade).join() === grades.join(), at('backup grades differ from the session'));
      expect(/^flashcards-backup-\d{4}-\d{2}-\d{2}\.jsonl$/.test(download.suggestedFilename()), at(`backup name ${download.suggestedFilename()}`));
      expect(await until(page, 'last-backup', (t) => t !== 'never', at('last backup recorded')), '');
      expect(!(await shown(page, '[data-check="backup-reminder"]')), at('backup reminder still shown after a backup'));

      const fresh = await browser.newContext({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch, deviceScaleFactor: 1 });
      const p2 = await fresh.newPage();
      await p2.goto(`${origin}/${APP}/`, { waitUntil: 'networkidle' });
      await until(p2, 'empty', (t) => t.length > 0, at('fresh profile empty'));
      await importFile(p2, await download.path());
      expect(await until(p2, 'reviews', (t) => t === String(DECK.length + 1), at('restored reviews')), '');
      expect(await read(p2, 'cards') === String(DECK.length), at(`restored cards: ${await read(p2, 'cards')}`));
      expect(await read(p2, 'new') === '0', at(`restored new: ${await read(p2, 'new')}`));
      expect(Boolean((await read(p2, 'message'))?.includes(`${DECK.length + 1} reviews restored`)), at(`restore message: ${await read(p2, 'message')}`));
      await fresh.close();
    }

    if (size.name === 'iphone') {
      // Bad lines are reported by number and skipped; good ones still import.
      await importFile(page, BAD);
      expect(await until(page, 'message', (t) => t.includes('2 line(s) skipped') && t.includes('line 2'), at('bad deck message')), '');
      expect(await read(page, 'cards') === String(DECK.length + 1), at(`cards after bad deck: ${await read(page, 'cards')}`));

      // The service worker, where the engine offers one, is scoped to this app's folder only.
      const scope = await page.evaluate(async () => (await navigator.serviceWorker?.getRegistration?.())?.scope ?? null);
      if (scope !== null) expect(new URL(scope).pathname === `/${APP}/`, at(`service worker scope ${scope}`));
      const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
      expect(Boolean(csp?.includes("'wasm-unsafe-eval'")), at('CSP meta missing or without wasm-unsafe-eval'));
    }

    expect(errors.length === 0, at(`console errors: ${errors.join(' | ')}`));
    await ctx.close();
  }
  if (failures.length) throw new Error(`${APP} e2e: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`);
}
