# Core & Seams — dependency register

Every third-party dependency an app declares directly, whether a crate, an npm package, a GitHub
Action, a downloaded tool or a vendored asset, is listed here before it is merged. Transitive
dependencies are covered by the committed lockfiles, not by this register.

The public site repo gets a copy of this file (published by `tools/publish.mjs`).
`scripts/check-deps.mjs` fails CI when a project declares a direct dependency that isn't listed.

## Admission test

A dependency earns its place only if **all** of these hold:

1. **The afternoon test fails:** we could not write and test what we use of it in an afternoon.
   Or it is a platform we build on (a compiler, a runtime, a shell).
2. **It is pinned exactly:** `=x.y.z` in Cargo, an exact version in `package.json`, a full tag or
   SHA for Actions, and a checksum for downloaded binaries.
3. **Its licence allows publishing:** MIT, Apache-2.0, BSD, ISC, OFL or Zlib. Anything copyleft
   (LGPL, MPL, GPL, AGPL) needs its own ADR.
4. **It sits behind a seam or at the edge.** A core crate (`-core`) has no dependencies unless an
   ADR says otherwise.

Status: **adopted** (in use), **planned** (named by the approved plan, not yet added),
**dev** (tests and tooling only; never shipped), **retired**.

---

## Rust crates

| Crate | Pin | Status | Used by | Why it's here | Afternoon test | Revisit when |
|---|---|---|---|---|---|---|
| `wasm-bindgen` | `=0.2.129` | adopted (S3) | every `-wasm` crate | The Rust↔JS binding (ADR-003); shared with cad-kernel | Fails: glue generation, type descriptors, the CLI | ADR-003's trigger |
| `js-sys` / `web-sys` | lockstep `0.3.106` | planned, only if a crate calls browser APIs | `-wasm` crates that need them | Typed browser API bindings | Fails: API surface | A crate uses them for one call; replace it with a JS import |
| `fsrs` | `=6.6.2`, no features | **retired** 2026-09-28 | was `projects/srs/tools/fsrs-vectors` only | The oracle for the FSRS-6 port (ADR-013). Retired with the Flashcards app, which Mark deleted | — | An app ports FSRS again |
| `tauri`, `tauri-build` | `=2.12.0`, `=2.7.0` | adopted (S3; built on the Mac in S6) | `src-tauri/` | The native shell (platform) | Fails: platform | Tauri 3 stable |
| `tauri-plugin-dialog` | `=2.8.0` | adopted (S3; built in S6) | `src-tauri/` | Native file pickers for the files seam | Fails: platform bindings | The files seam gets a native Swift plugin |
| `objc2` | `=0.6.4` | adopted (S3; built in S6), iOS only | `src-tauri/` | The iOS scroll-view inset fix (the second full-screen fix) | Fails: safe Obj-C messaging | wry sets `contentInsetAdjustmentBehavior` itself |

## npm packages

| Package | Pin | Status | Used by | Why it's here | Afternoon test | Revisit when |
|---|---|---|---|---|---|---|
| `vite` | `8.3.1` | adopted (S3) | `web/` | Dev server and bundler; the site's built-project contract | Fails: platform | — |
| `typescript` | `7.0.2` | adopted (S3) | `web/` | Type checking | Fails: platform | — |
| `react`, `react-dom` | `19.3.0` | adopted (S3) | `web/panels/` only | Panels (ADR-004) | Fails: reconciler, focus management | ADR-004's trigger |
| `@types/react`, `@types/react-dom` | `19.3.0` | **dev** (S3) | `web/` type checking | React's types; the React packages ship none | Fails: the whole JSX and DOM type surface | React ships its own types, or React leaves (ADR-004) |
| `three` | exact, 0.186.x | planned (S5) | renderer seam | Default renderer: WebGPU with WebGL2 fallback, picking, clipping | Fails: two GPU backends | A second renderer ships |
| `binaryen` | `132.0.0` | **dev** (S3) | `build.mjs` | `wasm-opt` for size (about 50% smaller measured) | Fails: an optimiser | wasm-bindgen gains an equivalent pass |
| `@tauri-apps/cli` | exact, 2.12.x | planned **dev** (S3/S6) | Tauri builds | Tauri's CLI | Fails: platform | Tauri 3 stable |

## GitHub Actions (site CI)

| Action | Pin | Status | Why it's here | Revisit when |
|---|---|---|---|---|
| `actions/checkout` | `v5` | adopted (site, predates Core & Seams) | Checks out the repo in CI | — |
| `actions/setup-node` | `v5` | adopted (site) | Node 22 and the npm cache in CI | — |
| `actions/configure-pages` | `v5` | adopted (site) | Pages deploy setup | Hosting moves off GitHub Pages |
| `actions/upload-pages-artifact` | `v3` | adopted (site) | Uploads `_site/` | Hosting moves off GitHub Pages |
| `actions/deploy-pages` | `v4` | adopted (site) | Deploys to Pages | Hosting moves off GitHub Pages |
| `Swatinem/rust-cache` | `6323deb102c322ba6fcbdcafc7e3dddab59af2b6` (v2.9.2) | adopted (S3) | Caches `target/` and the registry per Rust project; each uncached deploy otherwise adds 25–60 s | Deploy time stops mattering |

## Downloaded tools

| Tool | Pin | Status | Why it's here | How it's fetched | Revisit when |
|---|---|---|---|---|---|
| `wasm-bindgen-cli` | `0.2.129` (read from `Cargo.lock`), sha256 per platform in `build.mjs` | adopted (S3) | Must match the crate exactly | `build.mjs` downloads the GitHub release asset and checks its sha256. cargo-binstall fails through the cloud proxy | wasm-bindgen moves |

## Vendored assets

| Asset | Version | Licence | Status | Why it's here |
|---|---|---|---|---|
| Inter (variable, Latin subset, woff2) | 4.x, from `@fontsource-variable/inter` 5.3.0: `fonts/Inter-latin-wght-{normal,italic}.woff2`, 48 KB + 52 KB | OFL-1.1 (`fonts/OFL-Inter.txt`) | adopted (S1) | The UI face (Mark, 2026-09-28); self-hosted so apps work offline without a CDN |
| cad-kernel `cadk-wasm` built output | commit `f03dcbc` | Mark's own; the texts of its dependencies' licences (libm, robust, sha2, serde_json, spade, wasm-bindgen) ship beside it | planned (S5) | The CAD shell's kernel (ADR-011) |
