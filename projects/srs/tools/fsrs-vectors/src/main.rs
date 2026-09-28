//! Writes srs-core's FSRS-6 reference vectors (`crates/srs-core/tests/data/fsrs_vectors.rs`) from
//! the official fsrs-rs, pinned to =6.6.2. Every number comes from fsrs-rs's public API with its
//! default parameters; nothing here recomputes the model. Run: `cargo run --release`.

use fsrs::{
    DEFAULT_PARAMETERS, FSRS, FSRS6_DEFAULT_DECAY, FSRSItem, FSRSReview, MemoryState,
    current_retrievability,
};
use std::fmt::Write as _;

const OUT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../crates/srs-core/tests/data/fsrs_vectors.rs"
);

/// Full f32 precision, written as the exact f64 of that f32 (`{:?}` round-trips it).
fn num(x: f32) -> String {
    format!("{:?}", f64::from(x))
}

/// A tiny 64-bit LCG (Knuth's MMIX constants) with a fixed seed: the pseudo-random histories are
/// the same on every run and every machine.
struct Lcg(u64);

impl Lcg {
    fn next_u32(&mut self) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) as u32
    }
    /// Uniform in lo..=hi.
    fn range(&mut self, lo: u32, hi: u32) -> u32 {
        lo + self.next_u32() % (hi - lo + 1)
    }
}

fn state_for(fsrs: &FSRS, reviews: &[FSRSReview]) -> MemoryState {
    let item = FSRSItem { reviews: reviews.to_vec() };
    fsrs.memory_state(item, None).expect("memory_state")
}

/// One history: (delta_days, rating) per review; the first review's delta is 0.
struct Hist {
    name: String,
    reviews: Vec<(u32, u32)>,
}

fn hist(name: &str, reviews: &[(u32, u32)]) -> Hist {
    Hist { name: name.to_string(), reviews: reviews.to_vec() }
}

