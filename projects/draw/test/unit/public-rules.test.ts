// scripts/lib/public-rules.mjs: the guard's rules, shared with Draw's pre-save checks. Each rule
// fires on a line of its shape. The shapes are assembled from pieces so this public file holds no
// literal secret (the guard scans it too).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_RULES, lineFindings } from '../../../../scripts/lib/public-rules.mjs';

const SHAPES: [string, string][] = [
  ['anthropic-key', 'key ' + 'sk-' + 'ant-' + 'a'.repeat(24)],
  ['github-token', 'tok ' + 'gh' + 'p_' + 'A'.repeat(36)],
  ['github-pat', 'pat ' + 'github_' + 'pat_' + 'b'.repeat(55)],
  ['aws-key-id', 'aws ' + 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP'],
  ['slack-token', 'slack ' + 'xo' + 'xb-' + '1234567890abc'],
  ['private-key-block', '-----BEGIN ' + 'PRIVATE KEY-----'],
  ['wireguard-key', 'PrivateKey = ' + 'A'.repeat(42) + 'E='],
  ['sudo-password-pipe', 'echo hunter2 | ' + 'sudo -S true'],
  ['login-user-slash-password', 'login ' + 'mark/hunter2'],
  ['private-ipv4', 'ip ' + '192.' + '168.1.5'],
  ['ipv6-ula', 'ula ' + 'fd' + '12:3456:789a::1'],
  ['ipv6-global', 'g6 ' + '2600:1f18' + ':abcd:1234::5'],
  ['windows-machine-name', 'host ' + 'DESKTOP-' + 'ABC1234'],
  ['windows-home-path', 'win C:' + '\\Users\\alice\\x'],
  ['mac-home-path', 'mac /' + 'Users/alice/x'],
  ['linux-home-path', 'lin /' + 'home/alice/x'],
  ['ios-device-id', 'dev ' + '0000' + '8110-' + '0123456789ABCDEF'],
];

test('every guard rule has a shape here', () => {
  assert.deepEqual(SHAPES.map(([r]) => r).sort(), LINE_RULES.map((rule) => String(rule[0])).sort());
});

for (const [rule, line] of SHAPES) {
  test(`fires: ${rule}`, () => assert.ok(lineFindings(line).includes(rule)));
}

test('public-ok exempts a line', () => {
  assert.deepEqual(lineFindings('ok ' + '192.' + '168.1.5 public-ok'), []);
});

test('known false positive: compact SVG path numbers read as a private address', () => {
  // Why Draw's number formatter always writes separators and leading zeros (and why foreign data
  // gets an explicit "Normalize numbers" step before publishing).
  assert.ok(lineFindings('d="M1 ' + '10.5' + '.3.2"').includes('private-ipv4'));
  assert.deepEqual(lineFindings('d="M1 10.5 0.3 0.2"'), []);
});
