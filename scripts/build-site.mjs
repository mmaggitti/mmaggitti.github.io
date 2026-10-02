#!/usr/bin/env node
// Builds every projects/<name>/ into _site/<name>/ and writes the launcher at _site/index.html.
//
//   static project — no "build" script in its package.json: copied as-is
//   built project  — `npm ci` (or `npm install` without a lockfile), then `npm run build` with
//                    BASE_PATH=/<name>/, then its dist/ is copied. Vite reads it as
//                    `base: process.env.BASE_PATH ?? "/"`, or every asset 404s under /<name>/.
//
// Folders starting with "_" or "." are drafts and are skipped. The launcher is generated from each
// project's built <title> and <meta name="description">, so it can't drift from the projects.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECTS = join(ROOT, 'projects');
const OUT = join(ROOT, '_site');
// Paths a project can't take: crossword-v1 and ios-html-viewer are served by their own repos on this
// origin (project sites win over the user site), ds/ is the shared design system, and core-and-seams/
// holds the published outputs of Core & Seams, the design system for Rust/WASM + TypeScript apps.
const RESERVED = new Set(['crossword-v1', 'ios-html-viewer', 'ds', 'core-and-seams']);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
cpSync(join(ROOT, 'ds'), join(OUT, 'ds'), { recursive: true });
// Core & Seams is published into core-and-seams/ from its private source; served as-is (its README
// stays out of the site).
cpSync(join(ROOT, 'core-and-seams'), join(OUT, 'core-and-seams'), { recursive: true, filter: (p) => !p.endsWith(`${sep}README.md`) });

const names = existsSync(PROJECTS)
  ? readdirSync(PROJECTS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !/^[_.]/.test(d.name))
      .map((d) => d.name)
      .sort()
  : [];

const cards = [];
for (const name of names) {
  if (RESERVED.has(name)) throw new Error(`projects/${name}: that path is reserved`);
  // Pages is case-sensitive and macOS is not; lowercase-only names avoid a local-works/live-404 split.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`projects/${name}: use lowercase letters, digits, hyphens`);

  const src = join(PROJECTS, name);
  const dest = join(OUT, name);
  const pkgFile = join(src, 'package.json');
  const pkg = existsSync(pkgFile) ? JSON.parse(readFileSync(pkgFile, 'utf8')) : null;

  if (pkg?.scripts?.build) {
    const npm = (args) =>
      execFileSync('npm', args, { cwd: src, stdio: 'inherit', env: { ...process.env, BASE_PATH: `/${name}/` } });
    npm(existsSync(join(src, 'package-lock.json')) ? ['ci'] : ['install']);
    npm(['run', 'build']);
    cpSync(join(src, 'dist'), dest, { recursive: true });
  } else {
    // Tests aren't served (a built project ships only dist/, so the same holds there).
    const tests = join(src, 'test');
    cpSync(src, dest, { recursive: true, filter: (p) => !p.includes(`${sep}node_modules`) && p !== tests && !p.startsWith(tests + sep) });
  }

  const entry = join(dest, 'index.html');
  if (!existsSync(entry)) throw new Error(`projects/${name}: no index.html in the built output`);
  const html = readFileSync(entry, 'utf8');
  cards.push({
    name,
    title: html.match(/<title>([^<]*)<\/title>/i)?.[1].trim() || name,
    description:
      html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)?.[1] ??
      html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i)?.[1] ??
      '',
    // <meta name="launcher" content="unlisted">: built, deployed and tested, but not on the launcher
    // (a project that is live for testing before its release).
    unlisted: /<meta\s+name=["']launcher["']\s+content=["']unlisted["']/i.test(html),
  });
  console.log(`built ${name}`);
}

// The launcher (and the Studio's page picker) lists projects in the order they were created, oldest
// first: the order of their first commits in this repo (lean-keypoint-math counts from its first
// commit under lean/keypoint-math, before it moved). Add a new project's name at the end; a name
// missing here sorts after all of these.
const CREATED = ['hello', 'studio', 'svg-lab', 'draw', 'cs-probe', 'tetons', 'cad-kernel', 'lean-keypoint-math', 'flow', 'cowrite'];
const rank = (name) => (CREATED.includes(name) ? CREATED.indexOf(name) : CREATED.length);
cards.sort((a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

writeFileSync(join(OUT, 'index.html'), launcher(cards.filter((c) => !c.unlisted)));
// The studio's page picker reads this. Left out: the studio (it can't inspect itself), Draw (an
// editor, not a page to inspect; the studio's tree doesn't follow its shadow-root canvas) and
// unlisted projects.
const NOT_FRAMED = new Set(['studio', 'draw']);
const pages = [
  { path: '/', title: 'Projects' },
  { path: '/ds/', title: 'Design system' },
  { path: '/core-and-seams/', title: 'Core & Seams' },
  ...cards.filter((c) => !NOT_FRAMED.has(c.name) && !c.unlisted).map((c) => ({ path: `/${c.name}/`, title: c.title })),
];
writeFileSync(join(OUT, 'pages.json'), JSON.stringify(pages, null, 2) + '\n');
console.log(`launcher: ${cards.filter((c) => !c.unlisted).length} project(s) → _site/index.html (${cards.filter((c) => c.unlisted).length} unlisted)`);

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function launcher(cards) {
  const items = cards.length
    ? cards
        .map(
          (c) => `      <li><a class="ds-card" href="${esc(c.name)}/">
        <span class="ds-card-title">${esc(c.title)}</span>${c.description ? `
        <span class="ds-card-text">${esc(c.description)}</span>` : ''}
      </a></li>`,
        )
        .join('\n')
    : '      <li class="ds-muted">No projects yet.</li>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#F6F4EE" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#111111" media="(prefers-color-scheme: dark)">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="description" content="Phone-first mini projects.">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23233044'/%3E%3Crect x='14' y='14' width='16' height='16' rx='4' fill='%23fff'/%3E%3Crect x='34' y='14' width='16' height='16' rx='4' fill='%23fff' opacity='.45'/%3E%3Crect x='14' y='34' width='16' height='16' rx='4' fill='%23fff' opacity='.45'/%3E%3Crect x='34' y='34' width='16' height='16' rx='4' fill='%23fff' opacity='.45'/%3E%3C/svg%3E">
  <link rel="stylesheet" href="/ds/ds.css">
  <title>Projects</title>
  <!-- Generated by scripts/build-site.mjs — edit the generator, not this file. -->
</head>
<body>
  <div class="ds-app">
    <main class="ds-page">
      <h1 class="ds-title">Projects</h1>
      <p class="ds-sub">Phone-first mini projects.</p>
      <ul class="ds-cards">
${items}
      </ul>
      <p class="ds-small"><a class="ds-muted" href="ds/" style="display:inline-flex;align-items:center;min-height:var(--tap-min)">Design system</a></p>
    </main>
  </div>
</body>
</html>
`;
}
