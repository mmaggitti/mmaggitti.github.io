// The draft autosave: every open document is a draft (src/platform/drafts.ts), saved about a
// second after the last change and at once when the page is hidden or goes away.
//
// - A binding is one open document: its text (read from ITS Doc, so a pending save of the document
//   before still writes that document's text after another opens), its draft id and its name, and
//   the draft record as stored, so a save writes without reading first (one started in pagehide
//   must be issued within that event, or the unloading page loses it).
// - An imported file becomes a draft at once; the sample and New become one on their first change.
// - One writer per draft: the binding holds the draft's Web Lock. When another tab holds it, the
//   document is read-only here, and nothing is written.
// - Saves run one at a time, in order. A full quota (or any other storage error) is a loud failure
//   that names the drawing and stays until that drawing's save succeeds. A document whose save
//   failed keeps its text, its lock and its record here: every later open and flush saves it
//   again, and reopening its draft reopens those changes, not the older stored text. Nothing is
//   lost silently.
// - The unload journal (platform/drafts.ts): a flush also writes the pending change to it
//   synchronously, because Safari can drop an IndexedDB write started while the page unloads. A save
//   that lands clears it; the next load replays one that didn't (Workspace.boot).
//
// Framework-free, with injected timers and locks, so the unit tests drive it over memory storage.

import { createStore, type Store } from './panels/store.ts';
import { localJournal, QuotaError, type Draft, type DraftStore, type Journal } from './platform/drafts.ts';
import { why } from './import.ts';

export const SAVE_DELAY_MS = 1000;

export type SaveState =
  | { kind: 'none' } // not a draft yet (the sample, New): the first change makes it one
  | { kind: 'pending' } // a change waits for the debounce
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'read-only' } // another tab holds this draft
  /** A drawing's changes aren't stored: `open` when it is the drawing open now (export it), else reopen it from Files. */
  | { kind: 'failed'; name: string; message: string; quota: boolean; open: boolean };

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Take a draft's lock: its release, or null when another tab holds it (platform/drafts.ts lockDraft). */
export type Lock = (id: string) => Promise<(() => void) | null>;

export interface Target {
  text: () => string;
  id: string | null; // an existing draft, or null: a new one
  name: string;
  /** For a new draft: create it now (an import), or on the first change (the sample, New). */
  create: boolean;
}

interface Binding extends Target {
  readOnly: boolean;
  release: (() => void) | null;
  /** The record as stored (read once the lock is held, then as this tab wrote it); null until then. */
  draft: Draft | null;
  /** Its own progress, shown while no drawing has unsaved changes. */
  shown: SaveState;
  /** Why its last save failed (it is in #unsaved), or null. */
  error: { quota: boolean; reason: string } | null;
}

export class Autosave {
  readonly state: Store<SaveState> = createStore<SaveState>({ kind: 'none' });
  #store: DraftStore;
  #lock: Lock;
  #timers: Timers;
  #delay: number;
  #now: () => number;
  #b: Binding | null = null;
  #timer: unknown = null;
  #chain: Promise<void> = Promise.resolve();
  /** Documents whose last save failed, oldest first: saved again at every open and flush until one succeeds. */
  #unsaved = new Set<Binding>();
  #journal: Journal;

  constructor(store: DraftStore, lock: Lock, options: { timers?: Timers; delay?: number; now?: () => number; journal?: Journal } = {}) {
    this.#store = store;
    this.#lock = lock;
    this.#timers = options.timers ?? realTimers;
    this.#delay = options.delay ?? SAVE_DELAY_MS;
    this.#now = options.now ?? Date.now;
    this.#journal = options.journal ?? localJournal;
  }

  /** The open document's draft id (null until it is a draft). */
  get draftId(): string | null {
    return this.#b?.id ?? null;
  }

  get readOnly(): boolean {
    return !!this.#b?.readOnly;
  }

