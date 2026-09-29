// Lossless XML lexer. Every character of the source belongs to exactly one token, so concatenating
// the tokens' source slices gives back the input byte for byte. That is what lets Draw keep what it
// doesn't understand exactly as it was: an edit regenerates only the tokens it touched.
//
// It never executes, fetches or expands anything; entity decoding happens later, on demand, with
// caps (entities.ts). It is linear in the input (sticky scans, no repeated slicing) and total: bad
// input produces an error with a position, never a hang or an exception.
//
// What a browser's XML parser refuses at this level, it refuses too, each at its place: a character
// XML doesn't allow, a name with a colon out of place, an attribute written twice, '--' inside a
// comment, ']]>' in text, and a DOCTYPE not written in capitals. (References, namespaces and what
// may stand outside the root are checked in cst.ts, entities.ts and model/doc.ts.)

export type Quote = '"' | "'";

/** One attribute exactly as written: `lead` + name + `eq` + quote + raw + quote. */
export interface AttrTok {
  at: number; // where its name starts in the source
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
   * an entity that expands to markup, an entity a parameter entity may declare); the file itself
   * may be well-formed. Absent: not well-formed.
   */
  kind?: 'limit';
}

export type LexResult = { ok: true; tokens: Tok[] } | { ok: false; error: LexError };

// XML Name, simplified to what SVG files use, but permissive about non-ASCII letters.
const NAME = /[A-Za-z_:À-￿][\w.:\-·À-￿]*/y;
const WS = /[ \t\r\n]+/y;
// A character outside XML 1.0's Char, written as itself (engine/code/edit.ts refuses one in an edit).
const NOT_XML_CHAR = /[^\t\n\r\x20-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/u;

function matchAt(re: RegExp, s: string, at: number): string | null {
  re.lastIndex = at;
  const m = re.exec(s);
  return m ? m[0] : null;
}

/** Namespaces in XML: at most one colon, with a name on each side ('a:b', never ':a', 'a:', 'a:b:c' or 'a:1'). */
function badQName(name: string): boolean {
  const c = name.indexOf(':');
  if (c === -1) return false;
  return c === 0 || name.indexOf(':', c + 1) !== -1 || !/[A-Za-z_À-￿]/.test(name.charAt(c + 1));
}
const qnameMessage = (name: string): string => `${name} is not a valid name: a colon must stand once, between two names`;

export function lex(src: string): LexResult {
  const r = scan(src);
  // One pass for the characters XML doesn't allow; the first problem in the file is the one reported.
  const bad = NOT_XML_CHAR.exec(src);
  if (bad && (r.ok || r.error.at >= bad.index)) {
    const cp = bad[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
    return { ok: false, error: { at: bad.index, message: `the character U+${cp} is not allowed in XML` } };
  }
  return r;
}

function scan(src: string): LexResult {
  const tokens: Tok[] = [];
  const n = src.length;
  let i = 0;
  let cdataEnd = src.indexOf(']]>'); // the next ']]>' at or after i, or -1
  const fail = (at: number, message: string): LexResult => ({ ok: false, error: { at, message } });

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt !== i) {
      const end = lt === -1 ? n : lt;
      while (cdataEnd !== -1 && cdataEnd < i) cdataEnd = src.indexOf(']]>', i);
      if (cdataEnd !== -1 && cdataEnd < end) return fail(cdataEnd, "']]>' in text: only a CDATA section ends with it");
      tokens.push({ kind: 'text', start: i, end });
      i = end;
      continue;
    }
    // at '<'
    if (src.startsWith('<!--', i)) {
      const close = src.indexOf('-->', i + 4);
      if (close === -1) return fail(i, 'unterminated comment');
      // The first '--' after '<!--' must be the one that ends it (so no '--' inside, and no '--->').
      const dashes = src.indexOf('--', i + 4);
      if (dashes !== close) return fail(dashes, "'--' inside a comment");
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
    if (src.startsWith('<!DOCTYPE', i)) {
      const r = scanDoctype(src, i);
      if (!r) return fail(i, 'unterminated DOCTYPE');
      tokens.push({ kind: 'doctype', start: i, end: r.end, subset: r.subset });
      i = r.end;
      continue;
    }
    if (src.slice(i, i + 9).toUpperCase() === '<!DOCTYPE') return fail(i, 'a DOCTYPE must be written in capitals, <!DOCTYPE');
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
  if (badQName(name)) return { at: i + 1, message: qnameMessage(name) };
  let k = i + 1 + name.length;
  const attrs: AttrTok[] = [];
  const seen = new Set<string>();
  for (;;) {
    const lead = matchAt(WS, src, k) ?? '';
    k += lead.length;
    if (src.startsWith('/>', k)) return { kind: 'start', start: i, end: k + 2, name, attrs, tail: lead, selfClosing: true };
    if (src[k] === '>') return { kind: 'start', start: i, end: k + 1, name, attrs, tail: lead, selfClosing: false };
    if (k >= src.length) return { at: i, message: `unterminated start tag <${name}>` };
    if (!lead) return { at: k, message: `attributes of <${name}> must be separated by whitespace` };
    const an = matchAt(NAME, src, k);
    if (!an) return { at: k, message: `bad attribute name in <${name}>` };
    if (badQName(an)) return { at: k, message: qnameMessage(an) };
    if (seen.has(an)) return { at: k, message: `attribute ${an} is written twice in <${name}>` };
    seen.add(an);
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
    attrs.push({ at: k, lead, name: an, eq: w1 + '=' + w2, quote: q, raw });
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

// The subset ends at the first ']' outside a literal, a comment or a processing instruction (any of
// which may hold a ']' or a quote of its own).
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
    } else if (src.startsWith('<?', k)) {
      const e = src.indexOf('?>', k + 2);
      if (e === -1) return -1;
      k = e + 1;
    } else if (c === ']') return k;
  }
  return -1;
}
