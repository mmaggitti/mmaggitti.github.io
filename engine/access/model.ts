// The accessibility model (P1-M4 S3): what the Access tab shows and writes, DOM-free. SVG Lab's
// Accessibility lesson (LabAccess) and its Create lesson's "Name it", generalized to any file.
//
// - accessOf(doc): the drawing's own: its first <title> and <desc> children, the root's role,
//   aria-labelledby, aria-describedby, aria-label, aria-hidden and other aria-* attributes, and its
//   language (lang, else xml:lang). Its Dublin Core items are metadata.ts's.
// - elementAccess(doc, id): an element's: its first child <title>, aria-label, role, aria-hidden, its
//   other aria-* attributes, and tabindex (kept, never focused on the canvas).
// - The planners write through `apply`, each one transaction (a switch) or one field session's frame:
//   - planDrawingTitle(doc, text | null): text writes the drawing's <title> (made when it has none:
//     <title id="drawing-title">…</title> as the root's first element child, SVG Lab's Create markup,
//     a fresh id when drawing-title is taken, and on the root role="img" and aria-labelledby="<its id>",
//     each only when the root has none of its own: never over the file's own aria-labelledby, nor
//     over a role other than img); null takes the <title> away (with its leading whitespace), the
//     aria-labelledby that names exactly its id, and role="img" (the file's or Draw's) when neither a
//     title, a description, an aria-label nor a reference is left to name the image (SVG Lab's root:
//     role with a title or a desc).
//   - planDrawingDesc(doc, text | null): the same with <desc id="drawing-desc"> after the title, and
//     aria-describedby.
//   - planLang(doc, value): the root's lang (or its xml:lang where it has only that); '' takes it
//     away; a value must read as a language tag (LANG_TAG).
//   - planElementTitle(doc, id, text | null): its first child <title> with this text (made when it
//     has none: <rect …/> becomes <rect …><title>…</title></rect>, SVG Lab's bar titles), or taken
//     away.
//   - planAria(doc, id, name, value | null) and planRole(doc, id, value | null): an attribute
//     written or taken away; a role only as ARIA role tokens (WAI-ARIA 1.2's and the graphics roles,
//     a space-separated fallback list allowed).
// A text is written escaped as P0's Text sheet escapes it (&, <, and > in ]]>); a character XML
// can't hold is refused (TokenEditError).

import { NS, attrValue, el, findAttr, textContent, type Doc, type ElementNode, type NodeId } from '../model/doc.ts';
import { opInsert, opRemove, opSetAttr, opSetLeafRaw, type Op } from '../commands/ops.ts';
import { insertMarkup, removeWithSpace, type Where } from '../model/space.ts';
import { parseFragment } from '../model/fragment.ts';
import { freshId } from '../model/ids.ts';
import { escape } from '../xml/entities.ts';
import { TokenEditError, xmlCharError } from '../code/edit.ts';

type Apply = (op: Op) => void;

/** SVG Lab's defaults: the Create lesson's "Name it" title, and the ids its lessons write. */
export const DEFAULT_TITLE = 'My drawing';
export const TITLE_ID = 'drawing-title';
export const DESC_ID = 'drawing-desc';
/** A language tag as the Access tab takes one (BCP 47's shape: en, fr-CA, zh-Hant-TW). */
export const LANG_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
export const NOT_A_TAG = 'That isn’t a language tag, like en or fr-CA.';

export interface TextItem {
  id: NodeId;
  text: string; // its characters, as a reader takes them (decoded, whitespace as written)
}
export interface AriaItem {
  name: string; // aria-…
  value: string;
}
export interface DrawingAccess {
  title: TextItem | null;
  desc: TextItem | null;
  role: string | null;
  labelledby: string | null;
  describedby: string | null;
  label: string | null; // aria-label
  hidden: boolean; // aria-hidden="true"
  aria: AriaItem[]; // the other aria-* attributes
  lang: { value: string; attr: 'lang' | 'xml:lang' } | null;
}
export interface ElementAccess {
  title: TextItem | null;
  label: string | null;
  role: string | null;
  hidden: boolean;
  aria: AriaItem[];
  tabindex: string | null;
}

const isSvg = (n: { kind: string; ns?: string | null; local?: string } | undefined, local: string) => n?.kind === 'element' && n.ns === NS.svg && n.local === local;
const SHOWN = new Set(['aria-labelledby', 'aria-describedby', 'aria-label', 'aria-hidden']);

/** The element's first child <title> (or <desc>), as SVG names an element by it. */
function childOf(doc: Doc, id: NodeId, local: 'title' | 'desc'): TextItem | null {
  for (const c of el(doc, id).children) {
    const n = doc.nodes.get(c);
    if (isSvg(n, local)) return { id: c, text: textContent(doc, c) };
  }
  return null;
}

