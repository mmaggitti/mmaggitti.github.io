// The ToolRail (52pt, the bottom of the screen): the tools, then Undo and Redo, which follow the
// session's history. Select, Node and Pen (P1-M3) and Shapes (P1-M2) work; Text and Insert arrive
// later in P1 and are shown, disabled, so the rail doesn't reshuffle when they do. A tool is pressed
// while it is on, and a tap turns it on or off (Select turns it off too); each is disabled with no
// drawing, or a read-only one. While the Pen is on, Undo is its Undo point and Redo is off.

import type { ReactNode } from 'react';
import type { Editor } from '../editor.ts';
import { useStore } from './store.ts';

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const SELECT = icon(<path d="M5 3l14 8-6 1.5L10 19z" />);
const SHAPES = icon(<><rect x="3" y="11" width="9" height="9" /><circle cx="16" cy="8" r="5" /></>);
const NODE = icon(<><path d="M4 18C8 6 16 6 20 18" /><rect x="2.5" y="16.5" width="3" height="3" /><rect x="18.5" y="16.5" width="3" height="3" /><circle cx="12" cy="9" r="1.5" /></>);
const PEN = icon(<><path d="M4 20l3-1 11-11-2-2L5 17z" /><path d="M14 6l4 4" /></>);
const AFTER: [string, ReactNode][] = [
  ['Text', icon(<><path d="M5 6V4h14v2" /><path d="M12 4v16" /><path d="M9 20h6" /></>)],
  ['Insert', icon(<><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M12 8v8M8 12h8" /></>)],
];
const later = ([name, svg]: [string, ReactNode]) => (
  <button key={name} type="button" className="draw-tool" disabled aria-label={`${name} (coming in P1)`}>
    {svg}
    <span>{name}</span>
  </button>
);
const UNDO = icon(<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />);
const REDO = icon(<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />);

export function ToolRail({ editor }: { editor: Editor }) {
  const h = useStore(editor.history);
  const tool = useStore(editor.tool);
  const readOnly = useStore(editor.readOnly);
  useStore(editor.version);
  return (
    <nav className="draw-rail" aria-label="Tools">
      <button type="button" className="draw-tool" aria-pressed={tool === 'select'} onClick={() => editor.pickTool('select')}>
        {SELECT}
        <span>Select</span>
      </button>
      <button type="button" className="draw-tool draw-node-tool" aria-pressed={tool === 'node'} disabled={!editor.doc || readOnly} onClick={() => editor.pickTool(tool === 'node' ? 'select' : 'node')}>
        {NODE}
        <span>Node</span>
      </button>
      <button type="button" className="draw-tool draw-pen-tool" aria-pressed={tool === 'pen'} disabled={!editor.doc || readOnly} onClick={() => editor.pickTool(tool === 'pen' ? 'select' : 'pen')}>
        {PEN}
        <span>Pen</span>
      </button>
      <button type="button" className="draw-tool draw-shapes-tool" aria-pressed={tool === 'shapes'} disabled={!editor.doc || readOnly} onClick={() => editor.pickTool(tool === 'shapes' ? 'select' : 'shapes')}>
        {SHAPES}
        <span>Shapes</span>
      </button>
      {AFTER.map(later)}
      <button type="button" className="draw-tool" disabled={!h.canUndo} aria-label={h.undoLabel ? `Undo ${h.undoLabel}` : 'Undo'} onClick={() => editor.undo()}>
        {UNDO}
        <span>Undo</span>
      </button>
      <button type="button" className="draw-tool" disabled={!h.canRedo} aria-label={h.redoLabel ? `Redo ${h.redoLabel}` : 'Redo'} onClick={() => editor.redo()}>
        {REDO}
        <span>Redo</span>
      </button>
    </nav>
  );
}
