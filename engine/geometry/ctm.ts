// Coordinate systems: where an element's own user units land on the root, and on the root's box.
//
// - rootTransform (M): the root's viewBox and preserveAspectRatio fitted into its viewport at 100%
//   (W0 × H0 CSS px, the camera box's size before zoom); the identity for a root with no valid
//   viewBox (absent, invalid, or disabled by a zero size, which draws nothing).
// - ownTransform: an element's `transform` (the attribute) with its `transform-origin` (attribute
//   or style="") applied as T(o)·T·T(−o). The origin resolves against `transform-box`: view-box
//   (the default: the nearest viewport's viewBox size, else its size, placed at the origin of user
//   space), or fill-box (the element's own bounds; content-box and border-box act as fill-box for
//   SVG). Browsers read transform-box from CSS only, never as an attribute (Chromium, probed in
//   P1-M1), so its attribute is ignored here too.
// - placement: an element's user units in its parent's: its own transform, and for a nested <svg>
//   then translate(x, y)·viewportTransform(its viewBox into its width × height), which is also what
//   the browser's getScreenCTM of a nested <svg> includes (its getBBox is its content, inside).
// - userCtm: the element's user units in the root's (the placements from the root down);
//   elementCtm: M·userCtm, in box px at 100%.
//
// Null wherever a part is unknown: a transform CSS sets (a style declaration or a <style> rule), a
// transform list this parser can't read (CSS units, CSS syntax), an origin or box a <style> rule
// sets (for a transform that isn't a plain translation), a nested viewport whose size is unknown,
// and anything inside a container that draws only where it is referenced (defs, symbol, clipPath,
// mask, pattern, marker) or outside SVG's own containers (g, a, switch, svg).

