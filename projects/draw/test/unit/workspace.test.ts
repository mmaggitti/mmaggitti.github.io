// The workspace: load order (the sample, an #import link, the most recent draft), every open through
// the importer, drafts bound to what is open (the autosave hears changes last), read-only drafts,
// deleting drafts, and exports that keep the file's bytes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { DraftStore, memoryJournal, memoryKV, type Journal, type KV } from '../../src/platform/drafts.ts';
import { encodeImport } from '../../src/platform/files.ts';
import { SAVE_DELAY_MS } from '../../src/autosave.ts';
import { READ_ONLY } from '../../src/editor.ts';
import { BLANK, Workspace } from '../../src/workspace.ts';
import { descendants, type ElementNode } from '../../../../engine/model/doc.ts';
import { importReport } from '../../../../engine/report/import-report.ts';
import { attributeRenders, elementRenders, urlAllowed } from '../../../../engine/policy/render-policy.ts';
import { corpus, corpusBytes, edit, fakeEditor, FakeTimers, lockTable, SAMPLE } from './fakes.ts';

const DAY = 86_400_000;
const utf8 = (s: string) => new TextEncoder().encode(s);

function rig(kv: KV = memoryKV(), locks = lockTable(), journal: Journal = memoryJournal()) {
  const timers = new FakeTimers();
  const editor = fakeEditor();
  const store = new DraftStore(kv, () => timers.now);
  const ws = new Workspace(editor, { store, lock: locks.lock, sample: SAMPLE, timers, now: () => timers.now, journal });
  const settle = async () => {
    timers.tick(SAVE_DELAY_MS);
    await ws.autosave.flush();
  };
  return { timers, editor, store, ws, locks, kv, journal, settle };
}

test('on load the sample opens at once, then the most recent draft reopens quietly', async () => {
  const kv = memoryKV();
  await new DraftStore(kv, () => 1).create('Older', corpus('tools/svgo-icon-single-line.svg'), 'older');
  await new DraftStore(kv, () => 2).create('Newest', corpus('tools/inkscape-plain-svg.svg'), 'newest');
  const { ws, editor } = rig(kv);
  void ws.openSample();
  assert.equal(editor.source(), SAMPLE, 'the sample is open before anything is read from storage');
  await ws.boot('', () => assert.fail('there is no fragment to clear'));
  assert.equal(editor.source(), corpus('tools/inkscape-plain-svg.svg'));
  assert.equal(ws.current.get()?.name, 'Newest');
  assert.equal(ws.autosave.draftId, 'newest');
  assert.equal(ws.panel.get(), null, 'a draft reopens without its report');

  const empty = rig();
  void empty.ws.openSample();
  await empty.ws.boot('', () => {});
  assert.equal(empty.editor.source(), SAMPLE, 'with no drafts, the sample stays');
  assert.equal(empty.ws.current.get()?.name, 'Sample');
  assert.equal(empty.ws.autosave.draftId, null, 'and it is not a draft until it changes');
});

test('an #import link opens with its report, and becomes a draft on its first change; the fragment is cleared first, so a reload never imports it again', async () => {
  const kv = memoryKV();
  const { ws, editor, store, settle } = rig(kv);
  const file = corpus('lab/spin--js.svg');
  const cleared: string[] = [];
  void ws.openSample();
  await ws.boot('#' + (await encodeImport(file)), () => cleared.push('cleared'));
  assert.deepEqual(cleared, ['cleared']);
  assert.equal(editor.source(), file);
  assert.equal(ws.panel.get(), 'report', 'its import report shows');
  assert.ok(ws.current.get()!.report.totals.preview > 0);
  await settle();
  assert.deepEqual(await store.list(), [], 'a link only looked at is not stored (it is still in the link)');

  // The reload: no fragment, and no draft, so the sample opens; nothing is imported again.
  const looked = rig(kv);
  void looked.ws.openSample();
  await looked.ws.boot('', () => assert.fail('nothing to clear'));
  assert.equal(looked.editor.source(), SAMPLE);

  // An edit makes it a draft, which a reload reopens.
  edit(editor, 'circle', '<circle r="3"/>');
  await settle();
  const drafts = await store.list();
  assert.deepEqual(drafts.map((d) => d.name), ['Linked drawing']);
  const again = rig(kv);
  void again.ws.openSample();
  await again.ws.boot('', () => assert.fail('nothing to clear'));
  assert.equal(again.editor.source(), editor.source());
  assert.equal((await again.store.list()).length, 1);
});

