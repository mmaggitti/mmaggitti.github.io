// The ContextBar (48pt, above the ToolRail): the Scrub strip while a code number is focused (−, the
// value, +, ± for negatives, Done), else the selection and its actions, else a hint; for a file
// open as read-only source, where it fails and Files. Refused edits and other notices ("Copied")
// show just above it for a few seconds.
//
// The selection's actions at 440 pt (P1-M1): the label, then six 44 pt icon buttons: Deselect,
// Select more (a toggle), Bring forward, Send back, Delete and More. With only the root selected
// (from the code), Forward, Back and Delete are disabled. Edit source doesn't fit beside them, so
// it lives in the More sheet, with Fill… and Stroke… (the Colour sheet over the selection, P1-M2),
// Gloss (SVG Lab's, on or off, P1-M2), Duplicate, Group, Ungroup, Select group, Select all, Align
// (six ways) and Distribute (two).
//
// While the Shapes tool is on (P1-M2), the bar is its kind picker instead: seven 44 pt icon buttons
// (Rectangle, Circle, Ellipse, Line, Polygon, Star, Spiral), the chosen one pressed, then Cancel,
// which returns to Select.
//
// While the Pen is on (P1-M3), the bar is its own: Undo point, Close (from 3 anchors) and Done. In
// the Node tool, for one selected path, the selection's bar gives way to the path's: Deselect, Smooth
// (for the chosen node, when Make smooth or Make corner applies), Close or Open, Relative or
// Absolute, Reverse (the chosen node's subpath, or every subpath: S2), and More. Each a 44 pt icon
// button.

import { useEffect, useState, type ReactNode } from 'react';
import type { Editor } from '../editor.ts';
import { SHAPE_KINDS, SHAPE_NAMES, type ShapeKind } from '../interact/shapes-tool.ts';
import type { Unparsed } from '../workspace.ts';
import { elementLabel } from './label.ts';
import { Modal } from './Sheets.tsx';
import { useStore } from './store.ts';

