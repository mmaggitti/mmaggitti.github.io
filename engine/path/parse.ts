// Lossless path-data parser (the `d` attribute, SVG 2 §9.3.9).
//
// Every character of the input lands in exactly one segment's `raw` or in `tail`, so
// `segs.map(s => s.raw).join('') + tail === d` for ANY string. A segment's raw starts with the
// separators before it; that is what lets an edit regenerate one segment and leave every other byte
// of the attribute alone (serialize.ts).
//
// SVG renders a path up to its first error, so parsing stops there: the complete segments before it
// are kept, and the unparsed rest goes to `tail` with the error's position. Where the engines
// disagree, parsing stops at the earliest point any of Blink, WebKit and Gecko stops, so every
// segment kept here is drawn by all three:
// - numbers: a digit must follow '.', an 'e' commits to an exponent (Blink, WebKit), values must fit
//   a float;
// - separators: comma_wsp between arguments only, as in the grammar and Gecko. A comma before a
//   command letter, or a trailing one, is an error (Blink and WebKit tolerate both).
// Parsing is linear and total: it never throws.

export interface Seg {
  cmd: string; // the command letter as written; for an implicit segment the one it repeats ('L'/'l' after 'M'/'m')
  implicit: boolean; // written without its letter, continuing the previous command
  args: number[];
  raw: string; // exact source text, including the separators before it
}

export interface PathError {
  at: number; // index into d
  message: string;
}

export interface ParsedPath {
  segs: Seg[];
  tail: string; // unparsed rest: trailing whitespace, or everything from the failed segment on
  error: PathError | null;
}

/** Arguments per command. */
export const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** True for the large-arc and sweep flags of an arc, which are single characters '0' or '1'. */
export const isFlag = (cmd: string, argIndex: number): boolean => (cmd === 'A' || cmd === 'a') && (argIndex === 3 || argIndex === 4);

/** Browsers parse path numbers as 32-bit floats and reject anything larger. */
export const FLT_MAX = 3.4028234663852886e38;
const COMMANDS = 'MmLlHhVvCcSsQqTtAaZz';
const isWsp = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isDigit = (c: string) => c >= '0' && c <= '9';

function skipWsp(s: string, i: number): number {
  while (i < s.length && isWsp(s[i])) i++;
  return i;
}

// comma_wsp? : wsp* ','? wsp*
function skipCommaWsp(s: string, i: number): number {
  i = skipWsp(s, i);
  return s[i] === ',' ? skipWsp(s, i + 1) : i;
}

type Read = { end: number; value: number } | PathError;

function readNumber(s: string, i: number): Read {
  let j = i;
  if (s[j] === '+' || s[j] === '-') j++;
  const digits = j;
  while (j < s.length && isDigit(s[j])) j++;
  if (s[j] === '.' && isDigit(s[j + 1])) {
    j += 2;
    while (j < s.length && isDigit(s[j])) j++;
  } else if (j === digits) {
    return { at: i, message: i < s.length ? 'expected a number' : 'expected a number, found the end' };
  } else if (s[j] === '.') {
    return { at: j, message: "expected a digit after '.'" };
  }
  // Values must fit a float: Blink and WebKit check the digits alone, then the whole value.
  if (!(Math.abs(Number(s.slice(i, j))) <= FLT_MAX)) return { at: i, message: 'number out of range' };
  // They also commit to an exponent at any 'e' with a character after it, except the units
  // "ex" and "em" (Gecko backs off instead), and refuse a positive exponent over 38 even on zero.
  if ((s[j] === 'e' || s[j] === 'E') && j + 1 < s.length && s[j + 1] !== 'x' && s[j + 1] !== 'm') {
    j++;
    const negative = s[j] === '-';
    if (s[j] === '+' || s[j] === '-') j++;
    const e = j;
    while (j < s.length && isDigit(s[j])) j++;
    if (j === e) return { at: j, message: 'expected a digit in the exponent' };
    if (!negative && Number(s.slice(e, j)) > 38) return { at: i, message: 'number out of range' };
  }
  const value = Number(s.slice(i, j));
  if (!(Math.abs(value) <= FLT_MAX)) return { at: i, message: 'number out of range' };
  return { end: j, value };
}

function readFlag(s: string, i: number): Read {
  if (s[i] === '0' || s[i] === '1') return { end: i + 1, value: s[i] === '1' ? 1 : 0 };
  return { at: i, message: 'expected an arc flag (0 or 1)' };
}

type Span = { start: number; end: number };
type SegRead = { seg: Omit<Seg, 'raw'>; end: number; spans: Span[] } | PathError | null;

// One segment starting at `pos` (separators included). `prev` is the previous command, '' at the
// start. Returns null at the end of the input (only whitespace left).
function readSeg(s: string, pos: number, prev: string): SegRead {
  const i = skipWsp(s, pos);
  if (i >= s.length) return null;
  const c = s[i];
  let cmd: string;
  let implicit: boolean;
  let j: number;
  if (COMMANDS.includes(c)) {
    if (!prev && c !== 'M' && c !== 'm') return { at: i, message: 'path data must start with M or m' };
    cmd = c;
    implicit = false;
    j = skipWsp(s, i + 1);
  } else if (!prev) {
    return { at: i, message: 'path data must start with M or m' };
  } else if (/[A-Za-z]/.test(c)) {
    return { at: i, message: `'${c}' is not a path command` };
  } else if (prev === 'Z' || prev === 'z') {
    return { at: i, message: `expected a command after ${prev}` };
  } else {
    cmd = prev === 'M' ? 'L' : prev === 'm' ? 'l' : prev;
    implicit = true;
    j = skipCommaWsp(s, pos);
  }
  const n = ARITY[cmd.toUpperCase()];
  const args: number[] = [];
  const spans: Span[] = [];
  let end = implicit ? j : i + 1;
  for (let k = 0; k < n; k++) {
    if (k > 0) j = skipCommaWsp(s, end);
    const r = isFlag(cmd, k) ? readFlag(s, j) : readNumber(s, j);
    if ('message' in r) return r;
    args.push(r.value);
    spans.push({ start: j, end: r.end });
    end = r.end;
  }
  return { seg: { cmd, implicit, args }, end, spans };
}

export function parsePath(d: string): ParsedPath {
  const segs: Seg[] = [];
  let pos = 0;
  let prev = '';
  for (;;) {
    const r = readSeg(d, pos, prev);
    if (r === null) return { segs, tail: d.slice(pos), error: null };
    if ('message' in r) return { segs, tail: d.slice(pos), error: r };
    segs.push({ ...r.seg, raw: d.slice(pos, r.end) });
    pos = r.end;
    prev = r.seg.cmd;
  }
}

/** Where each argument's text sits inside seg.raw (for regenerating one segment). */
export function argSpans(seg: Seg): Span[] {
  const r = readSeg(seg.raw, 0, seg.cmd);
  // An edited segment may end with a space that keeps it apart from the next one (serialize.ts).
  if (r === null || 'message' in r || skipWsp(seg.raw, r.end) !== seg.raw.length || r.seg.args.length !== seg.args.length) {
    throw new Error('segment raw text does not match its command');
  }
  return r.spans;
}