test('a link that arrives while Draw is open waits for Open: nothing opens or is stored before, Not now keeps the drawing, and a newer link replaces the offer', async () => {
  const { ws, editor, store, settle } = rig();
  await ws.openText(corpus('tools/inkscape-plain-svg.svg'), 'mine.svg', 'file');
  const mine = editor.source();
  let cleared = 0;
  // A page that opened this tab can set its fragment again and again: each is only an offer.
  for (const rel of ['tools/svgo-icon-single-line.svg', 'lab/spin--js.svg']) {
    assert.equal(ws.offerLink('#' + (await encodeImport(corpus(rel))), () => cleared++), true);
  }
  assert.equal(cleared, 2, 'each fragment is cleared at once');
  assert.equal(ws.panel.get(), 'link');
  assert.equal(editor.source(), mine, 'nothing opened without a tap');
  await settle();
  assert.equal((await store.list()).length, 1, 'and nothing was stored');
  ws.close();
  assert.equal(ws.offer.get(), null);
  assert.equal(await ws.acceptLink(), false, 'Not now: the offer is gone');
  assert.equal(editor.source(), mine);

  assert.equal(ws.offerLink('#' + (await encodeImport(corpus('lab/spin--js.svg'))), () => {}), true);
  assert.equal(await ws.acceptLink(), true, 'Open');
  assert.equal(editor.source(), corpus('lab/spin--js.svg'));
  assert.equal(ws.panel.get(), 'report');
  assert.equal(ws.offerLink('#open=designs/x', () => assert.fail('not an import link: left alone')), false);
});

test('a broken #import link says so, is cleared, and the most recent draft opens instead', async () => {
  const kv = memoryKV();
  await new DraftStore(kv).create('Mine', corpus('tools/inkscape-plain-svg.svg'), 'mine');
  const { ws, editor } = rig(kv);
  let cleared = 0;
  void ws.openSample();
  await ws.boot('#import=AAAA', () => cleared++);
  assert.equal(cleared, 1);
  assert.match(ws.failure.get()?.message ?? '', /could not be read/);
  assert.equal(ws.panel.get(), 'report');
  assert.equal(editor.source(), corpus('tools/inkscape-plain-svg.svg'));
});

test('every way in goes through the importer; one that fails keeps the open drawing, and the next success clears the failure', async () => {
  const { ws, editor, store } = rig();
  void ws.openSample();
  assert.equal(await ws.openText('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>', '', 'paste'), false);
  const f = ws.failure.get()!;
  assert.equal(f.line, 1);
  assert.equal(ws.panel.get(), 'report');
  assert.equal(editor.source(), SAMPLE, 'the drawing that was open stays');
  assert.deepEqual(await store.list(), [], 'and nothing became a draft');

  assert.ok(await ws.openBytes(new Uint8Array(gzipSync(corpusBytes('tools/inkscape-1x-layers.svg'))), 'poster.svgz', 'drop'));
  assert.equal(ws.failure.get(), null);
  assert.equal(ws.current.get()?.name, 'poster');
  assert.equal(editor.source(), corpus('tools/inkscape-1x-layers.svg'));
  assert.deepEqual((await store.list()).map((d) => d.name), ['poster']);

  assert.ok(await ws.newDrawing());
  assert.equal(editor.source(), BLANK);
  assert.equal(ws.panel.get(), null, 'New shows no report');
  assert.equal((await store.list()).length, 1, 'New is not a draft until it changes');
});

