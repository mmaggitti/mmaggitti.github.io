// The boolean corpus (P1-M3 S3; plan §6 and §12): operand pairs on a 100-unit board, each combined
// four ways (union, difference, intersection, exclusion) by booleans.test.ts. Each operand is one
// element's markup; its fill-rule attribute (nonzero when absent) is the rule it fills by. Data only.
// The plan calls it the 60-case corpus (15 pairs × 4); its list of pairs names 16 (the pentagram
// under each rule is two), all of them here: 64 cases.

import { readFileSync } from 'node:fs';
import { polygonPoints, starPoints } from '../../../../engine/generators/radial.ts';

const lab = (f: string) => readFileSync(new URL(`../../../../engine/test/fixtures/corpus/lab/${f}`, import.meta.url), 'utf8');
const dIn = (src: string, n = 0): string => [...src.matchAll(/\sd="([^"]*)"/g)][n][1];

// A pentagram: a regular pentagon’s corners taken every other one.
const pentagram = (): string => {
  const pts = polygonPoints(50, 52, 40, 5).split(' ');
  return [0, 2, 4, 1, 3].map((i) => pts[i]).join(' ');
};

export interface Pair {
  name: string;
  a: string; // the bottom operand (painted first)
  b: string;
}

export const PAIRS: readonly Pair[] = [
  { name: 'two overlapping squares', a: '<rect x="10" y="10" width="50" height="50"/>', b: '<rect x="35" y="35" width="50" height="50"/>' },
  { name: 'two disjoint squares', a: '<rect x="10" y="10" width="30" height="30"/>', b: '<rect x="60" y="60" width="30" height="30"/>' },
  { name: 'a square inside a square', a: '<rect x="10" y="10" width="80" height="80"/>', b: '<rect x="30" y="30" width="40" height="40"/>' },
  { name: 'two squares sharing an edge', a: '<rect x="10" y="10" width="40" height="40"/>', b: '<rect x="50" y="10" width="40" height="40"/>' },
  { name: 'a square and itself', a: '<rect x="20" y="20" width="60" height="60"/>', b: '<rect x="20" y="20" width="60" height="60"/>' },
  { name: 'two overlapping circles', a: '<circle cx="40" cy="50" r="25"/>', b: '<circle cx="60" cy="50" r="25"/>' },
  { name: 'two tangent circles', a: '<circle cx="30" cy="50" r="20"/>', b: '<circle cx="70" cy="50" r="20"/>' },
  { name: 'a rounded rect and a circle', a: '<rect x="10" y="10" width="60" height="60" rx="15"/>', b: '<circle cx="65" cy="65" r="25"/>' },
  { name: 'SVG Lab’s heart (lab/create-icon.svg, four C) and a circle', a: `<path d="${dIn(lab('create-icon.svg'))}"/>`, b: '<circle cx="50" cy="45" r="18"/>' },
  { name: 'M2’s 5-tip star and a pentagon', a: `<polygon points="${starPoints(50, 50, 40, 0.4, 5)}"/>`, b: `<polygon points="${polygonPoints(50, 55, 30, 5)}"/>` },
  { name: 'SVG Lab’s keyhole ring (lab/arcs--holes.svg, nonzero) and a bar across it', a: `<path d="${dIn(lab('arcs--holes.svg'))}" fill-rule="nonzero"/>`, b: '<rect x="5" y="44" width="90" height="12"/>' },
  { name: 'a self-intersecting bowtie (nonzero) and a square', a: '<path d="M 10 10 L 90 90 L 90 10 L 10 90 Z" fill-rule="nonzero"/>', b: '<rect x="30" y="30" width="40" height="40"/>' },
  { name: 'a pentagram under evenodd and a circle', a: `<polygon points="${pentagram()}" fill-rule="evenodd"/>`, b: '<circle cx="50" cy="52" r="20"/>' },
  { name: 'a pentagram under nonzero and a circle', a: `<polygon points="${pentagram()}" fill-rule="nonzero"/>`, b: '<circle cx="50" cy="52" r="20"/>' },
  { name: 'SVG Lab’s Q wave, closed (lab/create-logo.svg), and a rect', a: `<path d="${dIn(lab('create-logo.svg'))} Z"/>`, b: '<rect x="40" y="38" width="20" height="14"/>' },
  { name: 'a path of relative commands, H, V, S and T, and an ellipse', a: '<path d="m 10 10 h 40 v 20 s 20 20 30 0 t 10 30 H 10 z"/>', b: '<ellipse cx="50" cy="50" rx="35" ry="20"/>' },
];
