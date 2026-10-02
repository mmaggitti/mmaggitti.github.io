// The New sheet's presets (engine/presets/quick-starts.ts): Draw's blank, the three quick starts and
// SVG Lab's Create templates, each a file that opens and saves byte for byte, held to its exact text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BLANK, PRESETS, PRESET_GROUPS, presetById } from '../../presets/quick-starts.ts';
import { NS, el, parseDoc, serialize } from '../../model/doc.ts';

const LAB = (f: string) => readFileSync(new URL(`../fixtures/corpus/lab/${f}`, import.meta.url), 'utf8');

test('the presets are Draw’s blank, the three quick starts and SVG Lab’s three templates, in that order, with unique ids', () => {
  assert.deepEqual(PRESETS.map((p) => p.id), ['draw-blank', 'quick-icon-24', 'quick-app-icon', 'quick-wordmark', 'lab-blank', 'lab-icon', 'lab-logo']);
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
  assert.deepEqual(PRESETS.map((p) => [p.group, p.name, p.size, p.drawing]), [
    ['draw', 'Blank', '800 × 600', 'Blank'],
    ['quick', 'Icon', '24 × 24', 'Icon'],
    ['quick', 'App icon', '1024 × 1024', 'App icon'],
    ['quick', 'Wordmark', '640 × 200', 'Wordmark'],
    ['lab', 'Blank', '100 × 100', 'SVG Lab blank'],
    ['lab', 'Icon', '100 × 100', 'SVG Lab icon'],
    ['lab', 'Logo', '100 × 100', 'SVG Lab logo'],
  ]);
  assert.deepEqual(PRESET_GROUPS.map((g) => g.group), ['draw', 'quick', 'lab']);
  assert.equal(presetById('quick-wordmark')?.name, 'Wordmark');
  assert.equal(presetById('nope'), undefined);
});

test('each preset parses as an <svg> in the SVG namespace, saves byte for byte, and ends with a newline', () => {
  for (const p of PRESETS) {
    const r = parseDoc(p.text);
    assert.ok(r.ok, `${p.id}: ${r.ok ? '' : r.error.message}`);
    const root = el(r.doc, r.doc.root);
    assert.equal(root.ns, NS.svg, p.id);
    assert.equal(root.local, 'svg', p.id);
    assert.equal(serialize(r.doc), p.text, `${p.id} round-trips`);
    assert.ok(p.text.endsWith('</svg>\n'), `${p.id} ends with a newline`);
  }
});

test('SVG Lab’s three are its own exports of Blank, Icon and Logo, byte for byte (a recaptured lab is noticed)', () => {
  assert.equal(presetById('lab-blank')!.text, LAB('create-blank.svg'));
  assert.equal(presetById('lab-icon')!.text, LAB('create-icon.svg'));
  assert.equal(presetById('lab-logo')!.text, LAB('create-logo.svg'));
});

test('the quick starts are exactly a stroke icon’s 24 × 24 board, a 1024 rounded square and an Archivo 900 wordmark; Draw’s blank is BLANK', () => {
  assert.equal(presetById('draw-blank')!.text, BLANK);
  assert.equal(BLANK, '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">\n</svg>\n');
  assert.equal(presetById('quick-icon-24')!.text, '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n</svg>\n');
  assert.equal(presetById('quick-app-icon')!.text, '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n  <rect width="1024" height="1024" rx="224" fill="#264653"/>\n</svg>\n');
  assert.equal(presetById('quick-wordmark')!.text, '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200">\n  <text x="320" y="134" font-size="96" font-family="Archivo, sans-serif" font-weight="900" text-anchor="middle" fill="#264653">Wordmark</text>\n</svg>\n');
  // The icon's root is the corpus's stroke icon sets' own, without their class.
  const lucide = readFileSync(new URL('../fixtures/corpus/icons/lucide/a-arrow-down.svg', import.meta.url), 'utf8');
  const head = /<svg[^>]*>/.exec(lucide)![0].replace(/\s+class="[^"]*"/, '').replace(/\s+/g, ' ');
  for (const a of ['xmlns="http://www.w3.org/2000/svg"', 'width="24"', 'height="24"', 'viewBox="0 0 24 24"', 'fill="none"', 'stroke="currentColor"', 'stroke-width="2"', 'stroke-linecap="round"', 'stroke-linejoin="round"']) {
    assert.ok(head.includes(a), `lucide's root has ${a}`);
  }
});
