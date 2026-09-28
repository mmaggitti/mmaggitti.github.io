# Draw support ledger

GENERATED from `ledger.json` by `projects/draw/tools/ledger-check.mjs --write`. Do not edit.

Current phase: **P0**. 1327 rows: 1155 planned, 13 partial, 158 done, 1 superseded.

A row is `done` only when the tests it cites passed in the build. Raising the current phase is the phase exit: every row of an earlier phase must then be done or superseded. Rows are never deleted.

## By kind

| Kind | Rows | planned | partial | done | superseded |
|---|---|---|---|---|---|
| element | 188 | 163 | 4 | 21 | 0 |
| attribute | 386 | 273 | 1 | 112 | 0 |
| property | 48 | 48 | 0 | 0 | 0 |
| value | 85 | 85 | 0 | 0 | 0 |
| syntax | 22 | 4 | 2 | 16 | 0 |
| namespace | 20 | 11 | 2 | 7 | 0 |
| capability | 479 | 478 | 0 | 0 | 1 |
| feature | 99 | 93 | 4 | 2 | 0 |

## By phase

| Phase | Rows | planned | partial | done | superseded |
|---|---|---|---|---|---|
| P0 | 246 | 78 | 10 | 158 | 0 |
| P1 | 320 | 320 | 0 | 0 | 0 |
| P2 | 74 | 71 | 3 | 0 | 0 |
| P3 | 161 | 161 | 0 | 0 | 0 |
| P4 | 273 | 273 | 0 | 0 | 0 |
| P5 | 124 | 124 | 0 | 0 | 0 |
| P6 | 107 | 106 | 0 | 0 | 1 |
| P7 | 8 | 8 | 0 | 0 | 0 |
| P8 | 14 | 14 | 0 | 0 | 0 |

## Import classes

| Class | Elements | Attributes | Other |
|---|---|---|---|
| edit | 130 | 243 | 119 |
| preserve | 3 | 20 | 38 |
| preserve-hidden | 26 | 112 | 10 |
| active | 29 | 11 | 6 |
| drop | 0 | 0 | 2 |

## SVG Lab lessons

Each lesson's capabilities and the phases that deliver them.

| Set | Lesson | Title | Phases | Capabilities | Done |
|---|---|---|---|---|---|
| 1 | Vector | Pixels vs vector | P1 | 11 | 0 |
| 1 | Grid | The grid | P1 | 10 | 0 |
| 1 | Shapes | Shapes | P1 | 13 | 0 |
| 1 | Style | Fill and stroke | P1 | 12 | 0 |
| 1 | Paths | Paths | P1 | 18 | 0 |
| 1 | Transform | Groups and transforms | P1 | 11 | 0 |
| 1 | Animate | Animation | P5 | 16 | 0 |
| 1 | Charts | Charts from data | P3 | 12 | 0 |
| all | Create | Create | P1, P5 | 50 | 0 |
| 2 | Arcs | Path shorthand | P1 | 26 | 0 |
| 2 | Reuse | Symbols and use | P2 | 13 | 0 |
| 2 | Paint | Gradients and patterns | P3 | 17 | 0 |
| 2 | Clip | Clip and mask | P3 | 14 | 0 |
| 2 | Markers | Markers | P3 | 16 | 0 |
| 2 | Type | Typography | P3 | 18 | 0 |
| 2 | CSS | Styling with CSS | P2 | 10 | 0 |
| 3 | Motion | Motion paths | P5 | 15 | 0 |
| 3 | Timing | Timing | P5 | 15 | 0 |
| 3 | Spinner | SMIL, CSS or JavaScript | P5 | 12 | 0 |
| 3 | Links | Links and scripts | P6 | 16 | 0 |
| 4 | Shadow | Blur and shadow | P4 | 14 | 0 |
| 4 | Color | Color and blending | P4 | 15 | 0 |
| 4 | Texture | Texture and distortion | P4 | 13 | 0 |
| 4 | Light | Lighting | P4 | 15 | 0 |
| 5 | Size | Sizing and views | P2 | 10 | 0 |
| 5 | Access | Accessibility | P1 | 11 | 0 |
| 5 | Images | Images and HTML | P4 | 13 | 0 |
| 5 | Media | Video, audio and more | P6 | 11 | 0 |
| 5 | Switch | Switch and unknown tags | P6 | 10 | 0 |

## Partial rows

- `element:unknown` (P0): kept and never rendered; the import report is P0-M4
- `element:xhtml/*` (P0): kept and never rendered; the import report is P0-M4
- `element:*/*` (P2): kept and never rendered; the sidecar arrives with the P2 publish pipeline, the clean-export strip with P0-M4
- `element:svg/*` (P0): kept and never rendered, with its subtree; the import report is P0-M4
- `attribute:(other)` (P0): kept and never rendered; the import report is P0-M4
- `syntax:external-entities` (P0): never fetched; listing them in the import report is P0-M4
- `syntax:parameter-entities` (P0): recorded and never expanded; the never-expanded half has no test yet
- `namespace:inkscape` (P2): kept and never rendered; the sidecar arrives with the P2 publish pipeline, the clean-export strip with P0-M4
- `namespace:other` (P2): kept and never rendered; the sidecar arrives with the P2 publish pipeline, the clean-export strip with P0-M4
- `feature:safe-viewer` (P0): every corpus file renders through the policy (unit) and on the canvas (e2e); fitting its viewBox with zoom and pan is P0-M3
- `feature:canvas-root-isolation` (P0): the host resets inherited styles and design tokens (e2e canvasIgnoresTheTheme); aria-hidden on the host is P0-M3
- `feature:dompurify-opinion` (P0): fail-closed is unit-tested; what DOMPurify refuses (ids naming document properties are kept since SANITIZE_DOM is off, data images on feImage, SMIL from/to) is proven only in the e2e policy-edges case
- `feature:shadow-root-decision` (P0): decided: the open shadow root. WebKit 26 passes all 24 probe rows (CI run 13); Chromium all but a document’s own @font-face. The probe is e2e (test/probe-shadow.mjs), which the ledger cannot cite as evidence yet

## Superseded rows

- `capability:code/css-and-script-tokens` (P6) → capability:code/css-tokens, capability:code/script-tokens

## Re-phased rows

Rows whose phase changed after they were first recorded in `ids.lock`.

None.
