// The radial generators: a regular polygon and a star, both a <polygon>'s `points`.
//
// Angles are in degrees from +x, so increasing angles turn clockwise on screen (SVG's y points
// down); the first vertex (or tip) is straight up, at −90°. Every coordinate is written with
// fmt(v, 2), each pair as `x,y` and the pairs joined by single spaces (SVG Lab's own spelling).
// Rounded to whole units, a star with centre (50, 53), r 30, inner 0.4 and 5 tips is exactly
// lab/vector.svg's star, and a 5-sided polygon with centre (50, 52), r 35 the Shapes lesson's
// pentagon.

import { fmt } from '../values/number-format.ts';

const rad = (deg: number) => (deg * Math.PI) / 180;

/** One point `r` from (cx, cy) at `deg`, written `x,y`. */
function at(cx: number, cy: number, r: number, deg: number): string {
  return `${fmt(cx + r * Math.cos(rad(deg)), 2)},${fmt(cy + r * Math.sin(rad(deg)), 2)}`;
}

/** A regular polygon: vertex k (0 … n−1) at −90° + k·360°/n, radius r. */
export function polygonPoints(cx: number, cy: number, r: number, sides: number): string {
  const out: string[] = [];
  for (let k = 0; k < sides; k++) out.push(at(cx, cy, r, -90 + (k * 360) / sides));
  return out.join(' ');
}

/** A star: tip k at θₖ = −90° + k·360°/n (radius r), then inner point k at θₖ + 180°/n (radius r·inner). */
export function starPoints(cx: number, cy: number, r: number, inner: number, tips: number): string {
  const out: string[] = [];
  for (let k = 0; k < tips; k++) {
    const t = -90 + (k * 360) / tips;
    out.push(at(cx, cy, r, t), at(cx, cy, r * inner, t + 180 / tips));
  }
  return out.join(' ');
}
