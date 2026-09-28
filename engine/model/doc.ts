// The document: a tree over the lossless CST with stable NodeIds.
//
// - A NodeId is a session-unique integer. It is never an array index and never serialized, so
//   selection, history, code blocks and layer rows keep pointing at the same node through reorder,
//   delete and undo (SVG Lab keyed everything by array index, which shifted under every edit).
// - Namespaces resolve by URI, never by prefix: `q:href` bound to XLink is an href.
// - Serializing copies the source slice of every untouched subtree. An edited start tag is rebuilt
//   from its attributes, and an untouched attribute is re-emitted from its raw text with its own
//   quote and whitespace, so one edit changes exactly that attribute's bytes.

import type { Quote } from '../xml/lex.ts';
import { parseCst, DEFAULT_LIMITS, type CstElement, type CstNode, type Limits, type LeafTok } from '../xml/cst.ts';
import { decode, escape, readEntityTable, newBudget, type Budget, type EntityTable } from '../xml/entities.ts';

export type NodeId = number;

export const NS = {
  svg: 'http://www.w3.org/2000/svg',
  xlink: 'http://www.w3.org/1999/xlink',
  xhtml: 'http://www.w3.org/1999/xhtml',
  xml: 'http://www.w3.org/XML/1998/namespace',
  xmlns: 'http://www.w3.org/2000/xmlns/',
} as const;

export interface Attr {
  qname: string; // as written, e.g. 'xlink:href'
  prefix: string | null;
  local: string;
  ns: string | null; // resolved namespace URI; null = no namespace
  lead: string; // whitespace before the name
  eq: string; // '=' with any whitespace around it
  quote: Quote;
  raw: string; // escaped value text, exactly as it will be written
}

interface Span {
  start: number;
  end: number;
}

export interface ElementNode {
  kind: 'element';
  id: NodeId;
  parent: NodeId | null;
  qname: string;
  prefix: string | null;
  local: string;
  ns: string | null;
  attrs: Attr[];
  children: NodeId[];
  selfClosing: boolean; // as written; an emptied element keeps its form
  tail: string; // whitespace before '>' or '/>'
  endTail: string; // whitespace before the end tag's '>'
  src: { tag: Span; whole: Span; endTag: Span | null } | null; // null for nodes created by edits
  tagDirty: boolean; // start tag must be rebuilt
  childrenDirty: boolean; // child list changed (insert, remove, reorder)
}

export type LeafKind = 'text' | 'comment' | 'cdata' | 'pi' | 'doctype';
export interface LeafNode {
  kind: LeafKind;
  id: NodeId;
  parent: NodeId | null;
  raw: string; // exact text, including delimiters for comments, CDATA, PIs and the DOCTYPE
  src: Span | null;
  dirty: boolean;
}

export type Node = ElementNode | LeafNode;

export interface Doc {
  source: string;
  nodes: Map<NodeId, Node>;
  root: NodeId;
  prolog: NodeId[];
  epilog: NodeId[];
  entities: EntityTable;
  budget: Budget; // one entity-expansion budget per document
  version: number; // bumped by every edit
}

let nextId = 1;
const newId = (): NodeId => nextId++;

export type BuildResult = { ok: true; doc: Doc } | { ok: false; error: { at: number; message: string } };

export function parseDoc(source: string, limits: Limits = DEFAULT_LIMITS): BuildResult {
  const parsed = parseCst(source, limits);
  if (!parsed.ok) return parsed;
  const { cst } = parsed;
  const nodes = new Map<NodeId, Node>();
  const doctype = cst.prolog.find((l) => l.tok.kind === 'doctype');
  const entities = readEntityTable(doctype && doctype.tok.kind === 'doctype' ? doctype.tok.subset : null);
  const doc: Doc = { source, nodes, root: 0, prolog: [], epilog: [], entities, budget: newBudget(), version: 0 };

  const leaf = (tok: LeafTok, parent: NodeId | null): NodeId => {
    const id = newId();
    nodes.set(id, { kind: tok.kind, id, parent, raw: source.slice(tok.start, tok.end), src: { start: tok.start, end: tok.end }, dirty: false });
    return id;
  };

  const element = (el: CstElement, parent: NodeId | null, scope: Map<string, string | null>): NodeId => {
    const id = newId();
    // namespace declarations on this element apply to its own name and attributes
    let map = scope;
    for (const a of el.start.attrs) {
      if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) {
        if (map === scope) map = new Map(scope);
        map.set(a.name === 'xmlns' ? '' : a.name.slice(6), decode(a.raw, entities, doc.budget) || null);
      }
    }
    const [prefix, local] = splitName(el.start.name);
    const attrs: Attr[] = el.start.attrs.map((a) => {
      const [ap, al] = splitName(a.name);
      const ns = a.name === 'xmlns' || ap === 'xmlns' ? NS.xmlns : ap === 'xml' ? NS.xml : ap ? map.get(ap) ?? null : null;
      return { qname: a.name, prefix: ap, local: al, ns, lead: a.lead, eq: a.eq, quote: a.quote, raw: a.raw };
    });
    const whole = { start: el.start.start, end: (el.end ?? el.start).end };
    const node: ElementNode = {
      kind: 'element',
      id,
      parent,
      qname: el.start.name,
      prefix,
      local,
      ns: prefix === 'xml' ? NS.xml : map.get(prefix ?? '') ?? null,
      attrs,
      children: [],
      selfClosing: el.start.selfClosing,
      tail: el.start.tail,
      endTail: el.end?.tail ?? '',
      src: { tag: { start: el.start.start, end: el.start.end }, whole, endTag: el.end ? { start: el.end.start, end: el.end.end } : null },
      tagDirty: false,
      childrenDirty: false,
    };
    nodes.set(id, node);
    node.children = el.children.map((c: CstNode) => (c.type === 'element' ? element(c, id, map) : leaf(c.tok, id)));
    return id;
  };

  doc.prolog = cst.prolog.map((l) => leaf(l.tok, null));
  doc.root = element(cst.root, null, new Map([['', null]]));
  doc.epilog = cst.epilog.map((l) => leaf(l.tok, null));
  return { ok: true, doc };
}

