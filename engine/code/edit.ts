// Token edits: the code panel's one way to change a value. An edit replaces exactly one token's
// characters in its raw text (an attribute's raw value, or a text or CDATA leaf's raw text) and
// leaves every other byte of the document as it was.
//
// - The new text is checked against the token's kind first: a number token takes only a number, a
//   colour token a colour (or one of its keywords), an enum token one of its options, a reference
//   an id. Text is escaped for where it lands (&, < and the attribute's quote). A character XML
//   can't hold at all (a control character, U+FFFE, a lone surrogate) is refused in any token.
// - For every kind but text, the edited value is then read again: it must hold the same tokens in
//   the same order, with only this one's text changed. A number glued to its neighbour ('1-2',
//   '0.5.5') may need a space to stay apart; the space goes inside the replaced span, so bytes
//   outside the token still never change. What no space can keep apart is refused. So a token's
//   index within its attribute or leaf survives the edit, and a scrub can keep hold of it.

import { el, findAttr, setAttrRaw, setLeafRaw, type Doc, type NodeId } from '../model/doc.ts';
import { escape } from '../xml/entities.ts';
import { fmt } from '../values/number-format.ts';
import { parseColor } from '../values/color.ts';
import { tokenizeAttrRaw, tokenizeLeafRaw, tokenizeText, type AttrRef, type NumberToken, type Token } from './tokens.ts';

/** Where a token lives: an attribute of an element, or the raw text of a text or CDATA leaf. */
export type TokenTarget = { attr: AttrRef } | { text: true };

export class TokenEditError extends Error {}

