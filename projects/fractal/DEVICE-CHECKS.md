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
| 2 | The page never zooms | Pinch on the bars, a tab bar and a block; the page itself never zooms | ☐ |
| 3 | ~~Lists scroll natively~~ | Not testable while the apps are blank blocks (2026-10-18); returns with real apps | — |
| 4 | ~~Typing doesn't zoom~~ | Not testable while the apps are blank blocks (2026-10-18); returns with real apps | — |
| 5 | ⤢ and Back | ⤢ on Group B fills the screen with it; Back steps out one level at a time (Group B → Group A → Home) | ☐ |
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
| 18 | Double-tap | Double-tap a tab bar: that panel is framed; double-tap it again: one level out | ☐ |
| 19 | Top-bar swipe | Framed on Amber, swipe right across the top bar: Sky | ☐ |
| 20 | Edge swipes | Frame Group B, then Teal; swipe in from the left edge: back to Group B; from the right edge: forward again. The chevron follows your finger | ☐ |
| 21 | Edges and content | Near the left edge of a framed block, a tab tap still works (only a sideways swipe from the very edge is history) | ☐ |

Signed: ______  Date: ______  Device / iOS: ______
