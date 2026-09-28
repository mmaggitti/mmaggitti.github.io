#!/usr/bin/env node
// Deliberate breaks: every guard in Draw's pipeline must be able to fail. Each break edits one
// file, runs the check that should catch it, requires a non-zero exit, and restores the file
// (in `finally`, so an interrupted run never leaves a break behind; `git diff` should be empty
// afterwards).
//
//   node tools/prove-breaks.mjs           every break (the e2e ones rebuild the site: slow)
//   node tools/prove-breaks.mjs --quick   only the breaks caught without a site build
//   node tools/prove-breaks.mjs B3 B5     just these
//
// Add a break whenever a milestone adds a check. The plan's rule: a check nobody has seen fail
// isn't a check.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DRAW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(DRAW, '..', '..');
const SITE_E2E = ['sh', ['-c', 'node scripts/build-site.mjs >/dev/null && node scripts/check-library.mjs --site _site && node scripts/smoke-test.mjs'], REPO];
const engineTests = (file) => ['node', ['--test', '--test-reporter=spec', `../../engine/test/${file}`], DRAW];
const XML_TESTS = engineTests('xml.test.ts');

const BREAKS = [
  {
    id: 'B1', what: 'the CSP plugin no longer injects the meta tag', slow: true,
    file: 'projects/draw/vite.config.ts', from: 'plugins: [react(), csp()]', to: 'plugins: [react()]',
    run: SITE_E2E, expect: /first element in <head>/,
  },
  {
    id: 'B2', what: 'an innerHTML sink appears in the app',
    file: 'projects/draw/src/panels/App.tsx', append: "\nexport const leak = (el: HTMLElement, s: string) => { el.innerHTML = s; };\n",
    run: ['node', ['tools/check-sinks.mjs'], DRAW], expect: /html-sink/,
  },
  {
    id: 'B3', what: 'a script-bearing .svg is put in the library',
    create: 'projects/draw/public/library/designs/planted.svg',
    content: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n',
    run: ['node', ['scripts/check-library.mjs'], REPO], expect: /svg-profile\/element:script/,
  },
  {
    id: 'B4', what: "the preview gains allow-same-origin",
    file: 'projects/draw/src/panels/App.tsx', append: "\nexport const SANDBOX = 'allow-scripts allow-same-origin';\n",
    run: ['node', ['tools/check-sinks.mjs'], DRAW], expect: /allow-same-origin/,
  },
  {
    id: 'B5', what: 'Draw loses its unlisted marker', slow: true,
    file: 'projects/draw/index.html', from: '<meta name="launcher" content="unlisted">', to: '',
    run: SITE_E2E, expect: /launcher lists Draw/,
  },
  {
    id: 'B6', what: 'the ledger and the served profile disagree on the version',
    file: 'engine/ledger/ledger.json', from: '"profileVersion": 1', to: '"profileVersion": 2',
    run: ['node', ['tools/ledger-check.mjs'], DRAW], expect: /profileVersion/,
  },
  {
    id: 'B7', what: 'the engine touches the DOM',
    create: 'engine/leak.ts', content: 'export const title = () => document.title;\n',
    run: ['node', ['tools/check-sinks.mjs'], DRAW], expect: /engine-dom/,
  },
  {
    id: 'B8', what: 'the engine imports an npm package',
    create: 'engine/leak.ts', content: "import x from 'left-pad';\nexport default x;\n",
    run: ['node', ['tools/check-sinks.mjs'], DRAW], expect: /engine-npm-import/,
  },
  {
    id: 'B9', what: 'a served .svg elsewhere on the site carries a handler', slow: true,
    file: 'projects/draw/public/icon.svg', from: '<svg xmlns="http://www.w3.org/2000/svg"', to: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"',
    run: SITE_E2E, expect: /event-handler/,
  },
  {
    id: 'B10', what: "the profile forgets the HTML comment breakout",
    file: 'scripts/lib/svg-profile.mjs', from: "else if (/^-?>|[<>]/.test(text.slice(i + 4, end))) add('comment-html-ambiguous', i);", to: '',
    run: ['npm', ['run', '--silent', 'test:unit'], DRAW], expect: /comment-html-ambiguous|comment breakout/,
  },
  {
    id: 'B11', what: 'a control drops under the 44pt floor', slow: true,
    file: 'projects/draw/src/panels/App.tsx', from: '<span className="draw-badge ds-small">preview</span>', to: '<span className="draw-badge ds-small">preview</span><button style={{ width: 20, height: 20 }}>x</button>',
    run: SITE_E2E, expect: /tap targets under 44pt/,
  },
  // P0-M1: the engine's round trip and limits.
  {
    id: 'B12', what: 'the serializer drops a byte from untouched subtrees',
    file: 'engine/model/doc.ts', from: 'doc.source.slice(n.src!.whole.start, n.src!.whole.end)', to: 'doc.source.slice(n.src!.whole.start, n.src!.whole.end - 1)',
    run: XML_TESTS, expect: /✖ every corpus file round-trips/,
  },
  {
    id: 'B13', what: 'an attribute edit re-spaces the whole start tag',
    file: 'engine/model/doc.ts', from: 's += `${a.lead}${a.qname}', to: 's += ` ${a.qname}',
    run: XML_TESTS, expect: /✖ one attribute edit changes exactly that attribute/,
  },
  {
    id: 'B14', what: 'entity expansion loses its size budget',
    file: 'engine/xml/entities.ts', from: 'if (budget.left < 0) throw', to: 'if (false) throw',
    run: XML_TESTS, expect: /✖ a wide, shallow expansion hits the size budget/,
  },
  {
    id: 'B15', what: 'entity expansion loses its depth limit',
    file: 'engine/xml/entities.ts', from: 'if (depth > ENTITY_DEPTH) throw', to: 'if (false) throw',
    run: XML_TESTS, expect: /✖ a deep chain of tiny entities hits the depth limit/,
  },
  {
    id: 'B16', what: 'the number formatter falls back to exponent notation',
    file: 'engine/values/number-format.ts', from: 'if (Math.abs(n) >= 1e21) return BigInt(n).toString();', to: '',
    run: engineTests('values/number-format.test.ts'), expect: /✖ fmt never writes -0 or an exponent/,
  },
  {
    id: 'B17', what: 'the path parser drops the text after an error',
    file: 'engine/path/parse.ts', from: "if ('message' in r) return { segs, tail: d.slice(pos), error: r };", to: "if ('message' in r) return { segs, tail: '', error: r };",
    run: engineTests('path/parse.test.ts'), expect: /✖ (fuzz: any string|parsing stops at the first error)/,
  },
];

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const only = args.filter((a) => /^B\d+$/.test(a));
const chosen = BREAKS.filter((b) => (only.length ? only.includes(b.id) : !(quick && b.slow)));

