// Where a ChangeSet goes: the fewest canvas patches, and the code view patched, placed or rebuilt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, type Doc, type ElementNode, type NodeId } from '../../../../engine/model/doc.ts';
import { emptyChangeSet, noteChange, opInsert, opRemove, opSetAttr, opSetTextRaw, type Op } from '../../../../engine/commands/ops.ts';
import { attached, route } from '../../src/routing.ts';

const SRC = '<svg xmlns="http://www.w3.org/2000/svg"><g id="a"><rect id="r"/><text id="t">hi</text></g><circle id="c"/><style id="s">rect { fill: red }</style></svg>';
const load = (): Doc => {
  const r = parseDoc(SRC);
  assert.ok(r.ok);
  return r.doc;
};
const byId = (doc: Doc, id: string): NodeId =>
  ([...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === id)) as ElementNode).id;
const kids = (doc: Doc, id: NodeId) => (doc.nodes.get(id) as ElementNode).children;
const changes = (ops: Op[]) => {
  const cs = emptyChangeSet();
  for (const op of ops) noteChange(cs, op);
  return cs;
};

test('an attribute edit patches one element and re-reads its block', () => {
  const doc = load();
  const cs = emptyChangeSet();
  const op = opSetAttr(doc, byId(doc, 'r'), null, 'x', '5');
  cs.attrs.add(op.kind === 'attr' ? op.id : -1);
  assert.deepEqual(route(doc, cs), { attrs: [byId(doc, 'r')], subtrees: [], moved: [], code: { reset: false, blocks: [byId(doc, 'r')], moved: [], parents: [] } });
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
  assert.deepEqual(r.moved, []);
  assert.deepEqual(r.code, { reset: false, blocks: [leaf], moved: [], parents: [] });
});

test('structure: a moved, inserted or removed node is patched alone, on the canvas and in the code', () => {
  // NodeIds are fresh in every parse: each case loads its own document and reads its own ids.
  const fresh = () => {
    const doc = load();
    return { doc, g: byId(doc, 'a'), r: byId(doc, 'r'), t: byId(doc, 't'), c: byId(doc, 'c'), s: byId(doc, 's') };
  };
  // Moved within its parent (Forward): the node alone; its parent is not drawn again, and its
  // parent's tags are read again in the code.
  {
    const { doc, g, r } = fresh();
    const out = route(doc, changes([opRemove(doc, r), opInsert(doc, r, g, 1)]));
    assert.deepEqual(out.subtrees, [], 'no parent drawn again');
    assert.deepEqual(out.moved, [r]);
    assert.deepEqual(out.code, { reset: false, blocks: [], moved: [r], parents: [g] });
  }
  // To another parent, with an attribute edit on the way: placed alone, not patched by attribute
  // (it is drawn anew); an element elsewhere is still patched.
  {
    const { doc, g, r, c } = fresh();
    const cs = changes([opRemove(doc, r), opInsert(doc, r, doc.root, kids(doc, doc.root).indexOf(c) + 1)]);
    opSetAttr(doc, r, null, 'x', '5');
    opSetAttr(doc, c, null, 'r', '2');
    cs.attrs.add(r).add(c);
    const out = route(doc, cs);
    assert.deepEqual(out.moved, [r]);
    assert.deepEqual(out.attrs, [c], 'only the element that did not move');
    assert.deepEqual(out.code, { reset: false, blocks: [c], moved: [r], parents: [g, doc.root] });
  }
  // Several: the removed ones first (they have no place), then the rest last to first in document
  // order, so each lands before a sibling already in its place.
  {
    const { doc, g, r, t, c } = fresh();
    const out = route(doc, changes([opRemove(doc, c), opRemove(doc, r), opInsert(doc, r, g, 1), opRemove(doc, t), opInsert(doc, t, g, 0)]));
    assert.deepEqual(out.moved, [c, r, t]);
    assert.deepEqual(out.subtrees, []);
  }
  // A node inside another moved node comes with it.
  {
    const { doc, g, r } = fresh();
    const out = route(doc, changes([opRemove(doc, r), opInsert(doc, r, g, 1), opRemove(doc, g), opInsert(doc, g, doc.root, 1)]));
    assert.deepEqual(out.moved, [g]);
    assert.deepEqual(out.code.reset ? null : out.code.moved, [g]);
  }
  // A leaf moved alone (whitespace carried by Forward, or text).
  {
    const { doc, g, t } = fresh();
    const leaf = kids(doc, t)[0];
    const out = route(doc, changes([opRemove(doc, leaf), opInsert(doc, leaf, g, 0)]));
    assert.deepEqual([out.moved, out.subtrees], [[leaf], []]);
  }
  // Inside a subtree already being drawn again (a text edit's element): it comes with it.
  {
    const { doc, t } = fresh();
    const leaf = kids(doc, t)[0];
    const cs = changes([opRemove(doc, leaf), opInsert(doc, leaf, t, 0)]);
    opSetTextRaw(doc, leaf, 'bye');
    cs.texts.add(leaf);
    const out = route(doc, cs);
    assert.deepEqual([out.subtrees, out.moved], [[t], []]);
  }
  // In or out of a <style>: the <style> is judged whole, so it is drawn again and the code rebuilt.
  {
    const { doc, g, s } = fresh();
    const css = kids(doc, s)[0];
    const out = route(doc, changes([opRemove(doc, css), opInsert(doc, css, g, 0)]));
    assert.deepEqual(out.subtrees, [s]);
    assert.deepEqual(out.code, { reset: true });
  }
  {
    const { doc, s } = fresh();
    const out = route(doc, changes([opRemove(doc, kids(doc, s)[0])]));
    assert.deepEqual([out.subtrees, out.code], [[s], { reset: true }], 'a leaf that left a <style>');
  }
});

test('a removed element is not patched by attribute: it is taken away alone', () => {
  const doc = load();
  const r = byId(doc, 'r'), g = byId(doc, 'a');
  const cs = changes([opRemove(doc, r)]);
  assert.equal(attached(doc, r), false);
  assert.equal(attached(doc, g), true);
  cs.attrs.add(r);
  assert.deepEqual(route(doc, cs), { attrs: [], subtrees: [], moved: [r], code: { reset: false, blocks: [], moved: [r], parents: [g] } });
});
