// Gradients (P1-M2): how a paint's gradient resolves through its templates, which paints use it,
// and the edits Inspect makes to it: a new gradient in defs with a fresh numbered id, a paint
// switched back to a colour or none (taking away what Draw made and nothing uses any more), and
// Make unique. DOM-free: node's test runner covers it.
//
// - The template chain (SVG 2): a gradient takes what it doesn't set from the gradient its href
//   names, then from that one's, and so on. gradientUnits, gradientTransform and spreadMethod come
//   from the first in the chain that has them; x1 y1 x2 y2 from the first linearGradient that has
//   them (for a linear gradient), cx cy r fx fy fr from the first radialGradient (for a radial one);
//   the stops from the first that has any. href (no namespace) wins over xlink:href even when it
//   can't be used, as the render policy has it too (so the canvas, the handles and the file alone
//   agree). The chain stops at a reference to another file (value:url/relative: kept as written,
//   never rendered, and no template here), a missing target, an element that isn't a gradient, or
//   a cycle.
// - Writes go where the value lives: a gradient attribute on the chain element it comes from (one no
//   element has goes on the gradient the paint names); stops on the element they come from.
// - What Draw made is one exact predicate (model/draw-ns.ts): a <defs> or gradient with draw:made
//   exactly "true". Draw takes a gradient away only when nothing refers to it any more and it holds
//   only stops and whitespace, and its <defs> when nothing but whitespace is left in it.

import { NS, attrValue, el, findAttr, serializeNode, type Attr, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { decodeAttr, escape } from '../xml/entities.ts';
import { decodeFragment } from '../values/url.ts';
import { parseColor, parsePaint } from '../values/color.ts';
import { opSetAttr, opSetAttrRaw, type Op } from '../commands/ops.ts';
import { buildRefIndex } from '../model/refs.ts';
import { declare, undeclareIfUnused } from '../model/draw-state.ts';
import { isDrawMadeEmpty, isDrawMadeGradient } from '../model/draw-ns.ts';
import { insertMarkup, insertMarkups, removeWithSpace } from '../model/space.ts';
import { numberedIds } from '../model/ids.ts';
import { shownValue, styleSource } from '../style/where.ts';
import { planStyle, type StyleCtx, type StylePlan } from '../style/write.ts';
import { applyPlan } from '../geometry/write.ts';
import { sheetUrlRefs } from '../geometry/css.ts';

type Apply = (op: Op) => void;
export type GradientKind = 'linearGradient' | 'radialGradient';
export type PaintProp = 'fill' | 'stroke';

/** Each kind's geometry attributes, in the order Draw writes them. */
export const GEOMETRY: Readonly<Record<GradientKind, readonly string[]>> = {
  linearGradient: ['x1', 'y1', 'x2', 'y2'],
  radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'fr'],
};
/** What any gradient in the chain may give. */
export const SHARED = ['gradientUnits', 'gradientTransform', 'spreadMethod'] as const;
/** The defaults (SVG 2); fx and fy default to the resolved cx and cy. */
export const DEFAULTS: Readonly<Record<string, string>> = {
  x1: '0%', y1: '0%', x2: '100%', y2: '0%', cx: '50%', cy: '50%', r: '50%', fr: '0%', gradientUnits: 'objectBoundingBox', gradientTransform: '', spreadMethod: 'pad',
};

/** SVG Lab's stop colours (Style lesson, L1464-1465). */
export const LAB_A = '#f4a261';
export const LAB_B = '#e76f51';

export const isGradient = (n: unknown): n is ElementNode =>
  !!n && (n as ElementNode).kind === 'element' && (n as ElementNode).ns === NS.svg && ((n as ElementNode).local === 'linearGradient' || (n as ElementNode).local === 'radialGradient');
const isStop = (doc: Doc, id: NodeId): boolean => {
  const n = doc.nodes.get(id);
  return n?.kind === 'element' && n.ns === NS.svg && n.local === 'stop';
};

let idMemo: { doc: Doc; version: number; ids: Map<string, NodeId> } | null = null;

/**
 * Each id's element: the first in document order with that id, as browsers pick it, and only a plain
 * id: the canvas never renders xml:id (renderer.ts), so url(#g) can't reach an xml:id="g" there, and
 * the gradient editor mustn't either (read once per document version).
 */
