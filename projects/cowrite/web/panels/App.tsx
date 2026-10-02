// The panels: React renders what the model holds and sends commands back. It owns no state that
// matters (ADR-004). The editor itself is framework-free and mounts into the slot DocScreen gives it.
import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { COLORS, commands, store, type State } from '../core/app';

const useApp = (): State => useSyncExternalStore(store.subscribe, store.get);
const swatch = (color: string) => ({ ['--author' as string]: color }) as CSSProperties;

function Notice({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="cw-notice" role="status">
      <span>{text}</span>
      <button className="cs-btn cs-btn--quiet cs-btn--sm" type="button" onClick={() => commands.dismissNotice()}>OK</button>
    </div>
  );
}

function IdentityScreen({ s }: { s: State }) {
  const [name, setName] = useState(s.identity?.name ?? '');
  const [color, setColor] = useState(s.identity?.color ?? COLORS[5].hex);
  const editing = s.identity !== null;
  return (
    <>
      <header className="cs-toolbar">
        <span className="cs-toolbar__title">Co-write</span>
      </header>
      <main className="cs-page">
        <h1 className="cs-title">{editing ? 'Your name and color' : 'Who’s writing?'}</h1>
        <p className="cs-sub">Everyone in a document sees your name, and your writing tinted in your color.</p>
        <form
          id="identity"
          className="cs-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void commands.saveIdentity(name, color);
          }}
        >
          <div className="cs-field">
            <label className="cs-label" htmlFor="name">Name</label>
            <input className="cs-input" id="name" value={name} maxLength={40} autoComplete="nickname" autoCapitalize="words" enterKeyHint="done" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="cs-field">
            <span className="cs-label" id="color-label">Color</span>
            <div className="cw-swatches" role="radiogroup" aria-labelledby="color-label">
              {COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  role="radio"
                  aria-checked={color === c.hex}
                  aria-label={c.name}
                  className="cw-swatch"
                  style={swatch(c.hex)}
                  data-color={c.hex}
                  onClick={() => setColor(c.hex)}
                />
              ))}
            </div>
          </div>
          <p className="cw-preview">
            <span className="cw-run" style={swatch(color)}>{name.trim() || 'Your name'}</span> writes like this.
          </p>
        </form>
        <div className="cs-bar" style={{ ['--bar-max' as string]: 'var(--measure)' }}>
          {editing && <button className="cs-btn" type="button" onClick={() => commands.editIdentity(false)}>Cancel</button>}
          <button className="cs-btn cs-btn--primary" type="submit" form="identity" data-action="save-identity" disabled={!name.trim()}>
            {editing ? 'Save' : 'Continue'}
          </button>
        </div>
      </main>
    </>
  );
}

function Home({ s }: { s: State }) {
  const me = s.identity;
  return (
    <>
      <header className="cs-toolbar">
        <span className="cs-toolbar__title">Co-write</span>
      </header>
      <main className="cs-page">
        <h1 className="cs-title">Documents</h1>
        <p className="cs-sub">Write together, live. Share a document’s link and anyone with it can edit. Only devices with the link can read it.</p>
        {me && (
          <div className="cw-me">
            <span>You write as <span className="cw-run" style={swatch(me.color)} data-check="me">{me.name}</span></span>
            <button className="cs-btn cs-btn--quiet cs-btn--sm" type="button" onClick={() => commands.editIdentity(true)}>Change</button>
          </div>
        )}
        {s.docs.length ? (
          <ul className="cs-list cw-docs" data-check="docs">
            {s.docs.map((d) => (
              <li key={d.id}>
                <button type="button" className="cw-doc" onClick={() => void commands.openDocument(d.id)}>
                  <span className="cw-doc__title">{d.title}</span>
                  <span className="cs-small cs-muted">{new Date(d.opened).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cs-empty">No documents yet.</p>
        )}
        <Notice text={s.notice} />
        <div className="cs-bar" style={{ ['--bar-max' as string]: 'var(--measure)' }}>
          <button className="cs-btn cs-btn--primary" type="button" data-action="new" onClick={() => void commands.newDocument()}>New document</button>
        </div>
      </main>
    </>
  );
}

const STATUS = {
  online: { label: 'Live', tone: 'ok' },
  connecting: { label: 'Connecting', tone: 'warn' },
  offline: { label: 'Offline', tone: 'danger' },
} as const;

function DocScreen({ s }: { s: State }) {
  const open = s.open;
  if (!open) return null;
  const status = STATUS[open.status];
  return (
    <>
      <header className="cs-toolbar">
        <button className="cs-btn cs-btn--quiet cs-btn--sm" type="button" data-action="back" onClick={() => void commands.closeDocument()}>‹ Documents</button>
        <span className="cs-toolbar__title" data-check="title">{open.title}</span>
        <span className={`cs-status cs-status--${status.tone}`} data-check="status" data-status={open.status}>{status.label}</span>
      </header>
      <main className="cs-page cw-docpage">
        {s.showAuthors && open.authors.length > 0 && (
          <ul className="cw-legend" aria-label="Authors" data-check="legend">
            {open.authors.map((a) => (
              <li key={a.id}><span className="cw-run" style={swatch(a.color)} data-author={a.id}>{a.name}</span></li>
            ))}
          </ul>
        )}
        {open.waiting && <p className="cs-hint" data-check="waiting">Waiting for the document to arrive…</p>}
        <div className="cw-slot" data-check="editor" data-saved={open.saved} ref={(el) => commands.mount(el)} />
        <Notice text={s.notice} />
        <div className="cs-bar" style={{ ['--bar-max' as string]: 'var(--measure)' }}>
          <button className="cs-btn" type="button" data-action="authors" aria-pressed={s.showAuthors} onClick={() => void commands.toggleAuthors()}>
            {s.showAuthors ? 'Hide authors' : 'Show authors'}
          </button>
          <button className="cs-btn cs-btn--primary" type="button" data-action="share" onClick={() => void commands.share()}>Share</button>
        </div>
      </main>
    </>
  );
}

export function App() {
  const s = useApp();
  if (s.phase === 'loading') return <main className="cs-page"><p className="cs-muted">Opening…</p></main>;
  if (s.phase === 'error') return <main className="cs-page"><p className="cs-error" data-check="error">Co-write couldn’t start: {s.error}</p></main>;
  if (!s.identity || s.editingIdentity) return <IdentityScreen s={s} />;
  if (s.open) return <DocScreen s={s} />;
  return <Home s={s} />;
}
