// Draw's own state in a document: the draw: namespace (https://mmaggitti.github.io/draw/ns). This
// module owns it; nothing else writes it.
//
// - The declaration, xmlns:draw, is written once, on the root (the one place in scope everywhere),
//   in the same transaction as the first Draw state, and removed in the one that removes the last
//   (no <draw:state> and no draw:* attribute left). A root that already binds the namespace keeps
//   its prefix; a `draw` prefix bound to another URI anywhere makes Draw use draw1, draw2, ….
// - Document state (guides and the grid step) is one empty element in the file's single
//   <metadata>: <draw:state version="1" grid="10" guides="v 20 v 80 h 50"/>. `grid` is present only
//   when a step was chosen; `guides` lists each guide as an axis letter and a position in root user
//   units. The root's first SVG <metadata> is reused; with none, Draw adds <metadata draw:made="true">
//   before the root's first element, and takes it away again when its last state goes. A
//   self-closing <metadata/> counts as none: stripped of Draw's state on export it would come back
//   as <metadata></metadata>, not byte for byte.
// - Whitespace, so a removal gives the bytes back: an inserted element brings a copy of the
//   whitespace before the sibling it goes in front of (or the last element child, appending), and
//   a removed one takes the whitespace just before it.
// - Per-element state is draw:* attributes: M1 writes draw:locked="true" (Layers).
// - stripDrawState is the file without any of it (the As-is export and Copy): the file itself, byte
//   for byte, when it has none.

import { NS, attrValue, el, findAttr, serialize, type Doc, type ElementNode, type NodeId } from './doc.ts';
import { parseFragment } from './fragment.ts';
import { DRAW_NS, isDrawMadeEmpty } from './draw-ns.ts';
import { opInsert, opRemove, opSetAttr, opSetAttrRaw, type Op } from '../commands/ops.ts';
import { rewriteNumbers } from '../code/edit.ts';
import { stripNamespaces } from '../export/clean.ts';
import { decodeAttr } from '../xml/entities.ts';
import { fmt } from '../values/number-format.ts';

export { DRAW_NS };

export interface Guide {
  axis: 'v' | 'h'; // v: a vertical guide at x; h: a horizontal one at y
  at: number; // root user units
}
export interface DrawState {
  grid: number | null; // the chosen grid step, or null (automatic)
  guides: Guide[];
}
export const NO_STATE: DrawState = { grid: null, guides: [] };

type Apply = (op: Op) => void;
const isDraw = (n: { ns: string | null }) => n.ns === DRAW_NS;
const blank = (doc: Doc, id: NodeId | undefined): boolean => {
  const n = id === undefined ? undefined : doc.nodes.get(id);
  return n?.kind === 'text' && /^[ \t\r\n]+$/.test(n.raw);
};
const elementKids = (doc: Doc, n: ElementNode): ElementNode[] => n.children.map((c) => doc.nodes.get(c)!).filter((c): c is ElementNode => c.kind === 'element');

/** Is this element locked: draw:locked="true" on it or on an ancestor? */
export function isLocked(doc: Doc, id: NodeId): boolean {
  for (let n = doc.nodes.get(id); n && n.kind === 'element'; n = n.parent === null ? undefined : doc.nodes.get(n.parent)) {
    if (el(doc, n.id).attrs.some((a) => a.ns === DRAW_NS && a.local === 'locked' && a.raw === 'true')) return true;
  }
  return false;
}

/** The document's <draw:state>, if any (in a <metadata> child of the root). */
export function stateElement(doc: Doc): ElementNode | null {
  for (const m of elementKids(doc, el(doc, doc.root))) {
    if (m.ns !== NS.svg || m.local !== 'metadata') continue;
    const s = elementKids(doc, m).find((k) => isDraw(k) && k.local === 'state');
    if (s) return s;
  }
  return null;
}

