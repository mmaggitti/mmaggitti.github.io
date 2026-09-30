// Gradient handles (P1-M2): where a gradient's points draw, in both unit systems and under
// gradientTransform, and what dragging one writes (SVG Lab's LabPaint, L2398-2468).
//
// With E the painted element, B its fill box in its own user units (getBBox), T the resolved
// gradientTransform as one matrix, and toHost E's own user units → host px:
// - U = [B.width, 0, 0, B.height, B.x, B.y] for objectBoundingBox, the identity for userSpaceOnUse;
// - a gradient point p draws at toHost · U · T · p (the transform applies inside the box mapping);
// - a value reads as a number as it is; a percentage as a fraction in objectBoundingBox, or of E's
//   nearest viewport in userSpaceOnUse (x by its width, y by its height, r and fr by
//   √((w² + h²)/2)); an absolute unit at 96 dpi; em, ex and rem are refused.
// A drag maps the finger back, p = (toHost · U · T)⁻¹ · f, and writes each value where it lives in
// the chain (only its number's characters: its unit kept), else on the gradient the paint names as
// a plain number: objectBoundingBox values to 0.01, userSpaceOnUse ones to the snap step. The radius
// is clamped (0.02–2 of the box; at least the step in user space), and after a centre, radius or
// focus drag a written focus farther than 0.96 r from the centre is pulled onto that circle and
// written too (LabPaint's fixF), so SVG 1.1 and 2 renderers agree. gradientTransform is never
// written: its bytes stay, and the handles follow it.

import { el, findAttr, type Doc } from '../model/doc.ts';
import { rewriteNumbers } from '../code/edit.ts';
import { IDENTITY, apply as applyM, invert, multiply, type Affine } from '../values/affine.ts';
import { parseTransform } from '../values/transform.ts';
import { parseLength } from '../values/length.ts';
import { fmt } from '../values/number-format.ts';
import type { AttrEdit, Plan } from '../geometry/write.ts';
import type { Rect } from '../geometry/bounds.ts';
import { GEOMETRY, valueOf, type Resolved } from './gradients.ts';

export interface Point {
  x: number;
  y: number;
}

/** What the handles need from the canvas: E's box and CTM, its nearest viewport's size, and the snap step. */
export interface GradientGeo {
  box: Rect; // E's fill box, in its own user units
  toHost: Affine; // E's own user units → host px
  viewport: { w: number; h: number } | null; // what userSpaceOnUse percentages resolve against
  step: number; // the snap step in E's user units
}

export type GradientHandleId = 'g-start' | 'g-end' | 'g-centre' | 'g-radius' | 'g-focus';
export interface GradientHandle {
  id: GradientHandleId;
  kind: 'start' | 'anchor' | 'center' | 'ctrl';
  at: Point; // host px
  tip: string; // the numbers as written
}
/** The guides: the unit box (objectBoundingBox) with "0,0" and "1,1", a linear gradient's line, a radial one's circle and focus arm; host px. */
export interface GradientMarks {
  box: Point[] | null;
  labels: { text: string; at: Point }[];
  line: [Point, Point] | null;
  ring: Point[] | null;
  arm: [Point, Point] | null;
}

export const FONT_RELATIVE = 'Its gradient uses font-relative lengths, which Draw’s handles don’t follow yet.';
export const NO_BOX = 'Its box has no width or height, so a bounding-box gradient doesn’t draw on it.';
export const FLATTENED = 'Its gradientTransform flattens it.';
export const FLAT = 'It is drawn flat, so Draw can’t place its gradient’s handles.';
export const NO_VIEWPORT = 'Its gradient is a percentage of a viewport whose size Draw can’t tell.';

/** The label of a handle's drag (its history entry). */
export const GRADIENT_LABELS: Readonly<Record<GradientHandleId, string>> = {
  'g-start': 'Gradient start', 'g-end': 'Gradient end', 'g-centre': 'Gradient centre', 'g-radius': 'Gradient radius', 'g-focus': 'Gradient focus',
};

