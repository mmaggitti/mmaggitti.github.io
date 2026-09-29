// The viewer's own choices, kept in this browser (localStorage, keys prefixed "draw:"): the code's
// tidy view and the theme. Conveniences only: storage can be missing or refuse (a private window,
// cleared site data), and then every read is the default and every write a quiet no-op.

export type Pref = 'tidy' | 'theme';

export function readPref(name: Pref): string | null {
  try {
    return localStorage.getItem(`draw:${name}`);
  } catch {
    return null;
  }
}

export function writePref(name: Pref, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(`draw:${name}`);
    else localStorage.setItem(`draw:${name}`, value);
  } catch {
    // not kept: the choice lasts until the page reloads
  }
}
