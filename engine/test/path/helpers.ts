// Shared by the engine/path tests: a seeded generator, the real-world d corpus, random paths, and
// point evaluators written separately from engine/path.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AbsSeg } from '../../path/abs.ts';
import { arcCenter, arcPoint } from '../../path/arc.ts';

/** mulberry32: small, fast, and the same sequence on every run. */
export function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)];

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

function* svgFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries.sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* svgFiles(p);
    else if (e.endsWith('.svg')) yield p;
  }
}

const dAttrs = (src: string) => [...src.matchAll(/\sd\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => m[1] ?? m[2]);

/**
 * Real d strings: the icon sample (fixtures/icon-paths.json, see fixtures/NOTICE.md), SVG Lab's own
 * paths, and the engine's shared SVG corpus when it is present.
 */
export function corpus(): { icons: string[]; lab: string[]; shared: string[] } {
  const icons: string[] = JSON.parse(readFileSync(here('./fixtures/icon-paths.json'), 'utf8'));
  const lab = dAttrs(readFileSync(here('../../../projects/svg-lab/index.html'), 'utf8')).filter((d) => /^\s*[Mm]/.test(d) && !d.includes('${'));
  const shared: string[] = [];
  for (const f of svgFiles(here('../fixtures/corpus/'))) shared.push(...dAttrs(readFileSync(f, 'utf8')));
  return { icons, lab, shared };
}

export type Pt = [number, number];

export function bezier(pts: readonly Pt[], t: number): Pt {
  // de Casteljau: a different route to the point than the Bernstein sums in engine/path.
  let p = pts.map((q) => [q[0], q[1]] as Pt);
  while (p.length > 1) p = p.slice(1).map((q, i) => [p[i][0] + (q[0] - p[i][0]) * t, p[i][1] + (q[1] - p[i][1]) * t] as Pt);
  return p[0];
}

/** A random, valid path of every command, absolute and relative, with degenerate cases mixed in. */
export function randomPath(r: () => number): string {
  const v = () => (r() < 0.1 ? pick(r, [0, 50, -50]) : Math.round((r() * 200 - 100) * 1000) / 1000);
  let d = `M${v()} ${v()}`;
  for (let n = 1 + Math.floor(r() * 8); n > 0; n--) {
    const c = pick(r, ['L', 'H', 'V', 'C', 'S', 'Q', 'T', 'A', 'A', 'Z', 'M']);
    const cmd = r() < 0.5 ? c : c.toLowerCase();
    const args =
      c === 'A'
        ? [r() < 0.1 ? 0 : r() * 150, r() * 150, r() * 360, r() < 0.5 ? 1 : 0, r() < 0.5 ? 1 : 0, v(), v()]
        : Array.from({ length: { L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0, M: 2 }[c]! }, v);
    d += ` ${cmd}${args.join(' ')}`;
  }
  return d;
}

/** Point at parameter t of one absolute segment, by the same parameterization nearestPoint uses. */
export function evaluator(s: AbsSeg): (t: number) => Pt {
  const lerp = (t: number): Pt => [s.x0 + (s.x - s.x0) * t, s.y0 + (s.y - s.y0) * t];
  switch (s.type) {
    case 'M':
      return () => [s.x, s.y];
    case 'L':
    case 'Z':
      return lerp;
    case 'Q':
      return (t) => {
        const u = 1 - t;
        return [u * u * s.x0 + 2 * u * t * s.x1 + t * t * s.x, u * u * s.y0 + 2 * u * t * s.y1 + t * t * s.y];
      };
    case 'C':
      return (t) => {
        const u = 1 - t;
        const [a, b, c, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
        return [a * s.x0 + b * s.x1 + c * s.x2 + e * s.x, a * s.y0 + b * s.y1 + c * s.y2 + e * s.y];
      };
    case 'A': {
      const c = arcCenter(s.x0, s.y0, s.rx, s.ry, s.rot, s.large, s.sweep, s.x, s.y);
      if (c === 'none') return () => [s.x0, s.y0];
      if (c === 'line') return lerp;
      return (t) => arcPoint(c, c.t1 + t * c.dt);
    }
  }
}
