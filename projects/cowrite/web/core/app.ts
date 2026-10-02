// The app model: state and commands, framework-free. React panels read the store and call
// commands; the editor and the relay talk to the core here without rendering React.
//
// Every core call for the open document goes through one queue (`run`), so local edits, remote
// batches and saves reach the core in the order they happened on this page.
import { openStorage, type Storage } from '../ports/storage';
import { Relay, isDocumentId, newDocumentId, type RelayStatus } from '../ports/relay';
import { fromBase64Url, importKey, newKey, open, seal, toBase64Url } from '../ports/seal';
import { CoreClient } from '../worker/client';
import { isCoreError, type Bytes, type Handle } from '../worker/protocol';
import { Editor, parsePatches, parseView, type AuthorInfo, type DocView } from './editor';
import { createStore } from './store';

export const APP = 'cowrite';

/** Author colors: every one keeps text at 10:1 or better under its tint, and is 3:1 against the page, light and dark. */
export const COLORS = [
  { name: 'Red', hex: '#e5484d' },
  { name: 'Orange', hex: '#e35c00' },
  { name: 'Gold', hex: '#a87b00' },
  { name: 'Green', hex: '#2b9a66' },
  { name: 'Teal', hex: '#0d9b8a' },
  { name: 'Blue', hex: '#0d74ce' },
  { name: 'Purple', hex: '#8e4ec6' },
  { name: 'Pink', hex: '#d6409f' },
] as const;

export interface Identity {
  id: string;
  name: string;
  color: string;
}
export interface DocEntry {
  id: string;
  key: string;
  title: string;
  opened: number;
}
export interface OpenDoc {
  id: string;
  title: string;
  status: RelayStatus;
  authors: AuthorInfo[];
  waiting: boolean; // joined by link and nothing has arrived yet
  saved: boolean; // everything this page knows is in this device's storage
}
export interface State {
  phase: 'loading' | 'ready' | 'error';
  error: string;
  identity: Identity | null;
  editingIdentity: boolean;
  docs: DocEntry[];
  open: OpenDoc | null;
  showAuthors: boolean;
  storage: string;
  notice: string;
}

export const store = createStore<State>({
  phase: 'loading', error: '', identity: null, editingIdentity: false, docs: [], open: null, showAuthors: true, storage: '', notice: '',
});

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();
const describe = (e: unknown) => (isCoreError(e) ? `${e.kind}: ${e.message}` : String(e));
const actor = (): Bytes => crypto.getRandomValues(new Uint8Array(16));
const randomHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const titleOf = (text: string): string => {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  const t = line.trim();
  return t ? (t.length > 60 ? `${t.slice(0, 59)}…` : t) : 'Untitled';
};

const client = new CoreClient();
let storage: Storage | null = null;
let nextHandle = 1;

async function readJson<T>(name: string): Promise<T | null> {
  const b = await storage?.read(name);
  if (!b) return null;
  try {
    return JSON.parse(fromUtf8.decode(b)) as T;
  } catch {
    return null;
  }
}
const writeJson = (name: string, value: unknown) => storage?.write(name, utf8.encode(JSON.stringify(value)));

/** Everything about the document open right now. Replaced as a whole on open and close. */
interface Session {
  entry: DocEntry;
  handle: Handle;
  key: CryptoKey;
  relay: Relay | null;
  editor: Editor;
  queue: Promise<void>;
  closed: boolean;
  batchTimer: ReturnType<typeof setTimeout> | null;
  saveTimer: ReturnType<typeof setTimeout> | null;
  /** Bumped on every change; a save is current only if it saw the latest. */
  changes: number;
  view: DocView;
}
let session: Session | null = null;
let mountPoint: HTMLElement | null = null;

/** Queue work on the open document's core. Work queued for a document that has since closed is dropped. */
function run(s: Session, task: () => Promise<void>): Promise<void> {
  s.queue = s.queue.then(async () => {
    if (s.closed) return;
    try {
      await task();
    } catch (e) {
      if (!s.closed) store.set({ notice: `Something went wrong: ${describe(e)}` });
    }
  });
  return s.queue;
}

function setOpen(patch: Partial<OpenDoc>) {
  const o = store.get().open;
  if (o) store.set({ open: { ...o, ...patch } });
}

function showView(s: Session, view: DocView) {
  s.view = view;
  const title = titleOf(view.text);
  setOpen({ authors: view.authors, title, ...(view.text ? { waiting: false } : {}) });
  if (title !== s.entry.title) {
    s.entry.title = title;
    store.set({ docs: store.get().docs.map((d) => (d.id === s.entry.id ? { ...s.entry } : d)) });
  }
}

/** Tell the core about typing since it last heard. Runs inside the queue. */
async function flushInput(s: Session) {
  const edit = s.editor.takeEdit();
  const me = store.get().identity;
  if (!edit || !me) return;
  const view = parseView(await client.call('splice', s.handle, edit.index, edit.remove, edit.insert, me.id));
  s.editor.render(view);
  showView(s, view);
  scheduleBatch(s);
  scheduleSave(s);
}