export function idMap(doc: Doc): Map<string, NodeId> {
  if (idMemo && idMemo.doc === doc && idMemo.version === doc.version) return idMemo.ids;
  const ids = new Map<string, NodeId>();
  const stack: NodeId[] = [doc.root];
  while (stack.length) {
    const n = doc.nodes.get(stack.pop()!);
    if (n?.kind !== 'element') continue;
    for (const a of n.attrs) {
      if (a.local !== 'id' || a.ns !== null) continue;
      const v = decodeAttr(a.raw, doc.entities);
      if (!ids.has(v)) ids.set(v, n.id);
    }
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  idMemo = { doc, version: doc.version, ids };
  return ids;
}

/** The attribute a gradient's template link is read from: href (no namespace), else xlink:href. */
export function templateLink(n: ElementNode): Attr | undefined {
  return findAttr(n, null, 'href') ?? findAttr(n, NS.xlink, 'href');
}

/** The gradient a gradient takes its template from, or null (none, another file, a missing target, not a gradient). */
function templateOf(doc: Doc, n: ElementNode, ids: Map<string, NodeId>): ElementNode | null {
  const a = templateLink(n);
  if (!a) return null;
  const v = decodeAttr(a.raw, doc.entities).trim();
  if (v.length < 2 || !v.startsWith('#')) return null; // another file (value:url/relative): never followed
  const t = ids.get(decodeFragment(v.slice(1)));
  const tn = t === undefined ? undefined : doc.nodes.get(t);
  return isGradient(tn) ? tn : null;
}

export interface ResolvedAttr {
  raw: string; // as written
  value: string; // decoded, trimmed
  from: NodeId; // the chain element that has it
}

/** A gradient as it draws: the one a paint names, its chain, each attribute and where it comes from, and its stops. */
export interface Resolved {
  id: NodeId;
  kind: GradientKind;
  chain: NodeId[];
  attrs: Map<string, ResolvedAttr>;
  stopsFrom: NodeId | null;
  stops: NodeId[];
}

/** Resolve gradient `id` through its templates (see the header), or null when it isn't a gradient. */
export function resolveGradient(doc: Doc, id: NodeId): Resolved | null {
  const g = doc.nodes.get(id);
  if (!isGradient(g)) return null;
  const ids = idMap(doc);
  const chain: ElementNode[] = [];
  const seen = new Set<NodeId>();
  for (let n: ElementNode | null = g; n && !seen.has(n.id); n = templateOf(doc, n, ids)) {
    seen.add(n.id);
    chain.push(n);
  }
  const kind = g.local as GradientKind;
  const attrs = new Map<string, ResolvedAttr>();
  const take = (name: string, only?: GradientKind) => {
    for (const n of chain) {
      if (only && n.local !== only) continue;
      const a = findAttr(n, null, name);
      if (a) return void attrs.set(name, { raw: a.raw, value: decodeAttr(a.raw, doc.entities).trim(), from: n.id });
    }
  };
  for (const name of GEOMETRY[kind]) take(name, kind);
  for (const name of SHARED) take(name);
  const holder = chain.find((n) => n.children.some((c) => isStop(doc, c))) ?? null;
  return { id, kind, chain: chain.map((n) => n.id), attrs, stopsFrom: holder?.id ?? null, stops: holder ? holder.children.filter((c) => isStop(doc, c)) : [] };
}

/** An attribute's value as the gradient draws with it: the chain's, else the default (fx, fy: the resolved cx, cy). */
export function valueOf(r: Resolved, name: string): string {
  const own = r.attrs.get(name)?.value;
  if (own !== undefined) return own;
  if (name === 'fx' || name === 'fy') return valueOf(r, name === 'fx' ? 'cx' : 'cy');
  return DEFAULTS[name] ?? '';
}

/** An element's own paint for fill or stroke, where it lives: a gradient it names (the id's element), its fallback's text, and the value as written. */
export interface OwnPaint {
  value: string | null; // as written where it lives, or null (absent)
  gradient: NodeId | null; // the gradient url(#id) names, when it names one
  url: string | null; // the id url(#…) names (whatever it is)
  fallback: string; // the text after url(…) (with its leading space), or ''
}

const URL_HEAD = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"'()]+))\s*\)/i;

export function ownPaint(doc: Doc, id: NodeId, prop: PaintProp): OwnPaint {
  const s = styleSource(doc, id, prop);
  const value = s.value;
  const out: OwnPaint = { value, gradient: null, url: null, fallback: '' };
  if (value === null) return out;
  const p = parsePaint(value);
  if (p?.kind !== 'url') return out;
  out.url = p.id;
  const m = URL_HEAD.exec(value);
  out.fallback = m ? value.slice(m[0].length) : '';
  const t = idMap(doc).get(p.id);
  if (t !== undefined && isGradient(doc.nodes.get(t))) out.gradient = t;
  return out;
}

/**
 * A paint that uses a gradient: the element and which of its paints; or a <style> rule whose url(#…)
 * names it ('rule', `el` its <style> element), which counts as one user, however many shapes the
 * rule may paint (Draw never evaluates a selector).
 */
export interface User {
  el: NodeId;
  prop: PaintProp | 'rule';
}

/** Who uses the document's gradients (gradientUsers), read once per document version. */
export interface Users {
  /** Each paint and <style> rule whose chain includes any of these gradient elements, each once. */
  of(chain: readonly NodeId[]): User[];
}

let usersMemo: { doc: Doc; version: number; users: Users } | null = null;

/**
 * Who uses the document's gradients: each paint (every element's own fill and stroke) and each
 * <style> rule (css.ts sheetUrlRefs: one user per rule) by the gradient it names, and each gradient's
 * template link, read in one walk and kept per document version. A user of a gradient uses every
 * gradient in its chain, so users.of(chain) walks the links backwards from `chain` once: linear in
 * the document, however long a chain of templates is (listing every chain element's users would be
 * quadratic in it).
 */
export function gradientUsers(doc: Doc): Users {
  if (usersMemo && usersMemo.doc === doc && usersMemo.version === doc.version) return usersMemo.users;
  const direct = new Map<NodeId, User[]>(); // each gradient, and the paints and rules that name it
  const takers = new Map<NodeId, NodeId[]>(); // each gradient, and the gradients whose template it is
  const push = <V>(m: Map<NodeId, V[]>, k: NodeId, v: V) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  const ids = idMap(doc);
  const stack: NodeId[] = [doc.root];
  while (stack.length) {
    const n = doc.nodes.get(stack.pop()!);
    if (n?.kind !== 'element') continue;
    if (isGradient(n)) {
      const t = templateOf(doc, n, ids);
      if (t && t.id !== n.id) push(takers, t.id, n.id);
    }
    for (const prop of ['fill', 'stroke'] as const) {
      const g = ownPaint(doc, n.id, prop).gradient;
      if (g !== null) push(direct, g, { el: n.id, prop });
    }
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  for (const [name, styles] of sheetUrlRefs(doc)) {
    const g = ids.get(name);
    if (g !== undefined && isGradient(doc.nodes.get(g))) for (const style of styles) push(direct, g, { el: style, prop: 'rule' });
  }
  const users: Users = {
    of(chain) {
      // Every gradient whose chain reaches one of these: backwards along the template links, each once.
      const seen = new Set<NodeId>(chain);
      const queue = [...seen];
      const out: User[] = [];
      for (let i = 0; i < queue.length; i++) {
        for (const u of direct.get(queue[i]) ?? []) out.push(u);
        for (const k of takers.get(queue[i]) ?? []) {
          if (seen.has(k)) continue;
          seen.add(k);
          queue.push(k);
        }
      }
      return out;
    },
  };
  usersMemo = { doc, version: doc.version, users };
  return users;
}

/**
 * The others (not this paint) that an edit of these chain elements would change too: each other
 * element once, and the <style> element of each rule that names one (once per rule).
 */
export function sharedWith(users: Users, written: readonly NodeId[], me: User): NodeId[] {
  const others = new Set<NodeId>();
  const rules = new Set<User>();
  for (const u of users.of(written)) {
    if (u.prop === 'rule') rules.add(u);
    else if (u.el !== me.el || u.prop !== me.prop) others.add(u.el);
  }
  others.delete(me.el);
  return [...others, ...[...rules].map((u) => u.el)];
}

// ── new gradients ──────────────────────────────────────────────────────────────────────────────

/** The qualified name of an SVG element in this file: its root's prefix (svg:rect under <svg:svg>). */
const qn = (doc: Doc, local: string): string => {
  const p = el(doc, doc.root).prefix;
  return p ? `${p}:${local}` : local;
};

/** The root's first <defs> child (SVG namespace), or null. */
export function rootDefs(doc: Doc): ElementNode | null {
  for (const c of el(doc, doc.root).children) {
    const n = doc.nodes.get(c);
    if (n?.kind === 'element' && n.ns === NS.svg && n.local === 'defs') return n;
  }
  return null;
}

/**
 * Put gradients' markup (each made by its `markups` entry from Draw's prefix) into the root's first
 * <defs>, as its last element children in order, or, with none, into a <defs draw:made="true"> Draw
 * makes before the root's first element child that isn't title, desc or metadata (last when there
 * is none), by the insertion rule. Declares Draw's namespace first. All of them in one fragment
 * parse (which reads the whole document), so a command over many shapes stays linear. Returns the
 * gradients' NodeIds, in order.
 */
export function insertGradients(doc: Doc, markups: readonly ((draw: string) => string)[], apply: Apply): NodeId[] {
  if (!markups.length) return [];
  const draw = declare(doc, apply);
  const defs = rootDefs(doc);
  if (defs) return insertMarkups(doc, { last: defs.id }, markups.map((m) => m(draw)), apply);
  const root = el(doc, doc.root);
  const first = root.children.find((c) => {
    const n = doc.nodes.get(c);
    return n?.kind === 'element' && !(n.ns === NS.svg && (n.local === 'title' || n.local === 'desc' || n.local === 'metadata'));
  });
  const d = qn(doc, 'defs');
  const made = insertMarkup(doc, first === undefined ? { last: root.id } : { before: first }, `<${d} ${draw}:made="true">${markups.map((m) => m(draw)).join('')}</${d}>`, apply);
  return [...el(doc, made).children];
}

/** A gradient's markup, one line, as SVG Lab writes one: `attrs` after its id, then draw:made, then its stops. */
export function gradientMarkup(doc: Doc, kind: GradientKind, id: string, attrs: string, stops: readonly [string, string][], draw: string): string {
  const q = qn(doc, kind);
  const s = qn(doc, 'stop');
  return `<${q} id="${id}" ${attrs} ${draw}:made="true">${stops.map(([o, c]) => `<${s} offset="${o}" stop-color="${escape(c, '"')}"/>`).join('')}</${q}>`;
}

/** Linear (SVG Lab's Style gradient, top to bottom) and Radial (LabPaint's centre and radius). */
export const NEW_ATTRS: Readonly<Record<GradientKind, string>> = {
  linearGradient: 'x1="0" y1="0" x2="0" y2="1"',
  radialGradient: 'cx="0.5" cy="0.5" r="0.5"',
};

/**
 * A new gradient's stop colours: the element's current colour for the paint as written (its own, or
 * an ancestor's it inherits), else SVG Lab's first (none, currentColor, a context paint, a gradient);
 * then SVG Lab's second, or its first when the colour is that already.
 */
export function newStops(doc: Doc, id: NodeId, prop: PaintProp): [string, string] {
  const v = shownValue(doc, id, prop).value;
  const c = v === null ? null : parseColor(v);
  const a = c && c.kind === 'color' ? v! : LAB_A;
  const b = a.toLowerCase() === LAB_B ? LAB_A : LAB_B;
  return [a, b];
}

/**
 * Give each element's `prop` a new gradient of `kind`: one per element, ids `linear-N` or `radial-N`
 * rising in document order, written where the paint lives (a fallback after an old url kept). The
 * gradients it stops using go when Draw made them and nothing uses them. Returns the refusals.
 * Every element is read before anything is written (one id map), and the new gradients go in with
 * one fragment parse, so it stays linear over many shapes.
 */
export function setGradientPaint(doc: Doc, ids: readonly NodeId[], prop: PaintProp, kind: GradientKind, ctx: StyleCtx, apply: Apply): { id: NodeId; why: string }[] {
  const next = numberedIds(doc);
  const refused: { id: NodeId; why: string }[] = [];
  const dropped: NodeId[] = [];
  const plans: StylePlan[] = [];
  const markups: ((draw: string) => string)[] = [];
  for (const e of ids) {
    const own = ownPaint(doc, e, prop);
    const stops = newStops(doc, e, prop);
    const gid = next(kind === 'linearGradient' ? 'linear' : 'radial');
    const plan = planStyle(doc, [e], prop, `url(#${gid})${own.fallback}`, ctx);
    if (plan.refused.length) {
      refused.push(plan.refused[0]);
      continue;
    }
    markups.push((draw) => gradientMarkup(doc, kind, gid, NEW_ATTRS[kind], [['0', stops[0]], ['1', stops[1]]], draw));
    plans.push(plan);
    if (own.gradient !== null) dropped.push(own.gradient);
  }
  insertGradients(doc, markups, apply);
  for (const plan of plans) applyPlan(doc, plan, apply);
  dropUnused(doc, dropped, apply);
  return refused;
}

/**
 * The paint back to a colour or none: `value` for each element (for Colour, the caller passes the
 * gradient's first stop colour as written), and the Draw-made gradients nothing uses any more
 * taken away. Returns the refusals. Every element (and `value`) is read before anything is
 * written, so it stays linear over many shapes.
 */
export function setPlainPaint(doc: Doc, ids: readonly NodeId[], prop: PaintProp, value: (id: NodeId) => string, ctx: StyleCtx, apply: Apply): { id: NodeId; why: string }[] {
  const refused: { id: NodeId; why: string }[] = [];
  const dropped: NodeId[] = [];
  const plans: StylePlan[] = [];
  for (const e of ids) {
    const own = ownPaint(doc, e, prop);
    const plan = planStyle(doc, [e], prop, value(e), ctx);
    refused.push(...plan.refused);
    if (plan.refused.length) continue;
    plans.push(plan);
    if (own.gradient !== null) dropped.push(own.gradient);
  }
  for (const plan of plans) applyPlan(doc, plan, apply);
  dropUnused(doc, dropped, apply);
  return refused;
}

/** A stop's colour as written (its style="" declaration or attribute), else black (the initial value). */
export function stopColour(doc: Doc, stop: NodeId): string {
  return styleSource(doc, stop, 'stop-color').value ?? 'black';
}

/**
 * Take away the gradients among `ids` that Draw made and nothing refers to any more (each with its
 * leading whitespace), then each Draw-made <defs> left with nothing but whitespace, then Draw's
 * namespace declaration when nothing of Draw's is left. A reference is one the file's attributes
 * hold (refs.ts), or a url(#…) in a <style> element's text (css.ts sheetUrlRefs, read
 * conservatively: any rule or at-rule, @keyframes too).
 */
export function dropUnused(doc: Doc, ids: readonly NodeId[], apply: Apply): void {
  if (!ids.length) return;
  const refs = buildRefIndex(doc).refs;
  const sheet = sheetUrlRefs(doc);
  const holders = new Set<NodeId>();
  const gone: NodeId[] = [];
  for (const g of new Set(ids)) {
    const n = doc.nodes.get(g);
    if (!isGradient(n) || !isDrawMadeGradient(doc, n) || n.parent === null) continue;
    const own = attrValue(doc, n, null, 'id');
    if (own !== null && ((refs.get(own)?.length ?? 0) > 0 || sheet.has(own))) continue;
    holders.add(n.parent);
    gone.push(g);
  }
  // Last first (M1's rule for many removals): each leaves from the end of what is left, so taking
  // 4,000 gradients out of one <defs> searches and shifts nothing.
  const at = new Map<NodeId, number>();
  for (const h of holders) el(doc, h).children.forEach((c, i) => at.set(c, i));
  for (const g of gone.sort((a, b) => at.get(b)! - at.get(a)!)) removeWithSpace(doc, g, apply);
  for (const h of holders) {
    const n = doc.nodes.get(h);
    if (n?.kind === 'element' && n.parent !== null && isDrawMadeEmpty(doc, n)) removeWithSpace(doc, h, apply);
  }
  undeclareIfUnused(doc, apply);
}

// ── Make unique ────────────────────────────────────────────────────────────────────────────────

/**
 * Make unique (one transaction): a standalone copy of the gradient element `id`'s paint names,
 * right after that gradient: the same element type, a fresh `linear-N` or `radial-N`, draw:made,
 * and every attribute the chain resolves (but id, href and xlink:href) copied as written from the
 * element it comes from, in the order x1 y1 x2 y2 or cx cy r fx fy fr, then gradientUnits,
 * gradientTransform, spreadMethod; its content the stops' element's, first stop to last, byte for
 * byte. Then only this paint is re-pointed where it lives: the id's characters inside url(#…).
 */
export function makeUnique(doc: Doc, id: NodeId, prop: PaintProp, apply: Apply): NodeId | { refused: string } {
  const own = ownPaint(doc, id, prop);
  if (own.gradient === null || own.url === null) return { refused: `Its ${prop} is not a gradient.` };
  const r = resolveGradient(doc, own.gradient)!;
  const gid = numberedIds(doc)(r.kind === 'linearGradient' ? 'linear' : 'radial');
  const parts: string[] = [];
  for (const name of [...GEOMETRY[r.kind], ...SHARED]) {
    const a = r.attrs.get(name);
    if (!a) continue;
    const src = findAttr(el(doc, a.from), null, name)!;
    const raw = src.raw.includes('"') ? escape(decodeAttr(src.raw, doc.entities), '"') : src.raw;
    parts.push(`${name}="${raw}"`);
  }
  let content = '';
  if (r.stopsFrom !== null) {
    const kids = el(doc, r.stopsFrom).children;
    const first = kids.indexOf(r.stops[0]);
    const last = kids.indexOf(r.stops[r.stops.length - 1]);
    content = kids.slice(first, last + 1).map((c) => serializeNode(doc, c)).join('');
  }
  const draw = declare(doc, apply);
  const q = qn(doc, r.kind);
  const copy = insertMarkup(doc, { after: r.id }, `<${q} id="${gid}"${parts.map((p) => ` ${p}`).join('')} ${draw}:made="true">${content}</${q}>`, apply);
  const why = repoint(doc, id, prop, own.url, gid, apply);
  return why ?? copy;
}

// url(…) in a paint, matched on the raw text (the id quoted or not), so only the id's characters change.
const URL_REF = /url\(\s*(?:(['"])#([^'"]+)\1|#([^'")\s]+))\s*\)/g;

/** Point this element's `prop` at `to` instead of `from`: only the id's characters inside its url(#…), where the paint lives. */
export function repoint(doc: Doc, id: NodeId, prop: PaintProp, from: string, to: string, apply: Apply): { refused: string } | null {
  const s = styleSource(doc, id, prop);
  const n = el(doc, id);
  const a = s.at === 'style' ? findAttr(n, null, 'style') : s.at === 'attr' ? findAttr(n, null, prop) : undefined;
  if (!a) return { refused: `Its ${prop} is not written on it.` };
  const [start, end] = s.at === 'style' ? [s.decl!.start, s.decl!.end] : [0, a.raw.length];
  const span = a.raw.slice(start, end);
  if (span.includes('&')) return { refused: `Its ${prop} is written with a character reference; edit it in the code.` };
  let done = false;
  const next = span.replace(URL_REF, (m, _q: string | undefined, quoted: string | undefined, bare: string | undefined) => {
    const raw = quoted ?? bare!;
    if (done || decodeFragment(raw) !== from) return m;
    done = true;
    const at = m.indexOf(raw, m.indexOf('#'));
    return m.slice(0, at) + to + m.slice(at + raw.length);
  });
  if (!done) return { refused: `Its ${prop} doesn’t name #${from}.` };
  apply(s.at === 'style' ? opSetAttrRaw(doc, id, null, 'style', a.raw.slice(0, start) + next + a.raw.slice(end)) : opSetAttrRaw(doc, id, null, prop, next));
  return null;
}

/** A gradient attribute written where it lives in the chain (a number's characters only, its unit kept), else added to the gradient the paint names. */
export function gradientAttrOp(doc: Doc, r: Resolved, name: string, value: string): Op {
  const a = r.attrs.get(name);
  return a ? opSetAttr(doc, a.from, null, name, value) : opSetAttr(doc, r.id, null, name, value);
}

