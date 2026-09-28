// The canvas render policy against the ledger and the tables generated from it. Nothing here pins
// the tables' contents beyond a few obvious facts: each test walks the rows, so a regenerated table
// is checked as it stands. The URL and CSS cases are ordinary values, since the policy allowlists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDoc, descendants, NS, type Attr, type Doc, type ElementNode } from '../../model/doc.ts';
import { RENDER_SVG_ATTRIBUTES, RENDER_SVG_ELEMENTS, RENDER_XHTML_ATTRIBUTES, RENDER_XHTML_ELEMENTS, type AttrScope } from '../../policy/tables.ts';
import { cssAllowed as profileCssAllowed } from '../../../scripts/lib/svg-profile.mjs';
import {
  attributeRenders, cssAllowed, cssUrlsLocal, elementRenders, extensionsSupported, hasDuplicateAttrs, hrefFragmentIds, renderValue, smilTargetAllowed,
  urlAllowed, URL_ATTRIBUTES,
} from '../../policy/render-policy.ts';

interface Row {
  id: string;
  kind: string;
  name: string;
  ns?: string;
  on?: string[];
  render?: boolean;
}

const ledger: { rows: Row[] } = JSON.parse(readFileSync(new URL('../../ledger/ledger.json', import.meta.url), 'utf8'));
const OTHER_NS = 'urn:example:app-data';
const nsUri = (ns: string | undefined): string => (ns === 'svg' || ns === undefined ? NS.svg : ns === 'xhtml' ? NS.xhtml : ns === 'mathml' ? 'http://www.w3.org/1998/Math/MathML' : OTHER_NS);
// A table key or ledger name as (namespace, local): 'xlink:href' → XLink, 'href'.
const keyParts = (key: string): [string | null, string] =>
  key.startsWith('xlink:') ? [NS.xlink, key.slice(6)] : key.startsWith('xml:') ? [NS.xml, key.slice(4)] : [null, key];
const TABLES: [string, ReadonlyMap<string, AttrScope>, ReadonlySet<string>][] = [
  [NS.svg, RENDER_SVG_ATTRIBUTES, RENDER_SVG_ELEMENTS],
  [NS.xhtml, RENDER_XHTML_ATTRIBUTES, RENDER_XHTML_ELEMENTS],
];

function parse(src: string): Doc {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
}
const find = (doc: Doc, local: string): ElementNode =>
  [...descendants(doc, doc.root)].find((n): n is ElementNode => n.kind === 'element' && n.local === local)!;
