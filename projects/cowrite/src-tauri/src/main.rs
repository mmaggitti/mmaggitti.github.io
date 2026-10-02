// Desktop entry. iOS never calls main: it enters through `run` (lib.rs, mobile_entry_point).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cowrite_shell_lib::run();
}
