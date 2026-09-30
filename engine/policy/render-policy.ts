// The canvas render policy: what the safe sink may materialize from a document.
//
// Draw opens files it did not write on an origin every project shares, so the canvas is an
// allowlist: elements and attributes come from the ledger's generated tables (tables.ts), URLs may
// only point inside the document, and CSS passes the served profile's guard. Event handlers and
// xml:base are refused here by rule, whatever the tables say, and so is an element that carries an
// attribute twice. Anything refused stays in the model and the file; it just never reaches the
// page. Pure functions, no DOM: the sink asks, this answers.

import { NS, type Attr, type ElementNode } from '../model/doc.ts';
import { decodeFragment } from '../values/url.ts';
import {
  RENDER_SVG_ATTRIBUTE_PATTERNS, RENDER_SVG_ATTRIBUTES, RENDER_SVG_ELEMENTS, RENDER_XHTML_ATTRIBUTE_PATTERNS, RENDER_XHTML_ATTRIBUTES, RENDER_XHTML_ELEMENTS,
} from './tables.ts';
import { cssAllowed } from '../../scripts/lib/svg-profile.mjs';

// One CSS rule for the canvas and the served profile, so a file that previews also serves.
export { cssAllowed };

/** Attributes whose value is a URL the canvas would load, keyed as attrKey() spells them. */
export const URL_ATTRIBUTES: ReadonlySet<string> = new Set(['href', 'xlink:href', 'src']);

/** Elements that may show a data: image, and the URL attribute that carries it. */
const DATA_IMAGE_ON: ReadonlyMap<string, string> = new Map([['image', 'href'], ['feImage', 'href'], ['img', 'src']]);
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp)[;,]/i;
// In CSS, fonts too: Draw embeds font subsets as data: URLs in <style>.
const CSS_DATA = /^data:(image\/(png|jpeg|gif|webp)|font\/)/i;

// The rule as written strips every ASCII whitespace and control character; the WHATWG URL parser
// trims C0 controls and spaces at the ends and drops tabs and line ends anywhere. A URL must pass
// read both ways, so a character one reading ignores can't turn a fragment into a path. asParsed is
// the reading that decides (whatever it accepts, squash accepts too); squash is the plan's rule, and
// it matters again when reading which id a kept fragment names (hrefFragmentIds).
const squash = (v: string): string => v.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
const asParsed = (v: string): string => v.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');

/** How the tables key an attribute: plain name, 'xlink:name' or 'xml:name'; null for any other namespace. */
export function attrKey(ns: string | null, local: string): string | null {
  if (ns === null) return local;
  if (ns === NS.xlink) return `xlink:${local}`;
  if (ns === NS.xml) return `xml:${local}`;
  return null;
}

/** May this element be materialized? A refused element's whole subtree is skipped. */
export function elementRenders(ns: string | null, local: string, inForeignObject: boolean): boolean {
  if (ns === NS.svg) return RENDER_SVG_ELEMENTS.has(local);
  if (ns === NS.xhtml) return inForeignObject && RENDER_XHTML_ELEMENTS.has(local);
  return false;
}

/**
 * Does an element carry the same attribute twice (same namespace and local name, whatever the
 * prefix)? XML forbids it and a browser's parser refuses the file; if one got through, the judges
 * would read one copy and the page keep another, so the element is refused.
 */
