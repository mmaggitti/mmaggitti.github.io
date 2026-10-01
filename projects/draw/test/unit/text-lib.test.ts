// The text library (P1-M4: fontkit 2.0.4, the spike's winner), as the lazy chunk gives it, in node:
// openFont reads each of the catalogue's 110 faces from the file the canvas registers, and refuses a
// file that isn't a font.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openFont } from '../../src/text/outline-lib.ts';
import { CATALOGUE, faceFile } from '../../src/platform/font-catalogue.ts';

const file = (slug: string, name: string) => new Uint8Array(readFileSync(new URL(`../../node_modules/@fontsource/${slug}/files/${name}`, import.meta.url)));

test('openFont reads the family, weight class and italic flag of each of the catalogue’s 110 faces as its file writes them (some variable-font instances say 250 for Thin and ExtraLight, and some name an instance in their family)', () => {
  let n = 0;
  for (const f of CATALOGUE) {
    for (const [weights, style] of [[f.weights, 'normal'], [f.italics, 'italic']] as const) {
      for (const w of weights) {
        const info = openFont(file(f.slug, faceFile(f.slug, w, style)));
        assert.ok(info.family.startsWith(f.family), `${f.family} ${w} ${style}: family ${info.family}`);
        // A variable font's Thin and ExtraLight instances may say 250 (IBM Plex Mono's say 100 and 200).
        assert.ok(info.weight === w || (w <= 200 && info.weight === 250), `${f.family} ${w} ${style}: weight class ${info.weight}`);
        assert.equal(info.italic, style === 'italic', `${f.family} ${w} ${style}: italic`);
        assert.ok(info.copyright.startsWith('Copyright'), `${f.family}: its copyright string`);
        n++;
      }
    }
  }
  assert.equal(n, 110);
  assert.equal(openFont(file('inter', 'inter-latin-400-normal.woff2')).family, 'Inter', 'the typographic family first');
  assert.match(openFont(file('dm-serif-display', 'dm-serif-display-latin-400-normal.woff2')).copyright, /Reserved Font Name 'Source'/);
});

test('openFont refuses a file that isn’t a font', () => {
  assert.throws(() => openFont(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')));
  assert.throws(() => openFont(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0])), 'a WOFF2 header and nothing else');
});
