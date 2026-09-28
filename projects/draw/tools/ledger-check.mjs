#!/usr/bin/env node
// Support-ledger gate. Runs in `npm run build`, so it gates CI.
//
// engine/ledger/ledger.json is the source of truth for what Draw edits, keeps, previews or drops,
// and for which SVG Lab capability lands in which phase. This checks it and generates the files
// that must agree with it:
//
//   node tools/ledger-check.mjs                    check (CI): any problem or a stale generated file fails
//   node tools/ledger-check.mjs --write            regenerate the generated files and extend ids.lock, then check
//   node tools/ledger-check.mjs --evidence <file>  also require every cited test to have passed, from the
//                                                  run recorded by tools/evidence-reporter.mjs
//
// Checks:
// - schema: ids, kinds, classes, phases, statuses; `partial` needs a reason, `done` needs tests,
//   `superseded` needs `supersededBy` (the rows or decision that replaced it);
// - rows are never deleted: every id in engine/ledger/ids.lock must still exist;
// - policy: hidden, active and dropped rows are never rendered, active and dropped ones never
//   served, and a `preserve` row is rendered (that is what distinguishes it from preserve-hidden);
// - attribute rows: one base row per name, splits (id@suffix) that name an existing base and do
//   not overlap, patterns rendered only from an explicit list, and no row whose phase comes before
//   the phase of an element it edits;
// - coverage: every element and element/attribute pair in svg-tag-names and svg-element-attributes
//   (SVG 1.1, Tiny 1.2 and 2), every SVG Lab lesson, and every extracted lesson capability
//   (engine/ledger/lesson-capabilities.json) has a row;
// - evidence: a cited test lives in a unit-test file, and with --evidence it passed;
// - the phase gate: every row of a phase before meta.currentPhase is done or superseded. Raising
//   currentPhase is the phase exit; 9 means the ledger is closed.
//
// Generated: scripts/lib/svg-profile-tables.mjs (the served profile), engine/policy/tables.ts
// (what the canvas may render) and engine/ledger/LEDGER.md (the coverage report).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svgTagNames } from 'svg-tag-names';
import { svgElementAttributes } from 'svg-element-attributes';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WRITE = process.argv.includes('--write');
const EVIDENCE = process.argv.includes('--evidence') ? process.argv[process.argv.indexOf('--evidence') + 1] : null;
// Read, not imported: the profile imports the tables this script generates, so importing it would
// make a broken generated file impossible to regenerate.
const PROFILE_VERSION = Number(/export const PROFILE_VERSION = (\d+);/.exec(readFileSync(resolve(ROOT, 'scripts/lib/svg-profile.mjs'), 'utf8'))?.[1]);
const errors = [];
const fail = (m) => errors.push(m);

const KINDS = ['element', 'attribute', 'property', 'value', 'syntax', 'namespace', 'capability', 'feature'];
const CLASSED = new Set(['element', 'attribute', 'property', 'value', 'syntax', 'namespace']);
const CLASSES = ['edit', 'preserve', 'preserve-hidden', 'active', 'drop'];
const STATUSES = ['planned', 'partial', 'done', 'superseded'];
const ELEMENT_NS = ['svg', 'xhtml', 'mathml', '*'];
const CLOSED = 9; // meta.currentPhase after the P8 exit
// Attribute patterns the canvas may render (so <style> selectors on them match), as regexes.
const RENDERABLE_PATTERNS = { 'data-*': '^data-[^\\s:]+$', 'aria-*': '^aria-[a-z]+$' };
// Where cited tests may live: the files the build's unit run executes.
const TEST_FILES = [/^engine\/test\/.+\.test\.ts$/, /^projects\/draw\/test\/unit\/.+\.test\.ts$/];
const isPattern = (name) => /[*(]/.test(name);
const baseId = (r) => r.id.split('@')[0];

function main() {
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(resolve(ROOT, 'engine/ledger/ledger.json'), 'utf8'));
  } catch (e) {
    fail(`engine/ledger/ledger.json: ${e.message.split('\n')[0]}`);
  }

  if (ledger) {
    const { meta, rows, lessons } = ledger;
    if (!meta || !Number.isInteger(meta.currentPhase) || meta.currentPhase < 0 || meta.currentPhase > CLOSED) fail(`meta.currentPhase must be an integer 0-${CLOSED} (${CLOSED} = closed)`);
    if (meta?.profileVersion !== PROFILE_VERSION) fail(`meta.profileVersion ${meta?.profileVersion} ≠ scripts/lib/svg-profile.mjs PROFILE_VERSION ${PROFILE_VERSION}`);
    if (!Array.isArray(rows)) fail('rows must be an array');
    if (!Array.isArray(lessons)) fail('lessons must be an array');
    if (Array.isArray(rows) && Array.isArray(lessons)) {
      checkRows(meta, rows, lessons);
      checkAttributes(rows);
      checkCoverage(rows, lessons);
      checkLock(rows);
      if (EVIDENCE) checkEvidence(rows);
      if (!errors.length) generate(meta, rows, lessons);
    }
  }

  if (errors.length) {
    console.error(`ledger-check: ${errors.length} problem(s):`);
    for (const e of errors.slice(0, 50)) console.error(`  ${e}`);
    if (errors.length > 50) console.error(`  … and ${errors.length - 50} more`);
    process.exitCode = 1;
  } else {
    const n = (s) => ledger.rows.filter((r) => r.status === s).length;
    const cited = EVIDENCE ? '; every cited test passed' : '';
    console.log(`ledger-check: ok (phase ${ledger.meta.currentPhase}; ${ledger.rows.length} rows: ${n('done')} done, ${n('partial')} partial, ${n('planned')} planned, ${n('superseded')} superseded${cited})`);
  }
}

