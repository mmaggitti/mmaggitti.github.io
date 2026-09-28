// The split sheet under the canvas: its handle, the Code and Inspect tabs, and the code view. Three
// detents (peek, half, full): drag the handle between them, or tap it to step through them; the
// canvas takes whatever height the sheet leaves. The code view is framework-free (codeview/): React
// owns only its container, which stays mounted while hidden so edits keep patching it.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { decodeAttr } from '../../../../engine/xml/entities.ts';
import type { ElementNode } from '../../../../engine/model/doc.ts';
import type { Editor } from '../editor.ts';
import { CodeView } from '../codeview/code-view.ts';
import { detentHeights, dragHeight, nextDetent, settle, TAP_SLOP, type Detent, type Heights } from '../detents.ts';
import { elementLabel } from './label.ts';
import { useStore } from './store.ts';
import type { Views } from './views.ts';

const HANDLE_LABEL: Record<Detent, string> = { peek: 'Show the code', half: 'Expand the code', full: 'Collapse the code' };

interface Press {
  id: number;
  y0: number;
  h0: number;
  y: number;
  t: number;
  v: number; // pt/ms, negative upward
  moved: boolean;
}

export function CodePanel({ editor, views }: { editor: Editor; views: Views }) {
  const sheet = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const code = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const dragged = useRef(false);
  const [detent, setDetent] = useState<Detent>('peek');
  const [tab, setTab] = useState<'code' | 'inspect'>('code');
  const [heights, setHeights] = useState<Heights | null>(null);
  const [live, setLive] = useState<number | null>(null); // the height while the handle is dragged

  useEffect(() => {
    const view = new CodeView(code.current!, {
      tap: (block, token) => editor.tapToken(block, token),
      blockTap: (block) => editor.tapBlock(block),
      scrubStart: (block, token) => editor.scrubStart(block, token),
      scrub: (steps) => editor.scrub(steps),
      scrubEnd: (committed) => editor.scrubEnd(committed),
    });
    views.code = view;
    return () => {
      view.destroy();
      views.code = null;
    };
  }, [editor, views]);

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

  // Code shown again: bring the selection's block into view.
  useEffect(() => {
    if (detent !== 'peek' && tab === 'code') editor.revealSelection();
  }, [detent, tab, editor]);

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
  const show = (t: 'code' | 'inspect') => {
    setTab(t);
    if (detent === 'peek') setDetent('half');
  };

  const height = live ?? (detent === 'peek' || !heights ? undefined : heights[detent]);
  return (
    <section ref={sheet} className={`draw-sheet draw-sheet--${detent}`} style={height === undefined ? undefined : { height }} aria-label="Code panel">
      <div ref={head} className="draw-sheet-head">
        <button
          type="button"
          className="draw-handle"
          aria-label={HANDLE_LABEL[detent]}
          aria-expanded={detent !== 'peek'}
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
            <button type="button" aria-pressed={tab === 'inspect'} onClick={() => show('inspect')}>
              Inspect
            </button>
          </div>
          <SelectionLabel editor={editor} />
        </div>
      </div>
      <div className="draw-sheet-body" hidden={detent === 'peek' && live === null}>
        <div ref={code} className="draw-code" role="region" aria-label="SVG source" hidden={tab !== 'code'} />
        {tab === 'inspect' && <Inspect editor={editor} />}
      </div>
    </section>
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

/** P0's Inspect tab: the selected element's attributes, as the file has them. */
function Inspect({ editor }: { editor: Editor }) {
  const selection = useStore(editor.selection);
  useStore(editor.version);
  const doc = editor.doc;
  const id = [...selection][0];
  const n = doc && id !== undefined ? doc.nodes.get(id) : undefined;
  if (!doc || !n || n.kind !== 'element') return <p className="draw-empty ds-muted">Select something to see its attributes.</p>;
  const node = n as ElementNode;
  return (
    <dl className="ds-list draw-attrs">
      <div className="ds-row">
        <dt>element</dt>
        <dd className="ds-mono">{elementLabel(doc, id)}</dd>
      </div>
      {node.attrs.map((a, i) => (
        <div className="ds-row" key={`${i}:${a.qname}`}>
          <dt className="ds-mono">{a.qname}</dt>
          <dd className="ds-mono">{decodeAttr(a.raw, doc.entities)}</dd>
        </div>
      ))}
    </dl>
  );
}
