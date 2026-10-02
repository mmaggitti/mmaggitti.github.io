/// <reference lib="webworker" />
// The core worker: owns the WASM instance and the open documents. The page never calls WASM
// directly (DOCTRINE §1); it holds numeric handles, never a Doc.
import init, * as core from '../pkg/cowrite_wasm.js';
import type { Handle, OpName, Request, Response } from './protocol';

const ready = init();
const scope = self as unknown as DedicatedWorkerGlobalScope;
const docs = new Map<Handle, core.Doc>();

const doc = (h: Handle): core.Doc => {
  const d = docs.get(h);
  if (!d) throw { kind: 'handle', message: `no open document ${h}` };
  return d;
};
const put = (h: Handle, d: core.Doc) => {
  docs.get(h)?.free();
  docs.set(h, d);
};

const handlers: { [K in OpName]: (...args: never[]) => unknown } = {
  create: (h: Handle, actor: Uint8Array) => put(h, core.Doc.create(actor)),
  load: (h: Handle, file: Uint8Array, actor: Uint8Array) => put(h, core.Doc.load(file, actor)),
  close: (h: Handle) => {
    docs.get(h)?.free();
    docs.delete(h);
  },
  save: (h: Handle) => doc(h).save(),
  splice: (h: Handle, index: number, remove: number, insert: string, author: string) => doc(h).splice(index, remove, insert, author),
  setAuthor: (h: Handle, id: string, name: string, color: string) => doc(h).setAuthor(id, name, color),
  takeLocalBatch: (h: Handle) => doc(h).takeLocalBatch(),
  appendBlob: (h: Handle, blob: Uint8Array) => doc(h).appendBlob(blob),
  takeNewBlobs: (h: Handle) => doc(h).takeNewBlobs(),
  applyBatch: (h: Handle, plain: Uint8Array) => doc(h).applyBatch(plain),
  relayReset: (h: Handle) => doc(h).relayReset(),
  relayMessage: (h: Handle) => doc(h).relayMessage() ?? null,
  receiveRelay: (h: Handle, message: Uint8Array) => doc(h).receiveRelay(message),
  view: (h: Handle) => doc(h).view(),
  __trapForTest: () => core.__trapForTest(),
};

scope.onmessage = async (e: MessageEvent<Request>) => {
  const { id, op, args } = e.data;
  let reply: Response;
  try {
    await ready;
    const value = (handlers[op] as (...a: unknown[]) => unknown)(...(args as unknown[]));
    reply = { id, ok: true, value: value ?? null };
  } catch (err) {
    if (err instanceof WebAssembly.RuntimeError) {
      // panic = "abort": the instance's state is unknown after a trap. Report it as fatal; the
      // client replaces this worker (and every open document goes with it).
      reply = { id, ok: false, fatal: true, error: { kind: 'trap', message: err.message } };
    } else if (err && typeof err === 'object' && 'kind' in err && 'message' in err) {
      // A `Problem` returned as Err from the binding, or a handle error above.
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
