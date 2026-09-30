// One canonical form of an XML document's tree, built the same way from Draw's engine (engineCanon,
// in node) and from the browser's own parser (browserCanon, passed to page.evaluate), so the e2e
// can require them to agree: corpusTreesMatchTheBrowsersParser over every corpus file, and
// theEngineRefusesWhatTheBrowserRefuses over PROBES, the refusals and acceptances of the engine's
// strict well-formedness.
//
// The form, identical on both sides:
//   { doctype: { name, publicId, systemId } | null, prolog: [item], root: element, epilog: [item] }
//   element: { ns, local, prefix, attrs, kids }
//     attrs: [ns, local, prefix, value] sorted by (ns, local), namespace declarations included (in
//       http://www.w3.org/2000/xmlns/)
//     kids: elements, { t } (adjacent text and CDATA merged, line ends normalized), { c } and { pi }
//   item: { c: comment data } or { pi: [target, data] }
// The DOCTYPE's internal subset is never compared. A refused document is { refused: true, ... }.
// The engine's form also carries `known`: what canonDiffs needs to apply KNOWN (never compared).
//
// KNOWN lists where the two differ on purpose, each with its reason; canonDiffs applies it.

import { parseDoc } from '../../../../engine/model/doc.ts';
import { decodeAttr, decodeText, normalizeEol } from '../../../../engine/xml/entities.ts';

