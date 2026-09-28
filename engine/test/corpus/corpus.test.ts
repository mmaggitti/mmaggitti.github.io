// The round-trip corpus (fixtures/corpus/): what it holds, and what it proves beyond xml.test.ts.
//
// An unedited document serializes by copying source slices, so a clean round trip proves only that
// the lexer accepts a file. Here every node is also marked dirty, which makes the model rebuild each
// start tag from its parsed attributes over real-world bytes. Folder counts are pinned so a lost
// folder or file fails, and the corpus's path data must parse the way Draw will read it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lex } from '../../xml/lex.ts';
import { parseDoc, serialize, descendants, attrValue, textContent, NS, type Doc, type ElementNode } from '../../model/doc.ts';
import { parsePath } from '../../path/parse.ts';

const CORPUS = fileURLToPath(new URL('../fixtures/corpus/', import.meta.url));

// Relative paths with '/'. No catch: a missing corpus folder must fail, not shrink the corpus.
const FILES = readdirSync(CORPUS, { recursive: true, encoding: 'utf8' })
  .map((p) => p.split(sep).join('/'))
  .filter((p) => p.endsWith('.svg'))
  .sort();

function load(rel: string): { src: string; doc: Doc } {
  const src = readFileSync(CORPUS + rel, 'utf8');
  const r = parseDoc(src);
  assert.ok(r.ok, `${rel}: ${!r.ok && r.error.message}`);
  return { src, doc: r.doc };
}

const elements = (doc: Doc): ElementNode[] => [...descendants(doc, doc.root)].filter((n): n is ElementNode => n.kind === 'element');

test('every folder holds the files it should', () => {
  const counts: Record<string, number> = {};
  for (const f of FILES) {
    const dir = f.slice(0, f.lastIndexOf('/'));
    counts[dir] = (counts[dir] ?? 0) + 1;
  }
  // icons: 25 per set (icons/README.md). lab: 29 screens + 33 other modes + 4 Create templates
  // (tools/capture-lab-corpus.mjs). tools: hand-written (tools/README.md). A re-capture that adds
  // or loses a lab mode changes this count on purpose.
  const sets = ['bootstrap', 'feather', 'heroicons', 'lucide', 'simple-icons', 'tabler'];
  assert.deepEqual(counts, { ...Object.fromEntries(sets.map((s) => [`icons/${s}`, 25])), lab: 66, tools: 37 });
  for (const s of sets) assert.ok(readFileSync(`${CORPUS}icons/${s}/LICENSE.txt`, 'utf8').length > 0, `icons/${s} has its license`);
});

test("the lab's non-default modes are captured: scripts, embedded HTML, unknown elements", () => {
  const shapes: [string, string, string][] = [
    ['lab/spin--js.svg', NS.svg, 'script'],
    ['lab/links--tips.svg', NS.svg, 'script'],
    ['lab/links--modes.svg', NS.svg, 'script'],
    ['lab/media--canvas.svg', NS.xhtml, 'canvas'],
    ['lab/media--iframe.svg', NS.xhtml, 'iframe'],
    ['lab/media--audio.svg', NS.xhtml, 'audio'],
    ['lab/embed--bubble.svg', NS.xhtml, 'p'],
    ['lab/switch--unknown.svg', NS.svg, 'sparkle'],
  ];
  for (const [rel, ns, local] of shapes) {
    assert.ok(elements(load(rel).doc).some((n) => n.ns === ns && n.local === local), `${rel} holds <${local}>`);
  }
});

test('every corpus file survives a full rebuild: all nodes dirty, bytes unchanged', () => {
  for (const rel of FILES) {
    const { src, doc } = load(rel);
    const r = lex(src);
    assert.ok(r.ok, rel);
    let at = 0;
    for (const t of r.tokens) {
      assert.equal(t.start, at, `${rel}: tokens are contiguous`);
      at = t.end;
    }
    assert.equal(at, src.length, `${rel}: tokens cover the source`);
    for (const n of doc.nodes.values()) {
      if (n.kind === 'element') n.tagDirty = n.childrenDirty = true;
      else n.dirty = true;
    }
    assert.equal(serialize(doc), src, `${rel}: rebuilt round trip`);
  }
});

test('every path in the corpus parses without error', () => {
  let n = 0;
  for (const rel of FILES) {
    const { doc } = load(rel);
    for (const e of elements(doc)) {
      const d = e.ns === NS.svg && e.local === 'path' ? attrValue(doc, e, null, 'd') : null;
      if (d === null) continue;
      const p = parsePath(d);
      assert.equal(p.error, null, `${rel}: ${p.error?.message} in ${JSON.stringify(d.slice(0, 60))}`);
      n++;
    }
  }
  assert.ok(n >= 400, `only ${n} paths: the corpus lost files`);
});

// XML 1.0 §2.11 and §3.3.3: a processor turns CRLF and lone CR into LF, then every TAB, CR and LF
// in an attribute value into a space; text keeps its LFs. The expected strings are what expat
// reports for these files.
test('decoded values match an XML processor: line ends and attribute whitespace', () => {
  const cases: [string, string, string | null, string][] = [
    ['tools/edge-crlf-line-endings.svg', 'path', 'd', 'M4 28            L16 4            L28 28 Z'],
    ['tools/edge-crlf-line-endings.svg', 'text', null, 'line one\nline two'],
    ['tools/edge-mixed-line-endings.svg', 'path', 'd', 'M0 10 L10 0'],
    ['tools/edge-tabs-indentation.svg', 'polygon', 'points', '22,2 38,2 30,18'],
    ['lab/texture.svg', 'feColorMatrix', 'values', '0 0 0 0 0         0 0 0 0 0         0 0 0 0 0         0 0 0 0.35 0'],
  ];
  for (const [rel, local, attr, want] of cases) {
    const { doc } = load(rel);
    const e = elements(doc).find((x) => x.local === local)!;
    assert.equal(attr ? attrValue(doc, e, null, attr) : textContent(doc, e.id), want, `${rel} <${local}>`);
  }
});
