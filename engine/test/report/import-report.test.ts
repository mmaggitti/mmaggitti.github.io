// The import report over the real corpus: every element and attribute lands in exactly one bucket,
// and the buckets say what the ledger says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseDoc, descendants, type ElementNode } from '../../model/doc.ts';
import { importReport } from '../../report/import-report.ts';
import { classifyAttribute, classifyElement } from '../../policy/classify.ts';

const CORPUS = new URL('../fixtures/corpus/', import.meta.url);
const FILES = readdirSync(CORPUS, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.svg')).sort();
const load = (rel: string) => {
  const r = parseDoc(readFileSync(new URL(rel, CORPUS), 'utf8'));
  assert.ok(r.ok, rel);
  return r.doc;
};

test('every element and attribute of every corpus file is counted once', () => {
  for (const rel of FILES) {
    const doc = load(rel);
    let expected = 0;
    for (const n of descendants(doc, doc.root)) {
      if (n.kind !== 'element') continue;
      const e = n as ElementNode;
      expected += 1 + e.attrs.filter((a) => classifyAttribute(e.ns, e.local, a.ns, a.local) !== null).length;
    }
    const r = importReport(doc);
    const total = Object.values(r.totals).reduce((a, b) => a + b, 0);
    assert.equal(total, expected, rel);
    assert.equal(r.items.reduce((a, i) => a + i.count, 0), total, rel);
  }
});

test('the buckets follow the ledger', () => {
  const svgNs = 'http://www.w3.org/2000/svg';
  assert.deepEqual(classifyElement(svgNs, 'rect'), { cls: 'edit', exact: true });
  assert.deepEqual(classifyElement(svgNs, 'script'), { cls: 'active', exact: true });
  assert.equal(classifyElement(svgNs, 'sparkle').exact, false);
  assert.deepEqual(classifyAttribute(svgNs, 'rect', null, 'onclick'), { cls: 'active', exact: true });
  assert.deepEqual(classifyAttribute(svgNs, 'script', null, 'type'), { cls: 'active', exact: true });
  assert.deepEqual(classifyAttribute(svgNs, 'style', null, 'type'), { cls: 'edit', exact: true });
  assert.equal(classifyAttribute(svgNs, 'g', 'http://www.inkscape.org/namespaces/inkscape', 'label')?.cls, 'preserve-hidden');
  assert.equal(classifyAttribute(svgNs, 'svg', 'http://www.w3.org/2000/xmlns/', 'xlink'), null);
  assert.deepEqual(classifyAttribute(svgNs, 'rect', null, 'data-x'), { cls: 'preserve', exact: true });
  assert.equal(classifyAttribute(svgNs, 'rect', null, 'made-up')?.exact, false);
});

test('reports name what matters in real files', () => {
  const spin = importReport(load('lab/spin--js.svg'));
  assert.ok(spin.totals.preview > 0 && spin.items.some((i) => i.bucket === 'preview' && i.name === 'script'));
  const ink = importReport(load('tools/inkscape-1x-layers.svg'));
  assert.ok(ink.items.some((i) => i.bucket === 'kept' && i.name.startsWith('inkscape:')));
  const unknown = importReport(load('lab/switch--unknown.svg'));
  assert.ok(unknown.items.some((i) => i.bucket === 'unclassified' && i.name === 'sparkle'));
  const legacy = importReport(load('tools/edge-legacy-fonts-tiny-rdfa.svg'));
  assert.ok(legacy.notes.some((n) => n.startsWith('Safari draws')));
  const icon = importReport(load('icons/lucide/' + readdirSync(new URL('icons/lucide/', CORPUS)).find((f) => f.endsWith('.svg'))));
  assert.equal(icon.totals.preview + icon.totals.unclassified, 0, 'a plain icon is all editable or kept');
});
