// The support ledger against what it generates. projects/draw/tools/ledger-check.mjs checks the
// ledger's schema, coverage, evidence and phase gate, and that the generated tables are current;
// these tests check that the tables and the served profile actually do what the rows promise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseDoc, descendants, NS, type ElementNode } from '../model/doc.ts';
import { RENDER_SVG_ATTRIBUTES, RENDER_SVG_ELEMENTS, RENDER_XHTML_ATTRIBUTES, RENDER_XHTML_ELEMENTS } from '../policy/tables.ts';
import { ACTIVE_ATTRIBUTES, ELEMENTS, XHTML_ELEMENTS } from '../../scripts/lib/svg-profile-tables.mjs';
import { checkSvg } from '../../scripts/lib/svg-profile.mjs';

interface Row {
  id: string;
  kind: string;
  name: string;
  ns?: string;
  class?: string;
  render?: boolean;
  serve?: boolean;
  status?: string;
}

const ledger: { meta: { currentPhase: number }; rows: Row[]; lessons: unknown[] } = JSON.parse(readFileSync(new URL('../ledger/ledger.json', import.meta.url), 'utf8'));
const svg = (body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${body}</svg>`;
const plain = (r: Row) => /^[A-Za-z][\w-]*$/.test(r.name); // not a pattern, not namespaced

test('ledger has meta, rows and lessons', () => {
  assert.ok(Number.isInteger(ledger.meta.currentPhase));
  assert.ok(ledger.meta.currentPhase >= 0 && ledger.meta.currentPhase <= 8);
  assert.ok(Array.isArray(ledger.rows));
  assert.ok(Array.isArray(ledger.lessons));
});

// Where the render tables let an attribute render: its scope ('*' or a list, minus `except`).
function rendersOn(map: ReadonlyMap<string, { on: '*' | readonly string[]; except?: readonly string[] }>, name: string, el: string): boolean {
  const s = map.get(name);
  if (!s) return false;
  return s.on === '*' ? !(s.except ?? []).includes(el) : s.on.includes(el);
}

test('hidden, active and dropped rows are never rendered, and active ones are never served', () => {
  const never = ledger.rows.filter((r) => r.class === 'preserve-hidden' || r.class === 'active' || r.class === 'drop');
  assert.ok(never.length > 100, 'the ledger lost its hidden and active rows');
  const svgElements = ledger.rows.filter((r) => r.kind === 'element' && r.ns === 'svg' && r.name !== '*').map((r) => r.name);
  for (const r of never) {
    if (r.kind === 'element' && r.ns === 'svg') assert.ok(!RENDER_SVG_ELEMENTS.has(r.name), `${r.id} is rendered`);
    if (r.kind === 'element' && r.ns === 'xhtml') assert.ok(!RENDER_XHTML_ELEMENTS.has(r.name), `${r.id} is rendered`);
    if (r.kind === 'attribute' && !/[*(]/.test(r.name)) {
      const on = (r as Row & { on: string[] }).on;
      const map = r.ns === 'xhtml' ? RENDER_XHTML_ATTRIBUTES : RENDER_SVG_ATTRIBUTES;
      for (const el of on.includes('*') ? svgElements : on) assert.ok(!rendersOn(map, r.name, el), `${r.id} is rendered on <${el}>`);
    }
  }
  for (const r of ledger.rows.filter((x) => x.class === 'active' || x.class === 'drop')) {
    if (r.kind === 'element' && r.ns === 'svg') assert.ok(!ELEMENTS.has(r.name), `${r.id} is served`);
    if (r.kind === 'element' && r.ns === 'xhtml') assert.ok(!XHTML_ELEMENTS.has(r.name), `${r.id} is served`);
    if (r.kind === 'attribute' && !r.ns && plain(r) && !r.id.includes('@')) assert.ok(ACTIVE_ATTRIBUTES.has(r.name), `${r.id} is not refused`);
  }
});

test('the served profile refuses every SVG element and attribute the ledger does not serve', () => {
  for (const r of ledger.rows) {
    if (r.kind === 'element' && r.ns === 'svg' && !r.serve) {
      assert.ok(checkSvg(svg(`<${r.name}/>`)).length > 0, `served profile accepts <${r.name}>`);
    }
    // Split rows are scoped to elements that are refused themselves (ledger-check enforces it).
    if (r.kind === 'attribute' && !r.ns && plain(r) && !r.id.includes('@') && (r.class === 'active' || r.class === 'drop')) {
      const rules = checkSvg(svg(`<g ${r.name}="x"/>`)).map((f: { rule: string }) => f.rule);
      assert.ok(rules.includes('active-attribute'), `served profile accepts ${r.name}=: [${rules.join(', ')}]`);
    }
  }
});

test('the served profile accepts every SVG element the ledger serves', () => {
  // Elements that are only valid inside another (stop, feFuncR, mpath…) are still well-formed on
  // their own; the profile checks what may appear, not the content model.
  for (const r of ledger.rows.filter((x) => x.kind === 'element' && x.ns === 'svg' && x.serve)) {
    assert.deepEqual(checkSvg(svg(`<${r.name}/>`)), [], `served profile refuses <${r.name}>`);
  }
});

test('every done preserve-hidden row occurs in the round-trip corpus', () => {
  // What the corpus holds, as 'ns:element' and 'element@attribute' (attributes by prefix:local for XLink and XML).
  const seen = new Set<string>();
  const dir = new URL('./fixtures/corpus/', import.meta.url);
  const prefix = (ns: string | null) => (ns === NS.xlink ? 'xlink:' : ns === NS.xml ? 'xml:' : '');
  for (const rel of readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.svg'))) {
    const r = parseDoc(readFileSync(new URL(rel, dir), 'utf8'));
    assert.ok(r.ok, rel);
    for (const n of descendants(r.doc, r.doc.root)) {
      if (n.kind !== 'element') continue;
      const el = n as ElementNode;
      const ns = el.ns === NS.svg ? 'svg' : el.ns === NS.xhtml ? 'xhtml' : 'other';
      seen.add(`${ns}:${el.local}`);
      for (const a of el.attrs) seen.add(`${ns}:${el.local}@${prefix(a.ns)}${a.local}`);
    }
  }
  const hidden = ledger.rows.filter((r) => r.class === 'preserve-hidden' && (r.status === 'done' || r.status === 'partial') && !/[*(]/.test(r.name));
  assert.ok(hidden.length > 100, 'the ledger lost its hidden rows');
  for (const r of hidden) {
    const ns = r.ns === 'xhtml' ? 'xhtml' : 'svg';
    if (r.kind === 'element') assert.ok(seen.has(`${ns}:${r.name}`), `${r.id}: <${r.name}> is not in the corpus`);
    if (r.kind === 'attribute') {
      const on = (r as Row & { on: string[] }).on;
      const found = [...seen].some((k) => k.startsWith(`${ns}:`) && k.endsWith(`@${r.name}`) && (on.includes('*') || on.includes(k.slice(ns.length + 1, k.indexOf('@')))));
      assert.ok(found, `${r.id}: ${r.name} is not in the corpus on ${on.join(', ')}`);
    }
  }
});

test('the served profile refuses every namespace the ledger does not serve', () => {
  const rows = ledger.rows.filter((r) => r.kind === 'namespace' && !r.serve && (r as Row & { uri: string }).uri !== '*');
  assert.ok(rows.length >= 10);
  for (const r of rows) {
    const uri = (r as Row & { uri: string }).uri;
    const el = checkSvg(svg(`<q:e xmlns:q="${uri}"/>`)).map((f: { rule: string }) => f.rule);
    const at = checkSvg(svg(`<g q:a="1" xmlns:q="${uri}"/>`)).map((f: { rule: string }) => f.rule);
    assert.ok(el.includes('foreign-element'), `${r.id}: an element is served`);
    assert.ok(at.includes('foreign-attribute'), `${r.id}: an attribute is served`);
  }
});

test('the served profile accepts every attribute the ledger serves, on every served element it applies to', () => {
  const served = new Set(ledger.rows.filter((r) => r.kind === 'element' && r.ns === 'svg' && r.serve && r.name !== '*').map((r) => r.name));
  const XL = ' xmlns:xlink="http://www.w3.org/1999/xlink"';
  let checked = 0;
  for (const r of ledger.rows) {
    if (r.kind !== 'attribute' || r.ns || !r.serve || /[*(]/.test(r.name)) continue;
    const on = (r as Row & { on: string[] }).on;
    const splits = ledger.rows.filter((s) => s.id.startsWith(`${r.id}@`)).flatMap((s) => (s as Row & { on: string[] }).on);
    const els = (on.includes('*') ? [...served] : on).filter((e) => served.has(e) && (r.id.includes('@') || !splits.includes(e)));
    const value = /(^|:)href$/.test(r.name) ? '#a' : 'x';
    for (const e of els) {
      const findings = checkSvg(svg(`<${e} ${r.name}="${value}"/>`, XL));
      assert.deepEqual(findings, [], `${r.id}: the profile refuses ${r.name} on <${e}>`);
      checked++;
    }
  }
  assert.ok(checked > 1000, `only ${checked} element/attribute pairs checked`);
});
