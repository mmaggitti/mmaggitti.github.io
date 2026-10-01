// The screen-reader preview (P1-M4 S3): roughly what a screen reader says for the drawing, computed
// from the model (never from the page's accessibility tree: the canvas host is aria-hidden). SVG
// Lab's Accessibility lesson (LabAccess.after), generalized to any file.
//
// - A root with aria-hidden="true": "hidden from screen readers." alone.
// - The name: the texts of the elements the root's aria-labelledby names (joined by one space), else
//   its aria-label, else its <title> child's text; the description: aria-describedby's texts, else its
//   <desc> child's. Each trimmed, its runs of whitespace collapsed.
// - With a name or a description, SVG Lab's sentence exactly: “<name>, image. <description>”, or
//   “Image. <description>”. With neither: "no name, so it may skip the drawing or read stray labels:
//   “Jan, Feb, …”", every <text>'s characters as laid out (text/space.ts), in document order, joined by
//   ", " (the first 20, then …); with no text at all, "no name, so it may skip the drawing.".
// - Then, when an element other than the root has its own <title>: " Titles on shapes show as tooltips
//   on hover, but role="img" hides them from screen readers." under a root role of img, else " Titles
//   on shapes show as tooltips on hover." (SVG Lab's bar titles' sentence, for any shape).
// - Neither the stray labels nor the titles note reads what a reader never reaches: an element with
//   aria-hidden="true" and everything in it (the Access tab's Hidden from screen readers writes it), and
//   the contents of <defs>, <symbol>, <clipPath>, <mask>, <marker> and <pattern> (drawn nowhere by
//   themselves).

import { NS, attrValue, descendants, el, textContent, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { renderedText } from '../text/space.ts';
import { accessOf, namedIds } from './model.ts';

export const HIDDEN = 'hidden from screen readers.';
export const MAX_LABELS = 20;

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

// Containers whose contents are drawn nowhere by themselves.
const UNDRAWN: ReadonlySet<string> = new Set(['defs', 'symbol', 'clipPath', 'mask', 'marker', 'pattern']);
/** Is this element out of a reader's reach, with everything in it (aria-hidden="true", or an undrawn container's)? */
const unread = (doc: Doc, n: ElementNode): boolean => (n.ns === NS.svg && UNDRAWN.has(n.local)) || (attrValue(doc, n, null, 'aria-hidden') ?? '').trim() === 'true';

// Every element with an id, the first one for each id (as the browser resolves a reference).
function byId(doc: Doc): Map<string, NodeId> {
  const out = new Map<string, NodeId>();
  for (const n of descendants(doc, doc.root)) {
    if (n.kind !== 'element') continue;
    const id = attrValue(doc, n, null, 'id');
    if (id !== null && !out.has(id)) out.set(id, n.id);
  }
  return out;
}

/** The stray labels: every drawn <text>'s characters as laid out, in document order. */
export function strayLabels(doc: Doc): string[] {
  const out: string[] = [];
  const walk = (id: NodeId): void => {
    for (const c of el(doc, id).children) {
      const n = doc.nodes.get(c)!;
      if (n.kind !== 'element' || n.ns !== NS.svg || unread(doc, n)) continue;
      if (n.local === 'title' || n.local === 'desc' || n.local === 'metadata') continue; // drawn nowhere
      if (n.local === 'text') {
        const t = squash(renderedText(doc, c));
        if (t) out.push(t);
        continue;
      }
      walk(c);
    }
  };
  walk(doc.root);
  return out;
}

/** Roughly what a screen reader says for the drawing (the module header). */
export function speak(doc: Doc): string {
  const a = accessOf(doc);
  if (a.hidden) return HIDDEN;
  const ids = a.labelledby !== null || a.describedby !== null ? byId(doc) : new Map<string, NodeId>();
  const named = (value: string | null) =>
    namedIds(value)
      .map((id) => ids.get(id))
      .filter((id): id is NodeId => id !== undefined)
      .map((id) => squash(textContent(doc, id)))
      .filter(Boolean)
      .join(' ');
  const name = named(a.labelledby) || squash(a.label ?? '') || squash(a.title?.text ?? '');
  const desc = named(a.describedby) || squash(a.desc?.text ?? '');
  let said: string;
  if (name || desc) said = `“${name ? `${name}, image` : 'Image'}${desc ? `. ${desc}` : ''}”`;
  else {
    const labels = strayLabels(doc);
    said = labels.length ? `no name, so it may skip the drawing or read stray labels: “${labels.slice(0, MAX_LABELS).join(', ')}${labels.length > MAX_LABELS ? ', …' : ''}”` : 'no name, so it may skip the drawing.';
  }
  if (shapeTitles(doc)) said += a.role?.trim().toLowerCase() === 'img' ? ' Titles on shapes show as tooltips on hover, but role="img" hides them from screen readers.' : ' Titles on shapes show as tooltips on hover.';
  return said;
}

/** Does an element other than the root, within a reader's reach, have its own <title> child? */
function shapeTitles(doc: Doc): boolean {
  const walk = (id: NodeId): boolean => {
    for (const c of el(doc, id).children) {
      const n = doc.nodes.get(c)!;
      if (n.kind !== 'element' || unread(doc, n)) continue;
      if (n.ns === NS.svg && n.local !== 'title' && n.children.some((k) => {
        const t = doc.nodes.get(k);
        return t?.kind === 'element' && t.ns === NS.svg && t.local === 'title';
      })) return true;
      if (walk(c)) return true;
    }
    return false;
  };
  return walk(doc.root);
}
