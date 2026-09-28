// Numbers as Draw writes them into SVG (rounded, minimal, one plain decimal each), and the
// number-list microsyntax it reads them back from.
//
// - No exponent notation (1e-7 is '0', 1e21 is all 22 digits): SVG 1.1 readers and some tools
//   reject it, and an 'e' inside path data is easy to misread.
// - Always a leading zero ('0.5', never '.5'), and numbers in a list are joined by one space.
//   Together these mean output never forms a run of dotted numbers (legal compact path data), which
//   the public-repo guard (scripts/lib/public-rules.mjs) would read as a private IPv4 address.
// - Never '-0', and no trailing zeros.

/** Round to `decimals` places and write the shortest plain decimal. Throws on NaN or Infinity. */
export function fmt(n: number, decimals = 3): string {
  if (!Number.isFinite(n)) throw new RangeError(`fmt: ${n} is not a finite number`);
  // toFixed switches to exponent notation from 1e21, where every double is already an integer
  if (Math.abs(n) >= 1e21) return BigInt(n).toString();
  let s = n.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

export function joinNumbers(list: readonly number[], decimals = 3): string {
  return list.map((n) => fmt(n, decimals)).join(' ');
}

// SVG 2's number: digits, or digits '.' digits (no '5.'), with an optional exponent.
const NUM = /[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/y;
const SEP = /[ \t\n\r\f]*,?[ \t\n\r\f]*/y;
const WS = /[ \t\n\r\f]*/y;

/**
 * Parse a list of numbers separated by whitespace and/or one comma, as viewBox and transform
 * arguments are written. Like browsers, a separator may be omitted where the next number's sign
 * or point ends the previous one ('0-1', '0.5.5'). Null for anything else, including a leading or
 * trailing comma, and for numbers too large to be finite.
 */
export function parseNumberList(s: string): number[] | null {
  const out: number[] = [];
  let i = skip(WS, s, 0);
  while (i < s.length) {
    if (out.length) i = skip(SEP, s, i);
    NUM.lastIndex = i;
    const m = NUM.exec(s);
    if (!m) return null;
    const v = Number(m[0]);
    if (!Number.isFinite(v)) return null;
    out.push(v);
    i = skip(WS, s, NUM.lastIndex);
  }
  return out;
}

function skip(re: RegExp, s: string, at: number): number {
  re.lastIndex = at;
  re.exec(s);
  return re.lastIndex;
}
