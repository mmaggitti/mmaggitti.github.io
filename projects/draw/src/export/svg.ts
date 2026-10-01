// What the Export sheet writes: the file's bytes and its name, computed synchronously (the share
// sheet must be asked for inside the tap that asked for it).
//
// - As-is: the file without Draw's own state (stripDrawState: guides, the grid step, locks), every
//   other byte Draw didn't change kept, in the encoding the file came in (what decodeSvg found, byte
//   order included), so an unedited file exports byte for byte. A .svgz exports as its plain .svg.
// - Clean: without editor data (engine/export/clean.ts), Draw's own included, with what it removed.
// - Save to Files: the working copy, serialize(doc): everything kept, Draw's own state too (one
//   <draw:state> in the file's <metadata>, draw:* attributes), to open in Draw again.
// - Clean's text (P1-M4 S2, prepareExport, async: the text library's chunk and the faces' files load
//   first, so the sheet prepares it when the choice is made and the tap shares it at once), on a
//   parsed copy, before the clean:
//   - As text: the clean file as above.
//   - As paths: every text Draw can outline becomes a path (Text to path's reading and write); the rest
//     stay text, and the notes say why.
//   - With fonts: one <style> as the root's first element child after any leading <title>, <desc> and
//     <metadata>, one @font-face per face of Draw's (the catalogue's, or yours) the texts use, the face's
//     whole file as a data: URL (Draw can't make subsets: fontkit's subsetter writes no cmap), each
//     after a comment naming its copyright and licence. Never a face whose font has a Reserved Font
//     Name (OFL 1.1: the catalogue's "Plex" and "Source", or one your font's copyright or licence
//     gives), nor one whose OS/2 fsType forbids embedding in an editable file: its texts are written
//     as paths instead, and the notes say why. A text in a family Draw holds no file for stays text;
//     the file's own @font-face rules stay as they are. A text whose font a <style> rule may set is
//     left as it is (Draw can't read selectors yet: P2), and a note names it.

import { NS, descendants, el, parseDoc, serialize, type Doc, type NodeId } from '../../../../engine/model/doc.ts';
import { cleanExport } from '../../../../engine/export/clean.ts';
import { stripDrawState } from '../../../../engine/model/draw-state.ts';
import { insertMarkup } from '../../../../engine/model/space.ts';
import { escape } from '../../../../engine/xml/entities.ts';
import { renderedText, textRuns } from '../../../../engine/text/space.ts';
import { GENERIC_FAMILIES, appFontName, computedFamilies, computedStyle, computedWeight, fontFaces, type FaceRequest, type FontFormat, type OwnFace } from '../../../../engine/text/font-faces.ts';
import { outlineText, type OutlineCtx, type OutlineText } from '../../../../engine/text/outline.ts';
import { textPathMarkup, writeTextToPath } from '../../../../engine/text/to-path.ts';
import { OFFLINE, faceUnloaded, outlineTexts, type TextDeps } from '../text/pipeline.ts';
import type { TextLib } from '../text/load.ts';
import { encodeSvg } from '../platform/files.ts';

export type ExportKind = 'as-is' | 'clean' | 'working';

export interface ExportFile {
  kind: ExportKind;
  fileName: string;
  bytes: Uint8Array;
  encoding: string;
  /** The encoding the file declared, when it couldn't hold its text: it was written as UTF-8. */
  relabeled: string | null;
  /** What Clean removed (null for the other kinds). */
  removed: { elements: number; attributes: number } | null;
}

/**
 * A file name from a drawing's name: no path separators or characters iOS and Windows refuse, and
 * no format characters (a bidi override would show one name and save another).
 */
export function fileNameFor(name: string, suffix = ''): string {
  const safe = name.replace(/\p{Cf}/gu, '').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '-').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 80);
  return `${safe || 'drawing'}${suffix}.svg`;
}

