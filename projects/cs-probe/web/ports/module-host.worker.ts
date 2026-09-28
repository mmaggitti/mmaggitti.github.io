/// <reference lib="webworker" />
// One sandboxed module per worker. It imports nothing; calls take and return numbers.
const scope = self as unknown as DedicatedWorkerGlobalScope;
let instance: WebAssembly.Instance | null = null;

scope.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: 'load'; bytes: Uint8Array<ArrayBuffer> } | { type: 'call'; id: number; name: string; args: number[] };
  if (m.type === 'load') {
    try {
      const loaded = (await WebAssembly.instantiate(m.bytes, {})).instance;
      instance = loaded;
      const exports = Object.entries(loaded.exports).filter(([, v]) => typeof v === 'function').map(([k]) => k);
      scope.postMessage({ type: 'loaded', exports });
    } catch (err) {
      scope.postMessage({ type: 'load-failed', error: { kind: 'instantiate', message: String(err) } });
    }
    return;
  }
  const fn = instance?.exports[m.name];
  if (typeof fn !== 'function') {
    scope.postMessage({ type: 'result', id: m.id, ok: false, error: { kind: 'missing', message: `no export named ${m.name}` } });
    return;
  }
  try {
    const value = (fn as (...a: number[]) => number | undefined)(...m.args);
    scope.postMessage({ type: 'result', id: m.id, ok: true, value });
  } catch (err) {
    const kind = err instanceof WebAssembly.RuntimeError ? 'trap' : 'internal';
    scope.postMessage({ type: 'result', id: m.id, ok: false, error: { kind, message: String(err) } });
  }
};

// A module, not a script: its top-level names stay out of the global scope other workers share.
export {};
