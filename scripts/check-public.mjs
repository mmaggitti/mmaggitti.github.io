#!/usr/bin/env node
// Pre-publish guard. Everything in this repo, and on the site it deploys, is public — so nothing
// private may be committed here: credentials, home-network addresses, machine names, personal paths.
//
//   node scripts/check-public.mjs          scan this repo (tracked + untracked, minus .gitignore)
//   node scripts/check-public.mjs <dir>    scan another git checkout or a subfolder of one
//   node scripts/check-public.mjs --hook   Claude Code PreToolUse hook: block `git commit` / `git push`
//
// Findings print as `path:line  rule` and NEVER include the matched text, so a CI log or a chat
// transcript can't become the leak. A line containing `public-ok` is exempt — use it for a real
// false positive, never to wave a secret through.
//
// PUBLIC_GUARD_DENY — private terms to block (known passwords, machine names, address prefixes),
// one per line or comma-separated. It lives in the cloud environment's settings and in an Actions
// secret, never in a file here: a deny list committed to a public repo would publish the list.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINE_RULES, SECRET_FILE } from './lib/public-rules.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function denyTerms() {
  const raw = process.env.PUBLIC_GUARD_DENY ?? '';
  const parts = raw.includes('\n') ? raw.split(/\r?\n/) : raw.split(',');
  // Under 3 characters would match nearly everything.
  return parts.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3);
}

function listFiles(dir) {
  const out = execFileSync('git', ['-C', dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  // --cached lists files deleted from the working tree too; only scan what exists.
  return [...new Set(out.split('\0').filter(Boolean))].filter((f) => {
    try {
      return statSync(join(dir, f)).isFile();
    } catch {
      return false;
    }
  });
}

function scan(dir) {
  const terms = denyTerms();
  const findings = [];
  for (const file of listFiles(dir)) {
    if (SECRET_FILE.test(file)) findings.push(`${file}  secret-file-name`);
    terms.forEach((t, i) => {
      if (file.toLowerCase().includes(t)) findings.push(`${file}  deny-list term #${i + 1} (in path)`);
    });
    const buf = readFileSync(join(dir, file));
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, n) => {
      if (line.includes('public-ok')) return;
      for (const [rule, re] of LINE_RULES) if (re.test(line)) findings.push(`${file}:${n + 1}  ${rule}`);
      const lower = line.toLowerCase();
      terms.forEach((t, i) => {
        if (lower.includes(t)) findings.push(`${file}:${n + 1}  deny-list term #${i + 1}`);
      });
    });
  }
  return { findings, denyListSet: terms.length > 0 };
}

function report({ findings, denyListSet }, stream) {
  if (!denyListSet) {
    stream.write('check-public: PUBLIC_GUARD_DENY is not set — only the generic rules ran.\n');
  }
  if (findings.length) {
    stream.write(`check-public: ${findings.length} finding(s) — this repo is public:\n`);
    for (const f of findings) stream.write(`  ${f}\n`);
    stream.write('Remove or generalize each one. Mark a proven false positive with `public-ok` on that line.\n');
  }
}

async function hook() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let command = '';
  try {
    command = JSON.parse(input).tool_input?.command ?? '';
  } catch {
    return 0;
  }
  if (!/\bgit\b[\s\S]*\b(?:commit|push)\b/.test(command)) return 0;
  const result = scan(REPO);
  if (!result.findings.length) return 0;
  process.stderr.write('Blocked by the public-repo guard (scripts/check-public.mjs).\n');
  report(result, process.stderr);
  return 2; // exit 2 = block the tool call and hand stderr to Claude
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--hook') {
    process.exitCode = await hook();
  } else {
    const dir = resolve(process.argv[2] ?? REPO);
    const result = scan(dir);
    report(result, result.findings.length ? process.stderr : process.stdout);
    if (!result.findings.length) console.log(`check-public: clean (${dir})`);
    process.exitCode = result.findings.length ? 1 : 0;
  }
}
