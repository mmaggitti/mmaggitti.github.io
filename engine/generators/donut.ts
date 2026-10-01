// The donut (P1-M3): SVG Lab's Arcs lesson in donut mode, as a generator whose data lives in a
// comment. A holder (an SVG <g>, or the root <svg>) carries draw:gen="donut" and its centre and
// radius; its children, whitespace aside, are the data comment and then one <path> per value:
//
//   <g draw:gen="donut" draw:cx="50" draw:cy="50" draw:r="28">
//     <!-- data: 40, 25, 20, 15 -->
//     <path d="M 50 22 A 28 28 0 0 1 66.5 72.7" fill="none" stroke="#e76f51" stroke-width="14"/>
//     …
//   </g>
//
// - The data comment's raw is exactly `<!-- data: ` + the values joined by `, ` + ` -->`: 2 to 12
//   values, each a whole number from 1 to 100 written plainly (SVG Lab's tokens).
// - Slice i is `M sx sy A R R 0 L 1 ex ey`: it starts at the top and runs clockwise, its angles taken
//   from the running total exactly as SVG Lab computes them, each coordinate rounded as the lab
//   rounds (Math.round(v · 10) / 10, half up) and written with fmt(·, 1); R is fmt(r, 2), and the
//   large-arc flag is 1 only when the slice is over half the total. So generating from
//   lab/arcs--donut.svg's comment with centre (50, 50) and r 28 gives its four paths byte for byte.
// - donutOf says whether a holder IS a donut now: every input valid, the comment read, one slice per
//   value, and every slice's d exactly what they generate. Anything else is plain: its draw:*
//   attributes are kept untouched, and its comment is a plain comment. The slices' other attributes
//   (their colours) are theirs.
// - donutCandidate is Edit as donut's rule: a holder without draw:gen whose children read as a donut's
//   when its centre and radius are taken from the first slice (SVG Lab's own export, the root of
//   lab/arcs--donut.svg). The finish hook (index.ts, GROUP_GENERATORS) regenerates or detaches a donut.

