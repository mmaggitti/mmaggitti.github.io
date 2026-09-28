// Absolute geometry for a parsed path: one AbsSeg per Seg, same index, so a hit on the geometry
// maps straight back to the text. Follows SVG 2 §9.3: H and V become lines, S and T reflect the
// previous control point only after C/S or Q/T, Z returns to the subpath start, and a command after
// Z starts a new subpath at that same point. Arcs keep their parameters as written; arc.ts
// converts them (negative radii are made absolute there).

import type { ParsedPath } from './parse.ts';

interface Base {
  cmd: string; // the source command letter
  sub: number; // subpath index, from 0
  x0: number; // current point before the segment
  y0: number;
  x: number; // end point
  y: number;
}

export type AbsSeg =
  | (Base & { type: 'M' })
  | (Base & { type: 'L' })
  | (Base & { type: 'Z' })
  | (Base & { type: 'Q'; x1: number; y1: number })
  | (Base & { type: 'C'; x1: number; y1: number; x2: number; y2: number })
  | (Base & { type: 'A'; rx: number; ry: number; rot: number; large: boolean; sweep: boolean });

export function toAbsolute(p: ParsedPath): AbsSeg[] {
  const out: AbsSeg[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0; // subpath start
  let sy = 0;
  let sub = -1;
  for (const seg of p.segs) {
    const prev: AbsSeg | undefined = out[out.length - 1];
    const U = seg.cmd.toUpperCase();
    const a = seg.args;
    const ox = seg.cmd === U ? 0 : cx; // origin for this segment's coordinates
    const oy = seg.cmd === U ? 0 : cy;
    if (U === 'M' || prev?.type === 'Z') sub++;
    const base = { cmd: seg.cmd, sub, x0: cx, y0: cy };
    let s: AbsSeg;
    switch (U) {
      case 'M':
        s = { ...base, type: 'M', x: ox + a[0], y: oy + a[1] };
        sx = s.x;
        sy = s.y;
        break;
      case 'L':
        s = { ...base, type: 'L', x: ox + a[0], y: oy + a[1] };
        break;
      case 'H':
        s = { ...base, type: 'L', x: ox + a[0], y: cy };
        break;
      case 'V':
        s = { ...base, type: 'L', x: cx, y: oy + a[0] };
        break;
      case 'C':
        s = { ...base, type: 'C', x1: ox + a[0], y1: oy + a[1], x2: ox + a[2], y2: oy + a[3], x: ox + a[4], y: oy + a[5] };
        break;
      case 'S': {
        const [x1, y1] = prev?.type === 'C' ? [2 * cx - prev.x2, 2 * cy - prev.y2] : [cx, cy];
        s = { ...base, type: 'C', x1, y1, x2: ox + a[0], y2: oy + a[1], x: ox + a[2], y: oy + a[3] };
        break;
      }
      case 'Q':
        s = { ...base, type: 'Q', x1: ox + a[0], y1: oy + a[1], x: ox + a[2], y: oy + a[3] };
        break;
      case 'T': {
        const [x1, y1] = prev?.type === 'Q' ? [2 * cx - prev.x1, 2 * cy - prev.y1] : [cx, cy];
        s = { ...base, type: 'Q', x1, y1, x: ox + a[0], y: oy + a[1] };
        break;
      }
      case 'A':
        s = { ...base, type: 'A', rx: a[0], ry: a[1], rot: a[2], large: a[3] !== 0, sweep: a[4] !== 0, x: ox + a[5], y: oy + a[6] };
        break;
      default: // Z
        s = { ...base, type: 'Z', x: sx, y: sy };
    }
    out.push(s);
    cx = s.x;
    cy = s.y;
  }
  return out;
}
