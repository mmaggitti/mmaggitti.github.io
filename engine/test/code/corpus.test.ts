// engine/code over the round-trip corpus: the code panel's blocks tile the source exactly, every
// token is the slice it claims, and the P0 exit criterion holds for every token in every file:
// editing a token (scrubbing a number by +1, setting a colour, cycling a keyword, renaming a
// reference, retyping text) changes only that token's bytes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDoc, serialize, el, findAttr, type Doc } from '../../model/doc.ts';
import { escape } from '../../xml/entities.ts';
import { codeBlocks, blockFor } from '../../code/blocks.ts';
import { applyTokenEdit, scrubNumber } from '../../code/edit.ts';
import type { Token, TokenKind } from '../../code/tokens.ts';

const CORPUS = fileURLToPath(new URL('../fixtures/corpus/', import.meta.url));
const FILES = readdirSync(CORPUS, { recursive: true, encoding: 'utf8' })
  .map((p) => p.split(sep).join('/'))
  .filter((p) => p.endsWith('.svg'))
  .sort();

function load(rel: string): Doc {
  const r = parseDoc(readFileSync(CORPUS + rel, 'utf8'));
  assert.ok(r.ok, `${rel}: ${!r.ok && r.error.message}`);
  return r.doc;
}

const joined = (doc: Doc): string => codeBlocks(doc).map((b) => b.text).join('');

test('the corpus is there', () => {
  assert.equal(FILES.length, 253);
});

test('blocks tile serialize(doc), and every token is the slice it claims', () => {
  for (const rel of FILES) {
    const doc = load(rel);
    const blocks = codeBlocks(doc);
    assert.equal(blocks.map((b) => b.text).join(''), serialize(doc), `${rel}: blocks tile the source`);
    for (const b of blocks) {
      for (const bt of b.tokens) {
        const t = bt.token;
        assert.equal(b.text.slice(bt.start, bt.end), t.text, `${rel}: block slice`);
        assert.equal(bt.end - bt.start, t.end - t.start);
        const raw = 'attr' in bt.target ? findAttr(el(doc, b.node), bt.target.attr.ns, bt.target.attr.local)!.raw : (doc.nodes.get(b.node) as { raw: string }).raw;
        assert.equal(raw.slice(t.start, t.end), t.text, `${rel}: raw slice`);
        assert.ok(t.text.length > 0, `${rel}: tokens are not empty`);
        if (doc.nodes.get(b.node)!.kind !== 'cdata') assert.ok(!t.text.includes('&'), `${rel}: ${JSON.stringify(t.text)} holds no reference`);
      }
      // blockFor reads the same block on its own
      if (b.part !== 'end') assert.deepEqual(blockFor(doc, b.node), b, `${rel}: blockFor`);
    }
  }
});

test('the same holds with every node dirty (start tags rebuilt from their attributes)', () => {
  for (const rel of FILES) {
    const doc = load(rel);
    for (const n of doc.nodes.values()) {
      if (n.kind === 'element') n.tagDirty = n.childrenDirty = true;
      else n.dirty = true;
    }
    assert.equal(joined(doc), serialize(doc), rel);
  }
});

const kinds: TokenKind[] = ['number', 'color', 'enum', 'text', 'ref'];

/** What each kind of token is changed to. */
function newTextFor(t: Token): string {
  switch (t.kind) {
    case 'number':
      return scrubNumber(t, 1);
    case 'color':
      return '#123456';
    case 'enum':
      return t.options[(t.options.indexOf(t.text) + 1) % t.options.length];
    case 'ref':
      return 'draw-ref';
    case 'text':
      return 'Draw & <edit> "q" \'a\'';
  }
}

test('P0: editing any token changes only its bytes (every token of every corpus file)', (t) => {
  const edited: Record<string, number> = Object.fromEntries(kinds.map((k) => [k, 0]));
  let separated = 0;
  let clamped = 0;
  for (const rel of FILES) {
    const doc = load(rel);
    let cur = serialize(doc);
    let offset = 0; // where the current block starts in `cur`
    // Tokens are edited one after another, as a user would. Each edit is checked against the
    // document just before it; the positions of the tokens still to come move with the edits.
    for (const b of codeBlocks(doc)) {
      let blockShift = 0;
      const rawShift = new Map<string, number>();
      for (const bt of b.tokens) {
        const key = 'attr' in bt.target ? `${bt.target.attr.ns} ${bt.target.attr.local}` : '';
        const s = rawShift.get(key) ?? 0;
        const token = { ...bt.token, start: bt.token.start + s, end: bt.token.end + s } as Token;
        const text = newTextFor(token);
        if (text === token.text) clamped++;
        const node = doc.nodes.get(b.node)!;
        const quote = 'attr' in bt.target ? findAttr(el(doc, b.node), bt.target.attr.ns, bt.target.attr.local)!.quote : null;
        const rep = node.kind === 'cdata' ? text : escape(text, quote);

        const after = applyTokenEdit(doc, b.node, bt.target, token, text);
        const got = serialize(doc);
        const at = offset + bt.start + blockShift;
        const head = cur.slice(0, at);
        const tail = cur.slice(at + token.text.length);
        if (got !== head + rep + tail) {
          // a glued number ('1-2', '0.5.5') keeps apart with a space inside the replaced span
          assert.ok(token.kind === 'number', `${rel}: ${token.kind} ${JSON.stringify(token.text)} → ${JSON.stringify(text)}`);
          const options = [' ' + rep, rep + ' ', ' ' + rep + ' '].map((r) => head + r + tail);
          assert.ok(options.includes(got), `${rel}: ${JSON.stringify(token.text)} → ${JSON.stringify(text)} changed bytes outside the token`);
          separated++;
        }
        // A run whose new text holds a reference (here &amp;) now reads as several runs.
        if (token.kind === 'text' && node.kind !== 'cdata' && rep.includes('&')) assert.equal(after, null);
        else {
          assert.ok(after, `${rel}: the edited token reads back`);
          assert.equal(after.text, rep);
          assert.equal(after.kind, token.kind);
        }
        if (after?.kind === 'number' && token.kind === 'number') {
          assert.equal(after.value, Number(text));
          assert.equal(after.unit, token.unit);
        }
        const delta = got.length - cur.length;
        blockShift += delta;
        rawShift.set(key, s + delta);
        cur = got;
        edited[token.kind]++;
      }
      offset += b.text.length + blockShift;
    }
    assert.equal(offset, cur.length, `${rel}: every block accounted for`);
    assert.equal(joined(doc), cur, `${rel}: the edited document still tiles into blocks`);
  }
  const total = kinds.reduce((n, k) => n + edited[k], 0);
  t.diagnostic(`${total} tokens edited: ${kinds.map((k) => `${edited[k]} ${k}`).join(', ')}; ${separated} glued numbers kept apart by a space; ${clamped} left as they were (at a limit, or already that value)`);
  assert.ok(edited.number > 10_000 && edited.color > 500 && edited.enum > 1000 && edited.text > 100 && edited.ref > 50, 'the corpus exercises every kind');
});

test('tokenizing the whole corpus is fast', () => {
  const docs = FILES.map(load);
  const t0 = performance.now();
  let n = 0;
  for (const doc of docs) for (const b of codeBlocks(doc)) n += b.tokens.length;
  const ms = performance.now() - t0;
  assert.ok(n > 15_000);
  assert.ok(ms < 1500, `codeBlocks over the corpus took ${ms.toFixed(0)} ms`);
});