test('a paste opens like any file: through the importer, with its report, kept whole, and nothing active in it renders', async () => {
  const { ws, editor } = rig();
  void ws.openSample();
  const pasted = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">\n' +
    '<script>alert(2)</script>\n<a xlink:href="javascript:alert(3)"><rect width="9" height="9" onclick="alert(4)"/></a>\n' +
    '<image href="https://example.com/x.png" width="1" height="1"/>\n<foreignObject width="9" height="9"><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://example.com/"/></foreignObject>\n</svg>\n';
  assert.ok(await ws.openText(pasted, '', 'paste'));
  assert.equal(editor.source(), pasted, 'nothing is cut out of the file: it is kept byte for byte');
  assert.equal(ws.panel.get(), 'report', 'its report shows');
  const report = ws.current.get()!.report;
  assert.deepEqual(report, importReport(editor.doc!), 'the report is the importer\'s, as for a file');
  assert.ok(report.items.some((i) => i.bucket === 'preview' && i.name === 'script'), 'the script is listed as preview-only');
  // What the canvas may draw of it (the render policy; the sink also asks DOMPurify): none of the active parts.
  const refused: string[] = [];
  for (const n of descendants(editor.doc!, editor.doc!.root)) {
    if (n.kind !== 'element') continue;
    const e = n as ElementNode;
    if (!elementRenders(e.ns, e.local, e.local === 'iframe')) refused.push(e.local);
    for (const a of e.attrs) if (!/^xmlns(:|$)/.test(a.qname) && !attributeRenders(e.ns, e.local, a.ns, a.local)) refused.push(a.qname);
  }
  assert.deepEqual(refused.sort(), ['iframe', 'onclick', 'onload', 'script', 'src', 'xlink:href'], 'what is refused is exactly the active part (a link on <a> never renders)');
  assert.equal(urlAllowed('a', 'href', 'javascript:alert(3)'), false);
  assert.equal(urlAllowed('image', 'href', 'https://example.com/x.png'), false);
});

test('the autosave hears a change last, after the stores; only for the document it is bound to', async () => {
  const { ws, editor, store, settle } = rig();
  await ws.openText(corpus('tools/inkscape-plain-svg.svg'), 'plain.svg', 'file');
  const id = ws.autosave.draftId!;
  const order: string[] = [];
  editor.version.subscribe(() => order.push('stores'));
  editor.onChange(() => order.push(`after (${ws.autosave.state.get().kind})`));
  edit(editor, 'circle', '<circle r="5"/>');
  assert.deepEqual(order.slice(0, 2), ['stores', 'after (pending)'], 'the autosave already scheduled when later listeners hear it');
  await settle();
  assert.equal((await store.load(id))!.text, editor.source());

  // A document opened some other way (the e2e's drawTest.render) is not saved over the draft.
  editor.open(SAMPLE);
  edit(editor, 'circle', '<circle r="1"/>');
  assert.equal(ws.autosave.state.get().kind, 'saved', 'a change to a document the autosave is not bound to is not heard');
  await settle();
  assert.notEqual((await store.load(id))!.text, editor.source());
  assert.equal((await store.list()).length, 1);
});

test('a change still waiting when another document opens is saved to its own draft, as it was', async () => {
  const { ws, editor, store, settle } = rig();
  await ws.openText(corpus('tools/inkscape-plain-svg.svg'), 'first.svg', 'file');
  const first = ws.autosave.draftId!;
  edit(editor, 'circle', '<circle r="7"/>');
  const edited = editor.source();
  await ws.openText(corpus('tools/svgo-icon-single-line.svg'), 'second.svg', 'file'); // within the debounce
  await settle();
  assert.equal((await store.load(first))!.text, edited, "the first draft holds its own last change, not the second file");
  assert.equal((await store.load(ws.autosave.draftId!))!.text, corpus('tools/svgo-icon-single-line.svg'));
});

test('a draft another tab has open reopens read-only here, and every edit is refused with a notice', async () => {
  const kv = memoryKV();
  const locks = lockTable();
  await new DraftStore(kv).create('Theirs', corpus('tools/inkscape-plain-svg.svg'), 'theirs');
  locks.other.add('theirs');
  const { ws, editor, store, settle } = rig(kv, locks);
  void ws.openSample();
  await ws.boot('', () => {});
  assert.equal(editor.source(), corpus('tools/inkscape-plain-svg.svg'));
  assert.equal(ws.autosave.state.get().kind, 'read-only');
  assert.equal(editor.readOnly.get(), true);
  const before = editor.source();
  const circle = [...editor.doc!.nodes.values()].find((n) => n.kind === 'element' && n.local === 'circle')!;
  assert.equal(editor.applySource(circle.id, '<circle/>')?.message, READ_ONLY);
  editor.select([circle.id]);
  editor.openSource();
  assert.equal(editor.sheet.get(), null, 'Edit source does not open');
  assert.equal(editor.notice.get(), READ_ONLY, 'and the notice says why');
  assert.equal(editor.source(), before, 'nothing changed');
  await settle();
  assert.equal((await store.load('theirs'))!.text, before);
  // Opening something else here makes a new draft this tab owns: editable again.
  await ws.newDrawing();
  assert.equal(editor.readOnly.get(), false);
});

