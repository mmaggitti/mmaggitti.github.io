// Replace this one (P1-M5, the New sheet): another file's drawing written over the open one, in one
// transaction that undo takes back byte for byte (SVG Lab's "Start from" replaces its one drawing).
//
// What changes is everything inside the root, and the root's own attributes, each written exactly as
// the other file writes it (its quotes, its spacing, its order). The root's name, the whitespace that
// ends its tags, and whatever comes before or after it (an XML declaration, a DOCTYPE, a comment) stay:
// they are the open file's, and no edit reaches them. So an open file with none of those becomes the
// other file byte for byte. The other file's content is parsed in the root's scope once its attributes
// (its namespace declarations among them) are in, within what the document has left of its limits.

import { el, parseDoc, type Doc } from './doc.ts';
import { parseFragment } from './fragment.ts';
import { opInsert, opPutAttr, opRemove, type Op } from '../commands/ops.ts';
import { TokenEditError } from '../code/edit.ts';

/** Write `text`'s drawing over `doc`'s (the module header); refused (TokenEditError) when it can't be. */
export function replaceDrawing(doc: Doc, text: string, apply: (op: Op) => void): void {
  const parsed = parseDoc(text);
  if (!parsed.ok) throw new TokenEditError(parsed.error.message);
  const src = parsed.doc;
  const from = el(src, src.root);
  const root = el(doc, doc.root);
  if (from.qname !== root.qname) throw new TokenEditError(`this drawing’s root is <${root.qname}>, which can’t take the content of an <${from.qname}>: use New drawing`);
  // Last child first: each removal is then at the end of the list (and its undo appends), not a
  // shift of every child after it.
  for (const c of [...root.children].reverse()) apply(opRemove(doc, c));
  for (const a of [...root.attrs]) apply(opPutAttr(doc, root.id, a.ns, a.local, null));
  from.attrs.forEach((a, index) => apply(opPutAttr(doc, root.id, a.ns, a.local, { index, attr: { ...a } })));
  const inner = from.src?.endTag ? text.slice(from.src.tag.end, from.src.endTag.start) : '';
  if (!inner) return;
  const made = parseFragment(doc, root.id, inner);
  if (!made.ok) throw new TokenEditError(made.error.message);
  made.nodes.forEach((id, i) => apply(opInsert(doc, id, root.id, i)));
}
