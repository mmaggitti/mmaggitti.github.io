// The safe sink fails closed: with no working DOMPurify (here, node has no window) it renders
// nothing at all, not even what the policy alone would allow. The browser side, where both judges
// are present, is covered by test/e2e.mjs over the whole corpus.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el, parseDoc, type LeafNode } from '../../../../engine/model/doc.ts';
import { elementRenders } from '../../../../engine/policy/render-policy.ts';
import { sinkAttributes, sinkElement, sinkReady, sinkText } from '../../src/canvas/safe-sink.ts';

test('without DOMPurify the sink renders nothing', () => {
  const parsed = parseDoc('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/><text>hi</text></svg>');
  assert.ok(parsed.ok);
  const { doc } = parsed;
  const root = el(doc, doc.root);
  const [rect, text] = root.children.map((id) => el(doc, id));
  assert.equal(sinkReady(), false);
  assert.ok(elementRenders(rect.ns, rect.local, false), 'test setup: the policy alone renders <rect>');
  for (const node of [root, rect, text]) assert.equal(sinkElement(doc, node, { inForeignObject: false }), null);
  assert.equal(sinkText(doc, doc.nodes.get(text.children[0]) as LeafNode, text), null);
  assert.equal(sinkAttributes({} as Element, doc, rect), null);
});
