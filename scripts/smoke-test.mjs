#!/usr/bin/env node
// Phone-size smoke test over the built site (_site/): the launcher plus every project in it.
//
// For each page, at Mark's primary phone's viewport with touch on, it fails when:
//   - the page doesn't load (non-2xx)
//   - anything logs a console error or throws an uncaught exception
//   - the page scrolls sideways (content wider than the screen)
//   - a same-origin request fails or 4xx/5xxs (a wrong asset path, usually a missing BASE_PATH)
// and saves a screenshot to .smoke/<engine>/<page>.png — at 1x, so it is 440×956 px, the phone's
// own point size.
//
//   ENGINE=chromium (default; the only engine in the cloud container)
//   ENGINE=webkit   (CI — Safari's engine; the phone itself is still the final word)
//
// Serving over HTTP, not file://, because ES modules refuse to load from file:// — the same reason
// as the crossword suite's _serve.cjs, which this server is adapted from.

import { existsSync, mkdirSync, readdirSync, readFile, rmSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = resolve(ROOT, '_site');
const ENGINE = process.env.ENGINE ?? 'chromium';
const SHOTS = join(ROOT, '.smoke', ENGINE);
// Mark's primary device: a 440×956-point screen (@3x hardware). 956 is the full height a Home
// Screen launch gets; in a Safari tab the browser bars leave 440×796.
const VIEWPORTS = [{ name: 'primary phone', width: 440, height: 956 }];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.wasm': 'application/wasm',
};

if (!existsSync(join(SITE, 'index.html'))) {
  console.error('smoke-test: no _site/index.html — run `npm run build` first.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = join(SITE, normalize(rel));
  if (file !== SITE && !file.startsWith(SITE + sep)) return void res.writeHead(403).end();
  readFile(file, (err, data) => {
    if (err) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const pages = [
  { name: '_launcher', path: '/' },
  ...readdirSync(SITE, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SITE, d.name, 'index.html')))
    .map((d) => ({ name: d.name, path: `/${d.name}/` })),
];

mkdirSync(SHOTS, { recursive: true });
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
let failed = 0;

for (const pg of pages) {
  for (const [i, vp] of VIEWPORTS.entries()) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const problems = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text()}`));
    page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
    page.on('requestfailed', (r) => r.url().startsWith(origin) && problems.push(`request failed: ${r.url().slice(origin.length)}`));
    page.on('response', (r) => r.url().startsWith(origin) && r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url().slice(origin.length)}`));

    try {
      const res = await page.goto(origin + pg.path, { waitUntil: 'networkidle' });
      if (!res?.ok()) problems.push(`page returned ${res?.status()}`);
      // clientWidth, not innerWidth: under mobile emulation Chromium widens innerWidth to the content,
      // so innerWidth-based overflow always reads 0.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) problems.push(`scrolls sideways by ${overflow}px`);
      if (i === 0) await page.screenshot({ path: join(SHOTS, `${pg.name}.png`) });
    } catch (e) {
      problems.push(`load failed: ${e.message.split('\n')[0]}`);
    }

    const label = `${pg.path} @ ${vp.width}×${vp.height} (${ENGINE})`;
    if (problems.length) {
      failed++;
      console.log(`FAIL ${label}`);
      for (const p of problems) console.log(`     ${p}`);
    } else {
      console.log(`ok   ${label}`);
    }
    await context.close();
  }
}

// Project end-to-end tests: projects/<name>/test/e2e.mjs exports default async ({ browser, origin,
// engine }) and throws on failure. They reuse this server and browser, so they run in Chromium
// here and WebKit in CI like everything else.
// E2E=draw,studio runs only those projects' e2e (the page checks above still run on every page): a
// local shortcut for tools such as Draw's prove-breaks. CI never sets it.
const only = process.env.E2E ? new Set(process.env.E2E.split(',').map((s) => s.trim()).filter(Boolean)) : null;
rmSync(join(ROOT, '.smoke', 'draw-e2e-evidence.jsonl'), { force: true }); // Draw's ledger evidence comes only from this run's e2e
for (const name of readdirSync(join(ROOT, 'projects')).filter((n) => !/^[_.]/.test(n) && (!only || only.has(n))).sort()) {
  const file = join(ROOT, 'projects', name, 'test', 'e2e.mjs');
  if (!existsSync(file)) continue;
  try {
    const { default: run } = await import(pathToFileURL(file).href);
    await run({ browser, origin, engine: ENGINE });
    console.log(`ok   e2e ${name} (${ENGINE})`);
  } catch (e) {
    failed++;
    console.log(`FAIL e2e ${name} (${ENGINE})`);
    console.log(`     ${String(e?.message ?? e).split('\n').join('\n     ')}`);
  }
}

await browser.close();
server.close();
console.log(failed ? `\n${failed} failing check(s).` : `\nAll ${pages.length} page(s) pass. Screenshots: .smoke/${ENGINE}/`);
process.exitCode = failed ? 1 : 0;
