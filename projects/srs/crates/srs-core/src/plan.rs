//! From the review log to a session: replay every card's memory, then rank what to review.
//!
//! Time is in **local days**: a real number whose whole part changes once a day (the web side
//! chooses the rollover hour). FSRS counts whole days between reviews; retrievability "now" uses
//! the fraction too.
//!
//! The ranker is the spec's stand-in: no due dates, no queue that empties. A card is eligible when
//! its retrievability has fallen below the target; eligible cards come lowest retrievability
//! first; new cards follow in deck order, capped; the list stops where the time budget runs out.

use crate::CoreError;
use crate::fsrs::{Fsrs, MemoryState, Rating};

/// One card's derived memory: `None` until its first review.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CardMemory {
    pub state: MemoryState,
    /// Local day (with fraction) of the latest review.
    pub last_day: f64,
}

/// Replay the review log into one memory per card.
///
/// `card[i]`, `day[i]` and `rating[i]` describe review `i`; reviews must be in time order. Cards
/// are numbered 0..`card_count`.
pub fn memories(fsrs: &Fsrs, card_count: usize, card: &[u32], day: &[f64], rating: &[u8]) -> Result<Vec<Option<CardMemory>>, CoreError> {
    if card.len() != day.len() || card.len() != rating.len() {
        return Err(CoreError::new("input", "card, day and rating must be the same length"));
    }
    let mut out: Vec<Option<CardMemory>> = vec![None; card_count];
    for (i, ((&c, &t), &g)) in card.iter().zip(day).zip(rating).enumerate() {
        let slot = out
            .get_mut(c as usize)
            .ok_or_else(|| CoreError::new("input", format!("review {i} is for card {c}, but there are {card_count} cards")))?;
        let g = Rating::from_u8(g).ok_or_else(|| CoreError::new("input", format!("review {i} has grade {g}; grades are 1 to 4")))?;
        if !t.is_finite() {
            return Err(CoreError::new("input", format!("review {i} has no valid time")));
        }
        *slot = Some(match *slot {
            None => CardMemory { state: fsrs.first(g), last_day: t },
            Some(prev) => {
                if t < prev.last_day {
                    return Err(CoreError::new("input", format!("review {i} is earlier than the review before it for card {c}; sort by time")));
                }
                let elapsed = (t.floor() - prev.last_day.floor()) as u32;
                CardMemory { state: fsrs.next(prev.state, elapsed, g), last_day: t }
            }
        });
    }
    Ok(out)
}

/// Retrievability of each card at local day `now`; `None` for new cards.
pub fn retrievabilities(fsrs: &Fsrs, cards: &[Option<CardMemory>], now: f64) -> Vec<Option<f64>> {
    cards.iter().map(|m| m.map(|m| fsrs.retrievability(now - m.last_day, m.state.stability))).collect()
}

/// What a session should cover, and how long it may take.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SessionRules {
    /// A card is eligible when its retrievability is below this (the spec's band target).
    pub target: f64,
    /// The time box, in seconds.
    pub budget_secs: f64,
    /// Expected seconds per review of a known card, and per new card.
    pub secs_per_review: f64,
    pub secs_per_new: f64,
    /// At most this many new cards per session.
    pub max_new: usize,
}

impl Default for SessionRules {
    fn default() -> Self {
        Self { target: 0.9, budget_secs: 15.0 * 60.0, secs_per_review: 12.0, secs_per_new: 25.0, max_new: 10 }
    }
}

/// The cards for one session, in the order to show them.
pub fn plan(fsrs: &Fsrs, cards: &[Option<CardMemory>], now: f64, rules: &SessionRules) -> Vec<u32> {
    let mut eligible: Vec<(f64, usize)> = retrievabilities(fsrs, cards, now)
        .into_iter()
        .enumerate()
        .filter_map(|(i, r)| r.filter(|&r| r < rules.target).map(|r| (r, i)))
        .collect();
    eligible.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));

    let mut out = Vec::new();
    let mut spent = 0.0;
    for (_, i) in eligible {
        if spent + rules.secs_per_review > rules.budget_secs {
            break;
        }
        spent += rules.secs_per_review;
        out.push(i as u32);
    }
    let new_cards = cards.iter().enumerate().filter(|(_, m)| m.is_none()).map(|(i, _)| i).take(rules.max_new);
    for i in new_cards {
        if spent + rules.secs_per_new > rules.budget_secs {
            break;
        }
        spent += rules.secs_per_new;
        out.push(i as u32);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fsrs() -> Fsrs {
        Fsrs::default()
    }

    #[test]
    fn new_cards_have_no_memory() {
        let m = memories(&fsrs(), 3, &[1], &[100.2], &[3]).unwrap_or_default();
        assert!(m[0].is_none() && m[1].is_some() && m[2].is_none());
    }

    #[test]
    fn rejects_bad_input() {
        let f = fsrs();
        assert_eq!(memories(&f, 1, &[1], &[0.0], &[3]).map_err(|e| e.kind), Err("input"));
        assert_eq!(memories(&f, 1, &[0], &[0.0], &[5]).map_err(|e| e.kind), Err("input"));
        assert_eq!(memories(&f, 1, &[0, 0], &[5.0, 4.0], &[3, 3]).map_err(|e| e.kind), Err("input"));
        assert_eq!(memories(&f, 1, &[0], &[f64::NAN], &[3]).map_err(|e| e.kind), Err("input"));
        assert_eq!(memories(&f, 1, &[0, 0], &[1.0], &[3]).map_err(|e| e.kind), Err("input"));
    }

    #[test]
    fn replay_matches_fsrs_step_by_step() {
        let f = fsrs();
        let m = memories(&f, 1, &[0, 0, 0], &[10.5, 10.9, 13.1], &[3, 1, 3]).unwrap_or_default();
        let step1 = f.first(Rating::Good);
        let step2 = f.next(step1, 0, Rating::Again); // same local day
        let step3 = f.next(step2, 3, Rating::Good); // day 10 → day 13
        assert_eq!(m[0].map(|c| c.state), Some(step3));
        assert_eq!(m[0].map(|c| c.last_day), Some(13.1));
    }

    #[test]
    fn plan_ranks_lowest_retrievability_first_then_new_cards() {
        let f = fsrs();
        // Card 0 reviewed long ago (low R), card 1 recently (high R, not eligible), card 2 a
        // moderate while ago, card 3 new.
        let m = memories(&f, 4, &[0, 1, 2], &[0.0, 99.0, 60.0], &[3, 3, 3]).unwrap_or_default();
        let order = plan(&f, &m, 100.0, &SessionRules::default());
        assert_eq!(order, vec![0, 2, 3]);
    }

    #[test]
    fn plan_stops_at_the_budget_and_caps_new_cards() {
        let f = fsrs();
        let m = vec![None; 30];
        let rules = SessionRules { budget_secs: 100.0, secs_per_new: 25.0, max_new: 10, ..SessionRules::default() };
        assert_eq!(plan(&f, &m, 0.0, &rules).len(), 4);
        let rules = SessionRules { budget_secs: 10_000.0, ..rules };
        assert_eq!(plan(&f, &m, 0.0, &rules).len(), 10);
    }
}
