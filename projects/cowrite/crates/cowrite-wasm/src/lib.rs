//! Co-write — the WASM binding. Thin: typed arrays and small JSON in and out; errors as
//! `{ kind, message }`. It runs in a module Worker (web/worker/core.worker.ts), never on the main
//! thread. With panic = "abort" a panic is a trap: the worker client re-instantiates the module and
//! reports `{ kind: "trap" }` (Core & Seams DOCTRINE §1).

use cowrite_core::Session;
use wasm_bindgen::prelude::*;

/// The `{ kind, message }` error the web side mirrors as `CoreError` in web/worker/protocol.ts.
#[wasm_bindgen(getter_with_clone)]
pub struct Problem {
    pub kind: String,
    pub message: String,
}

impl From<cowrite_core::CoreError> for Problem {
    fn from(e: cowrite_core::CoreError) -> Self {
        Self { kind: e.kind.to_owned(), message: e.message }
    }
}

fn index(n: u32) -> usize {
    n as usize
}

/// One open document. The worker holds these behind numeric handles; the page never sees one.
#[wasm_bindgen]
pub struct Doc {
    s: Session,
}

#[wasm_bindgen]
impl Doc {
    /// A new document (or the start of joining one). `actor`: 16 random bytes.
    pub fn create(actor: &[u8]) -> Result<Doc, Problem> {
        Ok(Doc { s: Session::new(actor)? })
    }

    pub fn load(file: &[u8], actor: &[u8]) -> Result<Doc, Problem> {
        Ok(Doc { s: Session::load(file, actor)? })
    }

    pub fn save(&mut self) -> Vec<u8> {
        self.s.save()
    }

    /// Replace `delete` UTF-16 units at `index` with `insert`, as `author`. Returns the view JSON.
    pub fn splice(&mut self, index_: u32, delete: u32, insert: &str, author: &str) -> Result<String, Problem> {
        self.s.splice(index(index_), index(delete), insert, author)?;
        Ok(self.s.view_json()?)
    }

    #[wasm_bindgen(js_name = setAuthor)]
    pub fn set_author(&mut self, id: &str, name: &str, color: &str) -> Result<String, Problem> {
        self.s.set_author(id, name, color)?;
        Ok(self.s.view_json()?)
    }

    #[wasm_bindgen(js_name = takeLocalBatch)]
    pub fn take_local_batch(&mut self) -> Vec<u8> {
        self.s.take_local_batch()
    }

    #[wasm_bindgen(js_name = appendBlob)]
    pub fn append_blob(&mut self, blob: &[u8]) -> Result<(), Problem> {
        Ok(self.s.append_blob(blob)?)
    }

    /// New blobs, each prefixed with its length (u32, little-endian), in one buffer.
    #[wasm_bindgen(js_name = takeNewBlobs)]
    pub fn take_new_blobs(&mut self) -> Vec<u8> {
        let mut out = Vec::new();
        for b in self.s.take_new_blobs() {
            out.extend_from_slice(&(b.len() as u32).to_le_bytes());
            out.extend_from_slice(&b);
        }
        out
    }

    /// Apply a decrypted batch. Returns the text patches as JSON: `[[index, delete, insert], …]`.
    #[wasm_bindgen(js_name = applyBatch)]
    pub fn apply_batch(&mut self, plain: &[u8]) -> Result<String, Problem> {
        let patches = self.s.apply_batch(plain)?;
        Ok(Session::patches_json(&patches))
    }

    #[wasm_bindgen(js_name = relayReset)]
    pub fn relay_reset(&mut self) {
        self.s.relay_reset();
    }

    #[wasm_bindgen(js_name = relayMessage)]
    pub fn relay_message(&mut self) -> Option<Vec<u8>> {
        self.s.relay_message()
    }

    #[wasm_bindgen(js_name = receiveRelay)]
    pub fn receive_relay(&mut self, message: &[u8]) -> Result<(), Problem> {
        Ok(self.s.receive_relay(message)?)
    }

    pub fn view(&self) -> Result<String, Problem> {
        Ok(self.s.view_json()?)
    }
}

/// Test hook: traps on purpose, so the e2e can prove the worker recovers. A handful of bytes.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = __trapForTest)]
pub fn trap_for_test() {
    core::arch::wasm32::unreachable()
}
