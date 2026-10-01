// The import report: what Draw can do with an opened file, from the support ledger.
//
// - editable: Draw's tools edit it (ledger class edit);
// - kept: kept byte for byte, rendered or not (preserve, preserve-hidden, drop);
// - preview: active content, kept but only ever run in the sandboxed preview (active);
// - unclassified: no ledger row names it; only a fallback row caught it (kept, never rendered).
//
// Plus notes on things that change what the file looks like in Draw or in another browser, and on
// the external entities a DOCTYPE declares (never fetched). P1-M4: the file's own fonts (its data:
// @font-face faces, which Draw registers so both engines draw them), and the ones it doesn't load: a
// face named like Draw's own interface fonts (it would restyle Draw itself), and faces over the limits.
// P1-M4 S3: the style rules that can't match on the canvas (focus, tabindex and link selectors), and
// the Dublin Core items the Access tab shows: kept as written (their rows' class), and edited there.

import { descendants, NS, type Doc, type ElementNode } from '../model/doc.ts';
import { buildRefIndex, duplicateIds } from '../model/refs.ts';
import { classifyAttribute, classifyElement, type Classified } from '../policy/classify.ts';
import { elementRenders } from '../policy/render-policy.ts';
import type { LedgerClass } from '../policy/tables.ts';
import { cssSets, unmatchableRules } from '../geometry/css.ts';
import { rootFontSize } from '../geometry/lengths.ts';
import { fmt } from '../values/number-format.ts';
import { FACE_MAX, FACES_MAX, appFontName, fontFaces } from '../text/font-faces.ts';
import { metaOf } from '../access/metadata.ts';

export type Bucket = 'editable' | 'kept' | 'preview' | 'unclassified';

export interface ReportItem {
  bucket: Bucket;
  kind: 'element' | 'attribute';
  name: string; // 'rect', 'inkscape:label', 'xhtml:div', 'on*'
  cls: LedgerClass;
  count: number;
}

export interface ImportReport {
  totals: Record<Bucket, number>;
  items: ReportItem[]; // grouped by bucket, kind and name; most frequent first within a bucket
  notes: string[];
  /** rem lengths in attributes and style="" (decision 13): Convert rem rewrites them in user units, unless a <style> rule may set the root's font size. */
  rem: { count: number; convertible: boolean; why: string | null };
}

export const REM_UNCONVERTIBLE = 'The root’s font size is set by a <style> rule, so Draw can’t tell what 1rem is.';

