import { useSyncExternalStore } from 'react';
import type { WorkspaceHandle } from '../runtime/workspace.ts';

/** The breadcrumb and the neighbour buttons. */
export function TopBar({ ws }: { ws: WorkspaceHandle }) {
  const v = useSyncExternalStore(ws.view.subscribe, ws.view.get);
  const last = v.crumbs.length - 1;
  return (
    <nav className="fx-topbar" aria-label="Where you are">
      <button type="button" className="fx-bar-btn" aria-label="Previous panel" disabled={!v.prev} onClick={() => ws.neighbour(-1)}>
        ‹
      </button>
      <ol className="fx-crumbs">
        {v.crumbs.map((c, i) => (
          <li key={`${c.frame}`}>
            {i === last ? (
              <span className="fx-crumb fx-crumb--here" aria-current="location">
                {c.label}
              </span>
            ) : (
              <button type="button" className="fx-crumb" onClick={() => ws.frame(c.frame)}>
                {c.label}
              </button>
            )}
          </li>
        ))}
      </ol>
      {v.page.count > 1 && (
        <span className="fx-page ds-small ds-muted" aria-label={`Panel ${v.page.index + 1} of ${v.page.count}`}>
          {v.page.index + 1}/{v.page.count}
        </span>
      )}
      <button type="button" className="fx-bar-btn" aria-label="Next panel" disabled={!v.next} onClick={() => ws.neighbour(1)}>
        ›
      </button>
    </nav>
  );
}
