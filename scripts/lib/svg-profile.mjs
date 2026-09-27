// The Library SVG Profile: what a served .svg on this site may contain.
//
// An .svg opened as a document runs its scripts on the page's origin, and every project here
// shares mmaggitti.github.io, so one script-bearing file would be a stored XSS for anyone opening
// its link. GitHub Pages can't send a CSP or Content-Disposition, so the files themselves must be
// inert. Draw's inert serializer produces files in this profile; this checker proves it, in the
// app before a save and in CI over every served .svg.
//
// It has its OWN tokenizer, deliberately independent of engine/xml: one parser bug must not be able
// to both produce a file and pass it. It is strict on purpose, and a file it can't read is a finding.
// Findings name a rule and a line, never the matched text.
//
// Plain, dependency-free ESM, shared by scripts/check-library.mjs and projects/draw.

import { ELEMENTS, METADATA_NS, XHTML_ELEMENTS, SMIL_ELEMENTS } from './svg-profile-tables.mjs';

export const PROFILE_VERSION = 1;

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

const NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/;
const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/y;

/** Decode the five named entities and numeric references (the only ones the profile allows). */
function decode(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g, (_, e) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0x10ffff ? '�' : String.fromCodePoint(n);
  });
}

// Browsers ignore control characters and whitespace inside a URL scheme ("java\tscript:").
const squash = (v) => v.replace(/[\u0000- \u007f-\u009f]/g, '');

/** A link or resource URL allowed in a served file. */
export function urlAllowed(value, el) {
  const u = squash(value);
  if (u === '') return true;
  if (u.startsWith('#')) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(u);
  if (!scheme) return !u.startsWith('//') && !u.startsWith('\\'); // relative path, same site
  const s = scheme[1].toLowerCase();
  if ((s === 'http' || s === 'https' || s === 'mailto') && el === 'a') return true;
  if (/^data:image\/(png|jpeg|gif|webp)[;,]/i.test(u) && (el === 'image' || el === 'feImage' || el === 'img')) return true;
  return false;
}

