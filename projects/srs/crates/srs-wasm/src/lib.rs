//! Flashcards — the WASM binding. Thin: typed arrays and small values in, typed arrays out; errors
//! as `{ kind, message }`. It runs in a module Worker (web/worker/core.worker.ts), never on the
//! main thread. With panic = "abort" a panic is a trap: the worker client re-instantiates the
//! module and reports `{ kind: "trap" }` (Core & Seams DOCTRINE §1).
//!
//! Card memories cross as a flat `Float64Array`, three numbers per card: stability, difficulty,
//! and the local day of the latest review; all three are NaN for a card never reviewed.

use srs_core::fsrs::{Fsrs, MemoryState};
use srs_core::plan::{self, CardMemory, SessionRules};
use wasm_bindgen::prelude::*;

/// The `{ kind, message }` error the web side mirrors as `CoreError` in web/worker/protocol.ts.
#[wasm_bindgen(getter_with_clone)]
pub struct Problem {
    pub kind: String,
    pub message: String,
}

impl From<srs_core::CoreError> for Problem {
    fn from(e: srs_core::CoreError) -> Self {
        Self { kind: e.kind.to_owned(), message: e.message }
    }
}

fn flatten(cards: &[Option<CardMemory>]) -> Vec<f64> {
    cards
        .iter()
        .flat_map(|m| match m {
            Some(m) => [m.state.stability, m.state.difficulty, m.last_day],
            None => [f64::NAN; 3],
        })
        .collect()
}

fn unflatten(flat: &[f64]) -> Result<Vec<Option<CardMemory>>, Problem> {
    let (triples, rest) = flat.as_chunks::<3>();
    if !rest.is_empty() {
        return Err(Problem { kind: "input".into(), message: "memories come in threes: stability, difficulty, day".into() });
    }
    Ok(triples
        .iter()
        .map(|&[stability, difficulty, last_day]| stability.is_finite().then_some(CardMemory { state: MemoryState { stability, difficulty }, last_day }))
        .collect())
}

/// Replay the review log (in time order) into one memory per card.
#[wasm_bindgen]
pub fn memories(card_count: u32, card: &[u32], day: &[f64], rating: &[u8]) -> Result<Vec<f64>, Problem> {
    Ok(flatten(&plan::memories(&Fsrs::default(), card_count as usize, card, day, rating)?))
}

/// Each card's retrievability at local day `now`; NaN for cards never reviewed.
#[wasm_bindgen]
pub fn retrievabilities(memories: &[f64], now: f64) -> Result<Vec<f64>, Problem> {
    Ok(plan::retrievabilities(&Fsrs::default(), &unflatten(memories)?, now).into_iter().map(|r| r.unwrap_or(f64::NAN)).collect())
}

/// The cards for a session, in order.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn plan(memories: &[f64], now: f64, target: f64, budget_secs: f64, secs_per_review: f64, secs_per_new: f64, max_new: u32) -> Result<Vec<u32>, Problem> {
    let rules = SessionRules { target, budget_secs, secs_per_review, secs_per_new, max_new: max_new as usize };
    Ok(plan::plan(&Fsrs::default(), &unflatten(memories)?, now, &rules))
}

/// Days until retrievability falls to `desired_retention`, for a card of `stability`.
#[wasm_bindgen]
pub fn interval(stability: f64, desired_retention: f64) -> f64 {
    Fsrs::default().interval(stability, desired_retention)
}
