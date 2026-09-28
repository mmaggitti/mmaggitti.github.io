// viewBox and preserveAspectRatio, and the viewport transform they make together (SVG 2, "The
// equivalent transform of an SVG viewport"). Draw's canvas, its export sizing and nested
// <svg>/<symbol>/<marker>/<pattern> all place content through this one function.

import type { Affine } from './affine.ts';
import { parseNumberList } from './number-format.ts';

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Align = 'none' | `x${'Min' | 'Mid' | 'Max'}Y${'Min' | 'Mid' | 'Max'}`;

export interface Par {
  align: Align;
  meetOrSlice: 'meet' | 'slice';
}

export const DEFAULT_PAR: Par = { align: 'xMidYMid', meetOrSlice: 'meet' };

/**
 * Four numbers separated by whitespace and/or commas. SVG 2 tells the two failures apart:
 * - null: a wrong count, garbage or a negative size invalidates the attribute (render as if absent);
 * - 'disabled': a zero width or height disables rendering of the element.
 */
export function parseViewBox(s: string): ViewBox | 'disabled' | null {
  const v = parseNumberList(s);
  if (!v || v.length !== 4 || !(v[2] >= 0 && v[3] >= 0)) return null;
  if (v[2] === 0 || v[3] === 0) return 'disabled';
  return { x: v[0], y: v[1], w: v[2], h: v[3] };
}

const PAR = /^[ \t\n\r\f]*(?:defer[ \t\n\r\f]+)?(none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:[ \t\n\r\f]+(meet|slice))?[ \t\n\r\f]*$/;

/** preserveAspectRatio. SVG 2 dropped `defer`; it is accepted and ignored, as browsers do. */
export function parsePar(s: string): Par | null {
  const m = PAR.exec(s);
  return m ? { align: m[1] as Align, meetOrSlice: (m[2] ?? 'meet') as Par['meetOrSlice'] } : null;
}

/** The matrix that maps viewBox coordinates into a width × height viewport at the origin. */
export function viewportTransform(vb: ViewBox, par: Par, width: number, height: number): Affine {
  let sx = width / vb.w;
  let sy = height / vb.h;
  if (par.align !== 'none') sx = sy = par.meetOrSlice === 'meet' ? Math.min(sx, sy) : Math.max(sx, sy);
  let tx = -vb.x * sx;
  let ty = -vb.y * sy;
  const slackX = width - vb.w * sx;
  const slackY = height - vb.h * sy;
  if (par.align.includes('xMid')) tx += slackX / 2;
  else if (par.align.includes('xMax')) tx += slackX;
  if (par.align.includes('YMid')) ty += slackY / 2;
  else if (par.align.includes('YMax')) ty += slackY;
  return [sx, 0, 0, sy, tx + 0, ty + 0]; // + 0 turns -0 (from a zero viewBox origin) into 0
}
