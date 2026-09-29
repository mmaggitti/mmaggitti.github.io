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
| `xml/` | Lossless lexer and CST: tokens tile the source, so `serialize(parse(x)) === x`. What a browser's XML parser refuses, it refuses, at the same place. Entity expansion is capped at 1 MB and depth 8. |
| `model/` | The document over the CST: stable NodeIds, namespaces resolved by URI, edits that change only their own bytes. `refs.ts` indexes ids and every reference to them. |
| `values/` | Numbers as Draw writes them (`fmt`: no exponents, no dotted runs), lengths, CSS Color 4, paint, viewBox and preserveAspectRatio, affine matrices, transform lists. |
| `path/` | Path data: a lossless parser (text after an error is kept), edits that touch one number, absolute form, arcs, exact bounds and nearest point. |
| `model/fragment.ts` | Edit source: markup parsed into an existing document, with the namespaces and entities in scope there, within what the document has left of its limits. |
| `commands/` | Every edit as a reversible op; transactions, undo and redo, and drags that commit as one history entry. Undo restores byte-identical source (10k seeded sequences). |
| `code/` | The code panel's typed tokens (numbers, colours, keywords, text, references) with spans into the raw text, so a token edit rewrites only that token's bytes. |
| `policy/` | What the canvas may render (`render-policy.ts`, from the ledger's generated `tables.ts`) and each element's and attribute's ledger class (`classify.ts`). |
| `report/` | The import report: what Draw can edit, keeps as-is, only previews, or does not know, for any opened file, and the external entities it declares (never fetched). |
| `export/` | Clean export: editor data (Inkscape, Illustrator, Sketch…) removed, every other byte kept. |
| `ledger/` | The support ledger: `ledger.json` (source of truth), `LEDGER.md` (generated report), `ids.lock` (rows are never deleted). |

## The round-trip corpus

`test/fixtures/corpus/` holds 260 files that must open and save byte for byte:
- `icons/`: 150 unmodified icons from six open-source sets, with their licenses.
- `lab/`: every SVG Lab screen, mode and Create template, downloaded by
  `projects/draw/tools/capture-lab-corpus.mjs`.
- `tools/`: 44 hand-written files in the shapes Inkscape, Illustrator, Figma, Sketch, SVGO, draw.io
  and others produce, plus XML edge cases.

Their exact bytes are the test (CRLF, lone CR, tabs, a BOM), so `.gitattributes` there turns off
line-ending conversion.

## Open findings (engine/xml)

Found by probing Chromium's parser in P1-M0 (e2e `theEngineRefusesWhatTheBrowserRefuses` holds Draw
to a browser rule by rule), and not fixed yet. Browsers refuse these files, and Draw opens them:
- **The DOCTYPE's internal subset is read only for its entity declarations.** Its own syntax isn't
  checked, so a subset a browser refuses can open: a `--` in one of its comments, stray text, an
  unterminated declaration, a bare `&` or a character XML forbids in an entity's value (even one
  never used), a colon in an entity's name, or a parameter-entity reference (browsers refuse any;
  Draw opens the file while nothing depends on one, and refuses a reference one may declare as
  over its limits);
- a colon in a processing instruction's target (`<?a:b?>`);
- a name character outside XML's (`a×b`: the lexer's names are permissive about non-ASCII);
- an XML declaration whose own syntax is wrong (its fields aren't checked): no `version`, a version
  other than `1.` and digits, an encoding that isn't a name, or a `standalone` other than `yes` or
  `no`;
- a public identifier holding a character XML doesn't allow there (`PUBLIC "a&b"`);
- a namespace name that isn't a URI (`xmlns:p="a b"`).

The other way round, one file browsers accept is refused, as over Draw's limits (so it isn't shown
as source that isn't well-formed): an HTML entity such as `&nbsp;` under a DOCTYPE that names an
XHTML DTD, which browsers supply themselves and Draw doesn't know.

Fixed in P1-M0:
- well-formedness is as strict as a browser's (ledger row `syntax:strict-well-formedness`), so such
  a file opens as read-only source, marked where the browser's parser stops. Each is refused at its
  place: an attribute written twice (by name, or under two prefixes of one namespace), a bare `&`,
  a reference without `;`, a character reference to a character XML forbids (`&#0;`), an undeclared
  entity (over Draw's limits instead when a parameter entity or an XHTML DTD may declare it), an
  external entity in a value, an entity whose text isn't well-formed where it expands, `--` in a
  comment, a lowercase `<!doctype`, anything but XML whitespace outside the root, an unbound prefix,
  a namespace declaration XML forbids, a malformed qualified name, a character XML doesn't allow,
  and `]]>` in text;
- a processing instruction inside the DOCTYPE may hold `]` or a quote.

Fixed in P0-M5:
- a failure over a limit (size, node count, depth, the entity budget and depth, an entity that
  expands to markup) says so (`kind: 'limit'`), so Draw refuses such a file rather than showing it
  as source that isn't well-formed.

Fixed in P0-M3:
- an XML declaration after the start, and a DOCTYPE anywhere but before the root, are refused as a
  browser refuses them (so Edit source can't bring either into element content);
- Edit source spends what the document has left of its size, node count, depth and entity budget,
  so Draw never writes a file it can't open again.

Fixed in P0-M2:
- values are normalized as XML requires (line ends, and whitespace in attributes);
- an entity that expands to markup or too far now fails at parse time;
- `&toString;` no longer matches an inherited object property;
- reads no longer draw down the parse budget;
- `refs.ts` decodes percent-encoded and quoted `url()` fragments.
