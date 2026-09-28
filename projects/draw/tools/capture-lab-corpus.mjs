#!/usr/bin/env node
// Capture SVG Lab's own exports into the engine's round-trip corpus. Draw is built from SVG Lab,
// so every file the lab can hand a user must open in Draw and save back byte for byte. The
// files come from the real Download button in a real browser, not from a copy of the lab's
// serializer that could drift from it.
//
//   node tools/capture-lab-corpus.mjs     needs a built _site/ (node scripts/build-site.mjs)
//
// Writes engine/test/fixtures/corpus/lab/<lab id>.svg for each of the 29 screens (28 lessons +
// Create) in its default state, <lab id>--<mode>.svg for every other mode chip a lesson offers
// (modes add markup the default never shows: Spinner's JS mode a <script>, Media's iframe mode a
// srcdoc), and create-<template>.svg for Create's templates.

import { existsSync, mkdirSync, readFile, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SITE = join(REPO, '_site');
const OUT = join(REPO, 'engine', 'test', 'fixtures', 'corpus', 'lab');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
// The lab's set picker: each set's tabs, as in projects/svg-lab/test/e2e.mjs.
const SETS = [
  ['Vector', 'Grid', 'Shapes', 'Style', 'Paths', 'Transform', 'Animate', 'Charts', 'Create'],
  ['Arcs', 'Reuse', 'Paint', 'Clip', 'Markers', 'Type', 'CSS', 'Create'],
  ['Motion', 'Timing', 'Spinner', 'Links', 'Create'],
  ['Shadow', 'Color', 'Texture', 'Light', 'Create'],
  ['Size', 'Access', 'Images', 'Media', 'Switch', 'Create'],
];

if (!existsSync(join(SITE, 'svg-lab', 'index.html'))) {
  console.error('capture-lab-corpus: no _site/svg-lab/ — run `node scripts/build-site.mjs` first.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = join(SITE, normalize(rel));
  if (!file.startsWith(SITE + sep)) return void res.writeHead(403).end();
  readFile(file, (err, data) => {
    if (err) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const saved = new Set();
let modes = 0;
try {
  const context = await browser.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/svg-lab/`, { waitUntil: 'networkidle' });
  mkdirSync(OUT, { recursive: true });

  const download = async (name) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btnDl').tap()]);
    const text = readFileSync(await dl.path(), 'utf8');
    if (!text.trimStart().startsWith('<svg')) throw new Error(`${name}: the download is not an SVG`);
    writeFileSync(join(OUT, name), text);
    saved.add(name);
  };

  for (const [s, tabs] of SETS.entries()) {
    for (const tab of tabs) {
      await openLab(page, s, tab);
      const id = await page.evaluate(() => document.body.dataset.lab);
      if (!/^[a-z0-9-]+$/.test(id ?? '')) throw new Error(`set ${s + 1} ${tab}: unexpected lab id ${id}`);
      if (saved.has(`${id}.svg`)) continue; // Create appears in every set
      await download(`${id}.svg`);
      const chips = await page.locator('#controls [data-m]').evaluateAll((bs) => bs.map((b) => [b.dataset.m, b.getAttribute('aria-pressed') === 'true']));
      if (chips.length && chips.filter(([, on]) => on).length !== 1) throw new Error(`${id}: expected one pressed mode chip, got ${JSON.stringify(chips)}`);
      for (const [m, on] of chips) {
        if (on) continue; // the default, saved above as <id>.svg
        if (!/^[a-z0-9-]+$/.test(m)) throw new Error(`${id}: unexpected mode ${m}`);
        await page.locator(`#controls [data-m="${m}"]`).tap();
        await page.waitForTimeout(350);
        await download(`${id}--${m}.svg`);
        modes++;
      }
    }
  }
  await openLab(page, 0, 'Create');
  const tpls = await page.locator('#controls [data-tpl]').evaluateAll((bs) => bs.map((b) => b.dataset.tpl));
  for (const tpl of tpls) {
    await page.locator(`#controls [data-tpl="${tpl}"]`).tap();
    await page.waitForTimeout(300);
    await download(`create-${tpl}.svg`);
  }
  if (errors.length) throw new Error(`errors on the page:\n${errors.join('\n')}`);
  const want = 29 + modes + tpls.length;
  if (saved.size !== want) throw new Error(`saved ${saved.size} files, expected ${want} (29 screens, ${modes} modes, ${tpls.length} templates)`);
  console.log(`capture-lab-corpus: ${saved.size} files (29 screens, ${modes} modes, ${tpls.length} templates) → ${OUT}`);
} finally {
  await browser.close();
  server.close();
}

async function openLab(page, set, tab) {
  await page.locator('#setBtn').tap();
  await page.locator('.setrow').nth(set).tap();
  await page.locator('#tabs .tab', { hasText: tab }).first().tap();
  await page.waitForFunction((t) => (document.querySelector('#tabs .tab[aria-current="true"]')?.textContent ?? '').trim().endsWith(t), tab);
  await page.waitForTimeout(350); // the lab renders on the next frame
}
