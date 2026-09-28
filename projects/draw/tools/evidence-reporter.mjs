// A node --test reporter for the ledger's evidence gate. It writes one JSON line per passing
// top-level test, with the file that declares it, so `ledger-check.mjs --evidence` can require
// every test a ledger row cites to have actually run and passed (not merely to exist as a string).
// Skipped and todo tests are not evidence.

import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export default async function* evidence(source) {
  for await (const event of source) {
    const d = event.data;
    if (event.type !== 'test:pass' || d.nesting !== 0 || d.skip || d.todo || !d.file) continue;
    if (d.details?.type === 'suite') continue;
    yield `${JSON.stringify({ file: relative(ROOT, d.file).split('\\').join('/'), name: d.name })}\n`;
  }
}
