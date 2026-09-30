// engine/code/tokens: what each grammar makes tokens of, with spans in the raw text, and that no
// token ever includes part of an entity or character reference.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc, descendants, findAttr, NS, type Doc, type ElementNode, type LeafNode } from '../../model/doc.ts';
import { ENUMS, decimalsOf, tokenizeAttr, tokenizeText, type AttrRef, type Token } from '../../code/tokens.ts';
import { applyTokenEdit } from '../../code/edit.ts';

const SVG = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

function load(body: string, prolog = ''): Doc {
  const r = parseDoc(`${prolog}<svg ${SVG}>${body}</svg>`);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
}

const elements = (doc: Doc): ElementNode[] => [...descendants(doc, doc.root)].filter((n): n is ElementNode => n.kind === 'element');
const nth = (doc: Doc, local: string, i = 0): ElementNode => elements(doc).filter((n) => n.local === local)[i];

/** Tokens of an attribute of the first <local>, each checked against the raw slice it claims. */
function attr(doc: Doc, local: string, name: string, ns: string | null = null, i = 0): Token[] {
  const node = nth(doc, local, i);
  const ref: AttrRef = { ns, local: name };
  const raw = findAttr(node, ns, name)!.raw;
  const ts = tokenizeAttr(doc, node.id, ref);
  for (const t of ts) assert.equal(raw.slice(t.start, t.end), t.text);
  return ts;
}

function leaves(doc: Doc): LeafNode[] {
  return [...doc.nodes.values()].filter((n): n is LeafNode => n.kind === 'text' || n.kind === 'cdata');
}

/** Tokens of every text and CDATA leaf, in document order, each checked against its raw slice. */
function textTokens(doc: Doc): Token[] {
  const out: Token[] = [];
  for (const n of descendants(doc, doc.root)) {
    if (n.kind !== 'text' && n.kind !== 'cdata') continue;
    for (const t of tokenizeText(doc, n.id)) {
      assert.equal(n.raw.slice(t.start, t.end), t.text);
      out.push(t);
    }
  }
  return out;
}

const texts = (ts: Token[]): string[] => ts.map((t) => t.text);
const kinds = (ts: Token[]): string[] => ts.map((t) => t.kind);

test('path data: every argument, glued numbers apart, arc flags as 0/1 keywords, nothing after an error', () => {
  const doc = load('<path d="M10,20L30-40.5.5 6a5 5 0 0110 10z"/><path d="M1 2 L3 x 5"/><path d="M1e2 3"/>');
  const ts = attr(doc, 'path', 'd');
  // P1-M3: a <path>'s written L (and l, Q, q, C, c) is a token too; the implicit L after it and the a are not.
  assert.deepEqual(texts(ts), ['10', '20', 'L', '30', '-40.5', '.5', '6', '5', '5', '0', '0', '1', '10', '10']);
  assert.deepEqual(kinds(ts).slice(9), ['number', 'enum', 'enum', 'number', 'number']);
  const flag = ts[10];
  assert.ok(flag.kind === 'enum' && flag.options === ENUMS['d.arcFlag']);
  assert.deepEqual(texts(attr(doc, 'path', 'd', null, 1)), ['1', '2'], 'the failed segment (its letter too) and the tail are not tokens');
  const [e] = attr(doc, 'path', 'd', null, 2);
  assert.ok(e.kind === 'number' && e.value === 100 && e.decimals === 0 && e.prop === 'd');
});

