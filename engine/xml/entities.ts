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
// - wellFormedRefs refuses the references a browser refuses (a bare &, a reference without ';', a
//   character reference to a character XML doesn't allow, an undeclared entity, an external entity
//   in an attribute value, an entity whose text isn't well-formed where it is used), each at its
//   place. An undeclared entity in a document whose DOCTYPE references a parameter entity is over
//   Draw's limits instead: the parameter entity may declare it, and Draw never expands one.

export const ENTITY_BUDGET = 1_000_000; // characters produced by expansion, per document
export const ENTITY_DEPTH = 8;

const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export interface EntityTable {
  internal: Map<string, string>; // name → replacement text (itself possibly containing references)
  external: Set<string>; // declared SYSTEM/PUBLIC: never fetched
  parameter: Set<string>; // %name; declarations: never expanded
  /** The subset references a parameter entity (a %name; outside literals and comments). */
  hasPERefs: boolean;
}

export const NO_ENTITIES: EntityTable = { internal: new Map(), external: new Set(), parameter: new Set(), hasPERefs: false };

/** XML 1.0 §2.11: every CRLF and lone CR in the source reads as LF. */
export const normalizeEol = (s: string): string => s.replace(/\r\n?/g, '\n');

/** XML 1.0's Char: what a document may hold, and what a character reference may name. */
export const isXmlChar = (cp: number): boolean =>
  cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);

const CHAR_REF = /&#(x[0-9a-fA-F]+|\d+);/g;
const codePoint = (ref: string): number => (ref[0] === 'x' ? parseInt(ref.slice(1), 16) : parseInt(ref, 10));
const charRef = (ref: string): string => {
  const cp = codePoint(ref);
  return isXmlChar(cp) ? String.fromCodePoint(cp) : '\uFFFD';
};

const PE_REF = /%[A-Za-z_:][\w.:-]*;/y;

/**
 * Read <!ENTITY …> declarations from a DOCTYPE internal subset (not from its comments or processing
 * instructions). As in XML, an internal entity's replacement text has its line ends normalized and
 * its character references expanded at the declaration; entity references in it expand later,
 * where the entity is used. A character reference to a character XML doesn't allow stays as
 * written, so a use of the entity is refused (wellFormedRefs).
 */
export function readEntityTable(subset: string | null): EntityTable {
  const table: EntityTable = { internal: new Map(), external: new Set(), parameter: new Set(), hasPERefs: false };
  if (!subset) return table;
  const { declarations, hasPERefs } = readSubset(subset);
  table.hasPERefs = hasPERefs;
  const re = /<!ENTITY\s+(%\s+)?([A-Za-z_:][\w.:-]*)\s+(?:(SYSTEM|PUBLIC)\b[^>]*|"([^"]*)"|'([^']*)')\s*>/g;
  for (const m of declarations.matchAll(re)) {
    const name = m[2];
    if (m[1]) table.parameter.add(name);
    else if (m[3]) table.external.add(name);
    else table.internal.set(name, normalizeEol(m[4] ?? m[5] ?? '').replace(CHAR_REF, (whole, ref: string) => (isXmlChar(codePoint(ref)) ? charRef(ref) : whole)));
  }
  return table;
}

/** The subset with its comments and processing instructions blanked, and whether it references a parameter entity. */
function readSubset(subset: string): { declarations: string; hasPERefs: boolean } {
  let declarations = '';
  let from = 0;
  let hasPERefs = false;
  let quote: string | null = null;
  const blank = (start: number, end: number): void => {
    declarations += subset.slice(from, start) + ' '.repeat(end - start);
    from = end;
  };
  for (let k = 0; k < subset.length; k++) {
    const c = subset[k];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (subset.startsWith('<!--', k)) {
      const close = subset.indexOf('-->', k + 4);
      blank(k, close === -1 ? subset.length : close + 3);
      k = from - 1;
    } else if (subset.startsWith('<?', k)) {
      const close = subset.indexOf('?>', k + 2);
      blank(k, close === -1 ? subset.length : close + 2);
      k = from - 1;
    } else if (c === '%') {
      PE_REF.lastIndex = k;
      if (PE_REF.test(subset)) hasPERefs = true;
    }
  }
  return { declarations: declarations + subset.slice(from), hasPERefs };
}