  /** A draft whose last save here failed: its name and its unsaved text, to reopen instead of the stored one. */
  unsaved(id: string): { name: string; text: string } | null {
    for (const u of this.#unsaved) if (u.id === id) return { name: u.name, text: u.text() };
    return null;
  }

  /**
   * Bind the document that is open now. The one before keeps a pending change, and every document
   * whose save failed is still unsaved: they are saved first, then the one before lets go of its
   * lock (unless its save failed again). Reopening a draft whose save failed here takes over its
   * lock and record. Resolves when the new binding has its lock (or is read-only) and, for an
   * import, its draft.
   */
  attach(to: Target): Promise<void> {
    const prev = this.#b;
    const retry = new Set(this.#unsaved);
    if (this.#timer !== null) {
      this.#timers.clear(this.#timer);
      this.#timer = null;
      if (prev) retry.add(prev);
    }
    const b: Binding = { ...to, readOnly: false, release: null, draft: null, shown: { kind: 'none' }, error: null };
    const heir = to.id === null ? undefined : [...this.#unsaved].find((u) => u.id === to.id);
    if (heir) {
      Object.assign(b, { release: heir.release, draft: heir.draft, error: heir.error });
      heir.release = null;
      this.#unsaved.delete(heir);
      retry.delete(heir);
      this.#unsaved.add(b);
      retry.add(b);
    }
    this.#b = b;
    this.#announce();
    for (const u of retry) void this.#queue(() => this.#save(u));
    if (prev) void this.#queue(async () => this.#letGo(prev));
    return this.#queue(async () => {
      if (b.id !== null && !b.release) {
        const release = await this.#lock(b.id);
        if (!release) {
          b.readOnly = true;
          this.#show(b, { kind: 'read-only' });
        } else {
          b.release = release;
          b.draft = (await this.#store.load(b.id)) ?? null;
          this.#show(b, this.#timer !== null ? { kind: 'pending' } : { kind: 'saved', at: this.#now() });
        }
      } else if (b.id === null && b.create) await this.#save(b);
    });
  }

  /** The open document changed: save it once changes stop for a moment. */
  changed(): void {
    const b = this.#b;
    if (!b || b.readOnly) return;
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    this.#timer = this.#timers.set(() => {
      this.#timer = null;
      void this.#queue(() => this.#save(b));
    }, this.#delay);
    this.#show(b, { kind: 'pending' });
  }

  /**
   * Save now whatever isn't stored (the page is hidden or going away): the pending change, and every
   * document whose save failed. The first save is issued before this returns control to the event
   * loop. Resolves when every save has run.
   */
  flush(): Promise<void> {
    const retry = new Set(this.#unsaved);
    const b = this.#b;
    // Written before anything else, synchronously: the one write an unloading page can't lose.
    if (this.#timer !== null && b && !b.readOnly) this.#journal.write({ id: b.id ?? '', name: b.name, text: b.text(), at: this.#now() });
    if (this.#timer !== null) {
      this.#timers.clear(this.#timer);
      this.#timer = null;
      if (this.#b) retry.add(this.#b);
    }
    for (const u of retry) void this.#queue(() => this.#save(u));
    return this.#chain;
  }

  /** An export or Save to Files succeeded: the draft's "not exported" reminder resets. */
  markExported(): Promise<void> {
    const b = this.#b;
    return this.#queue(async () => {
      if (!b?.id || b.readOnly) return;
      if (b.draft) b.draft = await this.#store.exportedOver(b.draft);
      else await this.#store.markExported(b.id);
    });
  }

  // Run after everything queued before; a failure is reported by the step itself, never thrown on.
  #queue(step: () => Promise<void>): Promise<void> {
    const next = this.#chain.then(step).catch((e) => this.#fail(this.#b, e));
    this.#chain = next;
    return next;
  }

  async #save(b: Binding): Promise<void> {
    if (b.readOnly) return;
    const text = b.text();
    this.#show(b, { kind: 'saving' });
    try {
      if (b.id === null) {
        b.draft = await this.#store.create(b.name, text);
        b.id = b.draft.id;
        b.release = await this.#lock(b.id); // a new id: no other tab has it
      } else if (b.draft) {
        b.draft = await this.#store.saveOver(b.draft, text); // written even if it was deleted meanwhile: not lost
      } else {
        b.draft = await this.#store.create(b.name, text, b.id); // it was gone when bound: written again, not lost
      }
    } catch (e) {
      this.#fail(b, e);
      return;
    }
    b.error = null;
    const j = this.#journal.read();
    if (j && (j.id === b.id || j.id === '') && j.text === text) this.#journal.clear(); // stored now: nothing to replay
    const was = this.#unsaved.delete(b);
    this.#show(b, this.#timer !== null && b === this.#b ? { kind: 'pending' } : { kind: 'saved', at: this.#now() });
    if (was) {
      this.#letGo(b);
      this.#announce();
    }
  }

  // A document that is no longer open lets go of its lock once nothing of it is unsaved.
  #letGo(b: Binding): void {
    if (b === this.#b || this.#unsaved.has(b)) return;
    b.release?.();
    b.release = null;
  }

  // A failure is kept with the document it belongs to, and shown whichever document is open.
  #fail(b: Binding | null, e: unknown): void {
    const error = { quota: e instanceof QuotaError, reason: why(e) };
    if (!b || b.readOnly) {
      this.state.set({ kind: 'failed', name: b?.name ?? '', message: failureMessage(b?.name ?? '', error, true), quota: error.quota, open: true });
      return;
    }
    b.error = error;
    this.#unsaved.delete(b);
    this.#unsaved.add(b); // the latest failure is the one shown
    this.#announce();
  }

  // The state: the latest failure while any drawing has unsaved changes, else the open drawing's progress.
  #announce(): void {
    const f = [...this.#unsaved].at(-1);
    if (f) this.state.set({ kind: 'failed', name: f.name, message: failureMessage(f.name, f.error!, f === this.#b), quota: f.error!.quota, open: f === this.#b });
    else if (this.#b) this.state.set(this.#b.shown);
  }

  // Only the bound document's progress shows, and only while nothing is unsaved: a failure stays up
  // until a save succeeds, so the warning to export can't flicker away while nothing is stored.
  #show(b: Binding, s: SaveState): void {
    b.shown = s;
    if (b === this.#b && !this.#unsaved.size) this.state.set(s);
  }
}

/** What the alert says: which drawing isn't saved, and what to do about it. */
export function failureMessage(name: string, error: { quota: boolean; reason: string }, open: boolean): string {
  const which = name ? `“${name}”` : 'this drawing';
  if (error.quota) {
    return open
      ? `Storage is full, so ${which} isn’t saved: export this drawing now, then delete old drafts.`
      : `Storage is full, so your last changes to ${which} aren’t saved: delete old drafts, or reopen it from Files and export it.`;
  }
  return open
    ? `Drafts can’t be saved here (${error.reason}), so ${which} isn’t saved: export this drawing to keep it.`
    : `Drafts can’t be saved here (${error.reason}), so your last changes to ${which} aren’t saved: reopen it from Files and export it.`;
}