/** CSS that can't run script, import, or reach another site. */
export function cssAllowed(css) {
  // Undo CSS escapes first: "\40 import" and "u\72l(" are how filters get dodged.
  const t = css
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/\\(.)/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .toLowerCase();
  if (/@import|expression\s*\(|behavior\s*:|-moz-binding|javascript:|image-set\s*\(/.test(t)) return false;
  for (const m of t.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/g)) {
    const u = squash(m[2]);
    if (u.startsWith('#')) continue;
    if (/^data:(image\/(png|jpeg|gif|webp)|font\/)/.test(u)) continue;
    if (!/^[a-z][a-z0-9+.-]*:/.test(u) && !u.startsWith('//')) continue; // relative
    return false;
  }
  return true;
}

/**
 * Check one file's text against the profile.
 * @returns {{rule: string, line: number}[]} findings (empty = conforms)
 */
export function checkSvg(text) {
  const findings = [];
  const add = (rule, at) => findings.push({ rule, line: lineAt(text, at) });
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const decl = /^<\?xml\s[^?]*\?>/.exec(text.slice(i));
  if (decl) {
    if (!/^<\?xml\s+version\s*=\s*["']1\.[01]["'](\s+encoding\s*=\s*["']utf-8["'])?(\s+standalone\s*=\s*["'](yes|no)["'])?\s*\?>$/i.test(decl[0])) add('xml-declaration', i);
    i += decl[0].length;
  }
  // stack of { name, local, ns, map (prefix → uri) }
  const stack = [];
  let sawRoot = false;
  const nsOf = (prefix, map) => (prefix === 'xml' ? XML_NS : prefix === 'xmlns' ? XMLNS_NS : map.get(prefix ?? ''));

  while (i < text.length) {
    const lt = text.indexOf('<', i);
    const chunkEnd = lt === -1 ? text.length : lt;
    if (chunkEnd > i) {
      checkText(text.slice(i, chunkEnd), i, stack, add);
      if (!stack.length && /\S/.test(text.slice(i, chunkEnd))) add('text-outside-root', i);
    }
    if (lt === -1) break;
    i = lt;
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end === -1) { add('unterminated-comment', i); break; }
      if (text.slice(i + 4, end).includes('--')) add('comment-double-dash', i);
      // An HTML parser ends '<!-->' at once and reads the rest as markup (SVG Lab's comment breakout).
      // A served file can be inlined into HTML, so its comments must mean the same to both parsers.
      else if (/^-?>|[<>]/.test(text.slice(i + 4, end))) add('comment-html-ambiguous', i);
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      if (end === -1) { add('unterminated-cdata', i); break; }
      const top = stack[stack.length - 1];
      if (!top || top.local !== 'style' || top.ns !== SVG_NS) add('cdata-outside-style', i);
      else if (!cssAllowed(text.slice(i + 9, end))) add('css', i);
      i = end + 3;
      continue;
    }
    if (text.startsWith('<!', i)) { add('doctype-or-declaration', i); break; } // DOCTYPE, ENTITY, …
    if (text.startsWith('<?', i)) { add('processing-instruction', i); const e = text.indexOf('?>', i); if (e === -1) break; i = e + 2; continue; }
    if (text.startsWith('</', i)) {
      const m = /^<\/([^\s>]+)\s*>/.exec(text.slice(i));
      if (!m) { add('malformed-end-tag', i); break; }
      const top = stack.pop();
      if (!top || top.name !== m[1]) { add('mismatched-end-tag', i); break; }
      i += m[0].length;
      continue;
    }
    // start tag
    const tag = readStartTag(text, i);
    if (!tag) { add('malformed-start-tag', i); break; }
    if (!stack.length && sawRoot) add('second-root', i);
    const parentMap = stack.length ? stack[stack.length - 1].map : new Map([['', null]]);
    const map = new Map(parentMap);
    for (const a of tag.attrs) {
      if (a.name === 'xmlns') map.set('', decode(a.value));
      else if (a.name.startsWith('xmlns:')) map.set(a.name.slice(6), decode(a.value));
    }
    const [prefix, local] = split(tag.name);
    const ns = nsOf(prefix, map);
    const parent = stack[stack.length - 1];
    checkElement({ name: tag.name, local, ns }, parent, stack, add, i);
    const seen = new Set();
    for (const a of tag.attrs) {
      const [ap, al] = split(a.name);
      const ans = a.name === 'xmlns' || ap === 'xmlns' ? XMLNS_NS : ap ? nsOf(ap, map) : null;
      const key = `${ans ?? ''}|${al}`;
      if (seen.has(key)) add('duplicate-attribute', i);
      seen.add(key);
      if (ap && ans == null) add('unbound-prefix', i);
      checkAttribute({ local, ns }, { local: al, ns: ans, prefix: ap }, a.value, add, i);
    }
    if (!stack.length) {
      sawRoot = true;
      if (local !== 'svg' || ns !== SVG_NS) add('root-not-svg', i);
    }
    if (prefix && ns == null) add('unbound-prefix', i);
    if (!tag.selfClosing) stack.push({ name: tag.name, local, ns, map });
    i = tag.end;
  }
  if (stack.length) add('unclosed-element', text.length);
  if (!sawRoot) add('no-root', 0);
  return findings;
}

function split(name) {
  const c = name.indexOf(':');
  return c === -1 ? [null, name] : [name.slice(0, c), name.slice(c + 1)];
}

function lineAt(text, at) {
  let n = 1;
  for (let k = 0; k < at && k < text.length; k++) if (text.charCodeAt(k) === 10) n++;
  return n;
}

