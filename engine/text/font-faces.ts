// A document's own fonts, and the faces its text asks for (P1-M4).
//
// - fontFaces(doc): every @font-face rule in the <style> elements the canvas renders (SVG <style>
//   whose text passes the canvas's CSS guards: cssAllowed and cssUrlsLocal), at the top level or in
//   a grouping rule, each from its FIRST src that is a url(data:font/…;base64,…) whose format() is
//   woff2, woff, truetype or opentype, or absent (local() and anything else skipped). The base64 is
//   decoded with whitespace ignored. At most 5 MB a face and 20 MB in all; what is over is counted by
//   family. Read again only when the document's <style> text changes (doc.styleVersion), and each
//   <style>'s guard verdict is kept by its text, so an edit to one judges only that one again.
// - The name guard (appFontName): a family the page must never register from a file, because the
//   app's own UI draws with it (ds.css's --font-ui and --font-mono), or because it is a CSS generic
//   family or a CSS-wide keyword. src/platform/fonts.ts registers a file's own faces page-wide
//   (document.fonts), so a face named like one of these would restyle Draw itself.
// - usedFaces(doc, held): for every run of every <text> that lays characters out (space.ts), the
//   first family of its computed font-family that the drawing's own faces hold, or `held` says Draw
//   holds (yours, the catalogue), with its computed weight (normal 400, bold 700, bolder and lighter
//   resolved against the parent's, as CSS Fonts 4 resolves them) and style (oblique as italic); a
//   generic family first in the list needs nothing, and a value a <style> rule may decide is skipped
//   (Draw can't evaluate selectors: P2). Deduplicated, in document order.

import { NS, descendants, textContent, type Doc, type NodeId } from '../model/doc.ts';
import { fontFaceBodies, declarations } from '../geometry/css.ts';
import { cssUrlsLocal } from '../policy/render-policy.ts';
import { cssAllowed } from '../../scripts/lib/svg-profile.mjs';
import { ruleWins, styleSource } from '../style/where.ts';
import { textRuns } from './space.ts';

export type FontFormat = 'woff2' | 'woff' | 'truetype' | 'opentype';

export interface OwnFace {
  family: string; // as declared, unquoted
  weight: string; // the descriptors as written ('normal' when absent): FontFace takes them as they are
  style: string;
  stretch: string;
  unicodeRange: string;
  format: FontFormat | null; // its format(), or null (absent)
  bytes: Uint8Array;
  styleId: NodeId; // the <style> that declares it
}

export interface OwnFaces {
  faces: OwnFace[];
  /** Families of the faces over the limits (5 MB a face, 20 MB in all), one entry per face. */
  over: string[];
}

export interface FaceRequest {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
}

export const FACE_MAX = 5_000_000;
export const FACES_MAX = 20_000_000;

/** The CSS generic families. */
export const GENERIC_FAMILIES: ReadonlySet<string> = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong']);
/** The CSS-wide keywords (and `default`, reserved in a family list). */
const KEYWORDS: ReadonlySet<string> = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default']);
/**
 * The app's own font stacks, exactly as ds/ds.css writes --font-ui and --font-mono (a unit test
 * compares them), so a new UI font can't slip past the guard. And WebKit's standard font, which the
 * canvas host names where `all: initial` keeps an inherited family (safe-sink.ts resetInheritedFont).
 */
export const UI_STACKS: readonly string[] = [
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  '-webkit-standard',
];

