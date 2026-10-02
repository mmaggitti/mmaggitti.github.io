// The message protocol between the page and the core worker. One request in, one response out.

/** Bytes backed by a plain ArrayBuffer: what Blob, OPFS, WebAssembly and transfer lists accept. */
export type Bytes = Uint8Array<ArrayBuffer>;

/** The `{ kind, message }` error of Core & Seams (mirrors `Problem` in the -wasm crate). */
export interface CoreError {
  kind: string;
  message: string;
}

/** A document open in the worker. The page holds only this number. */
export type Handle = number;

/** The operations the worker exposes: name → [arguments, result]. One per core export. */
export interface Ops {
  create: [[h: Handle, actor: Bytes], void];
  load: [[h: Handle, file: Bytes, actor: Bytes], void];
  close: [[h: Handle], void];
  save: [[h: Handle], Bytes];
  /** Returns the view JSON. */
  splice: [[h: Handle, index: number, remove: number, insert: string, author: string], string];
  setAuthor: [[h: Handle, id: string, name: string, color: string], string];
  takeLocalBatch: [[h: Handle], Bytes];
  appendBlob: [[h: Handle, blob: Bytes], void];
  /** Length-prefixed blobs in one buffer. */
  takeNewBlobs: [[h: Handle], Bytes];
  /** Returns the text patches JSON. */
  applyBatch: [[h: Handle, plain: Bytes], string];
  relayReset: [[h: Handle], void];
  relayMessage: [[h: Handle], Bytes | null];
  receiveRelay: [[h: Handle, message: Bytes], void];
  view: [[h: Handle], string];
  __trapForTest: [[], void];
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
