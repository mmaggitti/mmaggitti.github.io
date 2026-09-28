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
// root must be an SVG <svg>. The sink's canvas stylesheet makes it fill the host and stops CSS
// animations under prefers-reduced-motion, when its SMIL animations also start paused. The view
// (zoom and pan) is the rendered root's viewBox, set by setCamera: never the file's. An edit writes
// only the attributes that changed, so a scrub frame is one attribute mutation on the canvas.

import { NS, attrValue, el, findAttr, type Doc, type ElementNode, type LeafNode, type NodeId } from '../../../../engine/model/doc.ts';
import { buildRefIndex } from '../../../../engine/model/refs.ts';
import { animatesAttribute } from '../../../../engine/policy/render-policy.ts';
import { fmt } from '../../../../engine/values/number-format.ts';
import { canvasSheet, resetInheritedFont, sinkAttributes, sinkElement, sinkText, type Supplied } from './safe-sink.ts';
import { rootSize } from './artboard.ts';
import type { Rect } from './viewport.ts';

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

export class Renderer {
  #host: ShadowRoot;
  #doc: Doc | null = null;
  #nodes = new Map<NodeId, Rendered>();
  #skipped = new Map<NodeId, NodeId>(); // refused element → the drawn parent that skipped it
  #linked = new Set<NodeId>(); // attribute animations with an href, whose target follows the ids
  #rootSkipped = false;
  #ids: { version: number; ids: Map<string, NodeId[]> } | null = null;
  #back = new WeakMap<Node, NodeId>(); // drawn node → its NodeId, for hit testing
  #camera: string | null = null; // the viewBox the view gives the root, or null for the file's own

  constructor(host: ShadowRoot) {
    this.#host = host;
    host.adoptedStyleSheets = [canvasSheet()];
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
      if (dom && reducedMotion()) (dom as SVGSVGElement).pauseAnimations();
    } catch (e) {
      [this.#doc, this.#nodes, this.#skipped, this.#linked, this.#ids] = prev;
      throw e;
    }
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
   * The document rectangle the canvas shows: the rendered root's viewBox (the file itself is never
   * changed), or null to show the file's own. Written through the sink like any attribute.
   */
  setCamera(rect: Rect | null): void {
    const next = rect && [rect.x, rect.y, rect.width, rect.height].map((n) => fmt(n, 6)).join(' '); // fmt throws on a non-finite side
    if (next === this.#camera) return;
    this.#camera = next;
    const doc = this.#doc;
    if (doc && this.#nodes.get(doc.root)) this.patchAttributes(doc.root);
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

  // What the renderer gives the root besides its own attributes: the camera's viewBox, or, with no
  // camera, a viewBox for a document with a size but none, so it scales to the host like any other.
  #supplied(node: ElementNode): Supplied[] {
    const doc = this.#doc!;
    if (node.id !== doc.root) return [];
    if (this.#camera !== null) return [{ local: 'viewBox', value: this.#camera }];
    if (attrValue(doc, node, null, 'viewBox') !== null) return [];
    const size = rootSize(doc, node);
    return size ? [{ local: 'viewBox', value: `0 0 ${fmt(size.width)} ${fmt(size.height)}` }] : [];
  }
}
