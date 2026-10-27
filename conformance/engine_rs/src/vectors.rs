// SPDX-License-Identifier: Apache-2.0
//! The record vectors (riposte.record-vectors/0.1.0, conformance/record/SPEC.md) run against this crate: every case of the seven
//! parts, each answered pass or not with the reason, the same rules check.mjs and check.py apply. The file is read, never written.

use crate::json::{self, Value};
use crate::{frag, keys, ledger, strict, workgraph, CmdResult};
use std::path::{Path, PathBuf};

pub const SCHEMA: &str = "riposte.record-vectors/0.1.0";
pub const PARTS: [&str; 7] = ["canonical", "strict", "hashes", "ed25519", "ledger", "frag", "workgraph"];

/// The cases this reader does not meet, by part and name, with the reason: what a verify-only reader cannot say.
pub const NAMED: [(&str, &str, &str); 5] = [
    (
        "frag",
        "a release frag: intact and re-performed",
        "re-performs a release claim (the engine label closed below an open one): tier 1 carries no engine, so it answers can't tell (exit 2) where Node answers 0",
    ),
    (
        "frag",
        "the issuer pinned by a key file given on the command line",
        "the same release claim, re-performed by Node: tier 1 answers can't tell (exit 2)",
    ),
    (
        "frag",
        "a pin that differs from the tree: noted, not tampering",
        "the same release claim, re-performed by Node: tier 1 answers can't tell (exit 2)",
    ),
    (
        "frag",
        "a verdict frag that replays PASS (with a contract, evidence and history)",
        "replays a verdict through the engine: tier 1 does not re-perform verdicts, so it answers can't tell (exit 2)",
    ),
    (
        "frag",
        "a verdict frag that replays FAIL",
        "replays a verdict through the engine (exit 1 is the replayed FAIL): tier 1 answers can't tell (exit 2) and never says re-performed",
    ),
];

pub fn named_reason(part: &str, name: &str) -> Option<&'static str> {
    NAMED.iter().find(|(p, n, _)| *p == part && *n == name).map(|(_, _, r)| *r)
}

/// One case's outcome.
#[derive(Debug, Clone)]
pub struct Outcome {
    pub part: String,
    pub name: String,
    /// None: as expected. Some(why): not.
    pub failure: Option<String>,
    /// With --words: the whole streams compared too (command parts only; None elsewhere or when they agree).
    pub words_failure: Option<String>,
}

