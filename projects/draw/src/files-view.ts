// What the Files menu and the Import report sheet show, computed without React (the unit tests
// read these): the report's four buckets with their items grouped by kind, and the draft list's
// rows with their "not exported for N days" reminders.

import { BUCKETS, type Bucket, type ImportReport } from '../../../engine/report/import-report.ts';
import type { DraftSummary } from './platform/drafts.ts';
import type { ImportFailure } from './import.ts';

const DAY = 86_400_000;

export interface Counted {
  name: string;
  count: number;
}

export interface BucketView {
  bucket: Bucket;
  label: string;
  hint: string;
  total: number;
  elements: Counted[];
  attributes: Counted[];
}

export interface ReportView {
  buckets: BucketView[]; // always all four, in the report's order
  notes: string[];
  total: number;
}

const LABELS: Record<Bucket, [string, string]> = {
  editable: ['Editable', "Draw's tools edit these."],
  kept: ['Kept as-is', 'Kept byte for byte, drawn or not.'],
  preview: ['Preview only', 'Scripts, handlers and media: kept in the file, never run here.'],
  unclassified: ['Unclassified', 'No ledger row names these: kept byte for byte, never drawn.'],
};

export function reportView(r: ImportReport): ReportView {
  const buckets = BUCKETS.map((bucket): BucketView => {
    const items = r.items.filter((i) => i.bucket === bucket);
    const pick = (kind: 'element' | 'attribute') => items.filter((i) => i.kind === kind).map((i) => ({ name: kind === 'element' ? `<${i.name}>` : i.name, count: i.count }));
    return { bucket, label: LABELS[bucket][0], hint: LABELS[bucket][1], total: r.totals[bucket], elements: pick('element'), attributes: pick('attribute') };
  });
  return { buckets, notes: r.notes, total: BUCKETS.reduce((n, b) => n + r.totals[b], 0) };
}

/** Why an open failed, as one sentence: "Line 3, column 1: </svg> closes <rect>." or "This isn’t an SVG file." */
export function failureText(f: Pick<ImportFailure, 'message' | 'line' | 'column'>): string {
  const said = f.line !== null ? `Line ${f.line}, column ${f.column}: ${f.message}` : f.message.charAt(0).toUpperCase() + f.message.slice(1);
  return /[.!?]$/.test(said) ? said : `${said}.`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / 3_600_000)} h ago`;
  const d = Math.floor(ms / DAY);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export interface DraftRow {
  id: string;
  name: string;
  updated: string; // "Edited 5 min ago"
  reminder: string | null; // "Not exported for 6 days"
  open: boolean; // the drawing open in this tab
  unreadable: boolean; // not a draft Draw wrote: it can only be deleted
}

export function draftRows(list: readonly DraftSummary[], now: number, openId: string | null): DraftRow[] {
  return list.map((d) => {
    if (d.unreadable) return { id: d.id, name: d.name, updated: 'Can’t be read: delete it', reminder: null, open: false, unreadable: true };
    const days = Math.floor((now - (d.exported ?? d.created)) / DAY);
    return {
      id: d.id,
      name: d.name,
      updated: `Edited ${ago(now - d.updated)}`,
      reminder: d.remind ? `${d.exported === null ? 'Never exported' : 'Not exported'} for ${days} day${days === 1 ? '' : 's'}` : null,
      open: d.id === openId,
      unreadable: false,
    };
  });
}
