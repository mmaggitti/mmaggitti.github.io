// The third-party notices (P1-M3 S3): public/THIRD-PARTY-NOTICES.txt, served beside the app, names
// every package whose code ships in Draw's bundles, with its exact version, its licence and the
// licence text from its package. The packages are Draw's dependencies and theirs, walked through
// package-lock.json as npm resolves them (a type-only @types package ships no code).
//
// P1-M4: fontkit, its twelve packages and the ten @fontsource fonts join them ("code and fonts"). Three
// ship no licence file (fontkit, brotli and dfa, nor do their repositories): their sections say so and
// carry MIT's standard text (NO_FILE, below, holds exactly them); brotli's also holds the Apache License
// 2.0 its Google decoder is under, as @swc/helpers ships that licence's text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { CATALOGUE } from '../../src/platform/font-catalogue.ts';
import { reservedNames } from '../../src/platform/fonts.ts';

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

/** Packages whose licence text doesn't come from a file of their own: each with why, as its section says it. */
const NO_FILE: Readonly<Record<string, string>> = {
  fontkit: 'Licence: MIT (its package.json and README; the package and its repository ship no licence text). Author: Devon Govett (package.json).',
  brotli: 'Licence: MIT (its package.json and README; the package and its repository ship no licence text). Author: Devon Govett (package.json).',
  dfa: 'Licence: MIT (its package.json and README; the package and its repository ship no licence text). Author: Devon Govett (package.json).',
};
const MIT_TEXT = 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and\nassociated documentation files (the "Software")';

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
    const dir = new URL(`${key}/`, DRAW);
    const files = readdirSync(dir).filter((f) => /^licen[cs]e/i.test(f));
    if (name in NO_FILE) {
      // Its licence from package.json, said as such, and MIT's standard text.
      assert.equal(files.length, 0, `${name} ships a licence file now: take it out of NO_FILE`);
      assert.ok(section.includes(`\n${NO_FILE[name]}\n`) && NO_FILE[name].startsWith(`Licence: ${license} (`), `${name}: its section doesn't say where its licence comes from`);
      assert.ok(section.includes(MIT_TEXT), `${name}: no MIT text`);
      continue;
    }
    assert.ok(section.includes(`\nLicence: ${license}\n`), `${name}: its licence isn't ${license}`);
    assert.ok(files.length, `${name} ships no licence file`);
    for (const f of files) {
      const text = readFileSync(new URL(f, dir), 'utf8').replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
      assert.ok(section.includes(text), `${name}: the notices don't hold its ${f} as the package has it`);
    }
  }
  assert.equal(sections.length, found.size, `the notices list ${sections.length} packages; ${found.size} ship`);
  assert.deepEqual(Object.keys(NO_FILE).filter((n) => !found.has(n)), [], 'NO_FILE names only packages that ship');
  assert.match(NOTICES, /^Third-party notices: Draw\n=+\n\nDraw ships code and fonts /);
});

test('each font’s section states the catalogue’s Reserved Font Names, even where its package’s LICENSE leaves one out (IBM Plex’s “Plex”)', () => {
  const sections = NOTICES.split(/\n-{78}\n/).slice(1, -1);
  let n = 0;
  for (const c of CATALOGUE) {
    const section = sections.find((s) => s.startsWith(`@fontsource/${c.slug} `));
    assert.ok(section, c.family);
    for (const name of c.reserved) {
      assert.ok(reservedNames(c.family, section).includes(name), `${c.family}: its section doesn’t reserve “${name}”`);
      n++;
    }
  }
  assert.equal(n, 3, 'Plex twice, and Source');
});

test('brotli’s section holds the Apache License 2.0 its Google decoder is under (its dec/ files’ headers say so), in full: the text @swc/helpers ships', () => {
  const brotli = NOTICES.split(/\n-{78}\n/).find((s) => s.startsWith('brotli '))!;
  for (const f of ['decode.js', 'bit_reader.js', 'context.js', 'dictionary.js', 'dictionary-data.js', 'prefix.js', 'transform.js']) {
    assert.match(read(`node_modules/brotli/dec/${f}`), /Copyright 2013 Google Inc\. All Rights Reserved\.\s+Licensed under the Apache License, Version 2\.0/, f);
  }
  assert.ok(brotli.includes('"Copyright 2013 Google Inc. All\nRights Reserved. Licensed under the Apache License, Version 2.0"'), 'the decoder’s notice');
  const apache = read('node_modules/@swc/helpers/LICENSE').replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
  assert.ok(apache.length > 10000 && brotli.includes(apache), 'the Apache License 2.0, in full');
});

test('the walk reaches the packages Draw needs only through another: scheduler (react-dom’s), gl-matrix (path-bool’s), and fontkit’s twelve (tslib through @swc/helpers)', () => {
  const found = runtimePackages();
  assert.equal(found.get('scheduler')?.version, '0.28.0', 'the walk found no scheduler');
  assert.equal(found.get('gl-matrix')?.version, '3.4.4', 'the walk found no gl-matrix');
  assert.deepEqual([...found.keys()].sort(), [
    '@fontsource/archivo', '@fontsource/bebas-neue', '@fontsource/caveat', '@fontsource/dm-serif-display', '@fontsource/fraunces', '@fontsource/ibm-plex-mono', '@fontsource/ibm-plex-sans', '@fontsource/inter', '@fontsource/jetbrains-mono', '@fontsource/space-grotesk',
    '@swc/helpers', 'base64-js', 'brotli', 'clone', 'dfa', 'dompurify', 'fast-deep-equal', 'fontkit', 'gl-matrix', 'idb-keyval', 'pako', 'paper', 'path-bool', 'react', 'react-dom', 'restructure', 'scheduler', 'tiny-inflate', 'tslib', 'unicode-properties', 'unicode-trie',
  ]);
  assert.equal(found.get('tslib')?.version, '2.8.1', 'the walk found tslib (@swc/helpers’)');
  assert.ok(NOTICES.includes('paper-core includes Straps.js, with this notice:\n\nStraps.js - Class inheritance library'), 'paper’s section names Straps.js');
});