// ── schema, policy, citations, phase gate ──────────────────────────────────────────────────────

function checkRows(meta, rows, lessons) {
  const lessonIds = new Set(lessons.map((l) => l.id));
  const byId = new Map();
  for (const r of rows) {
    if (typeof r.id !== 'string' || !r.id) {
      fail(`row without an id: ${JSON.stringify(r).slice(0, 60)}`);
      continue;
    }
    if (byId.has(r.id)) fail(`${r.id}: duplicate id`);
    byId.set(r.id, r);
  }
  const elementKeys = new Set();
  for (const r of rows) {
    if (!r.id) continue;
    if (!KINDS.includes(r.kind)) fail(`${r.id}: unknown kind ${r.kind}`);
    else if (!r.id.startsWith(`${r.kind}:`)) fail(`${r.id}: id must start with "${r.kind}:"`);
    if (typeof r.name !== 'string' || !r.name) fail(`${r.id}: needs a name`);
    if (!Number.isInteger(r.phase) || r.phase < 0 || r.phase > 8) fail(`${r.id}: phase must be 0-8`);
    if (!STATUSES.includes(r.status)) fail(`${r.id}: unknown status ${r.status}`);
    if (r.status === 'partial' && !r.reason) fail(`${r.id}: partial needs a reason`);
    if (r.status === 'done' && !(Array.isArray(r.tests) && r.tests.length)) fail(`${r.id}: done needs the tests that prove it`);
    if (r.status === 'superseded') {
      if (typeof r.supersededBy !== 'string' || !r.supersededBy.trim()) fail(`${r.id}: superseded needs supersededBy (the rows or decision that replaced it)`);
      else {
        for (const ref of r.supersededBy.split(/,\s*/)) {
          const kind = ref.split(':')[0];
          if (!KINDS.includes(kind)) continue; // a decision (an _audit file or plan revision), not a row
          const to = byId.get(ref);
          if (!to) fail(`${r.id}: supersededBy names ${ref}, which does not exist`);
          else if (to.status === 'superseded') fail(`${r.id}: supersededBy names ${ref}, which is itself superseded`);
        }
      }
    } else if (r.supersededBy !== undefined) fail(`${r.id}: only a superseded row has supersededBy`);
    for (const l of r.lesson ?? []) if (!lessonIds.has(l)) fail(`${r.id}: unknown lesson ${l}`);

    if (CLASSED.has(r.kind)) {
      if (!CLASSES.includes(r.class)) fail(`${r.id}: unknown class ${r.class}`);
      if (typeof r.render !== 'boolean' || typeof r.serve !== 'boolean') fail(`${r.id}: render and serve must be true or false`);
      if (['preserve-hidden', 'active', 'drop'].includes(r.class) && r.render) fail(`${r.id}: a ${r.class} row is never rendered`);
      if (['active', 'drop'].includes(r.class) && r.serve) fail(`${r.id}: an ${r.class} row is never served`);
      if (r.class === 'preserve' && !r.render && r.kind !== 'syntax') fail(`${r.id}: a preserve row is rendered; a kept row that is not rendered is preserve-hidden`);
    } else if (r.class !== undefined) fail(`${r.id}: a ${r.kind} row has no class`);
    if (r.kind === 'element') {
      if (!ELEMENT_NS.includes(r.ns)) fail(`${r.id}: element ns must be one of ${ELEMENT_NS.join(', ')}`);
      const key = `${r.ns}:${r.name}`;
      if (elementKeys.has(key)) fail(`${r.id}: a second row for element ${key}`);
      elementKeys.add(key);
    }

    for (const t of r.tests ?? []) {
      const i = t.indexOf('#');
      const file = i > 0 ? t.slice(0, i) : '';
      if (!file || i === t.length - 1) fail(`${r.id}: test "${t}" must be "path#test name"`);
      else if (!TEST_FILES.some((re) => re.test(file))) fail(`${r.id}: ${file} is not a unit-test file the build runs`);
      else if (!existsSync(resolve(ROOT, file))) fail(`${r.id}: test file ${file} does not exist`);
    }

    if (r.phase < meta.currentPhase && r.status !== 'done' && r.status !== 'superseded') {
      fail(`${r.id}: phase ${r.phase} is behind the current phase ${meta.currentPhase} but the row is ${r.status}`);
    }
  }
}

