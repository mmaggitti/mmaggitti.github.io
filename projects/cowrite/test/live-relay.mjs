// A manual check against the REAL public relay (wss://sync.automerge.org), never run in CI: CI
// uses the stand-in in e2e.mjs. Two browser contexts open the built page; one writes, the other
// opens the share link; text must cross both ways through the relay.
//
//   npm run build (at the site root), then: node projects/cowrite/test/live-relay.mjs
//
// `bridge` (optional) routes the page's relay socket somewhere else, e.g. through a Node client
// where the browser can't reach the relay directly; see the export at the bottom.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SITE = fileURLToPath(new URL('../../../_site/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

// The page is served from _site by request routing, not a local server: behind a proxy, only the
// relay's websocket goes out.
const origin = 'https://cowrite.test';
async function serve(ctx) {
  await ctx.route(`${origin}/**`, async (route) => {
    let path = normalize(decodeURIComponent(new URL(route.request().url()).pathname));
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(SITE, path));
      await route.fulfill({ status: 200, body, contentType: TYPES[extname(path)] ?? 'application/octet-stream' });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
}

const bridge = globalThis.cowriteRelayBridge ?? null;
const browser = await chromium.launch();
const value = () => document.querySelector('.cw-area')?.value ?? null;
const state = () => document.querySelector('[data-check="status"]')?.dataset.status ?? null;
async function until(page, read, ok, what, ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await page.evaluate(read);
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`${what}: ${JSON.stringify(v)}`);
    await page.waitForTimeout(50);
  }
}
async function device(name, color, url) {
  const ctx = await browser.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true });
  await serve(ctx);
  if (bridge) await ctx.routeWebSocket((u) => u.hostname === 'sync.automerge.org', bridge);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] ${e.message}`));
  await page.goto(url);
  await page.locator('#name').fill(name);
  await page.locator(`[data-color="${color}"]`).click();
  await page.locator('[data-action="save-identity"]').click();
  return page;
}

let code = 0;
try {
  const a = await device('Live A', '#e5484d', `${origin}/cowrite/`);
  await a.locator('[data-action="new"]').click();
  await until(a, state, (s) => s === 'online', 'A online');
  const stamp = `live check ${new Date().toISOString()}`;
  await a.locator('.cw-area').focus();
  await a.keyboard.type(stamp);
  const b = await device('Live B', '#0d74ce', a.url());
  let t = Date.now();
  await until(b, value, (v) => v === stamp, 'A → B');
  console.log(`A → B: the document arrived through the relay (${Date.now() - t} ms after B joined)`);
  await b.locator('.cw-area').focus();
  await b.locator('.cw-area').evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  t = Date.now();
  await b.keyboard.type(' + B');
  await until(a, value, (v) => v === `${stamp} + B`, 'B → A');
  console.log(`B → A: live edit in ${Date.now() - t} ms (typing + the 300 ms batch + the relay)`);
  console.log('live relay: ok');
} catch (e) {
  console.error(`live relay: FAILED — ${e.message}`);
  code = 1;
} finally {
  await browser.close();
}
process.exit(code);
