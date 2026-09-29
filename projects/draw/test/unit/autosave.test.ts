// The draft autosave over drafts in memory, with manual timers and a lock table standing in for
// Web Locks. IndexedDB and real Web Locks are exercised in the browser e2e.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Autosave, SAVE_DELAY_MS } from '../../src/autosave.ts';
import { DraftStore, memoryJournal, memoryKV, QuotaError, type KV } from '../../src/platform/drafts.ts';
import { FakeTimers, lockTable } from './fakes.ts';

const idle = () => new Promise((ok) => setImmediate(ok));

function rig(kv: KV = memoryKV()) {
  const timers = new FakeTimers();
  const locks = lockTable();
  const store = new DraftStore(kv, () => timers.now);
  const journal = memoryJournal();
  const auto = new Autosave(store, locks.lock, { timers, now: () => timers.now, journal });
  return { timers, locks, store, auto, kv, journal };
}

test('an import is a draft at once; changes save once, a second after the last one', async () => {
  const { timers, locks, store, auto } = rig();
  let text = '<svg id="a"/>';
  await auto.attach({ text: () => text, id: null, name: 'Logo', create: true });
  const id = auto.draftId!;
  assert.ok(id, 'a draft was created');
  assert.ok(locks.held.has(id), 'and this tab holds its lock');
  assert.equal((await store.load(id))!.text, '<svg id="a"/>');
  assert.equal(auto.state.get().kind, 'saved');
  for (const t of ['b', 'c', 'd']) {
    text = `<svg id="${t}"/>`;
    auto.changed();
    timers.tick(SAVE_DELAY_MS / 2);
    await idle(); // anything a timer queued has run
  }
  assert.equal(auto.state.get().kind, 'pending');
  assert.equal((await store.load(id))!.versions.length, 1, 'nothing written while changes keep coming');
  timers.tick(SAVE_DELAY_MS);
  await auto.flush();
  const d = (await store.load(id))!;
  assert.equal(d.text, '<svg id="d"/>');
  assert.equal(d.versions.length, 2, 'one save for the burst');
  assert.equal(auto.state.get().kind, 'saved');
});

test('the sample (and New) become a draft on their first change, not before', async () => {
  const { timers, store, auto } = rig();
  let text = '<svg/>';
  await auto.attach({ text: () => text, id: null, name: 'Sample', create: false });
  assert.equal(auto.draftId, null);
  assert.deepEqual(await store.list(), []);
  text = '<svg id="edited"/>';
  auto.changed();
  timers.tick(SAVE_DELAY_MS);
  await auto.flush();
  const [d] = await store.list();
  assert.equal(d.name, 'Sample');
  assert.equal(auto.draftId, d.id);
  assert.equal((await store.load(d.id))!.text, '<svg id="edited"/>');
});

test('flush saves a pending change at once (pagehide, or the page hidden)', async () => {
  const { timers, store, auto } = rig();
  let text = '<svg/>';
  await auto.attach({ text: () => text, id: null, name: 'A', create: true });
  text = '<svg id="now"/>';
  auto.changed();
  await auto.flush();
  assert.equal((await store.load(auto.draftId!))!.text, '<svg id="now"/>', 'saved without waiting for the debounce');
  assert.equal(timers.pending, 0, 'and the debounce is gone');
});

test('opening another document saves the pending change of the one before as itself, then releases its lock', async () => {
  const { store, auto, locks } = rig();
  let a = '<svg id="a"/>';
  await auto.attach({ text: () => a, id: null, name: 'A', create: true });
  const first = auto.draftId!;
  a = '<svg id="a2"/>';
  auto.changed();
  await auto.attach({ text: () => '<svg id="b"/>', id: null, name: 'B', create: true });
  assert.equal((await store.load(first))!.text, '<svg id="a2"/>', "A's last change is saved as A");
  assert.ok(!locks.held.has(first), "A's lock is released");
  assert.ok(locks.held.has(auto.draftId!), "B's is held");
  assert.deepEqual((await store.list()).map((d) => d.name).sort(), ['A', 'B']);
});

