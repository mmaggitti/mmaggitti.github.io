// Elliptical arcs, per SVG 2 Appendix B.2 (implementation notes): endpoint parameters to center
// form, with the out-of-range rules (B.2.5): equal endpoints omit the arc, a zero radius makes it a
// straight line, negative radii are made positive, and radii too small to span the endpoints scale
// up uniformly until they just do. Angles here are radians; the path's rotation is degrees.

export interface ArcCenter {
  cx: number;
  cy: number;
  rx: number; // after abs() and scaling
  ry: number;
  phi: number; // x-axis rotation, radians
  t1: number; // start angle, radians
  dt: number; // signed sweep, radians: positive = positive-angle direction (sweep flag 1)
}

/** Center form of an arc, 'line' for a zero radius, 'none' when the endpoints are equal. */
export function arcCenter(
  x1: number, y1: number, rx: number, ry: number, rotDeg: number,
  large: boolean, sweep: boolean, x2: number, y2: number,
): ArcCenter | 'line' | 'none' {
  if (x1 === x2 && y1 === y2) return 'none';
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  // Browsers store path numbers as 32-bit floats, so a radius under about 7e-46 is already zero there.
  if (Math.fround(rx) === 0 || Math.fround(ry) === 0) return 'line';
  const phi = ((rotDeg % 360) * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  // B.2.4 step 1: the midpoint-relative start point in the ellipse's own axes.
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  // B.2.5: scale radii that are too small.
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  // Step 2: the center in the ellipse's axes (the chord's midpoint once the radii were scaled).
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = rx2 * ry2 - rx2 * yp * yp - ry2 * xp * xp;
  const den = rx2 * yp * yp + ry2 * xp * xp;
  const coef = lambda >= 1 ? 0 : (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * yp) / ry;
  const cyp = (-coef * ry * xp) / rx;
  // Step 3: back to user space. Step 4: the angles.
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const t1 = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
  const t2 = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx);
  let dt = t2 - t1;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  else if (!sweep && dt > 0) dt -= 2 * Math.PI;
  // Backstop: endpoints a denormal apart underflow the math above; the arc is then a line at most.
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(dt)) return 'line';
  return { cx, cy, rx, ry, phi, t1, dt };
}

/** The point at angle t on the arc's ellipse. */
export function arcPoint(a: ArcCenter, t: number): [number, number] {
  const cos = Math.cos(a.phi);
  const sin = Math.sin(a.phi);
  const ex = a.rx * Math.cos(t);
  const ey = a.ry * Math.sin(t);
  return [a.cx + cos * ex - sin * ey, a.cy + sin * ex + cos * ey];
}

export type Cubic = [x1: number, y1: number, x2: number, y2: number, x: number, y: number];

/**
 * The arc as cubic Béziers of at most 90° each (from the start point, which is not included).
 * A 'line' arc is one straight cubic; an omitted arc is none. Deviation from the true ellipse is
 * under 3e-4 of the larger radius per 90° piece.
 */
export function arcToCubics(
  x1: number, y1: number, rx: number, ry: number, rotDeg: number,
  large: boolean, sweep: boolean, x2: number, y2: number,
): Cubic[] {
  const a = arcCenter(x1, y1, rx, ry, rotDeg, large, sweep, x2, y2);
  if (a === 'none') return [];
  if (a === 'line') return [[x1 + (x2 - x1) / 3, y1 + (y2 - y1) / 3, x1 + (2 * (x2 - x1)) / 3, y1 + (2 * (y2 - y1)) / 3, x2, y2]];
  const n = Math.max(1, Math.ceil(Math.abs(a.dt) / (Math.PI / 2) - 1e-9));
  const d = a.dt / n;
  const k = (4 / 3) * Math.tan(d / 4);
  const cos = Math.cos(a.phi);
  const sin = Math.sin(a.phi);
  // A point and its tangent on the unit circle, mapped through the ellipse.
  const map = (ux: number, uy: number): [number, number] => [
    a.cx + cos * a.rx * ux - sin * a.ry * uy,
    a.cy + sin * a.rx * ux + cos * a.ry * uy,
  ];
  const out: Cubic[] = [];
  for (let i = 0; i < n; i++) {
    const t = a.t1 + i * d;
    const u = t + d;
    const c1 = map(Math.cos(t) - k * Math.sin(t), Math.sin(t) + k * Math.cos(t));
    const c2 = map(Math.cos(u) + k * Math.sin(u), Math.sin(u) - k * Math.cos(u));
    const end = i === n - 1 ? [x2, y2] : map(Math.cos(u), Math.sin(u)); // land exactly on the endpoint
    out.push([c1[0], c1[1], c2[0], c2[1], end[0], end[1]]);
  }
  return out;
}
