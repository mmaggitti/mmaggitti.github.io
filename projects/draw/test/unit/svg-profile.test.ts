// The Library SVG Profile (scripts/lib/svg-profile.mjs): every inert case conforms, and every
// active case is refused with the rule that names it. These are the served-library guarantees; the
// same checker runs in CI over every .svg on the site and in Draw before a save.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSvg, cssAllowed, urlAllowed } from '../../../../scripts/lib/svg-profile.mjs';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XL = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const XH = 'xmlns="http://www.w3.org/1999/xhtml"';
const svg = (body: string, attrs = '') => `<svg ${NS}${attrs ? ' ' + attrs : ''} viewBox="0 0 24 24">${body}</svg>`;

const INERT: [string, string][] = [
  ['minimal path', svg('<path d="M0 0L1 1"/>')],
  ['xml declaration', `<?xml version="1.0" encoding="UTF-8"?>\n${svg('<rect width="1" height="1"/>')}`],
  ['comment', svg('<!-- a note --><circle r="2"/>')],
  ['style element', svg('<style>rect{fill:red}.a{stroke:#000}</style><rect class="a"/>')],
  ['style in CDATA', svg('<style><![CDATA[rect > .a { fill: url(#g) }]]></style>')],
  ['https link on a', svg('<a href="https://example.com/x"><rect/></a>')],
  ['mailto link', svg('<a href="mailto:hi@example.com"><rect/></a>')],
  ['use fragment', svg('<defs><circle id="a" r="1"/></defs><use href="#a"/>')],
  ['xlink use fragment', svg('<use xlink:href="#a"/>', XL)],
  ['data png image', svg('<image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>')],
  ['relative image', svg('<image href="photo.png" width="1" height="1"/>')],
  ['dc metadata', svg('<metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Logo</dc:title></rdf:RDF></metadata>')],
  ['foreignObject text', svg(`<foreignObject width="10" height="10"><div ${XH}><p>Hello <b>there</b></p></div></foreignObject>`)],
  ['SMIL opacity', svg('<rect><animate attributeName="opacity" values="1;0;1" dur="2s" repeatCount="indefinite"/></rect>')],
  ['SMIL motion', svg('<path id="p" d="M0 0L9 9"/><circle r="1"><animateMotion dur="3s"><mpath href="#p"/></animateMotion></circle>')],
  ['entities', svg('<text>a &amp; b &lt; c &#169; &#x263A;</text>')],
  ['title and desc', svg('<title>Icon</title><desc>A thing</desc><g role="img" aria-label="x"/>')],
  ['filter chain', svg('<filter id="f"><feGaussianBlur stdDeviation="2"/><feOffset dx="1"/></filter><rect filter="url(#f)"/>')],
  ['style attribute ok', svg('<rect style="fill:#e76f51;stroke:url(#g)"/>')],
  ['data font in css', svg('<style>@font-face{font-family:X;src:url(data:font/woff2;base64,AAAA)}</style>')],
  ['css comments', svg('<style>/* brand */ rect { fill: url(#g) /* the gradient */ } /* end */</style><rect style="fill: /* teal */ #2a9d8f"/>')],
];

