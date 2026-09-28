// Bytes in, SVG text out: what every way of opening a file shares (file picker, paste, drop, a
// share link's #import fragment). The text then goes to the engine's parser and nowhere else.
//
// - .svgz: gzip is recognised by its magic bytes, not the file name, and inflated with a hard cap,
//   so a small file cannot expand into gigabytes.
// - Encoding: a byte order mark wins, then the XML declaration's encoding, then UTF-8. Bad bytes
//   become U+FFFD rather than failing the open, and the result says so (lossy), since writing the
//   text back can't restore them.
// - #import=<deflate-raw, base64url>: SVG Lab's "Open in Draw" link carries the whole file in the
//   URL fragment, which never reaches a server.
// - The picker's file, the paste event's clipboard data and a drop's data are read here, the only
//   place Draw touches files and the clipboard (src/import.ts takes it from there).
// - Bytes out: encodeSvg writes a file back in the encoding decodeSvg found (byte order included),
//   so an unedited file exports byte for byte.

export const MAX_SVG_BYTES = 20e6; // the engine's parse limit (engine/xml/cst.ts DEFAULT_LIMITS)
export const MAX_IMPORT_FRAGMENT = 2e6; // characters of base64url in a #import link

export interface Decoded {
  text: string;
  /** The decoder used (a WHATWG encoding name): pass it to encodeSvg to write the file back. */
  encoding: string;
  gzip: boolean;
  /** Some bytes were not valid in that encoding: they became U+FFFD, so the text written back differs there. */
  lossy: boolean;
}

export class FileTooLargeError extends Error {}

const isGzip = (b: Uint8Array) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Inflate with a byte cap: stops reading once the output passes `max`. */
async function inflate(bytes: Uint8Array, format: 'gzip' | 'deflate-raw', max: number): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new FileTooLargeError(`the file expands past ${max / 1e6} MB`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The encoding a file declares: its BOM, else its XML declaration, else UTF-8. */
export function sniffEncoding(b: Uint8Array): string {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return 'utf-8';
  if (b[0] === 0xff && b[1] === 0xfe) return 'utf-16le';
  if (b[0] === 0xfe && b[1] === 0xff) return 'utf-16be';
  // The declaration is ASCII in every encoding a declaration can name here.
  const head = String.fromCharCode(...b.subarray(0, Math.min(b.length, 200)));
  const m = /^<\?xml[^>]*?\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head);
  if (m) {
    const label = m[1].toLowerCase();
    try {
      return new TextDecoder(label).encoding;
    } catch {
      return 'utf-8'; // an encoding the platform does not know: read it as UTF-8
    }
  }
  return 'utf-8';
}

/** Decode a file's bytes (gzip or not) to text. The BOM, if any, stays in the text (it round-trips). */
export async function decodeSvg(bytes: Uint8Array): Promise<Decoded> {
  if (bytes.byteLength > MAX_SVG_BYTES && !isGzip(bytes)) throw new FileTooLargeError(`the file is larger than ${MAX_SVG_BYTES / 1e6} MB`);
  const gzip = isGzip(bytes);
  const raw = gzip ? await inflate(bytes, 'gzip', MAX_SVG_BYTES) : bytes;
  const encoding = sniffEncoding(raw);
  try {
    return { text: new TextDecoder(encoding, { ignoreBOM: true, fatal: true }).decode(raw), encoding, gzip, lossy: false };
  } catch {
    return { text: new TextDecoder(encoding, { ignoreBOM: true }).decode(raw), encoding, gzip, lossy: true };
  }
}

// ── writing a file back ────────────────────────────────────────────────────────────────────────

export interface Encoded {
  bytes: Uint8Array;
  encoding: string;
  /** The encoding the declaration named, when it couldn't hold the text: written as UTF-8, and the declaration says so. */
  relabeled: string | null;
}

const DECLARED = /^(﻿?<\?xml[^>]*?\bencoding\s*=\s*["'])([A-Za-z0-9._-]+)(["'])/;
// The WHATWG single-byte encodings: one byte per character, so a table from their own decoder writes them.
const SINGLE_BYTE = /^(ibm866|iso-8859-\d+|koi8-[ru]|macintosh|windows-\d+|x-mac-cyrillic)$/;
const tables = new Map<string, Map<number, number>>();

function singleByteTable(encoding: string): Map<number, number> {
  let t = tables.get(encoding);
  if (!t) {
    t = new Map();
    const dec = new TextDecoder(encoding);
    for (let b = 255; b >= 0; b--) {
      const ch = dec.decode(Uint8Array.of(b));
      if (ch.length === 1 && ch !== '�') t.set(ch.charCodeAt(0), b);
    }
    tables.set(encoding, t);
  }
  return t;
}

function writeSingleByte(text: string, encoding: string): Uint8Array | null {
  const t = singleByteTable(encoding);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const b = t.get(text.charCodeAt(i));
    if (b === undefined) return null; // a character the encoding can't hold
    out[i] = b;
  }
  return out;
}

function writeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), littleEndian);
  return out;
}

