// Shared fakes for the M4 unit tests (not a test file itself): an Editor over views that draw
// nothing, manual timers, a lock table standing in for Web Locks, and small document helpers.

import { readdirSync, readFileSync } from 'node:fs';
import { descendants, type Doc, type ElementNode } from '../../../../engine/model/doc.ts';
import { Editor, type EditorPorts } from '../../src/editor.ts';
import type { Lock, Timers } from '../../src/autosave.ts';

export const CORPUS = new URL('../../../../engine/test/fixtures/corpus/', import.meta.url);
export const corpus = (rel: string): string => readFileSync(new URL(rel, CORPUS), 'utf8');
export const corpusBytes = (rel: string): Uint8Array => new Uint8Array(readFileSync(new URL(rel, CORPUS)));
export const SAMPLE = readFileSync(new URL('../../src/canvas/sample.svg', import.meta.url), 'utf8');
export const firstIcon = (): string => 'icons/lucide/' + readdirSync(new URL('icons/lucide/', CORPUS)).find((f) => f.endsWith('.svg'));

export function fakePorts(options: { refuseRoot?: boolean } = {}): EditorPorts {
  return {
    canvas: {
      render: () => {},
      patchAttributes: () => {},
      patchSubtree: () => {},
      setCamera: () => {},
      nodeFor: () => (options.refuseRoot ? null : {}),
      stats: () => ({ rendered: 1, skippedElements: 0, droppedAttributes: 0 }),
      clear: () => {},
      motion: () => 'still',
      play: () => {},
    },
    code: { set: () => {}, patch: () => {}, select: () => {}, focus: () => {}, readOnly: () => {}, source: () => {} },
    overlay: { outline: () => {} },
    hostSize: () => ({ width: 416, height: 528 }),
    sinkReady: () => true,
  };
}

export const fakeEditor = (options?: { refuseRoot?: boolean }): Editor => new Editor(fakePorts(options));

/** Timers that fire only when told to. */
export class FakeTimers implements Timers {
  now = 0;
  #queue: { at: number; fn: () => void; handle: number }[] = [];
  #next = 1;
  set(fn: () => void, ms: number): unknown {
    const handle = this.#next++;
    this.#queue.push({ at: this.now + ms, fn, handle });
    return handle;
  }
  clear(handle: unknown): void {
    this.#queue = this.#queue.filter((t) => t.handle !== handle);
  }
  get pending(): number {
    return this.#queue.length;
  }
  tick(ms: number): void {
    this.now += ms;
    const due = this.#queue.filter((t) => t.at <= this.now);
    this.#queue = this.#queue.filter((t) => t.at > this.now);
    for (const t of due) t.fn();
  }
}

/** Web Locks for one origin: `other` holds locks for another tab. */
export function lockTable(): { lock: Lock; held: Set<string>; other: Set<string> } {
  const held = new Set<string>();
  const other = new Set<string>();
  const lock: Lock = async (id) => {
    if (held.has(id) || other.has(id)) return null;
    held.add(id);
    return () => void held.delete(id);
  };
  return { lock, held, other };
}

export const elementOf = (doc: Doc, local: string): ElementNode =>
  [...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.local === local) as ElementNode;

/** One undoable edit through the editor: replace the first <local> with `markup` (Edit source). */
export function edit(editor: Editor, local: string, markup: string): void {
  const n = elementOf(editor.doc!, local);
  editor.select([n.id]);
  const e = editor.applySource(n.id, markup);
  if (e) throw new Error(`test setup: ${e.message}`);
}
