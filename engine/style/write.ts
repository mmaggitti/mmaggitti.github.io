// Where Inspect writes a style value (P1-M2): where it already lives, changing only its bytes.
//
// Per element, in this order:
// 1. a <style> rule may set it with !important, and its own style="" declaration isn't !important:
//    refused (editing stylesheets arrives in P2);
// 2. its own style="" declares it: only that declaration's value span is replaced; the name, the
//    colon, the spacing, !important, the other declarations and every other byte stay. A span
//    holding a character reference is refused (edit it in the code). The text is escaped for the
//    attribute's quote;
// 3. a <style> rule may set it (and style="" doesn't): refused, since writing the attribute would
//    change nothing on screen;
// 4. its presentation attribute holds it: the value replaced (position, quote and whitespace kept);
// 5. neither: the presentation attribute added at the end of the start tag. Draw never starts a
//    style="" of its own, and never removes a declaration or an attribute here;
// 6. the same value as written now (trimmed): nothing to do.
// The width-2 rule (SVG Lab's LabCreate.set): a stroke given a paint other than none, on an element
// whose stroke was none and whose own stroke-width is absent or 0, also gets stroke-width = L(2k)
// (the Shapes tool's lengths: 2k on the snap step, at least one step), by the same rules and in the
// same edit of style="" when both live there.
// Over many elements this is linear: each element and its ancestors are read once, and the sheets'
// scan is cached per document (css.ts).

import { el, findAttr, type Doc, type NodeId } from '../model/doc.ts';
import { escape } from '../xml/entities.ts';
import { fmt } from '../values/number-format.ts';
import type { AttrEdit } from '../geometry/write.ts';
import { ruleWins, styleSource, type StyleSource } from './where.ts';

export interface StyleCtx {
  /** min(W, H) / 100 of the artboard (1 with none). */
  k: number;
  /** The snap step in root units. */
  step: number;
}

export interface StylePlan {
  edits: AttrEdit[];
  refused: { id: NodeId; why: string }[];
}

export const RULE_IMPORTANT = (prop: string) => `Its ${prop} is set by a <style> rule marked !important. Editing stylesheets arrives in P2.`;
export const RULE_SETS = (prop: string) => `Its ${prop} is set by a <style> rule, which wins over the attribute. Editing stylesheets arrives in P2.`;
export const REFERENCE = (prop: string) => `Its ${prop} in style="" is written with a character reference; edit it in the code.`;

/** Why a <style> rule keeps `prop` from being written where `s` says it lives (rules 1 and 3), or null. */
export function ruleWhy(s: StyleSource, prop: string): string | null {
  if (s.sheet === 'important' && !(s.at === 'style' && s.decl?.important)) return RULE_IMPORTANT(prop);
  if (s.sheet === 'rule' && s.at !== 'style') return RULE_SETS(prop);
  return null;
}

/**
 * One element's edit for `prop` = `value` (see the header): an attribute edit, a refusal, or null
 * (nothing to do). `styleRaw` reads style="" as an earlier edit in the same plan left it.
 */
export function planStyleOne(doc: Doc, id: NodeId, prop: string, value: string, styleRaw?: string): AttrEdit | { refused: string } | null {
  const s = styleSource(doc, id, prop, styleRaw);
  const why = ruleWhy(s, prop);
  if (why) return { refused: why };
  const v = value.trim();
  if (s.at === 'style') {
    const d = s.decl!;
    if (d.refs) return { refused: REFERENCE(prop) };
    if (s.value === v) return null;
    const a = findAttr(el(doc, id), null, 'style')!;
    const raw = styleRaw ?? a.raw;
    return { id, ns: null, local: 'style', raw: raw.slice(0, d.start) + escape(v, a.quote) + raw.slice(d.end), add: false };
  }
  if (s.at === 'attr') {
    if (s.value === v) return null;
    const a = findAttr(el(doc, id), null, prop)!;
    return { id, ns: null, local: prop, raw: escape(v, a.quote), add: false };
  }
  return { id, ns: null, local: prop, raw: v, add: true };
}

/** Was the element's stroke none: the nearest value written on it or above it none, or none written at all (the initial value)? */
function strokeIsNone(doc: Doc, id: NodeId): boolean {
  for (let n: NodeId | null = id; n !== null; n = el(doc, n).parent) {
    const s = styleSource(doc, n, 'stroke');
    if (ruleWins(s)) return false; // a rule's paint: not known to be none
    if (s.value !== null && s.value.toLowerCase() !== 'inherit') return s.value.toLowerCase() === 'none';
  }
  return true;
}

/** The plan for `prop` = `value` over `ids`: every element's edit, and the ones refused with why. */
export function planStyle(doc: Doc, ids: readonly NodeId[], prop: string, value: string, ctx: StyleCtx): StylePlan {
  const out: StylePlan = { edits: [], refused: [] };
  const widthTwo = prop === 'stroke' && value.trim().toLowerCase() !== 'none';
  for (const id of ids) {
    const was = widthTwo && strokeIsNone(doc, id);
    const e = planStyleOne(doc, id, prop, value);
    if (e && 'refused' in e) {
      out.refused.push({ id, why: e.refused });
      continue;
    }
    let two: AttrEdit | null = null;
    if (was) {
      const styleRaw = e?.local === 'style' ? e.raw : undefined;
      const w = styleSource(doc, id, 'stroke-width', styleRaw);
      if (w.value === null || parseFloat(w.value) === 0) {
        const p = planStyleOne(doc, id, 'stroke-width', widthOf(2, ctx), styleRaw);
        if (p && !('refused' in p)) two = p;
      }
    }
    // Both in style="": the width's edit was planned on the stroke's, so it holds both.
    if (e && !(two?.local === 'style' && e.local === 'style')) out.edits.push(e);
    if (two) out.edits.push(two);
  }
  return out;
}

/** A length of `n` lab units on this artboard, as the Shapes tool writes one: n·k on the snap step, at least one step. */
export function widthOf(n: number, ctx: StyleCtx): string {
  const places = fmt(ctx.step, 10).split('.')[1]?.length ?? 0;
  return fmt(Math.max(ctx.step, Math.round((n * ctx.k) / ctx.step) * ctx.step), places);
}
