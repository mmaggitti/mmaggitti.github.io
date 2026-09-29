// The safe sink: the only code that writes document content into the page.
//
// Draw renders files it did not write, on an origin every project on the site shares, so nothing
// from a document reaches the DOM except through here (tools/check-sinks.mjs bans making or filling
// nodes, attributes, text and stylesheets everywhere else). Every write asks two independent judges:
// - the render policy (engine/policy/render-policy.ts, built from the support ledger): which
//   elements, which attributes, which URLs and which CSS;
// - DOMPurify's isValidAttribute, a second opinion from a different codebase. Both must agree.
// Without a working DOMPurify the sink renders nothing: it fails closed.
//
// Values are the engine's decoded values (what a browser's parser would have produced), text goes
// in as text nodes, and comments, processing instructions, the DOCTYPE and CDATA markers never
// reach the page. The canvas's own stylesheet is made here too: app CSS, never document content,
// but it is a stylesheet write, and those live only here.

import DOMPurify, { type Config, type DOMPurify as Purifier } from 'dompurify';
import { NS, findAttr, type Attr, type Doc, type ElementNode, type LeafNode, textContent } from '../../../../engine/model/doc.ts';
import { decodeAttr } from '../../../../engine/xml/entities.ts';
import {
  animatesAttribute, attrKey, cssAllowed, cssUrlsLocal, elementRenders, extensionsSupported, hasDuplicateAttrs, hrefFragmentIds, renderValue,
  smilTargetAllowed,
} from '../../../../engine/policy/render-policy.ts';

// DOMPurify's own instance, so no other code can change its config. ADD_ATTR widens its allowlist
// only for SVG presentation attributes it does not list yet; each takes keywords, angles or a
// string, never a URL or CSS:
// - glyph-orientation-horizontal, glyph-orientation-vertical (angles);
// - text-overflow (clip, ellipsis or a string);
// - unicode-bidi, white-space (keywords).
// Everything else it refuses stays refused, including SMIL from/to/calcMode, fr, the light
// source's pointsAt*/limitingConeAngle, textPath side/spacing, requiredFeatures/Extensions and
// xml:lang.
// SANITIZE_DOM is off: it drops ordinary ids that happen to name a document or form property
// (close, blur, title), which breaks every url(#…) and href="#…" to them, and it protects nothing
// here. An element in a shadow tree is never a named property of window or document, and the
// policy never renders `name`. (A light-DOM fallback would rely on its id prefixes instead.)
const CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  ADD_ATTR: ['glyph-orientation-horizontal', 'glyph-orientation-vertical', 'text-overflow', 'unicode-bidi', 'white-space'],
  SANITIZE_DOM: false,
};

function load(): Purifier | null {
  if (typeof window === 'undefined') return null;
  try {
    const p = DOMPurify(window);
    if (!p.isSupported || typeof p.isValidAttribute !== 'function') return null;
    p.setConfig(CONFIG);
    return p;
  } catch {
    return null;
  }
}
const purify = load();

/** False when DOMPurify is missing or unsupported: then the sink renders nothing. */
export const sinkReady = (): boolean => purify !== null;

const isStyle = (n: ElementNode) => n.ns === NS.svg && n.local === 'style';
// A <style>'s text is judged whole: the served profile's guard, and every url() stays in the file.
const cssOk = (css: string) => cssAllowed(css) && cssUrlsLocal(css);

/** An attribute the renderer supplies (the root's viewBox: the camera), judged like any other. */
export interface Supplied {
  local: string;
  value: string;
}

interface Judged {
  ns: string | null;
  local: string;
  key: string; // the qualified name it is written under
  value: string;
}

// Queue one attribute if the policy renders it and DOMPurify agrees; the value is never changed.
function set(plan: Judged[], node: ElementNode, attr: Pick<Attr, 'ns' | 'local'>, value: string): boolean {
  const key = attrKey(attr.ns, attr.local);
  const out = key === null ? null : renderValue(node, attr as Attr, value);
  if (out === null || key === null || !purify?.isValidAttribute(node.local, key, out)) return false;
  plan.push({ ns: attr.ns, local: attr.local, key, value: out });
  return true;
}

const keyOf = (ns: string | null, local: string) => `${ns ?? ''} ${local}`;

// Make the element's attributes exactly the judged ones, touching only what differs, so a scrub
// frame is one attribute mutation. Kept attributes stay where they are and new ones go last; when
// that would not be the judged order (an undo put one back in the middle), every attribute is
// written again in order, as a fresh render writes them.
function write(target: Element, plan: readonly Judged[]): void {
  const want = new Set(plan.map((p) => keyOf(p.ns, p.local)));
  for (const a of [...target.attributes]) if (!want.has(keyOf(a.namespaceURI, a.localName))) target.removeAttributeNode(a);
  const have = [...target.attributes].map((a) => keyOf(a.namespaceURI, a.localName));
  if (!have.every((k, i) => k === keyOf(plan[i].ns, plan[i].local))) {
    while (target.attributes.length) target.removeAttributeNode(target.attributes[0]);
  }
  for (const p of plan) {
    if (target.getAttributeNS(p.ns, p.local) === p.value) continue;
    if (p.ns === null) target.setAttribute(p.local, p.value);
    else target.setAttributeNS(p.ns, p.key, p.value);
  }
}

export interface ElementContext {
  inForeignObject: boolean;
  /**
   * For an attribute animation, the elements it can drive, given the ids its kept href can name
   * (null when it keeps no href, so it animates its parent). Null back refuses it: a fragment that
   * names nothing must not fall back to "renders on some element". Without this, the animated
   * attribute must render on some SVG element.
   */
  smilTargets?: (node: ElementNode, ids: readonly string[] | null) => readonly ElementNode[] | null;
}

