// The split sheet under the canvas: its handle, the Code, Layers, Inspect, Access (P1-M4 S3) and Support
// tabs, and the code view. Three
// detents (peek, half, full): drag the handle between them, or tap it to step through them; the
// canvas takes whatever height the sheet leaves. The code view is framework-free (codeview/): React
// owns only its container, which stays mounted while hidden so edits keep patching it.
//
// Over the code: the legend ("Drag" a pink number; "Tap" a blue word or colour, or amber text,
// which is yellow in dark; not shown when nothing can be edited), Tidy (the tidy view: a way of
// showing the code, never a change to the file) and Copy.
// On a wide screen, or a phone on its side (media.ts DOCK), the sheet docks beside the canvas at
// full height instead. A file open as read-only source shows its text here, at the error.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Editor } from '../editor.ts';
import { CodeView } from '../codeview/code-view.ts';
import { detentHeights, dragHeight, nextDetent, settle, TAP_SLOP, type Detent, type Heights } from '../detents.ts';
import { readPref, writePref } from '../platform/prefs.ts';
import { elementLabel } from './label.ts';
import { DOCK, useMedia } from './media.ts';
import { useStore } from './store.ts';
import { Support } from './Support.tsx';
import { Guard } from './Guard.tsx';
import { Layers } from './Layers.tsx';
import { Inspect } from './Inspect.tsx';
import { Access } from './Access.tsx';
import type { Views } from './views.ts';

const HANDLE_LABEL: Record<Detent, string> = { peek: 'Show the code', half: 'Expand the code', full: 'Collapse the code' };
type Tab = 'code' | 'layers' | 'inspect' | 'access' | 'support';

interface Press {
  id: number;
  y0: number;
  h0: number;
  y: number;
  t: number;
  v: number; // pt/ms, negative upward
  moved: boolean;
}

interface Props {
  editor: Editor;
  views: Views;
  files: () => void;
  copy: () => void;
  /** A file open as read-only source (not well-formed): the code shows its text, at the error. */
  source: boolean;
}