test('a draft another tab holds opens read-only: nothing is written, and a change is ignored', async () => {
  const { store, auto, locks, timers } = rig();
  const d = await store.create('Shared', '<svg/>', 'shared');
  locks.other.add('shared');
  await auto.attach({ text: () => '<svg id="mine"/>', id: 'shared', name: 'Shared', create: false });
  assert.equal(auto.state.get().kind, 'read-only');
  assert.ok(auto.readOnly);
  auto.changed();
  timers.tick(SAVE_DELAY_MS);
  await auto.flush();
  assert.equal((await store.load('shared'))!.text, d.text, 'the other tab is the only writer');
  await auto.markExported();
  assert.equal((await store.load('shared'))!.exported, null, 'not even the export mark');
});

test('a full quota is a loud failure that stays until a save succeeds', async () => {
  let full = true;
  const base = memoryKV();
  const kv: KV = { ...base, set: async (k, v) => { if (full) throw new DOMException('full', 'QuotaExceededError'); await base.set(k, v); } };
  const { auto, timers, store } = rig(kv);
  let text = '<svg/>';
  await auto.attach({ text: () => text, id: null, name: 'Big', create: true });
  const s = auto.state.get();
  assert.ok(s.kind === 'failed' && s.quota && /export this drawing now/.test(s.message), JSON.stringify(s));
  text = '<svg id="more"/>';
  auto.changed();
  assert.equal(auto.state.get().kind, 'failed', 'a new change does not hide the failure');
  full = false;
  timers.tick(SAVE_DELAY_MS);
  await auto.flush();
  assert.equal(auto.state.get().kind, 'saved', 'the next save that succeeds clears it');
  assert.equal((await store.load(auto.draftId!))!.text, '<svg id="more"/>');
  assert.ok(new QuotaError('x') instanceof Error);
});

test('a draft deleted meanwhile is written again, not lost; an export resets its reminder', async () => {
  const { auto, store, timers } = rig();
  let text = '<svg/>';
  await auto.attach({ text: () => text, id: null, name: 'Kept', create: true });
  const id = auto.draftId!;
  await store.remove(id);
  text = '<svg id="still"/>';
  auto.changed();
  timers.tick(SAVE_DELAY_MS);
  await auto.flush();
  assert.equal((await store.load(id))!.text, '<svg id="still"/>');
  timers.now += 10 * 86_400_000;
  assert.equal((await store.list())[0].remind, true);
  await auto.markExported();
  assert.equal((await store.list())[0].remind, false);
});

test('a save writes the record the binding holds: no read first, so a flush in pagehide starts its write at once', async () => {
  const base = memoryKV();
  let reads = 0;
  const kv: KV = { ...base, get: (k) => (reads++, base.get(k)) };
  const { auto, store } = rig(kv);
  await store.create('Mine', '<svg/>', 'mine');
  let text = '<svg/>';
  await auto.attach({ text: () => text, id: 'mine', name: 'Mine', create: false }); // reads it once, under its lock
  reads = 0;
  text = '<svg id="gone"/>';
  auto.changed();
  await auto.flush();
  await auto.markExported();
  assert.equal(reads, 0, 'the flush and the export mark wrote without reading');
  const d = (await store.load('mine'))!;
  assert.equal(d.text, '<svg id="gone"/>');
  assert.equal(d.versions.length, 2);
  assert.notEqual(d.exported, null);
});