const NOTICE_MS = 4000;

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);
const DESELECT = icon(<path d="M6 6l12 12M18 6L6 18" />);
const SELECT_MORE = icon(<><rect x="3" y="9" width="12" height="12" rx="1.5" /><path d="M18 2v8M14 6h8" /></>);
const FORWARD = icon(<path d="M12 20V5M6 11l6-6 6 6" />);
const BACK = icon(<path d="M12 4v15M6 13l6 6 6-6" />);
const DELETE = icon(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>);
const MORE = icon(<><circle cx="5" cy="12" r="1.25" /><circle cx="12" cy="12" r="1.25" /><circle cx="19" cy="12" r="1.25" /></>);
const UNDO_POINT = icon(<><path d="M9 13L4 8l5-5M4 8h9a6 6 0 010 12h-2" /><rect x="15.5" y="17.5" width="4" height="4" /></>);
const CLOSE_PATH = icon(<path d="M5 18L8 6l11 3-4 10z" />);
const OPEN_PATH = icon(<><path d="M9 19H5L8 6l11 3-2 7" /><circle cx="17" cy="18" r="1.5" /></>);
const DONE = icon(<path d="M5 12.5l4.5 4.5L19 7" />);
const SMOOTH = icon(<><path d="M3 18C6 9 18 9 21 18" /><path d="M4 11h16" /><circle cx="12" cy="11" r="1.75" /></>);
const RELATIVE = icon(<><circle cx="6" cy="18" r="1.75" /><path d="M7.5 16.5L18 6M12 6h6v6" /></>);
const ABSOLUTE = icon(<><path d="M4 3v17h17" /><circle cx="14" cy="10" r="1.75" /><path d="M14 10H4M14 10v10" strokeDasharray="2 2" /></>);
const REVERSE = icon(<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" />);
const KIND_ICONS: Record<ShapeKind, ReactNode> = {
  rect: icon(<rect x="4" y="6" width="16" height="12" />),
  circle: icon(<circle cx="12" cy="12" r="8" />),
  ellipse: icon(<ellipse cx="12" cy="12" rx="9" ry="5.5" />),
  line: icon(<path d="M5 19L19 5" />),
  polygon: icon(<path d="M12 3.5l8.1 5.9-3.1 9.6H7l-3.1-9.6z" />),
  star: icon(<path d="M12 3.5l2.4 5.6 6.1.5-4.6 4 1.4 5.9L12 16.3l-5.3 3.2 1.4-5.9-4.6-4 6.1-.5z" />),
  spiral: icon(<path d="M12 12c0-1 1.5-1 1.5 0s-1 2.5-3 2.5-3-2-3-3.5 2-4.5 4.5-4.5 5.5 2.5 5.5 5.5-3 7-7 7-8-3.5-8-7.5" />),
};

export function ContextBar({ editor, unparsed, files }: { editor: Editor; unparsed: Unparsed | null; files: () => void }) {
  const focus = useStore(editor.focus);
  const selection = useStore(editor.selection);
  const notice = useStore(editor.notice);
  const selectMore = useStore(editor.selectMore);
  const tool = useStore(editor.tool);
  const kind = useStore(editor.shapeKind);
  const pen = useStore(editor.pen);
  useStore(editor.chosenNode);
  const [more, setMore] = useState(false);
  useStore(editor.version);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => editor.notice.set(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice, editor]);

  const ids = [...selection];
  const nodes = tool === 'node' ? editor.nodeBar() : null;
  let body;
  if (unparsed) {
    body = (
      <>
        <span className="draw-label">
          Read-only source{unparsed.line !== null ? ` · line ${unparsed.line}, column ${unparsed.column}` : ''}
        </span>
        <button type="button" className="draw-key draw-action draw-source-files" onClick={files}>
          Files
        </button>
      </>
    );
  } else if (focus) {
    const t = focus.token;
    body = (
      <div className="draw-strip" role="group" aria-label={`Scrub ${t.prop}`}>
        <span className="draw-strip-name ds-mono">{t.prop}</span>
        <button type="button" className="draw-key" aria-label={`Decrease ${t.prop}`} onClick={() => editor.stepFocus(-1)}>
          −
        </button>
        <button type="button" className="draw-key draw-strip-value ds-mono" aria-label={`Type ${t.prop}: ${t.text}${t.unit ?? ''}`} onClick={() => editor.openNumberSheet()}>
          {t.text}
          {t.unit ?? ''}
        </button>
        <button type="button" className="draw-key" aria-label={`Increase ${t.prop}`} onClick={() => editor.stepFocus(1)}>
          +
        </button>
        <button type="button" className="draw-key" aria-label="Change the sign" onClick={() => editor.negateFocus()}>
          ±
        </button>
        <button type="button" className="draw-key draw-done" onClick={() => editor.clearFocus()}>
          Done
        </button>
      </div>
    );
  } else if (tool === 'shapes') {
    body = (
      <>
        <div className="draw-shape-kinds" role="group" aria-label="Shape">
          {SHAPE_KINDS.map((k) => (
            <button key={k} type="button" className="draw-key draw-ctx-btn draw-shape-kind" aria-label={SHAPE_NAMES[k]} aria-pressed={k === kind} onClick={() => editor.pickShape(k)}>
              {KIND_ICONS[k]}
            </button>
          ))}
        </div>
        <button type="button" className="draw-key draw-ctx-btn draw-shapes-cancel" aria-label="Cancel" onClick={() => editor.pickTool('select')}>
          {DESELECT}
        </button>
      </>
    );
  } else if (tool === 'pen' && pen) {
    body = (
      <>
        <span className="draw-hint draw-pen-hint">{pen.anchors < 2 ? 'Tap to add points' : `${pen.anchors} points`}</span>
        <div className="draw-pen-keys" role="group" aria-label="Pen">
          <button type="button" className="draw-key draw-ctx-btn" aria-label="Undo point" disabled={!pen.canUndo} onClick={() => editor.undoPoint()}>
            {UNDO_POINT}
          </button>
          {pen.canClose && (
            <button type="button" className="draw-key draw-ctx-btn" aria-label="Close" onClick={() => editor.penClose()}>
              {CLOSE_PATH}
            </button>
          )}
          <button type="button" className="draw-key draw-ctx-btn ds-btn--primary draw-pen-done" aria-label="Done" onClick={() => editor.penDone()}>
            {DONE}
          </button>
        </div>
      </>
    );
  } else if (nodes && ids.length === 1) {
    body = (
      <>
        <span className="draw-label ds-mono">{elementLabel(editor.doc, ids[0])}</span>
        <button type="button" className="draw-key draw-ctx-btn" aria-label="Deselect" onClick={() => editor.deselect()}>
          {DESELECT}
        </button>
        {nodes.smooth && (
          <button type="button" className="draw-key draw-ctx-btn" aria-label="Smooth" aria-pressed={nodes.smooth === 'smooth'} onClick={() => editor.toggleSmooth()}>
            {SMOOTH}
          </button>
        )}
        <button type="button" className="draw-key draw-ctx-btn" aria-label={nodes.closed ? 'Open' : 'Close'} onClick={() => editor.toggleClosed()}>
          {nodes.closed ? OPEN_PATH : CLOSE_PATH}
        </button>
        <button type="button" className="draw-key draw-ctx-btn" aria-label={nodes.relative ? 'Absolute' : 'Relative'} onClick={() => editor.toggleRelative()}>
          {nodes.relative ? ABSOLUTE : RELATIVE}
        </button>
        <button type="button" className="draw-key draw-ctx-btn" aria-label="Reverse" onClick={() => editor.reverse()}>
          {REVERSE}
        </button>
        <button type="button" className="draw-key draw-ctx-btn" aria-label="More" aria-haspopup="dialog" onClick={() => setMore(true)}>
          {MORE}
        </button>
      </>
    );
  } else if (ids.length) {
    const rootOnly = ids.length === 1 && ids[0] === editor.doc?.root;
    body = (
      <>
        <span className="draw-label ds-mono">{ids.length > 1 ? `${ids.length} selected` : elementLabel(editor.doc, ids[0])}</span>
        <button type="button" className="draw-key draw-ctx-btn" aria-label="Deselect" onClick={() => editor.deselect()}>
          {DESELECT}
        </button>
        <button type="button" className="draw-key draw-ctx-btn" aria-label="Select more" aria-pressed={selectMore} onClick={() => editor.selectMore.set(!selectMore)}>
          {SELECT_MORE}
        </button>
        <button type="button" className="draw-key draw-ctx-btn" aria-label="Bring forward" disabled={rootOnly} onClick={() => editor.forward()}>
          {FORWARD}
        </button>
        <button type="button" className="draw-key draw-ctx-btn" aria-label="Send back" disabled={rootOnly} onClick={() => editor.back()}>
          {BACK}
        </button>
        <button type="button" className="draw-key draw-ctx-btn" aria-label="Delete" disabled={rootOnly} onClick={() => editor.delete()}>
          {DELETE}
        </button>
        <button type="button" className="draw-key draw-ctx-btn" aria-label="More" aria-haspopup="dialog" onClick={() => setMore(true)}>
          {MORE}
        </button>
      </>
    );
  } else {
    body = <span className="draw-hint">Tap a shape, or a number in the code.</span>;
  }

  return (
    <div className="draw-context">
      {notice && (
        <p className="draw-toast" role="status">
          {notice}
        </p>
      )}
      {body}
      {more && <MoreSheet editor={editor} close={() => setMore(false)} />}
    </div>
  );
}