export function hasDuplicateAttrs(attrs: readonly Attr[]): boolean {
  const seen = new Set<string>();
  for (const a of attrs) {
    if (a.ns === NS.xmlns) continue;
    const key = `${a.ns ?? ''} ${a.local}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/** May this attribute be set on this element? */
export function attributeRenders(elNs: string | null, elLocal: string, attrNs: string | null, attrLocal: string): boolean {
  if (attrLocal.toLowerCase().startsWith('on')) return false; // event handlers, in any namespace
  if (attrNs === NS.xml && attrLocal === 'base') return false;
  const table = elNs === NS.svg ? RENDER_SVG_ATTRIBUTES : elNs === NS.xhtml ? RENDER_XHTML_ATTRIBUTES : null;
  const key = attrKey(attrNs, attrLocal);
  const scope = table && key !== null ? table.get(key) : undefined;
  // A name no row lists may match a pattern row (data-*, aria-*): with no namespace, on any element.
  if (!scope) return attrNs === null && (elNs === NS.svg ? RENDER_SVG_ATTRIBUTE_PATTERNS : elNs === NS.xhtml ? RENDER_XHTML_ATTRIBUTE_PATTERNS : []).some((re) => re.test(attrLocal));
  if (scope.except?.includes(elLocal)) return false;
  return scope.on === '*' || scope.on.includes(elLocal);
}

/**
 * The canvas URL allowlist: a same-document fragment anywhere, and a data: image (png, jpeg, gif,
 * webp) on image, feImage and XHTML img. Nothing else loads: no network, no paths, no other files.
 */
export function urlAllowed(elLocal: string, attrLocal: string, value: string): boolean {
  const ok = (u: string) => u.startsWith('#') || (DATA_IMAGE.test(u) && DATA_IMAGE_ON.get(elLocal) === attrLocal);
  return ok(squash(value)) && ok(asParsed(value));
}

/**
 * The ids a fragment URL the canvas kept (urlAllowed) can name: read both ways, percent-decoded as
 * browsers match ids. A character one reading keeps and the other drops gives two candidates, and
 * a judge of what the fragment points at must accept every one of them.
 */
export function hrefFragmentIds(value: string): string[] {
  return [...new Set([asParsed(value), squash(value)].map((u) => decodeFragment(u.slice(1))))];
}

// CSS escapes in one pass, as the CSS tokenizer reads them: hex (0, surrogates and out-of-range
// become U+FFFD), a line continuation (removed), or any other character (itself).
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|(\r\n|[\n\r\f])|([\s\S]))/g;
const cssChar = (h: string): string => {
  const cp = parseInt(h, 16);
  return cp === 0 || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff ? '\uFFFD' : String.fromCodePoint(cp);
};

/**
 * Every url() in CSS text stays in the document: a fragment, or a data: image or font. Presentation
 * attributes are CSS too (fill="url(…)", mask, filter, markers) and SMIL values feed them, so the
 * canvas checks every value it sets this way, not only style. Comments stay in place (a url()
 * inside one is refused, never hidden), and each url() is judged by how its argument starts, read
 * both ways as in urlAllowed, so an unclosed one is still read.
 */
export function cssUrlsLocal(css: string): boolean {
  const t = css.replace(CSS_ESCAPE, (_, hex?: string, nl?: string, ch?: string) => (hex ? cssChar(hex) : nl ? '' : ch!)).toLowerCase();
  // image-set() takes plain strings as URLs, and @import takes one without url(); refused here with
  // comments still in place, so neither can hide in text another reading treats as a comment.
  if (/image-set\s*\(|@import/.test(t)) return false;
  const ok = (u: string) => u.startsWith('#') || CSS_DATA.test(u);
  for (const m of t.matchAll(/url\s*\(\s*['"]?/g)) {
    const arg = t.slice(m.index + m[0].length);
    if (!ok(squash(arg)) || !ok(asParsed(arg))) return false;
  }
  return true;
}

const ATTRIBUTE_ANIMATIONS: ReadonlySet<string> = new Set(['animate', 'set', 'animateTransform', 'animateColor']);

/** Is this an SVG animation of a named attribute (animate, set, animateTransform, animateColor)? */
export const animatesAttribute = (el: ElementNode): boolean => el.ns === NS.svg && ATTRIBUTE_ANIMATIONS.has(el.local);

// Every SMIL element: each targets its parent, or the element its href names. (animateColor and
// discard don't render today; listed so the rule below holds if they ever do.)
const ANIMATIONS: ReadonlySet<string> = new Set(['animate', 'set', 'animateTransform', 'animateMotion', 'animateColor', 'discard']);

/** Is this an SVG animation element (animate, set, animateTransform, animateMotion, animateColor, discard)? */
export const isAnimation = (el: ElementNode): boolean => el.ns === NS.svg && ANIMATIONS.has(el.local);

/**
 * Does the canvas lose this SMIL element's target: an animation (animateMotion as much as the
 * attribute ones) whose href the canvas dropped (`kept` is the href it kept, or null), while the
 * file's own names something? The href that decides is the file's href, else its xlink:href (SVG
 * 2: href wins). Exactly "" names the parent, as both engines read it, so it loses nothing; any
 * other value the canvas dropped (a URL to another file, or " ") names nothing, so in the file
 * alone nothing animates, while the canvas, left with no href, would animate the parent: such an
 * animation goes with its href. `value` reads an attribute's decoded value.
 */
export function smilHrefLost(el: ElementNode, kept: string | null, value: (a: Attr) => string): boolean {
  if (!isAnimation(el) || kept !== null) return false;
  const href = el.attrs.find((a) => a.ns === null && a.local === 'href') ?? el.attrs.find((a) => a.ns === NS.xlink && a.local === 'href');
  return href !== undefined && value(href) !== '';
}

/**
 * May this SMIL animation be rendered? `targetAttr` is its attributeName (decoded); `target` is an
 * element it animates (its parent, or an element its kept href can name: the sink asks for each).
 * The animated attribute must render on the target, and never be a URL, style or an event handler.
 * Without a target, it must render on some SVG element. The whole animation element is dropped
 * when this is false.
 */
export function smilTargetAllowed(animationElement: ElementNode, targetAttr: string, target?: { ns: string | null; local: string }): boolean {
  if (!animatesAttribute(animationElement)) return true;
  const name = targetAttr.trim().replace(/^[^:]*:/, '');
  const lower = name.toLowerCase();
  if (lower === 'href' || lower === 'style' || lower.startsWith('on')) return false;
  if (target) return attributeRenders(target.ns, target.local, null, name);
  return RENDER_SVG_ATTRIBUTES.has(name);
}

const SPACES = /[\t\n\f\r ]+/;

/**
 * How browsers read requiredExtensions (the value decoded): true only when every token is the
 * XHTML namespace, which they support; an empty value, a leading space or any other extension is
 * false. MathML reads as true too, but the canvas doesn't render MathML, so it counts as false
 * here and the <switch> shows its fallback.
 */
export function extensionsSupported(value: string): boolean {
  if (/^[\t\n\f\r ]/.test(value)) return false;
  const tokens = value.split(SPACES).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => t === NS.xhtml);
}

/**
 * The sink's one question: the value to set for this attribute (unchanged), or null to leave it
 * off. Table and rules first, then the URL allowlist for URL attributes, the served CSS guard for
 * style, and in-document url()s for every value.
 */
export function renderValue(el: ElementNode, attr: Attr, value: string): string | null {
  if (!attributeRenders(el.ns, el.local, attr.ns, attr.local)) return null;
  // SVG 2: href wins and xlink:href is ignored, even when the href can't be used. Dropping it here
  // keeps a browser from following xlink:href where the policy dropped a relative href, so the
  // canvas, Draw's gradient chain (paint/gradients.ts) and the file alone agree. It drops more than
  // before, never less.
  if (attr.ns === NS.xlink && attr.local === 'href' && el.attrs.some((a) => a.ns === null && a.local === 'href')) return null;
  if (URL_ATTRIBUTES.has(attrKey(attr.ns, attr.local)!)) return urlAllowed(el.local, attr.local, value) ? value : null;
  if (attr.ns === null && attr.local === 'style' && !cssAllowed(value)) return null;
  return cssUrlsLocal(value) ? value : null;
}
