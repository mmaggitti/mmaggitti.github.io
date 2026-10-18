// Dragging a divider: only the two panels beside it change, and neither goes below its minimum.
// (Pushing on through further neighbours, as Trellis's model/resize.ts does, is deferred.)

import type { LayoutDoc, Split } from './types.ts';
import type { Metrics } from './metrics.ts';
import type { RestLayout } from './layout.ts';
import { minSizer } from './layout.ts';
import type { TreeIndex } from './tree.ts';
import { updateNode } from './ops.ts';

/** New weights for a split after moving seam `seam` (between children seam and seam + 1) by `delta`
 * workspace px along its axis. The pair's total weight is kept, so nothing else moves. */
export function resizePair(doc: LayoutDoc, idx: TreeIndex, rest: RestLayout, m: Metrics, split: string, seam: number, delta: number): LayoutDoc {
  const node = idx.nodes.get(split);
  const out = rest.splits.get(split);
  if (node?.kind !== 'split' || !out || seam < 0 || seam >= node.children.length - 1) return doc;
  const along = node.axis === 'x' ? 'w' : 'h';
  const a = rest.nodes.get(node.children[seam].id);
  const b = rest.nodes.get(node.children[seam + 1].id);
  if (!a || !b) return doc;
  const min = minSizer(doc, m);
  const minA = min(node.children[seam])[along] * out.s;
  const minB = min(node.children[seam + 1])[along] * out.s;
  const total = a[along] + b[along];
  const ea = Math.min(Math.max(a[along] + delta, Math.min(minA, total / 2)), total - Math.min(minB, total / 2));
  const pair = node.weights[seam] + node.weights[seam + 1];
  const wa = (pair * ea) / total;
  return setPair(doc, idx, node, seam, wa, pair - wa);
}

/** Even out the two panels beside a seam. */
export function equalize(doc: LayoutDoc, idx: TreeIndex, split: string, seam: number): LayoutDoc {
  const node = idx.nodes.get(split);
  if (node?.kind !== 'split' || seam < 0 || seam >= node.children.length - 1) return doc;
  const half = (node.weights[seam] + node.weights[seam + 1]) / 2;
  return setPair(doc, idx, node, seam, half, half);
}

function setPair(doc: LayoutDoc, idx: TreeIndex, node: Split, seam: number, wa: number, wb: number): LayoutDoc {
  if (Math.abs(wa - node.weights[seam]) < 1e-12 && Math.abs(wb - node.weights[seam + 1]) < 1e-12) return doc;
  return updateNode(doc, idx, node.id, (n) => {
    if (n.kind !== 'split') return n;
    const weights = [...n.weights];
    weights[seam] = wa;
    weights[seam + 1] = wb;
    return { ...n, weights };
  });
}
