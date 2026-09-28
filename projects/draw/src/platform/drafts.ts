// Drafts: a cache of work in progress, never the only copy. Files are the source of truth (Save to
// Files, export); drafts survive a reload or a crash between saves. Safari clears a site's storage
// after 7 days without a visit, so Draw reminds you when a draft has not been exported for a while.
//
// - One record per draft, with a ring of its last 20 saved versions.
// - One writer per draft: a Web Lock held while a tab has the draft open, so two tabs never
//   overwrite each other; the second tab opens it read-only.
// - A full storage quota is an error the UI must show, never a silent loss.
// - The storage is a small key-value interface: IndexedDB (idb-keyval) in the app, memory in tests.

import { createStore, del, get, keys, set } from 'idb-keyval';

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
    set: (k, v) => set(k, v, store),
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
  updated: number;
  exported: number | null;
  remind: boolean; // not exported for REMIND_AFTER_DAYS
}

export class QuotaError extends Error {}

const key = (id: string) => `draft:${id}`;

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

  load(id: string): Promise<Draft | undefined> {
    return this.kv.get<Draft>(key(id));
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
      if (!k.startsWith('draft:')) continue;
      const d = await this.kv.get<Draft>(k);
      if (d) out.push({ id: d.id, name: d.name, updated: d.updated, exported: d.exported, remind: this.needsReminder(d) });
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
