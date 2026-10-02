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

## P1 — Select, transform, shapes, colour, paths, text, accessibility, finish, export, iPad and Create

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
| 44 | More after a marquee | After a one-finger marquee by touch, the first tap on More opens the sheet (CI's touch harness swallowed it in M2 and M3) | ☐ |
| 45 | Stroke to path | Draw a thick curved line with the Pen (Inspect: a stroke about 8 wide, round ends), then More → Stroke to path: zoomed in to about 4×, it looks the same before and after, now a filled shape; do the same on a filled shape with a stroke: its fill stays, and the outline sits exactly where the stroke was | ☐ |
| 46 | Typing a text | Text tool, tap the board: the Text sheet opens on "Hello" (tap into it if the keyboard isn't up) and you type over it; the page never zooms, the sheet stays above the keyboard, and Return makes a new line; after Done the canvas draws it below the first | ☐ |
| 47 | The Font sheet | Select a text, Inspect → Font: each name is drawn in its own face (they may take a moment to arrive), and a tap on one changes the text on the canvas at once | ☐ |
| 48 | Your own font | In the Font sheet, Add a font… and pick a .ttf or .otf from Files: it is listed under Your fonts by its own name and the text draws in it; reload Draw: it is still listed and still draws (Safari may clear it after seven days without a visit, as it does drafts) | ☐ |
| 49 | The text's position handle | Select a text: grab its position handle (on the first line's baseline, at the text's x and y) with your thumb, first try, at the fit and zoomed in to about 4×; the whole text moves, every line with it, and Undo puts it back | ☐ |
| 50 | Text to path | Type a short word in one of Draw's fonts (Inter, say) and make it large, then More → Text to path: zoomed in to about 4×, it looks the same before and after, now a path | ☐ |
| 51 | Export with fonts | A drawing with an Inter text and an IBM Plex Sans text: Export, Text → With fonts, Clean SVG, save to Files, then open it in Safari: the Inter text draws in Inter, and the IBM Plex text draws too, as paths (the sheet said its font reserves "Plex") | ☐ |
| 52 | VoiceOver reads the title | Open a drawing, Access tab: Title on, type a name, then Export → Clean SVG, save to Files, and open it from Files in Safari with VoiceOver on (Settings → Accessibility): it reads the name you typed, then "image", as the tab's preview said | ☐ |
| 53 | The Access fields and the keyboard | Access tab: tap the Title field, the Description box and the Language field in turn; the page never zooms, each field stays in view above the keyboard (scroll the sheet if it must), and Done or Return keeps what you typed | ☐ |
| 54 | The five tabs | The code sheet's tab row (Code, Layers, Inspect, Access, Support) fits across the screen with a shape selected, every tab easy to hit with your thumb, and the selection's name still shows (shortened if it must) | ☐ |
| 55 | A text's two handles | On a text, the position handle and the centre handle sit close together; both move the text. Check that each is easy to hit, and that the pair isn't confusing | ☐ |
| 56 | New from a quick start | Files → New…, then Icon, App icon and Wordmark in turn, each with New drawing: each opens as a new drawing you can draw on at once, and the drawing before is still in Files; then SVG Lab's Logo with Replace this one: the open drawing becomes the logo, keeping its name, and Undo brings it back | ☐ |
| 57 | Finish's previews | A drawing with a thin line: Finish: the 16 and 32 px previews show its real pixels (blocky, not blurred), the big ones fit the screen, and the light, dark and checkerboard strips read clearly; with a long drawing name, the top bar slides sideways to reach Export while the page itself never moves sideways | ☐ |
| 58 | PNG through the share sheet | Finish → Share (Icon set): the share sheet offers to save the images, and the saved PNGs open in Photos or Files with a transparent background where the drawing has none | ☐ |
| 59 | A big PNG | A 3000 × 3000 artboard (the root's viewBox `0 0 3000 3000`), Finish → 3×, which asks for 9000 × 9000: the sheet says `<name>@3x.png is 8192 × 8192: this device makes PNGs up to 67,108,864 pixels.` (before iOS 18: `<name>@3x.png is 4096 × 4096: this device makes PNGs up to 16,777,216 pixels.`), and the shared file is that size | ☐ |
| 60 | iPad layout | Landscape: the tools in a column on the left and the code beside the canvas; portrait: the tools on the left and the code under the canvas; neither cut by the screen's rounded corners or the home indicator. Draw beside another app in Split View at half width: the phone's layout, tools at the bottom | ☐ |
| 61 | ⌘K | With a keyboard on the iPad, ⌘K opens Commands (if Safari takes ⌘K for itself, note it: the top bar's Commands button is the way in); type "dup", and Return duplicates the selection | ☐ |
| 62 | Apple Pencil draws, fingers navigate | Draw and drag with the Pencil while panning with a finger: after the Pencil's first touch, a finger only moves the view, and a two-finger tap no longer undoes | ☐ |
| 63 | Pencil hover | (A hover-capable iPad and Pencil.) Hold the Pencil just above a shape's corner handle: the handle lights up before you touch, and near a guide the snap ring shows where a press would land | ☐ |
| 64 | The Pencil button | In pen mode the rail ends with Pencil, pressed: tap it, and a finger draws again and a two-finger tap undoes again; the Pencil's next touch brings pen mode, and the button, back | ☐ |
| 65 | Open in Draw from SVG Lab | In SVG Lab on the phone, Open in Draw (under the code) opens the lesson in Draw in a new tab, with its import report; Draw's address bar no longer holds the link | ☐ |
| 66 | Insert | Copy an icon's SVG from Notes, then the rail's Insert → paste in the field → Insert: it lands in the middle of the drawing as one group you can move, and Undo takes it out | ☐ |
| 67 | Edit the whole drawing | The code panel's Edit with the iOS keyboard up: the field stays above the keyboard; change a number and Apply; a typo says where it is and changes nothing | ☐ |
| 68 | The empty state | Files → New… → SVG Lab's Blank, then New drawing: "Add a shape below" sits in the middle of the canvas, and goes when you add a shape | ☐ |

Signed: ______  Date: ______  Device / iOS: ______
