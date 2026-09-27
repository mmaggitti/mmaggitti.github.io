#!/usr/bin/env node
// Static sink ban for Draw. Runs first in `npm run build`, so it gates CI.
//
// Draw renders documents it did not write, on an origin every project shares. SVG Lab's stored XSS
// came from one innerHTML sink; the rule here is structural: document content reaches the page
// only through src/canvas/safe-sink.ts, and the dangerous APIs aren't in the codebase at all.
// Findings print as `file:line  rule`.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DRAW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = resolve(DRAW, '..', '..', 'engine');
const rel = (p) => relative(resolve(DRAW, '..', '..'), p).split(sep).join('/');

// [rule, pattern, files it is allowed in (repo-relative prefixes)]
const BANS = [
  ['html-sink', /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML/, []],
  ['srcdoc', /\bsrcdoc\b/, []],
  ['eval', /\beval\s*\(|\bnew\s+Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/, []],
  // The script preview (P5) must stay an opaque origin.
  ['allow-same-origin', /allow-same-origin/, []],
  // Document elements and attributes are created only by the sink. The overlay draws the app's
  // own handles (never document content), so it may create its own elements.
  ['dom-write', /\b(createElementNS|setAttributeNS?|setAttribute)\s*\(/, ['projects/draw/src/canvas/safe-sink.ts', 'projects/draw/src/canvas/overlay.ts']],
  ['storage', /\b(localStorage|sessionStorage|indexedDB|caches)\b|navigator\.storage/, ['projects/draw/src/platform/']],
  ['fetch', /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|\bWebSocket\b|\bEventSource\b/, ['projects/draw/src/platform/', 'projects/draw/src/github/', 'projects/draw/src/export/']],
  ['password-field', /type\s*[=:]\s*["']password["']/, ['projects/draw/src/github/TokenForm.tsx']],
];

// The engine is DOM-free and dependency-free: node --test runs it, and any project may import it.
const ENGINE_BANS = [
  ['engine-dom', /\b(document|window|navigator|localStorage|sessionStorage|indexedDB|HTMLElement|SVGElement|DOMParser|XMLSerializer)\b\s*[.(]/],
  ['engine-npm-import', /^\s*import\b[^'"]*['"](?![./]|node:)[^'"]+['"]/],
];

function* walk(dir, exts) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'dist') yield* walk(p, exts);
    } else if (exts.test(e.name)) yield p;
  }
}

// Comments may discuss the rules ("never innerHTML"); only code counts.
function codeLines(text) {
  const noBlocks = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  return noBlocks.split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'));
}

const findings = [];
const scan = (file, bans) => {
  const r = rel(file);
  const isTest = /(^|\/)test\//.test(r);
  codeLines(readFileSync(file, 'utf8')).forEach((line, n) => {
    for (const [rule, re, allowed = []] of bans) {
      if (isTest && rule !== 'allow-same-origin') continue; // tests poke at the page on purpose
      if (re.test(line) && !allowed.some((a) => r === a || r.startsWith(a))) findings.push(`${r}:${n + 1}  ${rule}`);
    }
  });
};

for (const f of walk(join(DRAW, 'src'), /\.(ts|tsx|js|mjs)$/)) scan(f, BANS);
for (const f of walk(join(DRAW, 'public'), /\.(html|js|mjs|svg)$/)) scan(f, BANS.filter(([r]) => r === 'allow-same-origin' || r === 'srcdoc' || r === 'eval'));
scan(join(DRAW, 'index.html'), BANS.filter(([r]) => r === 'allow-same-origin' || r === 'srcdoc'));
for (const f of walk(ENGINE, /\.ts$/)) {
  if (/\/test\//.test(rel(f))) continue;
  scan(f, [...BANS.filter(([r]) => r === 'html-sink' || r === 'eval'), ...ENGINE_BANS]);
}

if (findings.length) {
  console.error(`check-sinks: ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  ${f}`);
  console.error('Document content reaches the page only through src/canvas/safe-sink.ts (see the Draw section of CLAUDE.md).');
  process.exitCode = 1;
} else {
  console.log('check-sinks: clean');
}
