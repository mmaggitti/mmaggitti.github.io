// Where CSS may set a property on an element: its own style="" declarations ('inline'), or a
// <style> rule whose selector may match it ('sheet'). CSS wins over the presentation attribute, so
// geometry a rule sets is not the attribute's, and Draw refuses to write the attribute in its place.
// sheetSets asks the sheets alone (whatever style="" says), and whether such a rule marks the
// property !important (P1-M2's Inspect: a rule's !important wins over style="" too).
//
// "May match" is conservative, and selectors are never evaluated: a rule may match when its last
// compound selector names the element's local name, `*`, its id or one of its classes, or names
// none of those (attribute selectors and pseudo-classes alone). Rules inside @media, @supports,
// @layer, @container and @scope count; @keyframes count for an element some rule or its style
// animates. A property also counts as set by a shorthand that sets it (font sets font-size).

import { NS, attrValue, descendants, el, textContent, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { decodeFragment } from '../values/url.ts';

export type CssSource = 'no' | 'inline' | 'sheet';

/** Shorthands that also set a property. */
const SHORTHANDS: Readonly<Record<string, readonly string[]>> = { 'font-size': ['font'] };

export interface Decl {
  name: string; // lowercase
  value: string; // without !important, trimmed
  important: boolean;
  /** The value's span in the text read, [start, end): trimmed, without !important (comments inside it kept). */
  start: number;
  end: number;
}

const IMPORTANT = /![ \t\n\r\f]*important[ \t\n\r\f]*$/i;
const blankChar = (c: string) => c.trim() === ''; // what String.prototype.trim takes off

/** The declarations of a declaration block (a style attribute's value), in order. */
export function declarations(css: string): Decl[] {
  const out: Decl[] = [];
  let seg = 0;
  const push = (a: number, b: number) => {
    const text = stripComments(css.slice(a, b));
    const colon = text.indexOf(':');
    if (colon === -1) return;
    const name = text.slice(0, colon).trim().toLowerCase();
    if (!/^-?[a-z][a-z0-9-]*$/.test(name)) return;
    const value = text.slice(colon + 1).replace(IMPORTANT, '').trim();
    // The value's span, read on the same text with each comment blanked character for character
    // (so every offset holds), then trimmed by loops (a regex would retry at every space).
    const blank = blankComments(css.slice(a, b));
    let end = blank.length;
    const bang = IMPORTANT.exec(blank);
    if (bang) end = bang.index;
    let start = blank.indexOf(':') + 1;
    while (start < end && blankChar(blank[start])) start++;
    while (end > start && blankChar(blank[end - 1])) end--;
    out.push({ name, value, important: !!bang, start: a + start, end: a + end });
  };
  for (let i = 0; i < css.length; ) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      i = e === -1 ? css.length : e + 2;
    } else if (c === '"' || c === "'") i = skipString(css, i);
    else if (c === '\\') i += 2; // an escape: the next character is a name's, never a separator
    else if (c === '(') i = skipParens(css, i);
    else if (c === ';') {
      push(seg, i);
      seg = ++i;
    } else i++;
  }
  push(seg, css.length);
  return out;
}

/** The element's own style="" value for a property (the last declaration wins), or null. */
export function inlineDecl(doc: Doc, id: NodeId, prop: string): string | null {
  const style = attrValue(doc, el(doc, id), null, 'style');
  if (style === null) return null;
  let found: string | null = null;
  for (const d of declarations(style)) if (d.name === prop) found = d.value;
  return found;
}

/** Where CSS may set `prop` on this element: its style attribute, a <style> rule, or neither. */
export function cssSets(doc: Doc, id: NodeId, prop: string): CssSource {
  const names = [prop, ...(SHORTHANDS[prop] ?? [])];
  const style = attrValue(doc, el(doc, id), null, 'style');
  if (style !== null && declarations(style).some((d) => names.includes(d.name))) return 'inline';
  return sheetSets(doc, id, prop) === 'no' ? 'no' : 'sheet';
}

