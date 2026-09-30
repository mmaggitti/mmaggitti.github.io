// The style properties Inspect edits (P1-M2): each one's initial value and whether it inherits, as
// CSS and SVG 2 define them. Inspect shows an element's own value, else (inherited) the nearest
// ancestor's written value, else the initial one.

export interface StyleProp {
  initial: string;
  inherited: boolean;
}

export const STYLE_PROPS: Readonly<Record<string, StyleProp>> = {
  fill: { initial: 'black', inherited: true },
  stroke: { initial: 'none', inherited: true },
  'stroke-width': { initial: '1', inherited: true },
  opacity: { initial: '1', inherited: false },
  'fill-opacity': { initial: '1', inherited: true },
  'stroke-opacity': { initial: '1', inherited: true },
  'stroke-linecap': { initial: 'butt', inherited: true },
  'stroke-linejoin': { initial: 'miter', inherited: true },
  'stroke-miterlimit': { initial: '4', inherited: true },
  'stroke-dasharray': { initial: 'none', inherited: true },
  'stroke-dashoffset': { initial: '0', inherited: true },
  'paint-order': { initial: 'normal', inherited: true },
  'vector-effect': { initial: 'none', inherited: false },
  'shape-rendering': { initial: 'auto', inherited: true },
  color: { initial: 'black', inherited: true },
  'stop-color': { initial: 'black', inherited: false },
  'stop-opacity': { initial: '1', inherited: false },
};

/** SVG Lab's four dash presets on its 100-unit board; each number × k on another. */
export const DASH_PRESETS: readonly (readonly number[] | null)[] = [null, [10, 6], [2, 6], [16, 4, 2, 4]];
