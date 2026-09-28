// Keyed patching, checked in a real browser: after each model edit and patch, the patched canvas
// must equal a fresh render of the same model (the same DOM, the same stats, and a drawn copy of
// exactly the same NodeIds, each inside the host). Moves, reorders and deletes; an id change that
// retargets an animation; a subtree moved into a foreignObject. And a render that throws keeps the
// previous drawing. P0-M3 adds the camera (the view as the root's viewBox), an attribute put back
// in the middle of the list (an undo), a value edit that must be exactly one attribute mutation
// (a scrub frame), and the hit test's way back from a drawn node to its NodeId. The real Renderer
// is bundled from source (test/harness/entry.ts) and driven directly.
//
// Run by test/e2e.mjs on the /draw/ page (Chromium here, WebKit in CI), or alone, quickly:
//   node test/renderer-patch.mjs

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DRAW = join(dirname(fileURLToPath(import.meta.url)), '..');

async function bundle() {
  const { build } = await import(pathToFileURL(join(DRAW, 'node_modules/vite/dist/node/index.js')).href);
  const out = await build({
    configFile: false, root: DRAW, logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: join(DRAW, 'test/harness/entry.ts'), formats: ['iife'], name: 'drawHarness', fileName: 'harness' } },
  });
  return (Array.isArray(out) ? out[0] : out).output[0].code;
}

export default async function rendererPatch({ browser, origin }) {
  const code = await bundle();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    if (origin) await page.goto(`${origin}/draw/`, { waitUntil: 'networkidle' });
    await page.evaluate(code);
    const results = await page.evaluate(cases);
    const failed = results.filter((r) => r.problems.length);
    if (failed.length) {
      throw new Error(`keyed patching differs from a fresh render in ${failed.length} of ${results.length} case(s):\n${failed.map((r) => `${r.label}\n    ${r.problems.join('\n    ')}`).join('\n')}`);
    }
  } finally {
    await context.close();
  }
}

