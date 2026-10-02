// The editor: framework-free (DOCTRINE §1, the web layer). A <textarea> takes the input, so iOS
// keeps its native selection, autocorrect, dictation and IME. Behind it, a mirror holds the same
// text in the same box and font, cut into runs tinted by author; the textarea is transparent, so
// the tints show through exactly under the letters they belong to. The mirror is in normal flow,
// so the pair grows with the text (a one-cell grid) and the page scrolls, not the textarea.
//
// Offsets are UTF-16 code units throughout, the unit JavaScript strings and the core both use.

export interface Run {
  start: number;
  end: number;
  author: string;
}
export interface AuthorInfo {
  id: string;
  name: string;
  color: string;
}
export interface DocView {
  text: string;
  spans: Run[];
  authors: AuthorInfo[];
}
/** Delete `remove` units at `index`, then insert `insert`. */
export interface Edit {
  index: number;
  remove: number;
  insert: string;
}

export function parseView(json: string): DocView {
  const v = JSON.parse(json) as { text: string; spans: [number, number, string][]; authors: [string, string, string][] };
  return {
    text: v.text,
    spans: v.spans.map(([start, end, author]) => ({ start, end, author })),
    authors: v.authors.map(([id, name, color]) => ({ id, name, color })),
  };
}

export const parsePatches = (json: string): Edit[] =>
  (JSON.parse(json) as [number, number, string][]).map(([index, remove, insert]) => ({ index, remove, insert }));

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** The one edit that turns `a` into `b`: common prefix and suffix, never splitting a surrogate pair. */
export function diff(a: string, b: string): Edit | null {
  if (a === b) return null;
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  if (p > 0 && isHigh(a.charCodeAt(p - 1))) p--;
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  if (s > 0 && isLow(a.charCodeAt(a.length - s))) s--;
  return { index: p, remove: a.length - p - s, insert: b.slice(p, b.length - s) };
}

export const applyEdit = (text: string, e: Edit): string => text.slice(0, e.index) + e.insert + text.slice(e.index + e.remove);

/** Where position `p` ends up after `e`. A position exactly at an insertion stays before it. */
export function mapPos(p: number, e: Edit): number {
  if (p <= e.index) return p;
  if (p >= e.index + e.remove) return p - e.remove + e.insert.length;
  return e.index;
}

/** Rebase a local edit made on the old text onto the text after remote edits `remote`. */
export function rebase(local: Edit, remote: Edit[]): Edit {
  let start = local.index;
  let end = local.index + local.remove;
  for (const r of remote) {
    start = mapPos(start, r);
    end = Math.max(start, mapPos(end, r));
  }
  return { index: start, remove: end - start, insert: local.insert };
}

export class Editor {
  readonly root: HTMLElement;
  readonly area: HTMLTextAreaElement;
  private readonly mirror: HTMLElement;
  /** The text the core holds, as far as this page has told it (every edit up to the last diff). */
  known = '';
  private colors = new Map<string, string>();
  private composing = false;
  private idleWaiters: (() => void)[] = [];

  constructor(onInput: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'cw-editor';
    this.mirror = document.createElement('div');
    this.mirror.className = 'cw-mirror';
    this.mirror.setAttribute('aria-hidden', 'true');
    this.area = document.createElement('textarea');
    this.area.className = 'cw-area';
    this.area.setAttribute('aria-label', 'Document text');
    this.area.spellcheck = true;
    this.area.placeholder = 'Start writing…';
    this.root.append(this.mirror, this.area);
    this.area.addEventListener('input', () => {
      if (!this.composing) onInput();
    });
    this.area.addEventListener('compositionstart', () => (this.composing = true));
    this.area.addEventListener('compositionend', () => {
      this.composing = false;
      onInput();
      for (const w of this.idleWaiters.splice(0)) w();
    });
    // Native undo would replay a stale copy of the text over other people's edits.
    this.area.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') e.preventDefault();
    });
  }

  /** Resolves when no IME composition is open: remote edits wait for it. */
  idle(): Promise<void> {
    return this.composing ? new Promise((r) => this.idleWaiters.push(r)) : Promise.resolve();
  }

  /** The local edit since the core last heard, or null. Marks it as told. */
  takeEdit(): Edit | null {
    if (this.composing) return null;
    const e = diff(this.known, this.area.value);
    if (e) this.known = this.area.value;
    return e;
  }

  /** A document was opened: its text and runs, replacing whatever was here. */
  reset(view: DocView) {
    this.known = view.text;
    this.area.value = view.text;
    this.render(view);
  }

  setEnabled(on: boolean) {
    this.area.disabled = !on;
  }

  setAuthorsVisible(on: boolean) {
    this.root.classList.toggle('cw-editor--plain', !on);
  }

  /**
   * Remote edits arrived: `patches` turned `known` into `view.text`. Typing that happened while the
   * core was applying them is rebased on top, and the caret moves with the text around it.
   */
  applyRemote(patches: Edit[], view: DocView): Edit | null {
    const before = this.known;
    const typed = diff(before, this.area.value);
    const selStart = this.area.selectionStart;
    const selEnd = this.area.selectionEnd;
    const focused = document.activeElement === this.area;
    let a = selStart;
    let b = selEnd;
    for (const p of patches) {
      a = mapPos(a, p);
      b = mapPos(b, p);
    }
    this.known = view.text;
    let shown = view.text;
    let pending: Edit | null = null;
    if (typed) {
      pending = rebase(typed, patches);
      shown = applyEdit(shown, pending);
      // The selection was measured on text that included the typing; put the caret after it.
      a = b = pending.index + pending.insert.length;
    }
    if (this.area.value !== shown) {
      this.area.value = shown;
      if (focused || selStart !== 0 || selEnd !== 0) this.area.setSelectionRange(Math.min(a, shown.length), Math.min(b, shown.length));
    }
    this.render(view);
    return pending;
  }

  /** Redraw the tinted runs behind the text. */
  render(view: DocView) {
    this.colors = new Map(view.authors.map((a) => [a.id, a.color]));
    const frag = document.createDocumentFragment();
    let at = 0;
    const plain = (end: number) => {
      if (end > at) frag.append(view.text.slice(at, end));
      at = Math.max(at, end);
    };
    for (const s of view.spans) {
      if (s.start < at) continue;
      plain(s.start);
      const run = document.createElement('span');
      run.className = 'cw-run';
      run.dataset.author = s.author;
      const color = this.colors.get(s.author);
      if (color) run.style.setProperty('--author', color);
      run.textContent = view.text.slice(s.start, s.end);
      frag.append(run);
      at = s.end;
    }
    plain(view.text.length);
    // A trailing newline needs a character after it, or the mirror is one line short.
    frag.append('\u200b');
    this.mirror.replaceChildren(frag);
  }
}
