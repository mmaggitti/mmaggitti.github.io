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

## Modules

| Folder | What it does |
|---|---|
| `xml/` | Lossless lexer and CST: tokens tile the source, so `serialize(parse(x)) === x`. Entity expansion is capped at 1 MB and depth 8. |
| `model/` | The document over the CST: stable NodeIds, namespaces resolved by URI, edits that change only their own bytes. `refs.ts` indexes ids and every reference to them. |
| `values/` | Numbers as Draw writes them (`fmt`: no exponents, no dotted runs), lengths, CSS Color 4, paint, viewBox and preserveAspectRatio, affine matrices, transform lists. |
| `path/` | Path data: a lossless parser (text after an error is kept), edits that touch one number, absolute form, arcs, exact bounds and nearest point. |
| `ledger/` | The support ledger. |

## The round-trip corpus

`test/fixtures/corpus/` holds 252 files that must open and save byte for byte:
- `icons/`: 150 unmodified icons from six open-source sets, with their licenses.
- `lab/`: every SVG Lab screen, mode and Create template, downloaded by
  `projects/draw/tools/capture-lab-corpus.mjs`.
- `tools/`: 36 hand-written files in the shapes Inkscape, Illustrator, Figma, Sketch, SVGO, draw.io
  and others produce, plus XML edge cases.

Their exact bytes are the test (CRLF, lone CR, tabs, a BOM), so `.gitattributes` there turns off
line-ending conversion.

## Open findings (engine/xml and engine/model)

The P0-M1 review found these. They are not fixed yet:
- **Well-formedness is looser than a browser's.** Duplicate attributes, a bare `&`, `--` in a
  comment, an unbound prefix, an XML declaration after the start, a lowercase `<!doctype`, and
  non-XML whitespace outside the root are accepted. Browsers refuse these files.
- **A processing instruction inside the DOCTYPE** that contains `]` or `'` fails to parse.
- **No XML line-end or attribute-value normalization** when values are decoded. The corpus test
  for it is marked `todo`.
- **An entity whose text holds markup** reads as text in the model, but browsers build elements
  from it. The served profile refuses every DOCTYPE, so served files are unaffected. The canvas
  classifier must handle it.
- **Entity decoding:** a name like `&toString;` matches an inherited object property, and reads
  after parsing draw down the document's expansion budget.
- **`refs.ts`** misses percent-encoded fragments and quoted `url()` values with spaces.
