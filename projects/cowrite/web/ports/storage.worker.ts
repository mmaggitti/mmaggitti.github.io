/// <reference lib="webworker" />
// OPFS from a dedicated worker, through sync access handles: the one OPFS write path every engine
// ships (Safari has no main-thread createWritable before 26). One app folder per worker; every
// handle is closed after each operation, so another tab can open the same file next.
//
// Safari before 17 returned promises from getSize/truncate/flush/close; `await` covers both.
const scope = self as unknown as DedicatedWorkerGlobalScope;
let dir: FileSystemDirectoryHandle | null = null;

type Req =
  | { id: number; op: 'open'; app: string }
  | { id: number; op: 'read' | 'remove'; name: string }
  | { id: number; op: 'write' | 'append'; name: string; bytes: Uint8Array<ArrayBuffer> }
  | { id: number; op: 'list' };

const notFound = (e: unknown) => (e as DOMException)?.name === 'NotFoundError';

/** Open a sync handle, retrying briefly if another tab holds the file. */
async function withHandle<T>(name: string, create: boolean, run: (h: FileSystemSyncAccessHandle) => Promise<T>): Promise<T> {
  if (!dir) throw new Error('storage: not opened');
  const file = await dir.getFileHandle(name, { create });
  for (let attempt = 0; ; attempt++) {
    let h: FileSystemSyncAccessHandle;
    try {
      h = await file.createSyncAccessHandle();
    } catch (e) {
      if ((e as DOMException).name === 'NoModificationAllowedError' && attempt < 5) {
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
        continue;
      }
      throw e;
    }
    try {
      return await run(h);
    } finally {
      await h.close();
    }
  }
}

async function handle(m: Req): Promise<unknown> {
  switch (m.op) {
    case 'open': {
      dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(m.app, { create: true });
      // Prove a sync handle works here before the page commits to this backend.
      await withHandle('.probe', true, async (h) => { await h.truncate(0); });
      await dir.removeEntry('.probe');
      return true;
    }
    case 'read':
      try {
        return await withHandle(m.name, false, async (h) => {
          const out = new Uint8Array(await h.getSize());
          h.read(out, { at: 0 });
          return out;
        });
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    case 'write':
      return withHandle(m.name, true, async (h) => {
        await h.truncate(0);
        h.write(m.bytes, { at: 0 });
        await h.flush();
      });
    case 'append':
      return withHandle(m.name, true, async (h) => {
        h.write(m.bytes, { at: await h.getSize() });
        await h.flush();
      });
    case 'list': {
      const names: string[] = [];
      for await (const key of dir!.keys()) if (!key.startsWith('.')) names.push(key);
      return names.sort();
    }
    case 'remove':
      try {
        await dir!.removeEntry(m.name);
      } catch (e) {
        if (!notFound(e)) throw e;
      }
      return undefined;
  }
}

scope.onmessage = async (e: MessageEvent<Req>) => {
  const m = e.data;
  try {
    const value = await handle(m);
    scope.postMessage({ id: m.id, ok: true, value }, value instanceof Uint8Array ? [value.buffer] : []);
  } catch (err) {
    scope.postMessage({ id: m.id, ok: false, error: { kind: (err as DOMException)?.name || 'storage', message: String(err) } });
  }
};

// A module, not a script: its top-level names stay out of the global scope other workers share.
export {};
