// What a tap on the canvas selects. The canvas hit test gives the drawn node under the finger; this
// climbs the model to the nearest element that draws on its own: an SVG graphics element, never
// the root <svg>, and never anything inside a container that only draws when referenced (defs,
// symbol, clipPath, mask, pattern, marker, gradients, filters). Text selects its element, and
// XHTML inside a foreignObject selects the foreignObject. A text run (a tspan or a textPath: a line
// Draw writes is one) selects its <text>; once that text, or a run of it, is selected, a tap selects
// the run under the finger (the way a group is entered). Pure, so it is unit-tested in node.

import { NS, type Doc, type NodeId } from '../../../engine/model/doc.ts';

// SVG 2's graphics elements (the ones with a box on the canvas), plus the containers that group them.
const GRAPHICS = new Set([
  'a', 'circle', 'ellipse', 'foreignObject', 'g', 'image', 'line', 'path', 'polygon', 'polyline', 'rect', 'svg', 'switch', 'text',
  'textPath', 'tspan', 'use',
]);
// Content inside these is drawn only where something references it.
const REFERENCED_ONLY = new Set([
  'defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker', 'linearGradient', 'radialGradient', 'filter', 'font', 'glyph', 'missing-glyph',
]);

const parentOf = (doc: Doc, id: NodeId): NodeId | null => doc.nodes.get(id)?.parent ?? null;

/** Is this element inside a referenced-only container (or one itself)? */
function referencedOnly(doc: Doc, id: NodeId): boolean {
  for (let p: NodeId | null = id; p !== null; p = parentOf(doc, p)) {
    const n = doc.nodes.get(p);
    if (n?.kind === 'element' && n.ns === NS.svg && REFERENCED_ONLY.has(n.local)) return true;
  }
  return false;
}

/** Can this element be outlined on the canvas (a graphics element that draws where it is)? */
export function outlineable(doc: Doc, id: NodeId): boolean {
  const n = doc.nodes.get(id);
  return n?.kind === 'element' && n.ns === NS.svg && GRAPHICS.has(n.local) && !referencedOnly(doc, id);
}

/** The <text> a text run (a tspan or a textPath) belongs to; any other element is its own. */
export function textOf(doc: Doc, id: NodeId): NodeId {
  const n = doc.nodes.get(id);
  if (n?.kind !== 'element' || n.ns !== NS.svg || (n.local !== 'tspan' && n.local !== 'textPath')) return id;
  for (let p = n.parent; p !== null; p = parentOf(doc, p)) {
    const q = doc.nodes.get(p);
    if (q?.kind === 'element' && q.ns === NS.svg && q.local === 'text') return p;
  }
  return id;
}

const NONE: ReadonlySet<NodeId> = new Set();

/**
 * The element a canvas tap on `hit` selects, or null (the root, empty canvas, defs content): a text
 * run's <text>, or the run itself while that text or a run of it is in `selected`.
 */
export function selectionTarget(doc: Doc, hit: NodeId | null, selected: ReadonlySet<NodeId> = NONE): NodeId | null {
  if (hit === null || !doc.nodes.has(hit) || referencedOnly(doc, hit)) return null;
  for (let p: NodeId | null = hit; p !== null && p !== doc.root; p = parentOf(doc, p)) {
    if (!outlineable(doc, p)) continue;
    const text = textOf(doc, p);
    return text === p || [...selected].some((s) => textOf(doc, s) === text) ? p : text;
  }
  return null;
}

/** The element a code block stands for: an element's own block, or a leaf's parent element. */
export function elementOf(doc: Doc, id: NodeId): NodeId | null {
  const n = doc.nodes.get(id);
  if (!n) return null;
  return n.kind === 'element' ? id : n.parent;
}
