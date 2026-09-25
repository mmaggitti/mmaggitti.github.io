// Read-only helpers over the framed document: what the tree shows, and what the inspector
// measures. The walk mirrors dom-hud's (element children, text, open shadow roots).
//
// Never `instanceof Element` here: framed nodes come from the iframe's realm, whose Element is a
// different constructor, so instanceof is false for all of them. Check nodeType instead.

export function isElement(node: Node | null | undefined): node is Element {
  return node?.nodeType === Node.ELEMENT_NODE;
}

export interface Row {
  node: Node;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

const MAX_CLASSES = 3;
const MAX_TEXT = 40;

/** Text that is only whitespace is layout noise in a tree; hide it. */
function isShown(node: Node): boolean {
  if (node.nodeType === Node.ELEMENT_NODE) return true;
  if (node.nodeType === Node.TEXT_NODE) return !!node.textContent?.trim();
  return false; // comments, processing instructions
}

/** The children the tree lists: elements, non-blank text, and an open shadow root first. */
export function children(node: Node): Node[] {
  const out: Node[] = [];
  const shadow = isElement(node) ? node.shadowRoot : null;
  if (shadow) out.push(shadow);
  for (const c of Array.from(node.childNodes)) if (isShown(c)) out.push(c);
  return out;
}

export function label(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    return `"${t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t}"`;
  }
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return '#shadow-root';
  if (!isElement(node)) return node.nodeName.toLowerCase();
  const el = node;
  let s = el.localName;
  if (el.id) s += `#${el.id}`;
  const cls = Array.from(el.classList);
  if (cls.length) s += `.${cls.slice(0, MAX_CLASSES).join('.')}${cls.length > MAX_CLASSES ? '…' : ''}`;
  return s;
}

/** Flatten the tree into the rows currently visible: only expanded nodes contribute children. */
export function visibleRows(root: Node, isExpanded: (n: Node) => boolean): Row[] {
  const rows: Row[] = [];
  const stack: Array<[Node, number]> = [[root, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    const kids = children(node);
    const expanded = kids.length > 0 && isExpanded(node);
    rows.push({ node, depth, hasChildren: kids.length > 0, expanded });
    if (expanded) for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], depth + 1]);
  }
  return rows;
}

/** Ancestors from the root element down to (and including) node, crossing shadow boundaries. */
export function ancestors(node: Node): Node[] {
  const path: Node[] = [];
  let n: Node | null = node;
  while (n && n.nodeType !== Node.DOCUMENT_NODE) {
    path.unshift(n);
    n = n.parentNode ?? (n.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? (n as ShadowRoot).host ?? null : null);
  }
  return path;
}

export interface Box {
  rect: DOMRect;
  margin: [number, number, number, number]; // top right bottom left
  border: [number, number, number, number];
  padding: [number, number, number, number];
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;

export function box(el: Element): Box | null {
  const win = el.ownerDocument.defaultView;
  if (!win) return null;
  const cs = win.getComputedStyle(el);
  const read = (prefix: string, suffix = '') =>
    SIDES.map((s) => parseFloat(cs.getPropertyValue(`${prefix}-${s.toLowerCase()}${suffix}`)) || 0) as Box['margin'];
  return {
    rect: el.getBoundingClientRect(),
    margin: read('margin'),
    border: read('border', '-width'),
    padding: read('padding'),
  };
}

/** The computed styles worth seeing first; flex and grid details only when they apply. */
export function keyStyles(el: Element): Array<[string, string]> {
  const win = el.ownerDocument.defaultView;
  if (!win) return [];
  const cs = win.getComputedStyle(el);
  const display = cs.display;
  const props = ['display', 'position', 'font-size', 'font-weight', 'line-height', 'color', 'background-color'];
  if (display.includes('flex')) props.push('flex-direction', 'justify-content', 'align-items', 'gap');
  if (display.includes('grid')) props.push('grid-template-columns', 'gap');
  if (cs.position !== 'static') props.push('top', 'right', 'bottom', 'left', 'z-index');
  return props.map((p) => [p, cs.getPropertyValue(p)]);
}

export function round(n: number): number {
  return Math.round(n * 10) / 10;
}
