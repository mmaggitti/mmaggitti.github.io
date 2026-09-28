// The panels: React renders what the model holds and sends commands back. They own no state that
// matters (ADR-004). Primary actions live in the bottom bar, in the thumb zone.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { backupDue, BUDGET_SECS, commands, currentCard, store, TARGET, type State } from '../core/app';
import { segments, type Card, type Grade } from '../core/deck';

const useApp = (): State => useSyncExternalStore(store.subscribe, store.get);

/** Card text: plain text, with `backticked` spans in the mono face. Never parsed as markup. */
function Text({ value }: { value: string }) {
  return (
    <>
      {segments(value).map((p, i) => (p.code ? <code key={i} className="cs-mono">{p.text}</code> : <span key={i}>{p.text}</span>))}
    </>
  );
}

function Row({ label, value, check }: { label: string; value: string; check: string }) {
  return (
    <div className="cs-row">
      <dt>{label}</dt>
      <dd className="cs-num" data-check={check}>{value}</dd>
    </div>
  );
}

function Notice() {
  const { message } = useApp();
  if (!message) return null;
  return (
    <div className={`srs-notice srs-notice--${message.tone}`} role="status" data-check="message">
      <span>{message.text}</span>
      <button type="button" className="cs-btn cs-btn--quiet cs-btn--sm" onClick={commands.dismiss} aria-label="Dismiss">Dismiss</button>
    </div>
  );
}

const dateOf = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

/** Nudges toward a backup while reviews exist that no backup holds. `action` adds its own button. */
function BackupReminder({ action = true }: { action?: boolean }) {
  const s = useApp();
  if (!backupDue(s)) return null;
  const since = s.reviews.length - (s.meta.lastBackupReviews ?? 0);
  return (
    <div className="cs-panel cs-panel--tint srs-reminder" data-check="backup-reminder">
      <p className="cs-small">
        {s.meta.lastBackupAt
          ? `${since} review${since === 1 ? '' : 's'} since your last backup on ${dateOf(s.meta.lastBackupAt)}.`
          : 'Your reviews live only on this device. Back them up to Files.'}
      </p>
      {action && <button type="button" className="cs-btn cs-btn--sm" data-action="backup" onClick={() => void commands.backup()}>Back up now</button>}
    </div>
  );
}

function Home() {
  const s = useApp();
  const empty = s.cards.length === 0;
  return (
    <>
      <p className="cs-kicker">Spaced repetition</p>
      <h1 className="cs-title">Flashcards</h1>
      <Notice />
      {empty ? (
        <div className="cs-empty" data-check="empty">
          <p>No cards yet. Import a deck: a <code className="cs-mono">.jsonl</code> file of cards, or a backup.</p>
        </div>
      ) : (
        <div className="cs-group cs-stack">
          <dl className="cs-list">
            <Row label="Due now" value={String(s.due)} check="due" />
            <Row label="New" value={String(s.fresh)} check="new" />
            <Row label="Cards" value={String(s.cards.length)} check="cards" />
            <Row label="Reviews logged" value={String(s.reviews.length)} check="reviews" />
            <Row label="Last backup" value={s.meta.lastBackupAt ? dateOf(s.meta.lastBackupAt) : 'never'} check="last-backup" />
          </dl>
          <BackupReminder />
        </div>
      )}
      <div className="cs-group cs-stack">
        <button type="button" className="cs-btn" data-action="import" disabled={s.busy} onClick={() => void commands.importFile()}>Import a deck or backup</button>
        {!empty && <button type="button" className="cs-btn" data-action="browse" onClick={commands.browse}>Browse all cards</button>}
        {!empty && <button type="button" className="cs-btn" data-action="backup-home" onClick={() => void commands.backup()}>Back up to Files</button>}
        <p className="cs-hint">
          Due means below {Math.round(TARGET * 100)}% predicted recall. Sessions run up to {BUDGET_SECS / 60} minutes. Stored here in {s.storage}.
        </p>
      </div>
      <div className="cs-bar srs-bar">
        <button type="button" className="cs-btn cs-btn--primary" data-action="start" disabled={empty || s.phase === 'loading' || s.due + s.fresh === 0} onClick={() => void commands.startSession()}>
          {s.due + s.fresh === 0 && !empty ? 'All caught up' : 'Start review'}
        </button>
      </div>
    </>
  );
}

const GRADES: Array<[Grade, string]> = [[1, 'Again'], [2, 'Hard'], [3, 'Good'], [4, 'Easy']];

function Review() {
  const s = useApp();
  const card = currentCard(s);
  if (!card) return null;
  const total = s.queue.length;
  return (
    <>
      <div className="srs-top">
        <span className="cs-kicker" data-check="topic">{card.topic}</span>
        <button type="button" className="cs-btn cs-btn--quiet cs-btn--sm" data-action="end" onClick={() => void commands.finish()}>End</button>
      </div>
      <div className="cs-meter" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={s.position} data-check="progress">
        <span style={{ ['--value' as string]: `${(100 * s.position) / total}%` }} />
      </div>
      <Notice />
      <section className="srs-card" aria-live="polite">
        <p className="srs-front" data-check="front"><Text value={card.fields.front} /></p>
        {s.revealed && (
          <>
            <hr className="srs-rule" />
            <p className="srs-back" data-check="back"><Text value={card.fields.back} /></p>
            {card.source && <p className="cs-small cs-muted" data-check="source"><Text value={card.source} /></p>}
          </>
        )}
      </section>
      <div className="cs-bar srs-bar">
        {s.revealed ? (
          GRADES.map(([g, label]) => (
            <button key={g} type="button" className={`cs-btn${g === 3 ? ' cs-btn--primary' : ''}`} data-action={`grade-${g}`} disabled={s.busy} onClick={() => void commands.grade(g)}>
              {label}
            </button>
          ))
        ) : (
          <button type="button" className="cs-btn cs-btn--primary" data-action="reveal" onClick={commands.reveal}>Show answer</button>
        )}
      </div>
    </>
  );
}

