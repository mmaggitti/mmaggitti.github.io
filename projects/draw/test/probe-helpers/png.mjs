// Minimal PNG decoder for reading pixel colours out of Playwright screenshots in node, without a
// dependency: 8-bit RGB or RGBA, non-interlaced, all five row filters. Anything else throws. Also
// what a canvas's PNG encoder writes, so Finish's PNGs (P1-M5) decode here, and pixelShare compares two.

import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let width = 0, height = 0, channels = 0;
  const idat = [];
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colour, interlace] = [data[8], data[9], data[12]];
      channels = { 2: 3, 6: 4 }[colour] ?? 0;
      if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(height * stride); // writes wrap mod 256, as the filters require
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? px[row + i - channels] : 0;
      const b = y ? px[row - stride + i] : 0;
      const c = y && i >= channels ? px[row - stride + i - channels] : 0;
      let v = raw[src + i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter} on row ${y}`);
      px[row + i] = v;
    }
  }
  return {
    width,
    height,
    rgb(x, y) {
      const i = y * stride + x * channels;
      return [px[i], px[i + 1], px[i + 2]];
    },
    /** Red, green, blue and alpha (255 for an RGB image). */
    rgba(x, y) {
      const i = y * stride + x * channels;
      return [px[i], px[i + 1], px[i + 2], channels === 4 ? px[i + 3] : 255];
    },
  };
}

/**
 * The share of pixels that differ by more than `tol` in any channel, colours compared premultiplied
 * by their alpha (so a fully transparent pixel is the same whatever colour it holds). `a` and `b` are
 * decodePng's results, or { width, height, rgba(x, y) } of the same size.
 */
export function pixelShare(a, b, tol = 2) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`pixelShare: ${a.width}×${a.height} against ${b.width}×${b.height}`);
  let differ = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const p = a.rgba(x, y), q = b.rgba(x, y);
      const pm = (c, i) => (i === 3 ? c[3] : (c[i] * c[3]) / 255);
      if ([0, 1, 2, 3].some((i) => Math.abs(pm(p, i) - pm(q, i)) > tol)) differ++;
    }
  }
  return differ / (a.width * a.height);
}

/** An image of `width` × `height` from RGBA bytes in rows (what a canvas's getImageData gives), for pixelShare. */
export function rgbaImage(width, height, data) {
  return { width, height, rgba: (x, y) => { const i = (y * width + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; } };
}
