// The Layers tab's rows (panels/Layers.tsx), pure so node can test them: every element but the
// root, topmost first within each parent (the reverse of document order, as the canvas stacks them),
// with its depth, its name (#id, else <tag>), and whether it is hidden or locked. A shape inside a
// locked group is locked too, by the group: its row says so, and names the group.

import { attrValue, type Doc, type ElementNode, type NodeId } from '../../../../engine/model/doc.ts';
import { DRAW_NS } from '../../../../engine/model/draw-state.ts';

export interface LayerRow {
  id: NodeId;
  depth: number;
  name: string;
  hidden: boolean;
  /** Its own draw:locked="true" (what Lock and Unlock write). */
  locked: boolean;
  /** Locked by an ancestor instead (not the root, which locks nothing): that ancestor's name. */
  lockedBy: string | null;
}

export function layerRows(doc: Doc): LayerRow[] {
  const out: LayerRow[] = [];
  const walk = (id: NodeId, depth: number, lockedBy: string | null) => {
    const n = doc.nodes.get(id) as ElementNode;
    const kids = n.children.map((c) => doc.nodes.get(c)!).filter((c): c is ElementNode => c.kind === 'element');
    for (const k of [...kids].reverse()) {
      const own = attrValue(doc, k, null, 'id');
      const name = own ? `#${own}` : `<${k.qname}>`;
      const locked = k.attrs.some((a) => a.ns === DRAW_NS && a.local === 'locked' && a.raw === 'true');
      out.push({ id: k.id, depth, name, hidden: attrValue(doc, k, null, 'display')?.trim() === 'none', locked, lockedBy: locked ? null : lockedBy });
      walk(k.id, depth + 1, locked ? name : lockedBy);
    }
  };
  walk(doc.root, 0, null);
  return out;
}
