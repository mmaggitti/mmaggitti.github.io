// The workspace: what is open, and the files around it. It runs every open through the one
// importer (src/import.ts), binds the open document to its draft (src/autosave.ts), keeps the
// import report of what opened (and why the last open failed, if it did), and writes exports.
// React reads its stores (panels/FileSheets.tsx, panels/TopBar.tsx); the page wires in IndexedDB,
// Web Locks, the paste and drop events and the URL fragment (panels/App.tsx). Framework-free, so
// the unit tests drive it with a real Editor over fake views and drafts in memory.
//
// - On load: the sample opens at once; then an #import link opens (and the fragment is cleared,
//   so a reload doesn't import it again), or else the most recent draft reopens.
// - An #import link that arrives while Draw is open (a hash change: typed into the address bar, or
//   set by a page that opened this tab) opens only when Mark taps Open: a page can't push drawings.
// - An import (a file, a paste, a drop) becomes a draft at once and shows its report. A link shows
//   its report but, like New and the sample, becomes a draft on its first change: a link can be
//   large, and one that is only looked at is not kept (it is still in the link). A draft reopens
//   quietly.
// - An open that fails opens nowhere: the drawing that was open stays, and the report sheet says
//   why and where.

import { serialize, type Doc } from '../../../engine/model/doc.ts';
import type { ImportReport } from '../../../engine/report/import-report.ts';
import type { Editor } from './editor.ts';
import { importSvg, why, type ImportFailure, type ImportInput, type Via } from './import.ts';
import { Autosave, type Lock, type Timers } from './autosave.ts';
import { localJournal, type DraftStore, type Journal } from './platform/drafts.ts';
import { decodeImport } from './platform/files.ts';
import type { Outcome } from './platform/share.ts';
import { exportFile, type ExportFile, type ExportKind } from './export/svg.ts';
import { draftRows, type DraftRow } from './files-view.ts';
import { createStore, type Store } from './panels/store.ts';

export type Panel = 'files' | 'report' | 'export' | 'link' | null;

export interface Current {
  name: string;
  via: Via;
  report: ImportReport;
  /** The canvas can't draw it (it refused the root), though it is open: why. */
  problem: string | null;
  /** The encoding its bytes came in (exports write it back so), or null when it came as text. */
  encoding: string | null;
  /** It came gzipped (.svgz): exports are plain .svg. */
  gzip: boolean;
  /** Some of its bytes were not valid in that encoding, so an as-is export differs there. */
  lossy: boolean;
}

/** New: a blank artboard. */
export const BLANK = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">\n</svg>\n';

export interface WorkspaceDeps {
  store: DraftStore;
  lock: Lock;
  sample: string;
  timers?: Timers;
  delay?: number;
  now?: () => number;
  /** The unload journal (tests pass memoryJournal()). */
  journal?: Journal;
}

export class Workspace {
  readonly panel: Store<Panel> = createStore<Panel>(null);
  readonly current: Store<Current | null> = createStore<Current | null>(null);
  /** The last open that failed, until the next one succeeds or its sheet is closed. */
  readonly failure: Store<ImportFailure | null> = createStore<ImportFailure | null>(null);
  /** The Files menu's draft list, read again each time it opens (null while it loads). */
  readonly drafts: Store<DraftRow[] | null> = createStore<DraftRow[] | null>(null);
  /** An #import link that arrived while Draw was open, waiting for Open (panel 'link'). */
  readonly offer: Store<string | null> = createStore<string | null>(null);
  readonly autosave: Autosave;
  #editor: Editor;
  #store: DraftStore;
  #lock: Lock;
  #journal: Journal;
  #sample: string;
  #now: () => number;
  #doc: Doc | null = null; // the document bound to the autosave

