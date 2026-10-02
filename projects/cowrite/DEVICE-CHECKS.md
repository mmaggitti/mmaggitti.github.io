# Co-write — device checks

What CI can't prove: real keyboards, the iOS share sheet, two real devices on real networks.
Use two devices (here "phone" and "second device"). Open `https://mmaggitti.github.io/cowrite/` in
Safari on both. Tick each line, or write what happened instead.

## Two devices, one document

- [ ] Phone: enter a name, pick a color, **New document**. The status reads **Live** within a few
      seconds.
- [ ] Phone: type a few lines. The title in the top bar follows the first line.
- [ ] Phone: **Share** opens the iOS share sheet; send the link to the second device (Messages,
      AirDrop or Notes).
- [ ] Second device: open the link, enter a different name and color. The text arrives.
- [ ] Type on both. Each edit shows on the other within about a second.
- [ ] Each person's text is tinted in their color, under the right letters (including wrapped
      lines and emoji). The names show above the text.
- [ ] Type on the phone while the second device's caret sits in the middle of the text. The caret
      stays where it was, relative to the words around it.

## The toggle

- [ ] **Hide authors** removes the tints and the names. **Show authors** brings them back. The
      choice survives a reload.

## Offline and back

- [ ] Phone: turn on Airplane Mode. The status reads **Offline**. Keep typing.
- [ ] Second device: type at the same time.
- [ ] Phone: turn off Airplane Mode. Within a few seconds both devices show both sets of edits,
      identical.

## Keyboard

- [ ] Autocorrect, predictive text and dictation insert text normally, without the caret jumping.
- [ ] A long document scrolls the page, and the caret stays visible above the keyboard.
- [ ] Tapping into the text doesn't zoom the page.

## Storage

- [ ] Close Safari's tab, reopen the site. The document is in the list and opens with its text and
      tints, even in Airplane Mode.

Signed: ____________ (date) · devices: ____________
