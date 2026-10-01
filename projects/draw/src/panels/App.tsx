// Draw's shell: the top bar (Files, the drawing's name and save state, Fit, Commands, Finish, Export:
// its own sideways scroller, so every button keeps 44 pt and the name shows in full), the canvas
// (zoom, pan, Select; a dropped file opens), the split code sheet (Code, Inspect and Support), the
// ContextBar (the Scrub strip, or the selection's actions) and the ToolRail, over the
// framework-free editor (src/editor.ts) and workspace (src/workspace.ts: opening, drafts, export).
// Every open goes through the one importer (src/import.ts); files, the clipboard, storage and the
// share sheet only through src/platform/. The theme follows the system unless a choice in Files
// says otherwise (data-theme on <html>, kept on this device). Every key but the arrows, the ContextBar's
// selection buttons, More's rows and the ⌘K palette run the command registry (src/commands.ts).

import { useEffect, useState } from 'react';
import { Editor, type OpenResult } from '../editor.ts';
import { Workspace } from '../workspace.ts';
import type { View } from '../canvas/viewport.ts';
import { DraftStore, idbKV, lockDraft } from '../platform/drafts.ts';
import { acceptDrag, clearFragment, dropped, fragment, pasted } from '../platform/files.ts';
import { writeClipboard } from '../platform/clipboard.ts';
import { readPref, writePref } from '../platform/prefs.ts';
import { Views } from './views.ts';
import { hitPath } from '../canvas/stage.ts';
import { installKeys } from '../keys.ts';
import type { Ctx } from '../commands.ts';
import { Palette } from './Palette.tsx';
import { panelUi } from './ui.ts';
import type { NodeId } from '../../../../engine/model/doc.ts';
import { Canvas, toggleGrid } from './Canvas.tsx';
import { CodePanel } from './CodePanel.tsx';
import { ContextBar } from './ContextBar.tsx';
import { FileSheets, type Theme } from './FileSheets.tsx';
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
    // way is never saved). It adds no other way in; source(), view(), hitPath() and measureAll()
    // only read. measureAll() gives each drawn element's document-order index and its getBBox
    // through root.getScreenCTM()⁻¹ · el.getScreenCTM(), in the root's user units.
    drawTest?: {
      render(text: string): OpenResult;
      source(): string;
      view(): View & { fitScale: number };
      hitPath(): 'elementsFromPoint' | 'elementFromPoint';
      measureAll(): { index: number; box: [number, number, number, number] }[];
    };
  }
}

