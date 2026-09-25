#!/usr/bin/env node
// Design-system check: sizes are rem, not px.
//
//   node scripts/check-units.mjs         scan ds/ and projects/ (exit 1 on findings)
//   node scripts/check-units.mjs <dir>   scan another folder
//
// The UI scales from one knob (--ui-scale in ds/ds.css), and only rem follows it; a raw px value
// silently stays full-size while everything around it shrinks. So px is allowed only where it must
// stay physical: 0–3px (hairlines, focus rings), or a line marked `px-ok` with the reason.
//
// Scans .css files, and <style> blocks and style="…" attributes in .html. Not JS/JSX/SVG: canvas
// and SVG coordinates are legitimately px.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const PX = /(?<![\w.#])-?(\d*\.?\d+)px\b/g;
const ALLOWED = new Set(['0', '1', '2', '3']);

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(join(dir, e.name));
    } else if (/\.(css|html)$/.test(e.name)) {
      yield join(dir, e.name);
    }
  }
}

function check(file) {
  const findings = [];
  const isHtml = file.endsWith('.html');
  let inStyle = false;
  const raw = readFileSync(file, 'utf8');
  const rawLines = raw.split('\n');
  // Blank out /* comments */ (keeping line breaks) so prose like "1rem = 12px" isn't a finding;
  // the px-ok marker is still read from the raw line.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  code.split('\n').forEach((line, n) => {
    let scan = !isHtml;
    if (isHtml) {
      // Track <style> blocks across lines; style="…" attributes count wherever they appear.
      if (/<style\b/i.test(line)) inStyle = true;
      scan = inStyle || /\sstyle\s*=/i.test(line);
      if (/<\/style>/i.test(line)) inStyle = false;
    }
    if (!scan || rawLines[n].includes('px-ok')) return;
    for (const m of line.matchAll(PX)) {
      if (!ALLOWED.has(String(Number(m[1])))) findings.push(`${n + 1}  ${m[0]}`);
    }
  });
  return findings;
}

const dirs = process.argv[2] ? [resolve(process.argv[2])] : ['ds', 'projects'].map((d) => join(ROOT, d));
let total = 0;
for (const dir of dirs) {
  let files;
  try {
    files = [...walk(dir)];
  } catch {
    continue; // folder absent
  }
  for (const file of files) {
    for (const f of check(file)) {
      if (!total) console.error('check-units: raw px found — use rem tokens from ds/ds.css (or mark the line `px-ok` with a reason):');
      console.error(`  ${relative(ROOT, file)}:${f}`);
      total++;
    }
  }
}
if (total) process.exitCode = 1;
else console.log('check-units: clean — sizes are rem');
