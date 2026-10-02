// The Insert tool's plan (P1-M5): another SVG file, or a fragment of markup, put into the open drawing
// as ONE <g> (SVG Lab's paste-shapes, where Draw keeps every element editable and has no raw items).
// Pure: it reads the document and returns the markup; the editor inserts it with the insertion rule
// (model/space.ts insertMarkup), which also charges what it adds to the document's remaining limits.
//
// 1. The text is parsed by the engine's parser. One with no <svg is wrapped as SVG Lab wraps a paste,
//    <svg xmlns="http://www.w3.org/2000/svg">…</svg>. A file that isn't well-formed is refused with the
//    parser's words and where (line and column); a root that isn't SVG's <svg> is refused. Its entity
//    references are written out as their values (escaped, with character references only), so what is
//    inserted never depends on a DOCTYPE: the file's own is left behind, and the drawing's may declare
//    the same names differently. One Draw can't expand (an external entity) refuses the insert.
// 2. Every id it uses that the document already uses gets a fresh one (ids.ts freshId, as Duplicate's
//    copies do), and its references inside the inserted content follow it: in attributes (renameIdsIn)
//    and in a <style> it brings (renameIdsInStyles: url(#…) and #id selectors). The <style> itself is
//    kept, so the inserted art looks as it did; its rules apply to the whole drawing (the editor's
//    caller says so).
// 3. The markup is one <g> holding the inserted root's children as written. The <g> takes the root's
//    attributes but its namespace declarations, id, width, height, x, y, viewBox, preserveAspectRatio,
//    version and baseProfile (so a stroke icon's fill="none" stroke="currentColor" still reaches its
//    paths); the namespace declarations its content needs that the document's root doesn't bind the
//    same way; and transform="translate(tx ty) scale(s)", which puts the inserted viewBox (or its width
//    and height) centred on `at` at its own size in the document's user units; one larger than the
//    artboard is scaled down uniformly to 80% of it (one the artboard's size, SVG Lab's 100-unit board
//    into a 100-unit drawing, keeps its size). An identity part is left out (all of it: no
//    transform). A root's own transform (SVG 2) comes after Draw's placement. A fragment with no viewBox
//    and no size stays where its markup puts it.

import { NS, descendants, el, parseDoc, serializeNode, type Attr, type Doc, type ElementNode } from './doc.ts';
import { freshId, idsInUse, renameIdsIn, renameIdsInStyles } from './ids.ts';
import { decodeAttr, decodeText, escape, newBudget } from '../xml/entities.ts';
import { opSetAttrRaw, opSetLeafRaw } from '../commands/ops.ts';
import { parseLength, toUserUnits } from '../values/length.ts';
import { parseViewBox } from '../values/viewbox.ts';
import { fmt } from '../values/number-format.ts';

export interface InsertPlan {
  /** One <g>, the markup to insert. */
  markup: string;
  /** How many ids were renamed because the document already used them. */
  renamed: number;
}

/** What the <g> doesn't take from the inserted root: its place and size are Draw's placement now. */
const LEFT_OFF = new Set(['id', 'width', 'height', 'x', 'y', 'viewBox', 'preserveAspectRatio', 'version', 'baseProfile', 'transform']);
const WRAP_HEAD = '<svg xmlns="http://www.w3.org/2000/svg">';
/** How much of the artboard an insert larger than it is scaled down to. */
export const INSERT_MAX_SHARE = 0.8;

