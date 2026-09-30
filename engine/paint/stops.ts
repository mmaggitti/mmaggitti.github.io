// The stop editor's planners (P1-M2): a stop's offset, a stop added at the midpoint after another,
// and a stop removed. A stop's offset is its own attribute (not CSS), written with only its
// number's characters changed, so a percentage stays one; stop-color and stop-opacity go through
// the style writer (style/write.ts: the stop's style="", as Inkscape writes them, or its
// attributes). The stops a gradient draws with are those of the first element in its template
// chain that has any (gradients.ts stopsFrom), and the editor works on those.

import { NS, attrValue, el, findAttr, type Doc, type NodeId } from '../model/doc.ts';
import { opSetAttr, opSetAttrRaw, type Op } from '../commands/ops.ts';
import { rewriteNumbers, TokenEditError } from '../code/edit.ts';
import { insertMarkup, removeWithSpace } from '../model/space.ts';
import { alphaIsPercent, clampRgb, notationOf, parseColor, writeColor } from '../values/color.ts';
import { fmt } from '../values/number-format.ts';
import { escape } from '../xml/entities.ts';
import { styleSource } from '../style/where.ts';
import type { Resolved } from './gradients.ts';

type Apply = (op: Op) => void;

const NUMBER = /[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/;

/** A stop's offset as the gradient draws with it: 0–1 (a percentage read as its fraction, clamped), 0 when absent or unreadable. */
export function stopOffset(doc: Doc, stop: NodeId): number {
  const v = attrValue(doc, el(doc, stop), null, 'offset');
  const m = v === null ? null : /^\s*([+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?)(%?)\s*$/.exec(v);
  if (!m) return 0;
  const n = Number(m[1]) / (m[2] ? 100 : 1);
  return Math.min(1, Math.max(0, n));
}

/** Is the stop's offset written as a percentage? */
export const offsetIsPercent = (doc: Doc, stop: NodeId): boolean => /%\s*$/.test(attrValue(doc, el(doc, stop), null, 'offset') ?? '');

/** The text of an offset `v` (0–1) as this stop writes one: a percentage stays one. */
export function offsetText(doc: Doc, stop: NodeId, v: number): string {
  return offsetIsPercent(doc, stop) ? `${fmt(v * 100, 2)}%` : fmt(v, 4);
}

/**
 * The op that sets a stop's offset to `v` (0–1): only the number's characters of the attribute
 * (its % kept), or the attribute added. Refused (TokenEditError) for a value outside 0–1.
 */
export function offsetOp(doc: Doc, stop: NodeId, v: number): Op {
  if (!(v >= 0 && v <= 1)) throw new TokenEditError('An offset is from 0 to 1');
  const a = findAttr(el(doc, stop), null, 'offset');
  const text = offsetIsPercent(doc, stop) ? fmt(v * 100, 2) : fmt(v, 4);
  const m = a && !a.raw.includes('&') ? NUMBER.exec(a.raw) : null;
  if (a && m) return opSetAttrRaw(doc, stop, null, 'offset', rewriteNumbers(a.raw, [{ start: m.index, end: m.index + m[0].length, text }]));
  return opSetAttr(doc, stop, null, 'offset', offsetText(doc, stop, v));
}

/** A stop's colour and opacity as the gradient draws them (black and 1 when a value doesn't read). */
function stopPaint(doc: Doc, stop: NodeId): { rgb: [number, number, number]; alpha: number; text: string; opacity: number } {
  const text = styleSource(doc, stop, 'stop-color').value ?? 'black';
  const c = parseColor(text);
  const rgb = c && c.kind === 'color' ? clampRgb(c) : { r: 0, g: 0, b: 0 };
  const o = Number(styleSource(doc, stop, 'stop-opacity').value ?? '1');
  return { rgb: [rgb.r, rgb.g, rgb.b], alpha: c && c.kind === 'color' ? c.alpha : 1, text, opacity: Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 1 };
}

/**
 * Add a stop after `after` (else the last stop): at the midpoint between its offset and the next
 * stop's (or 1), coloured as the gradient is there (the neighbours mixed in sRGB, written in the
 * first neighbour's notation family; past the last stop, its colour), with the insertion rule's
 * whitespace. Returns the new stop.
 */
export function addStop(doc: Doc, r: Resolved, after: NodeId | null, apply: Apply): NodeId {
  const stops = r.stops;
  const q = el(doc, doc.root).prefix ? `${el(doc, doc.root).prefix}:stop` : 'stop';
  if (!stops.length || r.stopsFrom === null) return insertMarkup(doc, { last: r.id }, `<${q} offset="0" stop-color="black"/>`, apply);
  const a = after !== null && stops.includes(after) ? after : stops[stops.length - 1];
  const i = stops.indexOf(a);
  const b = stops[i + 1] ?? null;
  const o1 = stopOffset(doc, a);
  const o2 = b === null ? 1 : Math.max(o1, stopOffset(doc, b));
  const mid = (o1 + o2) / 2;
  const p = stopPaint(doc, a);
  const n = b === null ? p : stopPaint(doc, b);
  const t = b === null ? 0 : 0.5;
  const mix = (x: number, y: number) => x + (y - x) * t;
  const c1 = parseColor(p.text);
  const family = c1 && c1.kind === 'color' ? notationOf(c1) : 'hex';
  const colour = writeColor([mix(p.rgb[0], n.rgb[0]), mix(p.rgb[1], n.rgb[1]), mix(p.rgb[2], n.rgb[2])], mix(p.alpha, n.alpha), family, c1 ? alphaIsPercent(c1) : false);
  const opacity = mix(p.opacity, n.opacity);
  const markup = `<${q} offset="${offsetText(doc, a, mid)}" stop-color="${escape(colour, '"')}"${opacity < 1 ? ` stop-opacity="${fmt(opacity, 2)}"` : ''}/>`;
  return insertMarkup(doc, { after: a }, markup, apply);
}

export const LAST_STOP = 'A gradient keeps at least one stop.';

/** Remove a stop with the whitespace before it; refused while it is the only one. */
export function removeStop(doc: Doc, r: Resolved, stop: NodeId, apply: Apply): void {
  if (r.stops.length <= 1) throw new TokenEditError(LAST_STOP);
  if (!r.stops.includes(stop)) throw new TokenEditError('That stop isn’t one this gradient draws with.');
  removeWithSpace(doc, stop, apply);
}

/** Is `id` a stop element? */
export const isStopElement = (doc: Doc, id: NodeId): boolean => {
  const n = doc.nodes.get(id);
  return n?.kind === 'element' && n.ns === NS.svg && n.local === 'stop';
};
