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
//   units. Draw reads the first MAX_GUIDES (100) guides only, so a file can't make it read, draw and
//   list a million: the rest are counted, never shown, and kept byte for byte when Draw writes the
//   ones it shows. A read is kept per document version. The root's first SVG <metadata> is reused; with none, Draw adds <metadata draw:made="true">
//   before the root's first element, and takes it away again when its last state goes. A
//   self-closing <metadata/> counts as none: stripped of Draw's state on export it would come back
//   as <metadata></metadata>, not byte for byte.
// - Whitespace, so a removal gives the bytes back: an inserted element brings a copy of the
//   whitespace before the sibling it goes in front of (or the last element child, appending), and
//   a removed one takes the whitespace just before it.
// - Per-element state is draw:* attributes, written through setDrawAttr: draw:locked="true" (Layers,
//   P1-M1) and a generated shape's inputs (engine/generators/, P1-M2).
// - stripDrawState is the file without any of it (the As-is export and Copy): the file itself, byte
//   for byte, when it has none.

import { NS, attrValue, el, findAttr, serialize, type Doc, type ElementNode, type NodeId } from './doc.ts';
import { parseFragment } from './fragment.ts';
import { DRAW_NS, isDrawMadeEmpty } from './draw-ns.ts';
import { opInsert, opSetAttr, opSetAttrRaw, type Op } from '../commands/ops.ts';
import { removeWithSpace } from './space.ts';
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
  guides: Guide[]; // the first MAX_GUIDES the file lists (hiddenGuides counts the rest)
}
export const NO_STATE: DrawState = { grid: null, guides: [] };

/** The guides Draw reads, draws and lists; a file's others are kept, unread. */
export const MAX_GUIDES = 100;

type Apply = (op: Op) => void;
const isDraw = (n: { ns: string | null }) => n.ns === DRAW_NS;
const blank = (doc: Doc, id: NodeId | undefined): boolean => {
  const n = id === undefined ? undefined : doc.nodes.get(id);
  return n?.kind === 'text' && /^[ \t\r\n]+$/.test(n.raw);
};
const elementKids = (doc: Doc, n: ElementNode): ElementNode[] => n.children.map((c) => doc.nodes.get(c)!).filter((c): c is ElementNode => c.kind === 'element');

/**
 * The element whose lock holds this one: itself or its nearest ancestor with draw:locked="true", or
 * null. Never the root: Draw never locks the root (Layers has no row for it), so a file's own root
 * draw:locked locks nothing, or it would lock the whole canvas with no way to unlock it.
 */
export function lockHolder(doc: Doc, id: NodeId): NodeId | null {
  for (let n = doc.nodes.get(id); n && n.kind === 'element' && n.id !== doc.root; n = n.parent === null ? undefined : doc.nodes.get(n.parent)) {
    if (n.attrs.some((a) => a.ns === DRAW_NS && a.local === 'locked' && a.raw === 'true')) return n.id;
  }
  return null;
}

