// The Support tab: the ledger's summary by phase and kind agrees with its rows, and the search finds
// rows by id, class, phase, status and note.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { search, SHOWN, STATUSES, summary, type Ledger } from '../../src/support.ts';

const LEDGER: Ledger = JSON.parse(readFileSync(new URL('../../../../engine/ledger/ledger.json', import.meta.url), 'utf8'));

test('the summary by phase and by kind counts every row once, by status', () => {
  const s = summary(LEDGER);
  assert.equal(s.phase, LEDGER.meta.currentPhase);
  assert.equal(s.total, LEDGER.rows.length);
  for (const t of [...s.byPhase, ...s.byKind]) assert.equal(STATUSES.reduce((n, k) => n + t.counts[k], 0), t.rows, t.label);
  assert.equal(s.byPhase.reduce((n, t) => n + t.rows, 0), LEDGER.rows.length);
  assert.equal(s.byKind.reduce((n, t) => n + t.rows, 0), LEDGER.rows.length);
  assert.deepEqual(s.byPhase.map((t) => t.label), [...new Set(LEDGER.rows.map((r) => r.phase))].sort((a, b) => a - b).map((p) => `P${p}`));
  for (const k of STATUSES) assert.equal(s.counts[k], LEDGER.rows.filter((r) => r.status === k).length, k);
  const p0 = s.byPhase.find((t) => t.label === 'P0')!;
  assert.equal(p0.counts.done, LEDGER.rows.filter((r) => r.phase === 0 && r.status === 'done').length);
});

test('the search finds rows by every word, in any field, and says how many it did not show', () => {
  const all = search(LEDGER.rows, '');
  assert.equal(all.matched, LEDGER.rows.length);
  assert.equal(all.rows.length, SHOWN, 'a long list is cut, and the count says so');
  assert.deepEqual(search(LEDGER.rows, 'feature:support-tab').rows.map((r) => r.id), ['feature:support-tab']);
  // A phase and a status some rows have (P0 has no partial rows left once it is closed).
  const some = LEDGER.rows.find((r) => r.status === 'partial') ?? LEDGER.rows[0];
  const found = search(LEDGER.rows, `P${some.phase} ${some.status.toUpperCase()}`, 10_000).rows;
  const want = LEDGER.rows.filter((r) => r.phase === some.phase && r.status === some.status);
  assert.ok(want.length > 0 && want.every((r) => found.includes(r)), 'the phase and the status are words to find, whatever their case');
  const hidden = search(LEDGER.rows, 'preserve-hidden element', 10_000).rows;
  assert.ok(hidden.length > 0 && hidden.every((r) => r.class === 'preserve-hidden' || /preserve-hidden/.test(r.note ?? '')));
  const reasoned = LEDGER.rows.find((r) => r.reason && !`${r.id} ${r.name} ${r.note ?? ''}`.toLowerCase().includes(r.reason.slice(0, 24).toLowerCase()))!;
  assert.ok(search(LEDGER.rows, reasoned.reason!.slice(0, 24), 10_000).rows.includes(reasoned), 'reasons are searched too');
  assert.equal(search(LEDGER.rows, 'no such thing anywhere').matched, 0);
});
