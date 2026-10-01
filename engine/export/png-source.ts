// The file a PNG is drawn from (P1-M5), pure: Clean's file with its text as paths (Draw's Export,
// projects/draw/src/export/png.ts makes it), then, in one parse and one serialize:
// - every <foreignObject> leaves (WebKit won't let a page read back a canvas that drew an SVG image
//   holding one: its SVGImage.cpp renderingTaintsOrigin), and a note says so;
// - the root's width and height become the PNG's size in pixels, plain numbers;
// - a root with no usable viewBox gets one of its old size in user units, `0 0 <width> <height>`, so
//   its drawing still scales to the new size; preserveAspectRatio stays as written.
// Nothing else changes.

import { NS, attrValue, descendants, detachNode, el, parseDoc, serialize, setAttr, type Doc, type NodeId } from '../model/doc.ts';
import { parseLength, toUserUnits } from '../values/length.ts';
import { parseViewBox } from '../values/viewbox.ts';
import { fmt } from '../values/number-format.ts';

export const NO_FOREIGN_OBJECT = 'A foreignObject (HTML inside the drawing) isn’t in the PNG: Safari won’t make a PNG of a drawing that holds one.';

export interface PngCopy {
  text: string;
  /** What the copy left out, said once. */
  notes: string[];
}

// The outermost <foreignObject>s (one inside another goes with it).
function foreignObjects(doc: Doc): NodeId[] {
  const out: NodeId[] = [];
  const walk = (id: NodeId): void => {
    for (const c of el(doc, id).children) {
      const n = doc.nodes.get(c)!;
      if (n.kind !== 'element') continue;
      if (n.ns === NS.svg && n.local === 'foreignObject') out.push(c);
      else walk(c);
    }
  };
  walk(doc.root);
  return out;
}

// The root's width or height in user units, or null (missing, a percentage, em or ex).
function side(doc: Doc, name: 'width' | 'height'): number | null {
  const len = parseLength(attrValue(doc, el(doc, doc.root), null, name) ?? '');
  const v = len && toUserUnits(len);
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

/** The copy of `text` a PNG of w × h pixels is drawn from (the module header), or why it can't be read. */
export function pngCopy(text: string, w: number, h: number): PngCopy | { refused: string } {
  const parsed = parseDoc(text);
  if (!parsed.ok) return { refused: parsed.error.message };
  const doc = parsed.doc;
  const notes: string[] = [];
  const fos = foreignObjects(doc);
  for (const id of fos) detachNode(doc, id);
  if (fos.length) notes.push(NO_FOREIGN_OBJECT);
  const root = el(doc, doc.root);
  const raw = attrValue(doc, root, null, 'viewBox');
  if (raw === null || parseViewBox(raw) === null) {
    const ow = side(doc, 'width');
    const oh = side(doc, 'height');
    if (ow !== null && oh !== null) setAttr(doc, doc.root, null, 'viewBox', `0 0 ${fmt(ow)} ${fmt(oh)}`);
  }
  setAttr(doc, doc.root, null, 'width', String(w));
  setAttr(doc, doc.root, null, 'height', String(h));
  return { text: serialize(doc), notes };
}

/** How many <text> elements a file holds (a PNG draws a text left as text in a fallback font). */
export function textCount(text: string): number {
  const parsed = parseDoc(text);
  if (!parsed.ok) return 0;
  const doc = parsed.doc;
  return [...descendants(doc, doc.root)].filter((n) => n.kind === 'element' && n.ns === NS.svg && n.local === 'text').length;
}
