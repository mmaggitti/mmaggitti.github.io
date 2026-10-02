// Parse markup into an existing document: what Edit source applies, and later paste-into and the
// Insert tool. The text is parsed by the same engine (the same errors), with the namespace
// declarations in scope at the insertion point and the document's own entities; the resulting nodes
// join the document detached, and an ordinary opInsert puts them in place (so undo removes them as
// it would any other insert).
//
// The limits are the document's, not fresh ones: the text may add only what the document has left
// of its size, node count, depth (from the insertion point) and entity budget, so Draw never writes
// a file it can't open again. What the text spends on entities is charged to the document's budget
// for good (an undo can bring any version back), and what is left is measured with the element Edit
// source replaces still in place: both err on the side of refusing. Replacing a whole element's
// content (replaceContent) removes the old content first, so it is measured without it.
//
// Nodes made here have no source span: serialize writes them from their own raw pieces, which are
// exactly the text that was parsed.

import { DEFAULT_LIMITS, type Limits } from '../xml/cst.ts';
import { el, parseDoc, serialize, type Doc, type ElementNode, type Node, type NodeId } from './doc.ts';
import { opInsert, opRemove, type Op } from '../commands/ops.ts';

const XMLNS = 'http://www.w3.org/2000/xmlns/';
const WRAPPER = 'draw-fragment';

export type FragmentResult = { ok: true; nodes: NodeId[] } | { ok: false; error: { at: number; message: string } };

/** Parse `text` as content for element `scope`; returns the new top-level nodes, detached. */
export function parseFragment(doc: Doc, scope: NodeId, text: string): FragmentResult {
  // The namespace declarations in scope at `scope`, nearest first.
  const decls = new Map<string, string>(); // qname ('xmlns' or 'xmlns:p') → raw value, as written
  for (let n: ElementNode | null = el(doc, scope); n; n = n.parent === null ? null : el(doc, n.parent)) {
    for (const a of n.attrs) if (a.ns === XMLNS && !decls.has(a.qname)) decls.set(a.qname, `${a.quote}${a.raw}${a.quote}`);
  }
  const doctype = doc.prolog.map((id) => doc.nodes.get(id)!).find((n) => n.kind === 'doctype');
  const head = `${doctype && doctype.kind === 'doctype' ? doctype.raw : ''}<${WRAPPER}${[...decls].map(([q, v]) => ` ${q}=${v}`).join('')}>`;
  const tail = `</${WRAPPER}>`;
  // What the document has left, plus what the head and tail take: the DOCTYPE and the wrapper's tags.
  const max = DEFAULT_LIMITS;
  const limits: Limits = {
    maxBytes: max.maxBytes - serialize(doc).length + head.length + tail.length,
    maxNodes: max.maxNodes - tokens(doc) + (doctype ? 3 : 2),
    maxDepth: max.maxDepth - depth(doc, scope) + 1,
  };
  const budget = { left: doc.budget.left };
  const parsed = parseDoc(`${head}${text}${tail}`, limits, budget);
  if (!parsed.ok) {
    const at = Math.min(Math.max(0, parsed.error.at - head.length), text.length);
    // A limit is reported as the document's own, not the fragment's share of it.
    const whole = new Map([
      [`file is larger than ${limits.maxBytes / 1e6} MB`, `the document would be larger than ${max.maxBytes / 1e6} MB`],
      [`more than ${limits.maxNodes} nodes`, `the document would have more than ${max.maxNodes} nodes`],
      [`nesting deeper than ${limits.maxDepth}`, `the document would nest deeper than ${max.maxDepth}`],
    ]);
    return { ok: false, error: { at, message: whole.get(parsed.error.message) ?? parsed.error.message } };
  }
  doc.budget.left = budget.left;
  const frag = parsed.doc;
  const top = el(frag, frag.root).children;
  const adopt = (id: NodeId, parent: NodeId | null): void => {
    const n = frag.nodes.get(id)! as Node;
    const copy: Node = n.kind === 'element'
      ? { ...n, parent, src: null, tagDirty: true, childrenDirty: true, attrs: n.attrs.map((a) => ({ ...a })), children: [...n.children] }
      : { ...n, parent, src: null, dirty: true };
    doc.nodes.set(id, copy);
    if (copy.kind === 'element') for (const c of copy.children) adopt(c, id);
  };
  for (const id of top) adopt(id, null);
  doc.version++;
  return { ok: true, nodes: [...top] };
}

/** Text replaceContent can't parse: where in the text, and why. Thrown inside the transaction, so the removals roll back. */
export class ContentError extends Error {
  at: number;
  constructor(at: number, message: string) {
    super(message);
    this.at = at;
  }
}

/**
 * Edit the drawing's source (P1-M5): everything inside `scope` (its elements, text, comments and PIs)
 * replaced by what `text` parses to there, in order, as ops handed to `apply` (one transaction), so the
 * element becomes exactly its start tag, the text and its end tag, and whatever lies outside it (the
 * prolog and epilog, for the root) stays. The old content is removed first, as Replace this one does
 * (model/replace.ts), so the text has the document's limits without it: an unchanged Apply always fits.
 * Text that doesn't parse throws ContentError, saying where, and the transaction rolls the removals
 * back (Session.run): nothing changes.
 */
export function replaceContent(doc: Doc, scope: NodeId, text: string, apply: (op: Op) => void): void {
  for (const c of [...el(doc, scope).children]) apply(opRemove(doc, c));
  const made = parseFragment(doc, scope, text);
  if (!made.ok) throw new ContentError(made.error.at, made.error.message);
  made.nodes.forEach((id, i) => apply(opInsert(doc, id, scope, i)));
}

// The tokens the parser would count in the saved document (every node, and each end tag), so a
// document and what is parsed into it stay within the node limit together. Text nodes that became
// neighbours read as one token again, so this can only overcount.
function tokens(doc: Doc): number {
  const count = (id: NodeId): number => {
    const n = doc.nodes.get(id)!;
    if (n.kind !== 'element') return 1;
    let k = n.selfClosing && n.children.length === 0 ? 1 : 2;
    for (const c of n.children) k += count(c);
    return k;
  };
  return doc.prolog.length + doc.epilog.length + count(doc.root);
}

/** How deep an element is: the root is 1. */
function depth(doc: Doc, id: NodeId): number {
  let d = 0;
  for (let n: ElementNode | null = el(doc, id); n; n = n.parent === null ? null : el(doc, n.parent)) d++;
  return d;
}