test('the Files menu lists drafts with reminders; delete refuses the open one and one another tab holds', async () => {
  const kv = memoryKV();
  const locks = lockTable();
  const { ws, timers } = rig(kv, locks);
  await ws.openText(corpus('tools/inkscape-plain-svg.svg'), 'a.svg', 'file');
  const a = ws.autosave.draftId!;
  timers.now += 1000;
  await ws.openText(corpus('tools/svgo-icon-single-line.svg'), 'b.svg', 'file');
  const b = ws.autosave.draftId!;
  timers.now += 6 * DAY;
  ws.show('files');
  await ws.refreshDrafts();
  const rows = ws.drafts.get()!;
  assert.deepEqual(rows.map((r) => [r.name, r.open, r.reminder]), [['b', true, 'Never exported for 6 days'], ['a', false, 'Never exported for 6 days']]);
  assert.equal(await ws.deleteDraft(b), false, 'the open draft is not deleted from the menu');
  locks.other.add(a);
  assert.equal(await ws.deleteDraft(a), false, 'nor one another tab has open');
  locks.other.delete(a);
  assert.equal(await ws.deleteDraft(a), true);
  assert.deepEqual(ws.drafts.get()!.map((r) => r.name), ['b']);
});

test('export: as-is is the file byte for byte (Latin-1, a BOM, CRLF), clean drops editor data, and an export marks the draft', async () => {
  const { ws, store, timers, editor } = rig();
  for (const rel of ['tools/edge-utf8-bom.svg', 'tools/edge-crlf-line-endings.svg', 'tools/illustrator-cs6-entities-pgf.svg']) {
    await ws.openBytes(corpusBytes(rel), rel, 'file');
    assert.deepEqual(ws.exportFile('as-is')!.bytes, corpusBytes(rel), `${rel}: as-is is byte-identical`);
    assert.deepEqual(ws.exportFile('working')!.bytes, corpusBytes(rel), `${rel}: Save to Files is the as-is file in P0`);
  }
  // é, and 0x80: € in windows-1252, which is how browsers read a file that says ISO-8859-1.
  const latin = new Uint8Array([...utf8('<?xml version="1.0" encoding="ISO-8859-1"?>\r\n<svg xmlns="http://www.w3.org/2000/svg"><text>Caf'), 0xe9, 0x20, 0x80, ...utf8('</text></svg>')]);
  await ws.openBytes(latin, 'menu.svg', 'file');
  const asIs = ws.exportFile('as-is')!;
  assert.deepEqual(asIs.bytes, latin, 'a Latin-1 file exports in Latin-1, byte for byte');
  assert.equal(asIs.fileName, 'menu.svg');

  // UTF-16 in either byte order, declared or not: written back as it was read (SEC-S4).
  const utf16 = (text: string, le: boolean) => {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) new DataView(out.buffer).setUint16(i * 2, text.charCodeAt(i), le);
    return out;
  };
  for (const [what, bytes] of [
    ['UTF-16LE, no declaration', utf16('\uFEFF<svg xmlns="http://www.w3.org/2000/svg"><text>✓</text></svg>', true)],
    ['UTF-16BE, declared "UTF-16"', utf16('\uFEFF<?xml version="1.0" encoding="UTF-16"?>\n<svg xmlns="http://www.w3.org/2000/svg"><text>✓</text></svg>', false)],
  ] as const) {
    await ws.openBytes(bytes, 'wide.svg', 'file');
    assert.deepEqual(ws.exportFile('as-is')!.bytes, bytes, `${what}: as-is is byte-identical`);
  }
  // A byte that wasn't valid UTF-8 can't be written back: the export can't be identical, and says so.
  await ws.openBytes(new Uint8Array([...utf8('<svg xmlns="http://www.w3.org/2000/svg"><text>Caf'), 0xe9, ...utf8('</text></svg>')]), 'bad.svg', 'file');
  assert.equal(ws.current.get()!.lossy, true);

  // After an edit, as-is is what the editor holds, not the file as it was opened.
  await ws.openBytes(corpusBytes('tools/inkscape-plain-svg.svg'), 'plain.svg', 'file');
  edit(editor, 'circle', '<circle r="7"/>');
  assert.equal(new TextDecoder().decode(ws.exportFile('as-is')!.bytes), editor.source());
  assert.notEqual(editor.source(), corpus('tools/inkscape-plain-svg.svg'));

  await ws.openBytes(corpusBytes('tools/inkscape-1x-layers.svg'), 'Poster: v2.svg', 'file');
  const clean = ws.exportFile('clean')!;
  assert.equal(clean.fileName, 'Poster- v2-clean.svg', 'a name iOS and Windows can save');
  assert.ok(clean.removed!.elements + clean.removed!.attributes > 0);
  assert.ok(!/inkscape:|sodipodi:/.test(new TextDecoder().decode(clean.bytes)));

  const id = ws.autosave.draftId!;
  timers.now += 6 * DAY;
  assert.equal((await store.list()).find((d) => d.id === id)!.remind, true);
  await ws.exported(clean, 'cancelled');
  assert.equal((await store.list()).find((d) => d.id === id)!.remind, true, 'a cancelled share is not an export');
  await ws.exported(clean, 'downloaded');
  assert.equal((await store.list()).find((d) => d.id === id)!.remind, false, 'a download resets the reminder');
  assert.equal(editor.notice.get(), 'Downloaded Poster- v2-clean.svg', 'and says so');
  await ws.exported(clean, 'shared');
  assert.equal(editor.notice.get(), 'Shared Poster- v2-clean.svg');
});

