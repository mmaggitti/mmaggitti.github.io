// The engine's code blocks (engine/code/blocks.ts) as the code view shows them. Pure: the view keeps
// only text, offsets and kinds, and the editor keeps the engine blocks by the same key to turn a
// tap or a scrub back into a token it can edit.
//
// Each block also says where it sits in the tree (its depth, and how it flows in the tidy view:
// layout.ts), and a colour token carries its swatch: the colour the engine read, as a hex colour
// (never the document's own text, so nothing the file writes reaches a style), or which keyword.

import type { Block } from '../../../../engine/code/blocks.ts';
import type { ColorToken } from '../../../../engine/code/tokens.ts';
import { toHex } from '../../../../engine/values/color.ts';
import type { Doc, ElementNode, Node, NodeId } from '../../../../engine/model/doc.ts';
import type { Flow, ViewBlock, ViewToken } from './code-view.ts';

/** A block's key: stable across edits, one per node and part ('12:start', '12:end', '13:leaf'). */
export const blockKey = (node: NodeId, part: Block['part']): string => `${node}:${part}`;

/** Which elements have mixed content, memoised over one listing. */
export type MixedMemo = Map<NodeId, boolean>;

const blank = (n: Node): boolean => n.kind === 'text' && /^[ \t\r\n]*$/.test(n.raw);

/** Mixed content: an element with a text or CDATA child that isn't only whitespace (<text>, <title>, <style>). */
function mixed(doc: Doc, id: NodeId | null, memo?: MixedMemo): boolean {
  if (id === null) return false;
  const known = memo?.get(id);
  if (known !== undefined) return known;
  const n = doc.nodes.get(id);
  const m = n?.kind === 'element' && n.children.some((c) => {
    const k = doc.nodes.get(c);
    return !!k && (k.kind === 'text' || k.kind === 'cdata') && !blank(k);
  });
  memo?.set(id, m);
  return m;
}

function depthOf(doc: Doc, n: Node): number {
  let d = 0;
  for (let p = n.parent; p !== null; p = doc.nodes.get(p)?.parent ?? null) d++;
  return d;
}

/**
 * How a block flows in the tidy view: on a line of its own ('line'), straight after the block
 * before it ('inline': inside mixed content, and an end tag with nothing but whitespace before it),
 * or not at all ('hidden': whitespace between elements, which the tidy view replaces with its own).
 */
function flowOf(doc: Doc, b: Block, n: Node, memo?: MixedMemo): Flow {
  const inMixed = mixed(doc, n.parent, memo);
  if (b.part === 'leaf') return inMixed ? 'inline' : blank(n) ? 'hidden' : 'line';
  if (b.part === 'start') return inMixed ? 'inline' : 'line';
  const e = n as ElementNode;
  const empty = e.children.every((c) => {
    const k = doc.nodes.get(c);
    return !!k && blank(k);
  });
  return inMixed || empty || mixed(doc, e.id, memo) ? 'inline' : 'line';
}

/** A colour token's swatch: '#rrggbb' ('#rrggbbaa' when translucent), or 'none', 'current' (currentColor) or 'context' (context-fill…). */
export function swatchOf(t: ColorToken): string {
  if (!t.color) return t.text.trim().toLowerCase() === 'none' ? 'none' : 'context';
  if (t.color.kind === 'current') return 'current';
  return toHex(t.color) ?? 'context';
}

export function viewBlock(doc: Doc, b: Block, memo?: MixedMemo): ViewBlock {
  const n = doc.nodes.get(b.node)!;
  const tokens = b.tokens.map((t): ViewToken => {
    const v: ViewToken = { start: t.start, end: t.end, kind: t.token.kind };
    if (t.token.kind === 'color') v.swatch = swatchOf(t.token);
    return v;
  });
  return { key: blockKey(b.node, b.part), node: b.node, part: b.part, text: b.text, tokens, depth: depthOf(doc, n), flow: flowOf(doc, b, n, memo) };
}

/**
 * Which tokens an edit changed, by index: the ones whose text differs, when everything else in the
 * block (the tokens' kinds and the text between them) is as it was. Null when the block changed
 * otherwise, so the whole block is new.
 */
export function changedTokens(a: ViewBlock, b: ViewBlock): number[] | null {
  if (a.tokens.length !== b.tokens.length) return null;
  const out: number[] = [];
  let ai = 0;
  let bi = 0;
  for (let i = 0; i < a.tokens.length; i++) {
    const s = a.tokens[i];
    const t = b.tokens[i];
    if (s.kind !== t.kind || a.text.slice(ai, s.start) !== b.text.slice(bi, t.start)) return null;
    if (a.text.slice(s.start, s.end) !== b.text.slice(t.start, t.end)) out.push(i);
    ai = s.end;
    bi = t.end;
  }
  return a.text.slice(ai) === b.text.slice(bi) ? out : null;
}
