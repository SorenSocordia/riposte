// SPDX-License-Identifier: Apache-2.0
//! `frag open` on a frag folder (riposte.frag/0.1.0), in its order and with its exit codes and first lines: frag.json read
//! strictly, its shape, the id over lock + claim + proof, the Ed25519 signature, the cover sentence re-derived, a verdict frag's
//! bundle file, the record (frags.jsonl: its hash chain, every entry signed by the issuer's key, its head record, the entry at
//! record.seq), the pins recomputed over a tree at hand. Written from the Python reader (conformance/engine_py/record/frag.py).
//!
//! Tier 1 verifies and never re-performs. Where the Node tool re-performs a claim this reader says it cannot tell (exit 2):
//!   - a release: whether the engine label is a closed one below an open one is the engine's to say, and this reader carries
//!     no engine. The changelog of the tree at hand must still carry the quoted sentence (a missing sentence is tampering).
//!   - a verdict: the bundle is compared with the claim, and the verdict is not replayed.
//!   - a bench table: never re-emitted here.
//! It never says "re-performed" for any of them.

use crate::json::{self, cmp16, is_hex64, is_safe_integer, js_slice, js_str, sha256_hex, sha256_text, truthy, Obj, Value};
use crate::keys;
use crate::ledger;
use crate::paths::{join_norm, rel_slash};
use crate::strict;
use crate::CmdResult;
use std::path::{Path, PathBuf};

pub const FRAG_SCHEMA: &str = "riposte.frag/0.1.0";
pub const PROTOTYPE_LINE: &str = "prototype; no measured accuracy";
const FRAG_FILE: &str = "frag.json";
const COVER_FILE: &str = "cover.txt";
const BUNDLE_FILE: &str = "bundle.json";
const RECORD_FILE: &str = "frags.jsonl";
const ISSUER_FILE: &str = "ISSUER.json";
const FRAGS_ROOT: &str = "frags";
pub const FRAG_SIGNING_PREFIX: &str = "riposte:frag:v0\n";
const RECORD_EVENT: &str = "frag.issued";
const WORK_CHAIN_SCHEMA: &str = "riposte.work-chain/0.1.0";
const WORKGRAPH_DEPOSIT_SCHEMA: &str = "riposte.workgraph/0.1.0";
pub const TAMPERED: &str = "FRAG TAMPERED OR NOT AS RECORDED";
const ENGINE_OVER: &str = "packages/verify/src/";
const AP_PACK_OVER: &str = "packages/verify/src/ap/";
const LEGAL_OVER: &str = "packages/verify/src/legal/";
const TOOL_OVER: &str = "packages/receipts/src/";
const EINVOICE_RULESETS: [&str; 2] =
    ["packages/verify/docs/examples/peppol-en16931.ruleset.v0.3.json", "packages/verify/docs/examples/peppol-en16931.ruleset.v0.2.json"];

fn short8(h: &str) -> String {
    format!("{}…", js_slice(h, 8))
}
fn short16(h: &str) -> String {
    format!("{}…", js_slice(h, 16))
}

// ---------------------------------------------------------------------------------------------------------------------
// format.ts

fn field(f: &Value, k: &str) -> Value {
    f.get(k).cloned().unwrap_or(Value::Null)
}

/// sha256 of canonical { lock, claim, proof }.
pub fn frag_id_of(f: &Value) -> String {
    let o = Value::obj(vec![("lock", field(f, "lock")), ("claim", field(f, "claim")), ("proof", field(f, "proof"))]);
    sha256_text(&json::canonicalize(&o))
}

/// The eight signed fields.
pub fn signed_body(f: &Value) -> Value {
    let mut o = Obj::new();
    for k in ["schema", "prototype", "name", "lock", "claim", "proof", "provenance", "frag_id"] {
        o.set(k, field(f, k));
    }
    Value::Obj(o)
}

pub fn body_sha256(f: &Value) -> String {
    sha256_text(&json::canonicalize(&signed_body(f)))
}

/// The bytes a frag signs: the prefix and the canonical JSON of its eight signed fields.
pub fn signing_message(f: &Value) -> Vec<u8> {
    format!("{}{}", FRAG_SIGNING_PREFIX, json::canonicalize(&signed_body(f))).into_bytes()
}

/// (ok, fingerprint, reason): the signature over the body by the key the frag carries; the issuer, if given, pins it.
pub fn verify_frag_signature(f: &Value, s: Option<&Value>, issuer_pem: Option<&str>) -> (bool, Option<String>, Option<String>) {
    let s = match s {
        Some(s)
            if s.is_obj()
                && json::is_str(s.get("alg"), "ed25519")
                && s.get("public_key").map_or(false, |x| x.as_jstr().is_some())
                && s.get("signature").map_or(false, |x| x.as_jstr().is_some()) =>
        {
            s
        }
        _ => return (false, None, Some("the signature is not an Ed25519 envelope { alg, public_key, signature }".into())),
    };
    let pem = s.get("public_key").unwrap().as_str().unwrap();
    let sig = s.get("signature").unwrap().as_str().unwrap();
    let (ok, fp) = match keys::verify_pem(&pem, &signing_message(f), &sig) {
        Ok(ok) => (ok, keys::key_fingerprint(&pem).ok()),
        Err(_) => (false, None),
    };
    if !ok {
        return (false, fp, Some("the signature does not verify: the frag was altered after it was signed, or the key does not match".into()));
    }
    if let Some(ip) = issuer_pem {
        match keys::key_fingerprint(ip) {
            Err(_) => return (false, fp, Some("the issuer key could not be read".into())),
            Ok(want) => {
                if fp.as_deref() != Some(want.as_str()) {
                    return (false, fp.clone(), Some(format!("signed by key {}, not the issuer's {}", fp.unwrap_or_default(), want)));
                }
            }
        }
    }
    (true, fp, None)
}

fn path_problem(p: &str) -> Option<String> {
    let segs: Vec<&str> = p.split('/').collect();
    if segs[0] != FRAGS_ROOT {
        return Some(format!("must start with {}/", FRAGS_ROOT));
    }
    if segs.len() < 2 {
        return Some("must name at least one segment after frags/".into());
    }
    for s in &segs[1..] {
        let b = s.as_bytes();
        let plain = !b.is_empty()
            && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
            && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'_' | b'-'));
        if !plain || *s == ".." || *s == "." {
            return Some(format!("has a segment that is not a plain lower-case name: {}", json::js_string_str(s)));
        }
    }
    None
}

