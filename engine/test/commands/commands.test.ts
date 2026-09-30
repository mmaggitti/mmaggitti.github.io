// engine/commands: reversible ops, transactions, history and drags. The P0 exit property: 10k seeded
// random edit sequences, with undo and redo mixed in, always restore byte-identical source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseDoc, serialize, descendants, el, type Doc, type ElementNode, type NodeId } from '../../model/doc.ts';
import { opInsert, opRemove, opSetAttr, opSetAttrRaw, opSetLeafRaw, opSetTextRaw, coalesce, type ChangeSet, type Op } from '../../commands/ops.ts';
import { Session } from '../../commands/session.ts';
import { mulberry32 } from '../values/rng.ts';

const SRC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox='0 0 24 24'>\n  <rect  x = "1" y="2"\twidth="3"/>\n  <g><circle r="4"/><text>hi &amp; bye</text></g>\n</svg>\n`;
const load = (src = SRC) => {
  const r = parseDoc(src);
  assert.ok(r.ok);
  return r.doc;
};
const find = (doc: Doc, local: string) => [...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.local === local) as ElementNode;

test('attribute edits, removals and additions undo and redo byte for byte', () => {
  const doc = load();
  const s = new Session(doc);
  const rect = find(doc, 'rect');
  s.dispatch('edit', (apply) => {
    apply(opSetAttr(doc, rect.id, null, 'y', '20'));
    apply(opSetAttr(doc, rect.id, null, 'x', null));
    apply(opSetAttr(doc, rect.id, null, 'fill', 'a<b"c'));
  });
  const after = serialize(doc);
  // A removed attribute takes its own leading whitespace with it.
  assert.equal(after, SRC.replace('  x = "1" y="2"', ' y="20"').replace('width="3"', 'width="3" fill="a&lt;b&quot;c"'));
  s.undo();
  assert.equal(serialize(doc), SRC);
  s.redo();
  assert.equal(serialize(doc), after);
});

test('raw attribute and text edits keep every other byte', () => {
  const doc = load();
  const s = new Session(doc);
  const svg = el(doc, doc.root);
  const text = [...descendants(doc, doc.root)].find((n) => n.kind === 'text' && n.raw.includes('hi'))!;
  s.dispatch('scrub', (apply) => {
    apply(opSetAttrRaw(doc, svg.id, null, 'viewBox', '0 0 48 24'));
    apply(opSetTextRaw(doc, text.id, 'hi &amp; hello'));
  });
  assert.equal(serialize(doc), SRC.replace("'0 0 24 24'", "'0 0 48 24'").replace('bye', 'hello'));
  s.undo();
  assert.equal(serialize(doc), SRC);
});

test('CDATA leaves (Illustrator styles) edit and undo like text', () => {
  const src = '<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[.a{fill:#111}]]></style></svg>';
  const doc = load(src);
  const s = new Session(doc);
  const cdata = [...descendants(doc, doc.root)].find((n) => n.kind === 'cdata')!;
  s.dispatch('colour', (apply) => apply(opSetLeafRaw(doc, cdata.id, '<![CDATA[.a{fill:#222}]]>')));
  assert.equal(serialize(doc), src.replace('#111', '#222'));
  assert.throws(() => opSetLeafRaw(doc, cdata.id, '.a{fill:red}'), /CDATA/);
  s.undo();
  assert.equal(serialize(doc), src);
});

test('a removed node comes back as the same node, in the same place', () => {
  const doc = load();
  const s = new Session(doc);
  const circle = find(doc, 'circle');
  const g = find(doc, 'g');
  s.dispatch('delete', (apply) => apply(opRemove(doc, circle.id)));
  assert.ok(!serialize(doc).includes('circle'));
  s.undo();
  assert.equal(serialize(doc), SRC);
  assert.equal(find(doc, 'circle').id, circle.id, 'same NodeId');
  s.dispatch('move', (apply) => {
    apply(opRemove(doc, circle.id));
    apply(opInsert(doc, circle.id, doc.root, 0));
  });
  assert.equal(el(doc, doc.root).children[0], circle.id);
  assert.throws(() => s.dispatch('bad', (apply) => {
    apply(opRemove(doc, g.id));
    apply(opInsert(doc, g.id, g.id, 0));
  }), /inside itself/);
  assert.ok(serialize(doc).includes('<g>'), 'a failed transaction rolls back what it applied');
  s.undo();
  assert.equal(serialize(doc), SRC);
  assert.throws(() => opRemove(doc, doc.root), /root/);
});

test('a drag applies every frame live and leaves one undo entry', () => {
  const doc = load();
  const s = new Session(doc);
  const rect = find(doc, 'rect');
  const seen: string[] = [];
  s.subscribe((cs, why) => seen.push(`${why.kind}:${[...cs.attrs].length}`));
  const d = s.drag('scrub x');
  for (let i = 0; i < 100; i++) d.update((apply) => apply(opSetAttrRaw(doc, rect.id, null, 'x', String(i))));
  assert.ok(serialize(doc).includes('x = "99"'));
  d.commit();
  assert.equal(seen.length, 100);
  assert.equal(s.undoLabel, 'scrub x');
  s.undo();
  assert.equal(serialize(doc), SRC);
  assert.equal(s.canUndo, false, 'one entry only');
  const c = s.drag('cancelled');
  c.update((apply) => apply(opSetAttr(doc, rect.id, null, 'y', '7')));
  c.cancel();
  assert.equal(serialize(doc), SRC);
  assert.equal(s.canUndo, false);
  const z = s.drag('no-op');
  z.update((apply) => apply(opSetAttrRaw(doc, rect.id, null, 'x', '1')));
  z.commit();
  assert.equal(s.canUndo, false, 'a drag that ends where it started records nothing');
});

test('coalesce keeps the first before and the last after of consecutive edits', () => {
  const doc = load();
  const rect = find(doc, 'rect');
  const ops: Op[] = [];
  for (const v of ['5', '6', '7']) ops.push(opSetAttrRaw(doc, rect.id, null, 'x', v));
  const [one] = coalesce(ops);
  assert.equal(coalesce(ops).length, 1);
  assert.ok(one.kind === 'attr' && one.before?.attr.raw === '1' && one.after?.attr.raw === '7');
});

// ── P1-M1: moved nodes, and place ops that cancel out ─────────────────────────────────────────

/** Move a node (and the whitespace before it) to just after `after`, as Forward does. */
function forward(doc: Doc, id: NodeId, apply: (op: Op) => void): void {
  const parent = el(doc, doc.nodes.get(id)!.parent!);
  const i = parent.children.indexOf(id);
  const ws = i > 0 && doc.nodes.get(parent.children[i - 1])!.kind === 'text' ? parent.children[i - 1] : null;
  const next = parent.children.slice(i + 1).find((c) => doc.nodes.get(c)!.kind === 'element')!;
  for (const n of ws === null ? [id] : [ws, id]) {
    apply(opRemove(doc, n));
    apply(opInsert(doc, n, parent.id, parent.children.indexOf(next) + 1 + (n === id && ws !== null ? 1 : 0)));
  }
}

test('a ChangeSet names every node whose place changed: inserted, removed and reordered', () => {
  const doc = load();
  const s = new Session(doc);
  let seen: ChangeSet | null = null;
  s.subscribe((cs) => (seen = cs));
  const rect = find(doc, 'rect');
  const g = find(doc, 'g');
  const circle = find(doc, 'circle');
  s.dispatch('reorder', (apply) => forward(doc, rect.id, apply));
  const ws = el(doc, doc.root).children[el(doc, doc.root).children.indexOf(rect.id) - 1];
  assert.deepEqual([...seen!.moved].sort(), [rect.id, ws].sort(), 'the element and its whitespace');
  assert.deepEqual([...seen!.structure], [doc.root]);
  s.dispatch('remove', (apply) => apply(opRemove(doc, circle.id)));
  assert.deepEqual([...seen!.moved], [circle.id]);
  s.dispatch('insert', (apply) => apply(opInsert(doc, circle.id, g.id, 0)));
  assert.deepEqual([...seen!.moved], [circle.id]);
  assert.deepEqual([...seen!.attrs], []);
});

test('coalesce merges consecutive place ops of one node, and drops one that ends where it started', () => {
  const doc = load();
  const rect = find(doc, 'rect');
  const root = el(doc, doc.root);
  const at = root.children.indexOf(rect.id);
  const ops: Op[] = [opRemove(doc, rect.id), opInsert(doc, rect.id, root.id, root.children.length)];
  const [move] = coalesce(ops);
  assert.equal(coalesce(ops).length, 1, 'a remove and its re-insert are one move');
  assert.ok(move.kind === 'place' && move.before?.index === at && move.after?.index === root.children.length - 1);
  const back: Op[] = [opRemove(doc, rect.id), opInsert(doc, rect.id, root.id, at)];
  assert.equal(coalesce(back).length, 1, 'the way back alone is a move too');
  assert.deepEqual(coalesce([...ops, ...back]), [], 'out and back where it was: nothing');
  assert.equal(serialize(doc), SRC);
});

test('a Forward and then a Back in one transaction records nothing', () => {
  const doc = load();
  const s = new Session(doc);
  const rect = find(doc, 'rect');
  const g = find(doc, 'g');
  s.dispatch('Forward then Back', (apply) => {
    forward(doc, rect.id, apply); // rect after the g
    forward(doc, g.id, apply); // the g after the rect again: the rect is back
  });
  assert.equal(serialize(doc), SRC, 'the file is as it was');
  assert.equal(s.canUndo, false, 'and no history entry was made');
  s.dispatch('Forward', (apply) => forward(doc, rect.id, apply));
  assert.equal(s.canUndo, true, 'one Forward alone is an entry');
  assert.notEqual(serialize(doc), SRC);
  s.undo();
  assert.equal(serialize(doc), SRC);
});

// ── the P0 exit property ───────────────────────────────────────────────────────────────────────

const CORPUS = new URL('../fixtures/corpus/', import.meta.url);
const FILES = readdirSync(CORPUS, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.svg')).sort();
const SOURCES = FILES.map((f) => readFileSync(new URL(f, CORPUS), 'utf8'));

function randomIntent(doc: Doc, r: () => number, removed: NodeId[]): ((apply: (op: Op) => void) => void) | null {
  const nodes = [...descendants(doc, doc.root)];
  const els = nodes.filter((n): n is ElementNode => n.kind === 'element');
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const kind = Math.floor(r() * 6);
  if (kind === 0 || kind === 1) {
    const e = pick(els);
    const a = e.attrs.filter((x) => !x.qname.startsWith('xmlns'));
    if (!a.length) return null;
    const at = pick(a);
    const value = kind === 0 ? String(Math.floor(r() * 1000) / 10) : null;
    return (apply) => apply(opSetAttr(doc, e.id, at.ns, at.local, value));
  }
  if (kind === 2) {
    const e = pick(els);
    return (apply) => apply(opSetAttr(doc, e.id, null, `data-t${Math.floor(r() * 3)}`, `v${Math.floor(r() * 100)}`));
  }
  if (kind === 3) {
    const t = nodes.filter((n) => n.kind === 'text');
    if (!t.length) return null;
    const leaf = pick(t);
    return (apply) => apply(opSetTextRaw(doc, leaf.id, `t${Math.floor(r() * 100)}`));
  }
  if (kind === 4) {
    const victims = nodes.filter((n) => n.id !== doc.root && n.parent !== null);
    if (!victims.length) return null;
    const v = pick(victims);
    return (apply) => {
      apply(opRemove(doc, v.id));
      removed.push(v.id);
    };
  }
  const back = removed.filter((id) => doc.nodes.get(id)?.parent === null);
  if (!back.length) return null;
  const id = pick(back);
  const parent = pick(els);
  return (apply) => apply(opInsert(doc, id, parent.id, Math.floor(r() * (parent.children.length + 1))));
}

test('10k seeded random edit sequences, with undo and redo mixed in, restore byte-identical source', () => {
  const r = mulberry32(20260928);
  let sequences = 0;
  let steps = 0;
  for (; sequences < 10_000; sequences++) {
    const i = Math.floor(r() * SOURCES.length);
    const doc = load(SOURCES[i]);
    const s = new Session(doc);
    const states = [serialize(doc)]; // states[k] = source after k entries in history
    let at = 0;
    const removed: NodeId[] = [];
    const n = 1 + Math.floor(r() * 8);
    for (let k = 0; k < n; k++) {
      const roll = r();
      if (roll < 0.2 && s.canUndo) {
        s.undo();
        at--;
      } else if (roll < 0.3 && s.canRedo) {
        s.redo();
        at++;
      } else {
        const intent = randomIntent(doc, r, removed);
        if (!intent) continue;
        const before = s.canUndo ? s.undoLabel : null;
        s.dispatch(`step ${k}`, intent);
        if (s.undoLabel === `step ${k}` && before !== `step ${k}`) {
          states.length = ++at;
          states.push(serialize(doc));
        }
      }
      steps++;
      assert.equal(serialize(doc), states[at], `${FILES[i]}: sequence ${sequences}, step ${k}: history position ${at}`);
    }
    while (s.canUndo) {
      s.undo();
      at--;
    }
    assert.equal(serialize(doc), SOURCES[i], `${FILES[i]}: sequence ${sequences} did not undo to the original`);
    while (s.canRedo) {
      s.redo();
      at++;
    }
    assert.equal(serialize(doc), states[at], `${FILES[i]}: sequence ${sequences} did not redo to its last state`);
  }
  assert.equal(sequences, 10_000);
  assert.ok(steps > 30_000, `only ${steps} steps`);
});

// The finish hook (P1-M2): after a transaction's own ops, and after each drag frame's, it sees them
// and what it applies joins them, so one undo takes both back; a throw from it rolls the whole run
// back; undo and redo replay what was recorded and never call it.
test('the finish hook: its ops join the transaction and the drag frame, a throw from it rolls the whole run back, and undo and redo never call it', () => {
  const doc = load();
  const rect = find(doc, 'rect');
  const seen: Op[][] = [];
  let fail = false;
  const s = new Session(doc, {
    finish: (d, ops, apply) => {
      seen.push([...ops]);
      if (fail) throw new Error('the hook failed');
      // Mirror y into data-y, as a generator mirrors its inputs into its geometry.
      if (ops.some((op) => op.kind === 'attr' && op.id === rect.id && op.local === 'y')) apply(opSetAttr(d, rect.id, null, 'data-y', find(d, 'rect').attrs.find((a) => a.local === 'y')!.raw));
    },
  });
  s.dispatch('Set y', (apply) => apply(opSetAttr(doc, rect.id, null, 'y', '7')));
  assert.equal(seen.length, 1, 'called once per transaction');
  assert.deepEqual(seen[0].map((op) => op.kind === 'attr' && op.local), ['y'], 'it sees the transaction’s own ops');
  const one = serialize(doc);
  assert.equal(one, SRC.replace('y="2"\twidth="3"', 'y="7"\twidth="3" data-y="7"'));
  s.undo();
  assert.equal(serialize(doc), SRC, 'one undo takes the hook’s op back with the edit’s');
  s.redo();
  assert.equal(serialize(doc), one);
  assert.equal(seen.length, 1, 'undo and redo never call it');
  s.undo();
  // A drag: each frame's ops, and the hook's, from the state before the drag; one entry.
  const drag = s.drag('Drag y');
  for (const v of ['3', '4', '5']) drag.update((apply) => apply(opSetAttr(doc, rect.id, null, 'y', v)));
  assert.equal(seen.length, 4, 'called once per frame');
  assert.equal(serialize(doc), SRC.replace('y="2"\twidth="3"', 'y="5"\twidth="3" data-y="5"'), 'the last frame, with its hook op');
  drag.commit();
  assert.equal(s.undoLabel, 'Drag y');
  s.undo();
  assert.equal(serialize(doc), SRC, 'the drag’s one entry holds the hook’s op');
  // A throw from the hook rolls back the build's ops too, and records nothing.
  fail = true;
  assert.throws(() => s.dispatch('Set y', (apply) => apply(opSetAttr(doc, rect.id, null, 'y', '9'))), /the hook failed/);
  assert.equal(serialize(doc), SRC, 'the build’s op was rolled back');
  assert.equal(s.canUndo, false, 'nothing was recorded');
  // With no hook, a Session is as before.
  const plain = new Session(load());
  assert.ok(plain.doc);
});
