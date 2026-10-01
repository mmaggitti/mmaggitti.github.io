// SVG's whitespace (P1-M4): the characters a <text> lays out, run by run, under the nearest
// xml:space (inherited from the element or an ancestor; SVG 1.1 §10.15, as WebKit lays text out).
//
// - default: every newline dropped, every tab a space; then the spaces at the start and the end of
//   the whole text dropped, and each run of spaces, across runs, collapsed to one;
// - preserve: every newline and tab a space, and every space kept.
// A run is one text (or CDATA) leaf of the <text>, with the element that holds it (the text, a
// tspan, a textPath or an <a>): what that element's font and paint draw. A <title>, <desc> or
// <metadata> child lays nothing out.
//
// Chromium differs in one place: under default it lays a newline out as a space (CSS's segment
// break), where WebKit and SVG 1.1 drop it, so "a⏎b" is "a b" there. Draw follows SVG 1.1, as the
// phone does; a text Draw writes (one line, or Draw's line tspans) holds no newline.
// Text to path (S2) and the screen-reader preview (S3) read text through here.

import { NS, el, type Doc, type NodeId } from '../model/doc.ts';
import { decodeText, normalizeEol } from '../xml/entities.ts';

export interface Run {
  leaf: NodeId; // the text or CDATA leaf
  owner: NodeId; // the element holding it
  text: string; // its characters as laid out (maybe '')
  preserve: boolean; // under xml:space="preserve"
}

/** Elements inside a <text> that lay nothing out. */
const SILENT = new Set(['title', 'desc', 'metadata']);

/** Is `id` (an element) or its nearest ancestor with xml:space marked preserve? */
export function preserves(doc: Doc, id: NodeId): boolean {
  for (let n: NodeId | null = id; n !== null; n = el(doc, n).parent) {
    const a = el(doc, n).attrs.find((x) => x.ns === NS.xml && x.local === 'space');
    if (a) return a.raw.trim() === 'preserve';
  }
  return false;
}

/** The text's runs in document order, with their characters as SVG lays them out (see the header). */
export function textRuns(doc: Doc, id: NodeId): Run[] {
  const runs: Run[] = [];
  const walk = (owner: NodeId, preserve: boolean): void => {
    for (const c of el(doc, owner).children) {
      const n = doc.nodes.get(c)!;
      if (n.kind === 'element') {
        if (n.ns === NS.svg && SILENT.has(n.local)) continue;
        const a = n.attrs.find((x) => x.ns === NS.xml && x.local === 'space');
        walk(c, a ? a.raw.trim() === 'preserve' : preserve);
      } else if (n.kind === 'text' || n.kind === 'cdata') {
        const raw = n.kind === 'text' ? decodeText(n.raw, doc.entities) : normalizeEol(n.raw.slice(9, -3));
        runs.push({ leaf: c, owner, text: preserve ? raw.replace(/[\n\r\t]/g, ' ') : raw.replace(/[\n\r]/g, '').replace(/\t/g, ' '), preserve });
      }
    }
  };
  walk(id, preserves(doc, id));
  // Collapse runs of default spaces (across runs), then drop the default spaces at either end.
  let prevSpace = true; // the start of the text: a leading default space goes
  for (const r of runs) {
    if (r.preserve) {
      if (r.text) prevSpace = false; // a preserved space doesn't swallow a default one after it
      continue;
    }
    let out = '';
    for (const ch of r.text) {
      if (ch === ' ') {
        if (prevSpace) continue;
        prevSpace = true;
      } else prevSpace = false;
      out += ch;
    }
    r.text = out;
  }
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    if (r.preserve) {
      if (r.text) break;
      continue;
    }
    const t = r.text.replace(/ +$/, '');
    const stop = t.length > 0;
    r.text = t;
    if (stop) break;
  }
  return runs;
}

/** The characters the text lays out, as one string. */
export function renderedText(doc: Doc, id: NodeId): string {
  return textRuns(doc, id).map((r) => r.text).join('');
}
