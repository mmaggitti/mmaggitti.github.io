// The node model of a <path> (P1-M3): its anchors, controls, bend points, arms and mirror guides, in
// the element's own user units, and what dragging or tapping one of them writes.
//
// Handle ids (the overlay and the editor use them): an anchor is `a<k>`, k being the index in
// parsePath(d).segs of the segment whose end point it is (a subpath's M is `a<k>` of that M, drawn as
// the start); a control is `c<k>` (a Q's, or a C's or S's second) or `c<k>.1` (a C's first); a bend
// handle is `b<k>`, at the midpoint of straight segment k (L, H or V of nonzero length). An arc's end
// is its anchor. A closed subpath's last anchor that is its start (within 1e-9, from 3 anchors) is
// not drawn: the start stands for both, and dragging it moves both (SVG Lab's linked point).
//
// What a drag writes (engine/path/segments.ts writes it byte-locally), SVG Lab's pathHandles:
// - an anchor: that point, and the C controls attached to it (the incoming C's or S's second, the
//   outgoing C's first) by the same delta, never a Q's; a following relative segment keeps its end;
//   an H or V that would leave its row or column becomes an L;
// - a control: that control; a following S's or T's implied control follows, as S and T mean;
// - a bend handle dragged: the segment becomes a Q through the finger at t = 0.5, control 2·f − mid;
//   tapped: a Q off the midpoint by max(8k, 0.3·len) along the normal (SVG Lab's setSeg);
// both rounded to the snap step. A following T whose implied control would change is written out.

import { NS, el, findAttr, attrValue, type Doc, type NodeId } from '../model/doc.ts';
import { parsePath, type ParsedPath } from './parse.ts';
import { toAbsolute, type AbsSeg } from './abs.ts';
import { cssSets } from '../geometry/css.ts';
import { cssWhy, type Plan } from '../geometry/write.ts';
import { TokenEditError } from '../code/edit.ts';
import { bendControl, onStep, readPathText, withFollowers, writeGeometry, type CycleOpts, type PathText, type Rewrite } from './segments.ts';

export interface Point {
  x: number;
  y: number;
}
export type NodeKind = 'start' | 'anchor' | 'ctrl' | 'bend';
export interface NodeHandle {
  id: string;
  kind: NodeKind;
  at: Point;
  seg: number; // the segment it belongs to
}
/** A mirror guide: the control an S or T implies, drawn as a dashed arm from the segment's start (and, for T, on to its end) and a dashed dot. */
export interface Mirror {
  from: Point;
  at: Point;
  to: Point | null;
}
export interface PathNodes {
  handles: NodeHandle[]; // drawing order: bends and controls, then anchors (which win a tie)
  arms: [Point, Point][];
  mirrors: Mirror[];
  hidden: number; // anchors past the cap, which get no handle
  closed: boolean; // the last subpath ends with Z
}

/** At most this many anchors get handles (the code has the rest), as M2 caps a polygon's vertices at 200. */
export const MAX_NODE_HANDLES = 400;

const P = (x: number, y: number): Point => ({ x, y });
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9;

/** The node model of an element that is a <path> with d (what parses of it), else null. */
export function pathNodes(doc: Doc, id: NodeId): PathNodes | null {
  const n = doc.nodes.get(id);
  if (!n || n.kind !== 'element' || n.ns !== NS.svg || n.local !== 'path') return null;
  const d = attrValue(doc, n, null, 'd');
  if (d === null) return null;
  const p = parsePath(d);
  return nodesOf(p, toAbsolute(p));
}

/** The indices of anchors not drawn: each closed subpath's last explicit anchor that is its start. */
export function linkedAnchors(abs: readonly AbsSeg[]): Set<number> {
  const out = new Set<number>();
  let count = 0;
  abs.forEach((s, i) => {
    if (s.type === 'Z') {
      const j = i - 1;
      if (count > 2 && j >= 0 && abs[j].type !== 'Z' && near(abs[j].x, s.x) && near(abs[j].y, s.y)) out.add(j);
      count = 0;
      return;
    }
    if (s.type === 'M' || (i > 0 && abs[i - 1].type === 'Z')) count = 0;
    count++;
  });
  return out;
}

