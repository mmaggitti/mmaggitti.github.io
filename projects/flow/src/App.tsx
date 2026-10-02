import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { clean, KIND_LABEL, KINDS, nextId, parseDoc, starter, type Doc, type FlowNode, type Kind } from './doc';
import { useHistory } from './history';
import { tidy } from './layout';
import { nodeTypes } from './nodes';
import { download, load, save } from './storage';

export function App() {
  return (
    <ReactFlowProvider>
      <Playground />
    </ReactFlowProvider>
  );
}

type Sheet = null | 'add' | 'more' | 'edit';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FIT = { padding: 0.2, maxZoom: 1.25 };

function Playground() {
  const initial = useMemo(() => load() ?? starter(), []);
  const [nodes, setNodes] = useState<FlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const rf = useReactFlow<FlowNode, Edge>();
  const canvas = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fitPending = useRef(false);
  const dragStart = useRef<Doc | null>(null);

  const doc = useRef<Doc>({ nodes, edges });
  doc.current = { nodes, edges };
  const current = useCallback(() => doc.current, []);
  const apply = useCallback((d: Doc) => {
    setNodes(d.nodes);
    setEdges(d.edges);
  }, []);
  const { record, undo, redo, canUndo, canRedo } = useHistory(current, apply);

  // Autosave shortly after every change, and at once when the page is put away.
  useEffect(() => {
    const t = setTimeout(() => save({ nodes, edges }), 250);
    return () => clearTimeout(t);
  }, [nodes, edges]);
  useEffect(() => {
    const flush = () => save(doc.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // A fit asked for by a change runs after React Flow has the new nodes.
  const fitSoon = () => {
    fitPending.current = true;
  };
  useEffect(() => {
    if (!fitPending.current) return;
    fitPending.current = false;
    void rf.fitView({ ...FIT, duration: reducedMotion() ? 0 : 300 });
  }, [nodes, rf]);

  // Desktop keys; the bar does the same on a phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)), []);

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) return;
      const dup = doc.current.edges.some(
        (e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? null) === (c.sourceHandle ?? null) && (e.targetHandle ?? null) === (c.targetHandle ?? null),
      );
      if (dup) return;
      record();
      setEdges((es) => addEdge({ ...c, id: nextId(es, 'e') }, es));
    },
    [record],
  );

  // Backspace/Delete on a keyboard. The bar's Delete records for itself.
  const onBeforeDelete = useCallback(
    async ({ nodes: n, edges: e }: { nodes: FlowNode[]; edges: Edge[] }) => {
      if (n.length || e.length) record();
      return true;
    },
    [record],
  );

  // A drag is one history entry, and only if something actually moved (a tap with a wobble isn't).
  const onDragStart = useCallback(() => {
    dragStart.current = clean(doc.current);
  }, []);
  const onDragStop = useCallback(() => {
    const before = dragStart.current;
    dragStart.current = null;
    if (!before) return;
    const was = new Map(before.nodes.map((n) => [n.id, n.position]));
    const moved = doc.current.nodes.some((n) => {
      const p = was.get(n.id);
      return p && (p.x !== n.position.x || p.y !== n.position.y);
    });
    if (moved) record(before);
  }, [record]);

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const hasSelection = selectedNodes.length + selectedEdges.length > 0;
  const editable = selectedNodes.length === 1 ? selectedNodes[0] : null;

  const add = (kind: Kind) => {
    record();
    const box = canvas.current!.getBoundingClientRect();
    const centre = rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    const nudge = (nodes.length % 5) * 12; // repeated adds fan out instead of stacking exactly
    const node: FlowNode = {
      id: nextId(nodes),
      type: kind,
      position: { x: Math.round(centre.x - 80 + nudge), y: Math.round(centre.y - 24 + nudge) },
      data: { label: KIND_LABEL[kind] },
      selected: true,
    };
    setNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), node]);
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
    setSheet(null);
  };

  const remove = () => {
    if (!hasSelection) return;
    record();
    const gone = new Set(selectedNodes.map((n) => n.id));
    setNodes((ns) => ns.filter((n) => !gone.has(n.id)));
    setEdges((es) => es.filter((e) => !e.selected && !gone.has(e.source) && !gone.has(e.target)));
    setSheet(null);
  };

  const editing = sheet === 'edit' ? nodes.find((n) => n.id === editingId) : undefined;
  const openEdit = (node: FlowNode | null) => {
    if (!node) return;
    setEditingId(node.id);
    setDraft(node.data.label);
    setSheet('edit');
  };
  const saveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (editing && draft !== editing.data.label) {
      record();
      const label = draft.slice(0, 200);
      setNodes((ns) => ns.map((n) => (n.id === editing.id ? { ...n, data: { ...n.data, label } } : n)));
    }
    setSheet(null);
  };

  const onTidy = () => {
    if (!nodes.length) return;
    record();
    setNodes(tidy(nodes, edges));
    fitSoon();
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const next = parseDoc(await file.text());
      record();
      apply(next);
      fitSoon();
      setStatus(`Imported ${next.nodes.length} nodes`);
    } catch (err) {
      setStatus(`Couldn't import: ${err instanceof Error ? err.message : 'unreadable file'}`);
    }
    setSheet(null);
  };

  const onClear = () => {
    if (!nodes.length && !edges.length) return;
    record();
    apply({ nodes: [], edges: [] });
    setSheet(null);
    setStatus('Cleared. Undo brings it back');
  };

  const shownEdges = useMemo(() => edges.map((e) => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--text-muted)' } })), [edges]);
  const toggle = (s: Sheet) => setSheet((cur) => (cur === s ? null : s));

  return (
    <div className="flow">
      <header className="flow-head">
        <h1 className="flow-title">Flow</h1>
        <p className="flow-count ds-muted" data-testid="count">
          {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'} · {edges.length} {edges.length === 1 ? 'edge' : 'edges'}
        </p>
        <p className="flow-status ds-muted" role="status" aria-live="polite">
          {status}
        </p>
      </header>

      <div className="flow-canvas" ref={canvas}>
        <ReactFlow<FlowNode, Edge>
          nodes={nodes}
          edges={shownEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onBeforeDelete={onBeforeDelete}
          onNodeDragStart={onDragStart}
          onNodeDragStop={onDragStop}
          onSelectionDragStart={onDragStart}
          onSelectionDragStop={onDragStop}
          onNodeDoubleClick={(_, node) => openEdit(node)}
          deleteKeyCode={['Backspace', 'Delete']}
          zoomOnDoubleClick={false}
          connectionRadius={32}
          minZoom={0.2}
          maxZoom={2}
          fitView
          fitViewOptions={FIT}
          colorMode="system"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>

      {sheet === 'add' && (
        <section className="flow-sheet" aria-label="Add a node">
          <div className="flow-grid">
            {KINDS.map((k) => (
              <button key={k} type="button" className={`ds-btn flow-kind flow-kind--${k}`} onClick={() => add(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </section>
      )}

      {sheet === 'more' && (
        <section className="flow-sheet" aria-label="More">
          <div className="flow-grid">
            <button type="button" className="ds-btn" onClick={() => (download(doc.current), setSheet(null))}>
              Export JSON
            </button>
            <button type="button" className="ds-btn" onClick={() => fileInput.current?.click()}>
              Import JSON
            </button>
            <button type="button" className="ds-btn" onClick={() => (void rf.fitView({ ...FIT, duration: reducedMotion() ? 0 : 300 }), setSheet(null))}>
              Fit to screen
            </button>
            <button type="button" className="ds-btn" onClick={onClear}>
              Clear all
            </button>
          </div>
        </section>
      )}

      {editing && (
        <form className="flow-sheet flow-edit" onSubmit={saveEdit} aria-label="Edit label">
          <input
            className="flow-input"
            value={draft}
            maxLength={200}
            autoFocus
            enterKeyHint="done"
            aria-label="Label"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flow-row">
            <button type="button" className="ds-btn" onClick={() => setSheet(null)}>
              Cancel
            </button>
            <button type="submit" className="ds-btn ds-btn--primary">
              Save
            </button>
          </div>
        </form>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="import"
        onChange={(e) => {
          void onImport(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <nav className="ds-bar flow-bar" aria-label="Actions">
        {hasSelection ? (
          <>
            <button type="button" className="ds-btn" disabled={!editable} onClick={() => openEdit(editable)}>
              Edit
            </button>
            <button type="button" className="ds-btn" onClick={remove}>
              Delete
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ds-btn ds-btn--primary" aria-expanded={sheet === 'add'} onClick={() => toggle('add')}>
              Add
            </button>
            <button type="button" className="ds-btn" disabled={!nodes.length} onClick={onTidy}>
              Tidy
            </button>
          </>
        )}
        <button type="button" className="ds-btn" disabled={!canUndo} onClick={undo}>
          Undo
        </button>
        <button type="button" className="ds-btn" disabled={!canRedo} onClick={redo}>
          Redo
        </button>
        <button type="button" className="ds-btn" aria-expanded={sheet === 'more'} onClick={() => toggle('more')}>
          More
        </button>
      </nav>
    </div>
  );
}
