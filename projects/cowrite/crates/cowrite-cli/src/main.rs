//! Co-write CLI: the core without a UI.
//!
//!   cowrite show <file>     print a saved document's text, its authors and who wrote which runs

use std::process::ExitCode;

// Reading never writes, but a session needs an actor that isn't the genesis one.
const READER: [u8; 16] = [0xc1; 16];

fn show(path: &str) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("io: {e}"))?;
    let view = cowrite_core::Session::load(&bytes, &READER).and_then(|s| s.view()).map_err(|e| e.to_string())?;
    println!("{}", view.text);
    println!("---");
    for a in &view.authors {
        println!("author {} {} {}", a.id, a.color, a.name);
    }
    for s in &view.spans {
        println!("run {}..{} {}", s.start, s.end, s.author);
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [cmd, path] if cmd == "show" => match show(path) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("{e}");
                ExitCode::FAILURE
            }
        },
        _ => {
            eprintln!("usage: cowrite show <saved document>");
            ExitCode::from(2)
        }
    }
}
