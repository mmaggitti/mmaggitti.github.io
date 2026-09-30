// The document: a tree over the lossless CST with stable NodeIds.
//
// - A NodeId is a session-unique integer. It is never an array index and never serialized, so
//   selection, history, code blocks and layer rows keep pointing at the same node through reorder,
//   delete and undo (SVG Lab keyed everything by array index, which shifted under every edit).
// - Namespaces resolve by URI, never by prefix: `q:href` bound to XLink is an href.
// - Serializing copies the source slice of every untouched subtree. An edited start tag is rebuilt
//   from its attributes, and an untouched attribute is re-emitted from its raw text with its own
//   quote and whitespace, so one edit changes exactly that attribute's bytes.
// - Every entity reference is expanded once while parsing, against one budget for the document, so
//   a file that expands too far, or into markup, fails to open instead of failing later. Markup
//   parsed into the document later (fragment.ts) spends from the same budget. Reads after that
//   each get their own budget: editing never drains it.
// - What a browser refuses here, parsing refuses too, at its place: a reference that isn't
//   well-formed (entities.ts), a prefix nobody declared, a namespace declaration XML forbids
//   (xmlns:p="", or the xml and xmlns prefixes and namespaces bound otherwise), and one attribute
//   written twice under two prefixes of one namespace.

import { clip, type AttrTok, type LexError, type Quote } from '../xml/lex.ts';
import { parseCst, DEFAULT_LIMITS, type CstElement, type CstLeaf, type CstNode, type Limits, type LeafTok } from '../xml/cst.ts';
import { decodeAttr, decodeText, escape, readEntityTable, newBudget, normalizeEol, wellFormedRefs, EntityBudgetError, EntityMarkupError, EntityWellFormednessError, type Budget, type EntityTable } from '../xml/entities.ts';

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
  budget: Budget; // the entity-expansion budget: spent while parsing, and by every fragment parsed in since
  version: number; // bumped by every edit
  /** Bumped only by an edit that can change what the document's <style> elements say: a text or CDATA
   *  leaf in one edited, or a <style> (or a leaf in one) coming or going. CSS readers key on it. */
  styleVersion: number;
}

let nextId = 1;
const newId = (): NodeId => nextId++;

/** A failure is not well-formed XML, or (kind 'limit') over Draw's limits: see LexError. */
export type BuildResult = { ok: true; doc: Doc } | { ok: false; error: LexError };

/** Parse a document; `budget` is the entity expansion it may spend (a fragment passes what its document has left). */
export function parseDoc(source: string, limits: Limits = DEFAULT_LIMITS, budget: Budget = newBudget()): BuildResult {
  const parsed = parseCst(source, limits);
  if (!parsed.ok) {
    // A browser stops at the first error. The lexer and the CST stop at theirs before the model's
    // checks (references, namespaces) run, so those run over what parsed before it: one found there
    // comes first.
    const first = parsed.before ? build(source, parsed.before, budget) : null;
    return first && !first.ok ? first : { ok: false, error: parsed.error };
  }
  return build(source, parsed.cst, budget);
}

/**
 * The model over a parsed tree: a whole document, or what parsed before a failure (the elements
 * still open, and the attributes a start tag had read when the lexer stopped inside it, which are
 * checked, not built).
 */
