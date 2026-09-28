//! Seams probe — the domain core.
//!
//! Pure Rust: no I/O, no platform code, no binding. The WASM binding (`cs-probe-wasm`) and the CLI
//! (`cs-probe-cli`) are thin consumers. The functions below are the template's worked example —
//! a checksum, a histogram and a parser with a typed error — replace them with the app's domain.

use core::fmt;

/// The error every core operation returns: a stable machine-readable `kind` plus a message for
/// people. The binding passes both across as `{ kind, message }` (Core & Seams DOCTRINE §1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreError {
    pub kind: &'static str,
    pub message: String,
}

impl CoreError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}

/// Adler-32 of `bytes` (RFC 1950 §8.2).
pub fn checksum(bytes: &[u8]) -> u32 {
    const MOD: u32 = 65_521;
    let (mut a, mut b) = (1u32, 0u32);
    // 5552 is the largest block for which the sums cannot overflow u32 before the modulo.
    for block in bytes.chunks(5552) {
        for &byte in block {
            a += u32::from(byte);
            b += a;
        }
        a %= MOD;
        b %= MOD;
    }
    (b << 16) | a
}

/// How many times each byte value occurs in `bytes`.
pub fn histogram(bytes: &[u8]) -> [u32; 256] {
    let mut counts = [0u32; 256];
    for &byte in bytes {
        let slot = &mut counts[usize::from(byte)];
        *slot = slot.saturating_add(1);
    }
    counts
}

/// Parses `major.minor.patch`, each part a number up to 65535.
pub fn parse_version(text: &str) -> Result<[u16; 3], CoreError> {
    let parts: Vec<&str> = text.trim().split('.').collect();
    if parts.len() != 3 {
        return Err(CoreError::new("parse", format!("expected major.minor.patch, got {} part(s)", parts.len())));
    }
    let mut out = [0u16; 3];
    for (slot, part) in out.iter_mut().zip(parts) {
        *slot = part
            .parse()
            .map_err(|_| CoreError::new("parse", format!("{part:?} is not a number from 0 to 65535")))?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksum_matches_known_vectors() {
        assert_eq!(checksum(b""), 1);
        assert_eq!(checksum(b"Wikipedia"), 0x11E6_0398);
        // Long input crosses the 5552-byte block boundary. Vector from Python's zlib.adler32.
        assert_eq!(checksum(&[0xFF; 10_000]), 0xB623_EB2B);
    }

    #[test]
    fn histogram_counts_every_byte() {
        let h = histogram(b"aab");
        assert_eq!((h[usize::from(b'a')], h[usize::from(b'b')], h.iter().sum::<u32>()), (2, 1, 3));
    }

    #[test]
    fn parse_version_accepts_and_rejects() {
        assert_eq!(parse_version(" 1.2.3 "), Ok([1, 2, 3]));
        assert_eq!(parse_version("1.2").map_err(|e| e.kind), Err("parse"));
        assert_eq!(parse_version("1.x.3").map_err(|e| e.kind), Err("parse"));
        assert_eq!(parse_version("1.2.70000").map_err(|e| e.kind), Err("parse"));
    }
}
