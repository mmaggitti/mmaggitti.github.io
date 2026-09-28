// The message protocol between the page and the core worker. One request in, one response out.

/** Bytes backed by a plain ArrayBuffer: what Blob, OPFS, WebAssembly and transfer lists accept. */
export type Bytes = Uint8Array<ArrayBuffer>;

/** The `{ kind, message }` error of Core & Seams (mirrors `Problem` in the -wasm crate). */
export interface CoreError {
  kind: string;
  message: string;
}

/** The operations the worker exposes: name → [arguments, result]. One per core export. */
export interface Ops {
  /** Review log (time order) → three numbers per card: stability, difficulty, last day (NaN = new). */
  memories: [[cardCount: number, card: Uint32Array<ArrayBuffer>, day: Float64Array<ArrayBuffer>, rating: Uint8Array<ArrayBuffer>], Float64Array];
  retrievabilities: [[memories: Float64Array<ArrayBuffer>, now: number], Float64Array];
  plan: [[memories: Float64Array<ArrayBuffer>, now: number, target: number, budgetSecs: number, secsPerReview: number, secsPerNew: number, maxNew: number], Uint32Array];
  interval: [[stability: number, desiredRetention: number], number];
}
export type OpName = keyof Ops;

export interface Request<K extends OpName = OpName> {
  id: number;
  op: K;
  args: Ops[K][0];
}

export type Response =
  | { id: number; ok: true; value: unknown }
  // fatal: the instance is unusable (a trap); the client replaces the worker.
  | { id: number; ok: false; error: CoreError; fatal: boolean };

export const isCoreError = (e: unknown): e is CoreError =>
  typeof e === 'object' && e !== null && typeof (e as CoreError).kind === 'string' && typeof (e as CoreError).message === 'string';