function Done() {
  const s = useApp();
  const minutes = Math.max(1, Math.round((Date.now() - s.startedAt) / 60_000));
  return (
    <>
      <p className="cs-kicker">Session done</p>
      <h1 className="cs-title">{s.reviewed} card{s.reviewed === 1 ? '' : 's'} reviewed</h1>
      <Notice />
      <div className="cs-group cs-stack">
        <dl className="cs-list">
          <Row label="Reviewed" value={String(s.reviewed)} check="done-reviewed" />
          <Row label="Again" value={String(s.again)} check="done-again" />
          <Row label="Time" value={`${minutes} min`} check="done-time" />
          <Row label="Still due" value={String(s.due)} check="done-due" />
        </dl>
        <BackupReminder action={false} />
      </div>
      <div className="cs-bar srs-bar">
        <button type="button" className="cs-btn" data-action="home" onClick={commands.home}>Done</button>
        <button type="button" className="cs-btn cs-btn--primary" data-action="backup-done" onClick={() => void commands.backup()}>Back up now</button>
      </div>
    </>
  );
}

/** A card's memory in words: new, due, or its chance of recall. */
function status(recall: number | undefined): string {
  if (recall === undefined || Number.isNaN(recall)) return 'New';
  const pct = `${Math.round(recall * 100)}% recall`;
  return recall < TARGET ? `Due · ${pct}` : pct;
}

/** Topics in the order the deck first uses them, each with its cards (and their indices). */
function byTopic(cards: Card[]): Array<[string, Array<[Card, number]>]> {
  const groups = new Map<string, Array<[Card, number]>>();
  cards.forEach((c, i) => {
    const g = groups.get(c.topic);
    if (g) g.push([c, i]);
    else groups.set(c.topic, [[c, i]]);
  });
  return [...groups];
}

function Browse() {
  const s = useApp();
  // Which answers to show is a reading preference, not app state: it lives here, not in the model.
  const [showAll, setShowAll] = useState(true);
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const reveal = (id: string) => setShown((prev) => new Set(prev).add(id));
  const setMode = (all: boolean) => {
    setShowAll(all);
    setShown(new Set());
  };
  return (
    <>
      <p className="cs-kicker">All cards · {s.cards.length}</p>
      <h1 className="cs-title">Browse</h1>
      <p className="cs-sub">Reading here never counts as a review, so it leaves the schedule alone.</p>
      <div className="cs-seg cs-seg--block srs-browse-mode" role="group" aria-label="Answers">
        <button type="button" aria-pressed={showAll} data-action="answers-show" onClick={() => setMode(true)}>Show answers</button>
        <button type="button" aria-pressed={!showAll} data-action="answers-hide" onClick={() => setMode(false)}>Hide answers</button>
      </div>
      {byTopic(s.cards).map(([topic, cards]) => (
        <section key={topic} className="srs-browse-topic">
          <h2 className="cs-heading">{topic} <span className="cs-muted cs-num">{cards.length}</span></h2>
          <ol className="srs-browse">
            {cards.map(([card, i]) => {
              const open = showAll || shown.has(card.id);
              return (
                <li key={card.id} className="cs-panel srs-browse-card" data-check="browse-card" data-card={card.id}>
                  <p className="srs-browse-front"><Text value={card.fields.front} /></p>
                  {open ? (
                    <p className="srs-browse-back" data-check="browse-back"><Text value={card.fields.back} /></p>
                  ) : (
                    <button type="button" className="cs-btn cs-btn--sm srs-browse-reveal" data-action="browse-reveal" onClick={() => reveal(card.id)}>Show answer</button>
                  )}
                  <p className="cs-small cs-muted srs-browse-meta">
                    <span data-check="browse-status">{status(s.recall[i])}</span>
                    {card.source && <> · <Text value={card.source} /></>}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <div className="cs-bar srs-bar">
        <button type="button" className="cs-btn" data-action="home" onClick={commands.home}>Back</button>
        <button type="button" className="cs-btn cs-btn--primary" data-action="start" disabled={s.due + s.fresh === 0} onClick={() => void commands.startSession()}>
          {s.due + s.fresh === 0 ? 'All caught up' : 'Start review'}
        </button>
      </div>
    </>
  );
}

export function App() {
  const s = useApp();
  // Mac parity: Space shows the answer, 1–4 grade it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      const st = store.get();
      if (st.phase !== 'review') return;
      if ((e.key === ' ' || e.key === 'Enter') && !st.revealed) {
        e.preventDefault();
        commands.reveal();
      } else if (st.revealed && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        void commands.grade(Number(e.key) as Grade);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  if (s.phase === 'review') return <Review />;
  if (s.phase === 'done') return <Done />;
  if (s.phase === 'browse') return <Browse />;
  return <Home />;
}
