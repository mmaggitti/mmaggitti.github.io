//! The few JSON shapes the binding passes out, written by hand: the core has one dependency
//! (Automerge, ADR-014) and this is an afternoon's code, not a serializer's.

use crate::{TextPatch, View};
use core::fmt::Write;

pub(crate) fn string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            // Other control characters, and the two separators JavaScript once refused in strings.
            c if (c as u32) < 0x20 || c == '\u{2028}' || c == '\u{2029}' => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

pub(crate) fn view(v: &View) -> String {
    let mut out = String::with_capacity(v.text.len() + 64 * (v.spans.len() + v.authors.len()) + 32);
    out.push_str("{\"text\":");
    string(&mut out, &v.text);
    out.push_str(",\"spans\":[");
    for (i, s) in v.spans.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(out, "[{},{},", s.start, s.end);
        string(&mut out, &s.author);
        out.push(']');
    }
    out.push_str("],\"authors\":[");
    for (i, a) in v.authors.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('[');
        string(&mut out, &a.id);
        out.push(',');
        string(&mut out, &a.name);
        out.push(',');
        string(&mut out, &a.color);
        out.push(']');
    }
    out.push_str("]}");
    out
}

pub(crate) fn patches(ps: &[TextPatch]) -> String {
    let mut out = String::from("[");
    for (i, p) in ps.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(out, "[{},{},", p.index, p.delete);
        string(&mut out, &p.insert);
        out.push(']');
    }
    out.push(']');
    out
}
