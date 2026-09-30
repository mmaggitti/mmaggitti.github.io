// The editor's ports in the page: the real renderer, code view and overlay, attached by the
// components that own their DOM (Canvas and CodePanel) when they mount. The editor exists from the
// first render so every panel can read its stores; it drives nothing until App opens a document,
// after those components have attached.

import type { NodeId } from '../../../../engine/model/doc.ts';
import type { EditorPorts, Measured } from '../editor.ts';
import type { Renderer } from '../canvas/renderer.ts';
import type { Overlay } from '../canvas/overlay/index.ts';
import type { CodeView } from '../codeview/code-view.ts';
import { sinkReady } from '../canvas/safe-sink.ts';

export class Views {
  renderer: Renderer | null = null;
  overlay: Overlay | null = null;
  code: CodeView | null = null;
  host: HTMLElement | null = null;
  readonly ports: EditorPorts;

  constructor() {
    const r = () => {
      if (!this.renderer) throw new Error('the canvas is not attached');
      return this.renderer;
    };
    this.ports = {
      canvas: {
        render: (doc) => r().render(doc),
        patchAttributes: (id) => r().patchAttributes(id),
        patchSubtree: (id) => r().patchSubtree(id),
        setCamera: (camera) => r().setCamera(camera),
        nodeFor: (id) => r().nodeFor(id),
        stats: () => r().stats(),
        clear: () => r().clear(),
        motion: () => r().motion(),
        play: (on) => r().play(on),
        measure: (ids) => this.#measure(ids),
      },
      code: {
        set: (blocks) => this.code?.set(blocks),
        patch: (block) => this.code?.patch(block),
        place: (blocks, before) => this.code?.place(blocks, before),
        remove: (keys) => this.code?.remove(keys),
        select: (nodes) => this.code?.select(nodes),
        focus: (mark) => this.code?.focus(mark),
        readOnly: (on) => this.code?.readOnly(on),
        source: (text, at) => this.code?.source(text, at),
      },
      overlay: { show: (model) => this.overlay?.show(model) },
      hostSize: () => {
        const b = this.host?.getBoundingClientRect();
        return b ? { width: b.width, height: b.height } : { width: 0, height: 0 };
      },
      remPx: () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 12,
      sinkReady,
    };
  }

  // Each drawn graphics element's getBBox, and its getScreenCTM less the host's offset: its own
  // units → host px. An element with no box (not rendered, in <defs>) is left out.
  #measure(ids: readonly NodeId[]): Map<NodeId, Measured> {
    const out = new Map<NodeId, Measured>();
    if (!this.renderer || !this.host || !ids.length) return out;
    const h = this.host.getBoundingClientRect();
    for (const id of ids) {
      const el = this.renderer.nodeFor(id);
      if (!el || el.nodeType !== 1 || !('getBBox' in el)) continue;
      const g = el as SVGGraphicsElement;
      let b: DOMRect;
      try {
        b = g.getBBox();
      } catch {
        continue;
      }
      const m = g.getScreenCTM();
      if (!m) continue;
      out.set(id, { box: { x: b.x, y: b.y, width: b.width, height: b.height }, toHost: [m.a, m.b, m.c, m.d, m.e - h.left, m.f - h.top] });
    }
    return out;
  }
}
