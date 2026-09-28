// Draw's shell. P0-M3, the interaction spine: the top bar, the canvas (zoom, pan, Select), the split
// code sheet (Code and Inspect), the ContextBar (the Scrub strip, or the selection's actions) and
// the ToolRail, over the framework-free editor (src/editor.ts). Files, drafts and export arrive in
// M4 (see the plan in the vault's _audit/).

import { useEffect, useState } from 'react';
import { Editor, type OpenResult } from '../editor.ts';
import type { View } from '../canvas/viewport.ts';
import { Views } from './views.ts';
import { Canvas } from './Canvas.tsx';
import { CodePanel } from './CodePanel.tsx';
import { ContextBar } from './ContextBar.tsx';
import { Sheets } from './Sheets.tsx';
import { ToolRail } from './ToolRail.tsx';
import sample from '../canvas/sample.svg?raw';

declare global {
  interface Window {
    // The e2e test opens every corpus file with render(), exactly the way M4's file open will: the
    // engine's parser, then the renderer and the sink. It adds no other way in; source() and
    // view() only read.
    drawTest?: { render(text: string): OpenResult; source(): string; view(): View & { fitScale: number } };
  }
}

export function App() {
  const [views] = useState(() => new Views());
  const [editor] = useState(() => new Editor(views.ports));
  const [error, setError] = useState<string | null>(null);

  // Runs after Canvas and CodePanel have attached their views (child effects run first).
  useEffect(() => {
    setError(editor.open(sample).error ?? null);
    window.drawTest = { render: (text) => editor.open(text), source: () => editor.source(), view: () => ({ ...editor.view, fitScale: editor.fitScale }) };
    const keys = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!(e.metaKey || e.ctrlKey) || t?.closest?.('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'y') {
        e.preventDefault();
        if (k === 'y' || e.shiftKey) editor.redo();
        else editor.undo();
      }
    };
    window.addEventListener('keydown', keys);
    return () => {
      window.removeEventListener('keydown', keys);
      delete window.drawTest;
    };
  }, [editor]);

  return (
    <div className="draw ds-app">
      <header className="draw-bar">
        <span className="draw-name">Draw</span>
        <span className="draw-badge ds-small">preview</span>
        <button type="button" className="draw-fit" onClick={() => editor.fitToScreen()}>
          Fit
        </button>
      </header>
      <div className="draw-split">
        <Canvas editor={editor} views={views} error={error} />
        <CodePanel editor={editor} views={views} />
      </div>
      <ContextBar editor={editor} />
      <ToolRail editor={editor} />
      <Sheets editor={editor} />
    </div>
  );
}
