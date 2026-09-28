// The flashcards' files: JSON Lines, one record per line, each saying what it is.
//
//   card     {"id","type":"fact@1","topic","fields":{"front","back"},"source"?}   ("kind":"card" optional)
//   review   {"kind":"review","card","at":"<ISO 8601>","grade":1-4,"ms"?,"mode"?}
//   header   {"kind":"srs-backup","version":1,"exported":"<ISO 8601>","cards":n,"reviews":m}
//
// A deck is cards. A backup is a header, every card, then every review. Import takes either, and
// merges: cards by id (the file's version wins), reviews by (card, time), never twice. Unknown
// keys on a card are kept, so a round trip through this app loses nothing.

export type Grade = 1 | 2 | 3 | 4;

export interface Card {
  id: string;
  type: 'fact@1';
  topic: string;
  fields: { front: string; back: string };
  source?: string;
  [extra: string]: unknown;
}

export interface Review {
  card: string;
  at: string; // ISO 8601, UTC
  grade: Grade;
  ms?: number; // how long the answer took
  mode?: string;
}

export interface Parsed {
  cards: Card[];
  reviews: Review[];
  errors: string[];
  backup: boolean;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TYPES = new Set(['fact@1']);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

function toCard(o: Record<string, unknown>): Card | string {
  const { kind: _kind, id, type, topic, fields, source, ...rest } = o;
  if (typeof id !== 'string' || !ID.test(id)) return 'a card needs an "id" of letters, digits and . _ : - (up to 128)';
  if (typeof type !== 'string' || !TYPES.has(type)) return `card ${id}: type ${JSON.stringify(type)} is not supported (only fact@1)`;
  if (!text(topic, 128)) return `card ${id}: "topic" must be text, up to 128 characters`;
  if (!isObj(fields) || !text(fields.front, 4000) || !text(fields.back, 4000)) return `card ${id}: "fields" needs "front" and "back" text, up to 4000 characters each`;
  if (source !== undefined && (typeof source !== 'string' || source.length > 300)) return `card ${id}: "source" must be text, up to 300 characters`;
  const card: Card = { id, type: 'fact@1', topic: topic as string, fields: { ...fields, front: fields.front as string, back: fields.back as string } };
  if (source !== undefined) card.source = source;
  return Object.assign(card, rest);
}

function toReview(o: Record<string, unknown>): Review | string {
  const { card, at, grade, ms, mode } = o;
  if (typeof card !== 'string' || !ID.test(card)) return 'a review needs the "card" id it belongs to';
  const t = typeof at === 'string' ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return `review of ${card}: "at" must be an ISO 8601 time`;
  if (grade !== 1 && grade !== 2 && grade !== 3 && grade !== 4) return `review of ${card}: "grade" must be 1, 2, 3 or 4`;
  const review: Review = { card, at: new Date(t).toISOString(), grade };
  if (ms !== undefined) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return `review of ${card}: "ms" must be a number of milliseconds`;
    review.ms = Math.round(ms);
  }
  if (mode !== undefined) {
    if (typeof mode !== 'string' || mode.length > 32) return `review of ${card}: "mode" must be short text`;
    review.mode = mode;
  }
  return review;
}

/** Parse a deck, a review log or a backup. Bad lines are reported by number and skipped. */
export function parseJsonl(source: string): Parsed {
  const out: Parsed = { cards: [], reviews: [], errors: [], backup: false };
  const seen = new Set<string>();
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const n = i + 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      out.errors.push(`line ${n}: not valid JSON`);
      return;
    }
    if (!isObj(value)) return void out.errors.push(`line ${n}: expected an object`);
    const kind = value.kind ?? 'card';
    if (kind === 'srs-backup') {
      if (value.version !== 1) out.errors.push(`line ${n}: backup version ${JSON.stringify(value.version)} is newer than this app`);
      else out.backup = true;
    } else if (kind === 'card') {
      const card = toCard(value);
      if (typeof card === 'string') out.errors.push(`line ${n}: ${card}`);
      else if (seen.has(card.id)) out.errors.push(`line ${n}: card ${card.id} appears twice`);
      else {
        seen.add(card.id);
        out.cards.push(card);
      }
    } else if (kind === 'review') {
      const review = toReview(value);
      if (typeof review === 'string') out.errors.push(`line ${n}: ${review}`);
      else out.reviews.push(review);
    } else {
      out.errors.push(`line ${n}: unknown kind ${JSON.stringify(kind)}`);
    }
  });
  return out;
}

export interface Merged {
  cards: Card[];
  reviews: Review[];
  added: number;
  updated: number;
  reviewsAdded: number;
  errors: string[];
}

const reviewKey = (r: Review) => `${r.card}\u0000${r.at}`;

/** Merge parsed records into what the app holds. Returns new arrays; the inputs are untouched. */
export function merge(cards: Card[], reviews: Review[], incoming: Parsed): Merged {
  const byId = new Map(cards.map((c) => [c.id, c]));
  let added = 0;
  let updated = 0;
  for (const c of incoming.cards) {
    const prior = byId.get(c.id);
    if (!prior) added++;
    else if (JSON.stringify(prior) !== JSON.stringify(c)) updated++;
    byId.set(c.id, c); // Map keeps first-insertion order: existing cards stay where they were
  }
  const keys = new Set(reviews.map(reviewKey));
  const errors: string[] = [];
  const nextReviews = [...reviews];
  let reviewsAdded = 0;
  for (const r of incoming.reviews) {
    if (!byId.has(r.card)) {
      errors.push(`a review of ${r.card} was skipped: there is no such card`);
      continue;
    }
    const k = reviewKey(r);
    if (keys.has(k)) continue;
    keys.add(k);
    nextReviews.push(r);
    reviewsAdded++;
  }
  nextReviews.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { cards: [...byId.values()], reviews: nextReviews, added, updated, reviewsAdded, errors };
}

export const cardLine = (c: Card) => JSON.stringify(c);
export const reviewLine = (r: Review) => JSON.stringify({ kind: 'review', ...r });
export const lines = (records: string[]) => (records.length ? `${records.join('\n')}\n` : '');

/** A complete backup: header, every card, every review. */
export function backupText(cards: Card[], reviews: Review[], exported: Date): string {
  const header = JSON.stringify({ kind: 'srs-backup', version: 1, exported: exported.toISOString(), cards: cards.length, reviews: reviews.length });
  return lines([header, ...cards.map((c) => JSON.stringify({ kind: 'card', ...c })), ...reviews.map(reviewLine)]);
}

/**
 * Local day number for FSRS: whole part changes at 4 a.m. local time (a late-night session counts
 * as the evening before, as Anki does); the fraction is the time of day.
 */
export function localDay(ms: number): number {
  const offsetMs = new Date(ms).getTimezoneOffset() * 60_000;
  return (ms - offsetMs - 4 * 3_600_000) / 86_400_000;
}

/** Split card text on backticks: odd pieces are code. An unmatched backtick stays literal. */
export function segments(value: string): Array<{ code: boolean; text: string }> {
  const parts = value.split('`');
  if (parts.length % 2 === 0) return [{ code: false, text: value }];
  return parts.map((t, i) => ({ code: i % 2 === 1, text: t })).filter((p) => p.text.length > 0);
}
