// The code panel: the document's real source, with every number, colour, keyword and text run a
// token. Framework-free: one DOM block per document node, so an edit patches one block, never the
// whole listing, and a scrub never goes through React.
//
// Its text is the source as text (textContent), never markup, so nothing here can make document
// content live; that is the sink's job alone (tools/check-sinks.mjs allows this folder to create
// its own spans). A colour token's swatch is painted from the colour the engine read (blocks.ts),
// never from the file's text.
//
// Tokens are smaller than a 44pt tap target, so a tap near a token takes the nearest one (within
// NEAR px). A number token scrubs by dragging sideways (scrub.ts); a vertical drag scrolls. Only a
// finger that stayed put, alone, is a tap (Taps): a swipe or a pinch over the code edits nothing.
// Every token takes the keyboard too: Enter or Space does what a tap does (a number opens its
// sheet), and the arrow keys step a number.
//
// - Read-only (another tab has the drawing): every token is plain, unhighlighted, selectable text
//   that no drag or key edits (a tap says why).
// - Source (a file that isn't well-formed): its text, read-only, with the error's place marked.
// - Tidy (layout.ts): the same blocks laid out one element a line; only whitespace changes, and
//   only on screen. The width is measured again whenever the panel changes size.
// - A patched block flashes only the tokens that changed (all of it when its shape changed); the
//   flash is a CSS animation, which reduced motion turns off.

import { ScrubGesture, Taps } from './scrub.ts';
import { changedTokens } from './blocks.ts';
import { columns, tidy, type Tidy } from './layout.ts';

export type TokenKind = 'number' | 'color' | 'enum' | 'text' | 'ref';

export interface ViewToken {
  start: number; // offsets in the block's text
  end: number;
  kind: TokenKind;
  /** A colour's swatch (blocks.ts swatchOf): a hex colour, or 'none', 'current' or 'context'. */
  swatch?: string;
}

/** Where a block goes in the tidy view: on its own line, after the block before, or not shown. */
export type Flow = 'line' | 'inline' | 'hidden';

export interface ViewBlock {
  key: string; // stable across edits (the node's id and part: 'n12:start')
  node: number; // the NodeId it shows
  part: 'start' | 'end' | 'leaf';
  text: string;
  tokens: ViewToken[];
  depth: number; // element ancestors
  flow: Flow;
}

/** A token by its block's key and its index among the block's tokens (which an edit keeps). */
export interface FocusMark {
  key: string;
  index: number;
}

/** A key on a focused token: Enter or Space ('open'), or an arrow ('up', 'down'). */
export type TokenKey = 'open' | 'up' | 'down';

export interface CodeViewHandlers {
  /** A tap on (or near) a token: open its sheet, or cycle an enum. */
  tap(block: ViewBlock, token: ViewToken, anchor: DOMRect): void;
  /** A tap on a block's plain text: select that node. */
  blockTap(block: ViewBlock): void;
  scrubStart(block: ViewBlock, token: ViewToken): void;
  scrub(steps: number): void;
  scrubEnd(committed: boolean): void;
  key(block: ViewBlock, token: ViewToken, key: TokenKey): void;
}

export const NEAR = 22; // px: half of a 44pt target

const KEYS: Record<string, TokenKey | undefined> = { Enter: 'open', ' ': 'open', ArrowUp: 'up', ArrowRight: 'up', ArrowDown: 'down', ArrowLeft: 'down' };

export class CodeView {
  private root: HTMLElement;
  private h: CodeViewHandlers;
  private blocks = new Map<string, { data: ViewBlock; el: HTMLElement | null }>();
  private order: string[] = [];
  private gesture: { g: ScrubGesture; block: ViewBlock; token: ViewToken; span: HTMLElement; id: number; last: number | null } | null = null;
  private taps = new Taps();
  private focused: FocusMark | null = null;
  private off: Array<() => void> = [];
  private ro = false;
  private raw = false; // showing a file's text as source (source())
  private tidyOn = false;
  private cols = 40;
  private firstLine: string | null = null; // the first block the tidy view shows

