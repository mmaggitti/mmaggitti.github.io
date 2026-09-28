//! Flashcards CLI: the core without a UI.
//!
//!   srs replay <days>:<grade> ...   the memory after each review (first days are ignored)
//!   srs recall <stability> <days>   retrievability after that many days
//!
//! e.g. `srs replay 0:3 3:3 10:1 2:3` shows stability and difficulty after each of four reviews.

use srs_core::fsrs::{Fsrs, Rating};
use std::process::ExitCode;

fn parse_step(arg: &str) -> Option<(u32, Rating)> {
    let (days, grade) = arg.split_once(':')?;
    Some((days.parse().ok()?, Rating::from_u8(grade.parse().ok()?)?))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let fsrs = Fsrs::default();
    match args.split_first() {
        Some((cmd, steps)) if cmd == "replay" && !steps.is_empty() => {
            let mut history = Vec::new();
            for arg in steps {
                let Some(step) = parse_step(arg) else {
                    eprintln!("input: {arg:?} is not <days>:<grade> with a grade from 1 to 4");
                    return ExitCode::FAILURE;
                };
                history.push(step);
                if let Some(m) = fsrs.replay(history.iter().copied()) {
                    println!("{arg:>8}  stability {:>10.4}  difficulty {:>7.4}", m.stability, m.difficulty);
                }
            }
            ExitCode::SUCCESS
        }
        Some((cmd, [s, d])) if cmd == "recall" => match (s.parse::<f64>(), d.parse::<f64>()) {
            (Ok(s), Ok(d)) if s > 0.0 => {
                println!("{:.6}", fsrs.retrievability(d, s));
                ExitCode::SUCCESS
            }
            _ => {
                eprintln!("input: stability must be > 0 and days a number");
                ExitCode::FAILURE
            }
        },
        _ => usage(),
    }
}

fn usage() -> ExitCode {
    eprintln!("usage: srs replay <days>:<grade> ... | srs recall <stability> <days>");
    ExitCode::from(2)
}
