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

import { NS, descendants, type Attr, type Doc, type ElementNode, type NodeId } from './doc.ts';
import { ARIA_IDREFS, buildRefIndex } from './refs.ts';
import { decodeAttr } from '../xml/entities.ts';
import { decodeFragment } from '../values/url.ts';
import { opSetAttr, opSetAttrRaw, type Op } from '../commands/ops.ts';

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
