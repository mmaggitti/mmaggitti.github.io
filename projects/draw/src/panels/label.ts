// How the panels name an element: its tag, with its id when it has one ('<circle#sun>').

import { attrValue, type Doc, type NodeId } from '../../../../engine/model/doc.ts';

export function elementLabel(doc: Doc | null, id: NodeId | undefined): string | null {
  const n = doc && id !== undefined ? doc.nodes.get(id) : undefined;
  if (!doc || !n || n.kind !== 'element') return null;
  const own = attrValue(doc, n, null, 'id');
  return `<${n.qname}${own ? `#${own}` : ''}>`;
}
