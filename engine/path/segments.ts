// Segment rewrites (P1-M3): how every edit of a <path>'s d that isn't a plain token edit is written,
// byte-locally.
//
// - Numbers only (a point moved, a control, a flag): each changed number's characters are rewritten
//   in place, every other byte kept (a glue space only inside a replaced span, as rewriteNumbers).
// - A segment rewrite (a letter changes, arguments are added or dropped: L → Q, H → L, S → C, Close,
//   Open, Reverse): only that segment's text changes, from its command letter to its last argument;
//   its leading separators stay. The new text is the letter, then the arguments, separated as the old
//   segment was: when its arguments held a comma, pairs by ", " and the numbers of a pair by one
//   space (SVG Lab's `C 22 20, 40 20, 50 55`), else every number by one space. A number whose value
//   doesn't change keeps its source text; a new one is written with fmt in the fewest places that
//   hold it exactly (a value on the snap step prints as the step writes it).
// - An implicit segment that is rewritten gets its letter written; an implicit segment that followed
//   a rewritten one and would now mean something else gets its own letter written, so it keeps meaning
//   what it meant. Nothing else changes: the other segments' raws, the tail, newlines and indentation.
// - Every write is given as the new absolute geometry of the segments it names (toAbsolute's form)
//   and their letters. A relative segment after a moved point is compensated (its numbers are offsets
//   from where its start is now), an H that would leave its row (or a V its column) becomes an L, and
//   the result is read back: anything that doesn't read as intended is refused, never written.
// - A raw d holding a reference (&…;) is refused: Draw edits the numbers it can see one-to-one.
//
// All of it is pure and DOM-free; engine/path/nodes.ts plans the node tool's drags with it.

import { argSpans, isFlag, parsePath, type ParsedPath, type Seg } from './parse.ts';
import { toAbsolute, type AbsSeg } from './abs.ts';
import { fmt } from '../values/number-format.ts';
import { TokenEditError } from '../code/edit.ts';

export const REFERENCES = 'Its path data is written with entity references, so Draw can’t change its numbers.';

/** A path's raw d, read for writing: its segments and their absolute geometry (same index). */
export interface PathText {
  raw: string;
  p: ParsedPath;
  abs: AbsSeg[];
}

/** The raw d read for a write; refused (TokenEditError) when it holds a reference. */
export function readPathText(raw: string): PathText {
  if (raw.includes('&')) throw new TokenEditError(REFERENCES);
  const p = parsePath(raw);
  return { raw, p, abs: toAbsolute(p) };
}

// ── numbers ────────────────────────────────────────────────────────────────────────────────────

/** v in the fewest places (from `min`) that hold it exactly: sums and differences of written numbers come out as written. */
export function exactText(v: number, min = 0): string {
  for (let d = min; d <= 12; d++) {
    const s = fmt(v, d);
    if (Math.abs(Number(s) - v) <= 1e-10 * Math.max(1, Math.abs(v))) return s;
  }
  return fmt(v, 12);
}

