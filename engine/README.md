# engine/

The SVG engine behind Draw (`projects/draw`), extracted from SVG Lab and generalized. It is the
plan's "shared modules": any project may import it, the way projects import `ds/ds.css`.

Rules, enforced by `projects/draw/tools/check-sinks.mjs`:

- **No DOM and no npm dependencies.** It runs under `node --test` and in a worker as well as the page.
- **Erasable TypeScript only** (no enums, namespaces or parameter properties), explicit `.ts`
  import extensions, and `import type` for types, so Node's built-in type stripping runs it as-is.
- **The ledger** (`ledger/ledger.json`) is the contract for what Draw supports. Rows are never
  deleted; a superseded row gets a note.

Tests live in `engine/test/` and run in Draw's build (`npm run test:unit` in `projects/draw`).
