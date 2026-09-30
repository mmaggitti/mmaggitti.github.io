// Concrete syntax tree over the lexer's tokens. Nodes keep their token (and so their source span);
// serializing a tree nobody edited is concatenation of source slices, byte for byte.

import { lex, type AttrTok, type LexError, type Tok } from './lex.ts';

export type StartTok = Extract<Tok, { kind: 'start' }>;
export type EndTok = Extract<Tok, { kind: 'end' }>;
export type LeafTok = Exclude<Tok, StartTok | EndTok>;

export interface CstElement {
  type: 'element';
  start: StartTok;
  end: EndTok | null; // null when self-closing
  children: CstNode[];
}
export interface CstLeaf {
  type: 'leaf';
  tok: LeafTok;
}
export type CstNode = CstElement | CstLeaf;

export interface Cst {
  source: string;
  prolog: CstLeaf[]; // XML declaration, comments, DOCTYPE, PIs and whitespace before the root
  root: CstElement;
  epilog: CstLeaf[]; // anything after the root
}

export interface Limits {
  maxBytes: number;
  maxNodes: number;
  maxDepth: number;
}
export const DEFAULT_LIMITS: Limits = { maxBytes: 20e6, maxNodes: 200_000, maxDepth: 256 };

export type ParseResult = { ok: true; cst: Cst } | { ok: false; error: LexError; before?: PartialCst };

/**
 * What parsed before a failure (see lex.ts's Before): the tree so far, its elements still open
 * included, and the attributes of a start tag the lexer stopped inside.
 */
export interface PartialCst {
  prolog: CstLeaf[];
  root: CstElement | null;
  epilog: CstLeaf[];
  attrs: AttrTok[];
}

export function parseCst(source: string, limits: Limits = DEFAULT_LIMITS): ParseResult {
  if (source.length > limits.maxBytes) return { ok: false, error: { at: 0, message: `file is larger than ${limits.maxBytes / 1e6} MB`, kind: 'limit' } };
  const lexed = lex(source);
  const prolog: CstLeaf[] = [];
  const epilog: CstLeaf[] = [];
  let root: CstElement | null = null;
  const stack: CstElement[] = [];
  let count = 0;
  const fail = (error: LexError, attrs: AttrTok[] = []): ParseResult => ({ ok: false, error, before: { prolog, root, epilog, attrs } });
  for (const tok of lexed.ok ? lexed.tokens : lexed.before.tokens) {
    if (++count > limits.maxNodes) return fail({ at: tok.start, message: `more than ${limits.maxNodes} nodes`, kind: 'limit' });
    if (tok.kind === 'start') {
      if (stack.length === 0 && root) return fail({ at: tok.start, message: 'a second root element' });
      if (!tok.selfClosing && stack.length + 1 > limits.maxDepth) return fail({ at: tok.start, message: `nesting deeper than ${limits.maxDepth}`, kind: 'limit' });
      const el: CstElement = { type: 'element', start: tok, end: null, children: [] };
      if (stack.length) stack[stack.length - 1].children.push(el);
      else root = el;
      if (!tok.selfClosing) stack.push(el);
      continue;
    }
    if (tok.kind === 'end') {
      const open = stack.at(-1);
      if (!open) return fail({ at: tok.start, message: `</${tok.name}> without a start tag` });
      if (open.start.name !== tok.name) return fail({ at: tok.start, message: `</${tok.name}> closes <${open.start.name}>` });
      stack.pop();
      open.end = tok;
      continue;
    }
    // A browser refuses a DOCTYPE anywhere but before the root, and an XML declaration anywhere but
    // the very start (after a BOM); a DOCTYPE in content would also bring its entities with it.
    if (tok.kind === 'doctype' && (stack.length || root)) {
      return fail({ at: tok.start, message: 'a DOCTYPE is allowed only before the root element' });
    }
    if (tok.kind === 'pi' && tok.target.toLowerCase() === 'xml' && tok.start !== (source.charCodeAt(0) === 0xfeff ? 1 : 0)) {
      return fail({ at: tok.start, message: 'the XML declaration is allowed only at the start of the document' });
    }
    const leaf: CstLeaf = { type: 'leaf', tok };
    if (stack.length) stack[stack.length - 1].children.push(leaf);
    else if (tok.kind === 'text' && stray(source, tok.start, tok.end) !== -1) {
      return fail({ at: stray(source, tok.start, tok.end), message: 'text outside the root element' });
    } else if (tok.kind === 'cdata') {
      return fail({ at: tok.start, message: 'CDATA outside the root element' });
    } else if (root) epilog.push(leaf);
    else prolog.push(leaf);
  }
  if (!lexed.ok) return fail(lexed.error, lexed.before.attrs);
  if (stack.length) return fail({ at: source.length, message: `<${stack[stack.length - 1].start.name}> is never closed` });
  if (!root) return fail({ at: 0, message: 'no root element' });
  return { ok: true, cst: { source, prolog, root, epilog } };
}

// Outside the root only XML's own whitespace may stand (a browser refuses a form feed or a no-break
// space there), and a byte order mark only as the very first character.
const STRAY = /[^ \t\r\n]/;
function stray(source: string, start: number, end: number): number {
  const from = start === 0 && source.charCodeAt(0) === 0xfeff ? 1 : start;
  const k = source.slice(from, end).search(STRAY);
  return k === -1 ? -1 : from + k;
}

/** Text of an untouched CST: the source itself (asserted equal by the round-trip tests). */
export function serializeCst(cst: Cst): string {
  let out = '';
  for (const l of cst.prolog) out += cst.source.slice(l.tok.start, l.tok.end);
  out += cst.source.slice(cst.root.start.start, (cst.root.end ?? cst.root.start).end);
  for (const l of cst.epilog) out += cst.source.slice(l.tok.start, l.tok.end);
  return out;
}
