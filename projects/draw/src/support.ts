// The Support tab's view of the support ledger (engine/ledger/ledger.json): a summary by phase and
// by kind, and a search over its rows. The panel loads the ledger with a dynamic import, so it is
// not in the initial bundle; this module only reads what it is given.

export const STATUSES = ['done', 'partial', 'planned', 'superseded'] as const;
export type Status = (typeof STATUSES)[number];

export interface LedgerRow {
  id: string;
  kind: string;
  name: string;
  class?: string;
  phase: number;
  status: Status;
  note?: string;
  reason?: string;
  supersededBy?: string;
}

export interface Ledger {
  meta: { currentPhase: number };
  rows: LedgerRow[];
}

export interface Tally {
  label: string;
  rows: number;
  counts: Record<Status, number>;
}

export interface Summary {
  phase: number;
  total: number;
  counts: Record<Status, number>;
  byPhase: Tally[];
  byKind: Tally[];
}

const zero = (): Record<Status, number> => ({ done: 0, partial: 0, planned: 0, superseded: 0 });

function tally(label: string, rows: readonly LedgerRow[]): Tally {
  const counts = zero();
  for (const r of rows) counts[r.status]++;
  return { label, rows: rows.length, counts };
}

export function summary(ledger: Ledger): Summary {
  const { rows } = ledger;
  const phases = [...new Set(rows.map((r) => r.phase))].sort((a, b) => a - b);
  const kinds = [...new Set(rows.map((r) => r.kind))];
  return {
    phase: ledger.meta.currentPhase,
    total: rows.length,
    counts: tally('all', rows).counts,
    byPhase: phases.map((p) => tally(`P${p}`, rows.filter((r) => r.phase === p))),
    byKind: kinds.map((k) => tally(k, rows.filter((r) => r.kind === k))),
  };
}

export const SHOWN = 100;

/** The words a row can be found by: its id, name, class, phase (P0), status, note and reason. */
const haystack = (r: LedgerRow): string => [r.id, r.name, r.class ?? '', `p${r.phase}`, r.status, r.note ?? '', r.reason ?? '', r.supersededBy ?? ''].join('\n').toLowerCase();

/** Rows matching every word of the query (in any field), the first `limit` of them, and how many matched. */
export function search(rows: readonly LedgerRow[], query: string, limit = SHOWN): { rows: LedgerRow[]; matched: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? rows.filter((r) => {
    const h = haystack(r);
    return words.every((w) => h.includes(w));
  }) : rows;
  return { rows: hits.slice(0, limit), matched: hits.length };
}