/// The shape problems of a frag.json, in the Node tool's order and words.
pub fn frag_shape_problems(x: &Value) -> Vec<String> {
    if !x.is_obj() {
        return vec![format!("{}: not a JSON object", FRAG_FILE)];
    }
    let mut out = Vec::new();
    if !json::is_str(x.get("schema"), FRAG_SCHEMA) {
        let got = match x.get("schema") {
            None => "undefined".to_string(),
            Some(v) => json::stringify(v),
        };
        out.push(format!("{}: schema must be \"{}\" (got {})", FRAG_FILE, FRAG_SCHEMA, got));
    }
    if !json::is_str(x.get("prototype"), PROTOTYPE_LINE) {
        out.push(format!("{}: prototype must be \"{}\"", FRAG_FILE, PROTOTYPE_LINE));
    }
    let name = x.get("name");
    let title = name.and_then(|n| n.get("title")).and_then(|t| t.as_str());
    let path = name.and_then(|n| n.get("path")).and_then(|t| t.as_str());
    match (name.map_or(false, |n| n.is_obj()), title, path) {
        (true, Some(t), Some(p)) if !json::js_trim(&t).is_empty() => {
            if let Some(pp) = path_problem(&p) {
                out.push(format!("{}: name.path {}", FRAG_FILE, pp));
            }
        }
        _ => out.push(format!("{}: name must be {{ title, path }}", FRAG_FILE)),
    }
    let lock = x.get("lock");
    let lock_ok = lock.map_or(false, |l| {
        l.is_obj()
            && l.get("engine").map_or(false, |e| e.is_obj())
            && l.get("rulesets").map_or(false, |e| e.as_arr().is_some())
            && l.get("tools").map_or(false, |e| e.as_arr().is_some())
            && l.get("corpus").map_or(false, |e| e.as_arr().is_some())
    });
    if !lock_ok {
        out.push(format!("{}: lock must carry engine, rulesets, tools, corpus and prereg", FRAG_FILE));
    }
    let claim = x.get("claim");
    let proof = x.get("proof");
    let ck = js_str(claim.and_then(|c| c.get("kind")));
    if !claim.map_or(false, |c| c.is_obj()) || !matches!(ck.as_str(), "bench" | "verdict" | "release") {
        out.push(format!("{}: claim.kind must be bench, verdict or release", FRAG_FILE));
    }
    if !proof.map_or(false, |p| p.is_obj())
        || !claim.map_or(false, |c| c.is_obj())
        || !json::js_eq(proof.and_then(|p| p.get("kind")), claim.and_then(|c| c.get("kind")))
    {
        out.push(format!("{}: proof.kind must be the claim's kind", FRAG_FILE));
    }
    let prov = x.get("provenance");
    if !prov.map_or(false, |p| {
        p.is_obj() && p.get("issued_at").map_or(false, |v| v.as_jstr().is_some()) && p.get("tier").map_or(false, |v| v.as_jstr().is_some())
    }) {
        out.push(format!("{}: provenance must carry issued_at and tier", FRAG_FILE));
    }
    if !x.get("frag_id").and_then(|v| v.as_str()).map_or(false, |s| is_hex64(&s)) {
        out.push(format!("{}: frag_id must be 64 lowercase hex", FRAG_FILE));
    }
    if !x.get("signature").map_or(false, |s| s.is_obj()) {
        out.push(format!("{}: signature is missing", FRAG_FILE));
    }
    let rec = x.get("record");
    let rec_ok = rec.map_or(false, |r| {
        r.is_obj()
            && r.get("ledger").map_or(false, |v| v.as_jstr().is_some())
            && is_safe_integer(r.get("seq"))
            && r.get("seq").and_then(|v| v.as_num()).unwrap() >= 0.0
            && r.get("hash").and_then(|v| v.as_str()).map_or(false, |s| is_hex64(&s))
    });
    if !rec_ok {
        out.push(format!("{}: record must be {{ ledger, seq, hash }}", FRAG_FILE));
    }
    let keys = ["schema", "prototype", "name", "lock", "claim", "proof", "provenance", "frag_id", "signature", "record"];
    let mut extra: Vec<String> = x.as_obj().unwrap().keys_lossy().into_iter().filter(|k| !keys.contains(&k.as_str())).collect();
    extra.sort_by(|a, b| cmp16(a, b));
    if !extra.is_empty() {
        out.push(format!("{}: unknown field(s) {}", FRAG_FILE, extra.join(", ")));
    }
    out
}

fn row_summary(rows: &[Value]) -> String {
    let (mut p, mut f, mut o) = (0, 0, 0);
    for r in rows {
        let v = if r.is_obj() { r.get("verdict") } else { None };
        if json::is_str(v, "PASS") {
            p += 1
        } else if json::is_str(v, "FAIL") {
            f += 1
        } else {
            o += 1
        }
    }
    let mut parts = Vec::new();
    if p > 0 {
        parts.push(format!("{} PASS against a preregistered bar", p));
    }
    if f > 0 {
        parts.push(format!("{} FAIL against a preregistered bar", f));
    }
    if o > 0 {
        parts.push(format!("{} descriptive or post-hoc", o));
    }
    parts.join(", ")
}

/// String(x ?? '?')
fn q(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => "?".into(),
        x => js_str(x),
    }
}

fn s_of(v: Option<&Value>) -> String {
    js_str(v)
}

