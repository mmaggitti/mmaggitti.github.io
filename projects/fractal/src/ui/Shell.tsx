import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { LayoutDoc } from '../core/types.ts';
import { appTitle } from '../core/nav.ts';
import { hueOf } from '../core/kinds.ts';
import { createWorkspace, type Surface, type WorkspaceHandle } from '../runtime/workspace.ts';
import { attachInput } from '../runtime/input.ts';
import { createDrag } from '../runtime/drag.ts';
import { layoutSaver } from '../platform/storage.ts';
import { Block, GroupBand } from '../apps/Blocks.tsx';
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
  const appRef = useRef<HTMLDivElement>(null);
  const edgeRefs = { left: useRef<HTMLDivElement>(null), right: useRef<HTMLDivElement>(null) };
  const [ws, setWs] = useState<WorkspaceHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const save = layoutSaver(setError);
    const w = createWorkspace({ host: viewportRef.current!, doc: initial, onChange: save });
    window.__fractal = w;
    const drag = createDrag({ ws: w, layerOf: appRef.current!, reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches });
    const detach = attachInput({
      app: appRef.current!,
      ws: w,
      drag,
      onEdge(side, amount) {
        const e = edgeRefs[side].current;
        if (e) e.style.setProperty('--fx-edge', String(amount));
      },
    });
    setWs(w);
    return () => {
      detach();
      w.destroy();
      if (window.__fractal === w) delete window.__fractal;
    };
  }, [initial]);

  return (
    <div className="fx-app" ref={appRef}>
      {ws ? <TopBar ws={ws} /> : <div className="fx-topbar" />}
      {error && (
        <p className="fx-error" role="alert">
          {error}
        </p>
      )}
      <div className="fx-stage">
        <div className="fx-host" ref={viewportRef} />
        <div className="fx-edge" data-side="left" ref={edgeRefs.left} aria-hidden="true">
          <span>‹</span>
        </div>
        <div className="fx-edge" data-side="right" ref={edgeRefs.right} aria-hidden="true">
          <span>›</span>
        </div>
      </div>
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
    case 'block':
      return <Block title={title} hue={hueOf(rec.params)} />;
    case 'container':
      return <GroupBand title={title} />;
    default:
      return <p className="band ds-muted">Unknown app</p>;
  }
}
