// The SVG transform attribute: a list of matrix/translate/scale/rotate/skewX/skewY functions.
//
// The items are kept as written, so an editor can show and edit `rotate(30 12 12)` as a rotation
// rather than as the six numbers of its matrix. Function names are case-sensitive and take plain
// numbers, as in SVG 1.1; the CSS forms the attribute also accepts in SVG 2 (units such as 45deg or
// 10px) parse as null, so a caller keeps that text as written instead of misreading it.

import { IDENTITY, multiply, rotate, scale, skewX, skewY, translate, type Affine } from './affine.ts';
import { joinNumbers, parseNumberList } from './number-format.ts';

export type TransformFn = 'matrix' | 'translate' | 'scale' | 'rotate' | 'skewX' | 'skewY';

export interface TransformItem {
  fn: TransformFn;
  args: number[];
}

export interface TransformList {
  items: TransformItem[];
  matrix: Affine; // the whole list as one matrix
}

// allowed argument counts per function
const ARITY: Record<TransformFn, readonly number[]> = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] };

const ITEM = /[ \t\n\r\f]*(matrix|translate|scale|rotate|skewX|skewY)[ \t\n\r\f]*\(([^()]*)\)[ \t\n\r\f]*(,?)/y;
const BLANK = /[ \t\n\r\f]*$/y;

/** Parse a transform list. The empty (or blank) string is the empty list; bad input is null. */
export function parseTransform(s: string): TransformList | null {
  const items: TransformItem[] = [];
  let i = 0;
  let comma = false;
  for (;;) {
    BLANK.lastIndex = i;
    if (BLANK.test(s)) break;
    ITEM.lastIndex = i;
    const m = ITEM.exec(s);
    if (!m) return null;
    const fn = m[1] as TransformFn;
    const args = parseNumberList(m[2]);
    if (!args || !ARITY[fn].includes(args.length)) return null;
    items.push({ fn, args });
    comma = m[3] === ',';
    i = ITEM.lastIndex;
  }
  if (comma) return null; // a comma separates two items; it cannot end the list
  return { items, matrix: items.reduce((m, it) => multiply(m, itemMatrix(it)), IDENTITY) };
}

export function itemMatrix({ fn, args: v }: TransformItem): Affine {
  switch (fn) {
    case 'matrix':
      return [v[0], v[1], v[2], v[3], v[4], v[5]];
    case 'translate':
      return translate(v[0], v[1] ?? 0);
    case 'scale':
      return scale(v[0], v[1] ?? v[0]);
    case 'rotate':
      return rotate(v[0], v[1] ?? 0, v[2] ?? 0);
    case 'skewX':
      return skewX(v[0]);
    case 'skewY':
      return skewY(v[0]);
  }
}

export function serializeTransform(items: readonly TransformItem[], decimals = 3): string {
  return items.map((it) => `${it.fn}(${joinNumbers(it.args, decimals)})`).join(' ');
}
