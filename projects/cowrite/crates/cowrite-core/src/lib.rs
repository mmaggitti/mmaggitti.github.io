//! Co-write — the domain core.
//!
//! Pure Rust: no I/O, no platform code, no binding. The WASM binding (`cowrite-wasm`) and the CLI
//! (`cowrite-cli`) are thin consumers.
//!
//! A shared document is two Automerge documents (Core & Seams ADR-014):
//! - the **content** document: `text` (Automerge Text, every inserted run marked `author=<id>`)
//!   and `authors` (`id → {name, color}`). It never leaves the device in the clear.
//! - the **envelope** document: `blobs`, an append-only list of opaque bytes. Each blob is a batch
//!   of this device's content changes, encrypted by the host. The envelope is what the relay
//!   stores and syncs; it can't read a blob.
//!
//! Both documents start from a fixed genesis change (a fixed actor, time 0), so every device
//! creates byte-identical root objects and a device can edit before it has heard from anyone.

mod json;

use core::fmt;
use std::collections::HashSet;
use std::hash::{DefaultHasher, Hash, Hasher};

use automerge::marks::{ExpandMark, Mark};
use automerge::sync::{self, SyncDoc};
use automerge::transaction::{CommitOptions, Transactable};
use automerge::{
    ActorId, AutoCommit, AutomergeError, Change, ChangeHash, ObjId, ObjType, PatchAction, ReadDoc, ScalarValue, ScalarValueRef, ValueRef, ROOT,
};

/// The error every core operation returns: a stable machine-readable `kind` plus a message for
/// people. The binding passes both across as `{ kind, message }` (Core & Seams DOCTRINE §1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreError {
    pub kind: &'static str,
    pub message: String,
}

impl CoreError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}

impl From<AutomergeError> for CoreError {
    fn from(e: AutomergeError) -> Self {
        Self::new("automerge", e.to_string())
    }
}

/// The mark name that records who wrote a run of text.
pub const AUTHOR_MARK: &str = "author";
const GENESIS_ACTOR: [u8; 16] = [0; 16];
const FILE_MAGIC: &[u8; 4] = b"CW1\0";
const MAX_NAME: usize = 40;

/// One text edit, in UTF-16 code units: delete `delete` units at `index`, then insert `insert`.
/// Patches apply in order, each to the text the previous one left.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextPatch {
    pub index: usize,
    pub delete: usize,
    pub insert: String,
}

/// One run of text by one author, in UTF-16 code units, `start..end`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub author: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Author {
    pub id: String,
    pub name: String,
    pub color: String,
}

/// What the editor draws: the text, who wrote which runs, and who the authors are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct View {
    pub text: String,
    pub spans: Vec<Span>,
    pub authors: Vec<Author>,
}

/// One shared document on one device.
pub struct Session {
    content: AutoCommit,
    envelope: AutoCommit,
    relay: sync::State,
    text: ObjId,
    authors: ObjId,
    blobs: ObjId,
    /// Every actor this device has used for this document. A fresh actor per load (two tabs must
    /// never share one), so the batch filter has to know them all.
    mine: Vec<ActorId>,
    /// Content heads at the last batch: the device's own changes after these are unbatched.
    batched: Vec<ChangeHash>,
    /// Blobs already applied or appended, by hash of their bytes (each blob has a random IV).
    seen: HashSet<u64>,
}

fn blob_key(bytes: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    h.finish()
}

fn actor(bytes: &[u8]) -> Result<ActorId, CoreError> {
    if bytes.len() != 16 || bytes == GENESIS_ACTOR {
        return Err(CoreError::new("actor", "an actor is 16 random bytes"));
    }
    Ok(ActorId::from(bytes))
}

fn genesis_content() -> Result<(AutoCommit, ObjId, ObjId), CoreError> {
    let mut doc = AutoCommit::new().with_actor(ActorId::from(GENESIS_ACTOR));
    let text = doc.put_object(ROOT, "text", ObjType::Text)?;
    let authors = doc.put_object(ROOT, "authors", ObjType::Map)?;
    doc.commit_with(CommitOptions::default().with_time(0));
    Ok((doc, text, authors))
}

fn genesis_envelope() -> Result<(AutoCommit, ObjId), CoreError> {
    let mut doc = AutoCommit::new().with_actor(ActorId::from(GENESIS_ACTOR));
    let blobs = doc.put_object(ROOT, "blobs", ObjType::List)?;
    doc.commit_with(CommitOptions::default().with_time(0));
    Ok((doc, blobs))
}

fn object(doc: &AutoCommit, key: &str, kind: ObjType) -> Result<ObjId, CoreError> {
    match doc.get(ROOT, key)? {
        Some((automerge::Value::Object(t), id)) if t == kind => Ok(id),
        _ => Err(CoreError::new("format", format!("the document has no {key} {kind:?}"))),
    }
}