// ── attribute rows: bases, splits, patterns, phases ────────────────────────────────────────────

function checkAttributes(rows) {
  const attrs = rows.filter((r) => r.kind === 'attribute');
  const bases = new Map();
  for (const r of attrs) {
    if (!Array.isArray(r.on) || !r.on.length) fail(`${r.id}: attribute rows list the elements they apply to ('*' for all)`);
    if (r.id.includes('@')) continue;
    const key = `${r.ns ?? 'svg'}:${r.name}`;
    if (bases.has(key)) fail(`${r.id}: a second base row for ${key} (use a split row, id@suffix)`);
    bases.set(key, r);
    const suffix = r.id.slice('attribute:'.length).replace(/^xhtml\//, '');
    if (suffix !== r.name) fail(`${r.id}: the id must end in the attribute name "${r.name}"`);
    if (isPattern(r.name) && r.render && !RENDERABLE_PATTERNS[r.name]) fail(`${r.id}: only ${Object.keys(RENDERABLE_PATTERNS).join(', ')} may be rendered as patterns`);
  }
  const claimed = new Map(); // base id → elements claimed by its splits
  for (const s of attrs.filter((r) => r.id.includes('@'))) {
    const base = rows.find((r) => r.id === baseId(s));
    if (!base) {
      fail(`${s.id}: split row without its base ${baseId(s)}`);
      continue;
    }
    if ((base.ns ?? 'svg') !== (s.ns ?? 'svg') || base.name !== s.name) fail(`${s.id}: a split must have its base's name and ns`);
    if (isPattern(base.name)) fail(`${s.id}: pattern rows cannot be split`);
    if (s.on.includes('*')) fail(`${s.id}: a split names its elements, not '*'`);
    const seen = claimed.get(base.id) ?? new Set();
    for (const e of s.on) {
      if (seen.has(e)) fail(`${s.id}: <${e}> is already claimed by another split of ${base.id}`);
      seen.add(e);
    }
    claimed.set(base.id, seen);
  }
  // An active split's elements must never be served: the profile refuses active names globally
  // from base rows only.
  const servedEl = new Set(rows.filter((r) => r.kind === 'element' && r.serve).map((r) => `${r.ns}:${r.name}`));
  for (const s of attrs.filter((r) => r.id.includes('@') && r.class === 'active')) {
    const served = s.on.filter((e) => servedEl.has(`${s.ns ?? 'svg'}:${e}`));
    if (served.length) fail(`${s.id}: an active split on served element(s) <${served.join('>, <')}> needs a scoped profile rule`);
  }
  // An attribute cannot be fully delivered before the elements it edits exist.
  const elPhase = new Map(rows.filter((r) => r.kind === 'element' && r.ns === 'svg' && r.class === 'edit').map((r) => [r.name, r.phase]));
  for (const r of attrs) {
    if (r.ns || r.class !== 'edit' || r.on.includes('*')) continue;
    const mine = r.id.includes('@') ? r.on : r.on.filter((e) => !(claimed.get(r.id) ?? new Set()).has(e));
    const late = mine.filter((e) => (elPhase.get(e) ?? -1) > r.phase);
    if (late.length) fail(`${r.id}: phase ${r.phase} comes before <${late.join('>, <')}> (split it by phase)`);
  }
}

// ── coverage ───────────────────────────────────────────────────────────────────────────────────

function checkCoverage(rows, lessons) {
  const elements = new Set(rows.filter((r) => r.kind === 'element' && r.ns === 'svg').map((r) => r.name));
  for (const t of svgTagNames) if (!elements.has(t)) fail(`coverage: no row for the SVG element <${t}>`);

  const attrRows = new Map();
  for (const r of rows) {
    if (r.kind !== 'attribute' || r.ns) continue;
    if (!attrRows.has(r.name)) attrRows.set(r.name, []);
    attrRows.get(r.name).push(r);
  }
  for (const [el, list] of Object.entries(svgElementAttributes)) {
    for (const a of list) {
      const ok = (attrRows.get(a) ?? []).some((r) => r.on.includes('*') || (el !== '*' && r.on.includes(el)));
      if (!ok) fail(`coverage: no row for ${a} on ${el === '*' ? 'every element' : `<${el}>`}`);
    }
  }

  const lab = readFileSync(resolve(ROOT, 'projects/svg-lab/index.html'), 'utf8');
  const labIds = [...lab.matchAll(/^\s*id: '([a-z0-9-]+)', tab: '/gm)].map((m) => m[1]);
  if (labIds.length < 29) fail(`coverage: found only ${labIds.length} lessons in SVG Lab; the pattern may have drifted`);
  const lessonIds = new Set(lessons.map((l) => l.id));
  for (const id of labIds) {
    if (!lessonIds.has(id)) fail(`coverage: SVG Lab lesson "${id}" is missing from ledger.lessons`);
    else if (!rows.some((r) => r.kind === 'capability' && r.lesson?.includes(id))) fail(`coverage: lesson "${id}" has no capability rows`);
  }
  const caps = JSON.parse(readFileSync(resolve(ROOT, 'engine/ledger/lesson-capabilities.json'), 'utf8'));
  const ids = new Set(rows.map((r) => r.id));
  for (const [lesson, list] of Object.entries(caps)) {
    for (const c of list) if (!ids.has(`capability:${c}`)) fail(`coverage: ${lesson} capability ${c} (lesson-capabilities.json) has no row`);
  }
}

// ── rows are never deleted ─────────────────────────────────────────────────────────────────────

const LOCK = 'engine/ledger/ids.lock';

/** ids.lock: every id the ledger has ever had, with the phase it was first given. */
function readLock() {
  const path = resolve(ROOT, LOCK);
  if (!existsSync(path)) return new Map();
  return new Map(readFileSync(path, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const [id, phase] = l.split('\t');
    return [id, Number(phase)];
  }));
}

function checkLock(rows) {
  const ids = new Set(rows.map((r) => r.id));
  for (const id of readLock().keys()) if (!ids.has(id)) fail(`${id}: rows are never deleted (${LOCK}); mark it superseded instead`);
}

// ── evidence: cited tests must have passed ─────────────────────────────────────────────────────

function checkEvidence(rows) {
  const path = resolve(process.cwd(), EVIDENCE);
  if (!existsSync(path)) {
    fail(`--evidence ${EVIDENCE}: no such file (run the unit tests with tools/evidence-reporter.mjs first)`);
    return;
  }
  const passed = new Set(readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => {
    const { file, name } = JSON.parse(l);
    return `${file}#${name}`;
  }));
  if (passed.size < 50) fail(`--evidence ${EVIDENCE}: only ${passed.size} passing tests recorded; the run looks incomplete`);
  for (const r of rows) for (const t of r.tests ?? []) if (!passed.has(t)) fail(`${r.id}: cited test did not pass (or does not exist): ${t}`);
}

// ── generated files ────────────────────────────────────────────────────────────────────────────

function generate(meta, rows, lessons) {
  const lock = readLock();
  const files = {
    'scripts/lib/svg-profile-tables.mjs': profileTables(rows),
    'engine/policy/tables.ts': renderTables(rows),
    'engine/ledger/LEDGER.md': report(meta, rows, lessons, lock),
  };
  const added = rows.filter((r) => !lock.has(r.id));
  if (added.length) {
    if (WRITE) {
      const header = lock.size ? '' : '# Every id the support ledger has had, with the phase it was first given. Append-only:\n# ledger-check --write adds new ids; a row is never deleted (mark it superseded).\n';
      writeFileSync(resolve(ROOT, LOCK), (existsSync(resolve(ROOT, LOCK)) ? readFileSync(resolve(ROOT, LOCK), 'utf8') : header) + added.map((r) => `${r.id}\t${r.phase}\n`).join(''));
      console.log(`ledger-check: added ${added.length} id(s) to ${LOCK}`);
    } else fail(`${added.length} row id(s) are not in ${LOCK} (first: ${added[0].id}): run \`node tools/ledger-check.mjs --write\` in projects/draw`);
  }
  for (const [rel, text] of Object.entries(files)) {
    const path = resolve(ROOT, rel);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current === text) continue;
    if (WRITE) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      console.log(`ledger-check: wrote ${rel}`);
    } else fail(`${rel} is out of date with the ledger: run \`node tools/ledger-check.mjs --write\` in projects/draw`);
  }
}