/** The More sheet: what doesn't fit on the bar, one 44 pt row each. */
function MoreSheet({ editor, close }: { editor: Editor; close: () => void }) {
  const then = (act: () => void) => () => {
    close();
    act();
  };
  const row = (label: string, act: () => void) => (
    <button key={label} type="button" className="ds-btn draw-more-row" onClick={then(act)}>
      {label}
    </button>
  );
  return (
    <Modal title="More" onClose={close} done mono={false}>
      <div className="draw-more">
        {editor.canEditSource() && (
          <button type="button" className="ds-btn draw-action" onClick={then(() => editor.openSource())}>
            Edit source
          </button>
        )}
        {row('Fill…', () => editor.openStyleSheet('fill'))}
        {row('Stroke…', () => editor.openStyleSheet('stroke'))}
        {row('Gloss', () => editor.toggleGloss())}
        {row('Duplicate', () => editor.duplicate())}
        {row('Group', () => editor.group())}
        {row('Ungroup', () => editor.ungroup())}
        {row('Select group', () => editor.selectGroup())}
        {row('Select all', () => editor.selectAll())}
        <p className="draw-subhead">Align</p>
        <div className="draw-more-grid">
          {row('Align left', () => editor.align('left'))}
          {row('Align centre', () => editor.align('center'))}
          {row('Align right', () => editor.align('right'))}
          {row('Align top', () => editor.align('top'))}
          {row('Align middle', () => editor.align('middle'))}
          {row('Align bottom', () => editor.align('bottom'))}
        </div>
        <p className="draw-subhead">Distribute</p>
        <div className="draw-more-grid">
          {row('Distribute horizontally', () => editor.distribute('h'))}
          {row('Distribute vertically', () => editor.distribute('v'))}
        </div>
      </div>
    </Modal>
  );
}
