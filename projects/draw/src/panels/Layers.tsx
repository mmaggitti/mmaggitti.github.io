// The Layers tab: the document's element tree, topmost first (the reverse of document order within
// each parent, as the canvas stacks them), indented by depth. Each row names its element (#id, else
// <tag>) and selects it on a tap; Hide/Show writes or removes display="none", Lock/Unlock
// draw:locked="true", and Rename changes the id and every reference to it, each one history entry
// through the editor. A shape inside a locked group reads locked, by the group (its lock button
// pressed, disabled, and naming the group). It reads the editor's stores only (never on a drag's
// path). A long document shows 200 rows at a time.

import { useState, type ReactNode } from 'react';
import { attrValue, type ElementNode } from '../../../../engine/model/doc.ts';
import type { Editor } from '../editor.ts';
import { layerRows, type LayerRow as Row } from './layer-rows.ts';
import { Modal } from './Sheets.tsx';
import { useStore } from './store.ts';

const PAGE = 200;

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);
const EYE = icon(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
const LOCK = icon(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>);
const PEN = icon(<><path d="M4 20l3-1 11-11-2-2L5 17z" /><path d="M14 6l4 4" /></>);

export function Layers({ editor }: { editor: Editor }) {
  useStore(editor.version);
  const selection = useStore(editor.selection);
  const [shown, setShown] = useState(PAGE);
  const [renaming, setRenaming] = useState<Row | null>(null);
  const doc = editor.doc;
  if (!doc) return <p className="draw-hint draw-layers-empty">Nothing is open.</p>;
  const all = layerRows(doc);
  return (
    <div className="draw-layers">
      <ul className="draw-layer-list">
        {all.slice(0, shown).map((r) => (
          <li key={r.id} className={`draw-layer${selection.has(r.id) ? ' on' : ''}`} style={{ paddingLeft: `${r.depth * 0.75}rem` }}>
            <button type="button" className="draw-layer-name ds-mono" aria-current={selection.has(r.id) || undefined} onClick={() => editor.select([r.id])}>
              {r.name}
            </button>
            <button type="button" className="draw-layer-btn" aria-label={r.hidden ? `Show ${r.name}` : `Hide ${r.name}`} aria-pressed={r.hidden} onClick={() => editor.setHidden(r.id, !r.hidden)}>
              {EYE}
            </button>
            {r.lockedBy === null ? (
              <button type="button" className="draw-layer-btn" aria-label={r.locked ? `Unlock ${r.name}` : `Lock ${r.name}`} aria-pressed={r.locked} onClick={() => editor.setLocked(r.id, !r.locked)}>
                {LOCK}
              </button>
            ) : (
              <button type="button" className="draw-layer-btn" aria-label={`Locked by ${r.lockedBy}`} title={`Locked by ${r.lockedBy}`} aria-pressed disabled>
                {LOCK}
              </button>
            )}
            <button type="button" className="draw-layer-btn" aria-label={`Rename ${r.name}`} onClick={() => setRenaming(r)}>
              {PEN}
            </button>
          </li>
        ))}
      </ul>
      {all.length > shown && (
        <button type="button" className="ds-btn draw-layers-more" onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, all.length - shown)} more
        </button>
      )}
      {renaming && <RenameSheet editor={editor} row={renaming} close={() => setRenaming(null)} />}
    </div>
  );
}

/** Rename: a new id, checked (a valid XML id no other element has) before it is written. */
function RenameSheet({ editor, row, close }: { editor: Editor; row: Row; close: () => void }) {
  const doc = editor.doc!;
  const n = doc.nodes.get(row.id) as ElementNode;
  const [text, setText] = useState(attrValue(doc, n, null, 'id') ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const apply = () => {
    const why = editor.rename(row.id, text.trim());
    if (why) setProblem(why);
    else close();
  };
  return (
    <Modal title={`Rename ${row.name}`} onClose={close} done={false}>
      <input
        className="draw-field ds-mono draw-wide"
        aria-label="New id"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="done"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
      />
      {problem && (
        <p className="draw-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="draw-actions">
        <button type="button" className="ds-btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="ds-btn ds-btn--primary draw-rename-go" onClick={apply}>
          Rename
        </button>
      </div>
    </Modal>
  );
}
