// engine/values/length: parsing SVG lengths and converting them to user units.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength, toUserUnits, type Length } from '../../values/length.ts';

test('parseLength reads a number and an optional unit, case-insensitively', () => {
  const ok: [string, Length][] = [
    ['12.5mm', { value: 12.5, unit: 'mm' }],
    ['10', { value: 10, unit: '' }],
    [' 10PX\n', { value: 10, unit: 'px' }],
    ['-1.5e1Em', { value: -15, unit: 'em' }],
    ['2ex', { value: 2, unit: 'ex' }],
    ['50%', { value: 50, unit: '%' }],
    ['.5in', { value: 0.5, unit: 'in' }],
    ['+3Pt', { value: 3, unit: 'pt' }],
    ['1pc', { value: 1, unit: 'pc' }],
    ['2.54CM', { value: 2.54, unit: 'cm' }],
    ['1e3', { value: 1000, unit: '' }],
    ['0', { value: 0, unit: '' }],
  ];
  for (const [s, want] of ok) assert.deepEqual(parseLength(s), want, JSON.stringify(s));
});

test('parseLength rejects garbage', () => {
  for (const s of ['', ' ', 'px', '10 px', '10px5', '1.', '1e', '1e3e', '10km', '10p x', '--1', '1..2', 'Infinity', 'NaN', '1e999', '10px;', 'calc(1px)', ' 10']) {
    assert.equal(parseLength(s), null, JSON.stringify(s));
  }
});

const near = (a: number | null, b: number, msg: string): void => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

test('absolute units convert at 96 per inch', () => {
  const u = (s: string): number | null => toUserUnits(parseLength(s)!);
  near(u('10'), 10, 'unitless');
  near(u('10px'), 10, 'px');
  near(u('1in'), 96, 'in');
  near(u('72pt'), 96, 'pt');
  near(u('6pc'), 96, 'pc');
  near(u('25.4mm'), 96, 'mm');
  near(u('2.54cm'), 96, 'cm');
  near(u('3pt'), 4, 'pt');
  near(u('1mm'), 96 / 25.4, 'mm');
  near(u('-1in'), -96, 'negative');
});

test('em, ex and % need their context, and are null without it', () => {
  const em = parseLength('2em')!;
  const ex = parseLength('2ex')!;
  const pc = parseLength('50%')!;
  assert.equal(toUserUnits(em), null);
  assert.equal(toUserUnits(ex, { percentBase: 100 }), null);
  assert.equal(toUserUnits(pc, { fontSize: 16 }), null);
  near(toUserUnits(em, { fontSize: 16 }), 32, 'em');
  near(toUserUnits(ex, { fontSize: 16 }), 16, 'ex is half an em');
  near(toUserUnits(pc, { percentBase: 300 }), 150, '%');
  near(toUserUnits(pc, { percentBase: 0 }), 0, '% of zero');
  near(toUserUnits(parseLength('1in')!, { fontSize: 16, percentBase: 1 }), 96, 'context ignored for absolute units');
});
