// The render policy over the real round-trip corpus (fixtures/corpus/): icons, every SVG Lab
// screen (scripts, iframe, audio and canvas included) and the editor-shaped tool files. The walk is
// the renderer's: a refused element skips its subtree, XHTML counts only inside foreignObject.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDoc, attrValue, textContent, NS, type Doc, type ElementNode, type NodeId } from '../../model/doc.ts';
import { ELEMENT_CLASS } from '../../policy/tables.ts';
import {
  attrKey, attributeRenders, cssAllowed, cssUrlsLocal, elementRenders, hasDuplicateAttrs, renderValue, smilTargetAllowed, URL_ATTRIBUTES,
} from '../../policy/render-policy.ts';

const CORPUS = fileURLToPath(new URL('../fixtures/corpus/', import.meta.url));
const FILES = readdirSync(CORPUS, { recursive: true, encoding: 'utf8' })
  .map((p) => p.split(sep).join('/'))
  .filter((p) => p.endsWith('.svg'))
  .sort();
const PREFIX: Record<string, string> = { [NS.svg]: 'svg', [NS.xhtml]: 'xhtml' };
const inDocument = (url: string) => {
  const u = url.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  return u.startsWith('#') || /^data:image\/(png|jpeg|gif|webp)[;,]/i.test(u);
};

/** Visit each element the renderer reaches, and each one it skips (not descending into it). */
function walk(doc: Doc, visit: (el: ElementNode, rendered: boolean, inForeignObject: boolean) => void): void {
  const go = (id: NodeId, inFo: boolean) => {
    const n = doc.nodes.get(id)!;
    if (n.kind !== 'element') return;
    const rendered = elementRenders(n.ns, n.local, inFo);
    visit(n, rendered, inFo);
    if (rendered) for (const c of n.children) go(c, inFo || (n.ns === NS.svg && n.local === 'foreignObject'));
  };
  go(doc.root, false);
}

test('the corpus renders through the policy: no URL leaves the document, nothing throws', () => {
  assert.ok(FILES.length >= 250, `only ${FILES.length} corpus files`);
  const n = { elements: 0, skipped: 0, attrs: 0, urlsKept: 0, urlsRefused: 0 };
  for (const rel of FILES) {
    const r = parseDoc(readFileSync(CORPUS + rel, 'utf8'));
    assert.ok(r.ok, rel);
    walk(r.doc, (el, rendered) => {
      if (!rendered) return void n.skipped++;
      n.elements++;
      for (const a of el.attrs) {
        const value: string = attrValue(r.doc, el, a.ns, a.local)!;
        const out = renderValue(el, a, value);
        const key = attrKey(a.ns, a.local);
        const url = key !== null && URL_ATTRIBUTES.has(key);
        if (out === null) {
          if (url && attributeRenders(el.ns, el.local, a.ns, a.local)) n.urlsRefused++;
          continue;
        }
        n.attrs++;
        assert.equal(out, value, `${rel}: <${el.qname} ${a.qname}> changed`);
        assert.ok(attributeRenders(el.ns, el.local, a.ns, a.local), `${rel}: <${el.qname} ${a.qname}>`);
        if (url) {
          n.urlsKept++;
          assert.ok(inDocument(out), `${rel}: <${el.qname} ${a.qname}> loads ${JSON.stringify(out.slice(0, 40))}`);
        }
      }
    });
  }
  // Not vacuous: real files keep in-document references and lose their external ones.
  assert.ok(n.elements > 1000 && n.attrs > 3000, JSON.stringify(n));
  assert.ok(n.urlsKept > 20 && n.urlsRefused > 0 && n.skipped > 10, JSON.stringify(n));
});

test("the lab's active content never renders, and every rendered element is one the ledger edits or keeps", () => {
  const skipped = new Set<string>();
  for (const rel of FILES) {
    const r = parseDoc(readFileSync(CORPUS + rel, 'utf8'));
    assert.ok(r.ok, rel);
    walk(r.doc, (el, rendered) => {
      const cls = ELEMENT_CLASS.get(`${PREFIX[el.ns ?? ''] ?? '?'}:${el.local}`);
      if (rendered) assert.ok(cls === 'edit' || cls === 'preserve', `${rel}: <${el.qname}> renders as ${cls}`);
      else if (cls) skipped.add(`${PREFIX[el.ns!]}:${el.local}`);
    });
  }
  for (const k of ['svg:script', 'xhtml:iframe', 'xhtml:audio', 'xhtml:canvas']) assert.ok(skipped.has(k), `${k} is in the corpus and skipped`);
});

test('every SMIL animation in the corpus targets an attribute its element renders', () => {
  let n = 0;
  for (const rel of FILES) {
    const r = parseDoc(readFileSync(CORPUS + rel, 'utf8'));
    assert.ok(r.ok, rel);
    walk(r.doc, (el, rendered) => {
      if (!rendered || !['animate', 'set', 'animateTransform'].includes(el.local)) return;
      const target = r.doc.nodes.get(el.parent!) as ElementNode;
      const name = attrValue(r.doc, el, null, 'attributeName') ?? '';
      assert.ok(smilTargetAllowed(el, name, target), `${rel}: <${el.local} attributeName="${name}"> on <${target.local}>`);
      n++;
    });
  }
  assert.ok(n >= 20, `only ${n} animations: the corpus lost its SMIL`);
});

test("the canvas's stricter rules cost real files nothing: no attribute twice, no CSS the profile allows is refused", () => {
  let css = 0;
  for (const rel of FILES) {
    const r = parseDoc(readFileSync(CORPUS + rel, 'utf8'));
    assert.ok(r.ok, rel);
    walk(r.doc, (el, rendered) => {
      if (!rendered) return;
      assert.ok(!hasDuplicateAttrs(el.attrs), `${rel}: <${el.qname}> carries an attribute twice`);
      const texts = el.ns === NS.svg && el.local === 'style' ? [textContent(r.doc, el.id)] : [];
      const style = attrValue(r.doc, el, null, 'style');
      if (style !== null) texts.push(style);
      for (const t of texts) {
        css++;
        if (cssAllowed(t)) assert.ok(cssUrlsLocal(t), `${rel}: <${el.qname}> CSS the profile serves is refused on the canvas: ${t.slice(0, 60)}`);
      }
    });
  }
  assert.ok(css >= 50, `only ${css} CSS texts: the corpus lost its styles`);
});
