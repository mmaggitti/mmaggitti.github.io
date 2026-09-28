#!/usr/bin/env node
// Deliberate breaks: every guard in Draw's pipeline must be able to fail. Each break edits one
// file, runs the check that should catch it, requires a non-zero exit, and restores the file
// (in `finally`, so an interrupted run never leaves a break behind; `git diff` should be empty
// afterwards).
//
//   node tools/prove-breaks.mjs           every break (the e2e ones rebuild the site: slow)
//   node tools/prove-breaks.mjs --quick   only the breaks caught without a site build
//   node tools/prove-breaks.mjs B3 B5     just these
//
// Add a break whenever a milestone adds a check. The plan's rule: a check nobody has seen fail
// isn't a check.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DRAW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(DRAW, '..', '..');
// The whole site is built and every page smoke-tested, but only Draw's e2e runs (E2E=draw): the
// other projects' e2e can't see a break in Draw, and svg-lab's alone takes about two minutes.
const SITE_E2E = ['sh', ['-c', 'node scripts/build-site.mjs >/dev/null && node scripts/check-library.mjs --site _site && E2E=draw node scripts/smoke-test.mjs'], REPO];
const engineTests = (file) => ['node', ['--test', '--test-reporter=spec', `../../engine/test/${file}`], DRAW];
const XML_TESTS = engineTests('xml.test.ts');
const LEDGER_CHECK = ['node', ['tools/ledger-check.mjs'], DRAW];
// A cited test's existence is proven by the evidence run: the unit tests, then ledger-check --evidence.
const EVIDENCE_CHECK = ['sh', ['-c', 'npm run --silent test:unit >/dev/null && node tools/ledger-check.mjs --evidence node_modules/.evidence.jsonl'], DRAW];
const POLICY_TESTS = engineTests('policy/render-policy.test.ts');
const CHECK_SINKS = ['node', ['tools/check-sinks.mjs'], DRAW];
// Keyed patching in Chromium, with the Renderer bundled from source: no site build needed.
const PATCH_TESTS = ['node', ['test/renderer-patch.mjs'], DRAW];
const drawTests = (file) => ['node', ['--test', '--test-reporter=spec', `test/unit/${file}`], DRAW];

