// Fonts (P1-M4): the only code that touches FontFace, document.fonts, the font files' bytes and your
// fonts' storage (check-sinks' font-face rule: registering a face is a page-wide write). The editor
// reaches it through EditorPorts.fonts; nothing here runs at import, so node can import the editor,
// and outside a browser (no FontFace) the app's instance does nothing.
//
// - use(faces): registers each face a drawing asks for (engine/text/font-faces.ts usedFaces), found
//   in this order: the drawing's own faces (documentFaces: they win for their family, which is what
//   the file shows alone), your fonts, the catalogue; an exact weight and style only (no nearest
//   match: Inspect and the Font sheet write only real faces). Each catalogue file is fetched once
//   (memoized; a failed fetch is forgotten, so the next use tries again), made a FontFace from its
//   bytes with the latin unicode-range, loaded, and added to document.fonts. Idempotent. A failure
//   says "Draw couldn't load <family>. Try again when you're online." and leaves the text in its
//   fallback.
// - documentFaces(faces): the open drawing's own data: faces (engine/text/font-faces.ts fontFaces),
//   replacing the last drawing's (deleted from document.fonts); a face the name guard refuses (named
//   like Draw's own interface fonts, a generic family or a CSS-wide keyword) is never registered.
//   The editor calls it on open, when the document's <style> text changes, and with [] when the
//   drawing closes.
// - Listeners hear a face that finished loading, a failure, and your fonts changing: the editor then
//   measures again (a text's drawn box changes when its face arrives) and asks for the faces again.
// - bytes(face): the same bytes, for text to path and export (S2).
// - Your fonts (Add a font…): kept on this device in the drafts' IndexedDB store (one database, one
//   store: idb-keyval makes a store only when its database is new) under draw:font:<sha-256 of the
//   bytes>, which the drafts list skips. Draw takes .woff2, .woff, .ttf and .otf files up to 10 MB,
//   read by the text library's openFont (the lazy chunk): its family, weight class, italic flag,
//   embedding bits, copyright and licence, and any Reserved Font Name they give. A full quota is loud.
//   Safari deletes script-written storage after seven days without a visit: P2's library is their
//   durable home.

import { CATALOGUE, LATIN_RANGE, catalogueFamily, faceFile, hasFace } from './font-catalogue.ts';
import { idbKV, type KV } from './drafts.ts';
import { appFontName, type FaceRequest, type FontFormat, type OwnFace } from '../../../../engine/text/font-faces.ts';
import { xmlCharError } from '../../../../engine/code/edit.ts';
import { loadTextLib, type FontInfo } from '../text/load.ts';

export { appFontName };

export const ADD_REFUSED = 'Draw takes .woff2, .woff, .ttf and .otf fonts up to 10 MB.';
export const UNREADABLE = 'Draw can’t read this font file.';
export const MAX_FONT_BYTES = 10e6;
export const FONT_PREFIX = 'draw:font:';
export const FONTS_FULL = 'Storage is full: remove fonts or drafts you don’t need, then add the font again.';
export const couldNotLoad = (family: string) => `Draw couldn’t load ${family}. Try again when you’re online.`;
export const namedLikeApp = (family: string) => `Draw can’t take ${family}: it shares a name with Draw’s own interface fonts.`;
export const MAX_FAMILY_CHARS = 128;
export const badFamilyName = (why: string) => `Draw can’t use this font’s name: ${why}.`;

/**
 * Why Draw can't take a family name, or null: a name the drawing's font-family can hold, so no
 * character XML can't hold (P0's message), no control character (C0 or C1: a tab or a line break in a
 * name would be normalized away in an attribute, and would break a <style> rule), and at most 128
 * characters.
 */
