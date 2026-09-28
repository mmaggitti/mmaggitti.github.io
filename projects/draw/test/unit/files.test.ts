// Opening files: gzip by magic bytes with a cap, encodings, and #import links.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decodeImport, decodeSvg, encodeImport, sniffEncoding, FileTooLargeError, MAX_SVG_BYTES } from '../../src/platform/files.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Café ✓</text></svg>';
const utf8 = (s: string) => new TextEncoder().encode(s);

test('plain UTF-8, with or without a BOM (the BOM stays, so the file round-trips)', async () => {
  assert.deepEqual(await decodeSvg(utf8(SVG)), { text: SVG, encoding: 'utf-8', gzip: false });
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(SVG)]);
  assert.equal((await decodeSvg(bom)).text, '﻿' + SVG);
});

test('.svgz is recognised by its bytes, whatever the name', async () => {
  const d = await decodeSvg(new Uint8Array(gzipSync(utf8(SVG))));
  assert.equal(d.text, SVG);
  assert.equal(d.gzip, true);
});

test('a gzip that expands past the limit fails cleanly and early', async () => {
  const bomb = new Uint8Array(gzipSync(Buffer.alloc(MAX_SVG_BYTES + 1024 * 1024, 0x20)));
  assert.ok(bomb.byteLength < 100_000, 'test setup: a small file');
  await assert.rejects(decodeSvg(bomb), FileTooLargeError);
});

test('legacy encodings from the XML declaration and UTF-16 by BOM', async () => {
  const latin = new Uint8Array([...utf8('<?xml version="1.0" encoding="ISO-8859-1"?><svg><text>Caf'), 0xe9, ...utf8('</text></svg>')]);
  assert.equal(sniffEncoding(latin), 'windows-1252');
  assert.ok((await decodeSvg(latin)).text.includes('Café'));
  const le = new Uint8Array([0xff, 0xfe, ...new Uint8Array(new Uint16Array([...SVG].map((c) => c.charCodeAt(0))).buffer)]);
  assert.equal((await decodeSvg(le)).encoding, 'utf-16le');
  assert.equal(sniffEncoding(utf8('<?xml version="1.0" encoding="made-up"?><svg/>')), 'utf-8');
});

test('#import links round-trip a file, and anything else is not one', async () => {
  const frag = await encodeImport(SVG);
  assert.match(frag, /^import=[A-Za-z0-9_-]+$/);
  assert.equal(await decodeImport('#' + frag), SVG);
  assert.equal(await decodeImport('#open=designs/x'), null);
  assert.equal(await decodeImport('#import=bad!chars'), null);
});
