// Drafts: a cache of work in progress, never the only copy. Files are the source of truth (Save to
// Files, export); drafts survive a reload or a crash between saves. Safari clears a site's storage
// after 7 days without a visit, so Draw reminds you when a draft has not been exported for a while.
//
// - One record per draft, with a ring of its last 20 saved versions.
// - One writer per draft: a Web Lock held while a tab has the draft open, so two tabs never
//   overwrite each other; the second tab opens it read-only.
// - A full storage quota is an error the UI must show, never a silent loss.
// - The storage is a small key-value interface: IndexedDB (idb-keyval) in the app, memory in tests.
// - A record is read as a draft only when it is one: every project on this origin can write Draw's
//   IndexedDB, so a record that isn't what Draw writes is listed as unreadable (to delete), and
//   loading it throws. Nothing downstream ever sees a name or a text that isn't a string.
// - A write commits at once, so one started while the page goes away (pagehide) still lands.

import { createStore, del, get, keys, promisifyRequest } from 'idb-keyval';

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export function idbKV(): KV {
  const store = createStore('draw', 'drafts');
  return {
    get: (k) => get(k, store),
    // idb-keyval's set, plus commit(): the page may be going away (pagehide), and a transaction left
    // to auto-commit at the end of the task is lost with it.
    set: (k, v) =>
      store('readwrite', (s) => {
        s.put(v, k);
        s.transaction.commit?.();
        return promisifyRequest(s.transaction);
      }),
    del: (k) => del(k, store),
    keys: async () => (await keys(store)).map(String),
  };
}

export function memoryKV(): KV {
  const m = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => structuredClone(m.get(k)) as T | undefined,
    set: async (k, v) => void m.set(k, structuredClone(v)),
    del: async (k) => void m.delete(k),
    keys: async () => [...m.keys()],
  };
}

export const VERSIONS = 20;
export const REMIND_AFTER_DAYS = 5; // before Safari's 7-day eviction

export interface Version {
  at: number; // ms
  text: string;
}

export interface Draft {
  id: string;
  name: string;
  text: string;
  created: number;
  updated: number;
  exported: number | null; // last export or Save to Files
  versions: Version[]; // newest last, at most VERSIONS
}

export interface DraftSummary {
  id: string;
  name: string;
  created: number;
  updated: number;
  exported: number | null;
  remind: boolean; // not exported for REMIND_AFTER_DAYS
  /** A record under a draft key that is not a draft Draw wrote: it can only be deleted. */
  unreadable?: true;
}

export class QuotaError extends Error {}

/** A record under a draft's key that is not a draft (another script on the origin, or damage). */
export class UnreadableDraftError extends Error {}

const PREFIX = 'draft:';
const key = (id: string) => `${PREFIX}${id}`;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A draft only if every field is what Draw writes, and it is stored under its own id. */
export function isDraft(v: unknown, id: string): v is Draft {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    d.id === id &&
    typeof d.name === 'string' &&
    typeof d.text === 'string' &&
    finite(d.created) &&
    finite(d.updated) &&
    (d.exported === null || finite(d.exported)) &&
    Array.isArray(d.versions) &&
    d.versions.every((x: unknown) => typeof x === 'object' && x !== null && finite((x as Version).at) && typeof (x as Version).text === 'string')
  );
}

export class DraftStore {
  private kv: KV;
  private now: () => number;

  constructor(kv: KV, now: () => number = Date.now) {
    this.kv = kv;
    this.now = now;
  }

  async create(name: string, text: string, id: string = crypto.randomUUID()): Promise<Draft> {
    const t = this.now();
    const d: Draft = { id, name, text, created: t, updated: t, exported: null, versions: [{ at: t, text }] };
    await this.put(d);
    return d;
  }

  /** The draft, or undefined when there is none; throws UnreadableDraftError for a record that isn't one. */
  async load(id: string): Promise<Draft | undefined> {
    const v = await this.kv.get<unknown>(key(id));
    if (v === undefined) return undefined;
    if (!isDraft(v, id)) throw new UnreadableDraftError('its record is damaged, or was not written by Draw');
    return v;
  }

  /** Save the current text; a changed text also becomes a new version (the ring keeps 20). */
  async save(id: string, text: string): Promise<Draft> {
    const d = await this.load(id);
    if (!d) throw new Error(`no draft ${id}`);
    if (d.text === text) return d;
    const t = this.now();
    d.text = text;
    d.updated = t;
    d.versions.push({ at: t, text });
    if (d.versions.length > VERSIONS) d.versions.splice(0, d.versions.length - VERSIONS);
    await this.put(d);
    return d;
  }

  /**
   * Save over a draft this tab already holds (the autosave's, under its lock): the same as save,
   * but with no read first, so a save started as the page goes away is written within the event.
   */
  async saveOver(d: Draft, text: string): Promise<Draft> {
    if (d.text === text) {
      await this.put(d); // written again even so: it may have been deleted meanwhile
      return d;
    }
    const t = this.now();
    const next: Draft = { ...d, text, updated: t, versions: [...d.versions, { at: t, text }].slice(-VERSIONS) };
    await this.put(next);
    return next;
  }

  /** Record an export of a draft this tab holds: the reminder resets. */
  async exportedOver(d: Draft): Promise<Draft> {
    const next: Draft = { ...d, exported: this.now() };
    await this.put(next);
    return next;
  }

  async rename(id: string, name: string): Promise<void> {
    const d = await this.load(id);
    if (!d) return;
    d.name = name;
    await this.put(d);
  }

  /** Record an export or a Save to Files: the reminder resets. */
  async markExported(id: string): Promise<void> {
    const d = await this.load(id);
    if (!d) return;
    d.exported = this.now();
    await this.put(d);
  }

  remove(id: string): Promise<void> {
    return this.kv.del(key(id));
  }

  async list(): Promise<DraftSummary[]> {
    const out: DraftSummary[] = [];
    for (const k of await this.kv.keys()) {
      if (!k.startsWith(PREFIX)) continue;
      const id = k.slice(PREFIX.length);
      const d = await this.kv.get<unknown>(k);
      if (isDraft(d, id)) out.push({ id, name: d.name, created: d.created, updated: d.updated, exported: d.exported, remind: this.needsReminder(d) });
      else if (d !== undefined) out.push({ id, name: 'Unreadable draft', created: 0, updated: 0, exported: null, remind: false, unreadable: true });
    }
    return out.sort((a, b) => b.updated - a.updated);
  }

  needsReminder(d: Pick<Draft, 'created' | 'exported'>): boolean {
    return this.now() - (d.exported ?? d.created) > REMIND_AFTER_DAYS * 86_400_000;
  }

  private async put(d: Draft): Promise<void> {
    try {
      await this.kv.set(key(d.id), d);
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        throw new QuotaError('Storage is full: export this drawing now, then delete old drafts.');
      }
      throw e;
    }
  }
}

/**
 * Hold a draft's lock while it is open in this tab. Resolves to a release function, or to null
 * when another tab has it (open it read-only). Without Web Locks (very old browsers) it always
 * grants the lock.
 */
export async function lockDraft(id: string): Promise<(() => void) | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return () => {};
  return new Promise((resolve) => {
    void locks.request(`draw-draft:${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return undefined;
      }
      return new Promise<void>((release) => resolve(() => release()));
    });
  });
}