const XML_WS = /^[ \t\r\n]+/;
const byNsLocal = (a, b) => {
  const ka = `${a[0] ?? ''} ${a[1]}`;
  const kb = `${b[0] ?? ''} ${b[1]}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};
const DOCTYPE = /^<!DOCTYPE[ \t\r\n]+([^ \t\r\n[>]+)(?:[ \t\r\n]+(?:PUBLIC[ \t\r\n]+(?:"([^"]*)"|'([^']*)')[ \t\r\n]+(?:"([^"]*)"|'([^']*)')|SYSTEM[ \t\r\n]+(?:"([^"]*)"|'([^']*)')))?/;
// DTD attribute defaults a browser adds: <!ATTLIST element attribute type #FIXED "value"> or a plain default.
const ATTLIST = /<!ATTLIST[ \t\r\n]+([^ \t\r\n>]+)([^>]*)>/g;
const ATTDEF = /([^ \t\r\n]+)[ \t\r\n]+(?:\([^)]*\)|[A-Z]+)[ \t\r\n]+(?:#FIXED[ \t\r\n]+)?("[^"]*"|'[^']*')/g;

/** The engine's canonical tree of `text`, or its refusal (kind 'limit' when over Draw's limits). */
export function engineCanon(text) {
  const r = parseDoc(text);
  if (!r.ok) return { refused: true, kind: r.error.kind ?? null, at: r.error.at, message: r.error.message };
  const doc = r.doc;
  const node = (id) => doc.nodes.get(id);
  const pi = (raw) => {
    const target = /^<\?([^ \t\r\n?]+)/.exec(raw)[1];
    return [target, normalizeEol(raw.slice(2 + target.length, -2).replace(XML_WS, ''))];
  };
  const item = (n) => (n.kind === 'comment' ? { c: normalizeEol(n.raw.slice(4, -3)) } : { pi: pi(n.raw) });
  const element = (n) => {
    const attrs = n.attrs.map((a) => [a.ns, a.local, a.prefix, decodeAttr(a.raw, doc.entities)]).sort(byNsLocal);
    const kids = [];
    let text = '';
    for (const id of n.children) {
      const k = node(id);
      if (k.kind === 'text') text += decodeText(k.raw, doc.entities);
      else if (k.kind === 'cdata') text += normalizeEol(k.raw.slice(9, -3));
      else {
        if (text) kids.push({ t: text });
        text = '';
        if (k.kind === 'element') kids.push(element(k));
        else if (k.kind === 'comment' || k.kind === 'pi') kids.push(item(k));
      }
    }
    if (text) kids.push({ t: text });
    return { ns: n.ns, local: n.local, prefix: n.prefix, attrs, kids };
  };
  // The XML declaration is not a node in the DOM; whitespace outside the root isn't either.
  const items = (ids) => ids.map(node).filter((n) => n.kind === 'comment' || (n.kind === 'pi' && !/^<\?xml[ \t\r\n?]/.test(n.raw))).map(item);
  const at = doc.prolog.findIndex((id) => node(id).kind === 'doctype');
  const dt = at === -1 ? null : node(doc.prolog[at]);
  const m = dt && DOCTYPE.exec(dt.raw);
  const subset = dt ? /\[([\s\S]*)\][ \t\r\n]*>$/.exec(dt.raw)?.[1] ?? '' : '';
  return {
    doctype: m ? { name: m[1], publicId: m[2] ?? m[3] ?? '', systemId: m[4] ?? m[5] ?? m[6] ?? m[7] ?? '' } : null,
    prolog: items(doc.prolog),
    root: element(node(doc.root)),
    epilog: items(doc.epilog),
    // For KNOWN, never compared: the entities Draw keeps as written, the attributes a DTD defaults,
    // and the comments and processing instructions inside the subset, with where the DOCTYPE stands.
    known: {
      external: [...doc.entities.external],
      defaults: [...subset.matchAll(ATTLIST)].flatMap(([, el, defs]) => [...defs.matchAll(ATTDEF)].map(([, attr]) => [el, attr])),
      subsetItems: subsetItems(subset, pi),
      beforeDoctype: at === -1 ? 0 : items(doc.prolog.slice(0, at)).length,
    },
  };
}

/** The comments and processing instructions of an internal subset, in order (outside its literals). */
function subsetItems(subset, pi) {
  const out = [];
  let quote = null;
  for (let k = 0; k < subset.length; k++) {
    const c = subset[k];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (subset.startsWith('<!--', k)) {
      const end = subset.indexOf('-->', k + 4);
      out.push({ c: normalizeEol(subset.slice(k + 4, end)) });
      k = end + 2;
    } else if (subset.startsWith('<?', k)) {
      const end = subset.indexOf('?>', k + 2);
      out.push({ pi: pi(subset.slice(k, end + 2)) });
      k = end + 1;
    }
  }
  return out;
}

/**
 * The browser's canonical trees of `texts`, each parsed by DOMParser as image/svg+xml, or
 * { refused: true } where the parser put a parsererror in (its namespace learned from '<').
 * Self-contained: it runs in the page.
 */
export function browserCanon({ texts }) {
  const refusal = new DOMParser().parseFromString('<', 'text/xml').getElementsByTagName('parsererror')[0];
  const PARSERERROR = refusal ? refusal.namespaceURI : null;
  const order = (a, b) => {
    const ka = `${a[0] ?? ''} ${a[1]}`;
    const kb = `${b[0] ?? ''} ${b[1]}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
  const item = (n) => (n.nodeType === 8 ? { c: n.data } : { pi: [n.target, n.data] });
  const element = (el) => {
    const kids = [];
    let text = '';
    for (const k of el.childNodes) {
      if (k.nodeType === 3 || k.nodeType === 4) text += k.data;
      else {
        if (text) kids.push({ t: text });
        text = '';
        if (k.nodeType === 1) kids.push(element(k));
        else if (k.nodeType === 8 || k.nodeType === 7) kids.push(item(k));
      }
    }
    if (text) kids.push({ t: text });
    return {
      ns: el.namespaceURI,
      local: el.localName,
      prefix: el.prefix,
      attrs: [...el.attributes].map((a) => [a.namespaceURI, a.localName, a.prefix, a.value]).sort(order),
      kids,
    };
  };
  return texts.map((text) => {
    // KNOWN (bom): a leading BOM is stripped first; the engine is given it.
    const doc = new DOMParser().parseFromString(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, 'image/svg+xml');
    const errors = PARSERERROR === null ? [] : doc.getElementsByTagNameNS(PARSERERROR, 'parsererror');
    if (errors.length) return { refused: true, message: errors[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 200) };
    const out = { doctype: null, prolog: [], root: null, epilog: [] };
    for (const n of doc.childNodes) {
      if (n.nodeType === 10) out.doctype = { name: n.name, publicId: n.publicId, systemId: n.systemId };
      else if (n.nodeType === 1) out.root = element(n);
      else if (n.nodeType === 8 || n.nodeType === 7) (out.root ? out.epilog : out.prolog).push(item(n));
    }
    return out;
  });
}

