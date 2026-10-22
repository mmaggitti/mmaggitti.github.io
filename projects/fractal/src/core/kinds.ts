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
  // A group has no UI of its own: no band, just its dock (drawn as a tinted well).
  container: { title: 'Group', glyph: '▦', hosts: true, bandRem: 0, minRem: { w: 10, h: 8 } },
  block: { title: 'Block', glyph: '■', hosts: false, bandRem: 0, minRem: { w: 10, h: 8 } },
};

const UNKNOWN: KindInfo = { title: 'Unknown app', glyph: '?', hosts: false, bandRem: 0, minRem: { w: 10, h: 8 } };

export function kindOf(kind: string): KindInfo {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind] : UNKNOWN;
}

export function isKnownKind(kind: string): boolean {
  return Object.hasOwn(KINDS, kind);
}

/** A block's colour, as an OKLCH hue in degrees, or null when its params don't give a valid one. */
export function hueOf(params: Record<string, unknown>): number | null {
  const h = params.hue;
  return typeof h === 'number' && Number.isFinite(h) ? ((h % 360) + 360) % 360 : null;
}
