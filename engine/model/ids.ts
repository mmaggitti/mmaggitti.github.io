// Fresh ids, and renaming ids with every reference to them: what Duplicate gives its copies and
// what Layers' Rename does; and SVG Lab's numbered ids (gloss-1, linear-2) for Draw's gradients.
//
// - freshId: the first of `base`, `base-2`, `base-3`, … that no element's id (or xml:id) uses and
//   `taken` doesn't hold, so one batch can reserve several. A batch reads the ids in use once
//   (idsInUse) and passes them in, so it doesn't walk the document once per id.
// - renameIdsIn: inside one subtree only, every mapped id and every reference refs.ts indexes to a
//   mapped id (url(#…) in any attribute, style="" included; href and xlink:href="#…"; every ARIA
//   id reference, refs.ts's ARIA_IDREFS; SMIL begin and end "id.event" values). Only the id's own characters change, as
//   undoable attribute ops, so references outside the subtree keep pointing at the originals.
//   A value written with entity references is rewritten whole instead (escaped as setAttr does).
// - renameIdsInStyles: the same map inside the subtree's <style> text (the Insert tool's, whose
//   <style> applies to the whole drawing): url(#…) anywhere and #id selectors, read as CSS tokenizes
//   them (policy/font-face-rules.ts), so a comment, a string or a colour never changes; a url("#…")
//   is a URL, so its string does.

import { NS, descendants, type Attr, type Doc, type ElementNode, type NodeId } from './doc.ts';
import { ARIA_IDREFS, buildRefIndex } from './refs.ts';
import { decodeAttr, decodeText, escape } from '../xml/entities.ts';
import { decodeFragment } from '../values/url.ts';
import { opSetAttr, opSetAttrRaw, opSetLeafRaw, type Op } from '../commands/ops.ts';
import { cssTokenAt } from '../policy/font-face-rules.ts';

/** Every id in use in the document (id and xml:id). */
export function idsInUse(doc: Doc): Set<string> {
  return new Set(buildRefIndex(doc).ids.keys());
}

/** The first of base, base-2, base-3, … that no element uses (`used`: the ids in use) and `taken` doesn't hold. */
export function freshId(doc: Doc, base: string, taken: ReadonlySet<string> = new Set(), used: ReadonlySet<string> = idsInUse(doc)): string {
  if (!used.has(base) && !taken.has(base)) return base;
  for (let k = 2; ; k++) {
    const id = `${base}-${k}`;
    if (!used.has(id) && !taken.has(id)) return id;
  }
}

/**
 * `prefix-N`, N the first positive integer no element's id uses (`used`) and `taken` doesn't hold:
 * SVG Lab's numbered ids (gloss-1, linear-2), which freshId's base, base-2 scheme wouldn't give.
 */
export function numberedId(doc: Doc, prefix: string, taken: ReadonlySet<string> = new Set(), used: ReadonlySet<string> = idsInUse(doc)): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!used.has(id) && !taken.has(id)) return id;
  }
}

/**
 * numberedId for a whole command: the ids in use read once, each id handed out reserved, and each
 * prefix's count carried on, so a command over many shapes stays linear (a Gloss over 1,000 shapes
 * doesn't search from 1 a thousand times).
 */
export function numberedIds(doc: Doc, used: ReadonlySet<string> = idsInUse(doc)): (prefix: string) => string {
  const next = new Map<string, number>();
  return (prefix) => {
    let n = next.get(prefix) ?? 1;
    while (used.has(`${prefix}-${n}`)) n++;
    next.set(prefix, n + 1);
    return `${prefix}-${n}`;
  };
}

// References as refs.ts reads them, matched on the raw text so only the id's characters change.
const URL_REF = /url\(\s*(?:(['"])#([^'"]+)\1|#([^'")\s]+))\s*\)/g;
const SMIL_REF = /(^|;)(\s*)([A-Za-z_][\w-]*)(\.(?:begin|end|click|mouseover|mouseout|mousedown|mouseup|focusin|focusout|activate|repeat(?:\(\d+\))?)\b)/g;

