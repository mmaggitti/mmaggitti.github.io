// path-bool (1.0.4, MIT; github.com/r-flash/PathBool.js), the library Draw's booleans use first (P1-M3
// S3). Only load.ts imports this module, with a dynamic import(), so it is a chunk of its own that the
// first boolean fetches. Loops of lines and cubics in, the result's path data out.

import { FillRule, PathBoolean, PathBooleanOperation, pathToPathData, type Path } from 'path-bool';
import type { BoolOp } from '../../../../engine/path/winding.ts';
import type { BoolInput, Combine } from './pipeline.ts';

const OPS: Readonly<Record<BoolOp, PathBooleanOperation>> = {
  union: PathBooleanOperation.Union,
  difference: PathBooleanOperation.Difference, // the first minus the rest: path-bool's left fold
  intersection: PathBooleanOperation.Intersection,
  exclusion: PathBooleanOperation.Exclusion,
};

/** An input as path-bool's Path: its loops' segments, each from where the last one ended. */
export const toPath = (input: BoolInput): Path =>
  input.loops.flatMap((l) => {
    let at = l.start;
    return l.segs.map((s): Path[number] => {
      const from = at;
      at = s.to;
      return s.type === 'L' ? ['L', from, s.to] : ['C', from, s.c1, s.c2, s.to];
    });
  });

export const combine: Combine = (inputs, op) =>
  new PathBoolean(inputs.map((i) => ({ path: toPath(i), fillRule: i.rule === 'evenodd' ? FillRule.EvenOdd : FillRule.NonZero })))
    .get(OPS[op])
    .map((p) => pathToPathData(p))
    .join(' ');
