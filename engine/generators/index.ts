// Generated shapes: a regular polygon, a star and a spiral whose inputs live on the element as
// draw:* attributes (Draw's namespace, matched by URI), beside the geometry they generate.
//
//   <polygon points="…" draw:gen="star" draw:cx="50" draw:cy="53" draw:r="30" draw:inner="0.4" draw:tips="5"/>
//
// - A table of generators (element, the attribute it writes, its inputs in order, generate), so a
//   later one (P1-M3's donut) joins without a switch.
// - generatorOf says whether an element IS generated now: the generator's element in the SVG
//   namespace, draw:gen naming it, every input present and valid, and the geometry attribute,
//   decoded, exactly what the inputs generate. Anything else is a plain shape, and its draw:*
//   attributes are kept untouched as unknown editor data. Reading never changes the file.
// - finishGenerators is the Session's finish hook (commands/session.ts): the one place a generated
//   shape is regenerated (its inputs changed) or detached (its geometry was edited by hand, or its
//   inputs no longer read), in the same transaction as the edit, so no editing path can miss it.

import { NS, attrValue, descendants, findAttr, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { DRAW_NS } from '../model/draw-ns.ts';
import { dropDrawAttrs, undeclareIfUnused } from '../model/draw-state.ts';
import { opSetAttr, type Op } from '../commands/ops.ts';
import { polygonPoints, starPoints } from './radial.ts';
import { spiralPath } from './spiral.ts';

export type GeneratorKind = 'polygon' | 'star' | 'spiral';

export interface GeneratorInput {
  /** The draw: attribute's local name. */
  name: string;
  /** Is this value one the generator takes? */
  valid: (v: number) => boolean;
  /** Written as a whole number (sides, tips). */
  integer?: boolean;
}

export interface Generator {
  kind: GeneratorKind;
  label: string;
  element: 'polygon' | 'path';
  attr: 'points' | 'd';
  inputs: readonly GeneratorInput[];
  generate: (v: Readonly<Record<string, number>>) => string;
}

const finite = (v: number) => Number.isFinite(v);
const CX: GeneratorInput = { name: 'cx', valid: finite };
const CY: GeneratorInput = { name: 'cy', valid: finite };
const R: GeneratorInput = { name: 'r', valid: (v) => Number.isFinite(v) && v > 0 };
const count = (name: string): GeneratorInput => ({ name, integer: true, valid: (v) => Number.isInteger(v) && v >= 3 && v <= 24 });

export const GENERATORS: readonly Generator[] = [
  { kind: 'polygon', label: 'Polygon', element: 'polygon', attr: 'points', inputs: [CX, CY, R, count('sides')], generate: (v) => polygonPoints(v.cx, v.cy, v.r, v.sides) },
  {
    kind: 'star', label: 'Star', element: 'polygon', attr: 'points',
    inputs: [CX, CY, R, { name: 'inner', valid: (v) => v >= 0.05 && v <= 0.95 }, count('tips')],
    generate: (v) => starPoints(v.cx, v.cy, v.r, v.inner, v.tips),
  },
  {
    kind: 'spiral', label: 'Spiral', element: 'path', attr: 'd',
    inputs: [CX, CY, R, { name: 'turns', valid: (v) => v >= 0.25 && v <= 20 }],
    generate: (v) => spiralPath(v.cx, v.cy, v.r, v.turns),
  },
];

/** The generator a draw:gen value names, or null. */
export function generatorNamed(kind: string | null | undefined): Generator | null {
  return GENERATORS.find((g) => g.kind === kind) ?? null;
}

// A plain decimal, as Draw writes one: no unit, no exponent, no '+'.
const PLAIN = /^-?(?:\d+|\d*\.\d+)$/;

/** An input's value from its draw: attribute (XML whitespace around it allowed), or null when absent or not one the generator takes. */
export function readInput(doc: Doc, n: ElementNode, input: GeneratorInput): number | null {
  const raw = attrValue(doc, n, DRAW_NS, input.name)?.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  if (raw === undefined || !PLAIN.test(raw)) return null;
  const v = Number(raw);
  return input.valid(v) ? v : null;
}

/** Every input, or null when one is missing or invalid. */
export function readInputs(doc: Doc, n: ElementNode, g: Generator): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const input of g.inputs) {
    const v = readInput(doc, n, input);
    if (v === null) return null;
    out[input.name] = v;
  }
  return out;
}

/** The generator the element's draw:gen names, when the element is that generator's element (SVG), or null. */
export function generatorFor(doc: Doc, n: ElementNode): Generator | null {
  if (n.ns !== NS.svg) return null;
  const g = generatorNamed(attrValue(doc, n, DRAW_NS, 'gen')?.trim());
  return g && g.element === n.local ? g : null;
}

