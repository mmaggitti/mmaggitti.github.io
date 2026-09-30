// The keyed renderer: a Doc drawn into the canvas host's shadow root, through the safe sink.
//
// Every rendered node is keyed by its NodeId, never by its position, so M3's edits patch one
// element's attributes or one subtree and selection, history and the code view keep pointing at
// the same node. A patched canvas always equals a fresh render of the same model: a patched node
// is rebuilt at its model position (so a moved or reordered node lands where it now is, and a copy
// left at its old place is taken away), and after an edit that can move ids every attribute
// animation with an href is judged again, since the browser re-binds its target. Framework-free:
// React owns the chrome, never the canvas. This file only inserts, moves and removes nodes the
// sink made; creating or filling them happens in the sink alone.
//
// A refused element is skipped with its whole subtree; it stays in the model and the file. The
// root must be an SVG <svg>. The sink's canvas stylesheet stops CSS animations under
// prefers-reduced-motion, when its SMIL animations also start paused. The view (zoom and pan) is
// the rendered root's own box, its CSS size and offset (setCamera, through the sink's camera
// sheet): never its viewBox, never the file. Only a root with no viewBox of its own, drawn at a
// scale other than 1, is given one (0 0 W0 H0), so its content scales with its box. A pan or zoom
// frame is one stylesheet replacement. An edit writes only the attributes that changed, so a scrub
// frame is one attribute mutation on the canvas.
//
// Under reduced motion a document that animates opens paused, on the frame where its first cycle
// ends (where a drawing that animates in has arrived), and Play starts the motion: its SMIL runs
// (the first Play from that still starts it from the top, so a drawing that animates once moves),
// and the canvas stylesheet lets its CSS animations run too (the host's draw-play class). Pause
// holds both where they are (draw-held keeps CSS animations on their frame).

import { NS, attrValue, el, findAttr, type Doc, type ElementNode, type LeafNode, type NodeId } from '../../../../engine/model/doc.ts';
import { buildRefIndex } from '../../../../engine/model/refs.ts';
import { animatesAttribute } from '../../../../engine/policy/render-policy.ts';
import { fmt } from '../../../../engine/values/number-format.ts';
import { cameraSheet, canvasSheet, placeRoot, resetInheritedFont, sinkAttributes, sinkElement, sinkText, type CameraBox, type Supplied } from './safe-sink.ts';
import { hasOwnViewBox } from './artboard.ts';
import type { Size } from './viewport.ts';

/** The camera: the root's box in the host, and the root's viewport at 100% it scales. */
export interface Camera {
  box: CameraBox;
  viewport: Size;
}

export interface RenderStats {
  rendered: number; // elements on the canvas
  skippedElements: number; // refused elements (each counts once; their subtrees aren't visited)
  droppedAttributes: number; // attributes of rendered elements that the sink left off
}

interface Rendered {
  dom: Element | Text;
  parent: NodeId | null;
  kids: NodeId[]; // rendered children, so a patch can forget a whole subtree
  dropped: number;
  id: string | null; // its plain id as drawn: a change re-judges the animations that name ids
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const plainId = (doc: Doc, n: ElementNode) => attrValue(doc, n, null, 'id');

/** A drawing's motion: none, running, or (under reduced motion) paused until Play, or playing. */
export type Motion = 'still' | 'running' | 'paused' | 'playing';

const SMIL = 'animate, set, animateMotion, animateTransform, animateColor';
// CSS that moves: a @keyframes rule, or an animation or animation-name declaration that isn't none
// (not a class named "animation-…", nor "animation: none").
const CSS_MOTION = /@keyframes|(?:^|[{;\s])animation(?:-name)?\s*:(?!\s*none\s*(?:[;}!]|$))/i;

/** Whether a <style> sheet or a style attribute animates anything. */
export const cssAnimates = (css: string): boolean => CSS_MOTION.test(css);

/** Where the longest first cycle of the drawing's SMIL ends (a moment before), or 0. */
function stillTime(svg: SVGSVGElement): number {
  let end = 0;
  for (const a of svg.querySelectorAll(SMIL)) {
    try {
      const e = a as SVGAnimationElement;
      end = Math.max(end, e.getStartTime() + e.getSimpleDuration());
    } catch {
      // indefinite, or no interval yet: it says nothing about where the drawing arrives
    }
  }
  return Number.isFinite(end) && end > 0 ? Math.min(end, 3600) - 0.001 : 0;
}

export class Renderer {
  #host: ShadowRoot;
  #doc: Doc | null = null;
  #nodes = new Map<NodeId, Rendered>();
  #skipped = new Map<NodeId, NodeId>(); // refused element → the drawn parent that skipped it
  #linked = new Set<NodeId>(); // attribute animations with an href, whose target follows the ids
  #rootSkipped = false;
  #ids: { version: number; ids: Map<string, NodeId[]> } | null = null;
  #back = new WeakMap<Node, NodeId>(); // drawn node → its NodeId, for hit testing
  #sheet: CSSStyleSheet; // the camera's: where the root's box goes
  #camera: Camera | null = null;
  #viewBox: string | null = null; // the viewBox supplied to a root without one, drawn at a scale other than 1
  #playing = false; // Play was pressed (reduced motion)
  #fromStill = false; // on the opening still (reduced motion): Play starts from the beginning

