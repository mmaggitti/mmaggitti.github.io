// The editor's ports in the page: the real renderer, code view and overlay, attached by the
// components that own their DOM (Canvas and CodePanel) when they mount. The editor exists from the
// first render so every panel can read its stores; it drives nothing until App opens a document,
// after those components have attached.

import type { NodeId } from '../../../../engine/model/doc.ts';
import type { EditorPorts } from '../editor.ts';
import type { Renderer } from '../canvas/renderer.ts';
import type { Overlay } from '../canvas/overlay.ts';
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
        setCamera: (rect) => r().setCamera(rect),
        nodeFor: (id) => r().nodeFor(id),
        stats: () => r().stats(),
      },
      code: {
        set: (blocks) => this.code?.set(blocks),
        patch: (block) => this.code?.patch(block),
        select: (nodes) => this.code?.select(nodes),
        focus: (mark) => this.code?.focus(mark),
      },
      overlay: { outline: (ids) => this.#outline(ids) },
      hostSize: () => {
        const b = this.host?.getBoundingClientRect();
        return b ? { width: b.width, height: b.height } : { width: 0, height: 0 };
      },
      sinkReady,
    };
  }

  #outline(ids: readonly NodeId[]): void {
    if (!this.overlay || !this.renderer) return;
    const drawn = ids.map((id) => this.renderer!.nodeFor(id)).filter((d): d is SVGGraphicsElement => !!d && d.nodeType === 1 && 'getBBox' in d);
    this.overlay.outline(drawn);
  }
}
