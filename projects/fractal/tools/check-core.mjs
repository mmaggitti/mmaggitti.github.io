// Fractal's code bans, run first in `npm run build` so CI fails on them (the pattern of Draw's
// tools/check-sinks.mjs). Prints `file:line rule`, never the matched text.
//
// - src/core is DOM-free and dependency-free: node --test runs it as-is.
// - React stays out of src/core and src/runtime: the engine never renders through a framework.
// - Storage APIs live only in src/platform: every project on the origin shares storage, so one
//   place owns the `fractal:` keys.
// - No HTML sinks anywhere: the origin is shared with every other project on the site.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');

const RULES = [
  ['core-dom', /\b(document|window|navigator|localStorage|sessionStorage|indexedDB|HTMLElement|requestAnimationFrame|getComputedStyle)\b\s*[.(]/, (f) => f.startsWith('src/core/')],
  ['core-npm-import', /^\s*import\b[^'"]*['"](?![./]|node:)[^'"]+['"]/, (f) => f.startsWith('src/core/')],
  ['core-ts-extension', /^\s*(?:import|export)\b[^'"]*['"]\.{1,2}\/[^'"]*(?<!\.ts)['"]/, (f) => f.startsWith('src/core/')],
  ['no-react-in-engine', /^\s*import\b[^'"]*['"](react|react-dom)(\/[^'"]*)?['"]/, (f) => f.startsWith('src/core/') || f.startsWith('src/runtime/')],
  ['storage', /\b(localStorage|sessionStorage|indexedDB|caches)\b/, (f) => !f.startsWith('src/platform/')],
  ['html-sink', /\b(innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML)\b|document\.write\b|\beval\s*\(|new\s+Function\b/, () => true],
];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

const findings = [];
for (const path of walk(src)) {
  const file = relative(root, path).split('\\').join('/');
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const [rule, re, applies] of RULES) if (applies(file) && re.test(code)) findings.push(`${file}:${i + 1} ${rule}`);
  });
}
if (findings.length) {
  console.error(findings.join('\n'));
  console.error(`check-core: ${findings.length} finding(s)`);
  process.exit(1);
}
console.log('check-core: clean');
