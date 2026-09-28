// Getting a file out: the share sheet where the browser can share files (Safari on the phone and
// iPad: Save to Files, AirDrop, Messages), otherwise a download. The file never leaves the device
// through Draw itself. The download link is one the React panel renders (<a hidden>), so this module
// creates no DOM (tools/check-sinks.mjs).

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
