// engine/access/model.ts: the Access tab's planners on SVG Lab's own files. Title on and off with the
// root's role and aria-labelledby (lab/create.svg: SVG Lab's Create markup; lab/access.svg: Title off,
// then Description off, gives SVG Lab's states); Draw never writing over a file's own role or label;
// role="img" taken away only when no title, description or aria-label is left; Language and its
// refusal; an element's title as its first child (SVG Lab's bar titles); Label, Role, Hidden and other
// ARIA; one undo each giving the bytes back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descendants, parseDoc, serialize, type Doc, type ElementNode, type NodeId } from '../../model/doc.ts';
import { Session } from '../../commands/session.ts';
import { TokenEditError } from '../../code/edit.ts';
import { ARIA_ROLES, DEFAULT_TITLE, NOT_A_TAG, accessOf, elementAccess, notARole, planAria, planDrawingDesc, planDrawingTitle, planElementTitle, planLang, planRole, roleError } from '../../access/model.ts';

const corpus = (rel: string) => readFileSync(new URL(`../fixtures/corpus/${rel}`, import.meta.url), 'utf8');
const load = (src: string): Doc => {
  const r = parseDoc(src);
  assert.ok(r.ok, !r.ok ? r.error.message : '');
  return r.doc;
};
const all = (doc: Doc, local: string): ElementNode[] => [...descendants(doc, doc.root)].filter((n): n is ElementNode => n.kind === 'element' && n.local === local);
const ACCESS = corpus('lab/access.svg');
const CREATE = corpus('lab/create.svg');
/** One transaction, the file after, then one undo must give `src` back. */
function once(src: string, plan: (doc: Doc, apply: Parameters<Parameters<Session['dispatch']>[1]>[0]) => void): string {
  const doc = load(src);
  const s = new Session(doc);
  s.dispatch('t', (apply) => plan(doc, apply));
  const after = serialize(doc);
  s.undo();
  assert.equal(serialize(doc), src, 'one undo gives the bytes back');
  return after;
}

