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
//                                         STALE: the anchor is gone; NOOP: replacing it changes
//                                         nothing; AMBIG: a string anchor, or a RegExp without the
//                                         g flag, matches more than once (counted with CRLF line
//                                         ends read as LF, so a copy in the other ending counts),
//                                         so the break plants only the first match (a g RegExp
//                                         replaces every match on purpose); BAD: a break that can't
//                                         run as written (a sticky RegExp plants only at index 0).
//                                         Any of them fails the run.
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
    run: XML_TESTS, expect: /✖ namespace declarations hold for their element only, at no cost per element[\s\S]*252 nested elements declaring 600 prefixes each took \d+ ms, [\d.]+× the \d+ ms 63 took/,
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
    id: 'B51', what: 'an animation whose href the policy dropped (a URL to another file) animates its parent on the canvas, where the file alone animates nothing', slow: true, checks: ['moreEdges'],
    // P1-M2: re-planted. Its first fault (SMIL judged by the model's first href, not the one the sink
    // kept) can't happen since decision 5: the policy keeps at most one of href and xlink:href.
    // P1-M2 fix (F2): re-planted on the refusal's new call, the same fault.
    file: 'projects/draw/src/canvas/safe-sink.ts', from: '  if (smilHrefLost(node, kept, (a) => decodeAttr(a.raw, doc.entities))) return false;\n', to: '',
    run: DRAW_E2E, expect: /an href to another file (beside a fragment xlink:href )?animates nothing: <animate> is on the canvas/,
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
    // P1-M1 fix (F5): re-anchored; the patches share one memo per change now.
    id: 'B72', what: 'the code view is not patched after an edit',
    file: 'projects/draw/src/editor.ts', from: '      for (const id of r.code.blocks) this.#patchCode(id, memo);\n', to: '',
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
    file: 'projects/draw/src/panels/Sheets.tsx', from: "    const r = editor.sheetInput(t);\n    setProblem('error' in r ? r.error : null);", to: '    const r = editor.sheetInput(t);\n    setProblem(null);',
    run: SITE_E2E, expect: /the Number sheet took "4o" without a word/,
  },
  {
    id: 'B90', what: 'a changed token no longer flashes', slow: true,
    file: 'projects/draw/src/codeview/code-view.ts', from: "const flash = (target: Element | null) => target?.classList.add('cv-flash');", to: 'const flash = (_target: Element | null) => undefined;',
    run: SITE_E2E, expect: /the scrubbed token doesn't flash/,
  },
  {
    // P1-M1 fix: the budget is 1 MB (Mark, 2026-09-30); the same plant, on the new line, run alone.
    id: 'B91', what: 'the initial JS is over its budget (here, a budget the bundle cannot meet)', slow: true, checks: ['initialJsBudget'],
    file: 'projects/draw/test/e2e.mjs', from: 'must(bytes <= 1_000_000,', to: 'must(bytes <= 50_000,',
    run: DRAW_E2E, expect: /over the 1 MB budget/,
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
    file: 'engine/code/edit.ts', from: '(token: Token, text: string): string | null {\n  const bad = NOT_XML_CHAR.exec(text);', to: '(token: Token, text: string): string | null {\n  const bad = null as RegExpExecArray | null;',
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
    file: 'projects/draw/src/app.css', from: '.draw-marks { position: absolute; inset: 0; z-index: 2147483647;', to: '.draw-marks { position: absolute; inset: 0;',
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
    file: 'projects/draw/src/editor.ts', from: "    if (commit && live.kind === 'style') this.#kept(live.prop, live.ids, live.refused);\n    this.#bump();\n    this.#changed();\n", to: "    if (commit && live.kind === 'style') this.#kept(live.prop, live.ids, live.refused);\n    this.#bump();\n",
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
    file: 'projects/draw/src/workspace.ts', from: '    clearFragment();\n    let text: string | null = null;\n', to: '    let text: string | null = null;\n',
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
    file: 'projects/draw/src/workspace.ts', from: "kind, current?.encoding ?? undefined)", to: 'kind, undefined)',
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
    file: 'engine/geometry/css.ts', from: "  return sheetSets(doc, id, prop) === 'no' ? 'no' : 'sheet';", to: "  return 'no';",
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
    // P1-M1 fix (F1): re-anchored; what Draw made is judged by draw-ns.ts's one rule.
    // P1-M2: re-anchored (Draw's <defs> joins the holders an export may drop; a gradient never).
    file: 'engine/export/clean.ts', from: '    if (isAttached(copy, m) && isHolderKind(m) && holdsOnlyDrawItems(copy, m)) drop(m);', to: '    void m;',
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
    // P1-M1 fix (F5): re-anchored; Duplicate reads the ids in use once and hands them to freshId.
    id: 'B368', what: "the copy keeps the original's ids", slow: true, checks: ['duplicateGetsFreshIdsAndItsOwnReferences'],
    file: 'projects/draw/src/interact/structure.ts', from: '          const now = freshId(doc, was, taken, used);', to: '          const now = was;',
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
  // P1-M1 review fixes (F1–F17).
  {
    id: 'B375', what: 'F5: the CSS sheet cache is keyed on doc.version again (a move of k shapes reads every <style> k times)',
    file: 'engine/geometry/css.ts', from: /(hit\.version === |version: )doc\.styleVersion/g, to: '$1doc.version',
    run: drawTests('large-selection.test.ts'), expect: /✖ a command over a large selection takes linear time/,
  },
  {
    id: 'B376', what: 'F5: a <style> that comes into the document is not noticed (a stale sheet)',
    file: 'engine/model/doc.ts', from: '  if (inStyle(doc, parent) || holdsStyle(doc, id)) doc.styleVersion++;\n  return at;', to: '  return at;',
    run: engineTests('geometry/css.test.ts'), expect: /✖ the sheets are read again whenever what a <style> says can change/,
  },
  {
    id: 'B377', what: 'F5: the code view is told about each moved node on its own again',
    file: 'projects/draw/src/editor.ts', from: '    if (placements.length) code.place(placements);', to: '    for (const one of placements) code.place([one]);',
    run: drawTests('editor.test.ts'), expect: /✖ Bring forward and Send back swap each selected element/,
  },
  {
    id: 'B379', what: 'F4: Group nests a shape past the depth the parser opens (a working copy that no longer opens)',
    file: 'projects/draw/src/interact/structure.ts', from: "  if (depthOf(doc, p!) + 1 + ids.reduce((h, id) => Math.max(h, height(doc, id)), 0) > DEFAULT_LIMITS.maxDepth) return `Grouping would nest it deeper than ${DEFAULT_LIMITS.maxDepth} levels.`;\n", to: '',
    run: drawTests('editor.test.ts'), expect: /✖ Group refuses to nest a shape past the depth the parser opens/,
  },
  {
    id: 'B380', what: 'F7: an id may hold a character XML can’t (U+FFFE, a lone surrogate): Rename writes a file that no longer opens',
    file: 'engine/code/edit.ts', from: "  if (bad) return `XML can't hold the character U+${bad[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;\n  return ID.test(text)", to: '  return ID.test(text)',
    run: drawTests('editor.test.ts'), expect: /✖ Rename refuses a name XML can’t hold as an id/,
  },
  {
    id: 'B381', what: 'F16: Ungroup pushes the group’s transform onto every element child again (a clip beside its user is moved twice)',
    file: 'projects/draw/src/interact/structure.ts', from: '    if (!drawnInPlace(k)) continue; // a clip, a gradient, defs…: used where it is referenced\n', to: '',
    run: drawTests('editor.test.ts'), expect: /✖ Ungroup gives the group’s transform only to the children drawn where they sit/,
  },
  {
    id: 'B383', what: 'F16: Ungroup takes a group with a <title> (its name goes to the parent)',
    file: 'projects/draw/src/interact/structure.ts', from: "    if (k.local === 'title') return 'Its title names the group; ungrouping would give it to the parent.';\n", to: '',
    run: drawTests('editor.test.ts'), expect: /✖ Ungroup gives the group’s transform only to the children drawn where they sit/,
  },
  {
    id: 'B384', what: 'F1: any element marked draw:made counts as Draw’s own (a shape so marked leaves the As-is export)',
    // P1-M2: re-anchored. The exports now also ask isHolderKind (a gradient Draw made stays), which
    // alone kept a marked shape, so the fault is planted in both: any element marked draw:made is
    // Draw's, and a holder unless it is a gradient.
    file: 'engine/model/draw-ns.ts',
    from: '  return n.ns === NS.svg && MADE_KINDS.has(n.local) && n.attrs.some((a) => a.ns === DRAW_NS && a.local === \'made\' && a.raw === \'true\');\n}\n\n/** Is this a kind Draw makes only to hold things (a <metadata> or <defs>, in the SVG namespace)? The exports ask before its draw:made goes. */\nexport function isHolderKind(n: ElementNode): boolean {\n  return n.ns === NS.svg && MADE_HOLDERS.has(n.local);\n',
    to: '  return n.attrs.some((a) => a.ns === DRAW_NS && a.local === \'made\' && a.raw === \'true\');\n}\n\n/** Is this a kind Draw makes only to hold things (a <metadata> or <defs>, in the SVG namespace)? The exports ask before its draw:made goes. */\nexport function isHolderKind(n: ElementNode): boolean {\n  return n.local !== \'linearGradient\' && n.local !== \'radialGradient\';\n',
    run: engineTests('draw-state.test.ts'), expect: /✖ only Draw’s own empty <metadata> is taken away/,
  },
  {
    id: 'B385', what: 'F2: a draw:locked on the root locks the whole canvas again',
    file: 'engine/model/draw-state.ts', from: "n && n.kind === 'element' && n.id !== doc.root;", to: "n && n.kind === 'element';",
    run: drawTests('editor.test.ts'), expect: /✖ a lock on the root is not Draw’s/,
  },
  {
    id: 'B386', what: 'F3: a panel edit during a handle or guide drag throws instead of being refused',
    // P1-M3: re-planted on the guard that now names the Pen's drag too, the same fault.
    file: 'projects/draw/src/editor.ts', from: 'this.#gesture?.move || this.#gesture?.hd || this.#gesture?.gd || this.#gesture?.draw?.drag || this.#gesture?.pen?.drag || this.#nudge', to: 'this.#gesture?.move || this.#gesture?.draw?.drag || this.#gesture?.pen?.drag || this.#nudge',
    run: drawTests('editor.test.ts'), expect: /✖ an edit from a panel during a handle or guide drag is refused quietly/,
  },
  {
    id: 'B387', what: 'F6: a corner drag gathers its snap targets on every frame again',
    file: 'projects/draw/src/editor.ts', from: '    const targets = hd.targets;\n', to: '    const targets = this.#snapTargets([hd.id]);\n',
    run: drawTests('editor.test.ts'), expect: /✖ a corner drag gathers its snap targets once/,
  },
  {
    id: 'B388', what: 'F8: every guide a file lists is read (a million make each overlay frame seconds long)',
    file: 'engine/model/draw-state.ts', from: '  while (guides.length < MAX_GUIDES) {', to: '  while (guides.length < Infinity) {',
    run: engineTests('draw-state.test.ts'), expect: /✖ a state with 10⁶ guides reads its first 100 in under 50 ms/,
  },
  {
    id: 'B389', what: 'F9: the scale diamond drops the sign of scale() (a mirror flips the other axis and shrinks)',
    file: 'projects/draw/src/interact/handles.ts', from: '  if (k < 0) return -scaleStep(-k);\n', to: '',
    run: drawTests('editor.test.ts'), expect: /✖ on a mirrored element the scale diamond keeps the mirror/,
  },
  {
    id: 'B390', what: 'F9: the ring takes its flip from the parent alone (on a mirrored list it turns against the finger)',
    file: 'projects/draw/src/editor.ts', from: "      for (const it of list ? (r === -1 ? list.items : list.items.slice(0, r)) : []) before = multiply(before, itemMatrix(it));\n", to: '',
    run: drawTests('editor.test.ts'), expect: /✖ on a mirrored element the scale diamond keeps the mirror/,
  },
  {
    id: 'B391', what: 'F11: each keystroke in the Grid step field is its own history entry again',
    file: 'projects/draw/src/editor.ts', from: '    d.drag.update((apply) => writeState(doc, { ...d.from, grid: step }, apply));\n', to: '    d.drag.update((apply) => writeState(doc, { ...d.from, grid: step }, apply));\n    this.gridStepEnd();\n',
    run: drawTests('editor.test.ts'), expect: /✖ the Snap sheet’s Grid step field is one history entry/,
  },
  {
    id: 'B394', what: 'F10: a move of an element whose transform flattens it is not refused',
    file: 'engine/geometry/write.ts', from: "      if (!inv) return refuse(FLATTENS);\n", to: '',
    run: engineTests('geometry/write.test.ts'), expect: /✖ CSS-controlled geometry and transforms are refused with their reasons/,
  },
  {
    id: 'B395', what: 'F14: Convert rem writes a unitless length into style="" again',
    file: 'engine/geometry/lengths.ts', from: "`${fmt(Number(n) * rootFont, 4)}${css ? 'px' : ''}`", to: 'fmt(Number(n) * rootFont, 4)',
    run: engineTests('geometry/lengths.test.ts'), expect: /✖ in a style declaration a converted rem keeps a unit/,
  },
  {
    id: 'B397', what: 'F12: Hide writes display="none" where CSS sets display (the refusal skipped)',
    file: 'projects/draw/src/editor.ts', from: "    if (cssSets(doc, id, 'display') !== 'no') return void this.notice.set('Its display is set by CSS.');\n", to: '',
    run: drawTests('editor.test.ts'), expect: /✖ Hide and Show are refused, with the reason, when CSS sets display/,
  },
  {
    id: 'B398', what: 'F12: the centre handle’s tooltip reads the shape’s old centre',
    file: 'projects/draw/src/editor.ts', from: "    let text = `x ${fmt(cx, dec)}, y ${fmt(cy, dec)}`;", to: "    let text = `x ${fmt(cx - m.delta.x, dec)}, y ${fmt(cy - m.delta.y, dec)}`;",
    run: drawTests('editor.test.ts'), expect: /✖ the centre handle moves the shape by whole units, with the tooltip/,
  },
  {
    id: 'B399', what: 'F12: a dragged corner ignores the snap targets',
    file: 'projects/draw/src/editor.ts', from: '    if (!toHost || !inv || !targets) return to;', to: '    if (!toHost || !inv || !targets || true) return to;',
    run: drawTests('editor.test.ts'), expect: /✖ a dragged corner snaps to a guide within 8 px/,
  },
  {
    id: 'B400', what: 'F12: the ring and the diamond lose the lab’s magenta stroke',
    file: 'projects/draw/src/app.css', from: '.draw-hd.rot, .draw-hd.scale { stroke: #e6007e; }', to: '.draw-hd.rot, .draw-hd.scale { stroke: #00a3e0; }',
    run: drawTests('overlay-model.test.ts'), expect: /✖ the seven handle styles are SVG Lab’s/,
  },
  {
    id: 'B401', what: 'F12: a nested svg’s corner resize measures its content, not its own viewport',
    file: 'engine/geometry/write.ts', from: '    const vp = nestedViewport(doc, n, opts.ctx);', to: '    const vp = localBounds(doc, id, opts.ctx);',
    run: engineTests('geometry/write.test.ts'), expect: /✖ corner resizes of a nested svg, an image and a foreignObject/,
  },
  // P1-M1 follow-ups.
  {
    id: 'B403', what: 'the overlay’s union box spreads every corner into Math.min again (a selection of 50,000 shapes throws)',
    file: 'projects/draw/src/interact/overlay-model.ts', from: 'export function unionBox(quads: readonly Quad[]): Rect | null {\n',
    to: 'export function unionBox(quads: readonly Quad[]): Rect | null {\n  const pts = quads.flat();\n  if (!pts.length) return null;\n  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);\n  const x = Math.min(...xs), y = Math.min(...ys);\n  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };\n',
    run: drawTests('overlay-model.test.ts'), expect: /✖ the union boxes take 200,000 boxes without throwing/,
  },
  {
    id: 'B404', what: 'Align’s union box spreads every box into Math.min again (Align over 200,000 shapes throws)',
    file: 'projects/draw/src/editor.ts', from: 'export const unionRect = (bs: readonly Rect[]): Rect => {\n',
    to: 'export const unionRect = (bs: readonly Rect[]): Rect => {\n  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));\n  return { x, y, width: Math.max(...bs.map((b) => b.x + b.width)) - x, height: Math.max(...bs.map((b) => b.y + b.height)) - y };\n',
    run: drawTests('overlay-model.test.ts'), expect: /✖ the union boxes take 200,000 boxes without throwing/,
  },
  {
    id: 'B405', what: 'Ungroup takes a group that holds an animation of itself (the animation retargets to the parent)',
    file: 'projects/draw/src/interact/structure.ts', from: "    if (ANIMATIONS.has(k.local) && animatesGroup(doc, k, own)) return 'It holds an animation that targets the group; ungrouping would retarget it.';\n", to: '',
    run: drawTests('editor.test.ts'), expect: /✖ Ungroup is refused, with the reason, when the group holds an animation that animates it/,
  },
  {
    id: 'B406', what: 'Ungroup pushes its transform onto a child something refers to (a use of it takes the transform twice)',
    file: 'projects/draw/src/interact/structure.ts', from: "  if (attrValue(doc, n, null, 'transform')?.trim()) {\n    const pushed", to: '  if (false) {\n    const pushed',
    run: drawTests('editor.test.ts'), expect: /✖ Ungroup is refused, with the reason, when a use, an href or a url\(#…\) refers to a child/,
  },
  // P1-M1, CI run 34: the geometry check's known WebKit differences stay narrow (probe-helpers/geometry-known.mjs).
  {
    id: 'B407', what: "the geometry check excuses a foreignObject's position in every engine, not just WebKit",
    file: 'projects/draw/test/probe-helpers/geometry-known.mjs', from: "if (engine === 'webkit' && local === 'foreignObject'", to: "if (local === 'foreignObject'",
    run: drawTests('geometry-known.test.ts'), expect: /✖ the geometry check's known differences are narrow[\s\S]*Chromium is held to the position/,
  },
  {
    id: 'B408', what: 'the geometry check excuses any flat box, a line that draws included',
    file: 'projects/draw/test/probe-helpers/geometry-known.mjs', from: "if (DISABLED_WHEN_EMPTY.has(local) && (w === 0 || h === 0)) return 'zero-size';", to: "if (w === 0 || h === 0) return 'zero-size';",
    run: drawTests('geometry-known.test.ts'), expect: /✖ the geometry check's known differences are narrow[\s\S]*a flat line still draws/,
  },
  // P1-M1 review fixes, slow.
  {
    id: 'B378', what: 'F5: the CSS sheet cache is keyed on doc.version again (a drag frame over 2,000 shapes costs far more than 4× one over 500)', slow: true, checks: ['aLargeSelectionDragsWithoutStalling'],
    file: 'engine/geometry/css.ts', from: /(hit\.version === |version: )doc\.styleVersion/g, to: '$1doc.version',
    run: DRAW_E2E, expect: /aLargeSelectionDragsWithoutStalling: a drag frame over 2000 selected shapes took \d+ ms \(the median\), [\d.]+× the \d+ ms over 500, not under 6×/,
  },
  {
    id: 'B392', what: 'F11: each keystroke in the Grid step field is its own history entry again', slow: true, checks: ['theGridStepFieldIsOneEntry'],
    file: 'projects/draw/src/editor.ts', from: '    d.drag.update((apply) => writeState(doc, { ...d.from, grid: step }, apply));\n', to: '    d.drag.update((apply) => writeState(doc, { ...d.from, grid: step }, apply));\n    this.gridStepEnd();\n',
    run: DRAW_E2E, expect: /theGridStepFieldIsOneEntry: one undo did not give Auto back/,
  },
  {
    id: 'B393', what: 'F13: the Snap sheet is rendered inside the canvas again (clipped by it, under its chrome and marks)', slow: true, checks: ['theSnapSheetIsReachableOnThePhone'],
    file: 'projects/draw/src/panels/Canvas.tsx', from: "{open && createPortal(<SnapSheet editor={editor} close={() => setOpen(false)} />, area.current?.closest('.draw') ?? document.body)}", to: '{open && <SnapSheet editor={editor} close={() => setOpen(false)} />}',
    run: DRAW_E2E, expect: /theSnapSheetIsReachableOnThePhone: (Done is at .* outside the|on top of (Done|the Grid step field) is)/,
  },
  {
    id: 'B396', what: "F17: the camera's rule leaves its cascade layer (a file's #id rule with !important moves the drawing off its paper)", slow: true, checks: ['aFilesOwnCssCantMoveItsDrawing'],
    file: 'projects/draw/src/canvas/safe-sink.ts', from: /`@layer draw-camera \{ (:host > svg \{[^`]*\}) \}`/, to: '`$1`',
    run: DRAW_E2E, expect: /aFilesOwnCssCantMoveItsDrawing: the file's #r \{ left, top !important \} moved the drawing/,
  },
  {
    id: 'B402', what: 'F12: the Snap sheet’s toggles are not kept on the device (forgotten on a reload)', slow: true, checks: ['theGridToggleShowsTheGrid'],
    file: 'projects/draw/src/panels/Canvas.tsx', from: "    writePref('snap', SNAP_NAMES.filter(([n]) => !next[n]).map(([n]) => n).join(' ') || null);\n", to: '',
    run: DRAW_E2E, expect: /theGridToggleShowsTheGrid: after a reload the Snap toggles are/,
  },
  {
    id: 'B382', what: 'F16: Ungroup pushes the group’s transform onto the clip too (the drawing changes)', slow: true, checks: ['groupAndUngroupKeepEveryShapeInPlace'],
    file: 'projects/draw/src/interact/structure.ts', from: '    if (!drawnInPlace(k)) continue; // a clip, a gradient, defs…: used where it is referenced\n', to: '',
    run: DRAW_E2E, expect: /groupAndUngroupKeepEveryShapeInPlace: Ungroup gave the clip the group's transform/,
  },
  // P1-M2 S0: what M1 left. B307 (above) is item 4's break: the namespace timing test is a ratio now.
  {
    id: 'B409', what: 'the reference index spreads each missing id’s references into push() again (a file with 200,000 references to one missing id throws)',
    file: 'engine/model/refs.ts', from: 'for (const [id, list] of refs) if (!ids.has(id)) for (const r of list) dangling.push(r);', to: 'for (const [id, list] of refs) if (!ids.has(id)) dangling.push(...list);',
    run: engineTests('refs.test.ts'), expect: /✖ a file with 200,000 references to one missing id builds its reference index/,
  },
  {
    id: 'B410', what: 'Ungroup refuses a reference to anything inside a child again (Illustrator’s clipPath and use in a nested group are refused)',
    file: 'projects/draw/src/interact/structure.ts', from: "      if (k?.kind === 'element' && drawnInPlace(k)) pushed.add(c);\n", to: "      if (k?.kind === 'element' && drawnInPlace(k)) for (const d of descendants(doc, c)) if (d.kind === 'element') pushed.add(d.id);\n",
    run: drawTests('editor.test.ts'), expect: /✖ Ungroup is refused, with the reason, when a use, an href or a url\(#…\) refers to a child that takes the group’s transform \(the child itself\)/,
  },
  {
    id: 'B411', what: 'Ungroup pushes the group’s transform into a child whose transform an animateTransform sets',
    file: 'projects/draw/src/interact/structure.ts', from: "      if ([...own, ...byHref].some((a) => a.kind === 'element' && setsTransform(doc, a))) {", to: '      if (false) {',
    run: drawTests('editor.test.ts'), expect: /✖ Ungroup is refused, with the reason, when an animateTransform sets the transform of a child/,
  },
  {
    id: 'B412', what: 'a foreignObject is measured by getBBox again (WebKit’s leaves its x and y out: Safari outlines it at its parent’s origin)', slow: true, checks: ['aForeignObjectIsOutlinedWhereItDraws'],
    file: 'projects/draw/src/panels/views.ts', from: "        if (g.localName === 'foreignObject' && g.namespaceURI === SVG_NS) {", to: '        if (false) {',
    run: DRAW_E2E, expect: /aForeignObjectIsOutlinedWhereItDraws: with WebKit's getBBox: the foreignObject's outline .* is not on it/,
  },
  // P1-M2 S1: the Shapes tool, shape handles and generators (quick).
  {
    id: 'B413', what: 'the star’s inner points take the tips’ angles',
    file: 'engine/generators/radial.ts', from: 'at(cx, cy, r * inner, t + 180 / tips)', to: 'at(cx, cy, r * inner, t)',
    run: engineTests('generators/generators.test.ts'), expect: /✖ each generator writes exactly its points or path for fixed inputs/,
  },
  {
    id: 'B414', what: 'the spiral’s controls are Δ/2 along the tangent, not Δ/3 (not a cubic Hermite)',
    file: 'engine/generators/spiral.ts', from: '    const h = dt / 3;', to: '    const h = dt / 2;',
    run: engineTests('generators/generators.test.ts'), expect: /✖ each generator writes exactly its points or path for fixed inputs/,
  },
  {
    id: 'B415', what: 'the finish hook redraws a shape whose geometry was edited by hand, instead of detaching it',
    file: 'engine/generators/index.ts', from: '    if (expected !== null && inputsTouched && !geometryTouched) {', to: '    if (expected !== null) {',
    run: engineTests('generators/generators.test.ts'), expect: /✖ the finish hook: an input edit regenerates and a geometry edit detaches/,
  },
  {
    id: 'B416', what: 'the finish hook’s ops are applied but not recorded with the transaction (one undo leaves them behind)',
    file: 'engine/commands/session.ts', from: 'if (this.finish) this.finish(this.doc, ops.slice(), (op) => ops.push(op));', to: 'if (this.finish) this.finish(this.doc, ops.slice(), () => {});',
    run: engineTests('commands/commands.test.ts'), expect: /✖ the finish hook: its ops join the transaction and the drag frame/,
  },
  {
    id: 'B417', what: 'planMove moves a generated shape’s points, not its inputs (the hook then detaches it)',
    file: 'engine/geometry/write.ts', from: '  if (generatorOf(doc, id)) {', to: '  if (false) {',
    run: engineTests('generators/generators.test.ts'), expect: /✖ the finish hook: a move rewrites only draw:cx, draw:cy and the geometry/,
  },
  {
    id: 'B418', what: 'a radius (or rx, ry) handle has no minimum: dragged onto the centre it writes 0',
    file: 'engine/geometry/shape-handles.ts', from: '  const length = (d: number) => Math.max(1, onStep(d, opts.step));', to: '  const length = (d: number) => onStep(d, opts.step);',
    run: engineTests('geometry/shape-handles.test.ts'), expect: /✖ a drag writes the lab’s numbers/,
  },
  {
    id: 'B419', what: 'a vertex drag writes the whole points list again (its separators and precision lost)',
    file: 'engine/geometry/shape-handles.ts', from: '      return next.length ? one(rewrite(doc, n, \'points\', a.raw, next)) : { edits };',
    to: "      return one({ id: n.id, ns: null, local: 'points', raw: tokens.map((t, j) => (j === 2 * i ? fmt(to.x, 2) : j === 2 * i + 1 ? fmt(to.y, 2) : fmt(t.value, 2))).join(' '), add: false });",
    run: engineTests('geometry/shape-handles.test.ts'), expect: /✖ over every corpus circle, ellipse, line, polygon and polyline, a handle moved by \(3, −2\) changes exactly the number tokens it owns/,
  },
  {
    id: 'B420', what: 'the Shapes tool ignores the artboard’s size (k is always 1)',
    file: 'projects/draw/src/interact/shapes-tool.ts', from: '(board && board.width > 0 && board.height > 0 ? Math.min(board.width, board.height) / 100 : 1)', to: '1',
    run: drawTests('shapes-tool.test.ts'), expect: /✖ on a 24 × 24 artboard \(k = 0\.24\) a tap places a 10 × 7 rect/,
  },
  {
    id: 'B421', what: 'the colour cycle restarts for every shape',
    file: 'projects/draw/src/editor.ts', from: '  #placed(id: NodeId): void {\n    this.#shapes++;\n', to: '  #placed(id: NodeId): void {\n',
    run: drawTests('shapes-tool.test.ts'), expect: /✖ a tap places SVG Lab’s default for each kind on lab\/create\.svg/,
  },
  {
    id: 'B422', what: 'a new shape in an empty root goes after the root’s closing whitespace, not before it',
    file: 'engine/model/space.ts', from: "  return { parent: p.id, index: p.children.length - 1, lead: /[\\r\\n]/.test(w) ? `${w}  ` : '', trail: '' };", to: "  return { parent: p.id, index: p.children.length, lead: '', trail: '' };",
    run: drawTests('shapes-tool.test.ts'), expect: /✖ a tap places SVG Lab’s default for each kind on lab\/create\.svg/,
  },
  {
    id: 'B423', what: 'the ry handle writes rx',
    file: 'engine/geometry/shape-handles.ts', from: "      return one(lengthEdit(doc, n, 'ry', 'y', { to: length(Math.abs(to.y - centre!.y)) }, opts));", to: "      return one(lengthEdit(doc, n, 'rx', 'x', { to: length(Math.abs(to.y - centre!.y)) }, opts));",
    run: drawTests('lab-goals.test.ts'), expect: /✖ lab goal "Ellipse into a circle" \(shapes\)/,
  },
  {
    id: 'B424', what: 'a draw gathers its snap targets on every frame (every shape measured again)',
    file: 'projects/draw/src/editor.ts', from: '    const b = this.#snapRoot(g.at, d.targets, d.step);', to: '    const b = this.#snapRoot(g.at, this.#snapTargets([]), d.step);',
    run: drawTests('shapes-tool.test.ts'), expect: /✖ a drag gathers its snap targets once, when it starts/,
  },
  {
    id: 'B425', what: 'a shape handle’s drag gathers its snap targets on every frame',
    file: 'projects/draw/src/editor.ts', from: "      if (shape.role === 'position') to = this.#cornerPoint(g, hd, f);", to: "      if (shape.role === 'position') to = this.#cornerPoint(g, { ...hd, targets: this.#snapTargets([hd.id]) }, f);",
    run: drawTests('editor.test.ts'), expect: /✖ a shape-handle drag gathers its snap targets once/,
  },
  {
    id: 'B426', what: 'shape handles are placed through the parent’s matrix, not the element’s own (a mirrored element’s radius handle on the wrong side)',
    file: 'projects/draw/src/editor.ts', from: '      const [x, y] = applyM(m.toHost, q.x, q.y);', to: '      const [x, y] = applyM(this.#ports.canvas.measure([n.parent!]).get(n.parent!)?.toHost ?? rootToHostMatrix(this.#box!, this.#viewport, this.#M), q.x, q.y);',
    run: drawTests('editor.test.ts'), expect: /✖ on a mirrored element, and inside a mirrored group, a radius or end handle stays under the finger/,
  },
  {
    id: 'B427', what: 'each keystroke that reads in a Generator field is its own history entry (Inner typed 0.6, then 0.65, makes two)',
    file: 'projects/draw/src/editor.ts', from: '    f.drag.update((apply) => apply(this.#inputOp(f.ids[0], name, v)));\n', to: '    f.drag.update((apply) => apply(this.#inputOp(f.ids[0], name, v)));\n    this.fieldEnd();\n',
    run: drawTests('editor.test.ts'), expect: /✖ generated shapes: the Tips field, typed "12"/,
  },
  {
    id: 'B428', what: 'a handle grabbed off its centre jumps to the finger again (decision 1: every handle keeps the grab)',
    file: 'projects/draw/src/editor.ts', from: '    const grab = g.handleAt ? { x: g.handleAt.x - g.at0.x, y: g.handleAt.y - g.at0.y } : { x: 0, y: 0 };', to: '    const grab = { x: 0, y: 0 };',
    run: drawTests('editor.test.ts'), expect: /✖ a handle drag keeps the grab/,
  },
  {
    id: 'B429', what: 'M1’s resize corners still show on a circle (and every shape-handle kind)',
    file: 'projects/draw/src/editor.ts', from: 'corners: !takesShapeHandles(doc, n.id) && RESIZABLE.has(n.local)', to: "corners: RESIZABLE.has(n.local) || ['circle', 'ellipse', 'line', 'polygon', 'polyline'].includes(n.local)",
    run: drawTests('editor.test.ts'), expect: /✖ the overlay gives circles, ellipses, lines, polygons, polylines and generated shapes their own handles and no corners/,
  },
  // P1-M2 S1 (slow: one per new e2e check, each naming it).
  {
    id: 'B430', what: 'a Shapes tap places at the canvas’s top-left, not under the finger', slow: true, checks: ['aTapPlacesTheLabsDefaultScaledToTheArtboard'],
    file: 'projects/draw/src/editor.ts', from: '      const p = this.#snapRoot(g.at0, this.#snapTargets([]), d.step).p;', to: '      const p = this.#snapRoot({ x: 0, y: 0 }, this.#snapTargets([]), d.step).p;',
    run: DRAW_E2E, expect: /aTapPlacesTheLabsDefaultScaledToTheArtboard: the rect is not exactly the lab's, centred on \(50, 50\)/,
  },
  {
    id: 'B431', what: 'a draw ignores the snap targets (the guide at x 40 isn’t taken)', slow: true, checks: ['aDragDrawsTheShapeWithSnapping'],
    file: 'projects/draw/src/editor.ts', from: '      d.targets = this.#snapTargets([]);', to: '      d.targets = null;',
    run: DRAW_E2E, expect: /aDragDrawsTheShapeWithSnapping: the drag from \(38\.6, 20\.2\) to \(70\.3, 45\.8\) did not snap/,
  },
  {
    id: 'B432', what: 'shape handles are placed through the root’s matrix: the rotated ellipse’s rx handle ignores its transform', slow: true, checks: ['shapeHandlesEditTheLabsShapes'],
    file: 'projects/draw/src/editor.ts', from: '      const [x, y] = applyM(m.toHost, q.x, q.y);', to: '      const [x, y] = applyM(rootToHostMatrix(this.#box!, this.#viewport, this.#M), q.x, q.y);',
    run: DRAW_E2E, expect: /shapeHandlesEditTheLabsShapes: the ellipse's rx handle is at .* not its own \(90, 30\) through its transform/,
  },
  {
    id: 'B433', what: 'an Inspect input edit doesn’t redraw the generated shape (the hook leaves the old points)', slow: true, checks: ['generatorsRegenerateAndDetach'],
    file: 'engine/generators/index.ts', from: '      apply(opSetAttr(doc, id, null, g.attr, expected));\n', to: '',
    run: DRAW_E2E, expect: /generatorsRegenerateAndDetach: Tips \+ did not draw 12 points/,
  },
  // P1-M2 S2: Inspect and colour. The style engine and the colour notations first (quick).
  {
    id: 'B434', what: 'a style="" declaration’s value is written without the spacing around it (its neighbours’ bytes change)',
    file: 'engine/style/write.ts', from: 'raw: raw.slice(0, d.start) + escape(v, a.quote) + raw.slice(d.end), add: false };', to: 'raw: raw.slice(0, d.start).trimEnd() + escape(v, a.quote) + raw.slice(d.end).trimStart(), add: false };',
    run: engineTests('style/style.test.ts'), expect: /✖ a declaration among others is rewritten alone/,
  },
  {
    id: 'B435', what: 'a value a <style> rule sets is written as the attribute anyway (it changes nothing on screen)',
    file: 'engine/style/write.ts', from: "  if (s.sheet === 'rule' && s.at !== 'style') return RULE_SETS(prop);\n", to: '',
    run: engineTests('style/style.test.ts'), expect: /✖ refused, with the reason, and nothing written/,
  },
  {
    id: 'B436', what: 'a style="" declaration’s !important is dropped when its value is written (the span runs over it)',
    file: 'engine/geometry/css.ts', from: '    if (bang) end = bang.index;\n', to: '',
    run: engineTests('style/style.test.ts'), expect: /✖ a declaration among others is rewritten alone/,
  },
  {
    id: 'B437', what: 'the width-2 rule writes a width over the one the shape has',
    file: 'engine/style/write.ts', from: '      if (w.value === null || parseFloat(w.value) === 0) {', to: '      if (true) {',
    run: engineTests('style/style.test.ts'), expect: /✖ the width-2 rule/,
  },
  {
    id: 'B438', what: 'the rule scan drops !important again (a rule’s !important no longer refuses)',
    file: 'engine/geometry/css.ts', from: 'map((d) => ({ name: d.name, important: d.important }))', to: 'map((d) => ({ name: d.name, important: false }))',
    run: engineTests('style/style.test.ts'), expect: /✖ refused, with the reason, and nothing written/,
  },
  {
    id: 'B439', what: 'writeColor writes a modern rgb() with commas (the legacy family’s)',
    file: 'engine/values/color.ts', from: "return notation === 'rgb' ? legacy('rgb', v) : modern('rgb', v);", to: "return legacy('rgb', v);",
    run: engineTests('values/color.test.ts'), expect: /✖ writeColor: each family writes in its own notation/,
  },
  {
    id: 'B440', what: 'a named colour is written back as a name when the picker lands on one',
    file: 'engine/values/color.ts', from: "    case 'named':\n    case 'transparent':\n", to: "    case 'named':\n      return [...NAMED_COLORS].find(([, h]) => h === toHex(srgb))?.[0] ?? toHex(srgb)!;\n    case 'transparent':\n",
    run: engineTests('values/color.test.ts'), expect: /✖ writeColor: each family writes in its own notation/,
  },
  // P1-M2 S2: the editor's style edits and the picker (quick).
  {
    id: 'B441', what: 'a multi-selection style edit is one entry per element',
    file: 'projects/draw/src/editor.ts', from: "    const done = this.#dispatch(`Set ${prop}`, (apply) => {\n      const plan = planStyle(doc, ids, prop, c.text, ctx);", to: "    let done = false;\n    for (const one of ids) done = this.#dispatch(`Set ${prop}`, (apply) => {\n      const plan = planStyle(doc, [one], prop, c.text, ctx);",
    run: drawTests('inspect.test.ts'), expect: /✖ a multi-selection edit is one entry/,
  },
  {
    id: 'B442', what: 'an Inspect field is one entry per keystroke ("25" makes two)',
    file: 'projects/draw/src/editor.ts', from: '      f.refused = this.#styleFrame(f.drag, f.ids, new Map([[f.field.prop, c.text]]));\n', to: '      f.refused = this.#styleFrame(f.drag, f.ids, new Map([[f.field.prop, c.text]]));\n      this.fieldEnd();\n      this.fieldStart(f.field);\n',
    run: drawTests('inspect.test.ts'), expect: /✖ one entry per editing session, per kind/,
  },
  {
    id: 'B443', what: 'the Dash presets ignore k (SVG Lab’s numbers on any artboard)',
    file: 'projects/draw/src/style-edit.ts', from: 'p.map((v) => fmt(v * k, 2))', to: 'p.map((v) => fmt(v, 2))',
    run: drawTests('inspect.test.ts'), expect: /✖ the Dash presets are SVG Lab/,
  },
  {
    id: 'B444', what: 'planStyle reads the stylesheets for every element instead of the cached sheet',
    file: 'engine/geometry/css.ts', from: '  if (hit && hit.version === doc.styleVersion) return hit.sheet;', to: '  if (hit && false) return hit.sheet;',
    run: drawTests('inspect.test.ts'), expect: /✖ a style edit over a large selection takes linear time/,
  },
  {
    id: 'B445', what: 'the picker writes alpha 1 (rgba(…, 1) where the colour is opaque)',
    file: 'engine/values/color.ts', from: '  const A = a >= 1 ? null : ', to: '  const A = a > 1 ? null : ',
    run: drawTests('color-picker.test.ts'), expect: /✖ each move is written in the opening family/,
  },
  {
    id: 'B446', what: 'the picker loses its hue at zero saturation or brightness',
    file: 'projects/draw/src/color-picker.ts', from: '({ ...p, s: unit(s), v: unit(v) });', to: '({ ...p, h: unit(s) && unit(v) ? p.h : 0, s: unit(s), v: unit(v) });',
    run: drawTests('color-picker.test.ts'), expect: /✖ the picker keeps its own hue through grey and black/,
  },
  // P1-M2 S2 (slow: one per new e2e check, each naming it).
  {
    id: 'B447', what: 'Inspect writes the attribute where a style="" declaration holds the value (the declaration still wins, so the drawing wouldn’t change)', slow: true, checks: ['inspectWritesWhereEachValueLives'],
    file: 'engine/style/write.ts', from: "  if (s.at === 'style') {", to: '  if (false) {',
    run: DRAW_E2E, expect: /inspectWritesWhereEachValueLives: the circle’s fill declaration: the source is not the value written where it lives/,
  },
  {
    id: 'B448', what: 'the picker writes hex for an hsl() value (out of its notation family)', slow: true, checks: ['theColourPickerKeepsTheNotation'],
    file: 'projects/draw/src/color-picker.ts', from: "family: own && own.kind === 'color' ? notationOf(own) : 'hex'", to: "family: own && own.kind === 'color' && notationOf(own) !== 'hsl-modern' ? notationOf(own) : 'hex'",
    run: DRAW_E2E, expect: /theColourPickerKeepsTheNotation: hsl\(12 76% 61%\): the square wrote #[0-9a-f]+, out of its family/,
  },
  {
    id: 'B449', what: 'a multi-selection fill from the Colour sheet makes one entry per shape', slow: true, checks: ['aMultiSelectionEditIsOneEntry'],
    file: 'projects/draw/src/editor.ts', from: '    if (commit) live.drag.commit();\n',
    to: "    if (commit && live.kind === 'style' && live.ids.length > 1) {\n      live.drag.cancel();\n      for (const id of live.ids) for (const [p, v] of live.last) this.#session!.dispatch(`Set ${p}`, (apply) => applyPlan(this.#doc!, planStyle(this.#doc!, [id], p, v, this.styleCtx), apply));\n    } else if (commit) live.drag.commit();\n",
    run: DRAW_E2E, expect: /aMultiSelectionEditIsOneEntry: one undo did not give all three back byte for byte/,
  },
  {
    id: 'B450', what: 'the Colour sheet’s HSV square shrinks under 44 pt (2rem: 24 px)', slow: true, checks: ['phoneRulesOnInspectAndThePicker'],
    file: 'projects/draw/src/app.css', from: '.draw-hsv {\n  position: relative;\n  height: 10rem;', to: '.draw-hsv {\n  position: relative;\n  height: 2rem;',
    run: DRAW_E2E, expect: /the Saturation and brightness square is \d+×24, under 44pt/,
  },
  {
    id: 'B451', what: 'the Colour sheet is rendered inside .draw-canvas (contain: strict clips it and holds its fixed position), a second slow break for phoneRulesOnInspectAndThePicker because only the browser’s layout can see a Done that is clipped or covered', slow: true, checks: ['phoneRulesOnInspectAndThePicker'],
    file: 'projects/draw/src/panels/Sheets.tsx',
    from: /^(import \{ useEffect[^\n]*\n)([\s\S]*?)    <Modal key=\{key\} title=\{title\} onClose=\{close\} done=\{sheet\.kind !== 'source'\} mono=\{mono\}>\n      <Body editor=\{editor\} sheet=\{sheet\} close=\{close\} \/>\n    <\/Modal>\n/m,
    to: "$1import { createPortal } from 'react-dom';\n$2    createPortal(<Modal key={key} title={title} onClose={close} done={sheet.kind !== 'source'} mono={mono}>\n      <Body editor={editor} sheet={sheet} close={close} />\n    </Modal>, document.querySelector('.draw-canvas') ?? document.body)\n",
    run: DRAW_E2E, expect: /phoneRulesOnInspectAndThePicker \((956|796)\): 440×(956|796): (Done is at .* outside the|on top of (Done|the Colour field) is)/,
  },
  // P1-M2 S3: gradients, gloss and the gradient handles. The engine first (quick).
  {
    id: 'B452', what: 'a linear gradient takes x1 from a radial template',
    file: 'engine/paint/gradients.ts', from: '  for (const name of GEOMETRY[kind]) take(name, kind);', to: '  for (const name of GEOMETRY[kind]) take(name);',
    run: engineTests('paint/gradients.test.ts'), expect: /✖ the chain: href before xlink:href/,
  },
  {
    id: 'B453', what: 'the stops come from the gradient the paint names even when it has none (not from its template)',
    file: 'engine/paint/gradients.ts', from: 'const holder = chain.find((n) => n.children.some((c) => isStop(doc, c))) ?? null;', to: 'const holder = chain[0];',
    run: engineTests('paint/gradients.test.ts'), expect: /✖ the chain: href before xlink:href/,
  },
  {
    id: 'B454', what: 'a new gradient is named by freshId’s scheme ("linear", not SVG Lab’s "linear-1")',
    file: 'engine/model/ids.ts', from: '    next.set(prefix, n + 1);\n    return `${prefix}-${n}`;', to: '    next.set(prefix, n + 1);\n    return n === 1 ? prefix : `${prefix}-${n}`;',
    run: engineTests('paint/gradients.test.ts'), expect: /✖ Linear on lab\/style\.svg’s circle/,
  },
  {
    id: 'B455', what: 'a Draw-made <defs> left empty stays when its last gradient goes',
    file: 'engine/paint/gradients.ts', from: "    if (n?.kind === 'element' && n.parent !== null && isDrawMadeEmpty(doc, n)) removeWithSpace(doc, h, apply);\n", to: '',
    run: engineTests('paint/gradients.test.ts'), expect: /✖ Linear on lab\/style\.svg’s circle/,
  },
  {
    id: 'B456', what: 'Make unique keeps the template link (the copy still takes from its template)',
    file: 'engine/paint/gradients.ts', from: "  let content = '';\n", to: "  const link = templateLink(el(doc, r.id));\n  if (link) parts.push(`${link.qname}=\"${link.raw}\"`);\n  let content = '';\n",
    run: engineTests('paint/gradients.test.ts'), expect: /✖ Make unique/,
  },
  {
    id: 'B457', what: 'Make unique re-points every user of the gradient, not only this paint',
    file: 'engine/paint/gradients.ts', from: '  const why = repoint(doc, id, prop, own.url, gid, apply);\n', to: "  const why = repoint(doc, id, prop, own.url, gid, apply);\n  for (const u of gradientUsers(doc).of([r.id])) if (u.prop !== 'rule') repoint(doc, u.el, u.prop, own.url, gid, apply);\n", // P1-M2 fix (F7): the users' new API, the same fault
    run: engineTests('paint/gradients.test.ts'), expect: /✖ Make unique/,
  },
  {
    id: 'B458', what: 'the gradient handles apply gradientTransform outside the bounding-box mapping (T·U, not U·T)',
    file: 'engine/paint/handles.ts', from: '  const M = multiply(geo.toHost, multiply(U, T));', to: '  const M = multiply(geo.toHost, multiply(T, U));',
    run: engineTests('paint/handles.test.ts'), expect: /✖ linear and radial handles sit at toHost · U · T · p/,
  },
  {
    id: 'B459', what: 'fixF is gone: a written focus is left outside 0.96 r',
    file: 'engine/paint/handles.ts', from: '    if (d > 0.96 * rr && d > 0) {', to: '    if (false) {',
    run: engineTests('paint/handles.test.ts'), expect: /✖ fixF/,
  },
  {
    id: 'B460', what: 'bounding-box gradient handles round to whole units (not 0.01)',
    file: 'engine/paint/handles.ts', from: ': f.obb ? fmt(n, 2) :', to: ': f.obb ? fmt(n, 0) :',
    run: engineTests('paint/handles.test.ts'), expect: /✖ linear and radial handles sit at toHost · U · T · p/,
  },
  {
    id: 'B461', what: 'Add stop puts the new stop at the next stop’s offset (the end), not the midpoint',
    file: 'engine/paint/stops.ts', from: '  const mid = (o1 + o2) / 2;', to: '  const mid = o2;',
    run: engineTests('paint/gradients.test.ts'), expect: /✖ the stop editor/,
  },
  {
    id: 'B462', what: 'Gloss writes r 0.5, not SVG Lab’s 0.8',
    file: 'engine/paint/gloss.ts', from: `export const GLOSS_ATTRS = 'cx="0.35" cy="0.3" r="0.8"';`, to: `export const GLOSS_ATTRS = 'cx="0.35" cy="0.3" r="0.5"';`,
    run: engineTests('paint/gradients.test.ts'), expect: /✖ Gloss on lab\/create-icon\.svg’s rect/,
  },
  {
    id: 'B463', what: 'Gloss off leaves the gloss gradient (and its <defs>) behind',
    file: 'engine/paint/gloss.ts', from: '  dropUnused(doc, dropped, apply);\n', to: '',
    run: engineTests('paint/gradients.test.ts'), expect: /✖ Gloss on lab\/create-icon\.svg’s rect/,
  },
  {
    id: 'B464', what: 'the template chain follows a relative href (other.svg#a) as if it were #a',
    file: 'engine/paint/gradients.ts', from: "  if (v.length < 2 || !v.startsWith('#')) return null; // another file (value:url/relative): never followed\n  const t = ids.get(decodeFragment(v.slice(1)));", to: "  const t = ids.get(decodeFragment(v.slice(v.indexOf('#') + 1)));",
    run: engineTests('paint/gradients.test.ts'), expect: /✖ a relative URL is not followed/,
  },
  {
    id: 'B465', what: 'a relative URL in a paint’s url() gets no token (the code can’t edit it)',
    // P1-M2 fix (F5): re-planted on the token's new data (its url flag), the same fault.
    file: 'engine/code/tokens.ts', from: "  else if (relative && e > s && t[s] !== '#' && !/^data:/i.test(t.slice(s, e))) emit(at + s, at + e, { kind: 'text', prop, url: g === 1 ? '\"' : g === 2 ? \"'\" : '' });\n", to: '',
    run: engineTests('code/tokens.test.ts'), expect: /✖ a relative URL \(value:url\/relative\)/,
  },
  {
    id: 'B466', what: 'the Draw-made test takes any draw:made value ("yes" counts as Draw’s)',
    file: 'engine/model/draw-ns.ts', from: "a.local === 'made' && a.raw === 'true'", to: "a.local === 'made'",
    run: engineTests('paint/gradients.test.ts'), expect: /✖ the Draw-made predicate/,
  },
  {
    id: 'B467', what: 'the Draw-made test takes a gradient holding a comment (Draw would take the file’s comment away)',
    file: 'engine/model/draw-ns.ts', from: '  if (!isDrawMade(n) || isHolderKind(n)) return false;\n  return n.children.every((c) => {', to: '  if (!isDrawMade(n) || isHolderKind(n)) return false;\n  return true || n.children.every((c) => {',
    run: engineTests('paint/gradients.test.ts'), expect: /✖ the Draw-made predicate/,
  },
  {
    id: 'B468', what: 'decision 5: the render policy keeps xlink:href beside href again (the canvas follows a template the file alone never uses)',
    file: 'engine/policy/render-policy.ts', from: "  if (attr.ns === NS.xlink && attr.local === 'href' && el.attrs.some((a) => a.ns === null && a.local === 'href')) return null;\n", to: '',
    run: POLICY_TESTS, expect: /✖ SVG 2: href wins/,
  },
  // P1-M2 S3: the editor (quick).
  {
    id: 'B469', what: 'a stop’s offset field is one entry per keystroke, not per editing session',
    file: 'projects/draw/src/editor.ts', from: '      f.drag.update((apply) => apply(offsetOp(doc, f.ids[0], Number(t))));\n', to: '      f.drag.update((apply) => apply(offsetOp(doc, f.ids[0], Number(t))));\n      this.fieldEnd();\n      this.fieldStart(f.field);\n',
    run: drawTests('inspect.test.ts'), expect: /✖ the stop editor, one entry per editing session/,
  },
  // P1-M2 S3 (slow: one per new e2e check, each naming it).
  {
    id: 'B470', what: 'the gradient handles ignore gradientTransform (the pixel under the end handle isn’t the last stop’s colour)', slow: true, checks: ['gradientHandlesSitWhereTheGradientDraws'],
    file: 'engine/paint/handles.ts', from: "  const T = parseTransform(valueOf(r, 'gradientTransform'))?.matrix ?? IDENTITY; // an unreadable list draws as none", to: '  const T = IDENTITY;',
    run: DRAW_E2E, expect: /gradientHandlesSitWhereTheGradientDraws: \(b\): the pixel under the (start|end) handle/,
  },
  {
    id: 'B471', what: 'Spread writes spreadMethod on the gradient’s template even where the gradient sets its own (which still wins)', slow: true, checks: ['gradientHandlesSitWhereTheGradientDraws'],
    file: 'engine/paint/gradients.ts', from: '  return a ? opSetAttr(doc, a.from, null, name, value) : opSetAttr(doc, r.id, null, name, value);', to: '  return opSetAttr(doc, r.chain[r.chain.length - 1], null, name, value);',
    run: DRAW_E2E, expect: /gradientHandlesSitWhereTheGradientDraws: Reflect: at t = 1\.75/,
  },
  {
    id: 'B472', what: 'Linear makes a second Draw <defs> instead of using the root’s first', slow: true, checks: ['gradientsGoInDefsWithFreshIds'],
    file: 'engine/paint/gradients.ts', from: '  const defs = rootDefs(doc);', to: '  const defs = null;',
    run: DRAW_E2E, expect: /gradientsGoInDefsWithFreshIds: the polyline's Linear/,
  },
  {
    id: 'B473', what: 'a stop edit on a shared gradient quietly makes it unique first (only one rect changes)', slow: true, checks: ['glossAndMakeUnique'],
    file: 'projects/draw/src/panels/Inspect.tsx', from: "onClick={() => editor.openStyleSheet('stop-color', [stop.id])}", to: "onClick={() => { if ((editor.paintInfo(prop)?.shared ?? 0) > 0) editor.makeUnique(prop); editor.openStyleSheet('stop-color', [editor.paintInfo(prop)!.stops[n - 1].id]); }}",
    run: DRAW_E2E, expect: /glossAndMakeUnique: a stop colour edit on the shared gradient did not change both rects/,
  },
  {
    id: 'B474', what: 'Gloss off leaves xmlns:draw on the root (the file isn’t given back)', slow: true, checks: ['glossAndMakeUnique'],
    file: 'engine/paint/gradients.ts', from: '  undeclareIfUnused(doc, apply);\n', to: '',
    run: DRAW_E2E, expect: /glossAndMakeUnique: Gloss off did not give the file back/,
  },
  // P1-M2 fix (the review's findings): quick unless marked, each slow one naming its checks.
  {
    id: 'B475', what: 'F8: Gloss and Linear put each shape’s gradient in with a fragment parse of its own (which reads the whole document), so a command over many shapes is quadratic again',
    file: 'engine/paint/gradients.ts', from: '  if (!markups.length) return [];\n', to: '  if (!markups.length) return [];\n  if (markups.length > 1) return markups.flatMap((m) => insertGradients(doc, [m], apply));\n',
    run: drawTests('inspect.test.ts'), expect: /✖ Gloss, Gloss off, Linear and None over a large selection take linear time/,
  },
  {
    id: 'B476', what: 'F9: the <style> scan is skipped, so Draw takes away a gradient a stylesheet rule still paints with (and the rule is no user)',
    file: 'engine/geometry/css.ts', from: '    for (const rule of textContent(doc, n.id).split(/[{}]/)) {', to: '    for (const rule of [] as string[]) {',
    run: engineTests('paint/gradients.test.ts'), expect: /✖ a gradient a <style> rule still paints with stays/,
  },
  {
    id: 'B477', what: 'F2: only the attribute animations go with an href the canvas dropped (an animateMotion keeps moving its parent)',
    file: 'engine/policy/render-policy.ts', from: '  if (!isAnimation(el) || kept !== null) return false;', to: '  if (!animatesAttribute(el) || kept !== null) return false;',
    run: POLICY_TESTS, expect: /✖ SMIL: an animation whose href the canvas dropped goes with it/,
  },
  {
    id: 'B478', what: 'F3: an empty href counts as one the canvas dropped (an animation of its parent vanishes)',
    file: 'engine/policy/render-policy.ts', from: "  return href !== undefined && value(href) !== '';", to: '  return href !== undefined;',
    run: POLICY_TESTS, expect: /✖ SMIL: an animation whose href the canvas dropped goes with it/,
  },
  {
    id: 'B479', what: 'F2 and F3 on the canvas: the reviewed rule back (judged after the attribute animations’ early return, and any href counted): an animateMotion to another file moves its parent, and an animate or set with href="" vanishes', slow: true, checks: ['moreEdges'],
    file: 'projects/draw/src/canvas/safe-sink.ts', from: "  if (!isAnimation(node)) return true;\n  const kept = el.getAttributeNS(null, 'href') ?? el.getAttributeNS(NS.xlink, 'href');\n  if (smilHrefLost(node, kept, (a) => decodeAttr(a.raw, doc.entities))) return false;\n  if (!animatesAttribute(node)) return true;\n", to: "  if (!animatesAttribute(node)) return true;\n  const kept = el.getAttributeNS(null, 'href') ?? el.getAttributeNS(NS.xlink, 'href');\n  if (kept === null && (findAttr(node, null, 'href') || findAttr(node, NS.xlink, 'href'))) return false;\n",
    run: DRAW_E2E, expect: /(?=[\s\S]*an animateMotion with an href to another file moves nothing: <animateMotion> is on the canvas)(?=[\s\S]*an empty href animates the parent: <animate> is not on the canvas)(?=[\s\S]*a <set> with an empty href sets the parent: <set> is not on the canvas)/,
  },
  {
    id: 'B480', what: 'F10: the gradient section ignores a <style> rule that decides the paint (Inspect shows and edits the losing gradient; Edit on canvas shows its handles)',
    file: 'projects/draw/src/editor.ts', from: '    return doc && id !== undefined ? ruleWhy(styleSource(doc, id, prop), prop) : null;', to: '    return null;',
    run: drawTests('inspect.test.ts'), expect: /✖ a <style> rule that decides the paint wins over the gradient the element names/,
  },
  {
    id: 'B481', what: 'F1: parsePaint takes a backslash inside url() again (a typed url(#a\\) runs on past its end and swallows the declarations after it)',
    file: 'engine/values/color.ts', from: "  const u = /^url\\([ \\t\\n\\r\\f]*(?:\"([^\"\\\\]*)\"|'([^'\\\\]*)'|([^ \\t\\n\\r\\f\"'()\\\\]+))[ \\t\\n\\r\\f]*\\)([^]*)$/i.exec(s);", to: "  const u = /^url\\([ \\t\\n\\r\\f]*(?:\"([^\"]*)\"|'([^']*)'|([^ \\t\\n\\r\\f\"'()]+))[ \\t\\n\\r\\f]*\\)([^]*)$/i.exec(s);",
    run: drawTests('inspect.test.ts'), expect: /✖ a typed paint with a backslash inside url\(\) is refused/,
  },
  {
    id: 'B482', what: 'F1: declarations() ignores an escape inside parentheses again (it splits fill:url(#a\\);stroke:blue in two, where the browser reads one declaration)',
    file: 'engine/geometry/css.ts', from: "    else if (c === '\\\\') k += 2; // an escape: the next character is part of a name or url, never a parenthesis\n", to: '',
    run: engineTests('geometry/css.test.ts'), expect: /✖ declarations: a backslash escapes the next character/,
  },
  {
    id: 'B483', what: 'F5: the relative URL token takes any one-line text again (#x);stroke:none closes the url() and writes CSS)',
    file: 'engine/code/edit.ts', from: '      return token.url === undefined ? null : urlTextError(text, token.url);', to: '      return null;',
    run: drawTests('inspect.test.ts'), expect: /✖ the relative URL inside a paint’s url\(\) holds a URL and nothing else/,
  },
  {
    id: 'B484', what: 'F4: the gradient editor resolves xml:id again (Inspect and the handles edit a gradient the canvas never draws)',
    file: 'engine/paint/gradients.ts', from: "      if (a.local !== 'id' || a.ns !== null) continue;", to: "      if (a.local !== 'id' || (a.ns !== null && a.ns !== NS.xml)) continue;",
    run: engineTests('paint/gradients.test.ts'), expect: /✖ the gradient editor resolves a plain id only/,
  },
  {
    id: 'B485', what: 'F6: the finish hook descends into moved nodes again (Group detaches a stale generated shape it only moved)',
    file: 'engine/generators/index.ts', from: '    for (const c of n.children) if (fresh.get(c) !== false) add(c);', to: '    for (const c of n.children) add(c);',
    run: engineTests('generators/generators.test.ts'), expect: /✖ the finish hook: Group moves a stale generated shape/,
  },
  {
    id: 'B486', what: 'F7: gradientUsers resolves each paint’s whole chain again (selecting a shape at the end of a long template chain is quadratic)',
    file: 'engine/paint/gradients.ts', from: '      if (g !== null) push(direct, g, { el: n.id, prop });', to: '      if (g !== null) {\n        resolveGradient(doc, g);\n        push(direct, g, { el: n.id, prop });\n      }',
    run: drawTests('inspect.test.ts'), expect: /✖ Shared with N reads a long chain of templates in linear time/,
  },
  {
    id: 'B487', what: 'N1: checkStyle takes any text for the keyword properties again (a stroke-linecap of "round; fill: red" is written)',
    file: 'projects/draw/src/style-edit.ts', from: "  if (words) return words.some((w) => w.toLowerCase() === text.toLowerCase()) ? { text } : { error: `${JSON.stringify(input)} is not one of ${words.join(', ')}` };\n", to: '',
    run: drawTests('inspect.test.ts'), expect: /✖ the keyword properties take only their own keywords/,
  },
  {
    id: 'B488', what: 'N3: a new gradient’s stop writes a reference-written colour decoded again (Gloss off and Colour give back #e76f51 for fill="&accent;")',
    file: 'engine/paint/gradients.ts', from: 'stop-color="${c.raw ?? escape(c.value, \'"\')}"', to: 'stop-color="${escape(c.value, \'"\')}"',
    run: engineTests('paint/gradients.test.ts'), expect: /✖ a colour written with a reference is carried as written/,
  },
  {
    id: 'B489', what: 'N4: planStyleOne re-serializes the whole style attribute (every declaration re-spaced), not only the value’s span',
    file: 'engine/style/write.ts', from: 'raw: raw.slice(0, d.start) + escape(v, a.quote) + raw.slice(d.end), add: false };', to: "raw: (raw.slice(0, d.start) + escape(v, a.quote) + raw.slice(d.end)).split(';').map((x) => x.trim()).filter(Boolean).join('; '), add: false };",
    run: engineTests('style/style.test.ts'), expect: /✖ corpus property: planStyle over every element of every corpus file/,
  },
  {
    id: 'B490', what: 'N5: the picker rounds an alpha nobody moved again (rgba(255, 0, 0, 0.333) becomes 0.33 the moment the square moves)',
    file: 'projects/draw/src/color-picker.ts', from: '  return writeColor(hsvToRgb(p.h, p.s, p.v), p.a, p.family, p.percent, p.alphaText);', to: '  return writeColor(hsvToRgb(p.h, p.s, p.v), p.a, p.family, p.percent);',
    run: drawTests('color-picker.test.ts'), expect: /✖ an alpha the Alpha slider hasn’t moved keeps its own text/,
  },
  {
    id: 'B491', what: 'N6: Inspect’s Join row never offers arcs or miter-clip, even when that is the value',
    file: 'projects/draw/src/style-edit.ts', from: "  return !row.mixed && (jv === 'miter-clip' || jv === 'arcs') ? [...JOINS, [jv, jv]] : [...JOINS];", to: '  return [...JOINS];',
    run: drawTests('inspect.test.ts'), expect: /✖ what Inspect’s rows show for the finer cases/,
  },
  {
    id: 'B492', what: 'N7: Make unique copies the ids inside the gradient verbatim again (the copy’s stop can take #s1 from the original)',
    file: 'engine/paint/gradients.ts', from: '  renameIdsIn(doc, copy, fresh, apply);\n', to: '',
    run: engineTests('paint/gradients.test.ts'), expect: /✖ Make unique gives each id inside the copy a fresh one/,
  },
  {
    id: 'B493', what: 'F8: the batch puts its gradients into the file’s <defs> in reverse order (each shape still names its own, but the file differs from one shape at a time)',
    file: 'engine/paint/gradients.ts', from: '  if (defs) return insertMarkups(doc, { last: defs.id }, markups.map((m) => m(draw)), apply);\n', to: '  if (defs) return insertMarkups(doc, { last: defs.id }, markups.map((m) => m(draw)).reverse(), apply).reverse();\n',
    run: drawTests('inspect.test.ts'), expect: /✖ Gloss, Gloss off, Linear and None over a selection write exactly what they write one shape at a time/,
  },
  // P1-M3 S1: the path engine (quick).
  {
    id: 'B494', what: 'an anchor drag moves a Q control with it (SVG Lab moves only C controls)',
    file: 'engine/path/nodes.ts', from: "    if (g.type === 'C') {\n      g.x2 += dx; // the incoming C's or S's second control follows", to: "    if (g.type === 'Q') {\n      g.x1 += dx;\n      g.y1 += dy;\n    }\n    if (g.type === 'C') {\n      g.x2 += dx; // the incoming C's or S's second control follows",
    run: engineTests('path/nodes.test.ts'), expect: /✖ the lab’s numbers: a bend drag writes Q with control 2·f − mid/,
  },
  {
    id: 'B495', what: 'a closed subpath’s linked last anchor gets a handle of its own (the heart shows five anchors)',
    file: 'engine/path/nodes.ts', from: '    if (linked.has(k)) return;\n', to: '',
    run: engineTests('path/nodes.test.ts'), expect: /✖ pathNodes on the lab’s files/,
  },
  {
    id: 'B496', what: 'a relative segment after a moved point isn’t compensated (its numbers stay offsets from the old start, so its end moves)',
    file: 'engine/path/segments.ts', from: '      if (rel && X_ROLES.has(r)) v -= cx;\n      if (rel && Y_ROLES.has(r)) v -= cy;', to: '      if (rel && X_ROLES.has(r)) v -= t.abs[i].x0;\n      if (rel && Y_ROLES.has(r)) v -= t.abs[i].y0;',
    run: engineTests('path/nodes.test.ts'), expect: /✖ corpus property: every handle of every corpus path/,
  },
  {
    id: 'B497', what: 'an H keeps its letter when its row changes (and a V its column): the end moves with the new start',
    file: 'engine/path/segments.ts', from: "    if ((U === 'H' && !same(g.y, cy)) || (U === 'V' && !same(g.x, cx))) {", to: '    if (false) {',
    run: engineTests('path/nodes.test.ts'), expect: /✖ corpus property: every handle of every corpus path/,
  },
  {
    id: 'B498', what: 'L → Q puts its control on the other side of the normal',
    file: 'engine/path/segments.ts', from: 'onStep((x0 + x1) / 2 + (-dy / len) * off, opts.step), onStep((y0 + y1) / 2 + (dx / len) * off, opts.step)', to: 'onStep((x0 + x1) / 2 + (dy / len) * off, opts.step), onStep((y0 + y1) / 2 + (-dx / len) * off, opts.step)',
    run: engineTests('path/segments.test.ts'), expect: /✖ the letter cycle on lab\/paths\.svg at step 1/,
  },
  {
    id: 'B499', what: 'Q → C elevates by ½ instead of ⅔',
    file: 'engine/path/segments.ts', from: 'x1: onStep(a.x0 + (2 / 3) * (a.x1 - a.x0), opts.step)', to: 'x1: onStep(a.x0 + (1 / 2) * (a.x1 - a.x0), opts.step)',
    run: engineTests('path/segments.test.ts'), expect: /✖ the letter cycle on lab\/paths\.svg at step 1/,
  },
  {
    id: 'B500', what: 'a letter-less segment after a cycled one never gets its letter written (it would read as the new command)',
    file: 'engine/path/segments.ts', from: '    else text = inPlace(seg, spans, texts, cmd, lastChar);', to: '    else text = inPlace(seg, spans, texts, seg.implicit ? null : cmd, lastChar);',
    run: engineTests('path/segments.test.ts'), expect: /✖ an implicit segment that followed the cycled one gets its old letter written/,
  },
  {
    id: 'B501', what: 'a following S or T isn’t written out when its implied control would change (it changes shape)',
    file: 'engine/path/segments.ts', from: "    if (U !== 'S' && U !== 'T') continue;", to: '    continue;',
    run: engineTests('path/segments.test.ts'), expect: /✖ a following S or T whose implied control would change is written out/,
  },
  {
    id: 'B502', what: 'Make relative leaves the first M uppercase (the lab writes m)',
    file: 'engine/path/segments.ts', from: '    const cmd = s.implicit ? impliedAfter(prev) : toRel ? s.cmd.toLowerCase() : s.cmd.toUpperCase();', to: '    const cmd = s.implicit ? impliedAfter(prev) : toRel && i > 0 ? s.cmd.toLowerCase() : s.cmd.toUpperCase();',
    run: engineTests('path/segments.test.ts'), expect: /✖ Make relative on lab\/arcs--smooth\.svg writes the lab’s relative spelling exactly/,
  },
  {
    id: 'B503', what: 'relative numbers are always written with 3 decimals (19.75 becomes 19.750)',
    file: 'engine/path/segments.ts', from: '      return was !== undefined && same(was, v) ? oldText.get(r)! : exactText(v);', to: '      return was !== undefined && same(was, v) ? oldText.get(r)! : rel ? v.toFixed(3) : exactText(v);',
    run: engineTests('path/segments.test.ts'), expect: /✖ Relative and Absolute on mixed letters, implicit segments, arcs/,
  },
  {
    id: 'B504', what: 'a letter-less segment gets a letter token too (over its first number’s first character)',
    file: 'engine/code/tokens.ts', from: "    if (letters && !seg.implicit && 'LQC'.includes(U)) {", to: "    if (letters && 'LQC'.includes(U)) {",
    run: engineTests('code/tokens.test.ts'), expect: /✖ a <path>’s written L, l, Q, q, C and c letters are enum tokens/,
  },
  {
    id: 'B505', what: 'transformPath counts the letter tokens again (every path with an L, Q or C refuses to move)',
    file: 'engine/geometry/write.ts', from: ".filter((t) => !(t.kind === 'enum' && t.segment !== undefined));", to: ';',
    run: engineTests('geometry/write.test.ts'), expect: /✖ a path whose letters are tokens still moves, resizes and rotates as before/,
  },
  // P1-M3 S1: the Pen, the Node tool and the path marks (quick).
  {
    id: 'B506', what: 'the Pen’s first tap inserts a path (a zero-length one), where it should write nothing',
    file: 'projects/draw/src/editor.ts', from: '    if (!pen.anchors.length) {\n      pen.anchors.push(anchor);\n      return this.#penChanged();\n    }', to: '    if (!pen.anchors.length) {\n      pen.anchors.push(anchor);\n      return this.#addAnchor(anchor);\n    }',
    run: drawTests('pen.test.ts'), expect: /✖ Pen taps: the first writes nothing/,
  },
  {
    id: 'B507', what: 'a dragged anchor’s in-handle isn’t reflected (it is the out-handle itself)',
    file: 'projects/draw/src/interact/pen.ts', from: '(a.out ? { x: 2 * a.at.x - a.out.x, y: 2 * a.at.y - a.out.y } : null)', to: '(a.out ? { x: a.out.x, y: a.out.y } : null)',
    run: drawTests('pen.test.ts'), expect: /✖ Pen drags: a drag makes a Q leaving the point along the drag/,
  },
  {
    id: 'B508', what: 'the Pen doesn’t take the shared colour counter (every path is the first colour)',
    file: 'projects/draw/src/editor.ts', from: 'colour: penColour(this.#shapes)', to: 'colour: penColour(0)',
    run: drawTests('pen.test.ts'), expect: /✖ the colour cycle is SVG Lab’s pen colours/,
  },
  {
    id: 'B509', what: 'Undo point undoes two entries',
    file: 'projects/draw/src/editor.ts', from: '      this.#session.undo();\n      pen.anchors.pop();', to: '      this.#session.undo();\n      this.#session.undo();\n      pen.anchors.pop();',
    run: drawTests('pen.test.ts'), expect: /✖ Undo point and ⌘Z walk back through the anchors to nothing/,
  },
  {
    id: 'B510', what: 'node handles show in the Select tool too (M1’s corners go from a path)',
    file: 'projects/draw/src/editor.ts', from: "    if (!doc || this.tool.get() !== 'node' || id === doc.root", to: '    if (!doc || id === doc.root',
    run: drawTests('editor.test.ts'), expect: /✖ node handles show only in the Node tool/,
  },
  {
    id: 'B511', what: 'a node drag gathers its snap targets on every frame (every shape measured again)',
    file: 'projects/draw/src/editor.ts', from: "      if (nd.kind === 'anchor' || nd.kind === 'start') to = this.#cornerPoint(g, hd, f);", to: "      if (nd.kind === 'anchor' || nd.kind === 'start') to = this.#cornerPoint(g, { ...hd, targets: this.#snapTargets([hd.id]) }, f);",
    run: drawTests('editor.test.ts'), expect: /✖ a node drag gathers its snap targets once/,
  },
  {
    id: 'B512', what: 'a panel edit during a node drag is taken (dispatched into the drag: it throws)',
    file: 'projects/draw/src/editor.ts', from: 'this.#gesture?.move || this.#gesture?.hd || this.#gesture?.gd', to: 'this.#gesture?.move || this.#gesture?.gd',
    run: drawTests('editor.test.ts'), expect: /✖ a panel edit during a node drag is refused, quietly/,
  },
  {
    id: 'B513', what: 'the S’s mirror is reflected about the segment’s end instead of its start',
    file: 'engine/path/nodes.ts', from: 'mirrors.push({ from: p0, at: c1, to: null })', to: 'mirrors.push({ from: p0, at: P(2 * s.x - (2 * s.x0 - c1.x), 2 * s.y - (2 * s.y0 - c1.y)), to: null })',
    run: drawTests('path-marks.test.ts'), expect: /✖ mirror guides: lab\/arcs--smooth\.svg’s S implies \(60, 90\)/,
  },
  // P1-M3 S1 (slow: one per new e2e check, each naming it).
  {
    id: 'B514', what: 'the Pen’s points skip the camera (host px taken as root units): the path isn’t under the taps', slow: true, checks: ['thePenTapsLinesAndDragsCurves'],
    file: 'projects/draw/src/editor.ts', from: '    if (m.every((v, i) => Math.abs(v - root[i]) <= 1e-9)) return this.#snapRoot(at, this.#snapTargets(pen.id !== null ? [pen.id] : []), this.#penStep()).p;', to: '    if (m.every((v, i) => Math.abs(v - root[i]) <= 1e-9)) return { x: toStep(at.x, this.#penStep()), y: toStep(at.y, this.#penStep()) };',
    run: DRAW_E2E, expect: /thePenTapsLinesAndDragsCurves: the second tap did not insert exactly the lab's path/,
  },
  {
    id: 'B515', what: 'node handles are placed through the parent’s matrix, not the path’s own (a rotated path’s handles off it)', slow: true, checks: ['nodeHandlesSitOnTheAnchorsAndControls'],
    file: 'projects/draw/src/editor.ts', from: '        const [x, y] = applyM(m.toHost, h.at.x, h.at.y);', to: '        const [x, y] = applyM(this.#ports.canvas.measure([n.parent!]).get(n.parent!)?.toHost ?? m.toHost, h.at.x, h.at.y);',
    run: DRAW_E2E, expect: /nodeHandlesSitOnTheAnchorsAndControls: the turned wave: the a0 handle is/,
  },
  {
    id: 'B516', what: 'a letter token’s tap goes through tokenEdit (refused: a letter change adds arguments), so no Q', slow: true, checks: ['theLetterCycleAndRelativeKeepTheRestOfThePath'],
    file: 'projects/draw/src/editor.ts', from: '        if (t.segment !== undefined) return void this.cycleSegment(ref.node, t.segment);\n', to: '',
    run: DRAW_E2E, expect: /theLetterCycleAndRelativeKeepTheRestOfThePath: the L tap wrote/,
  },
  {
    id: 'B517', what: 'the Node tool’s bar has a button under 44 pt (Relative shrinks to 1.5rem)', slow: true, checks: ['phoneRulesOnThePenAndNodeTools'],
    file: 'projects/draw/src/panels/ContextBar.tsx', from: "aria-label={nodes.relative ? 'Absolute' : 'Relative'} onClick={() => editor.toggleRelative()}>", to: "aria-label={nodes.relative ? 'Absolute' : 'Relative'} style={{ width: '1.5rem', minWidth: 0, height: '1.5rem', minHeight: 0 }} onClick={() => editor.toggleRelative()}>",
    run: DRAW_E2E, expect: /phoneRulesOnThePenAndNodeTools \(956\): 440×956:[\s\S]*the Node tool: Relative is \d+×\d+/,
  },
  // P1-M3 S1 close-out: the dry run's AMBIG rule (an anchor that matches twice plants only the first).
  {
    // As B325 proves STALE: a comment holding a second copy of B275's anchor keeps valid TypeScript.
    id: 'B518', what: "the dry run misses an ambiguous anchor (a second copy of B275's anchor, SLOP, appended in a comment: B275 would plant only the first)",
    file: 'projects/draw/src/canvas/gestures.ts', append: '// a second copy of the anchor: export const SLOP = 5;\n',
    run: ['node', ['tools/prove-breaks.mjs', '--dry'], DRAW], expect: /B275 +AMBIG +projects\/draw\/src\/canvas\/gestures\.ts: the anchor matches 2 times/,
  },
  // P1-M3 S2: arcs, holes and the donut (quick).
  {
    id: 'B519', what: 'evenodd counts signed crossings (it reads the winding number, as nonzero does: two same-way loops fill their overlap)',
    file: 'engine/path/winding.ts', from: "return rule === 'evenodd' ? crossingsOf(polys, x, y) % 2 === 1 : windingOf(polys, x, y) !== 0;", to: "return rule === 'evenodd' ? windingOf(polys, x, y) !== 0 : windingOf(polys, x, y) !== 0;",
    run: engineTests('path/winding.test.ts'), expect: /✖ lines: a square is inside under both rules/,
  },
  {
    id: 'B520', what: 'Reverse keeps an arc’s sweep flag (the reversed arc bulges the other way)',
    file: 'engine/path/segments.ts', from: "['sweep', +!g.sweep, g.sweep ? '0' : '1']", to: "['sweep', +g.sweep, g.sweep ? '1' : '0']",
    run: engineTests('path/segments.test.ts'), expect: /✖ Reverse on lab\/arcs--holes\.svg’s inner subpath gives SVG Lab’s HOLE_REV exactly/,
  },
  {
    id: 'B521', what: 'Reverse doesn’t write the closing line first (a closed subpath’s Z line is lost from the reversed order)',
    file: 'engine/path/segments.ts', from: '  if (z && !(same(An[0], S[0]) && same(An[1], S[1]))) {', to: '  if (false) {',
    run: engineTests('path/segments.test.ts'), expect: /✖ Reverse on lab\/arcs--holes\.svg’s inner subpath gives SVG Lab’s HOLE_REV exactly/,
  },
  {
    // lab/arcs.svg's own comment holds no number, so the plant shows on the lab's donut export before Edit as donut.
    id: 'B522', what: 'a comment gets number tokens without its holder being a donut (SVG Lab’s donut export, before Edit as donut)',
    file: 'engine/code/tokens.ts', from: '  const read = d && d.comment === leaf.id ? readData(raw) : null;', to: '  const read = readData(raw);',
    run: engineTests('code/tokens.test.ts'), expect: /✖ a donut’s data comment \(draw:gen="donut"\) has one number token per value/,
  },
  {
    id: 'B523', what: 'setLeafRaw takes a comment holding -- (the file would not be well-formed)',
    file: 'engine/model/doc.ts', from: "  return !body.includes('--') && !body.endsWith('-');", to: "  return !body.endsWith('-');",
    run: engineTests('code/edit.test.ts'), expect: /✖ a donut’s data comment is edited like any token/,
  },
  {
    id: 'B524', what: 'the large-arc flag is 1 at exactly half (SVG Lab’s is 1 only over half)',
    file: 'engine/generators/donut.ts', from: '${v / S > 0.5 ? 1 : 0}', to: '${v / S >= 0.5 ? 1 : 0}',
    run: engineTests('generators/donut.test.ts'), expect: /✖ exact halves: 50 and 50 give large-arc 0/,
  },
  {
    id: 'B525', what: 'the slices start at angle 0 (the right), not at the top',
    file: 'engine/generators/donut.ts', from: /-Math\.PI \/ 2 \+ \(acc \/ S\)/g, to: '(acc / S)',
    run: engineTests('generators/donut.test.ts'), expect: /✖ the acceptance test: generating from lab\/arcs--donut\.svg’s comment/,
  },
  {
    id: 'B526', what: 'the finish hook regenerates a donut whose slice’s d was edited by hand (it must detach it)',
    file: 'engine/generators/index.ts', from: '    if (st && expected && (inputsTouched || dataTouched) && !partsTouched) {', to: '    if (st && expected) {',
    run: engineTests('generators/donut.test.ts'), expect: /✖ the finish hook: a data edit and an input edit regenerate the slices/,
  },
  {
    id: 'B527', what: 'Edit as donut adopts a holder whose slices differ from the generator’s (the hook would then rewrite them)',
    file: 'engine/generators/donut.ts', from: '  const want = donutSlices(parts.data.values, cx, cy, r);\n  if (!want || !parts.slices.every((s, i) => dOf(doc, s) === want[i])) return null;', to: '  const want = donutSlices(parts.data.values, cx, cy, r);',
    run: engineTests('generators/donut.test.ts'), expect: /✖ Edit as donut’s candidate/,
  },
  {
    id: 'B528', what: 'a donut boundary drag lets a value reach 0 (the lab clamps each at 1)',
    file: 'projects/draw/src/editor.ts', from: '      const c = Math.min(Math.max(Math.round(fr * S) - before, 1), pair - 1);', to: '      const c = Math.min(Math.max(Math.round(fr * S) - before, 0), pair);',
    run: drawTests('editor.test.ts'), expect: /✖ the donut: Edit as donut changes only the holder’s start tag/,
  },
  {
    id: 'B529', what: 'fill-rule is missing from the style table (Inspect’s Fill rule has nowhere to write)',
    file: 'engine/style/props.ts', from: "  'fill-rule': { initial: 'nonzero', inherited: true }, // P1-M3: Inspect's Fill rule (holes)\n", to: '',
    run: engineTests('style/style.test.ts'), expect: /✖ each property is written where it lives/,
  },
  {
    id: 'B530', what: 'the flag labels are pushed towards the chord, not away from it (they sit on the arcs)',
    file: 'projects/draw/src/interact/path-marks.ts', from: 'x: clamp(mid.x + dx * 10, 8, canvas.width - 8), y: clamp(mid.y + dy * 10 + 4, 13, canvas.height - 4)', to: 'x: clamp(mid.x - dx * 10, 8, canvas.width - 8), y: clamp(mid.y - dy * 10 + 4, 13, canvas.height - 4)',
    run: drawTests('path-marks.test.ts'), expect: /✖ ghost arcs: lab\/arcs\.svg’s arc \(0 1\)/,
  },
  {
    id: 'B531', what: 'the inner subpaths’ arrows take the outer colour (draw-dir--in is never set)',
    file: 'projects/draw/src/interact/path-marks.ts', from: 'inner: s.sub > 0', to: 'inner: false',
    run: drawTests('path-marks.test.ts'), expect: /✖ direction arrows: lab\/arcs--holes\.svg’s outer arrows/,
  },
  {
    id: 'B532', what: 'the route doesn’t re-read a donut’s data comment after its holder’s draw: change (Edit as donut leaves the comment without tokens)',
    file: 'projects/draw/src/routing.ts', from: 'blocks: [...new Set([...cs.attrs, ...cs.texts, ...comments])]', to: 'blocks: [...new Set([...cs.attrs, ...cs.texts])]',
    run: drawTests('routing.test.ts'), expect: /✖ a donut’s data comment is re-read with its holder’s attribute changes/,
  },
  // P1-M3 S2 (slow: one per new e2e check, each naming it).
  {
    id: 'B533', what: 'the ghost arcs skip toHost (drawn in the path’s units, not where the other flag pairs draw)', slow: true, checks: ['ghostArcsSwitchTheFlags'],
    file: 'projects/draw/src/interact/path-marks.ts', from: '.map(([x1, y1, x2, y2, x, y]): [Point, Point, Point] => [h(x1, y1), h(x2, y2), h(x, y)]);\n      ghosts.push({ flags: text, start: h(a.x0, a.y0), cubics });', to: '.map(([x1, y1, x2, y2, x, y]): [Point, Point, Point] => [{ x: x1, y: y1 }, { x: x2, y: y2 }, { x, y }]);\n      ghosts.push({ flags: text, start: { x: a.x0, y: a.y0 }, cubics });',
    run: DRAW_E2E, expect: /ghostArcsSwitchTheFlags: lab\/arcs\.svg: the \d \d ghost passes [\d.]+ px from the arc those flags draw/,
  },
  {
    id: 'B534', what: 'the direction arrows skip toHost (drawn at the path’s own numbers, not on it)', slow: true, checks: ['holesCutTwoWays'],
    file: 'projects/draw/src/interact/path-marks.ts', from: '    const c = host(toHost, { x: m.p[0], y: m.p[1] });', to: '    const c = { x: m.p[0], y: m.p[1] };',
    run: DRAW_E2E, expect: /holesCutTwoWays: the arrow near \(50, 14\) is/,
  },
  {
    // Planted in the editor's call of route (routing.ts's own rule stays, so its unit test is green): only the browser's code view shows it.
    id: 'B535', what: 'the editor routes a change without the data comment’s re-read, so after Edit as donut the code shows the comment without tokens', slow: true, checks: ['theDonutRegeneratesFromItsData'],
    file: 'projects/draw/src/editor.ts', from: '      r = route(session.doc, cs);\n', to: "      r = route(session.doc, cs);\n      if (!r.code.reset) r.code.blocks = r.code.blocks.filter((id) => session.doc.nodes.get(id)?.kind !== 'comment' || cs.texts.has(id));\n",
    run: DRAW_E2E, expect: /theDonutRegeneratesFromItsData: the comment's block holds the number tokens \[\]/,
  },
  // P1-M3 S3: booleans (quick).
  {
    id: 'B536', what: 'check-bundle misses new Function (its pattern wants "Functionn")',
    file: 'projects/draw/tools/check-bundle.mjs', from: "['new-function', /\\bnew\\s+Function\\s", to: "['new-function', /\\bnew\\s+Functionn\\s",
    run: drawTests('check-bundle.test.ts'), expect: /✖ check-bundle: each pattern planted in a chunk fails the build/,
  },
  {
    id: 'B537', what: 'the notices test walks only Draw’s own dependencies (scheduler, react-dom’s, and gl-matrix, path-bool’s, are never asked for)',
    file: 'projects/draw/test/unit/notices.test.ts', from: '    for (const d of Object.keys(e.dependencies ?? {})) visit(d, key, false);\n    for (const d of Object.keys(e.optionalDependencies ?? {})) visit(d, key, true);\n', to: '',
    run: drawTests('notices.test.ts'), expect: /the walk found no scheduler/,
  },
  {
    id: 'B538', what: 'a rect’s outline ignores rx and ry (square corners)',
    file: 'engine/path/from-shape.ts', from: '      const rx = Math.min(r[0], w / 2);\n', to: '      const rx = Math.min(0, w / 2);\n',
    run: engineTests('path/from-shape.test.ts'), expect: /✖ a rect: its four sides clockwise/,
  },
  {
    id: 'B539', what: 'arcs and quadratics reach the libraries unconverted (toLoops keeps them as they are)',
    file: 'engine/path/loops.ts', from: "    else if (s.type === 'Q') {\n", to: "    else if (s.type === 'Q' || s.type === 'A') segs.push({ type: s.type, to: [s.x, s.y] } as unknown as LoopSeg);\n    else if (s.type === ('never' as string)) {\n",
    run: drawTests('booleans.test.ts'), expect: /✖ the libraries get lines and cubics only/,
  },
  {
    id: 'B540', what: 'a library’s result is written as it comes (its loops not oriented by nesting depth)',
    file: 'projects/draw/src/paths/pipeline.ts', from: '  return orientLoops(toLoops(toAbsolute(parsePath(d))));\n', to: '  return toLoops(toAbsolute(parsePath(d)));\n',
    run: drawTests('booleans.test.ts'), expect: /nonzero and evenodd disagree on the ring/,
  },
  {
    id: 'B541', what: 'the fallback never runs (only path-bool is tried)',
    file: 'projects/draw/src/paths/pipeline.ts', from: "[['path-bool', libs.primary], ['paper', libs.fallback]] as const", to: "[['path-bool', libs.primary]] as const",
    run: drawTests('booleans.test.ts'), expect: /✖ a path-bool that throws, or misses more than 1% of the self-check’s samples, hands the operation to paper-core/,
  },
  {
    id: 'B542', what: 'Subtract takes the top operand from the rest (path-bool gets the operands top first, so paper-core writes every subtract)',
    file: 'projects/draw/src/paths/booleans.ts', from: '  new PathBoolean(inputs.map(', to: "  new PathBoolean((op === 'difference' ? [...inputs].reverse() : inputs).map(",
    run: drawTests('booleans.test.ts'), expect: /each case written as pinned/,
  },
  {
    id: 'B543', what: 'the result drops the bottom’s id (the new <path> takes its attributes less its id)',
    file: 'projects/draw/src/paths/write.ts', from: '(a.ns === null && GEOMETRY_ATTRS.has(a.local))', to: "(a.ns === null && (GEOMETRY_ATTRS.has(a.local) || a.local === 'id'))",
    run: drawTests('editor.test.ts'), expect: /union wrote:/,
  },
  {
    id: 'B544', what: 'the other operands are removed without their leading whitespace',
    file: 'projects/draw/src/paths/write.ts', from: /import \{ remove \} from '\.\.\/interact\/structure\.ts';([\s\S]*)  remove\(doc, others, apply\);/, to: "import { remove } from '../interact/structure.ts';\nimport { opRemove } from '../../../../engine/commands/ops.ts';$1  for (const id of others) apply(opRemove(doc, id));",
    run: drawTests('editor.test.ts'), expect: /union: the rest of the file as it was/,
  },
  {
    // A Vite build, but no site build: quick, though it takes a minute or two. The minifier writes
    // paper-full's new Function("str", f) as Function("str", f), so check-bundle names it function-string.
    id: 'B545', what: 'paper-fallback.ts imports bare paper, which is paper-full (its PaperScript compiles with new Function)',
    file: 'projects/draw/src/paths/paper-fallback.ts', from: "import paperModule from 'paper/dist/paper-core.js';", to: "import paperModule from 'paper';",
    run: ['sh', ['-c', 'BASE_PATH=/draw/ npx vite build >/dev/null && node tools/check-bundle.mjs'], DRAW], expect: /paper-fallback-[\w-]+\.js:\d+  (new-function|function-string)/,
  },
  // P1-M3 S3 (slow: one per new e2e check, each naming it).
  {
    id: 'B546', what: 'the editor imports booleans.ts statically, so path-bool rides in the first chunk', slow: true, checks: ['booleansCombineWhatIsDrawn'],
    file: 'projects/draw/src/editor.ts', from: "import { LAZY_LIBRARIES } from './paths/load.ts';\n", to: "import { LAZY_LIBRARIES } from './paths/load.ts';\nimport { combine as eagerBooleans } from './paths/booleans.ts';\nvoid eagerBooleans;\n",
    run: DRAW_E2E, expect: /booleansCombineWhatIsDrawn: the first Union loaded no boolean chunk/,
  },
  // P1-M3 fix (the review's findings), quick unless marked.
  {
    id: 'B547', what: 'R3: writeGeometry reads the last character written from the growing string for every segment (it flattens it each time: quadratic)',
    file: 'engine/path/segments.ts', from: '    else text = inPlace(seg, spans, texts, cmd, lastChar);', to: '    else text = inPlace(seg, spans, texts, cmd, out.slice(-1));',
    run: engineTests('path/costs.test.ts'), expect: /✖ a segment rewrite and a node drag frame take linear time/,
  },
  {
    // The same text either way, so only the cost can show it.
    id: 'B548', what: 'R2: Reverse with no chosen node re-reads and rewrites the whole path once per subpath (quadratic)',
    file: 'engine/path/segments.ts', from: '  const out = reverseSubpaths(t, sub);\n', to: '  let out: string | null = null;\n  if (sub !== null) out = reverseSubpaths(t, sub);\n  else for (let s = 0; s < subpathCount(t.abs); s++) out = reverseSubpaths(readPathText(out ?? raw), s) ?? out;\n',
    run: engineTests('path/costs.test.ts'), expect: /✖ Reverse with no chosen node takes linear time/,
  },
  {
    id: 'B549', what: 'R5: every comment under a donut holder asks whether the holder is a donut (each ask walks the holder’s children: quadratic)',
    file: 'engine/code/tokens.ts', from: '  if (dataCommentOf(doc, leaf.parent) !== leaf.id) return [];\n', to: '',
    run: engineTests('code/tokens.test.ts'), expect: /✖ the tokens of many comments under a donut holder take linear time/,
  },
  {
    id: 'B550', what: 'R4: the donut takes any finite plain decimal as an input again (no FLT_MAX bound: a centre at 1e39 reads as a donut)',
    file: 'engine/generators/donut.ts', from: "    if (!(Math.abs(v) <= FLT_MAX) || (name === 'r' && !(v > 0))) return null;", to: "    if (!Number.isFinite(v) || (name === 'r' && !(v > 0))) return null;",
    run: engineTests('generators/donut.test.ts'), expect: /✖ hostile inputs stay plain and never throw: cx, cy or r written as 309-digit plain decimals/,
  },
  {
    id: 'B551', what: 'R4: the generators take any finite centre again (no FLT_MAX bound: a polygon centred at 1e39 reads as generated)',
    file: 'engine/generators/index.ts', from: 'const coordinate = (v: number) => Math.abs(v) <= FLT_MAX;', to: 'const coordinate = (v: number) => Number.isFinite(v);',
    run: engineTests('generators/generators.test.ts'), expect: /✖ hostile inputs stay plain and never throw: a polygon whose cx and r are 309-digit plain decimals/,
  },
  {
    id: 'B552', what: 'R4: donutSlices hands back slices with a coordinate it couldn’t write, rather than null',
    file: 'engine/generators/donut.ts', from: '  return finite ? out : null;\n', to: '  return out;\n',
    run: engineTests('generators/donut.test.ts'), expect: /✖ hostile inputs stay plain and never throw: cx, cy or r written as 309-digit plain decimals/,
  },
  {
    id: 'B553', what: 'R4: a generator whose coordinate overflows throws (fmt’s RangeError) rather than reading as plain',
    file: 'engine/generators/index.ts', from: '    if (e instanceof RangeError) return null;\n    throw e;', to: '    throw e;',
    run: engineTests('generators/generators.test.ts'), expect: /✖ hostile inputs stay plain and never throw: a polygon whose cx and r are 309-digit plain decimals/,
  },
  {
    id: 'B554', what: 'R4: Open builds the code view after it has swapped in the new document (a throw there leaves the editor half-swapped)',
    file: 'projects/draw/src/editor.ts', from: /    let code: CodeBlocks;\n    try \{\n      code = this\.#codeOf\(doc\);\n    \} catch \(e\) \{\n      return \{ ok: false, error: String\(e\), \.\.\.NO_STATS \};\n    \}\n([\s\S]*?)    this\.#setCode\(code\);\n/, to: '$1    this.#resetCode();\n',
    run: drawTests('editor.test.ts'), expect: /✖ Open refuses a document whose code view throws while it is built/,
  },
  {
    id: 'B555', what: 'R8: a selected root that holds a donut shows no handles (SVG Lab’s own file: no boundary handles on its holder)',
    file: 'projects/draw/src/editor.ts', from: "|| !ids.length || ids.some((id) => isLocked(doc, id))) return none;", to: "|| !ids.length || ids.some((id) => id === doc.root || isLocked(doc, id))) return none;",
    run: drawTests('editor.test.ts'), expect: /✖ a donut’s holder selected: the root/,
  },
  {
    id: 'B556', what: 'R8: a boundary drag needs the selection and its parent measured first, so a root holder’s never starts',
    file: 'projects/draw/src/editor.ts', from: '      const d = donutFor(doc, id);\n      const toHost = d && this.#unitsToHost(d.holder);', to: '      const d = this.#ports.canvas.measure([id, el(doc, id).parent!]).size === 2 ? donutFor(doc, id) : null;\n      const toHost = d && this.#unitsToHost(d.holder);',
    run: drawTests('editor.test.ts'), expect: /✖ a donut’s holder selected: the root/,
  },
  {
    id: 'B557', what: 'R8: a letter-less (implicit) segment gets no handles',
    file: 'engine/path/nodes.ts', from: '    const U = p.segs[k].cmd.toUpperCase();\n', to: '    if (p.segs[k].implicit) return;\n    const U = p.segs[k].cmd.toUpperCase();\n',
    run: engineTests('path/nodes.test.ts'), expect: /✖ pathNodes on letter-less \(implicit\) segments/,
  },
  {
    id: 'B558', what: 'R8: dragging a subpath’s start drags an arc’s end with it (as if linked)',
    file: 'engine/path/nodes.ts', from: '    for (let j = k + 1; j < abs.length && abs[j].sub === abs[k].sub; j++) if (linked.has(j)) move(j);', to: "    for (let j = k + 1; j < abs.length && abs[j].sub === abs[k].sub; j++) if (linked.has(j) || abs[j].type === 'A') move(j);",
    run: drawTests('editor.test.ts'), expect: /✖ an arc’s start and end anchors drag its ends/,
  },
  {
    id: 'B559', what: 'R8: a boolean maps the operands into root units, not the bottom’s (a bottom with its own transform is written off)',
    file: 'projects/draw/src/editor.ts', from: '    const toBottom = base && invert(base.toHost);', to: '    const toBottom = base && invert(this.#unitsToHost(doc.root)!);',
    run: drawTests('editor.test.ts'), expect: /✖ a bottom with its own transform/,
  },
  {
    id: 'B560', what: 'R1: an entry the Pen doesn’t own (an Inspect edit, a Layers Hide, a slider) no longer ends the Pen, so Undo point undoes it',
    file: 'projects/draw/src/editor.ts', from: '    if (this.#pen && !PEN_LABELS.has(label)) this.#endPen(true);\n', to: '',
    run: drawTests('pen.test.ts'), expect: /✖ an entry the Pen doesn’t own ends the Pen first/,
  },
  {
    id: 'B561', what: 'R6: a boolean flattens within 0.01 units again (the absolute tolerance back: ×10⁶ flattens to a thousand times the points)',
    file: 'engine/path/winding.ts', from: '  return diag > 0 && Number.isFinite(diag) ? FLAT_SHARE * diag : FLAT;', to: '  return FLAT;',
    run: drawTests('booleans.test.ts'), expect: /✖ a boolean’s cost follows what is drawn, not its units/,
  },
  {
    // The points check reads the tolerance helper itself, so only the timing sees the score alone go back to 0.01 units.
    id: 'B562', what: 'R6: the self-check (booleanScore) flattens within 0.01 units again, so its cost grows with the drawing’s units',
    file: 'engine/path/winding.ts', from: '  const flat = flatFor(inputs.map((i) => i.abs));', to: '  const flat = FLAT;',
    run: drawTests('booleans.test.ts'), expect: /✖ a boolean’s cost follows what is drawn, not its units/,
  },
  {
    id: 'B563', what: 'R7: a bottom shape a <style> rule may paint is combined anyway (the <path> that replaces it loses the rule’s paint: black)',
    file: 'projects/draw/src/editor.ts', from: "    if (bottom.local !== 'path' && Object.keys(STYLE_PROPS).some((p) => sheetSets(doc, bottom.id, p) !== 'no')) return { refused: STYLE_PAINT };\n", to: '',
    run: drawTests('editor.test.ts'), expect: /✖ booleans refuse, saying why and writing nothing/,
  },
  {
    id: 'B564', what: 'R9: a straight segment’s arrow is drawn at its midpoint again, under its bend handle',
    file: 'projects/draw/src/interact/path-marks.ts', from: "    const shift = s.type === 'L' && 'LHV'.includes(s.cmd.toUpperCase()) && len / 2 - past >= ANCHOR_REACH + ARROW_REACH ? past : 0;", to: '    const shift = 0;',
    run: drawTests('editor.test.ts'), expect: /✖ the direction arrows clear the handles/,
  },
  {
    id: 'B565', what: 'N1: the boolean compares the editor’s version again (a tool pick refuses it; a drag’s frames don’t, so a Union resolving mid-drag is dropped without a word)',
    file: 'projects/draw/src/editor.ts', from: /    const version = doc\.version;\n([\s\S]*?)doc\.version !== version \|\| this\.#live \|\| this\.#gesture \|\| this\.#field \|\| this\.#stepDrag \|\| this\.#nudge\) return/, to: '    const version = this.version.get();\n$1this.version.get() !== version) return',
    run: drawTests('editor.test.ts'), expect: /✖ a boolean whose chunk resolves during a live move drag/,
  },
  {
    id: 'B566', what: 'N1: the boolean doesn’t refuse while an edit is live (a press held): it writes into the gesture',
    file: 'projects/draw/src/editor.ts', from: ' || this.#live || this.#gesture || this.#field || this.#stepDrag || this.#nudge) return void this.notice.set(DRAWING_CHANGED);', to: ') return void this.notice.set(DRAWING_CHANGED);',
    run: drawTests('editor.test.ts'), expect: /✖ a boolean whose chunk resolves during a live move drag/,
  },
  {
    // As B518 proves AMBIG: a block comment holding B527's two-line anchor with a CRLF between its lines.
    id: 'B567', what: 'N2: the dry run misses a CRLF twin of a multi-line anchor (B527’s, appended in a comment with a CRLF line end: B527 would plant only the first)',
    file: 'engine/generators/donut.ts', append: '\n/* a CRLF twin of an anchor:\n  const want = donutSlices(parts.data.values, cx, cy, r);\r\n  if (!want || !parts.slices.every((s, i) => dOf(doc, s) === want[i])) return null;\n*/\n',
    run: ['node', ['tools/prove-breaks.mjs', '--dry'], DRAW], expect: /B527 +AMBIG +engine\/generators\/donut\.ts: the anchor matches 2 times/,
  },
  {
    // A break of this file's own dry run: with CRLF no longer read as LF, B567's twin goes unseen.
    id: 'B568', what: 'N2: the dry run counts an anchor’s matches with CRLF as written (a twin in the other line ending is missed)',
    file: 'projects/draw/tools/prove-breaks.mjs', from: "  const text = original.replace(/\\r\\n/g, '\\n');", to: '  const text = original;',
    run: ['node', ['tools/prove-breaks.mjs', 'B567'], DRAW], expect: /GREEN ✗  B567/,
  },
  {
    id: 'B569', what: 'N2: the dry run calls a sticky anchor fine (B525’s RegExp made sticky: it would plant only at index 0)',
    file: 'projects/draw/tools/prove-breaks.mjs', from: "file: 'engine/generators/donut.ts', from: /-Math\\.PI \\/ 2 \\+ \\(acc \\/ S\\)/g,", to: "file: 'engine/generators/donut.ts', from: /-Math\\.PI \\/ 2 \\+ \\(acc \\/ S\\)/y,",
    run: ['node', ['tools/prove-breaks.mjs', '--dry'], DRAW], expect: /B525 +BAD +a sticky anchor plants only at index 0/,
  },
  // P1-M4 S0: stroke to path (M3's spillover), quick unless marked.
  {
    id: 'B570', what: 'a miter join ignores stroke-miterlimit (a right angle under a limit of 1.2 is still mitered)',
    file: 'engine/path/offset.ts', from: "  if (style.join === 'miter' && Math.abs(cr) >= 1e-12 && miterRatio(cos) <= style.miterLimit) {", to: "  if (style.join === 'miter' && Math.abs(cr) >= 1e-12) {",
    run: engineTests('path/offset.test.ts'), expect: /✖ joins: a miter up to stroke-miterlimit/,
  },
  {
    id: 'B571', what: 'an open subpath gets no round cap (round ends as butt)',
    file: 'engine/path/offset.ts', from: "  if (kind === 'butt') return [{ type: 'L', to: R }];", to: "  if (kind === 'butt' || kind === 'round') return [{ type: 'L', to: R }];",
    run: engineTests('path/offset.test.ts'), expect: /✖ caps: butt stops at the end, round adds a half disc/,
  },
  {
    id: 'B572', what: 'toSubpaths closes every subpath (an open one, returning to its start or not, would get no caps)',
    file: 'engine/path/loops.ts', from: '    if (cur && (cur.segs.length || cur.closed)) out.push(cur);', to: '    if (cur && (cur.segs.length || cur.closed)) out.push({ ...cur, closed: true });',
    run: engineTests('path/loops.test.ts'), expect: /✖ toSubpaths: each subpath as drawn, closed only by a Z/,
  },
  {
    id: 'B573', what: 'a filled shape’s outline loses its transform (drawn in the parent’s space, off the shape)',
    file: 'projects/draw/src/paths/write.ts', from: '    if (t) m += ` transform=${t.quote}${t.raw}${t.quote}`;\n', to: '',
    run: drawTests('editor.test.ts'), expect: /✖ Stroke to path: a filled shape keeps its fill/,
  },
  // P1-M4 S0, the M3 follow-up: a shape that becomes a <path> a <style> rule may paint.
  {
    id: 'B574', what: 'a boolean’s bottom shape becomes a <path> that a `path { fill }` rule paints (the converted-<path> check skipped)',
    file: 'projects/draw/src/editor.ts', from: '    const asPath = pathRuleRefusal(doc, bottom.id);\n    if (asPath) return { refused: asPath };\n', to: '',
    run: drawTests('editor.test.ts'), expect: /✖ a boolean whose bottom shape would become a <path> a <style> rule may paint refuses/,
  },
  {
    id: 'B575', what: 'Stroke to path turns a line into a <path> that a `path { fill }` rule paints (the converted-<path> check skipped)',
    file: 'projects/draw/src/editor.ts', from: '    const ruled = pathRuleRefusal(doc, id, s.filled);\n    if (ruled) return void this.notice.set(ruled);\n', to: '',
    run: drawTests('editor.test.ts'), expect: /✖ a boolean whose bottom shape would become a <path> a <style> rule may paint refuses/,
  },
  {
    id: 'B576', what: 'the selector reading asks about a shape as itself when asked as a <path> (so `path { … }` never matches it)',
    file: 'engine/geometry/css.ts', from: '  const node = subjectOf(doc, el(doc, id), as);', to: '  const node = subjectOf(doc, el(doc, id));',
    run: drawTests('editor.test.ts'), expect: /✖ a boolean whose bottom shape would become a <path> a <style> rule may paint refuses/,
  },
  // P1-M4 S0, slow (one per new e2e check, naming it).
  {
    id: 'B577', what: 'Stroke to path writes the outline in the parent’s units instead of the element’s own (its transform applied twice)', slow: true, checks: ['strokeToPathCoversTheStroke'],
    file: 'projects/draw/src/editor.ts', from: '    const outline = loopsD(out.loops);\n', to: "    const outline = loopsD(mapLoops(out.loops, parseTransform(attrValueOf(doc, id, 'transform') ?? '')?.matrix ?? IDENTITY));\n",
    run: DRAW_E2E, expect: /strokeToPathCoversTheStroke: the rotated line: \d+ pixels differ/,
  },
  // P1-M4 S1: text and fonts, quick unless marked.
  {
    id: 'B578', what: 'the catalogue leaves a face out (Caveat’s 600)',
    file: 'projects/draw/src/platform/font-catalogue.ts', from: "generic: 'cursive', weights: [400, 500, 600, 700],", to: "generic: 'cursive', weights: [400, 500, 700],",
    run: drawTests('font-catalogue.test.ts'), expect: /✖ the catalogue: each family’s every latin \.woff2 face/,
  },
  {
    id: 'B579', what: 'the name guard lets Arial through (a file’s face named Arial would restyle the app)',
    file: 'engine/text/font-faces.ts', from: '  return UI_NAMES.has(f) || GENERIC_FAMILIES.has(f) || KEYWORDS.has(f);', to: "  return (UI_NAMES.has(f) && f !== 'arial') || GENERIC_FAMILIES.has(f) || KEYWORDS.has(f);",
    run: drawTests('fonts.test.ts'), expect: /✖ the name guard \(fonts\.ts’s appFontName\)/,
  },
  {
    id: 'B580', what: 'use registers a face twice (every use makes another FontFace for it)',
    file: 'projects/draw/src/platform/fonts.ts', from: '    if (registered.has(key) || ownFamilies.has(lower(f.family))) return;', to: '    if (ownFamilies.has(lower(f.family))) return;',
    run: drawTests('fonts.test.ts'), expect: /✖ use registers exactly the faces asked for, each once/,
  },
  {
    id: 'B581', what: 'documentFaces([]) leaves the old drawing’s faces on document.fonts',
    file: 'projects/draw/src/platform/fonts.ts', from: '      for (const f of own) deps.set.delete(f);\n', to: '',
    run: drawTests('fonts.test.ts'), expect: /✖ documentFaces replaces the drawing’s own faces/,
  },
  {
    id: 'B582', what: 'fontFaces takes the first source whatever it is (a local(), which has no data: font)',
    file: 'engine/text/font-faces.ts', from: "const src = srcItems(desc.get('src') ?? '').map(dataSource).find((s) => s !== null);", to: "const src = srcItems(desc.get('src') ?? '').map(dataSource)[0];",
    run: engineTests('text/font-faces.test.ts'), expect: /✖ the first usable source is taken/,
  },
  {
    id: 'B583', what: 'readLines accepts a tspan with more attributes than x and dy (SVG Lab’s Typography, its fills)',
    file: 'engine/text/lines.ts', from: '    if (k.attrs.length !== 2 || ax.ns !== null', to: '    if (k.attrs.length < 2 || ax.ns !== null',
    run: engineTests('text/lines.test.ts'), expect: /✖ readLines refuses anything else/,
  },
  {
    id: 'B584', what: 'planLines writes a space between the tspans (it lays out, and moves a middle-anchored line)',
    file: 'engine/text/lines.ts', from: '${escape(l, null)}</${tag}>`).join(\'\');', to: '${escape(l, null)}</${tag}>`).join(\' \');',
    run: engineTests('text/lines.test.ts'), expect: /✖ planLines: one line is one text node/,
  },
  {
    id: 'B585', what: 'the second line’s dy is 0em (every line drawn over the first)',
    file: 'engine/text/lines.ts', from: ' dy="${i ? LINE_DY : FIRST_DY}">', to: ' dy="${FIRST_DY}">',
    run: engineTests('text/lines.test.ts'), expect: /✖ planLines: one line is one text node/,
  },
  {
    id: 'B586', what: 'a text with a position list moves by its numbers (decision 8 says translate)',
    file: 'engine/geometry/write.ts', from: '      if (k === -1 || k > 1 || (k === 1 &&', to: '      if (k === -1 || (k === 1 &&',
    run: engineTests('geometry/write.test.ts'), expect: /✖ per element, a move writes exactly the attributes in the table/,
  },
  {
    id: 'B587', what: 'a tspan’s x stays put when its text moves (the lines split apart)',
    file: 'engine/geometry/write.ts', from: "    if (!own && !(p.ns === NS.svg && p.local === 'tspan')) continue;", to: '    if (!own) continue;',
    run: engineTests('geometry/write.test.ts'), expect: /✖ per element, a move writes exactly the attributes in the table/,
  },
  {
    id: 'B588', what: 'the font-family token cycles values beyond SVG Lab’s three generics',
    file: 'engine/code/tokens.ts', from: "  'font-family': ['sans-serif', 'serif', 'monospace'],", to: "  'font-family': ['sans-serif', 'serif', 'monospace', 'cursive', 'Archivo, sans-serif'],",
    run: engineTests('code/tokens.test.ts'), expect: /✖ font-family \(P1-M4\)/,
  },
  {
    id: 'B589', what: 'Inspect offers a weight the family lacks (Bebas Neue’s 700)',
    file: 'projects/draw/src/style-edit.ts', from: '  return [...list];\n}', to: '  return [...new Set([...list, 700])].sort((a, b) => a - b);\n}',
    run: drawTests('inspect.test.ts'), expect: /✖ the weights and styles Inspect offers for a family/,
  },
  {
    id: 'B590', what: 'the Text tool’s y misses the 0.35·S offset (the tap lands on the baseline, not the word’s middle)',
    file: 'projects/draw/src/interact/text-tool.ts', from: 'y="${w(q(p.y + 0.35 * size))}"', to: 'y="${w(q(p.y))}"',
    run: drawTests('text-tool.test.ts'), expect: /✖ a tap on a 100-unit board places SVG Lab’s "Hello" exactly/,
  },
  {
    id: 'B591', what: 'check-sinks misses new FontFace outside src/platform/',
    file: 'projects/draw/tools/check-sinks.mjs', from: "['font-face', /\\bnew\\s+FontFace\\s*\\(|\\bdocument\\.fonts\\b/,", to: "['font-face', /\\bdocument\\.fonts\\b/,",
    run: drawTests('check-sinks.test.ts'), expect: /✖ check-sinks keeps registering a font face to src\/platform\//,
  },
  {
    id: 'B592', what: 'a font over 10 MB is stored',
    file: 'projects/draw/src/platform/fonts.ts', from: '      if (file.size > MAX_FONT_BYTES) throw new FontError(ADD_REFUSED);\n', to: '',
    run: drawTests('fonts.test.ts'), expect: /✖ your fonts: added/,
  },
  {
    id: 'B593', what: 'a package with no licence file (dfa) is missing from the notices test’s table',
    file: 'projects/draw/test/unit/notices.test.ts', from: "  dfa: 'Licence: MIT (its package.json and README; the package and its repository ship no licence text). Author: Devon Govett (package.json).',\n", to: '',
    run: drawTests('notices.test.ts'), expect: /✖ the notices name every package whose code ships/,
  },
  {
    id: 'B594', what: 'the Text tool’s font toggle is ignored: every new text is Archivo (Mark, 2026-10-01)',
    file: 'projects/draw/src/editor.ts', from: '    const family = this.textFont.get();\n    const value = fontValue(family,', to: '    const family = TEXT_DEFAULTS[0];\n    const value = fontValue(family,',
    run: drawTests('editor.test.ts'), expect: /✖ the Text tool’s font \(Mark, 2026-10-01\)/,
  },
  // P1-M4 S1, slow (one per new e2e check, naming it).
  {
    id: 'B595', what: 'the Text tool places at the host px instead of the root units (the text isn’t under the tap)', slow: true, checks: ['theTextToolPlacesHelloAndWritesLines'],
    file: 'projects/draw/src/editor.ts', from: '    const p = this.#snapRoot(at, this.#snapTargets([]), step).p;\n', to: '    const p = at;\n',
    run: DRAW_E2E, expect: /theTextToolPlacesHelloAndWritesLines: the tap wrote/,
  },
  {
    id: 'B596', what: 'fonts.ts registers the whole catalogue at the first use (every face fetched, not only what a drawing uses)', slow: true, checks: ['fontsLoadOnlyWhatTheDrawingUses'],
    file: 'projects/draw/src/platform/fonts.ts', from: '        for (const f of faces) register(f);\n', to: "        for (const f of [...faces, ...CATALOGUE.flatMap((c) => c.weights.map((weight) => ({ family: c.family, weight, style: 'normal' as const })))]) register(f);\n",
    run: DRAW_E2E, expect: /fontsLoadOnlyWhatTheDrawingUses: (before any text, |the drawing fetched )/,
  },
  {
    id: 'B597', what: 'the editor never registers a file’s own faces (documentFaces): Chromium draws the text in serif (WebKit draws a shadow tree’s own @font-face anyway, so Chromium is where this shows)', slow: true, checks: ['aFilesOwnFontDrawsInEveryEngine'],
    file: 'projects/draw/src/editor.ts', from: '      fonts.documentFaces(fontFaces(doc).faces);\n', to: '',
    run: DRAW_E2E, expect: /aFilesOwnFontDrawsInEveryEngine: iiiiiiii in the file's own face measures/,
  },
  {
    id: 'B598', what: 'Inspect’s Text rows shrink below 44 pt (the Font button 18 pt tall)', slow: true, checks: ['phoneRulesOnTheTextTools'],
    file: 'projects/draw/src/app.css', from: '.draw-font-btn, .draw-weight-btn { flex: 1 1 auto; font-size: var(--text-md); }', to: '.draw-font-btn, .draw-weight-btn { flex: 1 1 auto; font-size: var(--text-md); min-height: 1.5rem; height: 1.5rem; }',
    run: DRAW_E2E, expect: /phoneRulesOnTheTextTools \((956|796)\)[\s\S]*Inspect's Text section at (half|full): tap targets under 44pt/,
  },
  // P1-M4 S2: text to path and export, quick unless marked.
  {
    id: 'B599', what: 'outlineD skips the y flip (a glyph is drawn upside down, below its baseline)',
    file: 'engine/text/outline.ts', from: 'const p = (x: number, y: number) => `${fmt(ox + x * s, 3)} ${fmt(oy - y * s, 3)}`;', to: 'const p = (x: number, y: number) => `${fmt(ox + x * s, 3)} ${fmt(oy + y * s, 3)}`;',
    run: engineTests('text/outline.test.ts'), expect: /✖ outlineD places a glyph at the pen/,
  },
  {
    id: 'B600', what: 'a middle-anchored line starts at its x (not half its advance to the left)',
    file: 'engine/text/outline.ts', from: "let pen = chunk.x - w * (chunk.anchor === 'middle' ? 0.5 : chunk.anchor === 'end' ? 1 : 0);", to: "let pen = chunk.x - w * (chunk.anchor === 'middle' ? 0 : chunk.anchor === 'end' ? 1 : 0);",
    run: engineTests('text/outline.test.ts'), expect: /✖ outlineD anchors a line at start, middle and end/,
  },
  {
    id: 'B601', what: 'the outline scales by size ÷ 1000, not the font’s unitsPerEm (Inter’s is 2048)',
    file: 'engine/text/outline.ts', from: /run\.size \/ shaped\[c\]\[r\]\.unitsPerEm/g, to: 'run.size / 1000',
    run: engineTests('text/outline.test.ts'), expect: /✖ outlineD places a glyph at the pen, scales it by size ÷ unitsPerEm/,
  },
  {
    id: 'B602', what: 'a text with a position list is outlined at its first position (it must refuse)',
    file: 'engine/text/outline.ts', from: '.split(/[\\s,]+/).length > 1;', to: '.split(/[\\s,]+/).length > 99;',
    run: engineTests('text/outline.test.ts'), expect: /✖ outlineText refuses tools\/edge-text-xml-space-tspans\.svg’s position-list/,
  },
  {
    id: 'B603', what: 'the path keeps the text’s font-family',
    file: 'engine/text/to-path.ts', from: "  'font-family', 'font-size', 'font-size-adjust',", to: "  'font-size', 'font-size-adjust',",
    run: engineTests('text/to-path.test.ts'), expect: /✖ the path keeps the text’s attributes in their order/,
  },
  {
    id: 'B604', what: 'the path gets no aria-label (its characters are lost to a screen reader)',
    file: 'engine/text/to-path.ts', from: "if (!moved.some((c) => el(doc, c).local === 'title')) s += ` aria-label=", to: "if (moved.some((c) => el(doc, c).local === 'none')) s += ` aria-label=",
    run: engineTests('text/to-path.test.ts'), expect: /✖ the aria-label is the characters as laid out/,
  },
  {
    id: 'B605', what: 'a character the face has no glyph for is outlined as .notdef (its box)',
    file: 'projects/draw/src/text/pipeline.ts', from: '      if (s.missing.length) why[u.t] ??= NO_GLYPH(face.family, s.missing[0]);\n', to: '',
    run: drawTests('text-pipeline.test.ts'), expect: /✖ a character a face can’t draw refuses/,
  },
  {
    id: 'B606', what: 'With fonts embeds a font with a Reserved Font Name (IBM Plex Sans’s “Plex”)',
    file: 'projects/draw/src/export/svg.ts', from: 'const no = held.reserved.length ? reservesName(', to: 'const no = held.reserved.length < 0 ? reservesName(',
    run: drawTests('export-text.test.ts'), expect: /✖ With fonts: one <style> right after the <title>/,
  },
  {
    id: 'B607', what: 'As paths converts Georgia, a font Draw holds no file for (outlined in another face)',
    file: 'engine/text/outline.ts', from: '  if (!held) return { refused: NOT_HELD(family) };', to: "  if (!held) return { family: 'Inter', weight, style, own: null };",
    run: drawTests('export-text.test.ts'), expect: /✖ As paths: the three texts in Draw’s fonts become paths/,
  },
  {
    id: 'B608', what: 'the text library reads the face’s .woff, not the .woff2 the canvas draws (Archivo’s outlines differ)',
    file: 'projects/draw/src/platform/font-catalogue.ts', from: '`${slug}-latin-${weight}-${style}.woff2`', to: '`${slug}-latin-${weight}-${style}.woff`',
    run: drawTests('text-pipeline.test.ts'), expect: /✖ what is read is the \.woff2 the canvas registers/,
  },
  // P1-M4 S2, slow (one per new e2e check, naming it).
  {
    id: 'B609', what: 'the editor imports src/text/outline-lib.ts statically, so fontkit rides in the first chunk', slow: true, checks: ['textToPathLooksTheSame'],
    file: 'projects/draw/src/editor.ts', from: "import { loadTextLib, type TextLib } from './text/load.ts';", to: "import type { TextLib } from './text/load.ts';\nimport * as staticTextLib from './text/outline-lib.ts';\nconst loadTextLib = async (): Promise<TextLib> => staticTextLib;",
    run: DRAW_E2E, expect: /textToPathLooksTheSame: the first Text to path loaded/,
  },
  {
    id: 'B610', what: 'the Export sheet shares the As text file while As paths is still preparing (Clean’s file would still hold <text>)', slow: true, checks: ['exportWritesTextAsPathsOrWithFonts'],
    file: 'projects/draw/src/panels/FileSheets.tsx', from: "const ready = choice === 'text' ? clean : prep?.choice === choice ? prep.file : null;", to: "const ready = choice === 'text' ? clean : prep?.choice === choice && prep.file ? prep.file : clean;",
    run: DRAW_E2E, expect: /exportWritesTextAsPathsOrWithFonts: while As paths prepares, Clean's button reads/,
  },
  // P1-M4 S3: the accessibility panel, quick unless marked.
  {
    id: 'B611', what: 'Title off leaves the aria-labelledby that named its id',
    file: 'engine/access/model.ts', from: '    if (own !== null && names !== null && names.trim() === own) apply(opSetAttr(doc, doc.root, null, ref, null));', to: "    if (own !== null && names !== null && names.trim() === own && which === 'desc') apply(opSetAttr(doc, doc.root, null, ref, null));",
    run: engineTests('access/access.test.ts'), expect: /✖ on lab\/access\.svg, Title off then Description off gives SVG Lab’s states/,
  },
  {
    id: 'B612', what: 'Title on writes role="img" over the file’s own role',
    file: 'engine/access/model.ts', from: "  if (findAttr(root, null, 'role') === undefined) apply(opSetAttr(doc, doc.root, null, 'role', 'img'));", to: "  apply(opSetAttr(doc, doc.root, null, 'role', 'img'));",
    run: engineTests('access/access.test.ts'), expect: /✖ Draw never writes over a file’s own role or label/,
  },
  {
    id: 'B613', what: 'role="img" stays when neither a title, a description nor a label is left',
    file: 'engine/access/model.ts', from: "  if (a.role?.trim().toLowerCase() !== 'img' || a.title", to: "  if (a.role?.trim().toLowerCase() !== 'gone' || a.title",
    run: engineTests('access/access.test.ts'), expect: /✖ on lab\/access\.svg, Title off then Description off gives SVG Lab’s states/,
  },
  {
    id: 'B614', what: 'an element’s title goes last, not as its first child',
    file: 'engine/access/model.ts', from: "  insertMarkup(doc, firstPlace(doc, id), `<${tagOf(doc, 'title')}>", to: "  insertMarkup(doc, { last: id }, `<${tagOf(doc, 'title')}>",
    run: engineTests('access/access.test.ts'), expect: /✖ an element’s Title is its first child/,
  },
  {
    id: 'B615', what: 'the Language field takes "english" (a tag’s first part may be up to 8 letters)',
    file: 'engine/access/model.ts', from: 'export const LANG_TAG = /^[A-Za-z]{2,3}(', to: 'export const LANG_TAG = /^[A-Za-z]{2,8}(',
    run: engineTests('access/access.test.ts'), expect: /✖ Language: the root’s lang/,
  },
  {
    id: 'B616', what: 'the preview ignores aria-labelledby (it reads the aria-label or the <title>)',
    file: 'engine/access/speak.ts', from: "  const name = named(a.labelledby) || squash(a.label ?? '')", to: "  const name = squash(a.label ?? '')",
    run: engineTests('access/speak.test.ts'), expect: /✖ the name: the texts aria-labelledby names/,
  },
  {
    id: 'B617', what: 'the stray labels read a text’s own characters only, skipping its tspans',
    file: 'engine/access/speak.ts', from: 'const t = squash(renderedText(doc, c));', to: "const t = squash(el(doc, c).children.map((k) => { const x = doc.nodes.get(k)!; return x.kind === 'text' ? x.raw : ''; }).join(''));",
    run: engineTests('access/speak.test.ts'), expect: /✖ stray labels: every text’s characters as laid out/,
  },
  {
    id: 'B618', what: 'Metadata on makes a second <metadata> where the file’s holds no RDF',
    file: 'engine/access/metadata.ts', from: '  if (m.metadata === null) {', to: '  if (m.metadata === null || m.work === null) {',
    run: engineTests('access/metadata.test.ts'), expect: /✖ Draw’s own <metadata draw:made> is shared/,
  },
  {
    id: 'B619', what: 'an RDF file’s new dc:creator and dc:date are written bare in its <metadata>, outside its cc:Work',
    file: 'engine/access/metadata.ts', from: '  const into = m.work ?? m.metadata;', to: '  const into = m.metadata;',
    run: engineTests('access/metadata.test.ts'), expect: /✖ an RDF file \(tools\/inkscape-1x-layers\.svg\)/,
  },
  {
    id: 'B620', what: 'the import report’s style-rule note misses :focus',
    file: 'engine/geometry/css.ts', from: '|:(?:focus(?:-visible|-within)?|link|', to: '|:(?:focus-visible|focus-within|link|',
    run: engineTests('report/import-report.test.ts'), expect: /✖ the style-rule note \(P1-M4 S3\)/,
  },
  {
    id: 'B621', what: 'xml:lang is rendered on the canvas again',
    file: 'engine/policy/render-policy.ts', from: "  if (attrNs === NS.xml && attrLocal === 'base') return false;", to: "  if (attrNs === NS.xml && attrLocal === 'base') return false;\n  if (attrNs === NS.xml && attrLocal === 'lang') return true;",
    run: engineTests('policy/render-policy.test.ts'), expect: /✖ xml:lang \(P1-M4 S3\) is refused on every element/,
  },
  // P1-M4 S3, slow (one per new e2e check, naming it).
  {
    id: 'B622', what: 'the Access tab subscribes to no version bump (it reads the drawing again only when the selection changes), so its switches and its preview don’t follow an edit or an undo', slow: true, checks: ['theAccessPanelNamesTheDrawing'],
    file: 'projects/draw/src/panels/Access.tsx', from: '  useStore(editor.selection);\n  useStore(editor.version);\n  const a = editor.access();', to: '  useStore(editor.selection);\n  const a = editor.access();',
    run: DRAW_E2E, expect: /theAccessPanelNamesTheDrawing: the preview reads/,
  },
  {
    id: 'B623', what: 'the screen-reader preview is computed once, when the tab opens', slow: true, checks: ['theScreenReaderPreviewFollowsTheFile'],
    file: 'projects/draw/src/panels/Access.tsx', from: '  useStore(editor.version);\n  const a = editor.access();', to: '  useStore(editor.version);\n  const [first] = useState(() => editor.access());\n  const now = editor.access();\n  const a = now && first ? { ...now, said: first.said } : now;',
    run: DRAW_E2E, expect: /theScreenReaderPreviewFollowsTheFile: Title off: the preview reads/,
  },
  {
    id: 'B624', what: 'the tabs’ padding grows to --space-8, pushing the five tabs past 440 pt', slow: true, checks: ['phoneRulesOnTheAccessPanel'],
    file: 'projects/draw/src/app.css', from: '.draw-tabs > button { padding: 0 var(--space-4); }', to: '.draw-tabs > button { padding: 0 var(--space-8); }',
    run: DRAW_E2E, expect: /phoneRulesOnTheAccessPanel \((956|796)\)[\s\S]*(is outside the 440 pt row|scrolls sideways)/,
  },
  // P1-M4, hardened: font names XML can hold, font files bounded by what they unpack to, a file's own
  // <metadata> kept (quick unless marked).
  {
    id: 'B625', what: 'Add a font… stores a family XML can’t hold (U+0001: Set font would write a file that no longer parses)',
    file: 'projects/draw/src/platform/fonts.ts', from: '      const badName = familyNameError(family);\n      if (badName) throw new FontError(badName);\n', to: '',
    run: drawTests('fonts.test.ts'), expect: /✖ a family XML can’t hold, holding a control character/,
  },
  {
    id: 'B626', what: 'a stored font record whose family XML can’t hold (another script on the origin wrote it) is read back',
    file: 'projects/draw/src/platform/fonts.ts', from: "f.family !== '' && familyNameError(f.family) === null && !appFontName(f.family) && ", to: "f.family !== '' && ",
    run: drawTests('fonts.test.ts'), expect: /✖ a family XML can’t hold, holding a control character/,
  },
  {
    id: 'B627', what: 'Set font writes a family XML can’t hold into the drawing',
    file: 'projects/draw/src/editor.ts', from: '    const bad = xmlCharError(value);\n    if (bad) return void this.notice.set(bad);\n', to: '',
    run: drawTests('editor.test.ts'), expect: /✖ Set font refuses a family XML can’t hold/,
  },
  {
    id: 'B628', what: 'the Text tool’s name characters take U+FFFE and U+FFFF again (a family holding one is written bare)',
    file: 'projects/draw/src/interact/text-tool.ts', from: '[_a-zA-Z\\u00A0-\\uFFFD])[-_a-zA-Z0-9\\u00A0-\\uFFFD]', to: '[_a-zA-Z\\u00A0-\\uFFFF])[-_a-zA-Z0-9\\u00A0-\\uFFFF]',
    run: drawTests('text-tool.test.ts'), expect: /✖ a family holding U\+FFFE or U\+FFFF is never written bare/,
  },
  {
    id: 'B629', what: 'fontkit gets a font whose header says it unpacks to 768 MB (no bound on what a WOFF or WOFF2 declares)',
    file: 'projects/draw/src/text/outline-lib.ts', from: '  if (size > MAX_UNPACKED) throw new Error(`a font that unpacks to ${size} bytes (the most is ${MAX_UNPACKED})`);\n', to: '',
    run: drawTests('text-lib.test.ts'), expect: /✖ a font whose header says it unpacks to more than 30 MB/,
  },
  {
    id: 'B630', what: 'Metadata off takes away a <metadata> holding no element, with the comment, text or CDATA in it',
    file: 'engine/access/metadata.ts', from: '    if (meta && empty(meta.id) && meta.attrs', to: '    if (meta && !kids(doc, meta.id).length && meta.attrs',
    run: engineTests('access/metadata.test.ts'), expect: /✖ Metadata on then off keeps a file’s own <metadata>/,
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

/**
 * How many places a break's anchor matches, for the dry run's AMBIG rule: a string counts every
 * occurrence (overlapping ones too), a RegExp without g every match. An append, or a g RegExp
 * (which replaces every match on purpose), counts as one. Counted with CRLF line ends read as LF
 * (the anchor's too): a copy of a multi-line anchor in the other line ending is a twin.
 */
function anchorMatches(b, original) {
  if (b.append != null || b.from == null) return 1;
  const text = original.replace(/\r\n/g, '\n');
  if (b.from instanceof RegExp) {
    if (b.from.global) return 1;
    return [...text.matchAll(new RegExp(b.from.source, b.from.flags.replace('y', '') + 'g'))].length;
  }
  const from = b.from.replace(/\r\n/g, '\n');
  let n = 0;
  for (let i = text.indexOf(from); i !== -1; i = text.indexOf(from, i + 1)) n++;
  return n;
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
    if (b.from instanceof RegExp && b.from.sticky) {
      say('BAD', 'a sticky anchor plants only at index 0');
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
    if (applyBreak(b, original) !== original) {
      const n = anchorMatches(b, original);
      if (n > 1) say('AMBIG', `${b.file}: the anchor matches ${n} times; the break plants only the first`);
      continue;
    }
    const found = b.from instanceof RegExp ? new RegExp(b.from.source, b.from.flags.replace(/[gy]/g, '')).test(original) : original.includes(b.from);
    if (found) say('NOOP', `${b.file}: the anchor is there but replacing it changes nothing`);
    else say('STALE', `${b.file}: the anchor is not in the file`);
  }
  for (const p of problems) console.log(p);
  const bad = new Set(problems.map((p) => p.split(' ')[0])).size;
  console.log(bad ? `Dry run: ${chosen.length} break(s) checked; ${bad} would not apply as written.` : `Dry run: ${chosen.length} break(s) checked; all apply.`);
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
