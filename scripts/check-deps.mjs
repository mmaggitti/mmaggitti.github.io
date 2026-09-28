#!/usr/bin/env node
// Dependency check for Core & Seams apps: every direct dependency is in the register, pinned exactly.
//
//   node scripts/check-deps.mjs          exit 1 on findings
//
// The register is core-and-seams/DEPENDENCIES.md (published from the Core & Seams system). A project
// is a Core & Seams app when it has projects/<name>/core-and-seams.json. For those apps:
//   - package.json dependencies and devDependencies: registered, and an exact version (no ^ ~ * ranges);
//   - every Cargo.toml under the app (not target/ or node_modules/): registered, and "=x.y.z"
//     unless it is a local path or workspace dependency.
// For the site: every `uses:` in .github/workflows/*.yml must be registered.
// Other projects keep their own rules; this check only reads the apps that opt in.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTER = join(ROOT, 'core-and-seams', 'DEPENDENCIES.md');
const findings = [];

// Register: every backticked name in the first cell of a table row, unless its row says "retired".
const registered = new Set();
if (existsSync(REGISTER)) {
  for (const line of readFileSync(REGISTER, 'utf8').split('\n')) {
    if (!line.startsWith('|') || /^\|\s*-/.test(line) || /\bretired\b/.test(line)) continue;
    const first = line.split('|')[1] ?? '';
    for (const m of first.matchAll(/`([^`]+)`/g)) registered.add(m[1].trim());
  }
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!['node_modules', 'target', 'dist', '.git', 'gen'].includes(e.name)) yield* walk(join(dir, e.name));
    } else yield join(dir, e.name);
  }
}

// Minimal Cargo.toml reading: dependency sections and their entries, one entry per line.
function cargoDeps(file) {
  const deps = [];
  let section = null;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const h = header[1];
      const table = /^(?:target\.[^.]+(?:\.[^.]+)*?\.)?(?:workspace\.)?(dependencies|dev-dependencies|build-dependencies)(?:\.(.+))?$/.exec(h);
      section = table ? { kind: table[1], single: table[2] ?? null } : null;
      if (section?.single) deps.push({ name: section.single.replace(/"/g, ''), spec: '(table)', file });
      continue;
    }
    if (!section || section.single || !line) continue;
    const entry = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (entry) deps.push({ name: entry[1], spec: entry[2], file });
  }
  return deps;
}

const apps = existsSync(join(ROOT, 'projects'))
  ? readdirSync(join(ROOT, 'projects')).filter((n) => existsSync(join(ROOT, 'projects', n, 'core-and-seams.json')))
  : [];
if (apps.length && !existsSync(REGISTER)) findings.push('core-and-seams/DEPENDENCIES.md is missing (publish Core & Seams first)');

for (const app of apps) {
  const dir = join(ROOT, 'projects', app);
  for (const file of walk(dir)) {
    const rel = relative(ROOT, file);
    if (file.endsWith('package.json') && statSync(file).isFile()) {
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (!registered.has(name)) findings.push(`${rel}: ${name} is not in the register`);
        if (!/^\d+\.\d+\.\d+([-+].*)?$/.test(version)) findings.push(`${rel}: ${name}@${version} is not an exact version`);
      }
    }
    if (file.endsWith('Cargo.toml')) {
      for (const { name, spec } of cargoDeps(file)) {
        if (/\bpath\s*=|\bworkspace\s*=\s*true/.test(spec)) continue; // local crate or declared at the workspace
        if (!registered.has(name)) findings.push(`${rel}: ${name} is not in the register`);
        const version = /^"([^"]+)"$/.exec(spec)?.[1] ?? /\bversion\s*=\s*"([^"]+)"/.exec(spec)?.[1];
        if (spec !== '(table)' && !(version ?? '').startsWith('=')) findings.push(`${rel}: ${name} = ${spec} is not pinned with "="`);
      }
    }
  }
}

const workflows = join(ROOT, '.github', 'workflows');
if (existsSync(workflows)) {
  for (const f of readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f))) {
    readFileSync(join(workflows, f), 'utf8').split('\n').forEach((line, i) => {
      const m = /^\s*-?\s*uses:\s*([^@\s]+)@/.exec(line);
      if (m && !registered.has(m[1])) findings.push(`.github/workflows/${f}:${i + 1}: action ${m[1]} is not in the register`);
    });
  }
}

if (findings.length) {
  console.error(`check-deps: ${findings.length} finding(s) — register each dependency in Core & Seams' DEPENDENCIES.md and republish:`);
  for (const f of findings) console.error(`  ${f}`);
  process.exitCode = 1;
} else {
  console.log(`check-deps: clean — ${apps.length} Core & Seams app(s), ${registered.size} registered name(s)`);
}
