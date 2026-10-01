// Dublin Core metadata (P1-M4 S3): what the Access tab's Metadata shows and writes.
//
// - The file's single <metadata> (the root's first SVG <metadata> child) holds Dublin Core items bare
//   (SVG Lab's: <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"> holding <dc:creator>You
//   </dc:creator> and <dc:date>2026-09-25</dc:date>) or inside RDF (rdf:RDF/cc:Work, as Inkscape
//   writes it, cc being Creative Commons' namespace or its legacy one, web.resource.org/cc/).
// - metaOf(doc) reads the items the tab shows: dc:creator, dc:date, dc:title and dc:description, and
//   every dcterms: item, each with where its text lives: the element itself, or a dc:creator's
//   cc:Agent/dc:title (Matplotlib and Inkscape write the creator so). An item inside another item (an
//   agent's dc:title) is that item's, never one of its own. Everything else (dc:format, dc:type,
//   cc:license, rdf: and other namespaces) is kept byte for byte and never shown.
// - planMetadata(doc, on, { creator, date }): on adds dc:creator and dc:date where the file has none:
//   inside its cc:Work where its metadata is RDF, else bare in its <metadata> (xmlns:dc on the
//   <metadata> where dc isn't declared in scope); with no <metadata>, SVG Lab's markup goes after the
//   root's leading <title> and <desc>, before the drawing, spelt as SVG Lab's code writes it: in a
//   file laid out on lines, each item on a line of its own one indent deeper than the <metadata> (the
//   <metadata>'s own indent again: two spaces in SVG Lab's files), else all on one line. Off takes away every item the tab shows, and
//   the <metadata> when nothing is left in it and it carries nothing but namespace declarations. A
//   <metadata> Draw's own state shares (draw:state, P1-M1) stays while that does.
// - planMetaText(doc, item, text): an item's text in place.

