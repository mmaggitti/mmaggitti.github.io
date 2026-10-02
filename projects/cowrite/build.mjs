#!/usr/bin/env node
// Co-write build: Rust core → WebAssembly → Vite. The site's build-site.mjs runs it (npm run build)
// with BASE_PATH=/cowrite/; it runs the same in a cloud session, in CI and on a Mac.
//
//   node build.mjs                 lint + test the Rust, build the WASM, type-check, bundle, budgets
//   node build.mjs --set-budgets   same, then write budgets.json = measured + 10% (first build)
//
// Tools: the Rust toolchain comes from rust-toolchain.toml (rustup installs it); wasm-bindgen's CLI
// is downloaded at the exact version in Cargo.lock and checked against the sha256 sums below
// (the release publishes none); wasm-opt comes from the npm binaryen package.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = 'cowrite';
const WASM_CRATE = 'cowrite_wasm';
const PKG = join(HERE, 'web', 'pkg');
const DIST = join(HERE, 'dist');
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: HERE, stdio: 'inherit', env: { ...process.env, ...env } });
const step = (msg) => console.log(`\n[${APP}] ${msg}`);

// wasm-bindgen CLI release archives: sha256, recorded when the version was adopted (DEPENDENCIES.md).
const WASM_BINDGEN_SHA256 = {
  '0.2.129': {
    'x86_64-unknown-linux-musl': '82d12bb940e2d4e72e0d5605387fc1b8ca179044e012b620f0ce4e7440e8320e',
    'aarch64-unknown-linux-gnu': '1797c349a0f45d30946e8986b184135e12839ab576c9a04203e85febfc5dcb35',
    'aarch64-apple-darwin': '81d4a23d56b3c3eb8187658329116d50e0b228a93b343825fb71f70179051cd1',
    'x86_64-apple-darwin': '7e028879a68ec53dae14048b55cc5215f6df75b17a9c1426fac8fa086d3202fd',
  },
};

function lockedVersion(crate) {
  const lock = readFileSync(join(HERE, 'Cargo.lock'), 'utf8');
  const m = new RegExp(`name = "${crate}"\\nversion = "([^"]+)"`).exec(lock);
  if (!m) throw new Error(`${crate} is not in Cargo.lock`);
  return m[1];
}

function wasmBindgen() {
  const version = lockedVersion('wasm-bindgen');
  const target = {
    'linux-x64': 'x86_64-unknown-linux-musl',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
  }[`${process.platform}-${process.arch}`];
  const sha = WASM_BINDGEN_SHA256[version]?.[target];
  if (!target || !sha) {
    throw new Error(`no pinned wasm-bindgen ${version} for ${process.platform}-${process.arch}: add its sha256 to build.mjs, or run \`cargo install wasm-bindgen-cli --version =${version}\``);
  }
  const dir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'core-and-seams', `wasm-bindgen-${version}-${target}`);
  const bin = join(dir, `wasm-bindgen-${version}-${target}`, 'wasm-bindgen');
  if (existsSync(bin)) return bin;
  mkdirSync(dir, { recursive: true });
  const archive = join(dir, 'cli.tar.gz');
  const url = `https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${version}/wasm-bindgen-${version}-${target}.tar.gz`;
  execFileSync('curl', ['-sSfL', '--retry', '3', '-o', archive, url], { stdio: 'inherit' });
  const got = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (got !== sha) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`wasm-bindgen ${version} (${target}): sha256 ${got} does not match the pinned ${sha}`);
  }
  execFileSync('tar', ['-xzf', archive, '-C', dir]);
  chmodSync(bin, 0o755);
  return bin;
}

// Paths the build must not leave inside the .wasm (a public repo; Core & Seams DOCTRINE §8).
// rustc applies the LAST matching remap, so the most specific prefix goes last. There is no
// catch-all for the home folder on purpose: a path none of these cover fails the check below.
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
const rustupHome = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup');
const remap = [`--remap-path-prefix=${cargoHome}=/cargo`, `--remap-path-prefix=${rustupHome}=/rustup`, `--remap-path-prefix=${HERE}=/${APP}`];