const GENERATED = 'GENERATED from engine/ledger/ledger.json by projects/draw/tools/ledger-check.mjs --write.\n// Do not edit: change the ledger and regenerate. The build fails if this file drifts from it.';
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A JS array literal body of strings, wrapped at 100 columns. */
function list(items, indent = '  ') {
  const lines = [];
  let line = indent;
  for (const s of items.map((x) => `'${x}',`)) {
    if (line.length + s.length + 1 > 100 && line.trim()) {
      lines.push(line.trimEnd());
      line = indent;
    }
    line += `${s} `;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.join('\n');
}

const names = (rows, pred) => [...new Set(rows.filter(pred).map((r) => r.name))].sort(byText);

function profileTables(rows) {
  const served = (ns) => (r) => r.kind === 'element' && r.ns === ns && r.serve && r.name !== '*';
  const elements = names(rows, served('svg'));
  const smil = names(rows, (r) => served('svg')(r) && r.group === 'animation');
  const xhtml = names(rows, served('xhtml'));
  const metadata = [...new Set(rows.filter((r) => r.kind === 'namespace' && r.group === 'metadata' && r.serve).map((r) => r.uri))].sort(byText);
  // Base rows only: an active split row applies to elements that are themselves never served
  // (checkAttributes enforces that), so refusing its name everywhere would refuse good files.
  const activeAttrs = names(rows, (r) => r.kind === 'attribute' && !r.ns && !r.id.includes('@') && r.class === 'active' && /^[A-Za-z][\w-]*$/.test(r.name));
  return `// Allowlists for scripts/lib/svg-profile.mjs.
//
// ${GENERATED}

// SVG elements a served file may contain: every element row that is served.
export const ELEMENTS = new Set([
${list(elements)}
]);

// SMIL elements whose attributeName must not retarget href, style or a handler.
export const SMIL_ELEMENTS = new Set([
${list(smil)}
]);

// Inside <foreignObject> only: the XHTML elements that are served (text and layout).
export const XHTML_ELEMENTS = new Set([
${list(xhtml)}
]);

// Descriptive metadata namespaces, allowed only inside <metadata>.
export const METADATA_NS = new Set([
${list(metadata)}
]);

// Attributes with no namespace that are active and never served, beyond every on* handler and
// xml:base (which the profile refuses by rule).
export const ACTIVE_ATTRIBUTES = new Set([
${list(activeAttrs)}
]);
`;
}

function renderTables(rows) {
  const attrScopes = (ns) => {
    const ofNs = (r) => r.kind === 'attribute' && (r.ns ?? 'svg') === ns;
    const base = rows.filter((r) => ofNs(r) && !r.id.includes('@') && !isPattern(r.name)).sort((a, b) => byText(a.name, b.name));
    const splits = rows.filter((r) => ofNs(r) && r.id.includes('@'));
    const out = [];
    for (const r of base) {
      const own = splits.filter((s) => baseId(s) === r.id);
      const except = own.flatMap((s) => s.on);
      const renderedSplits = own.filter((s) => s.render).flatMap((s) => s.on);
      let on = r.render ? (r.on.includes('*') ? '*' : r.on.filter((e) => !except.includes(e))) : [];
      if (on !== '*') on = [...new Set([...on, ...renderedSplits])].sort(byText);
      const ex = on === '*' ? except.filter((e) => !renderedSplits.includes(e)).sort(byText) : [];
      const q = (xs) => `[${xs.map((e) => `'${e}'`).join(', ')}]`;
      if (on !== '*' && !on.length) continue;
      const line = `  ['${r.name}', { on: ${on === '*' ? "'*'" : q(on)}${ex.length ? `, except: ${q(ex)}` : ''} }],`;
      out.push(line.length <= 100 ? line : `  ['${r.name}', {\n    on: [\n${list(on, '      ')}\n    ],${ex.length ? `\n    except: ${q(ex)},` : ''}\n  }],`);
    }
    return out.join('\n');
  };
  const patterns = (ns) => rows.filter((r) => r.kind === 'attribute' && (r.ns ?? 'svg') === ns && isPattern(r.name) && r.render)
    .map((r) => `  /${RENDERABLE_PATTERNS[r.name]}/, // ${r.name}`).sort(byText).join('\n');
  const classes = rows.filter((r) => r.kind === 'element').map((r) => `  ['${r.ns}:${r.name}', '${r.class}'],`).sort(byText).join('\n');
  // Attribute classes: base rows as 'ns:name' (patterns included, e.g. 'svg:on*'), splits as
  // 'ns:name@element'. Namespace classes by URI ('*' = any other namespace).
  const attrClasses = rows.filter((r) => r.kind === 'attribute').flatMap((r) => {
    const key = `${r.ns ?? 'svg'}:${r.name}`;
    return r.id.includes('@') ? r.on.map((e) => `  ['${key}@${e}', '${r.class}'],`) : [`  ['${key}', '${r.class}'],`];
  }).sort(byText).join('\n');
  const nsClasses = rows.filter((r) => r.kind === 'namespace').map((r) => `  ['${r.uri}', '${r.class}'],`).sort(byText).join('\n');
  return `// What the canvas may materialize, and every element's class.
//
// ${GENERATED}

export type LedgerClass = 'edit' | 'preserve' | 'preserve-hidden' | 'active' | 'drop';

/** Where an attribute applies: every element ('*') or a list; \`except\` elements have their own row. */
export interface AttrScope {
  readonly on: '*' | readonly string[];
  readonly except?: readonly string[];
}

/** SVG elements the canvas may materialize, through the safe sink. */
export const RENDER_SVG_ELEMENTS: ReadonlySet<string> = new Set([
${list(names(rows, (r) => r.kind === 'element' && r.ns === 'svg' && r.render && r.name !== '*'))}
]);

/** XHTML elements the canvas may materialize inside <foreignObject>. */
export const RENDER_XHTML_ELEMENTS: ReadonlySet<string> = new Set([
${list(names(rows, (r) => r.kind === 'element' && r.ns === 'xhtml' && r.render && r.name !== '*'))}
]);

/** SVG attributes the canvas may materialize (XLink and XML ones as xlink:name and xml:name). */
export const RENDER_SVG_ATTRIBUTES: ReadonlyMap<string, AttrScope> = new Map<string, AttrScope>([
${attrScopes('svg')}
]);

/** No-namespace SVG attribute names the canvas may materialize on any element, by pattern. */
export const RENDER_SVG_ATTRIBUTE_PATTERNS: readonly RegExp[] = [
${patterns('svg')}
];

/** XHTML attributes the canvas may materialize inside <foreignObject>. */
export const RENDER_XHTML_ATTRIBUTES: ReadonlyMap<string, AttrScope> = new Map<string, AttrScope>([
${attrScopes('xhtml')}
]);

/** XHTML attribute names the canvas may materialize on any element inside <foreignObject>, by pattern. */
export const RENDER_XHTML_ATTRIBUTE_PATTERNS: readonly RegExp[] = [
${patterns('xhtml')}
];

/** Every classified element, as 'ns:name'. Fallbacks: 'svg:*', 'xhtml:*', 'mathml:*' and '*:*'. */
export const ELEMENT_CLASS: ReadonlyMap<string, LedgerClass> = new Map<string, LedgerClass>([
${classes}
]);

/**
 * Every classified attribute: 'svg:fill', 'svg:xlink:href', 'xhtml:src', patterns such as
 * 'svg:on*', 'svg:data-*' and 'svg:(other)', and per-element overrides as 'svg:type@script'.
 */
export const ATTRIBUTE_CLASS: ReadonlyMap<string, LedgerClass> = new Map<string, LedgerClass>([
${attrClasses}
]);

/** Every classified namespace by URI; '*' is any other namespace. */
export const NAMESPACE_CLASS: ReadonlyMap<string, LedgerClass> = new Map<string, LedgerClass>([
${nsClasses}
]);
`;
}

function report(meta, rows, lessons, lock) {
  const count = (xs, s) => xs.filter((r) => r.status === s).length;
  const statusCells = (xs) => STATUSES.map((s) => count(xs, s)).join(' | ');
  const head = (first) => [`| ${first} | Rows | ${STATUSES.join(' | ')} |`, `|---|---|${STATUSES.map(() => '---').join('|')}|`];
  const out = [];
  out.push('# Draw support ledger', '');
  out.push('GENERATED from `ledger.json` by `projects/draw/tools/ledger-check.mjs --write`. Do not edit.', '');
  const phase = meta.currentPhase === CLOSED ? '**closed**' : `**P${meta.currentPhase}**`;
  out.push(`Current phase: ${phase}. ${rows.length} rows: ${STATUSES.map((s) => `${count(rows, s)} ${s}`).join(', ')}.`, '');
  out.push('A row is `done` only when the tests it cites passed in the build. Raising the current phase is the phase exit: every row of an earlier phase must then be done or superseded. Rows are never deleted.', '');

  out.push('## By kind', '', ...head('Kind'));
  for (const k of KINDS) {
    const xs = rows.filter((r) => r.kind === k);
    out.push(`| ${k} | ${xs.length} | ${statusCells(xs)} |`);
  }

  out.push('', '## By phase', '', ...head('Phase'));
  for (let p = 0; p <= 8; p++) {
    const xs = rows.filter((r) => r.phase === p);
    out.push(`| P${p} | ${xs.length} | ${statusCells(xs)} |`);
  }

  out.push('', '## Import classes', '', '| Class | Elements | Attributes | Other |', '|---|---|---|---|');
  for (const c of CLASSES) {
    const xs = rows.filter((r) => r.class === c);
    const els = xs.filter((r) => r.kind === 'element').length;
    const attrs = xs.filter((r) => r.kind === 'attribute').length;
    out.push(`| ${c} | ${els} | ${attrs} | ${xs.length - els - attrs} |`);
  }

  out.push('', '## SVG Lab lessons', '', "Each lesson's capabilities and the phases that deliver them.", '');
  out.push('| Set | Lesson | Title | Phases | Capabilities | Done |', '|---|---|---|---|---|---|');
  for (const l of lessons) {
    const caps = rows.filter((r) => r.kind === 'capability' && r.lesson?.includes(l.id));
    const phases = [...new Set(caps.map((r) => r.phase))].sort((a, b) => a - b).map((p) => `P${p}`).join(', ');
    out.push(`| ${l.set || 'all'} | ${l.tab} | ${l.title} | ${phases} | ${caps.length} | ${count(caps, 'done')} |`);
  }

  const partial = rows.filter((r) => r.status === 'partial');
  out.push('', '## Partial rows', '');
  if (!partial.length) out.push('None.');
  for (const r of partial) out.push(`- \`${r.id}\` (P${r.phase}): ${r.reason}`);

  const superseded = rows.filter((r) => r.status === 'superseded');
  out.push('', '## Superseded rows', '');
  if (!superseded.length) out.push('None.');
  for (const r of superseded) out.push(`- \`${r.id}\` (P${r.phase}) → ${r.supersededBy}`);

  const moved = rows.filter((r) => lock.has(r.id) && lock.get(r.id) !== r.phase);
  out.push('', '## Re-phased rows', '', 'Rows whose phase changed after they were first recorded in `ids.lock`.', '');
  if (!moved.length) out.push('None.');
  for (const r of moved) out.push(`- \`${r.id}\`: P${lock.get(r.id)} → P${r.phase}`);
  out.push('');
  return out.join('\n');
}

main();
