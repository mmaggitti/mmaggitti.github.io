// PNG (P1-M5, the Finish sheet): the source every PNG is drawn from, each file's size and name, and
// the device's canvas limit. Framework-free and DOM-free: the pixels come from the rasterizer handed in
// (src/platform/raster.ts in the page, a fake in node's tests).
//
// - The source is Clean's file with its text as paths (export/svg.ts prepareExport, As paths), its
//   notes too: an SVG image can't use the page's fonts, so a text Draw couldn't outline is drawn in the
//   image's own fallback font, and a note says so. A drawing with no text is Clean's file as it is
//   (the text library isn't loaded for nothing). Should the text tools fail to load, the file is
//   Clean's with its text as text, and a note says why.
// - Each file is the source's PNG copy at its size (engine/export/png-source.ts: no <foreignObject>, the
//   root sized to the file; the sheet's pngCopier parses the source once, and each file writes only its
//   width and height), rasterized. A size past the device's canvas area is clamped, first to
//   8192 × 8192 (iOS 18 on), and when the device refuses that, to 4096 × 4096 (iOS 16.4 to 17), then
//   tried again; the cap that worked is kept for the visit, so later files start there. Refused there
//   too, the file says it can't be made. A clamped file says so.
// - Names: the icon set <name>-<N>.png (N its longer side), the scales <name>.png, <name>@2x.png and
//   <name>@3x.png, sanitized as an SVG export's name is.

import { NS, descendants, type Doc } from '../../../../engine/model/doc.ts';
import { cleanExport } from '../../../../engine/export/clean.ts';
import { textCount, type PngCopies } from '../../../../engine/export/png-source.ts';
import { clampArea, type PngChoice, type PixelSize } from '../../../../engine/export/raster.ts';
import { fileNameFor, prepareExport, type ExportDeps } from './svg.ts';

/** The device canvas areas a PNG is clamped to, in the order tried (WebKit's maxCanvasArea on iOS 18, and before it). */
export const AREA_CAPS: readonly number[] = [8192 * 8192, 4096 * 4096];

export const FALLBACK_FONT = 'A text kept as text draws in the PNG’s own fallback font: an image can’t use Draw’s fonts.';
export const TOO_LARGE = 'This device can’t make a PNG that big.';
export const TAINTED = 'This browser won’t let Draw read the PNG back.';
export const FAILED = 'The drawing couldn’t be drawn as a PNG.';
/** A clamped file's note. */
export const clampedNote = (name: string, size: PixelSize, cap: number) => `${name} is ${size.w} × ${size.h}: this device makes PNGs up to ${cap.toLocaleString('en-US')} pixels.`;
/** When the text tools couldn't load: the PNG's text stays text. */
export const textAsText = (why: string) => `${why.replace(/\.?$/, '.')} Its text stays text in the PNG.`;

export type Raster = (svg: string, w: number, h: number) => Promise<Blob | 'too-large' | 'tainted' | 'failed'>;

export interface PngSource {
  /** Clean's file, its text as paths where Draw could outline it. */
  text: string;
  notes: string[];
}

const hasText = (doc: Doc) => [...descendants(doc, doc.root)].some((n) => n.kind === 'element' && n.ns === NS.svg && n.local === 'text');

/** The source every PNG of the drawing is drawn from (the module header). */
export async function pngSource(doc: Doc, name: string, deps: ExportDeps): Promise<PngSource> {
  if (!hasText(doc)) return { text: cleanExport(doc).text, notes: [] };
  const r = await prepareExport(doc, name, 'paths', deps);
  if ('refused' in r) return { text: cleanExport(doc).text, notes: [textAsText(r.refused), FALLBACK_FONT] };
  const text = new TextDecoder().decode(r.file.bytes);
  return { text, notes: textCount(text) ? [...r.notes, FALLBACK_FONT] : [...r.notes] };
}

/** A PNG file's name for a drawing: <name>-<N>.png for an icon, <name>.png, <name>@2x.png, <name>@3x.png for a scale. */
export function pngName(name: string, choice: PngChoice): string {
  const suffix = 'icon' in choice ? `-${choice.icon}` : choice.scale === 1 ? '' : `@${choice.scale}x`;
  return fileNameFor(name, suffix).replace(/\.svg$/, '.png');
}

export interface MadePng {
  name: string;
  /** What it was asked to be, and what it is (smaller when clamped). */
  wanted: PixelSize;
  size: PixelSize;
  blob: Blob;
  /** The cap it was clamped to, or null. */
  clamped: number | null;
  /** What its copy left out (a foreignObject). */
  notes: string[];
}

/** The cap that worked, kept across one visit's files: later files start there. */
export interface Caps {
  at: number; // an index into AREA_CAPS
}
export const freshCaps = (): Caps => ({ at: 0 });

/** One PNG of the source (its sheet's copies) at `wanted` pixels, clamped to the device as the module header says, or why it can't be made. */
export async function makePng(copies: PngCopies, wanted: PixelSize, name: string, raster: Raster, caps: Caps): Promise<MadePng | { refused: string }> {
  for (let i = caps.at; i < AREA_CAPS.length; i++) {
    const cap = AREA_CAPS[i];
    const size = clampArea(wanted.w, wanted.h, cap);
    const copy = copies(size.w, size.h);
    if ('refused' in copy) return { refused: copy.refused };
    const r = await raster(copy.text, size.w, size.h);
    if (r === 'tainted') return { refused: TAINTED };
    if (r === 'failed') return { refused: FAILED };
    if (r === 'too-large') continue;
    caps.at = i;
    return { name, wanted, size: { w: size.w, h: size.h }, blob: r, clamped: size.clamped ? cap : null, notes: copy.notes };
  }
  caps.at = AREA_CAPS.length - 1;
  return { refused: TOO_LARGE };
}
