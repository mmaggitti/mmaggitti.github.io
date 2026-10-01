// fontkit (2.0.4, MIT; github.com/foliojs/fontkit), Draw's text library (P1-M4: the S1 spike's winner,
// the only one of the two that reads the .woff2 files the canvas draws). Only src/text/load.ts imports
// this module, with a dynamic import(), so it is a chunk of its own that the first Add a font… (or, in
// S2, Text to path) fetches. Font bytes in, names and outlines out. Every file is measured by what its
// header says it unpacks to before fontkit sees it (unpackedSize): over 30 MB, or a header that doesn't
// read, is refused, as a file the library can't read is.

import { create } from 'fontkit';
import type { FontInfo, ShapedFace } from './load.ts';

/** The most a font file may unpack to: OTS's bound on a decompressed WOFF2 (the browser's own font sanitizer), far over any face Draw ships. */
export const MAX_UNPACKED = 30 * 1024 * 1024;

/**
 * What a font file says it unpacks to, read from its header before anything is decompressed (fontkit
 * allocates what a WOFF or WOFF2 declares, then inflates into it): a WOFF2's totalSfntSize or the sum
 * of its table directory's lengths (UIntBase128; a transformed table's transformLength), whichever is
 * larger; a WOFF's tables' origLength, summed; anything else is read as it is, so its own length.
 * Throws on a header that doesn't read.
 */
export function unpackedSize(b: Uint8Array): number {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength); // reading past the end throws
  const tag = b.length >= 4 ? String.fromCharCode(b[0], b[1], b[2], b[3]) : '';
  if (tag === 'wOFF') {
    const n = v.getUint16(12);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += v.getUint32(44 + 20 * i + 12);
    return sum;
  }
  if (tag !== 'wOF2') return b.length;
  const n = v.getUint16(12);
  let at = 48;
  // UIntBase128: at most five bytes, no leading zero byte, no overflow past 32 bits.
  const base128 = (): number => {
    let r = 0;
    for (let i = 0; i < 5; i++) {
      const c = v.getUint8(at++);
      if ((i === 0 && c === 0x80) || r >= 2 ** 25) throw new Error('a WOFF2 table length that doesn’t read');
      r = r * 128 + (c & 0x7f);
      if (!(c & 0x80)) return r;
    }
    throw new Error('a WOFF2 table length that doesn’t read');
  };
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const flags = v.getUint8(at++);
    let t = flags & 0x3f;
    if (t === 0x3f) {
      const custom = String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
      at += 4;
      t = custom === 'glyf' ? 10 : custom === 'loca' ? 11 : -1;
    }
    const length = base128();
    // glyf (10) and loca (11) are transformed at version 0; every other table at any other version.
    const transformed = t === 10 || t === 11 ? flags >> 6 === 0 : flags >> 6 !== 0;
    sum += transformed ? base128() : length;
  }
  return Math.max(sum, v.getUint32(16));
}

// fontkit over bytes whose header says they unpack to at most MAX_UNPACKED: one face, never a collection.
function read(bytes: Uint8Array) {
  let size: number;
  try {
    size = unpackedSize(bytes);
  } catch {
    throw new Error('a font header that doesn’t read');
  }
  if (size > MAX_UNPACKED) throw new Error(`a font that unpacks to ${size} bytes (the most is ${MAX_UNPACKED})`);
  const font = create(bytes);
  if ('fonts' in font) throw new Error('a font collection'); // .ttc/.dfont: not a face Draw takes
  return font;
}

/** A font file's family, subfamily, weight class, italic flag, embedding bits and its copyright and licence strings. */
export function openFont(bytes: Uint8Array): FontInfo {
  const font = read(bytes);
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

/**
 * Text to path (S2): each run laid out by fontkit with its default features (kerning and ligatures,
 * as browsers apply them), each glyph's outline in font units (y up), its advance and offsets, and the
 * characters whose glyph is .notdef (id 0). One parse of the file for all its runs.
 */
export function shape(bytes: Uint8Array, runs: readonly string[]): ShapedFace {
  const font = read(bytes);
  return {
    unitsPerEm: font.unitsPerEm,
    runs: runs.map((text) => {
      const laid = font.layout(text);
      const missing: string[] = [];
      const glyphs = laid.glyphs.map((g, i) => {
        if (g.id === 0) missing.push(String.fromCodePoint(...g.codePoints));
        const p = laid.positions[i];
        return { commands: g.path.commands.map((c) => ({ command: c.command, args: c.args.slice() })), xAdvance: p.xAdvance, xOffset: p.xOffset, yOffset: p.yOffset };
      });
      return { glyphs, missing };
    }),
  };
}