export function CodePanel({ editor, views, files, copy, source }: Props) {
  const sheet = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const code = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const dragged = useRef(false);
  const docked = useMedia(DOCK);
  const [detent, setDetent] = useState<Detent>('peek');
  const [tab, setTab] = useState<Tab>('code');
  const [heights, setHeights] = useState<Heights | null>(null);
  const [live, setLive] = useState<number | null>(null); // the height while the handle is dragged
  const [tidy, setTidy] = useState(() => readPref('tidy') === 'on');
  const readOnly = useStore(editor.readOnly);

  useEffect(() => {
    const view = new CodeView(code.current!, {
      tap: (block, token) => editor.tapToken(block, token),
      blockTap: (block) => editor.tapBlock(block),
      scrubStart: (block, token) => editor.scrubStart(block, token),
      scrub: (steps) => editor.scrub(steps),
      scrubEnd: (committed) => editor.scrubEnd(committed),
      key: (block, token, key) => editor.keyToken(block, token, key),
    });
    views.code = view;
    return () => {
      view.destroy();
      views.code = null;
    };
  }, [editor, views]);

  useEffect(() => {
    views.code?.layout(tidy);
  }, [tidy, views]);

  // The detents follow the space the canvas and the sheet share, and the sheet's head (from the
  // sheet's top edge, its hairline included, so peek is the height the sheet has there).
  useEffect(() => {
    const split = sheet.current!.parentElement!;
    const measure = () => setHeights(detentHeights(split.getBoundingClientRect().height, head.current!.getBoundingClientRect().bottom - sheet.current!.getBoundingClientRect().top));
    const ro = new ResizeObserver(measure);
    ro.observe(split);
    ro.observe(head.current!);
    return () => ro.disconnect();
  }, []);

  const open = docked || detent !== 'peek';
  // Code shown again: bring the selection's block into view.
  useEffect(() => {
    if (open && tab === 'code') editor.revealSelection();
  }, [open, tab, editor]);

  // A file opened as source: the code, at half at least, with its error in view.
  useEffect(() => {
    if (!source) return;
    setTab('code');
    setDetent((d) => (d === 'peek' ? 'half' : d));
    requestAnimationFrame(() => views.code?.revealError());
  }, [source, views]);

  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragged.current = false; // a touch drag gets no click to clear this, so it would swallow the next tap
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const h0 = sheet.current!.getBoundingClientRect().height;
    press.current = { id: e.pointerId, y0: e.clientY, h0, y: e.clientY, t: e.timeStamp, v: 0, moved: false };
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId || !heights) return;
    if (!p.moved && Math.abs(e.clientY - p.y0) < TAP_SLOP) return;
    p.moved = true;
    const dt = e.timeStamp - p.t;
    if (dt > 0) p.v = (e.clientY - p.y) / dt;
    p.y = e.clientY;
    p.t = e.timeStamp;
    setLive(dragHeight(heights, p.h0, e.clientY - p.y0));
  };
  const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (!p.moved || !heights) return;
    dragged.current = true; // the click that follows is not a tap
    setDetent(settle(heights, dragHeight(heights, p.h0, p.y - p.y0), e.type === 'pointercancel' ? 0 : p.v));
    setLive(null);
  };
  const tap = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    setDetent(nextDetent(detent));
  };
  const show = (t: Tab) => {
    setTab(t);
    if (detent === 'peek') setDetent('half');
  };
  const toggleTidy = () => {
    writePref('tidy', tidy ? null : 'on');
    setTidy(!tidy);
  };

  const height = docked ? undefined : live ?? (detent === 'peek' || !heights ? undefined : heights[detent]);
  return (
    <section ref={sheet} className={`draw-sheet draw-sheet--${docked ? 'dock' : detent}`} style={height === undefined ? undefined : { height }} aria-label="Code panel">
      <div ref={head} className="draw-sheet-head">
        <button
          type="button"
          className="draw-handle"
          aria-label={HANDLE_LABEL[detent]}
          aria-expanded={detent !== 'peek'}
          hidden={docked}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onClick={tap}
        >
          <span className="draw-grip" aria-hidden="true" />
        </button>
        <div className="draw-sheet-row">
          <div className="ds-seg draw-tabs" role="group" aria-label="Panel">
            <button type="button" aria-pressed={tab === 'code'} onClick={() => show('code')}>
              Code
            </button>
            <button type="button" aria-pressed={tab === 'layers'} onClick={() => show('layers')}>
              Layers
            </button>
            <button type="button" aria-pressed={tab === 'inspect'} onClick={() => show('inspect')}>
              Inspect
            </button>
            <button type="button" aria-pressed={tab === 'access'} onClick={() => show('access')}>
              Access
            </button>
            <button type="button" aria-pressed={tab === 'support'} onClick={() => show('support')}>
              Support
            </button>
          </div>
          <SelectionLabel editor={editor} />
        </div>
      </div>
      <div className="draw-sheet-body" hidden={!open && live === null}>
        <div className="draw-code-bar" hidden={tab !== 'code'}>
          {!source && !readOnly && <Legend />}
          {!source && (
            <button type="button" className="draw-bar-key draw-tidy" aria-pressed={tidy} aria-label="Tidy view (display only: the file is unchanged)" onClick={toggleTidy}>
              Tidy
            </button>
          )}
          {!source && !readOnly && (
            <button type="button" className="draw-key draw-code-edit" aria-haspopup="dialog" aria-label="Edit the drawing’s source" onClick={() => editor.openDrawingSource()}>
              Edit
            </button>
          )}
          <button type="button" className="draw-bar-key draw-copy" onClick={copy}>
            Copy
          </button>
        </div>
        <div ref={code} className="draw-code" role="region" aria-label="SVG source" hidden={tab !== 'code'} />
        <Guard files={files}>
          {tab === 'layers' && <Layers editor={editor} />}
          {tab === 'inspect' && <Inspect editor={editor} />}
          {tab === 'access' && <Access editor={editor} />}
          {tab === 'support' && <Support />}
        </Guard>
      </div>
    </section>
  );
}

/**
 * What the code's colours mean, verb first: drag a pink number; tap a blue word or colour, or amber
 * text. Each sample is a chip in its tokens' colour, so it reads as code apart from the words.
 */
function Legend() {
  return (
    <p className="draw-legend">
      <span className="draw-legend-item">
        Drag <span className="cv-key cv-key--number">12</span>
      </span>{' '}
      <span className="draw-legend-item">
        Tap <span className="cv-key cv-key--word">round</span>{' '}
        <span className="cv-key cv-key--word">
          <span className="cv-swatch" style={{ '--cv-swatch': '#ff7f50' } as CSSProperties} />
          coral
        </span>{' '}
        <span className="cv-key cv-key--text">Hi</span>
      </span>
    </p>
  );
}

function SelectionLabel({ editor }: { editor: Editor }) {
  const selection = useStore(editor.selection);
  useStore(editor.version);
  const ids = [...selection];
  const label = ids.length > 1 ? `${ids.length} selected` : elementLabel(editor.doc, ids[0]);
  return (
    <span className="draw-sel ds-mono" aria-live="polite">
      {label ?? 'nothing selected'}
    </span>
  );
}
