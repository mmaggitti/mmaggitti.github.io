// Entity decoding, on demand and capped. The source text is never rewritten: decoded values feed
// the typed-value parsers and the security classifier, which must see what a browser would see.
//
// - The five predefined entities and numeric references always decode.
// - General entities declared in the DOCTYPE's internal subset (Illustrator declares its namespace
//   URIs this way) expand, with a total budget and a depth limit, so a billion-laughs file fails
//   instead of exhausting memory.
// - External and parameter entities are never fetched or expanded; a reference to one is left as
//   written and reported.

export const ENTITY_BUDGET = 1_000_000; // characters produced by expansion, per document
export const ENTITY_DEPTH = 8;

const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export interface EntityTable {
  internal: Map<string, string>; // name → replacement text (itself possibly containing references)
  external: Set<string>; // declared SYSTEM/PUBLIC: never fetched
  parameter: Set<string>; // %name; declarations: never expanded
}

export const NO_ENTITIES: EntityTable = { internal: new Map(), external: new Set(), parameter: new Set() };

/** Read <!ENTITY …> declarations from a DOCTYPE internal subset. */
export function readEntityTable(subset: string | null): EntityTable {
  const table: EntityTable = { internal: new Map(), external: new Set(), parameter: new Set() };
  if (!subset) return table;
  const re = /<!ENTITY\s+(%\s+)?([A-Za-z_:][\w.:-]*)\s+(?:(SYSTEM|PUBLIC)\b[^>]*|"([^"]*)"|'([^']*)')\s*>/g;
  for (const m of subset.matchAll(re)) {
    const name = m[2];
    if (m[1]) table.parameter.add(name);
    else if (m[3]) table.external.add(name);
    else table.internal.set(name, m[4] ?? m[5] ?? '');
  }
  return table;
}

export class EntityBudgetError extends Error {}

/** A per-document budget shared by every decode of that document. */
export interface Budget {
  left: number;
}
export const newBudget = (): Budget => ({ left: ENTITY_BUDGET });

/**
 * Decode references in attribute-value or text content. Unknown and external references are left
 * as written (`unresolved` lists them). Throws EntityBudgetError past the budget or depth.
 */
export function decode(s: string, table: EntityTable = NO_ENTITIES, budget: Budget = newBudget(), depth = 0, unresolved?: Set<string>): string {
  if (!s.includes('&')) return s;
  if (depth > ENTITY_DEPTH) throw new EntityBudgetError(`entities nested deeper than ${ENTITY_DEPTH}`);
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z_:][\w.:-]*);/g, (whole, ref: string) => {
    if (ref[0] === '#') {
      const cp = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
    }
    if (ref in PREDEFINED) return PREDEFINED[ref];
    const rep = table.internal.get(ref);
    if (rep === undefined) {
      unresolved?.add(ref);
      return whole;
    }
    const out = decode(rep, table, budget, depth + 1, unresolved);
    budget.left -= out.length;
    if (budget.left < 0) throw new EntityBudgetError(`entity expansion over ${ENTITY_BUDGET} characters`);
    return out;
  });
}

/** Escape text for an attribute value in the given quote, or for text content (quote null). */
export function escape(s: string, quote: '"' | "'" | null): string {
  let out = s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (quote === '"') out = out.replace(/"/g, '&quot;');
  else if (quote === "'") out = out.replace(/'/g, '&apos;');
  else out = out.replace(/]]>/g, ']]&gt;');
  return out;
}
