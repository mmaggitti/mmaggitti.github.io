// The canvas: a host element whose open shadow root holds the rendered document, so the file's ids
// and <style> can't collide with the app's; under it the underlay (the surround, and the light
// checkerboard paper on the artboard, the same in both themes: decision 10, with the grid over it);
// and a layer above it for the app's marks (outlines, handles, guides, the tooltip).
// React owns only these elements; the framework-free renderer owns everything inside the host (every
// node it draws comes through the safe sink), and the stage turns the canvas's input into the
// editor's view and the Select tool. The host is hidden from assistive tech: the code panel is the
// accessible view of the document. A file (or SVG text) dropped on the canvas opens (iPad, desktop).
//
// Over the drawing: the Grid and Snap buttons at the top-left (view options kept on this device,
// never in the file; the Snap sheet also sets the grid step and the guides, which the file keeps as
// Draw's own state; it is rendered in the app's root, outside the canvas, whose containment would
// clip it and whose chrome and marks would paint over it, as the ContextBar's More sheet is); and when there is something to say, a file that isn't well-formed (it is shown only as
// source, in the code), a drawing the canvas couldn't draw (the file and the code are kept), and,
// under reduced motion, Play for a drawing that animates (it opens paused, top-right).

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '../editor.ts';
import type { Unparsed } from '../workspace.ts';
import { failureText } from '../files-view.ts';
import { useStore } from './store.ts';
import { readPref, writePref } from '../platform/prefs.ts';
import { Renderer } from '../canvas/renderer.ts';
import { Overlay } from '../canvas/overlay/index.ts';
import { Stage } from '../canvas/stage.ts';
import type { Views } from './views.ts';
import { Modal } from './Sheets.tsx';
import type { SnapPrefs } from '../interact/snap.ts';
import type { PanelUi } from './ui.ts';

interface Props {
  editor: Editor;
  views: Views;
  /** Why the canvas can't draw the open document (it refused the root), or null. */
  error: string | null;
  unparsed: Unparsed | null;
  files: () => void;
  onDrag: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  /** The panels' side of the commands: the Snap sheet opens from the palette too. */
  ui: PanelUi;
}

export function Canvas({ editor, views, error, unparsed, files, onDrag, onDrop, ui }: Props) {
  const area = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const marks = useRef<HTMLDivElement>(null);
  const under = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    const renderer = new Renderer(shadow);
    const overlay = new Overlay(marks.current!, el, { under: under.current!, paper: paper.current! });
    Object.assign(views, { renderer, overlay, host: el });
    const stage = new Stage(area.current!, el, shadow, editor, renderer);
    return () => {
      stage.destroy();
      overlay.destroy();
      Object.assign(views, { renderer: null, overlay: null, host: null });
    };
  }, [editor, views]);

  return (
    <main
      ref={area}
      className="draw-canvas"
      onDragEnter={(e: ReactDragEvent) => onDrag(e.nativeEvent)}
      onDragOver={(e: ReactDragEvent) => onDrag(e.nativeEvent)}
      onDrop={(e: ReactDragEvent) => onDrop(e.nativeEvent)}
    >
      <div ref={under} className="draw-under" aria-hidden="true">
        <div ref={paper} className="draw-paper" />
      </div>
      <div ref={host} className="draw-host" aria-hidden="true" />
      <div ref={marks} className="draw-marks" />
      <GridButton editor={editor} />
      <SnapButton editor={editor} area={area} ui={ui} />
      {error && <p className="draw-error ds-small">Can&rsquo;t show the drawing: {error}.</p>}
      <Over editor={editor} unparsed={unparsed} files={files} />
    </main>
  );
}

const GRID_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <path d="M4 4h16v16H4zM4 9.33h16M4 14.67h16M9.33 4v16M14.67 4v16" />
  </svg>
);

/** The grid over the paper, on or off: the device pref draw:grid, never the file (the Grid button, and the palette's Grid). */
export function toggleGrid(editor: Editor): void {
  const on = editor.grid.get();
  writePref('grid', on ? null : 'on');
  editor.grid.set(!on);
}

/** The Grid button. */
function GridButton({ editor }: { editor: Editor }) {
  const on = useStore(editor.grid);
  useEffect(() => editor.grid.set(readPref('grid') === 'on'), [editor]);
  return (
    <button type="button" className="draw-chrome draw-grid-btn" aria-label="Grid" aria-pressed={on} onClick={() => toggleGrid(editor)}>
      {GRID_ICON}
    </button>
  );
}

const SNAP_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3v7a6 6 0 0012 0V3" />
    <path d="M6 7h4M14 7h4" />
    <path d="M12 20v1M4 17l-1 1M20 17l1 1" />
  </svg>
);

const SNAP_NAMES: [keyof SnapPrefs, string][] = [['grid', 'Grid'], ['guides', 'Guides'], ['shapes', 'Shapes'], ['artboard', 'Artboard']];

/** What snaps, from the device pref draw:snap (all on unless turned off there). */
function readSnap(): SnapPrefs {
  const off = new Set((readPref('snap') ?? '').split(' ').filter(Boolean));
  return { grid: !off.has('grid'), guides: !off.has('guides'), shapes: !off.has('shapes'), artboard: !off.has('artboard') };
}

