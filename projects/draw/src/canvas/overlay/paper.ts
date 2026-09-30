// The underlay: the checkerboard paper under the drawing and the grid over it (decision 10). The
// paper (.draw-paper, which Canvas.tsx makes) is placed on the artboard's screen rectangle, and the
// grid is drawn into its own <svg class="draw-grid"> above the paper and below the canvas host, at
// the lines the model gives. Both follow the view through the same math as the drawing
// (src/interact/overlay-model.ts), so the paper sits exactly under the artboard.

import type { Grid } from '../../interact/overlay-model.ts';
import type { Point, Rect } from '../viewport.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();
const px = (v: number) => `${n2(v)}px`;

export class Paper {
  #paper: HTMLElement;
  #svg: SVGSVGElement;
  #lines: SVGLineElement[] = [];
  #last = '';

  constructor(under: HTMLElement, paper: HTMLElement) {
    this.#paper = paper;
    this.#svg = document.createElementNS(SVG_NS, 'svg');
    this.#svg.setAttribute('class', 'draw-grid');
    this.#svg.setAttribute('aria-hidden', 'true');
    under.append(this.#svg);
  }

  /** Place the paper (host px, the host's top-left at `offset` in the underlay's px) and draw the grid. */
  show(paper: Rect | null, grid: Grid | null, offset: Point): void {
    const s = this.#paper.style;
    const box = paper ? [px(paper.x + offset.x), px(paper.y + offset.y), px(paper.width), px(paper.height)] : ['0px', '0px', '0px', '0px'];
    const key = box.join(' ');
    if (key !== this.#last) {
      [s.left, s.top, s.width, s.height] = box;
      this.#last = key;
    }
    const lines = grid ? [...grid.x.map((l) => ({ ...l, v: true })), ...grid.y.map((l) => ({ ...l, v: false }))] : [];
    while (this.#lines.length < lines.length) {
      const l = document.createElementNS(SVG_NS, 'line');
      this.#svg.append(l);
      this.#lines.push(l);
    }
    this.#lines.forEach((el, i) => {
      const g = lines[i];
      if (!g || !grid) {
        if (el.style.display !== 'none') el.style.display = 'none';
        return;
      }
      if (el.style.display) el.style.display = '';
      const o = grid.over;
      const [x1, y1, x2, y2] = g.v ? [g.at, o.y, g.at, o.y + o.height] : [o.x, g.at, o.x + o.width, g.at];
      el.setAttribute('x1', n2(x1 + offset.x));
      el.setAttribute('y1', n2(y1 + offset.y));
      el.setAttribute('x2', n2(x2 + offset.x));
      el.setAttribute('y2', n2(y2 + offset.y));
      el.setAttribute('class', g.major ? 'draw-grid-line major' : 'draw-grid-line');
    });
    this.#svg.dataset.step = grid ? String(grid.step) : '';
  }

  destroy(): void {
    this.#svg.remove();
  }
}
