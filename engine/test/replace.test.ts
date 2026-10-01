// Replace this one (engine/model/replace.ts): another file's drawing written over the open one in one
// transaction (the root's attributes as written and everything inside it), undone byte for byte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDoc, serialize, el, descendants, NS, type Doc } from '../model/doc.ts';
import { replaceDrawing } from '../model/replace.ts';
import { Session } from '../commands/session.ts';
import { TokenEditError } from '../code/edit.ts';

const LAB = (f: string) => readFileSync(new URL(`./fixtures/corpus/lab/${f}`, import.meta.url), 'utf8');
const open = (text: string): { doc: Doc; s: Session } => {
  const r = parseDoc(text);
  assert.ok(r.ok);
  return { doc: r.doc, s: new Session(r.doc) };
};

test('a drawing with nothing before or after its root becomes the other file byte for byte, in one entry that undo takes back', () => {
  const before = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:draw="https://example.com/ns" viewBox="0 0 320 240" draw:x="1">\n  <circle cx="1" cy="2" r="3"/>\n  <!-- a note -->\n  <g id="a"><rect width="1" height="1"/></g>\n</svg>\n';
  for (const name of ['create-icon.svg', 'create-logo.svg', 'create-blank.svg']) {
    const { doc, s } = open(before);
    s.dispatch('Replace with SVG Lab icon', (apply) => replaceDrawing(doc, LAB(name), apply));
    assert.equal(serialize(doc), LAB(name), `${name}: the file is the template's`);
    assert.equal(s.undoLabel, 'Replace with SVG Lab icon');
    const shapes = [...descendants(doc, doc.root)].filter((n) => n.kind === 'element' && n.id !== doc.root);
    assert.ok(shapes.every((n) => n.kind === 'element' && n.ns === NS.svg), 'its elements are in the SVG namespace');
    s.undo();
    assert.equal(serialize(doc), before, `${name}: one undo gives the drawing back byte for byte`);
    assert.equal(s.canUndo, false);
    s.redo();
    assert.equal(serialize(doc), LAB(name));
  }
});

test('the root’s attributes come as the other file writes them, quotes and spacing too; a declaration, a comment and the root’s own closing space stay', () => {
  const before = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by hand -->\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"\n><rect/></svg>\n';
  const other = "<svg  viewBox='0 0 24 24'\txmlns=\"http://www.w3.org/2000/svg\" fill=\"none\">\n  <path d=\"M1 1h2\"/>\n</svg>\n";
  const { doc, s } = open(before);
  s.dispatch('Replace', (apply) => replaceDrawing(doc, other, apply));
  assert.equal(serialize(doc), '<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by hand -->\n' + "<svg  viewBox='0 0 24 24'\txmlns=\"http://www.w3.org/2000/svg\" fill=\"none\"\n>\n  <path d=\"M1 1h2\"/>\n</svg>\n");
  s.undo();
  assert.equal(serialize(doc), before);
});

test('a self-closing root takes content, and an empty template empties a drawing', () => {
  const { doc, s } = open('<svg xmlns="http://www.w3.org/2000/svg"/>');
  s.dispatch('Replace', (apply) => replaceDrawing(doc, LAB('create-icon.svg'), apply));
  assert.equal(serialize(doc), LAB('create-icon.svg').trimEnd());
  const two = open(LAB('create-logo.svg'));
  two.s.dispatch('Replace', (apply) => replaceDrawing(two.doc, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"/>', apply));
  assert.equal(serialize(two.doc), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"></svg>\n');
  assert.equal(el(two.doc, two.doc.root).children.length, 0);
});

test('what can’t be written is refused and changes nothing: a root of another name, or a file that doesn’t parse', () => {
  const prefixed = '<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:rect/></s:svg>';
  const { doc, s } = open(prefixed);
  assert.throws(() => s.dispatch('Replace', (apply) => replaceDrawing(doc, LAB('create-icon.svg'), apply)), (e: unknown) => e instanceof TokenEditError && /<s:svg>/.test(e.message));
  assert.equal(serialize(doc), prefixed);
  const plain = open(LAB('create-icon.svg'));
  assert.throws(() => plain.s.dispatch('Replace', (apply) => replaceDrawing(plain.doc, '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>', apply)), TokenEditError);
  assert.equal(serialize(plain.doc), LAB('create-icon.svg'));
  assert.equal(plain.s.canUndo, false);
});
