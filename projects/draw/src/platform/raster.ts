// The one place Draw turns a drawing into pixels (P1-M5: the Finish sheet's PNGs; check-sinks' raster
// rule keeps it here, since a canvas the page draws on can be read back).
//
// rasterize: the PNG copy (engine/export/png-source.ts: no <foreignObject>, the root sized to the file)
// as a data: SVG image, as SVG Lab's makeBitmap loads one (an SVG image runs no script and loads
// nothing), decoded, then drawn at w × h on a transparent OffscreenCanvas (a PNG keeps its alpha) and
// encoded, and the canvas's buffer let go at once. It never throws; it says why there is no PNG:
// - 'too-large': past the device's canvas area (no context; WebKit's convertToBlob rejects with an
//   EncodingError, CanvasBase::validateArea having refused the buffer), or nothing came out;
// - 'tainted': the canvas can't be read back (SecurityError), which the copy is made to avoid;
// - 'failed': the image wouldn't decode, or anything else.
// The sheet's previews are blob URLs, made and revoked here (createObjectURL is platform-only).

export type Rastered = Blob | 'too-large' | 'tainted' | 'failed';

const named = (e: unknown, name: string): boolean => !!e && typeof e === 'object' && (e as { name?: unknown }).name === name;

export async function rasterize(svg: string, w: number, h: number): Promise<Rastered> {
  const img = new Image();
  try {
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
  } catch {
    return 'failed';
  }
  let canvas: OffscreenCanvas;
  try {
    canvas = new OffscreenCanvas(w, h);
  } catch {
    return 'too-large';
  }
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'too-large';
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return blob.size ? blob : 'too-large';
  } catch (e) {
    if (named(e, 'EncodingError')) return 'too-large';
    if (named(e, 'SecurityError')) return 'tainted';
    return 'failed';
  } finally {
    // Up to 8192² × 4 bytes, let go now rather than when it is collected, so the next file's canvas
    // isn't refused for the memory this one still holds.
    canvas.width = 0;
    canvas.height = 0;
  }
}

const urls = new Set<string>();

/** A blob URL for a preview <img>, kept until revokeAll. */
export function previewUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  urls.add(url);
  return url;
}

/** Revoke every preview URL made so far (the sheet closed). */
export function revokeAll(): void {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
}
