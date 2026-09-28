// engine/values/number-format: minimal plain decimals, and output the public guard never trips on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, joinNumbers, parseNumberList } from '../../values/number-format.ts';
import { lineFindings } from '../../../scripts/lib/public-rules.mjs';
import { mulberry32 } from './rng.ts';

const PLAIN = /^(?!-0$)-?(0|[1-9]\d*)(\.\d*[1-9])?$/; // no exponent, no '.5', no trailing zeros

test('fmt rounds and writes the shortest plain decimal', () => {
  const cases: [number, number | undefined, string][] = [
    [0.5, undefined, '0.5'],
    [-0.5, undefined, '-0.5'],
    [1.23456, undefined, '1.235'],
    [1.2, undefined, '1.2'],
    [100, undefined, '100'],
    [0.1 + 0.2, undefined, '0.3'],
    [1.23456, 5, '1.23456'],
    [10, 2, '10'],
    [0.000123, 6, '0.000123'],
    [123.456, 0, '123'],
    [2.5, 0, '3'],
    [-2.5, 0, '-3'],
    [1.0625, 3, '1.063'],
    [-1.0625, 3, '-1.063'],
    [99.9996, 3, '100'],
  ];
  for (const [n, d, want] of cases) assert.equal(d === undefined ? fmt(n) : fmt(n, d), want, `fmt(${n}, ${d})`);
});

test('fmt never writes -0 or an exponent', () => {
  assert.equal(fmt(-0), '0');
  assert.equal(fmt(-0.0001), '0');
  assert.equal(fmt(-0.4, 0), '0');
  assert.equal(fmt(1e-7), '0');
  assert.equal(fmt(-1e-7, 20), '-0.0000001');
  assert.equal(fmt(5e-324, 3), '0');
  assert.equal(fmt(1e21), '1000000000000000000000');
  assert.equal(fmt(-1.5e22), '-15000000000000000000000');
  assert.equal(fmt(1e20 + 0.5), '100000000000000000000');
  const max = fmt(Number.MAX_VALUE);
  assert.match(max, /^\d{309}$/);
});

test('fmt rejects NaN and Infinity instead of writing them into a document', () => {
  assert.throws(() => fmt(NaN), RangeError);
  assert.throws(() => fmt(Infinity), RangeError);
  assert.throws(() => fmt(-Infinity), RangeError);
});

test('joinNumbers separates with one space', () => {
  assert.equal(joinNumbers([1, 0.5, -0.25]), '1 0.5 -0.25');
  assert.equal(joinNumbers([1 / 3, 2 / 3], 2), '0.33 0.67');
  assert.equal(joinNumbers([]), '');
});

test('the guard does fire on a compact dotted run (so the property test below can fail)', () => {
  const compact = ['10', '5', '3', '2'].join('.'); // what '10.5 0.3 0.2' becomes with leading zeros dropped
  assert.ok(lineFindings(compact).includes('private-ipv4'));
  assert.deepEqual(lineFindings(joinNumbers([10.5, 0.3, 0.2])), []);
});

// Magnitudes and shapes that stress rounding, exponents and IP-looking fragments.
function sample(rnd: () => number): number {
  const sign = rnd() < 0.5 ? -1 : 1;
  switch (Math.floor(rnd() * 7)) {
    case 0:
      return (rnd() * 2 - 1) * 1000;
    case 1:
      return sign * 10 ** (rnd() * 40 - 15); // 1e-15 … 1e25
    case 2:
      return sign * Math.floor(rnd() * 1e6);
    case 3:
      return sign * Math.floor(rnd() * 4096) / 8; // exact binary fractions, ties at .5
    case 4:
      return [10, 172, 192][Math.floor(rnd() * 3)] + Math.floor(rnd() * 256) / 1000; // 10.x, 172.x, 192.x
    case 5:
      return sign * Math.floor(rnd() * 256) / 10 ** Math.floor(rnd() * 4);
    default:
      return sign * rnd() * 1e-3;
  }
}

test('property: 100k numbers format plain, round-trip within the rounding, and never trip the guard', () => {
  const rnd = mulberry32(0x5eed);
  for (let i = 0; i < 100_000; i++) {
    const n = sample(rnd);
    const d = Math.floor(rnd() * 7);
    const s = fmt(n, d);
    assert.match(s, PLAIN, `fmt(${n}, ${d}) = ${s}`);
    assert.ok(Math.abs(Number(s) - n) <= 0.5 * 10 ** -d + Math.abs(n) * 1e-15, `fmt(${n}, ${d}) = ${s}`);
    assert.deepEqual(lineFindings(s), [], s);
  }
});

test('property: 100k joined number lists never trip the guard and never contain an exponent', () => {
  const rnd = mulberry32(0xd1a7);
  for (let i = 0; i < 100_000; i++) {
    const list = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => sample(rnd));
    const d = Math.floor(rnd() * 7);
    const s = joinNumbers(list, d);
    assert.ok(!s.includes('e'), s);
    assert.deepEqual(lineFindings(s), [], s);
    assert.deepEqual(parseNumberList(s), list.map((n) => Number(fmt(n, d))), s);
  }
});

test('parseNumberList reads whitespace/comma lists and the compact forms browsers accept', () => {
  const ok: [string, number[]][] = [
    ['0 0 24 24', [0, 0, 24, 24]],
    ['0,0,24,24', [0, 0, 24, 24]],
    [' 0 , 0 ,24,\t24\n', [0, 0, 24, 24]],
    ['0-1', [0, -1]],
    ['0.5.5', [0.5, 0.5]],
    ['1e2 3', [100, 3]],
    ['-1.5E-1 +2', [-0.15, 2]],
    ['+.5', [0.5]],
    ['', []],
    ['   ', []],
  ];
  for (const [s, want] of ok) assert.deepEqual(parseNumberList(s), want, JSON.stringify(s));
  for (const s of [',1', '1,', '1,,2', '1 , , 2', '1 x', 'x', '1.', '1e', '1e999', '.', '-', ' 1', '1 2']) {
    assert.equal(parseNumberList(s), null, JSON.stringify(s));
  }
});