test('number lists, lengths and their limits', () => {
  const doc = load(
    '<polygon points="0,0 10-5 1e1,2"/><svg viewBox="-1 0.5 24 24" width="50%" height="1.5mm"/>' +
      '<rect x="1 2" rx="auto" opacity=".5" stroke-dasharray="4 2, 1" stroke-miterlimit="4"/>' +
      '<stop offset="25%"/><feFuncA type="linear" offset="-0.5"/>',
  );
  const pts = attr(doc, 'polygon', 'points');
  assert.deepEqual(texts(pts), ['0', '0', '10', '-5', '1e1', '2']);
  assert.ok(pts[4].kind === 'number' && pts[4].value === 10);
  const vb = attr(doc, 'svg', 'viewBox', null, 1);
  assert.deepEqual(
    vb.map((t) => t.kind === 'number' && t.min),
    [undefined, undefined, 0, 0],
    'only the width and height are floored',
  );
  const [w] = attr(doc, 'svg', 'width', null, 1);
  assert.ok(w.kind === 'number' && w.unit === '%' && w.min === 0 && w.value === 50);
  const [h] = attr(doc, 'svg', 'height', null, 1);
  assert.ok(h.kind === 'number' && h.unit === 'mm' && h.decimals === 1);
  assert.deepEqual(texts(attr(doc, 'rect', 'x')), ['1', '2']);
  assert.deepEqual(attr(doc, 'rect', 'rx'), [], 'a keyword is not a number');
  const [op] = attr(doc, 'rect', 'opacity');
  assert.ok(op.kind === 'number' && op.min === 0 && op.max === 1 && op.step === 0.01 && op.decimals === 1);
  assert.deepEqual(texts(attr(doc, 'rect', 'stroke-dasharray')), ['4', '2', '1']);
  const [ml] = attr(doc, 'rect', 'stroke-miterlimit');
  assert.ok(ml.kind === 'number' && ml.min === 1);
  const [off] = attr(doc, 'stop', 'offset');
  assert.ok(off.kind === 'number' && off.unit === '%' && off.max === 100);
  const [fo] = attr(doc, 'feFuncA', 'offset');
  assert.ok(fo.kind === 'number' && fo.min === undefined, "a transfer function's offset is any number");
});

test('decimals are counted as written', () => {
  assert.deepEqual(['1', '1.50', '.5', '-0.125', '1e3', '1.5e-3', '2E+2', '12.5e1'].map(decimalsOf), [0, 2, 1, 3, 0, 4, 0, 0]);
});

test('transform lists: the numbers inside each function, in SVG and CSS forms', () => {
  const doc = load('<g transform="translate(10 20) rotate(-45, 12 12)scale(2)"/><g style="transform: rotate(30deg) translateX(1.5px)"/><g transform="rotate(1) bogus"/>');
  assert.deepEqual(texts(attr(doc, 'g', 'transform')), ['10', '20', '-45', '12', '12', '2']);
  const css = attr(doc, 'g', 'style', null, 1);
  assert.deepEqual(
    css.map((t) => [t.text, t.kind === 'number' && t.unit, t.prop]),
    [
      ['30', 'deg', 'transform'],
      ['1.5', 'px', 'transform'],
    ],
  );
  assert.deepEqual(texts(attr(doc, 'g', 'transform', null, 2)), ['1'], 'reading stops at what is not a function');
});

test('colours and paints', () => {
  const doc = load(
    '<rect fill="#fff" stroke=" none " color="currentColor"/><stop stop-color="hsl(120 50% 50%)"/>' +
      '<circle fill="url(#g) red" stroke="url(\'#a%20b\')"/><path fill="inherit" stroke="context-stroke"/><stop stop-color="none"/>',
  );
  const [fill] = attr(doc, 'rect', 'fill');
  assert.ok(fill.kind === 'color' && fill.color?.spelling === '#fff' && fill.keywords.includes('none'));
  const [none] = attr(doc, 'rect', 'stroke');
  assert.ok(none.kind === 'color' && none.color === null && none.text === 'none' && none.start === 1, 'none is a paint keyword, trimmed');
  const [cur] = attr(doc, 'rect', 'color');
  assert.ok(cur.kind === 'color' && cur.color?.kind === 'current' && cur.keywords.length === 0);
  const [hsl] = attr(doc, 'stop', 'stop-color');
  assert.ok(hsl.kind === 'color' && hsl.color?.space === 'hsl');
  const [ref, fallback] = attr(doc, 'circle', 'fill');
  assert.ok(ref.kind === 'ref' && ref.id === 'g' && ref.text === 'g');
  assert.ok(fallback.kind === 'color' && fallback.text === 'red' && fallback.keywords.join() === 'none');
  const [quoted] = attr(doc, 'circle', 'stroke');
  assert.ok(quoted.kind === 'ref' && quoted.text === 'a%20b' && quoted.id === 'a b', 'ids are percent-decoded, text stays as written');
  assert.deepEqual(attr(doc, 'path', 'fill'), []);
  const [ctx] = attr(doc, 'path', 'stroke');
  assert.ok(ctx.kind === 'color' && ctx.color === null);
  assert.deepEqual(attr(doc, 'stop', 'stop-color', null, 1), [], "stop-color doesn't take none");
});

