import type { Bytes } from '../worker/protocol';

// The storage seam (Core & Seams SEAMS.md). Default: OPFS under this app's own folder, because
// every project on the origin shares one OPFS root, written from a worker through sync access
// handles (Safari offers no other OPFS write path before 26). Fallback: IndexedDB with `<app>:`
// keys. Names are flat (no "/"). Durable data also gets export-to-Files backups (DOCTRINE §6).

export interface Storage {
  readonly backend: 'opfs' | 'indexeddb';
  read(name: string): Promise<Bytes | null>;
  write(name: string, bytes: Bytes): Promise<void>;
  /** Add bytes to the end of a file, creating it if needed: the operation an append-only log needs. */
  append(name: string, bytes: Bytes): Promise<void>;
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
  if (typeof navigator.storage?.getDirectory !== 'function') return null;
  const worker = new Worker(new URL('./storage.worker.ts', import.meta.url), { type: 'module' });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: { kind: string; message: string } }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.value);
    else p.reject(Object.assign(new Error(e.data.error?.message ?? 'storage failed'), { name: e.data.error?.kind ?? 'storage' }));
  };
  const call = <T>(msg: Record<string, unknown>, transfer: Transferable[] = []) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, ...msg }, transfer);
    });
  try {
    // A worker that never answers (no OPFS in this context) must not hang the app.
    await Promise.race([call({ op: 'open', app }), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]);
  } catch {
    worker.terminate();
    return null;
  }
  // Transfer a copy: the caller's bytes stay usable.
  const send = (op: 'write' | 'append', name: string, bytes: Bytes) => {
    checkName(name);
    const copy = bytes.slice();
    return call<void>({ op, name, bytes: copy }, [copy.buffer]);
  };
  return {
    backend: 'opfs',
    read: (name) => { checkName(name); return call<Bytes | null>({ op: 'read', name }); },
    write: (name, bytes) => send('write', name, bytes),
    append: (name, bytes) => send('append', name, bytes),
    list: () => call<string[]>({ op: 'list' }),
    remove: (name) => { checkName(name); return call<void>({ op: 'remove', name }); },
    persist,
  };
}

function indexedDb(app: string): Storage {
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(`${app}:storage`, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const done = (req: IDBRequest) => new Promise<unknown>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const key = (name: string) => `${app}:${name}`;
  const store = async (mode: IDBTransactionMode) => (await db).transaction('files', mode).objectStore('files');
  return {
    backend: 'indexeddb',
    async read(name) {
      checkName(name);
      return ((await done((await store('readonly')).get(key(name)))) as Bytes | undefined) ?? null;
    },
    async write(name, bytes) {
      checkName(name);
      await done((await store('readwrite')).put(bytes.slice(), key(name)));
    },
    async append(name, bytes) {
      checkName(name);
      // One transaction, so a concurrent append can't interleave between the read and the write.
      const s = await store('readwrite');
      const prior = ((await done(s.get(key(name)))) as Bytes | undefined) ?? new Uint8Array(0);
      const next = new Uint8Array(prior.length + bytes.length);
      next.set(prior);
      next.set(bytes, prior.length);
      await done(s.put(next, key(name)));
    },
    async list() {
      const keys = (await done((await store('readonly')).getAllKeys())) as IDBValidKey[];
      return keys.map(String).filter((k) => k.startsWith(`${app}:`)).map((k) => k.slice(app.length + 1)).sort();
    },
    async remove(name) {
      checkName(name);
      await done((await store('readwrite')).delete(key(name)));
    },
    persist,
  };
}

/** The app's storage: OPFS when this browser can write to it from a worker, IndexedDB otherwise. */
export async function openStorage(app: string): Promise<Storage> {
  return (await opfs(app)) ?? indexedDb(app);
}