// The element's own aria-* attributes, less the ones the tab shows by name.
function otherAria(n: ElementNode, doc: Doc, shown: ReadonlySet<string>): AriaItem[] {
  return n.attrs.filter((a) => a.ns === null && a.local.startsWith('aria-') && !shown.has(a.local)).map((a) => ({ name: a.local, value: attrValue(doc, n, null, a.local) ?? '' }));
}

/** The drawing's accessibility (the module header). */
export function accessOf(doc: Doc): DrawingAccess {
  const root = el(doc, doc.root);
  const lang = attrValue(doc, root, null, 'lang');
  const xmlLang = attrValue(doc, root, NS.xml, 'lang');
  return {
    title: childOf(doc, doc.root, 'title'),
    desc: childOf(doc, doc.root, 'desc'),
    role: attrValue(doc, root, null, 'role'),
    labelledby: attrValue(doc, root, null, 'aria-labelledby'),
    describedby: attrValue(doc, root, null, 'aria-describedby'),
    label: attrValue(doc, root, null, 'aria-label'),
    hidden: (attrValue(doc, root, null, 'aria-hidden') ?? '').trim() === 'true',
    aria: otherAria(root, doc, SHOWN),
    lang: lang !== null ? { value: lang, attr: 'lang' } : xmlLang !== null ? { value: xmlLang, attr: 'xml:lang' } : null,
  };
}

/** An element's accessibility (the module header). */
export function elementAccess(doc: Doc, id: NodeId): ElementAccess {
  const n = el(doc, id);
  return {
    title: childOf(doc, id, 'title'),
    label: attrValue(doc, n, null, 'aria-label'),
    role: attrValue(doc, n, null, 'role'),
    hidden: (attrValue(doc, n, null, 'aria-hidden') ?? '').trim() === 'true',
    aria: otherAria(n, doc, new Set(['aria-label', 'aria-hidden'])),
    tabindex: attrValue(doc, n, null, 'tabindex'),
  };
}

// ── writing ─────────────────────────────────────────────────────────────────────────────────────

/** A text as P0's Text sheet writes it, or why not. */
function escaped(text: string): string {
  const why = xmlCharError(text);
  if (why) throw new TokenEditError(why);
  return escape(text, null);
}

/** Make an element's content one text node holding `text` (its node kept and rewritten when it has exactly one). */
export function setText(doc: Doc, id: NodeId, text: string, apply: Apply): void {
  const raw = escaped(text);
  const kids = el(doc, id).children;
  const only = kids.length === 1 ? doc.nodes.get(kids[0]) : undefined;
  if (only?.kind === 'text') {
    if (only.raw !== raw) apply(opSetLeafRaw(doc, only.id, raw));
    return;
  }
  for (let i = kids.length - 1; i >= 0; i--) apply(opRemove(doc, kids[i]));
  if (!raw) return;
  const made = parseFragment(doc, id, raw);
  if (!made.ok) throw new TokenEditError(made.error.message);
  made.nodes.forEach((n, i) => apply(opInsert(doc, n, id, i)));
}

const blankText = (doc: Doc, id: NodeId) => {
  const n = doc.nodes.get(id);
  return n?.kind === 'text' && /^[ \t\r\n]*$/.test(n.raw);
};

/** Where a first child goes: before the first child that isn't whitespace (copying the whitespace before it), else last. */
function firstPlace(doc: Doc, id: NodeId): Where {
  const target = el(doc, id).children.find((c) => !blankText(doc, c));
  return target === undefined ? { last: id } : { before: target };
}

const tagOf = (doc: Doc, local: string) => {
  const p = el(doc, doc.root).prefix;
  return p ? `${p}:${local}` : local;
};
const idsIn = (value: string | null) => (value ?? '').trim().split(/\s+/).filter(Boolean);

// role="img" goes when nothing is left to name the image: no title, no description, no aria-label,
// and no reference of the file's own (one naming other elements still names it).
function dropImgRole(doc: Doc, apply: Apply): void {
  const a = accessOf(doc);
  if (a.role?.trim().toLowerCase() !== 'img' || a.title || a.desc || a.label !== null || a.labelledby !== null || a.describedby !== null) return;
  apply(opSetAttr(doc, doc.root, null, 'role', null));
}