test('references: href, xlink:href under any prefix, url() in clip-path, mask, filter and markers', () => {
  const doc = load(
    '<use href="#star" xlink:href=" #s2 "/><image href="data:image/png;base64,AAAA"/><a href="https://example.com/#top"/>' +
      '<g clip-path="url(#c)" mask="none" filter="blur(2px) url(#f1) url(#f2)" marker-end="url(#m)"/>' +
      '<svg xmlns:l="http://www.w3.org/1999/xlink"><use l:href="#p"/></svg>',
  );
  const [h] = attr(doc, 'use', 'href');
  assert.ok(h.kind === 'ref' && h.id === 'star' && h.start === 1);
  const [x] = attr(doc, 'use', 'href', NS.xlink);
  assert.ok(x.kind === 'ref' && x.id === 's2' && x.start === 2);
  assert.deepEqual(attr(doc, 'image', 'href'), []);
  assert.deepEqual(attr(doc, 'a', 'href'), [], 'only same-document references are tokens');
  assert.deepEqual(texts(attr(doc, 'g', 'clip-path')), ['c']);
  assert.deepEqual(attr(doc, 'g', 'mask'), []);
  assert.deepEqual(texts(attr(doc, 'g', 'filter')), ['f1', 'f2']);
  assert.deepEqual(texts(attr(doc, 'g', 'marker-end')), ['m']);
  assert.deepEqual(texts(attr(doc, 'use', 'href', NS.xlink, 1)), ['p'], 'the prefix is resolved by URI');
});

test('keywords: option tables, element-scoped options, parts of a value', () => {
  const doc = load(
    '<path stroke-linecap="round" stroke-linejoin="Round" font-weight="700" paint-order="stroke markers" xml:space="preserve"/>' +
      '<image preserveAspectRatio="xMinYMax slice"/><image preserveAspectRatio="defer xMidYMid"/><image preserveAspectRatio="bogus"/>' +
      '<animate attributeName="x" fill="freeze"/><feComposite operator="arithmetic"/><feMorphology operator="dilate"/><feBlend mode="screen"/>' +
      '<marker orient="auto-start-reverse"/><marker orient="45deg"/><animateMotion rotate="auto"/><text rotate="10 20"/><font-face font-weight="550"/>',
  );
  const [cap] = attr(doc, 'path', 'stroke-linecap');
  assert.ok(cap.kind === 'enum' && cap.options === ENUMS['stroke-linecap']);
  assert.deepEqual(attr(doc, 'path', 'stroke-linejoin'), [], 'a value not exactly in the table gets no token');
  assert.equal(attr(doc, 'path', 'font-weight')[0].kind, 'enum');
  assert.deepEqual(texts(attr(doc, 'path', 'paint-order')), ['stroke markers']);
  const [space] = attr(doc, 'path', 'space', NS.xml);
  assert.ok(space.kind === 'enum' && space.options === ENUMS['xml:space']);
  const par = attr(doc, 'image', 'preserveAspectRatio');
  assert.deepEqual(
    par.map((t) => [t.text, t.kind === 'enum' && t.options.length]),
    [
      ['xMinYMax', 10],
      ['slice', 2],
    ],
  );
  assert.deepEqual(texts(attr(doc, 'image', 'preserveAspectRatio', null, 1)), ['xMidYMid']);
  assert.deepEqual(attr(doc, 'image', 'preserveAspectRatio', null, 2), []);
  const [freeze] = attr(doc, 'animate', 'fill');
  assert.ok(freeze.kind === 'enum' && freeze.options.includes('remove'), "an animation's fill is freeze/remove, not a paint");
  assert.ok(attr(doc, 'feComposite', 'operator')[0].kind === 'enum');
  const [dilate] = attr(doc, 'feMorphology', 'operator');
  assert.ok(dilate.kind === 'enum' && dilate.options.join() === 'erode,dilate');
  assert.equal(attr(doc, 'feBlend', 'mode')[0].kind, 'enum');
  assert.equal(attr(doc, 'marker', 'orient')[0].kind, 'enum');
  const [angle] = attr(doc, 'marker', 'orient', null, 1);
  assert.ok(angle.kind === 'number' && angle.unit === 'deg');
  assert.equal(attr(doc, 'animateMotion', 'rotate')[0].kind, 'enum');
  assert.deepEqual(kinds(attr(doc, 'text', 'rotate')), ['number', 'number']);
  assert.deepEqual(attr(doc, 'font-face', 'font-weight'), []);
});

