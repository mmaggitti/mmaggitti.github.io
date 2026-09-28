// Bytes in, SVG text out: what every way of opening a file shares (file picker, paste, drop, a
// share link's #import fragment). The text then goes to the engine's parser and nowhere else.
//
// - .svgz: gzip is recognised by its magic bytes, not the file name, and inflated with a hard cap,
//   so a small file cannot expand into gigabytes.
// - Encoding: a byte order mark wins, then the XML declaration's encoding, then UTF-8. Bad bytes
//   become U+FFFD rather than failing the open.
// - #import=<deflate-raw, base64url>: SVG Lab's "Open in Draw" link carries the whole file in the
//   URL fragment, which never reaches a server.

export const MAX_SVG_BYTES = 20e6; // the engine's parse limit (engine/xml/cst.ts DEFAULT_LIMITS)
export const MAX_IMPORT_FRAGMENT = 2e6; // characters of base64url in a #import link

export interface Decoded {
  text: string;
  encoding: string;
  gzip: boolean;
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
  const text = new TextDecoder(encoding, { ignoreBOM: true }).decode(raw);
  return { text, encoding, gzip };
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
  return new TextDecoder('utf-8').decode(bytes);
}