/** Whether a <style> rule may set a property, and marks it !important. */
export type SheetSource = 'no' | 'rule' | 'important';

/**
 * Whether a <style> rule may set `prop` on this element, whatever its own style="" says: 'important'
 * when such a rule declares it !important, else 'rule' (a @keyframes animation counts as a rule),
 * else 'no'. Read from the cached sheet, so asking about many elements reads the sheets once.
 */
export function sheetSets(doc: Doc, id: NodeId, prop: string): SheetSource {
  const names = [prop, ...(SHORTHANDS[prop] ?? [])];
  const sheet = sheetOf(doc);
  const node = el(doc, id);
  let out: SheetSource = 'no';
  for (const r of sheet.rules) {
    let sets = false;
    let important = false;
    for (const d of r.decls) {
      if (!names.includes(d.name)) continue;
      sets = true;
      if (d.important) important = true;
    }
    // Once a rule may set it, only an !important one can change the answer.
    if (!sets || (!important && out === 'rule') || !r.selectors.some((s) => mayMatch(s, doc, node))) continue;
    if (important) return 'important';
    out = 'rule';
  }
  if (out !== 'no') return out;
  // A @keyframes rule sets what it animates on an element that some rule (or its style) animates.
  if (sheet.keyframes.has(prop) || names.some((n) => sheet.keyframes.has(n))) {
    const style = attrValue(doc, node, null, 'style');
    const animated = (style !== null && declarations(style).some((d) => d.name === 'animation' || d.name === 'animation-name'))
      || sheet.rules.some((r) => r.decls.some((d) => d.name === 'animation' || d.name === 'animation-name') && r.selectors.some((s) => mayMatch(s, doc, node)));
    if (animated) return 'rule';
  }
  return 'no';
}

/**
 * Does a <style> in the document name this id: an id selector (#c, escapes read) or a url(#c)? Read
 * conservatively (inside strings too), so a Rename that would leave a rule behind is refused.
 */
export function styleNamesId(doc: Doc, id: string): boolean {
  for (const n of descendants(doc, doc.root)) {
    if (n.kind !== 'element' || n.local !== 'style' || (n.ns !== NS.svg && n.ns !== NS.xhtml)) continue;
    for (const m of stripComments(textContent(doc, n.id)).matchAll(/#((?:\\[0-9A-Fa-f]{1,6}[ \t\r\n\f]?|\\[^\r\n\f0-9A-Fa-f]|[\w-]|[^\x00-\x7F])+)/g)) {
      if (unescapeCss(m[1]) === id) return true;
    }
  }
  return false;
}

/**
 * Each id a <style> element's text names in a url() (url(#id), url('#id') or url("#id"), CSS
 * escapes read and the id percent-decoded, as browsers match it), with the <style> element of each
 * rule that does: one entry per rule, however often the rule names it (a rule is the text between
 * two braces). Read conservatively, as styleNamesId is: in any rule or at-rule (@keyframes too), in
 * comments and strings too, so Draw never takes away a gradient a stylesheet may still paint with.
 * Cached per stylesheet content (doc.styleVersion).
 */
export function sheetUrlRefs(doc: Doc): ReadonlyMap<string, readonly NodeId[]> {
  const hit = urlCache.get(doc);
  if (hit?.styleVersion === doc.styleVersion) return hit.refs;
  const refs = new Map<string, NodeId[]>();
  for (const n of descendants(doc, doc.root)) {
    if (n.kind !== 'element' || n.local !== 'style' || (n.ns !== NS.svg && n.ns !== NS.xhtml)) continue;
    for (const rule of textContent(doc, n.id).split(/[{}]/)) {
      const named = new Set<string>();
      for (const m of rule.matchAll(SHEET_URL)) named.add(decodeFragment(unescapeCss(m[1] ?? m[2] ?? m[3])));
      for (const id of named) {
        const list = refs.get(id);
        if (list) list.push(n.id);
        else refs.set(id, [n.id]);
      }
    }
  }
  urlCache.set(doc, { styleVersion: doc.styleVersion, refs });
  return refs;
}

const urlCache = new WeakMap<Doc, { styleVersion: number; refs: Map<string, NodeId[]> }>();
// url( then, after any whitespace, a fragment: quoted (to its quote, or the end: an unclosed string
// still counts) or unquoted; a backslash escapes the next character in both.
const SHEET_URL = /url\(\s*(?:"#((?:\\[^]|[^"\\])*)|'#((?:\\[^]|[^'\\])*)|#((?:\\[^]|[^\s"'()\\])+))/gi;

