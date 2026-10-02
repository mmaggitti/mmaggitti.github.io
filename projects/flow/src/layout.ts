// Tidy: a top-to-bottom layered layout from dagre, using each node's measured size.
import dagre from '@dagrejs/dagre';
import type { Edge } from '@xyflow/react';
import type { FlowNode } from './doc';

export function tidy(nodes: FlowNode[], edges: Edge[]): FlowNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 32, ranksep: 56, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const size = (n: FlowNode) => ({ width: n.measured?.width ?? 160, height: n.measured?.height ?? 48 });
  for (const n of nodes) g.setNode(n.id, size(n));
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const { x, y } = g.node(n.id);
    const { width, height } = size(n);
    return { ...n, position: { x: Math.round(x - width / 2), y: Math.round(y - height / 2) } };
  });
}
