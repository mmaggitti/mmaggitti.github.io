#!/usr/bin/env node
// Support-ledger gate. Runs in `npm run build`, so it gates CI.
//
// engine/ledger/ledger.json is the source of truth for what Draw edits, keeps, previews or drops,
// and for which SVG Lab capability lands in which phase. P0-M0 checks its shape and that the served
// profile version matches; P0-M2 adds the coverage, evidence, policy and phase gates, and generates
// the classifier and profile tables from it.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILE_VERSION } from '../../../scripts/lib/svg-profile.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const errors = [];
let ledger;
try {
  ledger = JSON.parse(readFileSync(resolve(ROOT, 'engine/ledger/ledger.json'), 'utf8'));
} catch (e) {
  errors.push(`engine/ledger/ledger.json: ${e.message.split('\n')[0]}`);
}
if (ledger) {
  const { meta, rows, lessons } = ledger;
  if (!meta || !Number.isInteger(meta.currentPhase) || meta.currentPhase < 0 || meta.currentPhase > 8) errors.push('meta.currentPhase must be an integer 0-8');
  if (meta?.profileVersion !== PROFILE_VERSION) errors.push(`meta.profileVersion ${meta?.profileVersion} ≠ scripts/lib/svg-profile.mjs PROFILE_VERSION ${PROFILE_VERSION}`);
  if (!Array.isArray(rows)) errors.push('rows must be an array');
  if (!Array.isArray(lessons)) errors.push('lessons must be an array');
}
if (errors.length) {
  console.error(`ledger-check: ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exitCode = 1;
} else {
  console.log(`ledger-check: ok (phase ${ledger.meta.currentPhase}, ${ledger.rows.length} rows)`);
}