const BREAKS = [
  {
    id: 'B1', what: 'the CSP plugin no longer injects the meta tag', slow: true,
    file: 'projects/draw/vite.config.ts', from: 'plugins: [react(), csp()]', to: 'plugins: [react()]',
    run: SITE_E2E, expect: /first element in <head>/,
  },
  {
    id: 'B2', what: 'an innerHTML sink appears in the app',
    file: 'projects/draw/src/panels/App.tsx', append: "\nexport const leak = (el: HTMLElement, s: string) => { el.innerHTML = s; };\n",
    run: ['node', ['tools/check-sinks.mjs'], DRAW], expect: /html-sink/,
  },
  {
    id: 'B3', what: 'a script-bearing .svg is put in the library',
    create: 'projects/draw/public/library/designs/planted.svg',
    content: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n',
    run: ['node', ['scripts/check-library.mjs'], REPO], expect: /svg-profile\/element:script/,
  },
  {
    id: 'B4', what: "the preview gains allow-same-origin",
    file: 'projects/draw/src/panels/App.tsx', append: "\nexport const SANDBOX = 'allow-scripts allow-same-origin';\n",
    run: ['node', ['tools/check-sinks.mjs'], DRAW], expect: /allow-same-origin/,
  },
  {
    id: 'B5', what: 'Draw loses its unlisted marker', slow: true,
    file: 'projects/draw/index.html', from: '<meta name="launcher" content="unlisted">', to: '',
    run: SITE_E2E, expect: /launcher lists Draw/,
  },
  {
    id: 'B6', what: 'the ledger and the served profile disagree on the version',
    file: 'engine/ledger/ledger.json', from: '"profileVersion": 2', to: '"profileVersion": 3',
    run: ['node', ['tools/ledger-check.mjs'], DRAW], expect: /profileVersion/,
  },
  {
    id: 'B7', what: 'the engine touches the DOM',
    create: 'engine/leak.ts', content: 'export const title = () => document.title;\n',
    run: ['node', ['tools/check-sinks.mjs'], DRAW], expect: /engine-dom/,
  },
  {
    id: 'B8', what: 'the engine imports an npm package',
    create: 'engine/leak.ts', content: "import x from 'left-pad';\nexport default x;\n",
    run: ['node', ['tools/check-sinks.mjs'], DRAW], expect: /engine-npm-import/,
  },
  {
    id: 'B9', what: 'a served .svg elsewhere on the site carries a handler', slow: true,
    file: 'projects/draw/public/icon.svg', from: '<svg xmlns="http://www.w3.org/2000/svg"', to: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"',
    run: SITE_E2E, expect: /event-handler/,
  },
  {
    id: 'B10', what: "the profile forgets the HTML comment breakout",
    file: 'scripts/lib/svg-profile.mjs', from: "else if (/^-?>|[<>]/.test(text.slice(i + 4, end))) add('comment-html-ambiguous', i);", to: '',
    run: ['npm', ['run', '--silent', 'test:unit'], DRAW], expect: /comment-html-ambiguous|comment breakout/,
  },
  {
    id: 'B11', what: 'a control drops under the 44pt floor', slow: true,
    file: 'projects/draw/src/panels/App.tsx', from: '<span className="draw-badge ds-small">preview</span>', to: '<span className="draw-badge ds-small">preview</span><button style={{ width: 20, height: 20 }}>x</button>',
    run: SITE_E2E, expect: /tap targets under 44pt/,
  },
  // P0-M1: the engine's round trip and limits.
  {
    id: 'B12', what: 'the serializer drops a byte from untouched subtrees',
    file: 'engine/model/doc.ts', from: 'doc.source.slice(n.src!.whole.start, n.src!.whole.end)', to: 'doc.source.slice(n.src!.whole.start, n.src!.whole.end - 1)',
    run: XML_TESTS, expect: /✖ every corpus file round-trips/,
  },
  {
    id: 'B13', what: 'an attribute edit re-spaces the whole start tag',
    file: 'engine/model/doc.ts', from: 's += `${a.lead}${a.qname}', to: 's += ` ${a.qname}',
    run: XML_TESTS, expect: /✖ one attribute edit changes exactly that attribute/,
  },
  {
    id: 'B14', what: 'entity expansion loses its size budget',
    file: 'engine/xml/entities.ts', from: 'if (budget.left < 0) throw', to: 'if (false) throw',
    run: XML_TESTS, expect: /✖ a wide, shallow expansion hits the size budget/,
  },
  {
    id: 'B15', what: 'entity expansion loses its depth limit',
    file: 'engine/xml/entities.ts', from: 'if (depth > ENTITY_DEPTH) throw', to: 'if (false) throw',
    run: XML_TESTS, expect: /✖ a deep chain of tiny entities hits the depth limit/,
  },
  {
    id: 'B16', what: 'the number formatter falls back to exponent notation',
    file: 'engine/values/number-format.ts', from: 'if (Math.abs(n) >= 1e21) return BigInt(n).toString();', to: '',
    run: engineTests('values/number-format.test.ts'), expect: /✖ fmt never writes -0 or an exponent/,
  },
  {
    id: 'B17', what: 'the path parser drops the text after an error',
    file: 'engine/path/parse.ts', from: "if ('message' in r) return { segs, tail: d.slice(pos), error: r };", to: "if ('message' in r) return { segs, tail: '', error: r };",
    run: engineTests('path/parse.test.ts'), expect: /✖ (fuzz: any string|parsing stops at the first error)/,
  },
  // P0-M2: the support ledger's gates.
  {
    id: 'B18', what: 'an active attribute is marked as rendered',
    file: 'engine/ledger/ledger.json', from: '"name":"ping","on":["a"],"group":"link","class":"active","render":false', to: '"name":"ping","on":["a"],"group":"link","class":"active","render":true',
    run: LEDGER_CHECK, expect: /attribute:ping: a active row is never rendered/,
  },
  {
    id: 'B19', what: 'a done row cites a test that does not exist',
    file: 'engine/ledger/ledger.json', from: '#limits: size, node count and depth fail cleanly"', to: '#limits: no such test"',
    run: EVIDENCE_CHECK, expect: /syntax:limits: cited test did not pass/,
  },
  {
    id: 'B20', what: 'a generated profile table is edited by hand',
    file: 'scripts/lib/svg-profile-tables.mjs', from: "'radialGradient', 'rect',", to: "'radialGradient', 'rect', 'script',",
    run: LEDGER_CHECK, expect: /svg-profile-tables\.mjs is out of date/,
  },
  {
    id: 'B21', what: 'an SVG element loses its ledger row',
    file: 'engine/ledger/ledger.json', from: '{"id":"element:rect","kind":"element","name":"rect","ns":"svg","group":"shape","class":"edit","render":true,"serve":true,"phase":1,"status":"planned","lesson":["grid","shapes"]},\n', to: '',
    run: LEDGER_CHECK, expect: /no row for the SVG element <rect>/,
  },
  {
    id: 'B22', what: 'the phase is raised before its rows are done',
    file: 'engine/ledger/ledger.json', from: '"currentPhase": 0', to: '"currentPhase": 1',
    run: LEDGER_CHECK, expect: /behind the current phase 1/,
  },
  {
    id: 'B23', what: 'the served profile stops refusing the ledger\'s active attributes',
    file: 'scripts/lib/svg-profile.mjs', from: "if (attr.ns == null && ACTIVE_ATTRIBUTES.has(attr.local)) { add('active-attribute', at); return; }", to: '',
    run: engineTests('ledger.test.ts'), expect: /✖ the served profile refuses every SVG element and attribute the ledger does not serve/,
  },
  // P0-M2: the safe sink, the renderer and the canvas (all caught by the site e2e).
  {
    id: 'B24', what: 'the sink stops asking DOMPurify', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: '!purify?.isValidAttribute(node.local, key, out)', to: '!purify',
    run: SITE_E2E, expect: /is the sink still asking DOMPurify/,
  },
  {
    id: 'B25', what: 'the sink materializes elements the policy refuses', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: ' || !elementRenders(node.ns, node.local, ctx.inForeignObject)) return null;', to: ') return null;',
    run: SITE_E2E, expect: /problem\(s\) on the canvas[\s\S]*(is on the canvas|not in the render tables)/,
  },
  {
    id: 'B26', what: 'the corpus check silently inspects nothing', slow: true,
    file: 'projects/draw/test/e2e.mjs', from: 'for (const { name, text } of files) {', to: 'for (const { name, text } of files.slice(0, 0)) {',
    run: SITE_E2E, expect: /the corpus check inspected 0 of \d+ files/,
  },
  {
    id: 'B27', what: 'reduced motion no longer pauses SMIL', slow: true,
    file: 'projects/draw/src/canvas/renderer.ts', from: '(dom as SVGSVGElement).pauseAnimations();', to: '(dom as SVGSVGElement).unpauseAnimations();',
    run: SITE_E2E, expect: /reduced motion "reduce": the canvas's SMIL animations are running/,
  },
  {
    id: 'B28', what: 'the sink stops checking what SMIL animates', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: 'return dropped === null || !smilOk(doc, node, el, ctx) ? null : { el, dropped };', to: 'return dropped === null ? null : { el, dropped };',
    run: SITE_E2E, expect: /the policy refuses part of set/,
  },
  {
    id: 'B29', what: 'the sink stops judging <style> text', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: 'const cssOk = (css: string) => cssAllowed(css) && cssUrlsLocal(css);', to: 'const cssOk = (_css: string) => true;',
    run: SITE_E2E, expect: /the policy refuses part of style|errors while rendering the corpus/,
  },
  {
    id: 'B30', what: "the rendered root takes the size its own CSS gives it", slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: ':host > svg { width: 100% !important; height: 100% !important;', to: ':host > svg {',
    run: SITE_E2E, expect: /doesn't fill the host|a root sized by its own CSS: the root is/,
  },
  {
    id: 'B31', what: "the canvas loses the containment that holds a document's CSS", slow: true,
    file: 'projects/draw/src/app.css', from: '  contain: strict;\n', to: '',
    run: SITE_E2E, expect: /put the drawing over the top bar/,
  },
  {
    id: 'B32', what: 'the sink falls back to an unsupported DOMPurify instead of failing closed',
    file: 'projects/draw/src/canvas/safe-sink.ts', from: 'const purify = load();', to: 'const purify = load() ?? DOMPurify;',
    run: ['node', ['--test', '--test-reporter=spec', 'test/unit/safe-sink.test.ts'], DRAW], expect: /✖ without DOMPurify the sink renders nothing/,
  },
  // P0-M2 review: the render policy's rules, each seen failing its own test.
  {
    id: 'B33', what: "the policy ignores an attribute scope's except list",
    file: 'engine/policy/render-policy.ts', from: 'if (!scope || scope.except?.includes(elLocal)) return false;', to: 'if (!scope) return false;',
    run: POLICY_TESTS, expect: /✖ every rendered attribute renders on the elements in its scope/,
  },
  {
    id: 'B34', what: 'XHTML renders outside foreignObject',
    file: 'engine/policy/render-policy.ts', from: 'return inForeignObject && RENDER_XHTML_ELEMENTS.has(local);', to: 'return RENDER_XHTML_ELEMENTS.has(local);',
    run: POLICY_TESTS, expect: /✖ elements render exactly as their ledger rows say/,
  },
  {
    id: 'B35', what: 'values are no longer checked for url()s that leave the document',
    file: 'engine/policy/render-policy.ts', from: 'return cssUrlsLocal(value) ? value : null;', to: 'return value;',
    run: POLICY_TESTS, expect: /✖ CSS: the served profile rule/,
  },
  {
    id: 'B36', what: 'SMIL may animate href',
    file: 'engine/policy/render-policy.ts', from: "if (lower === 'href' || lower === 'style' || lower.startsWith('on')) return false;", to: "if (lower === 'style' || lower.startsWith('on')) return false;",
    run: POLICY_TESTS, expect: /✖ SMIL: an animation renders only/,
  },
  {
    id: 'B37', what: 'data: images load on any URL attribute',
    file: 'engine/policy/render-policy.ts', from: '(DATA_IMAGE.test(u) && DATA_IMAGE_ON.get(elLocal) === attrLocal)', to: 'DATA_IMAGE.test(u)',
    run: POLICY_TESTS, expect: /✖ URLs: a fragment on every URL attribute/,
  },
  {
    id: 'B38', what: 'relative URLs load',
    file: 'engine/policy/render-policy.ts', from: "const ok = (u: string) => u.startsWith('#') || (DATA_IMAGE", to: "const ok = (u: string) => u.startsWith('#') || !u.includes(':') || (DATA_IMAGE",
    run: POLICY_TESTS, expect: /✖ URLs: a fragment on every URL attribute/,
  },
  {
    id: 'B39', what: 'URLs are read only as the rule writes them, not as a URL parser does',
    file: 'engine/policy/render-policy.ts', from: 'return ok(squash(value)) && ok(asParsed(value));', to: 'return ok(squash(value));',
    run: POLICY_TESTS, expect: /✖ URLs: whatever is kept still means the same fragment or image/,
  },
  {
    id: 'B40', what: 'CSS function names are matched case-sensitively',
    file: 'engine/policy/render-policy.ts', from: "(hex ? cssChar(hex) : nl ? '' : ch!)).toLowerCase();", to: "(hex ? cssChar(hex) : nl ? '' : ch!));",
    run: POLICY_TESTS, expect: /✖ CSS: the served profile rule/,
  },
  {
    id: 'B41', what: "the canvas's CSS reading lets @import through",
    file: 'engine/policy/render-policy.ts', from: 'if (/image-set\\s*\\(|@import/.test(t)) return false;', to: 'if (/image-set\\s*\\(/.test(t)) return false;',
    run: POLICY_TESTS, expect: /✖ CSS: the served profile rule/,
  },
  {
    id: 'B42', what: 'an attribute written twice goes unnoticed',
    file: 'engine/policy/render-policy.ts', from: 'if (seen.has(key)) return true;', to: '',
    run: POLICY_TESTS, expect: /✖ an element carrying an attribute twice is flagged/,
  },
  {
    id: 'B43', what: 'requiredExtensions reads any extension as supported',
    file: 'engine/policy/render-policy.ts', from: 'return tokens.length > 0 && tokens.every((t) => t === NS.xhtml);', to: 'return tokens.length > 0;',
    run: POLICY_TESTS, expect: /✖ requiredExtensions: true only for the XHTML namespace/,
  },
  {
    id: 'B44', what: 'a kept fragment is read one way only when naming its target',
    file: 'engine/policy/render-policy.ts', from: '[asParsed(value), squash(value)].map(', to: '[squash(value)].map(',
    run: POLICY_TESTS, expect: /✖ the ids a kept fragment names/,
  },
  // P0-M2 review: the sink ban covers the ways to make or fill a node.
  {
    id: 'B45', what: 'the renderer makes a text node itself',
    file: 'projects/draw/src/canvas/renderer.ts', append: "\nexport const leak = (d: Document) => d.createTextNode('x');\n",
    run: CHECK_SINKS, expect: /renderer\.ts:\d+\s+dom-text/,
  },
  // P0-M2 review: keyed patching equals a fresh render.
  {
    id: 'B46', what: 'a patched node is appended instead of placed at its model position',
    file: 'projects/draw/src/canvas/renderer.ts', from: '(parent.dom as Element).insertBefore(dom, next ?? null);', to: '(parent.dom as Element).append(dom);',
    run: PATCH_TESTS, expect: /reorder, patch the node/,
  },
  {
    id: 'B47', what: 'a node rebuilt under its new parent stays drawn under the old one too',
    file: 'projects/draw/src/canvas/renderer.ts', from: '    this.#detach(node.id); // drawn somewhere else before a move: the new place wins\n', to: '',
    run: PATCH_TESTS, expect: /move into another parent, patch the new parent only/,
  },
  {
    id: 'B48', what: 'an id change does not re-judge the animations that name ids',
    file: 'projects/draw/src/canvas/renderer.ts', from: '    if (done.id !== was) this.#rejudge();\n', to: '',
    run: PATCH_TESTS, expect: /ids renamed so an animation now targets a circle/,
  },
  {
    id: 'B49', what: 'a structural patch does not re-judge the animations that name ids',
    file: 'projects/draw/src/canvas/renderer.ts', from: '    this.#patch(id);\n    this.#rejudge();\n', to: '    this.#patch(id);\n',
    run: PATCH_TESTS, expect: /an animation's target deleted/,
  },
  {
    id: 'B50', what: 'a render that throws leaves the renderer half-built',
    file: 'projects/draw/src/canvas/renderer.ts', from: '      [this.#doc, this.#nodes, this.#skipped, this.#linked, this.#ids] = prev;\n', to: '',
    run: PATCH_TESTS, expect: /patching the previous document still works/,
  },
  // P0-M2 review: the canvas's edges and fidelity (site e2e).
  {
    id: 'B51', what: 'SMIL is judged by the first href in the model, not the one the sink kept', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: "const kept = el.getAttributeNS(null, 'href') ?? el.getAttributeNS(NS.xlink, 'href');", to: "const kept = findAttr(node, null, 'href') ? el.getAttributeNS(null, 'href') : el.getAttributeNS(NS.xlink, 'href');",
    run: SITE_E2E, expect: /a dropped href leaves xlink:href to decide: <animate> is on the canvas/,
  },
  {
    id: 'B52', what: 'SMIL is judged against the first element with the id only', slow: true,
    file: 'projects/draw/src/canvas/renderer.ts', from: 'return found.length ? found : null;', to: 'return found.length ? [found[0]] : null;',
    run: SITE_E2E, expect: /the first id inside a refused element: <animate> is on the canvas/,
  },
  {
    id: 'B53', what: 'a fragment that names nothing falls back to "renders on some element"', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: 'return targets !== null && targets.every(', to: 'return targets === null ? smilTargetAllowed(node, name) : targets.every(',
    run: SITE_E2E, expect: /a fragment that names nothing: <animate> is on the canvas/,
  },
  {
    id: 'B54', what: 'DOMPurify drops ordinary ids again (SANITIZE_DOM)', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: '  SANITIZE_DOM: false,\n', to: '',
    run: SITE_E2E, expect: /is DOMPurify dropping ordinary ids again/,
  },
  {
    id: 'B55', what: "the app's inherited styles reach the document", slow: true,
    file: 'projects/draw/src/app.css', from: '  all: initial;\n', to: '',
    run: SITE_E2E, expect: /on the canvas the .+ but the file alone has/,
  },
  {
    id: 'B56', what: 'a ds token reaches the document', slow: true,
    file: 'projects/draw/src/app.css', from: ' --accent: initial;', to: '',
    run: SITE_E2E, expect: /ds tokens reach the document on the canvas: --accent/,
  },
  {
    id: 'B57', what: 'the paper follows the theme', slow: true,
    file: 'projects/draw/src/app.css', from: '  background: #fff;\n', to: '',
    run: SITE_E2E, expect: /the canvas paper is/,
  },
  {
    id: 'B58', what: 'a root the canvas refuses reports success', slow: true,
    file: 'projects/draw/src/editor.ts', from: 'if (!canvas.nodeFor(root.id)) {', to: 'if (false) {',
    run: SITE_E2E, expect: /not a refused root/,
  },
  {
    id: 'B59', what: 'a root size that overflows to Infinity is used',
    file: 'projects/draw/src/canvas/artboard.ts', from: 'return v != null && Number.isFinite(v) && v > 0 ? v : null;', to: 'return v && v > 0 ? v : null;',
    run: drawTests('artboard.test.ts'), expect: /✖ the artboard is the viewBox, else the size/,
  },
  {
    id: 'B60', what: 'reduced motion no longer stops CSS animations', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: '{ *, *::before, *::after { animation: none !important; transition: none !important } }', to: '{ }',
    run: SITE_E2E, expect: /reduced motion "reduce": the canvas runs \d+ CSS animation/,
  },
  {
    id: 'B61', what: 'requiredExtensions of XHTML still refuses its element', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: 'if (!extensionsSupported(value)) return null;', to: 'if (value) return null;',
    run: SITE_E2E, expect: /a <switch> offering XHTML: <switch > foreignObject > div> is not on the canvas/,
  },
  {
    id: 'B62', what: 'requiredExtensions is left off instead of refusing its element', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: 'if (!extensionsSupported(value)) return null;', to: '',
    run: SITE_E2E, expect: /Illustrator's <switch> shows its artwork, not its private data: <switch > foreignObject> is on the canvas/,
  },
  {
    id: 'B63', what: 'the corpus check passes on an empty canvas', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: '    } else if (!set(plan, node, a, value)) dropped++;', to: '    } else if (a.ns !== null) return null;\n    else if (!set(plan, node, a, value)) dropped++;',
    run: SITE_E2E, expect: /rendered nothing|the corpus drew only/,
  },
  {
    id: 'B64', what: 'the sink loses paint and clip references', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: '  SANITIZE_DOM: false,\n', to: "  SANITIZE_DOM: false,\n  FORBID_ATTR: ['clip-path', 'mask', 'filter', 'fill', 'stroke'],\n",
    run: SITE_E2E, expect: /the sample lost part of itself/,
  },
  {
    id: 'B65', what: 'the renderer stops telling the sink what an animation drives', slow: true,
    file: 'projects/draw/src/canvas/renderer.ts', from: 'sinkElement(doc, node, { inForeignObject, smilTargets: this.#smilTargets })', to: 'sinkElement(doc, node, { inForeignObject })',
    run: SITE_E2E, expect: /the policy refuses part of rect > animate/,
  },
  {
    id: 'B66', what: 'the shadow-root probe passes although its light-DOM control fails too', slow: true,
    file: 'projects/draw/test/probe-shadow.mjs', from: 'const rgb = shot.rgb(Math.round(left + x), Math.round(top + y));', to: 'const rgb = shot.rgb(Math.round(left + x) + 300, Math.round(top + y));',
    run: SITE_E2E, expect: /probe inconclusive in chromium/,
  },
  {
    id: 'B67', what: 'a test a done ledger row cites stops running (skipped), so the unit run still passes',
    file: 'engine/test/xml.test.ts', from: "test('every corpus file round-trips byte-identical through the CST and the model',",
    to: "test.skip('every corpus file round-trips byte-identical through the CST and the model',",
    run: EVIDENCE_CHECK,
    expect: /feature:round-trip: cited test did not pass/,
  },
  // P0-M3: the interaction spine. Unit and renderer-patch breaks first (quick), then the site e2e.
  {
    id: 'B68', what: 'a scrub frame rewrites every attribute of its element',
    file: 'projects/draw/src/canvas/safe-sink.ts', from: '    if (target.getAttributeNS(p.ns, p.local) === p.value) continue;\n', to: '',
    run: PATCH_TESTS, expect: /a value edit is one attribute mutation/,
  },
  {
    id: 'B69', what: 'the camera is not written to the drawn root',
    file: 'projects/draw/src/canvas/renderer.ts', from: "if (this.#camera !== null) return [{ local: 'viewBox', value: this.#camera }];", to: '',
    run: PATCH_TESTS, expect: /a camera on a root with a viewBox: the viewBox/,
  },
  {
    id: 'B70', what: "the canvas's hit test maps a stale node back to a NodeId",
    file: 'projects/draw/src/canvas/renderer.ts', from: 'return id !== undefined && this.#nodes.get(id)?.dom === dom ? id : undefined;', to: 'return id;',
    run: PATCH_TESTS, expect: /a node taken off the canvas still maps to its NodeId/,
  },
  {
    id: 'B71', what: "the editor's routing re-renders nested subtrees twice",
    file: 'projects/draw/src/routing.ts', from: 'const subtrees = [...roots].filter((id) => !under(doc, id, roots, false));', to: 'const subtrees = [...roots];',
    run: drawTests('routing.test.ts'), expect: /✖ structure: only the topmost subtrees/,
  },
  {
    id: 'B72', what: 'the code view is not patched after an edit',
    file: 'projects/draw/src/editor.ts', from: '      for (const id of r.code.blocks) this.#patchCode(id);\n', to: '',
    run: drawTests('editor.test.ts'), expect: /✖ an edit reaches the canvas, then the code/,
  },
  {
    id: 'B73', what: 'every scrub frame re-renders React (a store bump per frame)',
    file: 'projects/draw/src/editor.ts', from: "if (why.kind !== 'drag') this.#bump();", to: 'this.#bump();',
    run: drawTests('editor.test.ts'), expect: /✖ a scrub changes only its token bytes/,
  },
  {
    id: 'B74', what: 'a released scrub is thrown away instead of committed',
    file: 'projects/draw/src/editor.ts', from: '    this.#endLive(committed);', to: '    this.#endLive(false);',
    run: drawTests('editor.test.ts'), expect: /✖ a scrub changes only its token bytes/,
  },
  {
    id: 'B75', what: 'a parse error in Edit source loses its line',
    file: 'projects/draw/src/editor.ts', from: '...lineColumn(text, parsed.error.at)', to: 'line: 1, column: 1',
    run: drawTests('editor.test.ts'), expect: /✖ Edit source replaces the element/,
  },
  {
    id: 'B76', what: 'a canvas tap selects a shape that only draws where it is referenced (a clipPath)',
    file: 'projects/draw/src/selectable.ts', from: 'GRAPHICS.has(n.local) && !referencedOnly(doc, id);', to: 'GRAPHICS.has(n.local);',
    run: drawTests('editor.test.ts'), expect: /✖ selection: a canvas tap takes the nearest element/,
  },
  {
    id: 'B77', what: 'a resize throws away the view the user zoomed to',
    file: 'projects/draw/src/editor.ts', from: 'if (this.#fitted || !(was.width > 0 && was.height > 0)) this.#fitView();', to: 'this.#fitView();',
    run: drawTests('editor.test.ts'), expect: /✖ zoom and pan move the camera/,
  },
  {
    id: 'B78', what: 'an edit of the root viewBox leaves a fitted view on the old artboard',
    file: 'projects/draw/src/editor.ts', from: '      if (cs.attrs.has(session.doc.root)) this.#artboardChanged();\n', to: '',
    run: drawTests('editor.test.ts'), expect: /✖ a file placed otherwise/,
  },
  {
    id: 'B79', what: 'a file with its own preserveAspectRatio is shown without the camera that fits it',
    file: 'projects/draw/src/canvas/artboard.ts', from: 'if (p.align !== DEFAULT_PAR.align || p.meetOrSlice !== DEFAULT_PAR.meetOrSlice) return false;', to: '',
    run: drawTests('artboard.test.ts'), expect: /✖ a file whose own root shows the fitted view/,
  },
  {
    id: 'B80', what: 'the page zooms under a pinch on the canvas (touch-action removed from the canvas and the app)', slow: true,
    file: 'projects/draw/src/app.css', from: /  touch-action: none;\n| touch-action: pan-x pan-y;/g, to: '',
    run: SITE_E2E, expect: /the page zoomed to/,
  },
  {
    id: 'B81', what: "Safari's own pinch events reach the page", slow: true,
    file: 'projects/draw/src/canvas/stage.ts', from: "    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) on<Event>(area.ownerDocument, type, (e) => e.preventDefault(), { passive: false });\n", to: '',
    run: SITE_E2E, expect: /Safari's gesture events are not cancelled on the canvas/,
  },
  {
    id: 'B82', what: 'a wheel zoom goes about the corner, not the pointer', slow: true,
    file: 'projects/draw/src/canvas/stage.ts', from: 'this.#editor.zoomAt({ x: e.clientX - box.left, y: e.clientY - box.top },', to: 'this.#editor.zoomAt({ x: 0, y: 0 },',
    run: SITE_E2E, expect: /after the wheel zoom the document point/,
  },
  {
    id: 'B83', what: 'the outline is measured from the page, not the overlay', slow: true,
    file: 'projects/draw/src/canvas/overlay.ts', from: 'const origin = this.svg.getBoundingClientRect();', to: 'const origin = new DOMRect(0, 0, 0, 0);',
    run: SITE_E2E, expect: /at 400% the outline is [\d.]+pt off/,
  },
  {
    id: 'B84', what: 'the outline does not follow the zoom', slow: true,
    file: 'projects/draw/src/editor.ts', from: 'this.#ports.canvas.setCamera(usable && !own ? camera(this.#view, s) : null);\n    this.#outline();', to: 'this.#ports.canvas.setCamera(usable && !own ? camera(this.#view, s) : null);',
    run: SITE_E2E, expect: /at 400% the outline is [\d.]+pt off/,
  },
  {
    id: 'B85', what: 'a two-finger tap on the canvas no longer undoes', slow: true,
    file: 'projects/draw/src/canvas/stage.ts', from: '        return ed.undo();', to: '        return;',
    run: SITE_E2E, expect: /a two-finger tap on the canvas did not undo/,
  },
  {
    id: 'B86', what: "the canvas's hit test finds nothing", slow: true,
    file: 'projects/draw/src/canvas/stage.ts', from: 'ed.tapCanvas(this.#renderer.idFor(hit) ?? null);', to: 'ed.tapCanvas(null);',
    run: SITE_E2E, expect: /tapping the circle (did not select it|drew no outline)/,
  },
  {
    id: 'B87', what: 'the canvas host is exposed to assistive tech', slow: true,
    file: 'projects/draw/src/panels/Canvas.tsx', from: ' aria-hidden="true" />', to: ' />',
    run: SITE_E2E, expect: /the canvas host is not aria-hidden/,
  },
  {
    id: 'B88', what: 'a sheet field drops under 16px', slow: true,
    file: 'projects/draw/src/app.css', from: '.draw-wide { width: 100%; }', to: '.draw-field { font-size: 0.75rem; }\n.draw-wide { width: 100%; }',
    run: SITE_E2E, expect: /field\(s\) under 16px/,
  },
  {
    id: 'B89', what: 'the Number sheet refuses a value without saying why', slow: true,
    file: 'projects/draw/src/panels/Sheets.tsx', from: "setProblem('error' in r ? r.error : null);", to: 'setProblem(null);',
    run: SITE_E2E, expect: /the Number sheet took "4o" without a word/,
  },
  {
    id: 'B90', what: 'a changed code block no longer flashes', slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: "    el.classList.add('cv-flash');\n", to: '',
    run: SITE_E2E, expect: /the scrubbed block doesn't flash/,
  },
  {
    id: 'B91', what: 'the initial JS is over its budget (here, a budget the bundle cannot meet)', slow: true,
    file: 'projects/draw/test/e2e.mjs', from: 'must(bytes <= 250_000,', to: 'must(bytes <= 50_000,',
    run: SITE_E2E, expect: /over the 250 KB budget/,
  },
  // P0-M3 review fixes.
  {
    id: 'B92', what: 'Edit source parses with fresh limits (a new entity budget, depth, node count and size)',
    file: 'engine/model/fragment.ts', from: 'parseDoc(`${head}${text}${tail}`, limits, budget)', to: 'parseDoc(`${head}${text}${tail}`)',
    run: engineTests('fragment.test.ts'), expect: /✖ Edit source spends what the document has left/,
  },
  {
    id: 'B93', what: "Edit source's node limit counts nodes, not the tokens the parser counts (end tags too)",
    file: 'engine/model/fragment.ts', from: 'max.maxNodes - tokens(doc)', to: 'max.maxNodes - doc.nodes.size',
    run: engineTests('fragment.test.ts'), expect: /✖ Edit source spends what the document has left/,
  },
  {
    id: 'B94', what: 'a DOCTYPE is accepted inside an element or after the root (and so through Edit source)',
    file: 'engine/xml/cst.ts', from: "if (tok.kind === 'doctype' && (stack.length || root)) {", to: "if (tok.kind === 'doctype' && false) {",
    run: XML_TESTS, expect: /✖ a DOCTYPE outside the prolog/,
  },
  {
    id: 'B95', what: 'an XML declaration is accepted after the start of the document',
    file: 'engine/xml/cst.ts', from: "tok.start !== (source.charCodeAt(0) === 0xfeff ? 1 : 0)", to: 'false',
    run: XML_TESTS, expect: /✖ a DOCTYPE outside the prolog, or an XML declaration after the start/,
  },
  {
    id: 'B96', what: 'zooming in on a tiny artboard zooms out (the cap stays at MAX_SCALE below the fit)',
    file: 'projects/draw/src/canvas/viewport.ts', from: 'Math.min(Math.max(MAX_SCALE, fitScale * MAX_SCALE_FACTOR), ', to: 'Math.min(MAX_SCALE, ',
    run: drawTests('viewport.test.ts'), expect: /✖ zooming in never zooms out/,
  },
  {
    id: 'B97', what: 'a view whose camera overflows (a hostile viewBox) is applied anyway',
    file: 'projects/draw/src/editor.ts', from: '    if (!drawable(next, this.#size)) return;\n', to: '',
    run: drawTests('editor.test.ts'), expect: /✖ a hostile viewBox near the float limit/,
  },
  {
    id: 'B98', what: 'a token edit writes a character XML cannot hold (the Text sheet)',
    file: 'engine/code/edit.ts', from: 'const bad = NOT_XML_CHAR.exec(text);', to: 'const bad = null as RegExpExecArray | null;',
    run: engineTests('code/edit.test.ts'), expect: /✖ no token takes a character XML 1\.0 cannot hold/,
  },
  {
    id: 'B99', what: "the Color sheet no longer rings the current value when its case differs",
    file: 'projects/draw/src/color-choices.ts', from: 'a.toLowerCase() === b.toLowerCase()', to: 'a === b',
    run: drawTests('color-choices.test.ts'), expect: /✖ the Color sheet: a 16-colour palette/,
  },
  {
    id: 'B100', what: 'the ToolRail is 51pt again, not the plan\'s 52', slow: true,
    file: 'projects/draw/src/app.css', from: 'min-height: max(var(--tap-min), 3.75rem);', to: 'min-height: max(var(--tap-min), 3.5rem);',
    run: SITE_E2E, expect: /the TopBar, ContextBar and ToolRail are 44, 48 and 51/,
  },
  {
    id: 'B101', what: 'the code breaks numbers and colours across lines (word-break: break-all)', slow: true,
    file: 'projects/draw/src/app.css', from: '  overflow-wrap: anywhere;\n', to: '  overflow-wrap: anywhere;\n  word-break: break-all;\n',
    run: SITE_E2E, expect: /token\(s\) split across lines of the code/,
  },
  {
    id: 'B102', what: 'a tap near a wrapped token measures to the box around all its lines', slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: 'for (const r of span.getClientRects()) {', to: 'for (const r of [span.getBoundingClientRect()]) {',
    run: SITE_E2E, expect: /a tap on <\/text>, 40pt from the wrapped text run, opened its Text sheet/,
  },
  {
    id: 'B103', what: 'a selected block scrolls flush against the ContextBar (no scroll padding)', slow: true,
    file: 'projects/draw/src/app.css', from: '  scroll-padding-block: var(--tap-min);', to: '',
    run: SITE_E2E, expect: /from the panel's bottom edge, under a finger's width/,
  },
  {
    id: 'B104', what: 'any lift of a finger on the code is a tap, however far it moved', slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: 'const tap = this.taps.lift(e.pointerId, e.clientX, e.clientY, cancelled);', to: 'const tap = (this.taps.lift(e.pointerId, e.clientX, e.clientY, cancelled), !cancelled);',
    run: SITE_E2E, expect: /a swipe that ends on a colour opened a sheet/,
  },
  {
    id: 'B105', what: 'a second finger on the code leaves the first a tap',
    file: 'projects/draw/src/codeview/scrub.ts', from: '    for (const p of this.down.values()) p.still = false;\n', to: '',
    run: drawTests('scrub.test.ts'), expect: /✖ a tap on the code is one pointer that stayed put/,
  },
  {
    id: 'B106', what: 'the Scrub strip stays on the old number after a scrub of another',
    file: 'projects/draw/src/editor.ts', from: '    this.focus.set({ ref: hit.ref, token: t }); // the Scrub strip follows the number being scrubbed\n', to: '',
    run: drawTests('editor.test.ts'), expect: /✖ the Scrub strip follows the number being scrubbed/,
  },
  {
    id: 'B107', what: 'the editor never tells the code which number the Scrub strip holds',
    file: 'projects/draw/src/editor.ts', from: 'this.#ports.code.focus(key && index !== -1 ? { key, index } : null);', to: 'this.#ports.code.focus(null);',
    run: drawTests('editor.test.ts'), expect: /✖ the Scrub strip follows the number being scrubbed/,
  },
  {
    id: 'B108', what: "the code loses the Scrub strip's mark when the number's block is patched", slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: '    if (this.focused?.key === b.key) this.markFocus();\n', to: '',
    run: SITE_E2E, expect: /while the Number sheet writes 95 the mark is/,
  },
  {
    id: 'B109', what: 'a touch drag of the sheet handle swallows the next tap on it', slow: true,
    file: 'projects/draw/src/panels/CodePanel.tsx', from: '    dragged.current = false; // a touch drag gets no click to clear this, so it would swallow the next tap\n', to: '',
    run: SITE_E2E, expect: /the drag swallowed it/,
  },
  {
    id: 'B110', what: 'Edit source is offered for the root, which it always refuses',
    file: 'projects/draw/src/editor.ts', from: 'return !!this.#doc && ids.length === 1 && ids[0] !== this.#doc.root;', to: 'return !!this.#doc && ids.length === 1;',
    run: drawTests('editor.test.ts'), expect: /✖ Edit source is offered for one element, never the root/,
  },
  {
    id: 'B111', what: 'the ContextBar offers Edit source whatever is selected', slow: true,
    file: 'projects/draw/src/panels/ContextBar.tsx', from: '{editor.canEditSource() && (', to: '{true && (',
    run: SITE_E2E, expect: /Edit source is offered for the root <svg>/,
  },
  {
    id: 'B112', what: 'the page zooms under a pinch off the canvas (no touch-action on the app)', slow: true,
    file: 'projects/draw/src/app.css', from: ' touch-action: pan-x pan-y;', to: '',
    run: SITE_E2E, expect: /a pinch on \.draw-[\w-]+ zoomed the page to/,
  },
  {
    id: 'B113', what: "Safari's own pinch events are cancelled on the canvas only", slow: true,
    file: 'projects/draw/src/canvas/stage.ts', from: 'on<Event>(area.ownerDocument, type,', to: 'on<Event>(area, type,',
    run: SITE_E2E, expect: /Safari's gesture events are not cancelled on \.draw-bar/,
  },
  {
    id: 'B114', what: 'a document lifted above the selection outline paints over it (no z-index on the marks)', slow: true,
    file: 'projects/draw/src/app.css', from: ' z-index: 2147483647;', to: '',
    run: SITE_E2E, expect: /paints over the selection outline/,
  },
  // The correctness review: breaks that every test used to pass.
  {
    id: 'B115', what: 'the canvas does not follow an undo or a redo',
    file: 'projects/draw/src/editor.ts', from: '    session.subscribe((cs: ChangeSet) => {\n      r = route(session.doc, cs);\n', to: "    session.subscribe((cs: ChangeSet, why) => {\n      r = route(session.doc, cs);\n      if (why.kind === 'undo' || why.kind === 'redo') return;\n",
    run: drawTests('editor.test.ts'), expect: /✖ an edit reaches the canvas, then the code/,
  },
  {
    id: 'B116', what: 'the selection outline does not follow a scrub', slow: true,
    file: 'projects/draw/src/editor.ts', from: '    session.subscribe(() => {\n      const kept =', to: "    session.subscribe((_cs, why) => {\n      if (why.kind === 'drag') return;\n      const kept =",
    run: SITE_E2E, expect: /after the scrub the outline is [\d.]+pt off the circle/,
  },
  {
    id: 'B117', what: 'the view does not follow the canvas when it changes size', slow: true,
    file: 'projects/draw/src/canvas/stage.ts', from: '    ro.observe(host);\n', to: '',
    run: SITE_E2E, expect: /after the wheel zoom the document point/,
  },
  {
    id: 'B118', what: 'a node an undo took out stays selected',
    file: 'projects/draw/src/editor.ts', from: '      if (kept.length !== this.selection.get().size) this.selection.set(new Set(kept));\n', to: '',
    run: drawTests('editor.test.ts'), expect: /✖ Edit source replaces the element in one transaction/,
  },
  {
    id: 'B119', what: "the selected element's code block is not marked", slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: "      el.classList.toggle('cv-selected', on);\n", to: '',
    run: SITE_E2E, expect: /the selected circle's block is not marked/,
  },
  {
    id: 'B120', what: 'Enter no longer closes the Text sheet', slow: true,
    file: 'projects/draw/src/panels/Sheets.tsx', from: "        onKeyDown={(e) => e.key === 'Enter' && close()}\n      />\n      <Problem", to: '      />\n      <Problem',
    run: SITE_E2E, expect: /Enter did not close the Text sheet/,
  },
];

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const only = args.filter((a) => /^B\d+$/.test(a));
const chosen = BREAKS.filter((b) => (only.length ? only.includes(b.id) : !(quick && b.slow)));