/** The guides and the grid step the file keeps, or none. */
export function readState(doc: Doc): DrawState {
  const s = stateElement(doc);
  if (!s) return NO_STATE;
  const g = attrValue(doc, s, null, 'grid');
  const grid = g === null ? null : Number(g);
  const guides: Guide[] = [];
  const words = (attrValue(doc, s, null, 'guides') ?? '').trim().split(/[\s,]+/).filter(Boolean);
  for (let i = 0; i + 1 < words.length; i += 2) {
    const at = Number(words[i + 1]);
    if ((words[i] === 'v' || words[i] === 'h') && Number.isFinite(at)) guides.push({ axis: words[i] as 'v' | 'h', at });
  }
  return { grid: grid !== null && Number.isFinite(grid) && grid > 0 ? grid : null, guides };
}

const NUMBER = /[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/g;
const guidesText = (guides: readonly Guide[]) => guides.map((g) => `${g.axis} ${fmt(g.at, 4)}`).join(' ');

/** Does the document carry any Draw state: a draw: element or attribute (the declaration aside)? */
export function hasDrawItems(doc: Doc): boolean {
  const walk = (id: NodeId): boolean => {
    const n = doc.nodes.get(id)!;
    if (n.kind !== 'element') return false;
    if (isDraw(n) || n.attrs.some((a) => a.ns === DRAW_NS)) return true;
    return n.children.some(walk);
  };
  return walk(doc.root);
}

/** The prefix the root binds to Draw's namespace, if it does. */
function boundPrefix(doc: Doc): string | null {
  const root = el(doc, doc.root);
  const a = root.attrs.find((x) => x.ns === NS.xmlns && x.local !== 'xmlns' && decodeAttr(x.raw, doc.entities) === DRAW_NS);
  return a ? a.local : null;
}

/** The prefix to declare: draw, else the first of draw1, draw2, … no element binds to another URI. */
function freePrefix(doc: Doc): string {
  const taken = new Set<string>();
  const walk = (id: NodeId) => {
    const n = doc.nodes.get(id)!;
    if (n.kind !== 'element') return;
    for (const a of n.attrs) if (a.ns === NS.xmlns && a.local !== 'xmlns' && decodeAttr(a.raw, doc.entities) !== DRAW_NS) taken.add(a.local);
    for (const p of [n.prefix, ...n.attrs.map((a) => a.prefix)]) if (p && p !== 'xmlns') taken.add(p);
    n.children.forEach(walk);
  };
  walk(doc.root);
  if (!taken.has('draw')) return 'draw';
  for (let i = 1; ; i++) if (!taken.has(`draw${i}`)) return `draw${i}`;
}

/** Declare Draw's namespace on the root if it isn't; the prefix to write with. */
export function declare(doc: Doc, apply: Apply): string {
  const bound = boundPrefix(doc);
  if (bound) return bound;
  const p = freePrefix(doc);
  apply(opSetAttr(doc, doc.root, NS.xmlns, p, DRAW_NS, `xmlns:${p}`));
  return p;
}

/** Take the declaration away when no Draw item is left. */
export function undeclareIfUnused(doc: Doc, apply: Apply): void {
  const p = boundPrefix(doc);
  if (p !== null && !hasDrawItems(doc)) apply(opSetAttr(doc, doc.root, NS.xmlns, p, null));
}

/** Insert `id` (detached) at `index` under `parent`, with a copy of the whitespace `ws` before it. */
function insertWithSpace(doc: Doc, id: NodeId, parent: NodeId, index: number, ws: NodeId | null, apply: Apply): void {
  if (ws !== null) {
    const made = parseFragment(doc, parent, (doc.nodes.get(ws) as { raw: string }).raw);
    if (made.ok && made.nodes.length === 1) {
      apply(opInsert(doc, made.nodes[0], parent, index));
      index++;
    }
  }
  apply(opInsert(doc, id, parent, index));
}

/** Remove `id` and the whitespace just before it. */
function removeWithSpace(doc: Doc, id: NodeId, apply: Apply): void {
  const parent = doc.nodes.get(id)!.parent!;
  const kids = el(doc, parent).children;
  const before = kids[kids.indexOf(id) - 1];
  if (blank(doc, before)) apply(opRemove(doc, before));
  apply(opRemove(doc, id));
}

/**
 * Make the file's document state `next`, in the caller's transaction: <draw:state> written,
 * updated or taken away, with the declaration and a Draw-made <metadata> coming and going with it.
 */
export function writeState(doc: Doc, next: DrawState, apply: Apply): void {
  const cur = stateElement(doc);
  if (!next.guides.length && next.grid === null) {
    if (!cur) return;
    const meta = el(doc, cur.parent!);
    removeWithSpace(doc, cur.id, apply);
    if (isDrawMadeEmpty(doc, meta)) removeWithSpace(doc, meta.id, apply); // Draw's own, with nothing of the file's in it
    undeclareIfUnused(doc, apply);
    return;
  }
  const p = declare(doc, apply);
  const grid = next.grid === null ? null : fmt(next.grid, 4);
  const guides = next.guides.length ? guidesText(next.guides) : null;
  if (cur) {
    for (const [local, value] of [['grid', grid], ['guides', guides]] as const) {
      if (attrValue(doc, cur, null, local) !== value) apply(opSetAttr(doc, cur.id, null, local, value));
    }
    return;
  }
  const attrs = `${p}:state version="1"${grid === null ? '' : ` grid="${grid}"`}${guides === null ? '' : ` guides="${guides}"`}`;
  const root = el(doc, doc.root);
  const meta = elementKids(doc, root).find((k) => k.ns === NS.svg && k.local === 'metadata' && !(k.selfClosing && !k.children.length));
  if (meta) {
    const made = parseFragment(doc, meta.id, `<${attrs}/>`);
    if (!made.ok) throw new Error(made.error.message);
    const kids = elementKids(doc, meta);
    const last = kids[kids.length - 1];
    const at = last ? meta.children.indexOf(last.id) + 1 : 0;
    const ws = last ? meta.children[meta.children.indexOf(last.id) - 1] : undefined;
    insertWithSpace(doc, made.nodes[0], meta.id, at, blank(doc, ws) ? ws! : null, apply);
    return;
  }
  // In the SVG namespace, whatever the root calls it (<svg:svg> has no default namespace: <svg:metadata>).
  const tag = root.prefix ? `${root.prefix}:metadata` : 'metadata';
  const made = parseFragment(doc, root.id, `<${tag} ${p}:made="true"><${attrs}/></${tag}>`);
  if (!made.ok) throw new Error(made.error.message);
  // Before the first element and its whitespace; with no element, first (nothing before it, so its
  // removal takes none of the file's own whitespace).
  const first = elementKids(doc, root)[0];
  let at = first ? root.children.indexOf(first.id) : 0;
  const ws = first ? root.children[at - 1] : undefined;
  if (blank(doc, ws)) at--;
  insertWithSpace(doc, made.nodes[0], root.id, at, blank(doc, ws) ? ws! : null, apply);
}

/** Move guide `index` to `at`, rewriting only its number (the rest of the attribute keeps its bytes). */
export function moveGuide(doc: Doc, index: number, at: number, decimals: number, apply: Apply): void {
  const s = stateElement(doc);
  const a = s && findAttr(s, null, 'guides');
  if (!s || !a) return;
  const t = [...a.raw.matchAll(NUMBER)][index];
  if (!t) return;
  const [start, end] = [t.index, t.index + t[0].length];
  const text = fmt(at, decimals);
  if (a.raw.slice(start, end) === text) return;
  apply(opSetAttrRaw(doc, s.id, null, 'guides', rewriteNumbers(a.raw, [{ start, end, text }])));
}

/** The file without Draw's own state (the As-is export and Copy); the file itself when it has none. */
export function stripDrawState(doc: Doc): string {
  if (!hasDrawItems(doc) && boundPrefix(doc) === null) return serialize(doc);
  return stripNamespaces(doc, new Set([DRAW_NS])).text;
}
