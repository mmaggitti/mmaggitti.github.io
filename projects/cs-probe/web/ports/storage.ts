import type { Bytes } from '../worker/protocol';

// The storage seam (Core & Seams SEAMS.md). Default: OPFS under this app's own folder, because
// every project on the origin shares one OPFS root; fallback: IndexedDB with `<app>:` keys.
// Names are flat (no "/"). Durable data also gets export-to-Files backups (DOCTRINE §6).

export interface Storage {
  readonly backend: 'opfs' | 'indexeddb';
  read(name: string): Promise<Bytes | null>;
  write(name: string, bytes: Bytes): Promise<void>;
  list(): Promise<string[]>;
  remove(name: string): Promise<void>;
  /** Ask the browser to keep this origin's storage; resolves to what it granted. */
  persist(): Promise<boolean>;
}

const checkName = (name: string) => {
  if (!name || name.includes('/') || name.startsWith('.')) throw new Error(`storage: bad name ${JSON.stringify(name)}`);
};

async function persist(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

async function opfs(app: string): Promise<Storage | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(app, { create: true });
    const probe = await dir.getFileHandle('.probe', { create: true });
    if (typeof probe.createWritable !== 'function') return null; // Safari < 26: no main-thread writes
    await dir.removeEntry('.probe');
    return {
      backend: 'opfs',
      async read(name) {
        checkName(name);
        try {
          const file = await (await dir.getFileHandle(name)).getFile();
          return new Uint8Array(await file.arrayBuffer());
        } catch (e) {
          if ((e as DOMException).name === 'NotFoundError') return null;
          throw e;
        }
      },
      async write(name, bytes) {
        checkName(name);
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(bytes);
        await w.close();
      },
      async list() {
        const names: string[] = [];
        for await (const key of dir.keys()) if (!key.startsWith('.')) names.push(key);
        return names.sort();
      },
      async remove(name) {
        checkName(name);
        await dir.removeEntry(name).catch((e: DOMException) => {
          if (e.name !== 'NotFoundError') throw e;
        });
      },
      persist,
    };
  } catch {
    return null;
  }
}

function indexedDb(app: string): Storage {
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(`${app}:storage`, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) => {
    const store = (await db).transaction('files', mode).objectStore('files');
    return new Promise<T>((resolve, reject) => {
      const req = run(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  const key = (name: string) => `${app}:${name}`;
  return {
    backend: 'indexeddb',
    async read(name) {
      checkName(name);
      const v = await tx<Bytes | undefined>('readonly', (s) => s.get(key(name)));
      return v ?? null;
    },
    async write(name, bytes) {
      checkName(name);
      await tx('readwrite', (s) => s.put(bytes, key(name)));
    },
    async list() {
      const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
      return keys.map(String).filter((k) => k.startsWith(`${app}:`)).map((k) => k.slice(app.length + 1)).sort();
    },
    async remove(name) {
      checkName(name);
      await tx('readwrite', (s) => s.delete(key(name)));
    },
    persist,
  };
}

/** The app's storage: OPFS when this browser can write to it, IndexedDB otherwise. */
export async function openStorage(app: string): Promise<Storage> {
  return (await opfs(app)) ?? indexedDb(app);
}