/** `read`: the encoding the file's bytes came in (decodeSvg's), or undefined for text that came as text. */
export function exportFile(doc: Doc, name: string, kind: ExportKind, read?: string): ExportFile {
  const clean = kind === 'clean' ? cleanExport(doc) : null;
  const text = clean ? clean.text : kind === 'as-is' ? stripDrawState(doc) : serialize(doc);
  const { bytes, encoding, relabeled } = encodeSvg(text, read);
  return {
    kind,
    fileName: fileNameFor(name, kind === 'clean' ? '-clean' : ''),
    bytes,
    encoding,
    relabeled,
    removed: clean ? { elements: clean.removedElements, attributes: clean.removedAttributes } : null,
  };
}

// ── Clean's text (P1-M4 S2) ────────────────────────────────────────────────────────────────────

/** The Export sheet's Text choice for Clean. */
export type TextChoice = 'text' | 'paths' | 'fonts';

/** What Draw knows of a face it holds: the catalogue's (OFL), or one of yours. */
export interface HeldFace {
  family: string;
  reserved: readonly string[];
  copyright: string;
  /** Its licence string, or null for the catalogue's OFL. */
  licence: string | null;
  format: FontFormat;
}
/** What prepareExport needs from the editor: the text tools, and the faces Draw holds. */
export interface ExportDeps {
  /** Text to path's library and files (`own`: the copy's own faces). */
  textDeps(own: readonly OwnFace[]): TextDeps;
  faces: OutlineCtx['faces'];
  /** The face Draw holds at exactly this weight and style (yours first, as fonts.ts registers them), or null. */
  held(face: FaceRequest): HeldFace | null;
}
export interface Prepared {
  file: ExportFile;
  /** What the sheet says about the text: what was written as paths and why, what stayed text. */
  notes: string[];
}

export const OFL = 'SIL Open Font License 1.1, https://openfontlicense.org';
export const reservesName = (family: string, name: string) => `${family} reserves the name “${name}”, so its text is written as paths.`;
export const noEmbedding = (family: string) => `${family}’s font doesn’t allow embedding in an editable file, so its text is written as paths.`;
export const notDraws = (family: string) => `${family} isn’t one of Draw’s fonts, so its text stays as it is.`;
export const keptAsText = (n: number, reasons: readonly string[]) => `Kept as text: ${n}. ${reasons.join(' ')}`;
/** With fonts' note on the texts whose font a <style> rule may set (named by their first characters, at most three). */
export function ruledFonts(names: readonly string[]): string {
  const q = names.slice(0, 3).map((n) => `“${[...n].length > 40 ? `${[...n].slice(0, 40).join('')}…` : n}”`);
  const more = names.length - q.length;
  const list = more ? `${q.join(', ')} and ${more} more` : q.length > 1 ? `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}` : q[0];
  return `A <style> rule sets the font of ${list}, which Draw can’t read yet (P2): ${names.length === 1 ? 'its font isn’t' : 'their fonts aren’t'} embedded.`;
}

/**
 * May a face with these OS/2 fsType bits be embedded in an editable file? Its bitmapOnly bit (9) clear,
 * and its editable bit (3) set or neither its noEmbedding (1) nor its viewOnly (2) bit; noSubsetting
 * (8) doesn't matter, since Draw embeds whole files.
 */
export function embeddable(fsType: number): boolean {
  if (fsType & 0x200) return false;
  return (fsType & 0x8) !== 0 || (fsType & 0x6) === 0;
}

const FORMATS: Readonly<Record<FontFormat, { mime: string; name: string }>> = {
  woff2: { mime: 'font/woff2', name: 'woff2' },
  woff: { mime: 'font/woff', name: 'woff' },
  truetype: { mime: 'font/ttf', name: 'truetype' },
  opentype: { mime: 'font/otf', name: 'opentype' },
};

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const keyOf = (f: FaceRequest) => `${f.family.toLowerCase()}|${f.weight}|${f.style}`;

