// The first-launch layout: blank coloured blocks inside two groups, three levels deep, so every
// navigation gesture has something to work on and nothing else competes for attention.

import type { AppRecord, LayoutDoc, Node, Panel } from './types.ts';
import { setFrame } from './ops.ts';

const panel = (id: string, ...tabs: string[]): Panel => ({ kind: 'panel', id, tabs, selected: tabs[0] });
const row = (id: string, children: Node[], weights?: number[]): Node => ({
  kind: 'split',
  id,
  axis: 'x',
  children,
  weights: normalized(weights ?? children.map(() => 1)),
});
const col = (id: string, children: Node[], weights?: number[]): Node => ({
  kind: 'split',
  id,
  axis: 'y',
  children,
  weights: normalized(weights ?? children.map(() => 1)),
});
function normalized(w: number[]) {
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / s);
}
const block = (title: string, hue: number): AppRecord => ({ kind: 'block', title, params: { hue } });

export function defaultLayout(): LayoutDoc {
  const apps: Record<string, AppRecord> = {
    'group-a': {
      kind: 'container',
      title: 'Group A',
      params: {},
      dock: row('a-row', [panel('p-group-b', 'group-b'), col('a-col', [panel('p-coral', 'coral'), panel('p-lime', 'lime')])]),
    },
    'group-b': {
      kind: 'container',
      title: 'Group B',
      params: {},
      dock: row('b-row', [panel('p-teal', 'teal'), panel('p-indigo', 'indigo')]),
    },
    coral: block('Coral', 30),
    lime: block('Lime', 130),
    teal: block('Teal', 185),
    indigo: block('Indigo', 275),
    sky: block('Sky', 230),
    amber: block('Amber', 75),
    rose: block('Rose', 355),
    violet: block('Violet', 305),
  };
  const root = col('root', [
    panel('p-group-a', 'group-a'),
    row('mid', [panel('p-sky', 'sky'), panel('p-amber', 'amber', 'rose')]),
    panel('p-violet', 'violet'),
  ], [3, 2, 1]);
  return setFrame({ schema: 2, root, apps, nav: { frame: null, visits: [], index: -1, overviewReturn: null } }, null);
}