test("a record that isn't a draft never reaches the app: boot passes over it, opening it says so, and the Files menu offers only Delete", async () => {
  const kv = memoryKV();
  await new DraftStore(kv, () => 1).create('Mine', corpus('tools/inkscape-plain-svg.svg'), 'mine');
  // What any project on this origin can write into Draw's store, newer than every real draft.
  await kv.set('draft:evil', { id: 'evil', name: { x: 1 }, text: 42, created: 0, updated: 9e15, exported: null, versions: [] });
  await kv.set('draft:impostor', { id: 'mine', name: 'Mine', text: '<svg xmlns="http://www.w3.org/2000/svg"/>', created: 0, updated: 9e15, exported: null, versions: [] });
  const { ws, editor } = rig(kv);
  void ws.openSample();
  await ws.boot('', () => {});
  assert.equal(editor.source(), corpus('tools/inkscape-plain-svg.svg'), 'the newest readable draft reopens');
  assert.equal(ws.current.get()?.name, 'Mine');

  ws.show('files');
  await ws.refreshDrafts();
  const rows = ws.drafts.get()!;
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.unreadable]).sort(), [['evil', 'Unreadable draft', true], ['impostor', 'Unreadable draft', true], ['mine', 'Mine', false]]);
  assert.equal(await ws.openDraft('evil'), false);
  assert.match(editor.notice.get() ?? '', /^That draft can’t be read/);
  assert.equal(editor.source(), corpus('tools/inkscape-plain-svg.svg'), 'the open drawing stays');
  assert.equal(await ws.deleteDraft('impostor'), true);
  assert.equal(await ws.deleteDraft('evil'), true);
  assert.deepEqual(ws.drafts.get()!.map((r) => r.id), ['mine'], 'Delete removed each under its own key, and the draft an impostor named is still there');

  // Only unreadable records: the sample stays, and nothing throws.
  const only = memoryKV();
  await only.set('draft:evil', { id: 'evil', name: 7, text: '<svg/>', created: 0, updated: 1, exported: null, versions: [] });
  const r2 = rig(only);
  void r2.ws.openSample();
  await r2.ws.boot('', () => {});
  assert.equal(r2.editor.source(), SAMPLE);
  assert.equal(r2.editor.notice.get(), null, 'and load does not try to open it (it is listed in Files, to delete)');
});

test('a failed save stays loud while another draft is open, and reopening its draft brings the unsaved edit back', async () => {
  let full = false;
  const base = memoryKV();
  const kv: KV = { ...base, set: async (k, v) => { if (full) throw new DOMException('full', 'QuotaExceededError'); await base.set(k, v); } };
  const { ws, editor, store, settle } = rig(kv);
  await ws.openText(corpus('tools/inkscape-plain-svg.svg'), 'a.svg', 'file');
  const a = ws.autosave.draftId!;
  await ws.openText(corpus('tools/svgo-icon-single-line.svg'), 'other.svg', 'file');
  const other = ws.autosave.draftId!;
  await ws.openDraft(a);
  full = true;
  edit(editor, 'circle', '<circle r="7"/>');
  const edited = editor.source();
  await settle();
  assert.equal(ws.autosave.state.get().kind, 'failed');
  await ws.openDraft(other);
  const s = ws.autosave.state.get();
  assert.ok(s.kind === 'failed' && s.name === 'a' && !s.open, `the alert stays, and says which drawing: ${JSON.stringify(s)}`);
  assert.equal(await ws.deleteDraft(a), false, "a draft with unsaved changes can't be deleted");
  await ws.openDraft(a);
  assert.equal(editor.source(), edited, 'reopening it brings the unsaved edit back, not the stored text');
  assert.equal(editor.readOnly.get(), false);
  full = false;
  await settle();
  assert.equal((await store.load(a))!.text, edited);
  assert.equal(ws.autosave.state.get().kind, 'saved');
});