const svg = (body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${attrs}>${body}</svg>`;
/** renderValue for the first attribute of the first <local> element in the source. */
function valueOf(src: string, local: string): string | null {
  const doc = parse(src);
  const el = find(doc, local);
  const a = el.attrs.find((x) => x.ns !== NS.xmlns)!;
  return renderValue(el, a, a.raw);
}

test('elements render exactly as their ledger rows say: SVG anywhere, XHTML only inside foreignObject', () => {
  const rows = ledger.rows.filter((r) => r.kind === 'element');
  assert.ok(rows.length > 150, 'the ledger lost its element rows');
  for (const r of rows) {
    const ns = nsUri(r.ns);
    const want = !!r.render;
    if (ns === NS.xhtml) {
      assert.equal(elementRenders(ns, r.name, true), want, `${r.id} in foreignObject`);
      assert.equal(elementRenders(ns, r.name, false), false, `${r.id} outside foreignObject`);
    } else {
      assert.equal(elementRenders(ns, r.name, false), want && ns === NS.svg, r.id);
      assert.equal(elementRenders(ns, r.name, true), want && ns === NS.svg, `${r.id} in foreignObject`);
    }
  }
  assert.ok(elementRenders(NS.svg, 'rect', false));
  assert.ok(!elementRenders(NS.svg, 'script', false) && !elementRenders(NS.svg, 'script', true));
  assert.ok(!elementRenders(NS.xhtml, 'script', true));
});

test('a known name in the wrong namespace, or none, does not render', () => {
  for (const ns of [null, OTHER_NS, NS.xlink]) {
    for (const local of [...RENDER_SVG_ELEMENTS, ...RENDER_XHTML_ELEMENTS]) assert.ok(!elementRenders(ns, local, true), `${ns}:${local}`);
  }
  for (const local of RENDER_SVG_ELEMENTS) if (!RENDER_XHTML_ELEMENTS.has(local)) assert.ok(!elementRenders(NS.xhtml, local, true), `xhtml:${local}`);
  for (const local of RENDER_XHTML_ELEMENTS) if (!RENDER_SVG_ELEMENTS.has(local)) assert.ok(!elementRenders(NS.svg, local, false), `svg:${local}`);
});

test('every rendered attribute renders on the elements in its scope and on no other', () => {
  for (const [elNs, table, elements] of TABLES) {
    assert.ok(table.size > 10, 'an attribute table is empty');
    for (const [key, scope] of table) {
      const [ns, local] = keyParts(key);
      for (const e of elements) {
        const inScope = scope.on === '*' ? !scope.except?.includes(e) : scope.on.includes(e);
        assert.equal(attributeRenders(elNs, e, ns, local), inScope, `${key} on <${e}>`);
      }
      for (const e of scope.on === '*' ? [] : scope.on) assert.ok(attributeRenders(elNs, e, ns, local), `${key} on <${e}>`);
      for (const e of scope.except ?? []) assert.ok(!attributeRenders(elNs, e, ns, local), `${key} on <${e}> (except)`);
      assert.ok(!attributeRenders(OTHER_NS, 'rect', ns, local), `${key} on a foreign element`);
      assert.ok(!attributeRenders(elNs, [...elements][0], OTHER_NS, local), `${key} in a foreign namespace`);
    }
  }
  assert.ok(attributeRenders(NS.svg, 'rect', null, 'fill'));
});

test('an element with its own ledger row follows it: href and xlink:href on <a> do not render', () => {
  const splits = ledger.rows.filter((r) => r.kind === 'attribute' && r.id.includes('@'));
  assert.ok(splits.length >= 2, 'the ledger lost href@a');
  for (const r of splits) {
    const [ns, local] = keyParts(r.name);
    for (const e of r.on!) assert.equal(attributeRenders(nsUri(r.ns), e, ns, local), !!r.render, `${r.id} on <${e}>`);
  }
  assert.ok(!attributeRenders(NS.svg, 'a', null, 'href') && !attributeRenders(NS.svg, 'a', NS.xlink, 'href'));
  assert.ok(attributeRenders(NS.svg, 'use', null, 'href') && attributeRenders(NS.svg, 'use', NS.xlink, 'href'));
});

test('attributes the ledger does not render are refused, patterns (aria-*, data-*, on*) included', () => {
  const rows = ledger.rows.filter((r) => r.kind === 'attribute' && !r.render && !r.id.includes('@'));
  assert.ok(rows.length > 50, 'the ledger lost its unrendered attribute rows');
  const rendered = ledger.rows.filter((r) => r.kind === 'attribute' && r.render && r.id.includes('@'));
  for (const r of rows) {
    const name = r.name.includes('*') ? r.name.replace('*', 'x') : /^(?:(?:xlink|xml):)?[A-Za-z][\w.-]*$/.test(r.name) ? r.name : 'unclassified-name';
    const [ns, local] = keyParts(name);
    const elNs = nsUri(r.ns);
    const elements = r.on!.includes('*') ? [...(elNs === NS.xhtml ? RENDER_XHTML_ELEMENTS : RENDER_SVG_ELEMENTS)] : r.on!;
    for (const e of elements) {
      if (rendered.some((s) => s.id.startsWith(`${r.id}@`) && s.on!.includes(e))) continue;
      assert.ok(!attributeRenders(elNs, e, ns, local), `${r.id} renders on <${e}>`);
    }
  }
});

test('event handlers and xml:base never render, in any case or namespace', () => {
  const handlers = ['onclick', 'onload', 'ONLOAD', 'onBegin', 'OnFocusIn', 'on'];
  for (const [elNs, , elements] of TABLES) {
    for (const e of elements) {
      for (const h of handlers) for (const ns of [null, NS.xlink, NS.xml, OTHER_NS]) assert.ok(!attributeRenders(elNs, e, ns, h), `${h} on <${e}>`);
      assert.ok(!attributeRenders(elNs, e, NS.xml, 'base'), `xml:base on <${e}>`);
    }
  }
  assert.equal(valueOf(svg('<rect onclick="go()"/>'), 'rect'), null);
  assert.equal(valueOf(svg('<g xml:base="https://example.com/"/>'), 'g'), null);
});

test('XLink attributes are known by namespace, whatever the prefix', () => {
  const q = ' xmlns:q="http://www.w3.org/1999/xlink"';
  assert.equal(valueOf(svg('<use q:href="#a"/>', q), 'use'), '#a');
  assert.equal(valueOf(svg('<use xlink:href="#a"/>'), 'use'), '#a');
  // 'xlink' bound to some other namespace is not XLink.
  assert.equal(valueOf(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="${OTHER_NS}"><use xlink:href="#a"/></svg>`, 'use'), null);
  assert.equal(valueOf(svg('<use q:href="#a"/>', ` xmlns:q="${OTHER_NS}"`), 'use'), null);
});