test('Title on, on lab/create.svg, writes SVG Lab’s Create markup: role="img" aria-labelledby="drawing-title" on the root and <title id="drawing-title">My drawing</title> as its first child', () => {
  const out = once(CREATE, (doc, apply) => planDrawingTitle(doc, DEFAULT_TITLE, apply));
  assert.equal(out, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-labelledby="drawing-title">\n  <title id="drawing-title">My drawing</title>\n</svg>\n');
  const doc = load(out);
  assert.deepEqual(accessOf(doc).title?.text, 'My drawing');
  // drawing-title taken: a fresh id, named by the root's reference.
  const taken = once('<svg xmlns="http://www.w3.org/2000/svg"><rect id="drawing-title"/></svg>', (d, apply) => planDrawingTitle(d, 'Logo', apply));
  assert.equal(taken, '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="drawing-title-2"><title id="drawing-title-2">Logo</title><rect id="drawing-title"/></svg>');
});

test('on lab/access.svg, Title off then Description off gives SVG Lab’s states: the title and the reference that names exactly its id go, role="img" stays while the description names the image, then goes with it', () => {
  const noTitle = once(ACCESS, (doc, apply) => planDrawingTitle(doc, null, apply));
  assert.equal(noTitle, ACCESS.replace(' aria-labelledby="chart-title"', '').replace('\n  <title id="chart-title">Monthly visitors</title>', ''));
  const neither = once(noTitle, (doc, apply) => planDrawingDesc(doc, null, apply));
  assert.equal(neither, noTitle.replace(' role="img" aria-describedby="chart-desc"', '').replace('\n  <desc id="chart-desc">Bar chart. Visitors rose from 40 in January to 88 in April.</desc>', ''));
  // Description back on: after the title (none here: first), its role and reference again.
  const desc = once(neither, (doc, apply) => planDrawingDesc(doc, 'Bars', apply));
  assert.match(desc, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 100 100" role="img" aria-describedby="drawing-desc">\n {2}<desc id="drawing-desc">Bars<\/desc>\n {2}<line /);
  const both = once(desc, (doc, apply) => planDrawingTitle(doc, 'T', apply));
  assert.match(both, /aria-describedby="drawing-desc" aria-labelledby="drawing-title">\n {2}<title id="drawing-title">T<\/title>\n {2}<desc id="drawing-desc">Bars<\/desc>/, 'a title goes first, the description after it');
  const titled = once(both.replace('<title id="drawing-title">T</title>\n  ', ''), (doc, apply) => planDrawingDesc(doc, 'x', apply));
  assert.ok(titled.includes('<desc id="drawing-desc">x</desc>'), 'editing an existing description writes its text');
});

test('Draw never writes over a file’s own role or label: Title on keeps role="presentation" and its own aria-labelledby; off takes away only a reference that names exactly the title’s id; role="img" stays while an aria-label names the image', () => {
  const own = '<svg xmlns="http://www.w3.org/2000/svg" role="presentation" aria-labelledby="mine"><text id="mine">Logo</text></svg>';
  const on = once(own, (doc, apply) => planDrawingTitle(doc, 'Mine', apply));
  assert.equal(on, '<svg xmlns="http://www.w3.org/2000/svg" role="presentation" aria-labelledby="mine"><title id="drawing-title">Mine</title><text id="mine">Logo</text></svg>');
  const off = once(on, (doc, apply) => planDrawingTitle(doc, null, apply));
  assert.equal(off, own, 'its own reference and role stay');
  const two = '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="t x"><title id="t">A</title></svg>';
  assert.equal(once(two, (doc, apply) => planDrawingTitle(doc, null, apply)), '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="t x"></svg>', 'a reference naming more than its id stays, and so does the role it may still name');
  const labelled = '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Logo" aria-labelledby="t"><title id="t">A</title></svg>';
  assert.equal(once(labelled, (doc, apply) => planDrawingTitle(doc, null, apply)), '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Logo"></svg>', 'the aria-label still names it');
  assert.equal(once('<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Logo"/>', (doc, apply) => planAria(doc, doc.root, 'aria-label', null, apply)), '<svg xmlns="http://www.w3.org/2000/svg"/>', 'its last name gone: role="img" goes too');
});

test('Language: the root’s lang (or its xml:lang where it has only that); empty takes it away; a value that isn’t a language tag is refused', () => {
  assert.equal(once(CREATE, (doc, apply) => planLang(doc, 'en', apply)), CREATE.replace('viewBox="0 0 100 100"', 'viewBox="0 0 100 100" lang="en"'));
  assert.equal(once('<svg xmlns="http://www.w3.org/2000/svg" xml:lang="fr"/>', (doc, apply) => planLang(doc, 'fr-CA', apply)), '<svg xmlns="http://www.w3.org/2000/svg" xml:lang="fr-CA"/>');
  assert.equal(once('<svg xmlns="http://www.w3.org/2000/svg" lang="de"/>', (doc, apply) => planLang(doc, '', apply)), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.deepEqual(accessOf(load('<svg xmlns="http://www.w3.org/2000/svg" xml:lang="fr"/>')).lang, { value: 'fr', attr: 'xml:lang' });
  for (const bad of ['english', 'e', 'en_US', 'en-', '1x']) {
    const doc = load(CREATE);
    assert.throws(() => new Session(doc).dispatch('t', (apply) => planLang(doc, bad, apply)), (e) => e instanceof TokenEditError && e.message === NOT_A_TAG, bad);
  }
  assert.equal(NOT_A_TAG, 'That isn’t a language tag, like en or fr-CA.');
});

test('an element’s Title is its first child: lab/access.svg’s first bar becomes <rect …><title>Jan: 40</title></rect>, SVG Lab’s spelling; a group’s goes before its first element, a text’s before its characters; off takes it away; its text is escaped', () => {
  const bar = (doc: Doc): NodeId => all(doc, 'rect')[0].id;
  const out = once(ACCESS, (doc, apply) => planElementTitle(doc, bar(doc), 'Jan: 40', apply));
  assert.equal(out, ACCESS.replace('<rect x="16" y="52" width="12" height="32" fill="#2a9d8f"/>', '<rect x="16" y="52" width="12" height="32" fill="#2a9d8f"><title>Jan: 40</title></rect>'));
  const titled = load(out);
  assert.equal(elementAccess(titled, bar(titled)).title?.text, 'Jan: 40');
  const g = once('<svg xmlns="http://www.w3.org/2000/svg">\n  <g>\n    <rect/>\n  </g>\n</svg>', (doc, apply) => planElementTitle(doc, all(doc, 'g')[0].id, 'A & B <c>', apply));
  assert.equal(g, '<svg xmlns="http://www.w3.org/2000/svg">\n  <g>\n    <title>A &amp; B &lt;c></title>\n    <rect/>\n  </g>\n</svg>');
  const t = once('<svg xmlns="http://www.w3.org/2000/svg"><text>Hi</text></svg>', (doc, apply) => planElementTitle(doc, all(doc, 'text')[0].id, 'Hello', apply));
  assert.equal(t, '<svg xmlns="http://www.w3.org/2000/svg"><text><title>Hello</title>Hi</text></svg>');
  assert.equal(once(out, (doc, apply) => planElementTitle(doc, bar(doc), null, apply)), ACCESS.replace('fill="#2a9d8f"/>', 'fill="#2a9d8f"></rect>'), 'off: the title goes (the emptied element keeps its end tag)');
});

test('Label, Role, Hidden and other ARIA: each attribute written and taken away; elementAccess reads them, and tabindex, back', () => {
  const src = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5" tabindex="0" aria-describedby="d"/></svg>';
  const circle = (doc: Doc) => all(doc, 'circle')[0].id;
  const labelled = once(src, (doc, apply) => planAria(doc, circle(doc), 'aria-label', 'Sun', apply));
  assert.equal(labelled, src.replace('aria-describedby="d"/>', 'aria-describedby="d" aria-label="Sun"/>'));
  assert.equal(once(src, (doc, apply) => planRole(doc, circle(doc), 'button', apply)), src.replace('/>', ' role="button"/>'));
  assert.equal(once(src, (doc, apply) => planAria(doc, circle(doc), 'aria-hidden', 'true', apply)), src.replace('/>', ' aria-hidden="true"/>'));
  assert.equal(once(src, (doc, apply) => planAria(doc, circle(doc), 'aria-describedby', null, apply)), src.replace(' aria-describedby="d"', ''));
  const doc = load(labelled.replace('/>', ' role="img" aria-hidden="true"/>'));
  assert.deepEqual(elementAccess(doc, circle(doc)), { title: null, label: 'Sun', role: 'img', hidden: true, aria: [{ name: 'aria-describedby', value: 'd' }], tabindex: '0' });
  assert.throws(() => planAria(load(src), 1, 'onclick', 'x', () => {}), TokenEditError);
});

test('Role takes only ARIA role tokens: WAI-ARIA 1.2’s and the graphics roles, in any case, with space-separated fallbacks; anything else is refused, naming the token', () => {
  const src = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
  const circle = (doc: Doc) => all(doc, 'circle')[0].id;
  for (const role of ['img', 'graphics-symbol', 'Button', 'switch checkbox', ' none ']) {
    assert.equal(roleError(role), null, role);
    assert.equal(once(src, (doc, apply) => planRole(doc, circle(doc), role, apply)), src.replace('/>', ` role="${role.trim()}"/>`), role);
  }
  for (const [role, token] of [['picture', 'picture'], ['img sparkly', 'sparkly'], ['roletype', 'roletype'], ['"><x', '"><x'], ['aria-hidden', 'aria-hidden']]) {
    assert.equal(roleError(role), notARole(token), role);
    assert.throws(() => planRole(load(src), circle(load(src)), role, () => {}), new TokenEditError(notARole(token)), role);
  }
  assert.equal(notARole('picture'), '“picture” isn’t an ARIA role.');
  assert.equal(ARIA_ROLES.size, 85, 'WAI-ARIA 1.2’s 82, and three graphics roles');
});