let undetected = 0;
for (const b of chosen) {
  const file = b.file && join(REPO, b.file);
  const created = b.create && join(REPO, b.create);
  const original = file ? readFileSync(file, 'utf8') : null;
  // the outermost folder a created file needs that doesn't exist yet, removed afterwards
  let newDir = null;
  for (let d = created && dirname(created); d && d.startsWith(REPO) && !existsSync(d); d = dirname(d)) newDir = d;
  let out = '';
  let caught = false;
  try {
    if (file) {
      const next = b.append != null ? original + b.append : original.replace(b.from, b.to);
      if (next === original) throw new Error(`${b.id}: the break did not apply (anchor not found)`);
      writeFileSync(file, next);
    }
    if (created) {
      mkdirSync(dirname(created), { recursive: true });
      writeFileSync(created, b.content);
    }
    const [cmd, cmdArgs, cwd] = b.run;
    try {
      out = execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      caught = b.expect.test(out);
    }
  } finally {
    if (file) writeFileSync(file, original);
    if (created && existsSync(created)) rmSync(created);
    if (newDir) rmSync(newDir, { recursive: true, force: true });
  }
  if (!caught) undetected++;
  console.log(`${caught ? 'red ✓' : 'GREEN ✗'}  ${b.id}  ${b.what}${caught ? '' : `\n        expected ${b.expect} in:\n${out.split('\n').slice(-8).map((l) => '        ' + l).join('\n')}`}`);
}
console.log(undetected ? `\n${undetected} break(s) went undetected.` : `\nAll ${chosen.length} break(s) went red.`);
process.exitCode = undetected ? 1 : 0;
