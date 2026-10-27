// SPDX-License-Identifier: Apache-2.0
//! A reader of the record tier in Rust: verify, never issue, never sign, never re-perform. Prototype; no measured accuracy.
//!
//! - [`json`]: values as JavaScript holds them; canonical JSON; JSON.stringify; Number-to-String.
//! - [`strict`]: the engine's strict JSON reader and UTF-8 rule.
//! - [`keys`]: Ed25519 keys in PEM, fingerprints, Node's base64, verification by OpenSSL's rules.
//! - [`ledger`]: the receipts ledger: `verify`, `summary`, `fingerprint`, `verify-signature`.
//! - [`frag`]: `frag open` on a frag folder.
//! - [`workgraph`]: a deposited work graph (`open`), a store (`status`, `digest`), `charter check`.
//! - [`vectors`]: the frozen record vectors (conformance/record/vectors.json) run against this crate.
//!
//! The C ABI below takes buffers, so it builds for wasm32-unknown-unknown as well (the file-reading commands need a filesystem).

pub mod frag;
pub mod json;
pub mod keys;
pub mod ledger;
pub mod paths;
pub mod strict;
pub mod vectors;
pub mod workgraph;

/// verdict_id: the first 32 hex of sha256 of `<input_hash>:<id>@<version>:<engine_version>[:<remedy_table_hash>]` (an engine
/// that binds no remedy table, 0.0.1 and 0.1.0, has none).
pub fn derive_verdict_id(input_hash: &str, id: &str, version: &str, engine_version: &str, remedy_table_hash: Option<&str>) -> String {
    let mut base = format!("{}:{}@{}:{}", input_hash, id, version, engine_version);
    if let Some(r) = remedy_table_hash {
        base.push(':');
        base.push_str(r);
    }
    json::sha256_text(&base)[..32].to_string()
}

/// A command's answer: its exit code and both streams whole.
#[derive(Debug, Clone, Default)]
pub struct CmdResult {
    pub code: i32,
    pub out: String,
    pub err: String,
}

// ---------------------------------------------------------------------------------------------------------------------
// The C ABI (include/riposte_record.h)

/// The version of the C ABI below.
pub const ABI_VERSION: u32 = 1;

/// Returned when a call stopped on an internal error (a panic caught at the boundary).
pub const INTERNAL_ERROR: i32 = -1;

unsafe fn slice<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if ptr.is_null() {
        if len == 0 {
            Some(&[])
        } else {
            None
        }
    } else {
        Some(core::slice::from_raw_parts(ptr, len))
    }
}

unsafe fn opt_text(ptr: *const u8, len: usize) -> Result<Option<String>, ()> {
    if ptr.is_null() {
        return Ok(None);
    }
    let b = core::slice::from_raw_parts(ptr, len);
    core::str::from_utf8(b).map(|s| Some(s.to_string())).map_err(|_| ())
}

fn guarded<F: FnOnce() -> i32 + std::panic::UnwindSafe>(f: F) -> i32 {
    std::panic::catch_unwind(f).unwrap_or(INTERNAL_ERROR)
}

#[no_mangle]
pub extern "C" fn riposte_record_abi_version() -> u32 {
    ABI_VERSION
}

/// One frag.json (its bytes): 2 the id recomputes and the signature verifies by the key the frag carries (the issuer, the cover,
/// the record and the pins are outside one buffer), 3 not a frag, 4 tampered.
///
/// # Safety
/// `ptr` points to `len` readable bytes (or is null with `len` 0).
#[no_mangle]
pub unsafe extern "C" fn riposte_verify_frag(ptr: *const u8, len: usize) -> i32 {
    let b = match slice(ptr, len) {
        None => return 3,
        Some(b) => b.to_vec(),
    };
    guarded(move || frag::verify_frag_bytes(&b, None))
}

/// One frag.json and the issuer's public key in PEM: 0 the id recomputes and the issuer's key signed it, 3 not a frag (or the key
/// cannot be read as UTF-8), 4 tampered or signed by another key.
///
/// # Safety
/// Each pointer points to its length of readable bytes (or is null with length 0).
#[no_mangle]
pub unsafe extern "C" fn riposte_verify_frag_issued(ptr: *const u8, len: usize, issuer_ptr: *const u8, issuer_len: usize) -> i32 {
    let b = match slice(ptr, len) {
        None => return 3,
        Some(b) => b.to_vec(),
    };
    let issuer = match opt_text(issuer_ptr, issuer_len) {
        Ok(Some(s)) => s,
        _ => return 3,
    };
    guarded(move || frag::verify_frag_bytes(&b, Some(&issuer)))
}

/// A receipts ledger held in memory, as `riposte-ledger verify` answers it: 0 verified, 1 not verified, 3 the text cannot be read
/// as a ledger. `head_ptr` (the head record's bytes) null: the head record is not read (--no-sidecar). `key_ptr` (a public key
/// PEM) null: no key is pinned. `require_signed` nonzero: every entry must be signed.
///
/// # Safety
/// Each pointer points to its length of readable bytes (or is null).
#[no_mangle]
pub unsafe extern "C" fn riposte_verify_ledger(
    ledger_ptr: *const u8,
    ledger_len: usize,
    head_ptr: *const u8,
    head_len: usize,
    key_ptr: *const u8,
    key_len: usize,
    require_signed: i32,
) -> i32 {
    let b = match slice(ledger_ptr, ledger_len) {
        None => return 3,
        Some(b) => b,
    };
    if strict::invalid_utf8_offset(b).is_some() {
        return 3;
    }
    let text = String::from_utf8_lossy(b).into_owned();
    let head = match opt_text(head_ptr, head_len) {
        Ok(h) => h,
        Err(_) => return 3,
    };
    let key = match opt_text(key_ptr, key_len) {
        Ok(k) => k,
        Err(_) => return 3,
    };
    guarded(move || ledger::verify_text(&text, head.as_deref(), key.as_deref(), require_signed != 0).0)
}

/// A buffer for a caller without an allocator of its own (a WebAssembly host): `len` bytes, freed with riposte_free.
#[no_mangle]
pub extern "C" fn riposte_alloc(len: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}

/// Free a buffer riposte_alloc returned, with the same length.
///
/// # Safety
/// `ptr` came from riposte_alloc(`len`) and is freed once.
#[no_mangle]
pub unsafe extern "C" fn riposte_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
    }
}