test('URLs: a fragment on every URL attribute, data: images only where images show, nothing else', () => {
  const urlAttrs: [string, string, string][] = []; // [element ns, element, attribute key]
  for (const [elNs, table, elements] of TABLES) {
    for (const key of URL_ATTRIBUTES) {
      const [ns, local] = keyParts(key);
      for (const e of elements) if (attributeRenders(elNs, e, ns, local)) urlAttrs.push([elNs, e, key]);
    }
    assert.ok([...URL_ATTRIBUTES].some((k) => table.has(k)), 'no URL attribute renders');
  }
  const images = new Set(['image href', 'image xlink:href', 'feImage href', 'feImage xlink:href', 'img src']);
  const data = ['png', 'jpeg', 'gif', 'webp'].map((t) => `data:image/${t};base64,AAAA`);
  for (const [, e, key] of urlAttrs) {
    const local = keyParts(key)[1];
    for (const v of ['#a', ' #a ', '#a\n', '#']) assert.ok(urlAllowed(e, local, v), `${JSON.stringify(v)} on <${e} ${key}>`);
    for (const v of data) assert.equal(urlAllowed(e, local, v), images.has(`${e} ${key}`), `${v} on <${e} ${key}>`);
    for (const v of ['https://example.com/x.png', 'other.svg#a', 'x.png', '/draw/x.png', '//example.com/x.png', '', 'data:image/svg+xml,%3Csvg%2F%3E', 'data:text/plain,hi']) {
      assert.ok(!urlAllowed(e, local, v), `${JSON.stringify(v)} on <${e} ${key}>`);
    }
  }
  assert.ok(urlAttrs.length > 10, 'too few URL attributes render');
  // Editors wrap long base64 (XML reads the line ends as spaces); still a data: image.
  assert.ok(urlAllowed('image', 'href', 'data:image/png;base64,iVBORw0K GgoAAAA\n  NSUhEUgAA'));
  assert.ok(urlAllowed('image', 'href', 'DATA:IMAGE/PNG;base64,AAAA'));
});