fn claim_lines(c: &Value, p: &Value) -> Vec<String> {
    let ck = c.get("kind");
    let pk = p.get("kind");
    if json::is_str(ck, "bench") && json::is_str(pk, "bench") {
        let run = c.get("run").filter(|r| r.is_obj()).cloned().unwrap_or(Value::Obj(Obj::new()));
        let results = if truthy(p.get("results")) {
            format!(", results sha256 {}", short8(&s_of(p.get("results").and_then(|r| r.get("sha256")))))
        } else {
            String::new()
        };
        let rows = c.get("rows").and_then(|r| r.as_arr()).cloned().unwrap_or_default();
        return vec![
            format!(
                "Claim: bench table {}, \"{}\": {} rows ({}); run {} under engine {}, {}; label {}.",
                s_of(c.get("table")),
                s_of(c.get("title")),
                rows.len(),
                row_summary(&rows),
                q(run.get("date")),
                q(run.get("engine_version")),
                q(run.get("ruleset")),
                s_of(c.get("label"))
            ),
            format!(
                "Proof: the table re-emits from {}{}; reruns from this tree: {} ({}).",
                s_of(p.get("folder")),
                results,
                s_of(p.get("reruns_from_this_tree")),
                s_of(p.get("rerun"))
            ),
        ];
    }
    if json::is_str(ck, "verdict") && json::is_str(pk, "verdict") {
        let bv = c.get("bundle").and_then(|b| b.get("verdict"));
        let v = match bv {
            Some(bv) if bv.is_obj() => {
                if bv.get("verdict").map_or(false, |x| x.is_obj()) {
                    bv.get("verdict").unwrap().clone()
                } else {
                    bv.clone()
                }
            }
            _ => Value::Obj(Obj::new()),
        };
        let rs = v.get("ruleset");
        let rss = match rs {
            Some(r) if r.is_obj() => format!("{}@{}", s_of(r.get("id")), s_of(r.get("version"))),
            x => s_of(x),
        };
        return vec![
            format!(
                "Claim: one verdict, {}, outcome {}, ruleset {}, engine {}, with the inputs it was issued on.",
                s_of(v.get("verdict_id")),
                s_of(v.get("outcome")),
                rss,
                s_of(v.get("engine_version"))
            ),
            format!("Proof: the bundle replays ({}); reruns from this tree: yes.", s_of(p.get("replay"))),
        ];
    }
    if json::is_str(ck, "release") && json::is_str(pk, "release") {
        let r = p.get("record");
        return vec![
            format!(
                "Claim: engine {} is {}, carried by {}: \"{}\"",
                s_of(c.get("engine")),
                s_of(c.get("status")),
                s_of(c.get("carried_by")),
                s_of(c.get("statement"))
            ),
            format!(
                "Proof: {} (sha256 {}); reruns from this tree: partly ({}).",
                s_of(r.and_then(|r| r.get("file"))),
                short8(&s_of(r.and_then(|r| r.get("sha256")))),
                s_of(p.get("reason"))
            ),
        ];
    }
    vec!["Claim: of a kind this build does not read.".into()]
}

/// coverText: a pure function of the frag's fields, re-derived and compared on open.
pub fn cover_text(f: &Value) -> String {
    let lk = f.get("lock").unwrap();
    let corpus_list = lk.get("corpus").and_then(|c| c.as_arr()).cloned().unwrap_or_default();
    let ns = corpus_list.iter().filter(|c| !truthy(c.get("ships"))).count();
    let n = corpus_list.len();
    let corpus = if n > 0 {
        format!(
            "{} corpus entr{}{}",
            n,
            if n == 1 { "y" } else { "ies" },
            if ns > 0 { format!(", {} of them hashed, not shipped", ns) } else { String::new() }
        )
    } else {
        "no corpus entries".into()
    };
    let pr = lk.get("prereg");
    let prereg = if truthy(pr) {
        let pr = pr.unwrap();
        format!("prereg {}, {}", short8(&s_of(pr.get("sha256"))), s_of(pr.get("stamp")))
    } else {
        "no prereg".into()
    };
    let eng = lk.get("engine").unwrap();
    let name = f.get("name").unwrap();
    let mut lines = vec![
        PROTOTYPE_LINE.to_string(),
        format!(
            "Frag {} ({}): one answer the engine gave, named and pinned. {}.",
            s_of(name.get("path")),
            FRAG_SCHEMA,
            s_of(name.get("title"))
        ),
    ];
    lines.extend(claim_lines(f.get("claim").unwrap(), f.get("proof").unwrap()));
    let rulesets = lk.get("rulesets").and_then(|r| r.as_arr()).map_or(0, |a| a.len());
    let tools = lk.get("tools").and_then(|r| r.as_arr()).map_or(0, |a| a.len());
    lines.push(format!(
        "Pinned: engine {}, sources {} ({} files under {}); {} ruleset pins; {} tool pin{}; {}; {}.",
        s_of(eng.get("label")),
        short8(&s_of(eng.get("sha256"))),
        s_of(eng.get("files")),
        s_of(eng.get("over")),
        rulesets,
        tools,
        if tools == 1 { "" } else { "s" },
        corpus,
        prereg
    ));
    let pv = f.get("provenance").unwrap();
    lines.push(format!("Issued {}; tier: {}; {}.", s_of(pv.get("issued_at")), s_of(pv.get("tier")), s_of(pv.get("issuer"))));
    if truthy(pv.get("supersedes")) {
        lines.push(format!("Supersedes frag {}.", s_of(pv.get("supersedes"))));
    }
    lines.join("\n") + "\n"
}

// ---------------------------------------------------------------------------------------------------------------------
// record.ts

struct Issuer {
    public_key: String,
    fingerprint: String,
    note: String,
}

