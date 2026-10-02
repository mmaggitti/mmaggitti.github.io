// End-to-end encryption for what the relay stores (Core & Seams ADR-014). WebCrypto AES-GCM-256:
// a random 12-byte IV per blob, and the document ID as additional data, so a blob can't be moved
// to another document. The key lives only on devices and in the share link's #fragment.
import type { Bytes } from '../worker/protocol';

const VERSION = 1;
const utf8 = new TextEncoder();

export async function newKey(): Promise<Bytes> {
  return crypto.getRandomValues(new Uint8Array(32));
}

export const importKey = (raw: Bytes): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

/** `[version][iv 12][ciphertext + tag]`. */
export async function seal(key: CryptoKey, documentId: string, plain: Bytes): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(documentId) }, key, plain));
  const out = new Uint8Array(1 + iv.length + ct.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(ct, 1 + iv.length);
  return out;
}

/** The plaintext, or null for anything that isn't a blob sealed with this key for this document. */
export async function open(key: CryptoKey, documentId: string, blob: Uint8Array): Promise<Bytes | null> {
  if (blob.length < 1 + 12 + 16 || blob[0] !== VERSION) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: blob.slice(1, 13), additionalData: utf8.encode(documentId) },
      key,
      blob.slice(13),
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

export const toBase64Url = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

export function fromBase64Url(s: string): Bytes | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
