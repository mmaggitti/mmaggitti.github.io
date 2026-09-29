// The support ledger's kept rows (class preserve) of the current phase and earlier, found where
// they occur in the round-trip corpus. Shared by the corpus, render and served-profile tests, so
// each proves its half of a row against the same places in the same files.
//
// Elements and attributes are found by name. A property is found in CSS (a style attribute or a
// <style>), by its declaration or at-rule. A value is found by the test VALUES holds for its row:
// a value row without one fails the tests, so a new row can't pass by being looked for nowhere.

import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDoc, descendants, textContent, NS, type Attr, type Doc, type ElementNode } from '../../model/doc.ts';
import { decodeAttr } from '../../xml/entities.ts';
import { parsePath } from '../../path/parse.ts';

export interface Row {
  id: string;
  kind: string;
  name: string;
  ns?: string;
  on?: string[];
  class?: string;
  render?: boolean;
  serve?: boolean;
  phase: number;
}

/** One place a row occurs: the element that holds it and the attribute (or <style> text) it is in. */
export interface Site {
  file: string;
  el: ElementNode;
  attr: Attr | null; // null for an element row, and for CSS in a <style>
  value: string; // the attribute's decoded value, or the <style>'s text; '' for an element row
}

export interface CorpusFile {
  file: string;
  src: string;
  doc: Doc;
}

const CORPUS = fileURLToPath(new URL('../fixtures/corpus/', import.meta.url));
const ledger: { meta: { currentPhase: number }; rows: Row[] } = JSON.parse(readFileSync(new URL('../../ledger/ledger.json', import.meta.url), 'utf8'));

/** Kept rows of the current phase and earlier that name one thing (not a pattern such as data-*). */
export const KEPT: readonly Row[] = ledger.rows.filter(
  (r) => r.class === 'preserve' && r.phase <= ledger.meta.currentPhase && ['element', 'attribute', 'property', 'value'].includes(r.kind) && !/[*(]/.test(r.name),
);

export function loadCorpus(): CorpusFile[] {
  return readdirSync(CORPUS, { recursive: true, encoding: 'utf8' })
    .map((p) => p.split(sep).join('/'))
    .filter((p) => p.endsWith('.svg'))
    .sort()
    .map((file) => {
      const src = readFileSync(CORPUS + file, 'utf8');
      const r = parseDoc(src);
      if (!r.ok) throw new Error(`${file}: ${r.error.message}`);
      return { file, src, doc: r.doc };
    });
}

const COLOR_PROPS = new Set(['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color']);
// CSS Color 4 system colours, and the deprecated ones browsers still map.
const SYSTEM_COLORS = new Set([
  'accentcolor', 'accentcolortext', 'activetext', 'buttonborder', 'buttonface', 'buttontext', 'canvas', 'canvastext', 'field',
  'fieldtext', 'graytext', 'highlight', 'highlighttext', 'linktext', 'mark', 'marktext', 'selecteditem', 'selecteditemtext',
  'visitedtext', 'activeborder', 'activecaption', 'appworkspace', 'background', 'buttonhighlight', 'buttonshadow', 'captiontext',
  'inactiveborder', 'inactivecaption', 'inactivecaptiontext', 'infobackground', 'infotext', 'menu', 'menutext', 'scrollbar',
  'threeddarkshadow', 'threedface', 'threedhighlight', 'threedlightshadow', 'threedshadow', 'window', 'windowframe', 'windowtext',
]);
const color = (prop: string) => COLOR_PROPS.has(prop);
const words = (v: string) => v.replace(/url\([^)]*\)/gi, '').match(/[A-Za-z][\w-]*/g) ?? [];

/**
 * How each value row is recognised in a (property, value) pair. `css` is true for a declaration in
 * CSS and false for a presentation attribute (the property is the attribute's name).
 */
