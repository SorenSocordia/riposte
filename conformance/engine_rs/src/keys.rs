// SPDX-License-Identifier: Apache-2.0
//! Ed25519 as the Node tools read it (crypto.verify over OpenSSL): keys in PEM (SubjectPublicKeyInfo, or a PKCS #8 private key
//! read as its public half), the key fingerprint (sha256 over the DER SubjectPublicKeyInfo), Node's lenient base64 for
//! signatures, and verification.
//!
//! Verification is ed25519-dalek's `verify` (not `verify_strict`), which is OpenSSL's equation: the key's y is read mod p (a
//! key written with y = p + 1 is the identity), s at or past the group order is refused, and R is compared by its encoding
//! (an R written with y = p + 1 never matches). There is no small-order check; a pinned key or fingerprint is what excludes
//! such keys. This reader verifies and never signs.

use crate::json::{hex, sha256_hex};
use ed25519_dalek::{Signature, SigningKey, Verifier, VerifyingKey};

pub const SPKI_PREFIX: [u8; 12] = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
pub const PKCS8_PREFIX: [u8; 16] = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
const ED25519_OID: [u8; 3] = [0x2b, 0x65, 0x70];

/// A key that cannot be read as an Ed25519 key in PEM, with the reason.
#[derive(Debug, Clone)]
pub struct KeyErr(pub String);

impl core::fmt::Display for KeyErr {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(&self.0)
    }
}

