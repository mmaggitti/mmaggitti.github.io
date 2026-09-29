// The tidy view: SVG Lab's pretty-print, as a way of SHOWING the code. It never changes the file:
// the code view is the document's real source, and "As written" shows its bytes exactly. Tidy
// swaps only whitespace for display (never a token, never a byte of a value that is not
// whitespace), and every tap and scrub still reaches the same token.
//
// SVG Lab's rules, over a real file's blocks:
// - every element starts on a line of its own, indented two spaces a level; the whitespace between
//   elements is replaced by that (a block's flow, from blocks.ts);
// - a start tag goes on one line when it fits the measured width; otherwise each attribute goes on
//   a line of its own, one level in, and a value that spans lines (path data, a transform list,
//   CSS) is indented under its attribute's value;
// - a long value that wraps keeps to its column (a hanging indent: the attribute is wrapped in an
//   inline block no wider than what is left of the line); the last one holds the tag's close too,
//   so a "/>" or ">" never drops to a line of its own;
// - a line break inside a tag's own syntax (around an attribute's "=", before an end tag's ">") is
//   taken out, so each attribute reads as one piece;
// - comments, and anything inside mixed content (text, <title>, <style>), stay as written.
// Pure, so node's test runner checks it; code-view.ts builds the spans from what it returns.

import type { ViewBlock } from './code-view.ts';

/** Show `text` instead of the block's characters [at, end): whitespace only. */
export interface Swap {
  at: number;
  end: number;
  text: string;
}

/** Wrap [at, end) in an inline block that starts `indent` columns into its line (a hanging indent). */
export interface Wrap {
  at: number;
  end: number;
  indent: number;
}

export interface Tidy {
  /** Before the block: a line break and its indentation ('' for the first line, null to follow on). */
  lead: string | null;
  swaps: Swap[];
  wraps: Wrap[];
}

export const INDENT = '  ';
export const MIN_COLS = 26; // SVG Lab's floor, so a narrow panel still lays out sensibly

/** Columns of monospace text that fit a width, as SVG Lab measures them (two left spare). */
export function columns(width: number, charWidth: number): number {
  return charWidth > 0 && width > 0 ? Math.max(MIN_COLS, Math.floor(width / charWidth) - 2) : 40;
}

// An attribute in a start tag's text: its lead whitespace, name, '=' and quoted value.
const ATTR = /([ \t\r\n]+)([^\s=/>]+)([ \t\r\n]*=[ \t\r\n]*)("[^"]*"|'[^']*')/y;
const NEWLINE_RUN = /[ \t]*(?:\r\n|\r|\n)[ \t\r\n]*/g;

interface Attr {
  lead: [number, number];
  at: number; // the name's first character
  name: string;
  valueAt: number; // inside the quote
  valueEnd: number;
  end: number; // after the closing quote
}

function attributes(text: string): { name: number; attrs: Attr[]; tail: [number, number] } | null {
  const m = /^<[^\s/>]+/.exec(text);
  if (!m) return null;
  const attrs: Attr[] = [];
  let pos = m[0].length;
  for (;;) {
    ATTR.lastIndex = pos;
    const a = ATTR.exec(text);
    if (!a) break;
    const at = pos + a[1].length;
    const valueAt = at + a[2].length + a[3].length + 1;
    attrs.push({ lead: [pos, at], at, name: a[2], valueAt, valueEnd: ATTR.lastIndex - 1, end: ATTR.lastIndex });
    pos = ATTR.lastIndex;
  }
  const close = text.endsWith('/>') ? 2 : 1;
  const tail: [number, number] = [pos, text.length - close];
  if (!/^[ \t\r\n]*$/.test(text.slice(tail[0], tail[1]))) return null; // not a start tag this reads
  return { name: m[0].length, attrs, tail };
}

const inToken = (b: ViewBlock, at: number, end: number) => b.tokens.some((t) => t.start < end && at < t.end);

