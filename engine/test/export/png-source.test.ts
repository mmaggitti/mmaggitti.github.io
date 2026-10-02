// The file a PNG is drawn from (engine/export/png-source.ts): every <foreignObject> out (with its note),
// the root sized to the PNG, a viewBox only where the root had none, and every other byte kept.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_FOREIGN_OBJECT, pngCopier, pngCopy, textCount } from '../../export/png-source.ts';
import { linear } from '../timing.ts';

const copy = (text: string, w: number, h: number) => {
  const r = pngCopy(text, w, h);
  assert.ok(!('refused' in r), 'refused' in r ? r.refused : '');
  return r;
};

test('a <foreignObject> leaves the copy at any depth, with the one inside it, and the note says so once', () => {
  const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <foreignObject width="5" height="5"><p xmlns="http://www.w3.org/1999/xhtml">hi</p></foreignObject>\n  <g><g><foreignObject width="1" height="1"><svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg></foreignObject><rect width="2" height="2"/></g></g>\n</svg>\n';
  const r = copy(src, 64, 64);
  assert.equal(r.text, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="64" height="64">\n  \n  <g><g><rect width="2" height="2"/></g></g>\n</svg>\n');
  assert.deepEqual(r.notes, [NO_FOREIGN_OBJECT]);
  assert.match(NO_FOREIGN_OBJECT, /Safari won’t make a PNG of a drawing that holds one/);
  assert.deepEqual(copy('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>', 1, 1).notes, [], 'nothing left out, nothing said');
});

test('the root’s width and height become the PNG’s, plain numbers in place; every other byte stays', () => {
  const src = '<?xml version="1.0"?>\n<!-- a comment -->\n<svg  xmlns="http://www.w3.org/2000/svg" width=\'2cm\' height="10mm" viewBox="0 0 20 10" preserveAspectRatio="xMinYMax slice" >\n\t<circle r="1"/></svg>';
  const r = copy(src, 32, 16);
  assert.equal(r.text, src.replace("width='2cm'", "width='32'").replace('height="10mm"', 'height="16"'));
});

test('a root without a usable viewBox gets one of its old size in user units, so it still scales; a usable one is kept as written', () => {
  const sized = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200"><rect width="640" height="200"/></svg>';
  assert.equal(copy(sized, 16, 5).text, '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="5" viewBox="0 0 640 200"><rect width="640" height="200"/></svg>');
  const inches = '<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="0.5in"/>';
  assert.equal(copy(inches, 96, 48).text, '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48" viewBox="0 0 96 48"/>');
  const broken = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20" viewBox="0 0 -1 5"/>';
  assert.equal(copy(broken, 8, 16).text, '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="16" viewBox="0 0 10 20"/>', 'an unusable viewBox is as good as none');
  const kept = '<svg xmlns="http://www.w3.org/2000/svg" viewBox=" 0,0 , 100 100 " preserveAspectRatio="none"/>';
  assert.equal(copy(kept, 64, 64).text, '<svg xmlns="http://www.w3.org/2000/svg" viewBox=" 0,0 , 100 100 " preserveAspectRatio="none" width="64" height="64"/>', 'its viewBox and preserveAspectRatio as written');
});

test('a file that doesn’t parse is refused, with the parser’s words; textCount counts the texts a file still holds', () => {
  const r = pngCopy('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>', 1, 1);
  assert.ok('refused' in r && r.refused.length > 0);
  assert.equal(textCount('<svg xmlns="http://www.w3.org/2000/svg"><text>a</text><g><text>b</text></g><path d="M0 0"/></svg>'), 2);
  assert.equal(textCount('<svg xmlns="http://www.w3.org/2000/svg"/>'), 0);
});

test('pngCopier makes a sheet’s copies from one parse: each is pngCopy’s text at its size, and 56 files cost about what one does', () => {
  const src = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><g><foreignObject width="1" height="1"/></g><path d="M0 0h24"/></svg>';
  const copies = pngCopier(src);
  for (const [w, h] of [[16, 8], [1024, 512], [3, 1]]) assert.deepEqual(copies(w, h), pngCopy(src, w, h), `${w} × ${h}`);
  assert.deepEqual(pngCopier('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>')(4, 4), pngCopy('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>', 4, 4), 'a refusal too');
  const big = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${'<rect width="1" height="1"/>'.repeat(20_000)}</svg>`;
  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  const eight = Array.from({ length: 8 }, () => sizes).flat();
  linear('one copier: a file, then 56 files (eight icon sets) from one parse', () => void pngCopier(big)(64, 64), () => {
    const c = pngCopier(big);
    for (const n of eight) c(n, n);
  }, { runs: 5, most: 3, limit: 800 });
});
