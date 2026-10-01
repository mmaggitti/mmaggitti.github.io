// The Support tab: the support ledger in the app. A search over its rows (id, name, class, phase,
// status and note) at the top, then a summary by phase and by kind (hidden while searching, so the
// rows found sit right under the field), then the rows. Capability and feature rows show their
// name, which is what they are about. The ledger (about 400 KB) is loaded with a dynamic import
// the first time the tab opens, so it is not in the initial bundle. Under the lead, "Open-source
// licences" opens THIRD-PARTY-NOTICES.txt, served beside the app (P1-M3).

import { useEffect, useState } from 'react';
import { search, STATUSES, summary, type Ledger, type Tally } from '../support.ts';

let loading: Promise<Ledger> | null = null;
const loadLedger = (): Promise<Ledger> =>
  (loading ??= import('../../../../engine/ledger/ledger.json?raw').then((m) => JSON.parse(m.default) as Ledger).catch((e) => {
    loading = null; // a later visit tries again
    throw e;
  }));

const counts = (t: Tally) => STATUSES.filter((s) => t.counts[s]).map((s) => `${t.counts[s]} ${s}`).join(', ');

export function Support() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let live = true;
    loadLedger().then(
      (l) => live && setLedger(l),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  if (error) return <p className="draw-problem draw-support-pad" role="alert">The ledger couldn’t be loaded ({error}).</p>;
  if (!ledger) return <p className="draw-empty ds-muted">Loading the support ledger…</p>;
  const s = summary(ledger);
  const found = search(ledger.rows, query);
  return (
    <div className="draw-support">
      <p className="draw-support-lead">
        What Draw edits, keeps, previews or drops, and when each part lands. Now at <strong>P{s.phase}</strong>: {s.total} rows, {counts({ label: 'all', rows: s.total, counts: s.counts })}.
      </p>
      <a className="ds-btn draw-licences" href={`${import.meta.env.BASE_URL}THIRD-PARTY-NOTICES.txt`} target="_blank" rel="noopener">
        Open-source licences
      </a>
      <input
        type="search"
        className="draw-field draw-wide draw-ledger-search"
        aria-label="Search the ledger"
        placeholder="Search: rect, inkscape, partial, P0…"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!query.trim() && (
        <>
          <h3 className="draw-subhead">By phase</h3>
          <dl className="ds-list draw-tally" data-tally="phase">
            {s.byPhase.map((t) => (
              <div className="ds-row" key={t.label}>
                <dt>{t.label}</dt>
                <dd>{t.rows} rows: {counts(t)}</dd>
              </div>
            ))}
          </dl>
          <h3 className="draw-subhead">By kind</h3>
          <dl className="ds-list draw-tally" data-tally="kind">
            {s.byKind.map((t) => (
              <div className="ds-row" key={t.label}>
                <dt>{t.label}</dt>
                <dd>{t.rows} rows: {counts(t)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <p className="ds-small ds-muted draw-ledger-count" aria-live="polite">
        {found.matched > found.rows.length ? `Showing ${found.rows.length} of ${found.matched} rows: search to narrow them.` : `${found.matched} row${found.matched === 1 ? '' : 's'}.`}
      </p>
      <ul className="draw-ledger">
        {found.rows.map((r) => (
          <li key={r.id} className="draw-ledger-row" data-status={r.status}>
            <span className="draw-ledger-id ds-mono">{r.id}</span>
            {(r.kind === 'capability' || r.kind === 'feature') && <span className="draw-ledger-name ds-small">{r.name}</span>}
            <span className="draw-ledger-meta ds-small">
              {r.class ?? r.kind} · P{r.phase} · {r.status}
            </span>
            {(r.reason ?? r.note) && <span className="draw-ledger-note ds-small ds-muted">{r.status === 'partial' && r.reason ? r.reason : r.note ?? r.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