function build(source: string, cst: { prolog: CstLeaf[]; root: CstElement | null; epilog: CstLeaf[]; attrs?: AttrTok[] }, budget: Budget): BuildResult {
  const nodes = new Map<NodeId, Node>();
  const doctype = cst.prolog.find((l) => l.tok.kind === 'doctype')?.tok;
  const entities = doctype?.kind === 'doctype' ? readEntityTable(doctype.subset, publicId(source.slice(doctype.start, doctype.end))) : readEntityTable(null);
  const doc: Doc = { source, nodes, root: 0, prolog: [], epilog: [], entities, budget, version: 0, styleVersion: 0 };

  // Check every reference, then expand it once, now, against the document's budget (see the header).
  // `at` is where the raw text starts in the source.
  const check = (raw: string, at: number, attr: boolean): void => {
    if (!raw.includes('&')) return;
    const bad = wellFormedRefs(raw, entities, attr);
    if (bad) throw new ParseFail(at + bad.at, bad.message, bad.kind);
    try {
      if (attr) decodeAttr(raw, entities, doc.budget);
      else decodeText(raw, entities, doc.budget);
    } catch (e) {
      if (e instanceof EntityBudgetError || e instanceof EntityMarkupError || e instanceof EntityWellFormednessError) throw new ParseFail(at, e.message, e.kind);
      throw e;
    }
  };

  const leaf = (tok: LeafTok, parent: NodeId | null): NodeId => {
    if (tok.kind === 'text') check(source.slice(tok.start, tok.end), tok.start, false);
    const id = newId();
    nodes.set(id, { kind: tok.kind, id, parent, raw: source.slice(tok.start, tok.end), src: { start: tok.start, end: tok.end }, dirty: false });
    return id;
  };

  // An attribute's value, and a namespace declaration's own rules: the URI it declares, or undefined.
  const attribute = (a: AttrTok): string | undefined => {
    check(a.raw, valueAt(a), true);
    if (a.name !== 'xmlns' && !a.name.startsWith('xmlns:')) return undefined;
    const uri = decodeAttr(a.raw, entities);
    const bad = declarationError(a.name === 'xmlns' ? '' : a.name.slice(6), uri);
    if (bad) throw new ParseFail(a.at, bad);
    return uri;
  };

  // The namespace declarations in scope, in one map: an element sets its own on the way in and puts
  // back what they covered on the way out (a copy per declaring element was quadratic).
  const scope = new Map<string, string | null>([['', null]]);
  const element = (el: CstElement, parent: NodeId | null): NodeId => {
    const id = newId();
    const tag = el.start.name;
    // namespace declarations on this element apply to its own name and attributes
    const covered: [string, string | null | undefined][] = [];
    for (const a of el.start.attrs) {
      const uri = attribute(a);
      if (uri !== undefined) {
        const declared = a.name === 'xmlns' ? '' : a.name.slice(6);
        covered.push([declared, scope.get(declared)]);
        scope.set(declared, uri || null);
      }
    }
    const map = scope; // what is in scope here, this element's own declarations included
    const bound = (p: string): boolean => p === 'xml' || !!map.get(p);
    const [prefix, local] = splitName(tag);
    if (prefix !== null && !bound(prefix)) throw new ParseFail(el.start.start + 1, `the prefix ${clip(prefix)} of <${clip(tag)}> is not declared`);
    const seen = new Map<string, string>(); // namespace and local name → the name as first written
    const attrs: Attr[] = el.start.attrs.map((a) => {
      const [ap, al] = splitName(a.name);
      const declaration = a.name === 'xmlns' || ap === 'xmlns';
      if (!declaration && ap !== null && !bound(ap)) throw new ParseFail(a.at, `the prefix ${clip(ap)} of attribute ${clip(a.name)} is not declared`);
      const ns = declaration ? NS.xmlns : ap === 'xml' ? NS.xml : ap ? map.get(ap) ?? null : null;
      if (!declaration) {
        const key = `${ns ?? ''} ${al}`;
        const first = seen.get(key);
        // The same name twice is the lexer's to refuse; here, two names for one attribute.
        if (first !== undefined && first !== a.name) throw new ParseFail(a.at, `attributes ${clip(first)} and ${clip(a.name)} of <${clip(tag)}> are one attribute: their prefixes name the same namespace`);
        seen.set(key, a.name);
      }
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
    node.children = el.children.map((c: CstNode) => (c.type === 'element' ? element(c, id) : leaf(c.tok, id)));
    for (const [prefix, uri] of covered.reverse()) {
      if (uri === undefined) scope.delete(prefix);
      else scope.set(prefix, uri);
    }
    return id;
  };

  try {
    doc.prolog = cst.prolog.map((l) => leaf(l.tok, null));
    if (cst.root) doc.root = element(cst.root, null);
    doc.epilog = cst.epilog.map((l) => leaf(l.tok, null));
    for (const a of cst.attrs ?? []) attribute(a);
  } catch (e) {
    if (e instanceof ParseFail) return { ok: false, error: e.kind ? { at: e.at, message: e.message, kind: e.kind } : { at: e.at, message: e.message } };
    throw e;
  }
  return { ok: true, doc };
}

/** A failure while building: not well-formed, or (kind 'limit') over Draw's limits. */
class ParseFail extends Error {
  at: number;
  kind?: 'limit';
  constructor(at: number, message: string, kind?: 'limit') {
    super(message);
    this.at = at;
    this.kind = kind;
  }
}

/** The public identifier a DOCTYPE names (<!DOCTYPE svg PUBLIC "…" "…">), or null. */
function publicId(doctype: string): string | null {
  const m = /^<!DOCTYPE[ \t\r\n]+[^ \t\r\n[>]+[ \t\r\n]+PUBLIC[ \t\r\n]*(?:"([^"]*)"|'([^']*)')/.exec(doctype);
  return m ? m[1] ?? m[2] : null;
}

/** Where an attribute's value starts in the source: after its name, '=' (with any spaces) and the quote. */
const valueAt = (a: AttrTok): number => a.at + a.name.length + a.eq.length + 1;

/**
 * Why Namespaces in XML forbids this declaration (`prefix` '' is xmlns="…"), or null: a prefix
 * can't be undeclared (xmlns:p=""), xml is bound only to its own namespace and that namespace to no
 * other prefix, and neither the xmlns prefix nor its namespace can be declared at all.
 */
function declarationError(prefix: string, uri: string): string | null {
  if (prefix === 'xmlns') return 'the prefix xmlns is reserved: it can’t be declared';
  if (prefix === 'xml') return uri === NS.xml ? null : `the prefix xml is bound to ${NS.xml} only`;
  if (uri === NS.xml) return `only the prefix xml may name ${NS.xml}`;
  if (uri === NS.xmlns) return `no prefix may name ${NS.xmlns}`;
  if (prefix && !uri) return `xmlns:${clip(prefix)} is empty: a prefix can’t be undeclared`;
  return null;
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

/** An attribute's value as a browser sees it: normalized and decoded (see decodeAttr). */
export function attrValue(doc: Doc, node: ElementNode, ns: string | null, local: string): string | null {
  const a = findAttr(node, ns, local);
  return a ? decodeAttr(a.raw, doc.entities) : null;
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
    if (n.kind === 'text') out += decodeText(n.raw, doc.entities);
    else if (n.kind === 'cdata') out += normalizeEol(n.raw.slice(9, -3));
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

/**
 * Replace an existing attribute's raw (escaped) text. This is the byte-exact edit the code view
 * uses: a token edit rewrites only the token's characters, and entity references around it stay
 * as written. The raw text must be valid inside the attribute's own quotes.
 */
export function setAttrRaw(doc: Doc, id: NodeId, ns: string | null, local: string, raw: string): void {
  const node = el(doc, id);
  const a = findAttr(node, ns, local);
  if (!a) throw new Error(`setAttrRaw: <${node.qname}> has no ${local}`);
  if (raw.includes('<') || raw.includes(a.quote)) throw new Error(`setAttrRaw: raw text is not valid inside ${a.quote}…${a.quote}`);
  a.raw = raw;
  node.tagDirty = true;
  doc.version++;
}

/** The attribute exactly as written and its position, or null (for recording an inverse). */
export function attrSnapshot(doc: Doc, id: NodeId, ns: string | null, local: string): { index: number; attr: Attr } | null {
  const node = el(doc, id);
  const index = node.attrs.findIndex((a) => a.ns === ns && a.local === local);
  return index === -1 ? null : { index, attr: { ...node.attrs[index] } };
}

/** Put an attribute back exactly as written, at its position (undo of a remove or an add). */
export function restoreAttr(doc: Doc, id: NodeId, ns: string | null, local: string, snap: { index: number; attr: Attr } | null): void {
  const node = el(doc, id);
  const i = node.attrs.findIndex((a) => a.ns === ns && a.local === local);
  if (i !== -1) node.attrs.splice(i, 1);
  if (snap) node.attrs.splice(Math.min(snap.index, node.attrs.length), 0, { ...snap.attr });
  node.tagDirty = true;
  doc.version++;
}

/** Replace a text leaf's raw (escaped) text. */
export function setTextRaw(doc: Doc, id: NodeId, raw: string): void {
  const n = doc.nodes.get(id);
  if (!n || n.kind !== 'text') throw new Error(`setTextRaw: node ${id} is not text`);
  if (raw.includes('<')) throw new Error('setTextRaw: raw text may not contain <');
  n.raw = raw;
  n.dirty = true;
  doc.version++;
  if (inStyle(doc, n.parent)) doc.styleVersion++;
}

/** Is `raw` one well-formed XML comment: `<!--`, no `--` inside, not ending in `-`, `-->`? */
export function isOneComment(raw: string): boolean {
  if (!raw.startsWith('<!--') || !raw.endsWith('-->') || raw.length < 7) return false;
  const body = raw.slice(4, -3);
  return !body.includes('--') && !body.endsWith('-');
}

/**
 * Replace a text, CDATA or comment leaf's raw text (a CDATA leaf's and a comment's raw include their
 * delimiters). Illustrator and CorelDRAW put <style> in CDATA, so code tokens edit both kinds; a
 * donut's data comment (P1-M3) holds number tokens too, and its new raw must still be one
 * well-formed comment.
 */
export function setLeafRaw(doc: Doc, id: NodeId, raw: string): void {
  const n = doc.nodes.get(id);
  if (n?.kind === 'text') return setTextRaw(doc, id, raw);
  if (n?.kind === 'comment') {
    if (!isOneComment(raw)) throw new Error('setLeafRaw: raw text is not one well-formed comment');
    n.raw = raw;
    n.dirty = true;
    doc.version++;
    return;
  }
  if (!n || n.kind !== 'cdata') throw new Error(`setLeafRaw: node ${id} is not text or CDATA (or a comment)`);
  if (!raw.startsWith('<![CDATA[') || !raw.endsWith(']]>') || raw.length < 12 || raw.slice(9, -3).includes(']]>')) {
    throw new Error('setLeafRaw: raw text is not one CDATA section');
  }
  n.raw = raw;
  n.dirty = true;
  doc.version++;
  if (inStyle(doc, n.parent)) doc.styleVersion++;
}

/**
 * Detach a node from its parent; it stays in doc.nodes so it can be reinserted (undo). The node is
 * looked for from the end, so a batch taken away last first costs nothing per node (no search, and
 * nothing after it to shift).
 */
export function detachNode(doc: Doc, id: NodeId): { parent: NodeId; index: number } {
  const n = doc.nodes.get(id);
  if (!n || n.parent === null) throw new Error(`detachNode: node ${id} has no parent`);
  const parent = el(doc, n.parent);
  const index = parent.children.lastIndexOf(id);
  if (inStyle(doc, parent.id) || holdsStyle(doc, id)) doc.styleVersion++;
  parent.children.splice(index, 1);
  parent.childrenDirty = true;
  n.parent = null;
  doc.version++;
  return { parent: parent.id, index };
}

/** Insert a detached node (and its subtree) under a parent, at an index; returns the index it took. */
export function attachNode(doc: Doc, id: NodeId, parent: NodeId, index: number): number {
  const n = doc.nodes.get(id);
  if (!n || n.parent !== null) throw new Error(`attachNode: node ${id} is not detached`);
  const p = el(doc, parent);
  const at = Math.min(index, p.children.length);
  p.children.splice(at, 0, id);
  p.childrenDirty = true;
  n.parent = parent;
  doc.version++;
  if (inStyle(doc, parent) || holdsStyle(doc, id)) doc.styleVersion++;
  return at;
}

// Is `id` (an element, or null) a <style> or inside one?
function inStyle(doc: Doc, id: NodeId | null): boolean {
  for (let n = id === null ? undefined : doc.nodes.get(id); n; n = n.parent === null ? undefined : doc.nodes.get(n.parent)) {
    if (n.kind === 'element' && n.local === 'style') return true;
  }
  return false;
}

// Does the subtree at `id` hold a <style>?
function holdsStyle(doc: Doc, id: NodeId): boolean {
  const n = doc.nodes.get(id);
  return n?.kind === 'element' && (n.local === 'style' || n.children.some((c) => holdsStyle(doc, c)));
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
  const w = writer(doc);
  for (const id of doc.prolog) w.emit(id);
  w.emit(doc.root);
  for (const id of doc.epilog) w.emit(id);
  return w.text();
}

/** One node's source exactly as serialize writes it (Edit source shows this). */
export function serializeNode(doc: Doc, id: NodeId): string {
  const w = writer(doc);
  w.emit(id);
  return w.text();
}

function writer(doc: Doc): { emit: (id: NodeId) => void; text: () => string } {
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
  return { emit, text: () => out };
}

function startTag(n: ElementNode, selfClose: boolean): string {
  let s = `<${n.qname}`;
  for (const a of n.attrs) s += `${a.lead}${a.qname}${a.eq}${a.quote}${a.raw}${a.quote}`;
  return s + n.tail + (selfClose ? '/>' : '>');
}
