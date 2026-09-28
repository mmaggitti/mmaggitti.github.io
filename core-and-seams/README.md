# core-and-seams/ — generated, do not edit

Published outputs of **Core & Seams**, the design system for this site's Rust/WASM + TypeScript apps.
Everything here is generated or copied by the system's `tools/publish.mjs`; edits made here are
lost on the next publish.

- `index.html` + `specimen/` — the specimen page, served at [/core-and-seams/](https://mmaggitti.github.io/core-and-seams/)
- `generated/core-and-seams.css` — tokens, dark mode, density, base rules
- `generated/components.css` — the `cs-` components
- `generated/hues/<name>.css` — per-app accent ramps
- `generated/tokens.ts`, `generated/tokens.js` — the same tokens as modules
- `fonts/` — Inter (OFL, see `fonts/OFL-Inter.txt`)
- `DEPENDENCIES.md` — the dependency register `scripts/check-deps.mjs` enforces for Core & Seams apps

An app links `/core-and-seams/generated/core-and-seams.css`, `components.css` and its hue, or
imports them from `../../core-and-seams/generated/` so its build bundles them.