/** Take out the line breaks (and the blank space around them) in text[from, to), which holds no token. */
function unbreak(text: string, from: number, to: number): Swap[] {
  return [...text.slice(from, to).matchAll(NEWLINE_RUN)].map((m) => ({ at: from + m.index, end: from + m.index + m[0].length, text: '' }));
}

/**
 * How one block shows in the tidy view at `cols` columns. `first`: the first block shown, which
 * needs no line break before it. A hidden block is never asked.
 */
export function tidy(b: ViewBlock, cols: number, first: boolean): Tidy {
  if (b.flow !== 'line') return { lead: null, swaps: [], wraps: [] };
  const indent = INDENT.repeat(b.depth);
  const lead = first ? '' : `\n${indent}`;
  const tag = b.part === 'start' ? attributes(b.text) : null;
  if (!tag) {
    // An end tag broken before its ">" ("</g\n  >") reads as one piece ("</g>").
    const end = b.part === 'end' ? /^<\/[^\s>]+/.exec(b.text) : null;
    return { lead, swaps: end ? unbreak(b.text, end[0].length, b.text.length - 1) : [], wraps: [] };
  }
  const { attrs, tail } = tag;
  const swaps: Swap[] = [];
  const wraps: Wrap[] = [];
  const tailSwap = (): void => {
    if (tail[1] > tail[0]) swaps.push({ at: tail[0], end: tail[1], text: '' });
  };
  if (!attrs.length) {
    tailSwap();
    return { lead, swaps, wraps };
  }
  const oneLine = tag.name + attrs.reduce((n, a) => n + 1 + (a.end - a.at), 0) + (b.text.length - tail[1]);
  const spansLines = attrs.some((a) => /[\r\n]/.test(b.text.slice(a.at, a.end)));
  if (!spansLines && (indent.length + oneLine <= cols || attrs.length === 1)) {
    // One line: a single space before each attribute. A single attribute too long for the line
    // (a long path) wraps under its own start.
    for (const a of attrs) if (b.text.slice(a.lead[0], a.lead[1]) !== ' ') swaps.push({ at: a.lead[0], end: a.lead[1], text: ' ' });
    tailSwap();
    if (indent.length + oneLine > cols) wraps.push({ at: attrs[0].at, end: b.text.length, indent: indent.length + tag.name + 1 });
    return { lead, swaps, wraps };
  }
  // One attribute a line, a level in; a value's own line breaks line up under its first character.
  const inner = indent + INDENT;
  for (const a of attrs) {
    swaps.push({ at: a.lead[0], end: a.lead[1], text: `\n${inner}` });
    swaps.push(...unbreak(b.text, a.at + a.name.length, a.valueAt - 1)); // "height=\n" reads "height="
    const value = b.text.slice(a.valueAt, a.valueEnd);
    const under = ' '.repeat(a.name.length + 2);
    for (const m of value.matchAll(NEWLINE_RUN)) {
      const at = a.valueAt + m.index;
      const end = at + m[0].length;
      if (!inToken(b, at, end)) swaps.push({ at, end, text: `\n${under}` });
    }
    wraps.push({ at: a.at, end: a === attrs[attrs.length - 1] ? b.text.length : a.end, indent: inner.length });
  }
  tailSwap();
  return { lead, swaps, wraps };
}

/**
 * What the tidy view shows for a block, as plain text (for the tests): a line break inside a wrapped
 * attribute starts at the wrap's column, as the inline block draws it.
 */
export function tidyText(b: ViewBlock, t: Tidy): string {
  let out = t.lead ?? '';
  let at = 0;
  for (const s of [...t.swaps].sort((x, y) => x.at - y.at)) {
    const wrap = t.wraps.find((w) => s.at >= w.at && s.end <= w.end);
    out += b.text.slice(at, s.at) + (wrap ? s.text.replace(/\n/g, `\n${' '.repeat(wrap.indent)}`) : s.text);
    at = s.end;
  }
  return out + b.text.slice(at);
}
