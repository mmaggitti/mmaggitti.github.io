// The module-host seam (Core & Seams DOCTRINE §7): runs WebAssembly that is NOT built into the
// app — plugins, user modules — sandboxed, with hard limits. The app's own core never uses it.
//
// This is the webview host: one module Worker per instance, a watchdog per call, and a memory
// ceiling checked from the binary before anything runs. Plugins import nothing (zero-capability by
// default); a later host can grant capabilities explicitly. The wasmtime host (native shell) is a
// designed second implementation behind the same interface.
import type { Bytes, CoreError } from '../worker/protocol';

export interface Limits {
  /** Largest memory a module may declare, in 64 KiB pages. A module with no maximum is refused. */
  memoryMaxPages: number;
  /** Longest a single call may run before the instance is killed. */
  timeMs: number;
}

export interface ModuleInstance {
  exports: string[];
  call(name: string, ...args: number[]): Promise<number | undefined>;
  dispose(): void;
}

export interface ModuleHost {
  load(bytes: Bytes, limits: Limits): Promise<ModuleInstance>;
}

const fail = (kind: string, message: string): CoreError => ({ kind, message });

/** Every memory a module defines or imports, as [min, max | null] pages, read from the binary. */
export function declaredMemories(bytes: Uint8Array): Array<[number, number | null]> {
  let at = 8; // after magic + version
  const u32 = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[at++];
      if (b === undefined) throw fail('invalid', 'truncated LEB128');
      result |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return result >>> 0;
      shift += 7;
    }
  };
  const limits = (): [number, number | null] => {
    const flags = u32();
    const min = u32();
    return [min, flags & 1 ? u32() : null];
  };
  const skipName = () => { const n = u32(); at += n; };
  const out: Array<[number, number | null]> = [];
  while (at < bytes.length) {
    const id = bytes[at++];
    const size = u32();
    const end = at + size;
    if (id === 2) {
      // imports: module name, field name, kind, descriptor
      for (let n = u32(); n > 0; n--) {
        skipName();
        skipName();
        const kind = bytes[at++];
        if (kind === 0x00) u32(); // func: type index
        else if (kind === 0x01) { at++; limits(); } // table: reftype + limits
        else if (kind === 0x02) out.push(limits()); // memory
        else if (kind === 0x03) at += 2; // global: valtype + mut
        else { at = end; break; } // tag or future kinds: nothing memory-shaped follows
      }
    } else if (id === 5) {
      for (let n = u32(); n > 0; n--) out.push(limits());
    }
    at = end;
  }
  return out;
}

export class WebviewModuleHost implements ModuleHost {
  async load(bytes: Bytes, limits: Limits): Promise<ModuleInstance> {
    if (!WebAssembly.validate(bytes)) throw fail('invalid', 'not a valid WebAssembly module');
    for (const [, max] of declaredMemories(bytes)) {
      if (max === null) throw fail('limits', 'the module declares a memory with no maximum');
      if (max > limits.memoryMaxPages) throw fail('limits', `the module's memory maximum (${max} pages) exceeds the limit (${limits.memoryMaxPages})`);
    }
    const worker = new Worker(new URL('./module-host.worker.ts', import.meta.url), { type: 'module' });
    let alive = true;
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: number | undefined) => void; reject: (e: CoreError) => void; timer: ReturnType<typeof setTimeout> }>();
    const kill = (error: CoreError) => {
      if (!alive) return;
      alive = false;
      worker.terminate();
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
      pending.clear();
    };
    const exports = await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => { kill(fail('timeout', 'instantiation took too long')); reject(fail('timeout', 'instantiation took too long')); }, limits.timeMs);
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; id?: number; ok?: boolean; value?: number; error?: CoreError; exports?: string[] };
        if (m.type === 'loaded') { clearTimeout(timer); resolve(m.exports ?? []); return; }
        if (m.type === 'load-failed') { clearTimeout(timer); kill(m.error ?? fail('invalid', 'load failed')); reject(m.error); return; }
        const p = m.id === undefined ? undefined : pending.get(m.id);
        if (!p || m.id === undefined) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.ok) p.resolve(m.value);
        else p.reject(m.error ?? fail('internal', 'unknown'));
      };
      const copy = bytes.slice();
      worker.postMessage({ type: 'load', bytes: copy }, [copy.buffer]);
    });
    return {
      exports,
      call(name, ...args) {
        if (!alive) return Promise.reject(fail('disposed', 'this module instance was stopped'));
        const id = nextId++;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => kill(fail('timeout', `${name} ran longer than ${limits.timeMs} ms`)), limits.timeMs);
          pending.set(id, { resolve, reject, timer });
          worker.postMessage({ type: 'call', id, name, args });
        });
      },
      dispose: () => kill(fail('disposed', 'this module instance was stopped')),
    };
  }
}