const ACTIVE: [string, string, string][] = [
  ['script element', svg('<script>alert(1)</script>'), 'element:script'],
  ['onload on root', `<svg ${NS} onload="alert(1)"/>`, 'event-handler'],
  ['uppercase handler', svg('<rect ONCLICK="alert(1)"/>'), 'event-handler'],
  ['handler in foreign namespace', svg('<rect q:onclick="x" xmlns:q="urn:q"/>'), 'event-handler'],
  ['javascript link', svg('<a href="javascript:alert(1)"><rect/></a>'), 'url'],
  ['tab-split javascript', svg('<a href="java&#x09;script:alert(1)"><rect/></a>'), 'url'],
  ['entity-encoded javascript', svg('<a href="&#106;avascript:alert(1)"><rect/></a>'), 'url'],
  ['xlink javascript', svg('<a xlink:href="javascript:alert(1)"><rect/></a>', XL), 'url'],
  ['custom prefix bound to xlink', svg('<a q:href="javascript:alert(1)" xmlns:q="http://www.w3.org/1999/xlink"><rect/></a>'), 'url'],
  ['protocol-relative link', svg('<a href="//evil.example/x"><rect/></a>'), 'url'],
  ['use to data svg', svg('<use href="data:image/svg+xml;base64,PHN2Zy8+"/>'), 'use-href-not-fragment'],
  ['use to another file', svg('<use href="other.svg#a"/>'), 'use-href-not-fragment'],
  ['image data html', svg('<image href="data:text/html,x"/>'), 'url'],
  ['external image beacon', svg('<image href="https://evil.example/p.png"/>'), 'url'],
  ['feImage javascript', svg('<filter><feImage href="javascript:x"/></filter>'), 'url'],
  ['set href to javascript', svg('<a href="#ok"><set attributeName="href" to="javascript:alert(1)"/><rect/></a>'), 'smil-retarget'],
  ['animate xlink:href', svg('<a><animate attributeName="xlink:href" values="#a;javascript:x"/></a>'), 'smil-retarget'],
  ['set onclick', svg('<rect><set attributeName="onclick" to="alert(1)"/></rect>'), 'smil-retarget'],
  ['padded uppercase HREF', svg('<a><set attributeName=" HREF " to="x"/></a>'), 'smil-retarget'],
  ['animate style', svg('<rect><animate attributeName="style" values="a;b"/></rect>'), 'smil-retarget'],
  ['doctype with entity', `<!DOCTYPE svg [<!ENTITY x "y">]>${svg('<text>&x;</text>')}`, 'doctype-or-declaration'],
  ['xml-stylesheet PI', `<?xml-stylesheet href="x.xsl" type="text/xsl"?>${svg('')}`, 'processing-instruction'],
  ['PI in body', svg('<?x </g><img src=x onerror=alert(1)>?>'), 'processing-instruction'],
  ['html script outside foreignObject', svg('<html:script xmlns:html="http://www.w3.org/1999/xhtml">alert(1)</html:script>'), 'xhtml-outside-foreignobject'],
  ['xhtml script in foreignObject', svg(`<foreignObject><div ${XH}><script>alert(1)</script></div></foreignObject>`), 'xhtml:script'],
  ['iframe in foreignObject', svg(`<foreignObject><iframe ${XH} src="https://evil.example"/></foreignObject>`), 'xhtml:not-allowed'],
  ['body onload in foreignObject', svg(`<foreignObject><body ${XH} onload="alert(1)"/></foreignObject>`), 'event-handler'],
  ['css import', svg('<style>@import url(x.css);</style>'), 'css'],
  ['css external url', svg('<style>rect{fill:url(https://evil.example/x)}</style>'), 'css'],
  ['css escaped import', svg('<style>@\\69mport "x.css";</style>'), 'css'],
  ['style attr beacon', svg('<rect style="background:url(https://evil.example/b)"/>'), 'css'],
  ['css expression', svg('<rect style="width:expression(alert(1))"/>'), 'css'],
  ['cdata outside style', svg('<text><![CDATA[x]]></text>'), 'cdata-outside-style'],
  ['xml:base', svg('<g xml:base="https://evil.example/"><use href="#a"/></g>'), 'xml-base'],
  ['inkscape attribute', svg('<g inkscape:label="L" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"/>'), 'foreign-attribute'],
  ['sodipodi element', svg('<sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"/>'), 'foreign-element'],
  ['mathml', svg('<math xmlns="http://www.w3.org/1998/Math/MathML"/>'), 'foreign-element'],
  ['bare ampersand', svg('<text>a & b</text>'), 'entity'],
  ['html entity', svg('<text>a&nbsp;b</text>'), 'entity'],
  ['unquoted attribute', `<svg ${NS} width=10/>`, 'malformed-start-tag'],
  ['mismatched tags', svg('<g><rect></g></rect>'), 'mismatched-end-tag'],
  ['root is not svg', `<html ${XH}><body/></html>`, 'root-not-svg'],
  ['comment breakout shape', svg('<g><!--> <img src=x onerror=alert(1)> --></g>'), 'comment-html-ambiguous'],
  ['comment with markup', svg('<g><!-- </g><img src=x> --></g>'), 'comment-html-ambiguous'],
  ['comment with double dash', svg('<!-- a -- b -->'), 'comment-double-dash'],
];

