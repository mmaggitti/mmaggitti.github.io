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
| `model/fragment.ts` | Edit source: markup parsed into an existing document, with the namespaces and entities in scope there. |
| `commands/` | Every edit as a reversible op; transactions, undo and redo, and drags that commit as one history entry. Undo restores byte-identical source (10k seeded sequences). |
| `code/` | The code panel's typed tokens (numbers, colours, keywords, text, references) with spans into the raw text, so a token edit rewrites only that token's bytes. |
| `policy/` | What the canvas may render (`render-policy.ts`, from the ledger's generated `tables.ts`) and each element's and attribute's ledger class (`classify.ts`). |
| `report/` | The import report: what Draw can edit, keeps as-is, only previews, or does not know, for any opened file. |
| `export/` | Clean export: editor data (Inkscape, Illustrator, Sketch…) removed, every other byte kept. |
| `ledger/` | The support ledger: `ledger.json` (source of truth), `LEDGER.md` (generated report), `ids.lock` (rows are never deleted). |

## The round-trip corpus

`test/fixtures/corpus/` holds 252 files that must open and save byte for byte:
- `icons/`: 150 unmodified icons from six open-source sets, with their licenses.
- `lab/`: every SVG Lab screen, mode and Create template, downloaded by
  `projects/draw/tools/capture-lab-corpus.mjs`.
- `tools/`: 36 hand-written files in the shapes Inkscape, Illustrator, Figma, Sketch, SVGO, draw.io
  and others produce, plus XML edge cases.

Their exact bytes are the test (CRLF, lone CR, tabs, a BOM), so `.gitattributes` there turns off
line-ending conversion.

## Open findings (engine/xml)

The P0-M1 review found these, and they are not fixed yet:
- **Well-formedness is looser than a browser's.** These are accepted, but browsers refuse such files:
  - duplicate attributes (the canvas refuses such an element: `hasDuplicateAttrs` in
    `policy/render-policy.ts`);
  - a bare `&`;
  - a reference to an undefined entity;
  - a character reference to a character XML forbids (such as `&#0;`);
  - `--` in a comment;
  - an unbound prefix;
  - an XML declaration after the start;
  - a lowercase `<!doctype`;
  - non-XML whitespace outside the root.
- **A processing instruction inside the DOCTYPE** that contains `]` or `'` fails to parse.

Fixed in P0-M2:
- values are normalized as XML requires (line ends, and whitespace in attributes);
- an entity that expands to markup or too far now fails at parse time;
- `&toString;` no longer matches an inherited object property;
- reads no longer draw down the parse budget;
- `refs.ts` decodes percent-encoded and quoted `url()` fragments.
