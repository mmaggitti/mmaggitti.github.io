// engine/path/parse: the lossless invariant over real and fuzzed input, number and flag grammar,
// implicit repeats, and where parsing stops on an error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, ARITY, type ParsedPath } from '../../path/parse.ts';
import { serializePath } from '../../path/serialize.ts';
import { corpus, pick, rng } from './helpers.ts';

const WSP = /^[ \t\n\r\f]*$/;

// Everything that must hold for ANY input.
function checkInvariants(d: string, p: ParsedPath) {
  assert.equal(p.segs.map((s) => s.raw).join('') + p.tail, d, 'lossless');
  assert.equal(serializePath(p), d);
  if (p.error) {
    assert.ok(p.error.at >= d.length - p.tail.length && p.error.at <= d.length, 'error lies in the tail');
  } else {
    assert.match(p.tail, WSP, 'without an error the tail is whitespace');
  }
  p.segs.forEach((s, i) => {
    assert.ok(s.raw.length > 0);
    assert.equal(s.args.length, ARITY[s.cmd.toUpperCase()], `arity of ${s.cmd}`);
    assert.ok(s.args.every(Number.isFinite));
    if (i === 0) assert.ok((s.cmd === 'M' || s.cmd === 'm') && !s.implicit, 'starts with a moveto');
    if (s.implicit) assert.ok(!/[Zz]/.test(s.cmd));
  });
  // The kept segments parse the same on their own: nothing in them depends on what failed after.
  if (p.error && p.segs.length) {
    const again = parsePath(p.segs.map((s) => s.raw).join(''));
    assert.equal(again.error, null);
    assert.deepEqual(again.segs, p.segs);
  }
}

const summary = (p: ParsedPath) => p.segs.map((s) => `${s.implicit ? '~' : ''}${s.cmd}${s.args.join(',')}`).join(' ');

test('every real d string round-trips and parses without error', () => {
  const { icons, lab, shared } = corpus();
  assert.ok(icons.length >= 500, `icon sample has ${icons.length} paths`);
  assert.ok(lab.length >= 10, `SVG Lab has ${lab.length} paths`);
  for (const d of [...icons, ...lab]) {
    const p = parsePath(d);
    checkInvariants(d, p);
    assert.equal(p.error, null, d.slice(0, 80));
  }
  for (const d of shared) checkInvariants(d, parsePath(d)); // other people's files may hold errors
});

test('numbers: signs, dots, exponents, packing', () => {
  assert.equal(summary(parsePath('M.5.5')), 'M0.5,0.5');
  assert.equal(summary(parsePath('M10-5')), 'M10,-5');
  assert.equal(summary(parsePath('M-.5-.5 1e2-1E-1 +3+4')), 'M-0.5,-0.5 ~L100,-0.1 ~L3,4');
  assert.equal(summary(parsePath('M1.5.25.125')), 'M1.5,0.25');
  assert.equal(parsePath('M1.5.25.125').error?.at, 11, 'an odd coordinate out');
  assert.equal(summary(parsePath('M0 0 L2e1.5')), 'M0,0 L20,0.5');
  assert.equal(summary(parsePath('m1 2 3 4 5 6')), 'm1,2 ~l3,4 ~l5,6');
  assert.equal(summary(parsePath('M1 2 3 4 5 6')), 'M1,2 ~L3,4 ~L5,6');
  assert.equal(summary(parsePath(' \t\n\r\fM1,2')), 'M1,2');
  assert.equal(summary(parsePath('M 1 , 2 , 3 , 4')), 'M1,2 ~L3,4');
});

test('arc flags are single characters, even packed', () => {
  assert.equal(summary(parsePath('M0 0a1 1 0 0110 10')), 'M0,0 a1,1,0,0,1,10,10');
  assert.equal(summary(parsePath('M0 0A1 1 0 1 0 5 5 1 1 0 0,1 6,6')), 'M0,0 A1,1,0,1,0,5,5 ~A1,1,0,0,1,6,6');
  assert.equal(summary(parsePath('M0 0a.5.5 0 1 1.5.5')), 'M0,0 a0.5,0.5,0,1,1,0.5,0.5');
  for (const bad of ['M0 0 a1 1 0 2 0 5 5', 'M0 0 a1 1 0 .1 0 5 5', 'M0 0 a1 1 0 -1 0 5 5']) {
    const p = parsePath(bad);
    assert.equal(p.segs.length, 1);
    assert.equal(p.error?.message, 'expected an arc flag (0 or 1)');
    assert.equal(p.error?.at, 12);
  }
});

