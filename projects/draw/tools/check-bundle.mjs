#!/usr/bin/env node
// The bundle guard (P1-M3 S3; plan §2 and §11). Runs in `npm run build` right after vite build: every
// .js file under dist/ (the app and every lazy chunk: the ledger, path-bool, paper-core) is scanned
// for code that compiles strings, which the page's CSP blocks and Draw never ships:
// - eval: eval(…), an indirect (0, eval)(…) or eval?.(…), and setTimeout or setInterval handed a string;
// - new-function: new Function(…);
// - function-string: Function(…) handed a string.
// A bare `import 'paper'` would bring paper-full, whose PaperScript compiles with new Function: this is
// what stops it. Prints `file:offset  rule` per finding (never the matched text) and exits 1.
//
//   node tools/check-bundle.mjs [dir]     default: dist

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULES = [
  ['eval', /\beval\s*\(|\beval\s*\)\s*\(|\beval\s*\?\.\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/g],
  ['new-function', /\bnew\s+Function\s*\(/g],
  ['function-string', /\bFunction\s*\(\s*['"`]/g],
];

/** Every .js file under dir, sorted. */
function jsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** The findings under dir: each file (relative to dir), the offset, the rule. */
export function scan(dir) {
  const findings = [];
  for (const file of jsFiles(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const [rule, re] of RULES) for (const m of text.matchAll(re)) findings.push({ file: relative(dir, file), offset: m.index, rule });
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.offset - b.offset);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
  const found = scan(dir);
  for (const f of found) console.log(`${f.file}:${f.offset}  ${f.rule}`);
  if (found.length) {
    console.error(`check-bundle: ${found.length} finding(s): code that compiles strings, which the CSP blocks`);
    process.exit(1);
  }
  console.log(`check-bundle: clean (${jsFiles(dir).length} file(s))`);
}