fn b64_val(c: u8) -> Option<u8> {
    match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

fn b64_decode_unpadded(t: &[u8]) -> Option<Vec<u8>> {
    if t.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(t.len() * 3 / 4);
    for chunk in t.chunks(4) {
        let v: Vec<u8> = chunk.iter().map(|c| b64_val(*c)).collect::<Option<Vec<u8>>>()?;
        let n = v.iter().enumerate().fold(0u32, |a, (i, x)| a | ((*x as u32) << (18 - 6 * i)));
        out.push((n >> 16) as u8);
        if v.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if v.len() > 3 {
            out.push(n as u8);
        }
    }
    Some(out)
}

/// base64 read strictly: the alphabet, then at most two '=' that complete the last group (Python's validate=True).
pub fn b64_strict(s: &str) -> Option<Vec<u8>> {
    let b = s.as_bytes();
    let body = s.trim_end_matches('=');
    let pad = b.len() - body.len();
    if pad > 2 || (b.len() % 4) != 0 {
        return None;
    }
    b64_decode_unpadded(body.as_bytes())
}

/// Buffer.from(text, 'base64') as Node reads it: the URL-safe letters accepted, other characters skipped, decoding stops at
/// the first '=', and a trailing group of one character dropped.
pub fn b64_lenient(s: &str) -> Vec<u8> {
    let t: String = s.replace('-', "+").replace('_', "/");
    let t = t.split('=').next().unwrap_or("");
    let mut t: Vec<u8> = t.bytes().filter(|c| b64_val(*c).is_some()).collect();
    if t.len() % 4 == 1 {
        t.pop();
    }
    b64_decode_unpadded(&t).unwrap_or_default()
}

pub fn b64_encode(b: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(A[(n >> 18) as usize & 63] as char);
        out.push(A[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { A[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { A[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Every PEM block in the text, in order: (label, DER bytes); a block whose body is not base64 is left out.
pub fn pem_blocks(text: &str) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    let mut from = 0usize;
    while let Some(p) = text[from..].find("-----BEGIN ") {
        let start = from + p + "-----BEGIN ".len();
        let label_len = text[start..].bytes().take_while(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == b' ').count();
        if label_len == 0 || !text[start + label_len..].starts_with("-----") {
            from = from + p + 1;
            continue;
        }
        let label = &text[start..start + label_len];
        let body_start = start + label_len + 5;
        let end_mark = format!("-----END {}-----", label);
        match text[body_start..].find(&end_mark) {
            None => {
                from = from + p + 1;
                continue;
            }
            Some(q) => {
                let body: String = text[body_start..body_start + q].chars().filter(|c| !c.is_whitespace()).collect();
                if let Some(der) = b64_strict(&body) {
                    out.push((label.to_string(), der));
                }
                from = body_start + q + end_mark.len();
            }
        }
    }
    out
}

fn der_len(b: &[u8], i: usize) -> Option<(usize, usize)> {
    let n = *b.get(i)? as usize;
    let i = i + 1;
    if n < 0x80 {
        return Some((n, i));
    }
    let k = n & 0x7f;
    if k == 0 || k > 4 || i + k > b.len() {
        return None;
    }
    Some((b[i..i + k].iter().fold(0usize, |a, x| (a << 8) | *x as usize), i + k))
}

fn tlv(b: &[u8], i: usize) -> Option<(u8, &[u8], usize)> {
    if i + 2 > b.len() {
        return None;
    }
    let tag = b[i];
    let (n, j) = der_len(b, i + 1)?;
    if j + n > b.len() {
        return None;
    }
    Some((tag, &b[j..j + n], j + n))
}

/// The algorithm OID of a SubjectPublicKeyInfo or a PKCS #8 key, or None when it is neither.
fn algorithm_oid(der: &[u8]) -> Option<Vec<u8>> {
    let (tag, body, end) = tlv(der, 0)?;
    if tag != 0x30 || end != der.len() {
        return None;
    }
    let (mut tag, first, i) = tlv(body, 0)?;
    let alg = if tag == 0x02 {
        let (t2, alg, _) = tlv(body, i)?;
        tag = t2;
        alg
    } else {
        first
    };
    if tag != 0x30 {
        return None;
    }
    let (tag, oid, _) = tlv(alg, 0)?;
    if tag == 0x06 {
        Some(oid.to_vec())
    } else {
        None
    }
}

/// The public key of a 32-byte seed (no signature is made).
pub fn seed_to_public(seed: &[u8]) -> [u8; 32] {
    let mut s = [0u8; 32];
    s.copy_from_slice(&seed[..32]);
    SigningKey::from_bytes(&s).verifying_key().to_bytes()
}

/// The 32-byte Ed25519 public key a PEM holds: SPKI as it is, or derived from a PKCS #8 private key (as Node's createPublicKey
/// accepts a private key). Otherwise the reason.
pub fn public_key_bytes(pem: &str) -> Result<[u8; 32], KeyErr> {
    let blocks = pem_blocks(pem);
    let (label, der) = blocks.first().ok_or_else(|| KeyErr("not a key in PEM form".into()))?;
    if label == "PUBLIC KEY" {
        if der.len() == 44 && der.starts_with(&SPKI_PREFIX) {
            let mut k = [0u8; 32];
            k.copy_from_slice(&der[12..]);
            return Ok(k);
        }
        return Err(KeyErr(if algorithm_oid(der).is_some() { "a public key, but not Ed25519" } else { "not a public key this reader can parse" }.into()));
    }
    if label == "PRIVATE KEY" {
        if der.starts_with(&PKCS8_PREFIX) && der.len() >= 48 {
            return Ok(seed_to_public(&der[16..48]));
        }
        if der.len() > 16 && der[0] == 0x30 && der[2..5] == [0x02, 0x01, 0x01] && der[..16].windows(3).any(|w| w == ED25519_OID) {
            // PKCS #8 v2 (OneAsymmetricKey) with the public key appended: the seed is the first OCTET STRING inside
            if let Some(i) = der.windows(4).position(|w| w == [0x04, 0x22, 0x04, 0x20]) {
                if i > 0 && i + 36 <= der.len() {
                    return Ok(seed_to_public(&der[i + 4..i + 36]));
                }
            }
        }
        return Err(KeyErr(if algorithm_oid(der).is_some() { "a private key, but not Ed25519" } else { "not a private key this reader can parse" }.into()));
    }
    Err(KeyErr(format!("a PEM block labelled {}, not a key this reader reads", label)))
}

pub fn is_private_pem(pem: &str) -> bool {
    pem_blocks(pem).iter().any(|(l, _)| l == "PRIVATE KEY")
}

pub fn spki_der(public: &[u8; 32]) -> Vec<u8> {
    let mut v = SPKI_PREFIX.to_vec();
    v.extend_from_slice(public);
    v
}

/// The public key as Node exports it: SPKI PEM, 64-character lines, a final newline.
pub fn spki_pem(public: &[u8; 32]) -> String {
    let b = b64_encode(&spki_der(public));
    let lines: Vec<&str> = b.as_bytes().chunks(64).map(|c| core::str::from_utf8(c).unwrap()).collect();
    format!("-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----\n", lines.join("\n"))
}

pub fn fingerprint_of(public: &[u8; 32]) -> String {
    sha256_hex(&spki_der(public))
}

/// sha256 over the DER SubjectPublicKeyInfo, 64 hex (receipts keyFingerprint).
pub fn key_fingerprint(pem: &str) -> Result<String, KeyErr> {
    Ok(fingerprint_of(&public_key_bytes(pem)?))
}

/// True when `sig` (64 bytes) is a valid Ed25519 signature of `msg` by the 32-byte key `public`, by OpenSSL's rules.
pub fn verify(public: &[u8], msg: &[u8], sig: &[u8]) -> bool {
    if public.len() != 32 || sig.len() != 64 {
        return false;
    }
    let mut pk = [0u8; 32];
    pk.copy_from_slice(public);
    let vk = match VerifyingKey::from_bytes(&pk) {
        Ok(k) => k,
        Err(_) => return false,
    };
    let mut s = [0u8; 64];
    s.copy_from_slice(sig);
    vk.verify(msg, &Signature::from_bytes(&s)).is_ok()
}

/// crypto.verify(null, message, createPublicKey(pem), Buffer.from(sig, 'base64')): true, false, or the key's reason when it
/// cannot be read (Node throws there too).
pub fn verify_pem(pem: &str, msg: &[u8], sig_b64: &str) -> Result<bool, KeyErr> {
    Ok(verify(&public_key_bytes(pem)?, msg, &b64_lenient(sig_b64)))
}

/// A public key's hex, for display.
pub fn public_hex(public: &[u8; 32]) -> String {
    hex(public)
}
