# Draw support ledger

GENERATED from `ledger.json` by `projects/draw/tools/ledger-check.mjs --write`. Do not edit.

Current phase: **P1**. 1332 rows: 763 planned, 3 partial, 564 done, 2 superseded.

A row is `done` only when the tests it cites passed: unit tests in the build, e2e checks (`test/e2e.mjs#<check>`) in the smoke test after it, which is WebKit in CI. Raising the current phase is the phase exit: every row of an earlier phase must then be done or superseded. Rows are never deleted.

## By kind

| Kind | Rows | planned | partial | done | superseded |
|---|---|---|---|---|---|
| element | 188 | 143 | 1 | 44 | 0 |
| attribute | 386 | 208 | 0 | 178 | 0 |
| property | 48 | 32 | 0 | 16 | 0 |
| value | 85 | 25 | 0 | 60 | 0 |
| syntax | 23 | 0 | 0 | 23 | 0 |
| namespace | 21 | 3 | 2 | 16 | 0 |
| capability | 480 | 296 | 0 | 182 | 2 |
| feature | 101 | 56 | 0 | 45 | 0 |

## By phase

| Phase | Rows | planned | partial | done | superseded |
|---|---|---|---|---|---|
| P0 | 246 | 0 | 0 | 246 | 0 |
| P1 | 319 | 0 | 0 | 318 | 1 |
| P2 | 75 | 72 | 3 | 0 | 0 |
| P3 | 162 | 162 | 0 | 0 | 0 |
| P4 | 275 | 275 | 0 | 0 | 0 |
| P5 | 126 | 126 | 0 | 0 | 0 |
| P6 | 107 | 106 | 0 | 0 | 1 |
| P7 | 8 | 8 | 0 | 0 | 0 |
| P8 | 14 | 14 | 0 | 0 | 0 |

## Import classes

| Class | Elements | Attributes | Other |
|---|---|---|---|
| edit | 130 | 243 | 114 |
| preserve | 3 | 20 | 39 |
| preserve-hidden | 26 | 112 | 16 |
| active | 29 | 11 | 6 |
| drop | 0 | 0 | 2 |

## SVG Lab lessons

Each lesson's capabilities and the phases that deliver them.

| Set | Lesson | Title | Phases | Capabilities | Done |
|---|---|---|---|---|---|
| 1 | Vector | Pixels vs vector | P1 | 11 | 11 |
| 1 | Grid | The grid | P1 | 10 | 9 |
| 1 | Shapes | Shapes | P1 | 13 | 13 |
| 1 | Style | Fill and stroke | P1 | 12 | 12 |
| 1 | Paths | Paths | P1 | 18 | 18 |
| 1 | Transform | Groups and transforms | P1 | 11 | 11 |
| 1 | Animate | Animation | P5 | 16 | 0 |
| 1 | Charts | Charts from data | P3 | 12 | 0 |
| all | Create | Create | P1, P3, P4, P5 | 50 | 41 |
| 2 | Arcs | Path shorthand | P1 | 26 | 26 |
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
| 5 | Access | Accessibility | P1 | 11 | 11 |
| 5 | Images | Images and HTML | P4 | 13 | 0 |
| 5 | Media | Video, audio and more | P6 | 11 | 0 |
| 5 | Switch | Switch and unknown tags | P6 | 10 | 0 |

## Partial rows

- `element:*/*` (P2): kept and never rendered, and editor data (Inkscape, Illustrator, Sketch) is stripped from clean exports; the sidecar arrives with the P2 publish pipeline
- `namespace:inkscape` (P2): kept and never rendered, and stripped from clean exports; the sidecar arrives with the P2 publish pipeline
- `namespace:other` (P2): kept and never rendered; the sidecar arrives with the P2 publish pipeline (clean exports keep it: only editor namespaces are stripped)

## Superseded rows

- `capability:grid/tap-to-place` (P1) → capability:grid/center-handle
- `capability:code/css-and-script-tokens` (P6) → capability:code/css-tokens, capability:code/script-tokens

## Re-phased rows

Rows whose phase changed after they were first recorded in `ids.lock`.

- `value:url/data-image`: P1 → P4
- `capability:create/template-scene`: P1 → P5
- `capability:create/arrows`: P1 → P3
- `capability:create/effect`: P1 → P4
- `capability:create/paste-roundtrip`: P1 → P5