export interface Generated {
  kind: GeneratorKind;
  generator: Generator;
  inputs: Record<string, number>;
  attr: 'points' | 'd';
}

/** The element's generator and inputs when it is generated now (see the header), else null: a plain shape. */
export function generatorOf(doc: Doc, id: NodeId): Generated | null {
  const n = doc.nodes.get(id);
  if (!n || n.kind !== 'element') return null;
  const g = generatorFor(doc, n);
  const inputs = g && readInputs(doc, n, g);
  if (!g || !inputs) return null;
  return attrValue(doc, n, null, g.attr) === g.generate(inputs) ? { kind: g.kind, generator: g, inputs, attr: g.attr } : null;
}

const attached = (doc: Doc, id: NodeId): boolean => {
  let n = doc.nodes.get(id);
  while (n && n.parent !== null) n = doc.nodes.get(n.parent);
  return !!n && n.id === doc.root;
};

/**
 * The Session's finish hook: after a transaction's (or a drag frame's) own ops, regenerate or detach
 * the generated shapes they touched; returns the ids it detached.
 *
 * Candidates are the elements an attribute op touched, and every element a place op newly put in
 * the document (its subtree too: the Shapes tool, Edit source, Duplicate). A node that only moved
 * (a remove and then an insert: z-order, Group, Ungroup) is not a candidate. A candidate whose
 * draw:gen names its element's generator is looked at only if the ops touched its draw:gen or an
 * input, or its geometry, or it is new: a fill, a lock or a rename never looks at the generator,
 * so a stale shape from another tool is left exactly as it is. Then:
 * - its geometry is what its inputs generate: kept;
 * - else its inputs changed (all valid) and its geometry didn't: regenerated;
 * - else: detached (draw:gen and its inputs removed, and the root's xmlns:draw when that was the
 *   last of Draw's items).
 */
export function finishGenerators(doc: Doc, ops: readonly Op[], apply: (op: Op) => void): NodeId[] {
  const touched = new Map<NodeId, { draw: Set<string>; plain: Set<string> }>();
  const fresh = new Map<NodeId, boolean>(); // each node's first place op: did it put a new node in?
  for (const op of ops) {
    if (op.kind === 'attr') {
      let t = touched.get(op.id);
      if (!t) touched.set(op.id, (t = { draw: new Set(), plain: new Set() }));
      if (op.ns === DRAW_NS) t.draw.add(op.local);
      else if (op.ns === null) t.plain.add(op.local);
    } else if (op.kind === 'place' && !fresh.has(op.id)) fresh.set(op.id, op.before === null && op.after !== null);
  }
  const inserted = new Set<NodeId>();
  for (const [id, isNew] of fresh) if (isNew && attached(doc, id)) for (const d of descendants(doc, id)) if (d.kind === 'element') inserted.add(d.id);
  const detached: NodeId[] = [];
  for (const id of new Set([...touched.keys(), ...inserted])) {
    const n = doc.nodes.get(id);
    if (!n || n.kind !== 'element' || !attached(doc, id)) continue;
    const g = generatorFor(doc, n);
    if (!g) continue;
    const t = touched.get(id);
    const inputsTouched = !!t && (t.draw.has('gen') || g.inputs.some((i) => t.draw.has(i.name)));
    const geometryTouched = !!t && t.plain.has(g.attr);
    if (!inputsTouched && !geometryTouched && !inserted.has(id)) continue;
    const inputs = readInputs(doc, n, g);
    const expected = inputs && g.generate(inputs);
    if (expected !== null && attrValue(doc, n, null, g.attr) === expected) continue;
    if (expected !== null && inputsTouched && !geometryTouched) {
      apply(opSetAttr(doc, id, null, g.attr, expected));
      continue;
    }
    dropDrawAttrs(doc, id, ['gen', ...g.inputs.map((i) => i.name)], apply, false);
    detached.push(id);
  }
  if (detached.length) undeclareIfUnused(doc, apply);
  return detached;
}

/** Detach on purpose (Inspect's Detach): the generator's attributes removed, the shape keeps its geometry. */
export function detachGenerator(doc: Doc, id: NodeId, apply: (op: Op) => void): boolean {
  const n = doc.nodes.get(id);
  const g = n?.kind === 'element' ? generatorFor(doc, n) : null;
  if (!n || n.kind !== 'element' || !g || !findAttr(n, DRAW_NS, 'gen')) return false;
  dropDrawAttrs(doc, id, ['gen', ...g.inputs.map((i) => i.name)], apply);
  return true;
}
