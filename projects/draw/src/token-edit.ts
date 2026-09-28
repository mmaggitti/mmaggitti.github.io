// Token edits as the editor makes them: a reference to one token that survives edits, the op that
// rewrites it (so undo works), and the rules the Scrub strip and the Number, Color and Text sheets
// apply before anything is written. Pure, so every rule is unit-tested in node.
//
// A token is held by its node, its target (an attribute, or a text or CDATA leaf) and its index
// among that target's tokens: engine/code/edit.ts guarantees an edit keeps every token's index, so
// the reference stays good across the edits it makes. Text is refused with a message and never
// written when it would not read as the token's kind.

import type { Doc, NodeId } from '../../../engine/model/doc.ts';
import { opSetAttrRaw, opSetLeafRaw, type Op } from '../../../engine/commands/ops.ts';
import { scrubNumber, tokenEdit, tokenTextError, TokenEditError, type TokenTarget } from '../../../engine/code/edit.ts';
import { tokenizeAttr, tokenizeText, type ColorToken, type EnumToken, type NumberToken, type TextToken, type Token } from '../../../engine/code/tokens.ts';

export interface TokenRef {
  node: NodeId;
  target: TokenTarget;
  index: number;
}

export type Checked = { text: string } | { error: string };

/** Every token of one attribute or leaf, in order. */
export function tokensAt(doc: Doc, node: NodeId, target: TokenTarget): Token[] {
  return 'attr' in target ? tokenizeAttr(doc, node, target.attr) : tokenizeText(doc, node);
}

/** A reference to `token` (read from this node and target), or null when it isn't there. */
export function refOf(doc: Doc, node: NodeId, target: TokenTarget, token: Pick<Token, 'start' | 'end' | 'kind'>): TokenRef | null {
  const index = tokensAt(doc, node, target).findIndex((t) => t.start === token.start && t.end === token.end && t.kind === token.kind);
  return index === -1 ? null : { node, target, index };
}

/** The token a reference points at now, or null when the edit that made it is gone. */
export function tokenAt(doc: Doc, ref: TokenRef): Token | null {
  if (!doc.nodes.has(ref.node)) return null;
  try {
    return tokensAt(doc, ref.node, ref.target)[ref.index] ?? null;
  } catch {
    return null; // the attribute or leaf is gone
  }
}

/** The op that writes `text` in place of the referenced token. Throws TokenEditError, writing nothing. */
export function tokenOp(doc: Doc, ref: TokenRef, text: string): Op {
  const token = tokenAt(doc, ref);
  if (!token) throw new TokenEditError('that value is no longer in the document');
  const raw = tokenEdit(doc, ref.node, ref.target, token, text);
  return 'attr' in ref.target ? opSetAttrRaw(doc, ref.node, ref.target.attr.ns, ref.target.attr.local, raw) : opSetLeafRaw(doc, ref.node, raw);
}

// ── numbers ────────────────────────────────────────────────────────────────────────────────────

/** One step of a number token: its own step (opacity's 0.01), else one unit of its last written place. */
export const stepOf = (t: NumberToken): number => t.step ?? 10 ** -Math.min(t.decimals, 3);

/** The token's text after `steps` steps (a scrub, a stepper press), at its precision and clamped. */
export function stepped(t: NumberToken, steps: number): string {
  return scrubNumber(t, steps * stepOf(t));
}

/** `text` read as a number token's new value, then stepped: the Number sheet's − and +. */
export function steppedFrom(t: NumberToken, text: string, steps: number): string {
  const value = Number(text);
  if (!Number.isFinite(value)) return stepped(t, steps);
  const dot = text.indexOf('.');
  const decimals = Math.max(t.decimals, dot === -1 ? 0 : text.length - dot - 1);
  return scrubNumber({ ...t, value, decimals }, steps * stepOf(t));
}

/** The ± key: the same number with the other sign (iOS's decimal keypad has no minus). */
export function negated(text: string): string {
  const t = text.trim();
  if (Number(t) === 0) return t.replace(/^[+-]/, '');
  return t.startsWith('-') ? t.slice(1) : `-${t.replace(/^\+/, '')}`;
}

/**
 * What the Number sheet's field or the Scrub strip may write: a plain decimal inside the token's
 * range. A decimal comma (some iOS keypads), a typographic minus and a leading '+' are read as
 * the number they mean; anything else is refused with the reason.
 */
export function checkNumber(t: NumberToken, input: string): Checked {
  const text = input.trim().replace(/^−/, '-').replace(/^\+/, '').replace(',', '.');
  if (text === '') return { error: 'Type a number' };
  const why = tokenTextError(t, text);
  return why ? { error: why } : { text };
}

// ── colours, keywords, text ────────────────────────────────────────────────────────────────────

/** A colour the engine reads (CSS Color 4), or one of the slot's keywords (a paint's none). */
export function checkColor(t: ColorToken, input: string): Checked {
  const text = input.trim();
  if (text === '') return { error: 'Type a colour' };
  const why = tokenTextError(t, text);
  return why ? { error: why } : { text };
}

/** The next of an enum token's options, wrapping round. */
export function nextOption(t: EnumToken): string {
  const i = t.options.indexOf(t.text);
  return t.options[(i + 1) % t.options.length];
}

/** Text runs take any single line (it is escaped where it lands); a line break, or a character XML can't hold, is refused. */
export function checkText(t: TextToken, input: string): Checked {
  if (/[\r\n]/.test(input)) return { error: 'Text here is a single line' };
  const why = tokenTextError(t, input);
  return why ? { error: why } : { text: input };
}

/** A short, human label for a history entry: "Scrub cx", "Set fill". */
export function labelFor(verb: string, t: Token): string {
  return `${verb} ${t.prop}`;
}
