// Concrete syntax tree over the lexer's tokens. Nodes keep their token (and so their source span);
// serializing a tree nobody edited is concatenation of source slices, byte for byte.

import { lex, type LexError, type Tok } from './lex.ts';

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

export type ParseResult = { ok: true; cst: Cst } | { ok: false; error: LexError };

export function parseCst(source: string, limits: Limits = DEFAULT_LIMITS): ParseResult {
  if (source.length > limits.maxBytes) return { ok: false, error: { at: 0, message: `file is larger than ${limits.maxBytes / 1e6} MB` } };
  const lexed = lex(source);
  if (!lexed.ok) return lexed;
  const prolog: CstLeaf[] = [];
  const epilog: CstLeaf[] = [];
  let root: CstElement | null = null;
  const stack: CstElement[] = [];
  let count = 0;
  for (const tok of lexed.tokens) {
    if (++count > limits.maxNodes) return { ok: false, error: { at: tok.start, message: `more than ${limits.maxNodes} nodes` } };
    if (tok.kind === 'start') {
      const el: CstElement = { type: 'element', start: tok, end: null, children: [] };
      if (stack.length) stack[stack.length - 1].children.push(el);
      else if (root) return { ok: false, error: { at: tok.start, message: 'a second root element' } };
      else root = el;
      if (!tok.selfClosing) {
        if (stack.length + 1 > limits.maxDepth) return { ok: false, error: { at: tok.start, message: `nesting deeper than ${limits.maxDepth}` } };
        stack.push(el);
      }
      continue;
    }
    if (tok.kind === 'end') {
      const open = stack.pop();
      if (!open) return { ok: false, error: { at: tok.start, message: `</${tok.name}> without a start tag` } };
      if (open.start.name !== tok.name) return { ok: false, error: { at: tok.start, message: `</${tok.name}> closes <${open.start.name}>` } };
      open.end = tok;
      continue;
    }
    const leaf: CstLeaf = { type: 'leaf', tok };
    if (stack.length) stack[stack.length - 1].children.push(leaf);
    else if (tok.kind === 'text' && /\S/.test(source.slice(tok.start, tok.end))) {
      return { ok: false, error: { at: tok.start, message: 'text outside the root element' } };
    } else if (tok.kind === 'cdata') {
      return { ok: false, error: { at: tok.start, message: 'CDATA outside the root element' } };
    } else if (root) epilog.push(leaf);
    else prolog.push(leaf);
  }
  if (stack.length) return { ok: false, error: { at: source.length, message: `<${stack[stack.length - 1].start.name}> is never closed` } };
  if (!root) return { ok: false, error: { at: 0, message: 'no root element' } };
  return { ok: true, cst: { source, prolog, root, epilog } };
}

/** Text of an untouched CST: the source itself (asserted equal by the round-trip tests). */
export function serializeCst(cst: Cst): string {
  let out = '';
  for (const l of cst.prolog) out += cst.source.slice(l.tok.start, l.tok.end);
  out += cst.source.slice(cst.root.start.start, (cst.root.end ?? cst.root.start).end);
  for (const l of cst.epilog) out += cst.source.slice(l.tok.start, l.tok.end);
  return out;
}
