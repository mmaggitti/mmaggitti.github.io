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
// - A second table, GROUP_GENERATORS (P1-M3's donut, donut.ts), holds generators whose parts are a
//   holder's children and whose data lives in the holder's first child, a comment; the same hook
//   keeps, regenerates or detaches them by the same rules.

import { NS, attrValue, el, findAttr, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { DRAW_NS } from '../model/draw-ns.ts';
import { dropDrawAttrs, setDrawAttr, undeclareIfUnused } from '../model/draw-state.ts';
import { fmt } from '../values/number-format.ts';
import { opSetAttr, type Op } from '../commands/ops.ts';
import { polygonPoints, starPoints } from './radial.ts';
import { spiralPath } from './spiral.ts';
import { DONUT_INPUTS, donutInputs, donutParts, donutSlices, isDonutHolder, type DonutCandidate } from './donut.ts';

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

/**
 * A generator whose parts are a holder's children (P1-M3's donut): its inputs are draw: attributes on
 * the holder, its data the holder's first child (a comment), and it writes each part's d.
 */
export interface GroupGenerator {
  kind: 'donut';
  label: string;
  /** The holder's draw: inputs, in order. */
  inputs: readonly string[];
  /** Can this element hold one? */
  holds: (doc: Doc, n: ElementNode) => boolean;
  /**
   * The holder's data leaf and parts as they are, and what each part's d should be (null when an input
   * or the data doesn't read, or the part count differs); null when its children aren't a group's.
   */
  read: (doc: Doc, n: ElementNode) => { data: NodeId; parts: NodeId[]; expected: string[] | null } | null;
}

export const GROUP_GENERATORS: readonly GroupGenerator[] = [
  {
    kind: 'donut', label: 'Donut', inputs: DONUT_INPUTS, holds: isDonutHolder,
    read: (doc, n) => {
      const parts = donutParts(doc, n);
      if (!parts) return null;
      const inputs = donutInputs(doc, n);
      const expected = inputs && parts.slices.length === parts.data.values.length ? donutSlices(parts.data.values, inputs.cx, inputs.cy, inputs.r) : null;
      return { data: parts.comment, parts: parts.slices, expected };
    },
  },
];

/** The group generator an element's draw:gen names, when the element can hold it, or null. */
export function groupGeneratorFor(doc: Doc, n: ElementNode): GroupGenerator | null {
  const kind = attrValue(doc, n, DRAW_NS, 'gen')?.trim();
  const g = GROUP_GENERATORS.find((x) => x.kind === kind);
  return g && g.holds(doc, n) ? g : null;
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
 * (a remove and then an insert: z-order, Group, Ungroup), even into a new <g>, is not a candidate,
 * and nor is its subtree. A candidate whose
 * draw:gen names its element's generator is looked at only if the ops touched its draw:gen or an
 * input, or its geometry, or it is new: a fill, a lock or a rename never looks at the generator,
 * so a stale shape from another tool is left exactly as it is. Then:
 * - its geometry is what its inputs generate: kept;
 * - else its inputs changed (all valid) and its geometry didn't: regenerated;
 * - else: detached (draw:gen and its inputs removed, and the root's xmlns:draw when that was the
 *   last of Draw's items).
 * A group generator's holder (the donut) is looked at when the ops touched its draw:gen or an input,
 * its data comment (a text op), or a part's d, or it is new (the rule above: never one that only
 * moved); then its parts are kept when they are what its inputs and data generate, regenerated (an
 * opSetAttr of d on each part that differs) when its inputs or data changed and no part's d did, and
 * else it is detached (its comment left a plain comment). Moving, duplicating, recolouring, Lock, Hide
 * and Rename touch none of those, so they leave it a donut.
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
  // Each element a place op newly put in the document, and its subtree; not a node whose first place
  // op here took it out (it only moved: z-order, Group, Ungroup), nor its subtree, even under a new <g>.
  const inserted = new Set<NodeId>();
  const add = (id: NodeId): void => {
    const n = doc.nodes.get(id);
    if (n?.kind !== 'element' || inserted.has(id)) return;
    inserted.add(id);
    for (const c of n.children) if (fresh.get(c) !== false) add(c);
  };
  for (const [id, isNew] of fresh) if (isNew && attached(doc, id)) add(id);
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
  // Group generators: what each holder's ops touched (its draw: attributes, its comments' text, its
  // children's d).
  const groups = new Map<NodeId, { draw: Set<string>; data: Set<NodeId>; parts: Set<NodeId> }>();
  const group = (id: NodeId) => {
    let t = groups.get(id);
    if (!t) groups.set(id, (t = { draw: new Set(), data: new Set(), parts: new Set() }));
    return t;
  };
  for (const op of ops) {
    if (op.kind === 'text') {
      const leaf = doc.nodes.get(op.id);
      if (leaf?.kind === 'comment' && leaf.parent !== null) group(leaf.parent).data.add(op.id);
    } else if (op.kind === 'attr') {
      if (op.ns === DRAW_NS) group(op.id).draw.add(op.local);
      else if (op.ns === null && op.local === 'd') {
        const p = doc.nodes.get(op.id)?.parent;
        if (p != null) group(p).parts.add(op.id);
      }
    }
  }
  for (const id of new Set([...groups.keys(), ...inserted])) {
    const n = doc.nodes.get(id);
    if (!n || n.kind !== 'element' || !attached(doc, id)) continue;
    const g = groupGeneratorFor(doc, n);
    if (!g) continue;
    const t = groups.get(id);
    const st = g.read(doc, n);
    const inputsTouched = !!t && (t.draw.has('gen') || g.inputs.some((i) => t.draw.has(i)));
    const dataTouched = !!t && (st ? t.data.has(st.data) : t.data.size > 0);
    const partsTouched = !!t && !!st && st.parts.some((p) => t.parts.has(p));
    if (!inputsTouched && !dataTouched && !partsTouched && !inserted.has(id)) continue;
    const expected = st?.expected ?? null;
    const now = st ? st.parts.map((p) => attrValue(doc, el(doc, p), null, 'd')) : [];
    if (expected && expected.every((d, i) => now[i] === d)) continue;
    if (st && expected && (inputsTouched || dataTouched) && !partsTouched) {
      st.parts.forEach((p, i) => {
        if (now[i] !== expected[i]) apply(opSetAttr(doc, p, null, 'd', expected[i]));
      });
      continue;
    }
    dropDrawAttrs(doc, id, ['gen', ...g.inputs], apply, false);
    detached.push(id);
  }
  if (detached.length) undeclareIfUnused(doc, apply);
  return detached;
}

/** Detach on purpose (Inspect's Detach): the generator's attributes removed, the shape (or a donut's slices) keeps its geometry. */
export function detachGenerator(doc: Doc, id: NodeId, apply: (op: Op) => void): boolean {
  const n = doc.nodes.get(id);
  if (!n || n.kind !== 'element' || !findAttr(n, DRAW_NS, 'gen')) return false;
  const g = generatorFor(doc, n);
  const group = g ? null : groupGeneratorFor(doc, n);
  if (!g && !group) return false;
  dropDrawAttrs(doc, id, ['gen', ...(g ? g.inputs.map((i) => i.name) : group!.inputs)], apply);
  return true;
}

/**
 * Edit as donut (P1-M3): draw:gen="donut" and the candidate's centre and radius (fmt(·, 2)) written on
 * its holder, Draw's namespace declared first. Nothing else changes: the finish hook then keeps every
 * slice, byte for byte.
 */
export function adoptDonut(doc: Doc, c: DonutCandidate, apply: (op: Op) => void): void {
  setDrawAttr(doc, c.holder, 'gen', 'donut', apply);
  setDrawAttr(doc, c.holder, 'cx', fmt(c.cx, 2), apply);
  setDrawAttr(doc, c.holder, 'cy', fmt(c.cy, 2), apply);
  setDrawAttr(doc, c.holder, 'r', fmt(c.r, 2), apply);
}