/** A rendered copy of a document element with every attribute both judges allow, or null if it is refused. */
export function sinkElement(doc: Doc, node: ElementNode, ctx: ElementContext): { el: Element; dropped: number } | null {
  if (!purify || node.ns === null || !elementRenders(node.ns, node.local, ctx.inForeignObject)) return null;
  if (isStyle(node) && !cssOk(textContent(doc, node.id))) return null;
  const el = document.createElementNS(node.ns, node.local);
  const dropped = sinkAttributes(el, doc, node);
  return dropped === null || !smilOk(doc, node, el, ctx) ? null : { el, dropped };
}

// An attribute animation renders only if what it animates renders on every element it can drive.
// Its target is read from what was just set (the plain href wins over xlink:href only when both
// are on the element), so the judge and the browser resolve the same one.
function smilOk(doc: Doc, node: ElementNode, el: Element, ctx: ElementContext): boolean {
  if (!animatesAttribute(node)) return true;
  const a = findAttr(node, null, 'attributeName');
  const name = a ? decodeAttr(a.raw, doc.entities) : '';
  if (!ctx.smilTargets) return smilTargetAllowed(node, name);
  const kept = el.getAttributeNS(null, 'href') ?? el.getAttributeNS(NS.xlink, 'href');
  const targets = ctx.smilTargets(node, kept === null ? null : hrefFragmentIds(kept));
  return targets !== null && targets.every((t) => smilTargetAllowed(node, name, t));
}

/**
 * Make a rendered element's attributes the model's (plus any the renderer supplies, which replace
 * the model's own of that name): the number the judges dropped, or null when the element must not
 * render at all (one that carries an attribute twice, for one). Only attributes that differ are
 * written. Namespace declarations aren't attributes here.
 */
export function sinkAttributes(target: Element, doc: Doc, node: ElementNode, supplied: readonly Supplied[] = []): number | null {
  if (!purify || hasDuplicateAttrs(node.attrs)) return null;
  const plan: Judged[] = [];
  let dropped = 0;
  for (const a of node.attrs) {
    if (a.ns === NS.xmlns) continue;
    const value = decodeAttr(a.raw, doc.entities);
    if (a.ns === null && a.local === 'requiredExtensions') {
      // DOMPurify never sets it, and leaving it off makes the element unconditional (Illustrator's
      // private-data foreignObject would beat the artwork in its <switch>). So an extension browsers
      // read as false refuses the element; XHTML, which they read as true, is simply left off.
      if (!extensionsSupported(value)) return null;
      dropped++;
    } else if (!set(plan, node, a, value)) dropped++;
  }
  const own = new Set(supplied.map((s) => s.local));
  const judged = plan.filter((p) => !(p.ns === null && own.has(p.local)));
  for (const s of supplied) set(judged, node, { ns: null, local: s.local }, s.value);
  write(target, judged);
  return dropped;
}

/** A text or CDATA node's text as a Text node; null for comments, PIs, the DOCTYPE and refused CSS. */
export function sinkText(doc: Doc, node: LeafNode, parent: ElementNode): Text | null {
  if (!purify || (node.kind !== 'text' && node.kind !== 'cdata')) return null;
  if (isStyle(parent) && !cssOk(textContent(doc, parent.id))) return null;
  return document.createTextNode(textContent(doc, node.id));
}

// The app's own rules for the canvas's shadow root, adopted by the renderer. As !important author
// rules they outrank the document's normal CSS (its own !important inline styles can still win):
// - the rendered root fills the host whatever the document sizes it to;
// - reduced motion stops CSS animations and transitions, as ds.css does for the app (its rule
//   can't cross the shadow boundary; the renderer pauses SMIL), until Play (draw-play); Pause
//   (draw-held) holds them on their frame.
const CANVAS_CSS = `:host > svg { width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important }
@media (prefers-reduced-motion: reduce) { :host(:not(.draw-play):not(.draw-held)) *, :host(:not(.draw-play):not(.draw-held)) *::before, :host(:not(.draw-play):not(.draw-held)) *::after { animation: none !important; transition: none !important }
:host(.draw-held) *, :host(.draw-held) *::before, :host(.draw-held) *::after { animation-play-state: paused !important; transition: none !important } }`;
let canvas: CSSStyleSheet | null = null;

/** The canvas's own stylesheet (made once, on first use). */
export function canvasSheet(): CSSStyleSheet {
  if (!canvas) {
    canvas = new CSSStyleSheet();
    canvas.replaceSync(CANVAS_CSS);
  }
  return canvas;
}

/**
 * Keep the app's font out of the drawing where `all: initial` can't. app.css resets the canvas host
 * with `all: initial`, but WebKit keeps the inherited font-family for it (its initial family list is
 * empty), so a font-less <text> would take the app's font instead of the one it has opened on its
 * own. Test whether the reset really stops an inherited family; where it doesn't, name the standard
 * font the way WebKit reports it for a file on its own (-webkit-standard). A no-op in Chromium.
 */
export function resetInheritedFont(root: ShadowRoot): void {
  const outer = document.createElement('span');
  outer.style.fontFamily = 'draw-probe';
  const inner = outer.appendChild(document.createElement('span'));
  inner.style.setProperty('all', 'initial');
  root.append(outer);
  const kept = getComputedStyle(inner).fontFamily === 'draw-probe';
  outer.remove();
  if (kept && root.host instanceof HTMLElement) root.host.style.fontFamily = '-webkit-standard';
}