/** The attribute's new raw text with mapped ids renamed, or null when nothing changes. */
function renamed(a: Attr, value: string, map: ReadonlyMap<string, string>): string | null {
  const text = a.raw.includes('&') ? value : a.raw; // with references, work on the decoded value
  let out: string | null = null;
  if (a.local === 'id' && (a.ns === null || a.ns === NS.xml)) {
    const to = map.get(value);
    if (to !== undefined) out = to;
  } else if (a.local === 'href' && (a.ns === null || a.ns === NS.xlink)) {
    const lead = text.length - text.trimStart().length;
    const v = text.trim();
    const to = v.startsWith('#') ? map.get(decodeFragment(v.slice(1))) : undefined;
    if (to !== undefined) out = `${text.slice(0, lead)}#${to}${text.slice(lead + v.length)}`;
  } else if (a.ns === null && ARIA_IDREFS.has(a.local)) {
    const next = text.replace(/[^ \t\n\r]+/g, (id) => map.get(id) ?? id);
    if (next !== text) out = next;
  } else if (a.ns === null && (a.local === 'begin' || a.local === 'end')) {
    const next = text.replace(SMIL_REF, (m, semi: string, ws: string, id: string, ev: string) => (map.has(id) ? `${semi}${ws}${map.get(id)}${ev}` : m));
    if (next !== text) out = next;
  } else if (text.includes('url(')) {
    const next = text.replace(URL_REF, (m, q: string | undefined, quoted: string | undefined, bare: string | undefined) => {
      const raw = quoted ?? bare!;
      const to = map.get(decodeFragment(raw));
      if (to === undefined) return m;
      const at = m.indexOf(raw, m.indexOf('#'));
      return m.slice(0, at) + to + m.slice(at + raw.length);
    });
    if (next !== text) out = next;
  }
  return out;
}

/**
 * Rename ids inside the subtree at `root`: each mapped id, and every reference to one from inside
 * the subtree. Each changed attribute is one op, applied and handed to `apply` (a Session build).
 */
export function renameIdsIn(doc: Doc, root: NodeId, map: ReadonlyMap<string, string>, apply: (op: Op) => void): void {
  if (!map.size) return;
  const els = [...descendants(doc, root)].filter((n): n is ElementNode => n.kind === 'element');
  for (const n of els) {
    for (const a of [...n.attrs]) {
      if (a.ns === NS.xmlns) continue;
      const value = decodeAttr(a.raw, doc.entities);
      const next = renamed(a, value, map);
      if (next === null) continue;
      if (a.raw.includes('&')) apply(opSetAttr(doc, n.id, a.ns, a.local, next));
      else apply(opSetAttrRaw(doc, n.id, a.ns, a.local, next));
    }
  }
}

// ── ids in a <style>'s text ─────────────────────────────────────────────────────────────────────

// CSS escapes as the tokenizer reads them: hex (0, surrogates and out of range as U+FFFD, one
// whitespace after it taken), a backslash and newline removed (a string's line continuation), any
// other character itself.
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\n\r\f])|([\s\S]))/g;
const unescapeCss = (s: string): string =>
  s.replace(CSS_ESCAPE, (_, hex?: string, nl?: string, ch?: string) => {
    if (!hex) return nl ? '' : ch!;
    const cp = parseInt(hex, 16);
    return cp === 0 || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff ? '\uFFFD' : String.fromCodePoint(cp);
  });

// An id written as a CSS name: a letter, a digit, _, - or anything from U+0080 as it is, any other
// character as a hex escape, and a digit where a name can't start (first, or after a first -)
// escaped too, so it reads back as the same id in a selector, a url() or a string.
function cssName(id: string): string {
  let out = '';
  let i = 0;
  for (const ch of id) {
    const cp = ch.codePointAt(0)!;
    const digitFirst = /[0-9]/.test(ch) && (i === 0 || (i === 1 && id[0] === '-'));
    out += (/[A-Za-z0-9_-]/.test(ch) || cp >= 0x80) && !digitFirst ? ch : `\\${cp.toString(16)} `;
    i++;
  }
  return out;
}
// In a URL a % starts a percent escape, so the id's own % is written %25.
const urlName = (id: string): string => cssName(id.replace(/%/g, '%25'));

interface CssEdit {
  start: number;
  end: number;
  text: string;
}
const isCssSpace = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

