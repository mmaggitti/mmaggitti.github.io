// The layout document: one tree for every nesting level. A panel holds apps as tabs; a hosting app
// holds its own nested layout (its dock), so panel → app → dock → panel → … is the fractal.
// There is no stage and no special root kind: any hosting app can hold a layout at any depth.

export type Axis = 'x' | 'y';

export interface Split {
  kind: 'split';
  id: string;
  axis: Axis;
  /** Relative sizes, positive, normalized to sum to 1. */
  weights: number[];
  children: Node[];
}

/** A tab group of one or more apps. */
export interface Panel {
  kind: 'panel';
  id: string;
  tabs: string[];
  selected: string;
}

export type Node = Split | Panel;

export interface Selection {
  type: string;
  id: string;
}

export interface AppRecord {
  /** Key into the kind table (core/kinds.ts). */
  kind: string;
  title?: string;
  params: Record<string, unknown>;
  /** Only hosting kinds: the nested layout, or null when the dock is empty. */
  dock?: Node | null;
  /** The app whose selection this app shows. */
  follows?: string;
  selection?: Selection;
}

/** A place in history: the framed node, plus the apps it showed, so it survives moves. */
export interface Visit {
  node: string | null;
  apps: string[];
}

export interface NavState {
  /** The framed node's id, or null for the overview. */
  frame: string | null;
  visits: Visit[];
  index: number;
  /** Where Overview returns to. */
  overviewReturn?: Visit | null;
}

export interface LayoutDoc {
  schema: 1;
  root: Node | null;
  apps: Record<string, AppRecord>;
  nav: NavState;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
