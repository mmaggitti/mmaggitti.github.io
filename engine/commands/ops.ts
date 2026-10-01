// Edits as reversible operations. Every change to a document goes through an Op that records the
// state before and after, so undo and redo restore the exact bytes: an attribute comes back with
// its quote, whitespace and position, and a removed node comes back as the same node (same NodeId,
// same subtree), never as a re-parsed copy.

import {
  attachNode, attrSnapshot, detachNode, el, restoreAttr, setAttr, setAttrRaw, setLeafRaw,
  type Attr, type Doc, type NodeId,
} from '../model/doc.ts';

export interface AttrSnap {
  index: number;
  attr: Attr;
}
export interface Place {
  parent: NodeId;
  index: number;
}

export type Op =
  | { kind: 'attr'; id: NodeId; ns: string | null; local: string; before: AttrSnap | null; after: AttrSnap | null }
  | { kind: 'text'; id: NodeId; before: string; after: string } // a text, CDATA or comment leaf's raw text
  | { kind: 'place'; id: NodeId; before: Place | null; after: Place | null }; // null = detached

/** What an applied batch of ops touched, for the renderer, the code view and the overlay. */
export interface ChangeSet {
  attrs: Set<NodeId>; // start tags to re-render
  texts: Set<NodeId>; // text leaves to re-render
  structure: Set<NodeId>; // parents whose child list changed
  moved: Set<NodeId>; // nodes whose place changed: inserted, removed or moved
}

export const emptyChangeSet = (): ChangeSet => ({ attrs: new Set(), texts: new Set(), structure: new Set(), moved: new Set() });

export function noteChange(cs: ChangeSet, op: Op): void {
  if (op.kind === 'attr') cs.attrs.add(op.id);
  else if (op.kind === 'text') cs.texts.add(op.id);
  else {
    cs.moved.add(op.id);
    if (op.before) cs.structure.add(op.before.parent);
    if (op.after) cs.structure.add(op.after.parent);
  }
}

// ── intents: each applies itself and returns the op that undoes or redoes it ───────────────────

/** Set an attribute's value (unescaped); null removes it. */
export function opSetAttr(doc: Doc, id: NodeId, ns: string | null, local: string, value: string | null, qname?: string): Op {
  const before = attrSnapshot(doc, id, ns, local);
  if (value === null) restoreAttr(doc, id, ns, local, null);
  else setAttr(doc, id, ns, local, value, qname);
  return { kind: 'attr', id, ns, local, before, after: attrSnapshot(doc, id, ns, local) };
}

/** Put an attribute exactly as a snapshot holds it (its quote, spacing and place), or take it away (null). */
export function opPutAttr(doc: Doc, id: NodeId, ns: string | null, local: string, snap: AttrSnap | null): Op {
  const before = attrSnapshot(doc, id, ns, local);
  restoreAttr(doc, id, ns, local, snap);
  return { kind: 'attr', id, ns, local, before, after: attrSnapshot(doc, id, ns, local) };
}

/** Replace an attribute's raw text: the byte-exact edit a code token makes. */
export function opSetAttrRaw(doc: Doc, id: NodeId, ns: string | null, local: string, raw: string): Op {
  const before = attrSnapshot(doc, id, ns, local);
  setAttrRaw(doc, id, ns, local, raw);
  return { kind: 'attr', id, ns, local, before, after: attrSnapshot(doc, id, ns, local) };
}

/** Replace a text, CDATA or comment leaf's raw text (a CDATA leaf's and a comment's include their delimiters). */
export function opSetLeafRaw(doc: Doc, id: NodeId, raw: string): Op {
  const n = doc.nodes.get(id);
  if (!n || (n.kind !== 'text' && n.kind !== 'cdata' && n.kind !== 'comment')) throw new Error(`opSetLeafRaw: node ${id} is not text or CDATA (or a comment)`);
  const before = n.raw;
  setLeafRaw(doc, id, raw);
  return { kind: 'text', id, before, after: raw };
}

/** Kept for text leaves; opSetLeafRaw covers CDATA too. */
export const opSetTextRaw = opSetLeafRaw;

/** Detach a node; undo puts the same node back where it was. */
export function opRemove(doc: Doc, id: NodeId): Op {
  if (id === doc.root) throw new Error('opRemove: the root element cannot be removed');
  const before = detachNode(doc, id);
  return { kind: 'place', id, before, after: null };
}

/** Attach a detached node (a node from opRemove, or one built by the importer) under a parent. */
export function opInsert(doc: Doc, id: NodeId, parent: NodeId, index: number): Op {
  if (isInside(doc, parent, id)) throw new Error('opInsert: a node cannot be inserted inside itself');
  return { kind: 'place', id, before: null, after: { parent, index: attachNode(doc, id, parent, index) } };
}

