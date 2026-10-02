// tools/check-bundle.mjs (P1-M3 S3): every .js file under dist/ is scanned for code that compiles
// strings, which Draw's CSP blocks. A clean fixture passes; each pattern planted in a fixture file
// fails the tool, which prints `file:offset  rule` and never the matched text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan } from '../../tools/check-bundle.mjs';

const TOOL = fileURLToPath(new URL('../../tools/check-bundle.mjs', import.meta.url));

// Near misses that must pass: words holding "eval", a timer handed a function, Function named but not called with a string.
const CLEAN = [
  'export const retrieval = (s) => s.replace(/x/g, "y");',
  'const evaluate = () => 1; evaluate();',
  'setTimeout(() => retrieval("a"), 0); setInterval(evaluate, 10);',
  'const isFn = typeof retrieval === "function" && retrieval instanceof Function; Function.prototype.call.bind(isFn);',
  'class NewFunctionRow {} new NewFunctionRow();',
].join('\n');

const PLANTS: [rule: string, code: string][] = [
  ['eval', 'const x = eval("1 + 1");'],
  ['eval', 'const y = (0, eval)("1 + 1");'],
  ['eval', 'const z = eval?.("1 + 1");'],
  ['eval', 'setTimeout("tick()", 10);'],
  ['eval', 'setInterval(`tick()`, 10);'],
  ['new-function', 'const g = new Function(body);'],
  ['function-string', 'const h = Function("return this")();'],
];

/** A dist-like folder: the clean app file, and `planted` (if any) in assets/. */
function fixture(planted?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-bundle-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index-abc.js'), CLEAN);
  writeFileSync(join(dir, 'index.html'), '<script>eval("not a .js file")</script>');
  if (planted !== undefined) writeFileSync(join(dir, 'assets', 'chunk-def.js'), `${CLEAN}\n${planted}\n`);
  return dir;
}
const run = (dir: string) => spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' });

test('check-bundle: a clean bundle passes (near misses included, and only .js files are read)', () => {
  const dir = fixture();
  try {
    assert.deepEqual(scan(dir), []);
    const r = run(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /check-bundle: clean \(1 file\(s\)\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-bundle: each pattern planted in a chunk fails the build, printed as file:offset and rule, never the text', () => {
  for (const [rule, code] of PLANTS) {
    const dir = fixture(code);
    try {
      const offset = CLEAN.length + 1 + code.search(/eval|setTimeout|setInterval|new Function|Function\(/);
      assert.deepEqual(scan(dir), [{ file: join('assets', 'chunk-def.js'), offset, rule }], code);
      const r = run(dir);
      assert.equal(r.status, 1, `${code}: exit ${r.status}`);
      assert.equal(r.stdout, `${join('assets', 'chunk-def.js')}:${offset}  ${rule}\n`, code);
      assert.ok(!(r.stdout + r.stderr).includes(code.slice(10, 20)), `${code}: the matched text was printed`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
