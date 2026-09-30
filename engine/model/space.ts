// The whitespace around what Draw inserts and removes (the insertion rule), so the file's own
// indentation carries on around a new element and a removal gives the bytes back.
//
// - After a sibling S: the element goes right after S, preceded by a copy of the whitespace-only
//   text just before S (none if there isn't one).
// - Before a sibling S: the element, then a copy of S's leading whitespace, go right before S (so
//   the whitespace that was in front of S stays in front of the element).
// - As the last element child of P: after P's last element child, as above, so the whitespace
//   before </P> stays last. With no element child, when P's last child is whitespace-only text W,
//   the element goes before W, preceded by W's text plus two spaces when W holds a line break
//   (lab/create.svg's "\n" becomes "\n  <rect …/>\n"), else by nothing; with no children, alone.
// - A removal takes the whitespace-only text just before the element, so inserting and then
//   removing gives the bytes back.
// The whitespace is parsed with the markup it goes around, in one fragment parse.

import { el, type Doc, type LeafNode, type NodeId } from './doc.ts';
import { parseFragment } from './fragment.ts';
import { opInsert, opRemove, type Op } from '../commands/ops.ts';
import { TokenEditError } from '../code/edit.ts';

const BLANK = /^[ \t\r\n]+$/;
const blank = (doc: Doc, id: NodeId | undefined): boolean => {
  const n = id === undefined ? undefined : doc.nodes.get(id);
  return n?.kind === 'text' && BLANK.test(n.raw);
};
const rawOf = (doc: Doc, id: NodeId): string => (doc.nodes.get(id) as LeafNode).raw;

/** The whitespace-only text node right before `id` among its siblings, or null (looked for from the end, as detachNode does). */
export function leadingSpace(doc: Doc, id: NodeId): NodeId | null {
  const parent = doc.nodes.get(id)?.parent ?? null;
  if (parent === null) return null;
  const kids = el(doc, parent).children;
  const prev = kids[kids.lastIndexOf(id) - 1];
  return blank(doc, prev) ? prev : null;
}

/** Where an element goes: after or before a sibling, or last among a parent's element children. */
export type Where = { after: NodeId } | { before: NodeId } | { last: NodeId };

export interface Insertion {
  parent: NodeId;
  index: number; // where the first node (the lead whitespace, else the element) goes
  lead: string; // whitespace text before the element ('' for none)
  trail: string; // whitespace text after it ('' for none)
}

/** Where an element goes by the insertion rule, and the whitespace that goes around it. */
export function insertion(doc: Doc, where: Where): Insertion {
  if ('after' in where || 'before' in where) {
    const s = 'after' in where ? where.after : where.before;
    const parent = doc.nodes.get(s)!.parent!;
    const at = el(doc, parent).children.lastIndexOf(s);
    const ws = leadingSpace(doc, s);
    const text = ws === null ? '' : rawOf(doc, ws);
    return 'after' in where ? { parent, index: at + 1, lead: text, trail: '' } : { parent, index: at, lead: '', trail: text };
  }
  const p = el(doc, where.last);
  for (let i = p.children.length - 1; i >= 0; i--) if (doc.nodes.get(p.children[i])?.kind === 'element') return insertion(doc, { after: p.children[i] });
  const last = p.children[p.children.length - 1];
  if (last === undefined) return { parent: p.id, index: 0, lead: '', trail: '' };
  if (!blank(doc, last)) return { parent: p.id, index: p.children.length, lead: '', trail: '' };
  const w = rawOf(doc, last);
  return { parent: p.id, index: p.children.length - 1, lead: /[\r\n]/.test(w) ? `${w}  ` : '', trail: '' };
}

/**
 * Parse `markup` (one element) into the document where `where` says, with its whitespace, in one
 * fragment parse, and insert it: the new element's NodeId. Refused (TokenEditError) when the
 * markup doesn't parse there (a limit of the document's reached).
 */
export function insertMarkup(doc: Doc, where: Where, markup: string, apply: (op: Op) => void): NodeId {
  const at = insertion(doc, where);
  const made = parseFragment(doc, at.parent, at.lead + markup + at.trail);
  if (!made.ok) throw new TokenEditError(made.error.message);
  let index = at.index;
  let element: NodeId | null = null;
  for (const id of made.nodes) {
    apply(opInsert(doc, id, at.parent, index++));
    if (element === null && doc.nodes.get(id)?.kind === 'element') element = id;
  }
  if (element === null) throw new TokenEditError('there is no element to insert');
  return element;
}

/** Remove `id` and the whitespace-only text just before it. */
export function removeWithSpace(doc: Doc, id: NodeId, apply: (op: Op) => void): void {
  const ws = leadingSpace(doc, id);
  if (ws !== null) apply(opRemove(doc, ws));
  apply(opRemove(doc, id));
}