function isInside(doc: Doc, id: NodeId, ancestor: NodeId): boolean {
  for (let n = doc.nodes.get(id); n; n = n.parent === null ? undefined : doc.nodes.get(n.parent)) if (n.id === ancestor) return true;
  return false;
}

// ── replay ─────────────────────────────────────────────────────────────────────────────────────

function place(doc: Doc, id: NodeId, to: Place | null): void {
  const n = doc.nodes.get(id)!;
  if (n.parent !== null) detachNode(doc, id);
  if (to) attachNode(doc, id, to.parent, to.index);
}

/** Put an op's `after` state back (redo). */
export function redoOp(doc: Doc, op: Op): void {
  if (op.kind === 'attr') restoreAttr(doc, op.id, op.ns, op.local, op.after);
  else if (op.kind === 'text') setLeafRaw(doc, op.id, op.after);
  else place(doc, op.id, op.after);
}

/** Put an op's `before` state back (undo). */
export function undoOp(doc: Doc, op: Op): void {
  if (op.kind === 'attr') restoreAttr(doc, op.id, op.ns, op.local, op.before);
  else if (op.kind === 'text') setLeafRaw(doc, op.id, op.before);
  else place(doc, op.id, op.before);
}

const samePlace = (a: Place | null, b: Place | null): boolean => a === b || (!!a && !!b && a.parent === b.parent && a.index === b.index);

/**
 * Collapse a run of ops into the fewest that have the same effect:
 * - consecutive edits of one attribute or text keep the first `before` and the last `after` (a
 *   drag of a hundred frames is one change), and one that ends where it started is dropped;
 * - consecutive place ops of one node merge the same way (a remove and its re-insert are one
 *   move), and a merged one that ends where it started is dropped when no other place op in the
 *   batch touches that parent;
 * - given the document the ops were applied to, place ops whose net effect is nothing (every
 *   parent they touch has its children as before, a Forward and then a Back) are all dropped.
 */
export function coalesce(ops: readonly Op[], doc?: Doc): Op[] {
  let out: Op[] = [];
  for (const op of ops) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === op.kind && prev.id === op.id && (op.kind !== 'attr' || (prev.kind === 'attr' && prev.ns === op.ns && prev.local === op.local))) {
      out[out.length - 1] = { ...prev, after: op.after } as Op;
      continue;
    }
    out.push(op);
  }
  const parentsOf = (op: Op) => (op.kind === 'place' ? [op.before?.parent, op.after?.parent].filter((p): p is NodeId => p !== undefined) : []);
  out = out.filter((op, i) => {
    if (op.kind !== 'place') return JSON.stringify(op.before) !== JSON.stringify(op.after);
    if (!samePlace(op.before, op.after)) return true;
    const mine = new Set(parentsOf(op));
    return out.some((o, j) => j !== i && o.kind === 'place' && parentsOf(o).some((p) => mine.has(p)));
  });
  if (doc && out.some((op) => op.kind === 'place') && placesUnchanged(doc, out)) out = out.filter((op) => op.kind !== 'place');
  return out;
}

// Undo the place ops on copies of the children lists they touch: if every list comes back as it
// is now, the ops moved nothing in the end. A node that ends under another parent than it began
// (or in or out of the tree) settles it at once, without the undo (a Duplicate, a Delete, a Group).
function placesUnchanged(doc: Doc, ops: readonly Op[]): boolean {
  const first = new Map<NodeId, Place | null>();
  const last = new Map<NodeId, Place | null>();
  for (const op of ops) {
    if (op.kind !== 'place') continue;
    if (!first.has(op.id)) first.set(op.id, op.before);
    last.set(op.id, op.after);
  }
  for (const [id, b] of first) if ((b?.parent ?? null) !== (last.get(id)?.parent ?? null)) return false;
  const lists = new Map<NodeId, NodeId[]>();
  const list = (p: NodeId): NodeId[] => {
    let l = lists.get(p);
    if (!l) {
      const n = doc.nodes.get(p);
      if (!n || n.kind !== 'element') throw new Error('stale');
      l = [...n.children];
      lists.set(p, l);
    }
    return l;
  };
  try {
    for (const op of ops) if (op.kind === 'place') for (const p of [op.before?.parent, op.after?.parent]) if (p !== undefined) list(p);
    const now = new Map([...lists].map(([p, l]) => [p, [...l]]));
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      if (op.kind !== 'place') continue;
      if (op.after) {
        const l = list(op.after.parent);
        const at = l.indexOf(op.id);
        if (at === -1) return false;
        l.splice(at, 1);
      }
      if (op.before) list(op.before.parent).splice(op.before.index, 0, op.id);
    }
    return [...lists].every(([p, l]) => {
      const n = now.get(p)!;
      return l.length === n.length && l.every((id, i) => id === n[i]);
    });
  } catch {
    return false;
  }
}
