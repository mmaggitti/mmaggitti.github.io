// The lines model (P1-M4): a <text> Draw edits as lines (the Text sheet's lines mode, the Text tool's
// "Hello", the ContextBar's Edit text), in SVG Lab's Typography spelling (LabType: each line a tspan
// at the text's own x, `dy` in em, the first 0em and the rest 1.3em).
//
// A <text> is lines when it is one of:
// (a) empty, or holding exactly one text node with no line break: one line, its text;
// (b) holding only <tspan> children with nothing between them, each tspan's attributes exactly x
//     then dy (x the same text as the <text>'s own x, a single number; dy 0em for the first and
//     1.3em for the rest), each empty or holding exactly one text node without a line break: one
//     line per tspan.
// Neither may have position lists (two or more numbers in its x, y, dx, dy or rotate): they place
// each character, so a line written there would draw elsewhere. A text node qualifies when Draw
// writes it back byte for byte: its only references are the ones
// P0's Text sheet writes (&amp;, &lt; and &gt; in ]]&gt;), never CDATA or another entity. Anything
// else (SVG Lab's own Typography file, whose tspans carry fonts and fills; spaces between tspans;
// a text with position lists) isn't lines: its runs are edited by P0's text tokens.
//
// Writing lines (planLines, one call per keystroke inside the sheet's one drag): one line is the
// text's content as one text node (the node kept, its raw text rewritten, when it has one); two or
// more are `<tspan x="X" dy="0em">L1</tspan><tspan x="X" dy="1.3em">L2</tspan>…` with nothing
// between them (whitespace there lays out as a space, which moves a middle-anchored line), X the
// <text>'s own x text, under the text's own prefix. Each line is escaped as P0's Text sheet escapes
// it. The <text>'s own attributes and bytes stay; only its content changes.

