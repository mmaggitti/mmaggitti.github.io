// Where a ChangeSet goes: the fewest canvas patches, and the code view patched or rebuilt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, type Doc, type ElementNode, type NodeId } from '../../../../engine/model/doc.ts';
import { emptyChangeSet, opRemove, opSetAttr, opSetTextRaw } from '../../../../engine/commands/ops.ts';
import { attached, route } from '../../src/routing.ts';

const SRC = '<svg xmlns="http://www.w3.org/2000/svg"><g id="a"><rect id="r"/><text id="t">hi</text></g><circle id="c"/></svg>';
const load = (): Doc => {
  const r = parseDoc(SRC);
  assert.ok(r.ok);
  return r.doc;
};
const byId = (doc: Doc, id: string): NodeId =>
  ([...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === id)) as ElementNode).id;

test('an attribute edit patches one element and re-reads its block', () => {
  const doc = load();
  const cs = emptyChangeSet();
  const op = opSetAttr(doc, byId(doc, 'r'), null, 'x', '5');
  cs.attrs.add(op.kind === 'attr' ? op.id : -1);
  assert.deepEqual(route(doc, cs), { attrs: [byId(doc, 'r')], subtrees: [], code: { reset: false, blocks: [byId(doc, 'r')] } });
});

test('a text edit re-renders its element (a <style> is always judged whole) and re-reads the leaf', () => {
  const doc = load();
  const t = byId(doc, 't');
  const leaf = (doc.nodes.get(t) as ElementNode).children[0];
  opSetTextRaw(doc, leaf, 'bye');
  const cs = emptyChangeSet();
  cs.texts.add(leaf);
  const r = route(doc, cs);
  assert.deepEqual(r.subtrees, [t]);
  assert.deepEqual(r.code, { reset: false, blocks: [leaf] });
});

test('structure: only the topmost subtrees, no attribute patch inside them, and the code rebuilt', () => {
  const doc = load();
  const g = byId(doc, 'a'), r = byId(doc, 'r'), c = byId(doc, 'c');
  const cs = emptyChangeSet();
  cs.structure.add(g).add(doc.root);
  cs.attrs.add(r).add(c);
  const out = route(doc, cs);
  assert.deepEqual(out.subtrees, [doc.root], 'the root covers the group');
  assert.deepEqual(out.attrs, [], 'the root covers every element');
  assert.deepEqual(out.code, { reset: true });

  const cs2 = emptyChangeSet();
  cs2.structure.add(g);
  cs2.attrs.add(r).add(c);
  assert.deepEqual(route(doc, cs2).attrs, [c], 'an element outside the rebuilt subtree is still patched');
});

test('a removed element is not patched by attribute: its old parent is re-rendered', () => {
  const doc = load();
  const r = byId(doc, 'r'), g = byId(doc, 'a');
  opRemove(doc, r);
  assert.equal(attached(doc, r), false);
  assert.equal(attached(doc, g), true);
  const cs = emptyChangeSet();
  cs.structure.add(g);
  cs.attrs.add(r);
  assert.deepEqual(route(doc, cs), { attrs: [], subtrees: [g], code: { reset: true } });
});
