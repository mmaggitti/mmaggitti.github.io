#!/usr/bin/env node
// Library and served-SVG gate. Everything under /draw/library/ is public and served, and every
// .svg on this site can be opened as a document on the shared origin, where its scripts would run.
//
//   node scripts/check-library.mjs              source mode: projects/draw/public/library/
//   node scripts/check-library.mjs --site _site site mode: every .svg in the built site, plus
//                                               no active files under /draw/library/ and no
//                                               'allow-same-origin' anywhere under /draw/ (its
//                                               script preview must stay an opaque origin)
//
// The rules live in scripts/lib/ so Draw's pre-save checks run the identical code before a save
// commits (a commit to this public repo is published even if this gate later blocks the deploy).
// Findings print as `path:line  rule`, never the matched text.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSvg } from './lib/svg-profile.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIBRARY = join(ROOT, 'projects', 'draw', 'public', 'library');

// What may live in the library. Never: html, xml, xsl, js, css, svgz, pdf (anything a browser
// would run or render as an active document).
const ALLOWED_EXT = /\.(svg|json|woff2|woff|ttf|otf|png|jpe?g|webp|gif)$/i;
const LICENSE_TXT = /(^|[\\/])(OFL|LICEN[CS]E)[\w.-]*\.txt$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const TEXT_EXT = /\.(html?|js|mjs|css|svg|json|txt|xml|webmanifest|map)$/i;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // absent folder: nothing to check
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

function svgFindings(file) {
  return checkSvg(readFileSync(file, 'utf8')).map((f) => `${f.line}  svg-profile/${f.rule}`);
}

function sourceMode() {
  const out = [];
  for (const file of walk(LIBRARY)) {
    const rel = relative(ROOT, file);
    const name = file.split(sep).pop();
    if (!ALLOWED_EXT.test(name) && !LICENSE_TXT.test(name)) { out.push(`${rel}  library/extension`); continue; }
    const stem = name.replace(/(\.draw)?\.[^.]+$/, '');
    if (!LICENSE_TXT.test(name) && name !== 'font.json' && !SLUG.test(stem)) out.push(`${rel}  library/slug`);
    if (/\.svg$/i.test(name)) for (const f of svgFindings(file)) out.push(`${rel}:${f}`);
    if (/\.json$/i.test(name)) {
      const text = readFileSync(file, 'utf8');
      try {
        JSON.parse(text);
      } catch {
        out.push(`${rel}  library/json-parse`);
      }
      // Sidecars carry full-fidelity source; every '<' is escaped (<) so no sniffer sees markup.
      if (text.includes('<')) out.push(`${rel}  library/json-raw-less-than`);
    }
  }
  return out;
}

function siteMode(siteDir) {
  const site = resolve(siteDir);
  const out = [];
  for (const file of walk(site)) {
    const rel = relative(ROOT, file);
    if (/\.svg$/i.test(file)) for (const f of svgFindings(file)) out.push(`${rel}:${f}`);
    if (file.startsWith(join(site, 'draw', 'library') + sep) && /\.(html?|xhtml|xml|xsl|js|mjs|css|svgz|pdf)$/i.test(file)) {
      out.push(`${rel}  library/active-file`);
    }
    // Draw's preview runs document scripts; with allow-same-origin a sandboxed frame could reach
    // the site's storage. (SVG Lab's inert sandbox="allow-same-origin" without allow-scripts is
    // fine, which is why this is scoped to /draw/.)
    if (file.startsWith(join(site, 'draw') + sep) && TEXT_EXT.test(file) && statSync(file).size < 20e6 && readFileSync(file, 'utf8').includes('allow-same-origin')) {
      out.push(`${rel}  sandbox/allow-same-origin`);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--site');
  const findings = i === -1 ? sourceMode() : siteMode(process.argv[i + 1] ?? '_site');
  const what = i === -1 ? 'library sources' : 'served site';
  if (findings.length) {
    console.error(`check-library: ${findings.length} finding(s) in the ${what}:`);
    for (const f of findings) console.error(`  ${f}`);
    console.error('A served .svg must be inert (scripts/lib/svg-profile.mjs); see the Draw section of CLAUDE.md.');
    process.exitCode = 1;
  } else {
    console.log(`check-library: clean (${what})`);
  }
}
