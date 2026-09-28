// Ids and the references that point at them.
//
// SVG documents are webs of references: fill="url(#grad)", <use href="#star">, clip-path,
// markers, SMIL begin="spin.end", aria-labelledby="t1 t2". Renaming an id, pasting a fragment
// whose ids collide, deleting a def, or deciding whether a <use> points inside the document all
// need to know who points at what. XML ids are data (Draw's own identity is the NodeId).

import { decode } from '../xml/entities.ts';
import { NS, type Doc, type ElementNode, type NodeId } from './doc.ts';

export type RefKind = 'url' | 'href' | 'aria' | 'smil';

export interface Ref {
  from: NodeId; // the element holding the reference
  attr: string; // qname of the attribute (or 'style' for url() inside a style declaration)
  kind: RefKind;
  id: string; // the id pointed at
}

export interface RefIndex {
  ids: Map<string, NodeId[]>; // id → elements carrying it (more than one = a duplicate)
  refs: Map<string, Ref[]>; // id → references to it
  dangling: Ref[]; // references to ids that don't exist in this document
}

const URL_REF = /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g;
// SMIL syncbase and event values: "spin.end+1s", "go.click", "a.begin; b.end".
const SMIL_REF = /(?:^|;)\s*([A-Za-z_][\w-]*)\.(?:begin|end|click|mouseover|mouseout|mousedown|mouseup|focusin|focusout|activate|repeat(?:\(\d+\))?)\b/g;

export function buildRefIndex(doc: Doc): RefIndex {
  const ids = new Map<string, NodeId[]>();
  const refs = new Map<string, Ref[]>();
  const add = (r: Ref) => {
    const list = refs.get(r.id);
    if (list) list.push(r);
    else refs.set(r.id, [r]);
  };
  const walk = (id: NodeId) => {
    const n = doc.nodes.get(id);
    if (!n || n.kind !== 'element') return;
    visit(doc, n, ids, add);
    for (const c of n.children) walk(c);
  };
  walk(doc.root);
  const dangling: Ref[] = [];
  for (const [id, list] of refs) if (!ids.has(id)) dangling.push(...list);
  return { ids, refs, dangling };
}

function visit(doc: Doc, n: ElementNode, ids: Map<string, NodeId[]>, add: (r: Ref) => void): void {
  for (const a of n.attrs) {
    if (a.ns === NS.xmlns) continue;
    const value = decode(a.raw, doc.entities, doc.budget);
    if (a.local === 'id' && (a.ns === null || a.ns === NS.xml)) {
      const list = ids.get(value);
      if (list) list.push(n.id);
      else ids.set(value, [n.id]);
      continue;
    }
    if (a.local === 'href' && (a.ns === null || a.ns === NS.xlink)) {
      const v = value.trim();
      if (v.startsWith('#') && v.length > 1) add({ from: n.id, attr: a.qname, kind: 'href', id: v.slice(1) });
      continue;
    }
    if (a.ns === null && (a.local === 'aria-labelledby' || a.local === 'aria-describedby')) {
      for (const id of value.split(/\s+/).filter(Boolean)) add({ from: n.id, attr: a.qname, kind: 'aria', id });
      continue;
    }
    if (a.ns === null && (a.local === 'begin' || a.local === 'end')) {
      for (const m of value.matchAll(SMIL_REF)) add({ from: n.id, attr: a.qname, kind: 'smil', id: m[1] });
      continue;
    }
    if (value.includes('url(')) for (const m of value.matchAll(URL_REF)) add({ from: n.id, attr: a.qname, kind: 'url', id: m[2] });
  }
}

/** Ids that more than one element carries (the first one wins in browsers). */
export function duplicateIds(index: RefIndex): string[] {
  return [...index.ids].filter(([, list]) => list.length > 1).map(([id]) => id);
}
