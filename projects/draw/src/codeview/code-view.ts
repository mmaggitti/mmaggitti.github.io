// The code panel: the document's real source, with every number, colour, keyword and text run a
// token. Framework-free: one DOM block per document node, so an edit patches one block, never the
// whole listing, and a scrub never goes through React.
//
// Its text is the source as text (textContent), never markup, so nothing here can make document
// content live; that is the sink's job alone (tools/check-sinks.mjs allows this folder to create
// its own spans).
//
// Tokens are smaller than a 44pt tap target, so a tap near a token takes the nearest one (within
// NEAR px). A number token scrubs by dragging sideways (scrub.ts); a vertical drag scrolls. Only a
// finger that stayed put, alone, is a tap (Taps): a swipe or a pinch over the code edits nothing.

import { ScrubGesture, Taps } from './scrub.ts';

export type TokenKind = 'number' | 'color' | 'enum' | 'text' | 'ref';

export interface ViewToken {
  start: number; // offsets in the block's text
  end: number;
  kind: TokenKind;
}

export interface ViewBlock {
  key: string; // stable across edits (the node's id and part: 'n12:start')
  node: number; // the NodeId it shows
  text: string;
  tokens: ViewToken[];
}

/** A token by its block's key and its index among the block's tokens (which an edit keeps). */
export interface FocusMark {
  key: string;
  index: number;
}

export interface CodeViewHandlers {
  /** A tap on (or near) a token: open its sheet, or cycle an enum. */
  tap(block: ViewBlock, token: ViewToken, anchor: DOMRect): void;
  /** A tap on a block's plain text: select that node. */
  blockTap(block: ViewBlock): void;
  scrubStart(block: ViewBlock, token: ViewToken): void;
  scrub(steps: number): void;
  scrubEnd(committed: boolean): void;
}

export const NEAR = 22; // px: half of a 44pt target

export class CodeView {
  private root: HTMLElement;
  private h: CodeViewHandlers;
  private blocks = new Map<string, { data: ViewBlock; el: HTMLElement }>();
  private order: string[] = [];
  private gesture: { g: ScrubGesture; block: ViewBlock; token: ViewToken; span: HTMLElement; id: number; last: number | null } | null = null;
  private taps = new Taps();
  private focused: FocusMark | null = null;
  private off: Array<() => void> = [];

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
  }

  /** Replace the whole listing (a new document). */
  set(blocks: readonly ViewBlock[]): void {
    this.root.replaceChildren();
    this.blocks.clear();
    this.order = [];
    for (const b of blocks) {
      const el = this.build(b);
      this.root.append(el);
      this.blocks.set(b.key, { data: b, el });
      this.order.push(b.key);
    }
    this.markFocus();
  }

  /**
   * Replace one block after an edit; nothing else in the listing is touched. The changed block
   * flashes (not under reduced motion: ds.css stops animations), and a token being scrubbed stays
   * marked in its new block.
   */
  patch(b: ViewBlock): void {
    const cur = this.blocks.get(b.key);
    if (!cur) return;
    if (cur.data.text === b.text && sameTokens(cur.data.tokens, b.tokens)) return;
    const el = this.build(b);
    if (cur.el.classList.contains('cv-selected')) el.classList.add('cv-selected');
    el.classList.add('cv-flash');
    const g = this.gesture;
    if (g && g.block.key === b.key) {
      const span = el.querySelector<HTMLElement>(`.cv-tok[data-t="${g.span.dataset.t}"]`);
      if (span) {
        if (g.span.classList.contains('cv-active')) span.classList.add('cv-active');
        g.span = span;
      }
    }
    cur.el.replaceWith(el);
    this.blocks.set(b.key, { data: b, el });
    if (this.focused?.key === b.key) this.markFocus();
  }

  /** Mark the blocks of the selected nodes, and bring the first into view. */
  select(nodes: ReadonlySet<number>): void {
    let first: HTMLElement | null = null;
    for (const key of this.order) {
      const { data, el } = this.blocks.get(key)!;
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

  private markFocus(): void {
    const m = this.focused;
    if (m) this.blocks.get(m.key)?.el.querySelector(`.cv-tok[data-t="${m.index}"]`)?.classList.add('cv-focus');
  }

  destroy(): void {
    for (const f of this.off) f();
    this.root.replaceChildren();
  }

  private build(b: ViewBlock): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cv-block';
    el.dataset.key = b.key;
    let at = 0;
    b.tokens.forEach((t, i) => {
      if (t.start > at) el.append(document.createTextNode(b.text.slice(at, t.start)));
      const span = document.createElement('span');
      span.className = `cv-tok cv-${t.kind}`;
      span.dataset.t = String(i);
      span.textContent = b.text.slice(t.start, t.end);
      el.append(span);
      at = t.end;
    });
    if (at < b.text.length) el.append(document.createTextNode(b.text.slice(at)));
    return el;
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

  /** The token nearest a point, within NEAR px, in the block under it or its neighbours. */
  private nearest(x: number, y: number, blockEl: HTMLElement): { span: HTMLElement; token: ViewToken; block: ViewBlock } | null {
    let best: { span: HTMLElement; token: ViewToken; block: ViewBlock } | null = null;
    let bestD = NEAR;
    for (const el of [blockEl.previousElementSibling, blockEl, blockEl.nextElementSibling]) {
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

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.taps.press(e.pointerId, e.clientX, e.clientY);
    const hit = this.locate(e.target);
    if (!hit?.token || hit.token.kind !== 'number' || !hit.span) return;
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
  return a.length === b.length && a.every((t, i) => t.start === b[i].start && t.end === b[i].end && t.kind === b[i].kind);
}
