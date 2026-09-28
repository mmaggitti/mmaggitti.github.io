// Parse markup into an existing document: what Edit source applies, and later paste-into and the
// Insert tool. The text is parsed by the same engine (limits, entity budget, the same errors), with
// the namespace declarations in scope at the insertion point and the document's own entities; the
// resulting nodes join the document detached, and an ordinary opInsert puts them in place (so undo
// removes them as it would any other insert).
//
// Nodes made here have no source span: serialize writes them from their own raw pieces, which are
// exactly the text that was parsed.

import { el, parseDoc, type Doc, type ElementNode, type Node, type NodeId } from './doc.ts';

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
  const parsed = parseDoc(`${head}${text}</${WRAPPER}>`);
  if (!parsed.ok) {
    const at = Math.min(Math.max(0, parsed.error.at - head.length), text.length);
    return { ok: false, error: { at, message: parsed.error.message } };
  }
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
