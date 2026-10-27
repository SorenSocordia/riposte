// SPDX-License-Identifier: Apache-2.0
//! The C ABI (include/riposte_record.h) called as a C caller calls it, on the record vectors' own fixtures.

use riposte_record::{json, keys, vectors};
use std::path::PathBuf;

fn fixture(fx: &str, file: &str) -> Vec<u8> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("record").join("vectors.json");
    let cases = vectors::load(&p).unwrap();
    let f = cases.get("fixtures").and_then(|x| x.get(fx)).and_then(|x| x.get(file)).unwrap().clone();
    match f.get("utf8") {
        Some(json::Value::Str(s)) => s.lossy().into_bytes(),
        _ => keys::b64_strict(&json::str_of(f.get("base64")).unwrap()).unwrap(),
    }
}

fn frag(b: &[u8]) -> i32 {
    unsafe { riposte_record::riposte_verify_frag(b.as_ptr(), b.len()) }
}

fn frag_issued(b: &[u8], k: &[u8]) -> i32 {
    unsafe { riposte_record::riposte_verify_frag_issued(b.as_ptr(), b.len(), k.as_ptr(), k.len()) }
}

fn ledger(l: &[u8], head: Option<&[u8]>, key: Option<&[u8]>, require_signed: bool) -> i32 {
    let (hp, hl) = head.map_or((std::ptr::null(), 0), |h| (h.as_ptr(), h.len()));
    let (kp, kl) = key.map_or((std::ptr::null(), 0), |k| (k.as_ptr(), k.len()));
    unsafe { riposte_record::riposte_verify_ledger(l.as_ptr(), l.len(), hp, hl, kp, kl, i32::from(require_signed)) }
}

#[test]
fn abi_version() {
    assert_eq!(riposte_record::riposte_record_abi_version(), 1);
}

#[test]
fn verify_frag_buffer() {
    let f = fixture("frag-tree", "frags/t/fail/frag.json");
    let a = fixture("frag-tree", "a.pub.pem");
    let b = fixture("ledger", "b.pub.pem");
    assert_eq!(frag(&f), 2, "intact as far as one buffer shows; the issuer is not pinned");
    assert_eq!(frag_issued(&f, &a), 0, "key a is the issuer");
    assert_eq!(frag_issued(&f, &b), 4, "key b is not the issuer");
    let t = String::from_utf8(f.clone()).unwrap().replacen("\"outcome\": \"FAIL\"", "\"outcome\": \"PASS\"", 1);
    assert_ne!(t.as_bytes(), &f[..], "the edit landed");
    assert_eq!(frag(t.as_bytes()), 4, "the claim edited: the id no longer recomputes");
    assert_eq!(frag(b"{\"schema\":\"something else\"}"), 3);
    assert_eq!(frag(&[0xff, 0xfe]), 3);
    assert_eq!(unsafe { riposte_record::riposte_verify_frag(std::ptr::null(), 5) }, 3);
}

#[test]
fn verify_ledger_buffer() {
    let l = fixture("ledger", "ledger.jsonl");
    let h = fixture("ledger", "ledger.jsonl.head.json");
    let a = fixture("ledger", "a.pub.pem");
    let b = fixture("ledger", "b.pub.pem");
    assert_eq!(ledger(&l, Some(&h), Some(&a), false), 0);
    assert_eq!(ledger(&l, None, Some(&a), true), 0, "no head record read");
    assert_eq!(ledger(&l, Some(&h), Some(&b), false), 1, "every entry is key a's");
    let lines: Vec<&[u8]> = l.split(|c| *c == b'\n').collect();
    let cut: Vec<u8> = lines[..3].join(&b'\n').into_iter().chain(b"\n".iter().copied()).collect();
    assert_eq!(ledger(&cut, Some(&h), Some(&a), false), 1, "the head record shows the cut");
    assert_eq!(ledger(&cut, None, Some(&a), false), 0, "without the head record the cut does not show (the anchor is the caller's)");
    let u = fixture("ledger", "unsigned.jsonl");
    assert_eq!(ledger(&u, None, None, true), 1, "unsigned under require_signed");
    assert_eq!(ledger(b"{}\nnot json\n{}\n", None, None, false), 3);
    assert_eq!(ledger(&[0xff], None, None, false), 3);
}
