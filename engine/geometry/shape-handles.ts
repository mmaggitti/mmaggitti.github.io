// Shape handles (SVG Lab's KITS): where each shape's own handles sit, in its own user units, and
// what a drag of one writes. They replace the resize corners on circles, ellipses, lines, plain
// polygons and polylines, and generated shapes (engine/generators/); the editor places them through
// the element's measured CTM, so they follow a rotated, skewed or mirrored shape along its own axes.
//
// | element            | handles                                                                   |
// |--------------------|---------------------------------------------------------------------------|
// | circle             | centre (cx, cy); radius at (cx + r, cy): r = the distance, on the step, ≥ 1 |
// | ellipse            | centre; rx at (cx + rx, cy), ry at (cx, cy + ry): |Δx| or |Δy|, on the step, ≥ 1 |
// | line               | each end: that end = the point                                             |
// | polygon, polyline  | a vertex each (at most 200 points): that pair = the point                  |
// | generated polygon, star | centre (draw:cx, draw:cy); radius at the first vertex or tip, (cx, cy − r): draw:r; a star's inner point: draw:inner = distance ÷ r (0.01, 0.05–0.95) |
// | generated spiral   | centre; radius at its end P(Θ): draw:r                                     |
//
// A length is a distance, never signed, so a mirror keeps its sign and no handle writes the
// transform. Each written length keeps its unit (r="2em" stays in em) and refuses what the move and
// resize planners refuse (write.ts: rem until converted, ex, CSS-set geometry, a % of a viewport
// Draw can't size, a transform it can't read or that flattens the shape), in their words. Numbers
// are rewritten in place (rewriteNumbers); every other byte stays.

