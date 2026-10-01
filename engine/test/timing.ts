// Linear-time checks for the engine's tests (the P1-M3 review): a command run on some work and on 4×
// that work costs about 4× the time when it is linear, so the bound is 6×. Each size is timed alone;
// a pause of the runner's can land in one run, so a miss is measured again and the fastest run of
// each size counts. A run past 4× the absolute limit is no pause: the check ends at once (which also
// keeps a deliberately quadratic build from running for minutes). Each caller's limit is one the
// quadratic code missed by 5× or more.

import assert from 'node:assert/strict';

export interface LinearOpts {
  /** The most the larger may take (ms). */
  limit: number;
  /** Runs of each size at most (default 3). */
  runs?: number;
  /** Calls per run, for work too quick to time in one call (default 1). */
  reps?: number;
  /** The bound on the ratio (default 6). */
  most?: number;
}

/** How long `reps` calls of act take (ms); past `cap`, the rest aren't run and the time is extrapolated. */
function time(act: () => void, reps: number, cap: number): number {
  const t = performance.now();
  for (let i = 1; i <= reps; i++) {
    act();
    const ms = performance.now() - t;
    if (ms > cap && i < reps) return (ms * reps) / i;
  }
  return performance.now() - t;
}

/** small, and big (4× the work): big under `most`× small and under `limit` ms. */
export function linear(what: string, small: () => void, big: () => void, opts: LinearOpts): void {
  const { limit, runs = 3, reps = 1, most = 6 } = opts;
  const cap = 4 * limit;
  small(); // warm the engine up
  let s = time(small, reps, cap);
  let b = time(big, reps, cap);
  for (let again = 1; again < runs && (b >= most * s || b >= limit) && b < cap; again++) {
    s = Math.min(s, time(small, reps, cap));
    b = Math.min(b, time(big, reps, cap));
  }
  assert.ok(b < most * s, `${what}: ${s.toFixed(0)} ms, then ${b.toFixed(0)} ms for 4× the work (×${(b / s).toFixed(1)}; linear is ×4, the most ×${most})`);
  assert.ok(b < limit, `${what}: ${b.toFixed(0)} ms for the larger (the limit is ${limit})`);
}

/** How long `reps` calls of an async act take (ms), as time() measures a sync one. */
async function timeAsync(act: () => Promise<void>, reps: number, cap: number): Promise<number> {
  const t = performance.now();
  for (let i = 1; i <= reps; i++) {
    await act();
    const ms = performance.now() - t;
    if (ms > cap && i < reps) return (ms * reps) / i;
  }
  return performance.now() - t;
}

/** linear() for a command that is async (Text to path, a boolean): the same runs, bound and limit. */
export async function linearAsync(what: string, small: () => Promise<void>, big: () => Promise<void>, opts: LinearOpts): Promise<void> {
  const { limit, runs = 3, reps = 1, most = 6 } = opts;
  const cap = 4 * limit;
  await small(); // warm the engine up
  let s = await timeAsync(small, reps, cap);
  let b = await timeAsync(big, reps, cap);
  for (let again = 1; again < runs && (b >= most * s || b >= limit) && b < cap; again++) {
    s = Math.min(s, await timeAsync(small, reps, cap));
    b = Math.min(b, await timeAsync(big, reps, cap));
  }
  assert.ok(b < most * s, `${what}: ${s.toFixed(0)} ms, then ${b.toFixed(0)} ms for 4× the work (×${(b / s).toFixed(1)}; linear is ×4, the most ×${most})`);
  assert.ok(b < limit, `${what}: ${b.toFixed(0)} ms for the larger (the limit is ${limit})`);
}