/// UTF-16 length, the unit every index here uses (it matches JavaScript strings).
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], CoreError> {
        if self.0.len() < n {
            return Err(CoreError::new("format", "the saved document is truncated"));
        }
        let (head, rest) = self.0.split_at(n);
        self.0 = rest;
        Ok(head)
    }
    fn u32(&mut self) -> Result<usize, CoreError> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
    }
    fn chunk(&mut self) -> Result<&'a [u8], CoreError> {
        let n = self.u32()?;
        self.take(n)
    }
}

fn put_chunk(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

impl Session {
    /// A new, empty document, or the starting point for joining one: the genesis is the same on
    /// every device. `actor` is 16 random bytes from the host.
    pub fn new(actor_bytes: &[u8]) -> Result<Self, CoreError> {
        let me = actor(actor_bytes)?;
        let (mut content, text, authors) = genesis_content()?;
        let (mut envelope, blobs) = genesis_envelope()?;
        content.set_actor(me.clone());
        envelope.set_actor(me.clone());
        let batched = content.get_heads();
        Ok(Self { content, envelope, relay: sync::State::new(), text, authors, blobs, mine: vec![me], batched, seen: HashSet::new() })
    }

    /// Reopen a document saved by [`Session::save`], under a fresh actor.
    pub fn load(file: &[u8], actor_bytes: &[u8]) -> Result<Self, CoreError> {
        let me = actor(actor_bytes)?;
        let mut r = Reader(file);
        if r.take(4)? != FILE_MAGIC {
            return Err(CoreError::new("format", "not a Co-write document"));
        }
        let mut content = AutoCommit::load(r.chunk()?)?;
        let mut envelope = AutoCommit::load(r.chunk()?)?;
        let mut mine = Vec::new();
        for _ in 0..r.u32()? {
            mine.push(ActorId::from(r.take(16)?));
        }
        let mut batched = Vec::new();
        for _ in 0..r.u32()? {
            batched.push(ChangeHash::try_from(r.take(32)?).map_err(|e| CoreError::new("format", e.to_string()))?);
        }
        let text = object(&content, "text", ObjType::Text)?;
        let authors = object(&content, "authors", ObjType::Map)?;
        let blobs = object(&envelope, "blobs", ObjType::List)?;
        content.set_actor(me.clone());
        envelope.set_actor(me.clone());
        mine.push(me);
        // Content and envelope are saved together, so every blob in the envelope is already in
        // the content (or was undecryptable): none needs applying again.
        let seen = Self::blob_bytes(&envelope, &blobs).iter().map(|b| blob_key(b)).collect();
        Ok(Self { content, envelope, relay: sync::State::new(), text, authors, blobs, mine, batched, seen })
    }

    /// Both documents and the batch bookkeeping, in one buffer so one write keeps them consistent.
    pub fn save(&mut self) -> Vec<u8> {
        let mut out = FILE_MAGIC.to_vec();
        put_chunk(&mut out, &self.content.save());
        put_chunk(&mut out, &self.envelope.save());
        out.extend_from_slice(&(self.mine.len() as u32).to_le_bytes());
        for a in &self.mine {
            out.extend_from_slice(a.to_bytes());
        }
        out.extend_from_slice(&(self.batched.len() as u32).to_le_bytes());
        for h in &self.batched {
            out.extend_from_slice(&h.0);
        }
        out
    }

    /// Replace `delete` UTF-16 units at `index` with `insert`, marking the inserted run as `author`'s.
    pub fn splice(&mut self, index: usize, delete: usize, insert: &str, author: &str) -> Result<(), CoreError> {
        let len = self.content.length(&self.text);
        if index > len || delete > len - index {
            return Err(CoreError::new("range", format!("splice {index}+{delete} is outside the text ({len})")));
        }
        let del = isize::try_from(delete).map_err(|_| CoreError::new("range", "delete is too large"))?;
        self.content.splice_text(&self.text, index, del, insert)?;
        let n = utf16_len(insert);
        if n > 0 {
            let mark = Mark::new(AUTHOR_MARK.to_owned(), author, index, index + n);
            self.content.mark(&self.text, mark, ExpandMark::None)?;
        }
        self.content.commit();
        Ok(())
    }

    /// Record (or update) an author's name and color. Writes nothing when they are unchanged.
    pub fn set_author(&mut self, id: &str, name: &str, color: &str) -> Result<(), CoreError> {
        let name: String = name.trim().chars().take(MAX_NAME).collect();
        if id.is_empty() || name.is_empty() {
            return Err(CoreError::new("author", "an author needs an id and a name"));
        }
        if !(color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit())) {
            return Err(CoreError::new("author", "a color is #rrggbb"));
        }
        if self.authors().iter().any(|a| a.id == id && a.name == name && a.color == color) {
            return Ok(());
        }
        let entry = self.content.put_object(&self.authors, id, ObjType::Map)?;
        self.content.put(&entry, "name", name)?;
        self.content.put(&entry, "color", color)?;
        self.content.commit();
        Ok(())
    }

    /// This device's content changes since the last batch, as one buffer for the host to encrypt
    /// and hand back to [`Session::append_blob`]: each change length-prefixed, so a reader can
    /// refuse a batch that isn't one (Automerge's own incremental load skips what it can't parse).
    /// Empty when there is nothing new.
    pub fn take_local_batch(&mut self) -> Vec<u8> {
        let changes = self.content.get_changes(&self.batched);
        let mut out = Vec::new();
        for c in &changes {
            if self.mine.contains(c.actor_id()) {
                put_chunk(&mut out, c.raw_bytes());
            }
        }
        self.batched = self.content.get_heads();
        out
    }

    /// Append an encrypted batch to the envelope.
    pub fn append_blob(&mut self, blob: &[u8]) -> Result<(), CoreError> {
        let end = self.envelope.length(&self.blobs);
        self.envelope.insert(&self.blobs, end, ScalarValue::Bytes(blob.to_vec()))?;
        self.envelope.commit();
        self.seen.insert(blob_key(blob));
        Ok(())
    }

    fn blob_bytes(envelope: &AutoCommit, blobs: &ObjId) -> Vec<Vec<u8>> {
        envelope
            .list_range(blobs, ..)
            .filter_map(|item| match item.value {
                ValueRef::Scalar(ScalarValueRef::Bytes(b)) => Some(b.into_owned()),
                _ => None,
            })
            .collect()
    }

    /// Blobs in the envelope not yet applied here, in list order. Each is returned once.
    pub fn take_new_blobs(&mut self) -> Vec<Vec<u8>> {
        let mut fresh = Vec::new();
        for b in Self::blob_bytes(&self.envelope, &self.blobs) {
            if self.seen.insert(blob_key(&b)) {
                fresh.push(b);
            }
        }
        fresh
    }

    /// Apply a decrypted batch of someone's content changes. Returns the text edits it made, so
    /// the host can move its caret and any typing still in flight.
    pub fn apply_batch(&mut self, plain: &[u8]) -> Result<Vec<TextPatch>, CoreError> {
        let mut r = Reader(plain);
        let mut changes = Vec::new();
        while !r.0.is_empty() {
            let bytes = r.chunk().map_err(|_| CoreError::new("batch", "not a Co-write batch"))?;
            changes.push(Change::from_bytes(bytes.to_vec()).map_err(|e| CoreError::new("batch", e.to_string()))?);
        }
        if changes.is_empty() {
            return Err(CoreError::new("batch", "an empty batch"));
        }
        let before = self.content.get_heads();
        self.content.apply_changes(changes)?;
        let after = self.content.get_heads();
        let mut out = Vec::new();
        for p in self.content.diff(&before, &after) {
            if p.obj != self.text {
                continue;
            }
            match p.action {
                PatchAction::SpliceText { index, value, .. } => out.push(TextPatch { index, delete: 0, insert: value.make_string() }),
                PatchAction::DeleteSeq { index, length } => out.push(TextPatch { index, delete: length, insert: String::new() }),
                _ => {}
            }
        }
        Ok(out)
    }

    /// Forget what the relay was believed to hold: call on every new connection.
    pub fn relay_reset(&mut self) {
        self.relay = sync::State::new();
    }

    /// The next sync message for the relay, if the envelope has anything to say.
    pub fn relay_message(&mut self) -> Option<Vec<u8>> {
        self.envelope.sync().generate_sync_message(&mut self.relay).map(|m| m.encode())
    }

    /// Take in a sync message from the relay. New blobs are then available from
    /// [`Session::take_new_blobs`].
    pub fn receive_relay(&mut self, message: &[u8]) -> Result<(), CoreError> {
        let msg = sync::Message::decode(message).map_err(|e| CoreError::new("sync", e.to_string()))?;
        self.envelope.sync().receive_sync_message(&mut self.relay, msg)?;
        Ok(())
    }

    /// The authors recorded in the document, sorted by id.
    pub fn authors(&self) -> Vec<Author> {
        let mut out: Vec<Author> = self
            .content
            .map_range(&self.authors, ..)
            .filter_map(|item| {
                let entry = item.id();
                let field = |k: &str| match self.content.get(&entry, k) {
                    Ok(Some((automerge::Value::Scalar(s), _))) => s.as_str().map(str::to_owned),
                    _ => None,
                };
                Some(Author { id: item.key.to_string(), name: field("name")?, color: field("color")? })
            })
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    pub fn view(&self) -> Result<View, CoreError> {
        let text = self.content.text(&self.text)?;
        let spans = self
            .content
            .marks(&self.text)?
            .into_iter()
            .filter(|m| m.name == AUTHOR_MARK && m.end > m.start)
            .filter_map(|m| m.value.as_str().map(|a| Span { start: m.start, end: m.end, author: a.to_owned() }))
            .collect();
        Ok(View { text, spans, authors: self.authors() })
    }

    /// The view as a small JSON document for the binding: `{ text, spans: [[start, end, author]], authors: [[id, name, color]] }`.
    pub fn view_json(&self) -> Result<String, CoreError> {
        Ok(json::view(&self.view()?))
    }

    /// Text patches as JSON for the binding: `[[index, delete, insert], …]`.
    pub fn patches_json(patches: &[TextPatch]) -> String {
        json::patches(patches)
    }
}

#[cfg(test)]
mod tests;
