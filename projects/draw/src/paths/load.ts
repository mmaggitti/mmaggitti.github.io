// The boolean libraries' chunks (P1-M3 S3): the only import() of src/paths/booleans.ts and
// src/paths/paper-fallback.ts, so a static import of this module keeps both lazy (Vite makes each a
// chunk of its own, named after its file, in neither index.html's scripts nor its preloads). A load
// that fails is forgotten, so the next boolean tries again (the Support tab's ledger is the pattern).

import type { Combine, Libraries } from './pipeline.ts';

let primary: Promise<Combine> | null = null;
let fallback: Promise<Combine> | null = null;

export const loadBooleans = (): Promise<Combine> =>
  (primary ??= import('./booleans.ts').then((m) => m.combine).catch((e) => {
    primary = null; // a later boolean tries again
    throw e;
  }));

export const loadPaperFallback = (): Promise<Combine> =>
  (fallback ??= import('./paper-fallback.ts').then((m) => m.combine).catch((e) => {
    fallback = null;
    throw e;
  }));

/** The libraries as the app loads them. */
export const LAZY_LIBRARIES: Libraries = { primary: loadBooleans, fallback: loadPaperFallback };