test('SMIL: values read as the animated attribute, timing, and splines', () => {
  const doc = load(
    '<animate attributeName="fill" values="red; #00f;currentColor" dur="1.5s" begin="0.5s; x.end" repeatCount="indefinite" keyTimes="0; .25;1" keySplines=".5 0 .5 1"/>' +
      '<animate attributeName="opacity" from="0" to="1"/><animateTransform type="rotate" from="0 50 50" to="360 50 50"/>' +
      '<animate attributeName="d" values="M0 0h1;M0 0h2"/><set attributeName="visibility" to="hidden"/><animate attributeName="unknown" values="1;2"/>',
  );
  const vals = attr(doc, 'animate', 'values');
  assert.deepEqual(texts(vals), ['red', '#00f', 'currentColor']);
  assert.ok(vals.every((t) => t.kind === 'color' && t.prop === 'fill'), "tokens belong to the animated property");
  const [dur] = attr(doc, 'animate', 'dur');
  assert.ok(dur.kind === 'number' && dur.unit === 's' && dur.min === 0);
  assert.deepEqual(texts(attr(doc, 'animate', 'begin')), ['0.5']);
  assert.deepEqual(attr(doc, 'animate', 'repeatCount'), []);
  const kt = attr(doc, 'animate', 'keyTimes');
  assert.ok(kt.every((t) => t.kind === 'number' && t.min === 0 && t.max === 1));
  assert.equal(attr(doc, 'animate', 'keySplines').length, 4);
  const [to] = attr(doc, 'animate', 'to', null, 1);
  assert.ok(to.kind === 'number' && to.max === 1 && to.prop === 'opacity');
  assert.deepEqual(texts(attr(doc, 'animateTransform', 'to')), ['360', '50', '50']);
  assert.deepEqual(texts(attr(doc, 'animate', 'values', null, 2)), ['0', '0', '1', '0', '0', '2']);
  assert.equal(attr(doc, 'set', 'to')[0].kind, 'enum');
  assert.deepEqual(attr(doc, 'animate', 'values', null, 3), [], 'an attribute Draw has no grammar for');
});

test('style attributes: declarations by property, with !important, shorthands and custom properties skipped', () => {
  const doc = load('<rect style="fill:red; stroke-width: 2px !important;stroke-linecap:round;font: 12px sans-serif;--x: 5;opacity:50%; color : BLUE"/>');
  const ts = attr(doc, 'rect', 'style');
  assert.deepEqual(
    ts.map((t) => [t.kind, t.text, t.prop]),
    [
      ['color', 'red', 'fill'],
      ['number', '2', 'stroke-width'],
      ['enum', 'round', 'stroke-linecap'],
      ['number', '50', 'opacity'],
      ['color', 'BLUE', 'color'],
    ],
  );
  const pct = ts[3];
  assert.ok(pct.kind === 'number' && pct.max === 100);
});

test('style sheets: rules, at-rules, comments and strings; text and CDATA leaves', () => {
  const doc = load(
    '<style>.a{fill:#f00} @media (min-width: 1px) { .b { opacity: .5 } } /* c { fill: #000 } */ .c::after{content:"a;b{"} .d>e{stroke:blue}</style>' +
      '<style><![CDATA[ .st0{fill:#E63946;stroke-width:2;} ]]></style>',
  );
  const ts = textTokens(doc);
  assert.deepEqual(texts(ts), ['#f00', '.5', 'blue', '#E63946', '2']);
  const cdata = leaves(doc).find((n) => n.kind === 'cdata')!;
  const [c0] = tokenizeText(doc, cdata.id);
  assert.equal(c0.start, cdata.raw.indexOf('#E63946'), 'CDATA offsets count the delimiters');
});