test('segments carry their separators and the implicit form', () => {
  const d = '  M1 2L3,4 5 6\nz m1 1';
  const p = parsePath(d);
  assert.deepEqual(p.segs.map((s) => s.raw), ['  M1 2', 'L3,4', ' 5 6', '\nz', ' m1 1']);
  assert.deepEqual(p.segs.map((s) => s.implicit), [false, false, true, false, false]);
  assert.equal(p.segs[2].cmd, 'L');
  assert.equal(p.tail, '');
  const trailing = parsePath('M0 0 \n');
  assert.equal(trailing.tail, ' \n');
  assert.equal(trailing.error, null);
});

test('parsing stops at the first error and keeps the rest verbatim', () => {
  const cases: [string, number, string, string][] = [
    // d, error at, tail, kept segments
    ['L0 0', 0, 'L0 0', ''],
    ['x', 0, 'x', ''],
    ['M0 0 L10 10 20', 14, ' 20', 'M0,0 L10,10'],
    ['M0 0 L', 6, ' L', 'M0,0'],
    ['M0 0 L 1. 2', 8, ' L 1. 2', 'M0,0'],
    ['M0 0 L1 1e', 9, 'e', 'M0,0 L1,1'],
    ['M0 0 L1 1e+ 2', 11, ' L1 1e+ 2', 'M0,0'],
    ['M0 0 L1 1 L2 1e39', 13, ' L2 1e39', 'M0,0 L1,1'],
    ['M0 0 L2 0e39', 8, ' L2 0e39', 'M0,0'],
    ['M0 0z 5 5', 6, ' 5 5', 'M0,0 z'],
    ['M0 0,L1 1', 5, ',L1 1', 'M0,0'],
    ['M0 0 L1 1,', 10, ',', 'M0,0 L1,1'],
    ['M0 0 L1,,1', 8, ' L1,,1', 'M0,0'],
    ['M,0 0', 1, 'M,0 0', ''],
    ['M0 0 Q1 1 2 2 x', 14, ' x', 'M0,0 Q1,1,2,2'],
  ];
  for (const [d, at, tail, kept] of cases) {
    const p = parsePath(d);
    assert.equal(p.error?.at, at, `${d}: error position`);
    assert.equal(p.tail, tail, `${d}: tail`);
    assert.equal(summary(p), kept, `${d}: kept`);
    checkInvariants(d, p);
  }
  assert.deepEqual(parsePath(''), { segs: [], tail: '', error: null });
  assert.deepEqual(parsePath('  '), { segs: [], tail: '  ', error: null });
  assert.equal(parsePath('M0 0 L1 1 L2 3e38').error, null, 'a float-sized number is fine');
  assert.equal(parsePath('M0 0 L1 1e-99').error, null, 'underflow is fine');
  assert.equal(parsePath('M0 0 L1 1em').error?.at, 9, "'em' is a unit, not an exponent");
});

