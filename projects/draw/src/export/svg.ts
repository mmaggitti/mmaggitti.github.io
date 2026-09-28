// What the Export sheet writes: the file's bytes and its name, computed synchronously (the share
// sheet must be asked for inside the tap that asked for it).
//
// - As-is: serialize(doc), every byte Draw didn't change kept, in the encoding the file came in
//   (what decodeSvg found, byte order included), so an unedited file exports byte for byte. A .svgz
//   exports as its plain .svg.
// - Clean: without editor data (engine/export/clean.ts), with what it removed.
// - Save to Files: the working copy. The plan gives it one <metadata> element for Draw's own state
//   (guides, locks, generator inputs), and P0 has none to carry, so it is the as-is file for now.

import { serialize, type Doc } from '../../../../engine/model/doc.ts';
import { cleanExport } from '../../../../engine/export/clean.ts';
import { encodeSvg } from '../platform/files.ts';

export type ExportKind = 'as-is' | 'clean' | 'working';

export interface ExportFile {
  kind: ExportKind;
  fileName: string;
  bytes: Uint8Array;
  encoding: string;
  /** The encoding the file declared, when it couldn't hold its text: it was written as UTF-8. */
  relabeled: string | null;
  /** What Clean removed (null for the other kinds). */
  removed: { elements: number; attributes: number } | null;
}

/**
 * A file name from a drawing's name: no path separators or characters iOS and Windows refuse, and
 * no format characters (a bidi override would show one name and save another).
 */
export function fileNameFor(name: string, suffix = ''): string {
  const safe = name.replace(/\p{Cf}/gu, '').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '-').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 80);
  return `${safe || 'drawing'}${suffix}.svg`;
}

/** `read`: the encoding the file's bytes came in (decodeSvg's), or undefined for text that came as text. */
export function exportFile(doc: Doc, name: string, kind: ExportKind, read?: string): ExportFile {
  const clean = kind === 'clean' ? cleanExport(doc) : null;
  const { bytes, encoding, relabeled } = encodeSvg(clean ? clean.text : serialize(doc), read);
  return {
    kind,
    fileName: fileNameFor(name, kind === 'clean' ? '-clean' : ''),
    bytes,
    encoding,
    relabeled,
    removed: clean ? { elements: clean.removedElements, attributes: clean.removedAttributes } : null,
  };
}