import { attrValue, el, findAttr, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { DRAW_NS } from '../model/draw-ns.ts';
import { rewriteNumbers } from '../code/edit.ts';
import { fmt, parseNumberList } from '../values/number-format.ts';
import { generatorOf, type Generated } from '../generators/index.ts';
import { spiralEnd } from '../generators/spiral.ts';
import { lengthAttr, listMatrix, transformUnknown, type GeoContext } from './ctm.ts';
import { FLATTENS, lengthEdit, numberTokens, placesOf, rewrite, type AttrEdit, type Plan, type Point, type WriteOpts } from './write.ts';

export interface ShapeHandle {
  id: string;
  kind: 'center' | 'anchor' | 'ctrl';
  at: Point; // the element's own user units
  role: 'position' | 'length';
  tip: string;
}

/** A plain polygon or polyline gets a handle per vertex up to this many points. */
export const MAX_VERTEX_HANDLES = 200;

/** The history entry a drag of each handle makes. */
export function shapeHandleLabel(handleId: string): string {
  if (handleId === 'p1' || handleId === 'p2') return 'Move end';
  if (/^v\d+$/.test(handleId)) return 'Move point';
  return `Set ${handleId}`;
}

const refuse = (why: string): Plan => ({ refused: why });
/** The attribute as written (its number and unit), for a tooltip. */
const written = (doc: Doc, n: ElementNode, local: string, ns: string | null = null): string => attrValue(doc, n, ns, local)?.trim() ?? '0';

/** Does this element take shape handles (and so no resize corners)? */
export function takesShapeHandles(doc: Doc, id: NodeId): boolean {
  const n = doc.nodes.get(id);
  if (!n || n.kind !== 'element' || n.ns !== 'http://www.w3.org/2000/svg') return false;
  return n.local === 'circle' || n.local === 'ellipse' || n.local === 'line' || n.local === 'polygon' || n.local === 'polyline' || generatorOf(doc, id) !== null;
}

/** A plain polygon's or polyline's vertices (x, y pairs), when they read as numbers, or null. */
function vertices(doc: Doc, n: ElementNode): number[] | null {
  const a = findAttr(n, null, 'points');
  if (!a) return null;
  const list = parseNumberList(attrValue(doc, n, null, 'points')!);
  if (!list || list.length % 2 || numberTokens(doc, n, 'points', a.raw).length !== list.length) return null;
  return list;
}

/** A star's inner point's angle (degrees) and a generated shape's handle positions. */
function generatedHandles(doc: Doc, n: ElementNode, g: Generated): ShapeHandle[] {
  const { cx, cy, r } = g.inputs;
  const tipOf = (local: string) => `${local} ${written(doc, n, local, DRAW_NS)}`;
  const out: ShapeHandle[] = [{ id: 'center', kind: 'center', at: { x: cx, y: cy }, role: 'position', tip: `x ${written(doc, n, 'cx', DRAW_NS)}, y ${written(doc, n, 'cy', DRAW_NS)}` }];
  if (g.kind === 'spiral') {
    out.unshift({ id: 'r', kind: 'anchor', at: spiralEnd(cx, cy, r, g.inputs.turns), role: 'length', tip: tipOf('r') });
    return out;
  }
  const handles: ShapeHandle[] = [{ id: 'r', kind: 'anchor', at: { x: cx, y: cy - r }, role: 'length', tip: tipOf('r') }];
  if (g.kind === 'star') {
    const a = ((-90 + 180 / g.inputs.tips) * Math.PI) / 180;
    const ri = r * g.inputs.inner;
    handles.push({ id: 'inner', kind: 'ctrl', at: { x: cx + ri * Math.cos(a), y: cy + ri * Math.sin(a) }, role: 'length', tip: tipOf('inner') });
  }
  return [...handles, ...out];
}

/**
 * The element's shape handles in drawing order (its own handles, then its centre), in its own user
 * units; null when the element doesn't take shape handles (it keeps the resize corners). A plain
 * polygon or polyline past MAX_VERTEX_HANDLES points, or whose points don't read, has none.
 */
export function shapeHandles(doc: Doc, id: NodeId, ctx: GeoContext): ShapeHandle[] | null {
  if (!takesShapeHandles(doc, id)) return null;
  const n = el(doc, id);
  const g = generatorOf(doc, id);
  if (g) return generatedHandles(doc, n, g);
  const len = (local: string, axis: 'x' | 'y' | 'other') => lengthAttr(doc, n, local, axis, ctx);
  switch (n.local) {
    case 'circle': {
      const [cx, cy, r] = [len('cx', 'x'), len('cy', 'y'), len('r', 'other')];
      if (cx === null || cy === null || r === null) return [];
      return [
        { id: 'r', kind: 'anchor', at: { x: cx + r, y: cy }, role: 'length', tip: `r ${written(doc, n, 'r')}` },
        { id: 'center', kind: 'center', at: { x: cx, y: cy }, role: 'position', tip: '' },
      ];
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = [len('cx', 'x'), len('cy', 'y'), len('rx', 'x'), len('ry', 'y')];
      if (cx === null || cy === null || rx === null || ry === null) return [];
      return [
        { id: 'rx', kind: 'anchor', at: { x: cx + rx, y: cy }, role: 'length', tip: `rx ${written(doc, n, 'rx')}` },
        { id: 'ry', kind: 'anchor', at: { x: cx, y: cy + ry }, role: 'length', tip: `ry ${written(doc, n, 'ry')}` },
        { id: 'center', kind: 'center', at: { x: cx, y: cy }, role: 'position', tip: '' },
      ];
    }
    case 'line': {
      const ends: ShapeHandle[] = [];
      for (const [hid, lx, ly] of [['p1', 'x1', 'y1'], ['p2', 'x2', 'y2']] as const) {
        const [x, y] = [len(lx, 'x'), len(ly, 'y')];
        if (x === null || y === null) return [];
        ends.push({ id: hid, kind: 'anchor', at: { x, y }, role: 'position', tip: `x ${written(doc, n, lx)}, y ${written(doc, n, ly)}` });
      }
      return ends;
    }
    default: {
      const v = vertices(doc, n);
      if (!v || v.length / 2 > MAX_VERTEX_HANDLES) return [];
      const a = findAttr(n, null, 'points')!;
      const t = numberTokens(doc, n, 'points', a.raw);
      const out: ShapeHandle[] = [];
      for (let i = 0; i < v.length; i += 2) out.push({ id: `v${i / 2}`, kind: 'anchor', at: { x: v[i], y: v[i + 1] }, role: 'position', tip: `x ${t[i].text}, y ${t[i + 1].text}` });
      return out;
    }
  }
}

/** A value on the step (in the units the step is in), written as the step writes it. */
const onStep = (v: number, step: number): number => Number(fmt(Math.round(v / step) * step, placesOf(step, 10)));

/** A generator input rewritten to `value` (its number's characters only; the whole value when written with a reference). */
function inputTo(doc: Doc, n: ElementNode, local: string, value: number, decimals: number): AttrEdit | null {
  const a = findAttr(n, DRAW_NS, local)!;
  const text = fmt(value, decimals);
  const m = /-?(?:\d*\.\d+|\d+)/.exec(a.raw);
  const raw = m && !a.raw.includes('&') ? rewriteNumbers(a.raw, [{ start: m.index, end: m.index + m[0].length, text }]) : text;
  return raw === a.raw ? null : { id: n.id, ns: DRAW_NS, local, raw, add: false };
}

/**
 * What dragging handle `handleId` to `to` (the element's own user units) writes: a length handle
 * rounds its length to `opts.step` (at least 1); a position handle writes the point as given (the
 * editor has snapped it). The centre handle is the editor's move, not planned here.
 */
export function planShapeHandle(doc: Doc, id: NodeId, handleId: string, to: Point, opts: WriteOpts & { step: number }): Plan {
  const n = el(doc, id);
  const why = transformUnknown(doc, id);
  if (why) return refuse(why);
  const t = listMatrix(doc, id)!;
  if (Math.abs(t[0] * t[3] - t[1] * t[2]) < 1e-12) return refuse(FLATTENS);
  const handles = shapeHandles(doc, id, opts.ctx);
  const centre = handles?.find((h) => h.id === 'center')?.at;
  if (!handles || !handles.some((h) => h.id === handleId) || handleId === 'center') return refuse('That handle doesn’t change this shape.');
  const edits: AttrEdit[] = [];
  const one = (e: AttrEdit | { refused: string } | null): Plan => {
    if (e && 'refused' in e) return refuse(e.refused);
    if (e) edits.push(e);
    return { edits };
  };
  const length = (d: number) => Math.max(1, onStep(d, opts.step));
  const g = generatorOf(doc, id);
  if (g) {
    const d = Math.hypot(to.x - g.inputs.cx, to.y - g.inputs.cy);
    if (handleId === 'r') return one(inputTo(doc, n, 'r', length(d), 2));
    const inner = Math.min(0.95, Math.max(0.05, Math.round((d / g.inputs.r) * 100) / 100));
    return one(inputTo(doc, n, 'inner', inner, 2));
  }
  switch (handleId) {
    case 'r':
      return one(lengthEdit(doc, n, 'r', 'other', { to: length(Math.hypot(to.x - centre!.x, to.y - centre!.y)) }, opts));
    case 'rx':
      return one(lengthEdit(doc, n, 'rx', 'x', { to: length(Math.abs(to.x - centre!.x)) }, opts));
    case 'ry':
      return one(lengthEdit(doc, n, 'ry', 'y', { to: length(Math.abs(to.y - centre!.y)) }, opts));
    case 'p1':
    case 'p2': {
      const [lx, ly] = handleId === 'p1' ? ['x1', 'y1'] : ['x2', 'y2'];
      const x = lengthEdit(doc, n, lx, 'x', { to: to.x }, opts);
      if (x && 'refused' in x) return refuse(x.refused);
      if (x) edits.push(x);
      return one(lengthEdit(doc, n, ly, 'y', { to: to.y }, opts));
    }
    default: {
      // A vertex: only its pair's numbers.
      const i = Number(handleId.slice(1));
      const a = findAttr(n, null, 'points')!;
      const tokens = numberTokens(doc, n, 'points', a.raw);
      const d = opts.decimals ?? 0;
      const pair = [tokens[2 * i], tokens[2 * i + 1]];
      const next = [to.x, to.y].map((v, k) => ({ start: pair[k].start, end: pair[k].end, text: fmt(v, Math.max(d, pair[k].decimals, placesOf(v))) })).filter((e, k) => e.text !== pair[k].text);
      return next.length ? one(rewrite(doc, n, 'points', a.raw, next)) : { edits };
    }
  }
}