// An unquoted url(#id) token from `start` to `end`: the id's characters, when it is mapped.
function urlEdit(css: string, start: number, end: number, map: ReadonlyMap<string, string>): CssEdit | null {
  let j = css.indexOf('(', start) + 1;
  while (j < end && isCssSpace(css[j])) j++;
  if (css[j] !== '#') return null;
  let k = css[end - 1] === ')' ? end - 1 : end;
  while (k > j && isCssSpace(css[k - 1])) k--;
  const to = map.get(decodeFragment(unescapeCss(css.slice(j + 1, k))));
  return to === undefined ? null : { start: j + 1, end: k, text: urlName(to) };
}

// A url("#id") whose url( ends at `from`: the id's characters inside its string, when it is mapped.
function quotedUrlEdit(css: string, from: number, map: ReadonlyMap<string, string>): CssEdit | null {
  let j = from;
  while (j < css.length && isCssSpace(css[j])) j++;
  if (j >= css.length) return null;
  const tok = cssTokenAt(css, j);
  if (tok.kind !== 'string' || tok.end - j < 2 || css[tok.end - 1] !== css[j]) return null;
  let k = tok.end;
  while (k < css.length && isCssSpace(css[k])) k++;
  if (css[k] !== ')') return null;
  const value = unescapeCss(css.slice(j + 1, tok.end - 1));
  const to = value.startsWith('#') ? map.get(decodeFragment(value.slice(1))) : undefined;
  return to === undefined ? null : { start: j + 1, end: tok.end - 1, text: `#${urlName(to)}` };
}

/**
 * CSS text with mapped ids renamed: every url(#…) (quoted or not) and every #id in a rule's selector
 * (a hash before the rule's {, at any nesting; one before a ; or a } is a value, a colour). Comments
 * and other strings are left as written.
 */
export function renameIdsInCss(css: string, map: ReadonlyMap<string, string>): string {
  if (!map.size || !css.includes('#')) return css;
  const edits: CssEdit[] = [];
  let selectors: CssEdit[] = []; // the hashes since the last {, } or ;: kept if a { follows
  let depth = 0; // the ( and [ open since then (a function's too)
  for (let i = 0; i < css.length; ) {
    const tok = cssTokenAt(css, i);
    if (tok.kind === 'hash') {
      const to = map.get(unescapeCss(css.slice(i + 1, tok.end)));
      if (to !== undefined) selectors.push({ start: i + 1, end: tok.end, text: cssName(to) });
    } else if (tok.kind === 'url') {
      const e = urlEdit(css, i, tok.end, map);
      if (e) edits.push(e);
    } else if (tok.kind === 'function') {
      depth++;
      if (css.slice(i, tok.end).toLowerCase() === 'url(') {
        const e = quotedUrlEdit(css, tok.end, map);
        if (e) edits.push(e);
      }
    } else if (tok.kind === 'open') {
      if (tok.char !== '{') depth++;
      else if (depth === 0) {
        edits.push(...selectors);
        selectors = [];
      }
    } else if (tok.kind === 'close') {
      if (tok.char !== '}') depth = Math.max(0, depth - 1);
      else if (depth === 0) selectors = [];
    } else if (tok.kind === 'semi' && depth === 0) selectors = [];
    i = tok.end;
  }
  if (!edits.length) return css;
  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const e of edits) {
    out += css.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + css.slice(at);
}

/**
 * Rename ids inside the <style> elements of the subtree at `root` (renameIdsInCss): a text or CDATA
 * leaf that changes is written back whole (a text leaf as its decoded text, escaped), one op each,
 * applied and handed to `apply`.
 */
export function renameIdsInStyles(doc: Doc, root: NodeId, map: ReadonlyMap<string, string>, apply: (op: Op) => void): void {
  if (!map.size) return;
  for (const n of [...descendants(doc, root)]) {
    if (n.kind !== 'element' || n.ns !== NS.svg || n.local !== 'style') continue;
    for (const c of n.children) {
      const leaf = doc.nodes.get(c)!;
      if (leaf.kind === 'text') {
        const css = decodeText(leaf.raw, doc.entities);
        const next = renameIdsInCss(css, map);
        if (next !== css) apply(opSetLeafRaw(doc, c, escape(next, null)));
      } else if (leaf.kind === 'cdata') {
        const css = leaf.raw.slice('<![CDATA['.length, -']]>'.length);
        const next = renameIdsInCss(css, map);
        if (next !== css) apply(opSetLeafRaw(doc, c, `<![CDATA[${next}]]>`));
      }
    }
  }
}
