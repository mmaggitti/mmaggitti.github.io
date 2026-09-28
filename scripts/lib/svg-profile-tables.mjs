// Allowlists for scripts/lib/svg-profile.mjs.
//
// GENERATED from engine/ledger/ledger.json by projects/draw/tools/ledger-check.mjs --write.
// Do not edit: change the ledger and regenerate. The build fails if this file drifts from it.

// SVG elements a served file may contain: every element row that is served.
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
export const SMIL_ELEMENTS = new Set([
  'animate', 'animateMotion', 'animateTransform', 'discard', 'set',
]);

// Inside <foreignObject> only: the XHTML elements that are served (text and layout).
export const XHTML_ELEMENTS = new Set([
  'abbr', 'b', 'blockquote', 'br', 'cite', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'figcaption',
  'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'mark', 'ol', 'p', 'pre',
  'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'time',
  'tr', 'u', 'ul',
]);

// Descriptive metadata namespaces, allowed only inside <metadata>.
export const METADATA_NS = new Set([
  'http://creativecommons.org/ns#', 'http://purl.org/dc/elements/1.1/',
  'http://purl.org/dc/terms/', 'http://web.resource.org/cc/',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
]);

// Attributes with no namespace that are active and never served, beyond every on* handler and
// xml:base (which the profile refuses by rule).
export const ACTIVE_ATTRIBUTES = new Set([
  'defaultAction', 'event', 'handler', 'observer', 'phase', 'ping', 'propagate',
]);