test('a failed save names its drawing and stays up while another is open; it is saved at the next chance, and reopening its draft continues its changes', async () => {
  let full = false;
  const base = memoryKV();
  const kv: KV = { ...base, set: async (k, v) => { if (full) throw new DOMException('full', 'QuotaExceededError'); await base.set(k, v); } };
  const { auto, timers, store, locks } = rig(kv);
  const failed = () => {
    const s = auto.state.get();
    assert.equal(s.kind, 'failed', JSON.stringify(s));
    return s as Extract<typeof s, { kind: 'failed' }>;
  };
  let a = '<svg id="a"/>';
  await auto.attach({ text: () => a, id: null, name: 'Logo', create: true });
  const logo = auto.draftId!;
  full = true;
  a = '<svg id="a-edited"/>';
  auto.changed();
  timers.tick(SAVE_DELAY_MS);
  await auto.flush();
  let s = failed();
  assert.ok(s.open && s.quota && s.name === 'Logo' && s.message.includes('“Logo”') && /export this drawing now/.test(s.message), s.message);

  // Another drawing opens: Logo is tried again (still full), and the alert stays, about a drawing that isn't open.
  await auto.attach({ text: () => '<svg id="b"/>', id: null, name: 'Sample', create: false });
  s = failed();
  assert.ok(!s.open && s.name === 'Logo' && /reopen it from Files/.test(s.message), s.message);
  assert.ok(locks.held.has(logo), "Logo keeps its lock while its changes aren't stored");
  assert.deepEqual(auto.unsaved(logo), { name: 'Logo', text: '<svg id="a-edited"/>' });
  assert.equal((await base.get<{ text: string }>(`draft:${logo}`))!.text, '<svg id="a"/>', 'test setup: storage still has the old text');

  // Reopening Logo takes over its unsaved changes and its lock (not read-only), and the next save that succeeds stores them.
  await auto.attach({ text: () => a, id: logo, name: 'Logo', create: false });
  assert.equal(auto.readOnly, false);
  assert.ok(failed().open, 'the alert is about the open drawing again');
  full = false;
  await auto.flush();
  assert.equal(auto.state.get().kind, 'saved');
  assert.equal((await store.load(logo))!.text, '<svg id="a-edited"/>');
  assert.equal(auto.unsaved(logo), null);

  // Storage frees before another drawing opens: that open stores the one that failed first, lets go of its lock, and the alert goes.
  full = true;
  a = '<svg id="a-again"/>';
  auto.changed();
  await auto.flush();
  assert.equal(failed().open, true);
  full = false;
  await auto.attach({ text: () => '<svg/>', id: null, name: 'New', create: false });
  assert.equal(auto.state.get().kind, 'none', "the open drawing's own state again (New is not a draft yet)");
  assert.equal((await store.load(logo))!.text, '<svg id="a-again"/>');
  assert.ok(!locks.held.has(logo), 'and its lock is let go');
});

test('a flush writes the pending change to the unload journal at once, and the save that lands clears it', async () => {
  const { timers, auto, journal, store } = rig();
  let text = '<svg id="a"/>';
  await auto.attach({ text: () => text, id: null, name: 'Logo', create: true });
  const id = auto.draftId!;
  text = '<svg id="b"/>';
  auto.changed();
  timers.tick(10);
  const saved = auto.flush();
  // Synchronously, before any await: what an unloading Safari page can still keep.
  assert.deepEqual(journal.read(), { id, name: 'Logo', text: '<svg id="b"/>', at: timers.now });
  await saved;
  assert.equal((await store.load(id))!.text, '<svg id="b"/>');
  assert.equal(journal.read(), null, 'the save landed: nothing to replay');

  // Nothing pending: a flush writes no journal.
  await auto.flush();
  assert.equal(journal.read(), null);
});

test('a drawing that is not a draft yet journals under no id; a read-only one journals nothing', async () => {
  const { timers, auto, journal, locks } = rig();
  let text = '<svg/>';
  await auto.attach({ text: () => text, id: null, name: 'Sample', create: false });
  text = '<svg id="edited"/>';
  auto.changed();
  timers.tick(10);
  void auto.flush();
  assert.deepEqual(journal.read(), { id: '', name: 'Sample', text: '<svg id="edited"/>', at: timers.now });

  const other = rig();
  other.locks.held.add('held');
  await other.store.create('Held', '<svg/>', 'held');
  await other.auto.attach({ text: () => '<svg id="x"/>', id: 'held', name: 'Held', create: false });
  other.auto.changed();
  void other.auto.flush();
  assert.equal(other.journal.read(), null, 'another tab owns that draft: nothing is written for it');
  void locks;
});
