// SPDX-License-Identifier: Apache-2.0
//! The receipts ledger (one JSON entry per line, hash-chained, optionally Ed25519-signed, with its head record beside it), read
//! as `riposte-ledger verify`, `summary`, `fingerprint` and `verify-signature` read it, with their exit codes and first lines.
//! Written from the Python reader (conformance/engine_py/record/ledger.py), which follows packages/receipts/src/ledger.ts,
//! head-record.ts and ledger-command.ts. It never writes to a ledger.

use crate::json::{
    self, ellipsis16, is_hex64, is_safe_integer, js_eq, js_str, js_string, js_trim, sha256_text, truthy, Obj, Value,
};
use crate::keys;
use crate::strict::{self, StrictErr};
use crate::CmdResult;
use std::path::Path;

pub const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";
pub const USAGE: &str = "riposte-record ledger verify <ledger.jsonl> [--key <public.pem>] [--require-signed] [--head <hash>] [--no-sidecar]\n\
riposte-record ledger summary <ledger.jsonl> [--no-sidecar]\n\
riposte-record ledger fingerprint <key.pem> [--short]\n\
riposte-record ledger verify-signature <envelope.json | proof.json> [--trusted-key <public.pem | 64-hex fingerprint>]";
const HELP_TAIL: &str = "\n\nA reader (Rust, tier 1: verify only): it never writes to a ledger. It reads each line strictly, as the engine reads a replay\n\
bundle, walks the hash chain, verifies every Ed25519 signature, and reads the head record beside the file (<ledger>.head.json:\n\
entry count, head hash, byte length). Its first lines and exit codes are riposte-ledger verify's.\n\
Not here: rule, sign and case (they write), and verify --proof (the binding of a proof to its receipt).\n\
Exit (verify): 0 verified · 1 not verified · 3 a usage error, a file that cannot be read, a line before the last that is\n\
not JSON, or something this reader does not do (named).";
const ANCHOR: &str = "pin --head <hash>, a head you recorded somewhere you control";

/// sha256 over canonical JSON of { seq, kind, at, body, prev_hash }, a key the entry lacks left out.
pub fn entry_hash(e: &Value) -> String {
    let mut o = Obj::new();
    for k in ["seq", "kind", "at", "body", "prev_hash"] {
        if let Some(v) = e.get(k) {
            o.set(k, v.clone());
        }
    }
    sha256_text(&json::canonicalize(&Value::Obj(o)))
}

#[derive(Clone, Debug)]
pub struct Refusal {
    pub entry: usize,
    pub reason: String,
}

enum LineRead {
    Entry(Value),
    Refused(Value, Refusal),
    NotJson,
}

/// readLedgerLine: one way, or read by JSON.parse and refused by the strict reader, or not JSON at all.
fn read_ledger_line(text: &str, entry: usize, line: usize) -> LineRead {
    match strict::parse_json_strict(text, &format!("line {}", line)) {
        Ok(v) => LineRead::Entry(v),
        Err(StrictErr::NotJson { .. }) => LineRead::NotJson,
        Err(e @ StrictErr::Refused { .. }) => {
            let loose = match json::parse(text) {
                Ok(v) => v,
                Err(_) => return LineRead::NotJson,
            };
            let detail = match strict::duplicate_key_path(text) {
                Some((path, key)) => format!(
                    "line {}: the key {} appears twice in one object (at {}). JSON keeps the last, so the entry's hash and signature \
                     cover that value, while a reader that keeps the first sees the other. The receipts store writes every key once, so \
                     something else wrote this line",
                    line,
                    js_string(&key),
                    path
                ),
                None => e.message().to_string(),
            };
            LineRead::Refused(loose, Refusal { entry, reason: format!("entry {} cannot be read one way: {}", entry, detail) })
        }
    }
}

