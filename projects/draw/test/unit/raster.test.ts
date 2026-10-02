// The rasterizer (src/platform/raster.ts) over stand-ins for the browser's Image and OffscreenCanvas:
// it never throws, and it lets go of the canvas's buffer once the PNG is out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rasterize } from '../../src/platform/raster.ts';

class FakeImage {
  src = '';
  decode(): Promise<void> {
    return Promise.resolve();
  }
}
const made: FakeCanvas[] = [];
class FakeCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    made.push(this);
  }
  getContext() {
    return { drawImage: () => {} };
  }
  convertToBlob(): Promise<Blob> {
    return Promise.resolve(new Blob(['png'], { type: 'image/png' }));
  }
}

test('rasterize lets go of the canvas once the PNG is out, and never throws: text it can’t encode is “failed”', async () => {
  const g = globalThis as unknown as { Image: unknown; OffscreenCanvas: unknown };
  const was = { Image: g.Image, OffscreenCanvas: g.OffscreenCanvas };
  g.Image = FakeImage;
  g.OffscreenCanvas = FakeCanvas;
  try {
    const png = await rasterize('<svg xmlns="http://www.w3.org/2000/svg"/>', 64, 32);
    assert.ok(png instanceof Blob && png.size > 0, String(png));
    assert.equal(made.length, 1);
    assert.deepEqual([made[0].width, made[0].height], [0, 0], 'the canvas’s buffer is let go (64 × 32 → 0 × 0)');
    assert.equal(await rasterize('<svg xmlns="http://www.w3.org/2000/svg"><text>\uD800</text></svg>', 4, 4), 'failed', 'a lone surrogate: encodeURIComponent’s error is caught');
  } finally {
    g.Image = was.Image;
    g.OffscreenCanvas = was.OffscreenCanvas;
  }
});
