// The canvas: a host element whose open shadow root holds the rendered document, so the file's ids
// and <style> can't collide with the app's, and a layer above it for the selection outlines.
// React owns only these elements; the framework-free renderer owns everything inside the host (every
// node it draws comes through the safe sink), and the stage turns the canvas's input into the
// editor's view and the Select tool. The host is hidden from assistive tech: the code panel is the
// accessible view of the document. A file (or SVG text) dropped on the canvas opens (iPad, desktop).
//
// Over the drawing, when there is something to say: a file that isn't well-formed (it is shown only
// as source, in the code), a drawing the canvas couldn't draw (the file and the code are kept), and,
// under reduced motion, Play for a drawing that animates (it opens paused).

import { useEffect, useRef, type DragEvent as ReactDragEvent } from 'react';
import type { Editor } from '../editor.ts';
import type { Unparsed } from '../workspace.ts';
import { failureText } from '../files-view.ts';
import { useStore } from './store.ts';
import { Renderer } from '../canvas/renderer.ts';
import { Overlay } from '../canvas/overlay.ts';
import { Stage } from '../canvas/stage.ts';
import type { Views } from './views.ts';

interface Props {
  editor: Editor;
  views: Views;
  /** Why the canvas can't draw the open document (it refused the root), or null. */
  error: string | null;
  unparsed: Unparsed | null;
  files: () => void;
  onDrag: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

export function Canvas({ editor, views, error, unparsed, files, onDrag, onDrop }: Props) {
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
    <main
      ref={area}
      className="draw-canvas"
      onDragEnter={(e: ReactDragEvent) => onDrag(e.nativeEvent)}
      onDragOver={(e: ReactDragEvent) => onDrag(e.nativeEvent)}
      onDrop={(e: ReactDragEvent) => onDrop(e.nativeEvent)}
    >
      <div ref={host} className="draw-host" aria-hidden="true" />
      <div ref={marks} className="draw-marks" />
      {error && <p className="draw-error ds-small">Can&rsquo;t show the drawing: {error}.</p>}
      <Over editor={editor} unparsed={unparsed} files={files} />
    </main>
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
