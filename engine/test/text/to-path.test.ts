// engine/text/to-path.ts: Text to path's write. The path keeps the text's attributes in their order
// less the text-only ones, then d, then aria-label from the characters as laid out; a <title> child
// moves in instead of the label; fill-rule="nonzero" only where the path would be evenodd; the id and
// the leading whitespace kept; many texts in one transaction, and one undo giving the bytes back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, serialize, type Doc, type ElementNode } from '../../model/doc.ts';
import { Session } from '../../commands/session.ts';
import { TEXT_ONLY, textPathMarkup, writeTextToPath } from '../../text/to-path.ts';
import { outlineText } from '../../text/outline.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const texts = (doc: Doc): ElementNode[] => [...descendants(doc, doc.root)].filter((n): n is ElementNode => n.kind === 'element' && n.local === 'text');
const ctx = { faces: () => ({ weights: [400, 700], italics: [400] }) };
// The label as Text to path takes it: outline.ts's.
const label = (doc: Doc, t: ElementNode) => {
  const r = outlineText(doc, t.id, ctx);
  assert.ok(!('refused' in r), 'refused' in r ? r.refused : '');
  return r.label;
};
const D = 'M 0 0 L 1 0 L 1 1 Z';

test('the path keeps the text’s attributes in their order, their spelling kept, less the text-only ones (x, y, the fonts, the anchor, xml:space…); then d, then aria-label', () => {
  const doc = load(svg(`<text id="t" x="1" y="2" class="c" font-family="Inter" fill = '#264653' font-size="10" transform="rotate(5)" text-anchor="middle" style="font-weight:700;opacity:.5" xml:space="preserve" letter-spacing="0" data-k="v" dy="0em">Hi</text>`));
  const t = texts(doc)[0];
  assert.equal(textPathMarkup(doc, t.id, D, label(doc, t)), `<path id="t" class="c" fill = '#264653' transform="rotate(5)" style="font-weight:700;opacity:.5" data-k="v" d="${D}" aria-label="Hi"/>`);
  for (const a of ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'font-family', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style', 'font-variant', 'font-weight', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'letter-spacing', 'word-spacing', 'writing-mode', 'direction', 'unicode-bidi', 'text-rendering', 'text-decoration']) assert.ok(TEXT_ONLY.has(a), a);
  assert.ok(!TEXT_ONLY.has('fill') && !TEXT_ONLY.has('transform') && !TEXT_ONLY.has('id'));
});

test('the aria-label is the characters as laid out, the lines joined by one space, escaped: A&amp;V  To keeps its two spaces', () => {
  const doc = load(svg('<text x="1" y="9" font-family="Inter" font-size="10" xml:space="preserve">A&amp;V  To "q"</text><text x="50" y="55" font-family="Inter" font-size="14"><tspan x="50" dy="0em">Big</tspan><tspan x="50" dy="1.3em">Idea</tspan></text>'));
  const [a, b] = texts(doc);
  assert.match(textPathMarkup(doc, a.id, D, label(doc, a)), / aria-label="A&amp;V  To &quot;q&quot;"\/>$/);
  assert.match(textPathMarkup(doc, b.id, D, label(doc, b)), / aria-label="Big Idea"\/>$/);
});

test('a text with its own <title> moves the <title> (and its <desc>) into the path instead of an aria-label', () => {
  const doc = load(svg('<text id="w" x="1" y="9" font-family="Inter" font-size="10"><title>Acme</title><desc>The wordmark</desc>Acme</text>'));
  const t = texts(doc)[0];
  assert.equal(textPathMarkup(doc, t.id, D, label(doc, t)), `<path id="w" d="${D}"><title>Acme</title><desc>The wordmark</desc></path>`);
  const only = load(svg('<text x="1" y="9" font-family="Inter" font-size="10"><desc>d</desc>Hi</text>'));
  assert.equal(textPathMarkup(only, texts(only)[0].id, D, 'Hi'), `<path d="${D}" aria-label="Hi"><desc>d</desc></path>`, 'a <desc> alone: the label too');
});

test('fill-rule="nonzero" only where the path would be evenodd: added under an inherited evenodd, the text’s own evenodd attribute rewritten in place, nothing otherwise', () => {
  const doc = load(svg('<g fill-rule="evenodd"><text x="1" font-family="Inter">a</text><text x="1" font-family="Inter" fill-rule="nonzero">b</text></g><text x="1" font-family="Inter" fill-rule="evenodd" fill="red">c</text><text x="1" font-family="Inter">d</text>'));
  const [a, b, c, d] = texts(doc).map((t) => textPathMarkup(doc, t.id, D, 'x'));
  assert.equal(a, `<path fill-rule="nonzero" d="${D}" aria-label="x"/>`);
  assert.equal(b, `<path fill-rule="nonzero" d="${D}" aria-label="x"/>`, 'its own nonzero, kept');
  assert.equal(c, `<path fill-rule="nonzero" fill="red" d="${D}" aria-label="x"/>`, 'rewritten in place');
  assert.equal(d, `<path d="${D}" aria-label="x"/>`);
});

test('writeTextToPath: each text’s path in its place (its id and leading whitespace kept, the root’s prefix), texts in two parents in one transaction; one undo gives the bytes back', () => {
  const src = `<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <s:text id="a" x="1" y="9" font-family="Inter">A</s:text>\n  <s:g>\n    <s:text id="b" x="1" y="19" font-family="Inter">B</s:text>\n    <s:rect width="1" height="1"/>\n    <s:text id="c" x="1" y="29" font-family="Inter">C</s:text>\n  </s:g>\n</s:svg>`;
  const doc = load(src);
  const ts = texts(doc);
  const s = new Session(doc);
  let made: number[] = [];
  s.dispatch('Text to path', (apply) => {
    made = writeTextToPath(doc, ts.map((t, i) => ({ id: t.id, markup: textPathMarkup(doc, t.id, `M ${i} 0 Z`, label(doc, t)) })), apply);
  });
  assert.equal(serialize(doc), `<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <s:path id="a" d="M 0 0 Z" aria-label="A"/>\n  <s:g>\n    <s:path id="b" d="M 1 0 Z" aria-label="B"/>\n    <s:rect width="1" height="1"/>\n    <s:path id="c" d="M 2 0 Z" aria-label="C"/>\n  </s:g>\n</s:svg>`);
  assert.deepEqual(made.map((id) => (doc.nodes.get(id) as ElementNode).attrs[0].raw), ['a', 'b', 'c'], 'the paths, in the order given');
  s.undo();
  assert.equal(serialize(doc), src, 'one undo gives the bytes back');
  s.redo();
  assert.equal(texts(doc).length, 0);
});
