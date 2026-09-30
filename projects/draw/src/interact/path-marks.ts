// The path marks (P1-M3), pure: what the overlay draws for a path in the Node tool, and for the Pen's
// drag, in host px (the overlay model's units), from the engine's geometry in the element's own units
// and the element's measured toHost. SVG Lab's guides:
// - arms (`draw-arm`, the lab's .arm): a C's start → first control and second control → end, a Q's
//   start → control → end, an S's second control → end;
// - mirror guides (`draw-arm draw-arm--mirror` and the dashed dot `draw-mirror`, the lab's .armd and
//   .refl): the control an S or T implies, from the segment's start to it (and on to a T's end), a dot
//   there; nothing when it is the start itself;
// - while the Pen drags a point p to the finger f: both arms, p → f and p → 2p − f.

import { apply, type Affine } from '../../../../engine/values/affine.ts';
import type { Mirror, Point as UnitPoint } from '../../../../engine/path/nodes.ts';
import type { Line } from './overlay-model.ts';
import type { Point } from '../canvas/viewport.ts';

export interface PathMarks {
  arms: Line[];
  mirrors: Line[]; // dashed arms
  dots: Point[]; // dashed dots at the implied controls
}

export const NO_PATH_MARKS: PathMarks = { arms: [], mirrors: [], dots: [] };

const host = (m: Affine, p: UnitPoint): Point => {
  const [x, y] = apply(m, p.x, p.y);
  return { x, y };
};

/** A path's arms and mirror guides (engine/path/nodes.ts, element units) in host px through its toHost. */
export function pathMarks(nodes: { arms: readonly [UnitPoint, UnitPoint][]; mirrors: readonly Mirror[] }, toHost: Affine): PathMarks {
  const line = (a: UnitPoint, b: UnitPoint): Line => ({ from: host(toHost, a), to: host(toHost, b) });
  const mirrors: Line[] = [];
  for (const m of nodes.mirrors) {
    mirrors.push(line(m.from, m.at));
    if (m.to) mirrors.push(line(m.at, m.to));
  }
  return { arms: nodes.arms.map(([a, b]) => line(a, b)), mirrors, dots: nodes.mirrors.map((m) => host(toHost, m.at)) };
}

/** The Pen's arms while it drags from p to f (host px): the out-handle and its reflection. */
export function penArms(p: Point, f: Point): Line[] {
  return [
    { from: p, to: f },
    { from: p, to: { x: 2 * p.x - f.x, y: 2 * p.y - f.y } },
  ];
}
