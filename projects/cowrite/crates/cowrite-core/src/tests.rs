use super::*;

type R = Result<(), CoreError>;

const A: [u8; 16] = [1; 16];
const B: [u8; 16] = [2; 16];
const C: [u8; 16] = [3; 16];

// The host encrypts; a stand-in here so the tests see the blob path end to end.
fn seal(b: &[u8]) -> Vec<u8> {
    let mut v: Vec<u8> = b.iter().map(|x| x ^ 0x5a).collect();
    v.insert(0, 0xc0);
    v
}
fn open(b: &[u8]) -> Option<Vec<u8>> {
    (b.first() == Some(&0xc0)).then(|| b[1..].iter().map(|x| x ^ 0x5a).collect())
}

/// A stand-in relay: a plain Automerge peer holding the envelope, one sync state per device.
struct Relay {
    doc: AutoCommit,
    peers: Vec<sync::State>,
}
impl Relay {
    fn new(devices: usize) -> Self {
        Self { doc: AutoCommit::new(), peers: (0..devices).map(|_| sync::State::new()).collect() }
    }
    /// Run the sync protocol between the relay and one device until both are quiet.
    fn sync(&mut self, peer: usize, s: &mut Session) -> R {
        for _ in 0..20 {
            let up = s.relay_message();
            if let Some(m) = &up {
                let msg = sync::Message::decode(m).map_err(|e| CoreError::new("test", e.to_string()))?;
                self.doc.sync().receive_sync_message(&mut self.peers[peer], msg)?;
            }
            let down = self.doc.sync().generate_sync_message(&mut self.peers[peer]);
            if let Some(m) = &down {
                s.receive_relay(&m.clone().encode())?;
            }
            if up.is_none() && down.is_none() {
                return Ok(());
            }
        }
        Err(CoreError::new("test", "sync did not settle"))
    }
}

/// Batch and seal this device's edits into the envelope (what the host does on its timer).
fn publish(s: &mut Session) -> R {
    let batch = s.take_local_batch();
    if !batch.is_empty() {
        s.append_blob(&seal(&batch))?;
    }
    Ok(())
}

/// Open and apply every new blob; returns the patches, as the host would see them.
fn absorb(s: &mut Session) -> Result<Vec<TextPatch>, CoreError> {
    let mut all = Vec::new();
    for b in s.take_new_blobs() {
        if let Some(plain) = open(&b) {
            all.extend(s.apply_batch(&plain)?);
        }
    }
    Ok(all)
}

/// Apply patches to a JS-style UTF-16 string, as the editor does.
fn apply_utf16(text: &str, patches: &[TextPatch]) -> String {
    let mut units: Vec<u16> = text.encode_utf16().collect();
    for p in patches {
        let ins: Vec<u16> = p.insert.encode_utf16().collect();
        units.splice(p.index..p.index + p.delete, ins);
    }
    String::from_utf16_lossy(&units)
}

fn text(s: &Session) -> Result<String, CoreError> {
    Ok(s.view()?.text)
}

#[test]
fn every_device_starts_from_the_same_genesis() -> R {
    let mut a = Session::new(&A)?;
    let mut b = Session::new(&B)?;
    assert_eq!(a.content.get_heads(), b.content.get_heads());
    assert_eq!(a.envelope.get_heads(), b.envelope.get_heads());
    assert_eq!(a.text, b.text);
    Ok(())
}

#[test]
fn actors_must_be_sixteen_random_bytes() {
    assert_eq!(Session::new(&[1; 15]).err().map(|e| e.kind), Some("actor"));
    assert_eq!(Session::new(&GENESIS_ACTOR).err().map(|e| e.kind), Some("actor"));
}

#[test]
fn an_edit_travels_through_the_envelope_with_its_author() -> R {
    let mut relay = Relay::new(2);
    let mut a = Session::new(&A)?;
    let mut b = Session::new(&B)?;
    a.set_author("ana", "Ana", "#d0342c")?;
    a.splice(0, 0, "hello", "ana")?;
    publish(&mut a)?;
    relay.sync(0, &mut a)?;
    relay.sync(1, &mut b)?;
    let patches = absorb(&mut b)?;
    let v = b.view()?;
    assert_eq!(v.text, "hello");
    assert_eq!(patches, vec![TextPatch { index: 0, delete: 0, insert: "hello".into() }]);
    assert_eq!(v.spans, vec![Span { start: 0, end: 5, author: "ana".into() }]);
    assert_eq!(v.authors, vec![Author { id: "ana".into(), name: "Ana".into(), color: "#d0342c".into() }]);
    Ok(())
}

#[test]
fn the_envelope_holds_no_plaintext() -> R {
    let mut a = Session::new(&A)?;
    a.set_author("ana", "Ana Secretname", "#d0342c")?;
    a.splice(0, 0, "the secret plan", "ana")?;
    publish(&mut a)?;
    let mut relay = Relay::new(1);
    relay.sync(0, &mut a)?;
    let stored = relay.doc.save();
    let has = |needle: &str| stored.windows(needle.len()).any(|w| w == needle.as_bytes());
    assert!(!has("secret") && !has("Secretname"));
    Ok(())
}

