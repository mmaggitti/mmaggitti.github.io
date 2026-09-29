// engine/code/edit: token edits rewrite one token's characters, check the new text against the
// token's kind, keep glued numbers apart inside the token's own span, and scrub numbers at their
// own precision.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc, serialize, descendants, findAttr, detachNode, attachNode, setLeafRaw, type Doc, type ElementNode, type LeafNode } from '../../model/doc.ts';
import { tokenizeAttr, tokenizeText, type NumberToken, type Token } from '../../code/tokens.ts';
import { applyTokenEdit, scrubNumber, tokenEdit, tokenTextError, TokenEditError, type TokenTarget } from '../../code/edit.ts';
import { blockFor, codeBlocks } from '../../code/blocks.ts';

const SVG = 'xmlns="http://www.w3.org/2000/svg"';

function load(body: string): Doc {
  const r = parseDoc(`<svg ${SVG}>${body}</svg>`);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
}

const first = (doc: Doc, local: string): ElementNode => [...descendants(doc, doc.root)].find((n): n is ElementNode => n.kind === 'element' && n.local === local)!;
const on = (local: string): TokenTarget => ({ attr: { ns: null, local } });
const toks = (doc: Doc, el: string, name: string): Token[] => tokenizeAttr(doc, first(doc, el).id, { ns: null, local: name });

/** Edit the i-th token of an attribute of the first <el>, and return the attribute's raw text. */
function edit(doc: Doc, el: string, name: string, i: number, text: string): string {
  applyTokenEdit(doc, first(doc, el).id, on(name), toks(doc, el, name)[i], text);
  return findAttr(first(doc, el), null, name)!.raw;
}

const num = (text: string, extra: Partial<NumberToken> = {}): NumberToken => {
  const doc = load(`<rect x="${text}"/>`);
  return { ...(toks(doc, 'rect', 'x')[0] as NumberToken), ...extra };
};

test('scrubNumber keeps the precision as written, and goes finer only for a finer step or delta', () => {
  assert.equal(scrubNumber(num('1.25'), 1), '2.25');
  assert.equal(scrubNumber(num('10'), -1), '9');
  assert.equal(scrubNumber(num('0.10'), 0.25), '0.35');
  assert.equal(scrubNumber(num('1'), 0.05), '1.05');
  assert.equal(scrubNumber(num('3'), 3 * 0.1), '3.3', 'float residue from the delta is rounded away');
  assert.equal(scrubNumber(num('1', { step: 0.01, min: 0, max: 1 }), -0.01), '0.99');
  assert.equal(scrubNumber(num('1.5e-3'), 0.001), '0.0025');
  assert.equal(scrubNumber(num('1e-7'), 1), '1.0000001', 'no exponent notation');
  assert.equal(scrubNumber(num('1e21'), 1), '1000000000000000000000');
  assert.equal(scrubNumber(num('0.5'), -0.5), '0', 'never -0');
  assert.equal(scrubNumber(num('-0.25'), 0.25), '0');
});

test('scrubNumber clamps to the token’s limits', () => {
  const doc = load('<rect opacity="0.9" r="0.5" stroke-miterlimit="1.5"/>');
  const [op] = toks(doc, 'rect', 'opacity') as NumberToken[];
  assert.equal(scrubNumber(op, 1), '1');
  assert.equal(scrubNumber(op, -5), '0');
  const [r] = toks(doc, 'rect', 'r') as NumberToken[];
  assert.equal(scrubNumber(r, -2), '0');
  const [ml] = toks(doc, 'rect', 'stroke-miterlimit') as NumberToken[];
  assert.equal(scrubNumber(ml, -1), '1');
  assert.throws(() => scrubNumber(op, Number.NaN), RangeError);
});

test('an edit replaces only the token, and keeps glued numbers apart inside its own span', () => {
  assert.equal(edit(load('<path d="M1-2"/>'), 'path', 'd', 1, '3'), 'M1 3');
  assert.equal(edit(load('<path d="M1-2"/>'), 'path', 'd', 1, '-3'), 'M1-3', 'a sign still separates: no space');
  assert.equal(edit(load('<path d="M0.5.5 1 2"/>'), 'path', 'd', 0, '1'), 'M1 .5 1 2');
  assert.equal(edit(load('<path d="M0.5.5 1 2"/>'), 'path', 'd', 1, '2'), 'M0.5 2 1 2');
  assert.equal(edit(load('<path d="M0 0a1 1 0 0110 10"/>'), 'path', 'd', 6, '0'), 'M0 0a1 1 0 0010 10', 'a flag is one character');
  assert.equal(edit(load('<path d="M0 0a1 1 0 0110 10"/>'), 'path', 'd', 7, '5'), 'M0 0a1 1 0 015 10', 'packed flags need no space');
  assert.equal(edit(load('<path d="M0 0a1 1 0 0110 10"/>'), 'path', 'd', 8, '5'), 'M0 0a1 1 0 0110 5');
  assert.equal(edit(load('<path d="M0 1e2E-1"/>'), 'path', 'd', 1, '7'), 'M0 7 E-1', 'the error tail would read as an exponent');
  assert.equal(edit(load('<rect x="10px-5 3"/>'), 'rect', 'x', 1, '6'), '10px 6 3');
  assert.equal(edit(load('<rect x="1-2"/>'), 'rect', 'x', 1, '4'), '1 4');
  assert.equal(edit(load('<g transform="translate(1-2)"/>'), 'g', 'transform', 1, '2'), 'translate(1 2)');
  assert.equal(edit(load('<rect style="stroke-width:2px;fill:red"/>'), 'rect', 'style', 0, '12.5'), 'stroke-width:12.5px;fill:red');
});

