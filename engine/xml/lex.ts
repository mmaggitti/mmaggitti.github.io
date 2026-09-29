// Lossless XML lexer. Every character of the source belongs to exactly one token, so concatenating
// the tokens' source slices gives back the input byte for byte. That is what lets Draw keep what it
// doesn't understand exactly as it was: an edit regenerates only the tokens it touched.
//
// It never executes, fetches or expands anything; entity decoding happens later, on demand, with
// caps (entities.ts). It is linear in the input (sticky scans, no repeated slicing) and total: bad
// input produces an error with a position, never a hang or an exception.

export type Quote = '"' | "'";

/** One attribute exactly as written: `lead` + name + `eq` + quote + raw + quote. */
export interface AttrTok {
  lead: string; // whitespace before the name (at least one character)
  name: string;
  eq: string; // text from the end of the name through '=' up to the opening quote, e.g. '=' or ' = '
  quote: Quote;
  raw: string; // the value between the quotes, entities undecoded
}

export type Tok =
  | { kind: 'text'; start: number; end: number }
  | { kind: 'comment'; start: number; end: number }
  | { kind: 'cdata'; start: number; end: number }
  | { kind: 'pi'; start: number; end: number; target: string }
  | { kind: 'doctype'; start: number; end: number; subset: string | null }
  | { kind: 'start'; start: number; end: number; name: string; attrs: AttrTok[]; tail: string; selfClosing: boolean }
  | { kind: 'end'; start: number; end: number; name: string; tail: string };

export interface LexError {
  at: number;
  message: string;
  /**
   * 'limit': over what Draw's parser takes (size, node count, depth, the entity budget and depth,
   * an entity that expands to markup); the file itself may be well-formed. Absent: not well-formed.
   */
  kind?: 'limit';
}

export type LexResult = { ok: true; tokens: Tok[] } | { ok: false; error: LexError };

// XML Name, simplified to what SVG files use, but permissive about non-ASCII letters.
const NAME = /[A-Za-z_:À-￿][\w.:\-·À-￿]*/y;
const WS = /[ \t\r\n]+/y;

function matchAt(re: RegExp, s: string, at: number): string | null {
  re.lastIndex = at;
  const m = re.exec(s);
  return m ? m[0] : null;
}

export function lex(src: string): LexResult {
  const tokens: Tok[] = [];
  const n = src.length;
  let i = 0;
  const fail = (at: number, message: string): LexResult => ({ ok: false, error: { at, message } });

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt !== i) {
      const end = lt === -1 ? n : lt;
      tokens.push({ kind: 'text', start: i, end });
      i = end;
      continue;
    }
    // at '<'
    if (src.startsWith('<!--', i)) {
      const close = src.indexOf('-->', i + 4);
      if (close === -1) return fail(i, 'unterminated comment');
      tokens.push({ kind: 'comment', start: i, end: close + 3 });
      i = close + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const close = src.indexOf(']]>', i + 9);
      if (close === -1) return fail(i, 'unterminated CDATA section');
      tokens.push({ kind: 'cdata', start: i, end: close + 3 });
      i = close + 3;
      continue;
    }
    if (src.startsWith('<!DOCTYPE', i) || src.startsWith('<!doctype', i)) {
      const r = scanDoctype(src, i);
      if (!r) return fail(i, 'unterminated DOCTYPE');
      tokens.push({ kind: 'doctype', start: i, end: r.end, subset: r.subset });
      i = r.end;
      continue;
    }
    if (src.startsWith('<!', i)) return fail(i, 'unexpected markup declaration');
    if (src.startsWith('<?', i)) {
      const close = src.indexOf('?>', i + 2);
      if (close === -1) return fail(i, 'unterminated processing instruction');
      const target = matchAt(NAME, src, i + 2);
      if (!target) return fail(i, 'processing instruction without a target');
      tokens.push({ kind: 'pi', start: i, end: close + 2, target });
      i = close + 2;
      continue;
    }
    if (src.startsWith('</', i)) {
      const name = matchAt(NAME, src, i + 2);
      if (!name) return fail(i, 'end tag without a name');
      let k = i + 2 + name.length;
      const ws = matchAt(WS, src, k) ?? '';
      k += ws.length;
      if (src[k] !== '>') return fail(k, `malformed end tag </${name}>`);
      tokens.push({ kind: 'end', start: i, end: k + 1, name, tail: ws });
      i = k + 1;
      continue;
    }
    const r = scanStartTag(src, i);
    if ('message' in r) return fail(r.at, r.message);
    tokens.push(r);
    i = r.end;
  }
  return { ok: true, tokens };
}

type StartTok = Extract<Tok, { kind: 'start' }>;

function scanStartTag(src: string, i: number): StartTok | LexError {
  const name = matchAt(NAME, src, i + 1);
  if (!name) return { at: i, message: "'<' not followed by a tag name" };
  let k = i + 1 + name.length;
  const attrs: AttrTok[] = [];
  for (;;) {
    const lead = matchAt(WS, src, k) ?? '';
    k += lead.length;
    if (src.startsWith('/>', k)) return { kind: 'start', start: i, end: k + 2, name, attrs, tail: lead, selfClosing: true };
    if (src[k] === '>') return { kind: 'start', start: i, end: k + 1, name, attrs, tail: lead, selfClosing: false };
    if (k >= src.length) return { at: i, message: `unterminated start tag <${name}>` };
    if (!lead) return { at: k, message: `attributes of <${name}> must be separated by whitespace` };
    const an = matchAt(NAME, src, k);
    if (!an) return { at: k, message: `bad attribute name in <${name}>` };
    let e = k + an.length;
    const w1 = matchAt(WS, src, e) ?? '';
    e += w1.length;
    if (src[e] !== '=') return { at: e, message: `attribute ${an} in <${name}> has no value` };
    e += 1;
    const w2 = matchAt(WS, src, e) ?? '';
    e += w2.length;
    const q = src[e];
    if (q !== '"' && q !== "'") return { at: e, message: `attribute ${an} in <${name}> is not quoted` };
    const close = src.indexOf(q, e + 1);
    if (close === -1) return { at: e, message: `unterminated value of ${an} in <${name}>` };
    const raw = src.slice(e + 1, close);
    if (raw.includes('<')) return { at: e, message: `'<' in the value of ${an} in <${name}>` };
    attrs.push({ lead, name: an, eq: w1 + '=' + w2, quote: q, raw });
    k = close + 1;
  }
}

// <!DOCTYPE name [internal subset]> — the subset may itself contain '>' inside quotes and
// declarations, so it is scanned bracket-aware.
function scanDoctype(src: string, i: number): { end: number; subset: string | null } | null {
  let k = i + 9;
  let quote: string | null = null;
  let subsetStart = -1;
  for (; k < src.length; k++) {
    const c = src[k];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' && subsetStart === -1) {
      subsetStart = k + 1;
      const end = scanSubset(src, subsetStart);
      if (end === -1) return null;
      k = end; // at ']'
      const close = src.indexOf('>', k);
      if (close === -1) return null;
      return { end: close + 1, subset: src.slice(subsetStart, end) };
    } else if (c === '>') return { end: k + 1, subset: null };
  }
  return null;
}

function scanSubset(src: string, i: number): number {
  let quote: string | null = null;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (src.startsWith('<!--', k)) {
      const e = src.indexOf('-->', k + 4);
      if (e === -1) return -1;
      k = e + 2;
    } else if (c === ']') return k;
  }
  return -1;
}
