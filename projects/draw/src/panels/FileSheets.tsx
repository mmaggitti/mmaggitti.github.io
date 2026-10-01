// The file sheets over the canvas: the Files menu (Open…, New, a paste field, the import report
// again, the drafts to reopen or delete, and the theme), the Import report (after every import, or
// why an open failed), Export (as-is, clean with its text as it is, as paths or with fonts, Save to
// Files), Open link (an #import link that
// arrived while Draw was open opens only on a tap), and Copy's fallback (the text to select, where
// the clipboard is blocked). They read the workspace's stores; every file, paste and share goes
// through src/platform/ and every open through the importer.

import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react';
import type { Workspace } from '../workspace.ts';
import type { ImportFailure } from '../import.ts';
import type { ExportFile, ExportKind, TextChoice } from '../export/svg.ts';
import { failureText, reportView } from '../files-view.ts';
import { pasted } from '../platform/files.ts';
import { shareOrDownload } from '../platform/share.ts';
import { Modal } from './Sheets.tsx';
import { useStore } from './store.ts';

export type Theme = 'system' | 'light' | 'dark';

interface Props {
  workspace: Workspace;
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export function FileSheets({ workspace, theme, setTheme }: Props) {
  const panel = useStore(workspace.panel);
  const close = () => workspace.close();
  switch (panel) {
    case 'files':
      return (
        <Modal key="files" title="Files" onClose={close} done mono={false}>
          <FilesMenu workspace={workspace} />
          <ThemeChoice theme={theme} setTheme={setTheme} />
        </Modal>
      );
    case 'copy':
      return <CopySheet workspace={workspace} close={close} />;
    case 'report':
      return <ReportSheet workspace={workspace} close={close} />;
    case 'export':
      return (
        <Modal key="export" title="Export" onClose={close} done mono={false}>
          <ExportBody workspace={workspace} />
        </Modal>
      );
    case 'link':
      return (
        <Modal key="link" title="Open this link?" onClose={close} done={false} mono={false}>
          <p className="draw-link-say">This link holds a drawing. Opening it replaces the drawing open now; your drafts stay in Files.</p>
          <div className="draw-actions">
            <button type="button" className="ds-btn ds-btn--primary draw-link-open" onClick={() => void workspace.acceptLink()}>
              Open
            </button>
            <button type="button" className="ds-btn draw-link-not" onClick={close}>
              Not now
            </button>
          </div>
        </Modal>
      );
    default:
      return null;
  }
}

function FilesMenu({ workspace }: { workspace: Workspace }) {
  const input = useRef<HTMLInputElement>(null);
  const drafts = useStore(workspace.drafts);
  const [confirm, setConfirm] = useState<string | null>(null);
  const pick = (el: HTMLInputElement) => {
    const file = el.files?.[0];
    el.value = ''; // the same file can be picked again
    if (file) void workspace.openFile(file, file.name, 'file');
  };
  const paste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const p = pasted(e.nativeEvent);
    if (p) void workspace.openText(p.text, '', 'paste');
  };
  return (
    <>
      <div className="draw-actions">
        <button type="button" className="ds-btn ds-btn--primary draw-open" onClick={() => input.current?.click()}>
          Open…
        </button>
        <button type="button" className="ds-btn draw-new" onClick={() => void workspace.newDrawing()}>
          New
        </button>
      </div>
      {/* iOS offers only the types listed here: .svg must be named, not just image/svg+xml. */}
      <input ref={input} type="file" accept=".svg,.svgz,image/svg+xml" hidden onChange={(e) => pick(e.currentTarget)} />
      <textarea
        className="draw-field draw-paste"
        aria-label="Paste SVG"
        placeholder="Paste SVG markup here"
        rows={1}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value=""
        onChange={() => {}}
        onPaste={paste}
      />
      <button type="button" className="ds-btn draw-report-again" onClick={() => workspace.show('report')}>
        Import report
      </button>
      <h3 className="draw-subhead">Drafts</h3>
      <p className="ds-small ds-muted draw-hint-text">Kept on this device until Safari clears them: export what matters.</p>
      {drafts === null ? (
        <p className="ds-muted">Reading drafts…</p>
      ) : drafts.length === 0 ? (
        <p className="ds-muted">No drafts yet. A drawing becomes one when you open or change it.</p>
      ) : (
        <ul className="draw-drafts">
          {drafts.map((d) => (
            <li key={d.id} className="draw-draft" data-open={d.open || undefined} data-unreadable={d.unreadable || undefined}>
              {d.unreadable ? (
                <span className="draw-draft-open">
                  <span className="draw-draft-name">{d.name}</span>
                  <span className="draw-draft-meta ds-small">{d.updated}</span>
                </span>
              ) : (
                <button type="button" className="draw-draft-open" onClick={() => void workspace.openDraft(d.id)}>
                  <span className="draw-draft-name">{d.name}</span>
                  <span className="draw-draft-meta ds-small">
                    {d.open ? 'Open now · ' : ''}
                    {d.updated}
                  </span>
                  {d.reminder && <span className="draw-draft-remind ds-small">{d.reminder}</span>}
                </button>
              )}
              {!d.open && (
                <button
                  type="button"
                  className="draw-key draw-draft-delete"
                  aria-label={confirm === d.id ? `Really delete ${d.name}` : `Delete ${d.name}`}
                  onClick={() => (confirm === d.id ? (setConfirm(null), void workspace.deleteDraft(d.id)) : setConfirm(d.id))}
                >
                  {confirm === d.id ? 'Delete?' : 'Delete'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ReportSheet({ workspace, close }: { workspace: Workspace; close: () => void }) {
  const failure = useStore(workspace.failure);
  const current = useStore(workspace.current);
  const unparsed = useStore(workspace.unparsed);
  const shown: ImportFailure | null = failure ?? unparsed;
  if (shown) {
    return (
      <Modal key="failure" title={`Can’t open ${shown.name}`} onClose={close} done mono={false}>
        <p className="draw-problem draw-failure" role="alert">
          {failureText(shown)}
        </p>
        {shown.excerpt && (
          <pre className="draw-excerpt ds-mono" aria-label="Where it failed">
            {shown.excerpt.text}
            {'\n'}
            {' '.repeat(shown.excerpt.at)}^
          </pre>
        )}
        <p className="ds-muted">{shown === failure ? 'Nothing opened: the drawing you had open is unchanged.' : 'It is open as read-only source, with the error marked in the code. Nothing is drawn, and it is not a draft.'}</p>
      </Modal>
    );
  }
  if (!current) return null;
  const v = reportView(current.report);
  return (
    <Modal key="report" title={`Import report: ${current.name}`} onClose={close} done mono={false}>
      <div className="draw-buckets" role="list" aria-label="What Draw can do with it">
        {v.buckets.map((b) => (
          <div key={b.bucket} className="draw-bucket" role="listitem" data-bucket={b.bucket} data-count={b.total}>
            <span className="draw-bucket-count ds-num">{b.total}</span>
            <span className="draw-bucket-label ds-small">{b.label}</span>
          </div>
        ))}
      </div>
      {current.problem && (
        <p className="draw-problem" role="alert">
          The canvas can’t draw it: {current.problem}.
        </p>
      )}
      {v.notes.length > 0 && (
        <ul className="draw-notes">
          {v.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {current.report.rem.count > 0 && (
        <button type="button" className="ds-btn draw-convert-rem" disabled={!current.report.rem.convertible} onClick={() => workspace.convertRem()}>
          Convert rem to user units
        </button>
      )}
      {v.buckets.filter((b) => b.total > 0).map((b) => (
        <section key={b.bucket} className="draw-group" data-bucket={b.bucket}>
          <h3 className="draw-subhead">
            {b.label} <span className="ds-muted">{b.total}</span>
          </h3>
          <p className="ds-small ds-muted draw-hint-text">{b.hint}</p>
          {([['Elements', b.elements], ['Attributes', b.attributes]] as const).map(([kind, items]) =>
            items.length ? (
              <ul key={kind} className="draw-items" aria-label={`${b.label}: ${kind.toLowerCase()}`}>
                {items.map((i) => (
                  <li key={i.name} className="draw-item">
                    <span className="ds-mono">{i.name}</span>
                    {i.count > 1 && <span className="draw-item-count ds-num">×{i.count}</span>}
                  </li>
                ))}
              </ul>
            ) : null,
          )}
        </section>
      ))}
    </Modal>
  );
}

const EXPORTS: { kind: ExportKind; label: string; say: (removed: string, gzip: boolean) => string }[] = [
  {
    kind: 'as-is',
    label: 'As-is SVG',
    say: (_removed, gzip) => (gzip ? 'The file as it is now, uncompressed, without Draw’s own state (guides, locks): every other byte Draw didn’t change is kept.' : 'The file exactly as it is now, without Draw’s own state (guides, locks): every other byte Draw didn’t change is kept.'),
  },
  { kind: 'clean', label: 'Clean SVG', say: (removed) => `Without editor data (Inkscape, Illustrator, Sketch, Draw’s own…): ${removed}.` },
  { kind: 'working', label: 'Save to Files', say: () => 'Your working copy, with Draw’s own state (guides, locks), to open in Draw again.' },
];

// Clean's Text choice (P1-M4 S2), for a drawing with text: what each does to Clean's file.
const TEXT_CHOICES: { choice: TextChoice; label: string; say: string }[] = [
  { choice: 'text', label: 'As text', say: '' },
  { choice: 'paths', label: 'As paths', say: 'Its text as paths, outlined from the fonts the canvas draws: it looks the same anywhere, and is no longer text.' },
  { choice: 'fonts', label: 'With fonts', say: 'Its text with the fonts of Draw’s it uses embedded whole; a font with a reserved name goes as paths.' },
];

/** Clean's file for a Text choice while it is prepared (`file` null), once it is ready, or why it couldn't be. */
interface Preparing {
  choice: TextChoice;
  file: ExportFile | null;
  notes: string[];
  error: string | null;
}

function ExportBody({ workspace }: { workspace: Workspace }) {
  const link = useRef<HTMLAnchorElement>(null);
  const [busy, setBusy] = useState(false);
  // The Text choice lasts for the sheet's visit; As paths and With fonts prepare Clean's file at once,
  // so a tap can share it inside its own activation (the share sheet's rule).
  const [choice, setChoice] = useState<TextChoice>('text');
  const [prep, setPrep] = useState<Preparing | null>(null);
  useEffect(() => {
    if (choice === 'text') return;
    let live = true;
    setPrep({ choice, file: null, notes: [], error: null });
    void workspace.prepareExport(choice).then((r) => {
      if (!live) return;
      if ('refused' in r) {
        setPrep({ choice: 'text', file: null, notes: [], error: r.refused });
        setChoice('text'); // a failure says why and falls back to As text
      } else setPrep({ choice, file: r.file, notes: r.notes, error: null });
    });
    return () => {
      live = false;
    };
  }, [choice, workspace]);
  const current = useStore(workspace.current);
  const unparsed = useStore(workspace.unparsed);
  const clean = workspace.exportFile('clean');
  const asIs = workspace.exportFile('as-is');
  if (!clean || !asIs) return <p className="ds-muted">{unparsed ? 'A file that isn’t well-formed can’t be exported; Copy (over the code) has its text.' : 'Nothing is open.'}</p>;
  const hasText = workspace.hasText();
  const ready = choice === 'text' ? clean : prep?.choice === choice ? prep.file : null;
  const n = clean.removed!.elements + clean.removed!.attributes;
  const removed = n ? `removes ${clean.removed!.elements} element${clean.removed!.elements === 1 ? '' : 's'} and ${clean.removed!.attributes} attribute${clean.removed!.attributes === 1 ? '' : 's'}` : 'there is none here, so it is the as-is file';
  const go = async (kind: ExportKind) => {
    const file = kind === 'clean' ? ready : workspace.exportFile(kind);
    if (!file || busy) return;
    setBusy(true);
    try {
      const outcome = await shareOrDownload(link.current!, file.fileName, new Blob([new Uint8Array(file.bytes)], { type: 'image/svg+xml' }));
      await workspace.exported(file, outcome);
    } finally {
      setBusy(false);
    }
  };
  const said = TEXT_CHOICES.find((c) => c.choice === choice)!.say;
  return (
    <>
      {hasText && (
        <>
          <h3 className="draw-subhead">Text in Clean SVG</h3>
          <div className="ds-seg draw-export-text" role="group" aria-label="Text">
            {TEXT_CHOICES.map((c) => (
              <button key={c.choice} type="button" aria-pressed={choice === c.choice} disabled={busy} onClick={() => setChoice(c.choice)}>
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}
      <ul className="draw-exports">
        {EXPORTS.map((x) => (
          <li key={x.kind} className="draw-export-row">
            <button type="button" className={`ds-btn${x.kind === 'as-is' ? ' ds-btn--primary' : ''} draw-export-go`} data-kind={x.kind} disabled={busy || (x.kind === 'clean' && !ready)} onClick={() => void go(x.kind)}>
              {x.kind === 'clean' && !ready ? 'Preparing…' : x.label}
            </button>
            <p className="ds-small ds-muted draw-export-say">
              <span className="ds-mono">{x.kind === 'clean' ? clean.fileName : asIs.fileName}</span> · {x.kind === 'clean' && said ? said : x.say(removed, !!current?.gzip)}
            </p>
          </li>
        ))}
      </ul>
      {prep?.error && (
        <p className="draw-problem draw-export-error" role="note">
          {prep.error} Clean is as text.
        </p>
      )}
      {ready && choice !== 'text' && prep?.notes.map((note) => (
        <p key={note} className="ds-small draw-export-note" role="note">
          {note}
        </p>
      ))}
      {asIs.relabeled && (
        <p className="draw-problem" role="note">
          Draw can’t write {asIs.relabeled}, so these are UTF-8, and the file’s XML declaration says so.
        </p>
      )}
      {current?.lossy && (
        <p className="draw-problem draw-lossy" role="note">
          Some bytes in the file weren’t valid {current.encoding?.toUpperCase()}, so they are � in these files: they differ from the original there.
        </p>
      )}
      {/* The download link shareOrDownload clicks when the share sheet can't take a file. */}
      <a ref={link} hidden />
    </>
  );
}

/**
 * Copy where the clipboard is blocked: the text in a read-only field, with Select all (then the
 * system's own Copy).
 */
function CopySheet({ workspace, close }: { workspace: Workspace; close: () => void }) {
  const text = useStore(workspace.copying);
  const area = useRef<HTMLTextAreaElement>(null);
  const selectAll = () => {
    const a = area.current;
    if (!a) return;
    a.focus();
    a.select();
    a.setSelectionRange(0, a.value.length);
  };
  return (
    <Modal key="copy" title="Copy the file" onClose={close} done mono={false}>
      <p className="ds-small ds-muted draw-hint-text">The clipboard isn’t available here: select the text, then copy it.</p>
      <textarea ref={area} className="draw-source draw-copy-text ds-mono" aria-label="The file to copy" readOnly rows={8} value={text ?? ''} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <div className="draw-actions">
        <button type="button" className="ds-btn ds-btn--primary draw-select-all" onClick={selectAll}>
          Select all
        </button>
      </div>
    </Modal>
  );
}

const THEMES: { theme: Theme; label: string }[] = [
  { theme: 'system', label: 'System' },
  { theme: 'light', label: 'Light' },
  { theme: 'dark', label: 'Dark' },
];

/** Light or dark: the system's, or a choice kept on this device. The drawing stays on white paper either way. */
function ThemeChoice({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  return (
    <>
      <h3 className="draw-subhead">Theme</h3>
      <div className="ds-seg draw-theme" role="group" aria-label="Theme">
        {THEMES.map((t) => (
          <button key={t.theme} type="button" aria-pressed={theme === t.theme} onClick={() => setTheme(t.theme)}>
            {t.label}
          </button>
        ))}
      </div>
    </>
  );
}
