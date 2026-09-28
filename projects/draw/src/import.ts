// The importer: every way a document opens goes through importSvg (the file picker, a paste, a
// drop, an #import link, a draft, New and the sample), so nothing skips the engine's parser or
// the render sink (the plan's "one importer"). A file → readFile → bytes → decodeSvg (gzip,
// encodings) → parseDoc → editor.open(doc) → the import report. A file that fails anywhere before the editor opens it
// opens nowhere: the result says why and where, and the drawing that was open stays.
//
// It holds no state and touches no DOM, so node's test runner drives it with a real Editor over
// fake views (test/unit/import.test.ts).

import { el, NS, parseDoc, textContent, type Doc } from '../../../engine/model/doc.ts';
import { importReport, type ImportReport } from '../../../engine/report/import-report.ts';
import { decodeSvg, FileTooLargeError, readFile } from './platform/files.ts';
import { lineColumn, type OpenResult } from './editor.ts';

export type Via = 'file' | 'paste' | 'drop' | 'link' | 'draft' | 'new' | 'sample';

export interface ImportInput {
  via: Via;
  /** The file's name ('logo.svg'), a draft's name, or '' (a paste, a link). */
  name: string;
  /** A picked or dropped file, read here (a read that fails, or a file too large to read, is a failure like any other). */
  file?: Blob;
  bytes?: Uint8Array;
  text?: string;
}

export interface Opened {
  ok: true;
  via: Via;
  name: string; // the drawing's name: the file's without .svg or .svgz, its <title>, or a default
  doc: Doc;
  text: string;
  /** The encoding its bytes were decoded from (export writes it back so), or null when it came as text. */
  encoding: string | null;
  gzip: boolean;
  /** Some bytes were not valid in that encoding (they became U+FFFD): the report says so. */
  lossy: boolean;
  report: ImportReport;
  stats: OpenResult;
  /** The editor took the document but the canvas can't draw it (it refused the root): why. */
  problem: string | null;
}

export interface ImportFailure {
  ok: false;
  via: Via;
  name: string;
  message: string;
  /** Where in the text it failed (1-based), when the text was read at all. */
  line: number | null;
  column: number | null;
  /** The failing line, cut to about 80 characters around the column, and where in it the column is. */
  excerpt: { text: string; at: number } | null;
}

export type ImportResult = Opened | ImportFailure;

/** What the importer opens documents in: the Editor. */
export interface OpenTarget {
  open(doc: Doc): OpenResult;
  readonly doc: Doc | null;
}

/** An error's message for a parenthesis in a sentence: without its own closing period. */
export const why = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/\.+$/, '');

const DEFAULT_NAME: Record<Via, string> = {
  file: 'Untitled',
  paste: 'Pasted drawing',
  drop: 'Dropped drawing',
  link: 'Linked drawing',
  draft: 'Untitled',
  new: 'Untitled',
  sample: 'Sample',
};
const MAX_NAME = 60;

// Format characters (bidi overrides and isolates, zero-width ones, the BOM) would let a file's name or
// <title> show one thing and save as another ("invoice\u202Egnp.svg" shows as "invoicegvs.png").
const FORMAT = /\p{Cf}/gu;

/** A drawing's name: the file's without its extension, else the root's <title>, else a default. */
export function drawingName(fileName: string, doc: Doc | null, via: Via): string {
  const base = fileName.replace(FORMAT, '').replace(/\.svgz?$/i, '').trim();
  if (base) return base.slice(0, MAX_NAME);
  if (doc) {
    const root = el(doc, doc.root);
    for (const id of root.children) {
      const n = doc.nodes.get(id);
      if (n?.kind === 'element' && n.ns === NS.svg && n.local === 'title') {
        const title = textContent(doc, id).replace(FORMAT, '').replace(/\s+/g, ' ').trim();
        if (title) return title.slice(0, MAX_NAME);
      }
    }
  }
  return DEFAULT_NAME[via];
}

function excerptAt(text: string, at: number): { text: string; at: number } {
  const start = Math.max(text.lastIndexOf('\n', at - 1) + 1, text.lastIndexOf('\r', at - 1) + 1, at - 40);
  const nl = text.slice(at).search(/[\r\n]/);
  const end = Math.min(nl === -1 ? text.length : at + nl, at + 40);
  return { text: text.slice(start, end), at: at - start };
}

function failed(input: ImportInput, message: string, text?: string, at?: number): ImportFailure {
  const fail: ImportFailure = { ok: false, via: input.via, name: drawingName(input.name, null, input.via), message, line: null, column: null, excerpt: null };
  if (text !== undefined && at !== undefined) {
    // A BOM is not a column: positions count from the first character after it.
    if (text.charCodeAt(0) === 0xfeff && at > 0) [text, at] = [text.slice(1), at - 1];
    Object.assign(fail, lineColumn(text, at), { excerpt: excerptAt(text, at) });
  }
  return fail;
}

/**
 * Open bytes or text in the editor. Resolves to what opened (with its import report) or to why it
 * didn't; it never throws for anything a file can hold. Text is opened before the first await, so
 * the sample opens synchronously on mount.
 */
export async function importSvg(target: OpenTarget, input: ImportInput): Promise<ImportResult> {
  let text = input.text;
  let encoding: string | null = null;
  let gzip = false;
  let lossy = false;
  if (text === undefined) {
    if (!input.bytes && !input.file) return failed(input, 'there was nothing to open');
    try {
      ({ text, encoding, gzip, lossy } = await decodeSvg(input.bytes ?? (await readFile(input.file!))));
    } catch (e) {
      if (e instanceof FileTooLargeError) return failed(input, e.message);
      return failed(input, `it could not be read (${why(e)})`);
    }
  }
  // Markup starts with "<" (after a BOM and blank space): anything else (a PNG, a text file) isn't one.
  if (!/^\uFEFF?\s*</.test(text)) return failed(input, 'this isn’t an SVG file');
  const parsed = parseDoc(text);
  if (!parsed.ok) return failed(input, parsed.error.message, text, parsed.error.at);
  const doc = parsed.doc;
  const root = el(doc, doc.root);
  if (root.ns !== NS.svg || root.local !== 'svg') {
    return failed(input, `the root element is <${root.qname}>, not an <svg> in the SVG namespace`, text, root.src?.tag.start ?? 0);
  }
  const stats = target.open(doc);
  // Refused before the editor took it (it threw while drawing): the open drawing stays.
  if (!stats.ok && target.doc !== doc) return failed(input, stats.error ?? 'the canvas could not draw it');
  const problem = stats.ok ? null : stats.error ?? 'the canvas could not draw it';
  const report = importReport(doc);
  if (lossy) report.notes.unshift(`Some bytes in the file aren’t valid ${encoding!.toUpperCase()}: they show as �, and an as-is export writes � there too.`);
  return { ok: true, via: input.via, name: drawingName(input.name, doc, input.via), doc, text, encoding, gzip, lossy, report, stats, problem };
}
