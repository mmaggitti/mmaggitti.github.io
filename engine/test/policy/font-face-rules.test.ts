// engine/policy/font-face-rules.ts: the canvas's copy of a <style> declares no face of the document's.
// Every @font-face rule goes, at any depth and in any case, and nothing else changes; an "@font-face"
// in a comment or a string stays; a <style> it can't settle is refused whole (null).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { descendants, parseDoc, textContent } from '../../model/doc.ts';
import { canvasStyleTexts, withoutFontFaces } from '../../policy/font-face-rules.ts';

const FACE = '@font-face{font-family:Own;src:url(data:font/woff2;base64,d09GMgABAAAAA) format("woff2")}';

test('a face rule goes, and only it: at the top, nested in @media, @supports and @layer, in any case, several of them; the other rules and at-rules stay byte for byte', () => {
  assert.equal(withoutFontFaces(`${FACE}text{font-family:Own}`), 'text{font-family:Own}');
  assert.equal(withoutFontFaces(`rect{fill:red}\n${FACE}\ncircle{fill:blue}`), 'rect{fill:red}\n\ncircle{fill:blue}');
  assert.equal(withoutFontFaces(`@media (min-width: 1px) {\n  ${FACE}\n  rect { fill: red }\n}`), '@media (min-width: 1px) {\n  \n  rect { fill: red }\n}');
  assert.equal(withoutFontFaces(`@supports (display: grid) { @media print { ${FACE} } }@layer base { ${FACE} }`), '@supports (display: grid) { @media print {  } }@layer base {  }');
  assert.equal(withoutFontFaces('@FONT-FACE{font-family:A;src:url(x)}@Font-Face {font-family:B;src:url(y)}a{}'), 'a{}');
  assert.equal(withoutFontFaces(`${FACE}${FACE};${FACE} rect{fill:red}`), '; rect{fill:red}');
  const others = '@charset "utf-8";\n@namespace svg url(http://www.w3.org/2000/svg);\n@layer a, b;\n@keyframes spin { from { transform: rotate(0) } to { transform: rotate(1turn) } }\n@media screen { .k { fill: url(#g) } }\nsvg|rect:hover { stroke: red; }\n';
  assert.equal(withoutFontFaces(others), others);
  assert.equal(withoutFontFaces(`${others}${FACE}`), others);
  assert.equal(withoutFontFaces('rect{fill:red}'), 'rect{fill:red}');
});

test('an "@font-face" in a comment or a string stays, and so does a url() that holds one; a face rule whose url() or string holds braces or quotes goes whole', () => {
  for (const css of [
    '/* @font-face{font-family:A;src:url(x)} */rect{fill:red}',
    'text{font-family:"@font-face{font-family:A}"}',
    "text{font-family:'@font-face{a:b}'}",
    'rect{fill:url(#@font-face{a:b})}',
    'x{y:"a\\41\n@font-face{a:b}"}', // a hex escape takes the newline after it: still the string
    '/* unclosed @font-face{a:b}',
  ]) assert.equal(withoutFontFaces(css), css, css);
  assert.equal(withoutFontFaces('@font-face{font-family:"A}";src:url(a}b)}rect{fill:red}'), 'rect{fill:red}');
  assert.equal(withoutFontFaces("@font-face{src:local('}'),url(x)} rect{fill:red}"), ' rect{fill:red}');
  assert.equal(withoutFontFaces('@font-face{src:url( "x}" )}rect{fill:red}'), 'rect{fill:red}');
  assert.equal(withoutFontFaces('@font-face{a:"b\nc}d{e"}f}g{}'), 'd{e"}f}g{}', 'a newline ends a string, so the block ends at the } after it');
  assert.equal(withoutFontFaces('@font-face /* a comment */ {font-family:A;src:url(x)}rect{fill:red}'), 'rect{fill:red}');
});