/** A font-family list's families: quotes taken off, an unquoted name's spaces collapsed. */
export function familyList(value: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  const push = () => {
    const t = cur.trim();
    if (t) out.push(/^(['"]).*\1$/s.test(t) ? t.slice(1, -1).replace(/\\(.)/g, '$1') : t.replace(/\s+/g, ' ').replace(/\\(.)/g, '$1'));
    cur = '';
  };
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      cur += c;
      if (c === '\\') cur += value[++i] ?? '';
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ',') push();
    else cur += c;
  }
  push();
  return out;
}

const UI_NAMES: ReadonlySet<string> = new Set(UI_STACKS.flatMap(familyList).map((f) => f.toLowerCase()));

/** Is this a family name the page must never register from a file (see the header)? */
export function appFontName(family: string): boolean {
  const f = family.trim().replace(/^(['"])(.*)\1$/s, '$2').trim().toLowerCase();
  return UI_NAMES.has(f) || GENERIC_FAMILIES.has(f) || KEYWORDS.has(f);
}

// ── a document's own faces ─────────────────────────────────────────────────────────────────────

const FORMATS: Readonly<Record<string, FontFormat>> = { woff2: 'woff2', woff: 'woff', truetype: 'truetype', opentype: 'opentype', 'woff2-variations': 'woff2', 'woff-variations': 'woff', 'truetype-variations': 'truetype', 'opentype-variations': 'opentype' };
const DATA_FONT = /^data:font\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[^;,]*)*;base64,([\s\S]*)$/i;

// The src list's items, split at commas outside strings and parentheses.
function srcItems(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let a = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(src.slice(a, i));
      a = i + 1;
    }
  }
  out.push(src.slice(a));
  return out.map((s) => s.trim()).filter(Boolean);
}

// One src item's data: font payload (base64) and format, or null when it isn't one Draw takes.
function dataSource(item: string): { base64: string; format: FontFormat | null } | null {
  const m = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)\s*(.*)$/is.exec(item);
  if (!m) return null;
  const url = m[1] ?? m[2] ?? m[3] ?? '';
  const d = DATA_FONT.exec(url.trim());
  if (!d) return null;
  const rest = m[4].trim();
  let format: FontFormat | null = null;
  if (rest) {
    const f = /^format\(\s*(?:"([^"]*)"|'([^']*)'|([a-z0-9-]+))\s*\)/i.exec(rest);
    if (!f) return null;
    format = FORMATS[(f[1] ?? f[2] ?? f[3]).toLowerCase()] ?? null;
    if (!format) return null;
  }
  return { base64: d[1], format };
}

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/[\s]/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const cache = new WeakMap<Doc, { version: number; read: OwnFaces }>();
// The canvas's CSS guards' verdict on each <style>, by its text: a <style> edit judges only that one again.
const judged = new WeakMap<Doc, Map<NodeId, { css: string; ok: boolean }>>();

function drawn(doc: Doc, id: NodeId, css: string): boolean {
  let seen = judged.get(doc);
  if (!seen) judged.set(doc, (seen = new Map()));
  const hit = seen.get(id);
  if (hit && hit.css === css) return hit.ok;
  const ok = cssAllowed(css) && cssUrlsLocal(css);
  seen.set(id, { css, ok });
  return ok;
}

/** The document's own faces (see the header), cached by its <style> text. `limits`: a test's own (not cached). */
export function fontFaces(doc: Doc, limits: { face: number; total: number } = { face: FACE_MAX, total: FACES_MAX }): OwnFaces {
  const usual = limits.face === FACE_MAX && limits.total === FACES_MAX;
  const hit = usual ? cache.get(doc) : undefined;
  if (hit && hit.version === doc.styleVersion) return hit.read;
  const read: OwnFaces = { faces: [], over: [] };
  let total = 0;
  for (const n of descendants(doc, doc.root)) {
    if (n.kind !== 'element' || n.ns !== NS.svg || n.local !== 'style') continue;
    const css = textContent(doc, n.id);
    if (!drawn(doc, n.id, css)) continue; // the canvas draws none of it
    for (const body of fontFaceBodies(css)) {
      const desc = new Map<string, string>();
      for (const d of declarations(body)) desc.set(d.name, d.value);
      const family = familyList(desc.get('font-family') ?? '')[0];
      if (!family) continue;
      const src = srcItems(desc.get('src') ?? '').map(dataSource).find((s) => s !== null);
      if (!src) continue;
      const size = Math.floor((src.base64.replace(/[\s=]/g, '').length * 3) / 4);
      if (size > limits.face || total + size > limits.total) {
        read.over.push(family);
        continue;
      }
      const bytes = decodeBase64(src.base64);
      if (!bytes) continue;
      total += bytes.length;
      read.faces.push({ family, weight: desc.get('font-weight') ?? 'normal', style: desc.get('font-style') ?? 'normal', stretch: desc.get('font-stretch') ?? 'normal', unicodeRange: desc.get('unicode-range') ?? 'U+0-10FFFF', format: src.format, bytes, styleId: n.id });
    }
  }
  if (usual) cache.set(doc, { version: doc.styleVersion, read });
  return read;
}