step('Rust: clippy and tests (native)');
run('cargo', ['clippy', '--workspace', '--all-targets', '--locked', '--quiet', '--', '-D', 'warnings']);
run('cargo', ['test', '--workspace', '--locked', '--quiet']);

step('Rust → WebAssembly');
run('cargo', ['build', '--locked', '--quiet', '-p', `${APP}-wasm`, '--target', 'wasm32-unknown-unknown', '--profile', 'wasm'], {
  CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: remap.join(' '),
});
rmSync(PKG, { recursive: true, force: true });
run(wasmBindgen(), [join('target', 'wasm32-unknown-unknown', 'wasm', `${WASM_CRATE}.wasm`), '--out-dir', PKG, '--target', 'web']);
const wasmFile = join(PKG, `${WASM_CRATE}_bg.wasm`);
// wasm-bindgen drops the target_features section, so name the features Rust's wasm32-unknown-unknown
// enables by default (Rust 1.87+), exactly: enabling more could let wasm-opt emit instructions Safari
// lacks. All of these are in Safari since 15.x.
const RUST_WASM_FEATURES = ['bulk-memory', 'bulk-memory-opt', 'nontrapping-float-to-int', 'sign-ext', 'mutable-globals', 'reference-types', 'multivalue', 'call-indirect-overlong'];
run(join(HERE, 'node_modules', '.bin', 'wasm-opt'), ['-Oz', '--strip-debug', '--strip-producers', ...RUST_WASM_FEATURES.map((f) => `--enable-${f}`), wasmFile, '-o', wasmFile]);

const leaks = readFileSync(wasmFile).toString('latin1').match(/\/(?:Users|home)\/(?!runner\b)[A-Za-z0-9._-]+/g);
if (leaks) throw new Error(`${WASM_CRATE}_bg.wasm still holds a home path (${leaks.length} string(s)); check the --remap-path-prefix list (a RUSTFLAGS variable in the environment overrides it)`);

step('TypeScript and Vite');
run(join(HERE, 'node_modules', '.bin', 'tsc'), ['--noEmit']);
run(join(HERE, 'node_modules', '.bin', 'vite'), ['build']);

// Stamp the service worker with a build id derived from the output, so each deploy gets a fresh cache.
const files = [];
const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(DIST);
const idHash = createHash('sha256');
for (const f of files.sort()) idHash.update(f.slice(DIST.length)).update(readFileSync(f));
const buildId = idHash.digest('hex').slice(0, 12);
const sw = join(DIST, 'sw.js');
if (existsSync(sw)) writeFileSync(sw, readFileSync(sw, 'utf8').replaceAll('__BUILD_ID__', buildId));

step('Budgets (gzip -9 bytes; Pages serves gzip, not brotli)');
const gz = (ext) => files.filter((f) => f.endsWith(ext)).reduce((n, f) => n + gzipSync(readFileSync(f), { level: 9 }).length, 0);
const measured = { wasmGzip: gz('.wasm'), jsGzip: gz('.js'), cssGzip: gz('.css') };
const budgetsFile = join(HERE, 'budgets.json');
if (process.argv.includes('--set-budgets')) {
  const next = Object.fromEntries(Object.entries(measured).map(([k, v]) => [k, Math.ceil(v * 1.1)]));
  writeFileSync(budgetsFile, JSON.stringify({ $description: 'gzip -9 byte ceilings; build.mjs fails past them. Set at the first build + 10%.', ...next }, null, 2) + '\n');
  console.log(`budgets.json set: ${JSON.stringify(next)}`);
}
const budgets = JSON.parse(readFileSync(budgetsFile, 'utf8'));
let over = 0;
for (const [k, v] of Object.entries(measured)) {
  const limit = budgets[k];
  const ok = typeof limit === 'number' && v <= limit;
  if (!ok) over++;
  console.log(`  ${ok ? 'ok  ' : 'OVER'} ${k.padEnd(9)} ${String(v).padStart(8)} / ${limit ?? 'unset'}`);
}
if (over) throw new Error(`${over} budget(s) exceeded or unset — shrink the output, or raise budgets.json on purpose`);
console.log(`[${APP}] built dist/ (build ${buildId})`);
