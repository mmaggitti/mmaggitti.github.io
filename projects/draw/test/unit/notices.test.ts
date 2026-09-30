// The third-party notices (P1-M3 S3): public/THIRD-PARTY-NOTICES.txt, served beside the app, names
// every package whose code ships in Draw's bundles, with its exact version, its licence and the
// licence text from its package. The packages are Draw's dependencies and theirs, walked through
// package-lock.json as npm resolves them (a type-only @types package ships no code).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DRAW = new URL('../../', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, DRAW), 'utf8');
const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
interface LockEntry {
  version: string;
  license?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, LockEntry> };
const NOTICES = read('public/THIRD-PARTY-NOTICES.txt');

/** The lock's key for `name` as needed from the package at `from` (npm's rule: the nearest node_modules up from it). */
function resolve(name: string, from: string): string | null {
  for (let dir = from; ; dir = dir.slice(0, Math.max(0, dir.lastIndexOf('/node_modules/')))) {
    const key = `${dir ? `${dir}/` : ''}node_modules/${name}`;
    if (lock.packages[key]) return key;
    if (!dir) return null;
  }
}

/** Every package whose code ships: Draw's dependencies, then theirs, by name → version. */
function runtimePackages(): Map<string, { version: string; license: string; key: string }> {
  const out = new Map<string, { version: string; license: string; key: string }>();
  const visit = (name: string, from: string, optional: boolean) => {
    if (name.startsWith('@types/')) return; // types only: no code ships
    const key = resolve(name, from);
    if (!key) {
      assert.ok(optional, `${name}, which ${from || 'Draw'} needs, is not in package-lock.json`);
      return;
    }
    if (out.has(name)) return;
    const e = lock.packages[key];
    out.set(name, { version: e.version, license: e.license ?? '', key });
    for (const d of Object.keys(e.dependencies ?? {})) visit(d, key, false);
    for (const d of Object.keys(e.optionalDependencies ?? {})) visit(d, key, true);
  };
  for (const name of Object.keys(pkg.dependencies)) visit(name, '', false);
  return out;
}

test('the notices name every package whose code ships, with its exact version, its licence and its licence text', () => {
  const found = runtimePackages();
  const sections = NOTICES.split(/\n-{78}\n/).slice(1, -1);
  for (const [name, { version, license, key }] of found) {
    const section = sections.find((s) => s.startsWith(`${name} ${version}\n`));
    assert.ok(section, `THIRD-PARTY-NOTICES.txt has no section for ${name} ${version}`);
    assert.ok(section.includes(`\nLicence: ${license}\n`), `${name}: its licence isn't ${license}`);
    const dir = new URL(`${key}/`, DRAW);
    const files = readdirSync(dir).filter((f) => /^licen[cs]e/i.test(f));
    assert.ok(files.length, `${name} ships no licence file`);
    for (const f of files) {
      const text = readFileSync(new URL(f, dir), 'utf8').replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
      assert.ok(section.includes(text), `${name}: the notices don't hold its ${f} as the package has it`);
    }
  }
  assert.equal(sections.length, found.size, `the notices list ${sections.length} packages; ${found.size} ship`);
});

test('the walk reaches the packages Draw needs only through another: scheduler (react-dom’s) and gl-matrix (path-bool’s)', () => {
  const found = runtimePackages();
  assert.equal(found.get('scheduler')?.version, '0.28.0', 'the walk found no scheduler');
  assert.equal(found.get('gl-matrix')?.version, '3.4.4', 'the walk found no gl-matrix');
  assert.deepEqual([...found.keys()].sort(), ['dompurify', 'gl-matrix', 'idb-keyval', 'paper', 'path-bool', 'react', 'react-dom', 'scheduler']);
  assert.ok(NOTICES.includes('paper-core includes Straps.js, with this notice:\n\nStraps.js - Class inheritance library'), 'paper’s section names Straps.js');
});
