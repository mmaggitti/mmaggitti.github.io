// The overlay: the app's own marks over the canvas (selection outlines now; handles, guides and
// snapping in P1). It is never document content, so besides the sink it is the one module that may
// create elements (tools/check-sinks.mjs). It draws in canvas pixels from each selected node's
// getScreenCTM, so a rotated or skewed shape is outlined exactly, at any zoom.

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface Quad {
  points: [DOMPointReadOnly, DOMPointReadOnly, DOMPointReadOnly, DOMPointReadOnly];
}

/**
 * The screen corners of a rendered graphics element's bounding box, relative to `origin` (the
 * overlay's own top-left). Null when the element has no box (not rendered, or in <defs>).
 */
export function screenQuad(el: SVGGraphicsElement, origin: DOMRectReadOnly): Quad | null {
  let box: DOMRect;
  try {
    box = el.getBBox();
  } catch {
    return null;
  }
  const m = el.getScreenCTM();
  if (!m) return null;
  const at = (x: number, y: number) => {
    const p = new DOMPoint(x, y).matrixTransform(m);
    return new DOMPoint(p.x - origin.left, p.y - origin.top);
  };
  return { points: [at(box.x, box.y), at(box.x + box.width, box.y), at(box.x + box.width, box.y + box.height), at(box.x, box.y + box.height)] };
}

export class Overlay {
  private svg: SVGSVGElement;
  private outlines: SVGPolygonElement[] = [];

  constructor(host: HTMLElement) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'draw-overlay');
    this.svg.setAttribute('aria-hidden', 'true');
    host.append(this.svg);
  }

  /** Outline these quads (one per selected element), reusing polygons between calls. */
  show(quads: readonly Quad[]): void {
    while (this.outlines.length < quads.length) {
      const p = document.createElementNS(SVG_NS, 'polygon');
      p.setAttribute('class', 'draw-outline');
      this.svg.append(p);
      this.outlines.push(p);
    }
    this.outlines.forEach((p, i) => {
      const q = quads[i];
      if (!q) {
        p.setAttribute('points', '');
        return;
      }
      p.setAttribute('points', q.points.map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(' '));
    });
  }

  /** Outline these drawn elements, measured now against the overlay's own top-left. */
  outline(elements: readonly SVGGraphicsElement[]): void {
    const origin = this.svg.getBoundingClientRect();
    this.show(elements.map((el) => screenQuad(el, origin)).filter((q): q is Quad => q !== null));
  }

  clear(): void {
    this.show([]);
  }

  destroy(): void {
    this.svg.remove();
    this.outlines = [];
  }
}
