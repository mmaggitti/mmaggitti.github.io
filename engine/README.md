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
| `xml/` | Lossless lexer and CST: tokens tile the source, so `serialize(parse(x)) === x`. What a browser's XML parser refuses, it refuses, at the same place (the first, when a file has several). Entity expansion is capped at 1 MB and depth 8, the work of expanding counted with the output. |
| `model/` | The document over the CST: stable NodeIds, namespaces resolved by URI, edits that change only their own bytes. `refs.ts` indexes ids and every reference to them. |
| `model/ids.ts` | Fresh ids (`freshId`, reserved across a batch), SVG Lab's numbered ids (`numberedId`: `gloss-1`, `linear-2`), and renaming ids with every reference to them inside a subtree (`renameIdsIn`): Duplicate, Rename and Draw's gradients. |
| `model/draw-state.ts` | Draw's own state in the file (`draw-ns.ts`: its namespace): guides and the grid step in one `<draw:state>` in the file's single `<metadata>`, and per-element `draw:*` attributes (locks, generator inputs) through `setDrawAttr`, declared once on the root; `stripDrawState` gives the file back without it, byte for byte (As-is and Copy). What Draw made (its `<metadata>`, and its `<defs>` and gradients) is one exact predicate in `draw-ns.ts`: `draw:made` exactly `"true"`; the exports drop Draw's empty `<metadata>` and `<defs>` and keep its gradients (drawing content) without the mark. |
| `model/space.ts` | The insertion rule: where a new element goes (after or before a sibling, or last in a parent) and the whitespace copied around it, parsed with its markup in one fragment parse; a removal takes the whitespace before it, so insert then remove gives the bytes back. |
| `geometry/` | Where things are, without a DOM: lengths in user units (`lengths.ts`), the CSS that can move or size an element (`css.ts`), each element's transform to the root (`ctm.ts`, `transform-origin` and `transform-box` included), exact bounds (`bounds.ts`), thin-shape hits (`hit.ts`), and the write policy: what a move, resize, rotate or scale writes, number by number, or why it can't (`write.ts`). |
| `geometry/shape-handles.ts` | Shape handles (SVG Lab's KITS): a circle's radius, an ellipse's rx and ry, a line's ends, a vertex per point of a plain polygon or polyline, and a generated shape's radius and inner point, in the element's own units; what a drag writes (its own numbers only, units kept, M1's refusals). |
| `generators/` | Generated shapes: a regular polygon, a star and a spiral whose inputs are `draw:*` attributes on the element (`index.ts`: the registry, `generatorOf`, and `finishGenerators`, the Session's finish hook that regenerates a shape whose inputs changed and detaches one whose geometry was edited by hand, in the same transaction). |
| `style/` | Where a style value lives and where Inspect writes it (`props.ts`: each property's initial value and whether it inherits; `where.ts`: a `style=""` declaration's value span, the presentation attribute, or neither, whether a `<style>` rule may set it, with `!important`, and what Inspect shows: own, inherited from an ancestor, the default, or a rule's; `write.ts`: `planStyle`, which rewrites only that span or attribute value, refuses what a rule decides, and gives a stroke that had none a width). |
| `paint/` | Gradients (`gradients.ts`: the template chain, `href` before `xlink:href`, a URL to another file never followed; which paints use a gradient and when an edit is shared; a new gradient in `<defs>` with a numbered id, a paint switched back to a colour or none taking away what Draw made and nothing uses, Make unique), the stop editor (`stops.ts`), SVG Lab's gloss (`gloss.ts`), and the gradient handles in both unit systems and under `gradientTransform` (`handles.ts`: each point at toHost · U · T · p, what a drag writes, LabPaint's `fixF`). |
| `values/` | Numbers as Draw writes them (`fmt`: no exponents, no dotted runs), lengths, CSS Color 4 (and a colour written back in its own notation family, and HSV for the Colour sheet's picker), paint, viewBox and preserveAspectRatio, affine matrices, transform lists. |
| `path/` | Path data: a lossless parser (text after an error is kept), edits that touch one number, absolute form, arcs, exact bounds and nearest point. |
| `model/fragment.ts` | Edit source: markup parsed into an existing document, with the namespaces and entities in scope there, within what the document has left of its limits. |
| `commands/` | Every edit as a reversible op; transactions, undo and redo, and drags that commit as one history entry. Undo restores byte-identical source (10k seeded sequences). A Session's optional `finish` hook runs after each transaction's and drag frame's own ops, and what it applies joins them (undo and redo never call it). |
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

With two errors in one start tag, Draw can name another than the browser: it checks the element's
prefix before its attributes' prefixes, where a browser checks the attributes first (`<p:g q:k="1"/>`
with neither bound is marked at `p`; Chromium names `q`, at the end of the tag). Both are on the
tag's line unless the tag spans lines.

The other way round, one file browsers accept is refused, as over Draw's limits (so it isn't shown
as source that isn't well-formed): an HTML entity such as `&nbsp;` under a DOCTYPE that names an
XHTML DTD, which browsers supply themselves and Draw doesn't know.

Where WebKit itself departs from XML, Draw follows XML (CI run 32; the e2e names each in its KNOWN
list, so a change in WebKit shows):
- WebKit refuses a processing instruction holding `]` inside the internal subset, which XML allows
  and Chromium accepts;
- WebKit keeps a CR before an LF inside a CDATA section, where XML turns every CR LF into LF.

Fixed in P1-M1:
- the canvas's zoom and pan are the rendered root's own box (its CSS size and offset), never its
  `viewBox`: P0's camera was the root's `viewBox`, so a `%` length in the drawing (draw.io's
  `<rect width="100%" height="100%">` background) was resolved against the camera and changed size
  under zoom (e2e `percentLengthsKeepTheirSizeUnderZoom`). `geometry/ctm.ts` composes the root's
  viewport transform into every CTM, so the engine and the canvas agree on where things are
  (e2e `geometryMatchesTheBrowser`).

A known limit of that camera: the canvas places the drawn root with `!important` declarations in a
cascade layer of its own (`draw-camera`, `src/canvas/safe-sink.ts` `placeRoot`), which outrank the
file's own unlayered `!important`, however specific (`#root { left: 100px !important }` leaves the
drawing on its paper: e2e `aFilesOwnCssCantMoveItsDrawing`). A file that sets the root's position or
size with `!important` inside an `@layer` of its own can still move the drawing off its paper: its
layer comes first, and for `!important` declarations the first layer wins.

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
- a processing instruction inside the DOCTYPE may hold `]` or a quote;
- `data-*` was claimed rendered in P0 (ledger row `attribute:data-*`), but the canvas never
  consulted the generated pattern rows, so it wasn't. The canvas draws them now: `data-*`, and
  `aria-*` too (its row is still planned);
- the P1-M0 review:
  - the entity budget counts the work of expanding as well as the output: a bomb of entities that
    expand to nothing (535 bytes, fan 10, depth 8) took 34 s to parse, and as long again in Edit
    source; it is refused in well under a second;
  - the entity declarations are read in linear time: a subset of declarations that never close
    was scanned to its end from each one (1 MB took minutes);
  - namespace declarations are set and put back as the parser goes, not copied per element (255
    nested elements declaring 150 prefixes each took 1.4 s, 1,200 each 14 s);
  - an attribute whose name the DOM refuses to create (`data-😀`, `data-⁰x` in Chromium: the
    `data-*` pattern and DOMPurify admit them) is dropped from the canvas and counted, never
    thrown on; it made a well-formed file, or a P0 draft, open nowhere, and Edit source blank the
    canvas;
  - with several errors, the first is marked, where a browser's parser stops: a reference or
    namespace error before where the lexer or the tree stops (in a tag the lexer stops inside,
    and in text before a character XML doesn't allow, too) came second;
  - a reference to an unparsed (`NDATA`) entity is refused, as browsers refuse it;
  - an entity chain is named once in a message, by its ends, and a long name is cut to about 40
    characters (a 1 MB name made a 1 MB message).

  And two files browsers accept that Draw refused, the other way round: an entity whose name holds
  a character outside ASCII (`&é;`, `&a·b;`), read now with the lexer's name characters; and an
  entity declared twice, which binds its first declaration now, as XML says (the canvas drew the
  last: `fill="&c;"` blue where a browser draws red).

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
