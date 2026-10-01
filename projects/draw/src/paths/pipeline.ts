// Draw's boolean pipeline (P1-M3 S3). Pure: both libraries come in through `libs`, so node's tests run
// it with the libraries themselves, and the editor hands it the lazy chunks of load.ts.
// 1. path-bool (the primary) combines the inputs, and its result is scored against them by winding
//    samples (engine/path/winding.ts: a 32 × 32 lattice over the inputs' box, samples within 0.5% of
//    its diagonal from an input's outline left out);
// 2. if it throws, or more than 1% of the samples disagree, paper-core (the fallback, whose chunk
//    loads only then) runs the same operation and is scored the same way;
// 3. if that fails too, Draw refuses, and a chunk that can't load says so: nothing is written.
// A result is loops of lines and cubics oriented by nesting depth (engine/path/loops.ts), so it fills
// the same under nonzero and evenodd; both rules are scored, and the worse counts.

import { booleanScore, type BoolOp, type FillRule, type Score } from '../../../../engine/path/winding.ts';
import { loopsToAbs, orientLoops, toLoops, type Loop } from '../../../../engine/path/loops.ts';
import { parsePath } from '../../../../engine/path/parse.ts';
import { toAbsolute } from '../../../../engine/path/abs.ts';

export interface BoolInput {
  loops: Loop[]; // closed loops of lines and cubics
  rule: FillRule;
}
/** A library's operation: the inputs (the bottom first) combined, as path data. */
export type Combine = (inputs: readonly BoolInput[], op: BoolOp) => string;
export interface Libraries {
  primary: () => Promise<Combine>;
  fallback: () => Promise<Combine>;
}
export interface Check {
  grid: number;
  skip: number; // a share of the box's diagonal
  limit: number; // the share of the counted samples that may disagree
}
/** The runtime self-check (plan §5.9: 32 × 32, samples within 0.5% skipped, more than 1% fails). */
export const SELF_CHECK: Check = { grid: 32, skip: 0.005, limit: 0.01 };
export const REFUSED = 'Draw couldn’t combine these shapes.';
export const EMPTY = 'Nothing would be left.';
export const OFFLINE = 'Draw couldn’t load the shape tools. Try again when you’re online.';

export type Library = 'path-bool' | 'paper';
/** What each library did: its score, or why it gave none. */
export interface Tried {
  by: Library;
  score: Score | null;
  error: string | null;
}
export type Outcome = { loops: Loop[]; by: Library; score: Score; tried: Tried[] } | { refused: string; tried: Tried[] };

/** A library's result as loops, oriented by nesting depth. */
export function resultLoops(d: string): Loop[] {
  return orientLoops(toLoops(toAbsolute(parsePath(d))));
}

/** The worse of a score's two rules. */
export const worst = (s: Score): number => Math.max(s.nonzero, s.evenodd);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The pipeline (the header's steps). A result that scores well but is empty refuses with EMPTY. */
export async function runPipeline(inputs: readonly BoolInput[], op: BoolOp, libs: Libraries, check: Check = SELF_CHECK): Promise<Outcome> {
  const tried: Tried[] = [];
  const scored = inputs.map((i) => ({ abs: loopsToAbs(i.loops), rule: i.rule }));
  for (const [by, load] of [['path-bool', libs.primary], ['paper', libs.fallback]] as const) {
    let combine: Combine;
    try {
      combine = await load();
    } catch {
      return { refused: OFFLINE, tried };
    }
    try {
      const loops = resultLoops(combine(inputs, op));
      const score = booleanScore(scored, op, loopsToAbs(loops), check.grid, check.skip);
      tried.push({ by, score, error: null });
      if (worst(score) <= check.limit) return loops.length ? { loops, by, score, tried } : { refused: EMPTY, tried };
    } catch (e) {
      tried.push({ by, score: null, error: message(e) });
    }
  }
  return { refused: REFUSED, tried };
}
