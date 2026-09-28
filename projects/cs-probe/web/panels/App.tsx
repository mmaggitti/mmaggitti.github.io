// The panel: React renders what the model holds and sends commands back. It owns no state that
// matters (ADR-004). This is the template's "system check" screen; a real app replaces it.
import { useSyncExternalStore } from 'react';
import { commands, store, type State } from '../core/app';

const useApp = (): State => useSyncExternalStore(store.subscribe, store.get);

function Row({ label, value, check }: { label: string; value: string; check: string }) {
  return (
    <div className="cs-row">
      <dt>{label}</dt>
      <dd data-check={check}>{value}</dd>
    </div>
  );
}

export function App() {
  const s = useApp();
  return (
    <>
      <p className="cs-kicker">System check</p>
      <h1 className="cs-title">Seams probe</h1>
      <p className="cs-sub">A Rust core in WebAssembly, a TypeScript UI, every seam exercised once. Replace this screen with the app.</p>

      <div className="cs-group cs-stack">
        <dl className="cs-list">
          <Row label="Core (Adler-32 of “Wikipedia”)" value={s.core} check="core" />
          <Row label="Checksum of the text below" value={s.textChecksum} check="text-checksum" />
          <Row label="Version 1.2.3, parsed" value={s.version} check="version" />
          <Row label="Density" value={s.density} check="density" />
        </dl>
        <div className="cs-field">
          <label className="cs-label" htmlFor="text">Text to checksum</label>
          <input className="cs-input" id="text" value={s.text} onChange={(e) => void commands.checksumText(e.target.value)} />
        </div>
        <div className="cs-field">
          <label className="cs-label" htmlFor="ver">Parse a version</label>
          <input className="cs-input" id="ver" defaultValue="1.2.3" onChange={(e) => void commands.parseVersion(e.target.value)} />
          <span className="cs-hint">major.minor.patch; anything else returns the core's typed error.</span>
        </div>
      </div>

      <div className="cs-group cs-stack">
        <dl className="cs-list">
          <Row label="Trap and recover" value={s.trap} check="trap" />
          <Row label="Module host (test plugin)" value={s.plugin} check="plugin" />
          <Row label="Storage" value={s.storage} check="storage" />
          <Row label="Saved note, read back" value={s.saved} check="saved" />
          <Row label="Imported file" value={s.file} check="file" />
        </dl>
        <div className="cs-stack">
          <button className="cs-btn" type="button" data-action="trap" onClick={() => void commands.trapAndRecover()}>Trap the core, then recover</button>
          <button className="cs-btn" type="button" data-action="plugin" onClick={() => void commands.runPlugin()}>Run the test plugin</button>
          <button className="cs-btn" type="button" data-action="save" onClick={() => void commands.saveNote(`saved ${new Date().toISOString()}`)}>Save a note</button>
          <button className="cs-btn" type="button" data-action="import" onClick={() => void commands.importFile()}>Import a file</button>
        </div>
      </div>

      <div className="cs-bar" style={{ ['--bar-max' as string]: 'var(--measure)' }}>
        <button className="cs-btn cs-btn--primary" type="button" data-action="export" onClick={() => void commands.exportReport()}>Export report</button>
      </div>
    </>
  );
}