  constructor(editor: Editor, deps: WorkspaceDeps) {
    this.#editor = editor;
    this.#store = deps.store;
    this.#lock = deps.lock;
    this.#sample = deps.sample;
    this.#now = deps.now ?? Date.now;
    this.#journal = deps.journal ?? localJournal;
    this.autosave = new Autosave(deps.store, deps.lock, { timers: deps.timers, delay: deps.delay, now: deps.now, journal: this.#journal });
    // The last subscriber of the plan's data flow: after the canvas, the code, the overlay and the
    // stores. Only the bound document is saved (drawTest.render opens others, unbound).
    editor.onChange(() => {
      if (editor.doc && editor.doc === this.#doc) this.autosave.changed();
    });
  }

  // ── opening ────────────────────────────────────────────────────────────────────────────────

  /** The sample, synchronously (its text opens before the importer's first await). */
  openSample(): Promise<boolean> {
    return this.#open({ via: 'sample', name: 'Sample', text: this.#sample }, {});
  }

  /**
   * After the sample: an #import link in `fragment` opens (openLink); otherwise the most recent
   * draft reopens, unless something else opened meanwhile.
   */
  async boot(fragment: string, clearFragment: () => void): Promise<void> {
    await this.#replayJournal();
    const before = this.#editor.doc;
    if (await this.openLink(fragment, clearFragment)) return;
    let latest: string | undefined;
    try {
      latest = (await this.#store.list()).find((d) => !d.unreadable)?.id;
    } catch {
      return; // no storage here: the sample stays, and the first save says why nothing is kept
    }
    if (latest === undefined || this.#editor.doc !== before) return;
    const failure = this.failure.get(); // a broken link still says so over the draft
    try {
      await this.openDraft(latest);
    } catch (e) {
      // Whatever went wrong, the sample stays open and the app stays up: say so.
      this.#editor.notice.set(`The last drawing couldn’t be reopened (${why(e)})`);
    }
    if (failure) {
      this.failure.set(failure);
      this.panel.set('report');
    }
  }

  /**
   * A change the page wrote to the unload journal as it went away, whose IndexedDB save may not have
   * landed: written into its draft if it is newer (as a new version), or as a new draft for a drawing
   * that wasn't one yet, under the draft's lock. Kept for the next load if that can't happen now.
   */
  async #replayJournal(): Promise<void> {
    const j = this.#journal.read();
    if (!j) return;
    const release = j.id ? await this.#lock(j.id) : null;
    if (j.id && !release) return; // another tab has that draft open: leave it for later
    try {
      let d;
      try {
        d = j.id ? await this.#store.load(j.id) : undefined;
      } catch {
        d = undefined; // an unreadable record under its id: the journal's text replaces it
      }
      if (!d) await this.#store.create(j.name, j.text, j.id || undefined);
      else if (d.updated < j.at && d.text !== j.text) await this.#store.saveOver(d, j.text);
      this.#journal.clear();
    } catch {
      // storage refused it (full, or gone): keep the journal for the next load
    } finally {
      release?.();
    }
  }

  /**
   * An #import=… fragment on load (or one Mark said to open): the fragment is cleared first, so a
   * reload never imports it again, whether or not it opens. It shows its report, and becomes a
   * draft on its first change. True when it opened.
   */
  async openLink(fragment: string, clearFragment: () => void): Promise<boolean> {
    if (!/^#?import=/.test(fragment)) return false;
    clearFragment();
    let text: string | null = null;
    try {
      text = await decodeImport(fragment);
      if (text === null) this.#linkFailed('the link does not hold a drawing');
    } catch (e) {
      this.#linkFailed(`the link’s drawing could not be read (${why(e)})`);
    }
    return text !== null && (await this.#open({ via: 'link', name: '', text }, { show: true }));
  }

  /**
   * An #import=… fragment that arrived while Draw is open (a hash change): cleared at once, and
   * offered (panel 'link'); it opens only on Open (acceptLink). A newer one replaces the offer.
   */
  offerLink(fragment: string, clearFragment: () => void): boolean {
    if (!/^#?import=/.test(fragment)) return false;
    clearFragment();
    this.offer.set(fragment);
    this.show('link');
    return true;
  }

  /** Open the offered link (Mark tapped Open). */
  acceptLink(): Promise<boolean> {
    const fragment = this.offer.get();
    this.offer.set(null);
    return fragment ? this.openLink(fragment, () => {}) : Promise.resolve(false);
  }

  /** A picked or dropped file (read by the importer): it becomes a draft, and its report shows. */
  openFile(file: Blob, name: string, via: Via): Promise<boolean> {
    return this.#open({ via, name, file }, { show: true, create: true });
  }

  /** A file's bytes: it becomes a draft, and its report shows. */
  openBytes(bytes: Uint8Array, name: string, via: Via): Promise<boolean> {
    return this.#open({ via, name, bytes }, { show: true, create: true });
  }

  /** Pasted or dropped text: it becomes a draft, and its report shows. */
  openText(text: string, name: string, via: Via): Promise<boolean> {
    return this.#open({ via, name, text }, { show: true, create: true });
  }

  /** A blank artboard (a draft once it changes). */
  newDrawing(): Promise<boolean> {
    return this.#open({ via: 'new', name: '', text: BLANK }, {});
  }

  /** Reopen a draft; read-only when another tab has it open (reopening it tries its lock again). */
  async openDraft(id: string): Promise<boolean> {
    if (id === this.autosave.draftId && !this.autosave.readOnly) {
      this.panel.set(null);
      return true;
    }
    // Changes whose save failed here are newer than what storage holds: they reopen, not the stored text.
    const unsaved = this.autosave.unsaved(id);
    if (unsaved) return this.#open({ via: 'draft', name: unsaved.name, text: unsaved.text }, { draft: id });
    let draft;
    try {
      draft = await this.#store.load(id);
    } catch (e) {
      this.#editor.notice.set(`That draft can’t be read (${why(e)})`);
      return false;
    }
    if (!draft) {
      this.#editor.notice.set('That draft is gone');
      await this.refreshDrafts();
      return false;
    }
    return this.#open({ via: 'draft', name: draft.name, text: draft.text }, { draft: draft.id });
  }

  async #open(input: ImportInput, how: { draft?: string; show?: boolean; create?: boolean }): Promise<boolean> {
    const r = await importSvg(this.#editor, input);
    if (!r.ok) {
      this.failure.set(r);
      this.panel.set('report');
      return false;
    }
    const doc = r.doc;
    if (this.#editor.doc !== doc) return false; // another open took the editor meanwhile
    this.#doc = doc;
    this.failure.set(null);
    this.current.set({ name: r.name, via: r.via, report: r.report, problem: r.problem, encoding: r.encoding, gzip: r.gzip, lossy: r.lossy });
    this.#editor.readOnly.set(false);
    this.panel.set(how.show ? 'report' : null);
    await this.autosave.attach({ text: () => serialize(doc), id: how.draft ?? null, name: r.name, create: !!how.create });
    if (this.#doc === doc) this.#editor.readOnly.set(this.autosave.readOnly);
    return true;
  }

  #linkFailed(message: string): void {
    this.failure.set({ ok: false, via: 'link', name: 'Linked drawing', message, line: null, column: null, excerpt: null });
    this.panel.set('report');
  }

  // ── the Files menu ─────────────────────────────────────────────────────────────────────────

  async refreshDrafts(): Promise<void> {
    try {
      this.drafts.set(draftRows(await this.#store.list(), this.#now(), this.autosave.draftId));
    } catch {
      this.drafts.set([]);
    }
  }

  /** Delete a draft that is not open here, and not open in another tab. */
  async deleteDraft(id: string): Promise<boolean> {
    if (id === this.autosave.draftId) return false;
    if (this.autosave.unsaved(id)) {
      this.#editor.notice.set('That drawing has changes that aren’t saved yet, so it can’t be deleted');
      return false;
    }
    const release = await this.#lock(id);
    if (!release) {
      this.#editor.notice.set('That drawing is open in another tab, so it can’t be deleted here');
      return false;
    }
    try {
      await this.#store.remove(id);
    } finally {
      release();
    }
    await this.refreshDrafts();
    return true;
  }

  // ── sheets ─────────────────────────────────────────────────────────────────────────────────

  show(panel: Exclude<Panel, null>): void {
    // A token sheet (or Edit source) closes first: its edits commit, as its own Done would.
    this.#editor.closeSheet();
    this.#editor.closeSource();
    if (panel === 'files') {
      this.drafts.set(null);
      void this.refreshDrafts();
    }
    if (panel === 'report') this.failure.set(null);
    this.panel.set(panel);
  }

  close(): void {
    this.panel.set(null);
    this.failure.set(null);
    this.offer.set(null);
  }

  // ── export ─────────────────────────────────────────────────────────────────────────────────

  /** The file an export writes, now (synchronously: the share sheet needs the tap's activation). */
  exportFile(kind: ExportKind): ExportFile | null {
    const doc = this.#editor.doc;
    const current = this.current.get();
    return doc ? exportFile(doc, current?.name ?? 'drawing', kind, current?.encoding ?? undefined) : null;
  }

  /** After the share sheet or the download: say so (the sheet closes), and reset the draft's "not exported" reminder. */
  async exported(file: ExportFile, outcome: Outcome): Promise<void> {
    if (outcome === 'cancelled') return;
    this.panel.set(null);
    this.#editor.notice.set(`${outcome === 'shared' ? 'Shared' : 'Downloaded'} ${file.fileName}`);
    await this.autosave.flush(); // the draft holds exactly what was exported
    await this.autosave.markExported();
  }
}
