// The kernel on this phone: cad-kernel's WebAssembly build, run in a worker so the page stays
// responsive while it rebuilds the engine.
//
//   { type: 'init', base }      load the kernel from <base>pkg/  → { type: 'ready', info }
//   { type: 'rebuild', files }  rebuild the engine from its recipe (path → text), hash every result
//                               file, and hold the assembly for solving
//                               → { type: 'rebuilt', ms, summary, digests }
//   { type: 'solve', deg }      solve the joints at a crank angle
//                               → { type: 'solved', deg, residual, dof, unsatisfied, placements }
// Any failure answers { type: 'error', message }: the kernel's named failure (`<operation>.<reason>`)
// where it gave one. A trap (a panic or an allocation failure) poisons the instance; the page then
// starts a fresh worker.

let kernel = null;
let assembly = null;
const PARAM = 'crank_angle';

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

function message(e) {
  if (e instanceof WebAssembly.RuntimeError) return `kernel.trapped (${e.message})`;
  const text = String(e?.message ?? e);
  if (text.startsWith('{"code"')) {
    try {
      const x = JSON.parse(text);
      return `${x.code}: ${x.detail}`;
    } catch {
      return text;
    }
  }
  return text;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      kernel = await import(/* @vite-ignore */ `${data.base}pkg/cadk_wasm.js`);
      await kernel.default({ module_or_path: `${data.base}pkg/cadk_wasm_bg.wasm` });
      self.postMessage({ type: 'ready', info: JSON.parse(kernel.kernelInfo()) });
    } else if (data.type === 'rebuild') {
      const t0 = performance.now();
      const r = kernel.rebuildPackage(JSON.stringify(data.files), undefined);
      const ms = performance.now() - t0;
      const summary = JSON.parse(r.summary);
      const digests = {};
      for (const p of r.paths()) digests[p] = hex(await crypto.subtle.digest('SHA-256', r.bytes(p)));
      const root = JSON.parse(data.files['manifest.json']).root.replace(/^@/, '');
      assembly = r.assembly(root);
      self.postMessage({ type: 'rebuilt', ms, summary, digests });
    } else if (data.type === 'solve') {
      const s = JSON.parse(assembly.solve(PARAM, (data.deg * Math.PI) / 180));
      self.postMessage({ type: 'solved', deg: data.deg, ...s });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: message(e) });
  }
};
