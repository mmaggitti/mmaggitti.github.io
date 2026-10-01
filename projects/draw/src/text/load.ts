// The text library's chunk (P1-M4): the only import() of src/text/outline-lib.ts, so a static import of
// this module keeps fontkit lazy (Vite makes it a chunk of its own, outline-lib-*.js, in neither
// index.html's scripts nor its preloads). Add a font… (src/platform/fonts.ts), Text to path and
// Export's text choices (S2) load it on first use. A load that fails is forgotten, so the next use
// tries again (src/paths/load.ts is the pattern).

import type { ShapedGlyph } from '../../../../engine/text/outline.ts';

/** What the text library reads from a font file. */
export interface FontInfo {
  family: string;
  subfamily: string;
  weight: number; // OS/2 usWeightClass
  italic: boolean; // OS/2 fsSelection's italic bit
  fsType: number; // OS/2 embedding bits, as written
  copyright: string;
  licence: string;
}

/** One face's runs as the text library shapes them (engine/text/outline.ts ShapedGlyph: font units, y up). */
export interface ShapedFace {
  unitsPerEm: number;
  runs: { glyphs: ShapedGlyph[]; missing: string[] }[]; // missing: the characters left on .notdef (glyph 0)
}

/** The text library, as the chunk gives it. */
export interface TextLib {
  /** A font file's names and OS/2 bits; throws when the library can't read it. */
  openFont(bytes: Uint8Array): FontInfo;
  /** Each run laid out in the font (S2: its default features, kerning and ligatures, as browsers apply them); throws when it can't read the file. */
  shape(bytes: Uint8Array, runs: readonly string[]): ShapedFace;
}

let lib: Promise<TextLib> | null = null;

export const loadTextLib = (): Promise<TextLib> =>
  (lib ??= import('./outline-lib.ts').catch((e) => {
    lib = null; // a later use tries again
    throw e;
  }));
