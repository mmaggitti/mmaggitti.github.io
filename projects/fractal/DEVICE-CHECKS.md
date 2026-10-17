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
| 2 | The page never zooms | Pinch on the bars, a tab bar and a list; the page itself never zooms | ☐ |
| 3 | Lists scroll natively | Frame Long list (⤢) and flick it: it scrolls with momentum; nothing else moves | ☐ |
| 4 | Typing doesn't zoom | Frame Note and type; the page doesn't zoom, and nothing stays shifted after the keyboard closes | ☐ |
| 5 | ⤢ and Back | ⤢ on Garden fills the screen with it; Back steps out one level at a time (Garden → Desk → Home) | ☐ |
| 6 | Breadcrumb | Inside Garden list, tap Desk in the breadcrumb; Desk is framed | ☐ |
| 7 | Pages | Frame Long list, then ›: Note slides in as the next page; ‹ goes back; 1/2 and 2/2 show where you are | ☐ |
| 8 | Overview | Overview shows everything; pressing it again returns where you were | ☐ |
| 9 | Miniatures | At the overview, tap a shrunken panel (Garden list): it frames instead of taking the tap | ☐ |
| 10 | Kept across moves | Type in Note and tap Add one on a counter, then zoom around; the text and count are still there | ☐ |
| 11 | Relaunch | Frame something, close the app from the app switcher, reopen: it opens framed the same way | ☐ |
| 12 | Motion | Zooms are smooth, with no blank frames, including from the overview to Garden list | ☐ |
| 13 | Reduced motion | Settings → Accessibility → Motion → Reduce Motion on: framing jumps instead of animating | ☐ |

Rows for pinch, two-finger pan, double-tap, top-bar swipes and edge-swipe history arrive with
P0-M2.

Signed: ______  Date: ______  Device / iOS: ______
