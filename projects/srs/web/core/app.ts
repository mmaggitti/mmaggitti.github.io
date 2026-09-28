// The app model: state and commands, framework-free (ADR-004). Panels render it and call commands.
//
// Files in this app's storage folder:
//   cards.jsonl     the cards, rewritten on import
//   reviews.jsonl   the review log, append-only: one line per grade. FSRS state is derived from it.
//   meta.json       when the last backup was made, and how many reviews it held
import { pick, save } from '../ports/files';
import { openStorage, type Storage } from '../ports/storage';
import { CoreClient } from '../worker/client';
import { isCoreError } from '../worker/protocol';
import { backupText, cardLine, lines, localDay, merge, parseJsonl, reviewLine, type Card, type Grade, type Review } from './deck';
import { createStore } from './store';

export const APP = 'srs';
/** A card is due when its chance of recall has fallen below this (the spec's band target). */
export const TARGET = 0.9;
/** The session time box, and how many new cards one session may introduce. */
export const BUDGET_SECS = 15 * 60;
const SECS_PER_NEW = 25;
const MAX_NEW = 10;

export interface Message {
  tone: 'ok' | 'warn' | 'danger';
  text: string;
}

interface Meta {
  lastBackupAt?: string;
  lastBackupReviews?: number;
}

export interface State {
  phase: 'loading' | 'home' | 'review' | 'done';
  storage: string;
  cards: Card[];
  reviews: Review[];
  due: number;
  fresh: number;
  meta: Meta;
  message: Message | null;
  busy: boolean;
  // the session
  queue: number[];
  position: number;
  revealed: boolean;
  reviewed: number;
  again: number;
  startedAt: number;
}

export const store = createStore<State>({
  phase: 'loading', storage: 'opening…', cards: [], reviews: [], due: 0, fresh: 0, meta: {}, message: null, busy: false,
  queue: [], position: 0, revealed: false, reviewed: 0, again: 0, startedAt: 0,
});

const client = new CoreClient();
let storage: Storage | null = null;
let memories: Float64Array = new Float64Array(0);
let shownAt = 0;
const requeued = new Map<number, number>();
const utf8 = (s: string) => new TextEncoder().encode(s);
const describe = (e: unknown) => (isCoreError(e) ? `${e.kind}: ${e.message}` : e instanceof Error ? e.message : String(e));
const say = (tone: Message['tone'], text: string) => store.set({ message: { tone, text } });

/** The card on screen during a session, if any. */
export const currentCard = (s: State = store.get()): Card | undefined => s.cards[s.queue[s.position] ?? -1];

/** True when there are reviews the last backup doesn't hold. */
export const backupDue = (s: State = store.get()) => s.reviews.length > (s.meta.lastBackupReviews ?? 0);

async function readText(name: string): Promise<string> {
  const bytes = await storage?.read(name);
  return bytes ? new TextDecoder().decode(bytes) : '';
}

/** Recompute every card's memory from the review log, then the counts. */
async function recompute(): Promise<void> {
  const { cards, reviews } = store.get();
  const index = new Map(cards.map((c, i) => [c.id, i]));
  const known = reviews.filter((r) => index.has(r.card));
  const card = new Uint32Array(known.length);
  const day = new Float64Array(known.length);
  const rating = new Uint8Array(known.length);
  // Days never run backwards for one card, even across a daylight-saving change.
  const lastDay = new Map<number, number>();
  known.forEach((r, i) => {
    const c = index.get(r.card) ?? 0;
    const d = Math.max(localDay(Date.parse(r.at)), lastDay.get(c) ?? -Infinity);
    lastDay.set(c, d);
    card[i] = c;
    day[i] = d;
    rating[i] = r.grade;
  });
  memories = await client.call('memories', cards.length, card, day, rating);
  const r = await client.call('retrievabilities', memories.slice(), localDay(Date.now()));
  let due = 0;
  let fresh = 0;
  for (const x of r) {
    if (Number.isNaN(x)) fresh++;
    else if (x < TARGET) due++;
  }
  store.set({ due, fresh });
}

/** Seconds a review takes, from the recent log; 12 until there is one. */
function secsPerReview(reviews: Review[]): number {
  const times = reviews.slice(-50).map((r) => r.ms).filter((ms): ms is number => typeof ms === 'number').sort((a, b) => a - b);
  if (!times.length) return 12;
  return Math.min(60, Math.max(4, (times[Math.floor(times.length / 2)] ?? 12_000) / 1000));
}

