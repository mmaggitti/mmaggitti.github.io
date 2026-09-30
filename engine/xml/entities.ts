// Entity decoding, on demand and capped. The source text is never rewritten: decoded values feed
// the typed-value parsers and the security classifier, which must see what a browser would see.
//
// - The five predefined entities and numeric references always decode.
// - General entities declared in the DOCTYPE's internal subset (Illustrator declares its namespace
//   URIs this way) expand, with a total budget and a depth limit, so a billion-laughs file fails
//   instead of exhausting memory. The budget counts the work of expanding as well as the output,
//   so a bomb of entities that expand to nothing fails as fast.
// - External and parameter entities are never fetched or expanded; a reference to one is left as
//   written and reported.
// - An entity whose replacement text holds markup ('<') is refused: the model cannot represent
//   elements that only exist after expansion, and a browser would build them.
// - Values come out as an XML processor reports them: line ends normalized (XML 1.0 §2.11), and in
//   attribute values every literal tab and line end read as a space (§3.3.3).
// - wellFormedRefs refuses the references a browser refuses (a bare &, a reference without ';', a
//   character reference to a character XML doesn't allow, an undeclared entity, an external entity
//   in an attribute value, an unparsed (NDATA) entity anywhere, an entity whose text isn't
//   well-formed where it is used), each at its place. An entity declared twice is its first
//   declaration, as in XML, and entity names are the lexer's names. An undeclared entity in a document whose DOCTYPE references a parameter entity is over
//   Draw's limits instead: the parameter entity may declare it, and Draw never expands one. So is
//   one under a DOCTYPE that names an XHTML DTD, where browsers supply HTML's named references
//   (&nbsp;, &copy;…) themselves and Draw doesn't.

import { NAME_PATTERN, clip } from './lex.ts';

// Characters produced by expansion, per document, plus the work of expanding (see decode): one per
// expansion, and the replacement text an expansion reads for references.
export const ENTITY_BUDGET = 1_000_000;
export const ENTITY_DEPTH = 8;

const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export interface EntityTable {
  internal: Map<string, string>; // name → replacement text (itself possibly containing references)
  external: Set<string>; // declared SYSTEM/PUBLIC: never fetched
  unparsed: Set<string>; // the external ones declared NDATA (a non-XML file): no reference may name one
  parameter: Set<string>; // %name; declarations: never expanded
  /** The subset references a parameter entity (a %name; outside literals and comments). */
  hasPERefs: boolean;
  /** The DOCTYPE names an XHTML DTD (XHTML_DTDS): browsers then supply HTML's named references. */
  xhtmlDtd: boolean;
}

export const NO_ENTITIES: EntityTable = { internal: new Map(), external: new Set(), unparsed: new Set(), parameter: new Set(), hasPERefs: false, xhtmlDtd: false };

/**
 * The public identifiers under which a browser's XML parser supplies HTML's named character
 * references (&nbsp;, &copy;…) for entities the document doesn't declare, without reading the DTD:
 * the list Blink's and WebKit's XML document parsers share (their external-subset handler).
 */
export const XHTML_DTDS: ReadonlySet<string> = new Set([
  '-//W3C//DTD XHTML 1.0 Transitional//EN',
  '-//W3C//DTD XHTML 1.1//EN',
  '-//W3C//DTD XHTML 1.0 Strict//EN',
  '-//W3C//DTD XHTML 1.0 Frameset//EN',
  '-//W3C//DTD XHTML Basic 1.0//EN',
  '-//W3C//DTD XHTML 1.1 plus MathML 2.0//EN',
  '-//W3C//DTD XHTML 1.1 plus MathML 2.0 plus SVG 1.1//EN',
  '-//W3C//DTD MathML 2.0//EN',
  '-//WAPFORUM//DTD XHTML Mobile 1.0//EN',
  '-//WAPFORUM//DTD XHTML Mobile 1.1//EN',
  '-//WAPFORUM//DTD XHTML Mobile 1.2//EN',
]);

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