fn handmade(fsrs: &FSRS) -> Vec<Hist> {
    let mut h = vec![
        hist("first-again", &[(0, 1)]),
        hist("first-hard", &[(0, 2)]),
        hist("first-good", &[(0, 3)]),
        hist("first-easy", &[(0, 4)]),
        hist("good-then-next-day-each-rating-1", &[(0, 3), (1, 1)]),
        hist("good-then-next-day-each-rating-2", &[(0, 3), (1, 2)]),
        hist("good-then-next-day-each-rating-3", &[(0, 3), (1, 3)]),
        hist("good-then-next-day-each-rating-4", &[(0, 3), (1, 4)]),
        hist("good-streak", &[(0, 3), (1, 3), (3, 3), (8, 3), (21, 3), (55, 3), (144, 3)]),
        hist("easy-streak", &[(0, 4), (8, 4), (30, 4), (120, 4), (400, 4), (1200, 4)]),
        hist("hard-streak", &[(0, 2), (1, 2), (2, 2), (4, 2), (7, 2), (12, 2), (20, 2), (33, 2)]),
        hist("again-daily", &[(0, 1), (1, 1), (1, 1), (1, 1), (1, 1), (1, 1)]),
        hist("lapse-after-long-interval", &[(0, 3), (3, 3), (10, 3), (30, 3), (90, 3), (300, 1), (1, 3), (4, 3)]),
        hist("lapse-after-very-long-interval", &[(0, 4), (10, 4), (60, 4), (365, 4), (1500, 1), (2, 3)]),
        hist("lapse-early", &[(0, 3), (5, 3), (2, 1)]),
        hist("long-gap-after-first", &[(0, 3), (1000, 3)]),
        hist("long-gaps", &[(0, 3), (365, 3), (730, 4), (1825, 3), (3650, 3)]),
        hist("stability-cap", &[(0, 4), (30, 4), (300, 4), (3000, 4), (20000, 4), (36500, 4)]),
        hist("overdue-hard", &[(0, 3), (3, 3), (100, 2)]),
        hist("early-reviews", &[(0, 3), (10, 3), (1, 3), (1, 3), (1, 4)]),
        hist("same-day-good", &[(0, 3), (0, 3), (0, 3), (0, 3)]),
        hist("same-day-learning-steps", &[(0, 1), (0, 1), (0, 3), (0, 3), (1, 3)]),
        hist("same-day-again-after-good", &[(0, 3), (0, 1), (0, 3), (1, 3)]),
        hist("same-day-hard", &[(0, 2), (0, 2), (0, 3)]),
        hist("same-day-easy", &[(0, 3), (0, 4), (0, 4)]),
        hist("same-day-relearning-after-lapse", &[(0, 3), (5, 3), (20, 1), (0, 1), (0, 3), (1, 3)]),
        hist("same-day-at-high-stability", &[(0, 4), (20, 4), (0, 3), (0, 2), (0, 1), (0, 4)]),
        hist("difficulty-floor", &[(0, 4), (5, 4), (15, 4), (40, 4), (100, 4), (250, 4), (600, 3)]),
        hist("difficulty-ceiling", &[(0, 1), (1, 1), (2, 1), (3, 1), (5, 1), (8, 1), (13, 1), (21, 2)]),
        hist(
            "mixed-long",
            &[
                (0, 3), (2, 1), (1, 3), (4, 4), (10, 2), (15, 3), (30, 1), (1, 2), (3, 3), (0, 3),
                (7, 3), (20, 4), (60, 3), (150, 2), (90, 3), (200, 1), (1, 3), (3, 3), (9, 3),
                (27, 4), (80, 3), (240, 3),
            ],
        ),
    ];
    // Scheduled at 90%: each gap is the interval from the state so far, rounded, at least 1 day.
    let cycle = [3, 3, 2, 3, 1, 3, 3, 4, 3, 2, 1, 3];
    for (name, ratings) in [
        ("scheduled-good-12", &[3; 12][..]),
        ("scheduled-hard-22", &[2; 22][..]),
        ("scheduled-cycle-26", &[&cycle[..], &cycle[..], &[3, 4][..]].concat()[..]),
    ] {
        let mut reviews = vec![(0u32, ratings[0])];
        for &rating in &ratings[1..] {
            let rs: Vec<FSRSReview> =
                reviews.iter().map(|&(d, r)| FSRSReview { rating: r, delta_t: d }).collect();
            let s = state_for(fsrs, &rs).stability;
            let ivl = fsrs.next_interval(Some(s), 0.9, rating).round().max(1.0) as u32;
            reviews.push((ivl, rating));
        }
        h.push(Hist { name: name.to_string(), reviews });
    }
    h
}

fn random(n: usize) -> Vec<Hist> {
    let mut rng = Lcg(0x5352_535f_4653_5253); // "SRS_FSRS"
    (0..n)
        .map(|i| {
            let len = rng.range(2, 28);
            let mut reviews = Vec::new();
            for k in 0..len {
                let delta = if k == 0 {
                    0
                } else {
                    match rng.range(0, 99) {
                        0..=9 => 0,
                        10..=44 => rng.range(1, 14),
                        _ => rng.range(1, 400),
                    }
                };
                let rating = match rng.range(0, 99) {
                    0..=11 => 1,
                    12..=24 => 2,
                    25..=84 => 3,
                    _ => 4,
                };
                reviews.push((delta, rating));
            }
            Hist { name: format!("random-{i:02}"), reviews }
        })
        .collect()
}