  constructor(host: ShadowRoot) {
    this.#host = host;
    this.#sheet = cameraSheet();
    host.adoptedStyleSheets = [canvasSheet(), this.#sheet];
    resetInheritedFont(host);
  }

  /** Draw the whole document, replacing whatever the host held. If drawing throws, the previous drawing stays. */
  render(doc: Doc): void {
    const prev = [this.#doc, this.#nodes, this.#skipped, this.#linked, this.#ids] as const;
    this.#doc = doc;
    this.#nodes = new Map();
    this.#skipped = new Map();
    this.#linked = new Set();
    this.#ids = null;
    try {
      const root = el(doc, doc.root);
      const dom = root.ns === NS.svg && root.local === 'svg' ? this.#build(root, false, null) : null;
      this.#host.replaceChildren(...(dom ? [dom] : []));
      this.#rootSkipped = dom === null;
      this.#play(false);
      this.#fromStill = !!dom && reducedMotion();
      if (this.#fromStill) {
        (dom as SVGSVGElement).pauseAnimations();
        (dom as SVGSVGElement).setCurrentTime(stillTime(dom as SVGSVGElement));
      }
    } catch (e) {
      [this.#doc, this.#nodes, this.#skipped, this.#linked, this.#ids] = prev;
      throw e;
    }
  }

  /** Draw nothing (a file that isn't well-formed is shown only as source). */
  clear(): void {
    this.#doc = null;
    this.#nodes = new Map();
    this.#skipped = new Map();
    this.#linked = new Set();
    this.#ids = null;
    this.#rootSkipped = false;
    this.#play(false);
    this.#host.replaceChildren();
  }

  /** Whether the drawing moves (SMIL, or CSS animation in its styles), and if it waits for Play. */
  motion(): Motion {
    const svg = this.#root();
    if (!svg) return 'still';
    const css = () => [svg, ...svg.querySelectorAll('style, [style]')].some((e) => cssAnimates((e.localName === 'style' ? e.textContent : e.getAttribute('style')) ?? ''));
    if (!svg.querySelector(SMIL) && !css()) return 'still';
    if (!reducedMotion()) return 'running';
    return this.#playing ? 'playing' : 'paused';
  }

  /** Play (or pause again, holding the frame) a drawing that reduced motion paused. */
  play(on: boolean): void {
    this.#play(on, !on);
    const svg = this.#root();
    if (!svg) return;
    if (on) {
      // The opening still is where the first cycle ends: a drawing that animates once (fill="freeze")
      // would show no motion at all from there, so the first Play starts it from the top.
      if (this.#fromStill) svg.setCurrentTime(0);
      this.#fromStill = false;
      svg.unpauseAnimations();
    } else svg.pauseAnimations();
  }

  #play(on: boolean, held = false): void {
    this.#playing = on;
    this.#host.host.classList.toggle('draw-play', on);
    this.#host.host.classList.toggle('draw-held', held);
  }

  #root(): SVGSVGElement | null {
    const dom = this.#doc ? this.#nodes.get(this.#doc.root)?.dom : undefined;
    return dom?.nodeType === 1 ? (dom as SVGSVGElement) : null;
  }

  /** Re-apply one element's attributes after an edit. */
  patchAttributes(id: NodeId): void {
    const doc = this.#doc;
    const node = doc?.nodes.get(id);
    const done = this.#nodes.get(id);
    // An animation's attributes decide whether it renders at all, so it goes the subtree route.
    if (!doc || !node || node.kind !== 'element' || !done || done.dom.nodeType !== 1 || findAttr(node, null, 'attributeName')) {
      return this.patchSubtree(id);
    }
    const dropped = sinkAttributes(done.dom as Element, doc, node, this.#supplied(node));
    if (dropped === null) return this.patchSubtree(id);
    done.dropped = dropped;
    const was = done.id;
    done.id = plainId(doc, node);
    if (done.id !== was) this.#rejudge();
  }

  /** Re-render one node and everything under it at its model position (or remove it, if it left the document). */
  patchSubtree(id: NodeId): void {
    this.#patch(id);
    this.#rejudge();
  }

  /** The rendered copy of a node, if it is on the canvas. */
  nodeFor(id: NodeId): Element | Text | undefined {
    return this.#nodes.get(id)?.dom;
  }

  /** The NodeId a drawn node stands for (the canvas's hit test), if it is on the canvas. */
  idFor(dom: Node | null): NodeId | undefined {
    const id = dom ? this.#back.get(dom) : undefined;
    return id !== undefined && this.#nodes.get(id)?.dom === dom ? id : undefined;
  }

  /**
   * Place the rendered root's own box (null: fill the host). Its viewBox is never replaced; a root
   * with none is given 0 0 W0 H0 while it is drawn at a scale other than 1, re-patched only when
   * that changes, so a pan or zoom frame writes no attribute.
   */
  setCamera(camera: Camera | null): void {
    const was = this.#camera?.box ?? null;
    const box = camera?.box ?? null;
    if (!(was === box || (was && box && was.left === box.left && was.top === box.top && was.width === box.width && was.height === box.height))) placeRoot(this.#sheet, box);
    this.#camera = camera;
    const next = this.#suppliedViewBox();
    if (next === this.#viewBox) return;
    this.#viewBox = next;
    const doc = this.#doc;
    if (doc && this.#nodes.get(doc.root)) this.patchAttributes(doc.root);
  }

  // A root with no viewBox of its own, drawn at a scale other than 1: its viewport as a viewBox.
  #suppliedViewBox(): string | null {
    const doc = this.#doc;
    const c = this.#camera;
    if (!doc || !c || hasOwnViewBox(doc)) return null;
    const k = c.box.width / c.viewport.width;
    return Math.abs(k - 1) > 1e-9 ? `0 0 ${fmt(c.viewport.width, 6)} ${fmt(c.viewport.height, 6)}` : null;
  }

  stats(): RenderStats {
    const s: RenderStats = { rendered: 0, skippedElements: this.#skipped.size + (this.#rootSkipped ? 1 : 0), droppedAttributes: 0 };
    for (const r of this.#nodes.values()) {
      if (r.dom.nodeType === 1) s.rendered++;
      s.droppedAttributes += r.dropped;
    }
    return s;
  }

  #patch(id: NodeId): void {
    const doc = this.#doc;
    if (!doc) return;
    if (id === doc.root) return this.render(doc);
    const node = doc.nodes.get(id);
    // Text is re-rendered with its element, so a <style> is always judged whole.
    if (node && node.kind !== 'element') return node.parent === null ? undefined : this.#patch(node.parent);
    this.#detach(id);
    const at = node?.parent ?? null;
    const parent = at === null ? undefined : this.#nodes.get(at);
    if (!node || at === null || !parent) return; // it left the document, or its parent isn't drawn
    const dom = this.#build(node, this.#inForeignObject(node), at);
    if (!dom) return void this.#skipped.set(id, at);
    parent.kids.push(id);
    // Before the next sibling already drawn under the same parent: the node's place in the model.
    const siblings = el(doc, at).children;
    const next = siblings.slice(siblings.indexOf(id) + 1).map((s) => this.#nodes.get(s)?.dom).find((d) => d?.parentNode === parent.dom);
    (parent.dom as Element).insertBefore(dom, next ?? null);
  }

  // Ids may have moved, so every attribute animation with an href is judged again against what it
  // would drive now (the browser re-binds its target when ids change).
  #rejudge(): void {
    for (const id of [...this.#linked]) this.#patch(id);
  }

  #build(node: ElementNode, inForeignObject: boolean, parent: NodeId | null): Element | null {
    const doc = this.#doc!;
    this.#detach(node.id); // drawn somewhere else before a move: the new place wins
    if (animatesAttribute(node) && (findAttr(node, null, 'href') || findAttr(node, NS.xlink, 'href'))) this.#linked.add(node.id);
    const made = sinkElement(doc, node, { inForeignObject, smilTargets: this.#smilTargets });
    if (!made) return null;
    if (node.id === doc.root) {
      const dropped = sinkAttributes(made.el, doc, node, this.#supplied(node)); // the root's viewBox
      if (dropped === null) return null;
      made.dropped = dropped;
    }
    const done: Rendered = { dom: made.el, parent, kids: [], dropped: made.dropped, id: plainId(doc, node) };
    this.#nodes.set(node.id, done);
    this.#back.set(made.el, node.id);
    const inside = inForeignObject || (node.ns === NS.svg && node.local === 'foreignObject');
    for (const id of node.children) {
      const child = doc.nodes.get(id)!;
      const dom = child.kind === 'element' ? this.#build(child, inside, node.id) : this.#text(child, node);
      if (dom) {
        made.el.append(dom);
        done.kids.push(id);
      } else if (child.kind === 'element') this.#skipped.set(id, node.id);
    }
    return made.el;
  }

  #text(node: LeafNode, parent: ElementNode): Text | null {
    this.#detach(node.id);
    const dom = sinkText(this.#doc!, node, parent);
    if (dom) {
      this.#nodes.set(node.id, { dom, parent: parent.id, kids: [], dropped: 0, id: null });
      this.#back.set(dom, node.id);
    }
    return dom;
  }

  // Take a node off the canvas: its DOM, its place under its parent, and its subtree's entries.
  #detach(id: NodeId): void {
    const old = this.#nodes.get(id);
    if (old) {
      old.dom.remove();
      const p = old.parent === null ? undefined : this.#nodes.get(old.parent);
      if (p) p.kids = p.kids.filter((k) => k !== id);
      this.#forget(id);
    }
    this.#skipped.delete(id);
  }

  #forget(id: NodeId): void {
    const r = this.#nodes.get(id);
    if (!r) return;
    this.#nodes.delete(id);
    for (const [s, p] of this.#skipped) if (p === id) this.#skipped.delete(s);
    for (const k of r.kids) if (this.#nodes.get(k)?.parent === id) this.#forget(k);
  }

  #inForeignObject(node: ElementNode): boolean {
    const doc = this.#doc!;
    for (let p = node.parent; p !== null; ) {
      const a = el(doc, p);
      if (a.ns === NS.svg && a.local === 'foreignObject') return true;
      p = a.parent;
    }
    return false;
  }

  // What an attribute animation can drive (see the sink's ElementContext): its parent when it
  // keeps no href, else every element in the document whose plain id (never xml:id, which the
  // canvas drops) a reading of the fragment names, drawn or not. None refuses it.
  #smilTargets = (node: ElementNode, ids: readonly string[] | null): ElementNode[] | null => {
    const doc = this.#doc!;
    if (ids === null) return node.parent === null ? [] : [el(doc, node.parent)];
    if (this.#ids?.version !== doc.version) this.#ids = { version: doc.version, ids: buildRefIndex(doc).ids };
    const found = [...new Set(ids.flatMap((id) => this.#ids!.ids.get(id) ?? []))].map((n) => el(doc, n)).filter((n) => {
      const own = plainId(doc, n);
      return own !== null && ids.includes(own);
    });
    return found.length ? found : null;
  };

  // What the renderer gives the root besides its own attributes: a viewBox for a root with none,
  // while its box is drawn at a scale other than 1 (see setCamera).
  #supplied(node: ElementNode): Supplied[] {
    const doc = this.#doc!;
    if (node.id !== doc.root) return [];
    this.#viewBox = this.#suppliedViewBox();
    return this.#viewBox === null ? [] : [{ local: 'viewBox', value: this.#viewBox }];
  }
}
