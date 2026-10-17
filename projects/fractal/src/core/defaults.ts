// The first-launch layout. P0 uses Probe apps (a long list, a field, a counter) inside Containers,
// three levels deep, so every navigation gesture has something to work on.

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

export function probeLayout(): LayoutDoc {
  const apps: Record<string, AppRecord> = {
    home: {
      kind: 'container',
      title: 'Desk',
      params: {},
      dock: row('home-row', [
        panel('p-garden', 'garden'),
        col('home-col', [panel('p-home-list', 'home-list'), panel('p-home-field', 'home-field')]),
      ]),
    },
    garden: {
      kind: 'container',
      title: 'Garden',
      params: {},
      dock: row('garden-row', [panel('p-garden-list', 'garden-list'), panel('p-garden-counter', 'garden-counter')]),
    },
    'home-list': { kind: 'list', title: 'Desk list', params: { seed: 2 } },
    'home-field': { kind: 'field', title: 'Desk note', params: {} },
    'garden-list': { kind: 'list', title: 'Garden list', params: { seed: 3 } },
    'garden-counter': { kind: 'counter', title: 'Garden count', params: {} },
    list: { kind: 'list', title: 'Long list', params: { seed: 1 } },
    field: { kind: 'field', title: 'Note', params: {} },
    counter: { kind: 'counter', title: 'Counter', params: {} },
    counter2: { kind: 'counter', title: 'Tally', params: {} },
  };
  const root = col('root', [
    panel('p-home', 'home'),
    row('mid', [panel('p-list', 'list'), panel('p-field', 'field', 'counter2')]),
    panel('p-counter', 'counter'),
  ], [3, 2, 1]);
  return setFrame({ schema: 1, root, apps, nav: { frame: null, visits: [], index: -1, overviewReturn: null } }, null);
}
