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
| 12 | Dark mode | With Files → Theme on System, switch the phone to dark: the app follows, the drawing's own colours don't | ☐ |
| 13 | iPad (optional) | Portrait keeps the code under the canvas; landscape docks it beside the canvas; the keyboard doesn't cover fields | ☐ |
| 14 | Copy | Code → Copy says "Copied" with no permission prompt, and the file pastes into Notes whole (it starts with `<svg xmlns=`); with Tidy on, the paste is still the file as written | ☐ |
| 15 | Hold to repeat | In the Number sheet, hold + : one step at once, then it runs, and it stops the moment you lift; the slider drags the value | ☐ |
| 16 | A tap that opens a sheet | Tap a colour in the code: the Color sheet opens and nothing in it is picked by that same tap | ☐ |
| 17 | Phone on its side | Turn the phone: the code docks beside the canvas, Tidy re-flows to the new width, and turning back restores the sheet | ☐ |
| 18 | Broken file | Tap [this broken file](https://mmaggitti.github.io/draw/#import=FctBCoAgEEDRqwxzgGYq2oS66ColKlSGDo7HD-Ev3uab2gL0536rxSjy7USqOuk65RJoYWaqLSC05PXI3SIDwzxCZ4o_BTRdEi1uCNGnEGXQmXG5Hw) (a missing end tag): its text shows read-only with the error marked, nothing is drawn, a long-press selects the code, and Copy copies the broken text; Files gets you back | ☐ |
| 19 | Reduced motion | With Settings → Accessibility → Motion → Reduce Motion on, tap [a drawing that animates once](https://mmaggitti.github.io/draw/#import=NY5NDsIgFAav8vK5l1eN_8DCA3gHxNdKQtUALdXTGzUuZjszOo8dTX28ZYNrKY-9UrXWeV3O76lTC2ZWeexAY5B6vE8GTEwNf4HVPiQfhfxk0DDIPw1WDEoGW1AbYjSYyWbdrhpY7W6hd0XIlZLCeShycr0Y-Ak0ujhI_kgOOwZdhmSwyH9Fm0ReAmW1-gWt_lzZNw) and [one that loops](https://mmaggitti.github.io/draw/#import=TVDLUoRADPyVVLzowWUWZF1ZhrL07j-MECDlMLAz4VXW_ruFHPSQVA7d6UcepgaWzrqgsRUZsiia5_kwJ4feN1GslIrC1CBMTPNbv2hUoOCofgeLPMhqqXj9orX2pqMAYWAH3yD9trxxoe59l4HvxQjdJydVUfMAN7jBIVz_Yx57zw27DJ7VsECqhuUCxnFnhHuX7X-TAJYdGQ_sanYsBLc82j3knkqB0poQNIYrwqIxPSOsGpMzwsyVtBrjJ4SWuGllv2u2VuNdfHo6pQlGRV6yLy1BuWiMU4Ry1ZgqBK_xqP7g5qU611jku0ECI-L5cxT6MB1p9AiTsSOFjXWJ1WXjVqPXGAcETwMZee9HJxrZVbRH2dSjXb7It9KLHw): each opens still (showing the drawing) with Play; Play runs it from the top (the one-shot circle slides across again), and Pause holds both the pulse and the spinning square where they are | ☐ |
| 20 | Theme choice | Files → Theme → Dark with the phone in light (then Light with it in dark): the whole app takes the choice; close the tab and reopen Draw: still your choice, with no flash of the other theme while it loads; Safari's toolbar tint still follows the phone (a known limit); System follows the phone again | ☐ |

Signed: ______  Date: ______  Device / iOS: ______