/** The node model of a parsed path (pure: the overlay's marks and the tests read it). */
export function nodesOf(p: ParsedPath, abs: readonly AbsSeg[]): PathNodes {
  const linked = linkedAnchors(abs);
  const handles: NodeHandle[] = [];
  const anchors: NodeHandle[] = [];
  const arms: [Point, Point][] = [];
  const mirrors: Mirror[] = [];
  let shown = 0;
  let hidden = 0;
  abs.forEach((s, k) => {
    if (s.type === 'Z') return;
    if (shown >= MAX_NODE_HANDLES) {
      if (!linked.has(k)) hidden++;
      return;
    }
    const U = p.segs[k].cmd.toUpperCase();
    const p0 = P(s.x0, s.y0);
    const p1 = P(s.x, s.y);
    if (s.type === 'L' && (U === 'L' || U === 'H' || U === 'V') && !(near(s.x0, s.x) && near(s.y0, s.y))) {
      handles.push({ id: `b${k}`, kind: 'bend', at: P((s.x0 + s.x) / 2, (s.y0 + s.y) / 2), seg: k });
    } else if (s.type === 'C') {
      const c1 = P(s.x1, s.y1);
      const c2 = P(s.x2, s.y2);
      if (U === 'C') {
        handles.push({ id: `c${k}.1`, kind: 'ctrl', at: c1, seg: k });
        arms.push([p0, c1]);
      } else if (!(near(c1.x, p0.x) && near(c1.y, p0.y))) mirrors.push({ from: p0, at: c1, to: null });
      handles.push({ id: `c${k}`, kind: 'ctrl', at: c2, seg: k });
      arms.push([c2, p1]);
    } else if (s.type === 'Q') {
      const q = P(s.x1, s.y1);
      if (U === 'Q') {
        handles.push({ id: `c${k}`, kind: 'ctrl', at: q, seg: k });
        arms.push([p0, q], [q, p1]);
      } else if (!(near(q.x, p0.x) && near(q.y, p0.y))) mirrors.push({ from: p0, at: q, to: p1 });
    }
    if (linked.has(k)) return;
    anchors.push({ id: `a${k}`, kind: s.type === 'M' ? 'start' : 'anchor', at: p1, seg: k });
    shown++;
  });
  return { handles: [...handles, ...anchors], arms, mirrors, hidden, closed: p.segs.length > 0 && p.segs[p.segs.length - 1].cmd.toUpperCase() === 'Z' };
}

// ── what a drag or a tap writes ────────────────────────────────────────────────────────────────

export interface NodeOpts extends CycleOpts {}

const HANDLE = /^(a|c|b)(\d+)(\.1)?$/;

/** The path's raw d read for a write, or why not (CSS decides it, a reference, no d). */
function readFor(doc: Doc, id: NodeId): PathText | { refused: string } {
  const n = el(doc, id);
  if (n.ns !== NS.svg || n.local !== 'path') return { refused: 'Only a <path> has nodes.' };
  const css = cssSets(doc, id, 'd');
  if (css !== 'no') return { refused: cssWhy('d', css) };
  const a = findAttr(n, null, 'd');
  if (!a) return { refused: 'It has no path data.' };
  try {
    return readPathText(a.raw);
  } catch (e) {
    if (e instanceof TokenEditError) return { refused: e.message };
    throw e;
  }
}

function planOf(doc: Doc, id: NodeId, t: PathText, rewrites: readonly Rewrite[]): Plan {
  try {
    const raw = writeGeometry(t, rewrites);
    return raw === t.raw ? { edits: [] } : { edits: [{ id, ns: null, local: 'd', raw, add: false }] };
  } catch (e) {
    if (e instanceof TokenEditError) return { refused: `Its d can’t take that: ${e.message}.` };
    throw e;
  }
}

