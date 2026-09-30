// Shared fakes for the M4 unit tests (not a test file itself): an Editor over views that draw
// nothing, manual timers, a lock table standing in for Web Locks, and small document helpers.

import { readdirSync, readFileSync } from 'node:fs';
import { descendants, type Doc, type ElementNode, type NodeId } from '../../../../engine/model/doc.ts';
import { localBounds } from '../../../../engine/geometry/bounds.ts';
import { inDrawnTree, lineage, placement, userCtm } from '../../../../engine/geometry/ctm.ts';
import { multiply } from '../../../../engine/values/affine.ts';
import { Editor, type EditorPorts, type Measured } from '../../src/editor.ts';
import { rootToHostMatrix } from '../../src/interact/overlay-model.ts';
import type { Lock, Timers } from '../../src/autosave.ts';

export const CORPUS = new URL('../../../../engine/test/fixtures/corpus/', import.meta.url);
export const corpus = (rel: string): string => readFileSync(new URL(rel, CORPUS), 'utf8');
export const corpusBytes = (rel: string): Uint8Array => new Uint8Array(readFileSync(new URL(rel, CORPUS)));
export const SAMPLE = readFileSync(new URL('../../src/canvas/sample.svg', import.meta.url), 'utf8');
export const firstIcon = (): string => 'icons/lucide/' + readdirSync(new URL('icons/lucide/', CORPUS)).find((f) => f.endsWith('.svg'));

/** The page's root font size at Draw's 75% scale (1rem = 12 px): what the canvas measures rem against. */
export const REM_PX = 12;

/**
 * The canvas's measure port, answered by the engine: each element's box (bounds.ts) and its units →
 * host px (ctm.ts, then the editor's camera box), as the DOM's getBBox and getScreenCTM give them.
 * `referenced`: like the browser, also measure an element that draws only where it is referenced
 * (in a clipPath or defs), through its parents' placements, so only the editor's own rule keeps it
 * from being outlined.
 */
export function measureWith(editor: Editor, ids: readonly NodeId[], referenced = false): Map<NodeId, Measured> {
  const out = new Map<NodeId, Measured>();
  const doc = editor.doc;
  const { viewport, M, box } = editor.rootBox;
  if (!doc || !box) return out;
  const ctx = { viewport, remPx: REM_PX };
  const toHost = rootToHostMatrix(box, viewport, M);
  for (const id of ids) {
    const b = localBounds(doc, id, ctx);
    let m = b && userCtm(doc, id, ctx, (x) => localBounds(doc, x, ctx));
    if (b && !m && referenced && !inDrawnTree(doc, id)) {
      m = [1, 0, 0, 1, 0, 0];
      for (const n of lineage(doc, id).slice(1)) {
        const p = placement(doc, n.id, ctx, () => localBounds(doc, n.id, ctx));
        m = p && m && multiply(m, p);
      }
    }
    if (b && m) out.set(id, { box: b, toHost: multiply(toHost, m) });
  }
  return out;
}

const bound = new WeakMap<EditorPorts, Editor>();

/** Let fake ports measure through this editor (it is made after its ports). */
export function bind(ports: EditorPorts, editor: Editor): Editor {
  bound.set(ports, editor);
  return editor;
}

export function fakePorts(options: { refuseRoot?: boolean } = {}): EditorPorts {
  const ports: EditorPorts = {
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
      measure: (ids) => {
        const e = bound.get(ports);
        return e ? measureWith(e, ids) : new Map();
      },
    },
    code: { set: () => {}, patch: () => {}, place: () => {}, remove: () => {}, select: () => {}, focus: () => {}, readOnly: () => {}, source: () => {} },
    overlay: { show: () => {} },
    hostSize: () => ({ width: 416, height: 528 }),
    sinkReady: () => true,
  };
  return ports;
}

export const fakeEditor = (options?: { refuseRoot?: boolean }): Editor => {
  const ports = fakePorts(options);
  return bind(ports, new Editor(ports));
};

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
