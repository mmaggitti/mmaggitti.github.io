// Path data back to text. Serializing concatenates raw slices, so an untouched path is byte-identical.
// An edit regenerates exactly one segment: its leading separators and command letter (or its
// implicit form) stay, the edited number is written with fmt, and the other numbers keep their
// source text. Separators inside the segment become one space, or a comma where the source had one.

import { argSpans, isFlag, FLT_MAX, type ParsedPath, type Seg } from './parse.ts';
import { fmt } from '../values/number-format.ts';

export function serializePath(p: ParsedPath): string {
  return p.segs.map((s) => s.raw).join('') + p.tail;
}

/** A new path with one argument changed; every other segment keeps its raw bytes. */
export function editArg(p: ParsedPath, segIndex: number, argIndex: number, value: number, decimals = 3): ParsedPath {
  const seg = p.segs[segIndex];
  if (!seg || !Number.isInteger(argIndex) || argIndex < 0 || argIndex >= seg.args.length) throw new RangeError('no such path argument');
  const flag = isFlag(seg.cmd, argIndex);
  if (flag && value !== 0 && value !== 1) throw new RangeError('an arc flag is 0 or 1');
  const text = flag ? String(value) : fmt(value, decimals);
  if (!(Math.abs(Number(text)) <= FLT_MAX)) throw new RangeError('a path number must fit a float');

  const spans = argSpans(seg);
  let prefix = seg.raw.slice(0, spans[0].start);
  // An implicit segment may be glued to the number before it ("1-2-3"): keep them apart.
  if (prefix === '' && argIndex === 0 && !/^[-+]/.test(text)) prefix = ' ';
  let out = prefix;
  spans.forEach((sp, k) => {
    if (k > 0) out += seg.raw.slice(spans[k - 1].end, sp.start).includes(',') ? ',' : ' ';
    out += k === argIndex ? text : seg.raw.slice(sp.start, sp.end);
  });
  // What follows may be glued to this segment's last number: the next segment by a '.' ("1.5.5"),
  // or an error tail by an 'e' the old number's own exponent stopped ("1e2E-1"). Keep them apart.
  const next = segIndex + 1 < p.segs.length ? p.segs[segIndex + 1].raw : p.tail;
  if (argIndex === spans.length - 1 && (/^[eE]/.test(next) || (next.startsWith('.') && !text.includes('.')))) out += ' ';

  const args = seg.args.slice();
  args[argIndex] = Number(text);
  const edited: Seg = { ...seg, args, raw: out };
  // An error always sits in the tail, after every segment: it moves by the edit's change in length.
  const error = p.error && { ...p.error, at: p.error.at + out.length - seg.raw.length };
  return { ...p, segs: p.segs.map((s, k) => (k === segIndex ? edited : s)), error };
}
