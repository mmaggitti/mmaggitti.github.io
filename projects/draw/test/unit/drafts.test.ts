// Drafts over the in-memory store: versions, reminders, quota errors. IndexedDB and Web Locks are
// exercised in the browser e2e.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DraftStore, memoryKV, QuotaError, REMIND_AFTER_DAYS, UnreadableDraftError, VERSIONS, type KV } from '../../src/platform/drafts.ts';

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

test("a record that isn't a draft Draw wrote is listed as unreadable, under its own key, and loading it throws", async () => {
  const kv = memoryKV();
  const s = new DraftStore(kv, () => 5);
  await s.create('Good', '<svg/>', 'good');
  const ok = { name: 'X', text: '<svg/>', created: 0, updated: 9e15, exported: null, versions: [] };
  const bad: Record<string, unknown> = {
    'name-object': { ...ok, id: 'name-object', name: { x: 1 } },
    'text-number': { ...ok, id: 'text-number', text: 42 },
    'other-id': { ...ok, id: 'good' }, // stored under one key, claiming another draft's id
    'no-versions': { ...ok, id: 'no-versions', versions: 'none' },
    'bad-version': { ...ok, id: 'bad-version', versions: [{ at: 1, text: 7 }] },
    'nan-time': { ...ok, id: 'nan-time', updated: NaN },
    'not-an-object': 'draft',
  };
  for (const [id, v] of Object.entries(bad)) await kv.set(`draft:${id}`, v);
  const list = await s.list();
  assert.deepEqual(list.filter((d) => !d.unreadable).map((d) => d.id), ['good'], 'only the real draft is readable');
  const unreadable = list.filter((d) => d.unreadable);
  assert.deepEqual(unreadable.map((d) => d.id).sort(), Object.keys(bad).sort(), 'each listed under its own key');
  for (const d of unreadable) assert.ok(typeof d.name === 'string' && d.name === 'Unreadable draft' && d.updated === 0 && !d.remind);
  for (const id of Object.keys(bad)) await assert.rejects(s.load(id), UnreadableDraftError, id);
  assert.equal((await s.load('good'))!.name, 'Good');
  await s.remove('other-id');
  assert.equal((await s.load('good'))!.name, 'Good', 'deleting the impostor leaves the draft it named');
  assert.equal((await s.list()).length, Object.keys(bad).length);
});

test('saveOver writes a draft this tab holds without reading it first, keeps the ring, and brings back a deleted one', async () => {
  let t = 0;
  const base = memoryKV();
  let reads = 0;
  const kv: KV = { ...base, get: (k) => (reads++, base.get(k)) };
  const s = new DraftStore(kv, () => t);
  let d = await s.create('Held', '<svg/>', 'held');
  reads = 0;
  for (let i = 0; i < 25; i++) {
    t++;
    d = await s.saveOver(d, `<svg id="v${i}"/>`);
  }
  d = await s.exportedOver(d);
  assert.equal(reads, 0, 'nothing is read: the write can start at once (a flush in pagehide)');
  const back = (await base.get<{ text: string; versions: unknown[]; exported: number }>('draft:held'))!;
  assert.equal(back.text, '<svg id="v24"/>');
  assert.equal(back.versions.length, VERSIONS);
  assert.equal(back.exported, t);
  await s.remove('held');
  await s.saveOver(d, d.text);
  assert.equal((await s.load('held'))?.text, '<svg id="v24"/>', 'deleted meanwhile: written again, not lost');
});