import { NS, el, textContent, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { DRAW_NS } from '../model/draw-ns.ts';
import { opSetAttr, type Op } from '../commands/ops.ts';
import { insertMarkup, insertMarkups, insertion, removeWithSpace, type Where } from '../model/space.ts';
import { decodeAttr, escape } from '../xml/entities.ts';
import { TokenEditError, xmlCharError } from '../code/edit.ts';
import { setText } from './model.ts';

type Apply = (op: Op) => void;

export const DC = 'http://purl.org/dc/elements/1.1/';
export const DCTERMS = 'http://purl.org/dc/terms/';
export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const CC = 'http://creativecommons.org/ns#';
export const CC_LEGACY = 'http://web.resource.org/cc/';

/** The Dublin Core elements the tab shows from dc: (dcterms: shows every one). */
const SHOWN_DC = ['creator', 'date', 'title', 'description'];

export interface MetaItem {
  id: NodeId; // the item's element (dc:creator…)
  key: string; // dc:creator, dcterms:modified…
  at: NodeId; // where its text lives
  text: string;
}
export interface Meta {
  /** The file's <metadata>, if it has one. */
  metadata: NodeId | null;
  /** Its cc:Work, where its Dublin Core lives in RDF. */
  work: NodeId | null;
  items: MetaItem[];
}

const kids = (doc: Doc, id: NodeId): ElementNode[] => el(doc, id).children.map((c) => doc.nodes.get(c)!).filter((n): n is ElementNode => n.kind === 'element');
const isCc = (n: ElementNode) => n.ns === CC || n.ns === CC_LEGACY;

/** The file's <metadata>: the root's first SVG <metadata> child. */
export function metadataOf(doc: Doc): ElementNode | null {
  return kids(doc, doc.root).find((k) => k.ns === NS.svg && k.local === 'metadata') ?? null;
}

/** The Dublin Core items the tab shows (the module header). */
export function metaOf(doc: Doc): Meta {
  const meta = metadataOf(doc);
  if (!meta) return { metadata: null, work: null, items: [] };
  const rdf = kids(doc, meta.id).find((k) => k.ns === RDF && k.local === 'RDF');
  const work = rdf ? kids(doc, rdf.id).find((k) => isCc(k) && k.local === 'Work') : undefined;
  const items: MetaItem[] = [];
  const walk = (id: NodeId): void => {
    for (const k of kids(doc, id)) {
      const dc = k.ns === DC && SHOWN_DC.includes(k.local);
      if (k.ns === DC || k.ns === DCTERMS) {
        if (dc || k.ns === DCTERMS) {
          const agent = k.local === 'creator' && k.ns === DC ? kids(doc, k.id).find((a) => isCc(a) && a.local === 'Agent') : undefined;
          const name = agent ? kids(doc, agent.id).find((t) => t.ns === DC && t.local === 'title') : undefined;
          const at = name ?? k;
          items.push({ id: k.id, key: `${k.ns === DC ? 'dc' : 'dcterms'}:${k.local}`, at: at.id, text: textContent(doc, at.id) });
        }
        continue; // an item's insides are its own (an agent's dc:title is its creator's name)
      }
      walk(k.id);
    }
  };
  walk(meta.id);
  return { metadata: meta.id, work: work?.id ?? null, items };
}

/** The prefix bound to `uri` in scope at `id`, or null. */
function prefixFor(doc: Doc, id: NodeId, uri: string): string | null {
  const seen = new Set<string>();
  for (let n: NodeId | null = id; n !== null; n = el(doc, n).parent) {
    for (const a of el(doc, n).attrs) {
      if (a.ns !== NS.xmlns || a.local === 'xmlns' || seen.has(a.local)) continue;
      seen.add(a.local); // the nearest declaration of a prefix wins
      if (decodeAttr(a.raw, doc.entities) === uri) return a.local;
    }
  }
  return null;
}

/** A prefix free at `id` for a new declaration: dc, else dc1, dc2, …. */
function freePrefix(doc: Doc, id: NodeId): string {
  const bound = new Set<string>();
  for (let n: NodeId | null = id; n !== null; n = el(doc, n).parent) for (const a of el(doc, n).attrs) if (a.ns === NS.xmlns) bound.add(a.local);
  if (!bound.has('dc')) return 'dc';
  for (let i = 1; ; i++) if (!bound.has(`dc${i}`)) return `dc${i}`;
}

const text = (t: string) => {
  const why = xmlCharError(t);
  if (why) throw new TokenEditError(why);
  return escape(t, null);
};

// Where a new <metadata> goes: after the root's leading <title> and <desc>, before the drawing.
function metadataPlace(doc: Doc): Where {
  let after: NodeId | null = null;
  for (const k of kids(doc, doc.root)) {
    if (k.ns === NS.svg && (k.local === 'title' || k.local === 'desc')) after = k.id;
    else return after !== null ? { after } : { before: k.id };
  }
  return after !== null ? { after } : { last: doc.root };
}

/** Metadata on (adding a creator and a date where missing) or off (the module header). */
export function planMetadata(doc: Doc, on: boolean, values: { creator: string; date: string }, apply: Apply): void {
  const m = metaOf(doc);
  if (!on) {
    for (let i = m.items.length - 1; i >= 0; i--) removeWithSpace(doc, m.items[i].id, apply);
    const meta = m.metadata === null ? null : el(doc, m.metadata);
    if (meta && !kids(doc, meta.id).length && meta.attrs.every((a) => a.ns === NS.xmlns || (a.ns === DRAW_NS && a.local === 'made'))) removeWithSpace(doc, meta.id, apply);
    return;
  }
  const has = (local: string) => m.items.some((i) => i.key === `dc:${local}`);
  const wanted = [['creator', values.creator], ['date', values.date]].filter(([local]) => !has(local));
  if (!wanted.length) return;
  if (m.metadata === null) {
    const tag = el(doc, doc.root).prefix ? `${el(doc, doc.root).prefix}:metadata` : 'metadata';
    const p = prefixFor(doc, doc.root, DC);
    const decl = p === null ? ` xmlns:${freePrefix(doc, doc.root)}="${DC}"` : '';
    const dc = p ?? freePrefix(doc, doc.root);
    const where = metadataPlace(doc);
    const at = insertion(doc, where);
    // The line break and indent the <metadata> gets, from the whitespace the insertion rule puts before it.
    const ws = /(\r\n|\r|\n)([ \t]*)$/.exec(at.lead || at.trail);
    const inner = ws ? `${ws[1]}${ws[2]}${ws[2]}` : '';
    const items = wanted.map(([l, v]) => `${inner}<${dc}:${l}>${text(v)}</${dc}:${l}>`).join('');
    insertMarkup(doc, where, `<${tag}${decl}>${items}${ws ? `${ws[1]}${ws[2]}` : ''}</${tag}>`, apply);
    return;
  }
  const into = m.work ?? m.metadata;
  let dc = prefixFor(doc, into, DC);
  if (dc === null) {
    dc = freePrefix(doc, m.metadata);
    apply(opSetAttr(doc, m.metadata, NS.xmlns, dc, DC, `xmlns:${dc}`));
  }
  insertMarkups(doc, { last: into }, wanted.map(([l, v]) => `<${dc}:${l}>${text(v)}</${dc}:${l}>`), apply);
}

/** An item's text, written where it lives (its element, or its creator's agent's dc:title). */
export function planMetaText(doc: Doc, item: MetaItem, value: string, apply: Apply): void {
  setText(doc, item.at, value, apply);
}

/** Does the file's metadata hold any item the tab shows? (The Metadata switch.) */
export const metadataOn = (doc: Doc): boolean => metaOf(doc).items.length > 0;