test('a face rule whose block isn’t closed goes to the end of the text', () => {
  assert.equal(withoutFontFaces('rect{fill:red}@font-face{font-family:A;src:url(x)'), 'rect{fill:red}');
  assert.equal(withoutFontFaces('rect{fill:red}@font-face{font-family:A;src:url(x'), 'rect{fill:red}');
  assert.equal(withoutFontFaces('@media screen{rect{fill:red}@font-face{a:b}'), '@media screen{rect{fill:red}');
  assert.equal(withoutFontFaces('rect{fill:red}@font-face'), 'rect{fill:red}');
});

test('what can’t be settled is refused (null): a backslash in any at-keyword, a face rule where no rule starts, one not followed by its block', () => {
  for (const css of [
    '@font-fac\\65{font-family:A;src:url(x)}', '@\\66ont-face{a:b}', '@FONT-FACE\\ {a:b}', '@me\\64ia screen{}', 'rect{}@x\\y;',
    'rect{fill:red@font-face{a:b}}', 'a b @font-face{a:b}', '@media (@font-face{a:b}){}', '<!--@font-face{a:b}-->',
    '@font-face;rect{}', '@font-face x{a:b}', '@font-face("x"){a:b}',
  ]) assert.equal(withoutFontFaces(css), null, css);
});

test('a <style> split over leaves: whitespace leaves stay round the one that isn’t (CorelDRAW’s and Illustrator’s CDATA), each leaf stays when none holds a face rule, and a face rule over two leaves that aren’t whitespace is refused', () => {
  assert.deepEqual(canvasStyleTexts(['\n', `\n${FACE}\n.st0{fill:red}\n`, '\n']), ['\n', '\n\n.st0{fill:red}\n', '\n']);
  assert.deepEqual(canvasStyleTexts([FACE]), ['']);
  assert.deepEqual(canvasStyleTexts(['rect{fill:', 'red}']), ['rect{fill:', 'red}']);
  assert.deepEqual(canvasStyleTexts(['/* @font-face', ' */ rect{}']), ['/* @font-face', ' */ rect{}']);
  assert.deepEqual(canvasStyleTexts([' ', '\t']), [' ', '\t']);
  assert.deepEqual(canvasStyleTexts([]), []);
  for (const leaves of [['@font-', 'face{a:b}'], ['rect{}', FACE], [FACE, ' '], ['@font-fac\\65', '{a:b}'], ['@me\\64ia', ' x{}']]) {
    assert.equal(canvasStyleTexts(leaves), null, JSON.stringify(leaves));
  }
  assert.equal(canvasStyleTexts(['\n', '@font-fac\\65{a:b}', '\n']), null);
});

test('every corpus <style> is drawn as written (none declares a face), and with a face added to its text only the face goes', () => {
  const corpus = fileURLToPath(new URL('../fixtures/corpus/', import.meta.url));
  let styles = 0;
  for (const rel of readdirSync(corpus, { recursive: true, encoding: 'utf8' }).filter((p) => p.endsWith('.svg'))) {
    const r = parseDoc(readFileSync(corpus + rel.split(sep).join('/'), 'utf8'));
    assert.ok(r.ok, rel);
    for (const n of descendants(r.doc, r.doc.root)) {
      if (n.kind !== 'element' || n.local !== 'style') continue;
      styles++;
      const leaves = n.children.flatMap((id): string[] => {
        const c = r.doc.nodes.get(id)!;
        return c.kind === 'text' || c.kind === 'cdata' ? [textContent(r.doc, id)] : [];
      });
      assert.deepEqual(canvasStyleTexts(leaves), leaves, rel);
      const solid = leaves.findIndex((t) => /[^ \t\n\r\f]/.test(t));
      if (solid < 0 || leaves.filter((t) => /[^ \t\n\r\f]/.test(t)).length > 1) continue;
      const added = leaves.map((t, i) => (i === solid ? `${FACE}\n${t}` : t));
      assert.deepEqual(canvasStyleTexts(added), leaves.map((t, i) => (i === solid ? `\n${t}` : t)), rel);
    }
  }
  assert.ok(styles >= 10, `only ${styles} <style> elements`);
});