// Paths built from known segments with every legal way of writing them. The parser must recover
// exactly those commands and values.
function writeNumber(r: () => number, v: number): string {
  const s = String(v);
  switch (Math.floor(r() * 5)) {
    case 0:
      return v >= 0 && r() < 0.5 ? '+' + s : s;
    case 1:
      return /^-?0\./.test(s) ? s.replace('0.', '.') : s; // ".5", "-.5"
    case 2:
      return v === 0 ? '0e0' : `${v * 10}e-1`; // an exponent form of the same value (checked below)
    case 3:
      return v === Math.trunc(v) ? `${v}E+0` : s;
    default:
      return s;
  }
}
function generateValid(r: () => number): { d: string; want: { cmd: string; implicit: boolean; args: number[] }[] } {
  const want: { cmd: string; implicit: boolean; args: number[] }[] = [];
  let d = pick(r, ['', ' ', '\n\t']);
  let prevText = '';
  let prevCmd = '';
  const n = 1 + Math.floor(r() * 8);
  for (let k = 0; k < n; k++) {
    const letter = k === 0 ? 'M' : pick(r, Object.keys(ARITY));
    const cmd = r() < 0.5 ? letter : letter.toLowerCase();
    const implicit = k > 0 && !/[Zz]/.test(prevCmd) && cmd !== 'Z' && cmd !== 'z' && r() < 0.3;
    const eff = implicit ? (prevCmd === 'M' ? 'L' : prevCmd === 'm' ? 'l' : prevCmd) : cmd;
    const args: number[] = [];
    const texts: string[] = [];
    for (let i = 0; i < ARITY[eff.toUpperCase()]; i++) {
      if (/[Aa]/.test(eff) && (i === 3 || i === 4)) {
        const f = r() < 0.5 ? 0 : 1;
        args.push(f);
        texts.push(String(f));
      } else {
        const v = pick(r, [0, 1, -1, 0.5, -0.25, 12, 3.75, -40, 100.5, 7e-3]);
        const t = writeNumber(r, v);
        args.push(Number(t));
        texts.push(t);
      }
    }
    // A separator may be empty only where the next token can't continue the previous one.
    const glueOk = (prev: string, next: string, prevIsFlag: boolean) =>
      prevIsFlag || /^[-+]/.test(next) || (next.startsWith('.') && /[.eE]/.test(prev));
    const sep = (prev: string, next: string, prevIsFlag: boolean) => {
      const s = pick(r, ['', ' ', ',', ' , ', '\n', '  ']);
      return s === '' && !glueOk(prev, next, prevIsFlag) ? ' ' : s;
    };
    if (implicit) {
      d += sep(prevText, texts[0], false);
      prevCmd = eff;
    } else {
      if (k > 0) d += pick(r, ['', ' ', '\n']);
      d += cmd + (texts.length ? pick(r, ['', ' ']) : '');
      prevCmd = cmd;
    }
    texts.forEach((t, i) => {
      if (i > 0) d += sep(texts[i - 1], t, /[Aa]/.test(eff) && (i === 4 || i === 5));
      d += t;
    });
    if (texts.length) prevText = texts[texts.length - 1];
    want.push({ cmd: eff, implicit, args });
  }
  return { d: d + pick(r, ['', ' ', '\n']), want };
}

test('generated valid paths parse to exactly the segments they were built from', () => {
  const r = rng(1);
  for (let n = 0; n < 3000; n++) {
    const { d, want } = generateValid(r);
    const p = parsePath(d);
    assert.equal(p.error, null, JSON.stringify(d));
    assert.deepEqual(p.segs.map(({ cmd, implicit, args }) => ({ cmd, implicit, args })), want, JSON.stringify(d));
    checkInvariants(d, p);
  }
});

test('fuzz: any string, valid or not, never throws and stays lossless', () => {
  const r = rng(2);
  const { icons } = corpus();
  const alphabet = 'MmLlHhVvCcSsQqTtAaZz0123456789012345.-+eE,, \t\n\r\fxX#é  😀';
  let errors = 0;
  for (let n = 0; n < 6000; n++) {
    let d: string;
    const kind = n % 3;
    if (kind === 0) {
      d = generateValid(r).d;
    } else if (kind === 1) {
      // Mutate a real path: insert, delete or replace a few characters.
      d = pick(r, icons);
      for (let m = 1 + Math.floor(r() * 4); m > 0; m--) {
        const at = Math.floor(r() * (d.length + 1));
        const c = pick(r, [...alphabet]);
        const op = Math.floor(r() * 3);
        d = op === 0 ? d.slice(0, at) + c + d.slice(at) : op === 1 ? d.slice(0, at) + d.slice(at + 1) : d.slice(0, at) + c + d.slice(at + 1);
      }
    } else {
      d = Array.from({ length: Math.floor(r() * 40) }, () => pick(r, [...alphabet])).join('');
      if (r() < 0.5) d = 'M' + d;
    }
    const p = parsePath(d);
    checkInvariants(d, p);
    if (p.error) errors++;
  }
  assert.ok(errors > 1000 && errors < 5000, `the fuzzer exercises both outcomes (${errors} errors)`);
});

test('a huge input parses in linear time', () => {
  const d = 'M0 0' + ' 1 2'.repeat(200_000);
  const t0 = performance.now();
  const p = parsePath(d);
  assert.equal(p.segs.length, 200_001);
  assert.ok(performance.now() - t0 < 2000);
});