test('text runs in text, tspan, textPath, title, desc and a link inside text; nowhere else', () => {
  const doc = load(
    '<text>  Hello <tspan>big</tspan> world <a href="#x">link</a></text><title>A title</title><desc>\n  Two\n  lines\n</desc>' +
      '<g>loose</g><script>var a = 1;</script><a><text>in a link</text></a><foreignObject><p xmlns="http://www.w3.org/1999/xhtml">html</p></foreignObject>' +
      '<rect aria-label="Close &amp; go"/>',
  );
  const ts = textTokens(doc);
  assert.deepEqual(
    ts.map((t) => [t.text, t.prop]),
    [
      ['Hello', 'text'],
      ['big', 'tspan'],
      ['world', 'text'],
      ['link', 'a'],
      ['A title', 'title'],
      ['Two\n  lines', 'desc'],
      ['in a link', 'text'],
    ],
  );
  assert.deepEqual(texts(attr(doc, 'rect', 'aria-label')), ['Close', 'go']);
});

test('elements outside SVG get tokens only from style=""; foreign attributes get none', () => {
  const doc = load(
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="color:#264653" width="10" fill="red"/></foreignObject>' +
      '<g xmlns:ink="urn:example:ink" ink:opacity="0.5" data-x="1"/>',
  );
  assert.deepEqual(texts(attr(doc, 'div', 'style')), ['#264653']);
  assert.deepEqual(attr(doc, 'div', 'width'), []);
  assert.deepEqual(attr(doc, 'div', 'fill'), []);
  assert.deepEqual(attr(doc, 'g', 'opacity', 'urn:example:ink'), []);
  assert.deepEqual(attr(doc, 'g', 'data-x'), []);
  assert.deepEqual(tokenizeAttr(doc, nth(doc, 'g').id, { ns: null, local: 'missing' }), []);
});

// ── entity safety ────────────────────────────────────────────────────────────────────────────────

