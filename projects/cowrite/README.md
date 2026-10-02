# Co-write

A live document you share with a link. Everyone with the link edits at once, and each person's
writing is tinted in their color, with a switch to hide the tints. It's a Core & Seams app: the
document engine is [Automerge](https://github.com/automerge/automerge), compiled from its Rust
source into this app's core (Core & Seams ADR-014).

Status: a proof of concept, **unlisted** until it has been tried on two devices
([DEVICE-CHECKS.md](DEVICE-CHECKS.md)).

## How it works

- **Two Automerge documents per shared document.**
  - The **content** document holds the text, every inserted run marked with its author, and the
    authors' names and colors. It never leaves a device unencrypted.
  - The **envelope** document is an append-only list of opaque blobs. Each blob is a batch of one
    device's changes (sent about every 300 ms), encrypted with AES-GCM-256. Peers decrypt new blobs
    and apply them.
- **The relay** is Automerge's public one, `wss://sync.automerge.org` (`web/ports/relay.ts`,
  `RELAY_URL`). It stores and forwards the envelope. It sees the document ID, blob sizes, timing
  and connection IDs, but not the text, names or colors.
- **The link** is `…/cowrite/#d=<document id>&k=<key>`. The part after `#` never goes to any
  server.
- **Every device keeps a full copy** in its own storage (OPFS, or IndexedDB as the fallback), so
  documents open and edit offline. On each connect a device offers everything it holds, so a relay
  that lost the document is refilled by the next device to connect.
- **Both documents start from a fixed genesis change**, the same on every device, so a device can
  edit before it has heard from anyone.

```
crates/cowrite-core   Session: content + envelope, splice + author marks, batches, sync, view
crates/cowrite-wasm   the binding (a Doc handle, typed arrays and small JSON)
crates/cowrite-cli    `cowrite show <saved file>`: text, authors and runs of a saved document
web/core/editor.ts    a textarea over a mirror of tinted runs; local diffs, remote patches, caret mapping
web/core/app.ts       the controller: one queue per document for core calls, batching, saving
web/ports/relay.ts    the websocket client (protocol "1"), bs58check IDs; cbor.ts, seal.ts
```

## Tests

- `cargo test` (run by the build): merge, authorship through merges and reloads, UTF-16 offsets,
  strict batches, a wiped relay refilled, and no plaintext in the envelope.
- `test/e2e.mjs`, run by the site's smoke test against a stand-in relay (`test/relay.mjs`, the
  same Automerge, server side):
  - two people write in one document;
  - the tints land under the right letters (pixel comparison);
  - the caret holds still while others type;
  - the toggle;
  - reload while offline;
  - offline edits merge;
  - a wiped relay recovers;
  - no readable text, names or colors on the wire.
- `test/live-relay.mjs`: a manual run against the real relay.

## Limits of this slice

- **The public relay is for prototyping.** Before friends rely on it, move to an own relay that
  speaks the same protocol (change `RELAY_URL` and the CSP in `vite.config.ts`).
- **The relay is a convenience copy, not the source of truth.** A brand-new device opening the link
  right after the relay lost the document sees it empty until an existing device connects.
- **No compaction yet:** the envelope grows with every batch.
- **Access is the link.** Anyone with it can read and edit, and access can't be revoked short of
  making a new document.
- **No undo.** Native textarea undo is off, because it would replay stale text over other people's
  edits.