fn main() {
    let fsrs = FSRS::default();
    let mut out = String::new();
    let o = &mut out;

    writeln!(o, "// GENERATED by tools/fsrs-vectors from fsrs =6.6.2 — do not edit; rerun the tool.").unwrap();
    writeln!(o, "//").unwrap();
    writeln!(o, "// Every number is an f32 from fsrs-rs, written as the exact f64 of that f32, so nothing is lost.").unwrap();
    writeln!(o, "// Inputs (stability, difficulty, days, desired retention) are also the exact f32 values used.").unwrap();
    writeln!(o).unwrap();
    writeln!(o, "pub const FSRS_VERSION: &str = \"6.6.2\";").unwrap();
    writeln!(o).unwrap();
    writeln!(o, "pub const DEFAULT_PARAMETERS: [f64; 21] = [").unwrap();
    for (i, w) in DEFAULT_PARAMETERS.iter().enumerate() {
        writeln!(o, "    {}, // w{i}", num(*w)).unwrap();
    }
    writeln!(o, "];").unwrap();
    writeln!(o).unwrap();

    // HISTORIES
    let mut hists = handmade(&fsrs);
    hists.extend(random(30));
    let mut n_steps = 0;
    writeln!(o, "pub struct Step {{").unwrap();
    writeln!(o, "    pub delta_days: u32,").unwrap();
    writeln!(o, "    pub rating: u8,").unwrap();
    writeln!(o, "    pub stability: f64,").unwrap();
    writeln!(o, "    pub difficulty: f64,").unwrap();
    writeln!(o, "}}").unwrap();
    writeln!(o).unwrap();
    writeln!(o, "pub struct History {{").unwrap();
    writeln!(o, "    pub name: &'static str,").unwrap();
    writeln!(o, "    pub steps: &'static [Step],").unwrap();
    writeln!(o, "}}").unwrap();
    writeln!(o).unwrap();
    writeln!(o, "/// Memory state after each review of a history, from fsrs-rs's own API with the default parameters.").unwrap();
    writeln!(o, "pub const HISTORIES: &[History] = &[").unwrap();
    for h in &hists {
        let reviews: Vec<FSRSReview> =
            h.reviews.iter().map(|&(d, r)| FSRSReview { rating: r, delta_t: d }).collect();
        // Cross-check: the whole-history API must agree with memory_state on every prefix.
        let all = fsrs
            .historical_memory_states(FSRSItem { reviews: reviews.clone() }, None)
            .expect("historical_memory_states");
        writeln!(o, "    History {{").unwrap();
        writeln!(o, "        name: {:?},", h.name).unwrap();
        writeln!(o, "        steps: &[").unwrap();
        let mut prev: Option<MemoryState> = None;
        for (k, r) in reviews.iter().enumerate() {
            let s = state_for(&fsrs, &reviews[..=k]);
            assert_eq!(s, all[k], "{}: historical_memory_states differs at {k}", h.name);
            // And next_states from the previous state must give the same answer for this rating.
            let ns = fsrs.next_states(prev, 0.9, r.delta_t).expect("next_states");
            let pick = [&ns.again, &ns.hard, &ns.good, &ns.easy][r.rating as usize - 1];
            assert_eq!(s, pick.memory, "{}: next_states differs at {k}", h.name);
            writeln!(
                o,
                "            Step {{ delta_days: {}, rating: {}, stability: {}, difficulty: {} }},",
                r.delta_t,
                r.rating,
                num(s.stability),
                num(s.difficulty)
            )
            .unwrap();
            prev = Some(s);
            n_steps += 1;
        }
        writeln!(o, "        ],").unwrap();
        writeln!(o, "    }},").unwrap();
    }
    writeln!(o, "];").unwrap();
    writeln!(o).unwrap();

    // RETRIEVABILITY
    let stabilities: [f32; 11] =
        [0.1, 0.5, 1.0, 2.3065, 8.2956, 25.0, 100.0, 365.0, 1000.0, 2500.5, 3000.0];
    let days: [f32; 8] = [0.0, 0.5, 1.0, 2.5, 10.0, 100.0, 1000.0, 5000.0];
    let mut n_recall = 0;
    writeln!(o, "pub struct Recall {{").unwrap();
    writeln!(o, "    pub stability: f64,").unwrap();
    writeln!(o, "    pub days: f64,").unwrap();
    writeln!(o, "    pub retrievability: f64,").unwrap();
    writeln!(o, "}}").unwrap();
    writeln!(o).unwrap();
    writeln!(o, "/// fsrs::current_retrievability(state, days, FSRS6_DEFAULT_DECAY = w20).").unwrap();
    writeln!(o, "pub const RETRIEVABILITY: &[Recall] = &[").unwrap();
    for &s in &stabilities {
        // days == stability too: R is 0.9 there by construction.
        for &t in days.iter().chain(std::iter::once(&s)) {
            let state = MemoryState { stability: s, difficulty: 5.0 };
            let r = current_retrievability(state, t, FSRS6_DEFAULT_DECAY);
            writeln!(
                o,
                "    Recall {{ stability: {}, days: {}, retrievability: {} }},",
                num(s),
                num(t),
                num(r)
            )
            .unwrap();
            n_recall += 1;
        }
    }
    writeln!(o, "];").unwrap();
    writeln!(o).unwrap();

    // NEXT_STATES: (stability, difficulty, days_elapsed, desired_retention)
    let cases: [(f32, f32, u32, f32); 30] = [
        (0.212, 6.4133, 0, 0.9),
        (0.212, 6.4133, 1, 0.9),
        (1.2931, 5.1121707, 1, 0.9),
        (2.3065, 2.118104, 2, 0.9),
        (2.3065, 2.118104, 0, 0.8),
        (8.2956, 1.0, 8, 0.95),
        (0.5, 9.0, 0, 0.9),
        (0.5, 9.0, 3, 0.8),
        (1.0, 5.0, 0, 0.95),
        (1.0, 5.0, 1, 0.9),
        (3.0, 7.5, 5, 0.9),
        (5.0, 1.0, 0, 0.9),
        (5.0, 10.0, 5, 0.8),
        (10.0, 5.0, 0, 0.9),
        (10.0, 5.0, 1, 0.95),
        (10.0, 5.0, 10, 0.9),
        (10.0, 5.0, 30, 0.8),
        (21.7, 4.0, 21, 0.95),
        (30.0, 8.2, 90, 0.9),
        (60.0, 2.5, 60, 0.8),
        (100.0, 6.0, 7, 0.9),
        (100.0, 6.0, 365, 0.95),
        (180.0, 3.3, 180, 0.9),
        (365.0, 9.5, 400, 0.8),
        (500.0, 5.5, 0, 0.95),
        (1000.0, 1.0, 1000, 0.9),
        (2000.0, 7.0, 1500, 0.95),
        (3650.0, 4.2, 5000, 0.8),
        (10000.0, 2.0, 12000, 0.9),
        (0.001, 10.0, 1, 0.9),
    ];
    writeln!(o, "pub struct NextStates {{").unwrap();
    writeln!(o, "    pub stability: f64,").unwrap();
    writeln!(o, "    pub difficulty: f64,").unwrap();
    writeln!(o, "    pub days_elapsed: u32,").unwrap();
    writeln!(o, "    pub desired_retention: f64,").unwrap();
    writeln!(o, "    /// again, hard, good, easy: (stability, difficulty, interval_days)").unwrap();
    writeln!(o, "    pub next: [(f64, f64, f64); 4],").unwrap();
    writeln!(o, "}}").unwrap();
    writeln!(o).unwrap();
    writeln!(o, "/// fsrs.next_states(Some(state), desired_retention, days_elapsed); interval_days is fsrs-rs's raw f32").unwrap();
    writeln!(o, "/// interval (no rounding, no minimum).").unwrap();
    writeln!(o, "pub const NEXT_STATES: &[NextStates] = &[").unwrap();
    for &(s, d, t, dr) in &cases {
        let ns = fsrs
            .next_states(Some(MemoryState { stability: s, difficulty: d }), dr, t)
            .expect("next_states");
        writeln!(o, "    NextStates {{").unwrap();
        writeln!(o, "        stability: {},", num(s)).unwrap();
        writeln!(o, "        difficulty: {},", num(d)).unwrap();
        writeln!(o, "        days_elapsed: {t},").unwrap();
        writeln!(o, "        desired_retention: {},", num(dr)).unwrap();
        writeln!(o, "        next: [").unwrap();
        for st in [&ns.again, &ns.hard, &ns.good, &ns.easy] {
            writeln!(
                o,
                "            ({}, {}, {}),",
                num(st.memory.stability),
                num(st.memory.difficulty),
                num(st.interval)
            )
            .unwrap();
        }
        writeln!(o, "        ],").unwrap();
        writeln!(o, "    }},").unwrap();
    }
    writeln!(o, "];").unwrap();

    std::fs::create_dir_all(std::path::Path::new(OUT).parent().expect("parent")).expect("mkdir");
    std::fs::write(OUT, &out).expect("write");
    println!(
        "wrote crates/srs-core/tests/data/fsrs_vectors.rs: {} histories ({} steps), {} retrievability, {} next_states",
        hists.len(),
        n_steps,
        n_recall,
        cases.len()
    );
}