const REFS = /&(#x[0-9a-fA-F]+|#\d+|[A-Za-z_:][\w.:-]*);|&/g;

/** No token of any attribute or leaf overlaps a reference (or a bare '&') in its raw text. */
function assertNoStraddle(doc: Doc): number {
  let n = 0;
  const check = (raw: string, ts: Token[]): void => {
    const spans = [...raw.matchAll(REFS)].map((m) => [m.index, m.index + m[0].length]);
    for (const t of ts) {
      assert.equal(raw.slice(t.start, t.end), t.text);
      for (const [s, e] of spans) assert.ok(t.end <= s || t.start >= e, `${JSON.stringify(t.text)} overlaps ${JSON.stringify(raw.slice(s, e))}`);
      n++;
    }
  };
  for (const node of doc.nodes.values()) {
    if (node.kind === 'element') for (const a of node.attrs) check(a.raw, tokenizeAttr(doc, node.id, a));
    else if (node.kind === 'text') check(node.raw, tokenizeText(doc, node.id));
  }
  return n;
}

test('entity safety: a value written partly or wholly as a reference gets no token there', () => {
  const doc = load(
    '<rect fill="&#x23;2a9d8f" stroke="&accent;" x="1&#48;" y="&#49;" width="2&#32;" style="fill:&accent;;stroke:red" opacity="0&#46;5"/>' +
      '<path d="M1&#46;5 2 L3 4"/><polygon points="1,2&#32;3,4"/><circle fill="rgb(1,&#50;,3)" stroke="url(#a&#98;c)"/>' +
      '<text>Tom &amp; Jerry &unknown; end&#33;</text><title>a &amp; b</title><style>a &gt; b { fill: &accent; ; stroke: #abc }</style>',
    // &unknown; is external: it stays as written (never fetched), as an undeclared one no longer parses.
    '<!DOCTYPE svg [<!ENTITY accent "#e76f51"><!ENTITY unknown SYSTEM "unknown.xml">]>',
  );
  assert.deepEqual(attr(doc, 'rect', 'fill'), []);
  assert.deepEqual(attr(doc, 'rect', 'stroke'), []);
  assert.deepEqual(attr(doc, 'rect', 'x'), [], "'1&#48;' reads as 10: no part of it is a token");
  assert.deepEqual(attr(doc, 'rect', 'y'), []);
  assert.deepEqual(texts(attr(doc, 'rect', 'width')), ['2'], 'a reference that is only whitespace separates');
  assert.deepEqual(texts(attr(doc, 'rect', 'style')), ['red']);
  assert.deepEqual(attr(doc, 'rect', 'opacity'), []);
  assert.deepEqual(texts(attr(doc, 'path', 'd')), ['2', 'L', '3', '4'], 'a letter token is a letter, not a reference');
  const pts = attr(doc, 'polygon', 'points');
  assert.deepEqual(
    pts.map((t) => [t.text, t.start]),
    [
      ['1', 0],
      ['2', 2],
      ['3', 8],
      ['4', 10],
    ],
  );
  assert.deepEqual(attr(doc, 'circle', 'fill'), []);
  assert.deepEqual(attr(doc, 'circle', 'stroke'), [], 'an id with a reference in it is not a token');
  assert.deepEqual(texts(textTokens(doc)), ['Tom', 'Jerry', 'end', 'a', 'b', '#abc']);
  assert.ok(assertNoStraddle(doc) > 0);
});

test('entity safety: an edit beside a reference leaves the reference as written', () => {
  const doc = load('<polygon points="1,2&#32;3,4"/><text>Tom &amp; Jerry</text>');
  const poly = nth(doc, 'polygon');
  const [, , three] = tokenizeAttr(doc, poly.id, { ns: null, local: 'points' });
  applyTokenEdit(doc, poly.id, { attr: { ns: null, local: 'points' } }, three, '30');
  assert.equal(findAttr(poly, null, 'points')!.raw, '1,2&#32;30,4');
  const leaf = leaves(doc).find((n) => n.raw.startsWith('Tom'))!;
  const [, jerry] = tokenizeText(doc, leaf.id);
  applyTokenEdit(doc, leaf.id, { text: true }, jerry, 'Spike');
  assert.equal(leaf.raw, 'Tom &amp; Spike');
  assertNoStraddle(doc);
});

test('a relative URL (value:url/relative): in a gradient’s href and xlink:href, in fill="url(other.svg#g) red" and in style="fill:url(\'other.svg#g\')", one text token over exactly its own characters; a #id there is still a ref; a data: URL, and an href on any other element, get no new token', () => {
  const doc = load(`<linearGradient href="other.svg#a"/><radialGradient xlink:href=" other.svg#a "/><linearGradient href="#b"/><linearGradient href="data:image/png;base64,AAAA"/><use href="other.svg#a"/><rect fill="url(other.svg#g) red"/><rect style="fill:url('other.svg#g')"/><rect fill="url(#g)"/><rect stroke="url(&quot;x.svg#y&quot;)"/>`);
  const kinds = (ts: Token[]) => ts.map((t) => `${t.kind}:${t.text}`);
  assert.deepEqual(kinds(attr(doc, 'linearGradient', 'href')), ['text:other.svg#a']);
  assert.deepEqual(kinds(attr(doc, 'radialGradient', 'href', NS.xlink)), ['text:other.svg#a'], 'inside the attribute’s whitespace');
  assert.deepEqual(kinds(attr(doc, 'linearGradient', 'href', null, 1)), ['ref:b'], 'a fragment stays a ref');
  assert.deepEqual(kinds(attr(doc, 'linearGradient', 'href', null, 2)), [], 'a data: URL gets none');
  assert.deepEqual(kinds(attr(doc, 'use', 'href')), [], 'an href on another element gets none');
  assert.deepEqual(kinds(attr(doc, 'rect', 'fill')), ['text:other.svg#g', 'color:red'], 'the paint’s URL, then its fallback');
  assert.deepEqual(kinds(attr(doc, 'rect', 'style', null, 1)), ['text:other.svg#g'], 'between the quotes, in style=""');
  assert.deepEqual(kinds(attr(doc, 'rect', 'fill', null, 2)), ['ref:g']);
  assert.deepEqual(kinds(attr(doc, 'rect', 'stroke', null, 3)), ['text:x.svg#y'], 'quoted by references, the URL’s own characters are still its token');
});

// ── P1-M3: a path's letter tokens and its numbers' labels ──────────────────────────────────────

const LAB = new URL('../fixtures/corpus/lab/', import.meta.url);
const labDoc = async (f: string) => load((await import('node:fs')).readFileSync(new URL(f, LAB), 'utf8').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''));

