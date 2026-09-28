/// <reference lib="webworker" />
// The core worker: owns the WASM instance. The page never calls WASM directly (DOCTRINE §1).
import init, * as core from '../pkg/cs_probe_wasm.js';
import type { OpName, Request, Response } from './protocol';

const ready = init();
const scope = self as unknown as DedicatedWorkerGlobalScope;

const handlers: { [K in OpName]: (...args: never[]) => unknown } = {
  checksum: (bytes: Uint8Array) => core.checksum(bytes),
  histogram: (bytes: Uint8Array) => core.histogram(bytes),
  parseVersion: (text: string) => core.parseVersion(text),
  __trapForTest: () => core.__trapForTest(),
};

scope.onmessage = async (e: MessageEvent<Request>) => {
  const { id, op, args } = e.data;
  let reply: Response;
  try {
    await ready;
    const value = (handlers[op] as (...a: unknown[]) => unknown)(...(args as unknown[]));
    reply = { id, ok: true, value };
  } catch (err) {
    if (err instanceof WebAssembly.RuntimeError) {
      // panic = "abort": the instance's state is unknown after a trap. Report it as fatal; the
      // client replaces this worker.
      reply = { id, ok: false, fatal: true, error: { kind: 'trap', message: err.message } };
    } else if (err && typeof err === 'object' && 'kind' in err && 'message' in err) {
      // A `Problem` returned as Err from the binding.
      const p = err as { kind: string; message: string; free?: () => void };
      reply = { id, ok: false, fatal: false, error: { kind: String(p.kind), message: String(p.message) } };
      p.free?.();
    } else {
      reply = { id, ok: false, fatal: false, error: { kind: 'internal', message: String(err) } };
    }
  }
  const transfer = reply.ok && ArrayBuffer.isView(reply.value) ? [reply.value.buffer] : [];
  scope.postMessage(reply, transfer);
};
