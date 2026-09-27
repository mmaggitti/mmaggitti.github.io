// Allowlists for scripts/lib/svg-profile.mjs.
//
// Hand-written for P0-M0. From P0-M2 on this file is GENERATED from Draw's support ledger
// (engine/ledger/ledger.json) by projects/draw/tools/ledger-check.mjs, which also fails the build
// if the two drift. Until then, change it only together with the profile's tests.

// SVG 1.1 + SVG 2 elements that can't run script or load an active document. Absent on purpose:
// script, and the legacy SVG font and cursor elements.
export const ELEMENTS = new Set([
  'a', 'animate', 'animateMotion', 'animateTransform', 'circle', 'clipPath', 'defs', 'desc',
  'discard', 'ellipse', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
  'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow',
  'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage', 'feMerge',
  'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight',
  'feTile', 'feTurbulence', 'filter', 'foreignObject', 'g', 'image', 'line', 'linearGradient',
  'marker', 'mask', 'metadata', 'mpath', 'path', 'pattern', 'polygon', 'polyline',
  'radialGradient', 'rect', 'set', 'stop', 'style', 'svg', 'switch', 'symbol', 'text', 'textPath',
  'title', 'tspan', 'use', 'view',
]);

// SMIL elements whose attributeName must not retarget href, style or a handler.
export const SMIL_ELEMENTS = new Set(['animate', 'animateMotion', 'animateTransform', 'set', 'discard']);

// Inside <foreignObject> only: text and layout HTML. No script, style, iframe, object, embed,
// form controls, link, meta, base, or media (media is preview-only in Draw).
export const XHTML_ELEMENTS = new Set([
  'div', 'span', 'p', 'br', 'b', 'i', 'em', 'strong', 'small', 'sub', 'sup', 'u', 's', 'mark',
  'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt',
  'dd', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'figure', 'figcaption', 'hr', 'abbr',
  'cite', 'q', 'time',
]);

// Standard descriptive metadata (the Accessibility lesson teaches dc:title and friends), allowed
// only inside <metadata>. Editor namespaces (inkscape, sodipodi, Illustrator) are not served.
export const METADATA_NS = new Set([
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'http://purl.org/dc/elements/1.1/',
  'http://purl.org/dc/terms/',
  'http://creativecommons.org/ns#',
  'http://web.resource.org/cc/',
]);