// The allowlist against a real URL parser (Node's WHATWG one), for every character up to U+00A0
// around an ordinary fragment and data: image: whatever urlAllowed keeps must still resolve to this
// document, or be that image, once the browser has read it.
test('URLs: whatever is kept still means the same fragment or image to a URL parser', () => {
  const BASE = 'https://site.test/draw/';
  const here = (u: URL) => u.href.slice(0, u.href.length - u.hash.length) === BASE;
  let kept = 0;
  for (let cp = 0; cp <= 0xa0; cp++) {
    const c = String.fromCharCode(cp);
    for (const v of [`${c}#a`, `#${c}a`, `#a${c}`, `${c}${c}#a`]) {
      if (!urlAllowed('use', 'href', v)) continue;
      kept++;
      assert.ok(here(new URL(v, BASE)), `U+${cp.toString(16)}: ${JSON.stringify(v)} leaves the document`);
    }
    for (const v of [`${c}data:image/png;base64,AAAA`, `da${c}ta:image/png;base64,AAAA`, `data:image/p${c}ng;base64,AAAA`]) {
      if (!urlAllowed('image', 'href', v)) continue;
      kept++;
      const u = new URL(v, BASE);
      assert.ok(here(u) || /^data:image\/png[;,]/i.test(u.href), `U+${cp.toString(16)}: ${JSON.stringify(v)} is neither in the document nor a PNG`);
    }
  }
  assert.ok(kept > 300, `only ${kept} values kept: the sweep tests too little`);
});

test('the ids a kept fragment names, read both ways and percent-decoded', () => {
  assert.deepEqual(hrefFragmentIds('#a'), ['a']);
  assert.deepEqual(hrefFragmentIds(' #a%20b '), ['a b']);
  assert.deepEqual(hrefFragmentIds('#caf%C3%A9'), ['café']);
  // A leading control character: the URL parser trims it, so this names "t" (String#trim wouldn't).
  assert.ok(urlAllowed('animate', 'href', '\u0001#t'));
  assert.deepEqual(hrefFragmentIds('\u0001#t'), ['t']);
  // One inside: the URL parser keeps it, the plan's rule drops it, so both are candidates.
  assert.deepEqual(hrefFragmentIds('#a\u0001b').sort(), ['a\u0001b', 'ab'].sort());
});

// Built directly, not parsed: XML forbids these, and the parser may come to refuse them first.
test('an element carrying an attribute twice is flagged, by namespace and local name', () => {
  const attr = (qname: string, ns: string | null): Attr => {
    const [prefix, local] = qname.includes(':') ? qname.split(':') : [null, qname];
    return { qname, prefix, local, ns, lead: ' ', eq: '=', quote: '"', raw: 'x' };
  };
  assert.ok(hasDuplicateAttrs([attr('fill', null), attr('fill', null)]));
  // An unbound prefix resolves to no namespace: the same attribute as the plain one.
  assert.ok(hasDuplicateAttrs([attr('fill', null), attr('p:fill', null)]));
  // Two prefixes bound to XLink are one attribute.
  assert.ok(hasDuplicateAttrs([attr('xlink:href', NS.xlink), attr('q:href', NS.xlink)]));
  assert.ok(!hasDuplicateAttrs([attr('href', null), attr('xlink:href', NS.xlink), attr('fill', null)]));
  assert.ok(!hasDuplicateAttrs([attr('xmlns', NS.xmlns), attr('xmlns:q', NS.xmlns), attr('q:x', 'urn:a'), attr('r:x', 'urn:b')]), 'namespace declarations are not attributes');
});

test('requiredExtensions: true only for the XHTML namespace, as browsers read it', () => {
  const XHTML = 'http://www.w3.org/1999/xhtml';
  for (const v of [XHTML, `${XHTML} ${XHTML}`, `${XHTML}  ${XHTML} `, `${XHTML}\t${XHTML}`]) assert.ok(extensionsSupported(v), JSON.stringify(v));
  for (const v of ['', ' ', ` ${XHTML}`, 'http://example.com/ext', `${XHTML} http://example.com/ext`, `${XHTML},${XHTML}`, 'http://www.w3.org/1998/Math/MathML']) {
    assert.ok(!extensionsSupported(v), JSON.stringify(v));
  }
});