/** The Snap button and its sheet (in the app's root, not the canvas): the grid, its step, what snaps, and the guides. */
function SnapButton({ editor, area, ui }: { editor: Editor; area: RefObject<HTMLElement | null>; ui: PanelUi }) {
  const open = useStore(ui.snapOpen);
  useEffect(() => editor.snap.set(readSnap()), [editor]);
  return (
    <>
      <button type="button" className="draw-chrome draw-snap-btn" aria-label="Snap" aria-haspopup="dialog" onClick={() => ui.snapOpen.set(true)}>
        {SNAP_ICON}
      </button>
      {open && createPortal(<SnapSheet editor={editor} close={() => ui.snapOpen.set(false)} />, area.current?.closest('.draw') ?? document.body)}
    </>
  );
}

function SnapSheet({ editor, close }: { editor: Editor; close: () => void }) {
  const grid = useStore(editor.grid);
  const snap = useStore(editor.snap);
  useStore(editor.version);
  const state = editor.drawState;
  const more = editor.hiddenGuides;
  const [step, setStep] = useState(state.grid === null ? '' : String(state.grid));
  // The Grid step field is one history entry while it is typed in: it ends on a blur, or when the
  // sheet closes (Done, the dim, Escape) with the field still focused.
  useEffect(() => () => editor.gridStepEnd(), [editor]);
  const setGrid = (on: boolean) => {
    writePref('grid', on ? 'on' : null);
    editor.grid.set(on);
  };
  const toggle = (k: keyof SnapPrefs) => {
    const next = { ...snap, [k]: !snap[k] };
    writePref('snap', SNAP_NAMES.filter(([n]) => !next[n]).map(([n]) => n).join(' ') || null);
    editor.snap.set(next);
  };
  const applyStep = (text: string) => {
    setStep(text);
    const v = Number(text);
    if (text.trim() === '') editor.gridStepInput(null);
    else if (v > 0 && Number.isFinite(v)) editor.gridStepInput(v);
  };
  return (
    <Modal title="Snap" onClose={close} done mono={false}>
      <div className="draw-snap">
        <button type="button" className="ds-btn draw-snap-row" aria-pressed={grid} onClick={() => setGrid(!grid)}>
          Grid shown
        </button>
        <label className="draw-snap-step">
          <span>Grid step</span>
          <input className="draw-field ds-mono" inputMode="decimal" enterKeyHint="done" autoComplete="off" placeholder="Auto" aria-label="Grid step (empty: automatic)" value={step} onFocus={() => editor.gridStepStart()} onBlur={() => editor.gridStepEnd()} onChange={(e) => applyStep(e.target.value)} />
        </label>
        <p className="draw-subhead">Snap to</p>
        <div className="draw-snap-toggles">
          {SNAP_NAMES.map(([k, name]) => (
            <button key={k} type="button" className="ds-btn draw-snap-row" aria-pressed={snap[k]} onClick={() => toggle(k)}>
              {name}
            </button>
          ))}
        </div>
        <p className="draw-subhead">Guides</p>
        <div className="draw-snap-toggles">
          <button type="button" className="ds-btn draw-snap-row" onClick={() => editor.addGuide('v')}>
            Add vertical guide
          </button>
          <button type="button" className="ds-btn draw-snap-row" onClick={() => editor.addGuide('h')}>
            Add horizontal guide
          </button>
        </div>
        {state.guides.length > 0 && (
          <ul className="draw-guides">
            {state.guides.map((g, i) => (
              <li key={`${i}:${g.axis}:${g.at}`} className="draw-guide-row">
                <span className="ds-mono">
                  {g.axis === 'v' ? 'x' : 'y'} = {g.at}
                </span>
                <button type="button" className="ds-btn draw-snap-row" aria-label={`Remove the guide at ${g.axis === 'v' ? 'x' : 'y'} = ${g.at}`} onClick={() => editor.removeGuide(i)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {state.guides.length > 1 && (
          <button type="button" className="ds-btn draw-snap-row" onClick={() => editor.removeGuide('all')}>
            Remove all guides
          </button>
        )}
        {more > 0 && (
          <p className="draw-subhead draw-snap-more">
            {more} more guide{more === 1 ? '' : 's'} in the file {more === 1 ? 'isn’t' : 'aren’t'} shown.
          </p>
        )}
      </div>
    </Modal>
  );
}

function Over({ editor, unparsed, files }: { editor: Editor; unparsed: Unparsed | null; files: () => void }) {
  const broken = useStore(editor.canvasError);
  const motion = useStore(editor.motion);
  if (unparsed) {
    return (
      <div className="draw-over draw-chrome draw-unparsed" role="status">
        <p className="draw-over-title">Not drawn: “{unparsed.name}” isn’t well-formed XML.</p>
        <p className="draw-over-text">{failureText(unparsed)} The code shows its text, with the error marked. Nothing can be edited.</p>
        <button type="button" className="ds-btn draw-over-go" onClick={files}>
          Files
        </button>
      </div>
    );
  }
  if (broken) {
    return (
      <div className="draw-over draw-chrome draw-broken" role="alert">
        <p className="draw-over-title">The canvas couldn’t draw this ({broken}).</p>
        <p className="draw-over-text">Nothing is lost: the file and the code have every change, and undo works. The next change draws it again.</p>
        <button type="button" className="ds-btn draw-over-go" onClick={files}>
          Files
        </button>
      </div>
    );
  }
  if (motion === 'paused' || motion === 'playing') {
    return (
      <button type="button" className="draw-play-btn draw-chrome" aria-pressed={motion === 'playing'} onClick={() => editor.togglePlay()}>
        {motion === 'playing' ? 'Pause' : 'Play'}
      </button>
    );
  }
  return null;
}
