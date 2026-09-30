// The overlay: the app's own marks over the canvas (selection outlines, the marquee, handles,
// guides, snap lines, the tooltip) and under it (the checkerboard paper and the grid). It is never
// document content, so besides the sink this folder is the one place that may create elements
// (tools/check-sinks.mjs). It draws the overlay model (src/interact/overlay-model.ts), which is in
// host px, measured from each element's getScreenCTM on the canvas, so a rotated or skewed shape is
// outlined exactly, at any zoom; here the host's offset from the overlay is added.

import type { OverlayModel } from '../../interact/overlay-model.ts';
import { Marks } from './marks.ts';
import { Paper } from './paper.ts';
import { Tooltip } from './tooltip.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class Overlay {
  private svg: SVGSVGElement;
  #marks: Marks;
  #tip: Tooltip;
  #paper: Paper | null;
  #host: HTMLElement;
  #under: HTMLElement | null;

  /** `marks` holds the marks over the drawing; `under` and `paper` (if given) the underlay. */
  constructor(marks: HTMLElement, host: HTMLElement, under: { under: HTMLElement; paper: HTMLElement } | null = null) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'draw-overlay');
    this.svg.setAttribute('aria-hidden', 'true');
    marks.append(this.svg);
    this.#host = host;
    this.#marks = new Marks(this.svg);
    this.#tip = new Tooltip(marks);
    this.#under = under?.under ?? null;
    this.#paper = under ? new Paper(under.under, under.paper) : null;
  }

  /** Draw the model, measured now against the overlay's own top-left. */
  show(model: OverlayModel): void {
    const origin = this.svg.getBoundingClientRect();
    const h = this.#host.getBoundingClientRect();
    const offset = { x: h.left - origin.left, y: h.top - origin.top };
    this.#marks.draw(model, offset, h.width, h.height);
    this.#tip.show(model.tip, offset, h.width);
    if (this.#paper && this.#under) {
      const u = this.#under.getBoundingClientRect();
      this.#paper.show(model.paper, model.grid, { x: h.left - u.left, y: h.top - u.top });
    }
  }

  destroy(): void {
    this.#marks.destroy();
    this.#tip.destroy();
    this.#paper?.destroy();
    this.svg.remove();
  }
}
