// The canvas: a host element whose open shadow root holds the rendered document, so the file's ids
// and <style> can't collide with the app's, and a layer above it for the selection outlines.
// React owns only these elements; the framework-free renderer owns everything inside the host (every
// node it draws comes through the safe sink), and the stage turns the canvas's input into the
// editor's view and the Select tool. The host is hidden from assistive tech: the code panel is the
// accessible view of the document.

import { useEffect, useRef } from 'react';
import type { Editor } from '../editor.ts';
import { Renderer } from '../canvas/renderer.ts';
import { Overlay } from '../canvas/overlay.ts';
import { Stage } from '../canvas/stage.ts';
import type { Views } from './views.ts';

export function Canvas({ editor, views, error }: { editor: Editor; views: Views; error: string | null }) {
  const area = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const marks = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    const renderer = new Renderer(shadow);
    const overlay = new Overlay(marks.current!);
    Object.assign(views, { renderer, overlay, host: el });
    const stage = new Stage(area.current!, el, shadow, editor, renderer);
    return () => {
      stage.destroy();
      overlay.destroy();
      Object.assign(views, { renderer: null, overlay: null, host: null });
    };
  }, [editor, views]);

  return (
    <main ref={area} className="draw-canvas">
      <div ref={host} className="draw-host" aria-hidden="true" />
      <div ref={marks} className="draw-marks" />
      {error && <p className="draw-error ds-small">Can&rsquo;t show the drawing: {error}.</p>}
    </main>
  );
}