let undetected = 0;
for (const b of chosen) {
  const file = b.file && join(REPO, b.file);
  const created = b.create && join(REPO, b.create);
  const original = file ? readFileSync(file, 'utf8') : null;
  // the outermost folder a created file needs that doesn't exist yet, removed afterwards
  let newDir = null;
  for (let d = created && dirname(created); d && d.startsWith(REPO) && !existsSync(d); d = dirname(d)) newDir = d;
  let out = '';
  let caught = false;
  try {
    if (file) {
      const next = b.append != null ? original + b.append : original.replace(b.from, b.to);
      if (next === original) throw new Error(`${b.id}: the break did not apply (anchor not found)`);
      writeFileSync(file, next);
    }
    if (created) {
      mkdirSync(dirname(created), { recursive: true });
      writeFileSync(created, b.content);
    }
    const [cmd, cmdArgs, cwd] = b.run;
    try {
      out = execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      caught = b.expect.test(out);
    }
  } finally {
    if (file) writeFileSync(file, original);
    if (created && existsSync(created)) rmSync(created);
    if (newDir) rmSync(newDir, { recursive: true, force: true });
  }
  if (!caught) undetected++;
  console.log(`${caught ? 'red ✓' : 'GREEN ✗'}  ${b.id}  ${b.what}${caught ? '' : `\n        expected ${b.expect} in:\n${out.split('\n').slice(-8).map((l) => '        ' + l).join('\n')}`}`);
}
console.log(undetected ? `\n${undetected} break(s) went undetected.` : `\nAll ${chosen.length} break(s) went red.`);
process.exitCode = undetected ? 1 : 0;
