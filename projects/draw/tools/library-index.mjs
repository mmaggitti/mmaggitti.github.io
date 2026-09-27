#!/usr/bin/env node
// Writes dist/library/index.json, the served list of the GitHub library (P2). Generated at build,
// never committed: a committed index would be a hot-spot file that two devices and a Claude
// session saving at once would fight over. P0 ships an empty library.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILE_VERSION } from '../../../scripts/lib/svg-profile.mjs';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const LIB = join(DIST, 'library');
mkdirSync(LIB, { recursive: true });

const items = [];
for (const kind of ['designs', 'templates']) {
  const dir = join(LIB, kind);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.svg')).sort()) {
    items.push({ kind, slug: f.slice(0, -4), svg: `${kind}/${f}` });
  }
}
writeFileSync(join(LIB, 'index.json'), JSON.stringify({ profileVersion: PROFILE_VERSION, items }, null, 2) + '\n');
console.log(`library-index: ${items.length} item(s) → dist/library/index.json`);