import { NS, attrValue, el, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { IDENTITY, invert, multiply, translate, type Affine } from '../values/affine.ts';
import { parseTransform } from '../values/transform.ts';
import { parseLength } from '../values/length.ts';
import { DEFAULT_PAR, parsePar, parseViewBox, viewportTransform, type ViewBox } from '../values/viewbox.ts';
import { cssSets, inlineDecl } from './css.ts';
import { fontSizeOf, resolveLength, type Axis } from './lengths.ts';

export interface Size {
  width: number;
  height: number;
}

/** What geometry needs from outside the file: the root's viewport at 100%, and the page's rem. */
export interface GeoContext {
  /** The root's viewport in CSS px at 100% (W0 × H0): what % resolves against without a viewBox. */
  viewport: Size;
  /** CSS px per rem on the page the drawing is on, or null when unknown (rem geometry is then null). */
  remPx: number | null;
}

const CONTAINERS = new Set(['g', 'a', 'switch', 'svg']);
export const REFERENCED_ONLY = new Set(['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker', 'linearGradient', 'radialGradient', 'filter']);

const isSvg = (n: ElementNode, local?: string) => n.ns === NS.svg && (local === undefined || n.local === local);

/** The root's viewBox, when valid; 'disabled' for a zero size; null when absent or invalid. */
function validViewBox(doc: Doc, n: ElementNode): ViewBox | 'disabled' | null {
  const raw = attrValue(doc, n, null, 'viewBox');
  return raw === null ? null : parseViewBox(raw);
}

function parOf(doc: Doc, n: ElementNode) {
  const raw = attrValue(doc, n, null, 'preserveAspectRatio');
  return (raw === null ? null : parsePar(raw)) ?? DEFAULT_PAR;
}

/** M: root user units → the root's box px at 100% (its viewport W0 × H0). */
export function rootTransform(doc: Doc, viewport: Size): Affine {
  const root = el(doc, doc.root);
  const vb = validViewBox(doc, root);
  if (!vb || vb === 'disabled') return IDENTITY;
  return viewportTransform(vb, parOf(doc, root), viewport.width, viewport.height);
}

/** The ancestors of an element from the root down, the element last. */
export function lineage(doc: Doc, id: NodeId): ElementNode[] {
  const out: ElementNode[] = [];
  for (let n: ElementNode | undefined = el(doc, id); n; n = n.parent === null ? undefined : (doc.nodes.get(n.parent) as ElementNode | undefined)) out.unshift(n);
  return out;
}

/** The size % resolves against inside viewport element `v` (its viewBox size, else its own size). */
export function viewportSize(doc: Doc, v: ElementNode, ctx: GeoContext): { w: number; h: number } | null {
  const vb = validViewBox(doc, v);
  if (vb === 'disabled') return null;
  if (vb) return { w: vb.w, h: vb.h };
  if (v.id === doc.root) return { w: ctx.viewport.width, h: ctx.viewport.height };
  const box = nestedViewport(doc, v, ctx);
  return box ? { w: box.width, h: box.height } : null;
}

/** The nearest viewport element above `id` (the <svg> whose units its attributes use). */
export function nearestViewport(doc: Doc, id: NodeId): ElementNode {
  const n = el(doc, id);
  for (let p = n.parent === null ? undefined : (doc.nodes.get(n.parent) as ElementNode | undefined); p; p = p.parent === null ? undefined : (doc.nodes.get(p.parent) as ElementNode | undefined)) {
    if (isSvg(p, 'svg') || p.id === doc.root) return p;
  }
  return el(doc, doc.root);
}

/** One attribute of `n` as a length in user units: `fallback` when absent, null when unknown. */
export function lengthAttr(doc: Doc, n: ElementNode, local: string, axis: Axis, ctx: GeoContext, fallback: number | null = 0): number | null {
  const raw = attrValue(doc, n, null, local);
  if (raw === null) return fallback;
  return resolveLength(raw, lengthCtx(doc, n, axis, ctx, raw));
}

/** The context a length on `n` resolves in (the font size is looked up only for em). */
export function lengthCtx(doc: Doc, n: ElementNode, axis: Axis, ctx: GeoContext, raw = '') {
  const em = /em\s*$/i.test(raw) && !/rem\s*$/i.test(raw);
  return {
    axis,
    fontSize: em ? fontSizeOf(doc, n.id, ctx.remPx) : null,
    remPx: ctx.remPx,
    viewport: n.id === doc.root ? { w: ctx.viewport.width, h: ctx.viewport.height } : viewportSize(doc, nearestViewport(doc, n.id), ctx),
  };
}

/** A nested <svg>'s viewport in its parent's user units (x, y, width, height; auto is 100%). */
export function nestedViewport(doc: Doc, n: ElementNode, ctx: GeoContext): { x: number; y: number; width: number; height: number } | null {
  const x = lengthAttr(doc, n, 'x', 'x', ctx);
  const y = lengthAttr(doc, n, 'y', 'y', ctx);
  const size = (local: 'width' | 'height', axis: Axis) => {
    const raw = attrValue(doc, n, null, local);
    const v = raw === null || raw.trim() === 'auto' ? resolveLength('100%', lengthCtx(doc, n, axis, ctx)) : lengthAttr(doc, n, local, axis, ctx);
    return v === null ? null : Math.max(0, v);
  };
  const width = size('width', 'x');
  const height = size('height', 'y');
  return x === null || y === null || width === null || height === null ? null : { x, y, width, height };
}

// ── transform-origin ───────────────────────────────────────────────────────────────────────────

type OriginPart = { pct: number } | { len: string };

/** A transform-origin value's x and y (z is ignored), or null when it doesn't read. */
function parseOrigin(value: string, css: boolean): [OriginPart, OriginPart] | null {
  const parts = value.trim().split(/[ \t\n\r\f]+/).filter(Boolean);
  if (!parts.length || parts.length > 3) return null;
  const KW: Record<string, ['x' | 'y' | 'both', number]> = { left: ['x', 0], right: ['x', 100], top: ['y', 0], bottom: ['y', 100], center: ['both', 50] };
  const read = (p: string): OriginPart | null => {
    if (KW[p.toLowerCase()]) return { pct: KW[p.toLowerCase()][1] };
    const len = parseLength(p);
    if (!len) return null;
    if (css && len.unit === '' && len.value !== 0) return null; // CSS wants a unit
    return len.unit === '%' ? { pct: len.value } : { len: p };
  };
  const [a, b] = parts;
  const ka = KW[a.toLowerCase()];
  if (parts.length === 1) {
    const r = read(a);
    if (!r) return null;
    return ka?.[0] === 'y' ? [{ pct: 50 }, r] : [r, { pct: 50 }];
  }
  const kb = KW[b.toLowerCase()];
  // Keywords may come in either order ("top left"); lengths are x then y.
  if (ka?.[0] === 'y' || kb?.[0] === 'x') {
    if ((ka && ka[0] === 'x') || (kb && kb[0] === 'y')) return null;
    const ry = read(a), rx = read(b);
    return rx && ry ? [rx, ry] : null;
  }
  const rx = read(a), ry = read(b);
  return rx && ry ? [rx, ry] : null;
}

/** The element's transform-box, or null when a <style> rule may set it (or it names stroke-box). */
export function transformBox(doc: Doc, id: NodeId): 'view-box' | 'fill-box' | null {
  if (cssSets(doc, id, 'transform-box') === 'sheet') return null;
  const v = inlineDecl(doc, id, 'transform-box')?.trim().toLowerCase();
  if (v === undefined || v === 'view-box') return 'view-box';
  if (v === 'fill-box' || v === 'content-box' || v === 'border-box') return 'fill-box';
  if (v === 'stroke-box') return null;
  return 'view-box'; // an invalid value is ignored
}

export type OriginResult = { at: [number, number]; box: 'view-box' | 'fill-box' } | { unknown: string };

/**
 * The resolved transform-origin point, in the element's own user units, and the box it is on.
 * `bounds` gives the element's fill box when transform-box needs it.
 */
export function transformOrigin(doc: Doc, id: NodeId, ctx: GeoContext, bounds: () => { x: number; y: number; width: number; height: number } | null): OriginResult {
  const n = el(doc, id);
  const set = cssSets(doc, id, 'transform-origin');
  if (set === 'sheet') return { unknown: 'Its transform origin is set by a <style> rule.' };
  const box = transformBox(doc, id);
  if (box === null) return { unknown: 'Its transform box is set by a <style> rule.' };
  const inline = set === 'inline' ? inlineDecl(doc, id, 'transform-origin') : null;
  const fromInline = inline === null ? null : parseOrigin(inline, true);
  const attr = attrValue(doc, n, null, 'transform-origin');
  const parts = fromInline ?? (attr === null ? null : parseOrigin(attr, false)) ?? [{ len: '0' }, { len: '0' }];
  let ref: { x: number; y: number; width: number; height: number } | null;
  if (box === 'fill-box') ref = bounds();
  else {
    const vp = viewportSize(doc, nearestViewport(doc, id), ctx);
    ref = vp && { x: 0, y: 0, width: vp.w, height: vp.h };
  }
  if (!ref) return { unknown: 'Draw can’t tell where its transform origin is.' };
  const resolve = (p: OriginPart, axis: 'x' | 'y'): number | null => {
    const size = axis === 'x' ? ref!.width : ref!.height;
    if ('pct' in p) return (p.pct * size) / 100;
    return resolveLength(p.len, lengthCtx(doc, n, axis, ctx, p.len));
  };
  const ox = resolve(parts[0], 'x');
  const oy = resolve(parts[1], 'y');
  if (ox === null || oy === null) return { unknown: 'Draw can’t tell where its transform origin is.' };
  return { at: [ref.x + ox, ref.y + oy], box };
}

// ── transforms ─────────────────────────────────────────────────────────────────────────────────

/** Why the element's own transform can't be read, or null when it can. */
export function transformUnknown(doc: Doc, id: NodeId): string | null {
  if (cssSets(doc, id, 'transform') !== 'no') return 'Its transform is set by CSS, which Draw doesn’t edit yet.';
  const raw = attrValue(doc, el(doc, id), null, 'transform');
  if (raw !== null && parseTransform(raw) === null) return 'Its transform isn’t one Draw can read (CSS units or syntax).';
  return null;
}

/** The element's `transform` as written (origin not applied), or null when unknown. */
export function listMatrix(doc: Doc, id: NodeId): Affine | null {
  if (transformUnknown(doc, id)) return null;
  const raw = attrValue(doc, el(doc, id), null, 'transform');
  return raw === null ? IDENTITY : parseTransform(raw)!.matrix;
}

const isTranslation = (m: Affine) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1;

/**
 * The element's own transform with its origin: T(o)·T·T(−o). `bounds` gives its fill box (for
 * transform-box: fill-box); it is called only when needed.
 */
export function ownTransform(doc: Doc, id: NodeId, ctx: GeoContext, bounds: () => { x: number; y: number; width: number; height: number } | null = () => null): Affine | null {
  const t = listMatrix(doc, id);
  if (!t) return null;
  if (isTranslation(t)) return t; // an origin changes nothing for a translation
  const o = transformOrigin(doc, id, ctx, bounds);
  if ('unknown' in o) return null;
  const [ox, oy] = o.at;
  return ox === 0 && oy === 0 ? t : multiply(multiply(translate(ox, oy), t), translate(-ox, -oy));
}

/**
 * An element's user units in its parent's: its own transform, and for a nested <svg> then
 * translate(x, y)·viewportTransform. `bounds` gives the element's fill box (see ownTransform).
 */
export function placement(doc: Doc, id: NodeId, ctx: GeoContext, bounds?: () => { x: number; y: number; width: number; height: number } | null): Affine | null {
  const n = el(doc, id);
  if (id === doc.root) return IDENTITY; // the root's user units are the root's
  const own = ownTransform(doc, id, ctx, bounds);
  if (!own || !isSvg(n, 'svg')) return own;
  const vp = nestedViewport(doc, n, ctx);
  if (!vp) return null;
  const vb = validViewBox(doc, n);
  if (vb === 'disabled') return null;
  const inner = vb ? viewportTransform(vb, parOf(doc, n), vp.width, vp.height) : IDENTITY;
  return multiply(multiply(own, translate(vp.x, vp.y)), inner);
}

/** Is `id` drawn where it is: SVG, under SVG's own containers, outside referenced-only ones? */
export function inDrawnTree(doc: Doc, id: NodeId): boolean {
  const chain = lineage(doc, id);
  if (chain[0].id !== doc.root) return false;
  for (const a of chain.slice(0, -1)) {
    if (!isSvg(a) || !(CONTAINERS.has(a.local) || a.id === doc.root)) return false;
  }
  const self = chain[chain.length - 1];
  return isSvg(self) && !REFERENCED_ONLY.has(self.local);
}

/**
 * The element's user units → the root's user units, or null when unknown. `boundsOf` gives an
 * element's fill box (for transform-box: fill-box), by id.
 */
export function userCtm(doc: Doc, id: NodeId, ctx: GeoContext, boundsOf: (id: NodeId) => { x: number; y: number; width: number; height: number } | null = () => null): Affine | null {
  if (!inDrawnTree(doc, id)) return null;
  let m: Affine = IDENTITY;
  for (const n of lineage(doc, id).slice(1)) {
    const p = placement(doc, n.id, ctx, () => boundsOf(n.id));
    if (!p) return null;
    m = multiply(m, p);
  }
  return m;
}

/** The element's user units → the root's box px at 100% (M·userCtm), or null when unknown. */
export function elementCtm(doc: Doc, id: NodeId, ctx: GeoContext, boundsOf?: (id: NodeId) => { x: number; y: number; width: number; height: number } | null): Affine | null {
  const u = userCtm(doc, id, ctx, boundsOf);
  return u && multiply(rootTransform(doc, ctx.viewport), u);
}

/** The inverse of a matrix, or null when it is singular. */
export const inverse = (m: Affine): Affine | null => invert(m);