const AXIS: Readonly<Record<string, 'x' | 'y' | 'r'>> = { x1: 'x', x2: 'x', cx: 'x', fx: 'x', y1: 'y', y2: 'y', cy: 'y', fy: 'y', r: 'r', fr: 'r' };
const ABSOLUTE: Readonly<Record<string, number>> = { '': 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

interface Frame {
  obb: boolean;
  M: Affine; // gradient space → host px
  U: Affine; // gradient units → E's units (before T)
  inv: Affine;
}

/** The mapping (see the header), or why the handles can't be shown. */
function frameOf(r: Resolved, geo: GradientGeo): Frame | { refused: string } {
  const obb = valueOf(r, 'gradientUnits') !== 'userSpaceOnUse';
  const b = geo.box;
  if (obb && !(b.width > 0 && b.height > 0)) return { refused: NO_BOX };
  const U: Affine = obb ? [b.width, 0, 0, b.height, b.x, b.y] : IDENTITY;
  const T = parseTransform(valueOf(r, 'gradientTransform'))?.matrix ?? IDENTITY; // an unreadable list draws as none
  if (!invert(T)) return { refused: FLATTENED };
  const M = multiply(geo.toHost, multiply(U, T));
  const inv = invert(M);
  return inv ? { obb, M, U, inv } : { refused: FLAT };
}

/** Gradient units per unit of the value as written (a percentage, px, mm …), or why it can't be read. */
function unitScale(unit: string, axis: 'x' | 'y' | 'r', f: Frame, geo: GradientGeo): number | { refused: string } {
  const u = unit.toLowerCase();
  if (u === 'em' || u === 'ex' || u === 'rem') return { refused: FONT_RELATIVE };
  if (u === '%') {
    if (f.obb) return 0.01;
    const v = geo.viewport;
    if (!v) return { refused: NO_VIEWPORT };
    return (axis === 'x' ? v.w : axis === 'y' ? v.h : Math.sqrt((v.w * v.w + v.h * v.h) / 2)) / 100;
  }
  const abs = ABSOLUTE[u];
  return abs === undefined ? { refused: `Its gradient has a unit Draw doesn’t read (${unit}).` } : abs;
}

/** Each geometry value of the gradient in gradient units, as drawn. */
function values(r: Resolved, f: Frame, geo: GradientGeo): Map<string, number> | { refused: string } {
  const out = new Map<string, number>();
  for (const name of GEOMETRY[r.kind]) {
    const raw = valueOf(r, name);
    const len = parseLength(raw);
    if (!len) return { refused: `Its gradient’s ${name} (${raw}) doesn’t read as a length.` };
    const k = unitScale(len.unit, AXIS[name], f, geo);
    if (typeof k !== 'number') return k;
    out.set(name, len.value * k);
  }
  return out;
}

const host = (f: Frame, x: number, y: number): Point => {
  const [hx, hy] = applyM(f.M, x, y);
  return { x: hx, y: hy };
};
/** Is the focus written somewhere in the chain (else it sits on the centre and isn't drawn)? */
const focusWritten = (r: Resolved): boolean => r.attrs.has('fx') || r.attrs.has('fy');

/** The gradient's handles and guides for this element, or why they can't be shown. */
export function gradientHandles(r: Resolved, geo: GradientGeo): { handles: GradientHandle[]; marks: GradientMarks } | { refused: string } {
  const f = frameOf(r, geo);
  if ('refused' in f) return f;
  const v = values(r, f, geo);
  if ('refused' in v) return v;
  const g = (n: string) => v.get(n)!;
  const w = (n: string) => valueOf(r, n);
  const marks: GradientMarks = { box: null, labels: [], line: null, ring: null, arm: null };
  if (f.obb) {
    const box = (x: number, y: number) => {
      const [hx, hy] = applyM(multiply(geo.toHost, f.U), x, y);
      return { x: hx, y: hy };
    };
    marks.box = [box(0, 0), box(1, 0), box(1, 1), box(0, 1)];
    marks.labels = [{ text: '0,0', at: box(0, 0) }, { text: '1,1', at: box(1, 1) }];
  }
  const handles: GradientHandle[] = [];
  if (r.kind === 'linearGradient') {
    const a = host(f, g('x1'), g('y1'));
    const b = host(f, g('x2'), g('y2'));
    handles.push({ id: 'g-start', kind: 'start', at: a, tip: `x1 ${w('x1')}, y1 ${w('y1')}` }, { id: 'g-end', kind: 'anchor', at: b, tip: `x2 ${w('x2')}, y2 ${w('y2')}` });
    marks.line = [a, b];
  } else {
    const c = host(f, g('cx'), g('cy'));
    handles.push({ id: 'g-centre', kind: 'center', at: c, tip: `cx ${w('cx')}, cy ${w('cy')}` }, { id: 'g-radius', kind: 'anchor', at: host(f, g('cx') + g('r'), g('cy')), tip: `r ${w('r')}` });
    marks.ring = Array.from({ length: 64 }, (_, i) => host(f, g('cx') + g('r') * Math.cos((i * Math.PI) / 32), g('cy') + g('r') * Math.sin((i * Math.PI) / 32)));
    if (focusWritten(r)) {
      const fp = host(f, g('fx'), g('fy'));
      handles.push({ id: 'g-focus', kind: 'ctrl', at: fp, tip: `fx ${w('fx')}, fy ${w('fy')}` });
      marks.arm = [c, fp];
    }
  }
  return { handles, marks };
}

const NUMBER = /[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/;

/**
 * The plan for a drag of `handle` to host point `to`: each value written where it lives in the
 * chain (its number's characters, its unit kept), or added to the gradient the paint names.
 */
export function planGradientHandle(doc: Doc, r: Resolved, handle: GradientHandleId, to: Point, geo: GradientGeo): Plan {
  const f = frameOf(r, geo);
  if ('refused' in f) return f;
  const v = values(r, f, geo);
  if ('refused' in v) return v;
  const [px, py] = applyM(f.inv, to.x, to.y);
  const next = new Map<string, number>();
  // A value on the grid it is written with: 0.01 of the box, or the snap step in user space (a
  // percentage: 0.01 of one percent of its measure either way), as the numbers will read back.
  const written = (name: string, value: number): { text: string; value: number; unit: string; k: number } | { refused: string } => {
    const a = r.attrs.get(name);
    const unit = a ? (parseLength(a.value)?.unit ?? '') : '';
    const k = unitScale(unit, AXIS[name], f, geo);
    if (typeof k !== 'number') return k;
    const n = value / k;
    const text = unit === '%' ? fmt(n, 2) : f.obb ? fmt(n, 2) : unit === '' || unit.toLowerCase() === 'px' ? fmt(Math.round(n / geo.step) * geo.step, decimalsOf(geo.step)) : fmt(n, 4);
    return { text, value: Number(text) * k, unit, k };
  };
  const set = (name: string, value: number) => next.set(name, value);
  if (handle === 'g-start') [set('x1', px), set('y1', py)];
  else if (handle === 'g-end') [set('x2', px), set('y2', py)];
  else if (handle === 'g-centre') [set('cx', px), set('cy', py)];
  else if (handle === 'g-focus') [set('fx', px), set('fy', py)];
  else if (handle === 'g-radius') {
    const d = Math.hypot(px - v.get('cx')!, py - v.get('cy')!);
    set('r', f.obb ? Math.min(2, Math.max(0.02, d)) : Math.max(geo.step, d));
  }
  // Round what the drag writes; then fixF on the rounded values, when a focus is written.
  const edits: AttrEdit[] = [];
  const final = new Map(v);
  const texts = new Map<string, string>();
  for (const [name, value] of next) {
    const w = written(name, value);
    if ('refused' in w) return w;
    texts.set(name, w.text);
    final.set(name, w.value);
  }
  if (r.kind === 'radialGradient' && handle !== 'g-start' && handle !== 'g-end' && (focusWritten(r) || handle === 'g-focus')) {
    const [cx, cy, rr, fx, fy] = ['cx', 'cy', 'r', 'fx', 'fy'].map((n) => final.get(n)!);
    const d = Math.hypot(fx - cx, fy - cy);
    if (d > 0.96 * rr && d > 0) {
      const s = (0.96 * rr) / d;
      for (const [name, value] of [['fx', cx + (fx - cx) * s], ['fy', cy + (fy - cy) * s]] as const) {
        const w = written(name, value);
        if ('refused' in w) return w;
        texts.set(name, w.text);
      }
    }
  }
  for (const [name, text] of texts) {
    const a = r.attrs.get(name);
    if (!a) {
      edits.push({ id: r.id, ns: null, local: name, raw: text, add: true });
      continue;
    }
    const at = findAttr(el(doc, a.from), null, name)!;
    const m = at.raw.includes('&') ? null : NUMBER.exec(at.raw);
    if (!m) {
      const unit = parseLength(a.value)?.unit ?? '';
      edits.push({ id: a.from, ns: null, local: name, raw: `${text}${unit}`, add: false });
      continue;
    }
    if (at.raw.slice(m.index, m.index + m[0].length) === text) continue;
    edits.push({ id: a.from, ns: null, local: name, raw: rewriteNumbers(at.raw, [{ start: m.index, end: m.index + m[0].length, text }]), add: false });
  }
  return { edits };
}

/** Decimal places of a step as fmt writes it. */
function decimalsOf(step: number): number {
  const s = fmt(step, 10);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}
