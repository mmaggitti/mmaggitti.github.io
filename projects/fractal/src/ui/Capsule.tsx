import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WorkspaceHandle } from '../runtime/workspace.ts';

/** The one piece of global chrome: a small glass pill floating in the thumb zone. ‹ goes up a level;
 * the name says where you are (dots: which page); a sideways swipe on it flips pages (input.ts); a
 * tap on the name opens the sheet. While arranging it reads ‹ · Undo · Redo · Done. */
export function Capsule({ ws }: { ws: WorkspaceHandle }) {
  const v = useSyncExternalStore(ws.view.subscribe, ws.view.get);
  const [sheet, setSheet] = useState(false);
  const down = useRef<{ x: number; y: number } | null>(null);
  const here = v.crumbs.at(-1)?.label ?? 'Home';

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setSheet(false);
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [sheet]);
  useEffect(() => {
    if (v.arranging) setSheet(false);
  }, [v.arranging]);

  const back = (
    <button type="button" className="fx-capsule-btn fx-capsule-back" data-nav="back" aria-label="Up a level" disabled={v.frame === null} onClick={() => ws.stepOut()}>
      ‹
    </button>
  );
  const run = (fn: () => void) => () => {
    setSheet(false);
    fn();
  };

  if (v.arranging) {
    return (
      <nav className="fx-capsule" aria-label="Arrange">
        {back}
        <button type="button" className="fx-capsule-btn" disabled={!v.canUndo} onClick={() => ws.undo()}>
          Undo
        </button>
        <button type="button" className="fx-capsule-btn" disabled={!v.canRedo} onClick={() => ws.redo()}>
          Redo
        </button>
        <button type="button" className="fx-capsule-btn fx-capsule-done" onClick={() => ws.setArranging(false)}>
          Done
        </button>
      </nav>
    );
  }

  return (
    <>
      {sheet && (
        <div className="fx-sheet fx-capsule-sheet" role="dialog" aria-label="Places and actions">
          <ol className="fx-levels" aria-label="Levels">
            {v.crumbs.map((c, i) => (
              <li key={`${c.frame}`}>
                <button type="button" className="ds-btn" aria-current={i === v.crumbs.length - 1 ? 'location' : undefined} onClick={run(() => ws.frame(c.frame))}>
                  {c.label}
                </button>
              </li>
            ))}
          </ol>
          <div className="fx-menu-row">
            <button type="button" className="ds-btn" aria-pressed={v.frame === null} onClick={run(() => ws.overview())}>
              Overview
            </button>
            <button type="button" className="ds-btn" aria-label="Back in history" disabled={!v.canBack} onClick={run(() => ws.history(-1))}>
              ←
            </button>
            <button type="button" className="ds-btn" aria-label="Forward in history" disabled={!v.canForward} onClick={run(() => ws.history(1))}>
              →
            </button>
          </div>
          {v.page.count > 1 && (
            <div className="fx-menu-row">
              <button type="button" className="ds-btn" disabled={!v.prev} onClick={run(() => ws.neighbour(-1))}>
                ‹ Previous
              </button>
              <button type="button" className="ds-btn" disabled={!v.next} onClick={run(() => ws.neighbour(1))}>
                Next ›
              </button>
            </div>
          )}
          <button type="button" className="ds-btn" onClick={run(() => ws.setArranging(true))}>
            Arrange
          </button>
          <button type="button" className="ds-btn" onClick={() => setSheet(false)}>
            Close
          </button>
        </div>
      )}
      <nav className="fx-capsule" aria-label="Where you are">
        {back}
        <button
          type="button"
          className="fx-capsule-btn fx-capsule-name"
          aria-expanded={sheet}
          aria-haspopup="dialog"
          onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
          onClick={(e) => {
            // A swipe across the pill flips pages (input.ts); it must not also open the sheet.
            const d = down.current;
            if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
            setSheet(!sheet);
          }}
        >
          <span className="fx-capsule-here">{here}</span>
          {v.page.count > 1 && (
            <span className="fx-dots" role="img" aria-label={`Panel ${v.page.index + 1} of ${v.page.count}`}>
              {Array.from({ length: v.page.count }, (_, i) => (
                <span key={i} className="fx-dot" data-on={i === v.page.index ? '' : undefined} />
              ))}
            </span>
          )}
        </button>
      </nav>
    </>
  );
}