/**
 * A file's bytes in the encoding it was read in: `read`, what decodeSvg found (its byte order
 * included), for a file that came as bytes. Text that came as text (a paste, a link, a draft) has
 * only its own word for it: a BOM (kept in the text) means UTF-8, or UTF-16 when the declaration
 * says so; else the XML declaration's encoding; else UTF-8. So a Latin-1 or UTF-16 file saves as it
 * came. An encoding Draw can't write (Shift_JIS and the other multi-byte legacy ones), or one that
 * can't hold a character the text now has, is written as UTF-8 with the declaration changed to say
 * so: never bytes that disagree with their own declaration.
 */
export function encodeSvg(text: string, read?: string): Encoded {
  const m = DECLARED.exec(text);
  let encoding = read ?? 'utf-8';
  if (read === undefined && m) {
    try {
      encoding = new TextDecoder(m[2]).encoding;
    } catch {
      encoding = 'utf-8'; // unknown to the platform: it was read as UTF-8 (sniffEncoding), so it is written so
    }
  }
  if (encoding === 'utf-16le' || encoding === 'utf-16be') return { bytes: writeUtf16(text, encoding === 'utf-16le'), encoding, relabeled: null };
  const utf8 = (t: string) => new TextEncoder().encode(t);
  // A UTF-8 BOM decides, whatever the declaration says.
  if (encoding === 'utf-8' || (read === undefined && text.charCodeAt(0) === 0xfeff)) return { bytes: utf8(text), encoding: 'utf-8', relabeled: null };
  if (SINGLE_BYTE.test(encoding)) {
    const bytes = writeSingleByte(text, encoding);
    if (bytes) return { bytes, encoding, relabeled: null };
  }
  if (!m) return { bytes: utf8(text), encoding: 'utf-8', relabeled: encoding }; // nothing declares it: UTF-8 is what it then is
  const relabeled = text.replace(DECLARED, (_all, head: string, _label: string, tail: string) => `${head}UTF-8${tail}`);
  return { bytes: utf8(relabeled), encoding: 'utf-8', relabeled: m[2] };
}

// ── the ways a file comes in: the picker, the clipboard, a drop, a link ────────────────────────

/** A picked or dropped file's bytes; one past the parse limit is refused before it is read. */
export async function readFile(file: Blob): Promise<Uint8Array> {
  if (file.size > MAX_SVG_BYTES) throw new FileTooLargeError(`the file is larger than ${MAX_SVG_BYTES / 1e6} MB`);
  return new Uint8Array(await file.arrayBuffer());
}

export interface Pasted {
  text: string;
  svg: boolean; // the clipboard said image/svg+xml, or the text looks like SVG markup
}

/** SVG markup, or the start of an XML file that may hold it. */
export const looksLikeSvg = (text: string): boolean => /<svg[\s>/]/i.test(text) || /^﻿?\s*<\?xml/.test(text);

/** What a paste event carries: image/svg+xml first, then plain text. No clipboard-read permission is asked for. */
export function pasted(e: ClipboardEvent): Pasted | null {
  const data = e.clipboardData;
  if (!data) return null;
  const svg = data.getData('image/svg+xml');
  if (svg) return { text: svg, svg: true };
  const text = data.getData('text/plain');
  return text ? { text, svg: looksLikeSvg(text) } : null;
}

/** Let a drag carrying a file or text drop here (dragenter and dragover). */
export function acceptDrag(e: DragEvent): void {
  const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
  if (!types.some((t) => t === 'Files' || t === 'image/svg+xml' || t === 'text/plain')) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}

export type Dropped = { file: Blob; name: string } | { text: string; name: string };

/** What a drop carries: its first file (read by the importer, readFile), else SVG or plain text. */
export function dropped(e: DragEvent): Dropped | null {
  const data = e.dataTransfer;
  if (!data) return null;
  const file = data.files[0];
  if (file) return { file, name: file.name };
  const text = data.getData('image/svg+xml') || data.getData('text/plain');
  return text ? { text, name: '' } : null;
}

/** The URL fragment on load (#import=…). */
export const fragment = (): string => location.hash;

/** Drop the URL fragment without a reload or a history entry, so a reload doesn't import it again. */
export function clearFragment(): void {
  history.replaceState(history.state, '', location.pathname + location.search);
}

// ── #import links ──────────────────────────────────────────────────────────────────────────────

const toBase64Url = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

/** The #import fragment for a file: deflate-raw, then base64url. */
export async function encodeImport(text: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return `import=${toBase64Url(bytes)}`;
}

/** The file carried by a #import fragment, or null if the fragment is not one. */
export async function decodeImport(fragment: string): Promise<string | null> {
  const m = /^#?import=([A-Za-z0-9_-]+)$/.exec(fragment);
  if (!m) return null;
  if (m[1].length > MAX_IMPORT_FRAGMENT) throw new FileTooLargeError('the link is too long to open');
  const bytes = await inflate(fromBase64Url(m[1]), 'deflate-raw', MAX_SVG_BYTES);
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); // a BOM stays, as it does for a file
}