#[derive(Clone, Debug)]
pub struct Torn {
    pub bytes: usize,
    pub after_line: usize,
    pub ends_in_newline: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Parsed {
    pub entries: Vec<Value>,
    pub torn: Option<Torn>,
    pub no_final_newline: bool,
    pub refused: Option<Refusal>,
}

/// parseLedgerTolerant; Err for a line before the last that is not JSON (and, unless collect, for a line the strict reader refuses).
pub fn parse_ledger_tolerant(text: &str, collect: bool) -> Result<Parsed, String> {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut last = lines.len() as isize - 1;
    while last >= 0 && js_trim(lines[last as usize]).is_empty() {
        last -= 1;
    }
    if last < 0 {
        return Ok(Parsed::default());
    }
    let last = last as usize;
    let mut out = Parsed::default();
    let whole: Vec<&str> = lines[..last].iter().copied().filter(|l| !js_trim(l).is_empty()).collect();
    for (i, ln) in whole.iter().enumerate() {
        match read_ledger_line(ln, i, i + 1) {
            LineRead::NotJson => return Err(format!("line {} is not JSON", i + 1)),
            LineRead::Refused(v, r) => {
                if !collect {
                    return Err(r.reason);
                }
                if out.refused.is_none() {
                    out.refused = Some(r);
                }
                out.entries.push(v);
            }
            LineRead::Entry(v) => out.entries.push(v),
        }
    }
    let tail = lines[last];
    let newline = last < lines.len() - 1;
    let n = out.entries.len();
    match read_ledger_line(tail, n, n + 1) {
        LineRead::NotJson => {
            out.torn = Some(Torn { bytes: tail.len() + usize::from(newline), after_line: n, ends_in_newline: newline });
            return Ok(out);
        }
        LineRead::Refused(v, r) => {
            if !collect {
                return Err(r.reason);
            }
            if out.refused.is_none() {
                out.refused = Some(r);
            }
            out.entries.push(v);
        }
        LineRead::Entry(v) => out.entries.push(v),
    }
    out.no_final_newline = !newline;
    Ok(out)
}

/// (ok, fingerprint) for an entry's signature, as verifyChain reads it (any failure to read is a signature that fails).
pub fn signature_check(e: &Value) -> (bool, String) {
    let sig = e.get("signature");
    let h = e.get("hash").and_then(|x| x.as_jstr());
    let pem = sig.filter(|s| s.is_obj()).and_then(|s| s.get("public_key")).and_then(|x| x.as_str());
    let sg = sig.filter(|s| s.is_obj()).and_then(|s| s.get("sig")).and_then(|x| x.as_str());
    let (h, pem, sg) = match (h, pem, sg) {
        (Some(h), Some(p), Some(s)) => (h, p, s),
        _ => return (false, String::new()),
    };
    match keys::verify_pem(&pem, h.lossy().as_bytes(), &sg) {
        Ok(true) => match keys::key_fingerprint(&pem) {
            Ok(fp) => (true, fp),
            Err(_) => (false, String::new()),
        },
        _ => (false, String::new()),
    }
}

#[derive(Clone, Debug, Default)]
pub struct Policy {
    pub public_key: Option<String>,
    pub require_signed: bool,
    pub head: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Repair {
    seq: usize,
    bytes: f64,
    sha256: String,
    quarantined_to: String,
    after_seq: Option<f64>,
    cut_entry: Option<(f64, String)>,
}

#[derive(Clone, Debug)]
pub struct Chain {
    pub ok: bool,
    pub chain_ok: bool,
    pub signatures_ok: bool,
    pub anchor_ok: Option<bool>,
    pub length: usize,
    pub head: String,
    pub signed: usize,
    pub unsigned: usize,
    pub signers: Vec<String>,
    repairs: Vec<Repair>,
    pub broken_at: Option<usize>,
    pub reason: Option<String>,
    key_unreadable: bool,
}

impl Chain {
    /// The object as verifyChain returns it (its keys in its order).
    pub fn to_obj(&self) -> Obj {
        let mut o = Obj::new();
        if self.key_unreadable {
            o.set("ok", Value::Bool(false));
            o.set("chain_ok", Value::Bool(false));
            o.set("signatures_ok", Value::Bool(false));
            if let Some(a) = self.anchor_ok {
                o.set("anchor_ok", Value::Bool(a));
            }
            o.set("length", Value::n(self.length as f64));
            o.set("head", Value::s(&self.head));
            o.set("reason", Value::opt_s(self.reason.as_deref()));
            o.set("signed", Value::n(0.0));
            o.set("unsigned", Value::n(0.0));
            o.set("signers", Value::Arr(vec![]));
            return o;
        }
        o.set("ok", Value::Bool(self.ok));
        o.set("chain_ok", Value::Bool(self.chain_ok));
        o.set("signatures_ok", Value::Bool(self.signatures_ok));
        if let Some(a) = self.anchor_ok {
            o.set("anchor_ok", Value::Bool(a));
        }
        o.set("length", Value::n(self.length as f64));
        o.set("head", Value::s(&self.head));
        o.set("signed", Value::n(self.signed as f64));
        o.set("unsigned", Value::n(self.unsigned as f64));
        o.set("signers", Value::strs(&self.signers));
        if !self.repairs.is_empty() {
            o.set(
                "repairs",
                Value::Arr(
                    self.repairs
                        .iter()
                        .map(|r| {
                            let mut x = Obj::new();
                            x.set("seq", Value::n(r.seq as f64));
                            x.set("bytes", Value::n(r.bytes));
                            x.set("sha256", Value::s(&r.sha256));
                            x.set("quarantined_to", Value::s(&r.quarantined_to));
                            x.set("after_seq", r.after_seq.map(Value::n).unwrap_or(Value::Null));
                            if let Some((s, h)) = &r.cut_entry {
                                x.set("cut_entry", Value::obj(vec![("seq", Value::n(*s)), ("hash", Value::s(h))]));
                            }
                            Value::Obj(x)
                        })
                        .collect(),
                ),
            );
        }
        if let Some(b) = self.broken_at {
            o.set("broken_at", Value::n(b as f64));
        }
        if let Some(r) = &self.reason {
            o.set("reason", Value::s(r));
        }
        o
    }
}

/// Number(v) for a parsed value (undefined is NaN).
fn js_number_of(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) | Some(Value::Bool(false)) => 0.0,
        Some(Value::Bool(true)) => 1.0,
        Some(Value::Num(x)) => *x,
        Some(Value::Str(s)) => {
            let t = s.lossy();
            let t = js_trim(&t);
            if t.is_empty() {
                0.0
            } else if t == "Infinity" || t == "+Infinity" {
                f64::INFINITY
            } else if t == "-Infinity" {
                f64::NEG_INFINITY
            } else if let Some(h) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
                u64::from_str_radix(h, 16).map(|x| x as f64).unwrap_or(f64::NAN)
            } else if let Some(h) = t.strip_prefix("0o").or_else(|| t.strip_prefix("0O")) {
                u64::from_str_radix(h, 8).map(|x| x as f64).unwrap_or(f64::NAN)
            } else if let Some(h) = t.strip_prefix("0b").or_else(|| t.strip_prefix("0B")) {
                u64::from_str_radix(h, 2).map(|x| x as f64).unwrap_or(f64::NAN)
            } else if t.bytes().all(|c| c.is_ascii_digit() || matches!(c, b'.' | b'e' | b'E' | b'+' | b'-')) {
                t.parse::<f64>().unwrap_or(f64::NAN)
            } else {
                f64::NAN
            }
        }
        Some(Value::Arr(a)) => match a.len() {
            0 => 0.0,
            1 => js_number_of(Some(&Value::s(&if a[0].is_null() { String::new() } else { js_str(Some(&a[0])) }))),
            _ => f64::NAN,
        },
        Some(Value::Obj(_)) => f64::NAN,
    }
}