export const commands = {
  async boot() {
    try {
      storage = await openStorage(APP);
      const persisted = await storage.persist();
      store.set({ storage: `${storage.backend}${persisted ? ', persistent' : ''}${storage.fallback ? ` (OPFS unavailable: ${storage.fallback})` : ''}` });
      const cards = parseJsonl(await readText('cards.jsonl'));
      const reviews = parseJsonl(await readText('reviews.jsonl'));
      const metaText = await readText('meta.json');
      const meta = metaText ? (JSON.parse(metaText) as Meta) : {};
      const merged = merge(cards.cards, [], reviews);
      store.set({ cards: merged.cards, reviews: merged.reviews, meta });
      const problems = [...cards.errors, ...reviews.errors];
      if (problems.length) say('danger', `Some saved lines could not be read: ${problems.slice(0, 2).join('; ')}`);
      await recompute();
    } catch (e) {
      say('danger', `Could not open this app's storage: ${describe(e)}`);
    }
    store.set({ phase: 'home' });
  },

  /** Import a deck or a backup from Files. */
  async importFile() {
    const [file] = await pick('.jsonl,.json,.txt,application/json,text/plain');
    if (!file || !storage) return;
    store.set({ busy: true });
    try {
      const parsed = parseJsonl(new TextDecoder().decode(file.bytes));
      if (!parsed.cards.length && !parsed.reviews.length) {
        say('danger', `${file.name}: no cards found. ${parsed.errors.slice(0, 2).join('; ')}`);
        return;
      }
      const s = store.get();
      const m = merge(s.cards, s.reviews, parsed);
      await storage.write('cards.jsonl', utf8(lines(m.cards.map(cardLine))));
      if (m.reviewsAdded) await storage.write('reviews.jsonl', utf8(lines(m.reviews.map(reviewLine))));
      store.set({ cards: m.cards, reviews: m.reviews });
      await recompute();
      const problems = [...parsed.errors, ...m.errors];
      const summary = [`${m.added} new`, m.updated ? `${m.updated} updated` : '', m.reviewsAdded ? `${m.reviewsAdded} reviews restored` : ''].filter(Boolean).join(', ');
      say(problems.length ? 'warn' : 'ok', `Imported ${file.name}: ${summary}.${problems.length ? ` ${problems.length} line(s) skipped: ${problems[0]}` : ''}`);
    } catch (e) {
      say('danger', `Import failed: ${describe(e)}`);
    } finally {
      store.set({ busy: false });
    }
  },

  async startSession() {
    const s = store.get();
    const now = localDay(Date.now());
    const queue = [...(await client.call('plan', memories.slice(), now, TARGET, BUDGET_SECS, secsPerReview(s.reviews), SECS_PER_NEW, MAX_NEW))];
    if (!queue.length) {
      say('ok', 'Nothing is due. Every card is above 90% recall right now.');
      return;
    }
    requeued.clear();
    shownAt = Date.now();
    store.set({ phase: 'review', queue, position: 0, revealed: false, reviewed: 0, again: 0, startedAt: Date.now(), message: null });
  },

  reveal() {
    if (store.get().phase === 'review') store.set({ revealed: true });
  },

  async grade(grade: Grade) {
    const s = store.get();
    const card = currentCard(s);
    if (s.phase !== 'review' || !s.revealed || !card || !storage || s.busy) return;
    const at = new Date();
    const review: Review = { card: card.id, at: at.toISOString(), grade, ms: Math.min(at.getTime() - shownAt, 600_000), mode: 'session' };
    store.set({ busy: true });
    try {
      await storage.append('reviews.jsonl', utf8(`${reviewLine(review)}\n`));
    } catch (e) {
      store.set({ busy: false });
      say('danger', `That grade was not saved: ${describe(e)}`);
      return;
    }
    const queue = [...s.queue];
    const index = queue[s.position] ?? 0;
    // "Again" brings the card back a few cards later, at most twice per session.
    if (grade === 1 && (requeued.get(index) ?? 0) < 2) {
      requeued.set(index, (requeued.get(index) ?? 0) + 1);
      queue.splice(Math.min(s.position + 4, queue.length), 0, index);
    }
    const position = s.position + 1;
    const outOfTime = (Date.now() - s.startedAt) / 1000 >= BUDGET_SECS;
    store.set({ reviews: [...s.reviews, review], queue, position, revealed: false, reviewed: s.reviewed + 1, again: s.again + (grade === 1 ? 1 : 0), busy: false });
    shownAt = Date.now();
    if (position >= queue.length || outOfTime) await commands.finish();
  },

  async finish() {
    store.set({ phase: 'done' });
    await recompute();
  },

  home() {
    store.set({ phase: 'home', message: null });
  },

  /** Hand a complete backup to the share sheet (Files, iCloud Drive) or a download. */
  async backup() {
    const s = store.get();
    if (!storage) return;
    const now = new Date();
    const name = `flashcards-backup-${now.toISOString().slice(0, 10)}.jsonl`;
    try {
      const how = await save(name, utf8(backupText(s.cards, s.reviews, now)), 'text/plain');
      if (how === 'cancelled') return;
      const meta: Meta = { lastBackupAt: now.toISOString(), lastBackupReviews: s.reviews.length };
      await storage.write('meta.json', utf8(JSON.stringify(meta)));
      store.set({ meta });
      say('ok', how === 'shared' ? `Backup handed to the share sheet: ${name}.` : `Backup downloaded: ${name}.`);
    } catch (e) {
      say('danger', `Backup failed: ${describe(e)}`);
    }
  },

  dismiss() {
    store.set({ message: null });
  },
};