// ── the faces the text asks for ────────────────────────────────────────────────────────────────

// CSS Fonts 4's bolder and lighter.
const bolder = (w: number) => (w < 350 ? 400 : w < 550 ? 700 : 900);
const lighter = (w: number) => (w < 100 ? w : w < 550 ? 100 : w < 750 ? 400 : 700);

// The element and its ancestors, root first.
function chain(doc: Doc, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  for (let n: NodeId | null = id; n !== null; n = doc.nodes.get(n)!.parent) out.unshift(n);
  return out;
}

/** The computed font-weight (a number), or null when a <style> rule may decide it. */
export function computedWeight(doc: Doc, id: NodeId): number | null {
  let w: number | null = 400;
  for (const n of chain(doc, id)) {
    const s = styleSource(doc, n, 'font-weight');
    if (ruleWins(s)) {
      w = null;
      continue;
    }
    const v = s.value?.toLowerCase();
    if (!v || v === 'inherit' || v === 'unset') continue;
    if (v === 'initial' || v === 'normal') w = 400;
    else if (v === 'bold') w = 700;
    else if (v === 'bolder') w = w === null ? null : bolder(w);
    else if (v === 'lighter') w = w === null ? null : lighter(w);
    else if (/^\d+(?:\.\d+)?$/.test(v) && Number(v) >= 1 && Number(v) <= 1000) w = Number(v);
  }
  return w;
}

/** The computed font-style as a face's style (oblique matches an italic face), or null when a <style> rule may decide it. */
export function computedStyle(doc: Doc, id: NodeId): 'normal' | 'italic' | null {
  let s: 'normal' | 'italic' | null = 'normal';
  for (const n of chain(doc, id)) {
    const src = styleSource(doc, n, 'font-style');
    if (ruleWins(src)) {
      s = null;
      continue;
    }
    const v = src.value?.toLowerCase();
    if (!v || v === 'inherit' || v === 'unset') continue;
    if (v === 'initial' || v === 'normal') s = 'normal';
    else if (v === 'italic' || v.startsWith('oblique')) s = 'italic';
  }
  return s;
}

/** The computed font-family list, or null when a <style> rule may decide it. */
export function computedFamilies(doc: Doc, id: NodeId): string[] | null {
  for (const n of chain(doc, id).reverse()) {
    const s = styleSource(doc, n, 'font-family');
    if (ruleWins(s)) return null;
    const v = s.value?.trim();
    if (!v || /^(inherit|unset)$/i.test(v)) continue;
    if (/^initial$/i.test(v)) return [];
    return familyList(v);
  }
  return [];
}

/** The faces the document's text asks for (see the header). `held`: does Draw hold a file for this family (yours, the catalogue)? */
export function usedFaces(doc: Doc, held: (family: string) => boolean = () => false): FaceRequest[] {
  const own = new Set(fontFaces(doc).faces.map((f) => f.family.toLowerCase()));
  const out = new Map<string, FaceRequest>();
  for (const n of descendants(doc, doc.root)) {
    if (n.kind !== 'element' || n.ns !== NS.svg || n.local !== 'text') continue;
    for (const run of textRuns(doc, n.id)) {
      if (!run.text) continue;
      const families = computedFamilies(doc, run.owner);
      const family = families && families.find((f) => GENERIC_FAMILIES.has(f.toLowerCase()) || own.has(f.toLowerCase()) || held(f));
      if (!family || GENERIC_FAMILIES.has(family.toLowerCase())) continue;
      const weight = computedWeight(doc, run.owner);
      const style = computedStyle(doc, run.owner);
      if (weight === null || style === null) continue;
      const key = `${family.toLowerCase()}|${weight}|${style}`;
      if (!out.has(key)) out.set(key, { family, weight, style });
    }
  }
  return [...out.values()];
}
