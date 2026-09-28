//! Seams probe CLI: the core without a UI.
//!
//!   cs-probe checksum <file>     Adler-32 of a file
//!   cs-probe version <text>      parse major.minor.patch

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [cmd, path] if cmd == "checksum" => match std::fs::read(path) {
            Ok(bytes) => {
                println!("{:08x}", cs_probe_core::checksum(&bytes));
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("io: {e}");
                ExitCode::FAILURE
            }
        },
        [cmd, text] if cmd == "version" => match cs_probe_core::parse_version(text) {
            Ok([major, minor, patch]) => {
                println!("{major} {minor} {patch}");
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("{e}");
                ExitCode::FAILURE
            }
        },
        _ => {
            eprintln!("usage: cs-probe checksum <file> | cs-probe version <major.minor.patch>");
            ExitCode::from(2)
        }
    }
}
