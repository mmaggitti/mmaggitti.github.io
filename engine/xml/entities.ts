// Entity decoding, on demand and capped. The source text is never rewritten: decoded values feed
// the typed-value parsers and the security classifier, which must see what a browser would see.
//
// - The five predefined entities and numeric references always decode.
// - General entities declared in the DOCTYPE's internal subset (Illustrator declares its namespace
//   URIs this way) expand, with a total budget and a depth limit, so a billion-laughs file fails
//   instead of exhausting memory.
// - External and parameter entities are never fetched or expanded; a reference to one is left as
//   written and reported.
// - An entity whose replacement text holds markup ('<') is refused: the model cannot represent
//   elements that only exist after expansion, and a browser would build them.
// - Values come out as an XML processor reports them: line ends normalized (XML 1.0 §2.11), and in
//   attribute values every literal tab and line end read as a space (§3.3.3).

export const ENTITY_BUDGET = 1_000_000; // characters produced by expansion, per document
export const ENTITY_DEPTH = 8;

const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export interface EntityTable {
  internal: Map<string, string>; // name → replacement text (itself possibly containing references)
  external: Set<string>; // declared SYSTEM/PUBLIC: never fetched
  parameter: Set<string>; // %name; declarations: never expanded
}

export const NO_ENTITIES: EntityTable = { internal: new Map(), external: new Set(), parameter: new Set() };

/** XML 1.0 §2.11: every CRLF and lone CR in the source reads as LF. */
export const normalizeEol = (s: string): string => s.replace(/\r\n?/g, '\n');

const CHAR_REF = /&#(x[0-9a-fA-F]+|\d+);/g;
const charRef = (ref: string): string => {
  const cp = ref[0] === 'x' ? parseInt(ref.slice(1), 16) : parseInt(ref, 10);
  return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '\uFFFD';
};

/**
 * Read <!ENTITY …> declarations from a DOCTYPE internal subset. As in XML, an internal entity's
 * replacement text has its line ends normalized and its character references expanded at the
 * declaration; entity references in it expand later, where the entity is used.
 */
export function readEntityTable(subset: string | null): EntityTable {
  const table: EntityTable = { internal: new Map(), external: new Set(), parameter: new Set() };
  if (!subset) return table;
  const re = /<!ENTITY\s+(%\s+)?([A-Za-z_:][\w.:-]*)\s+(?:(SYSTEM|PUBLIC)\b[^>]*|"([^"]*)"|'([^']*)')\s*>/g;
  for (const m of subset.matchAll(re)) {
    const name = m[2];
    if (m[1]) table.parameter.add(name);
    else if (m[3]) table.external.add(name);
    else table.internal.set(name, normalizeEol(m[4] ?? m[5] ?? '').replace(CHAR_REF, (_, ref: string) => charRef(ref)));
  }
  return table;
}

// Both are limits of Draw's (a file that hits one may be well-formed), not well-formedness errors.
export class EntityBudgetError extends Error {
  readonly kind = 'limit';
}
export class EntityMarkupError extends Error {
  readonly kind = 'limit';
}

/** A per-document budget shared by every decode of that document. */
export interface Budget {
  left: number;
}
export const newBudget = (): Budget => ({ left: ENTITY_BUDGET });

/**
 * Decode references in attribute-value (`attr`) or text content. Unknown and external references
 * are left as written (`unresolved` lists them). Throws EntityBudgetError past the budget or depth,
 * and EntityMarkupError for an entity whose replacement text holds markup. Use decodeText and
 * decodeAttr for source text: they normalize it first.
 */
export function decode(s: string, table: EntityTable = NO_ENTITIES, budget: Budget = newBudget(), depth = 0, unresolved?: Set<string>, attr = false): string {
  if (attr) s = s.replace(/[\t\n\r]/g, ' '); // literal whitespace only: character references come after
  if (!s.includes('&')) return s;
  if (depth > ENTITY_DEPTH) throw new EntityBudgetError(`entities nested deeper than ${ENTITY_DEPTH}`);
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z_:][\w.:-]*);/g, (whole, ref: string) => {
    if (ref[0] === '#') return charRef(ref.slice(1));
    if (Object.hasOwn(PREDEFINED, ref)) return PREDEFINED[ref];
    const rep = table.internal.get(ref);
    if (rep === undefined) {
      unresolved?.add(ref);
      return whole;
    }
    if (rep.includes('<')) throw new EntityMarkupError(`entity &${ref}; expands to markup`);
    const out = decode(rep, table, budget, depth + 1, unresolved, attr);
    budget.left -= out.length;
    if (budget.left < 0) throw new EntityBudgetError(`entity expansion over ${ENTITY_BUDGET} characters`);
    return out;
  });
}

/** Text content as an XML processor reports it: line ends normalized, then references decoded. */
export function decodeText(raw: string, table: EntityTable = NO_ENTITIES, budget: Budget = newBudget(), unresolved?: Set<string>): string {
  return decode(normalizeEol(raw), table, budget, 0, unresolved);
}

/**
 * An attribute value as an XML processor reports it: line ends normalized, every literal tab and
 * line end read as a space, then references decoded. A character reference keeps what it names
 * (&#10; is still a line feed), as in XML.
 */
export function decodeAttr(raw: string, table: EntityTable = NO_ENTITIES, budget: Budget = newBudget(), unresolved?: Set<string>): string {
  return decode(normalizeEol(raw), table, budget, 0, unresolved, true);
}

/** Escape text for an attribute value in the given quote, or for text content (quote null). */
export function escape(s: string, quote: '"' | "'" | null): string {
  let out = s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (quote === '"') out = out.replace(/"/g, '&quot;');
  else if (quote === "'") out = out.replace(/'/g, '&apos;');
  else out = out.replace(/]]>/g, ']]&gt;');
  return out;
}
