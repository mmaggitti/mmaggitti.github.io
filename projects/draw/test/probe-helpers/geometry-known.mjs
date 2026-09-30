// Where the engine's geometry and a browser's measured box differ on purpose, for the e2e
// geometryMatchesTheBrowser: each difference is named, narrow, and unit-tested
// (test/unit/geometry-known.test.ts), so a known one can never hide a real one.
// Boxes are [minX, minY, maxX, maxY] in root user units.

export const GEOMETRY_KNOWN = [
  {
    id: 'webkit-foreignobject-bbox',
    why: 'WebKit measures a <foreignObject> without its x/y (its box comes back at 0,0 with the right size; CI run 34), where Chromium and SVG 2 place it at x/y as the engine does. In WebKit the size is still compared, the position not',
  },
  {
    id: 'zero-size',
    why: 'a rect, image, foreignObject, nested svg, circle or ellipse whose width, height or radius is 0 is not rendered; WebKit measures it as (0,0,0,0) (tools/edge-whitespace-in-tags.svg, CI run 34), Chromium at its x/y',
  },
];

// Zero width or height disables these elements' rendering (a line or a path with a zero-height box still draws).
const DISABLED_WHEN_EMPTY = new Set(['rect', 'image', 'foreignObject', 'svg', 'circle', 'ellipse']);
const near = (a, b) => Math.abs(a - b) <= 0.5;

/** The id of the known difference that explains `mine` against `theirs`, or null when none does. */
export function geometryKnown(engine, local, mine, theirs) {
  const w = mine[2] - mine[0], h = mine[3] - mine[1];
  if (DISABLED_WHEN_EMPTY.has(local) && (w === 0 || h === 0)) return 'zero-size';
  if (engine === 'webkit' && local === 'foreignObject' && near(theirs[2] - theirs[0], w) && near(theirs[3] - theirs[1], h)) return 'webkit-foreignobject-bbox';
  return null;
}
