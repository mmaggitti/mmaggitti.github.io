// Opening files: gzip by magic bytes with a cap, encodings, #import links and pastes; writing them
// back in the encoding they came in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decodeImport, decodeSvg, encodeImport, encodeSvg, looksLikeSvg, pasted, readFile, sniffEncoding, FileTooLargeError, MAX_SVG_BYTES } from '../../src/platform/files.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Café ✓</text></svg>';
const utf8 = (s: string) => new TextEncoder().encode(s);

test('plain UTF-8, with or without a BOM (the BOM stays, so the file round-trips)', async () => {
  assert.deepEqual(await decodeSvg(utf8(SVG)), { text: SVG, encoding: 'utf-8', gzip: false, lossy: false });
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
  assert.equal(await decodeImport('#' + (await encodeImport('\uFEFF' + SVG))), '\uFEFF' + SVG, 'a BOM stays, as it does in a file');
  assert.equal(await decodeImport('#open=designs/x'), null);
  assert.equal(await decodeImport('#import=bad!chars'), null);
});

test('encodeSvg writes a file back in the encoding it came in, and never bytes that disagree with their declaration', async () => {
  const same = async (bytes: Uint8Array) => assert.deepEqual(encodeSvg((await decodeSvg(bytes)).text).bytes, bytes);
  await same(utf8(SVG));
  await same(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(SVG)]));
  const latin = new Uint8Array([...utf8('<?xml version="1.0" encoding="ISO-8859-1"?><svg><text>Caf'), 0xe9, 0x80, ...utf8('</text></svg>')]);
  await same(latin);
  const koi8 = new Uint8Array([...utf8("<?xml version='1.0' encoding='KOI8-R'?><svg><text>"), 0xf0, 0xd2, 0xc9, ...utf8('</text></svg>')]);
  await same(koi8);
  const utf16 = (le: boolean) => {
    const s = '﻿<?xml version="1.0" encoding="UTF-16"?><svg><text>✓</text></svg>';
    const out = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) new DataView(out.buffer).setUint16(i * 2, s.charCodeAt(i), le);
    return out;
  };
  await same(utf16(true));
  // A UTF-8 BOM decides, whatever the declaration says: kept as it came.
  await same(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('<?xml version="1.0" encoding="ISO-8859-1"?><svg><text>✓</text></svg>')]));

  // A Latin-1 file that now holds a character Latin-1 can't: UTF-8, and the declaration says so.
  const grown = encodeSvg('<?xml version="1.0" encoding="ISO-8859-1"?><svg><text>✓</text></svg>');
  assert.equal(grown.relabeled, 'ISO-8859-1');
  assert.equal(new TextDecoder().decode(grown.bytes), '<?xml version="1.0" encoding="UTF-8"?><svg><text>✓</text></svg>');
  // Shift_JIS: Draw reads it but can't write it.
  const sjis = encodeSvg("<?xml version='1.0' encoding='Shift_JIS'?><svg/>");
  assert.equal(sjis.encoding, 'utf-8');
  assert.equal(new TextDecoder().decode(sjis.bytes), "<?xml version='1.0' encoding='UTF-8'?><svg/>");
  assert.equal(encodeSvg('<svg/>').relabeled, null);
});

test('a paste is SVG when the clipboard says image/svg+xml, or its text looks like SVG markup', () => {
  const event = (data: Record<string, string>) => ({ clipboardData: { getData: (t: string) => data[t] ?? '' } }) as unknown as ClipboardEvent;
  assert.deepEqual(pasted(event({ 'image/svg+xml': '<svg/>', 'text/plain': 'x' })), { text: '<svg/>', svg: true });
  assert.deepEqual(pasted(event({ 'text/plain': '  <svg xmlns="http://www.w3.org/2000/svg"/>' })), { text: '  <svg xmlns="http://www.w3.org/2000/svg"/>', svg: true });
  assert.deepEqual(pasted(event({ 'text/plain': 'just words' })), { text: 'just words', svg: false });
  assert.equal(pasted(event({})), null);
  assert.equal(pasted({ clipboardData: null } as unknown as ClipboardEvent), null);
  assert.ok(looksLikeSvg('<?xml version="1.0"?>\n<!DOCTYPE svg><svg/>'));
  assert.ok(!looksLikeSvg('<svgs/>'));
});

test('a file is written back as decodeSvg read it: UTF-16 in either byte order, declared or not; bytes that were not valid are flagged (lossy)', async () => {
  const utf16 = (s: string, le: boolean) => {
    const out = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) new DataView(out.buffer).setUint16(i * 2, s.charCodeAt(i), le);
    return out;
  };
  const cases: [string, Uint8Array, string][] = [
    ['UTF-8', utf8(SVG), 'utf-8'],
    ['UTF-8 with a BOM', new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(SVG)]), 'utf-8'],
    ['Latin-1', new Uint8Array([...utf8('<?xml version="1.0" encoding="ISO-8859-1"?><svg><text>Caf'), 0xe9, 0x80, ...utf8('</text></svg>')]), 'windows-1252'],
    ['UTF-16LE with a BOM and no declaration', utf16('\uFEFF' + SVG, true), 'utf-16le'],
    ['UTF-16BE with a BOM and no declaration', utf16('\uFEFF' + SVG, false), 'utf-16be'],
    ['UTF-16BE declared as "UTF-16"', utf16('\uFEFF<?xml version="1.0" encoding="UTF-16"?><svg><text>✓</text></svg>', false), 'utf-16be'],
    ['UTF-16LE declared as "UTF-16"', utf16('\uFEFF<?xml version="1.0" encoding="UTF-16"?><svg><text>✓</text></svg>', true), 'utf-16le'],
  ];
  for (const [what, bytes, encoding] of cases) {
    const d = await decodeSvg(bytes);
    assert.equal(d.encoding, encoding, what);
    assert.equal(d.lossy, false, what);
    const back = encodeSvg(d.text, d.encoding);
    assert.deepEqual(back.bytes, bytes, `${what}: written back byte for byte`);
    assert.equal(back.relabeled, null, what);
  }
  // A UTF-8 file with one Latin-1 byte: it opens (the byte becomes U+FFFD), and says so, since no
  // export can write that byte back.
  const broken = new Uint8Array([...utf8('<svg xmlns="http://www.w3.org/2000/svg"><text>Caf'), 0xe9, ...utf8('</text></svg>')]);
  const d = await decodeSvg(broken);
  assert.equal(d.lossy, true);
  assert.ok(d.text.includes('Caf\uFFFD'));
  assert.notDeepEqual(encodeSvg(d.text, d.encoding).bytes, broken);
  // What a file says it is still holds when the text can't be written so: UTF-8, and the declaration says so.
  const grown = encodeSvg('<?xml version="1.0" encoding="ISO-8859-1"?><svg><text>✓</text></svg>', 'windows-1252');
  assert.equal(grown.relabeled, 'ISO-8859-1');
  assert.equal(new TextDecoder().decode(grown.bytes), '<?xml version="1.0" encoding="UTF-8"?><svg><text>✓</text></svg>');
});

test('a file past the size limit is refused before it is read', async () => {
  const big = { size: MAX_SVG_BYTES + 1, arrayBuffer: () => assert.fail('it was read') } as unknown as Blob;
  await assert.rejects(readFile(big), FileTooLargeError);
  assert.deepEqual(await readFile(new Blob([utf8(SVG)])), utf8(SVG));
});
