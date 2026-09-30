// engine/geometry/hit: a tap near a hairline takes it (SVG Lab's hitThin: 22 px plus half the stroke).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descendants, parseDoc, type Doc, type ElementNode, type NodeId } from '../../model/doc.ts';
import { isThin, thinHit } from '../../geometry/hit.ts';
import type { GeoContext } from '../../geometry/ctm.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.doc;
};
const byId = (doc: Doc, id: string) => ([...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === id)) as ElementNode).id;
const all = (doc: Doc): NodeId[] => [...descendants(doc, doc.root)].filter((n) => n.kind === 'element').map((n) => n.id);
const CTX: GeoContext = { viewport: { width: 440, height: 528 }, remPx: 12 };
const TOL = 22;

test('a line is hit within 22 px plus half its stroke, at 1× and at 4×, and missed beyond', () => {
  const doc = load('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><line id="l" x1="0" y1="100" x2="400" y2="100" stroke="#000" stroke-width="4"/></svg>');
  const l = byId(doc, 'l');
  for (const scale of [1, 4]) {
    const reach = TOL / scale + 2; // 22 screen px, and half the 4-unit stroke
    assert.equal(thinHit(doc, all(doc), { x: 200, y: 100 + reach - 0.01 }, TOL, scale, CTX), l, `${scale}×: just inside`);
    assert.equal(thinHit(doc, all(doc), { x: 200, y: 100 - reach + 0.01 }, TOL, scale, CTX), l, `${scale}×: above`);
    assert.equal(thinHit(doc, all(doc), { x: 200, y: 100 + reach + 0.01 }, TOL, scale, CTX), null, `${scale}×: just outside`);
  }
});

test('the topmost thin shape wins, a transform is honoured, and a filled polygon is not thin', () => {
  const doc = load(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
    <polyline id="under" points="0 50 400 50"/><path id="over" d="M0 52 H400" fill="none"/><polygon id="filled" points="0 60 400 60 200 70"/>
    <polygon id="open" points="0 300 400 300 200 310" fill="none"/><g transform="translate(0 200)"><line id="moved" x1="0" y1="0" x2="400" y2="0"/></g></svg>`);
  assert.equal(thinHit(doc, all(doc), { x: 100, y: 51 }, TOL, 1, CTX), byId(doc, 'over'), 'later in document order paints above');
  assert.ok(!isThin(doc, byId(doc, 'filled')), 'a polygon with the default fill');
  assert.ok(isThin(doc, byId(doc, 'open')), 'fill="none"');
  assert.equal(thinHit(doc, [byId(doc, 'filled')], { x: 200, y: 61 }, TOL, 1, CTX), null);
  assert.equal(thinHit(doc, all(doc), { x: 30, y: 210 }, TOL, 1, CTX), byId(doc, 'moved'), 'through its group’s translate');
  assert.equal(thinHit(doc, all(doc), { x: 30, y: 150 }, TOL, 1, CTX), null, 'nothing near');
});