for (const [name, text] of INERT) {
  test(`inert: ${name}`, () => {
    assert.deepEqual(checkSvg(text), [], `expected no findings for ${name}`);
  });
}

for (const [name, text, rule] of ACTIVE) {
  test(`active: ${name} → ${rule}`, () => {
    const rules = checkSvg(text).map((f: { rule: string }) => f.rule);
    assert.ok(rules.includes(rule), `${name}: expected rule ${rule}, got [${rules.join(', ')}]`);
  });
}

// The ledger's active rows, where the served profile must refuse them. Ordinary values only: a
// script URL that does nothing, a style sheet by name, an image on another site.
const SCRIPT_URLS: [string, string][] = [
  ['javascript:', 'javascript:void(0)'],
  ['vbscript:', 'vbscript:void(0)'],
  ['data:text/html', 'data:text/html,hello'],
];

/** Where a served file can hold a URL, and the rule that refuses a bad one there. */
const URL_PLACES: [string, (u: string) => string, string][] = [
  ['a link', (u) => svg(`<a href="${u}"><rect width="1" height="1"/></a>`), 'url'],
  ['an XLink link', (u) => svg(`<a xlink:href="${u}"><rect width="1" height="1"/></a>`, XL), 'url'],
  ['an image', (u) => svg(`<image href="${u}" width="1" height="1"/>`), 'url'],
  ['an XLink image', (u) => svg(`<image xlink:href="${u}" width="1" height="1"/>`, XL), 'url'],
  ['a filter image', (u) => svg(`<filter id="f"><feImage href="${u}"/></filter>`), 'url'],
  ['a use', (u) => svg(`<use href="${u}"/>`), 'use-href-not-fragment'],
  ['an HTML image', (u) => svg(`<foreignObject width="1" height="1"><img ${XH} src="${u}"/></foreignObject>`), 'url'],
  ['a <style>', (u) => svg(`<style>rect { fill: url(${u}) }</style>`), 'css'],
  ['a style attribute', (u) => svg(`<rect style="fill: url(${u})"/>`), 'css'],
  ['a fill', (u) => svg(`<rect fill="url(${u})"/>`), 'css'],
  ['a mask', (u) => svg(`<g mask="url(${u})"/>`), 'css'],
  ['a cursor', (u) => svg(`<rect cursor="url(${u}), auto"/>`), 'css'],
  ['an animated fill', (u) => svg(`<rect><animate attributeName="fill" values="red;url(${u})" dur="1s"/></rect>`), 'css'],
  // A url() with no closing ")" or quote still loads: a browser reads it to the end.
  ['a fill never closed', (u) => svg(`<rect fill="url(${u}"/>`), 'css'],
  ['a quoted fill never closed', (u) => svg(`<rect fill="url('${u})"/>`), 'css'],
  ['a mask never closed', (u) => svg(`<g mask="url(${u}"/>`), 'css'],
  ['a style attribute with an unmatched quote', (u) => svg(`<rect style="mask:url('${u})"/>`), 'css'],
  ['a <style> with an unmatched quote', (u) => svg(`<style>rect{mask:url('${u})}</style>`), 'css'],
  ['an HTML srcset', (u) => svg(`<foreignObject width="1" height="1"><img ${XH} srcset="${u} 1x"/></foreignObject>`), 'url'],
  ['an HTML table background', (u) => svg(`<foreignObject width="1" height="1"><table ${XH} background="${u}"/></foreignObject>`), 'url'],
];
const rulesOf = (text: string): string[] => checkSvg(text).map((f: { rule: string }) => f.rule);

