// Draw's own namespace, alone in a module so that both the state it holds (draw-state.ts) and the
// exports that strip it (export/clean.ts) can name it without importing each other; and the one rule
// for what Draw made and may take away again, which both use.

import { NS, type Doc, type ElementNode } from './doc.ts';

export const DRAW_NS = 'https://mmaggitti.github.io/draw/ns';

// The kinds of element Draw makes and marks draw:made="true", so it can take them away again
// exactly: in P1-M1 the <metadata> that holds its state. (A kind added here, M2's <defs> and
// gradients, is judged the same way.)
const MADE_KINDS: ReadonlySet<string> = new Set(['metadata']);

/** Is this an element Draw made: one of its kinds, in the SVG namespace, with draw:made exactly "true"? */
export function isDrawMade(n: ElementNode): boolean {
  return n.ns === NS.svg && MADE_KINDS.has(n.local) && n.attrs.some((a) => a.ns === DRAW_NS && a.local === 'made' && a.raw === 'true');
}

/** Does it hold nothing of the file's: only whitespace text, once its draw: children are gone (no comment, no other text, no other element)? */
export function holdsOnlyDrawItems(doc: Doc, n: ElementNode): boolean {
  return n.children.every((c) => {
    const k = doc.nodes.get(c);
    return !!k && ((k.kind === 'element' && k.ns === DRAW_NS) || (k.kind === 'text' && /^[ \t\r\n]*$/.test(k.raw)));
  });
}

/** Is this Draw's own element with nothing of the file's in it, to be taken away with Draw's state? */
export function isDrawMadeEmpty(doc: Doc, n: ElementNode): boolean {
  return isDrawMade(n) && holdsOnlyDrawItems(doc, n);
}
