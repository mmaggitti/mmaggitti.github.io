# Tool-shaped corpus

Hand-written files in the shapes real editors and exporters produce: Inkscape, Illustrator,
Figma, Sketch, SVGO, draw.io, Affinity Designer, CorelDRAW, Graphviz and matplotlib, plus
animated files and `edge-*` cases for XML syntax. The generator comments and metadata are
modelled on each tool's output, but **no file here was exported by that tool**, and none holds
private data.

Some bytes matter and are easy to lose to an editor: CRLF endings (`*-crlf*`, `edge-crlf-*`,
`illustrator-cs6-*`), mixed endings (`edge-mixed-line-endings.svg`, which has a lone CR), tabs,
the UTF-8 BOM in `edge-utf8-bom.svg`, and no final newline (`svgo-*`, `sketch-*`). Every file is
well-formed XML.

`edge-legacy-fonts-tiny-rdfa.svg` is generated from the support ledger: it holds every element and
attribute the ledger keeps byte for byte but never renders (SVG fonts, SVG Tiny 1.2, RDFa), so the
round trip exercises them.

What the ledger keeps and renders (its `preserve` rows) is here in the shapes real files use it:
SVG 1.1 text by reference and deprecated presentation attributes (`edge-svg11-*`), SVG 2 flowed
text from Inkscape 1.x, current CSS (`edge-css-*`: layers, container and feature queries, Color 4
and 5, CSS transforms, a scroll-driven animation), ids two pasted icons share, and path data with
an error part way (`edge-path-comma-joined-commands.svg`, the one file whose paths do not all
parse). `engine/test/corpus/kept.ts` finds each row in them.