test('the edited token reads back, and a token index survives the edit', () => {
  const doc = load('<path d="M1-2-3-4"/>');
  const node = first(doc, 'path');
  const before = toks(doc, 'path', 'd');
  const after = applyTokenEdit(doc, node.id, on('d'), before[1], '5');
  assert.equal(findAttr(node, null, 'd')!.raw, 'M1 5-3-4');
  assert.ok(after && after.kind === 'number' && after.value === 5 && after.start === 3);
  const now = toks(doc, 'path', 'd');
  assert.equal(now.length, before.length);
  assert.deepEqual(now[1], after);
  // scrub again from the token the edit returned (the memo path)
  const again = applyTokenEdit(doc, node.id, on('d'), after, scrubNumber(after as NumberToken, -10));
  assert.equal(findAttr(node, null, 'd')!.raw, 'M1 -5-3-4', 'the space is outside the token now, and stays');
  assert.ok(again && again.text === '-5' && again.start === 3);
});

test('tokenEdit returns the new raw text and leaves the document alone', () => {
  const doc = load('<rect x="1" fill="red"/>');
  const v = doc.version;
  const out = tokenEdit(doc, first(doc, 'rect').id, on('fill'), toks(doc, 'rect', 'fill')[0], '#123456');
  assert.equal(out, '#123456');
  assert.equal(doc.version, v);
  assert.equal(findAttr(first(doc, 'rect'), null, 'fill')!.raw, 'red');
});

test('validation: each kind takes only its own kind of text', () => {
  const doc = load(
    '<rect x="1" opacity="0.5" r="2" fill="red" stop-color="blue" stroke-linecap="round" aria-label="hi"/><use href="#a"/><stop stop-color="red"/>',
  );
  const [x] = toks(doc, 'rect', 'x');
  for (const bad of ['abc', '#fff', '1e5', '+1', '5.', '', ' 5', '1 2', 'NaN', 'Infinity']) assert.ok(tokenTextError(x, bad), `number: ${bad}`);
  for (const good of ['0', '-3', '12.5', '.5', '-.5', '007']) assert.equal(tokenTextError(x, good), null, `number: ${good}`);
  const [op] = toks(doc, 'rect', 'opacity');
  assert.match(tokenTextError(op, '2')!, /maximum/);
  const [r] = toks(doc, 'rect', 'r');
  assert.match(tokenTextError(r, '-1')!, /minimum/);

  const [fill] = toks(doc, 'rect', 'fill');
  for (const bad of ['12', 'notacolor', ' red', '', 'url(#a)', 'inherit']) assert.ok(tokenTextError(fill, bad), `colour: ${bad}`);
  for (const good of ['none', 'NONE', 'context-fill', '#abc', 'rgb(1 2 3 / 50%)', 'currentColor', 'rebeccapurple']) assert.equal(tokenTextError(fill, good), null, `paint: ${good}`);
  const [stop] = toks(doc, 'stop', 'stop-color');
  assert.ok(tokenTextError(stop, 'none'), "stop-color doesn't take none");

  const [cap] = toks(doc, 'rect', 'stroke-linecap');
  assert.ok(tokenTextError(cap, 'Round'));
  assert.ok(tokenTextError(cap, 'miter'));
  assert.equal(tokenTextError(cap, 'square'), null);

  const [ref] = toks(doc, 'use', 'href');
  for (const bad of ['a b', '#x', '', 'x)y', 'a"b', '1abc']) assert.ok(tokenTextError(ref, bad), `ref: ${bad}`);
  assert.equal(tokenTextError(ref, 'grad-2_b.c'), null);

  // and the edit functions refuse it, clearly, before touching anything
  const node = first(doc, 'rect');
  const v = doc.version;
  assert.throws(() => applyTokenEdit(doc, node.id, on('x'), x, 'abc'), (e) => e instanceof TokenEditError && /not a number/.test(e.message));
  assert.throws(() => tokenEdit(doc, node.id, on('fill'), fill, '12'), TokenEditError);
  assert.throws(() => tokenEdit(doc, node.id, on('stroke-linecap'), cap, 'x'), /not one of butt, round, square/);
  assert.equal(doc.version, v);
  assert.equal(serialize(doc).includes('abc'), false);
});

