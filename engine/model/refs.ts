// Ids and the references that point at them.
//
// SVG documents are webs of references: fill="url(#grad)", <use href="#star">, clip-path,
// markers, SMIL begin="spin.end", aria-labelledby="t1 t2". Renaming an id, pasting a fragment
// whose ids collide, deleting a def, or deciding whether a <use> points inside the document all
// need to know who points at what. XML ids are data (Draw's own identity is the NodeId).

import { decodeAttr } from '../xml/entities.ts';
import { decodeFragment } from '../values/url.ts';
import { NS, type Doc, type ElementNode, type NodeId } from './doc.ts';

export type RefKind = 'url' | 'href' | 'aria' | 'smil';

/** The ARIA attributes whose value is an id, or a list of ids (IDREF and IDREFS in WAI-ARIA 1.2). */
export const ARIA_IDREFS: ReadonlySet<string> = new Set([
  'aria-activedescendant', 'aria-controls', 'aria-describedby', 'aria-details', 'aria-errormessage', 'aria-flowto', 'aria-labelledby', 'aria-owns',
]);

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

// url(#id), url('#id') and url("#id with spaces"); the id is percent-decoded as browsers match it.
const URL_REF = /url\(\s*(?:(['"])#([^'"]+)\1|#([^'")\s]+))\s*\)/g;
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
    const value = decodeAttr(a.raw, doc.entities);
    if (a.local === 'id' && (a.ns === null || a.ns === NS.xml)) {
      const list = ids.get(value);
      if (list) list.push(n.id);
      else ids.set(value, [n.id]);
      continue;
    }
    if (a.local === 'href' && (a.ns === null || a.ns === NS.xlink)) {
      const v = value.trim();
      if (v.startsWith('#') && v.length > 1) add({ from: n.id, attr: a.qname, kind: 'href', id: decodeFragment(v.slice(1)) });
      continue;
    }
    if (a.ns === null && ARIA_IDREFS.has(a.local)) {
      for (const id of value.split(/\s+/).filter(Boolean)) add({ from: n.id, attr: a.qname, kind: 'aria', id });
      continue;
    }
    if (a.ns === null && (a.local === 'begin' || a.local === 'end')) {
      for (const m of value.matchAll(SMIL_REF)) add({ from: n.id, attr: a.qname, kind: 'smil', id: m[1] });
      continue;
    }
    if (value.includes('url(')) for (const m of value.matchAll(URL_REF)) add({ from: n.id, attr: a.qname, kind: 'url', id: decodeFragment(m[2] ?? m[3]) });
  }
}

/** Ids that more than one element carries (the first one wins in browsers). */
export function duplicateIds(index: RefIndex): string[] {
  return [...index.ids].filter(([, list]) => list.length > 1).map(([id]) => id);
}