fn read_text_lossy(p: &Path) -> Option<String> {
    std::fs::read(p).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

fn read_issuer(file: &Path) -> Option<Issuer> {
    let x = json::parse(&read_text_lossy(file)?).ok()?;
    if !x.is_obj() {
        return None;
    }
    let pk = x.get("public_key")?.as_str()?;
    let fp = x.get("fingerprint")?.as_str()?;
    let note = x.get("note")?.as_str()?;
    if keys::key_fingerprint(&pk).ok()? != fp {
        return None;
    }
    Some(Issuer { public_key: pk, fingerprint: fp, note })
}

struct RecordBody {
    frag_id: String,
    path: String,
    body_sha256: String,
    supersedes: Option<String>,
}

fn record_body_of(e: Option<&Value>) -> Option<RecordBody> {
    let e = e.filter(|e| e.is_obj())?;
    let b = e.get("body")?;
    if !json::is_str(e.get("kind"), "note") || !b.is_obj() || !json::is_str(b.get("event"), RECORD_EVENT) {
        return None;
    }
    let g = |k: &str| b.get(k).and_then(|x| x.as_str());
    let (fid, path, _claim, body) = (g("frag_id")?, g("path")?, g("claim")?, g("body_sha256")?);
    Some(RecordBody { frag_id: fid, path, body_sha256: body, supersedes: g("supersedes") })
}

// ---------------------------------------------------------------------------------------------------------------------
// tree.ts

#[derive(Clone)]
struct Tree {
    root: PathBuf,
    lab: bool,
}

fn resolve_tree(root: &Path) -> Option<Tree> {
    if root.join("packages").join("verify").join("src").exists() {
        return Some(Tree { root: root.to_path_buf(), lab: false });
    }
    if root.join("verify").join("src").exists() {
        return Some(Tree { root: root.to_path_buf(), lab: true });
    }
    None
}

fn tree_path(t: &Tree, shipped: &str) -> PathBuf {
    let trimmed = shipped.trim_end_matches('/');
    let mut parts: Vec<&str> = trimmed.split('/').collect();
    if t.lab && parts.first() == Some(&"packages") {
        parts.remove(0);
    }
    let mut p = t.root.clone();
    for s in parts {
        p.push(s);
    }
    p
}

fn walk(d: &Path, base: &Path, out: &mut Vec<String>) -> std::io::Result<()> {
    for e in std::fs::read_dir(d)? {
        let e = e?;
        if e.file_type()?.is_dir() {
            walk(&e.path(), base, out)?;
        } else {
            out.push(rel_slash(base, &e.path()));
        }
    }
    Ok(())
}

/// The pin rule: sha256 over one line "<sha256 of the file>  <path>\n" per file, sorted by path (UTF-16 order).
pub fn digest_folder(d: &Path, recursive: bool, suffix: Option<&str>) -> std::io::Result<(String, usize)> {
    let mut files = Vec::new();
    if recursive {
        walk(d, d, &mut files)?;
    } else {
        for e in std::fs::read_dir(d)? {
            let e = e?;
            if !e.path().is_dir() {
                files.push(e.file_name().to_string_lossy().into_owned());
            }
        }
    }
    files.sort_by(|a, b| cmp16(a, b));
    if let Some(s) = suffix {
        files.retain(|f| f.ends_with(s));
    }
    let mut text = String::new();
    for f in &files {
        let mut p = d.to_path_buf();
        for seg in f.split('/') {
            p.push(seg);
        }
        let b = std::fs::read(&p)?;
        text.push_str(&format!("{}  {}\n", sha256_hex(&b), f));
    }
    Ok((sha256_text(&text), files.len()))
}

struct Pin {
    over: String,
    sha256: String,
}

struct RulesetPin {
    id: String,
    version: String,
    over: Option<String>,
    file: Option<String>,
    sha256: String,
}

struct ToolPin {
    name: String,
    version: String,
    sha256: String,
}

struct LockTable {
    engine_label: String,
    engine: Pin,
    rulesets: Vec<RulesetPin>,
    tools: Vec<ToolPin>,
}

fn pkg_version(t: &Tree, pkg: &str) -> Result<String, String> {
    let p = tree_path(t, &format!("packages/{}/package.json", pkg));
    if !p.exists() {
        return Err(format!("{}: no package.json at {}", pkg, rel_slash(&t.root, &p)));
    }
    let v = json::parse(&read_text_lossy(&p).unwrap_or_default()).map_err(|e| format!("{}: package.json does not parse ({})", pkg, e))?;
    v.get("version").and_then(|x| x.as_str()).ok_or_else(|| format!("{}: package.json names no version", pkg))
}

fn folder_pin(t: &Tree, over: &str, recursive: bool, suffix: Option<&str>) -> Result<Pin, String> {
    let d = tree_path(t, over);
    if !d.exists() {
        return Err(format!("the tree holds no {}", over));
    }
    let (sha, _) = digest_folder(&d, recursive, suffix).map_err(|e| e.to_string())?;
    Ok(Pin { over: over.into(), sha256: sha })
}

fn lock_table(t: &Tree, lock: &Value) -> Result<LockTable, String> {
    let engine = folder_pin(t, ENGINE_OVER, true, None)?;
    let label = pkg_version(t, "verify")?;
    let rs = lock.get("rulesets").and_then(|r| r.as_arr()).cloned().unwrap_or_default();
    let find = |over: &str| rs.iter().find(|r| r.is_obj() && json::is_str(r.get("over"), over)).cloned();
    let ap = find(AP_PACK_OVER);
    let lg = find(LEGAL_OVER);
    let ap_id = ap.as_ref().map_or("ap-threeway".to_string(), |a| js_str(a.get("id")));
    let ap_ver = ap.as_ref().map_or("?".to_string(), |a| js_str(a.get("version")));
    let lg_ver = lg.as_ref().map_or("?".to_string(), |a| js_str(a.get("version")));
    let ap_pin = folder_pin(t, AP_PACK_OVER, false, Some(".ts"))?;
    let lg_pin = folder_pin(t, LEGAL_OVER, false, Some(".ts"))?;
    let mut rulesets = vec![
        RulesetPin { id: ap_id, version: ap_ver, over: Some(ap_pin.over), file: None, sha256: ap_pin.sha256 },
        RulesetPin { id: "legal".into(), version: lg_ver, over: Some(lg_pin.over), file: None, sha256: lg_pin.sha256 },
    ];
    for file in EINVOICE_RULESETS {
        let p = tree_path(t, file);
        if !p.exists() {
            return Err(format!("the tree holds no {}", file));
        }
        let b = std::fs::read(&p).map_err(|e| e.to_string())?;
        let j = json::parse(&String::from_utf8_lossy(&b)).map_err(|e| format!("{} does not parse ({})", file, e))?;
        let id = match j.get("id") {
            None | Some(Value::Null) => "peppol-en16931".to_string(),
            x => js_str(x),
        };
        let ver = match j.get("version") {
            None | Some(Value::Null) => "?".to_string(),
            x => js_str(x),
        };
        rulesets.push(RulesetPin { id, version: ver, over: None, file: Some(file.into()), sha256: sha256_hex(&b) });
    }
    let tool = folder_pin(t, TOOL_OVER, true, None)?;
    let tools = vec![ToolPin { name: "riposte-ai".into(), version: pkg_version(t, "receipts")?, sha256: tool.sha256 }];
    Ok(LockTable { engine_label: label, engine, rulesets, tools })
}

struct PinCompare {
    agree: Vec<String>,
    differ: Vec<(String, String, String)>,
}

fn compare_pins(lock: &Value, t: &Tree) -> Result<PinCompare, String> {
    let now = lock_table(t, lock)?;
    let mut c = PinCompare { agree: vec![], differ: vec![] };
    fn put(c: &mut PinCompare, pin: String, pinned: String, here: String) {
        if pinned == here {
            c.agree.push(pin)
        } else {
            c.differ.push((pin, pinned, here))
        }
    }
    macro_rules! cmp {
        ($a:expr, $b:expr, $h:expr) => {
            put(&mut c, $a, $b, $h)
        };
    }
    let eng = lock.get("engine").unwrap();
    let here = if json::is_str(eng.get("label"), &now.engine_label) {
        now.engine.sha256.clone()
    } else {
        format!("label {}, sources {}", now.engine_label, now.engine.sha256)
    };
    cmp!(format!("engine {} ({})", js_str(eng.get("label")), js_str(eng.get("over"))), js_str(eng.get("sha256")), here);
    for r in lock.get("rulesets").and_then(|r| r.as_arr()).cloned().unwrap_or_default() {
        let rfile = r.get("file");
        let rid = r.get("id");
        let found = now.rulesets.iter().find(|x| {
            json::is_str(rid, &x.id)
                && if truthy(rfile) {
                    x.file.as_deref().map_or(false, |f| json::is_str(rfile, f))
                } else {
                    match (&x.over, r.get("over")) {
                        (Some(o), ov) => json::is_str(ov, o),
                        (None, None) => true,
                        _ => false,
                    }
                }
        });
        let label = format!(
            "ruleset {}@{} ({})",
            js_str(rid),
            js_str(r.get("version")),
            js_str(if truthy(rfile) { rfile } else { r.get("over") })
        );
        let pinned = match r.get("sha256") {
            None | Some(Value::Null) => String::new(),
            x => js_str(x),
        };
        match found {
            None => cmp!(label, pinned, "not in this tree".into()),
            Some(h) => {
                let here = if json::is_str(r.get("version"), &h.version) { h.sha256.clone() } else { format!("version {}, {}", h.version, h.sha256) };
                cmp!(label, pinned, here)
            }
        }
    }
    for r in lock.get("tools").and_then(|r| r.as_arr()).cloned().unwrap_or_default() {
        let found = now.tools.iter().find(|x| json::is_str(r.get("name"), &x.name));
        let label = format!("tool {} {} ({})", js_str(r.get("name")), js_str(r.get("version")), js_str(r.get("over")));
        let here = match found {
            None => "not in this tree".to_string(),
            Some(h) => {
                if json::is_str(r.get("version"), &h.version) {
                    h.sha256.clone()
                } else {
                    format!("version {}, {}", h.version, h.sha256)
                }
            }
        };
        cmp!(label, js_str(r.get("sha256")), here);
    }
    for co in lock.get("corpus").and_then(|r| r.as_arr()).cloned().unwrap_or_default() {
        if !truthy(co.get("ships")) {
            continue;
        }
        let name = js_str(co.get("name"));
        let p = tree_path(t, &name);
        if !p.exists() {
            c.differ.push((format!("corpus {}", name), js_str(co.get("sha256")), "not in this tree".into()));
            continue;
        }
        let here = if p.is_dir() {
            digest_folder(&p, true, None).map_err(|e| e.to_string())?.0
        } else {
            sha256_hex(&std::fs::read(&p).map_err(|e| e.to_string())?)
        };
        cmp!(format!("corpus {}", name), js_str(co.get("sha256")), here);
    }
    let pr = lock.get("prereg");
    if truthy(pr) {
        let pr = pr.unwrap();
        let path = js_str(pr.get("path"));
        let p = tree_path(t, &path);
        let here = if p.exists() { sha256_hex(&std::fs::read(&p).map_err(|e| e.to_string())?) } else { "not in this tree".into() };
        cmp!(format!("prereg {}", path), js_str(pr.get("sha256")), here);
    }
    Ok(c)
}

// ---------------------------------------------------------------------------------------------------------------------
// claim.ts, open's side, verify only

/// A release claim checked as far as verifying goes: the changelog of the tree at hand must still carry the quoted sentence.
/// Whether the label is closed is the engine's to say; this reader carries no engine and says so.
fn check_release(t: Option<&Tree>, claim: &Value, proof: &Value) -> (Vec<String>, Vec<String>) {
    let mut problems = Vec::new();
    let mut notes = Vec::new();
    if let Some(t) = t {
        let rec = proof.get("record");
        let shown = js_str(rec.and_then(|r| r.get("file")));
        let file = tree_path(t, &shown);
        if !file.exists() {
            notes.push(format!("{} is not in this tree", shown));
        } else if let Ok(b) = std::fs::read(&file) {
            if !json::is_str(rec.and_then(|r| r.get("sha256")), &sha256_hex(&b)) {
                notes.push(format!("{} has other bytes than the frag records (the changelog grows)", shown));
            }
            if !String::from_utf8_lossy(&b).contains(&js_str(claim.get("statement"))) {
                problems.push(format!("{} no longer carries the sentence the claim quotes", shown));
            }
        }
    }
    (problems, notes)
}

// ---------------------------------------------------------------------------------------------------------------------
// open.ts

/// What `frag open` answers: its exit and its sheet.
pub struct Opened {
    pub exit: i32,
    pub cover: Vec<String>,
    pub problems: Vec<String>,
    pub cant_tell: Vec<String>,
    pub notes: Vec<String>,
    pub frag_id: Option<String>,
}

fn not_a_frag(problems: Vec<String>) -> Opened {
    let mut cover = vec![PROTOTYPE_LINE.to_string(), "Not a frag: nothing was re-performed.".to_string()];
    cover.extend(problems.iter().take(10).map(|p| format!("  - {}", p)));
    Opened { exit: 3, cover, problems, cant_tell: vec![], notes: vec![], frag_id: None }
}

fn record_for(d: &Path, path: &str) -> (PathBuf, PathBuf) {
    let depth = path.split('/').count() - 1;
    let mut d = d.to_path_buf();
    for _ in 0..depth {
        d = d.parent().map(Path::to_path_buf).unwrap_or(d);
    }
    let root = d.parent().map(Path::to_path_buf).unwrap_or_else(|| d.clone());
    (d.join(RECORD_FILE), root)
}

fn read_issuer_opt(p: Option<PathBuf>, beside_record: &Path) -> Option<Issuer> {
    let file = p.unwrap_or_else(|| beside_record.parent().map(|x| x.join(ISSUER_FILE)).unwrap_or_else(|| PathBuf::from(ISSUER_FILE)));
    if !file.exists() {
        return None;
    }
    if file.to_string_lossy().ends_with(".json") {
        return read_issuer(&file);
    }
    let pem = read_text_lossy(&file)?;
    if !pem.contains("PUBLIC KEY") {
        return None;
    }
    let (pk, fp) = ledger::public_of(&pem).ok()?;
    Some(Issuer { public_key: pk, fingerprint: fp, note: "a public key given on the command line".into() })
}

fn deposit_pointer(p: &Path, shown: &str) -> Option<String> {
    if !p.is_file() {
        return None;
    }
    let x = json::parse(&read_text_lossy(p)?).ok()?;
    if x.is_obj() && json::is_str(x.get("schema"), WORKGRAPH_DEPOSIT_SCHEMA) {
        return Some(format!(
            "{}: a work graph deposit: open it with workgraph open (its schema is {}; this command opens frag folders and {} chains)",
            shown, WORKGRAPH_DEPOSIT_SCHEMA, WORK_CHAIN_SCHEMA
        ));
    }
    None
}

fn strict_file(p: &Path, name: &str) -> Result<Value, String> {
    let b = std::fs::read(p).map_err(|e| e.to_string())?;
    strict::decode_utf8_strict(&b, name).and_then(|t| strict::parse_json_strict(&t, name)).map_err(|e| e.message().to_string())
}

/// open(): the result of `frag open` on a folder, with `cwd` as the working folder.
pub fn open_frag(folder: &str, tree: Option<&str>, record: Option<&str>, issuer: Option<&str>, cwd: &Path) -> Opened {
    let d = join_norm(cwd, folder);
    if !d.is_dir() {
        return not_a_frag(vec![deposit_pointer(&d, folder).unwrap_or_else(|| format!("{}: not a folder", folder))]);
    }
    let frag_path = d.join(FRAG_FILE);
    if !frag_path.exists() {
        return not_a_frag(vec![format!("{}: missing; a frag is a folder with a frag.json", FRAG_FILE)]);
    }
    let f = match strict_file(&frag_path, FRAG_FILE) {
        Ok(v) => v,
        Err(m) => return not_a_frag(vec![format!("{}: refused by the strict JSON reader ({})", FRAG_FILE, m)]),
    };
    let shape = frag_shape_problems(&f);
    if !shape.is_empty() {
        return not_a_frag(shape);
    }
    let mut problems: Vec<String> = Vec::new();
    let mut cant_tell: Vec<String> = Vec::new();
    let mut notes: Vec<String> = Vec::new();
    let stated_id = f.get("frag_id").unwrap().as_str().unwrap();
    let fid = frag_id_of(&f);
    if fid != stated_id {
        problems.push(format!(
            "{}: frag_id does not recompute over lock + claim + proof ({} stated, {} recomputed)",
            FRAG_FILE,
            short16(&stated_id),
            short16(&fid)
        ));
    }
    let name_path = f.get("name").unwrap().get("path").unwrap().as_str().unwrap();
    let (record_default, default_root) = record_for(&d, &name_path);
    let record_file = record.map(|r| join_norm(cwd, r)).unwrap_or_else(|| record_default.clone());
    let iss = read_issuer_opt(issuer.map(|i| join_norm(cwd, i)), &record_file);
    let (sig_ok, sig_fp, sig_reason) = verify_frag_signature(&f, f.get("signature"), iss.as_ref().map(|i| i.public_key.as_str()));
    if !sig_ok {
        problems.push(format!("{}: {}", FRAG_FILE, sig_reason.unwrap_or_default()));
    }
    if iss.is_none() {
        cant_tell.push(format!(
            "the issuer key is not pinned here (no {} beside the record and no --issuer): the signature verifies against the key the frag carries, \
             which proves consistency, not who issued it",
            ISSUER_FILE
        ));
    }
    let cover_path = d.join(COVER_FILE);
    if !cover_path.exists() {
        problems.push(format!("{}: missing", COVER_FILE));
    } else if read_text_lossy(&cover_path).unwrap_or_default() != cover_text(&f) {
        problems.push(format!("{}: does not match the cover sentence re-derived from {}", COVER_FILE, FRAG_FILE));
    }
    let claim = f.get("claim").unwrap();
    let proof = f.get("proof").unwrap();
    let ck = js_str(claim.get("kind"));
    let pk = js_str(proof.get("kind"));
    if ck == "verdict" {
        let bp = d.join(BUNDLE_FILE);
        if !bp.exists() {
            problems.push(format!("{}: missing (a verdict frag carries its bundle as a file)", BUNDLE_FILE));
        } else {
            match strict_file(&bp, BUNDLE_FILE) {
                Ok(b) => {
                    let want = claim.get("bundle").map(json::canonicalize);
                    if Some(json::canonicalize(&b)) != want {
                        problems.push(format!("{}: is not the claim's bundle", BUNDLE_FILE));
                    }
                }
                Err(m) => problems.push(format!("{}: {}", BUNDLE_FILE, m)),
            }
        }
    }
    let mut rec_words = String::new();
    let mut rec_checked = false;
    let mut rec_entries: Option<usize> = None;
    let shown_record = record.map(String::from).unwrap_or_else(|| record_default.display().to_string());
    if !record_file.exists() {
        rec_words = format!("the record is not reachable from this folder (looked for {}); pass --record <frags.jsonl>", shown_record);
        cant_tell.push(rec_words.clone());
    } else {
        rec_checked = true;
        match ledger::read_record(&record_file, &record_file.display().to_string(), iss.as_ref().map(|i| i.public_key.as_str())) {
            Err(e) => problems.push(e),
            Ok(r) => {
                rec_entries = Some(r.entries.len());
                if let Some(b) = r.torn_bytes {
                    problems.push(format!("{}: its last line is torn ({} bytes with no newline)", RECORD_FILE, b));
                }
                if !r.chain.ok {
                    problems.push(format!("{}: the chain does not verify ({})", RECORD_FILE, r.chain.reason.clone().unwrap_or_else(|| "broken".into())));
                }
                if !r.head.ok {
                    problems.push(format!("{}: {}", RECORD_FILE, r.head.words));
                }
                let frec = f.get("record").unwrap();
                let seq = frec.get("seq").unwrap().as_num().unwrap() as usize;
                let frec_hash = frec.get("hash").unwrap().as_str().unwrap();
                let e = r.entries.get(seq);
                match (e, record_body_of(e)) {
                    (Some(e), Some(b)) if !e.is_null() => {
                        if !json::is_str(e.get("hash"), &frec_hash) {
                            problems.push(format!(
                                "{}: entry {} has hash {}, not the {} the frag records",
                                RECORD_FILE,
                                seq,
                                short16(&js_str(e.get("hash"))),
                                short16(&frec_hash)
                            ));
                        }
                        if b.frag_id != stated_id {
                            problems.push(format!("{}: entry {} records frag {}, not this frag ({})", RECORD_FILE, seq, short16(&b.frag_id), short16(&stated_id)));
                        }
                        if b.body_sha256 != body_sha256(&f) {
                            problems.push(format!("{}: entry {} records another body (name or provenance changed after the frag was recorded)", RECORD_FILE, seq));
                        }
                        if b.path != name_path {
                            problems.push(format!("{}: entry {} records the address {}, not {}", RECORD_FILE, seq, b.path, name_path));
                        }
                    }
                    _ => problems.push(format!("{}: entry {} is not a frag's record entry", RECORD_FILE, seq)),
                }
                let later = r.entries.iter().skip(seq + 1).filter_map(|e2| record_body_of(Some(e2))).find(|x| x.supersedes.as_deref() == Some(stated_id.as_str()));
                if let Some(l) = later {
                    notes.push(format!("a later frag supersedes this one: {} ({})", short16(&l.frag_id), l.path));
                }
                if problems.iter().any(|p| p.starts_with(RECORD_FILE)) {
                    rec_words = "the record does not hold this frag as written".into();
                } else {
                    let c = &r.chain;
                    rec_words = format!(
                        "entry {} of {}, chain {}, {} signed{}; head {}; {}",
                        seq,
                        r.entries.len(),
                        if c.chain_ok { "intact" } else { "broken" },
                        c.signed,
                        iss.as_ref().map(|i| format!(", every entry by the issuer's key {}", short16(&i.fingerprint))).unwrap_or_default(),
                        short16(&c.head),
                        r.head.words
                    );
                }
            }
        }
    }
    let t: Option<Tree> = match tree {
        Some(tr) => {
            let t = resolve_tree(&join_norm(cwd, tr));
            if t.is_none() {
                cant_tell.push(format!("{}: not a repository root, so the pins were not compared and the claim was not re-performed", tr));
            }
            t
        }
        None => {
            let t = resolve_tree(&default_root);
            if t.is_none() {
                cant_tell.push("no repository root above this frag, so the pins were not compared and the claim was not re-performed; pass --tree <root>".into());
            }
            t
        }
    };
    let mut pins_words = "not compared".to_string();
    if let Some(t) = &t {
        match compare_pins(f.get("lock").unwrap(), t) {
            Err(e) => cant_tell.push(format!("the pins could not be computed over this tree: {}", e)),
            Ok(c) => {
                pins_words = if !c.differ.is_empty() {
                    format!(
                        "{} of {} pins differ from this tree ({}): this is not the tree the frag pins",
                        c.differ.len(),
                        c.agree.len() + c.differ.len(),
                        c.differ.iter().map(|x| x.0.clone()).collect::<Vec<_>>().join("; ")
                    )
                } else {
                    format!("every one of the {} pins agrees with this tree", c.agree.len())
                };
                if !c.differ.is_empty() {
                    notes.push(pins_words.clone());
                }
            }
        }
    }
    let claim_words;
    if ck == "bench" && pk == "bench" {
        cant_tell.push(if t.is_none() {
            "the bench table was not re-emitted: no tree".to_string()
        } else {
            format!("the bench table was not re-emitted here: this reader does not re-emit bench tables; the bench tool does ({})", js_str(proof.get("reemit")))
        });
        claim_words = "not re-performed".to_string();
    } else if ck == "verdict" {
        claim_words = "the verdict was not replayed: this reader verifies the record (tier 1) and does not re-perform verdicts".to_string();
        cant_tell.push(claim_words.clone());
    } else if ck == "release" && pk == "release" {
        let (rp, rn) = check_release(t.as_ref(), claim, proof);
        problems.extend(rp);
        notes.extend(rn);
        claim_words = format!(
            "not re-performed: whether engine {} is a closed label below an open one is the engine's to say, and this reader (tier 1) carries no engine",
            js_str(claim.get("engine"))
        );
        cant_tell.push(claim_words.clone());
        let lrec = f.get("lock").unwrap().get("record");
        if truthy(lrec) && rec_checked && rec_entries.is_some() {
            if let Ok(rr) = ledger::read_record(&record_file, &record_file.display().to_string(), iss.as_ref().map(|i| i.public_key.as_str())) {
                for fr in lrec.unwrap().get("frags").and_then(|x| x.as_arr()).cloned().unwrap_or_default() {
                    let sq = fr.get("seq").and_then(|x| x.as_num()).unwrap_or(0.0) as usize;
                    let b2 = record_body_of(rr.entries.get(sq));
                    let want = js_str(fr.get("frag_id"));
                    if b2.as_ref().map_or(true, |b| b.frag_id != want) {
                        problems.push(format!(
                            "{}: the release names frag {} at entry {}, and the record holds {} there",
                            RECORD_FILE,
                            short16(&want),
                            sq,
                            b2.map(|b| short16(&b.frag_id)).unwrap_or_else(|| "no frag".into())
                        ));
                    }
                }
            }
        }
    } else {
        claim_words = "not re-performed".to_string();
    }
    let intact = problems.is_empty();
    let code = if !intact {
        4
    } else if !cant_tell.is_empty() {
        2
    } else {
        0
    };
    let mut head = vec![PROTOTYPE_LINE.to_string()];
    if !intact {
        head.push(format!("{}: the frag is not what it says it is.", TAMPERED));
        head.extend(problems.iter().map(|p| format!("  - {}", p)));
    } else {
        head.push(format!("On opening: {}", if code == 0 { "intact and re-performed." } else { "intact; some of it cannot be told here." }));
        head.push(format!("  frag {}", stated_id));
        head.push(format!(
            "  signature: {}, key {}{}",
            if sig_ok { "verifies" } else { "fails" },
            sig_fp.as_deref().map(short16).unwrap_or_else(|| "?".into()),
            iss.as_ref().map(|i| format!(" (the issuer's: {})", i.note)).unwrap_or_else(|| " (issuer not pinned)".into())
        ));
        head.push(format!("  record: {}", rec_words));
        head.push(format!("  pins: {}", pins_words));
        head.push(format!("  claim: {}", claim_words));
        head.extend(cant_tell.iter().map(|c| format!("  can't tell: {}", c)));
        head.extend(notes.iter().map(|n| format!("  note: {}", n)));
        let ct = cover_text(&f);
        let sheet: Vec<String> = ct.trim_end().split('\n').skip(1).map(String::from).collect();
        if !sheet.is_empty() {
            head.push(String::new());
            head.extend(sheet);
        }
    }
    Opened { exit: code, cover: head, problems, cant_tell, notes, frag_id: Some(stated_id) }
}

pub const USAGE: &str = "prototype; no measured accuracy\n\
usage:\n\
\x20 riposte-record frag open <frag folder> [--tree <repository root>] [--record <frags.jsonl>] [--issuer <ISSUER.json | public key.pem>]\n\
\x20 (a reader, tier 1: build, release, import, export, emit, contract and the opening of work-frag chains are node packages/frag/dist/cli.js's)";

const VALUE_FLAGS: [&str; 21] = [
    "--tree", "--name", "--title", "--claim", "--key", "--out", "--issuer", "--tier", "--supersedes", "--engine", "--record", "--declared", "--resolved",
    "--rollout", "--contract", "--root", "--actor", "--action", "--parents", "--ledger", "--trajectory",
];

fn is_work_chain_file(p: &Path) -> bool {
    p.is_file()
        && read_text_lossy(p).and_then(|t| json::parse(&t).ok()).map_or(false, |x| x.is_obj() && json::is_str(x.get("schema"), WORK_CHAIN_SCHEMA))
}

/// `frag <verb> ...` with `cwd` as the working folder.
pub fn frag_cli(argv: &[String], cwd: &Path) -> CmdResult {
    let cmd = argv.first().map(String::as_str);
    let args = if argv.is_empty() { &argv[..] } else { &argv[1..] };
    let res = |code: i32, out: String, err: String| CmdResult { code, out, err };
    if matches!(cmd, Some("help") | Some("--help")) {
        return res(0, format!("{}\n", USAGE), String::new());
    }
    let mut flags: Vec<(String, String)> = Vec::new();
    let mut rest: Vec<String> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if VALUE_FLAGS.contains(&a.as_str()) {
            match args.get(i + 1) {
                Some(v) if !(v.starts_with("--") && v.len() > 2) => {
                    if flags.iter().any(|(k, _)| k == a) {
                        return res(3, String::new(), format!("frag: {} given twice\n{}\n", a, USAGE));
                    }
                    flags.push((a.clone(), v.clone()));
                    i += 2;
                    continue;
                }
                _ => return res(3, String::new(), format!("frag: {} needs a value\n{}\n", a, USAGE)),
            }
        }
        if a == "--json" {
            return res(3, String::new(), format!("frag: --json is the Node tool's (this reader prints the sheet)\n{}\n", USAGE));
        } else if a.starts_with("--") {
            return res(3, String::new(), format!("frag: unknown flag {}\n{}\n", a, USAGE));
        } else {
            rest.push(a.clone());
        }
        i += 1;
    }
    if let Some(c) = cmd.filter(|c| matches!(*c, "build" | "release" | "import" | "export" | "emit" | "contract")) {
        return res(3, String::new(), format!("frag {}: this reader only opens frags (node packages/frag/dist/cli.js {})\n", c, c));
    }
    if cmd == Some("open") && rest.len() == 1 && is_work_chain_file(&join_norm(cwd, &rest[0])) {
        return res(
            3,
            String::new(),
            format!(
                "frag open: {} is a chain of work frags ({}): node packages/frag/dist/cli.js open re-performs it; this reader opens frag folders\n",
                rest[0], WORK_CHAIN_SCHEMA
            ),
        );
    }
    if cmd == Some("open") {
        let allowed = ["--tree", "--record", "--issuer"];
        if rest.len() != 1 || flags.iter().any(|(k, _)| !allowed.contains(&k.as_str())) {
            return res(3, String::new(), format!("frag open: give one frag folder\n{}\n", USAGE));
        }
        let get = |k: &str| flags.iter().find(|(f, _)| f == k).map(|(_, v)| v.as_str());
        let r = open_frag(&rest[0], get("--tree"), get("--record"), get("--issuer"), cwd);
        return res(r.exit, r.cover.join("\n") + "\n", String::new());
    }
    res(3, String::new(), format!("{}\n", USAGE))
}

/// One frag.json held in memory (the C ABI's entry): the strict reader, the shape, the id and the signature by the key it
/// carries. 2 intact as far as one file shows (the issuer, the cover, the record and the pins are outside it), 3 not a frag,
/// 4 tampered (the id does not recompute or the signature does not verify).
pub fn verify_frag_bytes(b: &[u8], issuer_pem: Option<&str>) -> i32 {
    let f = match strict::decode_utf8_strict(b, FRAG_FILE).and_then(|t| strict::parse_json_strict(&t, FRAG_FILE)) {
        Ok(v) => v,
        Err(_) => return 3,
    };
    if !frag_shape_problems(&f).is_empty() {
        return 3;
    }
    let stated = f.get("frag_id").and_then(|x| x.as_str()).unwrap_or_default();
    if frag_id_of(&f) != stated {
        return 4;
    }
    let (ok, _, _) = verify_frag_signature(&f, f.get("signature"), issuer_pem);
    if !ok {
        return 4;
    }
    if issuer_pem.is_some() {
        0
    } else {
        2
    }
}
