// The part of fontkit 2.0.4's API Draw uses (the package ships no type declarations).
declare module 'fontkit' {
  export interface PathCommand {
    command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
    args: number[];
  }
  export interface Glyph {
    id: number;
    name: string;
    advanceWidth: number;
    path: { commands: PathCommand[] };
  }
  export interface GlyphPosition {
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
  }
  export interface GlyphRun {
    glyphs: Glyph[];
    positions: GlyphPosition[];
  }
  export interface Font {
    familyName?: string;
    subfamilyName?: string;
    copyright?: string;
    unitsPerEm: number;
    italicAngle?: number;
    'OS/2'?: { usWeightClass?: number; fsType?: unknown; fsSelection?: { italic?: boolean } };
    getName?(key: string, lang?: string): string | undefined;
    glyphForCodePoint(codePoint: number): Glyph;
    layout(text: string, features?: string[] | Record<string, boolean>): GlyphRun;
  }
  export interface FontCollection {
    fonts: Font[];
  }
  export function create(buffer: Uint8Array, postscriptName?: string): Font | FontCollection;
}