// A CSS identifier's escapes read: \31  (hex, with its one optional space) and \. (the character).
const unescapeCss = (s: string) => s.replace(/\\([0-9A-Fa-f]{1,6})[ \t\r\n\f]?|\\(.)/g, (_, hex: string | undefined, ch: string | undefined) => (hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : ch!));

// ── the document's sheets, read again only when what its <style> elements say may have changed ──

interface Rule {
  selectors: Compound[]; // each selector's last compound
  decls: { name: string; important: boolean }[]; // what it declares, and which are !important
}
interface Compound {
  type: string | null; // a local name, '*', or null
  ids: string[];
  classes: string[];
}
interface Sheet {
  rules: Rule[];
  keyframes: Set<string>; // properties any @keyframes block animates
}

// Keyed on the stylesheets' own content (doc.styleVersion), not on every edit: a move of k shapes
// asks about each of them, and must not read the whole document k times.
const cache = new WeakMap<Doc, { version: number; sheet: Sheet }>();

function sheetOf(doc: Doc): Sheet {
  const hit = cache.get(doc);
  if (hit && hit.version === doc.styleVersion) return hit.sheet;
  const sheet: Sheet = { rules: [], keyframes: new Set() };
  for (const n of descendants(doc, doc.root)) {
    if (n.kind === 'element' && n.local === 'style' && (n.ns === NS.svg || n.ns === NS.xhtml)) readSheet(stripComments(textContent(doc, n.id)), sheet);
  }
  cache.set(doc, { version: doc.styleVersion, sheet });
  return sheet;
}

const GROUPING = /^@(media|supports|layer|container|scope|document|-moz-document)\b/i;

function readSheet(css: string, into: Sheet, inKeyframes = false): void {
  let i = 0;
  while (i < css.length) {
    const open = findTop(css, i, '{', ';');
    if (open === -1) return;
    if (css[open] === ';') {
      i = open + 1; // an @import or @charset statement
      continue;
    }
    const close = matching(css, open);
    const prelude = css.slice(i, open).trim();
    const body = css.slice(open + 1, close);
    if (/^@(-webkit-)?keyframes\b/i.test(prelude)) readSheet(body, into, true);
    else if (GROUPING.test(prelude)) readSheet(body, into, inKeyframes);
    else if (prelude.startsWith('@')) {
      // @font-face, @page, @property: nothing that styles an element
    } else if (inKeyframes) for (const d of declarations(body)) into.keyframes.add(d.name);
    else into.rules.push({ selectors: splitTop(prelude, ',').map(lastCompound), decls: declarations(body).map((d) => ({ name: d.name, important: d.important })) });
    i = close + 1;
  }
}

