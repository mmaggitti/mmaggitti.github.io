# Draw — device checks

What CI can't prove: gesture feel, iOS pickers and share sheets, Safari's storage and keyboard.
Mark signs each phase on his own phone (and iPad where it says so). Record the date, device and
iOS version, and a note for anything that fails.

## P0 — Foundation

Open <https://mmaggitti.github.io/draw/> in Safari (a normal tab, not the Home Screen).

| # | Check | How | Pass |
|---|---|---|---|
| 1 | Pinch keeps the point | Pinch on the canvas around a small detail; the detail stays under your fingers | ☐ |
| 2 | The page never zooms | Pinch on the top bar, the code sheet, the Scrub strip and the tool rail; nothing but the drawing ever zooms | ☐ |
| 3 | Two-finger tap undoes | Change a number, then tap the canvas with two fingers | ☐ |
| 4 | Scrub feels right | Drag a number in the code sideways; it changes smoothly, a vertical drag still scrolls, and one Undo puts it back | ☐ |
| 5 | Taps land | Tap small tokens in the code; the one under your finger is taken, never its neighbour | ☐ |
| 6 | Keyboard | Open the Number, Text and Edit source sheets; the field stays visible above the keyboard and Done is reachable | ☐ |
| 7 | Open… | Files → Open… shows the iOS file picker and lets you pick an .svg from Files and iCloud Drive | ☐ |
| 8 | Paste | Copy SVG text from Notes and paste it in Draw; it opens with its import report | ☐ |
| 9 | Save to Files | Export → Save to Files offers the share sheet with "Save to Files", and the saved file opens in Files | ☐ |
| 10 | Drafts survive | Edit a drawing, close the tab, reopen Draw: the edit is there | ☐ |
| 11 | Second tab | Open Draw in a second tab: it says the drawing is open elsewhere and is read-only | ☐ |
| 12 | Dark mode | Switch to dark: the app follows, the drawing's own colours don't | ☐ |
| 13 | iPad (optional) | The same layout works in portrait and landscape; the keyboard doesn't cover fields | ☐ |

Signed: ______  Date: ______  Device / iOS: ______
