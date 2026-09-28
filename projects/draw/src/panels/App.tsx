// Draw's shell: the top bar (Files, the drawing's name and save state, Fit, Export), the canvas
// (zoom, pan, Select; a dropped file opens), the split code sheet (Code, Inspect and Support), the
// ContextBar (the Scrub strip, or the selection's actions) and the ToolRail, over the
// framework-free editor (src/editor.ts) and workspace (src/workspace.ts: opening, drafts, export).
// Every open goes through the one importer (src/import.ts); files, the clipboard, storage and the
// share sheet only through src/platform/.

import { useEffect, useState } from 'react';
import { Editor, type OpenResult } from '../editor.ts';
import { Workspace } from '../workspace.ts';
import type { View } from '../canvas/viewport.ts';
import { DraftStore, idbKV, lockDraft } from '../platform/drafts.ts';
import { acceptDrag, clearFragment, dropped, fragment, pasted } from '../platform/files.ts';
import { Views } from './views.ts';
import { Canvas } from './Canvas.tsx';
import { CodePanel } from './CodePanel.tsx';
import { ContextBar } from './ContextBar.tsx';
import { FileSheets } from './FileSheets.tsx';
import { Guard } from './Guard.tsx';
import { Sheets } from './Sheets.tsx';
import { ToolRail } from './ToolRail.tsx';
import { useStore } from './store.ts';
import type { SaveState } from '../autosave.ts';
import sample from '../canvas/sample.svg?raw';

declare global {
  interface Window {
    // The e2e test opens every corpus file with render(): the engine's parser, then the renderer
    // and the sink, as the importer does, but with no draft and no report (a document opened this
    // way is never saved). It adds no other way in; source() and view() only read.
    drawTest?: { render(text: string): OpenResult; source(): string; view(): View & { fitScale: number } };
  }
}

const SAVE_LABEL: Record<SaveState['kind'], string> = {
  none: '',
  pending: 'Editing',
  saving: 'Saving…',
  saved: 'Saved',
  'read-only': 'Read-only',
  failed: 'Not saved',
};

export function App() {
  const [views] = useState(() => new Views());
  const [editor] = useState(() => new Editor(views.ports));
  const [workspace] = useState(() => new Workspace(editor, { store: new DraftStore(idbKV()), lock: lockDraft, sample }));
  const current = useStore(workspace.current);

  // Runs after Canvas and CodePanel have attached their views (child effects run first).
  useEffect(() => {
    void workspace.openSample();
    void workspace.boot(fragment(), clearFragment);
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
    // A paste anywhere but a field opens SVG (⌘V on the iPad or a Mac); a field keeps its own paste.
    const paste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
      const p = pasted(e);
      if (!p?.svg) return;
      e.preventDefault();
      void workspace.openText(p.text, '', 'paste');
    };
    // Save now when the page may not come back: hidden (the app switcher, a locked phone) or gone.
    const flush = () => void workspace.autosave.flush();
    const hidden = () => document.visibilityState === 'hidden' && flush();
    // An #import link entered while Draw is open changes only the fragment. It may come from a page
    // that opened this tab, so it opens only when Mark taps Open (the Open link sheet).
    const link = () => void workspace.offerLink(fragment(), clearFragment);
    window.addEventListener('keydown', keys);
    window.addEventListener('paste', paste);
    window.addEventListener('pagehide', flush);
    window.addEventListener('hashchange', link);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', keys);
      window.removeEventListener('paste', paste);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('hashchange', link);
      document.removeEventListener('visibilitychange', hidden);
      delete window.drawTest;
    };
  }, [editor, workspace]);

  const drop = (e: DragEvent) => {
    e.preventDefault(); // the browser would open the file itself
    const d = dropped(e);
    if (!d) return;
    if ('file' in d) void workspace.openFile(d.file, d.name, 'drop');
    else void workspace.openText(d.text, d.name, 'drop');
  };

  // A panel that throws shows a message and Files, never a blank page (Guard). The canvas and the
  // code view are outside every guard: they hold the drawing, and React only owns their containers.
  const files = () => workspace.show('files');
  return (
    <div className="draw ds-app">
      <Guard files={files}>
        <header className="draw-bar">
          <button type="button" className="draw-bar-btn draw-files" aria-haspopup="dialog" onClick={() => workspace.show('files')}>
            Files
          </button>
          <span className="draw-title">
            <span className="draw-name">{current?.name ?? 'Draw'}</span>
            <SaveLabel workspace={workspace} />
          </span>
          <span className="draw-badge ds-small">preview</span>
          <button type="button" className="draw-fit" onClick={() => editor.fitToScreen()}>
            Fit
          </button>
          <button type="button" className="draw-bar-btn draw-export" aria-haspopup="dialog" onClick={() => workspace.show('export')}>
            Export
          </button>
        </header>
        <Alert workspace={workspace} />
      </Guard>
      <div className="draw-split">
        <Canvas editor={editor} views={views} error={current?.problem ?? null} onDrag={acceptDrag} onDrop={drop} />
        <CodePanel editor={editor} views={views} files={files} />
      </div>
      <Guard files={files}>
        <ContextBar editor={editor} />
        <ToolRail editor={editor} />
        <Sheets editor={editor} />
        <FileSheets workspace={workspace} />
      </Guard>
    </div>
  );
}

function SaveLabel({ workspace }: { workspace: Workspace }) {
  const s = useStore(workspace.autosave.state);
  const label = SAVE_LABEL[s.kind];
  return label ? (
    <span className="draw-save ds-small" data-save={s.kind} aria-live="polite">
      {label}
    </span>
  ) : null;
}

/**
 * Loud and persistent: a drawing's changes aren't stored (export it now, or reopen it from Files when
 * it isn't the one open), or another tab has this drawing (read-only).
 */
function Alert({ workspace }: { workspace: Workspace }) {
  const s = useStore(workspace.autosave.state);
  if (s.kind === 'failed') {
    return (
      <div className="draw-alert draw-alert--loud" role="alert">
        <p className="draw-alert-text">{s.message}</p>
        <button type="button" className="draw-key draw-alert-go" onClick={() => workspace.show(s.open ? 'export' : 'files')}>
          {s.open ? 'Export now' : 'Files'}
        </button>
      </div>
    );
  }
  if (s.kind === 'read-only') {
    return (
      <div className="draw-alert" role="status">
        <p className="draw-alert-text">This drawing is open in another tab, so it is read-only here. Edit it there, or open it again here once that tab is closed.</p>
      </div>
    );
  }
  return null;
}