const NUMBER = /^-?(?:\d+|\d*\.\d+)$/; // plain decimal: no exponent, no leading '+'
// A character outside XML 1.0's Char: no escape can write one (&#1; is refused too), so a browser
// would refuse the whole file.
const NOT_XML_CHAR = /[^\t\n\r\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
const ID = /^[A-Za-z_À-￿][\w.\-·À-￿]*$/;

/** Why `text` can't replace this token, or null when it can. */
export function tokenTextError(token: Token, text: string): string | null {
  const bad = NOT_XML_CHAR.exec(text);
  if (bad) return `XML can't hold the character U+${bad[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
  switch (token.kind) {
    case 'number': {
      if (!NUMBER.test(text)) return `${JSON.stringify(text)} is not a number`;
      const v = Number(text);
      if (token.min !== undefined && v < token.min) return `${text} is below the minimum, ${token.min}`;
      if (token.max !== undefined && v > token.max) return `${text} is above the maximum, ${token.max}`;
      return null;
    }
    case 'color':
      if (text !== text.trim() || text === '') return `${JSON.stringify(text)} is not a colour`;
      return token.keywords.includes(text.toLowerCase()) || parseColor(text) ? null : `${JSON.stringify(text)} is not a colour`;
    case 'enum':
      return token.options.includes(text) ? null : `${JSON.stringify(text)} is not one of ${token.options.join(', ')}`;
    case 'ref':
      return ID.test(text) ? null : `${JSON.stringify(text)} is not an id`;
    case 'text':
      return null;
  }
}

/** Decimal places in a step or delta as fmt would write it ('0.15' → 2), at most 10. */
function placesOf(x: number): number {
  const s = fmt(Math.abs(x), 10);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * A number token's text moved by `delta`: written with fmt (no exponent, no '-0') at the token's
 * own precision, or finer when the step or the delta needs it, and clamped to its min and max.
 */
export function scrubNumber(token: NumberToken, delta: number): string {
  if (!Number.isFinite(delta)) throw new RangeError('scrubNumber: delta must be finite');
  const places = Math.min(20, Math.max(token.decimals, token.step === undefined ? 0 : placesOf(token.step), placesOf(delta)));
  let v = token.value + delta;
  if (token.min !== undefined) v = Math.max(v, token.min);
  if (token.max !== undefined) v = Math.min(v, token.max);
  return fmt(v, places);
}

interface Located {
  raw: string;
  quote: '"' | "'" | null; // the attribute's quote; null for leaf text
  cdata: boolean;
  key: string; // which attribute or leaf, for the memo below
  retokenize: (raw: string) => Token[];
}

// The tokens of the value the last applied edit wrote. A scrub edits the same value frame after
// frame, and reading a long path twice per frame (before and after) is the whole cost of an edit.
// Any other edit bumps doc.version, which retires it.
let memo: { doc: Doc; version: number; key: string; raw: string; tokens: Token[] } | null = null;

function tokensOf(doc: Doc, at: Located): Token[] {
  if (memo && memo.doc === doc && memo.version === doc.version && memo.key === at.key && memo.raw === at.raw) return memo.tokens;
  return at.retokenize(at.raw);
}

function locate(doc: Doc, nodeId: NodeId, target: TokenTarget): Located {
  if ('attr' in target) {
    const node = el(doc, nodeId);
    const a = findAttr(node, target.attr.ns, target.attr.local);
    if (!a) throw new TokenEditError(`<${node.qname}> has no ${target.attr.local} attribute`);
    const key = `${nodeId} ${target.attr.ns ?? ''} ${target.attr.local}`;
    return { raw: a.raw, quote: a.quote, cdata: false, key, retokenize: (raw) => tokenizeAttrRaw(doc, node, target.attr, raw) };
  }
  const n = doc.nodes.get(nodeId);
  if (!n || (n.kind !== 'text' && n.kind !== 'cdata')) throw new TokenEditError(`node ${nodeId} is not a text or CDATA leaf`);
  return { raw: n.raw, quote: null, cdata: n.kind === 'cdata', key: `${nodeId}`, retokenize: (raw) => tokenizeLeafRaw(doc, n, raw) };
}

const SEPARATORS: readonly [string, string][] = [
  ['', ''],
  [' ', ''],
  ['', ' '],
  [' ', ' '],
];

interface Spliced {
  raw: string;
  start: number; // where the token's new text starts in raw
  text: string; // the token's new text, escaped
  tokens: Token[] | null; // the tokens raw reads as (null for a text edit, which isn't re-read)
  key: string;
}

/** The new raw text, and where the token's new text starts in it. Throws TokenEditError. */
function splice(doc: Doc, nodeId: NodeId, target: TokenTarget, token: Token, newText: string): Spliced {
  const at = locate(doc, nodeId, target);
  const { raw } = at;
  if (raw.slice(token.start, token.end) !== token.text) throw new TokenEditError('the token is stale: its text is no longer where it was');
  const why = tokenTextError(token, newText);
  if (why) throw new TokenEditError(why);
  if (at.cdata && newText.includes(']]>')) throw new TokenEditError("text in a CDATA section can't contain ]]>");
  const text = at.cdata ? newText : escape(newText, at.quote);
  const head = raw.slice(0, token.start);
  const tail = raw.slice(token.end);
  if (token.kind === 'text') return { raw: head + text + tail, start: token.start, text, tokens: null, key: at.key };

  const before = tokensOf(doc, at);
  const index = before.findIndex((t) => t.start === token.start && t.end === token.end && t.kind === token.kind);
  if (index === -1) throw new TokenEditError('the token is stale: its value no longer reads that way');
  for (const [lead, trail] of SEPARATORS) {
    const out = head + lead + text + trail + tail;
    const start = token.start + lead.length;
    const after = at.retokenize(out);
    if (sameShape(before, after, index, start, text, out.length - raw.length)) return { raw: out, start, text, tokens: after, key: at.key };
  }
  throw new TokenEditError(`${JSON.stringify(newText)} would change how the rest of the value reads`);
}

/** The same tokens in the same order, only `index` changed (to `text` at `start`). */
function sameShape(before: Token[], after: Token[], index: number, start: number, text: string, shift: number): boolean {
  if (after.length !== before.length) return false;
  for (let j = 0; j < before.length; j++) {
    const a = before[j];
    const b = after[j];
    if (a.kind !== b.kind || a.prop !== b.prop) return false;
    if (j === index) {
      if (b.start !== start || b.text !== text) return false;
      if (a.kind === 'number' && b.kind === 'number' && a.unit !== b.unit) return false;
    } else if (b.text !== a.text || b.start !== (j < index ? a.start : a.start + shift)) return false;
  }
  return true;
}

/**
 * The raw text after replacing `token` with `newText`: raw.slice(0, start) + escaped newText +
 * raw.slice(end), with a separating space inside that span only where a glued number needs one.
 * Throws TokenEditError for text of the wrong kind or a stale token.
 */
export function tokenEdit(doc: Doc, nodeId: NodeId, target: TokenTarget, token: Token, newText: string): string {
  return splice(doc, nodeId, target, token, newText).raw;
}

/**
 * Apply a token edit to the document (setAttrRaw, or setLeafRaw for text and CDATA), and
 * return the token as it now reads (null only for a text run the edit emptied or split).
 */
export function applyTokenEdit(doc: Doc, nodeId: NodeId, target: TokenTarget, token: Token, newText: string): Token | null {
  const { raw, start, text, tokens, key } = splice(doc, nodeId, target, token, newText);
  if ('attr' in target) setAttrRaw(doc, nodeId, target.attr.ns, target.attr.local, raw);
  else setLeafRaw(doc, nodeId, raw);
  if (tokens) memo = { doc, version: doc.version, key, raw, tokens };
  const after = tokens ?? tokenizeText(doc, nodeId);
  return after.find((t) => t.start === start && t.text === text && t.kind === token.kind) ?? null;
}