/** Where the engine and the browser differ on purpose, and why. canonDiffs applies each. */
export const KNOWN = [
  { id: 'bom', why: 'a leading BOM is stripped before DOMParser (a string has no byte order); the engine keeps it as the file’s first character' },
  { id: 'attribute-order', why: 'attribute order is ignored: the DOM keeps no order XML promises (attrs are sorted by namespace and local name)' },
  {
    id: 'dtd-defaults',
    why: 'the browser adds the attributes an internal <!ATTLIST> defaults (tools/edge-entity-references.svg: xmlns:xlink on <svg>); Draw never applies a DTD, so a browser-only attribute is ignored where the subset declares it',
  },
  { id: 'external-entities', why: 'Draw keeps a reference to an external entity as written (it is never fetched), where the browser drops it' },
  {
    id: 'subset-comments',
    why: 'the browser lists the comments and processing instructions inside the DOCTYPE’s internal subset as document children after the doctype (Chromium does: tools/edge-entity-references.svg); Draw keeps them inside the DOCTYPE, whose subset is never compared, so either order is accepted',
  },
  {
    id: 'cdata-line-ends',
    why: 'WebKit keeps a CR before an LF inside a CDATA section, where XML turns every CR LF into LF before parsing (tools/illustrator-cs6-entities-pgf.svg in CI run 32, with the libxml2 of Playwright’s Linux WebKit); Chromium normalizes, as the engine does, so a text run that differs from the engine’s only by those CRs is accepted',
  },
  {
    id: 'webkit-subset-pi',
    why: 'WebKit ends the DOCTYPE’s internal subset at a ] inside a processing instruction and refuses the file (CI run 32); XML allows a ] there and Chromium accepts it, so Draw follows XML and the probe names WebKit’s refusal as its known defect',
  },
];

// KNOWN (cdata-line-ends): the browser kept a CR before an LF that XML, and the engine, normalize.
const onlyLineEnds = (engine, browser) => browser.includes('\r\n') && browser.replace(/\r\n/g, '\n') === engine;

/**
 * Every difference between an engine canon and a browser canon, as "path: engine …, browser …",
 * after KNOWN. Paths read like XPath: /svg/g[2]/@fill, /svg/text[1]/text()[1]. Two trees are
 * compared only when both parse: a refusal on either side is itself a difference.
 */
export function canonDiffs(engine, browser) {
  if (engine.refused || browser.refused) {
    return [`/: ${engine.refused ? `the engine refuses it (${engine.message})` : 'the engine parses it'}, the browser ${browser.refused ? `refuses it (${browser.message})` : 'parses it'}`];
  }
  const diffs = [];
  const say = (path, a, b) => diffs.push(`${path}: engine ${JSON.stringify(a)}, browser ${JSON.stringify(b)}`);
  const { known } = engine;
  const external = new RegExp(known.external.length ? `&(?:${known.external.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')});` : '(?!)', 'g');
  const defaulted = new Set(known.defaults.map(([el, attr]) => `${el} ${attr}`));
  const qname = (x) => (x.prefix ? `${x.prefix}:${x.local}` : x.local);
  if (JSON.stringify(engine.doctype) !== JSON.stringify(browser.doctype)) say('/doctype', engine.doctype, browser.doctype);
  const withSubset = [...engine.prolog.slice(0, known.beforeDoctype), ...known.subsetItems, ...engine.prolog.slice(known.beforeDoctype)];
  if (![engine.prolog, withSubset].some((p) => JSON.stringify(p) === JSON.stringify(browser.prolog))) say('/prolog', engine.prolog, browser.prolog);
  if (JSON.stringify(engine.epilog) !== JSON.stringify(browser.epilog)) say('/epilog', engine.epilog, browser.epilog);
  const element = (a, b, path) => {
    if (a.ns !== b.ns || a.local !== b.local || a.prefix !== b.prefix) return say(path, [a.ns, a.local, a.prefix], [b.ns, b.local, b.prefix]);
    const key = (x) => `${x[0] ?? ''} ${x[1]}`;
    const mine = new Map(a.attrs.map((x) => [key(x), x]));
    const theirs = new Map(b.attrs.map((x) => [key(x), x]));
    for (const [k, x] of mine) {
      const y = theirs.get(k);
      if (!y) say(`${path}/@${x[2] ? `${x[2]}:${x[1]}` : x[1]}`, x[3], null);
      else if (x[2] !== y[2] || x[3] !== y[3]) say(`${path}/@${x[2] ? `${x[2]}:${x[1]}` : x[1]}`, [x[2], x[3]], [y[2], y[3]]);
    }
    for (const [k, y] of theirs) {
      const name = y[2] ? `${y[2]}:${y[1]}` : y[1];
      if (!mine.has(k) && !defaulted.has(`${qname(a)} ${name}`)) say(`${path}/@${name}`, null, y[3]);
    }
    const kind = (k) => ('t' in k ? 'text()' : 'c' in k ? 'comment()' : 'pi' in k ? 'processing-instruction()' : qname(k));
    const seen = new Map();
    const n = Math.max(a.kids.length, b.kids.length);
    for (let i = 0; i < n; i++) {
      const x = a.kids[i];
      const y = b.kids[i];
      const step = kind(x ?? y);
      seen.set(step, (seen.get(step) ?? 0) + 1);
      const at = `${path}/${step}[${seen.get(step)}]`;
      if (!x || !y || kind(x) !== kind(y)) {
        say(at, x ? kind(x) : null, y ? kind(y) : null);
        break; // the rest are out of step
      }
      if ('t' in x) {
        if (x.t !== y.t && x.t.replace(external, '') !== y.t && !onlyLineEnds(x.t, y.t)) say(at, x.t, y.t);
      } else if ('c' in x || 'pi' in x) {
        if (JSON.stringify(x) !== JSON.stringify(y)) say(at, x, y);
      } else element(x, y, at);
    }
  };
  element(engine.root, browser.root, `/${qname(engine.root)}`);
  return diffs;
}

