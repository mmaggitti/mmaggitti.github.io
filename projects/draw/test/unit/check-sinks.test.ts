// The sink ban (tools/check-sinks.mjs), run as the build runs it, on planted files: a copy of the
// script in a temporary tree shaped like the repo scans that tree, so each rule is seen failing on
// the kind of line it bans, in the files it bans it from, and passing where it is allowed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../tools/check-sinks.mjs', import.meta.url));
// Spelled in two parts so this file never holds the keyword the site's own gate refuses under /draw/.
const SAME_ORIGIN = 'allow-' + 'same-origin';

/** Plants `files` (repo-relative path → text) around a copy of the script, runs it, and cleans up. */
function sinks(files: Record<string, string>): { code: number; findings: string[]; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'draw-sinks-'));
  try {
    const plant = (rel: string, text: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    mkdirSync(join(root, 'projects/draw/tools'), { recursive: true });
    copyFileSync(SCRIPT, join(root, 'projects/draw/tools/check-sinks.mjs'));
    plant('projects/draw/index.html', '<!doctype html><title>Draw</title>\n');
    for (const [rel, text] of Object.entries(files)) plant(rel, text);
    let code = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [join(root, 'projects/draw/tools/check-sinks.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      code = err.status;
      out = `${err.stdout}${err.stderr}`;
    }
    const findings = out.split('\n').map((l) => l.trim()).filter((l) => /^\S+:\d+\s+\S+$/.test(l)).map((l) => l.replace(/\s+/, ' '));
    return { code, findings: findings.sort(), out };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('check-sinks fails the build on planted HTML sinks, eval, srcdoc, a same-origin sandbox and DOM writes outside the sink, naming each file, line and rule', () => {
  const r = sinks({
    'projects/draw/src/panels/Leak.tsx': 'export const a = (el: HTMLElement, s: string) => {\n  el.innerHTML = s;\n};\n',
    'projects/draw/src/panels/Also.tsx': 'export const b = (el: Element, s: string) => el.insertAdjacentHTML("beforeend", s);\n',
    'projects/draw/src/run.ts': 'export const c = (s: string) => eval(s);\nexport const d = (s: string) => new Function(s);\nexport const e = () => setTimeout("go()", 1);\n',
    'projects/draw/src/frame.ts': `export const f = (fr: HTMLIFrameElement, s: string) => { fr.srcdoc = s; };\nexport const SANDBOX = 'allow-scripts ${SAME_ORIGIN}';\n`,
    'projects/draw/src/panels/Attrs.tsx': "export const g = (el: Element) => el.setAttribute('fill', 'red');\nexport const h = (d: Document) => d.createElementNS('http://www.w3.org/2000/svg', 'rect');\nexport const i = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml');\n",
    'projects/draw/src/panels/Text.tsx': "export const j = (d: Document) => d.createElement('span');\nexport const k = (el: Element) => { el.textContent = 'x'; };\n",
    'projects/draw/src/panels/Store.tsx': "export const l = () => localStorage.getItem('draw:x');\nexport const m = () => navigator.clipboard.readText();\nexport const n = () => fetch('/x');\n",
    'projects/draw/public/page.html': `<iframe sandbox="${SAME_ORIGIN}"></iframe>\n`,
    'engine/leak.ts': "export const o = () => document.title;\nimport x from 'left-pad';\nexport const p = (el: { innerHTML: string }) => { el.innerHTML = ''; };\n",
  });
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(r.findings, [
    'engine/leak.ts:1 engine-dom',
    'engine/leak.ts:2 engine-npm-import',
    'engine/leak.ts:3 html-sink',
    'projects/draw/public/page.html:1 allow-same-origin',
    'projects/draw/src/frame.ts:1 srcdoc',
    'projects/draw/src/frame.ts:2 allow-same-origin',
    'projects/draw/src/panels/Also.tsx:1 html-sink',
    'projects/draw/src/panels/Attrs.tsx:1 dom-write',
    'projects/draw/src/panels/Attrs.tsx:2 dom-write',
    'projects/draw/src/panels/Attrs.tsx:3 dom-write',
    'projects/draw/src/panels/Leak.tsx:2 html-sink',
    'projects/draw/src/panels/Store.tsx:1 storage',
    'projects/draw/src/panels/Store.tsx:2 file-api',
    'projects/draw/src/panels/Store.tsx:3 fetch',
    'projects/draw/src/panels/Text.tsx:1 dom-text',
    'projects/draw/src/panels/Text.tsx:2 dom-text',
    'projects/draw/src/run.ts:1 eval',
    'projects/draw/src/run.ts:2 eval',
    'projects/draw/src/run.ts:3 eval',
  ].sort());
});

test('check-sinks passes DOM writes in the sink, the overlay and the code view, platform APIs in platform/, and rules named only in comments', () => {
  const r = sinks({
    'projects/draw/src/canvas/safe-sink.ts': "export const a = (d: Document, el: Element) => { el.setAttribute('fill', 'red'); return d.createElementNS('http://www.w3.org/2000/svg', 'rect'); };\n",
    'projects/draw/src/canvas/overlay/index.ts': "export const b = (d: Document) => d.createElementNS('http://www.w3.org/2000/svg', 'path');\n",
    'projects/draw/src/codeview/code-view.ts': "export const c = (d: Document) => { const s = d.createElement('span'); s.textContent = '<svg>'; return s; };\n",
    'projects/draw/src/platform/prefs.ts': "export const d = () => localStorage.getItem('draw:theme');\nexport const e = (t: string) => navigator.clipboard.writeText(t);\n",
    'projects/draw/src/panels/Note.tsx': '// Never innerHTML, eval or a srcdoc here: the sink is the one writer.\n/* not el.innerHTML = s either */\nexport const f = 1;\n',
    'engine/model/ok.ts': "import { g } from './other.ts';\nexport const h = g;\n",
  });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.findings, []);
  assert.match(r.out, /check-sinks: clean/);
});

test('check-sinks allows DOM writes in the overlay folder only: a file beside it or a model outside it is flagged', () => {
  const make = "export const a = (d: Document) => d.createElementNS('http://www.w3.org/2000/svg', 'path');\n";
  const r = sinks({
    'projects/draw/src/canvas/overlay/marks.ts': make,
    'projects/draw/src/canvas/overlayish.ts': make,
    'projects/draw/src/interact/overlay-model.ts': make,
  });
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(r.findings, ['projects/draw/src/canvas/overlayish.ts:1 dom-write', 'projects/draw/src/interact/overlay-model.ts:1 dom-write']);
});

test('check-sinks keeps registering a font face to src/platform/ (P1-M4): new FontFace and document.fonts anywhere else are flagged; in platform/ they pass', () => {
  const r = sinks({
    'projects/draw/src/panels/Fonts.tsx': "export const a = (b: ArrayBuffer) => new FontFace('X', b);\nexport const c = () => document.fonts.ready;\n",
    'projects/draw/src/editor-fonts.ts': 'export const d = () => document.fonts.size;\n',
    'projects/draw/src/platform/fonts.ts': "export const e = (b: ArrayBuffer) => document.fonts.add(new FontFace('X', b));\n",
  });
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(r.findings, ['projects/draw/src/editor-fonts.ts:1 font-face', 'projects/draw/src/panels/Fonts.tsx:1 font-face', 'projects/draw/src/panels/Fonts.tsx:2 font-face']);
});

test('check-sinks bans the name FontFace in any spelling outside src/platform/, and the document’s fonts by a dot, by [\'fonts\'] or destructured: one finding per spelling; in platform/ they pass', () => {
  const spellings = [
    "export const a = (b: ArrayBuffer) => new globalThis.FontFace('X', b);",
    "export const b = (b: ArrayBuffer) => new window.FontFace('X', b);",
    "export const c = (b: ArrayBuffer) => new (window as any)['FontFace']('X', b);",
    "export const d = (f: unknown) => (document as any)['fonts'].add(f);",
    'const { fonts } = document;',
    "const FF = FontFace;",
    'export const g = (f: unknown) => self.document.fonts.add(f as never);',
    'export const h = () => document?.fonts.size;',
    'const { fonts: set } = window.document;',
  ];
  const text = spellings.join('\n') + '\n';
  const r = sinks({ 'projects/draw/src/panels/Sneaky.tsx': text, 'projects/draw/src/platform/fonts-too.ts': text });
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(r.findings, spellings.map((_, i) => `projects/draw/src/panels/Sneaky.tsx:${i + 1} font-face`).sort());
  const fine = sinks({ 'projects/draw/src/panels/Fine.tsx': "export type Choice = 'text' | 'paths' | 'fonts';\nexport const isSet = (font: object) => 'fonts' in font;\nexport const n = (f: { fonts: number }) => f.fonts;\n" });
  assert.equal(fine.code, 0, fine.out);
});

test('check-sinks keeps rasterizing to src/platform/ (P1-M5): new Image, new OffscreenCanvas, getContext, toBlob, convertToBlob and createImageBitmap anywhere else are flagged; in platform/ they pass', () => {
  const lines = [
    "export const a = () => new Image();",
    'export const b = (w: number, h: number) => new OffscreenCanvas(w, h);',
    "export const c = (cv: HTMLCanvasElement) => cv.getContext('2d');",
    'export const d = (cv: HTMLCanvasElement) => cv.toBlob(() => {});',
    "export const e = (cv: OffscreenCanvas) => cv.convertToBlob({ type: 'image/png' });",
    'export const f = (b: Blob) => createImageBitmap(b);',
  ];
  const text = lines.join('\n') + '\n';
  const r = sinks({ 'projects/draw/src/panels/Finish.tsx': text, 'projects/draw/src/export/png.ts': text, 'projects/draw/src/platform/raster.ts': text });
  assert.equal(r.code, 1, r.out);
  const want = (file: string) => lines.map((_, i) => `projects/draw/src/${file}:${i + 1} raster`);
  assert.deepEqual(r.findings, [...want('export/png.ts'), ...want('panels/Finish.tsx')].sort());
  const fine = sinks({ 'projects/draw/src/panels/Fine.tsx': "export type Kind = 'image' | 'canvas';\nexport const n = (x: { image: number }) => x.image;\nexport const m = (images: string[]) => images.length;\n" });
  assert.equal(fine.code, 0, fine.out);
});

test('check-sinks bans the raster names in any spelling outside src/platform/ (an alias, globalThis.…, [\'…\'], ?.(), and the read-back APIs): one finding per spelling; in platform/ they pass', () => {
  const spellings = [
    'export const a1 = () => new Image();',
    'export const a2 = () => new Image;',
    "export const a3 = () => new self['Image']();",
    'export const a4 = () => new globalThis.Image(1, 1);',
    'export const a5 = () => new globalThis.OffscreenCanvas(8, 8);',
    "export const a6 = () => new window['OffscreenCanvas'](8, 8);",
    'const OC = OffscreenCanvas; export const a7 = () => new OC(8, 8);',
    "export const a8 = (c: HTMLCanvasElement) => c['getContext']('2d');",
    "export const a9 = (c: HTMLCanvasElement) => c.getContext?.('2d');",
    'export const a10 = (c: HTMLCanvasElement) => c.toDataURL();',
    'export const a11 = (c: OffscreenCanvas) => c.transferToImageBitmap();',
    'export const a12 = (c: HTMLCanvasElement) => c.captureStream();',
    "export const a13 = (c: OffscreenCanvas) => c['convertToBlob']();",
    'export const a14 = (b: Blob) => globalThis.createImageBitmap?.(b);',
    "export const a15 = (b: Blob) => self['createImageBitmap'](b);",
    'export const a16 = (c: HTMLCanvasElement) => c.transferControlToOffscreen();',
    'export const a17 = (x: CanvasRenderingContext2D) => x.getImageData(0, 0, 1, 1);',
  ];
  const text = spellings.join('\n') + '\n';
  const r = sinks({ 'projects/draw/src/panels/Sneaky.tsx': text, 'projects/draw/src/platform/raster-too.ts': text });
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(r.findings, spellings.map((_, i) => `projects/draw/src/panels/Sneaky.tsx:${i + 1} raster`).sort());
  const fine = sinks({ 'projects/draw/src/panels/Fine.tsx': "export type Kind = 'image' | 'canvas';\nexport const n = (x: { image: number }) => x.image;\nexport const d = () => new ImageData(1, 1);\nexport const el = (i: HTMLImageElement) => i.naturalWidth;\n" });
  assert.equal(fine.code, 0, fine.out);
});

test('check-sinks keeps the share sheet, the clipboard, execCommand and the compression streams to src/platform/ in any spelling (?., [\'…\'], destructured): one finding per spelling; in platform/ they pass', () => {
  const spellings = [
    'export const s1 = () => navigator.share({ text: "x" });',
    'export const s2 = () => navigator?.share({ text: "x" });',
    "export const s3 = () => navigator['share']({ text: 'x' });",
    'export const s4 = () => globalThis.navigator.canShare({});',
    "export const s6 = () => (window.navigator as any)['canShare']({});",
    'export const k1 = () => navigator.clipboard.writeText("x");',
    "export const k2 = () => navigator['clipboard'].readText();",
    'export const k3 = () => navigator?.clipboard?.read();',
    'const { clipboard } = navigator; export const k4 = () => clipboard.read();',
    "export const k5 = (e: ClipboardEvent) => e.clipboardData?.getData('text');",
    "export const k6 = () => document.execCommand('copy');",
    "export const k7 = (e: ClipboardEvent) => e['clipboardData'];",
    'export const c1 = () => new CompressionStream("deflate-raw");',
    "export const c2 = () => new globalThis.DecompressionStream('deflate-raw');",
    "export const c3 = () => new (self as any)['CompressionStream']('gzip');",
  ];
  const text = spellings.join('\n') + '\n';
  const r = sinks({ 'projects/draw/src/panels/Sneaky.tsx': text, 'projects/draw/src/platform/files-too.ts': text });
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(r.findings, spellings.map((_, i) => `projects/draw/src/panels/Sneaky.tsx:${i + 1} file-api`).sort());
  const fine = sinks({ 'projects/draw/src/panels/Fine.tsx': "export const label = 'Share';\nexport const n = (o: { share: boolean }) => o.share;\nexport const m = (props: { share: () => void }) => { const { share } = props; return share; };\nexport const KINDS = ['share', 'download'];\n" });
  assert.equal(fine.code, 0, fine.out);
});
