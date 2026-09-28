// The app model: state and commands, framework-free. This template's model is a "system check"
// that exercises every seam once; a real app replaces it (and the panel that renders it).
import { density } from '../platform';
import { pick, save } from '../ports/files';
import { WebviewModuleHost } from '../ports/module-host';
import { openStorage, type Storage } from '../ports/storage';
import { TEST_PLUGIN } from '../ports/test-plugin';
import { CoreClient } from '../worker/client';
import { isCoreError } from '../worker/protocol';
import { createStore } from './store';

export const APP = 'cs-probe';
const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
const utf8 = (s: string) => new TextEncoder().encode(s);
const describe = (e: unknown) => (isCoreError(e) ? `${e.kind}: ${e.message}` : String(e));

export interface State {
  core: string;          // checksum of a known string, or the load error
  text: string;
  textChecksum: string;
  version: string;       // parsed result or the core's error
  trap: string;          // idle → recovered after a deliberate trap
  plugin: string;        // module-host results
  storage: string;       // backend + persist result
  saved: string;         // what reading back the saved note returned
  file: string;          // checksum of an imported file
  density: string;
}

export const store = createStore<State>({
  core: 'loading…', text: 'Wikipedia', textChecksum: '', version: '', trap: 'idle', plugin: 'not run',
  storage: 'opening…', saved: '', file: 'none', density: density(),
});

const client = new CoreClient();
let storage: Storage | null = null;

export const commands = {
  async boot() {
    try {
      store.set({ core: hex(await client.call('checksum', utf8('Wikipedia'))) });
    } catch (e) {
      store.set({ core: describe(e) });
    }
    await commands.checksumText(store.get().text);
    await commands.parseVersion('1.2.3');
    try {
      storage = await openStorage(APP);
      store.set({ storage: `${storage.backend}; persisted: ${await storage.persist()}` });
      const prior = await storage.read('note.txt');
      if (prior) store.set({ saved: new TextDecoder().decode(prior) });
    } catch (e) {
      store.set({ storage: describe(e) });
    }
    matchMedia('(any-pointer: coarse)').addEventListener('change', () => store.set({ density: density() }));
  },

  async checksumText(text: string) {
    store.set({ text });
    try {
      store.set({ textChecksum: hex(await client.call('checksum', utf8(text))) });
    } catch (e) {
      store.set({ textChecksum: describe(e) });
    }
  },

  async parseVersion(text: string) {
    try {
      store.set({ version: [...(await client.call('parseVersion', text))].join(' · ') });
    } catch (e) {
      store.set({ version: describe(e) });
    }
  },

  /** Trap the core on purpose, then prove the next call works on a fresh instance. */
  async trapAndRecover() {
    let trapped = '';
    try {
      await client.call('__trapForTest');
    } catch (e) {
      trapped = isCoreError(e) ? e.kind : 'unknown';
    }
    const after = hex(await client.call('checksum', utf8('Wikipedia')));
    store.set({ trap: trapped === 'trap' && after === '11e60398' ? `recovered (restarts: ${client.restarts})` : `failed (${trapped}, ${after})` });
  },

  /** Load the hand-encoded test plugin: a call, a runaway call, and a refused memory limit. */
  async runPlugin() {
    const host = new WebviewModuleHost();
    const results: string[] = [];
    const m = await host.load(TEST_PLUGIN, { memoryMaxPages: 1, timeMs: 1500 });
    results.push(`add(2,3) = ${await m.call('add', 2, 3)}`);
    await m.call('spin').catch((e: unknown) => results.push(`spin: ${isCoreError(e) ? e.kind : e}`));
    await host.load(TEST_PLUGIN, { memoryMaxPages: 0, timeMs: 1500 }).catch((e: unknown) => results.push(`max 0 pages: ${isCoreError(e) ? e.kind : e}`));
    store.set({ plugin: results.join('; ') });
  },

  async saveNote(text: string) {
    if (!storage) return;
    await storage.write('note.txt', utf8(text));
    const back = await storage.read('note.txt');
    store.set({ saved: back ? new TextDecoder().decode(back) : '(nothing)' });
  },

  async importFile() {
    const [file] = await pick();
    if (!file) return;
    store.set({ file: `${file.name}: ${hex(await client.call('checksum', file.bytes))}` });
  },

  async exportReport() {
    await save(`${APP}-report.json`, utf8(JSON.stringify(store.get(), null, 2)), 'application/json');
  },
};