// The drawing's <title> or <desc>: written (made, with the root's role and reference, when absent) or taken away.
function planNamer(doc: Doc, which: 'title' | 'desc', text: string | null, apply: Apply): void {
  const item = childOf(doc, doc.root, which);
  const ref = which === 'title' ? 'aria-labelledby' : 'aria-describedby';
  if (text === null) {
    if (!item) return;
    const own = attrValue(doc, el(doc, item.id), null, 'id');
    removeWithSpace(doc, item.id, apply);
    const names = attrValue(doc, el(doc, doc.root), null, ref);
    if (own !== null && names !== null && names.trim() === own) apply(opSetAttr(doc, doc.root, null, ref, null));
    dropImgRole(doc, apply);
    return;
  }
  if (item) return setText(doc, item.id, text, apply);
  const id = freshId(doc, which === 'title' ? TITLE_ID : DESC_ID);
  const markup = `<${tagOf(doc, which)} id="${id}">${escaped(text)}</${tagOf(doc, which)}>`;
  const title = which === 'desc' ? childOf(doc, doc.root, 'title') : null;
  insertMarkup(doc, title ? { after: title.id } : firstPlace(doc, doc.root), markup, apply);
  const root = el(doc, doc.root);
  if (findAttr(root, null, 'role') === undefined) apply(opSetAttr(doc, doc.root, null, 'role', 'img'));
  if (findAttr(root, null, ref) === undefined) apply(opSetAttr(doc, doc.root, null, ref, id));
}

/** The drawing's title (the module header): its text, or null to take it away. */
export function planDrawingTitle(doc: Doc, text: string | null, apply: Apply): void {
  planNamer(doc, 'title', text, apply);
}

/** The drawing's description (the module header): its text, or null to take it away. */
export function planDrawingDesc(doc: Doc, text: string | null, apply: Apply): void {
  planNamer(doc, 'desc', text, apply);
}

/** The drawing's language (the module header). */
export function planLang(doc: Doc, value: string, apply: Apply): void {
  const v = value.trim();
  if (v && !LANG_TAG.test(v)) throw new TokenEditError(NOT_A_TAG);
  const root = el(doc, doc.root);
  const has = findAttr(root, null, 'lang') !== undefined;
  const xml = !has && findAttr(root, NS.xml, 'lang') !== undefined;
  if (xml) {
    if (attrValue(doc, root, NS.xml, 'lang') !== (v || null)) apply(opSetAttr(doc, doc.root, NS.xml, 'lang', v || null));
    return;
  }
  if (attrValue(doc, root, null, 'lang') !== (v || null)) apply(opSetAttr(doc, doc.root, null, 'lang', v || null));
}

/** An element's own title (the module header): its text, or null to take it away. */
export function planElementTitle(doc: Doc, id: NodeId, text: string | null, apply: Apply): void {
  const item = childOf(doc, id, 'title');
  if (text === null) {
    if (item) removeWithSpace(doc, item.id, apply);
    return;
  }
  if (item) return setText(doc, item.id, text, apply);
  insertMarkup(doc, firstPlace(doc, id), `<${tagOf(doc, 'title')}>${escaped(text)}</${tagOf(doc, 'title')}>`, apply);
}

/** An aria-* attribute written, or taken away (null): a new one named aria- and lowercase letters, or one the element has. */
export function planAria(doc: Doc, id: NodeId, name: string, value: string | null, apply: Apply): void {
  if (!/^aria-[a-z]+$/.test(name) && !(name.startsWith('aria-') && findAttr(el(doc, id), null, name) !== undefined)) throw new TokenEditError(`${name} isn’t an aria- attribute`);
  if (value !== null) escaped(value);
  if (attrValue(doc, el(doc, id), null, name) !== value) apply(opSetAttr(doc, id, null, name, value));
  if (id === doc.root && name === 'aria-label' && value === null) dropImgRole(doc, apply);
}

/** WAI-ARIA 1.2's roles (its abstract roles aside), and the WAI-ARIA Graphics Module's three. */
export const ARIA_ROLES: ReadonlySet<string> = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption', 'cell', 'checkbox', 'code', 'columnheader',
  'combobox', 'complementary', 'contentinfo', 'definition', 'deletion', 'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure', 'form',
  'generic', 'grid', 'gridcell', 'group', 'heading', 'img', 'insertion', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math',
  'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'meter', 'navigation', 'none', 'note', 'option', 'paragraph', 'presentation',
  'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider',
  'spinbutton', 'status', 'strong', 'subscript', 'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer',
  'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem',
  'graphics-document', 'graphics-object', 'graphics-symbol',
]);
export const notARole = (token: string) => `“${token}” isn’t an ARIA role.`;

/** Why a Role value isn't one: each of its space-separated tokens (a role and its fallbacks) must be an ARIA role, in any case. */
export function roleError(value: string): string | null {
  const bad = value.trim().split(/\s+/).find((t) => t !== '' && !ARIA_ROLES.has(t.toLowerCase()));
  return bad === undefined ? null : notARole(bad);
}

/** A role written (only ARIA role tokens: roleError), or taken away (null or ''). */
export function planRole(doc: Doc, id: NodeId, value: string | null, apply: Apply): void {
  const v = value?.trim() || null;
  if (v !== null) {
    const why = roleError(v);
    if (why) throw new TokenEditError(why);
    escaped(v);
  }
  if (attrValue(doc, el(doc, id), null, 'role') !== v) apply(opSetAttr(doc, id, null, 'role', v));
}

/** The ids the root's aria-labelledby or aria-describedby names. */
export const namedIds = idsIn;