async function pump(s: Session) {
  const msg = await client.call('relayMessage', s.handle);
  if (msg) s.relay?.send(msg);
}

/** Seal this device's new changes into the envelope and send it. */
async function batch(s: Session) {
  await flushInput(s);
  const plain = await client.call('takeLocalBatch', s.handle);
  if (plain.length) {
    await client.call('appendBlob', s.handle, await seal(s.key, s.entry.id, plain));
    await pump(s);
    scheduleSave(s);
  }
}

function scheduleBatch(s: Session) {
  if (s.batchTimer) return;
  s.batchTimer = setTimeout(() => {
    s.batchTimer = null;
    void run(s, () => batch(s));
  }, 300);
}

async function saveNow(s: Session) {
  const seen = s.changes;
  const file = await client.call('save', s.handle);
  await storage?.write(`${s.entry.id}.cw`, file);
  s.entry.opened = Date.now();
  await writeJson('docs.json', store.get().docs.map((d) => (d.id === s.entry.id ? s.entry : d)));
  if (s.changes === seen && !s.closed) setOpen({ saved: true });
}

/** Something changed: save soon. A short delay keeps a burst of typing to one write. */
function scheduleSave(s: Session) {
  s.changes++;
  if (store.get().open?.saved) setOpen({ saved: false });
  if (s.saveTimer) return;
  s.saveTimer = setTimeout(() => {
    s.saveTimer = null;
    void run(s, () => saveNow(s));
  }, 300);
}

/** Apply every new blob from the relay: open it, apply it, move the text and caret. */
async function absorb(s: Session) {
  const framed = await client.call('takeNewBlobs', s.handle);
  if (!framed.length) return;
  const view = new DataView(framed.buffer, framed.byteOffset, framed.byteLength);
  let changed = false;
  for (let at = 0; at + 4 <= framed.length; ) {
    const n = view.getUint32(at, true);
    const blob = framed.subarray(at + 4, at + 4 + n);
    at += 4 + n;
    const plain = await open(s.key, s.entry.id, blob);
    if (!plain) continue; // not sealed with this document's key: ignore it
    await s.editor.idle();
    await flushInput(s);
    let patches;
    try {
      patches = parsePatches(await client.call('applyBatch', s.handle, plain));
    } catch (e) {
      if (isCoreError(e) && e.kind === 'batch') continue;
      throw e;
    }
    const v = parseView(await client.call('view', s.handle));
    const pending = s.editor.applyRemote(patches, v);
    showView(s, v);
    if (pending) await flushInput(s);
    changed = true;
  }
  if (changed) scheduleSave(s);
}

function connect(s: Session) {
  s.relay = new Relay(s.entry.id, {
    onOpen: () =>
      void run(s, async () => {
        await client.call('relayReset', s.handle);
        await pump(s);
      }),
    onMessage: (data) =>
      void run(s, async () => {
        await client.call('receiveRelay', s.handle, data);
        await pump(s);
        await absorb(s);
      }),
    onStatus: (status) => {
      if (!s.closed) setOpen({ status });
    },
  });
}

function mountEditor() {
  if (mountPoint && session && session.editor.root.parentElement !== mountPoint) mountPoint.replaceChildren(session.editor.root);
}

async function closeSession() {
  const s = session;
  if (!s) return;
  session = null;
  s.closed = true;
  s.relay?.close();
  if (s.batchTimer) clearTimeout(s.batchTimer);
  if (s.saveTimer) clearTimeout(s.saveTimer);
  await s.queue; // let work already running finish; queued work for a closed document is dropped
  try {
    // Last edits: seal what's unsent (it goes out next time), then save.
    const plain = await client.call('takeLocalBatch', s.handle);
    if (plain.length) await client.call('appendBlob', s.handle, await seal(s.key, s.entry.id, plain));
    await saveNow(s);
  } catch {
    // The worker may be gone (a trap); what was saved last stands.
  }
  await client.call('close', s.handle).catch(() => {});
}

async function openEntry(entry: DocEntry, joining: boolean) {
  await closeSession();
  const raw = fromBase64Url(entry.key);
  if (!raw || raw.length !== 32) throw new Error('this link has no valid key');
  const handle = nextHandle++;
  const file = await storage?.read(`${entry.id}.cw`);
  if (file) await client.call('load', handle, file, actor());
  else await client.call('create', handle, actor());
  const editor = new Editor(() => {
    const s = session;
    if (s && s.editor === editor) void run(s, () => flushInput(s));
  });
  const s: Session = {
    entry, handle, key: await importKey(raw), relay: null, editor, queue: Promise.resolve(), closed: false,
    batchTimer: null, saveTimer: null, changes: 0, view: { text: '', spans: [], authors: [] },
  };
  session = s;
  const me = store.get().identity;
  const view = parseView(me ? await client.call('setAuthor', handle, me.id, me.name, me.color) : await client.call('view', handle));
  editor.reset(view);
  editor.setAuthorsVisible(store.get().showAuthors);
  store.set({ open: { id: entry.id, title: titleOf(view.text), status: 'connecting', authors: view.authors, waiting: joining && !file, saved: true } });
  showView(s, view);
  mountEditor();
  history.replaceState(null, '', `#d=${entry.id}&k=${entry.key}`);
  scheduleBatch(s);
  connect(s);
}