export function splitName(name: string): [string | null, string] {
  const c = name.indexOf(':');
  return c === -1 ? [null, name] : [name.slice(0, c), name.slice(c + 1)];
}

// ── reading ──────────────────────────────────────────────────────────────────────────────────────

export function el(doc: Doc, id: NodeId): ElementNode {
  const n = doc.nodes.get(id);
  if (!n || n.kind !== 'element') throw new Error(`node ${id} is not an element`);
  return n;
}

/** Find an attribute by namespace URI and local name (`null` = no namespace). */
export function findAttr(node: ElementNode, ns: string | null, local: string): Attr | undefined {
  return node.attrs.find((a) => a.ns === ns && a.local === local);
}

/** An attribute's value as a browser sees it (entities decoded, within the document's budget). */
export function attrValue(doc: Doc, node: ElementNode, ns: string | null, local: string): string | null {
  const a = findAttr(node, ns, local);
  return a ? decode(a.raw, doc.entities, doc.budget) : null;
}

/** href under any prefix bound to XLink, or the plain SVG 2 href. */
export function href(doc: Doc, node: ElementNode): string | null {
  return attrValue(doc, node, null, 'href') ?? attrValue(doc, node, NS.xlink, 'href');
}

export function* descendants(doc: Doc, id: NodeId): Generator<Node> {
  const n = doc.nodes.get(id);
  if (!n) return;
  yield n;
  if (n.kind === 'element') for (const c of n.children) yield* descendants(doc, c);
}

export function textContent(doc: Doc, id: NodeId): string {
  let out = '';
  for (const n of descendants(doc, id)) {
    if (n.kind === 'text') out += decode(n.raw, doc.entities, doc.budget);
    else if (n.kind === 'cdata') out += n.raw.slice(9, -3);
  }
  return out;
}

// ── editing primitives (the command layer records their inverses) ─────────────────────────────

/** Set an attribute's value (unescaped text). Keeps its position, quote and whitespace. */
export function setAttr(doc: Doc, id: NodeId, ns: string | null, local: string, value: string, qname?: string): void {
  const node = el(doc, id);
  const a = findAttr(node, ns, local);
  if (a) a.raw = escape(value, a.quote);
  else node.attrs.push({ qname: qname ?? local, prefix: qname ? splitName(qname)[0] : null, local, ns, lead: ' ', eq: '=', quote: '"', raw: escape(value, '"') });
  node.tagDirty = true;
  doc.version++;
}

export function removeAttr(doc: Doc, id: NodeId, ns: string | null, local: string): void {
  const node = el(doc, id);
  const i = node.attrs.findIndex((a) => a.ns === ns && a.local === local);
  if (i === -1) return;
  node.attrs.splice(i, 1);
  node.tagDirty = true;
  doc.version++;
}

// ── serializing ──────────────────────────────────────────────────────────────────────────────────

function clean(doc: Doc, id: NodeId, memo: Map<NodeId, boolean>): boolean {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  const n = doc.nodes.get(id)!;
  let ok: boolean;
  if (n.kind === 'element') ok = !!n.src && !n.tagDirty && !n.childrenDirty && n.children.every((c) => clean(doc, c, memo));
  else ok = !!n.src && !n.dirty;
  memo.set(id, ok);
  return ok;
}

export function serialize(doc: Doc): string {
  const memo = new Map<NodeId, boolean>();
  let out = '';
  const emit = (id: NodeId): void => {
    const n = doc.nodes.get(id)!;
    if (clean(doc, id, memo)) {
      out += n.kind === 'element' ? doc.source.slice(n.src!.whole.start, n.src!.whole.end) : doc.source.slice(n.src!.start, n.src!.end);
      return;
    }
    if (n.kind !== 'element') {
      out += n.raw;
      return;
    }
    const empty = n.children.length === 0;
    const closeSelf = n.selfClosing && empty;
    if (!n.tagDirty && n.src && n.selfClosing === closeSelf) out += doc.source.slice(n.src.tag.start, n.src.tag.end);
    else out += startTag(n, closeSelf);
    for (const c of n.children) emit(c);
    if (closeSelf) return;
    out += n.src?.endTag && !n.selfClosing ? doc.source.slice(n.src.endTag.start, n.src.endTag.end) : `</${n.qname}${n.endTail}>`;
  };
  for (const id of doc.prolog) emit(id);
  emit(doc.root);
  for (const id of doc.epilog) emit(id);
  return out;
}

function startTag(n: ElementNode, selfClose: boolean): string {
  let s = `<${n.qname}`;
  for (const a of n.attrs) s += `${a.lead}${a.qname}${a.eq}${a.quote}${a.raw}${a.quote}`;
  return s + n.tail + (selfClose ? '/>' : '>');
}