/** Every drawn element's box in the root's user units, as the browser measures it (drawTest). */
function measureAll(editor: Editor, views: Views): { index: number; box: [number, number, number, number] }[] {
  const doc = editor.doc;
  const r = views.renderer;
  const root = doc && r?.nodeFor(doc.root);
  const inv = root && root.nodeType === 1 ? (root as SVGSVGElement).getScreenCTM()?.inverse() : null;
  if (!doc || !r || !inv) return [];
  const out: { index: number; box: [number, number, number, number] }[] = [];
  let index = 0;
  const walk = (id: NodeId) => {
    const n = doc.nodes.get(id);
    if (n?.kind !== 'element') return;
    const at = index++;
    const el = r.nodeFor(id);
    if (el && el.nodeType === 1 && 'getBBox' in el) {
      try {
        const b = (el as SVGGraphicsElement).getBBox();
        const m = (el as SVGGraphicsElement).getScreenCTM();
        if (m) {
          const k = inv.multiply(m);
          const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(k));
          const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
          out.push({ index: at, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
        }
      } catch {
        // no box (not rendered)
      }
    }
    for (const c of n.children) walk(c);
  };
  walk(doc.root);
  return out;
}

// The top bar's Commands: a command key's look, at the rail's icon size.
const COMMANDS_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6a3 3 0 10-3 3h12a3 3 0 10-3-3v12a3 3 0 103-3H6a3 3 0 103 3z" />
  </svg>
);

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
  const [ui] = useState(() => panelUi(() => void workspace.copy(writeClipboard), () => toggleGrid(editor)));
  const [ctx] = useState<Ctx>(() => ({ editor, workspace, ui }));
  const current = useStore(workspace.current);
  const unparsed = useStore(workspace.unparsed);
  const [theme, setTheme] = useState<Theme>(() => {
    const t = readPref('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  });

  // The theme on <html>: none follows the system (ds.css); light or dark overrides it (app.css).
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
  const chooseTheme = (t: Theme) => {
    writePref('theme', t === 'system' ? null : t);
    setTheme(t);
  };

  // Runs after Canvas and CodePanel have attached their views (child effects run first).
  useEffect(() => {
    void workspace.openSample();
    void workspace.boot(fragment(), clearFragment);
    window.drawTest = {
      render: (text) => editor.open(text),
      source: () => editor.source(),
      view: () => ({ ...editor.view, fitScale: editor.fitScale }),
      hitPath,
      measureAll: () => measureAll(editor, views),
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
    // The keys: the registry's commands (⌘Z, ⇧⌘Z, ⌘Y, Delete, Escape, Enter, ⌘A, ⌘K) and the arrows' nudge (src/keys.ts).
    const offKeys = installKeys(editor, window, () => document.querySelector('.draw-modal') !== null, ctx);
    window.addEventListener('paste', paste);
    window.addEventListener('pagehide', flush);
    window.addEventListener('hashchange', link);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      offKeys();
      window.removeEventListener('paste', paste);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('hashchange', link);
      document.removeEventListener('visibilitychange', hidden);
      delete window.drawTest;
    };
  }, [editor, workspace, ctx]);

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
  const copy = () => void workspace.copy(writeClipboard);
  return (
    <div className="draw ds-app">
      <Guard files={files}>
        <header className="draw-bar">
          <button type="button" className="draw-bar-btn draw-files" aria-haspopup="dialog" onClick={() => workspace.show('files')}>
            Files
          </button>
          <span className="draw-title">
            <span className="draw-name">{current?.name ?? unparsed?.name ?? 'Draw'}</span>
            <SaveLabel workspace={workspace} source={!!unparsed} />
          </span>
          <span className="draw-badge ds-small">preview</span>
          <button type="button" className="draw-fit" onClick={() => editor.fitToScreen()}>
            Fit
          </button>
          <button type="button" className="draw-bar-btn draw-commands" aria-label="Commands" aria-haspopup="dialog" onClick={() => ui.palette(false)}>
            {COMMANDS_ICON}
          </button>
          <button type="button" className="draw-bar-btn draw-finish" aria-haspopup="dialog" onClick={() => workspace.show('finish')}>
            Finish
          </button>
          <button type="button" className="draw-bar-btn draw-export" aria-haspopup="dialog" onClick={() => workspace.show('export')}>
            Export
          </button>
        </header>
        <Alert workspace={workspace} />
      </Guard>
      <div className="draw-split">
        <Canvas editor={editor} views={views} error={current?.problem ?? null} unparsed={unparsed} files={files} onDrag={acceptDrag} onDrop={drop} ui={ui} />
        <CodePanel editor={editor} views={views} files={files} copy={copy} source={!!unparsed} />
      </div>
      <Guard files={files}>
        <ContextBar ctx={ctx} unparsed={unparsed} files={files} />
        <ToolRail editor={editor} />
        <Sheets editor={editor} />
        <FileSheets workspace={workspace} editor={editor} theme={theme} setTheme={chooseTheme} />
        <Palette ctx={ctx} ui={ui} />
      </Guard>
    </div>
  );
}

function SaveLabel({ workspace, source }: { workspace: Workspace; source: boolean }) {
  const state = useStore(workspace.autosave.state);
  const kind = source && state.kind !== 'failed' ? 'read-only' : state.kind;
  const label = SAVE_LABEL[kind];
  return label ? (
    <span className="draw-save ds-small" data-save={kind} aria-live="polite">
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
