//! Flashcards — the domain core.
//!
//! Pure Rust: no I/O, no platform code, no binding. The WASM binding (`srs-wasm`) and the CLI
//! (`srs-cli`) are thin consumers.
//!
//! - [`fsrs`]: the FSRS-6 memory model (stability, difficulty, retrievability), ported from
//!   fsrs-rs and held to its values by `tests/fsrs.rs`.
//! - [`plan`]: memory states replayed from the review log, and the session ranker.
//!
//! The review log is the truth; every state here is derived from it and can be recomputed at any
//! time (the spec's interpretability rule). Card text never reaches the core: the web side parses
//! the JSONL files and hands over numbers.

use core::fmt;

pub mod fsrs;
pub mod plan;

/// The error every core operation returns: a stable machine-readable `kind` plus a message for
/// people. The binding passes both across as `{ kind, message }` (Core & Seams DOCTRINE §1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreError {
    pub kind: &'static str,
    pub message: String,
}

impl CoreError {
    pub(crate) fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}