test('an unload journal whose save never landed is replayed into its draft on the next load, then cleared', async () => {
  const kv = memoryKV();
  await new DraftStore(kv, () => 100).create('Logo', '<svg xmlns="http://www.w3.org/2000/svg" id="old"/>', 'logo');
  const journal = memoryJournal();
  journal.write({ id: 'logo', name: 'Logo', text: '<svg xmlns="http://www.w3.org/2000/svg" id="new"/>', at: 200 });
  const { ws, editor, store } = rig(kv, lockTable(), journal);
  void ws.openSample();
  await ws.boot('', () => {});
  assert.equal(editor.source(), '<svg xmlns="http://www.w3.org/2000/svg" id="new"/>', 'the reopened draft has the change');
  const d = (await store.load('logo'))!;
  assert.equal(d.versions.length, 2, 'as a new version: the one before is kept');
  assert.equal(journal.read(), null);
});

test('a journal older than its draft, or for a drawing that was not a draft, or held by another tab', async () => {
  // Older than the stored draft: ignored, and cleared.
  const kv = memoryKV();
  await new DraftStore(kv, () => 300).create('Logo', '<svg xmlns="http://www.w3.org/2000/svg" id="stored"/>', 'logo');
  const older = memoryJournal();
  older.write({ id: 'logo', name: 'Logo', text: '<svg xmlns="http://www.w3.org/2000/svg" id="stale"/>', at: 200 });
  const a = rig(kv, lockTable(), older);
  void a.ws.openSample();
  await a.ws.boot('', () => {});
  assert.equal(a.editor.source(), '<svg xmlns="http://www.w3.org/2000/svg" id="stored"/>');
  assert.equal((await a.store.load('logo'))!.versions.length, 1);
  assert.equal(older.read(), null);

  // Not a draft yet (the sample edited, then the page went away): it becomes one.
  const fresh = memoryJournal();
  fresh.write({ id: '', name: 'Sample', text: '<svg xmlns="http://www.w3.org/2000/svg" id="edited"/>', at: 5 });
  const b = rig(memoryKV(), lockTable(), fresh);
  void b.ws.openSample();
  await b.ws.boot('', () => {});
  assert.equal(b.editor.source(), '<svg xmlns="http://www.w3.org/2000/svg" id="edited"/>');
  assert.equal((await b.store.list()).length, 1);
  assert.equal(fresh.read(), null);

  // Another tab holds that draft: the journal waits for a later load.
  const kv2 = memoryKV();
  await new DraftStore(kv2, () => 1).create('Logo', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'logo');
  const locks = lockTable();
  locks.held.add('logo');
  const waiting = memoryJournal();
  waiting.write({ id: 'logo', name: 'Logo', text: '<svg xmlns="http://www.w3.org/2000/svg" id="later"/>', at: 9 });
  const c = rig(kv2, locks, waiting);
  void c.ws.openSample();
  await c.ws.boot('', () => {});
  assert.notEqual(waiting.read(), null, 'kept for the next load');
  assert.equal((await c.store.load('logo'))!.versions.length, 1);
});

test("a journal entry that isn't one (another script on the origin) is ignored", async () => {
  for (const raw of [{ id: 7, name: 'x', text: '<svg/>', at: 1 }, { id: 'a', name: 'x', text: 42, at: 1 }, { id: 'a', name: 'x', text: '<svg/>', at: Infinity }, 'junk', null]) {
    const journal = memoryJournal();
    journal.raw = raw;
    const { ws, editor, store } = rig(memoryKV(), lockTable(), journal);
    void ws.openSample();
    await ws.boot('', () => {});
    assert.equal(editor.source(), SAMPLE, `nothing replayed for ${JSON.stringify(raw)}`);
    assert.deepEqual(await store.list(), []);
  }
});
