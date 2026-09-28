// 2D affine matrices in SVG's order: [a, b, c, d, e, f] maps (x, y) to
// (a·x + c·y + e, b·x + d·y + f), the same six numbers as matrix(a b c d e f).
//
// multiply(m1, m2) is the matrix product m1·m2, which maps p to m1(m2(p)): the order an SVG
// transform list is written in, so `translate(…) rotate(…)` is multiply(translate, rotate), and the
// right-hand transform acts on points first.

export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function multiply(m1: Affine, m2: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

/** The inverse, or null when the matrix is singular (or its inverse overflows). */
export function invert(m: Affine): Affine | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  const inv: Affine = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
  return det !== 0 && inv.every(Number.isFinite) ? inv : null;
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export const translate = (tx: number, ty = 0): Affine => [1, 0, 0, 1, tx, ty];
export const scale = (sx: number, sy = sx): Affine => [sx, 0, 0, sy, 0, 0];

/** Rotation by `deg` degrees (clockwise on screen, where y points down), about (cx, cy). */
export function rotate(deg: number, cx = 0, cy = 0): Affine {
  const [cos, sin] = cosSin(deg);
  const r: Affine = [cos, sin, -sin, cos, 0, 0];
  return cx || cy ? multiply(multiply(translate(cx, cy), r), translate(-cx, -cy)) : r;
}

export const skewX = (deg: number): Affine => [1, 0, tan(deg), 1, 0, 0];
export const skewY = (deg: number): Affine => [1, tan(deg), 0, 1, 0, 0];

// Exact at quarter turns, so rotate(90) is [0 1 -1 0 0 0] and not 6.1e-17 residue.
const QUARTERS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function cosSin(deg: number): readonly [number, number] {
  const q = (((deg % 360) + 360) % 360) / 90;
  if (Number.isInteger(q)) return QUARTERS[q];
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

const tan = (deg: number): number => (deg % 180 === 0 ? 0 : Math.tan((deg * Math.PI) / 180));

export interface Decomposed {
  translateX: number;
  translateY: number;
  rotate: number; // degrees, (-180, 180]
  scaleX: number; // ≥ 0; a reflection shows as a negative scaleY
  scaleY: number;
  skewX: number; // degrees, (-90, 90)
}

/**
 * Split m into translate · rotate · scale · skewX, the SVG list
 * `translate(tx ty) rotate(r) scale(sx sy) skewX(k)`. Every matrix, singular ones included,
 * decomposes, and compose() rebuilds it to rounding error.
 */
export function decompose(m: Affine): Decomposed {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  if (sx === 0) {
    // the first column is zero: put the second column in rotate and scaleY
    const sy = Math.hypot(c, d);
    return { translateX: e, translateY: f, rotate: sy ? deg(Math.atan2(-c || 0, d)) : 0, scaleX: 0, scaleY: sy, skewX: 0 };
  }
  return {
    translateX: e,
    translateY: f,
    rotate: deg(Math.atan2(b || 0, a)), // || 0: a -0 would give -180
    scaleX: sx,
    scaleY: (a * d - b * c) / sx,
    skewX: deg(Math.atan((a * c + b * d) / (sx * sx))),
  };
}

export function compose(p: Decomposed): Affine {
  let m = multiply(translate(p.translateX, p.translateY), rotate(p.rotate));
  m = multiply(m, scale(p.scaleX, p.scaleY));
  return multiply(m, skewX(p.skewX));
}

const deg = (rad: number): number => (rad * 180) / Math.PI;
