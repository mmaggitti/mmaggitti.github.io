# Fractal — device checks

What CI can't prove: gesture feel and delivery on iOS, Safari's Home Screen mode, the keyboard, and
storage. A synthetic gesture in a test proves the handler, never the delivery. Mark signs each
phase on his own iPhone. Record the date, device and iOS version, and a note for anything that
fails.

## P0 — Navigation

Install it first: open <https://mmaggitti.github.io/fractal/> in Safari, then Share → Add to Home
Screen, and open it from the icon. (The Home Screen app keeps its own storage, separate from
Safari's. To pick up a new build, close it from the app switcher and reopen it; if that doesn't
take, delete the icon and add it again.)

| # | Check | How | Pass |
|---|---|---|---|
| 1 | Full screen | Light and dark: nothing sits under the Dynamic Island or the home indicator; the bottom bar clears the home indicator | ☐ |
| 2 | The page never zooms | Pinch on the bars, a caption and a block; the page itself never zooms | ☐ |
| 3 | ~~Lists scroll natively~~ | Not testable while the apps are blank blocks (2026-10-18); returns with real apps | — |
| 4 | ~~Typing doesn't zoom~~ | Not testable while the apps are blank blocks (2026-10-18); returns with real apps | — |
| 5 | Captions and Back | Tap the name "Group B": it fills the screen, with no caption of its own; Back steps out one level at a time (Group B → Group A → Home) | ☐ |
| 6 | Breadcrumb | Inside Teal, tap Group A in the breadcrumb; Group A is framed | ☐ |
| 7 | Pages | Frame Sky, then ›: Amber slides in as the next page; ‹ goes back; 1/2 and 2/2 show where you are | ☐ |
| 8 | Overview | Overview shows everything; pressing it again returns where you were | ☐ |
| 9 | Miniatures | Zoom out until panels shrink (a pinch in at the overview), then tap a small one: it frames | ☐ |
| 10 | ~~Kept across moves~~ | Blocks hold no state (2026-10-18); the e2e proves each block stays the same element | — |
| 11 | Relaunch | Frame something, close the app from the app switcher, reopen: it opens framed the same way | ☐ |
| 12 | Motion | Zooms are smooth, with no blank frames, including from the overview to Teal | ☐ |
| 13 | Reduced motion | Settings → Accessibility → Motion → Reduce Motion on: framing jumps instead of animating | ☐ |

### P0-M2 — gestures

Row 2 matters most here: CI can't prove it. With every one of Fractal's three zoom defences
removed on purpose, Chromium's phone emulation still never zoomed the page, so only a real iPhone
shows whether the page stays put.

| # | Check | How | Pass |
|---|---|---|---|
| 14 | Pinch keeps its point | At the overview, pinch out on Sky: it grows under your fingers and settles framed | ☐ |
| 15 | Two fingers on content | Put two fingers on a block and pinch: the workspace zooms, the page doesn't | ☐ |
| 16 | Pinch out | Framed on Teal, pinch in a little: it settles one level out (Group B); pinch in hard: further | ☐ |
| 17 | Two-finger pan | Framed on Sky, drag two fingers left past a quarter width: Amber becomes framed; a short drag springs back | ☐ |
| 18 | Caption taps | Tap "Rose" over Amber: the tab switches. Tap "Rose" again: Amber's panel fills the screen (its caption stays, since it has two tabs). Tap "Rose" once more: one level out | ☐ |
| 19 | Top-bar swipe | Framed on Amber, swipe right across the top bar: Sky | ☐ |
| 20 | Edge swipes | Frame Group B, then Teal; swipe in from the left edge: back to Group B; from the right edge: forward again. The chevron follows your finger | ☐ |
| 21 | Edges and content | Near the left edge of a framed block, a tab tap still works (only a sideways swipe from the very edge is history) | ☐ |

## C1 — Captions and the map

| # | Check | How | Pass |
|---|---|---|---|
| 37 | No white bars | Every tile is pure colour with its name in small type in the gap above it; groups are tinted wells, a shade deeper per level | ☐ |
| 38 | Names are easy to hit | Tap "Teal" at the overview with a thumb: it zooms straight to Teal, first time, without hitting the tile below | ☐ |
| 39 | The overview is a map | At the overview, tap Indigo's colour: the view zooms one level (Group A); tap it again: Group B. Inside Group B, tapping a tile does nothing (it's live) | ☐ |
| 40 | Long names | Add a few blocks as tabs to one panel (Arrange → ⋯ → Add block → As tab): when they don't fit, the caption shows the current name and "+n"; tapping "+n" steps through them | ☐ |

## P2 — Arrange

Arrange is in the bottom bar. While arranging the bar reads Back · Undo · Redo · Done.

| # | Check | How | Pass |
|---|---|---|---|
| 22 | Arrange on and off | Tap Arrange: panels get an accent edge, dividers show a pill, and tapping a block does nothing. Done: everything back to normal | ☐ |
| 23 | Drag a tab | Press Rose's tab and drag to the right third of Sky: a card follows just above your finger; after a moment the outline shows Sky's right half. Let go: Rose glides into its own panel there | ☐ |
| 24 | Drag a panel | Press a block's colour and drag onto another panel's tab strip: a bar shows where the tab goes. Let go: the tabs merge | ☐ |
| 25 | No flicker | Drag slowly across several panels: the outline only changes once you pause, and never flickers | ☐ |
| 26 | Cancel | Drag a tab and let go over the top bar: the card flies back and nothing changes | ☐ |
| 27 | Dividers | Drag the pill between Sky and Amber: the seam follows your finger and stops at a minimum width. Double-tap the pill: the two even out | ☐ |
| 28 | Undo and Redo | After a few moves, Undo steps back through them and Redo forward; a reload keeps the result | ☐ |
| 29 | Two fingers still navigate | In Arrange, pinch and two-finger pan work as before | ☐ |
| 30 | No iOS interference | No text selection, magnifier, callout or page scroll appears during a press or a drag | ☐ |
| 31 | The ⋯ menu | In Arrange each caption ends in a ⋯. Add block → Right puts a new colour beside it; Add group → Below adds an empty group that says "Drop blocks here" | ☐ |
| 32 | Close asks first | ⋯ on Group B → Close panel asks before removing it and its two blocks; Keep backs out; Undo brings it all back | ☐ |
| 33 | Move to… | ⋯ on Coral → Move to… → Top level: Coral becomes a new bottom row. Group A's own list has Group A and Group B greyed out | ☐ |
| 34 | Hold to step out | Frame Group B, Arrange, drag Teal's tab and hold it on Back: after half a second the view steps out to Group A (again each half second while held). Drop it beside Coral | ☐ |
| 35 | Hold to zoom in | At the overview, drag a block and hold it on Group B's well (the tinted area around its tiles): after a moment the view zooms into Group B; drop it there | ☐ |
| 36 | Crumbs and edges | While dragging, hold on a breadcrumb: that level is framed. Framed on Sky, hold at the right screen edge: the next page slides in | ☐ |

Signed: ______  Date: ______  Device / iOS: ______
