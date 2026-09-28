// The canvas: a host element whose open shadow root holds the rendered document, so the file's ids
// and <style> can't collide with the app's. React owns only the host; the framework-free renderer
// owns everything inside it, and every node it draws comes through the safe sink.

import { useEffect, useRef, useState } from 'react';
import { NS, el, parseDoc } from '../../../../engine/model/doc.ts';
import { Renderer, type RenderStats } from '../canvas/renderer.ts';
import { sinkReady } from '../canvas/safe-sink.ts';
import sample from '../canvas/sample.svg?raw';

export interface RenderResult extends RenderStats {
  ok: boolean;
  error?: string;
}

declare global {
  interface Window {
    // The e2e test opens every corpus file with this, exactly the way M4's file open will: the
    // engine's parser, then the renderer and the sink. It adds no other way in.
    drawTest?: { render(text: string): RenderResult };
  }
}

// A file that can't be drawn says so: one that fails to parse or throws while drawing (the previous
// drawing stays), and one whose root the canvas refuses (nothing would show).
function open(renderer: Renderer, text: string): RenderResult {
  const none = { rendered: 0, skippedElements: 0, droppedAttributes: 0 };
  if (!sinkReady()) return { ok: false, error: 'DOMPurify is unavailable, so nothing renders', ...none };
  const parsed = parseDoc(text);
  if (!parsed.ok) return { ok: false, error: parsed.error.message, ...none };
  try {
    renderer.render(parsed.doc);
  } catch (e) {
    return { ok: false, error: String(e), ...none };
  }
  const root = el(parsed.doc, parsed.doc.root);
  if (!renderer.nodeFor(root.id)) {
    const svg = root.ns === NS.svg && root.local === 'svg';
    return { ok: false, error: svg ? 'the canvas refused its root <svg>' : 'the root element is not an <svg> in the SVG namespace', ...renderer.stats() };
  }
  return { ok: true, ...renderer.stats() };
}

export function Canvas() {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new Renderer(el.shadowRoot ?? el.attachShadow({ mode: 'open' }));
    setError(open(renderer, sample).error ?? null);
    window.drawTest = { render: (text) => open(renderer, text) };
    return () => {
      delete window.drawTest;
    };
  }, []);

  return (
    <>
      <div ref={host} className="draw-host" />
      {error && <p className="draw-error ds-small">Can&rsquo;t show the drawing: {error}.</p>}
    </>
  );
}
