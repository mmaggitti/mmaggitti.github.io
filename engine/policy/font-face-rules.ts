// The canvas never declares a document's own faces. WebKit connects a shadow tree's own @font-face
// rules to the page-wide document.fonts (Chromium ignores them), where a file's face would get past
// Draw's name guard and its caps: a face named like one of the app's fonts could restyle the app's
// own text. So the sink draws a <style>'s text with its @font-face rules taken out, and Draw's own
// registration (src/platform/fonts.ts registers a document's data: faces, under that guard and those
// caps) is the one way a document's face reaches the page, in both engines. The file and the code
// view keep the rules as written. Pure functions, no DOM.
//
// The text is read the way CSS tokenizes it (comments, strings, url() tokens and escapes), so an
// "@font-face" inside a comment or a string stays, and every @font-face rule, at any depth (inside
// @media, @supports or @layer too) and in any case, goes from its at-keyword to the end of its block,
// or to the end of the text when the block isn't closed; nothing else changes. Where that can't be
// settled the answer is null, and the sink refuses the <style> whole, as it refuses CSS its guards
// refuse (a refusal stays safe):
// - a backslash in any at-keyword (an escape could spell font-face);
// - an @font-face where no rule starts (only after the start, a `{`, a `}` or a `;`, outside any
//   parentheses or brackets), or one not followed by its block;
// - a face rule in a <style> whose text is split over more than one leaf that isn't whitespace (the
//   browser joins them, so a rule could straddle two).

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isNewline = (c: string | undefined): boolean => c === '\n' || c === '\r' || c === '\f';
const isHex = (c: string | undefined): boolean => c !== undefined && /[0-9a-fA-F]/.test(c);
// A name code point: a letter, a digit, _ or -, any code unit from U+0080, or NUL (which CSS reads
// as U+FFFD).
const isName = (c: string | undefined): boolean => c !== undefined && (/[A-Za-z0-9_\0-]/.test(c) || c.charCodeAt(0) >= 0x80);
// A backslash starts an escape unless a newline (or the end) follows it.
const escapeAt = (t: string, i: number): boolean => t[i] === '\\' && i + 1 < t.length && !isNewline(t[i + 1]);

// The end of the escape whose backslash is at i: a hex escape takes up to six digits and one
// whitespace after them (a CRLF as one); any other, the one character after the backslash.
function escapeEnd(t: string, i: number): number {
  let j = i + 1;
  if (!isHex(t[j])) return j + 1;
  const stop = j + 6;
  while (j < stop && isHex(t[j])) j++;
  if (t[j] === '\r' && t[j + 1] === '\n') return j + 2;
  return isSpace(t[j]) ? j + 1 : j;
}

type Token =
  | { kind: 'space' | 'comment' | 'string' | 'url' | 'semi' | 'hash' | 'word' | 'function' | 'delim'; end: number }
  | { kind: 'open' | 'close'; end: number; char: string }
  | { kind: 'at'; end: number; name: string; escaped: boolean };

// A run of name code points and escapes from i: where it ends, its first characters decoded (enough
// to tell url and font-face), and whether it holds an escape.
function nameAt(t: string, i: number): { end: number; text: string; escaped: boolean } {
  let j = i;
  let text = '';
  let escaped = false;
  while (j < t.length) {
    if (isName(t[j])) {
      if (text.length < 16) text += t[j];
      j++;
    } else if (escapeAt(t, j)) {
      escaped = true;
      const end = escapeEnd(t, j);
      const hex = isHex(t[j + 1]) ? parseInt(t.slice(j + 1, end), 16) : -1;
      const ch = hex < 0 ? t[j + 1] : hex === 0 || (hex >= 0xd800 && hex <= 0xdfff) || hex > 0x10ffff ? '\uFFFD' : String.fromCodePoint(hex);
      if (text.length < 16) text += ch;
      j = end;
    } else break;
  }
  return { end: j, text, escaped };
}

// A quoted string from its quote: it ends at the same quote, before an unescaped newline (a bad
// string), or at the end; a backslash takes a newline (a CRLF as one) or an escape.
function stringEnd(t: string, i: number): number {
  const quote = t[i];
  let j = i + 1;
  while (j < t.length) {
    const c = t[j];
    if (c === quote) return j + 1;
    if (isNewline(c)) return j;
    if (c !== '\\') j++;
    else if (t[j + 1] === '\r' && t[j + 2] === '\n') j += 3;
    else if (isNewline(t[j + 1])) j += 2;
    else j = escapeEnd(t, j);
  }
  return t.length;
}

// An unquoted url( token from its first character: it ends after the first ) no escape takes (a bad
// url's remnants end the same way), or at the end.
function urlEnd(t: string, i: number): number {
  let j = i;
  while (j < t.length) {
    if (t[j] === ')') return j + 1;
    j = escapeAt(t, j) ? escapeEnd(t, j) : j + 1;
  }
  return t.length;
}

