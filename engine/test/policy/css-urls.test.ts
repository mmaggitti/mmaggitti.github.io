// The canvas's two CSS guards, the served profile's cssAllowed and the render policy's cssUrlsLocal,
// read each url() from a bounded window after it (never to the end of the text, which made a sheet of
// many url()s cost the square of its length). Their verdicts are the ones they gave when they read each
// url() to the end (that reading is kept below, in this file only): the same over every corpus
// <style> and attribute value, every CSS text the guards' own tests use, and every url() whose start
// lies inside the window; a start that doesn't show there is refused (a refusal stays safe). Its own
// file for the ratio test (engine/test/timing.ts): a <style> of 100 data: faces costs under 6× what
// 25 cost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linear } from '../timing.ts';
import { attrValue, descendants, parseDoc, textContent } from '../../model/doc.ts';
import { cssUrlsLocal } from '../../policy/render-policy.ts';
import { cssAllowed } from '../../../scripts/lib/svg-profile.mjs';

// ── the guards as they read each url() to the end of the text (the reference) ─────────────────

const profileSquash = (v: string) => v.replace(/[\u0000- \u007f-\u009f]/g, '');
function oldCssAllowed(css: string): boolean {
  const t = css
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/\\(.)/g, '$1')
    .toLowerCase();
  const reading = (s: string): boolean => {
    if (/@import|expression\s*\(|behavior\s*:|-moz-binding|javascript:|image-set\s*\(/.test(s)) return false;
    for (const m of s.matchAll(/url\s*\(\s*['"]?/g)) {
      const u = profileSquash(s.slice(m.index + m[0].length));
      if (u.startsWith('#')) continue;
      if (/^data:(image\/(png|jpeg|gif|webp)|font\/)/.test(u)) continue;
      if (!/^[a-z][a-z0-9+.-]*:/.test(u) && !u.startsWith('//')) continue;
      return false;
    }
    return true;
  };
  return [t, t.replace(/\/\*[\s\S]*?\*\//g, '')].every(reading);
}

const CSS_DATA = /^data:(image\/(png|jpeg|gif|webp)|font\/)/i;
const squash = (v: string): string => v.replace(/[\u0000- \u007f-\u009f]/g, '');
const asParsed = (v: string): string => v.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|(\r\n|[\n\r\f])|([\s\S]))/g;
const cssChar = (h: string): string => {
  const cp = parseInt(h, 16);
  return cp === 0 || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff ? '�' : String.fromCodePoint(cp);
};
function oldCssUrlsLocal(css: string): boolean {
  const t = css.replace(CSS_ESCAPE, (_, hex?: string, nl?: string, ch?: string) => (hex ? cssChar(hex) : nl ? '' : ch!)).toLowerCase();
  if (/image-set\s*\(|@import/.test(t)) return false;
  const ok = (u: string) => u.startsWith('#') || CSS_DATA.test(u);
  for (const m of t.matchAll(/url\s*\(\s*['"]?/g)) {
    const arg = t.slice(m.index + m[0].length);
    if (!ok(squash(arg)) || !ok(asParsed(arg))) return false;
  }
  return true;
}

// ── what they are run over ──────────────────────────────────────────────────────────────────────

const CORPUS = fileURLToPath(new URL('../fixtures/corpus/', import.meta.url));

/** Every <style>'s text and every attribute value in every corpus file (the canvas judges each value it sets). */
function corpusCss(): string[] {
  const out: string[] = [];
  for (const rel of readdirSync(CORPUS, { recursive: true, encoding: 'utf8' }).filter((p) => p.endsWith('.svg'))) {
    const r = parseDoc(readFileSync(CORPUS + rel.split(sep).join('/'), 'utf8'));
    assert.ok(r.ok, rel);
    for (const n of descendants(r.doc, r.doc.root)) {
      if (n.kind !== 'element') continue;
      if (n.local === 'style') out.push(textContent(r.doc, n.id));
      for (const a of n.attrs) out.push(attrValue(r.doc, n, a.ns, a.local)!);
    }
  }
  return out;
}

// The CSS the guards' own tests judge (engine/test/policy/render-policy.test.ts,
// projects/draw/test/unit/svg-profile.test.ts): every url() form around each of their URLs, @import in
// every form, @namespace, and the single cases.
const TEST_URLS = ['javascript:void(0)', 'vbscript:void(0)', 'data:text/html,hello', 'https://example.com/logo.png', 'http://example.com/logo.png', '//example.com/logo.png', 'https://example.com/sprite.svg#icon', '#g', 'paint.svg#g', 'data:image/png;base64,AAAA', 'data:font/woff2;base64,AAAA'];
const GUARD_TESTS: string[] = [
  ...TEST_URLS.flatMap((url) => [url, url.toUpperCase(), ` ${url}`, `\t${url}`]).flatMap((u) => [
    `rect { fill: url(${u}) }`, `rect { fill: url("${u}") }`, `@font-face { font-family: X; src: url(${u}) }`, `rect { cursor: url(${u}), auto }`,
    `fill: url(${u})`, `url(${u})`, `url('${u}')`, `url(${u}), auto`, `red;url(${u})`, `url(${u}`, `url('${u})`, `mask:url('${u})`, `rect{mask:url('${u})}`,
    `rect { fill: image-set("${u}" 1x) }`,
  ]),
  '@import "theme.css";', '@import url(theme.css) screen;', '@import url("#local");', '@IMPORT "theme.css";', '@layer base; @import "theme.css" layer(base);', '/* theme */ @import "theme.css";', '@\\69mport "theme.css";',
  '@namespace "http://www.w3.org/2000/svg";', '@namespace svg "http://www.w3.org/2000/svg"; svg|rect { fill: teal }', '@namespace url(http://www.w3.org/2000/svg);', '@namespace svg url("http://www.w3.org/2000/svg"); svg|rect { fill: teal }',
  'fill:red;stroke:url(#g)', 'fill:url(other.svg#g)', 'background:url(data:image/png;base64,AAAA)', 'background:url(https://example.com/x.png)', 'url(other.svg#g)', 'url(https://example.com/m.svg#m)', "url('#f')",
  'fill:url(#g)', 'fill:url( "#g" )', 'src:url(data:font/woff2;base64,AAAA)', 'fill:red', 'fill:url(x.svg#g)', 'background:image-set("x.png" 1x)', 'fill:URL(other.svg#g)', '@import "a.css";', '@IMPORT url(#a);', '@charset "utf-8"; rect { fill: red }',
  'fill: u\\72l(https://x)', '@font-face{font-family:X;src:url(data:font/woff2;base64,AAAA)}', '/* brand */ rect { fill: url(#g) /* the gradient */ } /* end */', 'fill: /* teal */ #2a9d8f',
  '@import url(x.css);', 'rect{fill:url(https://evil.example/x)}', 'background:url(https://evil.example/b)', 'width:expression(alert(1))',
];

// A url() whose start lies inside the window: control characters before it (the url( match takes
// whitespace itself; both readings drop controls), a long scheme-like run that ends there, an unclosed
// one at the end of the text, a comment splitting the keyword.
const EDGES: string[] = [0, 1, 50, 400, 480].flatMap((k) => {
  const pad = '\u0001'.repeat(k);
  return [
    `fill:url(${pad}#g)`, `fill:url(${pad}https://x.example/a)`, `fill:url(${pad}data:font/woff2;base64,AAAA)`, `fill:url(${pad}data:image/svg+xml,x)`, `fill:url(${pad}//x.example/a)`,
    `fill:url(${pad}a.png)`, `fill:url(${pad}/a.png)`, `fill:url(${pad}#`, `fill:url(${pad}`, `fill:url(${pad}d`, `fill:url(\t\n${pad}\u0001#g)`, `fill:url("${pad}data:image/png;base64,AAAA")`,
    `fill:url(${'a'.repeat(k)}:x)`, `fill:url(${'a'.repeat(k)})`, `fill:url(${'a'.repeat(k)}`, `fill:u/**/rl(${pad}https://x)`, `fill:url(/*${pad}*/https://x)`,
  ];
});

// Each edge again with text after it, so the window ends before the text does.
const TAIL = `;stroke:url(#h);${'b'.repeat(700)}`;

test('the guards’ verdicts are unchanged: over every corpus <style> and attribute value, every CSS text their own tests use, and a url() whose start lies inside the window', () => {
  const all = [...corpusCss(), ...GUARD_TESTS, ...EDGES, ...EDGES.map((e) => e + TAIL), sheet(3), `/* Inter. Copyright 2020 The Inter Project Authors. */${sheet(2)}`];
  assert.ok(all.length > 5000, `only ${all.length} texts`);
  let urls = 0;
  for (const css of all) {
    if (/url\s*\(/i.test(css)) urls++;
    assert.equal(cssAllowed(css), oldCssAllowed(css), `cssAllowed: ${JSON.stringify(css.slice(0, 120))}`);
    assert.equal(cssUrlsLocal(css), oldCssUrlsLocal(css), `cssUrlsLocal: ${JSON.stringify(css.slice(0, 120))}`);
  }
  assert.ok(urls > 400, `only ${urls} texts hold a url()`);
});

test('a url() whose start doesn’t show within 512 characters of it is refused (a refusal stays safe): 600 control characters before a fragment, a 600-letter name that might still be a scheme', () => {
  for (const css of [`fill:url(${'\u0001'.repeat(600)}#g)`, `fill:url(${'a'.repeat(600)})`]) {
    assert.equal(oldCssAllowed(css), true, 'read to the end, it passed');
    assert.equal(cssAllowed(css), false, JSON.stringify(css.slice(0, 40)));
  }
  const far = `fill:url(${'\u0001'.repeat(600)}#g)`;
  assert.equal(oldCssUrlsLocal(far), true);
  assert.equal(cssUrlsLocal(far), false);
});

// A base64 run as long as Inter 400's .woff2 (23 KB: 31,500 characters), the same for each face.
let seed = 7;
const B64 = Array.from({ length: 31500 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[(seed = (seed * 1103515245 + 12345) % 2147483648) % 64]).join('');
const sheet = (n: number) => Array.from({ length: n }, (_, i) => `@font-face{font-family:F${i};src:url(data:font/woff2;base64,${B64}) format("woff2")}`).join('\n');

// Measured in node: about 10 and 26 ms over 25 and 100 faces; read to the end, 100 faces took about
// 970 ms (320 cssAllowed, 650 cssUrlsLocal), and 400 faces 17 s.
test('the canvas’s CSS guards take linear time: cssAllowed and cssUrlsLocal over a <style> of 100 data: faces (3.2 MB) cost under 6× what 25 cost', () => {
  const small = sheet(25);
  const big = sheet(100);
  const guards = (css: string) => () => assert.ok(cssAllowed(css) && cssUrlsLocal(css), 'test setup: the canvas draws the sheet');
  linear('cssAllowed and cssUrlsLocal', guards(small), guards(big), { limit: 150 });
});
