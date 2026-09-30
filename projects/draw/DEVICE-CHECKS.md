# Draw — device checks

What CI can't prove: gesture feel, iOS pickers and share sheets, Safari's storage and keyboard.
Mark signs each phase on his own phone (and iPad where it says so). Record the date, device and
iOS version, and a note for anything that fails.

## P0 — Foundation

Open <https://mmaggitti.github.io/draw/> in Safari (a normal tab, not the Home Screen).

| # | Check | How | Pass |
|---|---|---|---|
| 1 | Pinch keeps the point | Pinch on the canvas around a small detail; the detail stays under your fingers | ☑ Mark, iPhone, 2026-09-29 |
| 2 | The page never zooms | Pinch on the top bar, the code sheet, the Scrub strip and the tool rail; nothing but the drawing ever zooms | ☑ Mark, iPhone, 2026-09-29 |
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

## P1 — Select, transform, shapes, colour and paths

The sample drawing, and [the lab's house](https://mmaggitti.github.io/draw/#import=VZDdaoQwEIXvfYpherML6-ZnNd2WxIu-idgYA1kjSTDu2xfdou3AwOEM53wwMs4Glocbo8IhpemTkJzzNd-uPhjCKaUkzgZhtjp_-UUhBQqMbotNASANpNCOsffhoXCTrk36VFOo6bmAY4JP6-G_GbvW6RM7b10AMuguwaKwZBXCU2EpELL9ToNCfkcYtDVDUsg5Qm-dU_imP7pKtEh-CybvnsaPMHk7prgW3S-lAHopOYdNH8l30ddsT-7oF7nawX-47OByUYn69kpLYppCrp9qih8) (a group moved by translate, rotate and scale).
To take the house's group: tap the roof, then More → Select group.

| # | Check | How | Pass |
|---|---|---|---|
| 21 | Drag feel | Drag a shape on the sample: it follows your finger in whole units, with no lag, and one Undo puts it back | ☐ |
| 22 | Reaching handles | On [the lab's house](https://mmaggitti.github.io/draw/#import=VZDdaoQwEIXvfYpherML6-ZnNd2WxIu-idgYA1kjSTDu2xfdou3AwOEM53wwMs4Glocbo8IhpemTkJzzNd-uPhjCKaUkzgZhtjp_-UUhBQqMbotNASANpNCOsffhoXCTrk36VFOo6bmAY4JP6-G_GbvW6RM7b10AMuguwaKwZBXCU2EpELL9ToNCfkcYtDVDUsg5Qm-dU_imP7pKtEh-CybvnsaPMHk7prgW3S-lAHopOYdNH8l30ddsT-7oF7nawX-47OByUYn69kpLYppCrp9qih8), with its group selected: grab a corner, the ring and the diamond with your thumb, each first try, at the fit and zoomed in to about 4× | ☐ |
| 23 | The tooltip | Drag a shape: the tooltip sits above your thumb, never under it; drag one near the top edge and the tooltip sits below your thumb | ☐ |
| 24 | Hold-drag marquee | Hold a finger on a shape for about half a second, then drag over other shapes: a marquee is drawn, the shape doesn't move, and lifting selects what it encloses | ☐ |
| 25 | Rotate and scale feel | On the house's group: the ring clicks to 15° steps as you turn it, and the diamond steps the size by 0.05 | ☐ |
| 26 | The checkerboard | Switch the phone between light and dark: the paper behind the drawing is the same light checkerboard in both, and the drawing's own colours don't change | ☐ |
| 27 | Layers: hide and lock | Code panel → Layers: Hide a shape and it disappears, Show brings it back; Lock one and taps and marquees go past it to what's under it; Unlock it | ☐ |
| 28 | iPad keys (optional) | With a keyboard on the iPad: ⌫ deletes the selection, Esc deselects, the arrows nudge it by 1 and ⇧ by 10, ⌘A selects all, and none of them act while you type in the code or a sheet | ☐ |
| 29 | Place and draw | Shapes tool: a tap puts the shape under your finger, centred on it; a drag draws it from where you pressed, and snaps to a guide (Snap → add one) when you pass near it | ☐ |
| 30 | Shape handles | Grab a circle's radius, an ellipse's rx and ry, a line's end and a polygon's vertex with your thumb, each first try, at the fit and zoomed in to about 4×; each moves only what it should | ☐ |
| 31 | Generators | Place a star: Inspect's Tips and Inner redraw it as you type; place a spiral and change its Turns; edit one of the star's points numbers in the code: it becomes a plain shape (the notice says so), and Undo brings the star back | ☐ |
| 32 | The colour picker | Open a fill's Colour sheet: the square and the Hue and Alpha sliders follow your thumb with no page scroll; tap the text field: the keyboard comes up and Done stays in reach | ☐ |
| 33 | Inspect at 440 pt | With one shape and then three selected, open Inspect at half and full: every row can be reached by scrolling, nothing scrolls sideways, and the segments are easy to hit with a thumb | ☐ |
| 34 | Gradient handles | Give a shape a Linear fill, then Edit on canvas: the handles sit on the gradient and drag it; turn the shape (the ring) and try again: they still sit where the gradient draws | ☐ |
| 35 | Gloss | More → Gloss on a rounded rect: it looks like SVG Lab's Create gloss on the same shape; More → Gloss again takes it off | ☐ |
| 36 | The Pen by thumb | Pen tool: tap three points, then drag a fourth: a tap never makes a curve, and even a short drag does, leaving the point along your drag; Undo point takes the last one back, and a tap on the first point (from three) closes the path | ☐ |
| 37 | Reaching nodes | Node tool on a curvy path: grab an anchor, a control and a line's bend handle with your thumb, each first try, at the fit and zoomed in to about 4×; each moves only what it should, and Undo puts it back | ☐ |
| 38 | The path's bar | Node tool with a path selected, a node tapped: Smooth, Close and Relative sit in the bottom bar within easy reach of your thumb, above the home indicator, and each does what it says in one tap | ☐ |
| 39 | Ghost arcs by thumb | Open the file SVG Lab's Arcs lesson exports in arc mode, and select its path in the Node tool: tap each dashed ghost arc with your thumb; the one you meant takes over first try, and its "L S" label turns pink | ☐ |
| 40 | The donut's ring | Open the file the Arcs lesson exports in donut mode, tap a slice, Inspect → Edit as donut, then drag a boundary between two slices all the way round the ring: the handle stays under your thumb, the "a \| b" tooltip is readable above it, and the % labels follow | ☐ |
| 41 | Direction arrows | Open the file the Arcs lesson exports in holes mode, and select its path in the Node tool at the fit: every arrowhead is readable, the inner ones pink; tap an inner point, then Reverse: the inner arrows turn, and the hole opens | ☐ |
| 42 | Union by thumb | Draw a rect and a circle that overlap, select both with a marquee, then More → Union: one shape is left where the two were, drawn in the rect's colour, and Undo brings both back; Subtract, Intersect and Exclude each do what they say the same way | ☐ |
| 43 | Union offline | Open Draw, then turn on Airplane mode without reloading and try Union: it works (Safari kept its code from an earlier Union) or the notice says Draw couldn't load the shape tools and nothing changes; back online, Union works, and from then on it works offline too until Draw is reloaded | ☐ |

Signed: ______  Date: ______  Device / iOS: ______