// Both are limits of Draw's (a file that hits one may be well-formed), not well-formedness errors.
export class EntityBudgetError extends Error {
  readonly kind = 'limit';
}
export class EntityMarkupError extends Error {
  readonly kind = 'limit';
}
/** An entity whose replacement text is not well-formed where it is used: the file is not well-formed. */
export class EntityWellFormednessError extends Error {
  readonly kind = undefined;
}

/** Why raw text's references make it not well-formed (or, kind 'limit', over Draw's limits): where and what. */
export interface RefError {
  at: number; // offset in the raw text
  message: string;
  kind?: 'limit';
}

const REF = /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_:À-￿][\w.:\-·À-￿]*)?(;?)/y;

/**
 * The first reference in raw text (a text leaf's or an attribute value's, as written) that a
 * browser's parser refuses, or null. Internal entities are checked as they would expand there
 * (each entity once per document and context); how far they expand is decode's to limit.
 */
export function wellFormedRefs(raw: string, table: EntityTable, inAttr: boolean): RefError | null {
  return refError(raw, table, inAttr, []);
}

function refError(raw: string, table: EntityTable, inAttr: boolean, open: string[]): RefError | null {
  for (let i = raw.indexOf('&'); i !== -1; i = raw.indexOf('&', i + 1)) {
    REF.lastIndex = i;
    const [, ref, semi] = REF.exec(raw)!;
    if (ref === undefined) return { at: i, message: raw[i + 1] === '#' ? 'a malformed character reference' : "a bare & (write &amp; for the character itself)" };
    if (!semi) return { at: i, message: ref[0] === '#' ? 'a malformed character reference' : `the reference &${ref} has no closing ;` };
    if (ref[0] === '#') {
      if (!isXmlChar(codePoint(ref.slice(1)))) return { at: i, message: `&${ref}; names a character XML doesn't allow` };
    } else if (Object.hasOwn(PREDEFINED, ref)) continue;
    else if (table.internal.has(ref)) {
      const inner = entityError(ref, table, inAttr, open);
      if (inner) return { ...inner, at: i };
    } else if (table.external.has(ref)) {
      if (inAttr) return { at: i, message: `the external entity &${ref}; can't be used in an attribute value` };
    } else if (table.hasPERefs) {
      return { at: i, message: `the entity &${ref}; is not declared; it may be declared by a parameter entity, which Draw doesn't expand`, kind: 'limit' };
    } else return { at: i, message: `the entity &${ref}; is not declared` };
  }
  return null;
}

const CHECKED = new WeakMap<EntityTable, Map<string, Omit<RefError, 'at'> | null>>();

/** Why an internal entity's replacement text is not well-formed in this context (text or attribute), or null. */
function entityError(name: string, table: EntityTable, inAttr: boolean, open: string[]): Omit<RefError, 'at'> | null {
  let memo = CHECKED.get(table);
  if (!memo) CHECKED.set(table, (memo = new Map()));
  const key = `${inAttr ? 'attr' : 'text'} ${name}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  if (open.includes(name)) return { message: `the entity &${name}; refers to itself` };
  if (open.length > ENTITY_DEPTH) return null; // deeper than decode goes: it refuses the file
  const rep = table.internal.get(name)!;
  open.push(name);
  const inner: Omit<RefError, 'at'> | null = !inAttr && rep.includes(']]>') ? { message: "']]>' in text" } : refError(rep, table, inAttr, open);
  open.pop();
  const message = inner && `the entity &${name}; expands to text that isn't well-formed: ${inner.message}`;
  const out = !inner ? null : inner.kind ? { message: message!, kind: inner.kind } : { message: message! };
  memo.set(key, out);
  return out;
}

/** A per-document budget shared by every decode of that document. */
export interface Budget {
  left: number;
}
export const newBudget = (): Budget => ({ left: ENTITY_BUDGET });

/**
 * Decode references in attribute-value (`attr`) or text content. Unknown and external references
 * are left as written (`unresolved` lists them). Throws EntityBudgetError past the budget or depth,
 * EntityMarkupError for an entity whose replacement text holds markup, and
 * EntityWellFormednessError for one whose replacement text is not well-formed there. Use
 * decodeText and decodeAttr for source text: they normalize it first.
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
    const bad = entityError(ref, table, attr, []);
    if (bad && bad.kind === undefined) throw new EntityWellFormednessError(bad.message);
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
