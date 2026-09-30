#!/usr/bin/env node
// Deliberate breaks: every guard in Draw's pipeline must be able to fail. Each break edits one
// file, runs the check that should catch it, requires a non-zero exit, and restores the file
// (in `finally`, so an interrupted run never leaves a break behind; `git diff` should be empty
// afterwards).
//
//   node tools/prove-breaks.mjs           every break (the e2e ones rebuild the site: slow)
//   node tools/prove-breaks.mjs --quick   only the breaks caught without a site build
//   node tools/prove-breaks.mjs B3 B5     just these
//   node tools/prove-breaks.mjs --dry [--quick] [B3 …]
//                                         check that each chosen break (default: every one) still
//                                         applies, without running any: a stale anchor otherwise
//                                         shows only when someone runs that break. Writes nothing.
//
// Add a break whenever a milestone adds a check. The plan's rule: a check nobody has seen fail
// isn't a check.
//
// A break edits with String.prototype.replace, so `from` may be a RegExp (an anchor that survives
// the row or line around it changing) and `to` a replacer function. A site e2e break may name the
// e2e checks that catch it (`checks`): only those run (DRAW_E2E_ONLY), which saves the rest of the
// suite's minutes; such a run is never evidence (test/e2e.mjs).

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
// The e2e evidence gate after the site e2e, as `npm run verify` and CI run it. The smoke test is
// expected to fail for some of these breaks; the break is caught only if ledger-check then fails.
const E2E_EVIDENCE = 'node projects/draw/tools/ledger-check.mjs --e2e-evidence .smoke/draw-e2e-evidence.jsonl';
// A Draw e2e break that names its `checks`: Draw's bundle alone, rebuilt without its unit tests (one
// may catch the same plant first; this proves the e2e check can) into the last built _site, then
// just those checks. It needs a built _site; the run puts Draw's own bundle back afterwards.
const DRAW_BUNDLE = 'cd projects/draw && BASE_PATH=/draw/ npx vite build >/dev/null && node tools/library-index.mjs >/dev/null && rm -rf ../../_site/draw && cp -r dist ../../_site/draw && cd ../..';
const DRAW_E2E = ['sh', ['-c', `test -f _site/index.html && ${DRAW_BUNDLE} && E2E=draw node scripts/smoke-test.mjs`], REPO];
const SITE_E2E_EVIDENCE = ['sh', ['-c', `node scripts/build-site.mjs >/dev/null && node scripts/check-library.mjs --site _site && { E2E=draw node scripts/smoke-test.mjs; ${E2E_EVIDENCE}; }`], REPO];

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
    file: 'engine/ledger/ledger.json', from: '"profileVersion": 4', to: '"profileVersion": 5',
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
    // P1-M0 review (F3): the namespaces in scope are one map, set and put back, not a copy per element.
    id: 'B307', what: 'every element copies the namespace declarations in scope again (quadratic over nested declarations)',
    file: 'engine/model/doc.ts', from: '    const map = scope; // what is in scope here', to: '    const map = new Map(scope); // what is in scope here',
    run: XML_TESTS, expect: /✖ namespace declarations hold for their element only, at no cost per element[\s\S]*255 nested elements declaring (150|600) prefixes each took \d+ ms/,
  },
  {
    id: 'B308', what: "an element's namespace declarations are never put back (they leak to what follows it)",
    file: 'engine/model/doc.ts', from: '      if (uri === undefined) scope.delete(prefix);\n      else scope.set(prefix, uri);\n', to: '',
    run: XML_TESTS, expect: /✖ namespace declarations hold for their element only, at no cost per element[\s\S]*each resolves in its own scope/,
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
    // P1-M0 review (F1): the budget counts work as well as output, in parsing and in Edit source.
    id: 'B300', what: 'an entity expansion costs only what it writes again (a bomb of entities that expand to nothing runs free)',
    file: 'engine/xml/entities.ts', from: "    budget.left -= 1 + (rep.includes('&') ? rep.length : 0);\n", to: '',
    run: ['node', ['--test', '--test-reporter=spec', '../../engine/test/xml.test.ts', '../../engine/test/fragment.test.ts'], DRAW],
    expect: /^(?=[\s\S]*✖ an entity bomb that expands to nothing fails within the entity budget[\s\S]*an expansion to nothing is charged to the budget)(?=[\s\S]*✖ Edit source refuses an entity bomb that expands to nothing, within the budget[\s\S]*an expansion to nothing is charged to the document)/,
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
    // The whole row's line, whatever it holds by then (its status, tests and notes change as it is built).
    id: 'B21', what: 'an SVG element loses its ledger row',
    file: 'engine/ledger/ledger.json', from: /^\{"id":"element:rect",[^\n]*\n/m, to: '',
    run: LEDGER_CHECK, expect: /no row for the SVG element <rect>/,
  },
  {
    // One phase past wherever the ledger stands, whose rows are never all done while it is built.
    id: 'B22', what: 'the phase is raised before its rows are done',
    file: 'engine/ledger/ledger.json', from: /"currentPhase": (\d+)/, to: (_, phase) => `"currentPhase": ${Number(phase) + 1}`,
    run: LEDGER_CHECK, expect: /: phase \d+ is behind the current phase \d+ but the row is (?:planned|partial)/,
  },
  {
    id: 'B23', what: 'the served profile stops refusing the ledger\'s active attributes',
    file: 'scripts/lib/svg-profile.mjs', from: "if (attr.ns == null && ACTIVE_ATTRIBUTES.has(attr.local)) { add('active-attribute', at); return; }", to: '',
    run: engineTests('ledger.test.ts'), expect: /✖ the served profile refuses every SVG element and attribute the ledger does not serve/,
  },
  // P0-M2: the safe sink, the renderer and the canvas (all caught by the site e2e).
  {
    // P1-M0 review (F4): the DOM judges a name too; one it refuses is dropped, never thrown on.
    id: 'B302', what: 'the sink stops asking the DOM whether it takes a name (data-😀 throws in setAttribute and fails the render)',
    file: 'projects/draw/src/canvas/safe-sink.ts', from: ' || !domTakesName(attr.ns, key)', to: '',
    run: PATCH_TESTS, expect: /attribute names the DOM refuses are dropped, never thrown on\n\s+threw InvalidCharacterError/,
  },
  {
    id: 'B303', what: 'the sink stops asking the DOM whether it takes a name, in the app (a file with data-😀 fails to draw; Edit source adding one blanks the canvas)', slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: ' || !domTakesName(attr.ns, key)', to: '',
    run: SITE_E2E, expect: /data-\* names the DOM refuses: did not render \(InvalidCharacterError[\s\S]*editSourceRoundTrip: Edit source adding data-\S+: \{"broken":"[^"]*is not a valid attribute name[^}]*"takes":false\}/,
  },
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
    id: 'B30', what: "the rendered root takes the size its own CSS gives it", slow: true, checks: ['phoneRules', 'moreEdges'],
    // P1-M1: the size is the camera sheet's now; without !important the root's own inline size wins.
    file: 'projects/draw/src/canvas/safe-sink.ts', from: 'width: ${width} !important; height: ${height} !important;', to: 'width: ${width}; height: ${height};',
    run: DRAW_E2E, expect: /doesn't fill the host|a root sized by its own CSS: the root is/,
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
    file: 'engine/policy/render-policy.ts', from: '  if (scope.except?.includes(elLocal)) return false;\n', to: '',
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
    // P1-M1: the paper is the underlay's checkerboard now; a checker colour that follows the theme.
    id: 'B57', what: 'the paper follows the theme', slow: true, checks: ['canvasIgnoresTheTheme', 'theThemeFollowsTheSystemOrTheChoice'],
    file: 'projects/draw/src/app.css', from: 'repeating-conic-gradient(#eeeeee 0 25%, #ffffff 0 50%)', to: 'repeating-conic-gradient(#eeeeee 0 25%, var(--surface) 0 50%)',
    run: DRAW_E2E, expect: /the canvas paper is/,
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
    file: 'projects/draw/src/canvas/safe-sink.ts', from: '{ :host(:not(.draw-play):not(.draw-held)) *, :host(:not(.draw-play):not(.draw-held)) *::before, :host(:not(.draw-play):not(.draw-held)) *::after { animation: none !important; transition: none !important }\n', to: '{ ',
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
    // P1-M1: the camera is the root's own box (the camera sheet), no longer its viewBox.
    id: 'B69', what: 'the camera box is not placed on the drawn root',
    file: 'projects/draw/src/canvas/renderer.ts', from: '&& was.width === box.width && was.height === box.height))) placeRoot(this.#sheet, box);', to: '&& was.width === box.width && was.height === box.height))) void 0;',
    run: PATCH_TESTS, expect: /a camera on a root with a viewBox: the box/,
  },
  {
    id: 'B70', what: "the canvas's hit test maps a stale node back to a NodeId",
    file: 'projects/draw/src/canvas/renderer.ts', from: 'return id !== undefined && this.#nodes.get(id)?.dom === dom ? id : undefined;', to: 'return id;',
    run: PATCH_TESTS, expect: /a node taken off the canvas still maps to its NodeId/,
  },
  {
    id: 'B71', what: 'a moved node re-renders its parent again (P1-M1: moved nodes are patched alone)',
    file: 'projects/draw/src/routing.ts', from: '  const alone = [...cs.moved].filter((id) => !isStyle(doc, doc.nodes.get(id)?.parent));', to: '  const alone: NodeId[] = [];\n  for (const p of cs.structure) roots.add(p);',
    run: drawTests('routing.test.ts'), expect: /✖ structure: a moved, inserted or removed node is patched alone/,
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
    // P1-M1: fitsNatively went with the camera box; re-planted as the same fault in M.
    id: 'B79', what: "the camera box ignores the root's own preserveAspectRatio (a file placed otherwise is shown as if centred)",
    file: 'engine/geometry/ctm.ts', from: '  return viewportTransform(vb, parOf(doc, root), viewport.width, viewport.height);', to: '  return viewportTransform(vb, DEFAULT_PAR, viewport.width, viewport.height);',
    run: drawTests('artboard.test.ts'), expect: /✖ the camera box at fit/,
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
    id: 'B83', what: 'the outline is measured from the page, not the overlay', slow: true, checks: ['outlineOnTheElementAt400'],
    file: 'projects/draw/src/canvas/overlay/index.ts', from: 'const origin = this.svg.getBoundingClientRect();', to: 'const origin = new DOMRect(0, 0, 0, 0);',
    run: DRAW_E2E, expect: /at 400% the outline is [\d.]+pt off/,
  },
  {
    id: 'B84', what: 'the outline does not follow the zoom', slow: true, checks: ['outlineOnTheElementAt400'],
    // P1-M1: re-planted on the camera box's #applyView.
    file: 'projects/draw/src/editor.ts', from: '    this.#ports.canvas.setCamera(this.#box && { box: this.#box, viewport: this.#viewport });\n    this.#show();', to: '    this.#ports.canvas.setCamera(this.#box && { box: this.#box, viewport: this.#viewport });',
    run: DRAW_E2E, expect: /at 400% the outline is [\d.]+pt off/,
  },
  {
    id: 'B85', what: 'a two-finger tap on the canvas no longer undoes', slow: true,
    file: 'projects/draw/src/canvas/stage.ts', from: '        return ed.undo();', to: '        return;',
    run: SITE_E2E, expect: /a two-finger tap on the canvas did not undo/,
  },
  {
    id: 'B86', what: "the canvas's hit test finds nothing", slow: true, checks: ['outlineOnTheElementAt400', 'phoneRulesOnTheNewLayout'],
    file: 'projects/draw/src/canvas/stage.ts', from: '      const id = this.#renderer.idFor(el);', to: '      const id = this.#renderer.idFor(null);',
    run: DRAW_E2E, expect: /tapping the circle (did not select it|drew no outline)/,
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
    id: 'B90', what: 'a changed token no longer flashes', slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: "const flash = (target: Element | null) => target?.classList.add('cv-flash');", to: 'const flash = (_target: Element | null) => undefined;',
    run: SITE_E2E, expect: /the scrubbed token doesn't flash/,
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
    file: 'projects/draw/src/editor.ts', from: '    if (!drawable(next, this.#size, this.#viewport)) return;\n', to: '',
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
    file: 'projects/draw/src/app.css', from: '  scroll-padding-block: calc(var(--tap-min) * 2) var(--tap-min);', to: '',
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
    id: 'B111', what: "the More sheet offers Edit source whatever is selected", slow: true, checks: ['editSourceRoundTrip'],
    file: 'projects/draw/src/panels/ContextBar.tsx', from: '{editor.canEditSource() && (', to: '{true && (',
    run: DRAW_E2E, expect: /Edit source is offered for the root <svg>/,
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
  // P0-M4: files, drafts and export.
  {
    id: 'B121', what: 'the app reads the clipboard outside platform/',
    file: 'projects/draw/src/panels/App.tsx', append: "\nexport const peek = (e: ClipboardEvent) => e.clipboardData?.getData('text/plain');\n",
    run: CHECK_SINKS, expect: /App\.tsx:\d+ {2}file-api/,
  },
  {
    id: 'B122', what: 'a file that fails to parse no longer says where',
    file: 'projects/draw/src/import.ts', from: 'failed(input, message, text, at), source', to: 'failed(input, message), source',
    run: drawTests('import.test.ts'), expect: /✖ a file that isn't well-formed never reaches the editor/,
  },
  {
    id: 'B123', what: 'the importer hands the editor a root that is not <svg>',
    file: 'projects/draw/src/import.ts', from: "if (root.ns !== NS.svg || root.local !== 'svg') {", to: 'if (false) {',
    run: drawTests('import.test.ts'), expect: /✖ a file that isn't well-formed never reaches the editor/,
  },
  {
    id: 'B124', what: 'export writes UTF-8 whatever encoding the file came in',
    file: 'projects/draw/src/platform/files.ts', from: '  if (SINGLE_BYTE.test(encoding)) {', to: '  if (false) {',
    run: drawTests('files.test.ts'), expect: /✖ encodeSvg writes a file back in the encoding it came in/,
  },
  {
    id: 'B125', what: 'the autosave saves every change at once (no debounce)',
    file: 'projects/draw/src/autosave.ts', from: 'this.#delay = options.delay ?? SAVE_DELAY_MS;', to: 'this.#delay = 0;',
    run: drawTests('autosave.test.ts'), expect: /✖ an import is a draft at once; changes save once/,
  },
  {
    id: 'B126', what: 'a flush (pagehide, the page hidden) drops the pending change',
    file: 'projects/draw/src/autosave.ts', from: '      if (this.#b) retry.add(this.#b);\n', to: '',
    run: drawTests('autosave.test.ts'), expect: /✖ flush saves a pending change at once/,
  },
  {
    id: 'B127', what: "opening another document loses the pending change of the one before",
    file: 'projects/draw/src/autosave.ts', from: '      if (prev) retry.add(prev);\n', to: '',
    run: drawTests('autosave.test.ts'), expect: /✖ opening another document saves the pending change of the one before/,
  },
  {
    id: 'B128', what: 'a draft another tab holds is written anyway (the lock is ignored)',
    file: 'projects/draw/src/autosave.ts', from: '        if (!release) {', to: '        if (false) {',
    run: drawTests('autosave.test.ts'), expect: /✖ a draft another tab holds opens read-only/,
  },
  {
    id: 'B129', what: 'a full quota hides behind the next change',
    file: 'projects/draw/src/autosave.ts', from: '    if (b === this.#b && !this.#unsaved.size) this.state.set(s);', to: '    if (b === this.#b) this.state.set(s);',
    run: drawTests('autosave.test.ts'), expect: /✖ a full quota is a loud failure that stays until a save succeeds/,
  },
  {
    id: 'B130', what: 'the draft autosave hears a change before the stores',
    file: 'projects/draw/src/editor.ts', from: "      if (why.kind !== 'drag') this.#bump();\n", to: "      if (why.kind !== 'drag') this.#changed();\n      if (why.kind !== 'drag') this.#bump();\n",
    run: drawTests('editor.test.ts'), expect: /✖ change listeners \(the draft autosave\) hear every change last/,
  },
  {
    id: 'B131', what: 'the end of a scrub or a sheet is never saved',
    file: 'projects/draw/src/editor.ts', from: '    else live.drag.cancel();\n    this.#bump();\n    this.#changed();\n', to: '    else live.drag.cancel();\n    this.#bump();\n',
    run: drawTests('editor.test.ts'), expect: /✖ change listeners \(the draft autosave\) hear every change last/,
  },
  {
    id: 'B132', what: 'a read-only document takes edits',
    file: 'projects/draw/src/editor.ts', from: '    if (!this.readOnly.get()) return true;', to: '    return true;',
    run: drawTests('editor.test.ts'), expect: /✖ a read-only document refuses every edit/,
  },
  {
    id: 'B133', what: 'the autosave hears changes to a document it is not bound to',
    file: 'projects/draw/src/workspace.ts', from: 'if (editor.doc && editor.doc === this.#doc) this.autosave.changed();', to: 'if (editor.doc) this.autosave.changed();',
    run: drawTests('workspace.test.ts'), expect: /✖ the autosave hears a change last, after the stores; only for the document it is bound to/,
  },
  {
    id: 'B134', what: 'an #import fragment stays in the URL (a reload imports it again)',
    file: 'projects/draw/src/workspace.ts', from: '    clearFragment();\n', to: '',
    run: drawTests('workspace.test.ts'), expect: /✖ an #import link opens with its report/,
  },
  {
    id: 'B135', what: 'the as-is export normalizes line ends',
    file: 'projects/draw/src/export/svg.ts', from: '  const { bytes, encoding, relabeled } = encodeSvg(text, read);', to: "  const { bytes, encoding, relabeled } = encodeSvg(text.replace(/\\r\\n/g, '\\n'), read);",
    run: drawTests('workspace.test.ts'), expect: /✖ export: as-is is the file byte for byte/,
  },
  {
    id: 'B136', what: 'a cancelled share counts as an export',
    file: 'projects/draw/src/workspace.ts', from: "    if (outcome === 'cancelled') return;\n", to: '',
    run: drawTests('workspace.test.ts'), expect: /✖ export: as-is is the file byte for byte/,
  },
  {
    id: 'B137', what: 'the import report no longer lists external entities',
    file: 'engine/report/import-report.ts', from: '  if (external.length) notes.push(', to: '  if (false) notes.push(',
    run: engineTests('report/import-report.test.ts'), expect: /✖ external entities a DOCTYPE declares are listed in the notes/,
  },
  {
    id: 'B138', what: 'the Support search looks only at ids',
    file: 'projects/draw/src/support.ts', from: "const haystack = (r: LedgerRow): string => [r.id, r.name,", to: "const haystack = (r: LedgerRow): string => [r.id].join('') || [r.id, r.name,",
    run: drawTests('support.test.ts'), expect: /✖ the search finds rows by every word, in any field/,
  },
  {
    id: 'B139', what: 'the import report sheet drops the attributes',
    file: 'projects/draw/src/files-view.ts', from: "attributes: pick('attribute')", to: 'attributes: []',
    run: drawTests('files-view.test.ts'), expect: /✖ the report sheet shows all four buckets with their counts, and every item once/,
  },
  {
    id: 'B140', what: 'the "not exported" reminder counts from the last edit',
    file: 'projects/draw/src/files-view.ts', from: '(now - (d.exported ?? d.created))', to: '(now - d.updated)',
    run: drawTests('files-view.test.ts'), expect: /✖ the draft list: newest first as given/,
  },
  {
    id: 'B150', what: "a draft's pending save reads whatever document is open by then",
    file: 'projects/draw/src/workspace.ts', from: 'text: () => serialize(doc),', to: 'text: () => this.#editor.source(),',
    run: drawTests('workspace.test.ts'), expect: /✖ a change still waiting when another document opens is saved to its own draft/,
  },
  {
    id: 'B141', what: 'the file input no longer lists .svg (iOS offers only what it lists)', slow: true,
    file: 'projects/draw/src/panels/FileSheets.tsx', from: 'accept=".svg,.svgz,image/svg+xml"', to: 'accept="image/svg+xml"',
    run: SITE_E2E, expect: /the file input does not list \.svg/,
  },
  {
    id: 'B142', what: 'a paste outside a field opens nothing', slow: true,
    file: 'projects/draw/src/panels/App.tsx', from: "    window.addEventListener('paste', paste);\n", to: '',
    run: SITE_E2E, expect: /a paste of image\/svg\+xml was not taken/,
  },
  {
    id: 'B143', what: 'the canvas refuses a dragged file', slow: true,
    file: 'projects/draw/src/panels/Canvas.tsx', from: '      onDragOver={(e: ReactDragEvent) => onDrag(e.nativeEvent)}\n', to: '',
    run: SITE_E2E, expect: /the canvas does not accept a dragged file/,
  },
  {
    id: 'B144', what: 'pagehide does not save the pending change', slow: true,
    file: 'projects/draw/src/panels/App.tsx', from: "    window.addEventListener('pagehide', flush);\n", to: '',
    run: SITE_E2E, expect: /pagehide did not save at once/,
  },
  {
    id: 'B145', what: 'the drafts live in memory, so a reload loses them', slow: true,
    file: 'projects/draw/src/panels/App.tsx', from: 'new DraftStore(idbKV())', to: 'new DraftStore({ get: async () => undefined, set: async () => {}, del: async () => {}, keys: async () => [] })',
    run: SITE_E2E, expect: /the edit made just before a real reload was lost|timed out waiting until the edited link reopens as a draft/,
  },
  {
    id: 'B146', what: 'a second tab takes the lock too (no Web Locks)', slow: true,
    file: 'projects/draw/src/panels/App.tsx', from: 'lock: lockDraft, sample', to: 'lock: async () => () => {}, sample',
    run: SITE_E2E, expect: /the second page does not say the drawing is read-only/,
  },
  {
    id: 'B147', what: 'a full quota shows as a quiet notice, not a loud alert', slow: true,
    file: 'projects/draw/src/panels/App.tsx', from: '<div className="draw-alert draw-alert--loud" role="alert">', to: '<div className="draw-alert" role="status">',
    run: SITE_E2E, expect: /a full quota shows no alert/,
  },
  {
    id: 'B148', what: 'the ledger is in the initial bundle', slow: true,
    file: 'projects/draw/src/panels/Support.tsx', from: 'let loading: Promise<Ledger> | null = null;', to: "import LEDGER_RAW from '../../../../engine/ledger/ledger.json?raw';\nlet loading: Promise<Ledger> | null = Promise.resolve(JSON.parse(LEDGER_RAW) as Ledger);",
    run: SITE_E2E, expect: /the ledger is in the initial JS/,
  },
  {
    id: 'B149', what: "a draft's Delete drops under the 44pt floor", slow: true,
    file: 'projects/draw/src/app.css', from: '.draw-draft-delete { align-self: center; font-size: var(--text-sm); }', to: '.draw-draft-delete { align-self: center; font-size: var(--text-sm); min-height: 2rem; }',
    run: SITE_E2E, expect: /the Files menu with drafts: tap targets under 44pt/,
  },
  // The P0-M4 review.
  {
    id: 'B151', what: 'RDF metadata counts as editable again (the class a whole namespace takes)',
    file: 'engine/policy/tables.ts', from: "['http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'preserve-hidden'],", to: "['http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'edit'],",
    run: engineTests('report/import-report.test.ts'), expect: /✖ metadata \(RDF, Dublin Core, Creative Commons\) is kept as-is/,
  },
  {
    id: 'B152', what: "a plain attribute on an Inkscape element is looked up as an SVG attribute",
    file: 'engine/policy/classify.ts', from: '  if (attrNs === null && elNs !== NS.svg && elNs !== NS.xhtml) return classifyElement(elNs, elLocal);\n', to: '',
    run: engineTests('report/import-report.test.ts'), expect: /✖ a plain attribute on a foreign element takes that element's class/,
  },
  {
    id: 'B153', what: "a record that isn't a draft is read as one (IndexedDB is shared by the whole origin)",
    file: 'projects/draw/src/platform/drafts.ts', from: '  return (\n    d.id === id &&', to: '  return true || (\n    d.id === id &&',
    run: drawTests('drafts.test.ts'), expect: /✖ a record that isn't a draft Draw wrote is listed as unreadable/,
  },
  {
    id: 'B154', what: 'boot reopens the newest record, readable or not',
    file: 'projects/draw/src/workspace.ts', from: 'latest = (await this.#store.list()).find((d) => !d.unreadable)?.id;', to: 'latest = (await this.#store.list())[0]?.id;',
    run: drawTests('workspace.test.ts'), expect: /✖ a record that isn't a draft never reaches the app/,
  },
  {
    id: 'B155', what: 'a draft save reads the record before writing it (a pagehide flush then lands too late)',
    file: 'projects/draw/src/autosave.ts', from: '      } else if (b.draft) {', to: '      } else if (b.draft && (await this.#store.load(b.id))) {',
    run: drawTests('autosave.test.ts'), expect: /✖ a save writes the record the binding holds: no read first/,
  },
  {
    id: 'B156', what: 'a draft write waits for the task to end to commit (a real unload loses it)', slow: true,
    file: 'projects/draw/src/platform/drafts.ts', from: '        s.transaction.commit?.();\n', to: '',
    run: SITE_E2E, expect: /the edit made just before a real reload was lost/,
  },
  {
    id: 'B157', what: "opening another drawing doesn't try the failed save again",
    file: 'projects/draw/src/autosave.ts', from: '    const retry = new Set(this.#unsaved);\n    if (this.#timer !== null) {\n      this.#timers.clear(this.#timer);\n      this.#timer = null;\n      if (prev) retry.add(prev);', to: '    const retry = new Set<Binding>();\n    if (this.#timer !== null) {\n      this.#timers.clear(this.#timer);\n      this.#timer = null;\n      if (prev) retry.add(prev);',
    run: drawTests('autosave.test.ts'), expect: /✖ a failed save names its drawing and stays up while another is open/,
  },
  {
    id: 'B158', what: 'reopening a draft whose save failed opens the older stored text',
    file: 'projects/draw/src/workspace.ts', from: '    if (unsaved) return this.#open(', to: '    if (false) return this.#open(',
    run: drawTests('workspace.test.ts'), expect: /✖ a failed save stays loud while another draft is open, and reopening its draft brings the unsaved edit back/,
  },
  {
    id: 'B159', what: 'reopening a draft whose save failed here finds its own lock taken (read-only)',
    file: 'projects/draw/src/autosave.ts', from: '    const heir = to.id === null ? undefined : [...this.#unsaved].find((u) => u.id === to.id);', to: '    const heir = undefined as Binding | undefined;',
    run: drawTests('autosave.test.ts'), expect: /✖ a failed save names its drawing and stays up while another is open/,
  },
  {
    id: 'B160', what: "the failure alert doesn't say which drawing isn't saved",
    file: 'projects/draw/src/autosave.ts', from: "  const which = name ? `“${name}”` : 'this drawing';", to: "  const which = 'this drawing';",
    run: drawTests('autosave.test.ts'), expect: /✖ a failed save names its drawing and stays up while another is open/,
  },
  {
    id: 'B161', what: 'export re-derives the encoding from the text (UTF-16 without a declaration becomes UTF-8)',
    file: 'projects/draw/src/workspace.ts', from: "current?.encoding ?? undefined", to: 'undefined',
    run: drawTests('workspace.test.ts'), expect: /✖ export: as-is is the file byte for byte/,
  },
  {
    id: 'B162', what: 'encodeSvg ignores the encoding the file was read in',
    file: 'projects/draw/src/platform/files.ts', from: "  let encoding = read ?? 'utf-8';\n  if (read === undefined && m) {", to: "  let encoding = 'utf-8';\n  if (m) {",
    run: drawTests('files.test.ts'), expect: /✖ a file is written back as decodeSvg read it/,
  },
  {
    id: 'B163', what: 'bytes that are not valid become U+FFFD silently',
    file: 'projects/draw/src/platform/files.ts', from: '{ ignoreBOM: true, fatal: true }', to: '{ ignoreBOM: true }',
    run: drawTests('files.test.ts'), expect: /✖ a file is written back as decodeSvg read it/,
  },
  {
    id: 'B164', what: 'a file past the size limit is read whole before it is refused',
    file: 'projects/draw/src/platform/files.ts', from: '  if (file.size > MAX_SVG_BYTES) throw new FileTooLargeError', to: '  if (false) throw new FileTooLargeError',
    run: drawTests('files.test.ts'), expect: /✖ a file past the size limit is refused before it is read/,
  },
  {
    id: 'B165', what: "a file that can't be read throws instead of saying so",
    file: 'projects/draw/src/import.ts', from: '      return failed(input, `it could not be read (${why(e)})`);', to: '      throw e;',
    run: drawTests('import.test.ts'), expect: /✖ a picked or dropped file is read by the importer/,
  },
  {
    id: 'B166', what: 'an #import link drops a UTF-8 BOM',
    file: 'projects/draw/src/platform/files.ts', from: "new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)", to: "new TextDecoder('utf-8').decode(bytes)",
    run: drawTests('files.test.ts'), expect: /✖ #import links round-trip a file/,
  },
  {
    id: 'B167', what: 'a BOM counts as a column on line 1',
    file: 'projects/draw/src/import.ts', from: '    if (text.charCodeAt(0) === 0xfeff && at > 0) [text, at] = [text.slice(1), at - 1];\n', to: '',
    run: drawTests('import.test.ts'), expect: /✖ a BOM is not a column/,
  },
  {
    id: 'B168', what: "a drawing's name keeps a bidi override from its <title>",
    file: 'projects/draw/src/import.ts', from: 'const FORMAT = /\\p{Cf}/gu;', to: 'const FORMAT = /(?!)/gu;',
    run: drawTests('import.test.ts'), expect: /✖ a drawing name drops format characters/,
  },
  {
    id: 'B169', what: 'an export file name keeps a bidi override',
    file: 'projects/draw/src/export/svg.ts', from: ".replace(/\\p{Cf}/gu, '')", to: '',
    run: drawTests('import.test.ts'), expect: /✖ a drawing name drops format characters/,
  },
  {
    id: 'B170', what: 'an #import link is stored as a draft at once (a large one slows every later load)',
    file: 'projects/draw/src/workspace.ts', from: "await this.#open({ via: 'link', name: '', text }, { show: true })", to: "await this.#open({ via: 'link', name: '', text }, { show: true, create: true })",
    run: drawTests('workspace.test.ts'), expect: /✖ an #import link opens with its report, and becomes a draft on its first change/,
  },
  {
    id: 'B171', what: 'a link that arrives while Draw is open opens without a tap',
    file: 'projects/draw/src/workspace.ts', from: "    this.offer.set(fragment);\n    this.show('link');", to: "    void this.openLink(fragment, () => {});",
    run: drawTests('workspace.test.ts'), expect: /✖ a link that arrives while Draw is open waits for Open/,
  },
  {
    id: 'B172', what: 'a failure without a line starts in lower case',
    file: 'projects/draw/src/files-view.ts', from: 'f.message.charAt(0).toUpperCase() + f.message.slice(1)', to: 'f.message',
    run: drawTests('files-view.test.ts'), expect: /✖ why an open failed reads as one sentence/,
  },
  {
    id: 'B173', what: 'a PNG is reported as a parse error at line 1, column 1',
    file: 'projects/draw/src/import.ts', from: "  if (!/^\\uFEFF?\\s*</.test(text)) return failed(input, 'this isn’t an SVG file');\n", to: '',
    run: drawTests('import.test.ts'), expect: /✖ a file that isn't markup \(a PNG, a text file\) says so/,
  },
  {
    id: 'B174', what: 'an error in parentheses keeps its own period (".)." at the end)',
    file: 'projects/draw/src/import.ts', from: ".replace(/\\.+$/, '');", to: ';',
    run: drawTests('import.test.ts'), expect: /✖ a picked or dropped file is read by the importer/,
  },
  {
    id: 'B175', what: 'hiding the page (visibilitychange) does not save the pending change', slow: true,
    file: 'projects/draw/src/panels/App.tsx', from: "    document.addEventListener('visibilitychange', hidden);\n", to: '',
    run: SITE_E2E, expect: /hiding the page did not save at once/,
  },
  // The unit test stops the site build first, so this one runs there; e2e exportIsTheFileByteForByte
  // ("the draft still says it was not exported") catches it too, in a build without the unit run.
  {
    id: 'B176', what: "an export no longer resets the draft's reminder",
    file: 'projects/draw/src/workspace.ts', from: '    await this.autosave.markExported();\n', to: '',
    run: drawTests('workspace.test.ts'), expect: /✖ export: as-is is the file byte for byte/,
  },
  {
    id: 'B177', what: 'the as-is export writes the file as opened, not as edited',
    file: 'projects/draw/src/export/svg.ts', from: "  const text = clean ? clean.text : kind === 'as-is' ? stripDrawState(doc) : serialize(doc);", to: '  const text = clean ? clean.text : doc.source;',
    run: drawTests('workspace.test.ts'), expect: /✖ export: as-is is the file byte for byte/,
  },
  {
    id: 'B178', what: 'a link that arrives in the open tab (a page that opened Draw) opens without a tap', slow: true,
    file: 'projects/draw/src/panels/App.tsx', from: 'const link = () => void workspace.offerLink(fragment(), clearFragment);', to: 'const link = () => void workspace.openLink(fragment(), clearFragment);',
    run: SITE_E2E, expect: /a link that arrived in the open tab was not offered first/,
  },
  {
    id: 'B179', what: 'a notice raised from the Files menu is hidden under it', slow: true,
    file: 'projects/draw/src/app.css', from: '  z-index: 12; /* above the modal sheets', to: '  z-index: 5; /* above the modal sheets',
    run: SITE_E2E, expect: /the notice is under/,
  },
  {
    id: 'B180', what: 'with the keyboard up, a tall sheet goes off the top of the screen', slow: true,
    file: 'projects/draw/src/panels/Sheets.tsx', from: 'style={inset ? { bottom: inset, maxHeight: `calc(85svh - ${inset}px)` } : undefined}', to: 'style={inset ? { bottom: inset } : undefined}',
    run: SITE_E2E, expect: /is off the screen left above the keyboard/,
  },
  {
    id: 'B181', what: "Support rows don't show a capability's or a feature's name", slow: true,
    file: 'projects/draw/src/panels/Support.tsx', from: "{(r.kind === 'capability' || r.kind === 'feature') && <span", to: '{false && <span',
    run: SITE_E2E, expect: /does not show its name/,
  },
  {
    id: 'B182', what: 'the Support summary stays between the search and the rows it found', slow: true,
    file: 'projects/draw/src/panels/Support.tsx', from: '{!query.trim() && (', to: '{true && (',
    run: SITE_E2E, expect: /the summary stays between the search and the rows it found/,
  },
  {
    id: 'B183', what: 'the Export sheet calls the plain .svg of a .svgz "exactly as it is"', slow: true,
    file: 'projects/draw/src/panels/FileSheets.tsx', from: 'say: (_removed, gzip) => (gzip ?', to: 'say: (_removed, gzip) => (false ?',
    run: SITE_E2E, expect: /the sheet says ".*" for a \.svgz/,
  },
  {
    id: 'B184', what: 'a panel that throws blanks the app (no error boundary)', slow: true,
    file: 'projects/draw/src/panels/Guard.tsx', from: '  static getDerivedStateFromError(', to: '  static notAnErrorBoundary(',
    run: SITE_E2E, expect: /a panel that threw left no message/,
  },
  {
    id: 'B185', what: 'an unreadable draft is offered to open', slow: true,
    file: 'projects/draw/src/panels/FileSheets.tsx', from: '{d.unreadable ? (', to: '{false ? (',
    run: SITE_E2E, expect: /an unreadable draft can be opened/,
  },
  {
    id: 'B186', what: 'a paste opens without its import report',
    file: 'projects/draw/src/workspace.ts', from: 'return this.#open({ via, name, text }, { show: true, create: true });', to: "return this.#open({ via, name, text }, { show: via !== 'paste', create: true });",
    run: drawTests('workspace.test.ts'), expect: /✖ a paste opens like any file: through the importer, with its report/,
  },
  {
    id: 'B187', what: 'Clean counts each removed element twice',
    file: 'engine/export/clean.ts', from: '    removedElements++;', to: '    removedElements += 2;',
    run: engineTests('export/clean.test.ts'), expect: /✖ Inkscape and Illustrator files lose exactly their editor markup/,
  },
  {
    id: 'B188', what: 'a flush no longer writes the unload journal (Safari drops an IndexedDB write started in pagehide)',
    file: 'projects/draw/src/autosave.ts', from: "if (this.#timer !== null && b && !b.readOnly) this.#journal.write(", to: "if (false && this.#timer !== null && b && !b.readOnly) this.#journal.write(",
    run: drawTests('autosave.test.ts'), expect: /✖ a flush writes the pending change to the unload journal at once/,
  },
  {
    id: 'B189', what: 'the next load no longer replays the unload journal',
    file: 'projects/draw/src/workspace.ts', from: '    await this.#replayJournal();\n', to: '',
    run: drawTests('workspace.test.ts'), expect: /✖ an unload journal whose save never landed is replayed/,
  },
  // ── P0-M5: the code panel's tools ────────────────────────────────────────────────────────────
  {
    id: 'B190', what: 'the tidy view keeps a tag too wide for the panel on one line',
    file: 'projects/draw/src/codeview/layout.ts', from: 'if (!spansLines && (indent.length + oneLine <= cols || attrs.length === 1)) {', to: 'if (true) {',
    run: drawTests('code-panel.test.ts'), expect: /✖ the tidy view lays a minified file out one element a line/,
  },
  {
    id: 'B191', what: "the tidy view doesn't measure the panel again when it changes size", slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: 'if (this.tidyOn && !this.raw && this.measure()) this.rebuild();', to: 'if (false) this.rebuild();',
    run: SITE_E2E, expect: /the width was not measured again/,
  },
  {
    id: 'B192', what: 'the tidy view shows a character that is not whitespace in place of whitespace',
    file: 'projects/draw/src/codeview/layout.ts', from: 'swaps.push({ at: a.lead[0], end: a.lead[1], text: `\\n${inner}` });', to: 'swaps.push({ at: a.lead[0], end: a.lead[1], text: `\\n${inner}·` });',
    run: drawTests('code-panel.test.ts'), expect: /✖ the tidy view swaps only whitespace, never inside a token/,
  },
  {
    id: 'B193', what: 'the code view loses where a block sits in the tree (every block at the root)',
    file: 'projects/draw/src/codeview/blocks.ts', from: '  for (let p = n.parent; p !== null; p = doc.nodes.get(p)?.parent ?? null) d++;\n', to: '',
    run: drawTests('code-panel.test.ts'), expect: /✖ the code is always the whole file inside its root <svg>/,
  },
  {
    id: 'B194', what: "the legend's number is not the colour of the numbers it explains", slow: true,
    file: 'projects/draw/src/app.css', from: '.cv-number, .cv-key--number { color: var(--cv-number); }', to: '.cv-number { color: var(--cv-number); }\n.cv-key--number { color: var(--cv-word); }',
    run: SITE_E2E, expect: /the legend shows a number as/,
  },
  {
    id: 'B195', what: "a colour token's swatch is its text, not the colour the engine read",
    file: 'projects/draw/src/codeview/blocks.ts', from: "  return toHex(t.color) ?? 'context';", to: '  return t.text;',
    run: drawTests('code-panel.test.ts'), expect: /✖ a colour token carries the swatch the engine read/,
  },
  {
    id: 'B196', what: "a colour's swatch is not painted", slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: "if (t.swatch.startsWith('#')) sw.style.setProperty('--cv-swatch', t.swatch);", to: "if (t.swatch.startsWith('#')) void 0;",
    run: SITE_E2E, expect: /the #ffd166 swatch is/,
  },
  {
    id: 'B197', what: 'both arrow keys step a number up',
    file: 'projects/draw/src/editor.ts', from: "this.stepFocus(key === 'up' ? 1 : -1);", to: 'this.stepFocus(1);',
    run: drawTests('editor.test.ts'), expect: /✖ the keyboard: Enter or Space on a number opens its Number sheet/,
  },
  {
    id: 'B198', what: 'code tokens cannot be focused (no keyboard)', slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: '    if (!this.ro) span.tabIndex = 0;\n', to: '',
    run: SITE_E2E, expect: /a token cannot be focused/,
  },
  {
    id: 'B199', what: 'read-only code keeps its token colours', slow: true,
    file: 'projects/draw/src/app.css', from: '.cv--ro .cv-tok { color: inherit; font-weight: inherit; }', to: '',
    run: SITE_E2E, expect: /read-only tokens are still coloured/,
  },
  {
    id: 'B200', what: 'a tap on a read-only number opens the Scrub strip',
    file: 'projects/draw/src/editor.ts', from: "    if (t.kind !== 'ref' && !this.#writable()) return; // read-only: plain text, and a tap says why\n", to: '',
    run: drawTests('editor.test.ts'), expect: /✖ a read-only document refuses every edit and says why/,
  },
  {
    id: 'B201', what: 'Copy puts the file as it was opened on the clipboard, not as it is now',
    file: 'projects/draw/src/workspace.ts', from: '(doc ? stripDrawState(doc) : null)', to: '(doc ? doc.source : null)',
    run: drawTests('workspace.test.ts'), expect: /✖ Copy puts the file on the clipboard exactly as it is/,
  },
  {
    id: 'B202', what: 'a refused clipboard write counts as copied',
    file: 'projects/draw/src/platform/clipboard.ts', from: '    return false; // blocked', to: '    return true; // blocked',
    run: drawTests('code-panel.test.ts'), expect: /✖ Copy writes the clipboard \(never reads it\)/,
  },
  {
    id: 'B203', what: 'Copy is not wired to its button', slow: true,
    file: 'projects/draw/src/panels/CodePanel.tsx', from: 'className="draw-bar-key draw-copy" onClick={copy}>', to: 'className="draw-bar-key draw-copy">',
    run: SITE_E2E, expect: /Copy said nothing/,
  },
  {
    id: 'B204', what: "a file that isn't well-formed opens nowhere (no source view)",
    file: 'projects/draw/src/workspace.ts', from: '      if (r.source) return this.#showSource(r as Unparsed);\n', to: '',
    run: drawTests('workspace.test.ts'), expect: /✖ a file that isn't well-formed opens as read-only source through the one importer/,
  },
  {
    id: 'B205', what: "the source view doesn't mark where the file fails", slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: "    mark.className = 'cv-error';", to: "    mark.className = 'cv-mark';",
    run: SITE_E2E, expect: /the mark is on null/,
  },
  {
    id: 'B206', what: 'the source view leaves the drawing before it on the canvas',
    file: 'projects/draw/src/editor.ts', from: '    this.#ports.canvas.clear();\n    this.#ports.code.source(text, at);', to: '    this.#ports.code.source(text, at);',
    run: drawTests('editor.test.ts'), expect: /✖ a file shown as source: its text in the code/,
  },
  {
    id: 'B207', what: 'wide screens stack the code under the canvas (no dock)', slow: true,
    file: 'projects/draw/src/app.css', from: '  .draw-split { flex-direction: row; }', to: '',
    run: SITE_E2E, expect: /the code is not docked beside the canvas/,
  },
  {
    id: 'B208', what: 'a render error during an edit is not caught',
    file: 'projects/draw/src/editor.ts', from: '      } catch {\n        this.#redraw();\n      }', to: '      } finally {\n        void 0;\n      }',
    run: drawTests('editor.test.ts'), expect: /✖ a render error: the whole drawing is drawn again from the model/,
  },
  {
    id: 'B209', what: 'a canvas that could not draw says nothing', slow: true,
    file: 'projects/draw/src/panels/Canvas.tsx', from: '  if (broken) {', to: '  if (false) {',
    run: SITE_E2E, expect: /a canvas that could not draw says nothing/,
  },
  {
    id: 'B210', what: 'every edit flashes the whole block, not only the token that changed', slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: '    if (changed === null) flash(el);\n    else for (const i of changed)', to: '    flash(el);\n    if (changed === null) for (const i of [] as number[])',
    run: SITE_E2E, expect: /the flash is on the whole block, not only the token that changed/,
  },
  {
    id: 'B211', what: 'an edit counts every token of the block as changed',
    file: 'projects/draw/src/codeview/blocks.ts', from: '    if (a.text.slice(s.start, s.end) !== b.text.slice(t.start, t.end)) out.push(i);', to: '    out.push(i);',
    run: drawTests('code-panel.test.ts'), expect: /✖ an edit flashes only the tokens it changed/,
  },
  {
    id: 'B212', what: 'holding − or + steps once, then never repeats',
    file: 'projects/draw/src/repeat.ts', from: '      fn();\n      this.#handle = this.#timers.set(tick, HOLD_EVERY);\n', to: '      fn();\n',
    run: drawTests('code-panel.test.ts'), expect: /✖ hold to repeat/,
  },
  {
    id: 'B213', what: "the Number sheet's slider ignores the artboard (always -100 to 200)",
    file: 'projects/draw/src/token-edit.ts', from: "  const e = t.unit === '%' || !(extent > 0) ? 100 : extent;", to: '  const e = 100;',
    run: drawTests('code-panel.test.ts'), expect: /✖ the Number sheet's slider/,
  },
  {
    id: 'B214', what: 'the Number sheet steps once however long + is held', slow: true,
    file: 'projects/draw/src/panels/Sheets.tsx', from: '      repeat.start(() => put(steppedFrom(t, latest.current, d)));', to: '      put(steppedFrom(t, latest.current, d));',
    run: SITE_E2E, expect: /holding \+ for a second wrote r=43/,
  },
  {
    id: 'B215', what: 'Escape no longer closes a sheet', slow: true,
    file: 'projects/draw/src/panels/Sheets.tsx', from: "const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();", to: 'const key = (_e: KeyboardEvent) => false;',
    run: SITE_E2E, expect: /Escape did not close the sheet/,
  },
  {
    id: 'B216', what: 'the click of the tap that opened a sheet reaches a control in it', slow: true,
    file: 'projects/draw/src/panels/Sheets.tsx', from: '          if (pressed.current || e.detail === 0 || performance.now() - opened.current > GHOST_CLICK_MS) return;', to: '          return;',
    run: SITE_E2E, expect: /the tap that opened the Color sheet picked a colour in it/,
  },
  {
    id: 'B217', what: 'Dark chosen in Files does not override a light system', slow: true,
    file: 'projects/draw/src/app.css', from: ':root[data-theme="dark"] {\n  --bg: #111111;', to: ':root[data-theme="none"] {\n  --bg: #111111;',
    run: SITE_E2E, expect: /Dark chosen in Files over a light system shows/,
  },
  {
    id: 'B218', what: 'the code keeps its light colours when the system goes dark', slow: true,
    file: 'projects/draw/src/app.css', from: '  :root:not([data-theme="light"]) .draw { --draw-danger', to: '  :root:not(:root) .draw { --draw-danger',
    run: SITE_E2E, expect: /the code did not recolour when the system went dark/,
  },
  {
    id: 'B219', what: 'reduced motion pauses a drawing with no Play to start it', slow: true,
    file: 'projects/draw/src/panels/Canvas.tsx', from: "  if (motion === 'paused' || motion === 'playing') {", to: '  if (false) {',
    run: SITE_E2E, expect: /an animated drawing under reduced motion offers no Play/,
  },
  {
    id: 'B220', what: 'reduced motion pauses a drawing at its start (a fade-in shows nothing)', slow: true,
    file: 'projects/draw/src/canvas/renderer.ts', from: '        (dom as SVGSVGElement).setCurrentTime(stillTime(dom as SVGSVGElement));\n', to: '',
    run: SITE_E2E, expect: /not the frame where the fade has arrived/,
  },
  {
    id: 'B221', what: "Play doesn't let a drawing's CSS animations run", slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: ':host(:not(.draw-play):not(.draw-held)) *, :host(:not(.draw-play):not(.draw-held)) *::before, :host(:not(.draw-play):not(.draw-held)) *::after {', to: '*, *::before, *::after {',
    run: SITE_E2E, expect: /Play did not start the CSS animation/,
  },
  {
    // (A wider SLOP itself is caught first, by viewport.test.ts in the build: B275.)
    id: 'B222', what: 'a touch that moves 8pt on the canvas is still a tap (the canvas reads a move at half its distance)', slow: true, checks: ['aShortMoveOnTheCanvasIsATap'],
    file: 'projects/draw/src/canvas/stage.ts', from: 'x: e.clientX - box.left, y: e.clientY - box.top, t: e.timeStamp', to: 'x: (e.clientX - box.left) / 2, y: (e.clientY - box.top) / 2, t: e.timeStamp',
    run: DRAW_E2E, expect: /a touch that moved 8pt did not move the circle/,
  },
  {
    id: 'B223', what: "the code bar's buttons fall under the tap floor", slow: true,
    file: 'projects/draw/src/app.css', from: '  min-width: max(var(--tap-min), 3.75rem);\n  min-height: var(--tap-min);\n  padding: 0 var(--space-3);\n  border: 1px solid var(--line);\n  border-radius: var(--radius-sm);\n  background: var(--surface);\n  color: var(--text);\n  font: 600 var(--text-sm) / 1 var(--font-ui);', to: '  min-width: max(var(--tap-min), 3.75rem);\n  min-height: 2rem;\n  padding: 0 var(--space-3);\n  border: 1px solid var(--line);\n  border-radius: var(--radius-sm);\n  background: var(--surface);\n  color: var(--text);\n  font: 600 var(--text-sm) / 1 var(--font-ui);',
    run: SITE_E2E, expect: /the code bar: tap targets under 44pt/,
  },
  // P0-M5: the engine rows (the keep-as-is corpus, script and external URLs, the served profile).
  {
    id: 'B224', what: 'the canvas stops rendering a kept attribute (kerning)',
    file: 'engine/policy/render-policy.ts', from: "  if (attrNs === NS.xml && attrLocal === 'base') return false;\n", to: "  if (attrNs === NS.xml && attrLocal === 'base') return false;\n  if (attrLocal === 'kerning') return false;\n",
    run: engineTests('policy/render-corpus.test.ts'), expect: /✖ every kept \(preserve\) row of this phase that renders is drawn as written/,
  },
  {
    id: 'B225', what: 'the canvas stops rendering a kept element (tref)',
    file: 'engine/policy/render-policy.ts', from: '  if (ns === NS.svg) return RENDER_SVG_ELEMENTS.has(local);', to: "  if (ns === NS.svg) return local !== 'tref' && RENDER_SVG_ELEMENTS.has(local);",
    run: engineTests('policy/render-corpus.test.ts'), expect: /✖ every kept \(preserve\) row of this phase that renders is drawn as written/,
  },
  {
    id: 'B226', what: 'the served profile stops checking url() in presentation attributes and animated values',
    file: 'scripts/lib/svg-profile.mjs', from: "  else if (/url\\s*\\(|image-set\\s*\\(|\\\\/i.test(value) && !cssAllowed(value)) add('css', at);\n", to: '',
    run: drawTests('svg-profile.test.ts'), expect: /✖ never served: javascript: URLs, wherever a URL, url\(\) or animated value can hold one/,
  },
  {
    id: 'B227', what: "the canvas's URL allowlist lets a javascript: URL through",
    file: 'engine/policy/render-policy.ts', from: "  const ok = (u: string) => u.startsWith('#') || (DATA_IMAGE", to: "  const ok = (u: string) => u.startsWith('#') || /^javascript:/i.test(u) || (DATA_IMAGE",
    run: POLICY_TESTS, expect: /✖ never rendered: javascript: URLs/,
  },
  {
    id: 'B228', what: "the canvas's CSS reading forgets @import (B41's edit, seen by the @import test)",
    file: 'engine/policy/render-policy.ts', from: 'if (/image-set\\s*\\(|@import/.test(t)) return false;', to: 'if (/image-set\\s*\\(/.test(t)) return false;',
    run: POLICY_TESTS, expect: /✖ never rendered: @import, whatever its form/,
  },
  {
    id: 'B229', what: "the canvas's url() rule lets https resources load",
    file: 'engine/policy/render-policy.ts', from: "  const ok = (u: string) => u.startsWith('#') || CSS_DATA.test(u);", to: "  const ok = (u: string) => u.startsWith('#') || CSS_DATA.test(u) || /^https:/.test(u);",
    run: POLICY_TESTS, expect: /✖ never rendered: a resource on another site/,
  },
  {
    id: 'B230', what: 'the served profile lets an <image> load from another site',
    file: 'scripts/lib/svg-profile.mjs', from: "  if ((s === 'http' || s === 'https' || s === 'mailto') && el === 'a') return true;", to: "  if ((s === 'http' || s === 'https' || s === 'mailto') && (el === 'a' || el === 'image')) return true;",
    run: drawTests('svg-profile.test.ts'), expect: /✖ never served: a resource on another site/,
  },
  {
    id: 'B231', what: 'the served profile forgets xml:base',
    file: 'scripts/lib/svg-profile.mjs', from: "  if (attr.ns === XML_NS && local === 'base') { add('xml-base', at); return; }\n", to: '',
    run: drawTests('svg-profile.test.ts'), expect: /✖ never served: xml:base/,
  },
  {
    id: 'B232', what: 'the shared CSS guard forgets @import',
    file: 'scripts/lib/svg-profile.mjs', from: '  if (/@import|expression', to: '  if (/expression',
    run: drawTests('svg-profile.test.ts'), expect: /✖ never served: @import, whatever its form/,
  },
  {
    id: 'B233', what: "the import report says Draw's canvas never draws tref and altGlyph",
    file: 'engine/report/import-report.ts',
    from: "  if (drawn.length) notes.push(`Safari draws ${names(drawn)}, and so does Draw's canvas there; Chrome and Firefox do not.`);\n  if (hidden.length) notes.push(",
    to: "  if (webkitOnly.size) notes.push(`Safari draws ${names([...webkitOnly])}; Chrome, Firefox and Draw's canvas do not.`);\n  if (false) notes.push(",
    run: engineTests('report/import-report.test.ts'), expect: /✖ what only WebKit draws is flagged/,
  },
  {
    id: 'B234', what: 'duplicate ids stop being reported',
    file: 'engine/model/refs.ts', from: '  return [...index.ids].filter(([, list]) => list.length > 1).map(([id]) => id);', to: '  return [...index.ids].filter(([, list]) => list.length > 2).map(([id]) => id);',
    run: engineTests('report/import-report.test.ts'), expect: /✖ duplicate ids are kept as written/,
  },
  {
    id: 'B235', what: 'an internal parameter entity is read as a general one (and expanded)',
    file: 'engine/xml/entities.ts', from: '    if (m[1]) table.parameter.add(name);\n    else if (m[3])', to: '    if (m[1] && m[3]) table.parameter.add(name);\n    else if (m[3])',
    run: XML_TESTS, expect: /✖ parameter entities are recorded and never expanded/,
  },
  {
    // P1-M0 review (F2): an unterminated declaration's scan stops at the next '<'.
    id: 'B301', what: "an external entity's declaration is scanned to the next '>' again (quadratic over unterminated declarations)",
    file: 'engine/xml/entities.ts', from: `(SYSTEM|PUBLIC)\\\\b((?:[^<>"']|"[^"]*"|'[^']*')*)`, to: '(SYSTEM|PUBLIC)\\\\b([^>]*)',
    run: XML_TESTS, expect: /✖ a DOCTYPE full of unterminated entity declarations is read in linear time[\s\S]*250 KB of unterminated declarations took \d+ ms/,
  },
  {
    id: 'B236', what: "an edit rewrites a path's unparsed tail",
    file: 'engine/path/serialize.ts', from: "  return p.segs.map((s) => s.raw).join('') + p.tail;", to: "  return p.segs.map((s) => s.raw).join('') + p.tail.replace(/^,/, ' ');",
    run: engineTests('corpus/corpus.test.ts'), expect: /✖ a path is drawn up to its first error, and an edit before it keeps the unparsed rest byte for byte/,
  },
  {
    id: 'B237', what: 'the corpus loses its only inline-size',
    file: 'engine/test/fixtures/corpus/tools/inkscape-1x-plain-svg2-flowed-text.svg', from: 'white-space:pre;inline-size:180.5;fill', to: 'white-space:pre;fill',
    run: engineTests('corpus/corpus.test.ts'), expect: /✖ every kept \(preserve\) row of this phase occurs in the corpus/,
  },
  {
    id: 'B238', what: 'the shared CSS guard starts refusing a kept colour function (light-dark)',
    file: 'scripts/lib/svg-profile.mjs', from: '  if (/@import|expression\\s*\\(', to: '  if (/@import|light-dark\\s*\\(|expression\\s*\\(',
    run: engineTests('policy/render-corpus.test.ts'), expect: /✖ every kept \(preserve\) row of this phase that renders is drawn as written/,
  },
  {
    id: 'B239', what: 'the corpus loses its only <tref>',
    file: 'engine/test/fixtures/corpus/tools/edge-svg11-tref-altglyph.svg', from: 'Made by <tref xlink:href="#product-name"/></text>', to: 'Made by Northwind</text>',
    run: engineTests('corpus/corpus.test.ts'), expect: /✖ every kept \(preserve\) row of this phase occurs in the corpus/,
  },
  // P0-M5: the tests behind the P0 features, and @namespace's two forms.
  {
    id: 'B240', what: 'check-sinks forgets insertAdjacentHTML',
    file: 'projects/draw/tools/check-sinks.mjs', from: '|insertAdjacentHTML|', to: '|',
    run: drawTests('check-sinks.test.ts'), expect: /✖ check-sinks fails the build on planted HTML sinks/,
  },
  {
    id: 'B241', what: 'check-library --site stops checking the .svg files it serves',
    file: 'scripts/check-library.mjs', from: '    if (/\\.svg$/i.test(file)) for (const f of svgFindings(file)) out.push(`${rel}:${f}`);\n', to: '',
    run: drawTests('check-library.test.ts'), expect: /✖ check-library --site: every \.svg anywhere on the built site must be inert/,
  },
  {
    id: 'B242', what: "the canvas's CSS guard lets @namespace's url() through",
    file: 'engine/policy/render-policy.ts', from: "  const ok = (u: string) => u.startsWith('#') || CSS_DATA.test(u);", to: "  const ok = (u: string) => u.startsWith('#') || CSS_DATA.test(u) || u.startsWith('http://www.w3.org/2000/svg');",
    run: POLICY_TESTS, expect: /✖ @namespace: the string form renders; the url\(\) form is kept byte for byte/,
  },
  {
    id: 'B243', what: "the served profile's CSS guard lets @namespace's url() through",
    file: 'scripts/lib/svg-profile.mjs', from: "    if (u.startsWith('#')) continue;", to: "    if (u.startsWith('#') || u.startsWith('http://www.w3.org/2000/svg')) continue;",
    run: drawTests('svg-profile.test.ts'), expect: /✖ @namespace: a file with the string form is served; one with the url\(\) form is refused/,
  },
  // P0-M5: e2e checks as ledger evidence, and the phase gate after the P0 exit.
  {
    id: 'B244', what: 'a ledger row cites an e2e check that does not exist',
    file: 'engine/ledger/ledger.json', from: '"projects/draw/test/e2e.mjs#cspIsFirstAndEnforced"', to: '"projects/draw/test/e2e.mjs#cspIsFirstAndEnforce"',
    run: LEDGER_CHECK, expect: /feature:meta-csp: cspIsFirstAndEnforce is not a function in projects\/draw\/test\/e2e\.mjs/,
  },
  {
    id: 'B245', what: 'a cited e2e check is no longer run through check()',
    file: 'projects/draw/test/e2e.mjs', from: '  await check(cspIsFirstAndEnforced);\n', to: '',
    run: LEDGER_CHECK, expect: /feature:meta-csp: projects\/draw\/test\/e2e\.mjs#cspIsFirstAndEnforced is not run through check\(\)/,
  },
  {
    id: 'B246', what: 'a cited e2e check fails', slow: true,
    file: 'projects/draw/test/e2e.mjs', from: "must(first === 'meta Content-Security-Policy',", to: "must(first === 'no such element',",
    run: SITE_E2E_EVIDENCE, expect: /feature:meta-csp: cited e2e check did not pass in every call \(or did not run, or asserted nothing\): projects\/draw\/test\/e2e\.mjs#cspIsFirstAndEnforced/,
  },
  {
    id: 'B247', what: 'a cited e2e check is skipped (still called through check(), so the static check passes)', slow: true,
    file: 'projects/draw/test/e2e.mjs', from: '  await check(cspIsFirstAndEnforced);', to: "  if (origin === 'never') await check(cspIsFirstAndEnforced);",
    run: SITE_E2E_EVIDENCE, expect: /feature:meta-csp: cited e2e check did not pass in every call \(or did not run, or asserted nothing\): projects\/draw\/test\/e2e\.mjs#cspIsFirstAndEnforced/,
  },
  {
    id: 'B248', what: 'e2e evidence older than the e2e is taken as evidence',
    create: '.smoke/stale-e2e-evidence.jsonl', content: '',
    run: ['sh', ['-c', 'touch -d 2000-01-01 .smoke/stale-e2e-evidence.jsonl && node projects/draw/tools/ledger-check.mjs --e2e-evidence .smoke/stale-e2e-evidence.jsonl'], REPO],
    expect: /stale-e2e-evidence\.jsonl: older than projects\/draw\/test\/e2e\.mjs/,
  },
  {
    id: 'B249', what: 'a phase-0 row is reopened after the P0 exit',
    file: 'engine/ledger/ledger.json', from: '"group":"P0","phase":0,"status":"done","tests":["projects/draw/test/e2e.mjs#cspIsFirstAndEnforced"]', to: '"group":"P0","phase":0,"status":"planned","tests":["projects/draw/test/e2e.mjs#cspIsFirstAndEnforced"]',
    run: LEDGER_CHECK, expect: /feature:meta-csp: phase 0 is behind the current phase 1 but the row is planned/,
  },
  // P0-M5 review fixes: the served profile (version 4).
  {
    id: 'B250', what: "the served profile reads a url() only when it is closed",
    file: 'scripts/lib/svg-profile.mjs', from: "  for (const m of t.matchAll(/url\\s*\\(\\s*['\"]?/g)) {\n    const u = squash(t.slice(m.index + m[0].length));", to: "  for (const m of t.matchAll(/url\\s*\\(\\s*(['\"]?)(.*?)\\1\\s*\\)/g)) {\n    const u = squash(m[2]);",
    run: drawTests('svg-profile.test.ts'), expect: /✖ never served: a resource on another site[^\n]*\n[\s\S]*a fill never closed/,
  },
  {
    id: 'B251', what: 'the served profile reads CSS only with its comments removed',
    file: 'scripts/lib/svg-profile.mjs', from: "return [t, t.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')].every(cssReadingAllowed);", to: "return cssReadingAllowed(t.replace(/\\/\\*[\\s\\S]*?\\*\\//g, ''));",
    run: drawTests('svg-profile.test.ts'), expect: /✖ never served: @import, whatever its form/,
  },
  {
    id: 'B252', what: 'the served profile lets an XHTML srcset or background through',
    file: 'scripts/lib/svg-profile.mjs', from: "  if (el.ns === XHTML_NS && (local === 'srcset' || local === 'background')) { add('url', at); return; }\n", to: '',
    run: drawTests('svg-profile.test.ts'), expect: /✖ never served: a resource on another site[^\n]*\n[\s\S]*an HTML srcset/,
  },
  // P0-M5 review fixes: a file over Draw's limits is refused, not shown as "not well-formed" source.
  {
    id: 'B253', what: "the importer shows a file over Draw's limits as source",
    file: 'projects/draw/src/import.ts', from: "    if (kind === 'limit') return failed(input, `${message} (over Draw’s limits)`, text, at);\n", to: '',
    run: drawTests('import.test.ts'), expect: /✖ a well-formed file over Draw's limits opens nowhere, not even as source/,
  },
  {
    id: 'B254', what: 'the depth limit is reported as a well-formedness error',
    file: 'engine/xml/cst.ts', from: "message: `nesting deeper than ${limits.maxDepth}`, kind: 'limit' }", to: 'message: `nesting deeper than ${limits.maxDepth}` }',
    run: XML_TESTS, expect: /✖ a limit failure says so \(kind 'limit'\)/,
  },
  {
    id: 'B255', what: 'an entity that expands too far is reported as a well-formedness error',
    file: 'engine/xml/entities.ts', from: "export class EntityBudgetError extends Error {\n  readonly kind = 'limit';", to: "export class EntityBudgetError extends Error {\n  readonly kind = undefined;",
    run: XML_TESTS, expect: /✖ a limit failure says so \(kind 'limit'\)/,
  },
  // P0-M5 review fixes: the e2e evidence (a check that asserts nothing, fails for one of its
  // arguments, or ran before its helpers or the build changed is no evidence).
  {
    id: 'B256', what: 'a cited e2e check returns before asserting anything (an engine-guarded early return)', slow: true,
    file: 'projects/draw/test/e2e.mjs', from: "  await withPage(browser, origin, 956, async (page, errors) => {\n    const first = await page.evaluate(() => {", to: "  await withPage(browser, origin, 956, async (page, errors) => {\n    if (origin) return;\n    const first = await page.evaluate(() => {",
    run: SITE_E2E_EVIDENCE, expect: /feature:meta-csp: cited e2e check did not pass in every call \(or did not run, or asserted nothing\): projects\/draw\/test\/e2e\.mjs#cspIsFirstAndEnforced/,
  },
  {
    id: 'B257', what: 'a cited e2e check fails for one of its arguments (dark) and passes for the other (light)', slow: true,
    file: 'projects/draw/test/e2e.mjs', from: 'must(files.length >= 200, `the fidelity check found', to: "must(files.length >= 200 && colorScheme !== 'dark', `the fidelity check found",
    run: SITE_E2E_EVIDENCE, expect: /: cited e2e check did not pass in every call \(or did not run, or asserted nothing\): projects\/draw\/test\/e2e\.mjs#corpusLooksAsItDoesAlone/,
  },
  {
    id: 'B258', what: 'e2e evidence older than a helper the e2e runs is taken as evidence',
    file: 'projects/draw/test/probe-helpers/png.mjs', append: '\n// changed after the e2e ran\n',
    create: '.smoke/helper-e2e-evidence.jsonl', content: '{"complete":true,"engine":"chromium","calls":0}\n',
    run: ['sh', ['-c', 'touch -r projects/draw/test/e2e.mjs .smoke/helper-e2e-evidence.jsonl && node projects/draw/tools/ledger-check.mjs --e2e-evidence .smoke/helper-e2e-evidence.jsonl'], REPO],
    expect: /helper-e2e-evidence\.jsonl: older than projects\/draw\/test\/probe-helpers\/png\.mjs/,
  },
  {
    id: 'B259', what: 'e2e evidence is taken with no built page to be evidence of',
    create: '.smoke/nosite-e2e-evidence.jsonl', content: '{"complete":true,"engine":"chromium","calls":0}\n',
    run: ['sh', ['-c', 'mv _site/draw/index.html _site/draw/index.html.away 2>/dev/null; node projects/draw/tools/ledger-check.mjs --e2e-evidence .smoke/nosite-e2e-evidence.jsonl; s=$?; mv _site/draw/index.html.away _site/draw/index.html 2>/dev/null; exit $s'], REPO],
    expect: /nosite-e2e-evidence\.jsonl: there is no _site\/draw\/index\.html/,
  },
  {
    id: 'B260', what: 'e2e evidence from a run that never finished (no complete line) is taken as evidence',
    create: '.smoke/partial-e2e-evidence.jsonl', content: '{"file":"projects/draw/test/e2e.mjs","name":"cspIsFirstAndEnforced","engine":"chromium"}\n',
    run: ['node', ['projects/draw/tools/ledger-check.mjs', '--e2e-evidence', '.smoke/partial-e2e-evidence.jsonl'], REPO],
    expect: /partial-e2e-evidence\.jsonl: not a complete run/,
  },
  {
    id: 'B261', what: "the smoke test leaves an earlier run's Draw e2e evidence in place", slow: true,
    file: 'scripts/smoke-test.mjs', from: "rmSync(join(ROOT, '.smoke', 'draw-e2e-evidence.jsonl'), { force: true });", to: '',
    run: ['sh', ['-c', 'node scripts/build-site.mjs >/dev/null && mkdir -p .smoke && echo earlier > .smoke/draw-e2e-evidence.jsonl && E2E=none node scripts/smoke-test.mjs >/dev/null; if [ -e .smoke/draw-e2e-evidence.jsonl ]; then echo "an earlier run\'s Draw e2e evidence survived the smoke test"; rm .smoke/draw-e2e-evidence.jsonl; exit 1; fi'], REPO],
    expect: /an earlier run's Draw e2e evidence survived the smoke test/,
  },
  {
    id: 'B262', what: "the probe's @font-face gap is listed for WebKit only, so Chromium must pass it too (gaps are gated per engine)", slow: true,
    file: 'projects/draw/test/probe-shadow.mjs', from: "gap: ['chromium']", to: "gap: ['webkit']",
    run: SITE_E2E, expect: /shadow root breaks 1 feature\(s\) that work in the light DOM in chromium[^:]*: @font-face in the document's <style>/,
  },
  // P0-M5 review fixes: the code panel and the canvas.
  {
    id: 'B263', what: "Tidy ends an attribute's wrap at its closing quote, so a tag's close drops to a line of its own",
    file: 'projects/draw/src/codeview/layout.ts', from: 'end: a === attrs[attrs.length - 1] ? b.text.length : a.end', to: 'end: a.end',
    run: drawTests('code-panel.test.ts'), expect: /✖ the tidy view keeps a tag's close with its last attribute/,
  },
  {
    id: 'B264', what: "the code view draws a tag's close after its last wrap (the start of a line of its own)", slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: '      this.fill(wrap, b, t, w.at, w.end);\n      el.append(wrap);\n      at = w.end;',
    to: "      const stop = w.end === b.text.length ? b.text.lastIndexOf(b.text.endsWith('/>') ? '/>' : '>') : w.end;\n      this.fill(wrap, b, t, w.at, stop);\n      el.append(wrap);\n      at = stop;",
    run: SITE_E2E, expect: /tidyKeepsEachCloseWithItsTag: \d+ tag close\(s\) start a line of their own in the tidy view/,
  },
  {
    id: 'B265', what: 'Tidy keeps a line break around an attribute\'s "="',
    file: 'projects/draw/src/codeview/layout.ts', from: '    swaps.push(...unbreak(b.text, a.at + a.name.length, a.valueAt - 1));', to: '',
    run: drawTests('code-panel.test.ts'), expect: /✖ the tidy view takes line breaks out of a tag's own syntax/,
  },
  {
    id: 'B266', what: 'Tidy keeps a line break before an end tag\'s ">"',
    file: 'projects/draw/src/codeview/layout.ts', from: 'swaps: end ? unbreak(b.text, end[0].length, b.text.length - 1) : []', to: 'swaps: []',
    run: drawTests('code-panel.test.ts'), expect: /✖ the tidy view takes line breaks out of a tag's own syntax/,
  },
  {
    id: 'B267', what: 'the first Play under reduced motion resumes from the opening still (a fade that animates once shows no motion)', slow: true,
    file: 'projects/draw/src/canvas/renderer.ts', from: '      if (this.#fromStill) svg.setCurrentTime(0);\n', to: '',
    run: SITE_E2E, expect: /Play shows no motion/,
  },
  {
    id: 'B268', what: "Pause under reduced motion drops a CSS animation back to its base style instead of holding its frame", slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: '\n:host(.draw-held) *, :host(.draw-held) *::before, :host(.draw-held) *::after { animation-play-state: paused !important; transition: none !important }', to: '',
    run: SITE_E2E, expect: /Pause did not hold the CSS animation on its frame/,
  },
  {
    id: 'B269', what: 'the theme chosen in Files goes on <html> only after React has drawn (a load flashes the system theme)', slow: true,
    file: 'projects/draw/src/main.tsx', from: "if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;\n", to: '',
    run: SITE_E2E, expect: /a load with Dark chosen drew the app in the system's theme first/,
  },
  {
    id: 'B270', what: "the legend's samples lose their token chips (plain coloured words among the verbs)", slow: true,
    file: 'projects/draw/src/app.css', from: '  background: color-mix(in srgb, currentColor 12%, transparent);\n  font-family: var(--font-mono);\n', to: '',
    run: SITE_E2E, expect: /the samples are not chips in code type apart from the words/,
  },
  {
    id: 'B271', what: 'Export over a file shown as source says "Nothing is open."', slow: true,
    file: 'projects/draw/src/panels/FileSheets.tsx', from: "{unparsed ? 'A file that isn’t well-formed can’t be exported; Copy (over the code) has its text.' : 'Nothing is open.'}", to: 'Nothing is open.',
    run: SITE_E2E, expect: /Export over the source says/,
  },
  {
    id: 'B272', what: 'the legend shows over a file shown as source', slow: true,
    file: 'projects/draw/src/panels/CodePanel.tsx', from: '{!source && !readOnly && <Legend />}', to: '{!readOnly && <Legend />}',
    run: SITE_E2E, expect: /the legend shows over source that nothing can edit/,
  },
  {
    id: 'B273', what: 'Enter no longer closes the Number sheet', slow: true,
    file: 'projects/draw/src/panels/Sheets.tsx', from: "          onKeyDown={(e) => e.key === 'Enter' && close()}\n        />\n        {unit &&", to: '        />\n        {unit &&',
    run: SITE_E2E, expect: /Enter did not close the Number sheet/,
  },
  {
    id: 'B274', what: 'any CSS that mentions "animation" counts as motion (a still drawing gets a Play that does nothing)',
    file: 'projects/draw/src/canvas/renderer.ts', from: "const CSS_MOTION = /@keyframes|(?:^|[{;\\s])animation(?:-name)?\\s*:(?!\\s*none\\s*(?:[;}!]|$))/i;", to: 'const CSS_MOTION = /animation|@keyframes/i;',
    run: drawTests('motion.test.ts'), expect: /✖ CSS moves with @keyframes/,
  },
  {
    id: 'B275', what: 'the tap slop on the canvas grows from 5 pt to 8',
    file: 'projects/draw/src/canvas/gestures.ts', from: 'export const SLOP = 5;', to: 'export const SLOP = 8;',
    run: drawTests('viewport.test.ts'), expect: /✖ a move under 5 pt is a tap; 5 pt or more/,
  },
  {
    id: 'B276', what: 'Tidy hides a value, in files only the whole corpus has (heroicons\' aria-hidden)',
    file: 'projects/draw/src/codeview/layout.ts', from: '    swaps.push(...unbreak(b.text, a.at + a.name.length, a.valueAt - 1));', to: "    swaps.push(...unbreak(b.text, a.at + a.name.length, a.valueAt - 1));\n    if (a.name === 'aria-hidden') swaps.push({ at: a.valueAt, end: a.valueEnd, text: '' });",
    run: drawTests('code-panel.test.ts'), expect: /✖ the tidy view swaps only whitespace, never inside a token, over the whole corpus/,
  },
  {
    id: 'B277', what: 'a DEVICE-CHECKS.md link is damaged (it no longer opens the looping drawing its row names)',
    file: 'projects/draw/DEVICE-CHECKS.md', from: 'and [one that loops](https://mmaggitti.github.io/draw/#import=TVDL', to: 'and [one that loops](https://mmaggitti.github.io/draw/#import=NY5N',
    run: drawTests('device-checks.test.ts'), expect: /✖ DEVICE-CHECKS\.md's links decode and open as their rows say/,
  },
  // P1-M0: the engine refuses what a browser's XML parser refuses, each at its place.
  {
    id: 'B278', what: 'an attribute written twice is accepted',
    file: 'engine/xml/lex.ts', from: '    if (seen.has(an)) return { at: k, message: `attribute ${clip(an)} is written twice in <${clip(name)}>`, attrs };\n', to: '',
    run: XML_TESTS, expect: /✖ strict well-formedness: what a browser refuses, Draw refuses, each with its place[\s\S]*\[ERR_ASSERTION\]: an attribute written twice: parsed\n/,
  },
  {
    id: 'B279', what: 'a bare & is accepted',
    file: 'engine/xml/entities.ts', from: "if (ref === undefined) return { at: i, message: raw[i + 1] === '#' ? 'a malformed character reference' : \"a bare & (write &amp; for the character itself)\" };", to: 'if (ref === undefined) continue;',
    run: XML_TESTS, expect: /✖ strict well-formedness: what a browser refuses, Draw refuses, each with its place[\s\S]*\[ERR_ASSERTION\]: a bare & in text: parsed\n/,
  },
  {
    id: 'B280', what: '&nbsp; is accepted with no DTD (an undeclared entity stays as written)',
    file: 'engine/xml/entities.ts', from: '    } else return { at: i, message: `the entity &${clip(ref)}; is not declared` };', to: '    }',
    run: XML_TESTS, expect: /✖ strict well-formedness: what a browser refuses, Draw refuses, each with its place[\s\S]*\[ERR_ASSERTION\]: &nbsp; with no DTD: parsed\n/,
  },
  {
    id: 'B281', what: '&#0; is accepted (read as U+FFFD, as before P1)',
    file: 'engine/xml/entities.ts', from: "      if (!isXmlChar(codePoint(ref.slice(1)))) return { at: i, message: `&${clip(ref)}; names a character XML doesn't allow` };\n", to: '',
    run: XML_TESTS, expect: /✖ strict well-formedness: what a browser refuses, Draw refuses, each with its place[\s\S]*\[ERR_ASSERTION\]: &#0;: parsed\n/,
  },
  {
    id: 'B282', what: "'--' in a comment is accepted",
    file: 'engine/xml/lex.ts', from: "      if (dashes !== close) return fail(dashes, \"'--' inside a comment\");\n", to: '',
    run: XML_TESTS, expect: /✖ strict well-formedness: what a browser refuses, Draw refuses, each with its place[\s\S]*\[ERR_ASSERTION\]: -- in a comment: parsed\n/,
  },
  {
    id: 'B283', what: 'an element prefix nobody declared is accepted',
    file: 'engine/model/doc.ts', from: '    if (prefix !== null && !bound(prefix)) throw new ParseFail(el.start.start + 1, `the prefix ${clip(prefix)} of <${clip(tag)}> is not declared`);\n', to: '',
    run: XML_TESTS, expect: /✖ strict well-formedness: what a browser refuses, Draw refuses, each with its place[\s\S]*\[ERR_ASSERTION\]: an unbound element prefix: parsed\n/,
  },
  {
    id: 'B284', what: 'a lowercase <!doctype is accepted',
    file: 'engine/xml/lex.ts', from: "    if (src.startsWith('<!DOCTYPE', i)) {", to: "    if (src.startsWith('<!DOCTYPE', i) || src.startsWith('<!doctype', i)) {",
    run: XML_TESTS, expect: /✖ strict well-formedness: what a browser refuses, Draw refuses, each with its place[\s\S]*\[ERR_ASSERTION\]: a lowercase <!doctype: parsed\n/,
  },
  {
    // A form feed is refused wherever it stands (it is no XML character at all); what the old /\S/
    // lets through outside the root is JavaScript's other whitespace: a no-break space, a late BOM.
    id: 'B285', what: 'text outside the root is judged by the old /\\S/ again (a no-break space before the root passes)',
    file: 'engine/xml/cst.ts', from: 'const STRAY = /[^ \\t\\r\\n]/;', to: 'const STRAY = /\\S/;',
    run: XML_TESTS, expect: /✖ strict well-formedness: what a browser refuses, Draw refuses, each with its place[\s\S]*\[ERR_ASSERTION\]: a no-break space before the root: parsed\n/,
  },
  {
    id: 'B286', what: "the DOCTYPE's subset scan loses its processing-instruction skip (a ] or a quote in one breaks the DOCTYPE)",
    file: 'engine/xml/lex.ts', from: "    } else if (src.startsWith('<?', k)) {\n      const e = src.indexOf('?>', k + 2);\n      if (e === -1) return -1;\n      k = e + 1;\n", to: '',
    run: XML_TESTS, expect: /✖ a processing instruction in the DOCTYPE may hold \] and quotes/,
  },
  {
    id: 'B287', what: 'an entity a parameter entity may declare is reported as not well-formed (it loses kind: limit)',
    file: 'engine/xml/entities.ts', from: "which Draw doesn't expand`, kind: 'limit' };", to: "which Draw doesn't expand` };",
    run: XML_TESTS, expect: /✖ an entity a parameter entity may declare is over Draw's limits, not malformed/,
  },
  {
    id: 'B293', what: 'an entity an XHTML DOCTYPE brings (browsers supply it) is reported as not well-formed',
    file: 'engine/xml/entities.ts', from: "    } else if (table.xhtmlDtd) {\n      return { at: i, message: `the entity &${clip(ref)}; is not declared; a browser takes it from the XHTML DTD the DOCTYPE names, which Draw doesn't read`, kind: 'limit' };\n", to: '',
    run: XML_TESTS, expect: /✖ an entity an XHTML DOCTYPE brings is over Draw's limits, not malformed/,
  },
  // P1-M0 review (F8): with several errors, the first is reported, as a browser's parser stops there.
  {
    id: 'B304', what: "the lexer's or the tree's error is reported before an earlier reference or namespace error again",
    file: 'engine/model/doc.ts', from: '    return first && !first.ok ? first : { ok: false, error: parsed.error };', to: '    return { ok: false, error: parsed.error };',
    run: drawTests('import.test.ts'), expect: /✖ a file with several errors opens as read-only source at the first[\s\S]*a bare & \(line 2\), then an attribute written twice \(line 3\)/,
  },
  {
    id: 'B305', what: 'the attributes a tag read before the lexer stopped inside it go unchecked',
    file: 'engine/xml/lex.ts', from: "    if ('message' in r) return fail(r.at, r.message, r.attrs);", to: "    if ('message' in r) return fail(r.at, r.message);",
    run: drawTests('import.test.ts'), expect: /✖ a file with several errors opens as read-only source at the first[\s\S]*in one tag, a reference \(line 2\), then an attribute written twice \(line 4\)/,
  },
  {
    id: 'B306', what: 'the text before a character XML doesn\'t allow goes unchecked',
    file: 'engine/xml/lex.ts', from: "      if (t.start < at && t.kind === 'text') tokens.push({ ...t, end: at });\n", to: '',
    run: drawTests('import.test.ts'), expect: /✖ a file with several errors opens as read-only source at the first[\s\S]*in one text, a reference \(line 2\), then U\+0001 \(line 3\)/,
  },
  {
    // P1-M0 review (F10): a stored draft the strict parser refuses is shown as source, never saved over.
    id: 'B314', what: 'a draft shown as source is attached to be saved (the source view makes a draft of its own)',
    file: 'projects/draw/src/workspace.ts', from: '    await this.autosave.attach({ text: () => r.source.text, id: null, name: r.name, create: false });', to: '    await this.autosave.attach({ text: () => r.source.text, id: null, name: r.name, create: true });',
    run: drawTests('workspace.test.ts'), expect: /✖ a stored draft the strict parser refuses reopens as read-only source at its error[\s\S]*the source view made no draft of its own/,
  },
  // P1-M0, CI run 32: WebKit's known XML parser differences are named narrowly (probe-helpers/xml-canon.mjs).
  {
    id: 'B315', what: "the canon's line-end rule accepts any text difference, not only a CR kept before an LF",
    file: 'projects/draw/test/probe-helpers/xml-canon.mjs', from: "browser.includes('\\r\\n') && browser.replace(/\\r\\n/g, '\\n') === engine;", to: 'true;',
    run: drawTests('xml-canon.test.ts'), expect: /✖ the canon's line-end rule/,
  },
  {
    id: 'B316', what: "a probe's known WebKit defect excuses every engine's refusal",
    file: 'projects/draw/test/probe-helpers/xml-canon.mjs', from: 'const excused = probe.knownDefect?.[engine];', to: 'const excused = probe.knownDefect;',
    run: drawTests('xml-canon.test.ts'), expect: /✖ a probe's known browser defect/,
  },
  // P1-M0 review (F9): an entity chain is named once; a long name is cut in a message.
  {
    id: 'B312', what: "an entity chain's message repeats its sentence at every level again (about 800 characters at depth 8)",
    file: 'engine/xml/entities.ts', from: '  const out: Fault | null = below && { ...below, chain: [name, ...below.chain] };', to: '  const out: Fault | null = below && { ...below, chain: [name], cause: faultMessage(below) };',
    run: XML_TESTS, expect: /✖ an entity chain is named once in a message, by its ends/,
  },
  {
    id: 'B313', what: 'a message holds a long name whole again (a 1 MB name makes a 1 MB message)',
    file: 'engine/xml/lex.ts', from: "export const clip = (name: string): string => (name.length > 40 ? `${name.slice(0, 39).replace(/[\\uD800-\\uDBFF]$/, '')}…` : name);", to: 'export const clip = (name: string): string => name;',
    run: XML_TESTS, expect: /✖ a message cuts a long name to about 40 characters[\s\S]*a colon out of place: a message of \d+ characters/,
  },
  // P1-M0 review: one name pattern for entities (F6), the first declaration binds (F7), an unparsed entity is never referenced (F9).
  {
    id: 'B309', what: "an entity's declaration takes ASCII names only again (a declared &é; reads as undeclared)",
    file: 'engine/xml/entities.ts', from: '(%\\\\s+)?(${NAME_PATTERN})', to: '(%\\\\s+)?([A-Za-z_:][\\\\w.:-]*)',
    run: XML_TESTS, expect: /✖ an entity name may hold any character a name may, declared, referenced and expanded alike/,
  },
  {
    id: 'B310', what: 'the last declaration of an entity binds again (fill="&c;" reads blue where a browser draws red)',
    file: 'engine/xml/entities.ts', from: '    if (m[1] ? table.parameter.has(name) : table.internal.has(name) || table.external.has(name)) continue;\n', to: '',
    run: XML_TESTS, expect: /✖ an entity declared twice keeps its first declaration/,
  },
  {
    id: 'B311', what: 'a reference to an unparsed (NDATA) entity is accepted in text',
    file: 'engine/xml/entities.ts', from: "    } else if (table.unparsed.has(ref)) {\n      return { at: i, message: `the entity &${clip(ref)}; is unparsed (declared NDATA): no reference may name it` };\n", to: '',
    run: XML_TESTS, expect: /✖ a reference to an unparsed \(NDATA\) entity is refused[\s\S]*<text>&logo;<\/text>: parsed/,
  },
  {
    // Edit source parses its text with the document's DOCTYPE and namespaces in scope.
    id: 'B295', what: "Edit source parses without the document's DOCTYPE (the entities it declares are out of scope)",
    file: 'engine/model/fragment.ts', from: "const head = `${doctype && doctype.kind === 'doctype' ? doctype.raw : ''}<${WRAPPER}", to: 'const head = `<${WRAPPER}',
    run: engineTests('fragment.test.ts'), expect: /✖ Edit source refuses what a browser refuses, at its place in the text, with the document in scope/,
  },
  {
    id: 'B288', what: 'the parser tree check compares no corpus file', slow: true,
    file: 'projects/draw/test/e2e.mjs', from: '    for (const [i, file] of corpus.entries()) {', to: '    for (const [i, file] of corpus.slice(0, 0).entries()) {',
    run: SITE_E2E, expect: /corpusTreesMatchTheBrowsersParser: compared 0 of \d+ corpus files/,
  },
  {
    id: 'B289', what: "the engine's canonical tree takes an attribute's raw text for its value (lab/transform.svg's transform spans lines)", slow: true,
    file: 'projects/draw/test/probe-helpers/xml-canon.mjs', from: 'const attrs = n.attrs.map((a) => [a.ns, a.local, a.prefix, decodeAttr(a.raw, doc.entities)]).sort(byNsLocal);', to: 'const attrs = n.attrs.map((a) => [a.ns, a.local, a.prefix, a.raw]).sort(byNsLocal);',
    run: SITE_E2E, expect: /corpusTreesMatchTheBrowsersParser: \d+ of \d+ corpus files parse to different trees in the engine and the browser \([^)]*lab\/transform\.svg/,
  },
  {
    id: 'B291', what: 'the parser probe loop is skipped', slow: true,
    file: 'projects/draw/test/e2e.mjs', from: '    for (const [i, probe] of PROBES.entries()) {', to: '    for (const [i, probe] of PROBES.slice(0, 0).entries()) {',
    run: SITE_E2E, expect: /theEngineRefusesWhatTheBrowserRefuses: checked 0 of \d+ probes/,
  },
  // P1-M0: the ledger's citations and the canvas's pattern rows.
  {
    id: 'B290', what: "a ledger row's note names an e2e check the row doesn't cite",
    file: 'engine/ledger/ledger.json', from: ',"projects/draw/test/e2e.mjs#theLedgerLoadsOnlyForSupport"]', to: ']',
    run: LEDGER_CHECK, expect: /feature:support-tab: its note names the e2e check theLedgerLoadsOnlyForSupport but the row does not cite it/,
  },
  {
    id: 'B292', what: 'data-* stops rendering (the canvas ignores the pattern rows again)',
    file: 'engine/policy/render-policy.ts', from: '  if (!scope) return attrNs === null && (elNs === NS.svg ? RENDER_SVG_ATTRIBUTE_PATTERNS : elNs === NS.xhtml ? RENDER_XHTML_ATTRIBUTE_PATTERNS : []).some((re) => re.test(attrLocal));\n', to: '  if (!scope) return false;\n',
    run: POLICY_TESTS, expect: /✖ data-\* \(a pattern row\): rendered on every element, kept byte for byte, served/,
  },
  {
    // The policy draws the pattern rows; the sink's second judge must agree, or they never land.
    id: 'B294', what: "DOMPurify's second opinion refuses data-* (a pattern row the policy draws never reaches the canvas)", slow: true,
    file: 'projects/draw/src/canvas/safe-sink.ts', from: '  SANITIZE_DOM: false,\n', to: '  SANITIZE_DOM: false,\n  ALLOW_DATA_ATTR: false,\n',
    run: SITE_E2E, expect: /without data-state or aria-label: the pattern rows \(data-\*, aria-\*\) must pass both judges/,
  },
  // P1-M0: SVG Lab goals closed early, each reached with Draw's own tools on the lab's file.
  {
    id: 'B296', what: 'zoom stops at 4× the fitted drawing',
    file: 'projects/draw/src/canvas/viewport.ts', from: 'Math.min(Math.max(MAX_SCALE, fitScale * MAX_SCALE_FACTOR), ', to: 'Math.min(fitScale * 4, ',
    run: drawTests('lab-goals.test.ts'), expect: /✖ lab goal "Zoom to 8×" \(vector\)/,
  },
  {
    id: 'B297', what: "a tap on a colour token opens no Color sheet",
    file: 'projects/draw/src/editor.ts', from: "      case 'color':\n        return this.#openSheet({ kind: 'color', ref, token: t });\n", to: "      case 'color':\n        return;\n",
    run: drawTests('lab-goals.test.ts'), expect: /✖ lab goal "Change a color" \(vector\)/,
  },
  {
    id: 'B298', what: "stroke-linejoin's keywords lose bevel",
    file: 'engine/code/tokens.ts', from: "'stroke-linejoin': ['miter', 'round', 'bevel', 'miter-clip', 'arcs'],", to: "'stroke-linejoin': ['miter', 'round', 'miter-clip', 'arcs'],",
    run: drawTests('lab-goals.test.ts'), expect: /✖ lab goal "Bevel corners" \(style\)/,
  },
  {
    id: 'B299', what: 'a tap on a text run opens no Text sheet',
    file: 'projects/draw/src/editor.ts', from: "      case 'text':\n        return this.#openSheet({ kind: 'text', ref, token: t });\n", to: "      case 'text':\n        return;\n",
    run: drawTests('lab-goals.test.ts'), expect: /✖ lab goal "Write your own title" \(access\)/,
  },
  // P1-M1 S1: engine geometry, the write policy, rewriteNumbers, moved/coalesce and ids.
  {
    id: 'B317', what: 'rewriteNumbers re-serializes the whole value (its tokens joined by single spaces)',
    file: 'engine/code/edit.ts', from: "  if (!same) throw new TokenEditError('the new numbers would change how the rest of the value reads');\n  return out;", to: "  if (!same) throw new TokenEditError('the new numbers would change how the rest of the value reads');\n  return after.map((t) => t.text).join(' ');",
    run: engineTests('geometry/write.test.ts'), expect: /✖ a path move leaves relative commands byte for byte/,
  },
  {
    id: 'B318', what: 'a rotate plan collapses the list into one matrix()',
    file: 'engine/geometry/write.ts', from: '  const raw = end > 0 ? `${attr.raw.slice(0, end)} ${item}${attr.raw.slice(end)}` : item + attr.raw;', to: "  const raw = `matrix(${parseTransform(attr.raw)!.matrix.join(' ')})`;",
    run: engineTests('geometry/write.test.ts'), expect: /✖ a transform list is never collapsed/,
  },
  {
    id: 'B319', what: 'ownTransform ignores transform-origin',
    file: 'engine/geometry/ctm.ts', from: '  return ox === 0 && oy === 0 ? t : multiply(multiply(translate(ox, oy), t), translate(-ox, -oy));', to: '  return t;',
    run: engineTests('geometry/ctm.test.ts'), expect: /✖ transform-origin: keywords, lengths and % under view-box/,
  },
  {
    id: 'B320', what: 'a path move moves relative commands too',
    file: 'engine/geometry/write.ts', from: '    if (!abs) return null; // relative: its bytes stay\n', to: '',
    run: engineTests('geometry/write.test.ts'), expect: /✖ a path move leaves relative commands byte for byte/,
  },
  {
    id: 'B321', what: 'cssSets never reports a <style> rule',
    file: 'engine/geometry/css.ts', from: "  if (sheet.rules.some((r) => r.decls.some((d) => names.includes(d)) && r.selectors.some((s) => mayMatch(s, doc, node)))) return 'sheet';\n", to: '',
    run: engineTests('geometry/write.test.ts'), expect: /✖ CSS-controlled geometry and transforms are refused with their reasons/,
  },
  {
    id: 'B322', what: 'coalesce keeps a place op that ends where it started',
    file: 'engine/commands/ops.ts', from: '    if (!samePlace(op.before, op.after)) return true;\n', to: '    return true;\n',
    run: engineTests('commands/commands.test.ts'), expect: /✖ coalesce merges consecutive place ops of one node/,
  },
  {
    id: 'B323', what: 'freshId returns the base even when it is taken',
    file: 'engine/model/ids.ts', from: '  if (!used.has(base) && !taken.has(base)) return base;', to: '  return base;',
    run: engineTests('ids.test.ts'), expect: /✖ freshId never reuses an id/,
  },
  {
    id: 'B324', what: 'renameIdsIn skips url(#…) inside style=""',
    file: 'engine/model/ids.ts', from: "  } else if (text.includes('url(')) {", to: "  } else if (text.includes('url(') && a.local !== 'style') {",
    run: engineTests('ids.test.ts'), expect: /✖ renameIdsIn rewrites ids and references inside the subtree only/,
  },
  // P1-M1 S2: selection, move, the paper, the camera box, per-node routing.
  {
    // Leans on B275's anchor: two spaces keep valid TypeScript but take the text B275 edits away.
    id: 'B325', what: "the dry run misses a stale anchor (it plants a second space in SLOP, B275's anchor)",
    file: 'projects/draw/src/canvas/gestures.ts', from: 'export const SLOP = 5;', to: 'export const SLOP =  5;',
    run: ['node', ['tools/prove-breaks.mjs', '--dry'], DRAW], expect: /B275 +STALE/,
  },
  {
    id: 'B326', what: "check-sinks' DOM-write allowlist widens from the overlay folder to the whole canvas folder",
    file: 'projects/draw/tools/check-sinks.mjs', from: "].map((r) => r.source).join('|')), ['projects/draw/src/canvas/safe-sink.ts', 'projects/draw/src/canvas/overlay/']],", to: "].map((r) => r.source).join('|')), ['projects/draw/src/canvas/safe-sink.ts', 'projects/draw/src/canvas/']],",
    run: drawTests('check-sinks.test.ts'), expect: /✖ check-sinks allows DOM writes in the overlay folder only/,
  },
  {
    id: 'B327', what: 'the tooltip never flips below the finger near the top of the canvas',
    file: 'projects/draw/src/interact/overlay-model.ts', from: '  return { text, finger, below: finger.y < TIP_FLIP };', to: '  return { text, finger, below: false };',
    run: drawTests('overlay-model.test.ts'), expect: /✖ the tooltip sits 42 px above the finger/,
  },
  {
    id: 'B328', what: 'the grid step ignores its 12 px floor (lines 1 px apart)',
    file: 'projects/draw/src/interact/overlay-model.ts', from: '  const want = GRID_MIN_PX / pxPerUnit;', to: '  const want = 1 / pxPerUnit;',
    run: drawTests('overlay-model.test.ts'), expect: /✖ the grid step is the smallest 1, 2 or 5/,
  },
  {
    id: 'B329', what: '`held` ignores the time (a hold-drag reads as an ordinary drag)',
    file: 'projects/draw/src/canvas/gestures.ts', from: 'held: e.t - tr.t0 >= HOLD_MS', to: 'held: false',
    run: drawTests('viewport.test.ts'), expect: /✖ a drag that starts after the pointer was held still for 450 ms is held/,
  },
  {
    id: 'B330', what: 'a drag on an unselected shape only selects it (no move)',
    file: 'projects/draw/src/editor.ts', from: '    if (!selected) this.select(g.add ? [...sel, g.target] : [g.target]);', to: "    if (!selected) {\n      this.select(g.add ? [...sel, g.target] : [g.target]);\n      g.mode = 'none';\n      return;\n    }",
    run: drawTests('editor.test.ts'), expect: /✖ a drag on an unselected shape selects and moves it/,
  },
  // P1-M1 S2: per-node structure routing (B71 above is the route itself).
  {
    id: 'B331', what: 'a text leaf that moved draws its parent again instead of being placed alone',
    file: 'projects/draw/src/canvas/renderer.ts', from: '    if (judgedWhole(doc, at)) return this.#patch(at);\n', to: '    return this.#patch(at);\n',
    run: PATCH_TESTS, expect: /a whitespace leaf moved alone: only what moved is drawn again/,
  },
  {
    id: 'B332', what: 'a moved node rebuilds the whole code listing',
    file: 'projects/draw/src/editor.ts', from: '      if ((r.code.moved.length || r.code.parents.length) && !this.#placeCode(r.code.moved, r.code.parents)) return this.#resetCode();', to: '      if (r.code.moved.length || r.code.parents.length) return this.#resetCode();',
    run: drawTests('editor.test.ts'), expect: /✖ an edit reaches the canvas, then the code/,
  },
  {
    id: 'B333', what: 'Bring forward moves one already last (it records an entry when nothing should move)',
    file: 'projects/draw/src/interact/structure.ts', from: '    if (past === null || moving.has(past)) continue;', to: '    if (moving.has(past!)) continue;',
    run: drawTests('editor.test.ts'), expect: /✖ Bring forward and Send back swap each selected element/,
  },
  {
    id: 'B334', what: 'a nudge (or Delete) acts while a field has focus',
    file: 'projects/draw/src/keys.ts', from: "const ELSEWHERE = 'input, textarea, select, .draw-code';", to: "const ELSEWHERE = '.draw-code';",
    run: drawTests('keys.test.ts'), expect: /✖ no key acts in a field, in the code view, under a sheet/,
  },
  {
    id: 'B335', what: 'every arrow repeat is its own history entry',
    file: 'projects/draw/src/keys.ts', from: '      ed.nudge(arrow[0] * n, arrow[1] * n);\n', to: '      ed.nudge(arrow[0] * n, arrow[1] * n);\n      ed.nudgeEnd();\n',
    run: drawTests('keys.test.ts'), expect: /✖ a held arrow with its repeats, and a second arrow while it is held, is one nudge/,
  },
  // P1-M1 S2, slow: the new e2e checks (each run alone, `checks`).
  {
    id: 'B336', what: 'a move rounds its delta to 2 units', slow: true, checks: ['aDragMovesTheShapeByWholeUnits'],
    file: 'projects/draw/src/editor.ts', from: '    const d = { x: toStep(rx, m.step), y: toStep(ry, m.step) };', to: '    const d = { x: toStep(rx, 2), y: toStep(ry, 2) };',
    run: DRAW_E2E, expect: /aDragMovesTheShapeByWholeUnits: mouse: the drag did not move the circle by/,
  },
  {
    id: 'B337', what: 'the tooltip is drawn under the finger', slow: true, checks: ['aDragMovesTheShapeByWholeUnits'],
    file: 'projects/draw/src/interact/overlay-model.ts', from: 'top: t.below ? t.finger.y + TIP_BELOW : t.finger.y - TIP_ABOVE - height', to: 'top: t.finger.y',
    run: DRAW_E2E, expect: /aDragMovesTheShapeByWholeUnits: mouse: the tooltip's bottom edge is/,
  },
  {
    id: 'B338', what: 'a marquee takes what it touches, not what it encloses', slow: true, checks: ['aMarqueeSelectsWhatItEncloses'],
    file: 'projects/draw/src/editor.ts', from: '      return b.x >= r.x - 0.5 && b.y >= r.y - 0.5 && b.x + b.width <= r.x + r.width + 0.5 && b.y + b.height <= r.y + r.height + 0.5;', to: '      return b.x <= r.x + r.width && b.y <= r.y + r.height && b.x + b.width >= r.x && b.y + b.height >= r.y;',
    run: DRAW_E2E, expect: /aMarqueeSelectsWhatItEncloses: a marquee around A, with B half inside it, selected AB/,
  },
  {
    id: 'B339', what: 'a hold-drag on a shape moves it', slow: true, checks: ['aMarqueeSelectsWhatItEncloses'],
    file: 'projects/draw/src/editor.ts', from: '    if (held || g.target === null || g.onLocked) {', to: '    if (g.target === null || g.onLocked) {',
    run: DRAW_E2E, expect: /aMarqueeSelectsWhatItEncloses: a hold-drag from B (drew no marquee|moved it)/,
  },
  {
    id: 'B340', what: 'the code view rebuilds every block on a structure change', slow: true, checks: ['zOrderAndDeletePatchOnlyWhatMoved'],
    file: 'projects/draw/src/editor.ts', from: '      if ((r.code.moved.length || r.code.parents.length) && !this.#placeCode(r.code.moved, r.code.parents)) return this.#resetCode();', to: '      if (r.code.moved.length || r.code.parents.length) return this.#resetCode();',
    run: DRAW_E2E, expect: /zOrderAndDeletePatchOnlyWhatMoved: Bring forward: new code blocks/,
  },
  {
    id: 'B341', what: 'the arrows nudge while a code token has focus', slow: true, checks: ['arrowsNudgeOnlyTheCanvasSelection'],
    file: 'projects/draw/src/keys.ts', from: "const ELSEWHERE = 'input, textarea, select, .draw-code';", to: "const ELSEWHERE = 'input, textarea, select';",
    run: DRAW_E2E, expect: /arrowsNudgeOnlyTheCanvasSelection: the arrows on a focused colour token nudged the circle/,
  },
  {
    id: 'B342', what: 'the grid draws past the paper', slow: true, checks: ['theGridToggleShowsTheGrid'],
    file: 'projects/draw/src/interact/overlay-model.ts', from: '  const over = intersect(paper, { x: 0, y: 0, width: host.width, height: host.height });', to: '  const over = { x: 0, y: 0, width: host.width, height: host.height };',
    run: DRAW_E2E, expect: /theGridToggleShowsTheGrid: .*runs past the paper/,
  },
  {
    id: 'B343', what: "the engine's geometry ignores a nested svg's viewBox", slow: true, checks: ['geometryMatchesTheBrowser'],
    file: 'engine/geometry/ctm.ts', from: '  const inner = vb ? viewportTransform(vb, parOf(doc, n), vp.width, vp.height) : IDENTITY;', to: '  const inner = IDENTITY;',
    run: DRAW_E2E, expect: /geometryMatchesTheBrowser: \d+ element\(s\) whose box differs/,
  },
  {
    id: 'B344', what: "the renderer supplies the camera as the root's viewBox again", slow: true, checks: ['percentLengthsKeepTheirSizeUnderZoom'],
    file: 'projects/draw/src/canvas/renderer.ts', from: '    if (!doc || !c || hasOwnViewBox(doc)) return null;', to: '    if (!doc || !c) return null;',
    run: DRAW_E2E, expect: /percentLengthsKeepTheirSizeUnderZoom: .*(viewBox is|the 100% rect measures)/,
  },
  // P1-M1 S3: handles, snapping and Draw's own state.
  {
    id: 'B345', what: 'the handle pick radius grows to 40 px',
    file: 'projects/draw/src/interact/handles.ts', from: 'export const HANDLE_PICK_PX = 26;', to: 'export const HANDLE_PICK_PX = 40;',
    run: drawTests('overlay-model.test.ts'), expect: /✖ a press takes the nearest handle within 26 px/,
  },
  {
    id: 'B346', what: 'a group resize prepends a new translate() scale() pair on every drag instead of editing the leading one',
    file: 'engine/geometry/write.ts', from: "  if (a && t?.fn === 'translate' && t.args.length === 2 && k?.fn === 'scale') {", to: "  if (a && t?.fn === 'translate' && t.args.length === 2 && k?.fn === 'scale' && false) {",
    run: engineTests('geometry/write.test.ts'), expect: /✖ a group resize keeps its fixed corner and edits a leading translate\(\) scale\(\) pair/,
  },
  {
    id: 'B347', what: "the ring isn't magnetic",
    file: 'projects/draw/src/interact/handles.ts', from: '  return (Math.abs(r - m) <= 4 ? m : r) + 0;', to: '  return r + 0;',
    run: drawTests('overlay-model.test.ts'), expect: /✖ a press takes the nearest handle within 26 px, the one drawn last on a tie; the ring is magnetic/,
  },
  {
    id: 'B348', what: "the diamond isn't clamped",
    file: 'projects/draw/src/interact/handles.ts', from: '  return Math.min(4, Math.max(0.2, Number(s.toFixed(2))));', to: '  return Number(s.toFixed(2));',
    run: drawTests('overlay-model.test.ts'), expect: /✖ a press takes the nearest handle within 26 px, the one drawn last on a tie; the ring is magnetic/,
  },
  {
    id: 'B349', what: 'the snap threshold doubles',
    file: 'projects/draw/src/interact/snap.ts', from: 'export const SNAP_PX = 8;', to: 'export const SNAP_PX = 16;',
    run: drawTests('editor.test.ts'), expect: /✖ a move snaps to a target within 8 px/,
  },
  {
    id: 'B350', what: "the last guide's removal leaves xmlns:draw",
    file: 'engine/model/draw-state.ts', from: '    undeclareIfUnused(doc, apply);\n    return;', to: '    return;',
    run: engineTests('draw-state.test.ts'), expect: /✖ the first guide in a file with no <metadata>/,
  },
  {
    id: 'B351', what: 'stripDrawState re-serializes a file with no Draw state',
    file: 'engine/model/draw-state.ts', from: '  if (!hasDrawItems(doc) && boundPrefix(doc) === null) return serialize(doc);\n', to: '',
    run: engineTests('draw-state.test.ts'), expect: /✖ stripDrawState of a file with no Draw state is the file itself/,
  },
  {
    id: 'B352', what: 'stripNamespaces leaves an empty Draw-made <metadata>',
    file: 'engine/export/clean.ts', from: '    if (isAttached(copy, m) && !m.children.some((c) => copy.nodes.get(c)?.kind === \'element\')) drop(m);', to: '    void m;',
    run: engineTests('draw-state.test.ts'), expect: /✖ stripDrawState gives every corpus file back byte for byte/,
  },
  {
    id: 'B353', what: 'cleanExport loses DRAW_NS',
    file: 'engine/export/clean.ts', from: '  DRAW_NS,\n]);', to: ']);',
    run: engineTests('export/clean.test.ts'), expect: /✖ the editor namespaces are the ledger's "Editor data" rows/,
  },
  {
    id: 'B354', what: 'the centre handle moves by half the drag (a lab goal)',
    file: 'projects/draw/src/editor.ts', from: '      if (g.move) g.move.centre = true;', to: '      if (g.move) {\n        g.move.centre = true;\n        g.move.rootInv = g.move.rootInv.map((v) => v / 2) as unknown as Affine;\n      }',
    run: drawTests('lab-goals.test.ts'), expect: /✖ lab goals "Go to x 80, y 20"/,
  },
  // P1-M1 S3, slow.
  {
    id: 'B355', what: "the dragged handle isn't yellow", slow: true, checks: ['theNearestHandleWithin26ptWins'],
    file: 'projects/draw/src/app.css', from: '.draw-hd.on { fill: #ffe600; }', to: '.draw-hd.on { }',
    run: DRAW_E2E, expect: /theNearestHandleWithin26ptWins: the dragged handle is .* during the drag, not yellow/,
  },
  {
    id: 'B356', what: "the top-left corner doesn't keep the bottom-right", slow: true, checks: ['rectCornerHandlesKeepTheOppositeCorner'],
    file: 'engine/geometry/write.ts', from: '  const f = cornerOf(box, OPPOSITE[corner]);', to: "  const f = cornerOf(box, corner === 'tl' ? 'tr' : OPPOSITE[corner]);",
    run: DRAW_E2E, expect: /rectCornerHandlesKeepTheOppositeCorner: the top-left corner to \(30, 30\)/,
  },
  {
    id: 'B357', what: 'a rotation collapses the list to matrix()', slow: true, checks: ['rotateAndScaleHandlesEditTheLabHouse'],
    file: 'engine/geometry/write.ts', from: '    if (rot.args[0].text === a) return { edits: [] };\n', to: "    if (rot.args[0].text === a) return { edits: [] };\n    return { edits: [{ id, ns: null, local: 'transform', raw: `matrix(${fmt(Math.cos((angle * Math.PI) / 180), 3)} ${fmt(Math.sin((angle * Math.PI) / 180), 3)} ${fmt(-Math.sin((angle * Math.PI) / 180), 3)} ${fmt(Math.cos((angle * Math.PI) / 180), 3)} 50 50)`, add: false }] };\n",
    run: DRAW_E2E, expect: /rotateAndScaleHandlesEditTheLabHouse: the ring at 180° did not write rotate\(180\) alone/,
  },
  {
    id: 'B358', what: 'snapping ignores guides', slow: true, checks: ['movesSnapToGuidesShapesAndTheGrid'],
    file: 'projects/draw/src/editor.ts', from: "    if (prefs.guides) for (const g of readState(doc).guides) (g.axis === 'v' ? out.x : out.y).push({ at: g.at, kind: 'guide' });", to: '    void prefs.guides;',
    run: DRAW_E2E, expect: /movesSnapToGuidesShapesAndTheGrid: the rect's left edge landed on 39, not the guide at 40/,
  },
  {
    id: 'B359', what: "a guide's pill moves it by half the drag", slow: true, checks: ['movesSnapToGuidesShapesAndTheGrid'],
    file: 'projects/draw/src/editor.ts', from: '    const [rx, ry] = applyM(inv, g.at.x, g.at.y);\n    const at = toStep(', to: '    const [rx, ry] = applyM(inv, (g.at.x + g.at0.x) / 2, (g.at.y + g.at0.y) / 2);\n    const at = toStep(',
    run: DRAW_E2E, expect: /movesSnapToGuidesShapesAndTheGrid: the pill did not drag the guide to 45/,
  },
  // P1-M1 S4: structure, Layers, rem and Draw's own state.
  {
    id: 'B360', what: 'the copy keeps draw:locked',
    file: 'projects/draw/src/interact/structure.ts', from: "      for (const n of descendants(doc, copy)) if (n.kind === 'element' && findAttr(n, DRAW_NS, 'locked')) apply(opSetAttr(doc, n.id, DRAW_NS, 'locked', null));\n", to: '',
    run: drawTests('editor.test.ts'), expect: /✖ Duplicate: the copy follows its original/,
  },
  {
    id: 'B361', what: 'duplicate renames ids across the whole document (outside references move to the copy)',
    file: 'projects/draw/src/interact/structure.ts', from: '      renameIdsIn(doc, copy, map, apply);\n', to: '      renameIdsIn(doc, copy, map, apply);\n      renameIdsIn(doc, doc.root, map, apply);\n',
    run: drawTests('editor.test.ts'), expect: /✖ Duplicate: the copy follows its original/,
  },
  {
    id: 'B362', what: "ungroup doesn't refuse opacity",
    file: 'projects/draw/src/interact/structure.ts', from: "(a.local === 'id' || a.local === 'transform')", to: "(a.local === 'id' || a.local === 'transform' || a.local === 'opacity')",
    run: drawTests('editor.test.ts'), expect: /✖ Group puts the selection in a new <g>/,
  },
  {
    id: 'B363', what: 'grouping across parents is allowed',
    file: 'projects/draw/src/interact/structure.ts', from: "  if (ids.some((id) => doc.nodes.get(id)!.parent !== p)) return 'Group needs shapes with the same parent.';\n", to: '',
    run: drawTests('editor.test.ts'), expect: /✖ Group puts the selection in a new <g>/,
  },
  {
    id: 'B364', what: 'Hide writes visibility instead',
    file: 'projects/draw/src/editor.ts', from: "apply(opSetAttr(doc, id, null, 'display', hidden ? 'none' : null))", to: "apply(opSetAttr(doc, id, null, 'visibility', hidden ? 'hidden' : null))",
    run: drawTests('editor.test.ts'), expect: /✖ Layers: Hide writes display="none"/,
  },
  {
    id: 'B365', what: 'the rem report misses rem in style=""',
    file: 'engine/report/import-report.ts', from: '      for (const a of n.attrs) attributes += countRem(a.raw);', to: "      for (const a of n.attrs) if (a.local !== 'style') attributes += countRem(a.raw);",
    run: engineTests('report/import-report.test.ts'), expect: /✖ rem lengths in attributes and style="" are counted/,
  },
  {
    id: 'B366', what: 'distribute keeps unequal gaps',
    file: 'projects/draw/src/interact/align.ts', from: '    const d = at - lo(boxes[i]);', to: '    const d = 0 * (at - lo(boxes[i]));',
    run: drawTests('align.test.ts'), expect: /✖ align deltas: each box to the target/,
  },
  {
    id: 'B367', what: 'Rename leaves a reference behind',
    file: 'projects/draw/src/editor.ts', from: '      else renameIdsIn(doc, doc.root, new Map([[was, next]]), apply);', to: "      else apply(opSetAttr(doc, id, null, 'id', next));",
    run: drawTests('editor.test.ts'), expect: /✖ Layers: Hide writes display="none"/,
  },
  {
    id: 'B373', what: 'a marquee takes a shape visibility hides',
    file: 'projects/draw/src/editor.ts', from: '      if (!m || m.hidden) return false;', to: '      if (!m) return false;',
    run: drawTests('editor.test.ts'), expect: /✖ a marquee and Select all pass by a shape visibility hides/,
  },
  {
    id: 'B374', what: "a move in the root's own units needs the root measured (a file with text: nothing moves)",
    file: 'projects/draw/src/editor.ts', from: "      const m = p === doc.root ? root : measured.get(p)?.toHost; // the root's own units are the camera's, measured or not", to: '      const m = measured.get(p)?.toHost;',
    run: drawTests('editor.test.ts'), expect: /✖ no raw items:/,
  },
  // P1-M1 S4, slow.
  {
    id: 'B368', what: "the copy keeps the original's ids", slow: true, checks: ['duplicateGetsFreshIdsAndItsOwnReferences'],
    file: 'projects/draw/src/interact/structure.ts', from: '          const now = freshId(doc, was, taken);', to: '          const now = was;',
    run: DRAW_E2E, expect: /duplicateGetsFreshIdsAndItsOwnReferences: the copy's ids are not fresh/,
  },
  {
    id: 'B369', what: "ungroup drops the group's transform", slow: true, checks: ['groupAndUngroupKeepEveryShapeInPlace'],
    file: 'projects/draw/src/interact/structure.ts', from: '    if (!t || gValue === null || !gValue.trim()) continue;', to: '    continue;',
    run: DRAW_E2E, expect: /groupAndUngroupKeepEveryShapeInPlace: Ungroup did not push translate\(10 5\) rotate\(15\) into each child/,
  },
  {
    id: 'B370', what: 'a locked shape takes taps', slow: true, checks: ['layersHideAndLockShapes'],
    file: 'projects/draw/src/editor.ts', from: '    const target = targets.find((t) => !isLocked(doc, t)) ?? null;', to: '    const target = targets[0] ?? null;',
    run: DRAW_E2E, expect: /layersHideAndLockShapes: a tap on the locked disc took <circle#disc>, not the sky under it/,
  },
  {
    id: 'B371', what: 'As-is keeps <draw:state>', slow: true, checks: ['drawStateStaysOutOfAsIsAndClean'],
    file: 'projects/draw/src/export/svg.ts', from: "  const text = clean ? clean.text : kind === 'as-is' ? stripDrawState(doc) : serialize(doc);", to: '  const text = clean ? clean.text : serialize(doc);',
    run: DRAW_E2E, expect: /drawStateStaysOutOfAsIsAndClean: the As-is export holds draw:/,
  },
  {
    id: 'B372', what: 'a ContextBar button shrinks under 44', slow: true, checks: ['phoneRulesOnTheSelectionTools'],
    file: 'projects/draw/src/app.css', from: '.draw-ctx-btn { display: inline-grid; place-items: center; width: var(--tap-min); padding: 0; }', to: '.draw-ctx-btn { display: inline-grid; place-items: center; width: 2.5rem; min-width: 0; padding: 0; }',
    run: DRAW_E2E, expect: /phoneRulesOnTheSelectionTools \(956\): 440×956:\n\s+one selected: Deselect is 30×44/,
  },
];

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const dry = args.includes('--dry');
const only = args.filter((a) => /^B\d+$/.test(a));
const chosen = BREAKS.filter((b) => (only.length ? only.includes(b.id) : !(quick && b.slow)));