/** Places a step is written with (1 → 0, 0.5 → 1, 0.05 → 2). */
function stepPlaces(step: number): number {
  const s = fmt(step, 10);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** v rounded to the snap step (half up, as SVG Lab's Math.round), written as the step writes it. */
export function onStep(v: number, step: number): number {
  return Number(fmt(Math.round(v / step) * step, stepPlaces(step)));
}

// ── roles: what each argument of a command is ──────────────────────────────────────────────────

type Role = 'x' | 'y' | 'c1x' | 'c1y' | 'c2x' | 'c2y' | 'qx' | 'qy' | 'rx' | 'ry' | 'rot' | 'large' | 'sweep';

const ROLES: Readonly<Record<string, readonly Role[]>> = {
  M: ['x', 'y'],
  L: ['x', 'y'],
  T: ['x', 'y'],
  H: ['x'],
  V: ['y'],
  C: ['c1x', 'c1y', 'c2x', 'c2y', 'x', 'y'],
  S: ['c2x', 'c2y', 'x', 'y'],
  Q: ['qx', 'qy', 'x', 'y'],
  A: ['rx', 'ry', 'rot', 'large', 'sweep', 'x', 'y'],
  Z: [],
};
// How the arguments group when a segment is spelled with commas (pairs of coordinates).
const GROUPS: Readonly<Record<string, readonly number[]>> = { M: [2], L: [2], T: [2], H: [1], V: [1], C: [2, 2, 2], S: [2, 2], Q: [2, 2], A: [2, 1, 2, 2], Z: [] };
const X_ROLES = new Set<Role>(['x', 'c1x', 'c2x', 'qx']);
const Y_ROLES = new Set<Role>(['y', 'c1y', 'c2y', 'qy']);

export const rolesOf = (cmd: string): readonly Role[] => ROLES[cmd.toUpperCase()] ?? [];

/** The value a role has in an absolute segment (toAbsolute's form). */
function valueOf(s: AbsSeg, r: Role): number {
  switch (r) {
    case 'x':
      return s.x;
    case 'y':
      return s.y;
    case 'c1x':
    case 'qx':
      return s.type === 'C' || s.type === 'Q' ? s.x1 : NaN;
    case 'c1y':
    case 'qy':
      return s.type === 'C' || s.type === 'Q' ? s.y1 : NaN;
    case 'c2x':
      return s.type === 'C' ? s.x2 : NaN;
    case 'c2y':
      return s.type === 'C' ? s.y2 : NaN;
    case 'rx':
      return s.type === 'A' ? s.rx : NaN;
    case 'ry':
      return s.type === 'A' ? s.ry : NaN;
    case 'rot':
      return s.type === 'A' ? s.rot : NaN;
    case 'large':
      return s.type === 'A' ? Number(s.large) : NaN;
    case 'sweep':
      return s.type === 'A' ? Number(s.sweep) : NaN;
  }
}

/** The command a letter-less segment after `prev` repeats (M → L, m → l). */
export const impliedAfter = (prev: string): string => (prev === 'M' ? 'L' : prev === 'm' ? 'l' : prev);

// ── the writer ─────────────────────────────────────────────────────────────────────────────────

/** One segment's new letter and absolute geometry (toAbsolute's form; S's and T's implied control is theirs, never written). */
export interface Rewrite {
  index: number;
  cmd: string;
  geo: AbsSeg;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const GLUE_BEFORE = /[\d.]$/;

/**
 * The raw d with these segments rewritten (the header's rule). Segments not named keep their
 * geometry; each segment's numbers are written from where its start is now, so a relative one after a
 * moved point keeps its end (and a letter-less one follows its command). Throws TokenEditError.
 */
export function rewriteSegments(raw: string, rewrites: readonly Rewrite[]): string {
  const t = readPathText(raw);
  return writeGeometry(t, rewrites);
}

/** rewriteSegments over an already read path. */
export function writeGeometry(t: PathText, rewrites: readonly Rewrite[]): string {
  const { p, abs } = t;
  const segs = p.segs;
  const letters = segs.map((s) => s.cmd);
  const geo: AbsSeg[] = abs.slice();
  for (const r of rewrites) {
    if (r.index < 0 || r.index >= segs.length) throw new TokenEditError('no such segment');
    letters[r.index] = r.cmd;
    geo[r.index] = r.geo;
  }
  // A letter-less segment keeps meaning what it meant: when the letter before it changed, its own is
  // written (inPlace, below).
  let out = '';
  let lastChar = ''; // out's last character, kept as it grows: reading it from out would flatten the whole string per segment
  const expected: { cmd: string; args: number[] }[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0; // the current point and the subpath's start, as the new path draws them
  segs.forEach((seg, i) => {
    let cmd = letters[i];
    const g = geo[i];
    let U = cmd.toUpperCase();
    const rel = cmd !== U;
    // An H that would leave its row, or a V its column, becomes a line.
    if ((U === 'H' && !same(g.y, cy)) || (U === 'V' && !same(g.x, cx))) {
      cmd = rel ? 'l' : 'L';
      U = 'L';
      letters[i] = cmd;
    }
    const roles = ROLES[U];
    const oldRoles = rolesOf(seg.cmd);
    const spans = argSpans(seg);
    const oldText = new Map<Role, string>();
    const oldValue = new Map<Role, number>();
    oldRoles.forEach((r, k) => {
      oldText.set(r, seg.raw.slice(spans[k].start, spans[k].end));
      oldValue.set(r, seg.args[k]);
    });
    const texts = roles.map((r) => {
      let v = valueOf(g, r);
      if (!Number.isFinite(v)) throw new TokenEditError(`the new ${U} has no ${r}`);
      if (rel && X_ROLES.has(r)) v -= cx;
      if (rel && Y_ROLES.has(r)) v -= cy;
      if (r === 'large' || r === 'sweep') return v ? '1' : '0';
      const was = oldValue.get(r);
      return was !== undefined && same(was, v) ? oldText.get(r)! : exactText(v);
    });
    const prevLetter = i > 0 ? letters[i - 1] : '';
    let text: string;
    if (U !== seg.cmd.toUpperCase()) text = respelled(seg, spans, cmd, texts); // another kind: written anew, with its letter
    else if (seg.implicit && cmd === impliedAfter(prevLetter)) text = inPlace(seg, spans, texts, null, lastChar);
    else text = inPlace(seg, spans, texts, cmd, lastChar);
    // A new last number mustn't glue to what follows it ("1" before ".5" reads as 1.5).
    const next = i + 1 < segs.length ? segs[i + 1].raw : p.tail;
    const oldLast = spans.length ? seg.raw.slice(spans[spans.length - 1].start, spans[spans.length - 1].end) : null;
    if (texts.length && texts[texts.length - 1] !== oldLast && GLUE_BEFORE.test(text) && /^[\d.eE]/.test(next)) text += ' ';
    out += text;
    if (text) lastChar = text[text.length - 1];
    expected.push({ cmd, args: texts.map(Number) });
    if (U === 'M') [sx, sy] = [g.x, g.y];
    [cx, cy] = U === 'Z' ? [sx, sy] : [g.x, g.y];
  });
  out += p.tail;

  // Read it back: the same segments, each with the letter and numbers intended.
  const back = parsePath(out);
  const ok = back.segs.length === segs.length && !!back.error === !!p.error &&
    back.segs.every((s, i) => s.cmd === expected[i].cmd && s.args.length === expected[i].args.length && s.args.every((v, k) => v === expected[i].args[k]));
  if (!ok) throw new TokenEditError('the new segment would change how the rest of the path reads');
  return out;
}

// A segment of the same kind (a letter's case may change): each changed number's characters in
// place, and the letter swapped, or written before a letter-less one that now needs it. `before` is
// the last character written before this segment (a letter-less segment may be glued to it by its sign).
function inPlace(seg: Seg, spans: readonly { start: number; end: number }[], texts: readonly string[], letter: string | null, before: string): string {
  const raw = seg.raw;
  let head: string;
  let at: number; // where the arguments' region starts in raw
  if (seg.implicit) {
    at = spans.length ? spans[0].start : raw.length;
    const lead = raw.slice(0, at).replace(',', '');
    head = letter === null ? raw.slice(0, at) : `${lead === '' ? ' ' : lead}${letter} `;
  } else {
    const li = raw.search(/[^ \t\n\r\f]/);
    at = li + 1;
    head = raw.slice(0, li) + (letter ?? raw[li]);
  }
  let out = head;
  let pos = at;
  spans.forEach((sp, k) => {
    const was = raw.slice(sp.start, sp.end);
    out += raw.slice(pos, sp.start);
    let t = texts[k];
    if (t !== was && !isFlag(seg.cmd, k)) {
      if (GLUE_BEFORE.test(out === '' ? before : out) && /^[\d.]/.test(t)) t = ` ${t}`;
      const after = raw.slice(sp.end);
      if (/^\d/.test(after) || /^[eE][+-]?\d/.test(after) || (after.startsWith('.') && !t.includes('.'))) t += ' ';
    }
    out += t;
    pos = sp.end;
  });
  return out + raw.slice(pos);
}

// A segment written anew: its leading separators, the letter, then the arguments, separated as the
// old segment's were (see the header).
function respelled(seg: Seg, spans: readonly { start: number; end: number }[], letter: string, texts: readonly string[]): string {
  const raw = seg.raw;
  let lead: string;
  let after = ' ';
  if (seg.implicit) {
    const at = spans.length ? spans[0].start : raw.length;
    lead = raw.slice(0, at).replace(',', '');
    if (lead === '') lead = ' ';
  } else {
    const li = raw.search(/[^ \t\n\r\f]/);
    lead = raw.slice(0, li);
    if (spans.length && spans[0].start === li + 1) after = '';
  }
  const region = spans.length ? raw.slice(spans[0].start) : '';
  return lead + letter + (texts.length ? after + spell(letter, texts, region.includes(',')) : '');
}

/** The arguments as SVG Lab writes them: pairs by ", " with commas, else every number by one space. */
export function spell(letter: string, texts: readonly string[], comma: boolean): string {
  if (!comma) return texts.join(' ');
  const out: string[] = [];
  let k = 0;
  for (const n of GROUPS[letter.toUpperCase()]) {
    out.push(texts.slice(k, k + n).join(' '));
    k += n;
  }
  return out.join(', ');
}

// ── what a rewrite leaves to the segment after it ──────────────────────────────────────────────

const reflect = (p: number, c: number): number => 2 * p - c;

/**
 * The control an S or T at `i` implies in this geometry (the reflection of the segment before's
 * second or Q control about its end, or the start itself), for the letters given.
 */
function impliedControl(letters: readonly string[], geo: readonly AbsSeg[], i: number): [number, number] {
  const prev = geo[i - 1];
  const px = prev.x;
  const py = prev.y;
  const U = letters[i].toUpperCase();
  const pU = letters[i - 1].toUpperCase();
  if (U === 'S' && (pU === 'C' || pU === 'S') && prev.type === 'C') return [reflect(px, prev.x2), reflect(py, prev.y2)];
  if (U === 'T' && (pU === 'Q' || pU === 'T') && prev.type === 'Q') return [reflect(px, prev.x1), reflect(py, prev.y1)];
  return [px, py];
}

/**
 * The rewrites plus, when the segment after one of them is an S or T whose implied control would
 * change, that segment written out (S → C, T → Q, its control as it was), so it keeps its shape.
 */
export function withFollowers(t: PathText, rewrites: readonly Rewrite[]): Rewrite[] {
  const segs = t.p.segs;
  const letters = segs.map((s) => s.cmd);
  const geo = t.abs.slice();
  for (const r of rewrites) {
    letters[r.index] = r.cmd;
    geo[r.index] = r.geo;
  }
  const out = [...rewrites];
  const named = new Set(rewrites.map((r) => r.index));
  for (const r of rewrites) {
    const j = r.index + 1;
    if (j >= segs.length || named.has(j)) continue;
    const U = segs[j].cmd.toUpperCase();
    if (U !== 'S' && U !== 'T') continue;
    const was = t.abs[j] as AbsSeg & { x1: number; y1: number };
    const [ix, iy] = impliedControl(letters, geo, j);
    if (same(ix, was.x1) && same(iy, was.y1)) continue;
    const rel = segs[j].cmd !== U;
    out.push({ index: j, cmd: U === 'S' ? (rel ? 'c' : 'C') : rel ? 'q' : 'Q', geo: t.abs[j] });
  }
  return out;
}

// ── the letter cycle: L → Q → C → L (SVG Lab's setSeg) ─────────────────────────────────────────

export interface CycleOpts {
  /** The root's snap step: new controls land on it. */
  step: number;
  /** The artboard's scale, min(W, H) / 100 (M2's k): the bend's least offset is 8k. */
  k: number;
}

/** The control SVG Lab's setSeg gives a straight segment turned into a Q: off its midpoint by max(8k, 0.3·len) along the normal. */
export function bendControl(x0: number, y0: number, x1: number, y1: number, opts: CycleOpts): [number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.max(8 * opts.k, 0.3 * len);
  return [onStep((x0 + x1) / 2 + (-dy / len) * off, opts.step), onStep((y0 + y1) / 2 + (dx / len) * off, opts.step)];
}

const NEXT: Readonly<Record<string, string>> = { L: 'Q', Q: 'C', C: 'L' };

/** A written L, Q or C letter cycled to the next (L → Q → C → L), its geometry converted as SVG Lab's setSeg. */
export function cycleSegment(raw: string, index: number, opts: CycleOpts): string {
  const t = readPathText(raw);
  const seg = t.p.segs[index];
  const a = t.abs[index];
  const U = seg?.cmd.toUpperCase();
  if (!seg || !NEXT[U]) throw new TokenEditError('Only an L, Q or C segment changes its letter.');
  const to = NEXT[U];
  const cmd = seg.cmd === U ? to : to.toLowerCase();
  const base = { cmd: seg.cmd, sub: a.sub, x0: a.x0, y0: a.y0, x: a.x, y: a.y };
  let geo: AbsSeg;
  if (to === 'Q') {
    const [x1, y1] = bendControl(a.x0, a.y0, a.x, a.y, opts);
    geo = { ...base, type: 'Q', x1, y1 };
  } else if (to === 'C' && a.type === 'Q') {
    // Degree elevation: exact before rounding.
    geo = {
      ...base, type: 'C',
      x1: onStep(a.x0 + (2 / 3) * (a.x1 - a.x0), opts.step), y1: onStep(a.y0 + (2 / 3) * (a.y1 - a.y0), opts.step),
      x2: onStep(a.x + (2 / 3) * (a.x1 - a.x), opts.step), y2: onStep(a.y + (2 / 3) * (a.y1 - a.y), opts.step),
    };
  } else geo = { ...base, type: 'L' };
  return writeGeometry(t, withFollowers(t, [{ index, cmd, geo }]));
}

// ── node types: Smooth (S after C or S, T after Q or T) and Corner ─────────────────────────────

/** Whether the node at the end of segment `k` is smooth, a corner Make smooth can smooth, or neither (no toggle). */
export function nodeType(p: ParsedPath, k: number): 'smooth' | 'corner' | null {
  const a = p.segs[k];
  const b = p.segs[k + 1];
  if (!a || !b) return null;
  const inU = a.cmd.toUpperCase();
  const outU = b.cmd.toUpperCase();
  const cubicIn = inU === 'C' || inU === 'S';
  const quadIn = inU === 'Q' || inU === 'T';
  if ((outU === 'S' && cubicIn) || (outU === 'T' && quadIn)) return 'smooth';
  if ((outU === 'C' && cubicIn) || (outU === 'Q' && quadIn)) return 'corner';
  return null;
}

/** Make smooth: the node's outgoing C written as S (its first control dropped: it becomes the mirror), or its Q as T. */
export function makeSmooth(raw: string, k: number): string {
  const t = readPathText(raw);
  if (nodeType(t.p, k) !== 'corner') throw new TokenEditError('This node can’t be made smooth.');
  const seg = t.p.segs[k + 1];
  const U = seg.cmd.toUpperCase();
  const to = U === 'C' ? 'S' : 'T';
  // Its new geometry: the dropped control is the mirror of the incoming one about the node.
  const a = t.abs[k] as AbsSeg & { x1: number; y1: number; x2: number; y2: number };
  const [mx, my] = U === 'C' ? [reflect(a.x, a.x2), reflect(a.y, a.y2)] : [reflect(a.x, a.x1), reflect(a.y, a.y1)];
  const geo = { ...t.abs[k + 1], x1: mx, y1: my } as AbsSeg;
  return writeGeometry(t, withFollowers(t, [{ index: k + 1, cmd: seg.cmd === U ? to : to.toLowerCase(), geo }]));
}

/** Make corner: the node's outgoing S written as C (or T as Q) with its implied control written out, so nothing moves. */
export function makeCorner(raw: string, k: number): string {
  const t = readPathText(raw);
  if (nodeType(t.p, k) !== 'smooth') throw new TokenEditError('This node is a corner already.');
  const seg = t.p.segs[k + 1];
  const U = seg.cmd.toUpperCase();
  const to = U === 'S' ? 'C' : 'Q';
  return writeGeometry(t, [{ index: k + 1, cmd: seg.cmd === U ? to : to.toLowerCase(), geo: t.abs[k + 1] }]);
}

// ── Close and Open (the last subpath) ──────────────────────────────────────────────────────────

/** Does the path's last subpath end with Z? */
export const lastClosed = (p: ParsedPath): boolean => p.segs.length > 0 && p.segs[p.segs.length - 1].cmd.toUpperCase() === 'Z';

/** Close: ` Z` right after the path's last segment (before its trailing whitespace). */
export function closeLast(raw: string): string {
  const t = readPathText(raw);
  const segs = t.p.segs;
  if (!segs.length) throw new TokenEditError('There is no path to close.');
  if (lastClosed(t.p)) throw new TokenEditError('It’s closed already.');
  const body = raw.slice(0, raw.length - t.p.tail.length);
  const out = `${body} Z${t.p.tail}`;
  const back = parsePath(out);
  if (back.segs.length !== segs.length + 1 || !lastClosed(back)) throw new TokenEditError('the new segment would change how the rest of the path reads');
  return out;
}

/** Open: the path's final Z taken away, with the separators before it. */
export function openLast(raw: string): string {
  const t = readPathText(raw);
  const segs = t.p.segs;
  if (!lastClosed(t.p)) throw new TokenEditError('It’s open already.');
  const body = raw.slice(0, raw.length - t.p.tail.length - segs[segs.length - 1].raw.length);
  const out = body + t.p.tail;
  const back = parsePath(out);
  if (back.segs.length !== segs.length - 1) throw new TokenEditError('the new segment would change how the rest of the path reads');
  return out;
}

// ── Relative and Absolute ──────────────────────────────────────────────────────────────────────

/**
 * Every segment after the first is lowercase (and there is one): the toggle reads Absolute. A
 * letter-less segment counts as the command it repeats, so `m 1 2 3 4` reads relative and `M 1 2 3 4`
 * absolute.
 */
export function readsRelative(p: ParsedPath): boolean {
  const rest = p.segs.slice(1);
  return rest.length > 0 && rest.every((s) => s.cmd === s.cmd.toLowerCase());
}

/**
 * Make relative (every written letter lowercase, each coordinate an offset from its segment's start)
 * or, when the path reads relative, Make absolute. Arc radii, rotation and flags, separators, newlines
 * and the tail never change; a number whose value doesn't change keeps its text.
 */
export function toggleRelative(raw: string): string {
  const t = readPathText(raw);
  const toRel = !readsRelative(t.p);
  const rewrites: Rewrite[] = [];
  let prev = '';
  t.p.segs.forEach((s, i) => {
    const cmd = s.implicit ? impliedAfter(prev) : toRel ? s.cmd.toLowerCase() : s.cmd.toUpperCase();
    prev = cmd;
    if (cmd !== s.cmd) rewrites.push({ index: i, cmd, geo: t.abs[i] });
  });
  return writeGeometry(t, rewrites);
}

// ── Reverse (a subpath's direction: the holes' other way) ──────────────────────────────────────

/** The separators before a segment's letter (for a letter-less one, those before its first number, without a comma: a letter mustn't follow one). */
function leadOf(seg: Seg): string {
  if (seg.implicit) {
    const spans = argSpans(seg);
    const lead = seg.raw.slice(0, spans.length ? spans[0].start : seg.raw.length).replace(',', '');
    return lead === '' ? ' ' : lead;
  }
  return seg.raw.slice(0, seg.raw.search(/[^ \t\n\r\f]/));
}

/** A written argument's source text, or undefined when the segment is relative (its numbers are offsets, not points) or doesn't write that role. */
function absText(seg: Seg, role: Role): string | undefined {
  if (seg.cmd !== seg.cmd.toUpperCase()) return undefined;
  const k = rolesOf(seg.cmd).indexOf(role);
  if (k === -1) return undefined;
  const sp = argSpans(seg)[k];
  return seg.raw.slice(sp.start, sp.end);
}

/** How a segment spells its arguments: glued to its letter, and with commas. */
function styleOf(seg: Seg): { glued: boolean; comma: boolean } {
  const spans = argSpans(seg);
  if (!spans.length) return { glued: false, comma: false };
  const li = seg.raw.search(/[^ \t\n\r\f]/);
  return { glued: !seg.implicit && spans[0].start === li + 1, comma: seg.raw.slice(spans[0].start).includes(',') };
}

const isLine = (cmd: string): boolean => 'LHV'.includes(cmd.toUpperCase());

/** The number of subpaths toAbsolute counts in a parsed path. */
export const subpathCount = (abs: readonly AbsSeg[]): number => (abs.length ? abs[abs.length - 1].sub + 1 : 0);

/**
 * Reverse: subpath `sub` (toAbsolute's numbering) drawn the other way, or every subpath when `sub` is
 * null (their order kept). The subpath's text from its M letter through its last segment is written
 * anew (the separators before the M stay; the i-th new segment takes the i-th old one's leading
 * separators, the Z its own), in this order:
 * 1. M at the start S when the subpath is closed (the M unchanged), else at its last anchor;
 * 2. closed, and the last anchor isn't S: a line to it (the closing line, reversed; `L`, or `l` when
 *    the Z is `z`);
 * 3. each drawing segment in reverse order, each ending at the anchor before it: L, H and V stay; C
 *    swaps its controls; Q keeps its control; A keeps its radii, rotation and large-arc flag and flips
 *    its sweep flag; S and T are written out as C and Q. In a closed subpath the last of them (the
 *    first segment, reversed) is left to the Z when it is a line, since the Z draws exactly it: the
 *    mirror of step 2, so a second Reverse gives the text back;
 * 4. Z if it was closed.
 * A segment keeps its case (a relative one's numbers become offsets from its new start); a coordinate
 * keeps the source text of the absolute number that wrote that point, and any other number is written
 * with exactText (an implied control, H's y, V's x: the fewest places that hold it, never more than
 * the path's own, since each is a sum or difference of its numbers). A relative m after an open
 * subpath is compensated, so nothing else moves. Throws TokenEditError.
 *
 * One read and one write, however many subpaths are reversed (the P1-M3 review, R2): each subpath is
 * read in the geometry the new text gives it (folded from the point the text written before it
 * reaches), so the result is exactly what reversing them one at a time, each over the last result,
 * writes.
 */
export function reverseSubpath(raw: string, sub: number | null): string {
  const t = readPathText(raw);
  if (sub !== null && !t.abs.some((s) => s.sub === sub)) throw new TokenEditError('There’s no such subpath.');
  const out = reverseSubpaths(t, sub);
  if (out === null) throw new TokenEditError('There’s no segment to reverse.');
  return out;
}

interface NewSeg {
  cmd: string;
  texts: string[];
  style: Seg; // whose spelling it takes
  keep?: string; // its raw kept as it is (a closed subpath's M)
}

type Expected = { cmd: string; args: number[] };

/** A segment from its letter and numbers alone: what a fold of the geometry reads. */
const segOf = (cmd: string, args: number[]): Seg => ({ cmd, implicit: false, args, raw: '' });

/** Segments' geometry when the current point before them is `at`: toAbsolute's own arithmetic, from a stand-in M at that point. */
function geometryFrom(at: readonly [number, number], segs: readonly Seg[]): AbsSeg[] {
  return toAbsolute({ segs: [segOf('M', [at[0], at[1]]), ...segs], tail: '', error: null }).slice(1);
}

/** Subpath `chosen` reversed, or every subpath when null; null when none has a segment to reverse. */
function reverseSubpaths(t: PathText, chosen: number | null): string | null {
  const { p, abs } = t;
  const segs = p.segs;
  const pieces: string[] = [];
  let lastChar = ''; // the last character written, kept as it goes (never read back from the text)
  const write = (s: string): void => {
    if (!s) return;
    pieces.push(s);
    lastChar = s[s.length - 1];
  };
  const expected: Expected[] = [];
  let at: [number, number] = [0, 0]; // the current point the new text has reached
  let open: { end: [number, number]; start: [number, number] } | null = null; // an open subpath just reversed, as it read before
  let reversed = false; // the subpath just written was reversed
  let n = 0;
  for (let first = 0; first < segs.length; ) {
    let last = first;
    while (last + 1 < segs.length && abs[last + 1].sub === abs[first].sub) last++;
    const own = segs.slice(first, last + 1);
    // A relative m after an open subpath that was reversed is compensated: its point stays where it was.
    if (open && own[0].cmd === 'm') {
      const m = own[0];
      const spans = argSpans(m);
      const texts = [open.end[0] + m.args[0] - open.start[0], open.end[1] + m.args[1] - open.start[1]]
        .map((v, k) => (same(v, m.args[k]) ? m.raw.slice(spans[k].start, spans[k].end) : exactText(v)));
      own[0] = { ...m, raw: inPlace(m, spans, texts, 'm', lastChar), args: texts.map(Number) };
    }
    if (reversed && GLUE_BEFORE.test(lastChar) && /^[\d.eE]/.test(own[0].raw)) write(' ');
    const geo = geometryFrom(at, own);
    const rev = chosen === null || chosen === abs[first].sub ? reverseOne(own, geo) : null;
    if (rev) {
      write(rev.text);
      for (const e of rev.expected) expected.push(e);
      const back = geometryFrom(at, rev.expected.map((e) => segOf(e.cmd, e.args)));
      at = [back[back.length - 1].x, back[back.length - 1].y];
      open = rev.closed ? null : { end: [geo[geo.length - 1].x, geo[geo.length - 1].y], start: rev.start };
      reversed = true;
      n++;
    } else {
      for (const s of own) {
        write(s.raw);
        expected.push({ cmd: s.cmd, args: s.args });
      }
      at = [geo[geo.length - 1].x, geo[geo.length - 1].y];
      open = null;
      reversed = false;
    }
    first = last + 1;
  }
  if (!n) return null;
  if (reversed && GLUE_BEFORE.test(lastChar) && /^[\d.eE]/.test(p.tail)) write(' ');
  write(p.tail);
  const text = pieces.join('');
  const back = parsePath(text);
  const ok = back.segs.length === expected.length && !!back.error === !!p.error &&
    back.segs.every((s, i) => s.cmd === expected[i].cmd && s.args.length === expected[i].args.length && s.args.every((v, k) => v === expected[i].args[k]));
  if (!ok) throw new TokenEditError('the reversed subpath would change how the rest of the path reads');
  return text;
}

/**
 * One subpath reversed: its segments (the first its head) and their geometry as the new text reads
 * them. Its new text, what it must read back as, whether it is closed, and its start as it read
 * before; null when it has no segment to reverse.
 */
function reverseOne(segs: readonly Seg[], abs: readonly AbsSeg[]): { text: string; expected: Expected[]; closed: boolean; start: [number, number] } | null {
  const last = segs.length - 1;
  const hasM = abs[0].type === 'M';
  const closed = abs[last].type === 'Z';
  const draw: number[] = [];
  abs.forEach((s, i) => {
    if (s.type !== 'M' && s.type !== 'Z') draw.push(i);
  });
  if (!draw.length) return null;
  const S: [number, number] = hasM ? [abs[0].x, abs[0].y] : [abs[0].x0, abs[0].y0];
  // P[j]: the subpath's anchors, P[0] = S; PT[j]: the text each of its coordinates was written with (absolute only).
  const P: [number, number][] = [S, ...draw.map((i): [number, number] => [abs[i].x, abs[i].y])];
  const PT: { x?: string; y?: string }[] = [
    hasM ? { x: absText(segs[0], 'x'), y: absText(segs[0], 'y') } : {},
    ...draw.map((i) => ({ x: absText(segs[i], 'x'), y: absText(segs[i], 'y') })),
  ];
  const m = draw.length;
  const An = P[m];

  // The new segments, each with its absolute values (per role) and the texts known for them.
  const out: NewSeg[] = [];
  let cur: [number, number] = [abs[0].x0, abs[0].y0]; // the current point before the subpath
  const put = (cmd: string, style: Seg, vals: [Role, number, string | undefined][], keep?: string) => {
    const rel = cmd !== cmd.toUpperCase();
    const texts = vals.map(([r, v, known]) => {
      if (r === 'large' || r === 'sweep' || r === 'rx' || r === 'ry' || r === 'rot') return known ?? exactText(v);
      if (rel) return exactText(v - (X_ROLES.has(r) ? cur[0] : cur[1]));
      return known ?? exactText(v);
    });
    out.push({ cmd, texts, style, keep });
    const x = vals.find(([r]) => r === 'x');
    const y = vals.find(([r]) => r === 'y');
    cur = cmd.toUpperCase() === 'Z' ? S : [x ? x[1] : cur[0], y ? y[1] : cur[1]];
  };
  // 1. M
  if (closed) {
    if (hasM) put(segs[0].cmd, segs[0], [['x', S[0], PT[0].x], ['y', S[1], PT[0].y]], segs[0].raw);
    cur = S;
  } else {
    const mSeg = hasM ? segs[0] : segs[draw[0]];
    const letter = hasM ? mSeg.cmd : mSeg.cmd === mSeg.cmd.toUpperCase() ? 'M' : 'm';
    put(letter, hasM ? mSeg : segs[last], [['x', An[0], PT[m].x], ['y', An[1], PT[m].y]]);
  }
  // 2. the closing line, reversed
  const z = closed ? segs[last] : null;
  if (z && !(same(An[0], S[0]) && same(An[1], S[1]))) {
    put(z.cmd === 'Z' ? 'L' : 'l', segs[draw[m - 1]], [['x', An[0], PT[m].x], ['y', An[1], PT[m].y]]);
  }
  // 3. each drawing segment, last first
  for (let j = m; j >= 1; j--) {
    const i = draw[j - 1];
    const seg = segs[i];
    const g = abs[i];
    const U = seg.cmd.toUpperCase();
    const rel = seg.cmd !== U;
    const to = P[j - 1];
    const tx = PT[j - 1];
    if (closed && j === 1 && isLine(seg.cmd)) break; // the Z draws it
    if (U === 'H') put(seg.cmd, seg, [['x', to[0], tx.x]]);
    else if (U === 'V') put(seg.cmd, seg, [['y', to[1], tx.y]]);
    else if (U === 'L') put(seg.cmd, seg, [['x', to[0], tx.x], ['y', to[1], tx.y]]);
    else if (g.type === 'C') {
      put(rel ? 'c' : 'C', seg, [
        ['c1x', g.x2, absText(seg, 'c2x')], ['c1y', g.y2, absText(seg, 'c2y')],
        ['c2x', g.x1, U === 'C' ? absText(seg, 'c1x') : undefined], ['c2y', g.y1, U === 'C' ? absText(seg, 'c1y') : undefined],
        ['x', to[0], tx.x], ['y', to[1], tx.y],
      ]);
    } else if (g.type === 'Q') {
      put(rel ? 'q' : 'Q', seg, [
        ['qx', g.x1, U === 'Q' ? absText(seg, 'qx') : undefined], ['qy', g.y1, U === 'Q' ? absText(seg, 'qy') : undefined],
        ['x', to[0], tx.x], ['y', to[1], tx.y],
      ]);
    } else if (g.type === 'A') {
      const spans = argSpans(seg);
      const src = (k: number) => seg.raw.slice(spans[k].start, spans[k].end);
      put(seg.cmd, seg, [
        ['rx', g.rx, src(0)], ['ry', g.ry, src(1)], ['rot', g.rot, src(2)],
        ['large', +g.large, src(3)], ['sweep', +!g.sweep, g.sweep ? '0' : '1'],
        ['x', to[0], tx.x], ['y', to[1], tx.y],
      ]);
    }
  }
  // 4. Z
  if (z) put(z.cmd, z, []);

  // The text: the new segments with the old leads by position (the Z its own).
  const leads = segs.map(leadOf);
  const zLead = z ? leads.pop()! : '';
  let text = '';
  const expected: Expected[] = [];
  out.forEach((n, k) => {
    const isZ = z !== null && k === out.length - 1;
    const lead = isZ ? zLead : (leads[Math.min(k, leads.length - 1)] ?? ' ');
    if (n.keep !== undefined) text += n.keep;
    else {
      const st = styleOf(n.style);
      text += lead + n.cmd + (n.texts.length ? (st.glued ? '' : ' ') + spell(n.cmd, n.texts, st.comma) : '');
    }
    expected.push({ cmd: n.cmd, args: n.texts.map(Number) });
  });
  return { text, expected, closed, start: S };
}

// ── an arc's flags (a ghost arc tapped) ────────────────────────────────────────────────────────

/**
 * Arc segment `index` with its large-arc and sweep flags set: the two flag characters rewritten in
 * place (packed flags too: `0 01`, `001`), every other byte kept. Throws TokenEditError.
 */
export function setArcFlags(raw: string, index: number, large: boolean, sweep: boolean): string {
  const t = readPathText(raw);
  const seg = t.p.segs[index];
  if (!seg || seg.cmd.toUpperCase() !== 'A') throw new TokenEditError('That segment isn’t an arc.');
  const spans = argSpans(seg);
  let r = seg.raw;
  const put = (k: number, v: boolean) => {
    r = r.slice(0, spans[k].start) + (v ? '1' : '0') + r.slice(spans[k].end); // one character for one
  };
  put(3, large);
  put(4, sweep);
  const segs = t.p.segs;
  const out = segs.slice(0, index).map((s) => s.raw).join('') + r + segs.slice(index + 1).map((s) => s.raw).join('') + t.p.tail;
  const back = parsePath(out);
  const ok = back.segs.length === segs.length && back.segs.every((s, i) => s.cmd === segs[i].cmd && s.args.every((v, k) => v === (i === index && k === 3 ? +large : i === index && k === 4 ? +sweep : segs[i].args[k])));
  if (!ok) throw new TokenEditError('the new flags would change how the rest of the path reads');
  return out;
}
