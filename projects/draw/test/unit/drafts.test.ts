// Drafts over the in-memory store: versions, reminders, quota errors. IndexedDB and Web Locks are
// exercised in the browser e2e.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DraftStore, memoryKV, QuotaError, REMIND_AFTER_DAYS, VERSIONS, type KV } from '../../src/platform/drafts.ts';

const DAY = 86_400_000;

test('saving keeps the text and a ring of the last 20 versions', async () => {
  let t = 1000;
  const s = new DraftStore(memoryKV(), () => t);
  const d = await s.create('Logo', '<svg/>', 'd1');
  assert.equal(d.versions.length, 1);
  for (let i = 0; i < 30; i++) {
    t += 1000;
    await s.save('d1', `<svg id="v${i}"/>`);
  }
  await s.save('d1', '<svg id="v29"/>'); // unchanged: no new version
  const back = (await s.load('d1'))!;
  assert.equal(back.text, '<svg id="v29"/>');
  assert.equal(back.versions.length, VERSIONS);
  assert.equal(back.versions.at(-1)!.text, '<svg id="v29"/>');
  assert.equal(back.versions[0].text, '<svg id="v10"/>');
});

test('a draft not exported for days is flagged, and exporting clears it', async () => {
  let t = 0;
  const s = new DraftStore(memoryKV(), () => t);
  await s.create('A', '<svg/>', 'a');
  t = (REMIND_AFTER_DAYS - 1) * DAY;
  assert.equal((await s.list())[0].remind, false);
  t = (REMIND_AFTER_DAYS + 1) * DAY;
  assert.equal((await s.list())[0].remind, true);
  await s.markExported('a');
  assert.equal((await s.list())[0].remind, false);
});

test('list is newest first; rename and remove work', async () => {
  let t = 0;
  const s = new DraftStore(memoryKV(), () => t);
  await s.create('Old', '<svg/>', 'o');
  t = 10;
  await s.create('New', '<svg/>', 'n');
  assert.deepEqual((await s.list()).map((d) => d.name), ['New', 'Old']);
  await s.rename('o', 'Older');
  await s.remove('n');
  assert.deepEqual((await s.list()).map((d) => d.name), ['Older']);
});

test('a full quota is a QuotaError the UI can show, not a silent loss', async () => {
  const full: KV = { ...memoryKV(), set: async () => { throw new DOMException('full', 'QuotaExceededError'); } };
  await assert.rejects(new DraftStore(full).create('X', '<svg/>'), QuotaError);
});
