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
