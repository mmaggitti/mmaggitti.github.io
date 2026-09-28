import type { Bytes } from '../worker/protocol';

// The files seam (Core & Seams SEAMS.md). The web has no open-in-place on iPhone: import through a
// file input, export through the share sheet (Web Share with files) or a download (DOCTRINE §5).

export interface PickedFile {
  name: string;
  type: string;
  bytes: Bytes;
}

/**
 * Ask the user for files. Resolves to [] if they cancel.
 *
 * `accept` filters what the picker offers. On iOS it only matches file types the system knows: a
 * format with no registered type (`.jsonl`, most custom extensions) is greyed out in Files even
 * when its extension is listed. For such formats leave `accept` empty and validate the contents.
 */
export function pick(accept = '', multiple = false): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', async () => {
      const files = [...(input.files ?? [])];
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    });
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/**
 * Hand bytes to the user as a file: the share sheet where the device offers one for files (so it
 * can go to Files or iCloud Drive), a download otherwise. Resolves to how it was delivered.
 */
export async function save(name: string, bytes: Bytes, type = 'application/octet-stream'): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([bytes], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
      // Share failed for another reason (e.g. no user gesture left): fall back to a download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
