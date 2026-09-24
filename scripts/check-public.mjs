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

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Generic shapes, checked against the private vault's real content: each catches what it names
// with little noise, so a hit is worth stopping for.
const LINE_RULES = [
  ['anthropic-key', /sk-ant-[\w-]{20,}/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36}\b/],
  ['github-pat', /github_pat_\w{50,}/],
  ['aws-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['slack-token', /\bxox[baprs]-[\w-]{10,}/],
  ['private-key-block', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['wireguard-key', /^\s*(?:PrivateKey|PresharedKey)\s*=\s*[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=/],
  // Passwords are usually too plain for an entropy check; these are the shapes they get written in.
  ['sudo-password-pipe', /\becho\s+(?!\$)\S+\s*\|\s*sudo\s+-S\b/],
  ['login-user-slash-password', /\blogin\s+\**(?:`[\w.-]+`\s*\/\s*`[^`\s]+`|[\w.-]+\/[^\s/)]+)/],
  ['private-ipv4', /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/],
  ['ipv6-ula', /(?<![0-9a-f:])f[cd][0-9a-f]{2}(?::[0-9a-f]{0,4}){2,7}/i],
  ['ipv6-global', /\b(?!2001:db8)[23][0-9a-f]{3}(?::[0-9a-f]{1,4}){3,7}/i],
  ['windows-machine-name', /\bDESKTOP-[A-Z0-9]{7}\b/],
  ['windows-home-path', /\b[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|<|\.\.\.|…)[^\\/\s"'`<]+/i],
  ['mac-home-path', /\/Users\/(?!Shared\b)[A-Za-z0-9._-]+/],
  ['linux-home-path', /\/home\/(?!user\b|runner\b)[a-z_][a-z0-9_-]*/],
  ['ios-device-id', /\b0000\d{4}-[0-9A-F]{16}\b/],
];
const SECRET_FILE = /(^|\/)\.env(\.(?!example$)|$)|\.(pem|key|p12|pfx)$/i;

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
