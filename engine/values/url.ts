// URL pieces the engine reads out of attribute values.

/**
 * Percent-decode a fragment the way browsers match it to an id: url(#a%20b) is id "a b" and
 * %C3%A9 is "é". A malformed escape, or a run that is not UTF-8, stays as written.
 */
export function decodeFragment(f: string): string {
  return f.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}