function readStartTag(text, i) {
  const m = /^<([^\s/>]+)/.exec(text.slice(i, i + 256));
  if (!m || !NAME.test(m[1])) return null;
  let k = i + m[0].length;
  const attrs = [];
  for (;;) {
    const ws = /^\s*/.exec(text.slice(k))[0].length;
    k += ws;
    if (text.startsWith('/>', k)) return { name: m[1], attrs, selfClosing: true, end: k + 2 };
    if (text[k] === '>') return { name: m[1], attrs, selfClosing: false, end: k + 1 };
    if (!ws) return null; // attributes must be separated by whitespace
    const am = /^([^\s=/>]+)\s*=\s*(["'])/.exec(text.slice(k, k + 512));
    if (!am || !NAME.test(am[1]) && !/^xmlns(:[A-Za-z_][\w.-]*)?$/.test(am[1])) return null;
    const q = am[2];
    const vStart = k + am[0].length;
    const vEnd = text.indexOf(q, vStart);
    if (vEnd === -1) return null;
    const raw = text.slice(vStart, vEnd);
    if (raw.includes('<')) return null;
    attrs.push({ name: am[1], value: raw });
    k = vEnd + 1;
  }
}

function checkEntities(s, at, add) {
  for (let k = s.indexOf('&'); k !== -1; k = s.indexOf('&', k + 1)) {
    ENTITY.lastIndex = k;
    if (!ENTITY.test(s)) { add('entity', at); return; }
  }
}

function checkText(s, at, stack, add) {
  checkEntities(s, at, add);
  if (s.includes(']]>')) add('cdata-end-in-text', at);
  const top = stack[stack.length - 1];
  if (top && top.local === 'style' && top.ns === SVG_NS && !cssAllowed(decode(s))) add('css', at);
}

function inside(stack, local, ns) {
  return stack.some((e) => e.local === local && e.ns === ns);
}

function checkElement(el, parent, stack, add, at) {
  if (el.ns === SVG_NS) {
    if (!ELEMENTS.has(el.local)) add(`element:${el.local === 'script' ? 'script' : 'not-allowed'}`, at);
    return;
  }
  if (el.ns === XHTML_NS) {
    // HTML only inside foreignObject, and only elements that can't run or load anything active.
    if (!inside(stack, 'foreignObject', SVG_NS)) add('xhtml-outside-foreignobject', at);
    else if (!XHTML_ELEMENTS.has(el.local.toLowerCase())) add(`xhtml:${el.local.toLowerCase() === 'script' ? 'script' : 'not-allowed'}`, at);
    return;
  }
  if (METADATA_NS.has(el.ns)) {
    if (!inside(stack, 'metadata', SVG_NS)) add('metadata-outside-metadata', at);
    return;
  }
  add('foreign-element', at); // MathML, editor namespaces (inkscape, sodipodi), anything else
}

function checkAttribute(el, attr, rawValue, add, at) {
  if (attr.ns === XMLNS_NS) return;
  const value = decode(rawValue);
  checkEntities(rawValue, at, add);
  const local = attr.local.toLowerCase();
  if (local.startsWith('on')) { add('event-handler', at); return; }
  if (attr.ns === XML_NS && local === 'base') { add('xml-base', at); return; }
  if (attr.ns != null && attr.ns !== XLINK_NS && attr.ns !== XML_NS && !METADATA_NS.has(attr.ns)) {
    add('foreign-attribute', at); // inkscape:*, sodipodi:*, i:*, x:* are editor data, not served
    return;
  }
  if (local === 'href' || local === 'src') {
    if (el.local === 'use' && el.ns === SVG_NS && !squash(value).startsWith('#')) add('use-href-not-fragment', at);
    else if (!urlAllowed(value, el.local)) add('url', at);
    return;
  }
  if (local === 'style' && !cssAllowed(value)) { add('css', at); return; }
  if (el.ns === SVG_NS && SMIL_ELEMENTS.has(el.local) && local === 'attributename') {
    const target = value.trim().toLowerCase().replace(/^[a-z_][\w.-]*:/, '');
    if (target === 'href' || target === 'style' || target.startsWith('on')) add('smil-retarget', at);
    return;
  }
  // SMIL values/from/to/by on a URL-bearing target are covered by smil-retarget above; any other
  // attribute value holding a script URL is still refused.
  if (/^javascript:|^vbscript:|^data:text\/html/i.test(squash(value))) add('url', at);
}
