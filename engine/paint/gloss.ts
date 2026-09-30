// Gloss (P1-M2): SVG Lab's Create gloss (L1746-1751, L1892, L2120-2125). On: the fill becomes a
// radial gradient from white to the shape's own colour, <radialGradient id="gloss-N" cx="0.35"
// cy="0.3" r="0.8" draw:made="true">, in defs (paint/gradients.ts insertGradients). Off: the fill is
// the end stop's colour as written again, and the gradient goes when Draw made it and nothing else
// uses it, with a Draw-made <defs> left empty and Draw's namespace when nothing of Draw's is left:
// on then off gives the file back byte for byte.
//
// For rect, circle, ellipse, polygon, polyline and path (SVG Lab: not line or text, L1915; not a
// container or the root). It is on when the element's own fill is exactly url(#gloss-N) naming a
// radialGradient whose id is gloss-N (SVG Lab's own test, L2120).

import { NS, attrValue, type Doc, type NodeId } from '../model/doc.ts';
import type { Op } from '../commands/ops.ts';
import { parseColor } from '../values/color.ts';
import { numberedIds } from '../model/ids.ts';
import { rawSpelling, styleSource } from '../style/where.ts';
import { planStyle, type StyleCtx, type StylePlan } from '../style/write.ts';
import { applyPlan } from '../geometry/write.ts';
import { dropUnused, gradientMarkup, idMap, insertGradients, resolveGradient, stopSpelling, LAB_B, type Spelled } from './gradients.ts';

type Apply = (op: Op) => void;

const GLOSSABLE = new Set(['rect', 'circle', 'ellipse', 'polygon', 'polyline', 'path']);
export const GLOSS_ATTRS = 'cx="0.35" cy="0.3" r="0.8"';
const GLOSS_URL = /^url\(#(gloss-\d+)\)$/;

/** Can this element take a gloss (a rect, circle, ellipse, polygon, polyline or path in the SVG namespace, not the root)? */
export function glossable(doc: Doc, id: NodeId): boolean {
  const n = doc.nodes.get(id);
  return n?.kind === 'element' && n.ns === NS.svg && GLOSSABLE.has(n.local) && id !== doc.root;
}

/** The gloss gradient when the element's gloss is on (its own fill exactly url(#gloss-N), naming a radialGradient with that id), else null. */
export function glossOf(doc: Doc, id: NodeId): NodeId | null {
  const v = styleSource(doc, id, 'fill').value;
  const m = v === null ? null : GLOSS_URL.exec(v);
  if (!m) return null;
  const g = idMap(doc).get(m[1]);
  const n = g === undefined ? undefined : doc.nodes.get(g);
  return n?.kind === 'element' && n.ns === NS.svg && n.local === 'radialGradient' && attrValue(doc, n, null, 'id') === m[1] ? g! : null;
}

/** The colour a gloss ends in: the element's own fill where it is a colour, as written (a reference and all), else SVG Lab's #e76f51. */
export function glossColour(doc: Doc, id: NodeId): Spelled {
  const v = styleSource(doc, id, 'fill').value;
  const c = v === null ? null : parseColor(v);
  return c && c.kind === 'color' ? { value: v!, raw: rawSpelling(doc, id, 'fill') } : { value: LAB_B, raw: null };
}

/**
 * Gloss on for each element (document order): a gloss-N each, N rising, one transaction. Returns the
 * refusals. Every element is read before anything is written, and the gradients go in with one
 * fragment parse, so a Gloss over many shapes stays linear.
 */
export function glossOn(doc: Doc, ids: readonly NodeId[], ctx: StyleCtx, apply: Apply): { id: NodeId; why: string }[] {
  const next = numberedIds(doc);
  const refused: { id: NodeId; why: string }[] = [];
  const plans: StylePlan[] = [];
  const markups: ((draw: string) => string)[] = [];
  for (const id of ids) {
    const gid = next('gloss');
    const colour = glossColour(doc, id);
    const plan = planStyle(doc, [id], 'fill', `url(#${gid})`, ctx);
    if (plan.refused.length) {
      refused.push(plan.refused[0]);
      continue;
    }
    markups.push((draw) => gradientMarkup(doc, 'radialGradient', gid, GLOSS_ATTRS, [['0', { value: '#ffffff', raw: null }], ['1', colour]], draw));
    plans.push(plan);
  }
  insertGradients(doc, markups, apply);
  for (const plan of plans) applyPlan(doc, plan, apply);
  return refused;
}

/**
 * Gloss off for each element: its fill the end stop's colour as written, and the gradient gone when
 * Draw made it and nothing else uses it. Every element is read before anything is written.
 */
export function glossOff(doc: Doc, ids: readonly NodeId[], ctx: StyleCtx, apply: Apply): { id: NodeId; why: string }[] {
  const refused: { id: NodeId; why: string }[] = [];
  const dropped: NodeId[] = [];
  const plans: StylePlan[] = [];
  for (const id of ids) {
    const g = glossOf(doc, id);
    if (g === null) continue;
    const r = resolveGradient(doc, g)!;
    const last = r.stops[r.stops.length - 1];
    const end = last === undefined ? { value: LAB_B, raw: null } : stopSpelling(doc, last);
    const plan = planStyle(doc, [id], 'fill', end.value, ctx, end.raw ?? undefined);
    if (plan.refused.length) {
      refused.push(plan.refused[0]);
      continue;
    }
    plans.push(plan);
    dropped.push(g);
  }
  for (const plan of plans) applyPlan(doc, plan, apply);
  dropUnused(doc, dropped, apply);
  return refused;
}
