// DEVICE-CHECKS.md hands Mark links to tap on the phone: each must decode and open through the
// importer as its row says, or the device check would test the wrong thing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeImport } from '../../src/platform/files.ts';
import { importSvg } from '../../src/import.ts';
import { fakeEditor } from './fakes.ts';

const CHECKS = readFileSync(new URL('../../DEVICE-CHECKS.md', import.meta.url), 'utf8');

/** The [label](https://mmaggitti.github.io/draw/#import=…) links of the row numbered `row`. */
function links(row: number): { label: string; fragment: string }[] {
  const line = CHECKS.split('\n').find((l) => l.startsWith(`| ${row} |`));
  assert.ok(line, `row ${row} is in DEVICE-CHECKS.md`);
  return [...line.matchAll(/\[([^\]]+)\]\(https:\/\/mmaggitti\.github\.io\/draw\/(#import=[A-Za-z0-9_-]+)\)/g)].map((m) => ({ label: m[1], fragment: m[2] }));
}

test("DEVICE-CHECKS.md's links decode and open as their rows say: a broken file as read-only source, a drawing that animates once, and one that loops", async () => {
  const [broken] = links(18);
  const [once, loop] = links(19);
  assert.ok(broken && once && loop, 'rows 18 and 19 carry their links');
  const ed = fakeEditor();

  const bad = await decodeImport(broken.fragment);
  const b = await importSvg(ed, { via: 'link', name: '', text: bad! });
  assert.ok(!b.ok && b.source !== null && b.source.text === bad, 'the broken file opens as read-only source');
  assert.equal(b.ok ? '' : b.message, '</svg> closes <rect>');

  const oneShot = (await decodeImport(once.fragment))!;
  const o = await importSvg(ed, { via: 'link', name: '', text: oneShot });
  assert.ok(o.ok, 'the one-shot drawing opens');
  assert.match(oneShot, /<animate [^>]*fill="freeze"/);
  assert.doesNotMatch(oneShot, /repeatCount|infinite/, 'it animates once');

  const looping = (await decodeImport(loop.fragment))!;
  const l = await importSvg(ed, { via: 'link', name: '', text: looping });
  assert.ok(l.ok, 'the looping drawing opens');
  assert.match(looping, /repeatCount="indefinite"/, 'its SMIL loops');
  assert.match(looping, /@keyframes[\s\S]*animation:[^;]*infinite/, 'and so does its CSS');
});

test("P1's row 22 links the lab's house: lab/transform.svg byte for byte, which opens", async () => {
  const HOUSE = readFileSync(fileURLToPath(new URL('../../../../engine/test/fixtures/corpus/lab/transform.svg', import.meta.url)), 'utf8');
  const [house] = links(22);
  assert.ok(house, "row 22 carries the house's link");
  const text = await decodeImport(house.fragment);
  assert.equal(text, HOUSE, "the link is the lab's house");
  const r = await importSvg(fakeEditor(), { via: 'link', name: '', text: text! });
  assert.ok(r.ok, 'it opens');
});