test('a <path>’s written L, l, Q, q, C and c letters are enum tokens over that one character, cycling L → Q → C, each with its segment’s index; M, H, V, S, T, A and Z letters and letter-less segments are plain text', async () => {
  const paths = await labDoc('paths.svg');
  const d = findAttr(nth(paths, 'path'), null, 'd')!.raw;
  const ts = attr(paths, 'path', 'd');
  assert.deepEqual(texts(ts), ['20', '75', 'L', '50', '30']);
  const [L] = ts.filter((t) => t.kind === 'enum');
  assert.ok(L.kind === 'enum' && L.segment === 1 && L.options.join() === 'L,Q,C' && L.prop === 'd');
  assert.equal(d.slice(L.start, L.end), 'L', 'its span is the letter');
  const logo = await labDoc('create-logo.svg');
  const lt = attr(logo, 'path', 'd').filter((t) => t.kind === 'enum');
  assert.deepEqual(lt.map((t) => [t.text, t.kind === 'enum' ? t.segment : -1]), [['Q', 1], ['Q', 2]]);
  const doc = load('<path d="M0 0l10 10 20 20H5V6c1 1 2 2 3 3s1 1 2 2t4 4a1 1 0 0 1 2 2Z"/><animate attributeName="d" values="M0 0 L1 1;M0 0 L2 2"/><glyph d="M0 0 L1 1"/>');
  const all = attr(doc, 'path', 'd');
  assert.deepEqual(all.filter((t) => t.kind === 'enum' && t.segment !== undefined).map((t) => t.text), ['l', 'c'], 'the implicit l after it, H, V, s, t, a and Z are not tokens');
  const l = all.find((t) => t.text === 'l')!;
  assert.ok(l.kind === 'enum' && l.options.join() === 'l,q,c' && l.segment === 1, 'a relative letter cycles in lowercase');
  assert.ok(!attr(doc, 'animate', 'values').some((t) => t.kind === 'enum'), 'an animation’s path values have no letter tokens');
  assert.ok(!attr(doc, 'glyph', 'd').some((t) => t.kind === 'enum'), 'nor a glyph’s d (Draw edits d on <path> only)');
});

test('a path’s number tokens are labelled as SVG Lab’s dParts labels them: point N x/y (N counting anchors from 1, the M too), control x/y, control 1 and 2, an S’s control 2, an arc’s rx, ry and rotation', () => {
  const doc = load('<path d="M 1 2 L 3 4 H 5 V 6 Q 7 8 9 10 C 11 12 13 14 15 16 S 17 18 19 20 T 21 22 A 23 24 25 0 1 26 27 Z"/>');
  const labels = attr(doc, 'path', 'd').filter((t) => t.kind === 'number').map((t) => (t.kind === 'number' ? `${t.text}:${t.label}` : ''));
  assert.deepEqual(labels, [
    '1:point 1 x', '2:point 1 y', '3:point 2 x', '4:point 2 y', '5:point 3 x', '6:point 4 y',
    '7:control x', '8:control y', '9:point 5 x', '10:point 5 y',
    '11:control 1 x', '12:control 1 y', '13:control 2 x', '14:control 2 y', '15:point 6 x', '16:point 6 y',
    '17:control 2 x', '18:control 2 y', '19:point 7 x', '20:point 7 y', '21:point 8 x', '22:point 8 y',
    '23:rx', '24:ry', '25:rotation', '26:point 9 x', '27:point 9 y',
  ]);
});
