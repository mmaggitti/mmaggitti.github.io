// fontkit (2.0.4, MIT; github.com/foliojs/fontkit), Draw's text library (P1-M4: the S1 spike's winner,
// the only one of the two that reads the .woff2 files the canvas draws). Only src/text/load.ts imports
// this module, with a dynamic import(), so it is a chunk of its own that the first Add a font… (or, in
// S2, Text to path) fetches. Font bytes in, names and outlines out.

import { create } from 'fontkit';
import type { FontInfo } from './load.ts';

/** A font file's family, subfamily, weight class, italic flag, embedding bits and its copyright and licence strings. */
export function openFont(bytes: Uint8Array): FontInfo {
  const font = create(bytes);
  if ('fonts' in font) throw new Error('a font collection'); // .ttc/.dfont: not a face Draw takes
  const os2 = font['OS/2'];
  const fs = os2?.fsType as Record<string, boolean> | undefined;
  // The bits as OS/2 writes them (fontkit names bits 1, 2, 3, 8 and 9).
  const fsType = fs ? (fs.noEmbedding ? 2 : 0) | (fs.viewOnly ? 4 : 0) | (fs.editable ? 8 : 0) | (fs.noSubsetting ? 0x100 : 0) | (fs.bitmapOnly ? 0x200 : 0) : 0;
  return {
    family: font.getName?.('preferredFamily') ?? font.familyName ?? '',
    subfamily: font.getName?.('preferredSubfamily') ?? font.subfamilyName ?? '',
    weight: os2?.usWeightClass ?? 400,
    italic: !!os2?.fsSelection?.italic || (font.italicAngle ?? 0) !== 0,
    fsType,
    copyright: font.copyright ?? '',
    licence: font.getName?.('license') ?? '',
  };
}