/** The rule's last compound selector (after the last combinator), read for what it names. */
function lastCompound(selector: string): Compound {
  const s = selector.trim();
  // Walk back to the last combinator (whitespace, >, +, ~) outside brackets and parentheses.
  let depth = 0;
  let start = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i];
    if (c === ')' || c === ']') depth++;
    else if (c === '(' || c === '[') depth--;
    else if (depth === 0 && (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '>' || c === '+' || c === '~')) {
      start = i + 1;
      break;
    }
  }
  const compound = s.slice(start);
  const out: Compound = { type: null, ids: [], classes: [] };
  const m = /^(?:(?:[\w-]*|\*)\|)?([A-Za-z_][\w-]*|\*)/.exec(compound);
  let rest = compound;
  if (m) {
    out.type = m[1];
    rest = compound.slice(m[0].length);
  }
  // Drop what is inside brackets and pseudo-class arguments, then read #ids and .classes.
  let flat = '';
  depth = 0;
  for (const c of rest) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0) flat += c;
  }
  for (const x of flat.matchAll(/#((?:\\.|[\w-])+)/g)) out.ids.push(unescapeIdent(x[1]));
  for (const x of flat.matchAll(/(?<!:)\.((?:\\.|[\w-])+)/g)) out.classes.push(unescapeIdent(x[1]));
  return out;
}

const unescapeIdent = (s: string) => s.replace(/\\(.)/g, '$1');

function mayMatch(c: Compound, doc: Doc, node: ElementNode): boolean {
  if (c.type === null && !c.ids.length && !c.classes.length) return true;
  if (c.type === '*' || c.type === node.local) return true;
  const id = attrValue(doc, node, null, 'id');
  if (id !== null && c.ids.includes(id)) return true;
  const classes = (attrValue(doc, node, null, 'class') ?? '').split(/[ \t\n\r\f]+/).filter(Boolean);
  return c.classes.some((k) => classes.includes(k));
}

// ── scanning ───────────────────────────────────────────────────────────────────────────────────

/** The text with each comment's characters blanked to spaces, one for one, so offsets hold. */
function blankComments(css: string): string {
  if (!css.includes('/*')) return css;
  let out = '';
  for (let i = 0; i < css.length; ) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      const end = e === -1 ? css.length : e + 2;
      out += ' '.repeat(end - i);
      i = end;
    } else if (c === '"' || c === "'") {
      const e = skipString(css, i);
      out += css.slice(i, e);
      i = e;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function stripComments(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; ) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      i = e === -1 ? css.length : e + 2;
      out += ' ';
    } else if (c === '"' || c === "'") {
      const e = skipString(css, i);
      out += css.slice(i, e);
      i = e;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function skipString(v: string, i: number): number {
  const q = v[i];
  for (let k = i + 1; k < v.length; k++) {
    if (v[k] === '\\') k++;
    else if (v[k] === q) return k + 1;
  }
  return v.length;
}

function skipParens(v: string, i: number): number {
  let depth = 0;
  for (let k = i; k < v.length; ) {
    const c = v[k];
    if (c === '"' || c === "'") k = skipString(v, k);
    else if (c === '\\') k += 2; // an escape: the next character is part of a name or url, never a parenthesis
    else {
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return k + 1;
      k++;
    }
  }
  return v.length;
}

/** The first of `chars` at the top level (outside strings and parentheses) from `i`, or -1. */
function findTop(v: string, i: number, ...chars: string[]): number {
  for (let k = i; k < v.length; ) {
    const c = v[k];
    if (c === '"' || c === "'") k = skipString(v, k);
    else if (c === '(') k = skipParens(v, k);
    else if (chars.includes(c)) return k;
    else k++;
  }
  return -1;
}

/** The index of the '}' that closes the '{' at `open` (or the end). */
function matching(v: string, open: number): number {
  let depth = 0;
  for (let k = open; k < v.length; ) {
    const c = v[k];
    if (c === '"' || c === "'") k = skipString(v, k);
    else if (c === '(') k = skipParens(v, k);
    else {
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return k;
      k++;
    }
  }
  return v.length;
}

/** Split at a separator outside strings, parentheses and brackets. */
function splitTop(v: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let a = 0;
  for (let k = 0; k < v.length; ) {
    const c = v[k];
    if (c === '"' || c === "'") {
      k = skipString(v, k);
      continue;
    }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      out.push(v.slice(a, k));
      a = k + 1;
    }
    k++;
  }
  out.push(v.slice(a));
  return out.filter((s) => s.trim());
}