/** Is this element locked: draw:locked="true" on it or on an ancestor below the root? */
export function isLocked(doc: Doc, id: NodeId): boolean {
  return lockHolder(doc, id) !== null;
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

const read = new WeakMap<Doc, { version: number; state: DrawState }>();

/** The guides (the first MAX_GUIDES) and the grid step the file keeps, or none; read once per version. */
export function readState(doc: Doc): DrawState {
  const hit = read.get(doc);
  if (hit && hit.version === doc.version) return hit.state;
  const s = stateElement(doc);
  let state = NO_STATE;
  if (s) {
    const g = attrValue(doc, s, null, 'grid');
    const grid = g === null ? null : Number(g);
    const raw = findAttr(s, null, 'guides')?.raw ?? '';
    state = { grid: grid !== null && Number.isFinite(grid) && grid > 0 ? grid : null, guides: scanGuides(raw).guides };
  }
  read.set(doc, { version: doc.version, state });
  return state;
}

const hidden = new WeakMap<Doc, { version: number; count: number }>();

/**
 * How many guides the file lists past the first MAX_GUIDES: never read or drawn, kept as they are.
 * Counted only when asked (the Snap sheet says so), once per version: a scan of the whole attribute,
 * which readState, asked on every frame, never makes.
 */
export function hiddenGuides(doc: Doc): number {
  const hit = hidden.get(doc);
  if (hit && hit.version === doc.version) return hit.count;
  const s = stateElement(doc);
  const raw = (s && findAttr(s, null, 'guides')?.raw) || '';
  const count = raw ? Math.floor(words(raw, scanGuides(raw).end) / 2) : 0;
  hidden.set(doc, { version: doc.version, count });
  return count;
}

const isSep = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 44; // whitespace and ','

/**
 * The first MAX_GUIDES guides in a guides attribute as written (pairs of an axis letter and a number;
 * a pair that isn't one is passed over), each number's place, and where the text after them begins.
 */
function scanGuides(raw: string): { guides: Guide[]; spans: [number, number][]; end: number } {
  const guides: Guide[] = [];
  const spans: [number, number][] = [];
  let i = 0;
  let end = 0;
  const word = (): [number, number] => {
    while (i < raw.length && isSep(raw.charCodeAt(i))) i++;
    const from = i;
    while (i < raw.length && !isSep(raw.charCodeAt(i))) i++;
    return [from, i];
  };
  while (guides.length < MAX_GUIDES) {
    const [a0, a1] = word();
    const [n0, n1] = word();
    if (n0 === n1) break;
    const axis = raw.slice(a0, a1);
    const at = Number(raw.slice(n0, n1));
    if ((axis === 'v' || axis === 'h') && Number.isFinite(at)) {
      guides.push({ axis, at });
      spans.push([n0, n1]);
    }
    end = n1;
  }
  return { guides, spans, end };
}

/** How many words `raw` holds from `from` on (a character loop: a million guides take a few ms). */
function words(raw: string, from: number): number {
  let n = 0;
  for (let i = from, inWord = false; i < raw.length; i++) {
    const sep = isSep(raw.charCodeAt(i));
    if (!sep && !inWord) n++;
    inWord = !sep;
  }
  return n;
}

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

/**
 * One draw:<local> attribute of an element set (declaring Draw's namespace on the root first, with
 * its prefix) or, with null, removed (and the declaration with it when that was Draw's last item):
 * Lock and Unlock, generator inputs, draw:made.
 */
export function setDrawAttr(doc: Doc, id: NodeId, local: string, value: string | null, apply: Apply): void {
  if (value !== null) {
    const p = declare(doc, apply);
    apply(opSetAttr(doc, id, DRAW_NS, local, value, `${p}:${local}`));
    return;
  }
  if (findAttr(el(doc, id), DRAW_NS, local)) apply(opSetAttr(doc, id, DRAW_NS, local, null));
  undeclareIfUnused(doc, apply);
}

/** Several draw: attributes removed from one element (the declaration too when nothing of Draw's is left, unless `undeclare` is false: a caller removing from many elements asks once, at the end). */
export function dropDrawAttrs(doc: Doc, id: NodeId, locals: readonly string[], apply: Apply, undeclare = true): void {
  for (const local of locals) if (findAttr(el(doc, id), DRAW_NS, local)) apply(opSetAttr(doc, id, DRAW_NS, local, null));
  if (undeclare) undeclareIfUnused(doc, apply);
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


/**
 * Make the file's document state `next`, in the caller's transaction: <draw:state> written,
 * updated or taken away, with the declaration and a Draw-made <metadata> coming and going with it.
 */
export function writeState(doc: Doc, next: DrawState, apply: Apply): void {
  const cur = stateElement(doc);
  // The guides past the first MAX_GUIDES, as written: kept after the ones Draw shows.
  const had = cur && findAttr(cur, null, 'guides');
  const rest = had ? had.raw.slice(scanGuides(had.raw).end) : '';
  const restLeft = /[^ \t\n\r,]/.test(rest);
  if (!next.guides.length && next.grid === null && !restLeft) {
    if (!cur) return;
    const meta = el(doc, cur.parent!);
    removeWithSpace(doc, cur.id, apply);
    if (isDrawMadeEmpty(doc, meta)) removeWithSpace(doc, meta.id, apply); // Draw's own, with nothing of the file's in it
    undeclareIfUnused(doc, apply);
    return;
  }
  const p = declare(doc, apply);
  const grid = next.grid === null ? null : fmt(next.grid, 4);
  const shown = next.guides.length ? guidesText(next.guides) : null;
  if (cur) {
    if (attrValue(doc, cur, null, 'grid') !== grid) apply(opSetAttr(doc, cur.id, null, 'grid', grid));
    // The shown guides, then the rest byte for byte (with no shown guide, from its first word on).
    const raw = shown === null ? (restLeft ? rest.replace(/^[ \t\n\r,]+/, '') : null) : restLeft ? `${shown}${rest}` : shown;
    if (raw === null) {
      if (had) apply(opSetAttr(doc, cur.id, null, 'guides', null));
    } else if (!had) apply(opSetAttr(doc, cur.id, null, 'guides', raw));
    else if (had.raw !== raw) apply(opSetAttrRaw(doc, cur.id, null, 'guides', raw));
    return;
  }
  const guides = shown;
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

/** Move guide `index` (of those readState lists) to `at`, rewriting only its number (the rest of the attribute keeps its bytes). */
export function moveGuide(doc: Doc, index: number, at: number, decimals: number, apply: Apply): void {
  const s = stateElement(doc);
  const a = s && findAttr(s, null, 'guides');
  if (!s || !a) return;
  const span = scanGuides(a.raw).spans[index];
  if (!span) return;
  const [start, end] = span;
  const text = fmt(at, decimals);
  if (a.raw.slice(start, end) === text) return;
  apply(opSetAttrRaw(doc, s.id, null, 'guides', rewriteNumbers(a.raw, [{ start, end, text }])));
}

/** The file without Draw's own state (the As-is export and Copy); the file itself when it has none. */
export function stripDrawState(doc: Doc): string {
  if (!hasDrawItems(doc) && boundPrefix(doc) === null) return serialize(doc);
  return stripNamespaces(doc, new Set([DRAW_NS])).text;
}
