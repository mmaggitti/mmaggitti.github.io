// Text to path's write (P1-M4 S2): each text becomes one <path> in its place (outline.ts reads it and
// says what refuses; this writes what it outlined).
//
// - The <path> is in the root's prefix and takes the <text>'s place, after its leading whitespace,
//   with the text's attributes in their order (their spelling kept) less the text-only ones (x, y,
//   dx, dy, rotate, textLength, lengthAdjust, the font-* attributes, text-anchor, the baselines,
//   letter- and word-spacing, writing-mode, direction, unicode-bidi, text-rendering,
//   text-decoration, xml:space; a style="" keeps its text, font declarations and all), then d, then
//   aria-label: the characters as laid out (outline.ts's label), escaped. Its id stays.
// - A text with its own <title> child moves the <title> (and its <desc>) into the path instead, and
//   the path gets no aria-label (a <title> names it). Anything else inside the text goes with it.
// - Glyphs are drawn nonzero: where the path would be evenodd (an ancestor's, or the text's own
//   fill-rule attribute), it says fill-rule="nonzero" (the attribute rewritten in place, or added
//   after the kept ones). outline.ts refuses evenodd set any other way.
// - writeTextToPath writes many texts in one transaction: one fragment parse per parent (parseFragment
//   reads the whole document), then each path in its text's place, the last first so every index
//   found before the first change still holds.

import { NS, el, serializeNode, type Doc, type NodeId } from '../model/doc.ts';
import { opInsert, opRemove, type Op } from '../commands/ops.ts';
import { parseFragment } from '../model/fragment.ts';
import { escape } from '../xml/entities.ts';
import { TokenEditError } from '../code/edit.ts';
import { shownValue, styleSource } from '../style/where.ts';

/** The attributes a path doesn't keep from the text it replaces (no namespace). */
export const TEXT_ONLY: ReadonlySet<string> = new Set([
  'x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust',
  'font-family', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style', 'font-variant', 'font-weight',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'letter-spacing', 'word-spacing',
  'writing-mode', 'direction', 'unicode-bidi', 'text-rendering', 'text-decoration',
]);

/** The children a path takes from the text: its own <title> and <desc>. */
const MOVES = new Set(['title', 'desc']);

// How the path comes out nonzero: as it is, its own fill-rule attribute rewritten, or one added.
function nonzero(doc: Doc, id: NodeId): 'keep' | 'rewrite' | 'add' {
  const shown = shownValue(doc, id, 'fill-rule').value;
  if (shown === null || shown.trim().toLowerCase() !== 'evenodd') return 'keep';
  return styleSource(doc, id, 'fill-rule').at === 'attr' ? 'rewrite' : 'add';
}

/** The <path> that takes the text's place (the module header): `d` its outline, `label` its characters as laid out. */
export function textPathMarkup(doc: Doc, id: NodeId, d: string, label: string): string {
  const n = el(doc, id);
  const prefix = el(doc, doc.root).prefix;
  const qname = prefix ? `${prefix}:path` : 'path';
  const rule = nonzero(doc, id);
  let s = `<${qname}`;
  for (const a of n.attrs) {
    if ((a.ns === null && TEXT_ONLY.has(a.local)) || (a.ns === NS.xml && a.local === 'space')) continue;
    const raw = rule === 'rewrite' && a.ns === null && a.local === 'fill-rule' ? 'nonzero' : a.raw;
    s += `${a.lead}${a.qname}${a.eq}${a.quote}${raw}${a.quote}`;
  }
  if (rule === 'add') s += ' fill-rule="nonzero"';
  s += ` d="${d}"`; // numbers, spaces and M, L, Q, C, Z: nothing to escape
  const moved = n.children.filter((c) => {
    const k = doc.nodes.get(c)!;
    return k.kind === 'element' && k.ns === NS.svg && MOVES.has(k.local);
  });
  if (!moved.some((c) => el(doc, c).local === 'title')) s += ` aria-label="${escape(label, '"')}"`;
  if (!moved.length) return `${s}${n.tail}/>`;
  return `${s}${n.tail}>${moved.map((c) => serializeNode(doc, c)).join('')}</${qname}${n.endTail}>`;
}

/** Write each text's path in its place (the module header), in one transaction's `apply`: the paths, in the order given. */
export function writeTextToPath(doc: Doc, items: readonly { id: NodeId; markup: string }[], apply: (op: Op) => void): NodeId[] {
  const byParent = new Map<NodeId, { id: NodeId; markup: string }[]>();
  for (const it of items) {
    const p = doc.nodes.get(it.id)!.parent!;
    const list = byParent.get(p);
    if (list) list.push(it);
    else byParent.set(p, [it]);
  }
  const made = new Map<NodeId, NodeId>();
  for (const [parent, list] of byParent) {
    const index = new Map(el(doc, parent).children.map((c, i) => [c, i] as const));
    const r = parseFragment(doc, parent, list.map((x) => x.markup).join(''));
    if (!r.ok) throw new TokenEditError(r.error.message);
    const paths = r.nodes.filter((n) => doc.nodes.get(n)?.kind === 'element');
    const order = list.map((x, i) => ({ text: x.id, path: paths[i], at: index.get(x.id)! })).sort((a, b) => b.at - a.at);
    for (const o of order) {
      apply(opInsert(doc, o.path, parent, o.at));
      apply(opRemove(doc, o.text));
      made.set(o.text, o.path);
    }
  }
  return items.map((it) => made.get(it.id)!);
}
