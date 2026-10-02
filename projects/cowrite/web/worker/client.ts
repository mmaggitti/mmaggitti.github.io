// The page's handle on the core worker. Every call resolves or rejects with a CoreError:
//   { kind: 'trap' }     the module trapped; the worker is replaced before the next call
//   { kind: 'timeout' }  the watchdog fired; the worker is replaced
//   anything else        an error the core returned (e.g. 'parse')
import type { CoreError, OpName, Ops, Request, Response } from './protocol';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: CoreError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CoreClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** How many times the worker has been replaced after a trap or timeout. */
  restarts = 0;
  /** Called after a replacement: every handle the old worker held is gone. */
  onReplace: ((error: CoreError) => void) | null = null;

  constructor(private readonly timeoutMs = 10_000) {}

  private spawn(): Worker {
    const w = new Worker(new URL('./core.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Response>) => {
      const r = e.data;
      const p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id);
      clearTimeout(p.timer);
      if (r.ok) p.resolve(r.value);
      else {
        if (r.fatal) this.replace(r.error);
        p.reject(r.error);
      }
    };
    w.onerror = (e) => this.replace({ kind: 'worker', message: e.message || 'the core worker failed to load' });
    return w;
  }

  /** Terminate the worker and fail every call in flight; the next call spawns a fresh one. */
  private replace(error: CoreError): void {
    this.worker?.terminate();
    this.worker = null;
    this.restarts++;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(error);
      this.pending.delete(id);
    }
    this.onReplace?.(error);
  }

  call<K extends OpName>(op: K, ...args: Ops[K][0]): Promise<Ops[K][1]> {
    this.worker ??= this.spawn();
    const id = this.nextId++;
    const req: Request<K> = { id, op, args };
    const transfer = (args as unknown[]).flatMap((a) => (ArrayBuffer.isView(a) ? [a.buffer] : []));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.replace({ kind: 'timeout', message: `${op} took longer than ${this.timeoutMs} ms` }), this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.worker?.postMessage(req, transfer);
    });
  }
}