/** 1-based line and column of an offset (CRLF, CR and LF each end a line). */
function lineColumn(text: string, at: number): { line: number; column: number } {
  const lines = text.slice(0, at).split(/\r\n|\r|\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

// A root length in user units, or null (missing, a percentage, em or ex).
function length(doc: Doc, root: ElementNode, name: 'width' | 'height'): number | null {
  const a = root.attrs.find((x) => x.ns === null && x.local === name);
  const len = a ? parseLength(decodeAttr(a.raw, doc.entities)) : null;
  const v = len && toUserUnits(len);
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

const written = (a: Attr) => ` ${a.qname}=${a.quote}${a.raw}${a.quote}`;

// A decoded value written so that it reads back the same with no DOCTYPE: escaped for its quote (or as
// text), and the whitespace a character reference made kept as one (a literal tab, line feed or
// carriage return reads back as a space in an attribute, and a carriage return as a line feed in text).
const asWritten = (value: string, quote: '"' | "'" | null): string =>
  escape(value, quote).replace(quote === null ? /\r/g : /[\t\n\r]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Every attribute value and text node of `src` holding a reference, as its value written out; the names it can't expand. */
function expandReferences(src: Doc): Set<string> {
  const unresolved = new Set<string>();
  const budget = newBudget();
  for (const n of [...descendants(src, src.root)]) {
    if (n.kind === 'element') {
      for (const a of n.attrs) if (a.raw.includes('&')) opSetAttrRaw(src, n.id, a.ns, a.local, asWritten(decodeAttr(a.raw, src.entities, budget, unresolved), a.quote));
    } else if (n.kind === 'text' && n.raw.includes('&')) opSetLeafRaw(src, n.id, asWritten(decodeText(n.raw, src.entities, budget, unresolved), null));
  }
  return unresolved;
}

/** Does the document's root bind namespace prefix `prefix` ('' for the default) to `uri`? */
function binds(doc: Doc, prefix: string, uri: string): boolean {
  const root = el(doc, doc.root);
  const a = root.attrs.find((x) => x.ns === NS.xmlns && (prefix === '' ? x.prefix === null && x.local === 'xmlns' : x.prefix === 'xmlns' && x.local === prefix));
  return !!a && decodeAttr(a.raw, doc.entities) === uri;
}

/**
 * The plan for inserting `text` into `doc`, centred on `at` (root user units: the point at the
 * canvas's centre), within `board` (the artboard, or null), or why it can't be inserted.
 */
export function planInsert(doc: Doc, text: string, at: { x: number; y: number }, board: { width: number; height: number } | null): InsertPlan | { refused: string } {
  const wrap = !/<svg[\s>/]/i.test(text);
  const source = wrap ? `${WRAP_HEAD}${text}</svg>` : text;
  const parsed = parseDoc(source);
  if (!parsed.ok) {
    const at0 = Math.min(Math.max(0, parsed.error.at - (wrap ? WRAP_HEAD.length : 0)), text.length);
    const { line, column } = lineColumn(text, at0);
    return { refused: `That SVG can’t be read (line ${line}, column ${column}): ${parsed.error.message}` };
  }
  const src = parsed.doc;
  const root = el(src, src.root);
  if (root.ns !== NS.svg || root.local !== 'svg') return { refused: `Only SVG can be inserted, and this file’s root is <${root.qname}>.` };
  const unresolved = expandReferences(src);
  if (unresolved.size) return { refused: `That SVG uses the entity &${[...unresolved][0]}; from outside the file, which Draw can’t expand, so it can’t be inserted.` };

  // Ids the document already uses: fresh ones, with their references inside the insert.
  const used = idsInUse(doc);
  const theirs = idsInUse(src);
  const taken = new Set(theirs);
  const map = new Map<string, string>();
  for (const id of theirs) {
    if (!used.has(id)) continue;
    const to = freshId(doc, id, taken, used);
    taken.add(to);
    map.set(id, to);
  }
  renameIdsIn(src, src.root, map, () => {});
  renameIdsInStyles(src, src.root, map, () => {});

  // The <g>: the root's attributes it keeps, the namespace declarations its content needs, and the placement.
  let attrs = '';
  for (const a of root.attrs) {
    if (a.ns === NS.xmlns) {
      const prefix = a.local === 'xmlns' && a.prefix === null ? '' : a.local;
      if (!binds(doc, prefix, decodeAttr(a.raw, src.entities))) attrs += written(a);
    } else if (!(a.ns === null && LEFT_OFF.has(a.local))) attrs += written(a);
  }
  const placement = place(src, root, at, board);
  const own = root.attrs.find((x) => x.ns === null && x.local === 'transform');
  const transform = [placement, own ? decodeAttr(own.raw, src.entities).trim() : ''].filter(Boolean).join(' ');
  if (transform) attrs += ` transform="${transform.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
  const inner = root.children.map((c) => serializeNode(src, c)).join('');
  return { markup: `<g${attrs}>${inner}</g>`, renamed: map.size };
}

// translate(tx ty) scale(s) for the inserted root's box centred on `at`, or '' (the identity, or no box).
function place(src: Doc, root: ElementNode, at: { x: number; y: number }, board: { width: number; height: number } | null): string {
  const vbAttr = root.attrs.find((x) => x.ns === null && x.local === 'viewBox');
  const parsedBox = vbAttr ? parseViewBox(decodeAttr(vbAttr.raw, src.entities)) : null;
  const vb = parsedBox === 'disabled' ? null : parsedBox;
  const w = length(src, root, 'width');
  const h = length(src, root, 'height');
  const box = vb ? { x: vb.x, y: vb.y, width: vb.w, height: vb.h } : w !== null && h !== null ? { x: 0, y: 0, width: w, height: h } : null;
  if (!box || !(box.width > 0 && box.height > 0)) return '';
  // Its own size: width and height where both are written, else the viewBox's.
  let s = vb && w !== null && h !== null ? Math.min(w / box.width, h / box.height) : 1;
  if (board && board.width > 0 && board.height > 0 && (box.width * s > board.width || box.height * s > board.height)) {
    s *= Math.min((INSERT_MAX_SHARE * board.width) / (box.width * s), (INSERT_MAX_SHARE * board.height) / (box.height * s));
  }
  const tx = at.x - s * (box.x + box.width / 2);
  const ty = at.y - s * (box.y + box.height / 2);
  const parts: string[] = [];
  if (fmt(tx) !== '0' || fmt(ty) !== '0') parts.push(`translate(${fmt(tx)} ${fmt(ty)})`);
  if (fmt(s, 6) !== '1') parts.push(`scale(${fmt(s, 6)})`);
  return parts.join(' ');
}