test('no token takes a character XML 1.0 cannot hold, and the refusal names it', () => {
  const doc = load(`<rect x="1" fill="red" aria-label="hi"/><text>Hello</text>`);
  const text = [...doc.nodes.values()].find((n): n is LeafNode => n.kind === 'text' && n.raw === 'Hello')!;
  const [run] = tokenizeText(doc, text.id);
  const [label] = toks(doc, 'rect', 'aria-label');
  for (const [bad, code] of [['Dr\u0001aw', '0001'], ['Dr\u000Baw', '000B'], ['Dr\uFFFEaw', 'FFFE'], ['Dr\uFFFFaw', 'FFFF'], ['Dr\uD800aw', 'D800'], ['\u0000', '0000']]) {
    assert.equal(tokenTextError(run, bad), `XML can't hold the character U+${code}`, JSON.stringify(bad));
    assert.ok(tokenTextError(label, bad), JSON.stringify(bad));
    assert.throws(() => applyTokenEdit(doc, text.id, { text: true }, run, bad), TokenEditError);
  }
  for (const good of ['tab\there', 'Dr😀aw', '\uE000\uFFFD', 'ünïcødé']) assert.equal(tokenTextError(run, good), null, JSON.stringify(good));
  assert.ok(tokenTextError(toks(doc, 'rect', 'x')[0], '1\u0001'), 'numbers too');
  assert.equal(text.raw, 'Hello', 'nothing was written');
});

test('text is escaped for where it lands: &, < and the attribute’s own quote', () => {
  const doc = load(`<rect aria-label='hi there'/><text>Hello</text><text><![CDATA[raw]]></text>`);
  const rect = first(doc, 'rect');
  const [hi] = toks(doc, 'rect', 'aria-label');
  applyTokenEdit(doc, rect.id, on('aria-label'), hi, `it's <b> & "q"`);
  assert.equal(findAttr(rect, null, 'aria-label')!.raw, `it&apos;s &lt;b> &amp; "q"`);

  const leaves = [...doc.nodes.values()].filter((n): n is LeafNode => n.kind === 'text' || n.kind === 'cdata');
  const text = leaves.find((n) => n.raw === 'Hello')!;
  applyTokenEdit(doc, text.id, { text: true }, tokenizeText(doc, text.id)[0], `a <b> & "c" ]]>`);
  assert.equal(text.raw, `a &lt;b> &amp; "c" ]]&gt;`);

  const cdata = leaves.find((n) => n.kind === 'cdata')!;
  const [raw] = tokenizeText(doc, cdata.id);
  assert.throws(() => tokenEdit(doc, cdata.id, { text: true }, raw, 'x ]]> y'), /CDATA/);
  const back = applyTokenEdit(doc, cdata.id, { text: true }, raw, 'a < b & c');
  assert.equal(cdata.raw, '<![CDATA[a < b & c]]>', 'CDATA text is written as is');
  assert.equal(back?.text, 'a < b & c');
  assert.equal(serialize(doc).match(/<text>.*?<\/text>/g)!.join(''), `<text>a &lt;b> &amp; "c" ]]&gt;</text><text><![CDATA[a < b & c]]></text>`);
});

test('CSS in a CDATA <style> is editable, and only its token changes', () => {
  const src = `<svg ${SVG}><style><![CDATA[.a{fill:#E63946;stroke-width:2}]]></style></svg>`;
  const r = parseDoc(src);
  assert.ok(r.ok);
  const doc = r.doc;
  const cdata = [...doc.nodes.values()].find((n) => n.kind === 'cdata')!;
  const [fill, width] = tokenizeText(doc, cdata.id);
  applyTokenEdit(doc, cdata.id, { text: true }, fill, '#123456');
  const w = tokenizeText(doc, cdata.id)[1] as NumberToken;
  assert.deepEqual([w.text, w.start], [width.text, width.start]);
  applyTokenEdit(doc, cdata.id, { text: true }, w, scrubNumber(w, 1));
  assert.equal(serialize(doc), src.replace('#E63946', '#123456').replace('width:2', 'width:3'));
  assert.throws(() => setLeafRaw(doc, cdata.id, '<![CDATA[a]]>b]]>'), /one CDATA section/);
  assert.throws(() => setLeafRaw(doc, doc.root, '<![CDATA[a]]>'), /not text or CDATA/);
});

