// Text to path's pipeline (P1-M4 S2), pure: the text library and the faces' bytes come in through
// `deps`, so node's tests run it with fontkit itself over the catalogue's files, and the editor and the
// Export sheet hand it the lazy chunk (load.ts) and Fonts.bytes (or a file's own face's bytes).
// 1. The library loads (its chunk, the first time); if it can't, nothing is outlined: OFFLINE.
// 2. The budget, before anything is shaped: the texts are taken in order while their characters total at
//    most 20,000 (about 12 MB of path data); one that would take the total past it is refused (and a
//    later, shorter one may still fit).
// 3. Each face the texts use is read once (its bytes, then one shape call for all its runs).
// 4. Each text is outlined (engine/text/outline.ts outlineD) unless one of its characters is outside
//    its face's unicode-range (the browser draws it from another font) or left on .notdef, its face's
//    file couldn't be had or read (a unitsPerEm outside 16 to 16384 is unreadable, as the browser's
//    own sanitizer finds it), its glyphs' numbers can't be drawn, or nothing would be drawn: then it
//    says why.
// The result is per text, so Text to path can refuse when any text does, and Export's "As paths" can
// keep a text it can't outline as text.

import { NO_GLYPH, inUnicodeRange, outlineD, type OutlineFace, type OutlineText, type ShapedRun } from '../../../../engine/text/outline.ts';
import type { ShapedFace, TextLib } from './load.ts';

export interface TextDeps {
  /** The text library (load.ts's lazy chunk, or a test's). */
  lib(): Promise<TextLib>;
  /** A face's file, or null when it can't be had (a fetch that failed). */
  bytes(face: OutlineFace): Promise<Uint8Array | null>;
  /** The unicode-range the canvas registers the face with (the catalogue's latin), or null for every character. */
  range(face: OutlineFace): string | null;
}

export const OFFLINE = 'Draw couldn’t load the text tools. Try again when you’re online.';
export const EMPTY = 'Nothing would be left.';
export const faceUnloaded = (family: string) => `Draw couldn’t load ${family}. Try again when you’re online.`;
export const faceUnreadable = (family: string) => `Draw can’t read ${family}’s file.`;
/** The most characters one Text to path, or one export, outlines. */
export const MAX_OUTLINE_CHARS = 20000;
export const TOO_MUCH_TEXT = 'Draw outlines up to 20,000 characters at once.';
/** Text to path's refusal when the selected texts hold more than MAX_OUTLINE_CHARS characters. */
export const tooMuchText = (n: number) => `The selection holds too much text to turn into paths at once: ${n.toLocaleString('en-US')} characters, and Draw outlines up to 20,000.`;
/** The characters a text outlines (code points, every run's). */
export function outlineChars(t: OutlineText): number {
  let n = 0;
  for (const c of t.chunks) for (const r of c.runs) for (const _ of r.text) n++;
  return n;
}
/** Why a text whose glyphs' numbers can't be drawn isn't outlined, naming the text (its first 40 characters). */
export const cantOutline = (label: string) => `Draw can’t outline “${[...label].length > 40 ? `${[...label].slice(0, 40).join('')}…` : label}”.`;

export type Outlined = { d: string } | { refused: string };

const keyOf = (f: OutlineFace) => `${f.own ?? ''}|${f.family.toLowerCase()}|${f.weight}|${f.style}`;

/** Each text's outline, in order (the header's steps), or OFFLINE when the library can't load. */
export async function outlineTexts(texts: readonly OutlineText[], deps: TextDeps): Promise<Outlined[] | { refused: string }> {
  let lib: TextLib;
  try {
    lib = await deps.lib();
  } catch {
    return { refused: OFFLINE };
  }
  const why: (string | null)[] = texts.map(() => null);
  let left = MAX_OUTLINE_CHARS;
  texts.forEach((t, i) => {
    const n = outlineChars(t);
    if (n > left) why[i] = TOO_MUCH_TEXT;
    else left -= n;
  });
  // Every run of the texts within the budget, by its face, in the order the texts first use each.
  const faces = new Map<string, { face: OutlineFace; runs: { t: number; c: number; r: number; text: string }[] }>();
  texts.forEach((t, ti) => {
    if (why[ti] !== null) return;
    t.chunks.forEach((chunk, ci) =>
      chunk.runs.forEach((run, ri) => {
        const k = keyOf(run.face);
        let f = faces.get(k);
        if (!f) faces.set(k, (f = { face: run.face, runs: [] }));
        f.runs.push({ t: ti, c: ci, r: ri, text: run.text });
      }),
    );
  });
  const shaped: (ShapedRun | null)[][][] = texts.map((t) => t.chunks.map((c) => c.runs.map(() => null)));
  for (const { face, runs } of faces.values()) {
    const range = deps.range(face);
    if (range !== null) {
      for (const u of runs) {
        if (why[u.t] !== null) continue;
        for (const ch of u.text) {
          if (inUnicodeRange(range, ch.codePointAt(0)!)) continue;
          why[u.t] = NO_GLYPH(face.family, ch);
          break;
        }
      }
    }
    const bytes = await deps.bytes(face);
    if (!bytes) {
      for (const u of runs) why[u.t] ??= faceUnloaded(face.family);
      continue;
    }
    let out: ShapedFace;
    try {
      out = lib.shape(bytes, runs.map((u) => u.text));
    } catch {
      for (const u of runs) why[u.t] ??= faceUnreadable(face.family);
      continue;
    }
    if (!Number.isInteger(out.unitsPerEm) || out.unitsPerEm < 16 || out.unitsPerEm > 16384) {
      for (const u of runs) why[u.t] ??= faceUnreadable(face.family);
      continue;
    }
    runs.forEach((u, i) => {
      const s = out.runs[i];
      if (s.missing.length) why[u.t] ??= NO_GLYPH(face.family, s.missing[0]);
      shaped[u.t][u.c][u.r] = { unitsPerEm: out.unitsPerEm, glyphs: s.glyphs };
    });
  }
  return texts.map((t, i): Outlined => {
    const no = why[i];
    if (no !== null) return { refused: no };
    let d: string;
    try {
      d = outlineD(t, shaped[i] as ShapedRun[][]);
    } catch {
      return { refused: cantOutline(t.label) }; // a number fmt won't write (NaN, Infinity) from the face's data
    }
    return d ? { d } : { refused: EMPTY };
  });
}
