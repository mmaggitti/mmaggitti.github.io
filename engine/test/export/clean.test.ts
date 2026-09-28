// Clean export over the corpus: editor data goes, every other byte stays.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseDoc, descendants } from '../../model/doc.ts';
import { cleanExport, EDITOR_NAMESPACES } from '../../export/clean.ts';

const CORPUS = new URL('../fixtures/corpus/', import.meta.url);
const FILES = readdirSync(CORPUS, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.svg')).sort();
const XMLNS = 'http://www.w3.org/2000/xmlns/';

test('the editor namespaces are the ledger\'s "Editor data" rows', () => {
  const ledger = JSON.parse(readFileSync(new URL('../../ledger/ledger.json', import.meta.url), 'utf8'));
  const rows = ledger.rows.filter((r: { kind: string; note?: string }) => r.kind === 'namespace' && /^Editor data/.test(r.note ?? ''));
  assert.deepEqual(rows.map((r: { uri: string }) => r.uri).sort(), [...EDITOR_NAMESPACES].sort());
});

test('every corpus file cleans to a file with no editor data, and a file without any is unchanged', () => {
  let cleaned = 0;
  for (const rel of FILES) {
    const src = readFileSync(new URL(rel, CORPUS), 'utf8');
    const doc = parseDoc(src);
    assert.ok(doc.ok, rel);
    const out = cleanExport(doc.doc);
    const re = parseDoc(out.text);
    assert.ok(re.ok, `${rel}: the clean export parses`);
    let editorLeft = 0;
    for (const n of descendants(re.doc, re.doc.root)) {
      if (n.kind !== 'element') continue;
      if (n.ns && EDITOR_NAMESPACES.has(n.ns)) editorLeft++;
      for (const a of n.attrs) if (a.ns && a.ns !== XMLNS && EDITOR_NAMESPACES.has(a.ns)) editorLeft++;
    }
    assert.equal(editorLeft, 0, `${rel}: editor data left`);
    if (out.removedElements + out.removedAttributes === 0) assert.equal(out.text, src, `${rel}: nothing to clean, so nothing changes`);
    else cleaned++;
  }
  assert.ok(cleaned >= 5, `only ${cleaned} corpus files had editor data`);
});

test('Inkscape and Illustrator files lose exactly their editor markup', () => {
  const ink = readFileSync(new URL('tools/inkscape-1x-layers.svg', CORPUS), 'utf8');
  const inkOut = cleanExport((parseDoc(ink) as { ok: true; doc: never }).doc);
  // The counts the Export sheet shows: the namedview (its grid goes with it); 18 inkscape: and
  // sodipodi: attributes and the 2 declarations nothing uses any more.
  assert.deepEqual([inkOut.removedElements, inkOut.removedAttributes], [1, 20]);
  const out = inkOut.text;
  assert.ok(!/inkscape:|sodipodi:/.test(out));
  assert.ok(out.includes('<dc:title>Poster</dc:title>'), 'descriptive metadata stays');
  assert.ok(out.includes('Summer  Fair'), 'content stays byte for byte');
  const ai = readFileSync(new URL('tools/illustrator-cs6-entities-pgf.svg', CORPUS), 'utf8');
  const aiClean = cleanExport((parseDoc(ai) as { ok: true; doc: never }).doc);
  assert.deepEqual([aiClean.removedElements, aiClean.removedAttributes], [3, 10], 'Illustrator: <sfw>, <i:pgf> and <i:pgfRef>; 7 i: attributes and 3 declarations');
  const aiOut = aiClean.text;
  assert.ok(!/<i:pgf|i:layer|xmlns:i=/.test(aiOut), 'Illustrator data and its entity-declared namespace go');
  assert.ok(aiOut.includes('.st1{fill:#E63946'), 'styles stay');
});
