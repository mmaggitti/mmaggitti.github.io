// The sync seam (Core & Seams SEAMS.md, ADR-014): a websocket client for an automerge-repo relay,
// written by hand. It speaks protocol "1": `join` → `peer`, then `sync` messages for one document.
// It carries the core's sync messages for the ENVELOPE document only; what's inside the envelope
// is ciphertext (seal.ts). Reconnects with backoff; the app treats the relay as untrusted.
import { decode, encode, type CborValue } from './cbor';
import type { Bytes } from '../worker/protocol';

/** The public relay Automerge offers for prototyping (as-is, not private). One place to change it. */
export const RELAY_URL = 'wss://sync.automerge.org';

export type RelayStatus = 'connecting' | 'online' | 'offline';

export interface RelayHandlers {
  /** The relay is ready for this document: reset sync state and send. */
  onOpen(): void;
  onMessage(data: Bytes): void;
  onStatus(status: RelayStatus, detail?: string): void;
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = (ALPHABET[Number(n % 58n)] as string) + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

function unbase58(s: string): Uint8Array | null {
  let n = 0n;
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== '1') break;
    out.unshift(0);
  }
  return new Uint8Array(out);
}

const sha256 = async (b: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
const checksum = async (payload: Uint8Array<ArrayBuffer>) => (await sha256(await sha256(payload))).slice(0, 4);

/** A new document ID: 16 random bytes, bs58check-encoded, as automerge-repo writes them. */
export async function newDocumentId(): Promise<string> {
  const id = crypto.getRandomValues(new Uint8Array(16));
  const sum = await checksum(id);
  const all = new Uint8Array(20);
  all.set(id);
  all.set(sum, 16);
  return base58(all);
}

export async function isDocumentId(s: string): Promise<boolean> {
  const raw = unbase58(s);
  if (!raw || raw.length !== 20) return false;
  const sum = await checksum(raw.slice(0, 16));
  return sum.every((b, i) => b === raw[16 + i]);
}

const randomHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

export class Relay {
  private ws: WebSocket | null = null;
  private server: string | null = null;
  private readonly peerId = `cowrite-${randomHex(8)}`;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  status: RelayStatus = 'offline';

  constructor(private readonly documentId: string, private readonly h: RelayHandlers, private readonly url = RELAY_URL) {
    addEventListener('online', this.wake);
    document.addEventListener('visibilitychange', this.wake);
    this.connect();
  }

  private set(status: RelayStatus, detail?: string) {
    this.status = status;
    this.h.onStatus(status, detail);
  }

  /** Reconnect now (back online, or the page came back to the front) if the socket is down. */
  private wake = () => {
    if (this.closed || document.visibilityState !== 'visible') return;
    if (!this.ws || this.ws.readyState > WebSocket.OPEN) {
      this.attempts = 0;
      this.connect();
    }
  };

  private connect() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
    this.server = null;
    this.set('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.retry(String(e));
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.raw({ type: 'join', senderId: this.peerId, peerMetadata: { isEphemeral: true }, supportedProtocolVersions: ['1'] });
    };
    ws.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      let m: CborValue;
      try {
        m = decode(new Uint8Array(e.data));
      } catch {
        return;
      }
      if (typeof m !== 'object' || m === null || Array.isArray(m) || m instanceof Uint8Array) return;
      if (m.type === 'peer' && typeof m.senderId === 'string') {
        this.server = m.senderId;
        this.attempts = 0;
        this.set('online');
        this.h.onOpen();
      } else if (m.type === 'error') {
        this.set('offline', typeof m.message === 'string' ? m.message : 'relay error');
      } else if ((m.type === 'sync' || m.type === 'request') && m.documentId === this.documentId && m.data instanceof Uint8Array) {
        this.h.onMessage(new Uint8Array(m.data));
      }
      // doc-unavailable, ephemeral and heads messages need nothing: every device always sends the
      // genesis, so the relay never lacks the document for long.
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.server = null;
      if (!this.closed) this.retry();
    };
    ws.onerror = () => ws.close();
  }

  private retry(detail?: string) {
    this.set('offline', detail);
    const delay = Math.min(30_000, 1000 * 2 ** this.attempts++);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private raw(m: { [k: string]: CborValue }) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(m));
  }

  /** Send a sync message for the envelope. Always "sync", never only "request": a device that
   * holds the document refills a relay that lost it. Dropped silently while offline; the next
   * connection resyncs from scratch. */
  send(data: Bytes) {
    if (!this.server) return;
    this.raw({ type: 'sync', senderId: this.peerId, targetId: this.server, documentId: this.documentId, data });
  }

  close() {
    this.closed = true;
    removeEventListener('online', this.wake);
    document.removeEventListener('visibilitychange', this.wake);
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }
}
