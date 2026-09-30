// The spiral generator: an Archimedean spiral from its centre, a <path>'s `d`.
//
// ρ(θ) = r·θ/Θ with Θ = 2π·turns, θ from 0 (pointing +x; increasing θ turns clockwise on screen).
// N = ⌈8·turns⌉ cubic segments of Δ = Θ/N each. With P(θ) = (cx + ρ cos θ, cy + ρ sin θ) and
// P′(θ) = (ρ′ cos θ − ρ sin θ, ρ′ sin θ + ρ cos θ), ρ′ = r/Θ, segment i runs from θ₀ = iΔ to
// θ₁ = (i+1)Δ with controls C₁ = P(θ₀) + (Δ/3)·P′(θ₀) and C₂ = P(θ₁) − (Δ/3)·P′(θ₁) (cubic
// Hermite). `d` is `M x y`, then ` C x1 y1 x2 y2 x y` per segment, every number fmt(v, 2) and one
// space apart.

import { fmt } from '../values/number-format.ts';

/** The spiral's path data. */
export function spiralPath(cx: number, cy: number, r: number, turns: number): string {
  const T = 2 * Math.PI * turns;
  const n = Math.ceil(8 * turns);
  const dt = T / n;
  const k = r / T; // ρ′
  const p = (t: number): [number, number] => {
    const rho = k * t;
    return [cx + rho * Math.cos(t), cy + rho * Math.sin(t)];
  };
  const v = (t: number): [number, number] => {
    const rho = k * t;
    return [k * Math.cos(t) - rho * Math.sin(t), k * Math.sin(t) + rho * Math.cos(t)];
  };
  const w = (x: number) => fmt(x, 2);
  const [x0, y0] = p(0);
  let d = `M ${w(x0)} ${w(y0)}`;
  for (let i = 0; i < n; i++) {
    const t0 = i * dt;
    const t1 = (i + 1) * dt;
    const [ax, ay] = p(t0);
    const [bx, by] = p(t1);
    const [avx, avy] = v(t0);
    const [bvx, bvy] = v(t1);
    const h = dt / 3;
    d += ` C ${w(ax + h * avx)} ${w(ay + h * avy)} ${w(bx - h * bvx)} ${w(by - h * bvy)} ${w(bx)} ${w(by)}`;
  }
  return d;
}

/** Where the spiral ends, P(Θ): its radius handle. */
export function spiralEnd(cx: number, cy: number, r: number, turns: number): { x: number; y: number } {
  const T = 2 * Math.PI * turns;
  return { x: cx + r * Math.cos(T), y: cy + r * Math.sin(T) };
}