pub fn load(path: &Path) -> Result<Value, String> {
    let b = std::fs::read(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    let v = json::parse(&String::from_utf8_lossy(&b)).map_err(|e| format!("{}: {}", path.display(), e))?;
    if !json::is_str(v.get("schema"), SCHEMA) {
        return Err(format!("not {}: {}", SCHEMA, json::js_str(v.get("schema"))));
    }
    Ok(v)
}

fn bytes_of(f: &Value) -> Vec<u8> {
    if let Some(Value::Str(s)) = f.get("utf8") {
        s.lossy().into_bytes()
    } else {
        keys::b64_strict(&json::str_of(f.get("base64")).unwrap_or_default()).unwrap_or_default()
    }
}

/// A case's files: its fixture with its change applied (null removes; { replace: [a, b] } swaps the first a for b).
fn files_of(cases: &Value, c: &Value) -> Result<Vec<(String, Vec<u8>)>, String> {
    let empty = json::Obj::new();
    let fx = c
        .get("fixture")
        .and_then(|f| f.as_str())
        .and_then(|f| cases.get("fixtures").and_then(|x| x.get(&f)).and_then(|x| x.as_obj()).cloned())
        .unwrap_or(empty);
    let mut out: Vec<(String, Vec<u8>)> = fx.0.iter().map(|(k, v)| (k.lossy(), bytes_of(v))).collect();
    if let Some(ch) = c.get("change").and_then(|x| x.as_obj()) {
        for (p, v) in &ch.0 {
            let p = p.lossy();
            let pos = out.iter().position(|(k, _)| *k == p);
            match v {
                Value::Null => match pos {
                    None => return Err(format!("change: {} is not in the fixture", p)),
                    Some(i) => {
                        out.remove(i);
                    }
                },
                Value::Obj(o) if o.get("replace").and_then(|r| r.as_arr()).is_some() => {
                    let i = pos.ok_or_else(|| format!("change: {} is not in the fixture", p))?;
                    let r = o.get("replace").unwrap().as_arr().unwrap();
                    let a = json::str_of(r.first()).unwrap_or_default();
                    let b = json::str_of(r.get(1)).unwrap_or_default();
                    let t = String::from_utf8_lossy(&out[i].1).into_owned();
                    let at = t.find(&a).ok_or_else(|| format!("change: {:?} is not in {}", &a.chars().take(40).collect::<String>(), p))?;
                    out[i].1 = format!("{}{}{}", &t[..at], b, &t[at + a.len()..]).into_bytes();
                }
                other => {
                    let b = bytes_of(other);
                    match pos {
                        Some(i) => out[i].1 = b,
                        None => out.push((p, b)),
                    }
                }
            }
        }
    }
    Ok(out)
}

fn source_text(cases: &Value, s: &Value) -> String {
    let fx = json::str_of(s.get("fixture")).unwrap_or_default();
    let file = json::str_of(s.get("file")).unwrap_or_default();
    let f = cases.get("fixtures").and_then(|x| x.get(&fx)).and_then(|x| x.get(&file)).cloned().unwrap_or(Value::Null);
    let t = String::from_utf8_lossy(&bytes_of(&f)).into_owned();
    match s.get("line").and_then(|l| l.as_num()) {
        None => t,
        Some(n) => t.split('\n').nth(n as usize).unwrap_or("").to_string(),
    }
}

fn source(cases: &Value, c: &Value) -> Result<Value, String> {
    json::parse(&source_text(cases, c.get("source").unwrap_or(&Value::Null)))
}

/// A fresh folder under `tmp` holding the files; removed when dropped.
struct CaseDir(PathBuf);

impl CaseDir {
    fn new(tmp: &Path, files: &[(String, Vec<u8>)]) -> Result<CaseDir, String> {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static N: AtomicUsize = AtomicUsize::new(0);
        let d = tmp.join(format!("record-vectors-case-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
        for (p, b) in files {
            let mut t = d.clone();
            for seg in p.split('/') {
                t.push(seg);
            }
            std::fs::create_dir_all(t.parent().unwrap()).map_err(|e| e.to_string())?;
            std::fs::write(&t, b).map_err(|e| e.to_string())?;
        }
        Ok(CaseDir(d))
    }
}

impl Drop for CaseDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn show(s: &str) -> String {
    let q = json::js_string_str(s);
    if q.chars().count() > 160 {
        format!("{}...", q.chars().take(157).collect::<String>())
    } else {
        q
    }
}

/// check.mjs commandDifference: why a command's result is not the case's (None when it is).
fn command_difference(r: &CmdResult, e: &Value, words: bool) -> Option<String> {
    let exit = e.get("exit").and_then(|x| x.as_num()).unwrap_or(-99.0) as i32;
    if json::truthy(e.get("threw")) {
        return if r.code == exit { None } else { Some(format!("exit {}, expected {} (the Node tool stops with an exception here)", r.code, exit)) };
    }
    let stream = if json::is_str(e.get("stream"), "stdout") { &r.out } else { &r.err };
    let head: Vec<String> = e.get("head").and_then(|h| h.as_arr()).map(|a| a.iter().map(|x| json::js_str(Some(x))).collect()).unwrap_or_default();
    if r.code != exit {
        let first = if !stream.is_empty() { stream } else if !r.out.is_empty() { &r.out } else { &r.err };
        return Some(format!(
            "exit {}, expected {}{}; {}",
            r.code,
            exit,
            head.first().map(|h| format!(" ({})", show(h))).unwrap_or_default(),
            show(first.split('\n').next().unwrap_or(""))
        ));
    }
    let lines: Vec<&str> = stream.split('\n').collect();
    for (i, want) in head.iter().enumerate() {
        let got = lines.get(i).copied();
        if got != Some(want.as_str()) {
            return Some(format!("{} line {} is {}, expected {}", json::js_str(e.get("stream")), i + 1, got.map(show).unwrap_or_else(|| "nothing".into()), show(want)));
        }
    }
    if words {
        for (name, got) in [("stdout", &r.out), ("stderr", &r.err)] {
            let want = json::str_of(e.get(name)).unwrap_or_default();
            if *got != want {
                let a: Vec<&str> = got.split('\n').collect();
                let b: Vec<&str> = want.split('\n').collect();
                let n = (0..a.len().max(b.len())).find(|i| a.get(*i) != b.get(*i)).unwrap_or(0);
                return Some(format!(
                    "{} differs at line {}: {}, expected {}",
                    name,
                    n + 1,
                    a.get(n).map(|x| show(x)).unwrap_or_else(|| "nothing".into()),
                    b.get(n).map(|x| show(x)).unwrap_or_else(|| "nothing".into())
                ));
            }
        }
    }
    None
}

fn eq_expect(got: &Value, want: Option<&Value>) -> bool {
    match want {
        None => true,
        Some(w) => json::canonicalize(got) == json::canonicalize(w),
    }
}

fn hash_case(cases: &Value, c: &Value, tmp: &Path) -> Result<Value, String> {
    let rule = json::str_of(c.get("rule")).unwrap_or_default();
    let text = || json::parse(&json::str_of(c.get("text")).unwrap_or_default());
    Ok(match rule.as_str() {
        "sha256_canonical" => Value::obj(vec![("sha256", Value::s(&json::hash_of(&text()?)))]),
        "verdict_id" => {
            let rs = c.get("ruleset").cloned().unwrap_or(Value::Null);
            let remedy = json::str_of(c.get("remedy_table_hash"));
            let id = crate::derive_verdict_id(
                &json::js_str(c.get("input_hash")),
                &json::js_str(rs.get("id")),
                &json::js_str(rs.get("version")),
                &json::js_str(c.get("engine_version")),
                remedy.as_deref(),
            );
            Value::obj(vec![("verdict_id", Value::s(&id))])
        }
        "frag_id" => {
            let f = source(cases, c)?;
            Value::obj(vec![("frag_id", Value::s(&frag::frag_id_of(&f))), ("body_sha256", Value::s(&frag::body_sha256(&f)))])
        }
        "entry_hash" => {
            let e = match c.get("entry") {
                Some(e) => e.clone(),
                None => source(cases, c)?,
            };
            Value::obj(vec![("hash", Value::s(&ledger::entry_hash(&e)))])
        }
        "work_frag_id" => Value::obj(vec![("id", Value::s(&workgraph::frag_id(&source(cases, c)?)))]),
        "charter_id" => Value::obj(vec![("id", Value::s(&workgraph::charter_id(&source(cases, c)?)))]),
        "bundle_sha256" => {
            let d = source(cases, c)?;
            let body = d.as_obj().map(|o| Value::Obj(o.without(&["bundle_sha256"]))).unwrap_or(d);
            Value::obj(vec![("bundle_sha256", Value::s(&json::hash_of(&body)))])
        }
        "index_chain" => {
            let t = source_text(cases, &{
                let s = c.get("source").cloned().unwrap_or(Value::Null);
                // the whole file, never one line of it
                match s {
                    Value::Obj(o) => Value::Obj(o.without(&["line"])),
                    x => x,
                }
            });
            let mut lines: Vec<&str> = t.split('\n').collect();
            if lines.last() == Some(&"") {
                lines.pop();
            }
            Value::obj(vec![
                ("line_sha256", Value::Arr(lines.iter().map(|l| Value::s(&json::sha256_text(l))).collect())),
                (
                    "head_record",
                    Value::obj(vec![
                        ("bytes", Value::n(t.len() as f64)),
                        ("count", Value::n(lines.len() as f64)),
                        ("head", Value::s(&lines.last().map(|l| json::sha256_text(l)).unwrap_or_else(|| "0".repeat(64)))),
                    ]),
                ),
            ])
        }
        "pin_rule" => {
            let s = c.get("source").cloned().unwrap_or(Value::Null);
            let fx = json::str_of(s.get("fixture")).unwrap_or_default();
            let folder = json::str_of(s.get("folder")).unwrap_or_default();
            let files = files_of(cases, &Value::obj(vec![("fixture", Value::s(&fx))]))?;
            let dir = CaseDir::new(tmp, &files)?;
            let mut d = dir.0.clone();
            for seg in folder.split('/') {
                d.push(seg);
            }
            let recursive = matches!(c.get("recursive"), Some(Value::Bool(true)));
            let suffix = json::str_of(c.get("suffix"));
            let (sha, n) = frag::digest_folder(&d, recursive, suffix.as_deref()).map_err(|e| e.to_string())?;
            Value::obj(vec![("sha256", Value::s(&sha)), ("files", Value::n(n as f64))])
        }
        "key_fingerprint" => {
            let pem = json::str_of(c.get("pem")).unwrap_or_default();
            Value::obj(vec![("fingerprint", Value::s(&ledger::public_of(&pem).map_err(|e| e.0)?.1))])
        }
        other => return Err(format!("a hash rule this runner does not know: {}", other)),
    })
}

/// The object an ed25519 case signs, with the case's signature and public key put in place of the fixture's.
fn signed_object(cases: &Value, c: &Value) -> Result<Value, String> {
    let mut o = source(cases, c)?;
    let kind = json::str_of(c.get("kind")).unwrap_or_default();
    let sig = c.get("signature").cloned();
    let pk = c.get("public_key").cloned();
    let set = |holder: &mut json::Obj, sig_key: &str, with_pk: bool| {
        if let Some(s) = &sig {
            holder.set(sig_key, s.clone());
        }
        if with_pk {
            if let Some(p) = &pk {
                holder.set("public_key", p.clone());
            }
        }
    };
    if let Value::Obj(root) = &mut o {
        match kind.as_str() {
            "ledger-entry" | "frag" => {
                if let Some((_, Value::Obj(h))) = root.0.iter_mut().find(|(k, _)| k.is("signature")) {
                    set(h, if kind == "frag" { "signature" } else { "sig" }, true);
                }
            }
            "envelope" => set(root, "signature", true),
            "charter" => {
                if let Some((_, Value::Arr(sigs))) = root.0.iter_mut().find(|(k, _)| k.is("signatures")) {
                    if let Some(Value::Obj(h)) = sigs.get_mut(0) {
                        set(h, "signature", false);
                    }
                }
            }
            _ => {}
        }
    }
    Ok(o)
}

fn signed_message(kind: &str, o: &Value) -> Vec<u8> {
    match kind {
        "ledger-entry" => json::str_of(o.get("hash")).unwrap_or_default().into_bytes(),
        "envelope" => json::canonicalize(o.get("verdict").unwrap_or(&Value::Null)).into_bytes(),
        "frag" => frag::signing_message(o),
        _ => workgraph::signing_message(o),
    }
}

fn verify_signed(kind: &str, o: &Value, issuer: Option<&str>) -> Result<bool, String> {
    Ok(match kind {
        "ledger-entry" => json::is_str(o.get("hash"), &ledger::entry_hash(o)) && ledger::signature_check(o).0,
        "envelope" => {
            let pem = json::str_of(o.get("public_key"));
            let sig = json::str_of(o.get("signature")).unwrap_or_default();
            json::is_str(o.get("alg"), "ed25519")
                && pem.map_or(false, |p| {
                    keys::verify_pem(&p, json::canonicalize(o.get("verdict").unwrap_or(&Value::Null)).as_bytes(), &sig).unwrap_or(false)
                })
        }
        "frag" => frag::verify_frag_signature(o, o.get("signature"), issuer).0,
        _ => match workgraph::validate_charter(o) {
            Ok(_) => true,
            Err(e) if e.code == "signature_invalid" => false,
            Err(e) => return Err(format!("{}: {}", e.code, e.message)),
        },
    })
}

/// Run every case; `tmp` is where case folders are made (and removed).
pub fn run(cases: &Value, tmp: &Path, words: bool) -> Vec<Outcome> {
    let mut out = Vec::new();
    let mut push = |part: &str, c: &Value, failure: Option<String>, words_failure: Option<String>| {
        out.push(Outcome { part: part.into(), name: json::js_str(c.get("name")), failure, words_failure });
    };
    let arr = |k: &str| cases.get(k).and_then(|x| x.as_arr()).cloned().unwrap_or_default();

    for c in arr("canonical") {
        let want = json::str_of(c.get("expect").and_then(|e| e.get("canonical"))).unwrap_or_default();
        let r = json::parse(&json::str_of(c.get("text")).unwrap_or_default()).map(|v| json::canonicalize(&v));
        let f = match r {
            Err(e) => Some(format!("threw {}", e)),
            Ok(got) if got == want => {
                let sha = json::str_of(c.get("expect").and_then(|e| e.get("sha256")));
                if sha.map_or(true, |s| s == json::sha256_text(&got)) {
                    None
                } else {
                    Some("sha256 differs".into())
                }
            }
            Ok(got) => Some(format!("got {}, expected {}", show(&got), show(&want))),
        };
        push("canonical", &c, f, None);
    }

    for c in arr("strict") {
        let graph = json::is_str(c.get("reader"), "workgraph");
        let file = json::str_of(c.get("file")).unwrap_or_default();
        let refused = c.get("expect").and_then(|e| e.get("refused")).filter(|r| !r.is_null()).cloned();
        let r: Result<Value, (Option<String>, String)> = (|| {
            let text = match c.get("base64").and_then(|b| b.as_str()) {
                Some(b) => {
                    let bytes = keys::b64_strict(&b).unwrap_or_default();
                    if graph {
                        workgraph::decode_utf8_strict(&bytes, &file).map_err(|e| (Some(e.at), e.message))?
                    } else {
                        strict::decode_utf8_strict(&bytes, &file).map_err(|e| (e.place().map(String::from), e.message().to_string()))?
                    }
                }
                None => json::str_of(c.get("text")).unwrap_or_default(),
            };
            if graph {
                workgraph::parse_strict(&text, &file).map_err(|e| (Some(e.at), e.message))
            } else {
                strict::parse_json_strict(&text, &file).map_err(|e| (e.place().map(String::from), e.message().to_string()))
            }
        })();
        let f = match (r, &refused) {
            (Err((at, msg)), None) => Some(format!("refused ({}): {}", at.unwrap_or_else(|| "-".into()), msg)),
            (Err((at, msg)), Some(want)) => {
                let w_at = json::str_of(want.get("where"));
                if at != w_at {
                    Some(format!("refused at {}, expected at {}", at.unwrap_or_else(|| "no place".into()), w_at.unwrap_or_else(|| "no place".into())))
                } else if words && Some(msg.clone()) != json::str_of(want.get("message")) {
                    Some(format!("the words differ: {}", show(&msg)))
                } else {
                    None
                }
            }
            (Ok(_), Some(want)) => Some(format!("accepted, expected a refusal at {}", json::str_of(want.get("where")).unwrap_or_else(|| "no place".into()))),
            (Ok(v), None) => {
                let want = json::str_of(c.get("expect").and_then(|e| e.get("canonical"))).unwrap_or_default();
                let got = json::canonicalize(&v);
                if got == want {
                    None
                } else {
                    Some(format!("read as {}, expected {}", show(&got), show(&want)))
                }
            }
        };
        push("strict", &c, f, None);
    }

    for c in arr("hashes") {
        let f = match hash_case(cases, &c, tmp) {
            Err(e) => Some(format!("threw {}", e)),
            Ok(got) => {
                let exp = c.get("expect").and_then(|e| e.as_obj()).cloned().unwrap_or_default();
                let off: Vec<String> = exp
                    .0
                    .iter()
                    .filter(|(k, v)| !eq_expect(got.as_obj().and_then(|o| o.get_j(k)).unwrap_or(&Value::Null), Some(v)))
                    .map(|(k, v)| {
                        format!(
                            "{} {}, expected {}",
                            k.lossy(),
                            got.as_obj().and_then(|o| o.get_j(k)).map(json::canonicalize).unwrap_or_else(|| "nothing".into()),
                            json::canonicalize(v)
                        )
                    })
                    .collect();
                if off.is_empty() {
                    None
                } else {
                    Some(off.join("; "))
                }
            }
        };
        push("hashes", &c, f, None);
    }

    for c in arr("ed25519") {
        let kind = json::str_of(c.get("kind")).unwrap_or_default();
        let want = matches!(c.get("expect").and_then(|e| e.get("valid")), Some(Value::Bool(true)));
        let verdict = |got: bool| {
            if got == want {
                None
            } else {
                Some(format!("{}, expected it {}", if got { "verifies" } else { "does not verify" }, if want { "to verify" } else { "not to verify" }))
            }
        };
        if kind == "raw" {
            let pem = json::str_of(c.get("public_key")).unwrap_or_default();
            let msg = json::unhex(&json::str_of(c.get("message_hex")).unwrap_or_default()).unwrap_or_default();
            let sig = json::str_of(c.get("signature")).unwrap_or_default();
            let got = keys::verify_pem(&pem, &msg, &sig).unwrap_or(false);
            push("ed25519", &c, verdict(got), None);
            continue;
        }
        let f = (|| -> Option<String> {
            let o = match signed_object(cases, &c) {
                Ok(o) => o,
                Err(e) => return Some(format!("threw {}", e)),
            };
            if let Some(ms) = json::str_of(c.get("expect").and_then(|e| e.get("message_sha256"))) {
                let h = json::sha256_hex(&signed_message(&kind, &o));
                if h != ms {
                    return Some(format!("the signed message hashes to {}, expected {}", h, ms));
                }
            }
            let issuer = c.get("issuer").and_then(|i| i.as_str()).and_then(|i| {
                cases.get("keys").and_then(|k| k.get(&i)).and_then(|k| k.get("public_key")).and_then(|p| p.as_str())
            });
            match verify_signed(&kind, &o, issuer.as_deref()) {
                Err(e) => Some(format!("threw {}", e)),
                Ok(got) => verdict(got),
            }
        })();
        push("ed25519", &c, f, None);
    }

    for part in ["ledger", "frag", "workgraph"] {
        for c in arr(part) {
            let argv: Vec<String> = c.get("argv").and_then(|a| a.as_arr()).map(|a| a.iter().map(|x| json::js_str(Some(x))).collect()).unwrap_or_default();
            let r = files_of(cases, &c).and_then(|files| {
                let dir = CaseDir::new(tmp, &files)?;
                Ok(match part {
                    "ledger" => ledger::ledger_cli(&argv, &dir.0),
                    "frag" => frag::frag_cli(&argv, &dir.0),
                    _ => workgraph::workgraph_cli(&argv, &dir.0, None),
                })
            });
            let e = c.get("expect").cloned().unwrap_or(Value::Null);
            match r {
                Err(err) => push(part, &c, Some(format!("threw {}", err)), None),
                Ok(r) => {
                    let f = command_difference(&r, &e, false);
                    let wf = if words && f.is_none() { command_difference(&r, &e, true) } else { None };
                    push(part, &c, f, wf);
                }
            }
        }
    }
    out
}

/// The tally: (passed, failed outside the named list, named, named that pass anyway).
pub struct Tally {
    pub passed: Vec<Outcome>,
    pub failed: Vec<Outcome>,
    pub named: Vec<(Outcome, &'static str)>,
    pub named_passing: Vec<Outcome>,
}

pub fn tally(outcomes: Vec<Outcome>) -> Tally {
    let mut t = Tally { passed: vec![], failed: vec![], named: vec![], named_passing: vec![] };
    for o in outcomes {
        match (named_reason(&o.part, &o.name), &o.failure) {
            (Some(r), Some(_)) => t.named.push((o, r)),
            (Some(_), None) => t.named_passing.push(o),
            (None, None) => t.passed.push(o),
            (None, Some(_)) => t.failed.push(o),
        }
    }
    t
}

/// The report the test and the binary print.
pub fn report(t: &Tally, total: usize) -> String {
    let mut s = String::new();
    for o in &t.failed {
        s += &format!("FAILED {}, {}: {}\n", o.part, o.name, o.failure.as_deref().unwrap_or(""));
    }
    for (o, r) in &t.named {
        s += &format!("NAMED {}, {}: {} [this reader answers: {}]\n", o.part, o.name, r, o.failure.as_deref().unwrap_or(""));
    }
    for o in &t.named_passing {
        s += &format!("NAMED BUT PASSING {}, {}: take it off the named list\n", o.part, o.name);
    }
    let mut by_part = Vec::new();
    for p in PARTS {
        by_part.push(format!("{} {}", p, t.passed.iter().chain(t.named_passing.iter()).filter(|o| o.part == p).count()));
    }
    s += &format!("{}\n", by_part.join(", "));
    s += &format!(
        "rust tier 1: {} cases; passed {}, named (not supported) {}, failures {}\n",
        total,
        t.passed.len() + t.named_passing.len(),
        t.named.len(),
        t.failed.len()
    );
    s
}
