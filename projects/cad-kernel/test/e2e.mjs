// Car engine end-to-end test, run by the site's scripts/smoke-test.mjs against the built site
// (Chromium in cloud sessions, WebKit in CI). Every check runs; the test throws once, listing all
// failures, so one CI run shows everything WebKit disagrees with.

const APP = 'cad-kernel';
// The engine's crank radius (stroke 80 / 2) and rod length (centre to centre), from its parameters.
const R = 40;
const L = 140;
// Rays the kernel's own browser check picks along (package coordinates, crank at 0°): each must
// land on this instance and this persistent face name.
const PICKS = [
  ['valve cover top', [0, 30, 1000], [0, 0, -1], 'valve_cover_1', 'ex1.cap[end]'],
  ['block side', [0, -1000, 100], [0, 1, 0], 'block_1', 'ex1.side[l1]'],
  ['camshaft end through the seal bore', [-1000, 0, 345], [1, 0, 0], 'camshaft_1', 'ex1.cap[start]'],
  ['oil pan bottom', [0, 0, -1000], [0, 0, 1], 'oil_pan_1', 'ex1.cap[end]'],
  ['intake plenum', [0, 1000, 352.848], [0, -1, 0], 'intake_manifold_1', 'ex1.side[c1]'],
];

export default async function run({ browser, origin, engine }) {
  const failures = [];
  const expect = (ok, message) => {
    if (ok !== true) failures.push(typeof ok === 'string' ? ok : message);
  };
  const at = (msg) => `[${engine}] ${msg}`;
  const ctx = await browser.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // Polls from Node, not inside the page: the page's CSP blocks eval.
  const until = async (fn, arg, what, timeout = 60_000) => {
    const end = Date.now() + timeout;
    for (;;) {
      const v = await page.evaluate(fn, arg);
      if (v) return true;
      if (Date.now() > end) return what;
      await page.waitForTimeout(100);
    }
  };
  const state = () => page.evaluate(() => {
    const s = window.__cadk;
    return { done: s.done, error: s.error ?? null, parts: s.parts, triangles: s.triangles, angle: s.angle, mode: s.mode };
  });

  await page.goto(`${origin}/${APP}/`, { waitUntil: 'networkidle' });
  expect(await until(() => window.__cadk?.done === true, null, at('the engine never finished loading')), '');
  const s0 = await state();
  expect(s0.error === null, at(`the engine failed to load: ${s0.error}`));
  expect(s0.parts === 35, at(`${s0.parts} parts, not the engine's 35`));
  expect(s0.triangles > 100_000, at(`${s0.triangles} triangles: the display cache is incomplete`));

  // It draws, where it should: every triangle in the frame, the whole engine across the screen's
  // width, its middle between the title card and the controls.
  await page.waitForTimeout(300);
  const lay = await page.evaluate(() => {
    const l = window.__cadk.layout();
    const card = document.querySelector('.card').getBoundingClientRect();
    const bar = document.querySelector('.bar').getBoundingClientRect();
    const d = document.documentElement;
    const tall = (sel) => Math.min(...[...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect().height));
    return { ...l, cardBottom: card.bottom, barTop: bar.top, width: d.clientWidth, overflow: d.scrollWidth - d.clientWidth, buttons: tall('.bar button'), slider: tall('#crank') };
  });
  expect(lay.triangles >= s0.triangles, at(`the frame drew ${lay.triangles} of ${s0.triangles} triangles`));
  expect(lay.left >= 0 && lay.right <= lay.width, at(`the engine runs off the screen (${Math.round(lay.left)}–${Math.round(lay.right)} of ${lay.width})`));
  expect(lay.center[1] > lay.cardBottom && lay.center[1] < lay.barTop, at(`the engine's middle (y ${Math.round(lay.center[1])}) is under the card or the controls (${Math.round(lay.cardBottom)}–${Math.round(lay.barTop)})`));
  expect(lay.overflow === 0, at(`sideways scroll of ${lay.overflow}px`));
  expect(lay.buttons >= 44 && lay.slider >= 44, at(`touch targets under 44px (buttons ${lay.buttons}, slider ${lay.slider})`));

  // Picks carry the kernel's persistent names.
  const picks = {};
  for (const [label, o, d, inst, name] of PICKS) {
    const got = await page.evaluate(([o, d]) => window.__cadk.pick(o, d), [o, d]);
    picks[label] = got;
    expect(got?.instance === inst && got?.name === name, at(`pick ${label}: ${JSON.stringify(got)}, wanted ${inst} ${name}`));
  }
  // A real tap on the block's side shows its name in the card.
  const side = picks['block side']?.screen;
  if (side) {
    await page.touchscreen.tap(side[0], side[1]);
    expect(await until(() => document.getElementById('pick').textContent.startsWith('block_1 · '), null, at('tapping the block did not show its name'), 5_000), '');
  }

  // Show inside hides the block and its covers: a ray through the block's side at piston 1 then
  // lands on the piston, and on the block again once they're back.
  const p1 = await page.evaluate(() => window.__cadk.position('piston_1'));
  const through = [[p1[0], -1000, p1[2] + 20], [0, 1, 0]];
  const hitAt = () => page.evaluate(([o, d]) => window.__cadk.pick(o, d).then((r) => r?.instance ?? null), through);
  const before = await hitAt();
  await page.locator('#inside').click();
  const inside = await hitAt();
  await page.locator('#inside').click();
  const after = await hitAt();
  expect(before === 'block_1' && inside === 'piston_1' && after === 'block_1', at(`through the block at piston 1: ${before}, then ${inside} with the inside shown, then ${after}`));

  // The crank moves piston 1 as the slider-crank formula says: a full stroke from top to bottom
  // dead centre, and at 90° the rod's reach down from the crank pin.
  const z = async (deg) => {
    await page.evaluate((d) => window.__cadk.setAngle(d), deg);
    return page.evaluate(() => window.__cadk.position('piston_1')[2]);
  };
  const [z0, z90, z180] = [await z(0), await z(90), await z(180)];
  expect(Math.abs(z0 - z180 - 2 * R) < 1e-4, at(`piston 1 travels ${z0 - z180} mm from 0° to 180°, not the stroke ${2 * R}`));
  expect(Math.abs(z0 - z90 - (R + L - Math.sqrt(L * L - R * R))) < 1e-4, at(`piston 1 at 90° is ${z0 - z90} mm down, not ${R + L - Math.sqrt(L * L - R * R)}`));
  // And through the slider itself.
  await page.locator('#crank').fill('270');
  const a = await page.evaluate(() => [document.getElementById('angle').textContent, window.__cadk.position('piston_1')[2]]);
  expect(a[0] === '270°' && Math.abs(a[1] - z90) < 1e-4, at(`the slider at 270 shows ${a[0]} with piston 1 at ${a[1]} (wanted ${z90})`));
  // Play turns it; Pause stops it.
  await page.locator('#play').click();
  await page.waitForTimeout(400);
  await page.locator('#play').click();
  const played = (await state()).angle;
  expect(played !== 270, at('Play did not turn the crank'));

  // The kernel loads in a worker under the page's CSP. (Its rebuild of the engine takes about a
  // minute, so the full rebuild is left to the phone and the kernel's own browser check.)
  const info = await page.evaluate(() => window.__cadk.kernelInfo().then((i) => i, (e) => ({ error: String(e) })));
  expect(typeof info?.name === 'string' && info.tier >= 4, at(`the kernel did not load in its worker: ${JSON.stringify(info)}`));

  expect(errors.length === 0, at(`console errors: ${errors.join(' | ')}`));
  await ctx.close();
  if (failures.length) throw new Error(failures.join('\n'));
}
