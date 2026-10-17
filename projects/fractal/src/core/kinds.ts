// What each kind of app can do. These are capabilities and presentation hints, never docking rules:
// any app can be docked anywhere, and any hosting app can hold any other.

export interface KindInfo {
  title: string;
  /** One or two characters shown on an icon tile. */
  glyph: string;
  /** Whether it can hold a nested layout (a dock) below its own band. */
  hosts: boolean;
  /** Height of a host's own UI band, in rem, at full size. */
  bandRem: number;
  /** The size its content is comfortable at, in rem. Smaller panels draw it scaled down. */
  minRem: { w: number; h: number };
}

export const KINDS: Record<string, KindInfo> = {
  container: { title: 'Container', glyph: '▦', hosts: true, bandRem: 3.5, minRem: { w: 10, h: 8 } },
  list: { title: 'List', glyph: 'L', hosts: false, bandRem: 0, minRem: { w: 16, h: 12 } },
  field: { title: 'Field', glyph: 'F', hosts: false, bandRem: 0, minRem: { w: 14, h: 9 } },
  counter: { title: 'Counter', glyph: 'C', hosts: false, bandRem: 0, minRem: { w: 10, h: 8 } },
};

const UNKNOWN: KindInfo = { title: 'Unknown app', glyph: '?', hosts: false, bandRem: 0, minRem: { w: 10, h: 8 } };

export function kindOf(kind: string): KindInfo {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind] : UNKNOWN;
}

export function isKnownKind(kind: string): boolean {
  return Object.hasOwn(KINDS, kind);
}
