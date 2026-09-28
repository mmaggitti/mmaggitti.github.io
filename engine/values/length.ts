// SVG lengths ('12.5mm', '50%', '2em') and their size in user units.
//
// Absolute units convert at CSS's fixed 96 dpi. em, ex and % depend on where the length is used
// (font size, which viewport axis), so they need that context and are null without it: guessing
// would silently misplace geometry.

export type LengthUnit = '' | 'px' | 'pt' | 'pc' | 'mm' | 'cm' | 'in' | 'em' | 'ex' | '%';

export interface Length {
  value: number;
  unit: LengthUnit; // lowercase
}

export interface LengthContext {
  fontSize?: number; // user units per em
  percentBase?: number; // user units that 100% stands for
}

const ABSOLUTE: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

const LENGTH = /^[ \t\n\r\f]*([+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?)(px|pt|pc|mm|cm|in|em|ex|%)?[ \t\n\r\f]*$/i;

export function parseLength(s: string): Length | null {
  const m = LENGTH.exec(s);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? { value, unit: (m[2] ?? '').toLowerCase() as LengthUnit } : null;
}

/** Size in user units; null when em/ex/% lack the context they need. ex is 0.5em (CSS's fallback x-height). */
export function toUserUnits(len: Length, ctx: LengthContext = {}): number | null {
  const k = ABSOLUTE[len.unit];
  if (k !== undefined) return len.value * k;
  if (len.unit === '%') return ctx.percentBase === undefined ? null : (len.value * ctx.percentBase) / 100;
  if (ctx.fontSize === undefined) return null;
  return len.value * ctx.fontSize * (len.unit === 'ex' ? 0.5 : 1);
}
