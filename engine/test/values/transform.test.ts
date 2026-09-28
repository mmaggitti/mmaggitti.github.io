// engine/values/transform: the transform attribute's grammar, its matrix, and writing it back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTransform, serializeTransform, itemMatrix, type TransformItem, type TransformFn } from '../../values/transform.ts';
import { IDENTITY, apply, multiply, rotate, translate, type Affine } from '../../values/affine.ts';
import { fmt } from '../../values/number-format.ts';
import { lineFindings } from '../../../scripts/lib/public-rules.mjs';
import { mulberry32 } from './rng.ts';

function close(a: readonly number[], b: readonly number[], tol = 1e-9, msg = ''): void {
  assert.ok(a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol * Math.max(1, Math.abs(b[i]))), `${msg} [${a}] ≠ [${b}]`);
}

const items = (s: string): [string, number[]][] | undefined => parseTransform(s)?.items.map((it) => [it.fn, it.args]);

test('an empty or blank transform is the empty list', () => {
  for (const s of ['', '  ', '\n\t']) assert.deepEqual(parseTransform(s), { items: [], matrix: IDENTITY });
});

test('each function with each allowed argument count', () => {
  assert.deepEqual(items('matrix(1 2 3 4 5 6)'), [['matrix', [1, 2, 3, 4, 5, 6]]]);
  assert.deepEqual(items('translate(10)'), [['translate', [10]]]);
  assert.deepEqual(items('translate(10 20)'), [['translate', [10, 20]]]);
  assert.deepEqual(items('scale(2)'), [['scale', [2]]]);
  assert.deepEqual(items('scale(2,-1)'), [['scale', [2, -1]]]);
  assert.deepEqual(items('rotate(45)'), [['rotate', [45]]]);
  assert.deepEqual(items('rotate(45 10 10)'), [['rotate', [45, 10, 10]]]);
  assert.deepEqual(items('skewX(30)'), [['skewX', [30]]]);
  assert.deepEqual(items('skewY(-30)'), [['skewY', [-30]]]);
  close(parseTransform('translate(10)')!.matrix, [1, 0, 0, 1, 10, 0]);
  close(parseTransform('scale(2)')!.matrix, [2, 0, 0, 2, 0, 0]);
  close(parseTransform('matrix(1 2 3 4 5 6)')!.matrix, [1, 2, 3, 4, 5, 6]);
});

test('whitespace and commas per the SVG grammar', () => {
  const want = [['translate', [10, 20]], ['scale', [2]]];
  for (const s of [
    'translate(10,20) scale(2)',
    'translate(10 , 20),scale(2)',
    'translate(10,20)scale(2)',
    'translate (10 20) , scale( 2 )',
    '\ttranslate(10\n20)\n\nscale(2)\n',
  ]) {
    assert.deepEqual(items(s), want, JSON.stringify(s));
  }
  assert.deepEqual(items('translate(10-5)'), [['translate', [10, -5]]]); // compact numbers, as browsers read them
  assert.deepEqual(items('matrix(1,0,0,1,.5.5)'), [['matrix', [1, 0, 0, 1, 0.5, 0.5]]]);
});

test('invalid transforms are null', () => {
  for (const s of [
    'translate()',
    'translate(1 2 3)',
    'rotate(1 2)',
    'rotate(1 2 3 4)',
    'matrix(1 2 3 4 5)',
    'matrix(1 2 3 4 5 6 7)',
    'skewX(1 2)',
    'skewY()',
    'scale(1,)',
    'scale(,1)',
    'Translate(1)',
    'TRANSLATE(1)',
    'translate(1',
    'translate(1))',
    'translate 1',
    ',translate(1)',
    'translate(1),',
    'translate(1) ,',
    'translate(1),,scale(2)',
    'foo(1)',
    'translate(1px)',
    'rotate(45deg)',
    'translate(1) x',
    'translate(1)(2)',
    'translate(1e999)',
    'translate(calc(1))',
  ]) {
    assert.equal(parseTransform(s), null, JSON.stringify(s));
  }
});

test('the list matrix is the left-to-right product, so the last item acts on points first', () => {
  const t = parseTransform('translate(10 0) scale(2)')!;
  assert.deepEqual(apply(t.matrix, 1, 1), [12, 2]);
  const u = parseTransform('scale(2) translate(10 0)')!;
  assert.deepEqual(apply(u.matrix, 1, 1), [22, 2]);
  close(parseTransform('rotate(30 5 7)')!.matrix, multiply(multiply(translate(5, 7), rotate(30)), translate(-5, -7)));
  const s = 'translate(3 4) rotate(20) scale(1.5 -2) skewX(10) skewY(-5) matrix(1 0.2 0.3 1 7 8)';
  const r = parseTransform(s)!;
  close(r.matrix, r.items.map(itemMatrix).reduce<Affine>((m, x) => multiply(m, x), IDENTITY));
});

test('serializeTransform writes minimal numbers with single spaces', () => {
  const list: TransformItem[] = [
    { fn: 'translate', args: [10, 20] },
    { fn: 'rotate', args: [45, 10, 10] },
    { fn: 'scale', args: [1 / 3, 2 / 3] },
    { fn: 'matrix', args: [1, 0, -0, 1, 0.5, 1e-9] },
  ];
  assert.equal(serializeTransform(list), 'translate(10 20) rotate(45 10 10) scale(0.333 0.667) matrix(1 0 0 1 0.5 0)');
  assert.equal(serializeTransform(list.slice(2, 3), 1), 'scale(0.3 0.7)');
  assert.equal(serializeTransform([]), '');
});

test('property: serialize then parse gives back the rounded items, and the output never trips the guard', () => {
  const rnd = mulberry32(4);
  const arity: [TransformFn, number[]][] = [['matrix', [6]], ['translate', [1, 2]], ['scale', [1, 2]], ['rotate', [1, 3]], ['skewX', [1]], ['skewY', [1]]];
  for (let i = 0; i < 5000; i++) {
    const list: TransformItem[] = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => {
      const [fn, counts] = arity[Math.floor(rnd() * arity.length)];
      const n = counts[Math.floor(rnd() * counts.length)];
      return { fn, args: Array.from({ length: n }, () => (rnd() * 2 - 1) * 10 ** Math.floor(rnd() * 5 - 2)) };
    });
    const d = Math.floor(rnd() * 6);
    const s = serializeTransform(list, d);
    assert.ok(!/\([^)]*e/i.test(s), `no exponent in the arguments: ${s}`);
    assert.deepEqual(lineFindings(s), [], s);
    const back = parseTransform(s);
    assert.ok(back, s);
    assert.deepEqual(
      back.items,
      list.map((it) => ({ fn: it.fn, args: it.args.map((v) => Number(fmt(v, d))) })),
      s,
    );
  }
});