export function familyNameError(family: string): string | null {
  const xml = xmlCharError(family);
  if (xml) return badFamilyName(xml);
  const c = /[\u0000-\u001f\u007f-\u009f]/.exec(family);
  if (c) return badFamilyName(`it holds the control character U+${c[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  if ([...family].length > MAX_FAMILY_CHARS) return badFamilyName(`it is longer than ${MAX_FAMILY_CHARS} characters`);
  return null;
}

export class FontError extends Error {}

/** One of your fonts, as stored. */
export interface MyFont {
  id: string; // the SHA-256 of its bytes, hex
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  fileName: string;
  format: FontFormat;
  bytes: ArrayBuffer;
  added: number; // ms
  copyright: string;
  licence: string;
  reserved: string[]; // its Reserved Font Names (from its copyright and licence strings)
  fsType: number; // OS/2 embedding bits
}

export type FontEvent = { kind: 'loaded' } | { kind: 'failed'; family: string } | { kind: 'mine' };

/** What the editor and the panels ask of the fonts (EditorPorts.fonts). */
export interface Fonts {
  use(faces: readonly FaceRequest[]): void;
  documentFaces(faces: readonly OwnFace[]): void;
  bytes(face: FaceRequest): Promise<Uint8Array | null>;
  /** Does Draw hold a file for this family (yours, or the catalogue's)? */
  holds(family: string): boolean;
  /** The family's real faces Draw holds (yours and the catalogue's), or null for a family it holds none of. */
  faces(family: string): { weights: number[]; italics: number[] } | null;
  mine(): readonly MyFont[];
  add(file: Blob, fileName: string): Promise<MyFont>;
  remove(id: string): Promise<void>;
  subscribe(fn: (e: FontEvent) => void): () => void;
}

/** A FontFace as fonts.ts uses one. */
export interface FaceLike {
  load(): Promise<unknown>;
}
export interface FaceSet {
  add(face: FaceLike): unknown;
  delete(face: FaceLike): unknown;
}

/** What fonts.ts needs from the page: the browser's in the app, fakes in the tests. */
export interface FontDeps {
  makeFace(family: string, bytes: ArrayBuffer, descriptors: Record<string, string>): FaceLike;
  set: FaceSet;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  /** The catalogue's file URLs by file name (font-files.ts). */
  urls(): Promise<Readonly<Record<string, string>>>;
  kv: KV;
  sha256(bytes: Uint8Array): Promise<string>;
  openFont(bytes: Uint8Array): Promise<FontInfo>;
  now(): number;
}

/** A font file's format from its first four bytes, or null. */
export function sniffFont(b: Uint8Array): FontFormat | null {
  const tag = String.fromCharCode(...b.subarray(0, 4));
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'opentype';
  if (tag === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'truetype';
  return null;
}

/**
 * The Reserved Font Names a font's copyright or licence string gives. Any mention of "Reserved Font
 * Name(s)" or "Reserved Name(s)" reserves (strict, as Mark chose: a wrong reservation only writes
 * paths): the quoted names after it ("…with Reserved Font Name 'Source'", "Reserved Names "PT Sans"
 * and "ParaType""), else the name that follows it, up to punctuation ("…with Reserved Font Name
 * Oswald.", "Reserved Font Name: Gentium."), else `family` itself. The term itself in quotes, as the
 * licence's own text defines it, reserves nothing.
 */
export function reservedNames(family: string, ...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(/Reserved\s+(?:Font\s+)?Names?\b/gi)) {
      // The term itself in quotes (OFL 1.1's own text: “"Reserved Font Name" refers to…”) reserves nothing.
      if (/["“'‘]$/.test(t.slice(0, m.index)) && /^["”'’]/.test(t.slice(m.index + m[0].length))) continue;
      const after = t.slice(m.index + m[0].length).replace(/^\s*:?\s*/, '');
      const quoted = /^(?:["“'‘][^"”'’]+["”'’]\s*(?:,|and\b|&)?\s*)+/i.exec(after);
      const bare = quoted ? null : /^[\p{L}\p{N}][^.,;:()[\]"“”'‘’\r\n]*/u.exec(after);
      const names = quoted ? [...quoted[0].matchAll(/["“'‘]([^"”'’]+)["”'’]/g)].map((q) => q[1]) : bare ? bare[0].split(/\s+(?:and|&)\s+/i) : [family];
      for (const n of names) if (n.trim()) out.add(n.trim());
    }
  }
  return [...out];
}

/** Is this a record fonts.ts wrote (every project on the origin can write the database), with a family add() takes? */
export function isMyFont(v: unknown, id: string): v is MyFont {
  const f = v as MyFont;
  return !!f && typeof f === 'object' && f.id === id && typeof f.family === 'string' && f.family !== '' && familyNameError(f.family) === null && !appFontName(f.family) && Number.isFinite(f.weight) && (f.style === 'normal' || f.style === 'italic') && typeof f.fileName === 'string' && (['woff2', 'woff', 'truetype', 'opentype'] as unknown[]).includes(f.format) && f.bytes instanceof ArrayBuffer && Array.isArray(f.reserved) && f.reserved.every((r) => typeof r === 'string') && typeof f.copyright === 'string' && typeof f.licence === 'string' && Number.isFinite(f.fsType) && Number.isFinite(f.added);
}

const isQuota = (e: unknown) => e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
const lower = (s: string) => s.trim().toLowerCase();
const keyOf = (f: FaceRequest) => `${lower(f.family)}|${f.weight}|${f.style}`;
const copy = (b: ArrayBuffer | Uint8Array): ArrayBuffer => (b instanceof Uint8Array ? b.slice().buffer : b.slice(0));

/** The fonts over these dependencies (see the header). */
export function createFonts(deps: FontDeps): Fonts {
  const listeners = new Set<(e: FontEvent) => void>();
  const emit = (e: FontEvent) => {
    for (const fn of [...listeners]) fn(e);
  };
  const fetched = new Map<string, Promise<ArrayBuffer>>(); // by URL; a failed fetch is forgotten
  const registered = new Map<string, Promise<void>>(); // by face; a failed one is forgotten
  const madeFor = new Map<string, FaceLike>(); // your fonts' and the catalogue's faces, by face
  let own: FaceLike[] = []; // the open drawing's own faces
  let ownFamilies = new Set<string>();
  let mine: MyFont[] = [];
  let loading: Promise<void> | null = null;

  // Your fonts, read once from storage; a listener hears them arrive.
  const ready = (): Promise<void> =>
    (loading ??= (async () => {
      try {
        const found: MyFont[] = [];
        for (const k of await deps.kv.keys()) {
          if (!k.startsWith(FONT_PREFIX)) continue;
          const v = await deps.kv.get<unknown>(k);
          if (isMyFont(v, k.slice(FONT_PREFIX.length))) found.push(v);
        }
        mine = found.sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight);
      } catch {
        mine = []; // no storage (a private window): no fonts of yours
      }
      if (mine.length) emit({ kind: 'mine' });
    })());

  const yours = (f: FaceRequest) => mine.find((m) => lower(m.family) === lower(f.family) && m.weight === f.weight && m.style === f.style);

  const fileBytes = (url: string): Promise<ArrayBuffer> => {
    let p = fetched.get(url);
    if (!p) {
      p = deps.fetchBytes(url);
      fetched.set(url, p);
      p.catch(() => fetched.delete(url));
    }
    return p;
  };

  const catalogueUrl = async (f: FaceRequest): Promise<string | null> => {
    const c = catalogueFamily(f.family);
    if (!c || !hasFace(c, f.weight, f.style)) return null;
    return (await deps.urls())[faceFile(c.slug, f.weight, f.style)] ?? null;
  };

  const register = (f: FaceRequest): void => {
    const key = keyOf(f);
    if (registered.has(key) || ownFamilies.has(lower(f.family))) return;
    const mineFace = yours(f);
    const c = mineFace ? null : catalogueFamily(f.family);
    if (!mineFace && !(c && hasFace(c, f.weight, f.style))) return; // Draw holds no file for it
    const p = (async () => {
      const descriptors: Record<string, string> = { weight: String(f.weight), style: f.style };
      let bytes: ArrayBuffer;
      let family: string;
      if (mineFace) {
        bytes = copy(mineFace.bytes);
        family = mineFace.family;
      } else {
        const url = await catalogueUrl(f);
        if (!url) throw new Error('no file');
        bytes = copy(await fileBytes(url));
        family = c!.family;
        descriptors.unicodeRange = LATIN_RANGE;
      }
      const face = deps.makeFace(family, bytes, descriptors);
      await face.load();
      deps.set.add(face);
      madeFor.set(key, face);
    })();
    registered.set(key, p);
    p.then(
      () => emit({ kind: 'loaded' }),
      () => {
        registered.delete(key);
        emit({ kind: 'failed', family: f.family });
      },
    );
  };

  return {
    use(faces) {
      void ready().then(() => {
        for (const f of faces) register(f);
      });
    },

    documentFaces(faces) {
      for (const f of own) deps.set.delete(f);
      own = [];
      ownFamilies = new Set();
      const loads: Promise<unknown>[] = [];
      for (const f of faces) {
        if (appFontName(f.family)) continue;
        let face: FaceLike;
        try {
          face = deps.makeFace(f.family, copy(f.bytes), { weight: f.weight, style: f.style, stretch: f.stretch, unicodeRange: f.unicodeRange });
        } catch {
          continue; // a descriptor the browser can't read: the face is left out, as the canvas leaves it
        }
        own.push(face);
        ownFamilies.add(lower(f.family));
        deps.set.add(face);
        loads.push(face.load().catch(() => deps.set.delete(face)));
      }
      // A face of yours or the catalogue's under a family the drawing holds itself would compete with it.
      for (const [key, face] of madeFor) {
        if (!ownFamilies.has(key.slice(0, key.indexOf('|')))) continue;
        deps.set.delete(face);
        madeFor.delete(key);
        registered.delete(key);
      }
      if (loads.length) void Promise.all(loads).then(() => emit({ kind: 'loaded' }));
    },

    async bytes(f) {
      await ready();
      const m = yours(f);
      if (m) return new Uint8Array(copy(m.bytes));
      const url = await catalogueUrl(f);
      if (!url) return null;
      try {
        return new Uint8Array(copy(await fileBytes(url)));
      } catch {
        return null;
      }
    },

    holds(family) {
      return !!catalogueFamily(family) || mine.some((m) => lower(m.family) === lower(family));
    },

    faces(family) {
      const c = catalogueFamily(family);
      const ws = new Set<number>(c?.weights ?? []);
      const is = new Set<number>(c?.italics ?? []);
      for (const m of mine) if (lower(m.family) === lower(family)) (m.style === 'italic' ? is : ws).add(m.weight);
      if (!c && !ws.size && !is.size) return null;
      return { weights: [...ws].sort((a, b) => a - b), italics: [...is].sort((a, b) => a - b) };
    },

    mine: () => mine,

    async add(file, fileName) {
      await ready();
      if (file.size > MAX_FONT_BYTES) throw new FontError(ADD_REFUSED);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = sniffFont(bytes);
      if (!format) throw new FontError(ADD_REFUSED);
      let info: FontInfo;
      try {
        info = await deps.openFont(bytes);
      } catch {
        throw new FontError(UNREADABLE);
      }
      const family = info.family.trim();
      if (!family) throw new FontError(UNREADABLE);
      const badName = familyNameError(family);
      if (badName) throw new FontError(badName);
      if (appFontName(family)) throw new FontError(namedLikeApp(family));
      const id = await deps.sha256(bytes);
      const font: MyFont = { id, family, weight: info.weight, style: info.italic ? 'italic' : 'normal', fileName, format, bytes: copy(bytes), added: deps.now(), copyright: info.copyright, licence: info.licence, reserved: reservedNames(family, info.copyright, info.licence), fsType: info.fsType };
      try {
        await deps.kv.set(FONT_PREFIX + id, font);
      } catch (e) {
        if (isQuota(e)) throw new FontError(FONTS_FULL);
        throw e;
      }
      mine = [...mine.filter((m) => m.id !== id), font].sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight);
      emit({ kind: 'mine' });
      return font;
    },

    async remove(id) {
      await ready();
      const gone = mine.find((m) => m.id === id);
      await deps.kv.del(FONT_PREFIX + id);
      mine = mine.filter((m) => m.id !== id);
      if (gone) {
        const key = keyOf({ family: gone.family, weight: gone.weight, style: gone.style });
        const face = madeFor.get(key);
        if (face) deps.set.delete(face);
        madeFor.delete(key);
        registered.delete(key);
      }
      emit({ kind: 'mine' });
    },

    subscribe(fn) {
      listeners.add(fn);
      void ready();
      return () => listeners.delete(fn);
    },
  };
}

// ── the app's instance ─────────────────────────────────────────────────────────────────────────

const NONE: Fonts = {
  use: () => {},
  documentFaces: () => {},
  bytes: async () => null,
  holds: (family) => !!catalogueFamily(family),
  faces: (family) => {
    const c = catalogueFamily(family);
    return c ? { weights: [...c.weights], italics: [...c.italics] } : null;
  },
  mine: () => [],
  add: async () => {
    throw new FontError(UNREADABLE);
  },
  remove: async () => {},
  subscribe: () => () => {},
};

let app: Fonts | null = null;

/** The page's fonts: the browser's FontFace, document.fonts, fetch and IndexedDB (none outside a browser). */
export function appFonts(): Fonts {
  if (app) return app;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return NONE;
  app = createFonts({
    makeFace: (family, bytes, descriptors) => new FontFace(family, bytes, descriptors),
    set: document.fonts as unknown as FaceSet,
    fetchBytes: async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.arrayBuffer();
    },
    urls: async () => (await import('./font-files.ts')).FONT_FILES,
    kv: idbKV(),
    sha256: async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()))].map((b) => b.toString(16).padStart(2, '0')).join(''),
    openFont: async (bytes) => (await loadTextLib()).openFont(bytes),
    now: () => Date.now(),
  });
  return app;
}

/** The catalogue's ten families' 400 normal faces (the Font sheet draws each name in its own). */
export const SHEET_FACES: readonly FaceRequest[] = CATALOGUE.filter((f) => f.weights.includes(400)).map((f) => ({ family: f.family, weight: 400, style: 'normal' }));
