// The document: what is saved, exported, imported and kept in undo history. Only plain fields go
// in (no selection, no measured sizes), so a snapshot is small and an import can't smuggle anything
// React Flow would act on.
import type { Edge, Node } from '@xyflow/react';

export const KINDS = ['process', 'decision', 'io', 'note'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = { process: 'Step', decision: 'Decision', io: 'In / out', note: 'Note' };

export type FlowNode = Node<{ label: string }, Kind>;
export type Doc = { nodes: FlowNode[]; edges: Edge[] };

const MAX_LABEL = 200;
const MAX_ITEMS = 2000;

export function clean(doc: Doc): Doc {
  return {
    nodes: doc.nodes.map((n) => ({ id: n.id, type: n.type, position: { x: n.position.x, y: n.position.y }, data: { label: n.data.label } })),
    edges: doc.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
    })),
  };
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parses untrusted JSON (a file, or localStorage) into a Doc, or throws with a short reason. */
export function parseDoc(text: string): Doc {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object') throw new Error('not a flow file');
  const { nodes, edges } = raw as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new Error('no nodes or edges');
  if (nodes.length > MAX_ITEMS || edges.length > MAX_ITEMS) throw new Error('too many items');
  const ids = new Set<string>();
  const outNodes: FlowNode[] = [];
  for (const n of nodes) {
    const { id, type, position, data } = (n ?? {}) as Record<string, any>;
    if (!str(id) || ids.has(id) || !position || !num(position.x) || !num(position.y)) throw new Error('a node is malformed');
    ids.add(id);
    const kind: Kind = KINDS.includes(type) ? type : 'process';
    const label = typeof data?.label === 'string' ? data.label.slice(0, MAX_LABEL) : '';
    outNodes.push({ id, type: kind, position: { x: position.x, y: position.y }, data: { label } });
  }
  const edgeIds = new Set<string>();
  const outEdges: Edge[] = [];
  for (const e of edges) {
    const { id, source, target, sourceHandle, targetHandle } = (e ?? {}) as Record<string, any>;
    if (!str(id) || edgeIds.has(id) || !ids.has(source) || !ids.has(target)) throw new Error('an edge is malformed');
    edgeIds.add(id);
    outEdges.push({
      id,
      source,
      target,
      ...(str(sourceHandle) ? { sourceHandle } : {}),
      ...(str(targetHandle) ? { targetHandle } : {}),
    });
  }
  return { nodes: outNodes, edges: outEdges };
}

export function starter(): Doc {
  const node = (id: string, type: Kind, x: number, y: number, label: string): FlowNode => ({ id, type, position: { x, y }, data: { label } });
  return {
    nodes: [
      node('n1', 'io', 0, 0, 'An idea'),
      node('n2', 'process', 120, 110, 'Sketch it'),
      node('n3', 'decision', -40, 230, 'Does it work?'),
      node('n4', 'io', 150, 360, 'Ship it'),
      node('n5', 'note', -60, 470, 'Tap a node, then Edit. Drag from a dot to another dot to connect.'),
    ],
    edges: [],
  };
}

/** The next free "n<number>" id. */
export function nextId(nodes: { id: string }[], prefix = 'n'): string {
  let max = 0;
  for (const { id } of nodes) {
    const m = id.match(/^[a-z]+(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}
