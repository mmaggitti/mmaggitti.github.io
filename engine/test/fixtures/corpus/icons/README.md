# Icon corpus

Real-world icons for the round-trip test (`engine/test/xml.test.ts`). Six open-source sets, 25
icons each, taken from their npm packages. **The files are unmodified**: byte for byte as
published, which is the point of a round-trip corpus.

| Folder | npm package | Version | License | Source folder in the package |
|---|---|---|---|---|
| `lucide/` | `lucide-static` | 1.48.0 | ISC (Feather-derived icons MIT) | `icons/` |
| `feather/` | `feather-icons` | 4.29.2 | MIT | `dist/icons/` |
| `tabler/` | `@tabler/icons` | 3.48.0 | MIT | `icons/outline/` |
| `heroicons/` | `heroicons` | 2.2.0 | MIT | `24/outline/` |
| `bootstrap/` | `bootstrap-icons` | 1.13.1 | MIT | `icons/` |
| `simple-icons/` | `simple-icons` | 16.33.0 | CC0-1.0 | `icons/` |

Each folder's `LICENSE.txt` is that package's license file, copied as-is (simple-icons ships it
as `LICENSE.md`). Simple Icons' marks remain trademarks of their brands; they are here only as
test data for the parser.

**Selection is deterministic.** For a set of `n` `.svg` files, sorted by filename (JavaScript's
default string sort), take indices `0, N, 2N, … 24N` with `N = floor(n / 25)`. Nothing was
hand-picked or skipped.