  constructor(root: HTMLElement, handlers: CodeViewHandlers) {
    this.root = root;
    this.h = handlers;
    root.classList.add('cv');
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      root.addEventListener(type, fn as EventListener);
      this.off.push(() => root.removeEventListener(type, fn as EventListener));
    };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e, false));
    on('pointercancel', (e) => this.up(e, true));
    on('keydown', (e) => this.keydown(e));
    // The tidy view fits the panel's width: measured again when that changes (a rotation, the dock).
    const resize = new ResizeObserver(() => {
      if (this.tidyOn && !this.raw && this.measure()) this.rebuild();
    });
    resize.observe(root);
    this.off.push(() => resize.disconnect());
  }

  /** Replace the whole listing (a new document). */
  set(blocks: readonly ViewBlock[]): void {
    this.raw = false;
    this.root.classList.remove('cv--source');
    this.root.classList.toggle('cv--ro', this.ro);
    this.blocks.clear();
    this.order = [];
    for (const b of blocks) {
      this.blocks.set(b.key, { data: b, el: null });
      this.order.push(b.key);
    }
    this.rebuild();
  }

  /**
   * Replace one block after an edit; nothing else in the listing is touched. The tokens that changed
   * flash (the whole block when its shape changed), and a token being scrubbed or focused stays so
   * in the new block.
   */
  patch(b: ViewBlock): void {
    const cur = this.blocks.get(b.key);
    if (!cur?.el || this.raw) return;
    if (cur.data.text === b.text && cur.data.flow === b.flow && cur.data.depth === b.depth && sameTokens(cur.data.tokens, b.tokens)) return;
    const el = this.build(b);
    if (cur.el.classList.contains('cv-selected')) el.classList.add('cv-selected');
    const changed = changedTokens(cur.data, b);
    const flash = (target: Element | null) => target?.classList.add('cv-flash');
    if (changed === null) flash(el);
    else for (const i of changed) flash(el.querySelector(`.cv-tok[data-t="${i}"]`));
    const g = this.gesture;
    if (g && g.block.key === b.key) {
      const span = el.querySelector<HTMLElement>(`.cv-tok[data-t="${g.span.dataset.t}"]`);
      if (span) {
        if (g.span.classList.contains('cv-active')) span.classList.add('cv-active');
        g.span = span;
      }
    }
    const active = document.activeElement;
    const had = active instanceof HTMLElement && cur.el.contains(active) ? active.dataset.t : undefined;
    cur.el.replaceWith(el);
    this.blocks.set(b.key, { data: b, el });
    if (had !== undefined) el.querySelector<HTMLElement>(`.cv-tok[data-t="${had}"]`)?.focus({ preventScroll: true });
    if (this.focused?.key === b.key) this.markFocus();
  }

  /**
   * Put these blocks (a node inserted or moved, and everything under it) before the block keyed
   * `before`, or at the end. Every other block keeps its DOM node.
   */
  place(blocks: readonly ViewBlock[], before: string | null): void {
    if (this.raw || !blocks.length) return;
    this.drop(blocks.map((b) => b.key));
    const found = before === null ? -1 : this.order.indexOf(before);
    const at = found === -1 ? this.order.length : found;
    for (const b of blocks) this.blocks.set(b.key, { data: b, el: null });
    this.order.splice(at, 0, ...blocks.map((b) => b.key));
    const after = this.order[at + blocks.length];
    const next = after === undefined ? null : this.blocks.get(after)!.el;
    if (this.firstMoved() || (after !== undefined && next?.parentNode !== this.root)) return this.rebuild();
    const made = document.createDocumentFragment();
    for (const b of blocks) {
      const el = this.build(b);
      this.blocks.get(b.key)!.el = el;
      made.append(el);
    }
    this.root.insertBefore(made, next);
    this.markFocus();
  }

  /** Take these blocks away (a node removed); the rest stay. */
  remove(keys: readonly string[]): void {
    if (this.drop(keys) && this.firstMoved()) this.rebuild();
  }

  private drop(keys: readonly string[]): boolean {
    const gone = new Set(keys.filter((k) => this.blocks.has(k)));
    for (const k of gone) {
      this.blocks.get(k)!.el?.remove();
      this.blocks.delete(k);
    }
    if (gone.size) this.order = this.order.filter((k) => !gone.has(k));
    return gone.size > 0;
  }

  // The tidy view lays out its first shown block apart (no line break before it): when another
  // block becomes the first, the listing is laid out again.
  private firstMoved(): boolean {
    return this.tidyOn && (this.order.find((k) => this.blocks.get(k)!.data.flow !== 'hidden') ?? null) !== this.firstLine;
  }

  /** Mark the blocks of the selected nodes, and bring the first into view. */
  select(nodes: ReadonlySet<number>): void {
    let first: HTMLElement | null = null;
    for (const key of this.order) {
      const { data, el } = this.blocks.get(key)!;
      if (!el) continue;
      const on = nodes.has(data.node);
      el.classList.toggle('cv-selected', on);
      if (on && !first) first = el;
    }
    first?.scrollIntoView({ block: 'nearest' });
  }

  /** Mark the number the Scrub strip edits (cv-focus), or none; the mark stays through edits of its block. */
  focus(mark: FocusMark | null): void {
    this.root.querySelector('.cv-focus')?.classList.remove('cv-focus');
    this.focused = mark;
    this.markFocus();
  }

  /** Read-only: every token plain, selectable text that nothing here edits (the listing is rebuilt). */
  readOnly(on: boolean): void {
    if (on === this.ro) return;
    this.ro = on;
    this.root.classList.toggle('cv--ro', on || this.raw);
    if (!this.raw) this.rebuild();
  }

  /** The tidy view on or off: a way of showing the code, which never changes the file. */
  layout(tidyOn: boolean): void {
    if (tidyOn === this.tidyOn) return;
    this.tidyOn = tidyOn;
    this.root.classList.toggle('cv--tidy', tidyOn);
    if (!this.raw) this.rebuild();
  }

  /**
   * A file that isn't well-formed, as read-only source: its text exactly, with the line that failed
   * and the character at `at` marked. The listing and any gesture in progress are gone.
   */
  source(text: string, at: number): void {
    this.gesture = null;
    this.raw = true;
    this.blocks.clear();
    this.order = [];
    this.focused = null;
    this.root.classList.add('cv--source', 'cv--ro');
    this.root.classList.remove('cv-scrubbing');
    const pos = Math.max(0, Math.min(at, text.length));
    const lineStart = Math.max(text.lastIndexOf('\n', pos - 1), text.lastIndexOf('\r', pos - 1)) + 1;
    const rest = text.slice(pos).search(/[\r\n]/);
    const lineEnd = rest === -1 ? text.length : pos + rest;
    const line = document.createElement('span');
    line.className = 'cv-error-line';
    const mark = document.createElement('span');
    mark.className = 'cv-error';
    // The failing character, or a caret (CSS) where there is none: at the end of a line or of the file.
    const ch = pos < lineEnd ? String.fromCodePoint(text.codePointAt(pos)!) : '';
    if (ch) mark.textContent = ch;
    else mark.classList.add('cv-error--gap');
    line.append(document.createTextNode(text.slice(lineStart, pos)), mark, document.createTextNode(text.slice(pos + ch.length, lineEnd)));
    this.root.replaceChildren(document.createTextNode(text.slice(0, lineStart)), line, document.createTextNode(text.slice(lineEnd)));
  }

  /** Bring the source view's error mark into view. */
  revealError(): void {
    this.root.querySelector('.cv-error')?.scrollIntoView({ block: 'center' });
  }

  destroy(): void {
    for (const f of this.off) f();
    this.root.replaceChildren();
  }

  // Every block again, as the mode (read-only, tidy) and the width say; the selection stays marked.
  private rebuild(): void {
    if (this.tidyOn) this.measure();
    this.firstLine = this.order.find((k) => this.blocks.get(k)!.data.flow !== 'hidden') ?? null;
    const all = document.createDocumentFragment();
    for (const key of this.order) {
      const entry = this.blocks.get(key)!;
      const selected = !!entry.el?.classList.contains('cv-selected');
      entry.el = this.build(entry.data);
      if (selected) entry.el.classList.add('cv-selected');
      all.append(entry.el);
    }
    this.root.replaceChildren(all);
    this.markFocus();
  }

  /** The columns of code that fit the panel now; true when that changed. */
  private measure(): boolean {
    const probe = document.createElement('span');
    probe.className = 'cv-probe';
    probe.textContent = '0123456789';
    this.root.append(probe);
    const ch = probe.getBoundingClientRect().width / 10;
    probe.remove();
    const cs = getComputedStyle(this.root);
    const width = this.root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (!(width > 0 && ch > 0)) return false; // hidden: keep the last width
    const cols = columns(width, ch);
    const changed = cols !== this.cols;
    this.cols = cols;
    return changed;
  }

  private markFocus(): void {
    const m = this.focused;
    if (m) this.blocks.get(m.key)?.el?.querySelector(`.cv-tok[data-t="${m.index}"]`)?.classList.add('cv-focus');
  }

  private build(b: ViewBlock): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cv-block';
    el.dataset.key = b.key;
    if (this.tidyOn && b.flow === 'hidden') {
      el.classList.add('cv-gone');
      return el;
    }
    const t: Tidy = this.tidyOn ? tidy(b, this.cols, b.key === this.firstLine) : { lead: null, swaps: [], wraps: [] };
    if (t.lead) el.append(document.createTextNode(t.lead));
    // A wrapped attribute holds its own tokens and swaps; the rest goes in the block itself.
    let at = 0;
    for (const w of t.wraps) {
      this.fill(el, b, t, at, w.at);
      const wrap = document.createElement('span');
      wrap.className = 'cv-at';
      wrap.style.setProperty('--cv-at', String(w.indent));
      this.fill(wrap, b, t, w.at, w.end);
      el.append(wrap);
      at = w.end;
    }
    this.fill(el, b, t, at, b.text.length);
    return el;
  }

  // The block's text in [from, to): its tokens as spans, the whitespace tidy swaps, the rest as text.
  private fill(into: HTMLElement, b: ViewBlock, t: Tidy, from: number, to: number): void {
    const items: { at: number; end: number; token?: number; text?: string }[] = [];
    b.tokens.forEach((k, i) => {
      if (k.start >= from && k.end <= to) items.push({ at: k.start, end: k.end, token: i });
    });
    for (const s of t.swaps) if (s.at >= from && s.end <= to) items.push({ at: s.at, end: s.end, text: s.text });
    items.sort((x, y) => x.at - y.at);
    let at = from;
    for (const it of items) {
      if (it.at > at) into.append(document.createTextNode(b.text.slice(at, it.at)));
      if (it.token !== undefined) into.append(this.token(b, it.token));
      else if (it.text) into.append(document.createTextNode(it.text));
      at = it.end;
    }
    if (at < to) into.append(document.createTextNode(b.text.slice(at, to)));
  }

  private token(b: ViewBlock, i: number): HTMLElement {
    const t = b.tokens[i];
    const span = document.createElement('span');
    span.className = `cv-tok cv-${t.kind}`;
    span.dataset.t = String(i);
    if (!this.ro) span.tabIndex = 0;
    if (t.swatch !== undefined) {
      const sw = document.createElement('span');
      sw.className = 'cv-swatch';
      if (t.swatch.startsWith('#')) sw.style.setProperty('--cv-swatch', t.swatch);
      else sw.classList.add(`cv-swatch--${t.swatch}`);
      span.append(sw);
    }
    span.append(document.createTextNode(b.text.slice(t.start, t.end)));
    return span;
  }

  private locate(target: EventTarget | null): { block: ViewBlock; blockEl: HTMLElement; token: ViewToken | null; span: HTMLElement | null } | null {
    const node = target instanceof Element ? target : null;
    const blockEl = node?.closest<HTMLElement>('.cv-block');
    if (!blockEl || !this.root.contains(blockEl)) return null;
    const entry = this.blocks.get(blockEl.dataset.key!);
    if (!entry) return null;
    const span = node!.closest<HTMLElement>('.cv-tok');
    return { block: entry.data, blockEl, span, token: span ? entry.data.tokens[Number(span.dataset.t)] ?? null : null };
  }

  // The block shown before or after this one (the tidy view hides whitespace between elements).
  private shown(el: Element, next: boolean): Element | null {
    let e: Element | null = el;
    do e = next ? e.nextElementSibling : e.previousElementSibling;
    while (e && e.classList.contains('cv-gone'));
    return e;
  }

  /** The token nearest a point, within NEAR px, in the block under it or its neighbours. */
  private nearest(x: number, y: number, blockEl: HTMLElement): { span: HTMLElement; token: ViewToken; block: ViewBlock } | null {
    let best: { span: HTMLElement; token: ViewToken; block: ViewBlock } | null = null;
    let bestD = NEAR;
    for (const el of [this.shown(blockEl, false), blockEl, this.shown(blockEl, true)]) {
      if (!(el instanceof HTMLElement)) continue;
      const entry = this.blocks.get(el.dataset.key ?? '');
      if (!entry) continue;
      for (const span of el.querySelectorAll<HTMLElement>('.cv-tok')) {
        // A token that wraps has a box on each line: the distance is to the nearest of those, not
        // to the one box around them all (which spans whole lines of other text).
        for (const r of span.getClientRects()) {
          const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
          if (d < bestD) {
            bestD = d;
            best = { span, token: entry.data.tokens[Number(span.dataset.t)], block: entry.data };
          }
        }
      }
    }
    return best;
  }

  private keydown(e: KeyboardEvent): void {
    const key = KEYS[e.key];
    if (!key || this.ro || this.raw || e.altKey || e.ctrlKey || e.metaKey) return;
    const hit = this.locate(e.target);
    if (!hit?.token || !hit.span || e.target !== hit.span) return;
    if (key !== 'open' && hit.token.kind !== 'number') return; // the arrows step numbers; elsewhere they scroll
    e.preventDefault();
    this.h.key(hit.block, hit.token, key);
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.taps.press(e.pointerId, e.clientX, e.clientY);
    const hit = this.locate(e.target);
    if (this.ro || !hit?.token || hit.token.kind !== 'number' || !hit.span) return;
    const g = new ScrubGesture();
    g.down(e.clientX, e.clientY);
    this.gesture = { g, block: hit.block, token: hit.token, span: hit.span, id: e.pointerId, last: null };
  }

  private move(e: PointerEvent): void {
    this.taps.move(e.pointerId, e.clientX, e.clientY);
    const s = this.gesture;
    if (!s || e.pointerId !== s.id) return;
    const wasScrubbing = s.g.scrubbing;
    const steps = s.g.move(e.clientX, e.clientY);
    if (steps === null) return;
    if (!wasScrubbing) {
      this.root.setPointerCapture(e.pointerId);
      s.span.classList.add('cv-active');
      this.root.classList.add('cv-scrubbing');
      this.h.scrubStart(s.block, s.token);
    }
    e.preventDefault();
    if (steps !== s.last) {
      s.last = steps;
      this.h.scrub(steps);
    }
  }

  private up(e: PointerEvent, cancelled: boolean): void {
    const tap = this.taps.lift(e.pointerId, e.clientX, e.clientY, cancelled);
    const s = this.gesture;
    if (s && e.pointerId === s.id) {
      this.gesture = null;
      s.span.classList.remove('cv-active');
      this.root.classList.remove('cv-scrubbing');
      const outcome = s.g.up(cancelled);
      if (outcome === 'scrub') this.h.scrubEnd(!cancelled);
      else if (outcome === 'tap' && tap) this.h.tap(s.block, s.token, s.span.getBoundingClientRect());
      return;
    }
    if (!tap) return;
    // A tap that did not start on a number token: a token (or the nearest one), else the block.
    const hit = this.locate(e.target);
    if (!hit) return;
    if (hit.token && hit.span) {
      this.h.tap(hit.block, hit.token, hit.span.getBoundingClientRect());
      return;
    }
    const near = this.nearest(e.clientX, e.clientY, hit.blockEl);
    if (near) this.h.tap(near.block, near.token, near.span.getBoundingClientRect());
    else this.h.blockTap(hit.block);
  }
}

function sameTokens(a: readonly ViewToken[], b: readonly ViewToken[]): boolean {
  return a.length === b.length && a.every((t, i) => t.start === b[i].start && t.end === b[i].end && t.kind === b[i].kind && t.swatch === b[i].swatch);
}