// Runs in the page.
function cases() {
  const { attrSnapshot, el, parseDoc, setAttr, removeAttr, restoreAttr, Renderer, sinkReady } = window.drawHarness;
  const SVG = 'http://www.w3.org/2000/svg';
  const host = () => {
    const div = document.createElement('div');
    div.style.cssText = 'width:400px;height:300px';
    document.body.append(div);
    return div.attachShadow({ mode: 'open' });
  };
  const results = [];
  if (!sinkReady()) return [{ label: 'setup', problems: ['the sink is not ready'] }];

  const check = (label, r, root, doc, camera = null) => {
    const freshRoot = host();
    const fresh = new Renderer(freshRoot);
    fresh.setCamera(camera);
    fresh.render(doc);
    const problems = [];
    if (root.innerHTML !== freshRoot.innerHTML) problems.push(`DOM differs:\n      patched ${root.innerHTML.slice(0, 300)}\n      fresh   ${freshRoot.innerHTML.slice(0, 300)}`);
    const [a, b] = [JSON.stringify(r.stats()), JSON.stringify(fresh.stats())];
    if (a !== b) problems.push(`stats ${a}, fresh ${b}`);
    for (const id of doc.nodes.keys()) {
      const p = r.nodeFor(id), f = fresh.nodeFor(id);
      if (!!p !== !!f) problems.push(`nodeFor(${id}) is ${p ? 'drawn' : 'missing'}, fresh ${f ? 'drawn' : 'missing'}`);
      if (p && !root.contains(p)) problems.push(`nodeFor(${id}) is not on the canvas`);
    }
    freshRoot.host.remove();
    results.push({ label, problems });
  };
  const setup = (text) => {
    const parsed = parseDoc(text);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const root = host();
    const r = new Renderer(root);
    r.render(parsed.doc);
    return { r, root, doc: parsed.doc };
  };
  const byId = (doc, id) => [...doc.nodes.values()].find((n) => n.kind === 'element' && n.attrs.some((a) => a.local === 'id' && a.raw === id));
  // Model moves, as M3's commands will make them.
  const detach = (doc, node) => {
    const p = el(doc, node.parent);
    p.children = p.children.filter((c) => c !== node.id);
    p.childrenDirty = true;
    node.parent = null;
    doc.version++;
  };
  const attach = (doc, node, parentId, index) => {
    const p = el(doc, parentId);
    p.children.splice(index, 0, node.id);
    p.childrenDirty = true;
    node.parent = parentId;
    doc.version++;
  };
  const move = (doc, node, parentId, index) => {
    detach(doc, node);
    attach(doc, node, parentId, index);
  };
  const TEXT = `<svg xmlns="${SVG}" viewBox="0 0 100 100"><g id="A"><rect id="r1" width="5" height="5"/><circle id="c1" r="3"/></g><g id="B"><text id="t">hi</text></g><style id="s">rect { fill: red }</style></svg>`;

  {
    const { r, root, doc } = setup(TEXT);
    const n = byId(doc, 'r1');
    const before = r.nodeFor(n.id);
    setAttr(doc, n.id, null, 'fill', 'blue');
    r.patchAttributes(n.id);
    check('an attribute edit', r, root, doc);
    if (r.nodeFor(n.id) !== before) results.push({ label: 'an attribute edit keeps the element', problems: ['a new element was made'] });
  }
  {
    const { r, root, doc } = setup(TEXT);
    const n = byId(doc, 'r1');
    setAttr(doc, n.id, null, 'requiredExtensions', 'http://example.com/ext');
    r.patchAttributes(n.id);
    check('an edit that makes an element refused', r, root, doc);
    removeAttr(doc, n.id, null, 'requiredExtensions');
    r.patchAttributes(n.id);
    check('...and back', r, root, doc);
  }
  {
    const { r, root, doc } = setup(TEXT);
    const g = byId(doc, 'A');
    detach(doc, g);
    r.patchSubtree(g.id);
    check('delete a subtree', r, root, doc);
    attach(doc, g, doc.root, 0);
    r.patchSubtree(g.id);
    check('...and undo', r, root, doc);
  }
  const moves = [
    ['move into another parent, patch the node', (doc, n, A, B) => [n]],
    ['move into another parent, patch the new parent only', (doc, n, A, B) => [B]],
    ['move into another parent, patch the old parent then the new', (doc, n, A, B) => [A, B]],
    ['move into another parent, patch the new parent then the old', (doc, n, A, B) => [B, A]],
    ['move into another parent, patch the node, later the old parent', (doc, n, A, B) => [n, A]],
  ];
  for (const [label, patches] of moves) {
    const { r, root, doc } = setup(TEXT);
    const n = byId(doc, 'r1'), A = byId(doc, 'A'), B = byId(doc, 'B');
    move(doc, n, B.id, 1);
    for (const p of patches(doc, n, A, B)) r.patchSubtree(p.id);
    check(label, r, root, doc);
  }
  for (const [label, target] of [['reorder, patch the node', 'c1'], ['reorder, patch the parent', 'A']]) {
    const { r, root, doc } = setup(TEXT);
    move(doc, byId(doc, 'c1'), byId(doc, 'A').id, 0);
    r.patchSubtree(byId(doc, target).id);
    check(label, r, root, doc);
  }
  {
    const { r, root, doc } = setup(TEXT.replace('<rect id="r1"', '<rect id="r1" requiredExtensions="http://example.com/ext"'));
    const n = byId(doc, 'r1'), B = byId(doc, 'B');
    move(doc, n, B.id, 0);
    r.patchSubtree(B.id);
    check('a refused element moves: patch the new parent only', r, root, doc);
  }
  {
    const { r, root, doc } = setup(`<svg xmlns="${SVG}" viewBox="0 0 100 100"><foreignObject id="fo" width="50" height="50"/><g id="g"><p xmlns="http://www.w3.org/1999/xhtml">hi</p></g></svg>`);
    const g = byId(doc, 'g');
    move(doc, g, byId(doc, 'fo').id, 0);
    r.patchSubtree(g.id);
    check('a subtree moves into a foreignObject', r, root, doc);
  }
  {
    const { r, root, doc } = setup(TEXT);
    const t = byId(doc, 't');
    const leaf = doc.nodes.get(t.children[0]);
    leaf.raw = 'bye &amp; so long';
    leaf.dirty = true;
    doc.version++;
    r.patchSubtree(leaf.id);
    check('a text edit', r, root, doc);
  }
  {
    const { r, root, doc } = setup(TEXT);
    setAttr(doc, doc.root, null, 'viewBox', '0 0 50 50');
    r.patchAttributes(doc.root);
    check('a root attribute edit', r, root, doc);
  }
  {
    const { r, root, doc } = setup(TEXT);
    const id = 1e9;
    doc.nodes.set(id, { kind: 'element', id, parent: null, qname: 'ellipse', prefix: null, local: 'ellipse', ns: SVG, attrs: [], children: [], selfClosing: true, tail: '', endTail: '', src: null, tagDirty: true, childrenDirty: false });
    attach(doc, doc.nodes.get(id), byId(doc, 'A').id, 1);
    r.patchSubtree(id);
    check('an insert', r, root, doc);
  }
  // Ids: an animation's href target follows them, so changing one re-judges it.
  const ANIM = `<svg xmlns="${SVG}" viewBox="0 0 100 100"><rect id="a" width="5" height="5"/><circle id="b" r="3"/><animate href="#a" attributeName="width" values="5;9" dur="1s"/></svg>`;
  {
    const { r, root, doc } = setup(ANIM);
    const rect = byId(doc, 'a'), circle = byId(doc, 'b');
    setAttr(doc, rect.id, null, 'id', 'x');
    r.patchAttributes(rect.id);
    setAttr(doc, circle.id, null, 'id', 'a');
    r.patchAttributes(circle.id);
    check('ids renamed so an animation now targets a circle', r, root, doc);
  }
  {
    const { r, root, doc } = setup(ANIM.replace('id="a"', 'id="z"'));
    const rect = byId(doc, 'z');
    setAttr(doc, rect.id, null, 'id', 'a');
    r.patchAttributes(rect.id);
    check('an id created for an animation that named nothing', r, root, doc);
  }
  {
    const { r, root, doc } = setup(ANIM);
    const rect = byId(doc, 'a');
    detach(doc, rect);
    r.patchSubtree(rect.id);
    check("an animation's target deleted", r, root, doc);
  }
  // P0-M3: the camera is the root's viewBox, through the sink; the file's own comes back without it.
  const CAM = { x: -10.5, y: 4, width: 40, height: 30 };
  for (const [label, text] of [['a camera on a root with a viewBox', TEXT], ['a camera on a root with only a size', TEXT.replace('viewBox="0 0 100 100"', 'width="100" height="100"')]]) {
    const { r, root, doc } = setup(text);
    r.setCamera(CAM);
    check(label, r, root, doc, CAM);
    const svg = root.querySelector('svg');
    if (svg.getAttribute('viewBox') !== '-10.5 4 40 30') results.push({ label: `${label}: the viewBox`, problems: [`is ${svg.getAttribute('viewBox')}`] });
    setAttr(doc, doc.root, null, 'data-x', '1');
    r.patchAttributes(doc.root);
    check(`${label}, then a root attribute edit`, r, root, doc, CAM);
    r.setCamera(null);
    check(`${label}, then no camera`, r, root, doc);
  }
  {
    // An undo puts an attribute back where it was, in the middle: the canvas matches a fresh render.
    const { r, root, doc } = setup(TEXT);
    const n = byId(doc, 'r1');
    const snap = attrSnapshot(doc, n.id, null, 'width');
    removeAttr(doc, n.id, null, 'width');
    r.patchAttributes(n.id);
    check('an attribute removed', r, root, doc);
    restoreAttr(doc, n.id, null, 'width', snap);
    r.patchAttributes(n.id);
    check('...and put back in the middle', r, root, doc);
  }
  {
    // A value edit (a scrub frame) is one attribute mutation on the canvas, and nothing else.
    const { r, root, doc } = setup(TEXT);
    const n = byId(doc, 'r1');
    const records = [];
    const mo = new MutationObserver((m) => records.push(...m));
    mo.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
    for (const w of ['6', '7', '8']) {
      setAttr(doc, n.id, null, 'width', w);
      r.patchAttributes(n.id);
    }
    r.patchAttributes(n.id); // nothing changed
    records.push(...mo.takeRecords());
    mo.disconnect();
    const problems = records.length === 3 && records.every((m) => m.type === 'attributes' && m.attributeName === 'width') ? [] : [`${records.length} mutation(s): ${records.map((m) => `${m.type} ${m.attributeName ?? ''}`).join(', ')}`];
    results.push({ label: 'a value edit is one attribute mutation', problems });
    check('...and equals a fresh render', r, root, doc);
  }
  {
    // The hit test's way back: every drawn node maps to its NodeId; a replaced one no longer does.
    const { r, root, doc } = setup(TEXT);
    const problems = [];
    for (const id of doc.nodes.keys()) {
      const dom = r.nodeFor(id);
      if (dom && r.idFor(dom) !== id) problems.push(`idFor(nodeFor(${id})) is ${r.idFor(dom)}`);
    }
    const g = byId(doc, 'A');
    const old = r.nodeFor(g.id);
    r.patchSubtree(g.id);
    if (r.idFor(old) !== undefined) problems.push('a node taken off the canvas still maps to its NodeId');
    if (r.idFor(root.host) !== undefined || r.idFor(null) !== undefined) problems.push('something not drawn maps to a NodeId');
    results.push({ label: 'idFor maps drawn nodes back to their NodeIds', problems });
  }
  // A render that throws leaves the drawing as it was (here: a model missing a child).
  {
    const { r, root, doc } = setup(TEXT);
    const before = root.innerHTML, stats = JSON.stringify(r.stats());
    const bad = parseDoc(TEXT);
    const g = bad.doc.nodes.get(bad.doc.root);
    g.children = [...g.children, 424242];
    let threw = false;
    try {
      r.render(bad.doc);
    } catch {
      threw = true;
    }
    const problems = [];
    if (!threw) problems.push('test setup: the broken model rendered');
    if (root.innerHTML !== before) problems.push('the previous drawing is gone');
    if (JSON.stringify(r.stats()) !== stats) problems.push(`stats ${JSON.stringify(r.stats())}, before ${stats}`);
    results.push({ label: 'a render that throws keeps the previous drawing', problems });
    check('...and patching the previous document still works', r, root, doc);
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    await rendererPatch({ browser });
    console.log('ok renderer-patch');
  } finally {
    await browser.close();
  }
}
