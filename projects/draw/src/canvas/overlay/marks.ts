// The overlay's SVG marks, drawn from the model (src/interact/overlay-model.ts): selection outlines,
// the marquee, coordinate guides, snap lines, the user's guides and their pills, the local grid,
// the rotation guide, a gradient's guides (Edit on canvas: its unit box, line, circle and focus
// arm), a path's arms and mirror guides (the Node tool and the Pen, P1-M3), an arc's ghost arcs and
// flag labels, a path's direction arrows and a donut's percentage labels (P1-M3 S2) and the handles,
// with SVG Lab's look. The model is in host px; every
// coordinate written here is in the overlay's own px (the host's offset added), so an outline's
// points read as where it is drawn. Every element is reused between frames (a drag frame changes
// attributes, never the element list), and only what changed is written.

import type { Handle, Label, Line, OverlayModel } from '../../interact/overlay-model.ts';
import type { Point } from '../viewport.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** Set an attribute only when it differs. */
function put(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** A group of like elements, grown as needed and hidden when not used. */
class Pool {
  #g: SVGGElement;
  #tag: string;
  #cls: string;
  #els: SVGElement[] = [];
  constructor(parent: SVGElement, tag: string, cls: string, group = `${cls}-group`) {
    this.#g = document.createElementNS(SVG_NS, 'g');
    this.#g.setAttribute('class', group);
    parent.append(this.#g);
    this.#tag = tag;
    this.#cls = cls;
  }
  /** Exactly `n` elements shown, the rest hidden. */
  take(n: number): SVGElement[] {
    while (this.#els.length < n) {
      const e = document.createElementNS(SVG_NS, this.#tag) as SVGElement;
      e.setAttribute('class', this.#cls);
      this.#g.append(e);
      this.#els.push(e);
    }
    this.#els.forEach((e, i) => {
      const want = i < n ? '' : 'none';
      if (e.style.display !== want) e.style.display = want;
    });
    return this.#els.slice(0, n);
  }
}

/** The handles' shapes and sizes: [shape, size, size when active], half-sides for squares, radii for circles (SVG Lab's px). */
export const HANDLE = {
  anchor: ['square', 5.5, 7],
  start: ['square', 5.5, 7],
  ctrl: ['circle', 6, 7.5],
  bend: ['circle', 4.5, 6.5],
  scale: ['diamond', 6.5, 8],
  center: ['circle', 8, 9.5],
  rot: ['circle', 8, 9.5],
} as const;

/** The centre handle's dot (SVG Lab's). */
export const CENTRE_DOT_R = 2.2;
/** A mirror guide's dashed dot (SVG Lab's .refl), px. */
export const MIRROR_DOT_R = 5.5;

export class Marks {
  #root: SVGGElement;
  #outlines: Pool;
  #localGrid: Pool;
  #localAxes: Pool;
  #coords: Pool;
  #snap: Pool;
  #guides: Pool;
  #marquee: Pool;
  #rotGuide: Pool;
  #gradBox: Pool;
  #gradLine: Pool;
  #gradRing: Pool;
  #gradArm: Pool;
  #arms: Pool;
  #mirrorArms: Pool;
  #mirrorDots: Pool;
  #ghosts: Pool;
  #arrows: Pool;
  #pills: Pool;
  #squares: Pool;
  #circles: Pool;
  #dots: Pool;
  #labels: Pool;
  #flagLabels: Pool;
  #donutLabels: Pool;

  constructor(svg: SVGSVGElement) {
    this.#root = document.createElementNS(SVG_NS, 'g');
    svg.append(this.#root);
    const r = this.#root;
    this.#outlines = new Pool(r, 'polygon', 'draw-outline');
    this.#localGrid = new Pool(r, 'line', 'draw-local-grid');
    this.#localAxes = new Pool(r, 'line', 'draw-local-axis');
    this.#coords = new Pool(r, 'line', 'draw-coord');
    this.#snap = new Pool(r, 'line', 'draw-snap-line');
    this.#guides = new Pool(r, 'line', 'draw-guide');
    this.#marquee = new Pool(r, 'rect', 'draw-marquee');
    this.#rotGuide = new Pool(r, 'line', 'draw-rot-guide');
    this.#gradBox = new Pool(r, 'polygon', 'draw-grad-box');
    this.#gradLine = new Pool(r, 'line', 'draw-grad-guide');
    this.#gradRing = new Pool(r, 'polygon', 'draw-grad-guide');
    this.#gradArm = new Pool(r, 'line', 'draw-grad-arm');
    this.#arms = new Pool(r, 'line', 'draw-arm');
    this.#mirrorArms = new Pool(r, 'line', 'draw-arm draw-arm--mirror', 'draw-mirror-arm-group');
    this.#mirrorDots = new Pool(r, 'circle', 'draw-mirror');
    this.#ghosts = new Pool(r, 'path', 'draw-ghost');
    this.#arrows = new Pool(r, 'polygon', 'draw-dir');
    this.#pills = new Pool(r, 'rect', 'draw-pill');
    this.#squares = new Pool(r, 'rect', 'draw-hd');
    this.#circles = new Pool(r, 'circle', 'draw-hd');
    this.#dots = new Pool(r, 'circle', 'draw-hd-dot');
    this.#labels = new Pool(r, 'text', 'draw-mark-label');
    this.#flagLabels = new Pool(r, 'text', 'draw-flag-label');
    this.#donutLabels = new Pool(r, 'text', 'draw-donut-label');
  }

  #o: Point = { x: 0, y: 0 }; // the host's top-left in the overlay's px

  /** Draw the model, `offset` being the host's top-left in the overlay's own px. */
  draw(model: OverlayModel, offset: Point, hostWidth: number, hostHeight: number): void {
    this.#o = offset;
    const X = (v: number) => n2(v + offset.x);
    const Y = (v: number) => n2(v + offset.y);
    const outlines = this.#outlines.take(model.outlines.length);
    model.outlines.forEach((o, i) => put(outlines[i], 'points', o.quad.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')));
    const local = model.localGrid;
    this.#lines(this.#localGrid, local?.lines ?? []);
    this.#lines(this.#localAxes, local?.axes ?? []);
    this.#lines(this.#coords, model.coords?.lines ?? []);
    this.#lines(this.#snap, model.snapLines);
    this.#lines(this.#guides, model.guides.map((g) => (g.axis === 'v' ? { from: { x: g.at, y: -offset.y }, to: { x: g.at, y: hostHeight + offset.y } } : { from: { x: -offset.x, y: g.at }, to: { x: hostWidth + offset.x, y: g.at } })));
    const [m] = this.#marquee.take(model.marquee ? 1 : 0);
    if (m && model.marquee) {
      put(m, 'x', X(model.marquee.x));
      put(m, 'y', Y(model.marquee.y));
      put(m, 'width', n2(model.marquee.width));
      put(m, 'height', n2(model.marquee.height));
    }
    this.#lines(this.#rotGuide, model.rotGuide ? [model.rotGuide] : []);
    const grad = model.gradient;
    const poly = (pool: Pool, pts: readonly Point[] | null) => {
      const [el] = pool.take(pts ? 1 : 0);
      if (el && pts) put(el, 'points', pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(' '));
    };
    poly(this.#gradBox, grad?.box ?? null);
    poly(this.#gradRing, grad?.ring ?? null);
    this.#lines(this.#gradLine, grad?.line ? [grad.line] : []);
    this.#lines(this.#gradArm, grad?.arm ? [grad.arm] : []);
    const paths = model.paths;
    this.#lines(this.#arms, paths?.arms ?? []);
    this.#lines(this.#mirrorArms, paths?.mirrors ?? []);
    const dots = this.#mirrorDots.take(paths?.dots.length ?? 0);
    paths?.dots.forEach((p, i) => {
      put(dots[i], 'cx', X(p.x));
      put(dots[i], 'cy', Y(p.y));
      put(dots[i], 'r', String(MIRROR_DOT_R));
    });
    // An arc's ghosts (P1-M3 S2): each as M … C … in overlay px.
    const ghosts = this.#ghosts.take(paths?.ghosts.length ?? 0);
    paths?.ghosts.forEach((g, i) => {
      const pt = (p: Point) => `${X(p.x)} ${Y(p.y)}`;
      put(ghosts[i], 'd', `M ${pt(g.start)}${g.cubics.map(([a, b, c]) => ` C ${pt(a)} ${pt(b)} ${pt(c)}`).join('')}`);
      put(ghosts[i], 'data-flags', g.flags);
    });
    const arrows = this.#arrows.take(paths?.arrows.length ?? 0);
    paths?.arrows.forEach((a, i) => {
      put(arrows[i], 'points', a.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(' '));
      put(arrows[i], 'class', a.inner ? 'draw-dir draw-dir--in' : 'draw-dir');
    });
    const pills = this.#pills.take(model.guides.length);
    model.guides.forEach((g, i) => {
      const [w, h] = g.axis === 'v' ? [20, 44] : [44, 20];
      put(pills[i], 'x', X(g.pill.x - w / 2));
      put(pills[i], 'y', Y(g.pill.y - h / 2));
      put(pills[i], 'width', String(w));
      put(pills[i], 'height', String(h));
      put(pills[i], 'rx', '10');
      put(pills[i], 'class', g.active ? 'draw-pill on' : 'draw-pill');
    });
    this.#handles(model.handles);
    this.#text([...(model.coords?.labels ?? []), ...(local?.labels ?? []), ...(grad?.labels ?? [])]);
    const flags = this.#flagLabels.take(paths?.flags.length ?? 0);
    paths?.flags.forEach((f, i) => {
      put(flags[i], 'x', X(f.at.x));
      put(flags[i], 'y', Y(f.at.y));
      put(flags[i], 'text-anchor', 'middle');
      put(flags[i], 'class', f.on ? 'draw-flag-label on' : 'draw-flag-label');
      if (flags[i].textContent !== f.text) flags[i].textContent = f.text;
    });
    const donut = this.#donutLabels.take(paths?.donut.length ?? 0);
    paths?.donut.forEach((l, i) => {
      put(donut[i], 'x', X(l.at.x));
      put(donut[i], 'y', Y(l.at.y));
      put(donut[i], 'text-anchor', 'middle');
      if (donut[i].textContent !== l.text) donut[i].textContent = l.text;
    });
  }

  #lines(pool: Pool, lines: readonly Line[]): void {
    const { x, y } = this.#o;
    const els = pool.take(lines.length);
    lines.forEach((l, i) => {
      put(els[i], 'x1', n2(l.from.x + x));
      put(els[i], 'y1', n2(l.from.y + y));
      put(els[i], 'x2', n2(l.to.x + x));
      put(els[i], 'y2', n2(l.to.y + y));
    });
  }

  #handles(list: readonly Handle[]): void {
    const hs = list.map((h) => ({ ...h, at: { x: h.at.x + this.#o.x, y: h.at.y + this.#o.y } }));
    const squares = hs.filter((h) => HANDLE[h.kind][0] !== 'circle');
    const circles = hs.filter((h) => HANDLE[h.kind][0] === 'circle');
    const sq = this.#squares.take(squares.length);
    squares.forEach((h, i) => {
      const [shape, size, on] = HANDLE[h.kind];
      const a = h.active ? on : size;
      put(sq[i], 'x', n2(h.at.x - a));
      put(sq[i], 'y', n2(h.at.y - a));
      put(sq[i], 'width', n2(2 * a));
      put(sq[i], 'height', n2(2 * a));
      put(sq[i], 'transform', shape === 'diamond' ? `rotate(45 ${n2(h.at.x)} ${n2(h.at.y)})` : '');
      put(sq[i], 'class', `draw-hd ${h.kind}${h.active ? ' on' : ''}`);
      put(sq[i], 'data-handle', h.id);
    });
    const ci = this.#circles.take(circles.length);
    circles.forEach((h, i) => {
      const [, size, on] = HANDLE[h.kind];
      put(ci[i], 'cx', n2(h.at.x));
      put(ci[i], 'cy', n2(h.at.y));
      put(ci[i], 'r', String(h.active ? on : size));
      put(ci[i], 'class', `draw-hd ${h.kind}${h.active ? ' on' : ''}`);
      put(ci[i], 'data-handle', h.id);
    });
    const centres = hs.filter((h) => h.kind === 'center');
    const dots = this.#dots.take(centres.length);
    centres.forEach((h, i) => {
      put(dots[i], 'cx', n2(h.at.x));
      put(dots[i], 'cy', n2(h.at.y));
      put(dots[i], 'r', String(CENTRE_DOT_R));
    });
  }

  #text(labels: readonly Label[]): void {
    const els = this.#labels.take(labels.length);
    labels.forEach((l, i) => {
      put(els[i], 'x', n2(l.at.x + this.#o.x));
      put(els[i], 'y', n2(l.at.y + this.#o.y));
      put(els[i], 'text-anchor', l.anchor);
      if (els[i].textContent !== l.text) els[i].textContent = l.text;
    });
  }

  destroy(): void {
    this.#root.remove();
  }
}
