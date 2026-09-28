// engine/values/affine: SVG matrix order, inversion, exact quarter turns, decompose/compose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY, apply, compose, decompose, invert, multiply, rotate, scale, skewX, skewY, translate, type Affine } from '../../values/affine.ts';
import { mulberry32 } from './rng.ts';

function close(a: readonly number[], b: readonly number[], tol = 1e-9, msg = ''): void {
  const scale = Math.max(1, ...b.map(Math.abs));
  assert.ok(a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol * scale), `${msg} [${a}] ≠ [${b}]`);
}

const randomMatrix = (rnd: () => number): Affine => {
  const v = (): number => (rnd() * 2 - 1) * 10 ** Math.floor(rnd() * 3);
  return [v(), v(), v(), v(), v() * 100, v() * 100];
};

test('multiply(m1, m2) applies m2 first, as an SVG transform list reads left to right', () => {
  const m = multiply(translate(10, 0), scale(2));
  assert.deepEqual(apply(m, 1, 1), [12, 2]); // scaled to (2, 2), then moved
  const rnd = mulberry32(1);
  for (let i = 0; i < 1000; i++) {
    const m1 = randomMatrix(rnd);
    const m2 = randomMatrix(rnd);
    const [x, y] = [rnd() * 100, rnd() * 100];
    close(apply(multiply(m1, m2), x, y), apply(m1, ...apply(m2, x, y)), 1e-9, 'composition');
    const m3 = randomMatrix(rnd);
    close(multiply(multiply(m1, m2), m3), multiply(m1, multiply(m2, m3)), 1e-9, 'associativity');
  }
});

test('identity is neutral', () => {
  const m: Affine = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(multiply(IDENTITY, m), m);
  assert.deepEqual(multiply(m, IDENTITY), m);
  assert.deepEqual(apply(IDENTITY, 3, -4), [3, -4]);
});

test('constructors match the SVG definitions', () => {
  assert.deepEqual(translate(5), [1, 0, 0, 1, 5, 0]);
  assert.deepEqual(translate(5, -3), [1, 0, 0, 1, 5, -3]);
  assert.deepEqual(scale(2), [2, 0, 0, 2, 0, 0]);
  assert.deepEqual(scale(2, -1), [2, 0, 0, -1, 0, 0]);
  close(rotate(30), [Math.cos(Math.PI / 6), 0.5, -0.5, Math.cos(Math.PI / 6), 0, 0]);
  close(skewX(45), [1, 0, 1, 1, 0, 0]);
  close(skewY(-45), [1, -1, 0, 1, 0, 0]);
  assert.deepEqual(skewX(0), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(skewX(180), [1, 0, 0, 1, 0, 0]);
});

test('quarter turns are exact', () => {
  assert.deepEqual([...rotate(90)].map((v) => v + 0), [0, 1, -1, 0, 0, 0]);
  assert.deepEqual([...rotate(180)].map((v) => v + 0), [-1, 0, 0, -1, 0, 0]);
  assert.deepEqual([...rotate(-90)].map((v) => v + 0), [0, -1, 1, 0, 0, 0]);
  assert.deepEqual([...rotate(450)].map((v) => v + 0), [0, 1, -1, 0, 0, 0]);
  assert.deepEqual([...rotate(360)].map((v) => v + 0), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(apply(rotate(90), 1, 0), [0, 1]); // clockwise on screen: +x turns to +y
});

test('rotate about a center keeps the center fixed', () => {
  const m = rotate(37, 10, 20);
  close(apply(m, 10, 20), [10, 20]);
  close(m, multiply(multiply(translate(10, 20), rotate(37)), translate(-10, -20)));
  close(apply(rotate(90, 10, 10), 20, 10), [10, 20]);
});

test('invert undoes the matrix, and is null when it is singular', () => {
  const rnd = mulberry32(2);
  for (let i = 0; i < 1000; i++) {
    const m = randomMatrix(rnd);
    const inv = invert(m);
    if (!inv) continue;
    close(multiply(m, inv), IDENTITY, 1e-7, 'm · m⁻¹');
    close(multiply(inv, m), IDENTITY, 1e-7, 'm⁻¹ · m');
  }
  close(invert(translate(3, 4))!, translate(-3, -4));
  close(invert(rotate(30))!, rotate(-30));
  assert.equal(invert([1, 2, 2, 4, 5, 6]), null);
  assert.equal(invert([0, 0, 0, 0, 0, 0]), null);
  assert.equal(invert([1e-200, 0, 0, 1e-200, 0, 0]), null); // determinant underflows to 0
  assert.equal(invert([1e-160, 0, 0, 1e-160, 1e200, 0]), null); // the inverse overflows
});

test('decompose names the parts of simple transforms', () => {
  const d = (m: Affine) => {
    const p = decompose(m);
    return [p.translateX, p.translateY, p.rotate, p.scaleX, p.scaleY, p.skewX];
  };
  close(d(translate(5, 6)), [5, 6, 0, 1, 1, 0]);
  close(d(rotate(30)), [0, 0, 30, 1, 1, 0]);
  close(d(rotate(-120)), [0, 0, -120, 1, 1, 0]);
  close(d(scale(2, 3)), [0, 0, 0, 2, 3, 0]);
  close(d(skewX(30)), [0, 0, 0, 1, 1, 30]);
  close(d(scale(-1, 1)), [0, 0, 180, 1, -1, 0]); // a reflection lands in scaleY
  close(d(multiply(multiply(translate(7, -8), rotate(25)), multiply(scale(2, 0.5), skewX(-40)))), [7, -8, 25, 2, 0.5, -40]);
  close(d([0, 0, 0, 0, 5, 6]), [5, 6, 0, 0, 0, 0]);
  close(d([0, 0, 3, 4, 0, 0]), [0, 0, (Math.atan2(-3, 4) * 180) / Math.PI, 0, 5, 0]);
});

test('property: compose(decompose(m)) rebuilds m within 1e-9, singular matrices included', () => {
  const rnd = mulberry32(3);
  const special: Affine[] = [IDENTITY, [0, 0, 0, 0, 0, 0], [0, 0, 3, 4, 1, 2], [0, 0, -0, -4, 0, 0], [1, 2, 2, 4, 0, 0], [2, 0, 5, 0, 0, 0], [-1, -0, 0, -1, 0, 0], [0, -1, 1, 0, 3, 3]];
  const all = [...special, ...Array.from({ length: 5000 }, () => randomMatrix(rnd))];
  for (const m of all) {
    const p = decompose(m);
    assert.ok(p.scaleX >= 0, 'scaleX is never negative');
    assert.ok(p.rotate > -180 && p.rotate <= 180, 'rotate in (-180, 180]');
    assert.ok(p.skewX > -90 && p.skewX < 90, 'skewX in (-90, 90)');
    close(compose(p), m, 1e-9, 'round trip');
  }
});
