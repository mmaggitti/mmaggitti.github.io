import { useEffect, useMemo, useReducer, useRef } from 'react';
import { ancestors, domStats, isElement, label, visibleRows, type Row } from './dom';
import { session, useFrameVersion } from './frame';
import { selection } from './selection';
import { useStore } from './store';

// The live DOM as an indented, collapsible tree. Only expanded nodes contribute rows, so a
// collapsed subtree costs nothing (the polyglot-graph FileTree pattern).

const ids = new WeakMap<Node, number>();
let nextId = 1;
function keyOf(node: Node): number {
  let id = ids.get(node);
  if (!id) ids.set(node, (id = nextId++));
  return id;
}

/** Tapping a text or shadow-root row selects the element it belongs to. */
function elementFor(node: Node): Element | null {
  if (isElement(node)) return node;
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return (node as ShadowRoot).host ?? null;
  const parent = node.parentNode; // a text node directly in a shadow root has no parentElement
  if (parent?.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return (parent as ShadowRoot).host ?? null;
  return node.parentElement;
}

// Expansion state lives per document, outside the component, so switching tabs or folding the
// sheet (which unmounts the tree) doesn't collapse everything. A new document starts with html
// and body open.
const expansions = new WeakMap<Document, WeakSet<Node>>();
function expandedFor(doc: Document): WeakSet<Node> {
  let set = expansions.get(doc);
  if (!set) {
    set = new WeakSet();
    set.add(doc.documentElement);
    if (doc.body) set.add(doc.body);
    expansions.set(doc, set);
  }
  return set;
}

export function Tree() {
  const version = useFrameVersion('structure');
  const selected = useStore(selection);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const list = useRef<HTMLUListElement>(null);

  const doc = session.document;
  const root = doc?.documentElement;
  const expanded = doc ? expandedFor(doc) : null;
  // Recounted only when the DOM changes (structure channel), never on scroll.
  const stats = useMemo(() => (doc ? domStats(doc) : null), [doc, version]);

  // The selection's ancestors open so its row is visible (idempotent, so safe during render).
  if (selected && expanded && selected.ownerDocument === doc) {
    for (const a of ancestors(selected).slice(0, -1)) expanded.add(a);
  }

  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!root || !expanded) return <p className="ds-muted studio-empty">Loading the page…</p>;

  const rows = visibleRows(root, (n) => expanded.has(n));
  const toggle = (row: Row) => {
    if (row.expanded) expanded.delete(row.node);
    else expanded.add(row.node);
    redraw();
  };

  const summary = stats
    ? `${plural(stats.elements, 'element')} · maximum depth ${stats.deepest.toLocaleString()}`
    : '';

  return (
    <>
      <p className="tree-stats ds-num">{summary}</p>
      <ul className="tree" aria-label={`Live DOM, ${summary}`} ref={list}>
        {rows.map((row) => {
          const el = elementFor(row.node);
          const isSel = el !== null && el === selected && isElement(row.node);
          const flash = session.changedAt.get(row.node) === version;
          const kind = isElement(row.node) ? 'el' : row.node.nodeType === Node.TEXT_NODE ? 'text' : 'shadow';
          const indent = { marginLeft: `calc(${row.depth} * var(--space-3))` };
          return (
            <li key={keyOf(row.node)} className={`tree-row tree-${kind}`} data-selected={isSel || undefined}>
              {flash && <span key={version} className="tree-flash" aria-hidden="true" />}
              {row.hasChildren ? (
                <button
                  type="button"
                  className="tree-toggle"
                  style={indent}
                  aria-expanded={row.expanded}
                  aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${label(row.node)}`}
                  onClick={() => toggle(row)}
                >
                  {row.expanded ? '▾' : '▸'}
                </button>
              ) : (
                <span className="tree-toggle" style={indent} aria-hidden="true" />
              )}
              <button
                type="button"
                className="tree-label"
                aria-current={isSel ? 'true' : undefined}
                onClick={() => {
                  if (!el) return;
                  selection.set(el);
                  session.reveal(el);
                }}
              >
                {label(row.node)}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}
