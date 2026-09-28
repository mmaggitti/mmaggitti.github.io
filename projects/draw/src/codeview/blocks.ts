// The engine's code blocks (engine/code/blocks.ts) as the code view shows them. Pure: the view keeps
// only text, offsets and kinds, and the editor keeps the engine blocks by the same key to turn a
// tap or a scrub back into a token it can edit.

import type { Block } from '../../../../engine/code/blocks.ts';
import type { NodeId } from '../../../../engine/model/doc.ts';
import type { ViewBlock } from './code-view.ts';

/** A block's key: stable across edits, one per node and part ('12:start', '12:end', '13:leaf'). */
export const blockKey = (node: NodeId, part: Block['part']): string => `${node}:${part}`;

export function viewBlock(b: Block): ViewBlock {
  return { key: blockKey(b.node, b.part), node: b.node, text: b.text, tokens: b.tokens.map((t) => ({ start: t.start, end: t.end, kind: t.token.kind })) };
}
