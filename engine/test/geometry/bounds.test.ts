// engine/geometry/bounds: the fill box as getBBox gives it (Chromium's numbers, probed in P1-M1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { descendants, parseDoc, type Doc, type ElementNode } from '../../model/doc.ts';
import { localBounds, rootBounds, type Rect } from '../../geometry/bounds.ts';
import type { GeoContext } from '../../geometry/ctm.ts';

const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, r.ok ? '' : r.error.message);
  return r.doc;
};
const byId = (doc: Doc, id: string) => ([...descendants(doc, doc.root)].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === id)) as ElementNode).id;
const CTX: GeoContext = { viewport: { width: 440, height: 528 }, remPx: 12 };
const svg = (body: string, attrs = 'viewBox="0 0 200 100"') => load(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`);
const box = (r: Rect | null) => r && [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 1e6) / 1e6);

test('each shape’s box comes from its own geometry', () => {
  const doc = svg(`<rect id="rect" x="5" y="6" width="7" height="8" rx="3"/><image id="image" x="1" y="2" width="3" height="4"/>
    <foreignObject id="fo" x="1" y="2" width="30" height="40"/><circle id="circle" cx="50" cy="40" r="10"/>
    <ellipse id="ellipse" cx="50" cy="50" rx="10" ry="5"/><ellipse id="auto" cx="50" cy="50" rx="10"/><line id="line" x1="30" y1="5" x2="10" y2="25"/>
    <polyline id="odd" points="0 0 10 10 20"/><polygon id="bad" points="1 2 3 x 5 6"/><polygon id="none" points=""/>
    <path id="path" d="M10 10 Q 20 0 30 10"/><path id="moves" d="M1 1 M2 2"/><path id="broken" d="M10 10 L20 20 Q"/><path id="empty" d=""/>
    <rect id="neg" x="5" y="6" width="-3" height="4"/><rect id="units" x="1in" y="10%" width="2em" height="2rem" font-size="10"/>`);
  const b = (id: string) => box(localBounds(doc, byId(doc, id), CTX));
  assert.deepEqual(b('rect'), [5, 6, 7, 8]);
  assert.deepEqual(b('image'), [1, 2, 3, 4]);
  assert.deepEqual(b('fo'), [1, 2, 30, 40]);
  assert.deepEqual(b('circle'), [40, 30, 20, 20]);
  assert.deepEqual(b('ellipse'), [40, 45, 20, 10]);
  assert.deepEqual(b('auto'), [40, 40, 20, 20], 'a missing ry is auto: rx');
  assert.deepEqual(b('line'), [10, 5, 20, 20]);
  assert.deepEqual(b('odd'), [0, 0, 10, 10], 'an odd final coordinate is dropped');
  assert.deepEqual(b('bad'), [1, 2, 0, 0], 'points read up to the first error');
  assert.deepEqual(b('none'), [0, 0, 0, 0]);
  assert.deepEqual(b('path'), [10, 5, 20, 5], 'a curve’s extremum counts');
  assert.deepEqual(b('moves'), [2, 2, 0, 0], 'a moveto replaced at once');
  assert.deepEqual(b('broken'), [10, 10, 10, 10], 'up to the first error');
  assert.deepEqual(b('empty'), [0, 0, 0, 0]);
  assert.deepEqual(b('neg'), [5, 6, 0, 4], 'a negative size is none');
  assert.deepEqual(b('units'), [96, 10, 20, 24], 'in, % of the viewBox height, em of its own font size, rem of the page’s');
});

test('a group is the union of its displayed children through their transforms; empty shapes are left out, lines count', () => {
  const doc = svg(`<g id="g"><rect x="10" y="10" width="10" height="10" transform="translate(100 0)"/><circle cx="5" cy="5" r="5" transform="scale(2)"/></g>
    <g id="empties"><rect x="10" y="10" width="5" height="5"/><rect x="100" y="100" width="0" height="10"/><circle cx="100" cy="100" r="0"/><path d=""/><g/><image x="90" y="90"/></g>
    <g id="points"><rect x="10" y="10" width="5" height="5"/><line x1="100" y1="100" x2="100" y2="100"/></g>
    <g id="hidden"><rect x="0" y="0" width="10" height="10" display="none"/><rect x="0" y="0" width="1" height="1" style="display:none"/><rect x="20" y="20" width="10" height="10" visibility="hidden"/></g>
    <g id="nothing"/><switch id="sw"><rect x="0" y="0" width="5" height="5" requiredExtensions="http://example.org/x"/><rect x="50" y="50" width="5" height="5"/><rect x="80" y="80" width="5" height="5"/></switch>
    <g id="rot"><rect x="0" y="0" width="10" height="10" transform="rotate(45)"/></g>
    <svg id="nested" x="10" y="20" width="40" height="30" viewBox="0 0 10 10"><rect x="2" y="3" width="4" height="5"/></svg><g id="outer"><svg x="50" y="50" width="20" height="20" viewBox="0 0 10 10"><rect width="5" height="5"/></svg></g>`);
  const b = (id: string) => box(localBounds(doc, byId(doc, id), CTX));
  assert.deepEqual(b('g'), [0, 0, 120, 20]);
  assert.deepEqual(b('empties'), [10, 10, 5, 5], 'zero-size shapes, an empty path and group and an unsized image add nothing');
  assert.deepEqual(b('points'), [10, 10, 90, 90], 'a zero-length line is a point');
  assert.deepEqual(b('hidden'), [20, 20, 10, 10], 'display none is skipped; visibility hidden is not');
  assert.deepEqual(b('nothing'), [0, 0, 0, 0]);
  assert.deepEqual(b('sw'), [50, 50, 5, 5], 'a switch is its first child that renders');
  const r = localBounds(doc, byId(doc, 'rot'), CTX)!;
  assert.ok(Math.abs(r.width - 10 * Math.SQRT2) < 1e-9 && Math.abs(r.x + 5 * Math.SQRT2) < 1e-9, 'a turned child: the box around its turned box');
  assert.deepEqual(b('nested'), [2, 3, 4, 5], 'a nested svg is its content, in its own inner units');
  assert.deepEqual(box(rootBounds(doc, byId(doc, 'nested'), CTX)), [21, 29, 12, 15], 'and through its viewport on the root');
  assert.deepEqual(b('outer'), [50, 50, 10, 10], 'a nested svg in a group: its content through its viewport');
});

test('null where the box is unknown: text, use, an unsized image with an href, CSS geometry, display none, rem without the page, ex', () => {
  const doc = svg(`<style>.k { r: 4px }</style><text id="text" x="1" y="2">Hi</text><use id="use" href="#rect"/><rect id="rect" width="1" height="1"/>
    <image id="image" x="1" y="2" href="data:image/png;base64,AAAA"/><circle id="css" class="k" r="3"/><rect id="inline" style="x: 3px" width="1" height="1"/>
    <rect id="none" display="none" width="1" height="1"/><rect id="rem" width="2rem" height="1"/><rect id="ex" width="2ex" height="1"/>
    <g id="withText"><rect width="1" height="1"/><text>Hi</text></g>`);
  for (const id of ['text', 'use', 'image', 'css', 'inline', 'none', 'ex', 'withText']) assert.equal(localBounds(doc, byId(doc, id), CTX), null, id);
  assert.equal(localBounds(doc, byId(doc, 'rem'), { ...CTX, remPx: null }), null, 'rem without the page’s root size');
  assert.deepEqual(box(localBounds(doc, byId(doc, 'rem'), CTX)), [0, 0, 24, 1], 'with it');
});

test('over the corpus, every element gives null or a finite box, and nothing throws', () => {
  const dir = new URL('../fixtures/corpus/', import.meta.url);
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.svg'));
  assert.ok(files.length > 250);
  let boxes = 0;
  let elements = 0;
  for (const f of files) {
    const doc = load(readFileSync(new URL(f, dir), 'utf8'));
    for (const n of descendants(doc, doc.root)) {
      if (n.kind !== 'element') continue;
      elements++;
      for (const r of [localBounds(doc, n.id, CTX), rootBounds(doc, n.id, CTX)]) {
        if (r === null) continue;
        assert.ok([r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 0 && r.height >= 0, `${f}: <${n.qname}> ${JSON.stringify(r)}`);
        boxes++;
      }
    }
  }
  assert.ok(boxes > 2000, `only ${boxes} boxes over ${elements} elements`);
});