const PE_REF = new RegExp(`%${NAME_PATTERN};`, 'y');
// An external identifier runs to the declaration's '>' through its literals, never past a '<': an
// unterminated declaration can't send the scan on to the end of the subset from every one.
const DECLARATION = new RegExp(`<!ENTITY\\s+(%\\s+)?(${NAME_PATTERN})\\s+(?:(SYSTEM|PUBLIC)\\b((?:[^<>"']|"[^"]*"|'[^']*')*)|"([^"]*)"|'([^']*)')\\s*>`, 'g');

/**
 * Read <!ENTITY …> declarations from a DOCTYPE internal subset (not from its comments or processing
 * instructions). As in XML, an internal entity's replacement text has its line ends normalized and
 * its character references expanded at the declaration; entity references in it expand later,
 * where the entity is used. A character reference to a character XML doesn't allow stays as
 * written, so a use of the entity is refused (wellFormedRefs). `publicId` is the one the DOCTYPE
 * names, if any.
 */
export function readEntityTable(subset: string | null, publicId: string | null = null): EntityTable {
  const table: EntityTable = { internal: new Map(), external: new Set(), unparsed: new Set(), parameter: new Set(), hasPERefs: false, xhtmlDtd: publicId !== null && XHTML_DTDS.has(publicId) };
  if (!subset) return table;
  const { declarations, hasPERefs } = readSubset(subset);
  table.hasPERefs = hasPERefs;
  for (const m of declarations.matchAll(DECLARATION)) {
    const name = m[2];
    // XML binds an entity's first declaration and ignores later ones. General entities (internal,
    // external, unparsed) share their names; parameter entities have their own.
    if (m[1] ? table.parameter.has(name) : table.internal.has(name) || table.external.has(name)) continue;
    if (m[1]) table.parameter.add(name);
    else if (m[3]) {
      table.external.add(name);
      if (/\bNDATA\b/.test(m[4].replace(/"[^"]*"|'[^']*'/g, ''))) table.unparsed.add(name);
    } else table.internal.set(name, normalizeEol(m[5] ?? m[6] ?? '').replace(CHAR_REF, (whole, ref: string) => (isXmlChar(codePoint(ref)) ? charRef(ref) : whole)));
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

const REF = new RegExp(`&(#x[0-9a-fA-F]+|#[0-9]+|${NAME_PATTERN})?(;?)`, 'y');

/**
 * The first reference in raw text (a text leaf's or an attribute value's, as written) that a
 * browser's parser refuses, or null. Internal entities are checked as they would expand there
 * (each entity once per document and context); how far they expand is decode's to limit.
 */
export function wellFormedRefs(raw: string, table: EntityTable, inAttr: boolean): RefError | null {
  const r = refError(raw, table, inAttr, []);
  return r && (r.kind ? { at: r.at, message: r.message, kind: r.kind } : { at: r.at, message: r.message });
}

/**
 * What is wrong in an entity's replacement text: `chain` is the entities expanded to reach the text
 * at fault, outermost first, and `cause` what is wrong in it.
 */
interface Fault {
  chain: string[];
  cause: string;
  kind?: 'limit';
}
type Found = RefError & { fault?: Fault };

// A chain is named once, by its ends: "the entity &c8; (through &c7; … &c0;) expands to…".
function faultMessage({ chain, cause }: Fault): string {
  if (!chain.length) return cause; // an entity that refers to itself, met while expanding it
  const through = chain.length < 2 ? '' : ` (through ${chain.length > 2 ? `&${clip(chain[1])}; … ` : ''}&${clip(chain[chain.length - 1])};)`;
  return `the entity &${clip(chain[0])};${through} expands to text that isn't well-formed: ${cause}`;
}

function refError(raw: string, table: EntityTable, inAttr: boolean, open: string[]): Found | null {
  for (let i = raw.indexOf('&'); i !== -1; i = raw.indexOf('&', i + 1)) {
    REF.lastIndex = i;
    const [, ref, semi] = REF.exec(raw)!;
    if (ref === undefined) return { at: i, message: raw[i + 1] === '#' ? 'a malformed character reference' : "a bare & (write &amp; for the character itself)" };
    if (!semi) return { at: i, message: ref[0] === '#' ? 'a malformed character reference' : `the reference &${clip(ref)} has no closing ;` };
    if (ref[0] === '#') {
      if (!isXmlChar(codePoint(ref.slice(1)))) return { at: i, message: `&${clip(ref)}; names a character XML doesn't allow` };
    } else if (Object.hasOwn(PREDEFINED, ref)) continue;
    else if (table.internal.has(ref)) {
      const fault = entityError(ref, table, inAttr, open);
      if (fault) return fault.kind ? { at: i, message: faultMessage(fault), kind: fault.kind, fault } : { at: i, message: faultMessage(fault), fault };
    } else if (table.unparsed.has(ref)) {
      return { at: i, message: `the entity &${clip(ref)}; is unparsed (declared NDATA): no reference may name it` };
    } else if (table.external.has(ref)) {
      if (inAttr) return { at: i, message: `the external entity &${clip(ref)}; can't be used in an attribute value` };
    } else if (table.hasPERefs) {
      return { at: i, message: `the entity &${clip(ref)}; is not declared; it may be declared by a parameter entity, which Draw doesn't expand`, kind: 'limit' };
    } else if (table.xhtmlDtd) {
      return { at: i, message: `the entity &${clip(ref)}; is not declared; a browser takes it from the XHTML DTD the DOCTYPE names, which Draw doesn't read`, kind: 'limit' };
    } else return { at: i, message: `the entity &${clip(ref)}; is not declared` };
  }
  return null;
}

const CHECKED = new WeakMap<EntityTable, Map<string, Fault | null>>();

/** Why an internal entity's replacement text is not well-formed in this context (text or attribute), or null. */
function entityError(name: string, table: EntityTable, inAttr: boolean, open: string[]): Fault | null {
  let memo = CHECKED.get(table);
  if (!memo) CHECKED.set(table, (memo = new Map()));
  const key = `${inAttr ? 'attr' : 'text'} ${name}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  if (open.includes(name)) return { chain: [], cause: `the entity &${clip(name)}; refers to itself` };
  if (open.length > ENTITY_DEPTH) return null; // deeper than decode goes: it refuses the file
  const rep = table.internal.get(name)!;
  open.push(name);
  const inner: Found | null = !inAttr && rep.includes(']]>') ? { at: 0, message: "']]>' in text" } : refError(rep, table, inAttr, open);
  open.pop();
  const below: Fault | null = inner && (inner.fault ?? (inner.kind ? { chain: [], cause: inner.message, kind: inner.kind } : { chain: [], cause: inner.message }));
  const out: Fault | null = below && { ...below, chain: [name, ...below.chain] };
  memo.set(key, out);
  return out;
}

const DECODE = new RegExp(`&(#x[0-9a-fA-F]+|#\\d+|${NAME_PATTERN});`, 'g');

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
  return s.replace(DECODE, (whole, ref: string) => {
    if (ref[0] === '#') return charRef(ref.slice(1));
    if (Object.hasOwn(PREDEFINED, ref)) return PREDEFINED[ref];
    const rep = table.internal.get(ref);
    if (rep === undefined) {
      unresolved?.add(ref);
      return whole;
    }
    if (rep.includes('<')) throw new EntityMarkupError(`entity &${ref}; expands to markup`);
    const bad = entityError(ref, table, attr, []);
    if (bad && bad.kind === undefined) throw new EntityWellFormednessError(faultMessage(bad));
    // An expansion costs work as well as output, or one that makes nothing is free and a bomb of
    // empty entities runs fan^depth expansions: one for the expansion, and its replacement text when
    // it holds references (read again at every use; text without them is output, charged below).
    budget.left -= 1 + (rep.includes('&') ? rep.length : 0);
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