function tokenAt(t: string, i: number): Token {
  const c = t[i];
  if (c === '/' && t[i + 1] === '*') {
    const close = t.indexOf('*/', i + 2);
    return { kind: 'comment', end: close < 0 ? t.length : close + 2 };
  }
  if (isSpace(c)) {
    let j = i + 1;
    while (isSpace(t[j])) j++;
    return { kind: 'space', end: j };
  }
  if (c === '"' || c === "'") return { kind: 'string', end: stringEnd(t, i) };
  if (c === '{' || c === '(' || c === '[') return { kind: 'open', end: i + 1, char: c };
  if (c === '}' || c === ')' || c === ']') return { kind: 'close', end: i + 1, char: c };
  if (c === ';') return { kind: 'semi', end: i + 1 };
  if (c === '@') {
    const n = nameAt(t, i + 1);
    return { kind: 'at', end: n.end, name: n.text.toLowerCase(), escaped: n.escaped };
  }
  if (c === '#') return { kind: 'hash', end: nameAt(t, i + 1).end };
  if (isName(c) || escapeAt(t, i)) {
    const n = nameAt(t, i);
    if (t[n.end] !== '(') return { kind: 'word', end: n.end };
    if (n.text.toLowerCase() === 'url') {
      let j = n.end + 1;
      while (isSpace(t[j])) j++;
      if (t[j] !== '"' && t[j] !== "'") return { kind: 'url', end: urlEnd(t, j) };
    }
    return { kind: 'function', end: n.end + 1 };
  }
  return { kind: 'delim', end: i + 1 };
}

const closer = (open: string): string => (open === '{' ? '}' : open === '(' ? ')' : ']');

// The end of the block that opens at i (a {): after its matching }, or the end of the text.
function blockEnd(t: string, i: number): number {
  const open = ['}'];
  let j = i + 1;
  while (j < t.length) {
    const tok = tokenAt(t, j);
    j = tok.end;
    if (tok.kind === 'open') open.push(closer(tok.char));
    else if (tok.kind === 'function') open.push(')');
    else if (tok.kind === 'close' && open[open.length - 1] === tok.char) {
      open.pop();
      if (!open.length) return j;
    }
  }
  return t.length;
}

/** CSS text with every @font-face rule taken out (the module header), or null when that can't be settled. */
export function withoutFontFaces(css: string): string | null {
  if (!css.includes('@')) return css;
  let out = '';
  let kept = 0; // where the text not yet copied starts
  let ruleStart = true; // a rule may start here
  const open: string[] = []; // the closers of the blocks open here
  let parens = 0; // how many of them are ) or ]
  let i = 0;
  while (i < css.length) {
    const tok = tokenAt(css, i);
    if (tok.kind === 'at' && tok.escaped) return null;
    if (tok.kind === 'at' && tok.name === 'font-face') {
      if (!ruleStart) return null;
      let j = tok.end;
      while (j < css.length) {
        const s = tokenAt(css, j);
        if (s.kind !== 'space' && s.kind !== 'comment') break;
        j = s.end;
      }
      if (j < css.length && css[j] !== '{') return null;
      const end = j < css.length ? blockEnd(css, j) : css.length;
      out += css.slice(kept, i);
      kept = i = end;
      continue; // a rule may start after it, as after its }
    }
    if (tok.kind === 'open' || tok.kind === 'function') {
      const c = tok.kind === 'open' ? closer(tok.char) : ')';
      open.push(c);
      if (c !== '}') parens++;
      ruleStart = c === '}' && parens === 0;
    } else if (tok.kind === 'close') {
      const top = open[open.length - 1];
      if (top === tok.char) {
        open.pop();
        if (top !== '}') parens--;
      }
      ruleStart = tok.char === '}' && parens === 0 && (top === '}' || top === undefined);
    } else if (tok.kind === 'semi') ruleStart = parens === 0;
    else if (tok.kind !== 'space' && tok.kind !== 'comment') ruleStart = false;
    i = tok.end;
  }
  return out + css.slice(kept);
}

const CSS_SPACE = /^[ \t\n\r\f]*$/;

/**
 * A <style>'s text and CDATA leaves as the canvas draws them: with the @font-face rules taken out of
 * the one leaf that isn't whitespace, or each as it is when none holds a face rule; null when the
 * <style> is refused whole (the module header).
 */
export function canvasStyleTexts(leaves: readonly string[]): string[] | null {
  const solid = leaves.flatMap((t, i) => (CSS_SPACE.test(t) ? [] : [i]));
  if (solid.length <= 1) {
    if (!solid.length) return [...leaves];
    const drawn = withoutFontFaces(leaves[solid[0]]);
    return drawn === null ? null : leaves.map((t, i) => (i === solid[0] ? drawn : t));
  }
  const joined = leaves.join('');
  return withoutFontFaces(joined) === joined ? [...leaves] : null;
}

/** The tokenizer above, for other readers of a <style>'s text (model/ids.ts renames ids in one). */
export { tokenAt as cssTokenAt, type Token as CssToken };