/** The broken file's text: the original with the break applied (the real run and the dry run share this). */
function applyBreak(b, original) {
  return b.append != null ? original + b.append : original.replace(b.from, b.to);
}

// ── the dry run: does every chosen break still apply? ─────────────────────────────────────────
if (dry) {
  const problems = [];
  const ids = new Map();
  for (const b of BREAKS) ids.set(b.id, (ids.get(b.id) ?? 0) + 1);
  for (const b of chosen) {
    const say = (kind, text) => problems.push(`${b.id.padEnd(5)} ${kind.padEnd(8)} ${text}`);
    if (ids.get(b.id) > 1) say('DUP', 'the id is used by another break');
    const missing = [];
    if (!Array.isArray(b.run)) missing.push('run');
    if (!(b.expect instanceof RegExp)) missing.push('an expect RegExp');
    const edits = b.file && (b.append != null || (b.from != null && b.to != null));
    const creates = b.create && b.content != null;
    if (!edits && !creates) missing.push('file with from/to or append, or create with content');
    if (missing.length) {
      say('BAD', `no ${missing.join(', no ')}`);
      continue;
    }
    if (b.create && existsSync(join(REPO, b.create))) say('TAKEN', `${b.create}: the path already exists`);
    if (!b.file) continue;
    const path = join(REPO, b.file);
    if (!existsSync(path)) {
      say('MISSING', `${b.file}: no such file`);
      continue;
    }
    const original = readFileSync(path, 'utf8');
    if (applyBreak(b, original) !== original) continue;
    const found = b.from instanceof RegExp ? new RegExp(b.from.source, b.from.flags.replace(/[gy]/g, '')).test(original) : original.includes(b.from);
    if (found) say('NOOP', `${b.file}: the anchor is there but replacing it changes nothing`);
    else say('STALE', `${b.file}: the anchor is not in the file`);
  }
  for (const p of problems) console.log(p);
  const bad = new Set(problems.map((p) => p.split(' ')[0])).size;
  console.log(bad ? `Dry run: ${chosen.length} break(s) checked; ${bad} would not apply.` : `Dry run: ${chosen.length} break(s) checked; all apply.`);
  process.exit(bad ? 1 : 0);
}

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
      const next = applyBreak(b, original);
      if (next === original) throw new Error(`${b.id}: the break did not apply (anchor not found)`);
      writeFileSync(file, next);
    }
    if (created) {
      mkdirSync(dirname(created), { recursive: true });
      writeFileSync(created, b.content);
    }
    const [cmd, cmdArgs, cwd] = b.run;
    try {
      const env = b.checks ? { ...process.env, DRAW_E2E_ONLY: b.checks.join(',') } : process.env;
      out = execFileSync(cmd, cmdArgs, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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
if (chosen.some((b) => b.run === DRAW_E2E)) execFileSync('sh', ['-c', DRAW_BUNDLE], { cwd: REPO, stdio: 'ignore' }); // Draw's own bundle back in _site
console.log(undetected ? `\n${undetected} break(s) went undetected.` : `\nAll ${chosen.length} break(s) went red.`);
process.exitCode = undetected ? 1 : 0;
