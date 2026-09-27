// The support ledger's shape. P0-M2 adds the coverage, evidence, policy and phase gates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ledger = JSON.parse(readFileSync(new URL('../ledger/ledger.json', import.meta.url), 'utf8'));

test('ledger has meta, rows and lessons', () => {
  assert.ok(Number.isInteger(ledger.meta.currentPhase));
  assert.ok(ledger.meta.currentPhase >= 0 && ledger.meta.currentPhase <= 8);
  assert.ok(Array.isArray(ledger.rows));
  assert.ok(Array.isArray(ledger.lessons));
});