async function rememberEntry(entry: DocEntry) {
  const docs = [entry, ...store.get().docs.filter((d) => d.id !== entry.id)];
  store.set({ docs });
  await writeJson('docs.json', docs);
}

/** `#d=<id>&k=<key>` from the address, if it names a document. */
async function linkFromHash(): Promise<{ id: string; key: string } | null> {
  const p = new URLSearchParams(location.hash.slice(1));
  const id = p.get('d');
  const key = p.get('k');
  if (!id || !key || !(await isDocumentId(id)) || fromBase64Url(key)?.length !== 32) return null;
  return { id, key };
}

let pendingLink: { id: string; key: string } | null = null;

async function openLink(link: { id: string; key: string }) {
  if (!store.get().identity) {
    pendingLink = link;
    return;
  }
  if (session?.entry.id === link.id) return;
  const known = store.get().docs.find((d) => d.id === link.id);
  const entry = known ? { ...known, key: link.key } : { id: link.id, key: link.key, title: 'Shared document', opened: Date.now() };
  await rememberEntry(entry);
  await openEntry(entry, !known);
}

export const commands = {
  async boot() {
    try {
      storage = await openStorage(APP);
      store.set({ storage: storage.backend });
      const [identity, docs, prefs] = await Promise.all([
        readJson<Identity>('me.json'),
        readJson<DocEntry[]>('docs.json'),
        readJson<{ showAuthors?: boolean }>('prefs.json'),
      ]);
      store.set({ identity, docs: docs ?? [], showAuthors: prefs?.showAuthors ?? true, phase: 'ready' });
      client.onReplace = () => {
        // The worker trapped and every open handle went with it: reopen from the last save.
        const s = session;
        if (s) {
          session = null;
          s.closed = true;
          s.relay?.close();
          void openEntry(s.entry, false).catch((e) => store.set({ notice: describe(e) }));
        }
      };
      addEventListener('hashchange', () => void linkFromHash().then((l) => l && openLink(l)));
      const flushAll = () => {
        const s = session;
        if (s && document.visibilityState === 'hidden') void run(s, () => batch(s)).then(() => run(s, () => saveNow(s)));
      };
      document.addEventListener('visibilitychange', flushAll);
      addEventListener('pagehide', flushAll);
      const link = await linkFromHash();
      if (link) await openLink(link);
      void storage.persist();
    } catch (e) {
      store.set({ phase: 'error', error: describe(e) });
    }
  },

  async saveIdentity(name: string, color: string) {
    const prior = store.get().identity;
    const identity: Identity = { id: prior?.id ?? randomHex(8), name: name.trim().slice(0, 40), color };
    store.set({ identity, editingIdentity: false });
    await writeJson('me.json', identity);
    const s = session;
    if (s) {
      void run(s, async () => {
        const view = parseView(await client.call('setAuthor', s.handle, identity.id, identity.name, identity.color));
        s.editor.render(view);
        showView(s, view);
        scheduleBatch(s);
      });
    }
    if (pendingLink) {
      const link = pendingLink;
      pendingLink = null;
      await openLink(link);
    }
  },

  editIdentity(on: boolean) {
    store.set({ editingIdentity: on });
  },

  async newDocument() {
    const id = await newDocumentId();
    const entry: DocEntry = { id, key: toBase64Url(await newKey()), title: 'Untitled', opened: Date.now() };
    await rememberEntry(entry);
    await openEntry(entry, false);
    session?.editor.area.focus();
  },

  async openDocument(id: string) {
    const entry = store.get().docs.find((d) => d.id === id);
    if (entry) await openEntry(entry, false).catch((e) => store.set({ notice: describe(e) }));
  },

  async closeDocument() {
    await closeSession();
    store.set({ open: null });
    history.replaceState(null, '', location.pathname);
  },

  /** The panel's editor slot appeared (or went away). */
  mount(el: HTMLElement | null) {
    mountPoint = el;
    mountEditor();
  },

  async toggleAuthors() {
    const showAuthors = !store.get().showAuthors;
    store.set({ showAuthors });
    session?.editor.setAuthorsVisible(showAuthors);
    await writeJson('prefs.json', { showAuthors });
  },

  /** The share link: the page address with the document and its key in the #fragment. */
  shareUrl(): string {
    const s = session;
    return s ? `${location.origin}${location.pathname}#d=${s.entry.id}&k=${s.entry.key}` : location.href;
  },

  async share() {
    const url = commands.shareUrl();
    const title = session?.entry.title ?? 'Co-write';
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(url);
      store.set({ notice: 'Link copied. Anyone with it can read and edit.' });
    } catch {
      store.set({ notice: url });
    }
  },

  dismissNotice() {
    store.set({ notice: '' });
  },
};