/** The rem lengths in a document's attributes (style="" included), and in its <style> text. */
export function remLengths(doc: Doc): { attributes: number; styleText: number } {
  let attributes = 0;
  let styleText = 0;
  for (const n of descendants(doc, doc.root)) {
    if (n.kind === 'element') {
      for (const a of n.attrs) attributes += countRem(a.raw);
    } else if ((n.kind === 'text' || n.kind === 'cdata') && n.parent !== null) {
      const p = doc.nodes.get(n.parent);
      if (p?.kind === 'element' && p.local === 'style') styleText += countRem(n.raw);
    }
  }
  return { attributes, styleText };
}
const countRem = (raw: string): number => (raw.match(/(?<![\w.-])[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?rem\b/gi) ?? []).length;

export const BUCKETS: readonly Bucket[] = ['editable', 'kept', 'preview', 'unclassified'];

export function bucketOf(c: Classified): Bucket {
  if (!c.exact) return 'unclassified';
  if (c.cls === 'edit') return 'editable';
  if (c.cls === 'active') return 'preview';
  return 'kept';
}

// WebKit (Safari, the iPad) draws these; Chromium and Firefox do not.
const WEBKIT_ONLY = new Set(['tref', 'altGlyph', 'font', 'font-face', 'glyph', 'missing-glyph', 'hkern', 'vkern']);

export function importReport(doc: Doc): ImportReport {
  const groups = new Map<string, ReportItem>();
  const add = (kind: 'element' | 'attribute', name: string, c: Classified) => {
    const bucket = bucketOf(c);
    const key = `${bucket}|${kind}|${name}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { bucket, kind, name, cls: c.cls, count: 1 });
  };
  const webkitOnly = new Set<string>();
  for (const n of descendants(doc, doc.root)) {
    if (n.kind !== 'element') continue;
    const e = n as ElementNode;
    add('element', displayName(e.ns, e.qname, e.local), classifyElement(e.ns, e.local));
    if (e.ns === NS.svg && WEBKIT_ONLY.has(e.local)) webkitOnly.add(e.local);
    for (const a of e.attrs) {
      const c = classifyAttribute(e.ns, e.local, a.ns, a.local);
      if (!c) continue;
      const name = /^on/i.test(a.local) ? 'on*' : a.ns === null ? a.local : a.qname;
      add('attribute', name, c);
    }
  }
  const items = [...groups.values()].sort((a, b) => BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket) || b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const totals = { editable: 0, kept: 0, preview: 0, unclassified: 0 };
  for (const i of items) totals[i.bucket] += i.count;

  const notes: string[] = [];
  const external = [...doc.entities.external].sort();
  if (external.length) notes.push(`${external.length} external entit${external.length > 1 ? 'ies are' : 'y is'} declared (${external.slice(0, 5).join(', ')}${external.length > 5 ? ', …' : ''}); Draw never fetches them, and references to them stay as written.`);
  const refs = buildRefIndex(doc);
  const dup = duplicateIds(refs);
  if (dup.length) notes.push(`${dup.length} id${dup.length > 1 ? 's are' : ' is'} used more than once (${dup.slice(0, 5).join(', ')}${dup.length > 5 ? ', …' : ''}); browsers use the first.`);
  const dangling = [...new Set(refs.dangling.map((r) => r.id))];
  if (dangling.length) notes.push(`${dangling.length} reference${dangling.length > 1 ? 's point' : ' points'} at an id that is not in the file (${dangling.slice(0, 5).join(', ')}${dangling.length > 5 ? ', …' : ''}).`);
  // The canvas renders some of them (tref, altGlyph), so in Safari Draw draws those too.
  const names = (xs: string[]) => xs.sort().map((x) => `<${x}>`).join(', ');
  const drawn = [...webkitOnly].filter((x) => elementRenders(NS.svg, x, false));
  const hidden = [...webkitOnly].filter((x) => !elementRenders(NS.svg, x, false));
  if (drawn.length) notes.push(`Safari draws ${names(drawn)}, and so does Draw's canvas there; Chrome and Firefox do not.`);
  if (hidden.length) notes.push(`Safari draws ${names(hidden)}; Chrome, Firefox and Draw's canvas do not.`);
  if (totals.preview) notes.push('Scripts, handlers and media are kept in the file but never run in the editor.');
  if (totals.unclassified) notes.push('Unclassified content is kept byte for byte and never drawn.');
  const rems = remLengths(doc);
  const convertible = cssSets(doc, doc.root, 'font-size') !== 'sheet';
  if (rems.attributes) {
    notes.push(`${rems.attributes} rem length${rems.attributes > 1 ? 's' : ''}: the canvas measures rem against the app’s 12 px root, not this file’s own ${fmt(rootFontSize(doc), 2)} px, so ${rems.attributes > 1 ? 'they draw' : 'it draws'} smaller here. Convert ${rems.attributes > 1 ? 'them' : 'it'} to user units to fix it.${convertible ? '' : ` ${REM_UNCONVERTIBLE}`}`);
  }
  if (rems.styleText) notes.push(`${rems.styleText} rem length${rems.styleText > 1 ? 's' : ''} inside <style> text ${rems.styleText > 1 ? 'are' : 'is'} left as written.`);
  notes.push(...fontNotes(doc));
  const unmatchable = unmatchableRules(doc);
  if (unmatchable) notes.push(`${unmatchable} style rule${unmatchable > 1 ? 's' : ''} can’t match on the canvas: its shapes are never focused and never links.`);
  const dc = [...new Set(metaOf(doc).items.map((i) => i.key))];
  if (dc.length) notes.push(`Its Dublin Core ${dc.length > 1 ? 'items' : 'item'} (${dc.slice(0, 5).join(', ')}${dc.length > 5 ? ', …' : ''}) ${dc.length > 1 ? 'are' : 'is'} kept as written and edited in the Access tab.`);
  return { totals, items, notes, rem: { count: rems.attributes, convertible, why: convertible ? null : REM_UNCONVERTIBLE } };
}

function displayName(ns: string | null, qname: string, local: string): string {
  if (ns === NS.svg) return local;
  if (ns === NS.xhtml) return `xhtml:${local}`;
  return qname;
}

/** The import report's notes on a file's own fonts (P1-M4). */
export function fontNotes(doc: Doc): string[] {
  const own = fontFaces(doc);
  const drawn = own.faces.filter((f) => !appFontName(f.family));
  const notes: string[] = [];
  if (drawn.length) notes.push(`This file’s own fonts: ${drawn.length} drawn on the canvas.`);
  for (const family of [...new Set(own.faces.filter((f) => appFontName(f.family)).map((f) => f.family))]) notes.push(`Not loaded: ${family}, which shares a name with Draw’s own interface fonts.`);
  for (const family of [...new Set(own.over)]) notes.push(`Not loaded: ${family}, over the limits for a file’s own fonts (${FACE_MAX / 1e6} MB a face, ${FACES_MAX / 1e6} MB in all).`);
  return notes;
}