/// verifyChain: the chain, the signatures and the anchor answered apart; the first failure in entry order named.
pub fn verify_chain(entries: &[Value], policy: &Policy, refused: Option<&Refusal>) -> Chain {
    let mut signed = 0usize;
    let mut unsigned = 0usize;
    let mut signers: Vec<String> = Vec::new();
    let mut expected: Option<String> = None;
    if let Some(pk) = &policy.public_key {
        match keys::key_fingerprint(pk) {
            Ok(f) => expected = Some(f),
            Err(_) => {
                return Chain {
                    ok: false,
                    chain_ok: false,
                    signatures_ok: false,
                    anchor_ok: policy.head.as_ref().map(|_| false),
                    length: entries.len(),
                    head: GENESIS.into(),
                    signed: 0,
                    unsigned: 0,
                    signers: vec![],
                    repairs: vec![],
                    broken_at: None,
                    reason: Some("the expected public key could not be read".into()),
                    key_unreadable: true,
                }
            }
        }
    }
    let mut chain_at: Option<(usize, String)> = None;
    let mut sig_at: Option<(usize, String)> = None;
    let mut head = GENESIS.to_string();
    let genesis = Value::s(GENESIS);
    let mut prev: Option<Value> = Some(genesis);
    let mut anchored = policy.head.is_none();
    let mut repairs = Vec::new();
    for (i, e) in entries.iter().enumerate() {
        if e.is_null() {
            if chain_at.is_none() {
                chain_at = Some((i, format!("entry {} is not a ledger entry (the line is JSON null)", i)));
            }
            prev = None;
            unsigned += 1;
            continue;
        }
        let seq = e.get("seq");
        let ph = e.get("prev_hash");
        let hh = e.get("hash");
        if chain_at.is_none() {
            if let Some(r) = refused.filter(|r| r.entry == i) {
                chain_at = Some((i, r.reason.clone()));
            } else if !js_eq(seq, Some(&Value::n(i as f64))) {
                chain_at = Some((i, format!("entry {} has seq {} (reordered or removed entries)", i, js_str(seq))));
            } else if !js_eq(ph, prev.as_ref()) {
                chain_at = Some((i, format!("entry {} does not follow entry {} (chain broken)", i, i as isize - 1)));
            } else if !js_eq(Some(&Value::s(&entry_hash(e))), hh) {
                chain_at = Some((i, format!("entry {} was altered after it was written", i)));
            } else {
                head = hh.and_then(|x| x.as_str()).unwrap_or_default();
            }
        }
        prev = hh.cloned();
        if truthy(e.get("signature")) {
            let (ok, fp) = signature_check(e);
            if !ok {
                if sig_at.is_none() {
                    sig_at = Some((i, format!("entry {} signature does not verify", i)));
                }
            } else {
                if !signers.contains(&fp) {
                    signers.push(fp.clone());
                }
                signed += 1;
                if let Some(x) = &expected {
                    if &fp != x && sig_at.is_none() {
                        sig_at = Some((i, format!("entry {} is signed by key {}, not the expected {} (re-signed by someone else?)", i, fp, x)));
                    }
                }
            }
        } else {
            unsigned += 1;
            if policy.require_signed {
                if sig_at.is_none() {
                    sig_at = Some((i, format!("entry {} is not signed (signatures required)", i)));
                }
            } else if expected.is_some() && sig_at.is_none() {
                sig_at = Some((
                    i,
                    format!(
                        "entry {} is not signed, and a pinned key needs every entry signed by it (an unsigned entry could have been written by anyone)",
                        i
                    ),
                ));
            }
        }
        if let Some(h) = &policy.head {
            if js_eq(hh, Some(&Value::s(h))) && chain_at.as_ref().map_or(true, |c| c.0 > i) {
                anchored = true;
            }
        }
        let b = e.get("body");
        if chain_at.is_none()
            && json::is_str(e.get("kind"), "note")
            && b.map_or(false, |b| b.is_container())
            && json::is_str(b.and_then(|b| b.get("event")), "ledger.torn_tail_quarantined")
        {
            let b = b.unwrap();
            let cut = b.get("cut_entry");
            let after = b.get("after_seq").and_then(|x| x.as_num());
            let cut_entry = match cut {
                Some(c) if c.is_container() => match (c.get("seq").and_then(|x| x.as_num()), c.get("hash").and_then(|x| x.as_str())) {
                    (Some(s), Some(h)) => Some((s, h)),
                    _ => None,
                },
                _ => None,
            };
            repairs.push(Repair {
                seq: i,
                bytes: js_number_of(b.get("bytes")),
                sha256: js_str(b.get("sha256")),
                quarantined_to: js_str(b.get("quarantined_to")),
                after_seq: after,
                cut_entry,
            });
        }
    }
    let first = match (&chain_at, &sig_at) {
        (Some(c), Some(s)) => Some(if c.0 <= s.0 { c.clone() } else { s.clone() }),
        (Some(c), None) => Some(c.clone()),
        (None, s) => s.clone(),
    };
    let anchor_reason = if anchored {
        None
    } else {
        Some(format!(
            "the anchored hash {} is not in this chain (rewritten or truncated since it was recorded)",
            ellipsis16(policy.head.as_deref().unwrap_or(""))
        ))
    };
    let (ok, broken_at, reason) = match (&first, &anchor_reason) {
        (Some(f), _) => (false, Some(f.0), Some(f.1.clone())),
        (None, Some(a)) => (false, None, Some(a.clone())),
        (None, None) => (true, None, None),
    };
    Chain {
        ok,
        chain_ok: chain_at.is_none(),
        signatures_ok: sig_at.is_none(),
        anchor_ok: policy.head.as_ref().map(|_| anchored),
        length: entries.len(),
        head,
        signed,
        unsigned,
        signers,
        repairs,
        broken_at,
        reason,
        key_unreadable: false,
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// head-record.ts

#[derive(Clone, Debug)]
pub struct Layout {
    ends: Vec<usize>,
    crlf: bool,
}

impl Layout {
    fn bytes_through(&self, count: usize) -> Option<usize> {
        if count == 0 {
            Some(0)
        } else {
            self.ends.get(count - 1).copied()
        }
    }
}

/// ledgerLayout: where each entry's line ends, in bytes, and whether the lines end in CR LF.
pub fn ledger_layout(text: &str) -> Layout {
    let mut ends = Vec::new();
    let mut crlf = false;
    let mut offset = 0usize;
    for ln in text.split('\n') {
        let n = ln.len();
        if !js_trim(ln).is_empty() {
            ends.push(offset + n + 1);
            if ln.ends_with('\r') {
                crlf = true;
            }
        }
        offset += n + 1;
    }
    Layout { ends, crlf }
}

#[derive(Clone, Debug)]
pub struct HeadCheck {
    pub file: String,
    pub count: Option<usize>,
    pub head: Option<String>,
    pub bytes: Option<f64>,
    pub file_bytes: Option<usize>,
    pub status: &'static str,
    pub ok: bool,
    pub words: String,
}

impl HeadCheck {
    fn new(file: &str, status: &'static str, ok: bool, words: String) -> HeadCheck {
        HeadCheck { file: file.into(), count: None, head: None, bytes: None, file_bytes: None, status, ok, words }
    }
    pub fn to_obj(&self) -> Obj {
        let mut o = Obj::new();
        o.set("file", Value::s(&self.file));
        if let Some(c) = self.count {
            o.set("count", Value::n(c as f64));
        }
        if let Some(h) = &self.head {
            o.set("head", Value::s(h));
        }
        if let Some(b) = self.bytes {
            o.set("bytes", Value::n(b));
        }
        if let Some(b) = self.file_bytes {
            o.set("file_bytes", Value::n(b as f64));
        }
        o.set("status", Value::s(self.status));
        o.set("ok", Value::Bool(self.ok));
        o.set("words", Value::s(&self.words));
        o
    }
}

/// checkHeadRecord: agrees, behind, absent, skipped, cut, rewritten or unreadable, with its words.
pub fn check_head_record(entries: &[Value], file: &str, text: Option<&str>, skipped: bool, required: bool, layout: Option<&Layout>) -> HeadCheck {
    if skipped {
        return HeadCheck::new(
            file,
            "skipped",
            true,
            format!("head record not read (--no-sidecar); truncation cannot be detected without an anchor: {}", ANCHOR),
        );
    }
    let text = match text {
        None if required => {
            return HeadCheck::new(
                file,
                "absent",
                false,
                format!(
                    "no head record found ({}), so a cut at the end of the file, or the record deleted with it, would not show: verify \
                     against a head you recorded elsewhere (--head <hash>) as well, and pass --no-sidecar to verify without the record \
                     when this ledger never had one",
                    file
                ),
            )
        }
        None => {
            return HeadCheck::new(
                file,
                "absent",
                true,
                format!("no head record found ({}); truncation cannot be detected without an anchor: {}", file, ANCHOR),
            )
        }
        Some(t) => t,
    };
    let unreadable = |why: &str| {
        HeadCheck::new(
            file,
            "unreadable",
            false,
            format!("the head record {} {}, so it cannot say where the ledger ends; delete it, or pass --no-sidecar, to verify without it", file, why),
        )
    };
    let r = match json::parse(text) {
        Ok(r) => r,
        Err(_) => return unreadable("does not parse"),
    };
    let shape = if layout.is_some() { "{ count, head, bytes }" } else { "{ count, head }" };
    let count = r.get("count");
    let head = r.get("head").and_then(|x| x.as_str());
    let rbytes = r.get("bytes");
    let count_ok = is_safe_integer(count) && count.and_then(|c| c.as_num()).unwrap() >= 0.0;
    if !r.is_container() || !count_ok || !head.as_deref().map_or(false, is_hex64) {
        return unreadable(&format!("is not {}", shape));
    }
    if layout.is_some() && !(is_safe_integer(rbytes) && rbytes.and_then(|b| b.as_num()).unwrap() >= 0.0) {
        return unreadable(&format!("is not {}", shape));
    }
    let rbytes: Option<f64> = if layout.is_some() { rbytes.and_then(|b| b.as_num()) } else { None };
    let count = count.and_then(|c| c.as_num()).unwrap() as usize;
    let head = head.unwrap();
    let said = |status: &'static str, ok: bool, words: String, file_bytes: Option<usize>| HeadCheck {
        file: file.into(),
        count: Some(count),
        head: Some(head.clone()),
        bytes: rbytes,
        file_bytes,
        status,
        ok,
        words,
    };
    let h16 = ellipsis16(&head);
    if count == 0 {
        if head != GENESIS {
            return unreadable("records no entries but a head that is not the empty chain's");
        }
        if let Some(b) = rbytes {
            if b != 0.0 {
                return unreadable(&format!("records no entries but {} bytes", json::js_num_str(b)));
            }
        }
        let z = rbytes.map(|_| 0usize);
        if !entries.is_empty() {
            return said(
                "behind",
                true,
                format!("head record {}: no entries; the file holds {}, chained from the start (appended after the record was written)", file, entries.len()),
                z,
            );
        }
        return said("agrees", true, format!("head record {}: no entries, as in the file", file), z);
    }
    let n = entries.len();
    if n < count {
        let k = count - n;
        return said(
            "cut",
            false,
            format!(
                "the file has {} {}; its head record ({}) says {} (head {}); the last {} removed or the file was rewritten; verify against a head \
                 you recorded elsewhere (--head <hash>)",
                n,
                if n == 1 { "entry" } else { "entries" },
                file,
                count,
                h16,
                if k == 1 { "entry was".to_string() } else { format!("{} entries were", k) }
            ),
            None,
        );
    }
    let at = &entries[count - 1];
    let at_hash = if at.is_null() { None } else { at.get("hash") };
    if !js_eq(at_hash, Some(&Value::s(&head))) {
        let detail = match at_hash.and_then(|h| h.as_str()) {
            Some(ah) => format!("is not the one its head record ({}) names (the record says head {}; the file has {} there)", file, h16, ellipsis16(&ah)),
            None => format!("is not a ledger entry, so it is not the one its head record ({}) names (the record says head {})", file, h16),
        };
        return said(
            "rewritten",
            false,
            format!("entry {} {}; the file was rewritten; verify against a head you recorded elsewhere (--head <hash>)", count - 1, detail),
            None,
        );
    }
    let found = layout.and_then(|l| l.bytes_through(count));
    if let (Some(rb), Some(f)) = (rbytes, found) {
        if f as f64 != rb {
            return said(
                "rewritten",
                false,
                format!(
                    "the file holds {} bytes up to the end of entry {}; its head record ({}) says {} (head {}, the same entry): bytes were \
                     added to or removed from the entries it covers, so the file was rewritten; verify against a head you recorded \
                     elsewhere (--head <hash>){}",
                    f,
                    count - 1,
                    file,
                    json::js_num_str(rb),
                    h16,
                    if layout.unwrap().crlf { "; its lines end in CR LF, and a line-ending conversion adds one byte per line" } else { "" }
                ),
                found,
            );
        }
    }
    if n > count {
        return said(
            "behind",
            true,
            format!(
                "head record {}: {} entries, head {}; the file holds {} more, chained after it (appended after the record was written)",
                file,
                count,
                h16,
                n - count
            ),
            found,
        );
    }
    said("agrees", true, format!("head record {}: {} entries, head {}, as in the file", file, count, h16), found)
}

// ---------------------------------------------------------------------------------------------------------------------
// ledger-command.ts (the reading commands)

#[derive(Debug, Clone)]
pub struct ReadFailed {
    pub message: String,
    pub code: &'static str,
}

/// Node's words for a failed read (readFileSync: on Windows Node names the absolute path, elsewhere the path as given).
pub fn read_bytes(cwd: &Path, path: &str) -> Result<Vec<u8>, ReadFailed> {
    let full = cwd.join(path);
    let shown = if cfg!(windows) { crate::paths::normalize(&full).display().to_string() } else { path.to_string() };
    match std::fs::read(&full) {
        Ok(b) => Ok(b),
        Err(e) => {
            if full.is_dir() {
                return Err(ReadFailed { message: "EISDIR: illegal operation on a directory, read".into(), code: "EISDIR" });
            }
            match e.kind() {
                std::io::ErrorKind::NotFound => {
                    Err(ReadFailed { message: format!("ENOENT: no such file or directory, open '{}'", shown), code: "ENOENT" })
                }
                std::io::ErrorKind::PermissionDenied => {
                    Err(ReadFailed { message: format!("EACCES: permission denied, open '{}'", shown), code: "EIO" })
                }
                _ => Err(ReadFailed { message: e.to_string(), code: "EIO" }),
            }
        }
    }
}

/// The bin's readFile: a file's bytes as UTF-8 text, refusing bytes that are not UTF-8 (readLedgerText); a BOM is kept.
pub fn read_ledger_text(cwd: &Path, path: &str) -> Result<String, ReadFailed> {
    let b = read_bytes(cwd, path)?;
    if let Some(at) = strict::invalid_utf8_offset(&b) {
        return Err(ReadFailed {
            message: format!(
                "{} is not valid UTF-8 at byte {}: every file this command reads is UTF-8 (the receipts store writes nothing else), \
                 and reading it would replace those bytes, so two different files would read the same",
                path, at
            ),
            code: "ledger.not_utf8",
        });
    }
    Ok(String::from_utf8_lossy(&b).into_owned())
}

pub fn head_record_path_of(ledger_path: &str) -> String {
    format!("{}.head.json", ledger_path)
}

fn last_segment(p: &str) -> String {
    p.rsplit(['\\', '/']).next().unwrap_or(p).to_string()
}

enum HeadFor {
    Check(HeadCheck),
    Error(String),
}

/// headRecordFor: the head-record check, or an error when the record exists and cannot be read (exit 3).
fn head_record_for(cwd: &Path, file: &str, entries: &[Value], skip: bool, required: bool, ledger_text: &str) -> HeadFor {
    let hp = head_record_path_of(file);
    let name = last_segment(&hp);
    if skip {
        return HeadFor::Check(check_head_record(entries, &name, None, true, false, None));
    }
    let rtext = match read_ledger_text(cwd, &hp) {
        Ok(t) => Some(t),
        Err(e) if matches!(e.code, "ENOENT" | "ENOTDIR") => None,
        Err(e) => return HeadFor::Error(format!("cannot read the head record {}: {} (pass --no-sidecar to verify without it)", hp, e.message)),
    };
    match rtext {
        None => HeadFor::Check(check_head_record(entries, &name, None, false, required, None)),
        Some(t) => HeadFor::Check(check_head_record(entries, &name, Some(&t), false, required, Some(&ledger_layout(ledger_text)))),
    }
}

/// publicOf: the public PEM and fingerprint of a PEM holding a public or a private Ed25519 key.
pub fn public_of(pem: &str) -> Result<(String, String), keys::KeyErr> {
    let pk = keys::public_key_bytes(pem)?;
    Ok((keys::spki_pem(&pk), keys::fingerprint_of(&pk)))
}

fn result(code: i32, out: String, err: String) -> CmdResult {
    CmdResult { code, out, err }
}

fn is_envelope(x: &Value) -> bool {
    x.is_obj() && x.get("verdict").map_or(false, |v| v.is_obj()) && x.get("signature").map_or(false, |s| s.as_jstr().is_some())
}

/// riposte-ledger verify-signature: an envelope's Ed25519 signature over the canonical JSON of its verdict, offline.
fn verify_signature_command(cwd: &Path, file: &str, rest: &[String]) -> CmdResult {
    let usage = |msg: &str| result(3, String::new(), format!("{}\n{}\n", msg, USAGE));
    let mut trusted_spec: Option<String> = None;
    let mut i = 0;
    while i < rest.len() {
        let a = &rest[i];
        if a != "--trusted-key" {
            return usage(&format!("unknown option {}", a));
        }
        i += 1;
        match rest.get(i) {
            Some(v) if !v.starts_with("--") => trusted_spec = Some(v.clone()),
            _ => return usage("--trusted-key needs a value: a public key PEM file, or the 64-hex fingerprint"),
        }
        i += 1;
    }
    let js = match read_ledger_text(cwd, file) {
        Err(e) => return result(3, String::new(), format!("cannot read {}: {}\n", file, e.message)),
        Ok(t) => match strict::parse_json_strict(&t, file) {
            Ok(v) => v,
            Err(e) => return result(3, String::new(), format!("{}\n", e.message())),
        },
    };
    let mut trusted: Option<String> = None;
    if let Some(spec) = &trusted_spec {
        if is_hex64(spec) {
            trusted = Some(spec.clone());
        } else {
            let pem = match read_ledger_text(cwd, spec) {
                Ok(p) => p,
                Err(e) => {
                    return result(
                        3,
                        String::new(),
                        format!("--trusted-key: cannot read {}: {} (give a public key PEM file, or the 64-hex fingerprint)\n", spec, e.message),
                    )
                }
            };
            if pem.contains("PRIVATE KEY") {
                return result(3, String::new(), "--trusted-key is a private key: give the public key whose signature counts (never a private key)\n".into());
            }
            match keys::key_fingerprint(&pem) {
                Ok(f) => trusted = Some(f),
                Err(e) => return result(3, String::new(), format!("--trusted-key: {} is not a public key in PEM: {}\n", spec, e)),
            }
        }
    }
    let env: Value = if is_envelope(&js) {
        js.clone()
    } else if js.is_obj() && js.get("verdict").map_or(false, is_envelope) {
        js.get("verdict").unwrap().clone()
    } else if js.is_obj()
        && (js.get("verdict").map_or(false, |v| v.is_obj() && v.get("verdict_id").map_or(false, |x| x.as_jstr().is_some()))
            || js.get("verdict_id").map_or(false, |x| x.as_jstr().is_some()))
    {
        let vid = if js.get("verdict").map_or(false, |v| v.is_obj()) {
            js.get("verdict").unwrap().get("verdict_id").cloned().unwrap()
        } else {
            js.get("verdict_id").cloned().unwrap()
        };
        let o = Value::obj(vec![("ok", Value::Bool(false)), ("signature_ok", Value::Bool(false)), ("verdict_id", vid), ("reason", Value::s("not signed"))]);
        return result(
            1,
            json::pretty(&o) + "\n",
            format!(
                "NOT VERIFIED: not signed: {} carries a verdict with no envelope {{ verdict, alg, public_key, signature }}; riposte-ledger sign writes one\n",
                file
            ),
        );
    } else {
        return result(3, String::new(), format!("{}: not a signed envelope, a replay bundle carrying one, or a verdict\n", file));
    };
    let issuer = keys::key_fingerprint(&js_str(env.get("public_key"))).unwrap_or_else(|_| "?".into());
    let verdict_id = env.get("verdict").and_then(|v| v.get("verdict_id")).cloned();
    let mut reason: Option<String> = None;
    let mut signature_ok = false;
    if !json::is_str(env.get("alg"), "ed25519") {
        reason = Some(format!("unsupported alg: {}", js_str(env.get("alg"))));
    } else {
        match env.get("public_key").and_then(|p| p.as_str()) {
            None => reason = Some("signature verification errored: the public key is not a string".into()),
            Some(pem) => {
                let msg = json::canonicalize(env.get("verdict").unwrap());
                match keys::verify_pem(&pem, msg.as_bytes(), &env.get("signature").and_then(|s| s.as_str()).unwrap_or_default()) {
                    Ok(true) => signature_ok = true,
                    Ok(false) => reason = Some("signature does not verify — the verdict body was altered, or the key does not match".into()),
                    Err(e) => reason = Some(format!("signature verification errored: {}", e)),
                }
            }
        }
    }
    let with_vid = |o: &mut Obj| {
        if let Some(v) = &verdict_id {
            o.set("verdict_id", v.clone());
        }
    };
    if !signature_ok {
        let extra = match &reason {
            Some(r) if !r.starts_with("signature does not verify") => format!("{}\n", r),
            _ => String::new(),
        };
        let mut o = Obj::new();
        o.set("ok", Value::Bool(false));
        o.set("signature_ok", Value::Bool(false));
        with_vid(&mut o);
        o.set("issuer_fingerprint", Value::s(&issuer));
        o.set("reason", Value::s("the signature does not verify: the verdict body was altered, or the key does not match"));
        return result(
            1,
            json::pretty(&Value::Obj(o)) + "\n",
            format!("NOT VERIFIED: the signature does not verify: the verdict body was altered, or the key does not match\n{}", extra),
        );
    }
    if let Some(t) = &trusted {
        if t != &issuer {
            let mut o = Obj::new();
            o.set("ok", Value::Bool(false));
            o.set("signature_ok", Value::Bool(true));
            with_vid(&mut o);
            o.set("issuer_fingerprint", Value::s(&issuer));
            o.set("trusted", Value::Bool(false));
            return result(
                1,
                json::pretty(&Value::Obj(o)) + "\n",
                format!(
                    "NOT VERIFIED: signed by {}, which is not the trusted key ({}); the signature verifies, but it proves only that the holder of that \
                     other key issued the verdict\n",
                    issuer, t
                ),
            );
        }
    }
    let mut o = Obj::new();
    o.set("ok", Value::Bool(true));
    o.set("signature_ok", Value::Bool(true));
    with_vid(&mut o);
    o.set("issuer_fingerprint", Value::s(&issuer));
    if trusted.is_some() {
        o.set("trusted", Value::Bool(true));
    }
    result(
        0,
        json::pretty(&Value::Obj(o)) + "\n",
        format!(
            "OK: the signature verifies{}; issuer fingerprint {}\nnote: this checks the signature, not the verdict: riposte-replay or verify \
             replay re-performs it\n",
            if trusted.is_some() { ", by the trusted key" } else { "" },
            issuer
        ),
    )
}

/// The reading half of ledgerCli: verify, summary, fingerprint and verify-signature, run with `cwd` as the working folder.
pub fn ledger_cli(argv: &[String], cwd: &Path) -> CmdResult {
    let cmd = argv.first().map(String::as_str);
    let file = argv.get(1).map(String::as_str);
    let rest: Vec<String> = argv.iter().skip(2).cloned().collect();
    let usage = |msg: Option<&str>| match msg {
        Some(m) => result(3, String::new(), format!("{}\n{}\n", m, USAGE)),
        None => result(0, String::new(), format!("{}{}\n", USAGE, HELP_TAIL)),
    };
    if cmd.is_none() || matches!(cmd, Some("--help") | Some("-h")) || matches!(file, Some("--help") | Some("-h")) {
        return usage(None);
    }
    let cmd = cmd.unwrap();
    let file = match file {
        None => return usage(Some(&format!("{} needs a file", cmd))),
        Some(f) => f,
    };
    if matches!(cmd, "rule" | "sign" | "case") {
        return result(3, String::new(), format!("{} writes; this reader only reads (node packages/receipts/dist/ledger-cli.js {} ...)\n", cmd, cmd));
    }
    if cmd == "verify-signature" {
        return verify_signature_command(cwd, file, &rest);
    }
    let text = match read_ledger_text(cwd, file) {
        Ok(t) => t,
        Err(e) => return result(3, String::new(), format!("cannot read {}: {}\n", file, e.message)),
    };
    if cmd == "fingerprint" {
        if let Some(a) = rest.iter().find(|a| a.as_str() != "--short") {
            return usage(Some(&format!("unknown option {}", a)));
        }
        let short = rest.iter().any(|a| a == "--short");
        let (pem, fp) = match public_of(&text) {
            Ok(p) => p,
            Err(e) => return result(3, String::new(), format!("not a key: {}\n", e)),
        };
        let mut o = Obj::new();
        o.set("public_key", Value::s(&pem));
        o.set("fingerprint", Value::s(&fp));
        if short {
            o.set("short", Value::s(&fp[..16]));
        }
        let tail = if short { format!("\nshort {} (for display only: pin the full fingerprint)", &fp[..16]) } else { String::new() };
        return result(0, json::pretty(&Value::Obj(o)) + "\n", format!("fingerprint {}{}\n", fp, tail));
    }
    let parsed = match parse_ledger_tolerant(&text, true) {
        Ok(p) => p,
        Err(e) => return result(3, String::new(), format!("{}: {}\n", file, e)),
    };
    let entries = &parsed.entries;
    if let Some(t) = &parsed.torn {
        if cmd != "verify" {
            return result(
                3,
                String::new(),
                format!("{}: line {} is not JSON (a torn tail of {} bytes: riposte-ledger verify says more)\n", file, entries.len() + 1, t.bytes),
            );
        }
    }
    if cmd == "summary" {
        if let Some(a) = rest.iter().find(|a| a.as_str() != "--no-sidecar") {
            return usage(Some(&format!("unknown option {}", a)));
        }
        let hr = match head_record_for(cwd, file, entries, rest.iter().any(|a| a == "--no-sidecar"), false, &text) {
            HeadFor::Error(e) => return result(3, String::new(), format!("{}\n", e)),
            HeadFor::Check(h) => h,
        };
        let mut kinds = Obj::new();
        for e in entries {
            let k = json::JStr::new(&js_str(if e.is_null() { None } else { e.get("kind") }));
            let n = kinds.get_j(&k).and_then(|x| x.as_num()).unwrap_or(0.0);
            kinds.set_j(k, Value::n(n + 1.0));
        }
        let c = verify_chain(entries, &Policy::default(), parsed.refused.as_ref());
        let at_of = |e: &Value| -> Option<Value> {
            match e {
                Value::Null => Some(Value::Null),
                Value::Str(_) | Value::Arr(_) => None, // String.prototype.at and Array.prototype.at: a function, which JSON leaves out
                _ => Some(e.get("at").cloned().unwrap_or(Value::Null)),
            }
        };
        let mut s = Obj::new();
        s.set("entries", Value::n(entries.len() as f64));
        s.set("kinds", Value::Obj(kinds));
        match entries.first() {
            None => s.set("first_at", Value::Null),
            Some(e) => {
                if let Some(v) = at_of(e) {
                    s.set("first_at", v)
                }
            }
        }
        match entries.last() {
            None => s.set("last_at", Value::Null),
            Some(e) => {
                if let Some(v) = at_of(e) {
                    s.set("last_at", v)
                }
            }
        }
        s.set("head", Value::s(&c.head));
        s.set("chain_ok", Value::Bool(c.chain_ok));
        s.set("signatures_ok", Value::Bool(c.signatures_ok));
        s.set("signed", Value::n(c.signed as f64));
        s.set("unsigned", Value::n(c.unsigned as f64));
        s.set("signers", Value::strs(&c.signers));
        if let Some(r) = &c.reason {
            s.set("reason", Value::s(r));
        }
        s.set("head_record", Value::Obj(hr.to_obj()));
        return result(
            if c.ok && hr.ok { 0 } else { 1 },
            json::pretty(&Value::Obj(s)) + "\n",
            if hr.ok { String::new() } else { format!("{}\n", hr.words) },
        );
    }
    if cmd != "verify" {
        return usage(Some(&format!("unknown command {}", cmd)));
    }
    let mut policy = Policy::default();
    let mut want: Option<String> = None;
    let mut proof_file: Option<String> = None;
    let mut no_sidecar = false;
    let mut i = 0;
    while i < rest.len() {
        let a = rest[i].as_str();
        match a {
            "--require-signed" => policy.require_signed = true,
            "--no-sidecar" => no_sidecar = true,
            "--key" | "--head" | "--proof" | "--entry" => {
                i += 1;
                let v = match rest.get(i) {
                    Some(v) if !v.is_empty() => v.clone(),
                    _ => return usage(Some(&format!("{} needs a value", a))),
                };
                match a {
                    "--head" => policy.head = Some(v),
                    "--proof" => proof_file = Some(v),
                    "--entry" => want = Some(v),
                    _ => match read_ledger_text(cwd, &v) {
                        Err(e) => return result(3, String::new(), format!("cannot use key {}: {}\n", v, e.message)),
                        Ok(pem) => match public_of(&pem) {
                            Ok((p, _)) => policy.public_key = Some(p),
                            Err(e) => return result(3, String::new(), format!("cannot use key {}: {}\n", v, e)),
                        },
                    },
                }
            }
            _ => return usage(Some(&format!("unknown option {}", a))),
        }
        i += 1;
    }
    if want.is_some() && proof_file.is_none() {
        return usage(Some("--entry names the receipt a --proof binds to: give --proof too"));
    }
    if let Some(p) = proof_file {
        return result(
            3,
            String::new(),
            format!(
                "--proof is outside what this reader checks: the binding of a proof to its ap_gate receipt is riposte-ledger verify --proof's \
                 (node packages/receipts/dist/ledger-cli.js verify {} --proof {})\n",
                file, p
            ),
        );
    }
    let c = verify_chain(entries, &policy, parsed.refused.as_ref());
    let hr = match head_record_for(cwd, file, entries, no_sidecar, true, &text) {
        HeadFor::Error(e) => return result(3, String::new(), format!("{}\n", e)),
        HeadFor::Check(h) => h,
    };
    let torn = parsed.torn.as_ref();
    let report = verify_report(&c, &hr, &policy, torn, parsed.no_final_newline, file);
    result(report.0, report.1, report.2)
}

/// The words and the object of `verify`: (exit, stdout, stderr).
pub fn verify_report(c: &Chain, hr: &HeadCheck, policy: &Policy, torn: Option<&Torn>, no_final_newline: bool, file: &str) -> (i32, String, String) {
    let anchored = policy.public_key.is_some() || policy.require_signed || policy.head.is_some();
    let warn = if anchored {
        ""
    } else {
        "note: no trust anchor given (--key, --require-signed or --head). This proves the file is internally consistent, not that nobody rewrote all of it.\n"
    };
    let signers = if c.signers.is_empty() { "no keys".to_string() } else { c.signers.join(", ") };
    let counts = format!("{} entries, head {} · {} signed ({}) · {} unsigned", c.length, ellipsis16(&c.head), c.signed, signers, c.unsigned);
    let torn_cut = if torn.is_some() && hr.status == "cut" { " (the unfinished line at the end of the file may be that entry: see TORN TAIL)" } else { "" };
    let sig_note = if c.signatures_ok {
        "signatures_ok is true because each signature covers the hash its entry records, not the entry's body or its place in the chain: \
         with the chain broken it does not vouch for this file. Read ok, which is false\n"
    } else {
        ""
    };
    let line = if !c.chain_ok {
        format!(
            "BROKEN: chain\nBROKEN at entry {}: {}\n{}",
            c.broken_at.map(|b| b.to_string()).unwrap_or_else(|| "-".into()),
            c.reason.as_deref().unwrap_or(""),
            sig_note
        )
    } else if !c.ok {
        format!("NOT VERIFIED: {}; the hash chain itself holds ({})\n", c.reason.as_deref().unwrap_or(""), counts)
    } else if !hr.ok {
        let st = hr.status;
        let lead = if st == "cut" { "BROKEN at the tail" } else if st == "rewritten" { "BROKEN" } else { "NOT VERIFIED" };
        let why = if st == "cut" {
            "that does not show nothing was removed after them"
        } else if st == "rewritten" {
            "a consistent chain is what a rewrite by the key holder looks like"
        } else {
            "without a readable head record, a cut at the tail would not show"
        };
        format!("{}: {}{}\nthe entries in the file chain correctly on their own ({}); {}\n", lead, hr.words, torn_cut, counts, why)
    } else if let Some(t) = torn {
        format!(
            "NOT VERIFIED: torn tail. {}; the entries before it chain correctly on their own ({})\n",
            if t.ends_in_newline { "The file's last line is not a whole entry" } else { "The file ends in an unfinished line" },
            counts
        )
    } else {
        format!("OK: {}\n", counts)
    };
    let hr_line = if !hr.ok {
        if c.ok {
            String::new()
        } else {
            format!("head record: {}\n", hr.words)
        }
    } else if hr.status == "agrees" || hr.status == "behind" {
        format!(
            "{}{}\n",
            hr.words,
            if policy.head.is_some() {
                ""
            } else {
                ". It is written beside the file by the same process, so it catches a cut that left it behind, not one that rewrote it too: \
                 --head <hash>, recorded somewhere you control, is the anchor"
            }
        )
    } else if policy.head.is_some() {
        format!(
            "note: {}; the --head you gave is the anchor\n",
            if hr.status == "skipped" { "head record not read (--no-sidecar)".to_string() } else { format!("no head record found ({})", hr.file) }
        )
    } else {
        format!("note: {}\n", hr.words)
    };
    let next_step = torn.map(|t| {
        format!(
            "Next: truncate the file after entry {} and verify again, or restore it from a copy that matches its head record (<ledger>.head.json)",
            t.after_line as isize - 1
        )
    });
    let torn_line = match torn {
        None => String::new(),
        Some(t) if t.ends_in_newline => format!(
            "TORN TAIL: the file's last line is not a whole entry ({} bytes after entry {}), and a newline follows it, which a crash \
             mid-append does not leave: a cut or an edit. The entries before it are checked above. {}.\n",
            t.bytes,
            t.after_line as isize - 1,
            next_step.clone().unwrap()
        ),
        Some(t) => format!(
            "TORN TAIL: the file ends in an unfinished line ({} bytes after entry {}): a crash mid-append. The entries before it are \
             checked above; the receipts file store moves those bytes to <ledger>.torn-<stamp> and records it when it next opens this \
             ledger. {}, or let the store do it.\n",
            t.bytes,
            t.after_line as isize - 1,
            next_step.clone().unwrap()
        ),
    };
    let newline_line = if no_final_newline {
        format!(
            "note: the last line has no newline after it. Every entry is whole and was checked. The receipts file store reads the bytes \
             after the last newline as an unfinished line and moves them aside when it next opens this ledger, so add the newline \
             first (printf '\\n' >> {})\n",
            file
        )
    } else {
        String::new()
    };
    let mut repair_lines = String::new();
    for r in &c.repairs {
        repair_lines += &format!(
            "quarantined: entry {} records a torn tail of {} bytes (sha256 {}) moved to {}{}",
            r.seq,
            json::js_num_str(r.bytes),
            ellipsis16(&r.sha256),
            r.quarantined_to,
            r.after_seq.map(|a| format!(" after entry {}", json::js_num_str(a))).unwrap_or_default()
        );
        if let Some((s, h)) = &r.cut_entry {
            repair_lines += &format!(
                "; the cut went through entry {} (hash {}), which had been written: that entry is lost from this file (a disk fault \
                 or an edit, not a crash)",
                json::js_num_str(*s),
                ellipsis16(h)
            );
        }
        repair_lines.push('\n');
    }
    let ok = c.ok && hr.ok && torn.is_none();
    let reason: Option<String> = if !c.ok {
        c.reason.clone()
    } else if !hr.ok {
        Some(hr.words.clone())
    } else if let Some(t) = torn {
        Some(if t.ends_in_newline {
            format!(
                "torn tail: the last line is not a whole entry ({} bytes after entry {}, a newline after it): a cut or an edit, not a crash mid-append",
                t.bytes,
                t.after_line as isize - 1
            )
        } else {
            format!("torn tail: the file ends in an unfinished line ({} bytes after entry {}), a crash mid-append", t.bytes, t.after_line as isize - 1)
        })
    } else {
        None
    };
    let mut out = c.to_obj();
    out.set("ok", Value::Bool(ok));
    if let Some(r) = reason {
        out.set("reason", Value::s(&r));
    }
    out.set("head_record", Value::Obj(hr.to_obj()));
    if let Some(t) = torn {
        let mut o = Obj::new();
        o.set("bytes", Value::n(t.bytes as f64));
        o.set("after_line", Value::n(t.after_line as f64));
        if t.ends_in_newline {
            o.set("ends_in_newline", Value::Bool(true));
        }
        out.set("torn_tail", Value::Obj(o));
    }
    if no_final_newline {
        out.set("no_final_newline", Value::Bool(true));
    }
    (
        if ok { 0 } else { 1 },
        json::pretty(&Value::Obj(out)) + "\n",
        format!("{}{}{}{}{}{}", line, hr_line, newline_line, torn_line, repair_lines, warn),
    )
}

/// Verify a ledger held in memory (the C ABI's entry): its text, the head record's text if one is given (none is --no-sidecar),
/// and a public key to pin. The exit code of `verify`: 0 verified, 1 not verified, 3 the text cannot be read as a ledger.
pub fn verify_text(text: &str, head_record: Option<&str>, key_pem: Option<&str>, require_signed: bool) -> (i32, String, String) {
    let mut policy = Policy { require_signed, ..Policy::default() };
    if let Some(k) = key_pem {
        match public_of(k) {
            Ok((p, _)) => policy.public_key = Some(p),
            Err(e) => return (3, String::new(), format!("cannot use key: {}\n", e)),
        }
    }
    let parsed = match parse_ledger_tolerant(text, true) {
        Ok(p) => p,
        Err(e) => return (3, String::new(), format!("ledger: {}\n", e)),
    };
    let c = verify_chain(&parsed.entries, &policy, parsed.refused.as_ref());
    let hr = match head_record {
        None => check_head_record(&parsed.entries, "head record", None, true, false, None),
        Some(h) => check_head_record(&parsed.entries, "head record", Some(h), false, true, Some(&ledger_layout(text))),
    };
    verify_report(&c, &hr, &policy, parsed.torn.as_ref(), parsed.no_final_newline, "ledger")
}

// ---------------------------------------------------------------------------------------------------------------------
// For the frag reader: the record as frag.ts reads it (record.ts readRecord)

pub struct Record {
    pub entries: Vec<Value>,
    pub chain: Chain,
    pub head: HeadCheck,
    pub torn_bytes: Option<usize>,
}

/// readRecord: the text read as readFileSync(file, 'utf8') reads it (bytes that are not UTF-8 replaced); the head record's
/// byte count is not compared, as frag open does not compare it. Err: the record cannot be read.
pub fn read_record(file: &Path, shown: &str, issuer_pem: Option<&str>) -> Result<Record, String> {
    if !file.exists() {
        return Err(format!("{}: no such record", shown));
    }
    let text = String::from_utf8_lossy(&std::fs::read(file).map_err(|e| e.to_string())?).into_owned();
    let parsed = parse_ledger_tolerant(&text, false).map_err(|e| format!("{}: not a receipts ledger ({})", shown, e))?;
    let policy = Policy { public_key: issuer_pem.map(String::from), require_signed: true, head: None };
    let chain = verify_chain(&parsed.entries, &policy, None);
    let side = std::path::PathBuf::from(format!("{}.head.json", file.display()));
    let side_text = if side.exists() { std::fs::read(&side).ok().map(|b| String::from_utf8_lossy(&b).into_owned()) } else { None };
    let name = side.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let head = check_head_record(&parsed.entries, &name, side_text.as_deref(), false, true, None);
    Ok(Record { torn_bytes: parsed.torn.map(|t| t.bytes), entries: parsed.entries, chain, head })
}