for (const [label, url] of SCRIPT_URLS) {
  test(`never served: ${label} URLs, wherever a URL, url() or animated value can hold one`, () => {
    for (const [place, make, rule] of URL_PLACES) {
      for (const u of [url, url.toUpperCase(), ` ${url}`]) {
        const rules = rulesOf(make(u));
        assert.ok(rules.includes(rule), `${JSON.stringify(u)} in ${place}: expected ${rule}, got [${rules.join(', ')}]`);
      }
    }
  });
}

test('never served: a resource on another site, wherever a URL or url() can load one', () => {
  const resources = URL_PLACES.filter(([place]) => !place.includes('link'));
  for (const url of ['https://example.com/logo.png', 'http://example.com/logo.png', '//example.com/logo.png']) {
    for (const [place, make, rule] of resources) {
      const rules = rulesOf(make(url));
      assert.ok(rules.includes(rule), `${url} in ${place}: expected ${rule}, got [${rules.join(', ')}]`);
    }
    for (const css of [`@font-face { font-family: X; src: url(${url}) }`, `rect { cursor: url(${url}), auto }`, `rect { fill: image-set("${url}" 1x) }`]) {
      assert.ok(rulesOf(svg(`<style>${css}</style>`)).includes('css'), css);
    }
  }
  // A link is not a resource: it loads nothing until it is followed, so https is served on <a>.
  assert.deepEqual(checkSvg(svg('<a href="https://example.com/"><rect width="1" height="1"/></a>')), []);
  // Files on this site are not another site's.
  assert.deepEqual(checkSvg(svg('<image href="logo.png" width="1" height="1"/><rect fill="url(#g)"/>')), []);
});

test('never served: @import, whatever its form', () => {
  const imports = ['@import "theme.css";', '@import url(theme.css) screen;', '@import url("#local");', '@IMPORT "theme.css";', '@layer base; @import "theme.css" layer(base);', '/* theme */ @import "theme.css";', '@\\69mport "theme.css";', '@charset "/*"; @import "theme.css"; rect { stroke: teal } /* end */'];
  for (const css of imports) {
    for (const text of [svg(`<style>${css}</style>`), svg(`<style><![CDATA[${css}]]></style>`), svg(`<rect style='${css}'/>`)]) {
      assert.ok(rulesOf(text).includes('css'), text);
    }
  }
});

test('@namespace: a file with the string form is served; one with the url() form is refused (css), though a namespace name is never fetched', () => {
  assert.deepEqual(rulesOf(svg('<style>@namespace svg "http://www.w3.org/2000/svg"; svg|rect { fill: teal }</style><rect/>')), []);
  for (const css of ['@namespace url(http://www.w3.org/2000/svg);', '@namespace svg url("http://www.w3.org/2000/svg");']) {
    assert.deepEqual(rulesOf(svg(`<style>${css}</style><rect/>`)), ['css'], css);
  }
});

test('never served: xml:base, on any element and whatever it points at', () => {
  for (const value of ['https://example.com/', 'assets/', '#', '']) {
    const texts = [
      `<svg ${NS} xml:base="${value}"/>`,
      svg(`<g xml:base="${value}"><use href="#a"/></g>`),
      svg(`<a xml:base="${value}" href="#a"><rect width="1" height="1"/></a>`),
      svg(`<foreignObject width="1" height="1"><div ${XH} xml:base="${value}"/></foreignObject>`),
    ];
    for (const text of texts) assert.ok(rulesOf(text).includes('xml-base'), text);
  }
});

test('findings carry a line number, never the matched text', () => {
  const f = checkSvg(`<svg ${NS}>\n<rect/>\n<script>secret-token-shape</script>\n</svg>`);
  assert.equal(f[0].line, 3);
  assert.deepEqual(Object.keys(f[0]).sort(), ['line', 'rule']);
});

test('urlAllowed and cssAllowed agree with the profile on edge cases', () => {
  assert.equal(urlAllowed('  #a', 'use'), true);
  assert.equal(urlAllowed('JAVASCRIPT:x', 'a'), false);
  assert.equal(urlAllowed('https://x', 'image'), false);
  assert.equal(cssAllowed('fill: url( "#g" )'), true);
  assert.equal(cssAllowed('fill: u\\72l(https://x)'), false);
});
