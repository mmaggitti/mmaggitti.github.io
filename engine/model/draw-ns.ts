// Draw's own namespace, alone in a module so that both the state it holds (draw-state.ts) and the
// exports that strip it (export/clean.ts) can name it without importing each other; and the one rule
// for what Draw made and may take away again, which both use.

import { NS, type Doc, type ElementNode } from './doc.ts';

export const DRAW_NS = 'https://mmaggitti.github.io/draw/ns';

// The kinds of element Draw makes and marks draw:made="true", so it can take them away again
// exactly: the <metadata> that holds its state (P1-M1), and the <defs> it makes for a gradient and
// the gradients themselves (P1-M2). Any other value ("yes", "True", " true"), any other element, or
// the same name in another namespace is never Draw's: Draw never removes it.
const MADE_KINDS: ReadonlySet<string> = new Set(['metadata', 'defs', 'linearGradient', 'radialGradient']);
// The kinds that only hold things: taken away (by Draw, and by the exports with Draw's state) when
// nothing of the file's is left in them. A gradient is drawing content, which the exports keep.
const MADE_HOLDERS: ReadonlySet<string> = new Set(['metadata', 'defs']);

/** Is this an element Draw made: one of its kinds, in the SVG namespace, with draw:made exactly "true"? */
export function isDrawMade(n: ElementNode): boolean {
  return n.ns === NS.svg && MADE_KINDS.has(n.local) && n.attrs.some((a) => a.ns === DRAW_NS && a.local === 'made' && a.raw === 'true');
}

/** Is this a kind Draw makes only to hold things (a <metadata> or <defs>, in the SVG namespace)? The exports ask before its draw:made goes. */
export function isHolderKind(n: ElementNode): boolean {
  return n.ns === NS.svg && MADE_HOLDERS.has(n.local);
}

/** Does it hold nothing of the file's: only whitespace text, once its draw: children are gone (no comment, no other text, no other element)? */
export function holdsOnlyDrawItems(doc: Doc, n: ElementNode): boolean {
  return n.children.every((c) => {
    const k = doc.nodes.get(c);
    return !!k && ((k.kind === 'element' && k.ns === DRAW_NS) || (k.kind === 'text' && /^[ \t\r\n]*$/.test(k.raw)));
  });
}

/** Is this Draw's own holder (<metadata>, <defs>) with nothing of the file's in it, to be taken away with Draw's state? */
export function isDrawMadeEmpty(doc: Doc, n: ElementNode): boolean {
  return isDrawMade(n) && isHolderKind(n) && holdsOnlyDrawItems(doc, n);
}

/**
 * Is this a gradient Draw made that holds nothing of the file's: only <stop> elements (in the SVG
 * namespace) and whitespace text? (A comment, text or any other element someone put in it keeps it.)
 * Draw removes one only when, besides, nothing refers to it any more.
 */
export function isDrawMadeGradient(doc: Doc, n: ElementNode): boolean {
  if (!isDrawMade(n) || isHolderKind(n)) return false;
  return n.children.every((c) => {
    const k = doc.nodes.get(c);
    return !!k && ((k.kind === 'element' && k.ns === NS.svg && k.local === 'stop') || (k.kind === 'text' && /^[ \t\r\n]*$/.test(k.raw)));
  });
}
