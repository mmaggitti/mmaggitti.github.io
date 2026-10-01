// The code panel's source, as blocks: one per start tag, leaf and end tag, in document order, each
// holding exactly the text serialize(doc) emits for it and the tokens inside it. Concatenating every
// block's text gives serialize(doc) (tests hold that over the whole corpus).
//
// An edit changes one node's bytes: a token edit rewrites one attribute (one start tag) or one leaf,
// so the view re-reads that block with blockFor and patches it, rather than the whole document.
//
// The texts follow serialize's rules in model/doc.ts: a start tag nobody edited is its source
// slice, an edited one is rebuilt from its attributes (each re-emitted from its raw text, with its
// own whitespace and quote), and a leaf is its raw text. Keep the two in step.

import type { Doc, ElementNode, LeafNode, NodeId } from '../model/doc.ts';
import { tokenizeAttrRaw, tokenizeLeafRaw, type Token } from './tokens.ts';
import type { TokenTarget } from './edit.ts';

export interface BlockToken {
  start: number; // offsets in the block's text
  end: number;
  token: Token; // offsets in the attribute's or leaf's raw text: what edit.ts takes
  target: TokenTarget;
}

export interface Block {
  node: NodeId;
  part: 'start' | 'end' | 'leaf';
  text: string;
  tokens: BlockToken[];
}

/** Every block of the document, in order. */
export function codeBlocks(doc: Doc): Block[] {
  const out: Block[] = [];
  const emit = (id: NodeId): void => {
    const n = doc.nodes.get(id)!;
    if (n.kind !== 'element') {
      out.push(leafBlock(doc, n));
      return;
    }
    out.push(startBlock(doc, n));
    for (const c of n.children) emit(c);
    const end = endTag(doc, n);
    if (end !== null) out.push({ node: id, part: 'end', text: end, tokens: [] });
  };
  for (const id of doc.prolog) emit(id);
  emit(doc.root);
  for (const id of doc.epilog) emit(id);
  return out;
}

/** The blocks of one node and everything under it, in order (a node placed or moved alone). */
export function blocksOf(doc: Doc, nodeId: NodeId): Block[] {
  const out: Block[] = [];
  const emit = (id: NodeId): void => {
    const n = doc.nodes.get(id)!;
    if (n.kind !== 'element') {
      out.push(leafBlock(doc, n));
      return;
    }
    out.push(startBlock(doc, n));
    for (const c of n.children) emit(c);
    const end = endTag(doc, n);
    if (end !== null) out.push({ node: id, part: 'end', text: end, tokens: [] });
  };
  emit(nodeId);
  return out;
}

/** An element's end-tag block, or null when it closes itself (a self-closing tag that is still empty). */
export function endBlockFor(doc: Doc, nodeId: NodeId): Block | null {
  const n = doc.nodes.get(nodeId);
  if (!n || n.kind !== 'element') return null;
  const end = endTag(doc, n);
  return end === null ? null : { node: nodeId, part: 'end', text: end, tokens: [] };
}

/**
 * One node's block after an edit: an element's start tag (the only part of it a token edit
 * changes; its end tag never has tokens), or a leaf.
 */
export function blockFor(doc: Doc, nodeId: NodeId): Block {
  const n = doc.nodes.get(nodeId);
  if (!n) throw new Error(`blockFor: no node ${nodeId}`);
  return n.kind === 'element' ? startBlock(doc, n) : leafBlock(doc, n);
}

const closesSelf = (n: ElementNode): boolean => n.selfClosing && n.children.length === 0;

function startTag(doc: Doc, n: ElementNode): string {
  const self = closesSelf(n);
  if (!n.tagDirty && n.src && n.selfClosing === self) return doc.source.slice(n.src.tag.start, n.src.tag.end);
  let s = `<${n.qname}`;
  for (const a of n.attrs) s += `${a.lead}${a.qname}${a.eq}${a.quote}${a.raw}${a.quote}`;
  return s + n.tail + (self ? '/>' : '>');
}

function endTag(doc: Doc, n: ElementNode): string | null {
  if (closesSelf(n)) return null;
  return n.src?.endTag && !n.selfClosing ? doc.source.slice(n.src.endTag.start, n.src.endTag.end) : `</${n.qname}${n.endTail}>`;
}

function startBlock(doc: Doc, n: ElementNode): Block {
  const text = startTag(doc, n);
  const tokens: BlockToken[] = [];
  const seen = new Set<string>();
  let pos = 1 + n.qname.length;
  for (const a of n.attrs) {
    pos += a.lead.length + a.qname.length + a.eq.length + 1;
    // An attribute written twice is never the one an edit reaches (the parser refuses such a file, as
    // browsers do, but a document built in code may still hold one).
    const key = `${a.ns ?? ''}\n${a.local}`;
    if (!seen.has(key) && text.startsWith(a.raw, pos)) {
      const target: TokenTarget = { attr: { ns: a.ns, local: a.local } };
      for (const t of tokenizeAttrRaw(doc, n, a, a.raw)) tokens.push({ start: pos + t.start, end: pos + t.end, token: t, target });
    }
    seen.add(key);
    pos += a.raw.length + 1;
  }
  return { node: n.id, part: 'start', text, tokens };
}

function leafBlock(doc: Doc, n: LeafNode): Block {
  const text = n.src && !n.dirty ? doc.source.slice(n.src.start, n.src.end) : n.raw;
  const tokens: BlockToken[] = [];
  if (text === n.raw && (n.kind === 'text' || n.kind === 'cdata' || n.kind === 'comment')) {
    const target: TokenTarget = { text: true };
    for (const t of tokenizeLeafRaw(doc, n, n.raw)) tokens.push({ start: t.start, end: t.end, token: t, target });
  }
  return { node: n.id, part: 'leaf', text, tokens };
}