// The faces of Draw's a text uses (as usedFaces finds them: each run's first family that is generic,
// the file's own, or one Draw holds), the first families it names that Draw holds no file for, and
// whether a <style> rule may set the font of one of its runs (Draw can't read that yet: P2).
function facesOf(doc: Doc, id: NodeId, own: ReadonlySet<string>, deps: ExportDeps): { faces: FaceRequest[]; foreign: string[]; ruled: boolean } {
  const faces = new Map<string, FaceRequest>();
  const foreign = new Set<string>();
  let ruled = false;
  for (const run of textRuns(doc, id)) {
    if (!run.text) continue;
    const families = computedFamilies(doc, run.owner);
    const weight = computedWeight(doc, run.owner);
    const style = computedStyle(doc, run.owner);
    if (!families || weight === null || style === null) {
      ruled = true;
      continue;
    }
    const known = (f: string) => GENERIC_FAMILIES.has(f.toLowerCase()) || own.has(f.toLowerCase()) || deps.faces(f) !== null;
    if (families[0] && !known(families[0])) foreign.add(families[0]); // the browser draws it where it is installed
    const family = families.find(known);
    if (!family || GENERIC_FAMILIES.has(family.toLowerCase()) || own.has(family.toLowerCase())) continue;
    const face = { family, weight, style };
    faces.set(keyOf(face), face);
  }
  return { faces: [...faces.values()], foreign: [...foreign], ruled };
}

/** Why Clean's text couldn't be prepared when something failed outright (the text library misbehaving). */
export const unprepared = (e: unknown) => `Draw couldn’t prepare the text: ${e instanceof Error ? e.message : String(e)}.`;

/**
 * Clean's file with its text as paths or with fonts (the module header), or why it can't be made (the
 * text library or a face's file that won't load, or anything failing outright: never a rejection): the
 * sheet then falls back to As text, saying why.
 */
export async function prepareExport(doc: Doc, name: string, choice: 'paths' | 'fonts', deps: ExportDeps, read?: string): Promise<Prepared | { refused: string }> {
  try {
    return await prepare(doc, name, choice, deps, read);
  } catch (e) {
    return { refused: unprepared(e) };
  }
}

