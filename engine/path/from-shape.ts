// A shape's outline as absolute path data (P1-M3 S3): what booleans take in, in the element's own
// user units (toAbsolute's form), as SVG draws it. Pure and DOM-free.
//
// - rect: x, y, width and height, with rx and ry as SVG 2 resolves them (a missing, auto or negative
//   one takes the other; each then clamped to half its side), each rounded corner a quarter arc:
//   SVG 2's own path for it, clockwise from (x + rx, y);
// - circle and ellipse: four quarter arcs, clockwise from (cx + rx, cy) (an ellipse's missing, auto
//   or negative radius takes the other);
// - polygon: its points, closed; polyline: its points, open (a fill closes it, a stroke doesn't);
// - line: its two ends, open;
// - path: its d, which must parse to its end.
// Lengths resolve as bounds.ts reads them (ctm.ts's lengthAttr). A shape with no area (a zero size or
// radius, fewer than two points) has an empty outline. Refused, saying why: geometry CSS sets (M1's
// words), a length Draw can't read, a d with an error, and any other element.

import { attrValue, NS, type Doc, type NodeId } from '../model/doc.ts';
import { cssSets } from '../geometry/css.ts';
import { lengthAttr, type GeoContext } from '../geometry/ctm.ts';
import { GEOMETRY_PROPS, pointsOf } from '../geometry/bounds.ts';
import { cssWhy } from '../geometry/write.ts';
import { parsePath } from './parse.ts';
import { toAbsolute, type AbsSeg } from './abs.ts';

/** The elements that have an outline here. */
export const OUTLINED: ReadonlySet<string> = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
export const NOT_OUTLINED = 'Only shapes have an outline.';
const UNREADABLE = 'Its size is written in a way Draw can’t read here.';

export type Outline = { abs: AbsSeg[]; open: boolean } | { refused: string };

const n2 = (v: number) => String(v); // every double round-trips through the parser
const abs = (d: string): AbsSeg[] => toAbsolute(parsePath(d));

/** The element's outline, in its own user units; or why not. */
export function shapeOutline(doc: Doc, id: NodeId, ctx: GeoContext): Outline {
  const n = doc.nodes.get(id);
  if (!n || n.kind !== 'element' || n.ns !== NS.svg || !OUTLINED.has(n.local)) return { refused: NOT_OUTLINED };
  for (const p of [...(GEOMETRY_PROPS[n.local] ?? []), ...(n.local === 'rect' ? ['rx', 'ry'] : [])]) {
    const set = cssSets(doc, id, p);
    if (set !== 'no') return { refused: cssWhy(p, set) };
  }
  const len = (name: string, axis: 'x' | 'y' | 'other') => lengthAttr(doc, n, name, axis, ctx);
  // A radius that may be auto: null when absent, auto or negative (SVG 2: it then takes the other); undefined when unreadable.
  const radius = (name: 'rx' | 'ry', axis: 'x' | 'y'): number | null | undefined => {
    const raw = attrValue(doc, n, null, name);
    if (raw === null || raw.trim() === 'auto') return null;
    const v = len(name, axis);
    return v === null ? undefined : v < 0 ? null : v;
  };
  const radii = (): [number, number] | null => {
    const rx = radius('rx', 'x');
    const ry = radius('ry', 'y');
    if (rx === undefined || ry === undefined) return null;
    return [rx ?? ry ?? 0, ry ?? rx ?? 0];
  };
  switch (n.local) {
    case 'path': {
      const p = parsePath(attrValue(doc, n, null, 'd') ?? '');
      if (p.error) return { refused: `Its path data has an error at character ${p.error.at + 1}.` };
      return { abs: toAbsolute(p), open: false };
    }
    case 'rect': {
      const [x, y, w, h] = [len('x', 'x'), len('y', 'y'), len('width', 'x'), len('height', 'y')];
      const r = radii();
      if (x === null || y === null || w === null || h === null || !r) return { refused: UNREADABLE };
      if (!(w > 0 && h > 0)) return { abs: [], open: false };
      const rx = Math.min(r[0], w / 2);
      const ry = Math.min(r[1], h / 2);
      if (!(rx > 0 && ry > 0)) return { abs: abs(`M ${n2(x)} ${n2(y)} H ${n2(x + w)} V ${n2(y + h)} H ${n2(x)} Z`), open: false };
      const A = (tx: number, ty: number) => `A ${n2(rx)} ${n2(ry)} 0 0 1 ${n2(tx)} ${n2(ty)}`;
      return {
        abs: abs(`M ${n2(x + rx)} ${n2(y)} H ${n2(x + w - rx)} ${A(x + w, y + ry)} V ${n2(y + h - ry)} ${A(x + w - rx, y + h)} H ${n2(x + rx)} ${A(x, y + h - ry)} V ${n2(y + ry)} ${A(x + rx, y)} Z`),
        open: false,
      };
    }
    case 'circle':
    case 'ellipse': {
      const [cx, cy] = [len('cx', 'x'), len('cy', 'y')];
      let r: [number, number] | null;
      if (n.local === 'circle') {
        const v = len('r', 'other');
        r = v === null ? null : [v, v];
      } else r = radii();
      if (cx === null || cy === null || !r) return { refused: UNREADABLE };
      const [rx, ry] = r;
      if (!(rx > 0 && ry > 0)) return { abs: [], open: false };
      const A = (tx: number, ty: number) => `A ${n2(rx)} ${n2(ry)} 0 0 1 ${n2(tx)} ${n2(ty)}`;
      return { abs: abs(`M ${n2(cx + rx)} ${n2(cy)} ${A(cx, cy + ry)} ${A(cx - rx, cy)} ${A(cx, cy - ry)} ${A(cx + rx, cy)} Z`), open: false };
    }
    case 'polygon':
    case 'polyline': {
      const pts = pointsOf(attrValue(doc, n, null, 'points') ?? '');
      if (pts.length < 4) return { abs: [], open: n.local === 'polyline' };
      let d = `M ${n2(pts[0])} ${n2(pts[1])}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += ` L ${n2(pts[i])} ${n2(pts[i + 1])}`;
      return n.local === 'polygon' ? { abs: abs(`${d} Z`), open: false } : { abs: abs(d), open: true };
    }
    default: {
      const [x1, y1, x2, y2] = [len('x1', 'x'), len('y1', 'y'), len('x2', 'x'), len('y2', 'y')];
      if (x1 === null || y1 === null || x2 === null || y2 === null) return { refused: UNREADABLE };
      return { abs: abs(`M ${n2(x1)} ${n2(y1)} L ${n2(x2)} ${n2(y2)}`), open: true };
    }
  }
}