/**
 * The strict well-formedness probes: one refusal for each rule the engine enforces, and what must
 * stay accepted. `draw` is the engine's verdict ('limit': refused as over Draw's limits); `browser`
 * the parser's, per engine. Chromium's were read in the cloud container; WebKit's are the same by
 * prediction (both engines parse XML with libxml2, refuse on any error it reports, and share the
 * handlers that matter here: entities, the XHTML DTDs, namespaces), and CI's WebKit run holds them
 * to it. Where it showed otherwise, the probe says so, with the engine's known defect (KNOWN).
 */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg">';
const XHTML_DOCTYPE = '<!DOCTYPE svg PUBLIC "-//W3C//DTD XHTML 1.1 plus MathML 2.0 plus SVG 1.1//EN" "http://www.w3.org/2002/04/xhtml-math-svg/xhtml-math-svg.dtd">';
const both = (verdict) => ({ chromium: verdict, webkit: verdict });
const refused = (label, body, draw = 'refuse') => ({ label, text: body.includes('<svg') ? body : `${SVG}${body}</svg>`, draw, browser: both('refuse') });
const accepted = (label, body) => ({ label, text: body.includes('<svg') ? body : `${SVG}${body}</svg>`, draw: 'accept', browser: both('accept') });
export const PROBES = [
  refused('an attribute written twice', '<rect fill="red" fill="blue"/>'),
  refused('one attribute under two prefixes of one namespace', '<g xmlns:a="urn:x" xmlns:b="urn:x"><rect a:k="1" b:k="2"/></g>'),
  refused('a bare &', '<text>Fish & chips</text>'),
  refused('a reference without ;', '<text>&amp chips</text>'),
  refused('&#0;', '<text>a&#0;b</text>'),
  refused('&#xFFFE; in a value', '<g id="&#xFFFE;"/>'),
  refused('&nbsp; with no DTD', '<text>a&nbsp;b</text>'),
  refused('an undeclared entity with a parameter-entity reference in the DOCTYPE', `<!DOCTYPE svg [<!ENTITY % decl "<!ENTITY name 'Draw'>"> %decl;]>${SVG}<text>&name;</text></svg>`, 'limit'),
  refused('an external entity in a value', `<!DOCTYPE svg [<!ENTITY ext SYSTEM "ext.xml">]>${SVG}<g id="&ext;"/></svg>`),
  refused('an entity that expands to a bare &', `<!DOCTYPE svg [<!ENTITY a "x &#38; y">]>${SVG}<text>&a;</text></svg>`),
  refused('-- in a comment', '<!-- a -- b -->'),
  refused('a comment that ends in ---', '<!-- a --->'),
  refused('a lowercase <!doctype', `<!doctype svg>${SVG}</svg>`),
  refused('a no-break space before the root', `\u{A0}${SVG}</svg>`),
  refused('an unbound element prefix', '<p:g/>'),
  refused('an unbound attribute prefix', '<g p:k="1"/>'),
  refused('xmlns:p=""', '<g xmlns:p=""/>'),
  refused('the xml prefix bound elsewhere', '<g xmlns:xml="urn:x"/>'),
  refused('the xmlns prefix declared', '<g xmlns:xmlns="urn:x"/>'),
  refused('a name with two colons', '<g xmlns:a="urn:a"><a:b:c/></g>'),
  refused('a name that starts with a colon', '<:g/>'),
  refused('U+0001 in text', '<text>a\u{1}b</text>'),
  refused(']]> in text', '<text>a ]]> b</text>'),
  // KNOWN (webkit-subset-pi): WebKit refuses this one (CI run 32); XML allows it, and Chromium accepts it.
  {
    ...accepted('a processing instruction with ] and \' in the DOCTYPE', `<!DOCTYPE svg [<?draw a ] b ' c?><!ENTITY e "x">]>${SVG}<text>&e;</text></svg>`),
    browser: { chromium: 'accept', webkit: 'refuse' },
    knownDefect: { webkit: 'webkit-subset-pi' },
  },
  accepted('declared entities, in text and values', `<!DOCTYPE svg [<!ENTITY a "x"><!ENTITY b "&a;y">]>${SVG}<text id="&b;">&b; &amp; &lt;</text></svg>`),
  accepted('&#x9;&#xA;&#xD;', '<text id="&#x9;&#xA;&#xD;">&#x9;&#xA;&#xD;</text>'),
  accepted('- in a comment', '<!-- a - b -->'),
  accepted('xml:lang, and xml bound to its own namespace', '<g xml:lang="en" xmlns:xml="http://www.w3.org/XML/1998/namespace"/>'),
  accepted('a parameter entity declared and never referenced', `<!DOCTYPE svg [<!ENTITY % p "x">]>${SVG}<text>hi</text></svg>`),
  accepted('a leading BOM (the engine is given it)', `\u{FEFF}${SVG}</svg>`),
  accepted(']]> in a value', '<g id="a]]>b"/>'),
  // The P1-M0 review: an entity's name is any name (F6); the first of two declarations binds (F7); an
  // unparsed (NDATA) entity is never referenced (F9).
  accepted('a non-ASCII entity name, declared', `<!DOCTYPE svg [<!ENTITY \u00E9 "x">]>${SVG}<text>&\u00E9;</text></svg>`),
  accepted('a non-ASCII entity name in a value', `<!DOCTYPE svg [<!ENTITY caf\u00E9 "red">]>${SVG}<rect fill="&caf\u00E9;" width="1" height="1"/></svg>`),
  accepted('a middle dot in an entity name', `<!DOCTYPE svg [<!ENTITY a\u00B7b "x">]>${SVG}<text>&a\u00B7b;</text></svg>`),
  accepted('an entity declared twice, the first well-formed', `<!DOCTYPE svg [<!ENTITY a "x"><!ENTITY a "&#38;">]>${SVG}<text>&a;</text></svg>`),
  refused('an entity declared twice, the first not well-formed', `<!DOCTYPE svg [<!ENTITY a "&#38;"><!ENTITY a "x">]>${SVG}<text>&a;</text></svg>`),
  refused('a reference to an unparsed (NDATA) entity', `<!DOCTYPE svg [<!NOTATION gif SYSTEM "image/gif"><!ENTITY logo SYSTEM "logo.gif" NDATA gif>]>${SVG}<text>&logo;</text></svg>`),
  // Browsers supply HTML's named references under an XHTML DOCTYPE; Draw doesn't read DTDs.
  { label: 'an HTML entity under an XHTML DOCTYPE', text: `${XHTML_DOCTYPE}${SVG}<text>a&nbsp;b</text></svg>`, draw: 'limit', browser: both('accept') },
];

