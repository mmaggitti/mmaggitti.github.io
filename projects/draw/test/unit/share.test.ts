// Sharing several files inside the tap (src/platform/share.ts, P1-M5): navigator.share is asked first,
// before anything is awaited (WebKit consumes the tap's activation), with exactly the files given; a
// closed sheet is "cancelled"; no file sharing at all, or a failure, sends the caller to downloads;
// and nothing reads the files' bytes on the way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canShareFiles, shareFiles } from '../../src/platform/share.ts';

interface FakeNav {
  canShare?: (d: { files?: File[] }) => boolean;
  share?: (d: { files?: File[] }) => Promise<void>;
}

/** Run `fn` with `nav` as the global navigator, then put the real one back. */
async function withNavigator<T>(nav: FakeNav | undefined, fn: () => Promise<T>): Promise<T> {
  const was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (was) Object.defineProperty(globalThis, 'navigator', was);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

/** Files whose bytes say so if anything reads them. */
function files(read: string[]): File[] {
  return ['Icon-16.png', 'Icon-32.png'].map((name) => {
    const f = new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
    for (const m of ['arrayBuffer', 'text', 'stream', 'bytes', 'slice'] as const) {
      Object.defineProperty(f, m, { value: () => { read.push(`${name}.${m}`); throw new Error('read'); } });
    }
    return f;
  });
}

test('shareFiles asks for the share sheet before anything is awaited, once, with exactly the files given, and nothing reads them', async () => {
  const read: string[] = [];
  const given = files(read);
  const calls: File[][] = [];
  let resolve!: () => void;
  const nav: FakeNav = {
    canShare: (d) => Array.isArray(d.files) && d.files.length > 0,
    share: (d) => {
      calls.push(d.files!);
      return new Promise<void>((ok) => (resolve = ok));
    },
  };
  const outcome = await withNavigator(nav, async () => {
    const p = shareFiles(given);
    assert.equal(calls.length, 1, 'navigator.share was called synchronously, inside the tap');
    assert.deepEqual(calls[0], given, 'with the files as given, in order');
    assert.notEqual(calls[0], given, 'a copy of the list, not the caller’s array');
    resolve();
    return p;
  });
  assert.equal(outcome, 'shared');
  assert.equal(calls.length, 1, 'one tap shares once');
  assert.deepEqual(read, [], 'nothing read the files');
});

test('a closed share sheet (AbortError) is "cancelled"; any other failure, or no file sharing at all, is "unshared": the caller offers downloads', async () => {
  const read: string[] = [];
  const reject = (name: string): FakeNav => ({ canShare: () => true, share: () => Promise.reject(new DOMException('no', name)) });
  assert.equal(await withNavigator(reject('AbortError'), () => shareFiles(files(read))), 'cancelled');
  assert.equal(await withNavigator(reject('NotAllowedError'), () => shareFiles(files(read))), 'unshared');
  assert.equal(await withNavigator({ canShare: () => true, share: () => { throw new TypeError('sync'); } }, () => shareFiles(files(read))), 'unshared');
  let shared = 0;
  const share = () => {
    shared++;
    return Promise.resolve();
  };
  assert.equal(await withNavigator({ share }, () => shareFiles(files(read))), 'unshared', 'no canShare: downloads');
  assert.equal(await withNavigator({ canShare: () => false, share }, () => shareFiles(files(read))), 'unshared', 'canShare says no: downloads');
  assert.equal(await withNavigator(undefined, () => shareFiles(files(read))), 'unshared', 'no navigator at all');
  assert.equal(shared, 0, 'share is never asked when canShare doesn’t say yes');
  assert.equal(await withNavigator({ share }, async () => canShareFiles(files(read))), false);
  assert.equal(await withNavigator({ canShare: () => true, share }, async () => canShareFiles(files(read))), true);
  assert.equal(await withNavigator({ canShare: () => { throw new TypeError('x'); } }, async () => canShareFiles(files(read))), false);
  assert.deepEqual(read, []);
});
