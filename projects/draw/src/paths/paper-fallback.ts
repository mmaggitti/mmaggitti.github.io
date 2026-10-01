// paper-core (paper 0.12.18, MIT; Jürg Lehni and Jonathan Puckey), Draw's fallback for booleans (P1-M3
// S3): used only when path-bool throws or fails the self-check. Only load.ts imports this module,
// with a dynamic import(), so it is a chunk of its own. It imports paper/dist/paper-core.js, never
// bare 'paper': that is paper-full, whose PaperScript compiles code at run time, which the CSP blocks
// and tools/check-bundle.mjs refuses.

import paperModule from 'paper/dist/paper-core.js';
import type { BoolOp } from '../../../../engine/path/winding.ts';
import type { BoolInput, Combine } from './pipeline.ts';

// paper's typings declare this module as 'paper/dist/paper-core' (no .js), and paper-core.d.ts only
// brings in the global `paper` namespace: the default export is paper-core's PaperScope.
const paperCore = paperModule as unknown as paper.PaperScope;

const METHODS: Readonly<Record<BoolOp, 'unite' | 'subtract' | 'intersect' | 'exclude'>> = { union: 'unite', difference: 'subtract', intersection: 'intersect', exclusion: 'exclude' };

// Each number as the double it is.
const dOf = (i: BoolInput): string =>
  i.loops.map((l) => `M ${l.start[0]} ${l.start[1]}${l.segs.map((s) => (s.type === 'L' ? ` L ${s.to[0]} ${s.to[1]}` : ` C ${s.c1[0]} ${s.c1[1]} ${s.c2[0]} ${s.c2[1]} ${s.to[0]} ${s.to[1]}`)).join('')} Z`).join(' ');

let scope: paper.PaperScope | null = null;

export const combine: Combine = (inputs, op) => {
  if (!scope) {
    scope = new paperCore.PaperScope();
    scope.setup(new scope.Size(1, 1));
  }
  scope.activate();
  const s = scope;
  const items = inputs.map((i) => {
    const c = new s.CompoundPath({ pathData: dOf(i), insert: false });
    c.fillRule = i.rule;
    return c;
  });
  // Folded left from the bottom, as path-bool folds (the bottom minus the rest; an odd count of them).
  let out: paper.PathItem = items[0];
  for (const it of items.slice(1)) out = out[METHODS[op]](it, { insert: false });
  return out.pathData;
};