/**
 * What is wrong with one probe's verdicts, the engine's (`mine`, from engineCanon) and one browser's
 * (`theirs`, from browserCanon), against the rule and the probe table. A browser's refusal the engine
 * doesn't share is excused only where the probe names that engine's known defect (KNOWN), and the
 * browser's verdict is still held to the table, so a defect that gets fixed is named.
 */
export function probeProblems(probe, engine, mine, theirs) {
  const problems = [];
  const draw = mine.refused ? (mine.kind === 'limit' ? 'limit' : 'refuse') : 'accept';
  const verdict = theirs.refused ? 'refuse' : 'accept';
  const why = (r) => (r.refused ? ` (${r.message})` : '');
  const excused = probe.knownDefect?.[engine];
  if (verdict === 'refuse' && draw === 'accept' && !excused) problems.push(`${probe.label}: ${engine} refuses it, but Draw's parser accepts it`);
  if (draw === 'refuse' && verdict === 'accept') problems.push(`${probe.label}: Draw's parser refuses it as not well-formed${why(mine)}, but ${engine} accepts it`);
  if (draw !== probe.draw) problems.push(`${probe.label}: Draw's parser gives ${draw}, not ${probe.draw} as the probe table says${why(mine)}`);
  if (verdict !== probe.browser[engine]) problems.push(`${probe.label}: ${engine} gives ${verdict}, not ${probe.browser[engine]} as the probe table says${why(theirs)}`);
  return problems;
}
