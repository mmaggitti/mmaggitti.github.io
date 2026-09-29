// Putting text on the clipboard: Copy in the code panel. Write only: Draw never reads the clipboard
// (a paste arrives as the paste event's own data, platform/files.ts), so no permission is asked for.
// The async Clipboard API needs a secure context and the tap's user activation; where it is missing
// or refuses, this says so (false) and the caller offers the text to select instead.

/** The part of `navigator` this uses (tests pass their own). */
export interface ClipboardHost {
  clipboard?: { writeText(text: string): Promise<void> };
}

/** Put `text` on the clipboard: true when it is there. Never throws. */
export async function writeClipboard(text: string, host: ClipboardHost | undefined = globalThis.navigator, secure = globalThis.isSecureContext !== false): Promise<boolean> {
  if (!secure || typeof host?.clipboard?.writeText !== 'function') return false;
  try {
    await host.clipboard.writeText(text);
    return true;
  } catch {
    return false; // blocked (no user activation, a permission policy): the caller shows the text instead
  }
}
