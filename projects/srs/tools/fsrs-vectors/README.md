# fsrs-vectors

Generates `crates/srs-core/tests/data/fsrs_vectors.rs`, the reference values that srs-core's FSRS-6
port is tested against. Every number comes from the official fsrs-rs, pinned to `fsrs = "=6.6.2"`,
through its public API with the default parameters:

- `DEFAULT_PARAMETERS`: fsrs-rs's 21 defaults.
- `HISTORIES`: the memory state after each review, from `FSRS::memory_state` on each prefix of the
  history. The tool also checks each value against `historical_memory_states` and `next_states` and
  stops if they disagree. The histories cover first reviews, long gaps, lapses, easy and hard
  streaks, same-day reviews, the stability and difficulty clamps, schedules of 20 or more reviews,
  and 30 pseudo-random histories (a fixed-seed LCG, so every run gives the same output).
- `RETRIEVABILITY`: `current_retrievability` with the default decay (w20).
- `NEXT_STATES`: `next_states` for a range of stabilities, difficulties, elapsed days and desired
  retentions. The interval is fsrs-rs's raw f32, with no rounding and no minimum.

Values are fsrs-rs's f32 results, written as the exact f64 of each f32, so no precision is lost.
Inputs are written the same way, so desired retention 0.9 appears as `0.8999999761581421`.

This package has its own empty `[workspace]`, so it is not part of the app's workspace and CI never
builds it. `fsrs` is its only direct dependency, with no features.

## Rerun

```bash
cargo run --release     # from this folder; overwrites ../../crates/srs-core/tests/data/fsrs_vectors.rs
```

To move to a new fsrs-rs release, change the pin in `Cargo.toml` and the version strings in
`src/main.rs`, rerun the tool, and review the diff of the generated file.