/** The rewrites that move anchor `k` by (dx, dy), with the C controls attached to it (and a linked closing anchor with the start). */
export function anchorMoves(t: PathText, k: number, dx: number, dy: number): Rewrite[] {
  const { abs } = t;
  const segs = t.p.segs;
  const geo = new Map<number, AbsSeg>();
  const at = (j: number) => ({ ...(geo.get(j) ?? abs[j]) }) as AbsSeg;
  const move = (j: number) => {
    const g = at(j) as AbsSeg & { x2: number; y2: number };
    g.x += dx;
    g.y += dy;
    if (g.type === 'C') {
      g.x2 += dx; // the incoming C's or S's second control follows
      g.y2 += dy;
    }
    geo.set(j, g);
    const nx = j + 1;
    if (nx < segs.length && abs[nx].sub === abs[j].sub && abs[nx].type === 'C' && segs[nx].cmd.toUpperCase() === 'C') {
      const h = at(nx) as AbsSeg & { x1: number; y1: number };
      h.x1 += dx; // the outgoing C's first control follows
      h.y1 += dy;
      geo.set(nx, h);
    }
  };
  move(k);
  if (abs[k].type === 'M') {
    // The start of a closed subpath carries its linked last anchor with it.
    const linked = linkedAnchors(abs);
    for (let j = k + 1; j < abs.length && abs[j].sub === abs[k].sub; j++) if (linked.has(j)) move(j);
  }
  return [...geo].map(([index, g]) => ({ index, cmd: segs[index].cmd, geo: g }));
}

/**
 * A node drag: handle `handleId` to `to` (the element's own units; an anchor or control already
 * snapped, a bend's finger raw: its control is rounded to the step here). Re-planned from the
 * document before the drag on every frame.
 */
export function planNodeDrag(doc: Doc, id: NodeId, handleId: string, to: Point, opts: NodeOpts): Plan {
  const t = readFor(doc, id);
  if ('refused' in t) return t;
  const m = HANDLE.exec(handleId);
  const k = m ? Number(m[2]) : -1;
  const s = t.abs[k];
  const seg = t.p.segs[k];
  if (!m || !s || !seg) return { refused: 'That node is no longer in the path.' };
  const U = seg.cmd.toUpperCase();
  if (m[1] === 'a') {
    if (s.type === 'Z') return { refused: 'That node is no longer in the path.' };
    return planOf(doc, id, t, anchorMoves(t, k, to.x - s.x, to.y - s.y));
  }
  if (m[1] === 'c') {
    let geo: AbsSeg | null = null;
    if (m[3] && s.type === 'C' && U === 'C') geo = { ...s, x1: to.x, y1: to.y };
    else if (!m[3] && s.type === 'C' && (U === 'C' || U === 'S')) geo = { ...s, x2: to.x, y2: to.y };
    else if (!m[3] && s.type === 'Q' && U === 'Q') geo = { ...s, x1: to.x, y1: to.y };
    if (!geo) return { refused: 'That control is no longer in the path.' };
    return planOf(doc, id, t, [{ index: k, cmd: seg.cmd, geo }]);
  }
  if (s.type !== 'L' || !'LHV'.includes(U)) return { refused: 'That segment isn’t straight any more.' };
  // A bend drag: the Q through the finger at t = 0.5.
  const x1 = onStep(2 * to.x - (s.x0 + s.x) / 2, opts.step);
  const y1 = onStep(2 * to.y - (s.y0 + s.y) / 2, opts.step);
  return planOf(doc, id, t, bend(t, k, x1, y1));
}

/** A tap on a bend handle: the segment becomes a Q curved off its midpoint along the normal (SVG Lab's setSeg). */
export function planBendTap(doc: Doc, id: NodeId, handleId: string, opts: NodeOpts): Plan {
  const t = readFor(doc, id);
  if ('refused' in t) return t;
  const m = /^b(\d+)$/.exec(handleId);
  const k = m ? Number(m[1]) : -1;
  const s = t.abs[k];
  const U = t.p.segs[k]?.cmd.toUpperCase();
  if (!s || s.type !== 'L' || !'LHV'.includes(U)) return { refused: 'That segment isn’t straight any more.' };
  const [x1, y1] = bendControl(s.x0, s.y0, s.x, s.y, opts);
  return planOf(doc, id, t, bend(t, k, x1, y1));
}

// Straight segment k as a Q with control (x1, y1), its case kept, and a following T written out if it would change.
function bend(t: PathText, k: number, x1: number, y1: number): Rewrite[] {
  const seg = t.p.segs[k];
  const rel = seg.cmd !== seg.cmd.toUpperCase();
  const s = t.abs[k];
  return withFollowers(t, [{ index: k, cmd: rel ? 'q' : 'Q', geo: { cmd: seg.cmd, sub: s.sub, x0: s.x0, y0: s.y0, x: s.x, y: s.y, type: 'Q', x1, y1 } }]);
}
