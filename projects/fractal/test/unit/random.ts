// Random valid documents for property tests: splits, tab groups and nested hosts.
import type { AppRecord, LayoutDoc, Node } from '../../src/core/types.ts';
import { normalizeDoc } from '../../src/core/tree.ts';

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function randomDoc(seed: number): LayoutDoc {
  const r = rng(seed);
  let n = 0;
  const apps: Record<string, AppRecord> = {};
  const leafKinds = ['list', 'field', 'counter'];
  const node = (depth: number, hostDepth: number): Node => {
    const id = `n${n++}`;
    if (depth < 3 && r() < 0.55) {
      const count = 2 + Math.floor(r() * 3);
      const children = Array.from({ length: count }, () => node(depth + 1, hostDepth));
      const weights = children.map(() => 0.2 + r());
      const sum = weights.reduce((a, b) => a + b, 0);
      return { kind: 'split', id, axis: r() < 0.5 ? 'x' : 'y', children, weights: weights.map((w) => w / sum) };
    }
    const tabs: string[] = [];
    const count = 1 + Math.floor(r() * 2);
    for (let i = 0; i < count; i++) {
      const app = `a${n++}`;
      if (hostDepth < 2 && r() < 0.3) {
        apps[app] = { kind: 'container', title: `Host ${app}`, params: {}, dock: node(0, hostDepth + 1) };
      } else {
        apps[app] = { kind: leafKinds[Math.floor(r() * 3)], title: `App ${app}`, params: {} };
      }
      tabs.push(app);
    }
    return { kind: 'panel', id, tabs, selected: tabs[Math.floor(r() * tabs.length)] };
  };
  const root = node(0, 0);
  return normalizeDoc({ schema: 1, root, apps, nav: { frame: null, visits: [], index: -1 } });
}