export const VALUES: Readonly<Record<string, (prop: string, value: string, css: boolean) => boolean>> = {
  'color/color-function': (p, v) => color(p) && /(?:^|[\s,(])color\(/i.test(v),
  'color/color-mix': (p, v) => color(p) && /\bcolor-mix\(/i.test(v),
  'color/relative': (p, v) => color(p) && /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*from\s/i.test(v),
  'color/light-dark': (p, v) => color(p) && /\blight-dark\(/i.test(v),
  'color/system': (p, v) => color(p) && words(v).some((w) => SYSTEM_COLORS.has(w.toLowerCase())),
  // SVG's own transform attribute takes no units; CSS transforms in style do, and 3D functions.
  'transform/css-functions': (p, v, css) => css && p === 'transform' && /\d(?:deg|rad|grad|turn|px|em|rem|%)|\b(?:\w+3d|perspective|(?:translate|scale|rotate)[XYZ])\(/i.test(v),
  'path/error-tail': (p, v, css) => !css && p === 'd' && parsePath(v).error !== null,
};

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const declarations = (css: string): [string, string][] =>
  [...stripComments(css).matchAll(/([A-Za-z-]+)\s*:\s*([^;{}]*)/g)].map((m) => [m[1].toLowerCase(), m[2].trim()]);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The attribute a ledger name means: 'xml:base' and 'xlink:href' by namespace, anything else plain. */
function attrKeyParts(name: string): [string | null, string] {
  if (name.startsWith('xlink:')) return [NS.xlink, name.slice(6)];
  if (name.startsWith('xml:')) return [NS.xml, name.slice(4)];
  return [null, name];
}

/** CSS in the document: every style attribute's value and every <style>'s text. */
function cssSites(file: string, doc: Doc): Site[] {
  const out: Site[] = [];
  for (const n of descendants(doc, doc.root)) {
    if (n.kind !== 'element') continue;
    if (n.ns === NS.svg && n.local === 'style') out.push({ file, el: n, attr: null, value: textContent(doc, n.id) });
    for (const a of n.attrs) {
      if (a.ns === null && a.local === 'style' && (n.ns === NS.svg || n.ns === NS.xhtml)) out.push({ file, el: n, attr: a, value: decodeAttr(a.raw, doc.entities) });
    }
  }
  return out;
}

/** Where a kept row occurs in one corpus file. Throws for a value row VALUES has no test for. */
export function sitesOf(row: Row, { file, doc }: CorpusFile): Site[] {
  const elements = [...descendants(doc, doc.root)].filter((n): n is ElementNode => n.kind === 'element');
  const ns = row.ns === 'xhtml' ? NS.xhtml : NS.svg;
  if (row.kind === 'element') return elements.filter((e) => e.ns === ns && e.local === row.name).map((el) => ({ file, el, attr: null, value: '' }));
  if (row.kind === 'attribute') {
    const [ans, local] = attrKeyParts(row.name);
    const on = row.on ?? [];
    return elements
      .filter((e) => e.ns === ns && (on.includes('*') || on.includes(e.local)))
      .flatMap((el) => el.attrs.filter((a) => a.ns === ans && a.local === local).map((attr) => ({ file, el, attr, value: decodeAttr(attr.raw, doc.entities) })));
  }
  if (row.kind === 'property') {
    const re = row.name.startsWith('@')
      ? new RegExp(`${escapeRe(row.name)}(?![\\w-])`, 'i')
      : new RegExp(`(?:^|[;{\\s])${escapeRe(row.name)}\\s*:`, 'i');
    return cssSites(file, doc).filter((s) => re.test(stripComments(s.value)));
  }
  const test = VALUES[row.name];
  if (!test) throw new Error(`${row.id}: no test in VALUES recognises this value row`);
  const presentation = elements.flatMap((el) =>
    el.attrs.filter((a) => a.ns === null && a.local !== 'style').map((attr) => ({ file, el, attr, value: decodeAttr(attr.raw, doc.entities) })).filter((s) => test(s.attr.local, s.value, false)),
  );
  const css = cssSites(file, doc).filter((s) => declarations(s.value).some(([p, v]) => test(p, v, true)));
  return [...presentation, ...css];
}
