// Lengths where geometry uses them: x, y, width, r… resolved in user units the way a browser
// resolves them for the element they are on.
//
// - Absolute units at 96 dpi; em against the element's own font size from the document (never the
//   app's: font sizes resolve down the tree from the initial 16); rem against the root font size of
//   the page the drawing is on (the app's, on Draw's canvas); % against the nearest viewport's
//   viewBox (else its size): its width for x-ish values, its height for y-ish ones and the
//   normalised diagonal √((w² + h²)/2) for the rest (r).
// - ex is the font's own x-height, which only the browser knows (Chromium gives 0.459em for its
//   default font where CSS's fallback is 0.5em), so ex geometry is unknown here: null.
// - Unknown is null, never a guess: a font size a <style> rule may set, rem without the page's
//   root size, % without a viewport.

import { attrValue, el, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { parseLength, toUserUnits } from '../values/length.ts';
import { fmt } from '../values/number-format.ts';
import { cssSets, inlineDecl } from './css.ts';

export type Axis = 'x' | 'y' | 'other';

export interface LengthCtx {
  axis: Axis;
  /** User units per em on this element, or null when unknown. */
  fontSize: number | null;
  /** User units per rem (the page's root font size), or null when unknown. */
  remPx: number | null;
  /** The nearest viewport's viewBox size (else its size), or null when unknown. */
  viewport: { w: number; h: number } | null;
}

/** The initial font size, and CSS's absolute size keywords at that size (as browsers have them). */
export const INITIAL_FONT_SIZE = 16;
const KEYWORDS: Readonly<Record<string, number>> = {
  'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48,
};

/** A length value in user units, or null (unknown, or not a length). */
export function resolveLength(raw: string, ctx: LengthCtx): number | null {
  const len = parseLength(raw);
  if (!len) return null;
  if (len.unit === 'ex') return null;
  if (len.unit === '%') {
    const v = ctx.viewport;
    if (!v) return null;
    const base = ctx.axis === 'x' ? v.w : ctx.axis === 'y' ? v.h : Math.sqrt((v.w * v.w + v.h * v.h) / 2);
    return toUserUnits(len, { percentBase: base });
  }
  const v = toUserUnits(len, { fontSize: ctx.fontSize ?? undefined, remPx: ctx.remPx ?? undefined });
  return v !== null && Number.isFinite(v) ? v : null;
}

// A number followed by rem: not inside a longer word or number (an id "a2rem", "1.2.3rem").
const REM = /(?<![\w.-])([+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?)rem\b/gi;

/** Does this value hold a rem length? */
export function hasRem(raw: string): boolean {
  REM.lastIndex = 0;
  return REM.test(raw);
}

/**
 * Every `<n>rem` in a value as user units (`fmt(n · rootFont, 4)`); every other byte kept. In CSS (a
 * style="" value, `css`) each is written in px, as CSS wants a unit on most lengths (width: 32 is
 * dropped by WebKit); an attribute takes the plain number.
 */
export function remToUserUnits(raw: string, rootFont: number, css = false): string {
  return raw.replace(REM, (_, n: string) => `${fmt(Number(n) * rootFont, 4)}${css ? 'px' : ''}`);
}

/** A font-size value in user units, given the parent's font size; null when unknown. */
function fontSizeValue(value: string, parent: number, remPx: number | null, css: boolean): number | null {
  const v = value.trim().toLowerCase();
  if (KEYWORDS[v] !== undefined) return KEYWORDS[v];
  const len = parseLength(v);
  if (!len || len.value < 0) return null;
  if (css && len.unit === '' && len.value !== 0) return null; // CSS wants a unit
  if (len.unit === 'em') return len.value * parent;
  if (len.unit === '%') return (len.value * parent) / 100;
  if (len.unit === 'ex') return null;
  if (len.unit === 'rem') return remPx === null ? null : len.value * remPx;
  return toUserUnits(len);
}

/**
 * The root's own font size, as the file has it alone: its `font-size` attribute or `style`
 * declaration (the declaration wins), resolved against the initial 16; else 16.
 */
export function rootFontSize(doc: Doc): number {
  const root = el(doc, doc.root);
  const inline = inlineDecl(doc, doc.root, 'font-size');
  const fromInline = inline === null ? null : fontSizeValue(inline, INITIAL_FONT_SIZE, INITIAL_FONT_SIZE, true);
  if (fromInline !== null) return fromInline;
  const attr = attrValue(doc, root, null, 'font-size');
  const fromAttr = attr === null ? null : fontSizeValue(attr, INITIAL_FONT_SIZE, INITIAL_FONT_SIZE, false);
  return fromAttr ?? INITIAL_FONT_SIZE;
}

/**
 * An element's font size in user units, from the document: its own `style` declaration, else its
 * `font-size` attribute, else its parent's (the root's parent is the initial 16). Null when a
 * `<style>` rule may set it on the element or on an ancestor it inherits from, or a value can't be
 * read (a `font` shorthand, ex, rem without the page's root size).
 */
export function fontSizeOf(doc: Doc, id: NodeId, remPx: number | null): number | null {
  const chain: ElementNode[] = [];
  for (let n: ElementNode | null = el(doc, id); n; n = n.parent === null ? null : (doc.nodes.get(n.parent) as ElementNode)) chain.unshift(n);
  let size = INITIAL_FONT_SIZE;
  for (const n of chain) {
    const set = cssSets(doc, n.id, 'font-size');
    if (set === 'sheet') return null;
    if (set === 'inline') {
      const decl = inlineDecl(doc, n.id, 'font-size');
      const v = decl === null ? null : fontSizeValue(decl, size, remPx, true);
      if (v === null) {
        if (inlineDecl(doc, n.id, 'font') !== null) return null; // the shorthand set it
      } else {
        size = v;
        continue;
      }
    }
    const attr = attrValue(doc, n, null, 'font-size');
    if (attr !== null) {
      const v = fontSizeValue(attr, size, remPx, false);
      if (v !== null) size = v;
    }
  }
  return size;
}