#[test]
fn concurrent_edits_merge_and_patches_replay_on_the_editor_text() -> R {
    let mut relay = Relay::new(2);
    let mut a = Session::new(&A)?;
    let mut b = Session::new(&B)?;
    a.splice(0, 0, "hello world", "ana")?;
    publish(&mut a)?;
    relay.sync(0, &mut a)?;
    relay.sync(1, &mut b)?;
    absorb(&mut b)?;
    // Both edit at once: Ana at the start, Ben at the end.
    a.splice(0, 5, "goodbye", "ana")?;
    b.splice(11, 0, "!", "ben")?;
    publish(&mut a)?;
    publish(&mut b)?;
    relay.sync(0, &mut a)?;
    relay.sync(1, &mut b)?;
    relay.sync(0, &mut a)?;
    let ben_before = text(&b)?;
    let pa = absorb(&mut a)?;
    let pb = absorb(&mut b)?;
    assert_eq!(text(&a)?, "goodbye world!");
    assert_eq!(text(&b)?, "goodbye world!");
    assert_eq!(apply_utf16(&ben_before, &pb), "goodbye world!");
    assert_eq!(apply_utf16("goodbye world", &pa), "goodbye world!");
    let spans = a.view()?.spans;
    assert_eq!(spans.last(), Some(&Span { start: 13, end: 14, author: "ben".into() }));
    assert_eq!(spans.first(), Some(&Span { start: 0, end: 13, author: "ana".into() }));
    Ok(())
}

#[test]
fn indexes_are_utf16_like_javascript() -> R {
    let mut a = Session::new(&A)?;
    a.splice(0, 0, "a😀b", "ana")?;
    a.splice(3, 0, "X", "ben")?; // after the surrogate pair: "a" (1) + "😀" (2)
    let v = a.view()?;
    assert_eq!(v.text, "a😀Xb");
    assert!(v.spans.contains(&Span { start: 3, end: 4, author: "ben".into() }));
    assert_eq!(a.splice(9, 0, "x", "ana").err().map(|e| e.kind), Some("range"));
    assert_eq!(a.splice(4, 2, "", "ana").err().map(|e| e.kind), Some("range"));
    Ok(())
}

#[test]
fn authorship_survives_save_and_load_and_unbatched_edits_still_go_out() -> R {
    let mut a = Session::new(&A)?;
    a.set_author("ana", "Ana", "#d0342c")?;
    a.splice(0, 0, "kept", "ana")?;
    publish(&mut a)?;
    a.splice(4, 0, " and unbatched", "ana")?; // saved before its batch went out
    let file = a.save();
    let mut a2 = Session::load(&file, &C)?;
    assert_eq!(a2.view()?, a.view()?);
    assert!(a2.take_new_blobs().is_empty(), "blobs saved with the content are not reapplied");
    let batch = a2.take_local_batch();
    assert!(!batch.is_empty(), "the old actor's unbatched change is still this device's");
    let mut b = Session::new(&B)?;
    // The first batch, then the late one, reach a new device.
    let first = a2.envelope.save();
    let mut relay = Relay::new(2);
    let mut env_only = Session::new(&[4; 16])?;
    env_only.envelope.load_incremental(&first)?;
    relay.sync(0, &mut env_only)?;
    relay.sync(1, &mut b)?;
    absorb(&mut b)?;
    b.apply_batch(&batch)?;
    assert_eq!(text(&b)?, "kept and unbatched");
    assert_eq!(Session::load(b"nope", &C).err().map(|e| e.kind), Some("format"));
    Ok(())
}

#[test]
fn a_garbage_blob_is_refused_without_a_trap() -> R {
    let mut a = Session::new(&A)?;
    assert!(a.apply_batch(b"not an automerge change").is_err());
    a.splice(0, 0, "still fine", "ana")?;
    assert_eq!(text(&a)?, "still fine");
    Ok(())
}

#[test]
fn a_wiped_relay_is_refilled_by_the_next_device_to_connect() -> R {
    let mut a = Session::new(&A)?;
    a.set_author("ana", "Ana", "#d0342c")?;
    a.splice(0, 0, "survives the wipe", "ana")?;
    publish(&mut a)?;
    let mut relay = Relay::new(1);
    relay.sync(0, &mut a)?;
    // The relay loses everything. Ana reconnects (a new connection resets the sync state).
    let mut relay = Relay::new(2);
    a.relay_reset();
    relay.sync(0, &mut a)?;
    // A brand-new device opens the link.
    let mut c = Session::new(&C)?;
    relay.sync(1, &mut c)?;
    absorb(&mut c)?;
    assert_eq!(text(&c)?, "survives the wipe");
    assert_eq!(c.view()?.spans, vec![Span { start: 0, end: 17, author: "ana".into() }]);
    Ok(())
}

#[test]
fn an_unchanged_author_writes_nothing() -> R {
    let mut a = Session::new(&A)?;
    a.set_author("ana", "Ana", "#d0342c")?;
    let heads = a.content.get_heads();
    a.set_author("ana", "  Ana ", "#d0342c")?;
    assert_eq!(a.content.get_heads(), heads);
    a.set_author("ana", "Ana B", "#d0342c")?;
    assert_ne!(a.content.get_heads(), heads);
    assert_eq!(a.set_author("ana", "Ana", "red").err().map(|e| e.kind), Some("author"));
    assert_eq!(a.set_author("ana", "   ", "#000000").err().map(|e| e.kind), Some("author"));
    Ok(())
}

#[test]
fn json_is_escaped() {
    let v = View {
        text: "a\"b\\c\nd\u{1}\u{2028}😀".into(),
        spans: vec![Span { start: 0, end: 1, author: "x".into() }],
        authors: vec![Author { id: "x".into(), name: "N\"".into(), color: "#000000".into() }],
    };
    assert_eq!(
        json::view(&v),
        r##"{"text":"a\"b\\c\nd\u0001\u2028😀","spans":[[0,1,"x"]],"authors":[["x","N\"","#000000"]]}"##
    );
    assert_eq!(json::patches(&[TextPatch { index: 2, delete: 1, insert: "é".into() }]), r#"[[2,1,"é"]]"#);
}
