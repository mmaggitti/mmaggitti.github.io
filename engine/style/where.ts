// Where a style property's value lives on an element (P1-M2): a declaration in its own style="",
// its presentation attribute, or neither; and whether a <style> rule may set it, and marks it
// !important (never evaluated: css.ts's conservative rule). Reading never changes the file.
//
// - The declaration that wins in style="" is the last one, or the last !important one. Its value
//   span is found on the decoded value by css.ts's splitter (strings, parentheses, comments and
//   !important respected) and mapped back to raw offsets the way the code's tokens are
//   (code/tokens.ts decodedSrc), so a write replaces exactly those characters. A span holding a
//   character that came from a reference is marked: Draw won't rewrite half an entity.
// - What Inspect shows: the element's own value; else, for an inherited property, the nearest
//   ancestor's written value ("from" it); else the initial value ("default"). A value a <style>
//   rule may decide is never guessed: the element's own shows as set by the rule (P2 edits
//   stylesheets), and an ancestor's as coming from that ancestor, value unknown.

import { attrValue, el, findAttr, type Doc, type NodeId } from '../model/doc.ts';
import { decodeAttr } from '../xml/entities.ts';
import { declarations, sheetSets, type SheetSource } from '../geometry/css.ts';
import { decodedSrc } from '../code/tokens.ts';
import { STYLE_PROPS } from './props.ts';

export interface StyleSource {
  at: 'style' | 'attr' | 'none';
  /** The value as written there (decoded, trimmed), or null at 'none'. */
  value: string | null;
  /** Whether a <style> rule may set it, and with !important. */
  sheet: SheetSource;
  /** At 'style': the winning declaration's value span in the style attribute's raw text. */
  decl: { start: number; end: number; important: boolean; refs: boolean } | null;
}

/**
 * Where `prop`'s value lives on the element (see the header). `styleRaw`, when given, is the style
 * attribute's raw text to read instead of the file's (an earlier edit to it in the same plan).
 */
export function styleSource(doc: Doc, id: NodeId, prop: string, styleRaw?: string): StyleSource {
  const n = el(doc, id);
  const sheet = sheetSets(doc, id, prop);
  const raw = styleRaw ?? findAttr(n, null, 'style')?.raw;
  if (raw !== undefined) {
    const src = decodedSrc(doc, raw, true);
    let win: ReturnType<typeof declarations>[number] | null = null;
    for (const d of declarations(src.s)) if (d.name === prop && (d.important || !win?.important)) win = d;
    if (win) {
      let refs = false;
      if (src.bad) for (let i = win.start; i < win.end; i++) if (src.bad[i]) refs = true;
      const map = src.map;
      const start = map ? (win.start < map.length ? map[win.start] : raw.length) : win.start;
      const end = win.end > win.start ? (map ? map[win.end - 1] + 1 : win.end) : start;
      return { at: 'style', value: win.value, sheet, decl: { start, end, important: win.important, refs } };
    }
  }
  const v = attrValue(doc, n, null, prop);
  return v !== null ? { at: 'attr', value: v.trim(), sheet, decl: null } : { at: 'none', value: null, sheet, decl: null };
}

/**
 * The value's raw text where it lives (its style="" declaration's span, or its attribute's raw
 * text) when that holds an entity or character reference and reads as exactly the value; else
 * null, the decoded value being how it is spelled. Draw carries it into what it writes from the
 * value (a new gradient's stop, and back again), so the file comes back as it was written.
 */
export function rawSpelling(doc: Doc, id: NodeId, prop: string): string | null {
  const s = styleSource(doc, id, prop);
  const n = el(doc, id);
  const raw = s.at === 'style' ? findAttr(n, null, 'style')!.raw.slice(s.decl!.start, s.decl!.end) : s.at === 'attr' ? findAttr(n, null, prop)!.raw : null;
  if (raw === null || !raw.includes('&') || raw.includes('"')) return null;
  return decodeAttr(raw, doc.entities).trim() === s.value ? raw : null;
}

/** Does a <style> rule's value show instead of the element's own (the rule may set it, and nothing of the element's wins over it)? */
export function ruleWins(s: StyleSource): boolean {
  if (s.sheet === 'important') return !(s.at === 'style' && s.decl?.important);
  return s.sheet === 'rule' && s.at !== 'style';
}

export interface Shown {
  /** The value as written where it comes from, or null when a <style> rule may decide it. */
  value: string | null;
  /** own: the element's; ancestor: inherited from `holder`; default: the initial value; rule: a <style> rule may set the element's own. */
  from: 'own' | 'ancestor' | 'default' | 'rule';
  holder: NodeId | null;
}

/** What Inspect shows for `prop` on the element (see the header). */
export function shownValue(doc: Doc, id: NodeId, prop: string): Shown {
  const s = styleSource(doc, id, prop);
  if (ruleWins(s)) return { value: null, from: 'rule', holder: null };
  if (s.value !== null && s.value.toLowerCase() !== 'inherit') return { value: s.value, from: 'own', holder: null };
  const p = STYLE_PROPS[prop];
  if (p?.inherited || s.value !== null) {
    for (let a = el(doc, id).parent; a !== null; a = el(doc, a).parent) {
      const up = styleSource(doc, a, prop);
      if (ruleWins(up)) return { value: null, from: 'ancestor', holder: a };
      if (up.value !== null && up.value.toLowerCase() !== 'inherit') return { value: up.value, from: 'ancestor', holder: a };
      if (!p?.inherited && up.value === null) break; // 'inherit' reaches one level for a property that doesn't inherit
    }
  }
  return { value: p?.initial ?? '', from: 'default', holder: null };
}