import { NS, attrValue, findAttr, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { DRAW_NS } from '../model/draw-ns.ts';
import { fmt } from '../values/number-format.ts';
import { parsePath } from '../path/parse.ts';

export const VALUE_MIN = 1;
export const VALUE_MAX = 100;
export const SLICES_MIN = 2;
export const SLICES_MAX = 12;
/** The donut's draw: inputs on its holder, in order. */
export const DONUT_INPUTS = ['cx', 'cy', 'r'] as const;

const HEAD = '<!-- data: ';
const TAIL = ' -->';
const VALUE = /^(?:[1-9]\d?|100)$/; // a whole number from 1 to 100, written plainly
const PLAIN = /^-?(?:\d+|\d*\.\d+)$/; // an input, as Draw writes one (M2's rule)

export interface DataRead {
  values: number[];
  spans: { start: number; end: number }[]; // each value's span in the comment's raw text (which includes `<!--`)
}

/** A data comment's values and their spans, or null when the raw text isn't exactly a data comment. */
export function readData(raw: string): DataRead | null {
  if (!raw.startsWith(HEAD) || !raw.endsWith(TAIL) || raw.length <= HEAD.length + TAIL.length) return null;
  const parts = raw.slice(HEAD.length, raw.length - TAIL.length).split(', ');
  if (parts.length < SLICES_MIN || parts.length > SLICES_MAX) return null;
  const out: DataRead = { values: [], spans: [] };
  let at = HEAD.length;
  for (const p of parts) {
    if (!VALUE.test(p)) return null;
    out.values.push(Number(p));
    out.spans.push({ start: at, end: at + p.length });
    at += p.length + 2;
  }
  return out;
}

/** A data comment's raw text for these values. */
export const dataRaw = (values: readonly number[]): string => `${HEAD}${values.join(', ')}${TAIL}`;

/**
 * The element's data comment: its first child (whitespace-only text aside) when that is a comment
 * reading as data, else null. Only it can be a donut's data comment, so only it asks whether its
 * holder is a donut (each ask walks the holder's children).
 */
export function dataCommentOf(doc: Doc, id: NodeId | null | undefined): NodeId | null {
  const n = id === null || id === undefined ? undefined : doc.nodes.get(id);
  if (n?.kind !== 'element') return null;
  for (const c of n.children) {
    const k = doc.nodes.get(c);
    if (k?.kind === 'text' && /^[ \t\r\n]*$/.test(k.raw)) continue;
    return k?.kind === 'comment' && readData(k.raw) ? c : null;
  }
  return null;
}

const lab1 = (v: number): number => Math.round(v * 10) / 10; // SVG Lab's rnd(v, 1)

/** Each slice's d for these values, centre and radius (the header's rule, SVG Lab's arithmetic). */
export function donutSlices(values: readonly number[], cx: number, cy: number, r: number): string[] {
  const S = values.reduce((a, b) => a + b, 0);
  const R = fmt(r, 2);
  const at = (a: number) => `${fmt(lab1(cx + r * Math.cos(a)), 1)} ${fmt(lab1(cy + r * Math.sin(a)), 1)}`;
  const out: string[] = [];
  let acc = 0;
  for (const v of values) {
    const a0 = -Math.PI / 2 + (acc / S) * 2 * Math.PI;
    acc += v;
    const a1 = -Math.PI / 2 + (acc / S) * 2 * Math.PI;
    out.push(`M ${at(a0)} A ${R} ${R} 0 ${v / S > 0.5 ? 1 : 0} 1 ${at(a1)}`);
  }
  return out;
}

/** An element that may hold a donut: an SVG <g>, or the root <svg>. */
export function isDonutHolder(doc: Doc, n: ElementNode): boolean {
  return n.ns === NS.svg && (n.local === 'g' || (n.id === doc.root && n.local === 'svg'));
}

export interface DonutParts {
  comment: NodeId;
  data: DataRead;
  slices: NodeId[];
}

/** A holder's children read as a donut's: first the data comment, then only <path>s (whitespace-only text aside); else null. */
export function donutParts(doc: Doc, holder: ElementNode): DonutParts | null {
  let comment: NodeId | null = null;
  let raw = '';
  const slices: NodeId[] = [];
  for (const c of holder.children) {
    const n = doc.nodes.get(c)!;
    if (n.kind === 'text' && /^[ \t\r\n]*$/.test(n.raw)) continue;
    if (comment === null) {
      if (n.kind !== 'comment') return null;
      comment = n.id;
      raw = n.raw;
      continue;
    }
    if (n.kind !== 'element' || n.ns !== NS.svg || n.local !== 'path') return null;
    slices.push(n.id);
  }
  const data = comment === null ? null : readData(raw);
  return comment !== null && data ? { comment, data, slices } : null;
}

/** The holder's draw:cx, draw:cy and draw:r, or null when one is missing or invalid (plain decimals, r > 0). */
export function donutInputs(doc: Doc, holder: ElementNode): { cx: number; cy: number; r: number } | null {
  const out: Record<string, number> = {};
  for (const name of DONUT_INPUTS) {
    const raw = attrValue(doc, holder, DRAW_NS, name)?.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
    if (raw === undefined || !PLAIN.test(raw)) return null;
    const v = Number(raw);
    if (!Number.isFinite(v) || (name === 'r' && !(v > 0))) return null;
    out[name] = v;
  }
  return { cx: out.cx, cy: out.cy, r: out.r };
}

export interface Donut extends DonutParts {
  holder: NodeId;
  values: number[];
  cx: number;
  cy: number;
  r: number;
}

const dOf = (doc: Doc, id: NodeId): string | null => {
  const n = doc.nodes.get(id);
  return n?.kind === 'element' ? attrValue(doc, n, null, 'd') : null;
};

/** The holder's donut when it is one now (see the header), else null: plain. Reading never changes the file. */
export function donutOf(doc: Doc, holderId: NodeId): Donut | null {
  const n = doc.nodes.get(holderId);
  if (!n || n.kind !== 'element' || !isDonutHolder(doc, n) || attrValue(doc, n, DRAW_NS, 'gen')?.trim() !== 'donut') return null;
  const inputs = donutInputs(doc, n);
  const parts = inputs && donutParts(doc, n);
  if (!inputs || !parts || parts.slices.length !== parts.data.values.length) return null;
  const want = donutSlices(parts.data.values, inputs.cx, inputs.cy, inputs.r);
  if (!parts.slices.every((s, i) => dOf(doc, s) === want[i])) return null;
  return { holder: holderId, values: parts.data.values, ...parts, ...inputs };
}

/** The donut a selected element belongs to: its own (a holder), or its parent's (a slice). */
export function donutFor(doc: Doc, id: NodeId): Donut | null {
  const own = donutOf(doc, id);
  if (own) return own;
  const n = doc.nodes.get(id);
  const d = n?.kind === 'element' && n.parent !== null ? donutOf(doc, n.parent) : null;
  return d && d.slices.includes(id) ? d : null;
}

export interface DonutCandidate {
  holder: NodeId;
  values: number[];
  cx: number;
  cy: number;
  r: number;
}

/**
 * Edit as donut's candidate: a holder without draw:gen whose children are a data comment and one
 * <path> per value, the first reading `M sx sy A r r 0 L 1 ex ey` (absolute, rx = ry = r > 0), and
 * every one exactly what (values, cx = sx, cy = sy + r, r) generates, those inputs as Draw would
 * write them (fmt(·, 2)): the finish hook then keeps every slice byte for byte. Else null.
 */
export function donutCandidate(doc: Doc, holderId: NodeId): DonutCandidate | null {
  const n = doc.nodes.get(holderId);
  if (!n || n.kind !== 'element' || !isDonutHolder(doc, n) || findAttr(n, DRAW_NS, 'gen')) return null;
  const parts = donutParts(doc, n);
  if (!parts || parts.slices.length !== parts.data.values.length) return null;
  const d0 = dOf(doc, parts.slices[0]);
  const p = d0 === null ? null : parsePath(d0);
  if (!p || p.error || p.segs.length !== 2 || p.segs[0].cmd !== 'M' || p.segs[1].cmd !== 'A') return null;
  const [sx, sy] = p.segs[0].args;
  const [rx, ry, rot, , sweep] = p.segs[1].args;
  if (!(rx > 0) || rx !== ry || rot !== 0 || sweep !== 1) return null;
  const cx = Number(fmt(sx, 2));
  const cy = Number(fmt(sy + rx, 2));
  const r = Number(fmt(rx, 2));
  if (!(r > 0)) return null;
  const want = donutSlices(parts.data.values, cx, cy, r);
  if (!parts.slices.every((s, i) => dOf(doc, s) === want[i])) return null;
  return { holder: holderId, values: parts.data.values, cx, cy, r };
}

/** The candidate a selected element offers (its own holder, or its parent as a slice's). */
export function donutCandidateFor(doc: Doc, id: NodeId): DonutCandidate | null {
  const own = donutCandidate(doc, id);
  if (own) return own;
  const n = doc.nodes.get(id);
  const c = n?.kind === 'element' && n.parent !== null ? donutCandidate(doc, n.parent) : null;
  return c && donutParts(doc, doc.nodes.get(c.holder) as ElementNode)!.slices.includes(id) ? c : null;
}
