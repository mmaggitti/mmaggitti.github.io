// Getting a file out: the share sheet where the browser can share files (Safari on the phone and
// iPad: Save to Files, AirDrop, Messages), otherwise a download. The file never leaves the device
// through Draw itself. The download link is one the React panel renders (<a hidden>), so this module
// creates no DOM (tools/check-sinks.mjs).
//
// Several files at once (P1-M5: Finish's PNGs): the files are made before the tap, and shareFiles
// asks for the share sheet before anything is awaited, since WebKit's Navigator::share consumes the
// tap's activation (which lasts 5 s) and refuses without it. One tap shares once. Where the browser
// can't share files, the sheet offers each file's download, one tap each (downloadFile).

export type Outcome = 'shared' | 'downloaded' | 'cancelled';

export async function shareOrDownload(link: HTMLAnchorElement, name: string, data: string | Blob, type = 'image/svg+xml'): Promise<Outcome> {
  const file = new File([data], name, { type });
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav?.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // NotAllowedError (no user activation) and friends: fall back to a download
    }
  }
  download(link, file);
  return 'downloaded';
}

/** Whether the browser's share sheet takes these files (nothing is read or shared). */
export function canShareFiles(files: readonly File[]): boolean {
  const nav = globalThis.navigator as Navigator | undefined;
  try {
    return !!nav?.canShare?.({ files: [...files] });
  } catch {
    return false;
  }
}

/**
 * Share several files in one share sheet, inside the tap: navigator.share is called first, with
 * nothing awaited before it. 'shared'; 'cancelled' (the sheet was closed); or 'unshared' (no file
 * sharing here, or it failed): the caller then offers each file's download.
 */
export async function shareFiles(files: readonly File[]): Promise<'shared' | 'cancelled' | 'unshared'> {
  const nav = globalThis.navigator as Navigator | undefined;
  const data = { files: [...files] };
  let asked: Promise<void>;
  try {
    if (!nav?.canShare?.(data)) return 'unshared';
    asked = nav.share(data);
  } catch {
    return 'unshared';
  }
  try {
    await asked;
    return 'shared';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    return 'unshared';
  }
}

/** Download one file through the panel's hidden link (one tap, one file). */
export function downloadFile(link: HTMLAnchorElement, file: File): 'downloaded' {
  download(link, file);
  return 'downloaded';
}

function download(link: HTMLAnchorElement, file: File): void {
  const url = URL.createObjectURL(file);
  link.href = url;
  link.download = file.name;
  link.rel = 'noopener';
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.removeAttribute('href');
  }, 30_000);
}