import { NS, attrValue, el, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { opInsert, opRemove, opSetLeafRaw, type Op } from '../commands/ops.ts';
import { parseFragment } from '../model/fragment.ts';
import { decodeText, escape } from '../xml/entities.ts';
import { TokenEditError, xmlCharError } from '../code/edit.ts';
import { tokenizeAttrRaw } from '../code/tokens.ts';
import { parseNumberList } from '../values/number-format.ts';

/** SVG Lab's line spacing (LabType L2628): each line after the first moves down 1.3em. */
export const LINE_DY = '1.3em';
export const FIRST_DY = '0em';
/** Why a text with no single-number x can't take lines. */
export const NO_X = 'Draw writes lines at the text’s own x, and this text has no single x.';
/** Why a text that isn't lines can't be written as lines. */
export const NOT_LINES = 'Edit this text’s runs in the code: Draw writes lines only in its own spelling.';

const isText = (n: ElementNode) => n.ns === NS.svg && n.local === 'text';

// The decoded text of a leaf Draw writes back exactly as it is, or null.
function lineOf(doc: Doc, id: NodeId): string | null {
  const n = doc.nodes.get(id);
  if (n?.kind !== 'text') return null;
  const t = decodeText(n.raw, doc.entities);
  return /[\n\r]/.test(t) || escape(t, null) !== n.raw ? null : t;
}

// The text's own x when it is a single number (its raw text), else null.
function ownX(doc: Doc, n: ElementNode): string | null {
  const a = n.attrs.find((x) => x.ns === null && x.local === 'x');
  if (!a || a.raw.includes('&')) return null;
  const tokens = tokenizeAttrRaw(doc, n, { ns: null, local: 'x' }, a.raw);
  return tokens.length === 1 && tokens[0].kind === 'number' && a.raw.trim() === tokens[0].text + (tokens[0].unit ?? '') ? a.raw : null;
}

// Does the text hold a position list (or a position that doesn't read as numbers)?
function positionLists(doc: Doc, n: ElementNode): boolean {
  return ['x', 'y', 'dx', 'dy', 'rotate'].some((local) => {
    const v = attrValue(doc, n, null, local);
    if (v === null) return false;
    const list = parseNumberList(v.replace(/(\d)(px|pt|pc|mm|cm|in|em|ex|rem|%)/gi, '$1'));
    return list === null || list.length > 1;
  });
}

/** The text's lines, when Draw can edit it as lines (see the header); else null. */
export function readLines(doc: Doc, id: NodeId): string[] | null {
  const n = doc.nodes.get(id);
  if (n?.kind !== 'element' || !isText(n) || positionLists(doc, n)) return null;
  const kids = n.children.map((c) => doc.nodes.get(c)!);
  if (!kids.length) return [''];
  if (kids.length === 1 && kids[0].kind === 'text') {
    const t = lineOf(doc, kids[0].id);
    return t === null ? null : [t];
  }
  const x = ownX(doc, n);
  if (x === null) return null;
  const lines: string[] = [];
  for (const [i, k] of kids.entries()) {
    if (k.kind !== 'element' || k.ns !== NS.svg || k.local !== 'tspan') return null;
    const [ax, ady] = k.attrs;
    if (k.attrs.length !== 2 || ax.ns !== null || ax.local !== 'x' || ady.ns !== null || ady.local !== 'dy') return null;
    if (ax.raw !== x || ady.raw !== (i ? LINE_DY : FIRST_DY)) return null;
    if (!k.children.length) {
      lines.push('');
      continue;
    }
    if (k.children.length !== 1) return null;
    const t = lineOf(doc, k.children[0]);
    if (t === null) return null;
    lines.push(t);
  }
  return lines;
}

/** Why these lines can't be written into this text, or null. */
export function linesError(doc: Doc, id: NodeId, lines: readonly string[]): string | null {
  if (readLines(doc, id) === null) return NOT_LINES;
  for (const l of lines) {
    if (/[\n\r]/.test(l)) return 'A line can’t hold a line break.';
    const why = xmlCharError(l);
    if (why) return why;
  }
  if (lines.length > 1 && ownX(doc, el(doc, id)) === null) return NO_X;
  return null;
}

/** The markup of the text's content for these lines (see the header). */
export function linesMarkup(doc: Doc, id: NodeId, lines: readonly string[]): string {
  if (lines.length === 1) return escape(lines[0], null);
  const n = el(doc, id);
  const tag = n.prefix ? `${n.prefix}:tspan` : 'tspan';
  const x = ownX(doc, n)!;
  return lines.map((l, i) => `<${tag} x="${x}" dy="${i ? LINE_DY : FIRST_DY}">${escape(l, null)}</${tag}>`).join('');
}

/**
 * Write `lines` as the text's content (see the header): nothing when they are the lines it holds
 * now; the one text node's raw text rewritten for one line over one; else its children taken away
 * and the new content put in, from one fragment parse. Refused (TokenEditError, linesError's words)
 * before anything is written.
 */
export function planLines(doc: Doc, id: NodeId, lines: readonly string[], apply: (op: Op) => void): void {
  const why = linesError(doc, id, lines);
  if (why) throw new TokenEditError(why);
  const now = readLines(doc, id)!;
  if (now.length === lines.length && now.every((l, i) => l === lines[i])) return;
  const n = el(doc, id);
  const only = n.children.length === 1 ? doc.nodes.get(n.children[0]) : undefined;
  if (lines.length === 1 && only?.kind === 'text' && lines[0] !== '') return apply(opSetLeafRaw(doc, only.id, escape(lines[0], null)));
  for (let i = n.children.length - 1; i >= 0; i--) apply(opRemove(doc, n.children[i]));
  if (lines.length === 1 && lines[0] === '') return;
  const made = parseFragment(doc, id, linesMarkup(doc, id, lines));
  if (!made.ok) throw new TokenEditError(made.error.message);
  made.nodes.forEach((c, i) => apply(opInsert(doc, c, id, i)));
}
