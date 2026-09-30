// Clean export: the file without the editor data other tools left in it (Inkscape, Sodipodi,
// Illustrator, Sketch, Affinity), which no browser reads. Everything else stays byte for byte:
// the same model edits the rest of Draw uses, on a copy, so untouched markup is copied from the
// source and never re-printed.
//
// Removed: elements in an editor namespace (with their subtrees), attributes in one, and the
// xmlns declarations that bound those namespaces. Kept: all SVG, XHTML inside foreignObject,
// MathML, descriptive metadata (rdf, dc, cc), comments, the XML declaration and DOCTYPE.
//
// stripNamespaces is the same for any set of namespaces; cleanExport strips every editor's, Draw's
// own included, and stripDrawState (model/draw-state.ts) Draw's alone. What Draw inserted goes with
// the whitespace it brought: a draw: element takes the whitespace just before it, and an element Draw
// made (draw-ns.ts: a <metadata draw:made="true">) goes too when nothing of the file's is left in it.

import { descendants, detachNode, parseDoc, restoreAttr, serialize, type Doc, type ElementNode } from '../model/doc.ts';
import { DRAW_NS, holdsOnlyDrawItems, isDrawMade } from '../model/draw-ns.ts';
import { decodeAttr } from '../xml/entities.ts';

/** Editor namespaces: the ledger's namespace rows marked "Editor data" (checked by a test). */
export const EDITOR_NAMESPACES: ReadonlySet<string> = new Set([
  'http://www.inkscape.org/namespaces/inkscape',
  'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd',
  'http://ns.adobe.com/AdobeIllustrator/10.0/',
  'http://ns.adobe.com/Extensibility/1.0/',
  'http://ns.adobe.com/Graphs/1.0/',
  'http://ns.adobe.com/SaveForWeb/1.0/',
  'http://www.bohemiancoding.com/sketch/ns',
  'http://www.serif.com/',
  DRAW_NS,
]);

const XMLNS = 'http://www.w3.org/2000/xmlns/';

export interface CleanResult {
  text: string;
  removedElements: number;
  removedAttributes: number;
}

/** The clean export of a document (the document itself is not changed). */
export function cleanExport(doc: Doc): CleanResult {
  return stripNamespaces(doc, EDITOR_NAMESPACES);
}

/** The document without these namespaces' elements, attributes and declarations (it is not changed). */
export function stripNamespaces(doc: Doc, uris: ReadonlySet<string>): CleanResult {
  const parsed = parseDoc(serialize(doc));
  if (!parsed.ok) throw new Error(`cleanExport: the document no longer parses (${parsed.error.message})`);
  const copy = parsed.doc;
  let removedElements = 0;
  let removedAttributes = 0;
  const editorEls: ElementNode[] = [];
  // What Draw made, found before its draw:made attribute goes.
  const made = uris.has(DRAW_NS) ? [...descendants(copy, copy.root)].filter((n): n is ElementNode => n.kind === 'element' && isDrawMade(n)) : [];
  for (const n of descendants(copy, copy.root)) {
    if (n.kind !== 'element') continue;
    if (n.ns !== null && uris.has(n.ns) && n.id !== copy.root) {
      editorEls.push(n);
      continue;
    }
    for (const a of [...n.attrs]) {
      if (a.ns !== null && uris.has(a.ns)) {
        restoreAttr(copy, n.id, a.ns, a.local, null);
        removedAttributes++;
      }
    }
  }
  const drop = (e: ElementNode) => {
    // What Draw inserted brought the whitespace before it: it goes too.
    if (e.ns === DRAW_NS || made.includes(e)) {
      const kids = (copy.nodes.get(e.parent!) as ElementNode).children;
      const ws = copy.nodes.get(kids[kids.indexOf(e.id) - 1]);
      if (ws?.kind === 'text' && /^[ \t\r\n]+$/.test(ws.raw)) detachNode(copy, ws.id);
    }
    detachNode(copy, e.id);
    removedElements++;
  };
  for (const e of editorEls) if (isAttached(copy, e)) drop(e);
  for (const m of made) {
    if (isAttached(copy, m) && holdsOnlyDrawItems(copy, m)) drop(m);
  }
  // Declarations of editor namespaces nothing uses any more.
  const used = usedNamespaces(copy);
  for (const n of descendants(copy, copy.root)) {
    if (n.kind !== 'element') continue;
    for (const a of [...n.attrs]) {
      if (a.ns !== XMLNS || a.local === 'xmlns') continue;
      const uri = decodeAttr(a.raw, copy.entities);
      if (uris.has(uri) && !used.has(uri)) {
        restoreAttr(copy, n.id, a.ns, a.local, null);
        removedAttributes++;
      }
    }
  }
  return { text: serialize(copy), removedElements, removedAttributes };
}

function isAttached(doc: Doc, e: ElementNode): boolean {
  for (let n: ElementNode | undefined = e; n; n = n.parent === null ? undefined : (doc.nodes.get(n.parent) as ElementNode)) {
    if (n.id === doc.root) return true;
    if (n.parent === null) return false;
  }
  return false;
}

function usedNamespaces(doc: Doc): Set<string> {
  const used = new Set<string>();
  for (const n of descendants(doc, doc.root)) {
    if (n.kind !== 'element') continue;
    if (n.ns) used.add(n.ns);
    for (const a of n.attrs) if (a.ns && a.ns !== XMLNS) used.add(a.ns);
  }
  return used;
}
