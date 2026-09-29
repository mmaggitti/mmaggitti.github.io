// The served-SVG gate (scripts/check-library.mjs), run as CI runs it, on planted files: a copy of
// the script and the profile in a temporary tree shaped like the repo checks that tree's library
// (source mode) or a planted built site (--site). Every .svg a page can serve must be inert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPTS = ['scripts/check-library.mjs', 'scripts/lib/svg-profile.mjs', 'scripts/lib/svg-profile-tables.mjs'];
// Spelled in two parts so this file never holds the keyword the site's own gate refuses under /draw/.
const SAME_ORIGIN = 'allow-' + 'same-origin';
const INERT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2a9d8f"/></svg>\n';

/** Plants `files` (repo-relative path → text) around copies of the gate, runs it with `args`, and cleans up. */
function library(files: Record<string, string>, args: string[] = []): { code: number; findings: string[]; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'draw-library-'));
  try {
    const plant = (rel: string, text: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    for (const rel of SCRIPTS) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      copyFileSync(join(REPO, rel), join(root, rel));
    }
    for (const [rel, text] of Object.entries(files)) plant(rel, text);
    let code = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [join(root, 'scripts/check-library.mjs'), ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      code = err.status;
      out = `${err.stdout}${err.stderr}`;
    }
    const findings = out.split('\n').map((l) => l.trim()).filter((l) => /^\S+\s+\S+$/.test(l) && !l.startsWith('check-library')).map((l) => l.replace(/\s+/, ' '));
    return { code, findings: findings.sort(), out };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('check-library refuses a library .svg that is not inert (a script, a handler, a remote image), an active file and a raw sidecar; inert files pass', () => {
  const lib = 'projects/draw/public/library';
  const r = library({
    [`${lib}/designs/leaf.svg`]: INERT,
    [`${lib}/designs/leaf.draw.json`]: '{"source":"\\u003csvg/>"}\n',
    [`${lib}/designs/script.svg`]: '<svg xmlns="http://www.w3.org/2000/svg">\n<script>alert(1)</script></svg>\n',
    [`${lib}/designs/handler.svg`]: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>\n',
    [`${lib}/designs/beacon.svg`]: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/p.png" width="1" height="1"/></svg>\n',
    [`${lib}/designs/page.html`]: '<p>hi</p>\n',
    [`${lib}/designs/raw.draw.json`]: '{"source":"<svg/>"}\n',
  });
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(r.findings, [
    `${lib}/designs/beacon.svg:1 svg-profile/url`,
    `${lib}/designs/handler.svg:1 svg-profile/event-handler`,
    `${lib}/designs/page.html library/extension`,
    `${lib}/designs/raw.draw.json library/json-raw-less-than`,
    `${lib}/designs/script.svg:2 svg-profile/element:script`,
  ].sort());
});

test('check-library --site: every .svg anywhere on the built site must be inert, and /draw/ serves no active library file and no same-origin sandbox', () => {
  const bad = library({
    '_site/hello/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>\n',
    '_site/svg-lab/lab.svg': INERT,
    '_site/draw/library/designs/leaf.svg': INERT,
    '_site/draw/library/designs/run.js': 'alert(1)\n',
    '_site/draw/assets/app.js': `const s = '${SAME_ORIGIN}';\n`,
  }, ['--site', '_site']);
  assert.equal(bad.code, 1, bad.out);
  assert.deepEqual(bad.findings, [
    '_site/draw/assets/app.js sandbox/allow-same-origin',
    '_site/draw/library/designs/run.js library/active-file',
    '_site/hello/icon.svg:1 svg-profile/event-handler',
  ].sort());

  const good = library({ '_site/hello/icon.svg': INERT, '_site/draw/library/designs/leaf.svg': INERT, '_site/draw/assets/app.js': 'export {};\n' }, ['--site', '_site']);
  assert.equal(good.code, 0, good.out);
  assert.match(good.out, /check-library: clean \(served site\)/);
});