test('a stale token, a missing attribute or a wrong target is refused', () => {
  const doc = load('<rect x="1 2" y="3"/>');
  const node = first(doc, 'rect');
  const [a, b] = toks(doc, 'rect', 'x');
  applyTokenEdit(doc, node.id, on('x'), a, '100');
  assert.throws(() => tokenEdit(doc, node.id, on('x'), b, '5'), /stale/);
  assert.throws(() => tokenEdit(doc, node.id, on('width'), a, '5'), /no width attribute/);
  assert.throws(() => tokenEdit(doc, node.id, { text: true }, a, '5'), /not a text or CDATA leaf/);
  // a token taken from another attribute whose text happens to match is not this attribute's token
  const [y] = toks(doc, 'rect', 'y');
  assert.throws(() => tokenEdit(doc, node.id, on('x'), { ...y, start: 0, end: 1, text: '1' }, '5'), /stale/);
});

// ── blocks ───────────────────────────────────────────────────────────────────────────────────────

test('blocks: start tag, leaves and end tag in order, tokens at block offsets', () => {
  const src = `<?xml version="1.0"?>\n<svg ${SVG} viewBox="0 0 10 10"><!-- c --><rect x="1" fill="red"/><text>Hi</text></svg>\n`;
  const r = parseDoc(src);
  assert.ok(r.ok);
  const doc = r.doc;
  const blocks = codeBlocks(doc);
  assert.deepEqual(
    blocks.map((b) => [b.part, b.text]),
    [
      ['leaf', '<?xml version="1.0"?>'],
      ['leaf', '\n'],
      ['start', `<svg ${SVG} viewBox="0 0 10 10">`],
      ['leaf', '<!-- c -->'],
      ['start', '<rect x="1" fill="red"/>'],
      ['start', '<text>'],
      ['leaf', 'Hi'],
      ['end', '</text>'],
      ['end', '</svg>'],
      ['leaf', '\n'],
    ],
  );
  const rect = blocks[4];
  assert.deepEqual(
    rect.tokens.map((t) => [rect.text.slice(t.start, t.end), t.token.start, t.target]),
    [
      ['1', 0, { attr: { ns: null, local: 'x' } }],
      ['red', 0, { attr: { ns: null, local: 'fill' } }],
    ],
  );
  assert.deepEqual(blocks[6].tokens.map((t) => [t.start, t.target]), [[0, { text: true }]]);

  // an edit changes one block; blockFor reads it again
  applyTokenEdit(doc, rect.node, on('x'), rect.tokens[0].token, '12.5');
  const again = codeBlocks(doc);
  assert.equal(again.map((b) => b.text).join(''), serialize(doc));
  again.forEach((b, i) => {
    if (i !== 4) assert.equal(b.text, blocks[i].text);
  });
  assert.equal(again[4].text, '<rect x="12.5" fill="red"/>');
  assert.deepEqual(blockFor(doc, rect.node), again[4]);
  assert.equal(again[4].tokens[1].start, 21);
});

test('blocks follow serialize through structural edits and duplicate attributes', () => {
  const r = parseDoc(`<svg ${SVG}><g/><rect x="1" y="2"/><circle r="3"></circle></svg>`);
  assert.ok(r.ok);
  const doc = r.doc;
  const [g, rect, circle] = (doc.nodes.get(doc.root) as ElementNode).children;
  // The parser refuses an attribute written twice, as a browser does, so this one is made by hand:
  // <rect x="1" x="2"/>. Only the first is ever the target of an edit, so only it has tokens.
  const tag = doc.nodes.get(rect) as ElementNode;
  tag.attrs[1] = { ...tag.attrs[1], qname: 'x', local: 'x' };
  tag.tagDirty = true;
  assert.ok(serialize(doc).includes('<rect x="1" x="2"/>'));
  assert.deepEqual(
    blockFor(doc, rect).tokens.map((t) => t.start),
    [9],
  );
  // move the circle into the self-closed <g>: <g/> must open and close around it
  detachNode(doc, circle);
  attachNode(doc, circle, g, 0);
  const blocks = codeBlocks(doc);
  assert.equal(blocks.map((b) => b.text).join(''), serialize(doc));
  assert.ok(serialize(doc).includes('<g><circle r="3"></circle></g>'));
  assert.equal(blocks.filter((b) => b.node === g).map((b) => b.text).join('|'), '<g>|</g>');
  // and back: an emptied element keeps the form it was written in
  detachNode(doc, circle);
  attachNode(doc, circle, doc.root, 2);
  assert.equal(codeBlocks(doc).map((b) => b.text).join(''), serialize(doc));
  assert.ok(serialize(doc).startsWith(`<svg ${SVG}><g/>`));
});
