import { useState, useSyncExternalStore } from 'react';
import type { WorkspaceHandle } from '../runtime/workspace.ts';

/** Back (one level out), Overview, History and Arrange, in the thumb zone. While arranging: Back,
 * Undo, Redo and Done. */
export function BottomBar({ ws }: { ws: WorkspaceHandle }) {
  const v = useSyncExternalStore(ws.view.subscribe, ws.view.get);
  const [history, setHistory] = useState(false);
  const atOverview = v.frame === null;
  const back = (
    <button type="button" className="ds-btn" disabled={atOverview} onClick={() => ws.stepOut()}>
      Back
    </button>
  );
  if (v.arranging) {
    return (
      <nav className="fx-bottombar" aria-label="Arrange">
        {back}
        <button type="button" className="ds-btn" disabled={!v.canUndo} onClick={() => ws.undo()}>
          Undo
        </button>
        <button type="button" className="ds-btn" disabled={!v.canRedo} onClick={() => ws.redo()}>
          Redo
        </button>
        <button type="button" className="ds-btn ds-btn--primary" onClick={() => ws.setArranging(false)}>
          Done
        </button>
      </nav>
    );
  }
  return (
    <>
      {history && (
        <div className="fx-sheet" role="dialog" aria-label="History">
          <button type="button" className="ds-btn" disabled={!v.canBack} onClick={() => ws.history(-1)}>
            ← Back in history
          </button>
          <button type="button" className="ds-btn" disabled={!v.canForward} onClick={() => ws.history(1)}>
            Forward →
          </button>
          <button type="button" className="ds-btn" onClick={() => setHistory(false)}>
            Close
          </button>
        </div>
      )}
      <nav className="fx-bottombar" aria-label="Navigate">
        {back}
        <button type="button" className="ds-btn" aria-pressed={atOverview} onClick={() => ws.overview()}>
          Overview
        </button>
        <button type="button" className="ds-btn" aria-expanded={history} onClick={() => setHistory(!history)}>
          History
        </button>
        <button
          type="button"
          className="ds-btn"
          onClick={() => {
            setHistory(false);
            ws.setArranging(true);
          }}
        >
          Arrange
        </button>
      </nav>
    </>
  );
}
