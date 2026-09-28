//! Seams probe — the WASM binding. Thin: typed arrays and small values in, typed arrays out; errors
//! as `{ kind, message }`. It runs in a module Worker (web/worker/core.worker.ts), never on the
//! main thread. With panic = "abort" a panic is a trap: the worker client re-instantiates the
//! module and reports `{ kind: "trap" }` (Core & Seams DOCTRINE §1).

use wasm_bindgen::prelude::*;

/// The `{ kind, message }` error the web side mirrors as `CoreError` in web/worker/protocol.ts.
#[wasm_bindgen(getter_with_clone)]
pub struct Problem {
    pub kind: String,
    pub message: String,
}

impl From<cs_probe_core::CoreError> for Problem {
    fn from(e: cs_probe_core::CoreError) -> Self {
        Self { kind: e.kind.to_owned(), message: e.message }
    }
}

#[wasm_bindgen]
pub fn checksum(bytes: &[u8]) -> u32 {
    cs_probe_core::checksum(bytes)
}

#[wasm_bindgen]
pub fn histogram(bytes: &[u8]) -> Vec<u32> {
    cs_probe_core::histogram(bytes).to_vec()
}

#[wasm_bindgen(js_name = parseVersion)]
pub fn parse_version(text: &str) -> Result<Vec<u16>, Problem> {
    Ok(cs_probe_core::parse_version(text)?.to_vec())
}

/// Test hook: traps on purpose, so the e2e can prove the worker recovers. A handful of bytes.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = __trapForTest)]
pub fn trap_for_test() {
    core::arch::wasm32::unreachable()
}
