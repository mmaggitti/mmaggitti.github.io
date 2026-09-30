// The e2e geometry check's known differences (test/probe-helpers/geometry-known.mjs) are narrow:
// each explains only its own case, so none can hide a real difference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEOMETRY_KNOWN, geometryKnown } from '../probe-helpers/geometry-known.mjs';

test("the geometry check's known differences are narrow: WebKit's foreignObject box only in WebKit and only at the right size, and zero size only where it stops the element rendering", () => {
  const fo = [16, 17, 84, 50];
  assert.equal(geometryKnown('webkit', 'foreignObject', fo, [0, 0, 68, 33]), 'webkit-foreignobject-bbox');
  assert.equal(geometryKnown('chromium', 'foreignObject', fo, [0, 0, 68, 33]), null, 'Chromium is held to the position');
  assert.equal(geometryKnown('webkit', 'foreignObject', fo, [0, 0, 60, 33]), null, 'a wrong size is still a difference');
  assert.equal(geometryKnown('webkit', 'rect', [16, 17, 84, 50], [0, 0, 68, 33]), null, 'only a foreignObject');
  assert.equal(geometryKnown('webkit', 'rect', [1, 0, 1, 0], [0, 0, 0, 0]), 'zero-size');
  assert.equal(geometryKnown('chromium', 'circle', [5, 5, 5, 5], [0, 0, 0, 0]), 'zero-size');
  assert.equal(geometryKnown('webkit', 'line', [0, 10, 50, 10], [0, 0, 50, 0]), null, 'a flat line still draws');
  assert.equal(geometryKnown('webkit', 'rect', [0, 0, 10, 10], [0, 0, 10, 12]), null);
  assert.deepEqual(GEOMETRY_KNOWN.map((k) => k.id), ['webkit-foreignobject-bbox', 'zero-size']);
});
