// Renders public/icon.svg to the PNGs iOS and the manifest need (apple-touch-icon.png 180×180,
// icon-512.png). iOS rounds the corners itself, so the PNGs are full squares in the field colour.
// Run with `npm run icons` after changing the SVG; the PNGs are committed.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pub = fileURLToPath(new URL('../public/', import.meta.url));
const svg = readFileSync(pub + 'icon.svg', 'utf8');
const field = /<rect width="64" height="64"[^>]*fill="(#[0-9a-f]{6})"/i.exec(svg)?.[1] ?? '#000000';
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
try {
  for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-512.png', 512]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const square = svg.replace(/rx="14"/, 'rx="0"');
    await page.setContent(`<body style="margin:0;background:${field}"><img src="data:image/svg+xml;base64,${Buffer.from(square).toString('base64')}" width="${size}" height="${size}" style="display:block"></body>`);
    await page.screenshot({ path: pub + name });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('icons written');
