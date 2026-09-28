// What the support ledger says about one element or attribute of an opened file: its class, and
// whether a row names it exactly or only a fallback row caught it (unclassified). The import
// report and the Support tab read this; the render decision is render-policy.ts's.

import { NS } from '../model/doc.ts';
import { ATTRIBUTE_CLASS, ELEMENT_CLASS, NAMESPACE_CLASS, type LedgerClass } from './tables.ts';

export interface Classified {
  cls: LedgerClass;
  exact: boolean; // false: only a fallback row ('svg:*', '(other)', another namespace) matched
}

const MATHML = 'http://www.w3.org/1998/Math/MathML';
const nsKey = (ns: string | null): string | null => (ns === NS.svg ? 'svg' : ns === NS.xhtml ? 'xhtml' : ns === MATHML ? 'mathml' : null);

function namespaced(uri: string | null): Classified {
  const known = uri !== null ? NAMESPACE_CLASS.get(uri) : undefined;
  return { cls: known ?? NAMESPACE_CLASS.get('*') ?? 'preserve-hidden', exact: known !== undefined };
}

export function classifyElement(ns: string | null, local: string): Classified {
  const key = nsKey(ns);
  if (key === null) return ns === null ? { cls: ELEMENT_CLASS.get('*:*') ?? 'preserve-hidden', exact: false } : namespaced(ns);
  const exact = ELEMENT_CLASS.get(`${key}:${local}`);
  if (exact) return { cls: exact, exact: true };
  return { cls: ELEMENT_CLASS.get(`${key}:*`) ?? 'preserve-hidden', exact: false };
}

/** Null for namespace declarations (xmlns, xmlns:*), which are syntax, not attributes. */
export function classifyAttribute(elNs: string | null, elLocal: string, attrNs: string | null, attrLocal: string): Classified | null {
  if (attrNs === NS.xmlns) return null;
  if (/^on/i.test(attrLocal)) return { cls: ATTRIBUTE_CLASS.get('svg:on*') ?? 'active', exact: true };
  const scope = elNs === NS.xhtml ? 'xhtml' : 'svg';
  let name: string;
  if (attrNs === null) name = attrLocal;
  else if (attrNs === NS.xlink) name = `xlink:${attrLocal}`;
  else if (attrNs === NS.xml) name = `xml:${attrLocal}`;
  else return namespaced(attrNs);
  const exact = ATTRIBUTE_CLASS.get(`${scope}:${name}@${elLocal}`) ?? ATTRIBUTE_CLASS.get(`${scope}:${name}`);
  if (exact) return { cls: exact, exact: true };
  for (const p of ['data-*', 'aria-*']) {
    if (name.startsWith(p.slice(0, -1))) {
      const c = ATTRIBUTE_CLASS.get(`${scope}:${p}`);
      if (c) return { cls: c, exact: true };
    }
  }
  return { cls: ATTRIBUTE_CLASS.get(`${scope}:(other)`) ?? 'preserve-hidden', exact: false };
}