async function prepare(doc: Doc, name: string, choice: 'paths' | 'fonts', deps: ExportDeps, read?: string): Promise<Prepared | { refused: string }> {
  const parsed = parseDoc(serialize(doc));
  if (!parsed.ok) return { refused: parsed.error.message };
  const copy = parsed.doc;
  const ownFaces = fontFaces(copy).faces;
  const textDeps = deps.textDeps(ownFaces);
  const texts = [...descendants(copy, copy.root)].filter((n) => n.kind === 'element' && n.ns === NS.svg && n.local === 'text').map((n) => n.id);
  const notes: string[] = [];
  let toPaths = texts;
  const embed: { face: FaceRequest; held: HeldFace; bytes: Uint8Array }[] = [];
  if (choice === 'fonts') {
    // Each face of Draw's the texts use, read once: embedded, or (a reserved name, or bits that
    // forbid it) its texts written as paths.
    let lib: TextLib;
    try {
      lib = await textDeps.lib();
    } catch {
      return { refused: OFFLINE };
    }
    const own = new Set(ownFaces.filter((f) => !appFontName(f.family)).map((f) => f.family.toLowerCase()));
    const verdict = new Map<string, string | null>(); // by face: why it isn't embedded, or null
    const foreign = new Set<string>();
    const ruled: string[] = []; // the texts whose font a <style> rule may set, by their characters
    toPaths = [];
    for (const id of texts) {
      const used = facesOf(copy, id, own, deps);
      for (const f of used.foreign) foreign.add(f);
      if (used.ruled) ruled.push(renderedText(copy, id).replace(/\s+/g, ' ').trim());
      let why: string | null = null;
      for (const face of used.faces) {
        const k = keyOf(face);
        if (!verdict.has(k)) {
          const held = deps.held(face);
          if (!held) {
            verdict.set(k, null); // no file for this exact face: nothing to embed
            continue;
          }
          const bytes = await textDeps.bytes({ ...face, own: null });
          if (!bytes) return { refused: faceUnloaded(face.family) };
          let fsType = 0;
          try {
            fsType = lib.openFont(bytes).fsType;
          } catch {
            return { refused: `Draw can’t read ${face.family}’s file.` };
          }
          const no = held.reserved.length ? reservesName(held.family, held.reserved[0]) : !embeddable(fsType) ? noEmbedding(held.family) : null;
          verdict.set(k, no);
          if (!no) embed.push({ face, held, bytes });
        }
        why ??= verdict.get(k) ?? null;
      }
      if (why) {
        toPaths.push(id);
        if (!notes.includes(why)) notes.push(why);
      }
    }
    for (const f of foreign) notes.push(notDraws(f));
    if (ruled.length) notes.push(ruledFonts(ruled));
  }
  // The texts to write as paths: each one Draw can outline (the rest stay text, and say why).
  const reads: { id: NodeId; read: OutlineText }[] = [];
  const kept: string[] = [];
  for (const id of toPaths) {
    const r = outlineText(copy, id, deps);
    if ('refused' in r) kept.push(r.refused);
    else reads.push({ id, read: r });
  }
  const out = await outlineTexts(reads.map((r) => r.read), textDeps);
  if ('refused' in out) return out;
  const items: { id: NodeId; markup: string }[] = [];
  out.forEach((o, i) => {
    if ('refused' in o) kept.push(o.refused);
    else items.push({ id: reads[i].id, markup: textPathMarkup(copy, reads[i].id, o.d, reads[i].read.label) });
  });
  const none = () => {};
  if (items.length) writeTextToPath(copy, items, none);
  if (embed.length) insertMarkup(copy, styleWhere(copy), styleMarkup(copy, embed), none);
  if (kept.length) notes.push(keptAsText(kept.length, [...new Set(kept)]));
  const clean = cleanExport(copy);
  const { bytes, encoding, relabeled } = encodeSvg(clean.text, read);
  return { file: { kind: 'clean', fileName: fileNameFor(name, '-clean'), bytes, encoding, relabeled, removed: { elements: clean.removedElements, attributes: clean.removedAttributes } }, notes };
}

// Where the <style> goes: the root's first element child after any leading <title>, <desc> and <metadata>.
function styleWhere(doc: Doc): { before: NodeId } | { last: NodeId } {
  for (const c of el(doc, doc.root).children) {
    const n = doc.nodes.get(c)!;
    if (n.kind !== 'element') continue;
    if (n.ns === NS.svg && (n.local === 'title' || n.local === 'desc' || n.local === 'metadata')) continue;
    return { before: c };
  }
  return { last: doc.root };
}

/** Text for a single-quoted CSS string: \\ and ' escaped, and a line break or other control character as a hex escape (`\\a `). */
export function cssString(s: string): string {
  return s.replace(/[\\']/g, (c) => `\\${c}`).replace(/[\u0000-\u001f\u007f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

// The <style> holding one @font-face per embedded face, each after its comment.
function styleMarkup(doc: Doc, faces: readonly { face: FaceRequest; held: HeldFace; bytes: Uint8Array }[]): string {
  const prefix = el(doc, doc.root).prefix;
  const qname = prefix ? `${prefix}:style` : 'style';
  const css = faces
    .map(({ face, held, bytes }) => {
      const f = FORMATS[held.format];
      const said = `${held.family}. ${held.copyright}${/[.!]$/.test(held.copyright) ? '' : '.'} ${held.licence ?? OFL}`.replace(/\*\//g, '* /').replace(/\s+/g, ' ');
      const family = cssString(held.family);
      return `/* ${said} */@font-face{font-family:'${family}';font-weight:${face.weight};font-style:${face.style};src:url(data:${f.mime};base64,${base64(bytes)}) format('${f.name}')}`;
    })
    .join('');
  return `<${qname}>${escape(css, null)}</${qname}>`;
}
