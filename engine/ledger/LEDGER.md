# Draw support ledger

GENERATED from `ledger.json` by `projects/draw/tools/ledger-check.mjs --write`. Do not edit.

Current phase: **P0**. 1327 rows: 1124 planned, 18 partial, 184 done, 1 superseded.

A row is `done` only when the tests it cites passed in the build. Raising the current phase is the phase exit: every row of an earlier phase must then be done or superseded. Rows are never deleted.

## By kind

| Kind | Rows | planned | partial | done | superseded |
|---|---|---|---|---|---|
| element | 188 | 163 | 1 | 24 | 0 |
| attribute | 386 | 273 | 0 | 113 | 0 |
| property | 48 | 48 | 0 | 0 | 0 |
| value | 85 | 85 | 0 | 0 | 0 |
| syntax | 22 | 1 | 2 | 19 | 0 |
| namespace | 20 | 11 | 2 | 7 | 0 |
| capability | 479 | 462 | 9 | 7 | 1 |
| feature | 99 | 81 | 4 | 14 | 0 |

## By phase

| Phase | Rows | planned | partial | done | superseded |
|---|---|---|---|---|---|
| P0 | 246 | 47 | 15 | 184 | 0 |
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
| edit | 130 | 243 | 114 |
| preserve | 3 | 20 | 38 |
| preserve-hidden | 26 | 112 | 15 |
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

- `element:*/*` (P2): kept and never rendered, and editor data (Inkscape, Illustrator, Sketch) is stripped from clean exports; the sidecar arrives with the P2 publish pipeline
- `syntax:parameter-entities` (P0): recorded and never expanded; the never-expanded half has no test yet
- `syntax:malformed` (P0): a file that is not well-formed opens nowhere: the error, its line and column and the failing line are shown, and the drawing that was open stays (unit); opening it as source only is not built
- `namespace:inkscape` (P2): kept and never rendered, and stripped from clean exports; the sidecar arrives with the P2 publish pipeline
- `namespace:other` (P2): kept and never rendered; the sidecar arrives with the P2 publish pipeline (clean exports keep it: only editor namespaces are stripped)
- `capability:code/live-code` (P0): canvas and code are live views of one model (unit); the flash of a changed block is CSS (cv-flash, stopped under reduced motion by ds.css), checked only in e2e scrubChangesOnlyItsBytes
- `capability:code/number-sheet` (P0): stepper buttons, a checked numeric field (with a ± key for the decimal keypad) and one history entry per visit are built and unit-tested; hold-to-repeat and the range slider are not built yet
- `capability:code/enum-cycle` (P0): a tap moves a keyword to its next option, wrapping round, as one history entry (unit); Enter or Space on a focused token is not built (tokens are not focusable yet)
- `capability:code/text-sheet` (P0): the single-line field, its live edits, its refusals and one history entry per visit are unit-tested; Enter closing it is a key handler, exercised only in e2e sheetsRefuseWhatTheyCantWrite
- `capability:shared/tap-vs-drag` (P0): a move under 5 px is a tap on the canvas (unit); handle drags that snap to whole units arrive with the P1 handles
- `capability:shared/reduced-motion` (P0): under reduced motion the canvas's SMIL is paused and its CSS animation stopped (e2e reducedMotionStopsAnimation), and the code's flash on a changed token is a CSS animation that ds.css turns off too; a Play button that starts the motion is not built
- `capability:shared/bottom-sheet` (P0): the keyboard inset is unit-tested; the dim, Done and Escape are built, and Done is exercised only in e2e (phoneRulesOnTheNewLayout, sheetsRefuseWhatTheyCantWrite)
- `capability:shared/toast` (P0): refused edits (e2e sheetsRefuseWhatTheyCantWrite) and exports ("Downloaded", "Shared": e2e exportIsTheFileByteForByte) show a short notice above the ContextBar; nothing copies to the clipboard yet, so there is no "Copied"
- `capability:shared/theme` (P0): the app follows the system's light or dark theme (ds.css), and the code's token colours have a dark set that switches with it (app.css), while the canvas stays on white paper in both (e2e canvasIgnoresTheTheme); nothing checks the code's recolouring yet, and there is no data-theme override
- `feature:canvas-root-isolation` (P0): the host resets inherited styles and design tokens and is aria-hidden (the code panel is the accessible view); proven only in e2e canvasIgnoresTheTheme and phoneRulesOnTheNewLayout
- `feature:dompurify-opinion` (P0): fail-closed is unit-tested; what DOMPurify refuses (ids naming document properties are kept since SANITIZE_DOM is off, data images on feImage, SMIL from/to) is proven only in the e2e policy-edges case
- `feature:shadow-root-decision` (P0): decided: the open shadow root. WebKit 26 passes all 24 probe rows (CI run 13); Chromium all but a document’s own @font-face. The probe is e2e (test/probe-shadow.mjs), which the ledger cannot cite as evidence yet
- `feature:save-working-copy` (P0): Save to Files writes the working copy through the share sheet or a download, and it is the as-is file for now: the one <metadata> element for editor state has nothing to carry in P0 (no guides, locks or generator inputs yet)

## Superseded rows

- `capability:code/css-and-script-tokens` (P6) → capability:code/css-tokens, capability:code/script-tokens

## Re-phased rows

Rows whose phase changed after they were first recorded in `ids.lock`.

None.
