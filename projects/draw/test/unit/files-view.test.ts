// What the Import report sheet and the Files menu show: the report's four buckets with their items
// grouped by kind (every counted item once), and the draft list's reminders.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc } from '../../../../engine/model/doc.ts';
import { importReport } from '../../../../engine/report/import-report.ts';
import { ago, draftRows, failureText, reportView } from '../../src/files-view.ts';
import { corpus } from './fakes.ts';

const DAY = 86_400_000;
const report = (rel: string) => {
  const r = parseDoc(corpus(rel));
  assert.ok(r.ok, rel);
  return importReport(r.doc);
};

test('the report sheet shows all four buckets with their counts, and every item once, grouped by kind', () => {
  for (const rel of ['lab/spin--js.svg', 'tools/inkscape-1x-layers.svg', 'lab/switch--unknown.svg', 'tools/drawio-two-boxes-html-labels.svg']) {
    const r = report(rel);
    const v = reportView(r);
    assert.deepEqual(v.buckets.map((b) => b.bucket), ['editable', 'kept', 'preview', 'unclassified'], rel);
    for (const b of v.buckets) {
      assert.equal(b.total, r.totals[b.bucket], `${rel} ${b.bucket}`);
      assert.equal([...b.elements, ...b.attributes].reduce((n, i) => n + i.count, 0), b.total, `${rel} ${b.bucket}: the items add up to the count`);
      assert.ok(b.elements.every((e) => /^<.+>$/.test(e.name)), 'elements read as tags');
    }
    assert.equal(v.total, r.items.reduce((n, i) => n + i.count, 0));
    assert.deepEqual(v.notes, r.notes);
  }
  const spin = reportView(report('lab/spin--js.svg'));
  assert.ok(spin.buckets[2].elements.some((e) => e.name === '<script>'), 'a script is preview-only');
  const ink = reportView(report('tools/inkscape-1x-layers.svg'));
  assert.ok(ink.buckets[1].attributes.some((a) => a.name.startsWith('inkscape:')), "Inkscape's data is kept");
});

test('the draft list: newest first as given, the open one marked, and "not exported for N days" once it is due', () => {
  const now = 20 * DAY;
  const rows = draftRows([
    { id: 'a', name: 'Logo', created: now - 2 * DAY, updated: now - 90_000, exported: null, remind: false },
    { id: 'b', name: 'Poster', created: now - 9 * DAY, updated: now - 3 * DAY, exported: null, remind: true },
    { id: 'c', name: 'Icon', created: now - 19 * DAY, updated: now - 8 * DAY, exported: now - 6 * DAY, remind: true },
  ], now, 'a');
  assert.deepEqual(rows.map((r) => [r.name, r.open, r.updated, r.reminder]), [
    ['Logo', true, 'Edited 1 min ago', null],
    ['Poster', false, 'Edited 3 days ago', 'Never exported for 9 days'],
    ['Icon', false, 'Edited 8 days ago', 'Not exported for 6 days'],
  ]);
  assert.deepEqual([ago(5_000), ago(3 * 3_600_000), ago(DAY)], ['just now', '3 h ago', '1 day ago']);
});

test('why an open failed reads as one sentence: capitalised, one period, with where when it is known', () => {
  assert.equal(failureText({ message: '</svg> closes <rect>', line: 3, column: 1 }), 'Line 3, column 1: </svg> closes <rect>.');
  assert.equal(failureText({ message: 'the link’s drawing could not be read (Compressed input was truncated)', line: null, column: null }), 'The link’s drawing could not be read (Compressed input was truncated).');
  assert.equal(failureText({ message: 'this isn’t an SVG file', line: null, column: null }), 'This isn’t an SVG file.');
  assert.equal(failureText({ message: 'Done already.', line: null, column: null }), 'Done already.');
});