test('renderValue returns the value unchanged, or null', () => {
  const doc = parse(svg('<rect fill="red" style="fill:url(#g)"/><use href="#a"/><image href="x.png"/>'));
  const rect = find(doc, 'rect');
  const [fill, style] = rect.attrs.filter((a) => a.ns !== NS.xmlns);
  const v = 'rgb(1, 2, 3)';
  assert.equal(renderValue(rect, fill, v), v);
  assert.equal(renderValue(rect, style, 'fill:url(#g)'), 'fill:url(#g)');
  assert.equal(renderValue(find(doc, 'use'), find(doc, 'use').attrs[0], '#a'), '#a');
  assert.equal(renderValue(find(doc, 'image'), find(doc, 'image').attrs[0], 'x.png'), null);
});

test('CSS: the served profile rule for style, and every url() stays in the document', () => {
  assert.equal(cssAllowed, profileCssAllowed);
  const div = (style: string) => `<foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="${style}"/></foreignObject>`;
  const cases: [string, string, boolean][] = [
    [svg('<rect style="fill:red;stroke:url(#g)"/>'), 'rect', true],
    [svg('<rect style="fill:url(other.svg#g)"/>'), 'rect', false],
    [svg(div('background:url(data:image/png;base64,AAAA)')), 'div', true],
    [svg(div('background:url(https://example.com/x.png)')), 'div', false],
    [svg('<rect fill="url(#g)"/>'), 'rect', true],
    [svg('<rect fill="url(other.svg#g)"/>'), 'rect', false],
    [svg('<g mask="url(https://example.com/m.svg#m)"/>'), 'g', false],
    [svg('<g filter="url(\'#f\')"/>'), 'g', true],
    [svg('<path d="M0 0L10 10"/>'), 'path', true],
  ];
  for (const [src, local, ok] of cases) assert.equal(valueOf(src, local) !== null, ok, src);
  for (const css of ['fill:url(#g)', 'fill:url( "#g" )', 'src:url(data:font/woff2;base64,AAAA)', 'fill:red']) assert.ok(cssUrlsLocal(css), css);
  // CSS function names are case-insensitive, and @import takes a file without url().
  for (const css of ['fill:url(x.svg#g)', 'background:url(https://example.com/x.png)', 'background:image-set("x.png" 1x)', 'fill:URL(other.svg#g)', '@import "a.css";', '@IMPORT url(#a);']) {
    assert.ok(!cssUrlsLocal(css), css);
  }
  assert.ok(cssUrlsLocal('@charset "utf-8"; rect { fill: red }'));
});

test('SMIL: an animation renders only if what it animates renders on its target', () => {
  const doc = parse(svg('<rect><animate attributeName="fill"/><set attributeName="x"/><animateMotion/></rect>'));
  const animate = find(doc, 'animate');
  const set = find(doc, 'set');
  for (const target of [...RENDER_SVG_ELEMENTS].map((local) => ({ ns: NS.svg, local }))) {
    for (const key of RENDER_SVG_ATTRIBUTES.keys()) {
      if (key.includes(':')) continue;
      const want = attributeRenders(NS.svg, target.local, null, key) && key !== 'href' && key !== 'style';
      assert.equal(smilTargetAllowed(animate, key, target), want, `${key} on <${target.local}>`);
    }
    for (const name of ['href', 'xlink:href', 'q:href', ' style ', 'onclick', 'ONBEGIN', '']) {
      assert.ok(!smilTargetAllowed(set, name, target), `${JSON.stringify(name)} on <${target.local}>`);
    }
  }
  const rect = { ns: NS.svg, local: 'rect' };
  assert.ok(smilTargetAllowed(animate, ' fill ', rect) && smilTargetAllowed(set, 'x', rect));
  assert.ok(smilTargetAllowed(animate, 'fill') && !smilTargetAllowed(animate, 'not-an-attribute'));
  assert.ok(smilTargetAllowed(find(doc, 'animateMotion'), '', rect), 'animateMotion has no attributeName');
});
