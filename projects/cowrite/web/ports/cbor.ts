// The CBOR subset the relay protocol uses (RFC 8949): unsigned and negative integers, byte and
// text strings, arrays, maps with text keys, booleans, null and undefined. Written by hand: it's
// an afternoon's code and the app stays dependency-free (Core & Seams DEPENDENCIES.md, rule 1).

export type CborValue = number | string | boolean | null | undefined | Uint8Array | CborValue[] | { [k: string]: CborValue };

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder('utf-8', { fatal: true });

export function encode(value: CborValue): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  const head = (major: number, n: number) => {
    if (n < 24) out.push((major << 5) | n);
    else if (n < 0x100) out.push((major << 5) | 24, n);
    else if (n < 0x10000) out.push((major << 5) | 25, n >> 8, n & 0xff);
    else if (n < 0x100000000) out.push((major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
    else throw new Error('cbor: integers past 2^32 are not used here');
  };
  const bytes = (b: Uint8Array) => {
    for (let i = 0; i < b.length; i++) out.push(b[i] as number);
  };
  const walk = (v: CborValue): void => {
    if (v === null) out.push(0xf6);
    else if (v === undefined) out.push(0xf7);
    else if (v === false) out.push(0xf4);
    else if (v === true) out.push(0xf5);
    else if (typeof v === 'number') {
      if (!Number.isInteger(v)) throw new Error('cbor: floats are not used here');
      if (v >= 0) head(0, v);
      else head(1, -1 - v);
    } else if (typeof v === 'string') {
      const b = utf8.encode(v);
      head(3, b.length);
      bytes(b);
    } else if (v instanceof Uint8Array) {
      head(2, v.length);
      bytes(v);
    } else if (Array.isArray(v)) {
      head(4, v.length);
      v.forEach(walk);
    } else {
      const entries = Object.entries(v).filter(([, x]) => x !== undefined);
      head(5, entries.length);
      for (const [k, x] of entries) {
        walk(k);
        walk(x);
      }
    }
  };
  walk(value);
  return new Uint8Array(out);
}

export function decode(data: Uint8Array): CborValue {
  let pos = 0;
  const byte = (): number => {
    if (pos >= data.length) throw new Error('cbor: truncated');
    return data[pos++] as number;
  };
  const length = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return byte();
    if (info === 25) return byte() * 0x100 + byte();
    if (info === 26) return ((byte() * 0x100 + byte()) * 0x100 + byte()) * 0x100 + byte();
    if (info === 27) {
      let n = 0;
      for (let i = 0; i < 8; i++) n = n * 0x100 + byte();
      if (!Number.isSafeInteger(n)) throw new Error('cbor: integer too large');
      return n;
    }
    throw new Error(`cbor: indefinite lengths are not supported (${info})`);
  };
  const slice = (n: number): Uint8Array => {
    if (pos + n > data.length) throw new Error('cbor: truncated');
    const s = data.slice(pos, pos + n);
    pos += n;
    return s;
  };
  const item = (): CborValue => {
    const b = byte();
    const major = b >> 5;
    const info = b & 0x1f;
    switch (major) {
      case 0: return length(info);
      case 1: return -1 - length(info);
      case 2: return slice(length(info));
      case 3: return fromUtf8.decode(slice(length(info)));
      case 4: {
        const n = length(info);
        const arr: CborValue[] = [];
        for (let i = 0; i < n; i++) arr.push(item());
        return arr;
      }
      case 5: {
        const n = length(info);
        const obj: { [k: string]: CborValue } = {};
        for (let i = 0; i < n; i++) {
          const k = item();
          obj[String(k)] = item();
        }
        return obj;
      }
      case 6: length(info); return item(); // a tag: keep the tagged value
      default:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new Error(`cbor: unsupported simple value ${info}`);
    }
  };
  const v = item();
  if (pos !== data.length) throw new Error('cbor: trailing bytes');
  return v;
}
