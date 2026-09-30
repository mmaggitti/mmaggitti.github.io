// The probe helpers' own rules (test/probe-helpers/xml-canon.mjs): what the e2e excuses between
// Draw's parser and a browser's is narrow, so a known difference never hides a real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonDiffs, engineCanon, KNOWN, PROBES, probeProblems } from '../probe-helpers/xml-canon.mjs';

const probes: any[] = PROBES;
const svgText = (t: string) => `<svg xmlns="http://www.w3.org/2000/svg"><text>${t}</text></svg>`;

test("the canon's line-end rule: a text run that differs from the engine's only by a CR before LF is WebKit's known difference, and any other difference is still named", () => {
  const engine: any = engineCanon(svgText('a\nb'));
  const browser = (t: string) => {
    const b = structuredClone(engine);
    delete b.known;
    b.root.kids[0].kids[0].t = t;
    return b;
  };
  assert.deepEqual(canonDiffs(engine, browser('a\nb')), []);
  assert.deepEqual(canonDiffs(engine, browser('a\r\nb')), [], 'a CR kept before an LF (KNOWN cdata-line-ends)');
  assert.equal(canonDiffs(engine, browser('a\r\nc')).length, 1, 'a CR and another difference');
  assert.equal(canonDiffs(engine, browser('a\rb')).length, 1, 'a lone CR');
  assert.equal(canonDiffs(engine, browser('a\r\n\nb')).length, 1, 'an extra line');
  assert.ok(KNOWN.some((k: any) => k.id === 'cdata-line-ends'));
});

test("a probe's known browser defect excuses only that engine's refusal: the verdict must still match the table, and every other engine is held to the rule", () => {
  const excused = probes.filter((p) => p.knownDefect);
  assert.ok(excused.length > 0, 'a probe names a known defect');
  for (const p of excused) {
    for (const [engine, id] of Object.entries(p.knownDefect)) assert.ok(KNOWN.some((k: any) => k.id === id), `${p.label}: ${engine}'s ${id} is in KNOWN`);
  }
  const accepts = { refused: false };
  const refuses = { refused: true, message: 'refused' };
  const probe = excused.find((p) => p.knownDefect.webkit && p.browser.webkit === 'refuse' && p.draw === 'accept');
  assert.ok(probe, 'a probe WebKit refuses and Draw accepts');
  assert.deepEqual(probeProblems(probe, 'webkit', accepts, refuses), [], 'WebKit refuses it, as the table says: excused');
  assert.equal(probeProblems(probe, 'webkit', accepts, accepts).length, 1, 'a WebKit that accepts it no longer matches the table, and that is named');
  assert.ok(probeProblems(probe, 'chromium', accepts, refuses).some((p) => p.includes("chromium refuses it, but Draw's parser accepts it")), 'Chromium is not excused');
  const plain = probes.find((p) => !p.knownDefect && p.draw === 'accept');
  for (const engine of ['chromium', 'webkit']) {
    assert.ok(probeProblems(plain, engine, accepts, refuses).some((p) => p.includes(`${engine} refuses it, but Draw's parser accepts it`)), `${engine} is held to the rule on an ordinary probe`);
  }
});
