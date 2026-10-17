import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { LayoutDoc } from '../core/types.ts';
import { appTitle } from '../core/nav.ts';
import { appsIn } from '../core/tree.ts';
import { createWorkspace, type Surface, type WorkspaceHandle } from '../runtime/workspace.ts';
import { layoutSaver } from '../platform/storage.ts';
import { ContainerBand, ProbeCounter, ProbeField, ProbeList } from '../apps/Probe.tsx';
import { TopBar } from './TopBar.tsx';
import { BottomBar } from './BottomBar.tsx';

declare global {
  interface Window {
    /** Test hook: the workspace handle. */
    __fractal?: WorkspaceHandle;
  }
}

export function Shell({ initial }: { initial: LayoutDoc }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [ws, setWs] = useState<WorkspaceHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const save = layoutSaver(setError);
    const w = createWorkspace({ host: viewportRef.current!, doc: initial, onChange: save });
    window.__fractal = w;
    setWs(w);
    return () => {
      w.destroy();
      if (window.__fractal === w) delete window.__fractal;
    };
  }, [initial]);

  return (
    <div className="fx-app">
      {ws ? <TopBar ws={ws} /> : <div className="fx-topbar" />}
      {error && (
        <p className="fx-error" role="alert">
          {error}
        </p>
      )}
      <div className="fx-host" ref={viewportRef} />
      {ws ? <BottomBar ws={ws} /> : <div className="fx-bottombar" />}
      {ws && <Portals ws={ws} />}
    </div>
  );
}

function Portals({ ws }: { ws: WorkspaceHandle }) {
  const surfaces = useSyncExternalStore(ws.surfaces.subscribe, ws.surfaces.get);
  return <>{surfaces.map((s) => createPortal(<AppHost ws={ws} surface={s} />, s.content, s.app))}</>;
}

function AppHost({ ws, surface }: { ws: WorkspaceHandle; surface: Surface }) {
  const doc = ws.getDoc();
  const rec = doc.apps[surface.app];
  if (!rec) return null;
  const title = appTitle(doc, surface.app);
  switch (rec.kind) {
    case 'list':
      return <ProbeList seed={Number(rec.params.seed) || 0} title={title} />;
    case 'field':
      return <ProbeField title={title} />;
    case 'counter':
      return <ProbeCounter title={title} />;
    case 'container':
      return <ContainerBand title={title} count={rec.dock ? appsIn(doc, rec.dock).length : 0} />;
    default:
      return <p className="probe ds-muted">Unknown app</p>;
  }
}
