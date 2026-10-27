// SPDX-License-Identifier: Apache-2.0
//! The work graph's format, read: work frags (riposte.work-frag/0.1.0), charters, the derived statuses and container states,
//! the one-line digest, a deposited file (riposte.workgraph/0.1.0) and a store's index chain and head record. Written from the
//! Python reader (conformance/engine_py/record/workgraph.py), which follows packages/workgraph/SCHEMA.md and its src/. It
//! writes nothing.

use crate::json::{self, cmp16, is_hex64, is_safe_integer, js_slice, js_str, sha256_text, utf16_len, JStr, Obj, Value};
use crate::keys;
use crate::paths::join_norm;
use crate::CmdResult;
use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub const MAX_DEPTH: usize = 64;
pub const WORK_FRAG_SCHEMA: &str = "riposte.work-frag/0.1.0";
pub const CHARTER_SCHEMA: &str = "riposte.charter/0.1.0";
pub const BUNDLE_SCHEMA: &str = "riposte.workgraph/0.1.0";
pub const FRAG_CHAIN_SCHEMA: &str = "riposte.work-chain/0.1.0";
pub const TAMPERED: &str = "DEPOSIT TAMPERED OR NOT AS WRITTEN";
pub const SIGNING_PREFIX: &str = "riposte:charter:v0\n";
const KINDS: [&str; 5] = ["step", "decision", "guard", "claim-check", "inference"];
const LEVELS: [&str; 4] = ["task", "run", "branch", "step"];
const FINDINGS: [&str; 3] = ["pass", "fail", "cant-tell"];
const REVERSIBILITY: [&str; 3] = ["always", "maybe", "never"];
const CONTAINER_LEVELS: [&str; 3] = ["task", "run", "branch"];
const CLAUSE_KINDS: [&str; 6] = ["goal", "no-go", "better", "budget", "amend", "other"];
const ROLE_LEVELS: [&str; 5] = ["operator", "collaborator", "consultant", "approver", "observer"];
const EFFECTS: [&str; 3] = ["gate", "flag", "monitor"];
const ZERO: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const STORE_HEAD_FILE: &str = "index.jsonl.head.json";
const INDEX: &str = "index.jsonl";
const ROUTE_PREFIX: &str = "axiom-route:";
const PREDICATE_PREFIX: &str = "axiom-predicate:";
/// Object.prototype's own property names: `k in o` is true for them on any plain object (bundle.ts tests `id in prose`).
const PROTO: [&str; 12] = [
    "constructor", "__defineGetter__", "__defineSetter__", "hasOwnProperty", "__lookupGetter__", "__lookupSetter__", "isPrototypeOf",
    "propertyIsEnumerable", "toString", "valueOf", "__proto__", "toLocaleString",
];

/// A refusal: a code from SCHEMA.md section 12 and a sentence.
#[derive(Debug, Clone)]
pub struct Refused {
    pub code: String,
    pub message: String,
}

fn refused(code: &str, message: String) -> Refused {
    Refused { code: code.into(), message }
}

type R<T> = Result<T, Refused>;

// ---------------------------------------------------------------------------------------------------------------------
// canonical.ts: the work graph's own strict reader

/// canonical.ts parseStrict refusal: a sentence and the path it names (`at`), code not_json.
#[derive(Debug, Clone)]
pub struct StrictRefused {
    pub message: String,
    pub at: String,
}

impl From<StrictRefused> for Refused {
    fn from(e: StrictRefused) -> Refused {
        refused("not_json", e.message)
    }
}

pub fn decode_utf8_strict(b: &[u8], name: &str) -> Result<String, StrictRefused> {
    if crate::strict::invalid_utf8_offset(b).is_some() {
        return Err(StrictRefused { message: format!("{}: not valid UTF-8", name), at: "bytes".into() });
    }
    Ok(String::from_utf8_lossy(b).into_owned())
}

struct GP<'a> {
    c: Vec<char>,
    i: usize,
    name: &'a str,
}

impl<'a> GP<'a> {
    fn at16(&self) -> usize {
        let n = self.c.len();
        if self.i <= n {
            self.c[..self.i].iter().map(|c| c.len_utf16()).sum()
        } else {
            self.c.iter().map(|c| c.len_utf16()).sum::<usize>() + (self.i - n)
        }
    }
    fn refuse<T>(&self, what: &str, path: &str) -> Result<T, StrictRefused> {
        Err(StrictRefused { message: format!("{}: {} (at {}, character {})", self.name, what, path, self.at16()), at: path.into() })
    }
    fn ch(&self) -> Option<char> {
        self.c.get(self.i).copied()
    }
    fn ws(&mut self) {
        while matches!(self.ch(), Some(' ') | Some('\t') | Some('\n') | Some('\r')) {
            self.i += 1;
        }
    }
    fn starts(&self, s: &str) -> bool {
        let k: Vec<char> = s.chars().collect();
        self.c.len() >= self.i + k.len() && self.c[self.i..self.i + k.len()] == k[..]
    }
    fn string(&mut self, path: &str) -> Result<JStr, StrictRefused> {
        let start = self.i;
        self.i += 1;
        loop {
            if self.i >= self.c.len() {
                return self.refuse("a string is not closed", path);
            }
            let c = self.c[self.i];
            if c == '"' {
                break;
            }
            self.i += if c == '\\' { 2 } else { 1 };
        }
        self.i += 1;
        let tok: String = self.c[start..self.i].iter().collect();
        match json::parse_string_token(&tok) {
            Some(s) => Ok(s),
            None => self.refuse("a string is not valid JSON", path),
        }
    }
    fn value(&mut self, path: &str, depth: usize) -> Result<Value, StrictRefused> {
        if depth > MAX_DEPTH {
            return self.refuse(&format!("nesting deeper than {} levels", MAX_DEPTH), path);
        }
        self.ws();
        match self.ch() {
            Some('{') => {
                self.i += 1;
                let mut out = Obj::new();
                self.ws();
                if self.ch() == Some('}') {
                    self.i += 1;
                    return Ok(Value::Obj(out));
                }
                loop {
                    self.ws();
                    if self.ch() != Some('"') {
                        return self.refuse("expected a key", path);
                    }
                    let k = self.string(path)?;
                    let kp = crate::strict::path_step_key(path, &k);
                    if out.has_j(&k) {
                        return self.refuse(&format!("the key {} appears twice in one object", json::js_string(&k)), &kp);
                    }
                    self.ws();
                    if self.ch() != Some(':') {
                        return self.refuse("expected \":\"", &kp);
                    }
                    self.i += 1;
                    let v = self.value(&kp, depth + 1)?;
                    out.set_j(k, v);
                    self.ws();
                    match self.ch() {
                        Some(',') => {
                            self.i += 1;
                        }
                        Some('}') => {
                            self.i += 1;
                            return Ok(Value::Obj(out));
                        }
                        _ => return self.refuse("expected \",\" or \"}\"", path),
                    }
                }
            }
            Some('[') => {
                self.i += 1;
                let mut out = Vec::new();
                self.ws();
                if self.ch() == Some(']') {
                    self.i += 1;
                    return Ok(Value::Arr(out));
                }
                loop {
                    let p = format!("{}[{}]", path, out.len());
                    out.push(self.value(&p, depth + 1)?);
                    self.ws();
                    match self.ch() {
                        Some(',') => {
                            self.i += 1;
                        }
                        Some(']') => {
                            self.i += 1;
                            return Ok(Value::Arr(out));
                        }
                        _ => return self.refuse("expected \",\" or \"]\"", path),
                    }
                }
            }
            Some('"') => Ok(Value::Str(self.string(path)?)),
            _ => {
                if self.starts("true") {
                    self.i += 4;
                    return Ok(Value::Bool(true));
                }
                if self.starts("false") {
                    self.i += 5;
                    return Ok(Value::Bool(false));
                }
                if self.starts("null") {
                    self.i += 4;
                    return Ok(Value::Null);
                }
                // -?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)? at i
                let ascii: Vec<u8> = self.c[self.i..].iter().take_while(|c| c.is_ascii()).map(|c| *c as u8).collect();
                if let Some(end) = json::number_end(&ascii, 0) {
                    let tok = core::str::from_utf8(&ascii[..end]).unwrap().to_string();
                    let x = crate::strict::number_of(&tok);
                    if !x.is_finite() {
                        return self.refuse(&format!("the number {} is not finite", tok), path);
                    }
                    if !crate::strict::number_text_is_exact(&tok) {
                        let shown = if utf16_len(&tok) > 40 { format!("{}...", js_slice(&tok, 32)) } else { tok.clone() };
                        return self.refuse(&format!("the number {} does not read back as written (it reads as {})", shown, json::js_num_str(x)), path);
                    }
                    self.i += end;
                    return Ok(Value::Num(x));
                }
                self.refuse("expected a value", path)
            }
        }
    }
}

/// canonical.ts parseStrict: each refusal with its path and the character (counted in UTF-16 code units).
pub fn parse_strict(text: &str, name: &str) -> Result<Value, StrictRefused> {
    if text.starts_with('\u{FEFF}') {
        return Err(StrictRefused { message: format!("{}: starts with a UTF-8 byte-order mark; save it without one", name), at: "character 0".into() });
    }
    let mut p = GP { c: text.chars().collect(), i: 0, name };
    let v = p.value("$", 0)?;
    p.ws();
    if p.i < p.c.len() {
        return p.refuse("text after the value", "$");
    }
    Ok(v)
}

pub fn parse_strict_bytes(b: &[u8], name: &str) -> Result<Value, StrictRefused> {
    parse_strict(&decode_utf8_strict(b, name)?, name)
}

// ---------------------------------------------------------------------------------------------------------------------
// Date.parse for the one ISO form the format allows (YYYY-MM-DDTHH:MM:SS[.fff]Z), as V8 reads it

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn iso_shape(s: &str) -> bool {
    let b = s.as_bytes();
    let d = |i: usize| b.get(i).map_or(false, |c| c.is_ascii_digit());
    if b.len() < 20 {
        return false;
    }
    let base = (0..4).all(d) && b[4] == b'-' && d(5) && d(6) && b[7] == b'-' && d(8) && d(9) && b[10] == b'T' && d(11) && d(12) && b[13] == b':'
        && d(14) && d(15) && b[16] == b':' && d(17) && d(18);
    if !base {
        return false;
    }
    if b.len() == 20 {
        return b[19] == b'Z';
    }
    b[19] == b'.' && (21..=24).contains(&b.len()) && (20..b.len() - 1).all(d) && b[b.len() - 1] == b'Z'
}

/// Date.parse(s) in milliseconds for a string of the ISO shape; NaN where V8 answers NaN.
pub fn date_parse(s: &str) -> f64 {
    let n = |a: usize, b: usize| s[a..b].parse::<i64>().unwrap();
    let (y, mo, d, h, mi, sec) = (n(0, 4), n(5, 7), n(8, 10), n(11, 13), n(14, 16), n(17, 19));
    let frac = if s.len() > 20 { &s[20..s.len() - 1] } else { "" };
    let ms = if frac.is_empty() { 0 } else { format!("{}00", frac)[..3].parse::<i64>().unwrap() };
    if !((1..=12).contains(&mo) && (1..=31).contains(&d) && h <= 24 && mi <= 59 && sec <= 59) {
        return f64::NAN;
    }
    if h == 24 && (mi != 0 || sec != 0 || ms != 0) {
        return f64::NAN;
    }
    ((days_from_civil(y, mo, 1) + d - 1) * 86400000 + h * 3600000 + mi * 60000 + sec * 1000 + ms) as f64
}

// ---------------------------------------------------------------------------------------------------------------------
// schema.ts

fn is_id(x: Option<&Value>) -> bool {
    x.and_then(|v| v.as_str()).map_or(false, |s| is_hex64(&s))
}
fn is_iso(x: Option<&Value>) -> bool {
    x.and_then(|v| v.as_str()).map_or(false, |s| iso_shape(&s) && !date_parse(&s).is_nan())
}
fn is_strv(x: Option<&Value>) -> bool {
    matches!(x, Some(Value::Str(_)))
}
fn nonempty_str(x: Option<&Value>) -> bool {
    matches!(x, Some(Value::Str(s)) if !s.0.is_empty())
}
fn one_line(x: Option<&Value>) -> bool {
    match x {
        Some(Value::Str(s)) => !s.0.is_empty() && !s.0.contains(&13) && !s.0.contains(&10),
        _ => false,
    }
}
fn is_role(x: Option<&Value>) -> bool {
    one_line(x) && x.unwrap().as_jstr().unwrap().len16() <= 80 && !x.unwrap().as_jstr().unwrap().0.contains(&(b'@' as u16))
}
fn sv(x: Option<&Value>) -> String {
    x.and_then(|v| v.as_str()).unwrap_or_default()
}
fn opt_s(x: Option<&Value>) -> Option<String> {
    match x {
        Some(Value::Str(s)) => Some(s.lossy()),
        _ => None,
    }
}
fn in_set(x: Option<&Value>, set: &[&str]) -> bool {
    x.and_then(|v| v.as_str()).map_or(false, |s| set.contains(&s.as_str()))
}

/// The id: sha256 hex of canonical JSON of the frag with `id` removed.
pub fn frag_id(f: &Value) -> String {
    match f.as_obj() {
        Some(o) => sha256_text(&json::canonicalize(&Value::Obj(o.without(&["id"])))),
        None => sha256_text(&json::canonicalize(f)),
    }
}

fn exact_keys(o: &Obj, keys: &[&str], wh: &str) -> R<()> {
    for k in keys {
        if !o.has(k) {
            return Err(refused(
                "field_missing",
                format!("{}: the field \"{}\" is missing (every field is present; write null where it does not apply)", wh, k),
            ));
        }
    }
    for k in o.keys_lossy() {
        if !keys.contains(&k.as_str()) {
            return Err(refused("field_unexpected", format!("{}: the field \"{}\" is not part of {}", wh, k, WORK_FRAG_SCHEMA)));
        }
    }
    Ok(())
}

fn type_err(wh: &str, what: &str) -> Refused {
    refused("field_type", format!("{}: {}", wh, what))
}

fn digests(x: Option<&Value>, wh: &str) -> R<Vec<(String, String)>> {
    let a = x.and_then(|v| v.as_arr()).ok_or_else(|| type_err(wh, "must be an array of { name, sha256 }"))?;
    let mut out = Vec::new();
    for (i, d) in a.iter().enumerate() {
        let w = format!("{}[{}]", wh, i);
        let o = d.as_obj().ok_or_else(|| type_err(&w, "must be { name, sha256 }"))?;
        exact_keys(o, &["name", "sha256"], &w)?;
        if !one_line(o.get("name")) {
            return Err(type_err(&format!("{}.name", w), "must be a non-empty one-line string"));
        }
        if !is_id(o.get("sha256")) {
            return Err(type_err(&format!("{}.sha256", w), "must be 64 lowercase hex characters"));
        }
        out.push((sv(o.get("name")), sv(o.get("sha256"))));
    }
    Ok(out)
}

fn no_crlf(s: &str) -> bool {
    !s.contains('\r') && !s.contains('\n')
}

/// person:[^@\r\n]+ | [^\r\n]+@[^@\r\n]+
fn check_by_ok(s: &str) -> bool {
    if let Some(r) = s.strip_prefix("person:") {
        if !r.is_empty() && !r.contains('@') && no_crlf(r) {
            return true;
        }
    }
    if !no_crlf(s) {
        return false;
    }
    match s.rfind('@') {
        Some(p) => p > 0 && p < s.len() - 1,
        None => false,
    }
}

/// person:[^@\r\n]+ | model:[^\r\n]+ | tool:[^\r\n]+@[^@\r\n]+
fn who_ok(s: &str) -> bool {
    if let Some(r) = s.strip_prefix("person:") {
        if !r.is_empty() && !r.contains('@') && no_crlf(r) {
            return true;
        }
    }
    if let Some(r) = s.strip_prefix("model:") {
        if !r.is_empty() && no_crlf(r) {
            return true;
        }
    }
    if let Some(r) = s.strip_prefix("tool:") {
        if no_crlf(r) {
            if let Some(p) = r.rfind('@') {
                return p > 0 && p < r.len() - 1;
            }
        }
    }
    false
}

fn py_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// axiom-route:[^@\s]+@[^@\s]+
fn route_tell_ok(s: &str) -> bool {
    match s.strip_prefix(ROUTE_PREFIX) {
        None => false,
        Some(r) => {
            let parts: Vec<&str> = r.split('@').collect();
            parts.len() == 2 && parts.iter().all(|p| !p.is_empty() && !p.chars().any(py_space))
        }
    }
}

/// axiom(?:-[a-z0-9-]+)?: at the start, and not a predicate.
pub fn is_routing_checker(cid: &str) -> bool {
    let ns = if cid.starts_with("axiom:") {
        true
    } else if let Some(r) = cid.strip_prefix("axiom-") {
        let k = r.bytes().take_while(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-').count();
        k > 0 && r.as_bytes().get(k) == Some(&b':')
    } else {
        false
    };
    ns && !cid.starts_with(PREDICATE_PREFIX)
}

#[derive(Clone, Debug)]
pub struct Check {
    pub by: String,
    pub finding: String,
    pub detail: String,
}

fn validate_checks(x: Option<&Value>, wh: &str) -> R<Vec<Check>> {
    let a = x.and_then(|v| v.as_arr()).ok_or_else(|| refused("check_shape", format!("{}: must be an array of {{ by, finding, detail }}", wh)))?;
    let mut out = Vec::new();
    for (i, c) in a.iter().enumerate() {
        let o = c.as_obj().ok_or_else(|| refused("check_shape", format!("{}[{}]: must be {{ by, finding, detail }}", wh, i)))?;
        for k in ["by", "finding", "detail"] {
            if !o.has(k) {
                return Err(refused("check_shape", format!("{}[{}]: the field \"{}\" is missing", wh, i, k)));
            }
        }
        for k in o.keys_lossy() {
            if !["by", "finding", "detail"].contains(&k.as_str()) {
                return Err(refused("check_shape", format!("{}[{}]: the field \"{}\" is not part of a check", wh, i, k)));
            }
        }
        if !is_strv(o.get("by")) || !check_by_ok(&sv(o.get("by"))) {
            return Err(refused("check_shape", format!("{}[{}].by: must be \"<checker id>@<version>\" or \"person:<role>\"", wh, i)));
        }
        if !in_set(o.get("finding"), &FINDINGS) {
            return Err(refused("check_shape", format!("{}[{}].finding: must be pass, fail or cant-tell", wh, i)));
        }
        if !is_strv(o.get("detail")) {
            return Err(refused("check_shape", format!("{}[{}].detail: must be a string", wh, i)));
        }
        out.push(Check { by: sv(o.get("by")), finding: sv(o.get("finding")), detail: sv(o.get("detail")) });
    }
    Ok(out)
}

#[derive(Clone, Debug)]
pub enum Actor {
    Model { declared: Option<String>, resolved: Option<String> },
    Person(String),
    Tool { name: String, version: String },
}

impl Actor {
    fn kind(&self) -> &'static str {
        match self {
            Actor::Model { .. } => "model",
            Actor::Person(_) => "person",
            Actor::Tool { .. } => "tool",
        }
    }
}

fn actor_of(x: Option<&Value>) -> R<Actor> {
    let o = x.and_then(|v| v.as_obj()).ok_or_else(|| refused("actor_shape", "actor: must be { kind, model, person, tool }".into()))?;
    exact_keys(o, &["kind", "model", "person", "tool"], "actor")?;
    let k = o.get("kind");
    if !in_set(k, &["model", "person", "tool"]) {
        return Err(refused("actor_shape", "actor.kind: must be model, person or tool".into()));
    }
    let k = sv(k);
    for f in ["model", "person", "tool"] {
        if f != k && !o.get(f).unwrap().is_null() {
            return Err(refused("actor_shape", format!("actor: a {} actor has \"{}\": null", k, f)));
        }
    }
    match k.as_str() {
        "model" => {
            let m = o.get("model").and_then(|v| v.as_obj()).ok_or_else(|| refused("actor_shape", "actor.model: must be { declared, resolved }".into()))?;
            exact_keys(m, &["declared", "resolved"], "actor.model")?;
            if !m.get("declared").unwrap().is_null() && !one_line(m.get("declared")) {
                return Err(refused(
                    "actor_shape",
                    "actor.model.declared: must be the model id named for the work, or null when nothing declared one (never copied from resolved)".into(),
                ));
            }
            if !m.get("resolved").unwrap().is_null() && !one_line(m.get("resolved")) {
                return Err(refused("actor_shape", "actor.model.resolved: must be the id the reply carried, or null when not attested".into()));
            }
            Ok(Actor::Model { declared: opt_s(m.get("declared")), resolved: opt_s(m.get("resolved")) })
        }
        "person" => {
            if !is_role(o.get("person")) {
                return Err(refused("person_not_a_role", "actor.person: must be a role (owner, approver, reviewer), never a personal name or contact".into()));
            }
            Ok(Actor::Person(sv(o.get("person"))))
        }
        _ => {
            let t = o.get("tool").and_then(|v| v.as_obj()).ok_or_else(|| refused("actor_shape", "actor.tool: must be { name, version }".into()))?;
            exact_keys(t, &["name", "version"], "actor.tool")?;
            if !one_line(t.get("name")) || !one_line(t.get("version")) {
                return Err(refused("actor_shape", "actor.tool: name and version must be one-line strings".into()));
            }
            Ok(Actor::Tool { name: sv(t.get("name")), version: sv(t.get("version")) })
        }
    }
}

#[derive(Clone, Debug)]
pub struct Answer {
    pub choice: String,
    pub who: String,
    pub when: String,
    pub state_digest: String,
}

#[derive(Clone, Debug)]
pub struct Decision {
    pub raw: Value,
    pub question: String,
    pub options: Vec<String>,
    pub reversibility: String,
    pub policy: String,
    pub max_wait_s: f64,
    pub state_digest: String,
    pub asks: Option<String>,
    pub answer: Option<Answer>,
}

fn decision_block(b: &Obj, parents: &[String]) -> R<Decision> {
    exact_keys(b, &["question", "options", "reversibility", "deferral", "state_digest", "asks", "answer"], "decision")?;
    if !nonempty_str(b.get("question")) {
        return Err(type_err("decision.question", "must be a non-empty string"));
    }
    let opts = b.get("options").and_then(|v| v.as_arr());
    if !opts.map_or(false, |a| !a.is_empty() && a.iter().all(|o| nonempty_str(Some(o)))) {
        return Err(type_err("decision.options", "must be at least one non-empty string"));
    }
    if !in_set(b.get("reversibility"), &REVERSIBILITY) {
        return Err(type_err("decision.reversibility", "must be always, maybe or never (can the choice be undone?)"));
    }
    let d = b.get("deferral").and_then(|v| v.as_obj()).ok_or_else(|| type_err("decision.deferral", "must be { policy, max_wait_s }"))?;
    exact_keys(d, &["policy", "max_wait_s"], "decision.deferral")?;
    if !json::is_str(d.get("policy"), "now") && !json::is_str(d.get("policy"), "next-breakpoint") {
        return Err(type_err("decision.deferral.policy", "must be now or next-breakpoint"));
    }
    if !is_safe_integer(d.get("max_wait_s")) || d.get("max_wait_s").unwrap().as_num().unwrap() < 0.0 {
        return Err(type_err("decision.deferral.max_wait_s", "must be a whole number of seconds, zero or more"));
    }
    if !is_id(b.get("state_digest")) {
        return Err(type_err("decision.state_digest", "must be 64 lowercase hex characters"));
    }
    let asks_null = b.get("asks").unwrap().is_null();
    let ans_null = b.get("answer").unwrap().is_null();
    let ask = asks_null && ans_null;
    let answer = !asks_null && !ans_null;
    if !ask && !answer {
        return Err(refused("answer_without_ask", "decision: an ask has asks and answer both null; an answer has both set".into()));
    }
    let mut ans = None;
    if answer {
        if !is_id(b.get("asks")) {
            return Err(type_err("decision.asks", "must be the id of the ask this answers"));
        }
        if !parents.contains(&sv(b.get("asks"))) {
            return Err(refused("answer_without_ask", "decision: an answer lists the ask it answers among its parents".into()));
        }
        let a = b.get("answer").and_then(|v| v.as_obj()).ok_or_else(|| type_err("decision.answer", "must be { choice, who, when, state_digest }"))?;
        exact_keys(a, &["choice", "who", "when", "state_digest"], "decision.answer")?;
        if !nonempty_str(a.get("choice")) {
            return Err(type_err("decision.answer.choice", "must be a non-empty string"));
        }
        if !is_strv(a.get("who")) || !who_ok(&sv(a.get("who"))) {
            return Err(type_err("decision.answer.who", "must be person:<role>, model:<resolved id> or tool:<name>@<version>"));
        }
        if !is_iso(a.get("when")) {
            return Err(type_err("decision.answer.when", "must be an ISO-8601 UTC time"));
        }
        if !is_id(a.get("state_digest")) {
            return Err(type_err("decision.answer.state_digest", "must be 64 lowercase hex characters"));
        }
        ans = Some(Answer { choice: sv(a.get("choice")), who: sv(a.get("who")), when: sv(a.get("when")), state_digest: sv(a.get("state_digest")) });
    }
    Ok(Decision {
        raw: Value::Obj(b.clone()),
        question: sv(b.get("question")),
        options: opts.unwrap().iter().map(|o| sv(Some(o))).collect(),
        reversibility: sv(b.get("reversibility")),
        policy: sv(d.get("policy")),
        max_wait_s: d.get("max_wait_s").unwrap().as_num().unwrap(),
        state_digest: sv(b.get("state_digest")),
        asks: opt_s(b.get("asks")),
        answer: ans,
    })
}

#[derive(Clone, Debug)]
pub struct Frag {
    pub v: Value,
    pub id: String,
    pub kind: String,
    pub level: String,
    pub parents: Vec<String>,
    pub charter: Option<(String, String)>,
    pub actor: Actor,
    pub action: String,
    pub claim: Option<String>,
    pub checks: Vec<Check>,
    pub inputs: Vec<(String, String)>,
    pub outputs: Vec<(String, String)>,
    pub tokens: Option<(f64, f64)>,
    pub started: Option<String>,
    pub ended: Option<String>,
    pub closes: Option<String>,
    pub decision: Option<Decision>,
    pub guard: Option<(String, String, String)>,
    pub claim_check: Option<(String, String)>,
    pub inference: Option<(String, String, Option<String>)>,
}

const COMMON: [&str; 15] = ["schema", "id", "kind", "level", "parents", "charter", "actor", "inputs", "action", "outputs", "claim", "checks", "tokens", "time", "closes"];

/// validateFrag: one frag's shape, id and kind rules; the first rule broken refused.
pub fn validate(x: &Value, check_id: bool) -> R<Frag> {
    let o = x.as_obj().ok_or_else(|| refused("field_type", "a work frag is a JSON object".into()))?;
    if !json::is_str(o.get("schema"), WORK_FRAG_SCHEMA) {
        return Err(refused("schema_wrong", format!("schema: must be \"{}\"", WORK_FRAG_SCHEMA)));
    }
    if !in_set(o.get("kind"), &KINDS) {
        return Err(type_err("kind", &format!("must be one of {}", KINDS.join(", "))));
    }
    let kind = sv(o.get("kind"));
    let mut keys: Vec<&str> = COMMON.iter().copied().filter(|k| check_id || *k != "id").collect();
    if kind != "step" {
        keys.push(KINDS.iter().find(|k| **k == kind).unwrap());
    }
    for k in KINDS {
        if k != "step" && k != kind && o.has(k) {
            return Err(refused("field_unexpected", format!("a {} frag carries no \"{}\" block", kind, k)));
        }
    }
    if kind != "step" && !o.has(&kind) {
        return Err(refused("kind_block_missing", format!("a {} frag carries a \"{}\" block", kind, kind)));
    }
    exact_keys(o, &keys, "frag")?;
    if check_id && !is_id(o.get("id")) {
        return Err(type_err("id", "must be 64 lowercase hex characters"));
    }
    if !in_set(o.get("level"), &LEVELS) {
        return Err(type_err("level", &format!("must be one of {}", LEVELS.join(", "))));
    }
    let ps_v = o.get("parents").and_then(|v| v.as_arr());
    if !ps_v.map_or(false, |a| a.iter().all(|p| is_id(Some(p)))) {
        return Err(type_err("parents", "must be an array of ids"));
    }
    let ps: Vec<String> = ps_v.unwrap().iter().map(|p| sv(Some(p))).collect();
    for i in 1..ps.len() {
        if ps[i - 1] >= ps[i] {
            return Err(refused("parents_not_sorted", "parents: must be sorted ascending with no repeats, so one set of parents has one id".into()));
        }
    }
    let mut charter = None;
    let cv = o.get("charter").unwrap();
    if !cv.is_null() {
        let c = cv.as_obj().ok_or_else(|| type_err("charter", "must be { id, clause } or null"))?;
        exact_keys(c, &["id", "clause"], "charter")?;
        if !is_id(c.get("id")) {
            return Err(type_err("charter.id", "must be the charter id"));
        }
        if !one_line(c.get("clause")) {
            return Err(type_err("charter.clause", "must be a clause id"));
        }
        charter = Some((sv(c.get("id")), sv(c.get("clause"))));
    }
    let a = actor_of(o.get("actor"))?;
    let inputs = digests(o.get("inputs"), "inputs")?;
    let outputs = digests(o.get("outputs"), "outputs")?;
    if !one_line(o.get("action")) || o.get("action").unwrap().as_jstr().unwrap().len16() > 240 {
        return Err(type_err("action", "must be one line, \"<verb> <object>\", at most 240 characters"));
    }
    let claim_v = o.get("claim").unwrap();
    if !claim_v.is_null() && !nonempty_str(Some(claim_v)) {
        return Err(type_err("claim", "must be a non-empty string or null"));
    }
    if !claim_v.is_null() && !(kind == "step" && a.kind() == "model") {
        return Err(refused("claim_not_from_model_step", "claim: only a step by a model may carry a claim; people and tools record actions and checks".into()));
    }
    let checks = validate_checks(o.get("checks"), "checks")?;
    let t = o.get("tokens").unwrap();
    let mut tokens = None;
    if !json::is_str(Some(t), "absent") {
        let to = t.as_obj().ok_or_else(|| type_err("tokens", "must be { in, out } or \"absent\" (declared, never estimated)"))?;
        exact_keys(to, &["in", "out"], "tokens")?;
        let ok = is_safe_integer(to.get("in"))
            && is_safe_integer(to.get("out"))
            && to.get("in").unwrap().as_num().unwrap() >= 0.0
            && to.get("out").unwrap().as_num().unwrap() >= 0.0;
        if !ok {
            return Err(type_err("tokens", "in and out must be whole numbers, zero or more"));
        }
        tokens = Some((to.get("in").unwrap().as_num().unwrap(), to.get("out").unwrap().as_num().unwrap()));
    }
    let tm = o.get("time").and_then(|v| v.as_obj()).ok_or_else(|| type_err("time", "must be { started, ended }"))?;
    exact_keys(tm, &["started", "ended"], "time")?;
    for k in ["started", "ended"] {
        if !tm.get(k).unwrap().is_null() && !is_iso(tm.get(k)) {
            return Err(type_err(
                &format!("time.{}", k),
                "must be an ISO-8601 UTC time (YYYY-MM-DDTHH:MM:SS[.fff]Z), or null when not recorded (never invented)",
            ));
        }
    }
    let started = opt_s(tm.get("started"));
    let ended = opt_s(tm.get("ended"));
    if let (Some(s), Some(e)) = (&started, &ended) {
        if date_parse(e) < date_parse(s) {
            return Err(refused("time_order", "time: ended is before started".into()));
        }
    }
    let closes_v = o.get("closes").unwrap();
    if !closes_v.is_null() && !is_id(Some(closes_v)) {
        return Err(type_err("closes", "must be an id or null"));
    }
    let mut decision = None;
    let mut guard = None;
    let mut claim_check = None;
    let mut inference = None;
    match kind.as_str() {
        "decision" => {
            let b = o.get("decision").and_then(|v| v.as_obj()).ok_or_else(|| type_err("decision", "must be an object"))?;
            decision = Some(decision_block(b, &ps)?);
        }
        "guard" => {
            let g = o.get("guard").and_then(|v| v.as_obj()).ok_or_else(|| type_err("guard", "must be { blocked, rule, shown }"))?;
            exact_keys(g, &["blocked", "rule", "shown"], "guard")?;
            if !nonempty_str(g.get("blocked")) || !one_line(g.get("rule")) || !is_strv(g.get("shown")) {
                return Err(type_err("guard", "blocked and rule must be non-empty, shown a string"));
            }
            guard = Some((sv(g.get("blocked")), sv(g.get("rule")), sv(g.get("shown"))));
        }
        "claim-check" => {
            let c = o.get("claim-check").and_then(|v| v.as_obj()).ok_or_else(|| type_err("claim-check", "must be { target, result }"))?;
            exact_keys(c, &["target", "result"], "claim-check")?;
            if a.kind() == "model" {
                return Err(refused("claim_check_by_model", "claim-check: made by a tool or a person; a model's view of another frag is an inference".into()));
            }
            if checks.is_empty() {
                return Err(refused("claim_check_without_evidence", "claim-check: carries at least one check, the evidence for its result".into()));
            }
            if !is_id(c.get("target")) {
                return Err(type_err("claim-check.target", "must be the id of the frag judged"));
            }
            if ps.contains(&sv(c.get("target"))) {
                return Err(refused("target_in_parents", "claim-check: the target is not a parent (judging a frag is not relying on it)".into()));
            }
            if !in_set(c.get("result"), &["holds", "wrong", "cant-tell"]) {
                return Err(type_err("claim-check.result", "must be holds, wrong or cant-tell"));
            }
            claim_check = Some((sv(c.get("target")), sv(c.get("result"))));
        }
        "inference" => {
            let nf = o.get("inference").and_then(|v| v.as_obj()).ok_or_else(|| type_err("inference", "must be { opinion, prediction, tell }"))?;
            exact_keys(nf, &["opinion", "prediction", "tell"], "inference")?;
            if ps.is_empty() {
                return Err(refused("inference_without_receipts", "inference: names the receipts it was read from as its parents".into()));
            }
            if a.kind() == "person" {
                return Err(refused("inference_actor", "inference: made by a model or a tool".into()));
            }
            if !nonempty_str(nf.get("opinion")) || !nonempty_str(nf.get("prediction")) {
                return Err(type_err("inference", "opinion and prediction must be non-empty strings"));
            }
            if !nf.get("tell").unwrap().is_null() && !one_line(nf.get("tell")) {
                return Err(type_err("inference.tell", "must be a catalogue id or null"));
            }
            inference = Some((sv(nf.get("opinion")), sv(nf.get("prediction")), opt_s(nf.get("tell"))));
        }
        _ => {}
    }
    if kind != "inference" {
        if let Some(hit) = checks.iter().find(|c| is_routing_checker(&c.by)) {
            return Err(refused(
                "route_cannot_check",
                format!(
                    "checks: \"{}\" is a routing hit; it may appear only in an inference frag (as its tell), never as a check that could pass or stop a gate",
                    hit.by
                ),
            ));
        }
        if let Actor::Tool { name, .. } = &a {
            if is_routing_checker(name) {
                return Err(refused(
                    "route_cannot_check",
                    format!("actor: the tool \"{}\" is in the axiom namespace but not a predicate; a routing hit may appear only as an inference frag", name),
                ));
            }
        }
    } else if let Some((_, _, Some(tell))) = &inference {
        if tell.starts_with(ROUTE_PREFIX) && !route_tell_ok(tell) {
            return Err(type_err("inference.tell", &format!("a routing tell is written {}<id>@<hash>", ROUTE_PREFIX)));
        }
    }
    let id = sv(o.get("id"));
    if check_id {
        let want = frag_id(x);
        if id != want {
            return Err(refused("id_mismatch", format!("id: does not recompute (the content hashes to {})", want)));
        }
    }
    Ok(Frag {
        v: x.clone(),
        id,
        kind,
        level: sv(o.get("level")),
        parents: ps,
        charter,
        actor: a,
        action: sv(o.get("action")),
        claim: opt_s(Some(claim_v)),
        checks,
        inputs,
        outputs,
        tokens,
        started,
        ended,
        closes: opt_s(Some(closes_v)),
        decision,
        guard,
        claim_check,
        inference,
    })
}

pub fn short(i: &str) -> String {
    js_slice(i, 12)
}

// ---------------------------------------------------------------------------------------------------------------------
// charter.ts

fn ctype_err(wh: &str, what: &str) -> Refused {
    refused("field_type", format!("charter {}: {}", wh, what))
}

fn exact_c(o: &Obj, keys: &[&str], wh: &str) -> R<()> {
    for k in keys {
        if !o.has(k) {
            return Err(refused("field_missing", format!("charter {}: the field \"{}\" is missing", wh, k)));
        }
    }
    for k in o.keys_lossy() {
        if !keys.contains(&k.as_str()) {
            return Err(refused("field_unexpected", format!("charter {}: the field \"{}\" is not part of {}", wh, k, CHARTER_SCHEMA)));
        }
    }
    Ok(())
}

fn unit(x: Option<&Value>) -> bool {
    matches!(x, Some(Value::Num(v)) if v.is_finite() && *v >= 0.0 && *v <= 1.0)
}

/// The charter id: without `id` and without `signatures`.
pub fn charter_id(c: &Value) -> String {
    match c.as_obj() {
        Some(o) => sha256_text(&json::canonicalize(&Value::Obj(o.without(&["id", "signatures"])))),
        None => sha256_text(&json::canonicalize(c)),
    }
}

/// The bytes a charter party signs.
pub fn signing_message(c: &Value) -> Vec<u8> {
    let body = match c.as_obj() {
        Some(o) => Value::Obj(o.without(&["signatures"])),
        None => c.clone(),
    };
    format!("{}{}", SIGNING_PREFIX, json::canonicalize(&body)).into_bytes()
}

fn clause_id_ok(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 32
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b[1..].iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'_' | b'-'))
}

const CHARTER_KEYS: [&str; 11] = ["schema", "id", "supersedes", "intake", "clauses", "thresholds", "roles", "findings", "deferral", "parties", "signatures"];

#[derive(Clone, Debug)]
pub struct FindingRow {
    pub check: String,
    pub finding: String,
    pub source: String,
    pub maps_to: String,
}

#[derive(Clone, Debug)]
pub struct Charter {
    pub v: Value,
    pub id: String,
    pub supersedes: Option<String>,
    pub clauses: Vec<(String, String, String)>,
    pub roles: Vec<(String, String, String)>,
    pub findings: Vec<FindingRow>,
}

#[derive(Clone, Debug)]
pub struct Party {
    pub index: usize,
    pub kind: String,
    pub as_: String,
    pub fingerprint: Option<String>,
    pub signed: bool,
}

fn public_key_of(pem: Option<&Value>, wh: &str) -> R<[u8; 32]> {
    let p = pem.and_then(|v| v.as_str()).ok_or_else(|| ctype_err(wh, "must be an Ed25519 public key in SPKI PEM form, or null"))?;
    keys::public_key_bytes(&p).map_err(|e| {
        if e.0.contains("but not Ed25519") {
            ctype_err(wh, "must be an Ed25519 public key")
        } else {
            ctype_err(wh, "must be an Ed25519 public key in SPKI PEM form, or null")
        }
    })
}

/// validateCharter: shape, id, rules and signatures; (charter, party reports) or the refusal.
pub fn validate_charter(x: &Value) -> R<(Charter, Vec<Party>)> {
    let o = x.as_obj().ok_or_else(|| refused("field_type", "a charter is a JSON object".into()))?;
    if !json::is_str(o.get("schema"), CHARTER_SCHEMA) {
        return Err(refused("schema_wrong", format!("charter schema: must be \"{}\"", CHARTER_SCHEMA)));
    }
    exact_c(o, &CHARTER_KEYS, "object")?;
    if !is_id(o.get("id")) {
        return Err(ctype_err("id", "must be 64 lowercase hex characters"));
    }
    let sup = o.get("supersedes").unwrap();
    if !sup.is_null() && !is_id(Some(sup)) {
        return Err(ctype_err("supersedes", "must be a charter id or null"));
    }
    let it = o.get("intake").and_then(|v| v.as_obj()).ok_or_else(|| ctype_err("intake", "must be { why, who_for, perfect_version, proud_of }"))?;
    exact_c(it, &["why", "who_for", "perfect_version", "proud_of"], "intake")?;
    for k in ["why", "who_for", "perfect_version", "proud_of"] {
        if !is_strv(it.get(k)) {
            return Err(ctype_err(&format!("intake.{}", k), "must be a string (empty when not answered)"));
        }
    }
    let clauses_v = o.get("clauses").and_then(|v| v.as_arr()).filter(|a| !a.is_empty()).ok_or_else(|| ctype_err("clauses", "must hold at least one clause"))?;
    let mut ids: Vec<String> = Vec::new();
    let mut clauses = Vec::new();
    for (i, c) in clauses_v.iter().enumerate() {
        let w = format!("clauses[{}]", i);
        let co = c.as_obj().ok_or_else(|| ctype_err(&w, "must be { id, kind, text }"))?;
        exact_c(co, &["id", "kind", "text"], &w)?;
        if !is_strv(co.get("id")) || !clause_id_ok(&sv(co.get("id"))) {
            return Err(ctype_err(&format!("{}.id", w), "must be a short lower-case id (c1, no-push)"));
        }
        let cid = sv(co.get("id"));
        if ids.contains(&cid) {
            return Err(refused("clause_duplicate", format!("charter clauses: the id \"{}\" is used twice", cid)));
        }
        ids.push(cid.clone());
        if !in_set(co.get("kind"), &CLAUSE_KINDS) {
            return Err(ctype_err(&format!("{}.kind", w), &format!("must be one of {}", CLAUSE_KINDS.join(", "))));
        }
        if !is_strv(co.get("text")) || json::js_trim(&sv(co.get("text"))).is_empty() {
            return Err(ctype_err(&format!("{}.text", w), "must say what the clause binds"));
        }
        clauses.push((cid, sv(co.get("kind")), sv(co.get("text"))));
    }
    let th = o.get("thresholds").and_then(|v| v.as_arr()).ok_or_else(|| ctype_err("thresholds", "must be an array"))?;
    let mut classes: Vec<String> = Vec::new();
    for (i, t) in th.iter().enumerate() {
        let w = format!("thresholds[{}]", i);
        let to = t.as_obj().ok_or_else(|| ctype_err(&w, "must be { action_class, reversibility, act_at, ask_at }"))?;
        exact_c(to, &["action_class", "reversibility", "act_at", "ask_at"], &w)?;
        if !one_line(to.get("action_class")) {
            return Err(ctype_err(&format!("{}.action_class", w), "must name an action class, or *"));
        }
        let ac = sv(to.get("action_class"));
        if classes.contains(&ac) {
            return Err(refused("threshold_order", format!("charter thresholds: the action class \"{}\" has two rows", ac)));
        }
        classes.push(ac.clone());
        if !in_set(to.get("reversibility"), &REVERSIBILITY) {
            return Err(ctype_err(&format!("{}.reversibility", w), "must be always, maybe or never (can it be undone?)"));
        }
        if !unit(to.get("ask_at")) {
            return Err(ctype_err(&format!("{}.ask_at", w), "must be a number from 0 to 1"));
        }
        let act = to.get("act_at").unwrap();
        if !act.is_null() && !unit(Some(act)) {
            return Err(ctype_err(&format!("{}.act_at", w), "must be a number from 0 to 1, or null (always ask)"));
        }
        if json::is_str(to.get("reversibility"), "never") && !act.is_null() {
            return Err(refused("never_reversible_must_ask", format!("charter thresholds: \"{}\" cannot be undone, so it always asks: act_at is null", ac)));
        }
        if !act.is_null() && to.get("ask_at").unwrap().as_num().unwrap() > act.as_num().unwrap() {
            return Err(refused(
                "threshold_order",
                format!(
                    "charter thresholds: \"{}\" asks above the point where it would act (ask_at {} > act_at {})",
                    ac,
                    js_str(to.get("ask_at")),
                    js_str(Some(act))
                ),
            ));
        }
    }
    let roles_v = o.get("roles").and_then(|v| v.as_arr()).ok_or_else(|| ctype_err("roles", "must be an array"))?;
    let mut roles = Vec::new();
    for (i, r) in roles_v.iter().enumerate() {
        let w = format!("roles[{}]", i);
        let ro = r.as_obj().ok_or_else(|| ctype_err(&w, "must be { scope, person, level }"))?;
        exact_c(ro, &["scope", "person", "level"], &w)?;
        if !one_line(ro.get("scope")) {
            return Err(ctype_err(&format!("{}.scope", w), "must name a branch, or *"));
        }
        if !is_role(ro.get("person")) {
            return Err(refused("person_not_a_role", format!("charter roles[{}].person: must be a role, never a personal name or contact", i)));
        }
        if !in_set(ro.get("level"), &ROLE_LEVELS) {
            return Err(ctype_err(&format!("{}.level", w), &format!("must be one of {}", ROLE_LEVELS.join(", "))));
        }
        roles.push((sv(ro.get("scope")), sv(ro.get("person")), sv(ro.get("level"))));
    }
    let fv = o.get("findings").and_then(|v| v.as_arr()).ok_or_else(|| ctype_err("findings", "must be an array"))?;
    let mut findings = Vec::new();
    for (i, f) in fv.iter().enumerate() {
        let w = format!("findings[{}]", i);
        let fo = f.as_obj().ok_or_else(|| ctype_err(&w, "must be { check, finding, source, maps_to }"))?;
        exact_c(fo, &["check", "finding", "source", "maps_to"], &w)?;
        if !one_line(fo.get("check")) {
            return Err(ctype_err(&format!("{}.check", w), "must name a checker, or *"));
        }
        if !json::is_str(fo.get("finding"), "*") && !in_set(fo.get("finding"), &FINDINGS) {
            return Err(ctype_err(&format!("{}.finding", w), "must be pass, fail, cant-tell or *"));
        }
        if !json::is_str(fo.get("source"), "evidence") && !json::is_str(fo.get("source"), "inference") {
            return Err(ctype_err(&format!("{}.source", w), "must be evidence or inference"));
        }
        if !in_set(fo.get("maps_to"), &EFFECTS) {
            return Err(ctype_err(&format!("{}.maps_to", w), "must be gate, flag or monitor"));
        }
        if json::is_str(fo.get("source"), "inference") && json::is_str(fo.get("maps_to"), "gate") {
            return Err(refused(
                "inference_cannot_gate",
                format!("charter findings[{}]: an inference finding maps only to flag or monitor; an opinion never passes or stops a gate", i),
            ));
        }
        findings.push(FindingRow { check: sv(fo.get("check")), finding: sv(fo.get("finding")), source: sv(fo.get("source")), maps_to: sv(fo.get("maps_to")) });
    }
    let d = o.get("deferral").and_then(|v| v.as_obj()).ok_or_else(|| ctype_err("deferral", "must be { policy, max_wait_s }"))?;
    exact_c(d, &["policy", "max_wait_s"], "deferral")?;
    if !json::is_str(d.get("policy"), "now") && !json::is_str(d.get("policy"), "next-breakpoint") {
        return Err(ctype_err("deferral.policy", "must be now or next-breakpoint"));
    }
    if !is_safe_integer(d.get("max_wait_s")) || d.get("max_wait_s").unwrap().as_num().unwrap() < 0.0 {
        return Err(ctype_err("deferral.max_wait_s", "must be a whole number of seconds, zero or more"));
    }
    let pv = o.get("parties").and_then(|v| v.as_arr()).filter(|a| !a.is_empty()).ok_or_else(|| ctype_err("parties", "must name at least one party"))?;
    let mut pkeys: Vec<Option<[u8; 32]>> = Vec::new();
    for (i, p) in pv.iter().enumerate() {
        let w = format!("parties[{}]", i);
        let po = p.as_obj().ok_or_else(|| ctype_err(&w, "must be { kind, as, public_key }"))?;
        exact_c(po, &["kind", "as", "public_key"], &w)?;
        if !json::is_str(po.get("kind"), "person") && !json::is_str(po.get("kind"), "agent") {
            return Err(ctype_err(&format!("{}.kind", w), "must be person or agent"));
        }
        let bad_as = if json::is_str(po.get("kind"), "person") { !is_role(po.get("as")) } else { !one_line(po.get("as")) };
        if bad_as {
            return Err(refused(
                "party_not_a_role",
                format!("charter parties[{}].as: a person party is named by role, never by name or contact; an agent party by the name it chose", i),
            ));
        }
        let pk = po.get("public_key").unwrap();
        pkeys.push(if pk.is_null() { None } else { Some(public_key_of(Some(pk), &format!("parties[{}].public_key", i))?) });
    }
    let want = charter_id(x);
    let id = sv(o.get("id"));
    if id != want {
        return Err(refused("id_mismatch", format!("charter id: does not recompute (the content hashes to {})", want)));
    }
    let sigs = o.get("signatures").and_then(|v| v.as_arr()).ok_or_else(|| ctype_err("signatures", "must be an array"))?;
    let msg = signing_message(x);
    let mut signed_by: Vec<usize> = Vec::new();
    for (i, s) in sigs.iter().enumerate() {
        let w = format!("signatures[{}]", i);
        let so = s.as_obj().ok_or_else(|| ctype_err(&w, "must be { party, alg, signature }"))?;
        exact_c(so, &["party", "alg", "signature"], &w)?;
        let party = so.get("party");
        let pn = party.and_then(|p| p.as_num()).unwrap_or(-1.0);
        if !is_safe_integer(party) || pn < 0.0 || pn >= pkeys.len() as f64 {
            return Err(refused("signature_invalid", format!("charter signatures[{}]: party {} is not in parties", i, js_str(party))));
        }
        let party = pn as usize;
        let k = match pkeys[party] {
            None => return Err(refused("signature_invalid", format!("charter signatures[{}]: party {} has no key, so it cannot sign", i, party))),
            Some(k) => k,
        };
        if signed_by.contains(&party) {
            return Err(refused("signature_invalid", format!("charter signatures[{}]: party {} signed twice", i, party)));
        }
        if !json::is_str(so.get("alg"), "ed25519") || !is_strv(so.get("signature")) {
            return Err(refused("signature_invalid", format!("charter signatures[{}]: alg is ed25519 and the signature base64", i)));
        }
        if !keys::verify(&k, &msg, &keys::b64_lenient(&sv(so.get("signature")))) {
            return Err(refused(
                "signature_invalid",
                format!("charter signatures[{}]: the signature of party {} ({}) does not verify", i, party, js_str(pv[party].get("as"))),
            ));
        }
        signed_by.push(party);
    }
    let parties = pv
        .iter()
        .enumerate()
        .map(|(i, p)| Party {
            index: i,
            kind: sv(p.get("kind")),
            as_: sv(p.get("as")),
            fingerprint: if json::truthy(p.get("public_key")) { pkeys[i].map(|k| keys::fingerprint_of(&k)) } else { None },
            signed: signed_by.contains(&i),
        })
        .collect();
    Ok((Charter { v: x.clone(), id, supersedes: opt_s(Some(sup)), clauses, roles, findings }, parties))
}

fn checker_name(by: &str) -> String {
    if by.starts_with("person:") {
        return by.to_string();
    }
    let n = by.rfind('@').map(|p| &by[..p]).unwrap_or("");
    if n.is_empty() {
        by.to_string()
    } else {
        n.to_string()
    }
}

fn is_registered(charter: Option<&Charter>, by: &str) -> bool {
    let c = match charter {
        None => return false,
        Some(c) => c,
    };
    let name = checker_name(by);
    if c.findings.iter().any(|r| r.check != "*" && (r.check == by || r.check == name)) {
        return true;
    }
    by.starts_with("person:") && c.roles.iter().any(|r| r.1 == by["person:".len()..])
}

fn row_effect(charter: Option<&Charter>, by: &str, finding: &str, source: &str) -> String {
    let name = checker_name(by);
    let mut best: Option<&FindingRow> = None;
    let mut best_score = -1i32;
    if let Some(c) = charter {
        for r in &c.findings {
            if r.source != source {
                continue;
            }
            let cs = if r.check == by { 2 } else if r.check == name { 1 } else if r.check == "*" { 0 } else { -1 };
            let fs = if r.finding == finding { 1 } else if r.finding == "*" { 0 } else { -1 };
            if cs < 0 || fs < 0 {
                continue;
            }
            let score = cs * 2 + fs;
            if score > best_score {
                best = Some(r);
                best_score = score;
            }
        }
    }
    let effect = match best {
        Some(b) => b.maps_to.clone(),
        None => {
            if source == "evidence" {
                (if finding == "fail" { "gate" } else if finding == "cant-tell" { "flag" } else { "monitor" }).to_string()
            } else {
                (if finding == "fail" { "flag" } else { "monitor" }).to_string()
            }
        }
    };
    if source == "inference" && effect == "gate" {
        "flag".into()
    } else {
        effect
    }
}

fn explain_finding(charter: Option<&Charter>, by: &str, finding: &str, source: &str, kind: Option<&str>) -> (String, bool) {
    let registered = is_registered(charter, by);
    if kind == Some("claim-check") && !registered {
        return ("flag".into(), true);
    }
    let effect = row_effect(charter, by, finding, source);
    if effect == "gate" && !registered {
        return ("flag".into(), true);
    }
    (effect, false)
}

/// The gates read together: any fail is FAIL; else any cant-tell is can't tell; else a pass is PASS; none is can't tell.
pub fn read_gates(findings: &[String]) -> &'static str {
    if findings.iter().any(|f| f == "fail") {
        "FAIL"
    } else if findings.iter().any(|f| f == "cant-tell") {
        "can't tell"
    } else if findings.iter().any(|f| f == "pass") {
        "PASS"
    } else {
        "can't tell"
    }
}

fn clause_of<'c>(c: &'c Charter, cid: &str) -> Option<&'c (String, String, String)> {
    c.clauses.iter().find(|x| x.0 == cid)
}

// ---------------------------------------------------------------------------------------------------------------------
// graph.ts

fn by_time_then_id(a: &Frag, b: &Frag) -> Ordering {
    cmp16(a.started.as_deref().unwrap_or(""), b.started.as_deref().unwrap_or("")).then_with(|| cmp16(&a.id, &b.id))
}

#[derive(Clone, Debug)]
pub struct Info {
    pub status: String,
    pub marks: Vec<String>,
    pub stale_from: Vec<String>,
    pub cleared_for: Vec<String>,
}

#[derive(Default)]
pub struct Graph {
    allow_outside: bool,
    frags: HashMap<String, Frag>,
    frag_order: Vec<String>,
    charters: HashMap<String, Charter>,
    charter_order: Vec<String>,
    outside: Vec<String>,
    kids: HashMap<String, Vec<String>>,
    judged: HashMap<String, Vec<String>>,
    answers: HashMap<String, Vec<String>>,
    cache: RefCell<Option<HashMap<String, Info>>>,
}

impl Graph {
    pub fn new(allow_outside: bool) -> Graph {
        Graph { allow_outside, ..Graph::default() }
    }
    pub fn has(&self, i: &str) -> bool {
        self.frags.contains_key(i) || self.charters.contains_key(i)
    }
    fn mark_outside(&mut self, i: &str) {
        if !self.outside.iter().any(|x| x == i) {
            self.outside.push(i.to_string());
        }
    }
    pub fn add_charter(&mut self, c: &Value) -> R<()> {
        let (charter, _) = validate_charter(c)?;
        if self.has(&charter.id) {
            return Err(refused("duplicate", format!("charter {} is already in the graph", short(&charter.id))));
        }
        if let Some(s) = &charter.supersedes {
            if !self.charters.contains_key(s) {
                if !self.allow_outside {
                    return Err(refused("unknown_charter", format!("charter supersedes {}, which is not in the graph", short(s))));
                }
                let s = s.clone();
                self.mark_outside(&s);
            }
        }
        self.charter_order.push(charter.id.clone());
        self.charters.insert(charter.id.clone(), charter);
        Ok(())
    }
    pub fn add_frag(&mut self, x: &Value) -> R<()> {
        let f = validate(x, true)?;
        if self.has(&f.id) {
            return Err(refused("duplicate", format!("frag {} is already in the graph", short(&f.id))));
        }
        let missing = |g: &mut Graph, i: &str, code: &str, what: &str| -> R<()> {
            if g.allow_outside {
                g.mark_outside(i);
                return Ok(());
            }
            Err(refused(code, format!("{} {} is not in the graph (add it first)", what, short(i))))
        };
        for p in &f.parents {
            if !self.frags.contains_key(p) {
                missing(self, p, "unknown_parent", "parent")?;
            }
        }
        if let Some((cid, clause)) = &f.charter {
            match self.charters.get(cid) {
                None => missing(self, cid, "unknown_charter", "charter")?,
                Some(c) => {
                    if clause_of(c, clause).is_none() {
                        return Err(refused("unknown_clause", format!("charter {} has no clause \"{}\"", short(cid), clause)));
                    }
                }
            }
        }
        if let Some((target, _)) = &f.claim_check {
            if !self.frags.contains_key(target) {
                missing(self, target, "unknown_target", "target")?;
            }
        }
        if let Some(cl) = &f.closes {
            match self.frags.get(cl) {
                None => missing(self, cl, "closes_not_a_container", "the closed frag")?,
                Some(t) => {
                    if !CONTAINER_LEVELS.contains(&t.level.as_str()) || !self.ancestors_of(&f.parents).contains(cl) {
                        return Err(refused("closes_not_a_container", format!("closes: {} must be an ancestor at level task, run or branch", short(cl))));
                    }
                }
            }
        }
        if let Some(d) = &f.decision {
            if let Some(asks) = &d.asks {
                match self.frags.get(asks) {
                    None => missing(self, asks, "answer_without_ask", "the ask")?,
                    Some(ask) => {
                        let a = match &ask.decision {
                            Some(a) if a.asks.is_none() => a,
                            _ => return Err(refused("answer_without_ask", format!("decision: {} is not an open ask", short(asks)))),
                        };
                        let key = |d: &Decision| {
                            let r = &d.raw;
                            json::canonicalize(&Value::Arr(vec![
                                r.get("question").cloned().unwrap(),
                                r.get("options").cloned().unwrap(),
                                r.get("reversibility").cloned().unwrap(),
                                r.get("deferral").cloned().unwrap(),
                                r.get("state_digest").cloned().unwrap(),
                            ]))
                        };
                        if key(a) != key(d) {
                            return Err(refused(
                                "answer_differs_from_ask",
                                "decision: an answer repeats its ask's question, options, reversibility, deferral and state digest exactly".into(),
                            ));
                        }
                    }
                }
            }
        }
        let id = f.id.clone();
        for p in &f.parents {
            let k = self.kids.entry(p.clone()).or_default();
            if !k.contains(&id) {
                k.push(id.clone());
            }
        }
        if let Some((target, _)) = &f.claim_check {
            self.judged.entry(target.clone()).or_default().push(id.clone());
        }
        if let Some(d) = &f.decision {
            if let Some(asks) = &d.asks {
                self.answers.entry(asks.clone()).or_default().push(id.clone());
            }
        }
        self.frag_order.push(id.clone());
        self.frags.insert(id, f);
        *self.cache.borrow_mut() = None;
        Ok(())
    }
    pub fn get(&self, i: &str) -> Option<&Frag> {
        self.frags.get(i)
    }
    fn kids_of(&self, i: &str) -> &[String] {
        self.kids.get(i).map(|v| v.as_slice()).unwrap_or(&[])
    }
    fn judgements_of(&self, i: &str) -> &[String] {
        self.judged.get(i).map(|v| v.as_slice()).unwrap_or(&[])
    }
    fn answers_of(&self, i: &str) -> &[String] {
        self.answers.get(i).map(|v| v.as_slice()).unwrap_or(&[])
    }
    /// Every descendant, in the order found.
    pub fn descendants_of(&self, ids: &[String]) -> Vec<String> {
        let mut seen: HashSet<String> = HashSet::new();
        let mut order = Vec::new();
        let mut stack: Vec<String> = ids.to_vec();
        while let Some(x) = stack.pop() {
            for c in self.kids_of(&x) {
                if seen.insert(c.clone()) {
                    order.push(c.clone());
                    stack.push(c.clone());
                }
            }
        }
        order
    }
    /// The ids and every ancestor (the ids themselves included).
    pub fn ancestors_of(&self, ids: &[String]) -> HashSet<String> {
        let mut seen = HashSet::new();
        let mut stack: Vec<String> = ids.to_vec();
        while let Some(i) = stack.pop() {
            if !seen.insert(i.clone()) {
                continue;
            }
            if let Some(f) = self.frags.get(&i) {
                stack.extend(f.parents.iter().cloned());
            }
        }
        seen
    }
    /// The derived status of every frag (SCHEMA.md section 5).
    pub fn statuses(&self) -> HashMap<String, Info> {
        if let Some(c) = &*self.cache.borrow() {
            return c.clone();
        }
        let ids = &self.frag_order;
        let mut wrong: HashMap<String, bool> = HashMap::new();
        let mut marks: HashMap<String, Vec<String>> = HashMap::new();
        for i in ids.iter().rev() {
            let m: Vec<String> = self
                .judgements_of(i)
                .iter()
                .filter(|c| self.frags[*c].claim_check.as_ref().map_or(false, |cc| cc.1 == "wrong") && !wrong.get(*c).copied().unwrap_or(false))
                .cloned()
                .collect();
            wrong.insert(i.clone(), !m.is_empty());
            marks.insert(i.clone(), m);
        }
        let mut info: HashMap<String, Info> = ids
            .iter()
            .map(|i| {
                (
                    i.clone(),
                    Info {
                        status: if wrong[i] { "wrong".into() } else { "ok".into() },
                        marks: marks[i].clone(),
                        stale_from: vec![],
                        cleared_for: vec![],
                    },
                )
            })
            .collect();
        let mut anc_cache: HashMap<String, HashSet<String>> = HashMap::new();
        for root in ids {
            if !wrong[root] {
                continue;
            }
            let root_marks = marks[root].clone();
            let cleared_for_root = |x: &str, anc_cache: &mut HashMap<String, HashSet<String>>| -> bool {
                for h in self.judgements_of(x) {
                    let hf = &self.frags[h];
                    if hf.claim_check.as_ref().map_or(true, |cc| cc.1 != "holds") || wrong.get(h).copied().unwrap_or(false) {
                        continue;
                    }
                    let anc = anc_cache.entry(h.clone()).or_insert_with(|| self.ancestors_of(&[h.clone()]));
                    if root_marks.iter().any(|m| anc.contains(m)) {
                        return true;
                    }
                }
                false
            };
            let mut seen: HashSet<String> = HashSet::new();
            let mut stack: Vec<String> = self.kids_of(root).to_vec();
            while let Some(x) = stack.pop() {
                if !seen.insert(x.clone()) {
                    continue;
                }
                if cleared_for_root(&x, &mut anc_cache) {
                    continue;
                }
                if let Some(xi) = info.get_mut(&x) {
                    xi.stale_from.push(root.clone());
                }
                stack.extend(self.kids_of(&x).iter().cloned());
            }
            for x in self.descendants_of(&[root.clone()]) {
                if cleared_for_root(&x, &mut anc_cache) {
                    if let Some(xi) = info.get_mut(&x) {
                        xi.cleared_for.push(root.clone());
                    }
                }
            }
        }
        for xi in info.values_mut() {
            xi.stale_from.sort_by(|a, b| cmp16(a, b));
            let mut cf: Vec<String> = xi.cleared_for.iter().filter(|r| !xi.stale_from.contains(r)).cloned().collect();
            cf.sort_by(|a, b| cmp16(a, b));
            cf.dedup();
            xi.cleared_for = cf;
            if xi.status != "wrong" {
                xi.status = if !xi.stale_from.is_empty() {
                    "stale".into()
                } else if !xi.cleared_for.is_empty() {
                    "cleared".into()
                } else {
                    "ok".into()
                };
            }
        }
        *self.cache.borrow_mut() = Some(info.clone());
        info
    }
    pub fn status(&self, i: &str) -> R<Info> {
        self.statuses().get(i).cloned().ok_or_else(|| refused("unknown_parent", format!("{} is not a frag in this graph", short(i))))
    }
    fn frags_in_order(&self) -> Vec<&Frag> {
        self.frag_order.iter().map(|i| &self.frags[i]).collect()
    }
    pub fn heads(&self) -> Vec<&Frag> {
        let mut h: Vec<&Frag> = self.frags_in_order().into_iter().filter(|f| self.kids_of(&f.id).is_empty()).collect();
        h.sort_by(|a, b| by_time_then_id(a, b));
        h
    }
    pub fn open_asks(&self, within: Option<&HashSet<String>>) -> Vec<&Frag> {
        let st = self.statuses();
        let mut out: Vec<&Frag> = self
            .frags_in_order()
            .into_iter()
            .filter(|f| {
                f.decision.as_ref().map_or(false, |d| d.asks.is_none())
                    && self.answers_of(&f.id).is_empty()
                    && st[&f.id].status != "wrong"
                    && within.map_or(true, |w| w.contains(&f.id))
            })
            .collect();
        out.sort_by(|a, b| by_time_then_id(a, b));
        out
    }
    pub fn resolve(&self, r: &str) -> R<String> {
        if self.has(r) {
            return Ok(r.to_string());
        }
        let ok = (8..=64).contains(&r.len()) && r.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c));
        if !ok {
            return Err(refused("unknown_parent", format!("\"{}\" is not an id or an id prefix of 8 or more hex characters", r)));
        }
        let hits: Vec<&String> = self.frag_order.iter().chain(self.charter_order.iter()).filter(|i| i.starts_with(r)).collect();
        if hits.len() == 1 {
            return Ok(hits[0].clone());
        }
        Err(refused(
            "unknown_parent",
            if hits.is_empty() { format!("no frag or charter starts with \"{}\"", r) } else { format!("\"{}\" matches {} ids; give more characters", r, hits.len()) },
        ))
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// digest.ts

pub fn clip(s: &str, n: usize) -> String {
    let mut collapsed = String::new();
    let mut in_ws = false;
    for c in s.chars() {
        if json::is_js_ws(c) {
            if !in_ws {
                collapsed.push(' ');
            }
            in_ws = true;
        } else {
            collapsed.push(c);
            in_ws = false;
        }
    }
    let t = json::js_trim(&collapsed);
    if utf16_len(t) > n {
        format!("{}...", js_slice(t, n - 3))
    } else {
        t.to_string()
    }
}

fn plural(n: usize, one: &str, many: Option<&str>) -> String {
    format!("{} {}", n, if n == 1 { one.to_string() } else { many.map(String::from).unwrap_or_else(|| format!("{}s", one)) })
}

fn actor_words(a: &Actor) -> String {
    match a {
        Actor::Person(p) => format!("a person ({})", p),
        Actor::Tool { name, version } => format!("tool {}@{}", name, version),
        Actor::Model { declared, resolved } => match (declared, resolved) {
            (None, None) => "a model, none declared, not attested".into(),
            (None, Some(r)) => format!("model {} (none declared)", r),
            (Some(d), None) => format!("model {}, not attested", d),
            (Some(d), Some(r)) => {
                if r == d {
                    format!("model {}", r)
                } else {
                    format!("model {} (declared {})", r, d)
                }
            }
        },
    }
}

fn why_words(g: &Graph, f: &Frag) -> String {
    match &f.charter {
        None => "no charter clause".into(),
        Some((cid, clause)) => match g.charters.get(cid).and_then(|c| clause_of(c, clause)) {
            Some(cl) => format!("clause {}: {}", cl.0, clip(&cl.2, 70)),
            None => format!("clause {} (its charter is not in this graph)", clause),
        },
    }
}

fn is_container(f: &Frag) -> bool {
    CONTAINER_LEVELS.contains(&f.level.as_str())
}

fn effect_words(e: &str, finding: &str) -> String {
    if e == "gate" {
        format!("gate, {}", if finding == "pass" { "met" } else if finding == "fail" { "not met" } else { "can't tell" })
    } else {
        e.to_string()
    }
}

fn explained(g: &Graph, f: &Frag, by: &str, finding: &str) -> (String, bool) {
    let charter = f.charter.as_ref().and_then(|(cid, _)| g.charters.get(cid));
    explain_finding(charter, by, finding, if f.kind == "inference" { "inference" } else { "evidence" }, Some(&f.kind))
}

fn score_of(g: &Graph, f: &Frag) -> Option<String> {
    let st = g.statuses();
    let mut checks: Vec<&Frag> = g
        .judgements_of(&f.id)
        .iter()
        .filter(|i| st[*i].status != "wrong" && g.frags[*i].claim_check.as_ref().map_or(false, |c| c.1 != "cant-tell"))
        .map(|i| &g.frags[i])
        .collect();
    checks.sort_by(|a, b| by_time_then_id(a, b));
    checks.last().and_then(|c| c.claim_check.as_ref().map(|cc| cc.1.clone()))
}

fn stale_answer(f: &Frag) -> bool {
    f.decision.as_ref().map_or(false, |d| d.answer.as_ref().map_or(false, |a| a.state_digest != d.state_digest))
}

struct Below<'g> {
    members: Vec<&'g Frag>,
    wrong: Vec<&'g Frag>,
    stale: Vec<&'g Frag>,
    gate_not_met: usize,
    gate_cant_tell: usize,
    gates: Vec<String>,
    flag: usize,
    asks: Vec<&'g Frag>,
    closing: Vec<&'g Frag>,
    heads: Vec<&'g Frag>,
}

fn below<'g>(g: &'g Graph, f: &Frag) -> Below<'g> {
    let st = g.statuses();
    let ids_v = g.descendants_of(&[f.id.clone()]);
    let ids: HashSet<String> = ids_v.iter().cloned().collect();
    let mut members: Vec<&Frag> = ids_v.iter().map(|i| &g.frags[i]).collect();
    members.sort_by(|a, b| by_time_then_id(a, b));
    let mut flag = 0;
    let mut gates = Vec::new();
    for m in &members {
        for c in &m.checks {
            let (e, unreg) = explained(g, m, &c.by, &c.finding);
            if e == "gate" {
                gates.push(c.finding.clone());
            } else if e == "flag" && (c.finding != "pass" || unreg) {
                flag += 1;
            }
        }
    }
    Below {
        wrong: members.iter().copied().filter(|m| st[&m.id].status == "wrong").collect(),
        stale: members.iter().copied().filter(|m| st[&m.id].status == "stale").collect(),
        gate_not_met: gates.iter().filter(|x| *x == "fail").count(),
        gate_cant_tell: gates.iter().filter(|x| *x == "cant-tell").count(),
        flag,
        asks: g.open_asks(Some(&ids)),
        closing: members.iter().copied().filter(|m| m.closes.as_deref() == Some(f.id.as_str())).collect(),
        heads: members.iter().copied().filter(|m| !g.kids_of(&m.id).iter().any(|c| ids.contains(c))).collect(),
        gates,
        members,
    }
}

fn state_of(b: &Below) -> &'static str {
    if !b.asks.is_empty() {
        "needs you"
    } else if !b.closing.is_empty() {
        "ready for review"
    } else {
        "working"
    }
}

/// Container state (needs you, ready for review, working) of a task, run or branch; None for a step-level frag.
pub fn container_state(g: &Graph, i: &str) -> Option<&'static str> {
    let f = g.get(i)?;
    if is_container(f) {
        Some(state_of(&below(g, f)))
    } else {
        None
    }
}

fn relies(si: &Info) -> String {
    format!(
        "re-check: relies on {}{}, marked wrong",
        si.stale_from.iter().take(2).map(|x| short(x)).collect::<Vec<_>>().join(", "),
        if si.stale_from.len() > 2 { " and more" } else { "" }
    )
}

fn next_words(g: &Graph, f: &Frag, si: &Info, b: Option<&Below>) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(b) = b {
        if !b.asks.is_empty() {
            out.push(format!(
                "answer: {}{}",
                clip(&b.asks[0].decision.as_ref().unwrap().question, 70),
                if b.asks.len() > 1 { format!(" (+{} more)", b.asks.len() - 1) } else { String::new() }
            ));
        }
        if si.status == "wrong" {
            out.push(format!("re-check {} that relied on it", plural(b.stale.len() + b.wrong.len(), "frag", None)));
        } else if si.status == "stale" {
            out.push(relies(si));
        }
        if !b.stale.is_empty() && si.status != "wrong" {
            out.push(format!("re-check {} below", plural(b.stale.len(), "stale frag", None)));
        }
        if b.asks.is_empty() && !b.closing.is_empty() {
            let mut c = b.closing.clone();
            c.sort_by(|a, b| by_time_then_id(a, b));
            out.push(format!("review: {}", clip(&c.last().unwrap().action, 70)));
        }
        if out.is_empty() {
            let mut hs = b.heads.clone();
            hs.sort_by(|a, b| by_time_then_id(a, b));
            out.push(match hs.last() {
                Some(h) => format!("last: {}", clip(&h.action, 70)),
                None => "no step recorded yet".into(),
            });
        }
        return out;
    }
    if let Some(d) = &f.decision {
        if d.asks.is_none() && g.answers_of(&f.id).is_empty() && si.status != "wrong" {
            out.push(format!("waiting on a person: {}", clip(&d.question, 70)));
        }
    }
    if si.status == "wrong" {
        let n = g.descendants_of(&[f.id.clone()]).iter().filter(|i| g.status(i).map_or(false, |s| s.stale_from.contains(&f.id))).count();
        out.push(if n > 0 { format!("re-check {} that relied on it", plural(n, "frag", None)) } else { "nothing relied on it".into() });
    }
    if si.status == "stale" {
        out.push(relies(si));
    }
    if stale_answer(f) {
        out.push("ask again: the inputs moved while the question waited".into());
    }
    if f.kind == "inference" && score_of(g, f).is_none() {
        out.push(format!("watching for: {}", clip(&f.inference.as_ref().unwrap().1, 70)));
    }
    let mut kids: Vec<&Frag> = g.kids_of(&f.id).iter().map(|i| &g.frags[i]).collect();
    kids.sort_by(|a, b| by_time_then_id(a, b));
    if !kids.is_empty() {
        out.push(format!(
            "followed by: {}{}",
            clip(&kids[0].action, 60),
            if kids.len() > 1 { format!(" (+{} more)", kids.len() - 1) } else { String::new() }
        ));
    }
    if out.is_empty() {
        out.push("no later step recorded".into());
    }
    out
}

/// The one-line digest: doing / why / next (and, for a container, below).
pub fn digest_line(g: &Graph, i: &str) -> R<String> {
    let f = g.get(i).ok_or_else(|| refused("unknown_parent", format!("{} is not a frag in this graph", short(i))))?;
    let si = g.status(i)?;
    if is_container(f) {
        let b = below(g, f);
        let state = state_of(&b);
        let head = if si.status == "ok" { state.to_string() } else { format!("{}; {}", si.status, state) };
        let parts = [
            plural(b.members.len(), "frag", None),
            if b.wrong.is_empty() { String::new() } else { format!("{} wrong", b.wrong.len()) },
            if b.stale.is_empty() { String::new() } else { format!("{} stale", b.stale.len()) },
            if b.gate_not_met > 0 { format!("{} gate{} not met", b.gate_not_met, if b.gate_not_met == 1 { "" } else { "s" }) } else { String::new() },
            if b.gate_cant_tell > 0 { format!("{} gate{} can't tell", b.gate_cant_tell, if b.gate_cant_tell == 1 { "" } else { "s" }) } else { String::new() },
            if b.flag > 0 { format!("{} flagged", b.flag) } else { String::new() },
            if b.asks.is_empty() { String::new() } else { plural(b.asks.len(), "open ask", None) },
        ];
        let counts = parts.iter().filter(|p| !p.is_empty()).cloned().collect::<Vec<_>>().join(", ");
        return Ok(format!(
            "{} | doing: {} ({}, by {}) | why: {} | next: {} | below: {}",
            head,
            clip(&f.action, 70),
            f.level,
            actor_words(&f.actor),
            why_words(g, f),
            next_words(g, f, &si, Some(&b))[0],
            counts
        ));
    }
    Ok(format!(
        "{} | doing: {} ({}, by {}) | why: {} | next: {}",
        si.status,
        clip(&f.action, 70),
        f.kind,
        actor_words(&f.actor),
        why_words(g, f),
        next_words(g, f, &si, None)[0]
    ))
}

/// The digest in detail.
pub fn digest_detail(g: &Graph, i: &str) -> R<String> {
    let f = g.get(i).ok_or_else(|| refused("unknown_parent", format!("{} is not a frag in this graph", short(i))))?;
    let st = g.statuses();
    let si = st[i].clone();
    let mut l = vec![digest_line(g, i)?, String::new(), "doing".to_string()];
    l.push(format!("  action: {}", f.action));
    l.push(format!("  record: {} at level {}, id {}", f.kind, f.level, f.id));
    l.push(format!("  by: {}", actor_words(&f.actor)));
    l.push(format!("  claim: {}", f.claim.clone().unwrap_or_else(|| "none".into())));
    if f.checks.is_empty() {
        l.push("  checks: none".into());
    } else {
        l.push("  checks:".into());
        for c in &f.checks {
            let (e, unreg) = explained(g, f, &c.by, &c.finding);
            let words = if unreg { "flag, unregistered checker: a person decides".to_string() } else { effect_words(&e, &c.finding) };
            l.push(format!(
                "    - {}: {} ({}){}",
                c.by,
                if c.finding == "cant-tell" { "can't tell" } else { &c.finding },
                words,
                if c.detail.is_empty() { String::new() } else { format!(": {}", clip(&c.detail, 100)) }
            ));
        }
    }
    let mut dg = |label: &str, ds: &[(String, String)]| {
        if ds.is_empty() {
            l.push(format!("  {}: none", label));
        } else {
            l.push(format!("  {}:", label));
            for (n, s) in ds {
                l.push(format!("    - {} (sha256 {})", n, &s[..12]));
            }
        }
    };
    dg("inputs", &f.inputs);
    dg("outputs", &f.outputs);
    l.push(format!(
        "  tokens: {}",
        match f.tokens {
            None => "absent (not reported; never estimated)".to_string(),
            Some((a, b)) => format!("in {}, out {}", json::js_num_str(a), json::js_num_str(b)),
        }
    ));
    l.push(format!(
        "  time: {}",
        if f.started.is_none() && f.ended.is_none() {
            "not recorded".to_string()
        } else {
            format!(
                "{} to {}",
                f.started.clone().unwrap_or_else(|| "start not recorded".into()),
                f.ended.clone().unwrap_or_else(|| "end not recorded".into())
            )
        }
    ));
    if let Some(d) = &f.decision {
        l.push(format!("  question: {}", d.question));
        l.push(format!("  options: {}", d.options.join(" / ")));
        l.push(format!("  can it be undone: {}{}", d.reversibility, if d.reversibility == "never" { " (so a person is always asked)" } else { "" }));
        l.push(format!("  deferral: {}, at most {} s", d.policy, json::js_num_str(d.max_wait_s)));
        match &d.answer {
            Some(a) => l.push(format!(
                "  answer: {}, by {}, at {}{}",
                a.choice,
                a.who,
                a.when,
                if stale_answer(f) { " (given after the inputs moved)" } else { "" }
            )),
            None => l.push(format!("  answer: {}", if g.answers_of(&f.id).is_empty() { "not yet" } else { "given in a later frag" })),
        }
    }
    if let Some((blocked, rule, shown)) = &f.guard {
        l.push(format!("  blocked: {}", blocked));
        l.push(format!("  rule: {}", rule));
        l.push(format!("  shown to the agent: {}", if shown.is_empty() { "(nothing)" } else { shown }));
    }
    if let Some((target, result)) = &f.claim_check {
        l.push(format!(
            "  judges: {}{}",
            short(target),
            match g.get(target) {
                Some(tf) => format!(" [{}] {}", st[&tf.id].status, clip(&tf.action, 60)),
                None => " (not in this graph)".into(),
            }
        ));
        l.push(format!("  result: {}", if result == "cant-tell" { "can't tell" } else { result }));
    }
    if let Some((opinion, prediction, tell)) = &f.inference {
        let s = score_of(g, f);
        l.push(format!("  opinion (an inference, not evidence): {}", opinion));
        l.push(format!("  prediction: {}", prediction));
        l.push(format!("  tell: {}", tell.clone().unwrap_or_else(|| "none named".into())));
        l.push(format!(
            "  scored: {}",
            match s.as_deref() {
                None => "not yet",
                Some("holds") => "the prediction held",
                _ => "the prediction did not hold",
            }
        ));
    }
    l.push("why".into());
    l.push(format!("  serves: {}", why_words(g, f)));
    let mut parents: Vec<&Frag> = f.parents.iter().filter_map(|p| g.get(p)).collect();
    parents.sort_by(|a, b| by_time_then_id(a, b));
    if f.parents.is_empty() {
        l.push("  relied on: nothing".into());
    } else {
        l.push("  relied on:".into());
        for p in &parents {
            l.push(format!("    - {} [{}] {}", short(&p.id), st[&p.id].status, clip(&p.action, 70)));
        }
        let mut missing: Vec<&String> = f.parents.iter().filter(|p| g.get(p).is_none()).collect();
        missing.sort_by(|a, b| cmp16(a, b));
        for p in missing {
            l.push(format!("    - {} (not in this graph)", short(p)));
        }
    }
    if !si.marks.is_empty() {
        l.push("  marked wrong by:".into());
        let mut ms: Vec<&Frag> = si.marks.iter().map(|x| &g.frags[x]).collect();
        ms.sort_by(|a, b| by_time_then_id(a, b));
        for m in ms {
            let details: Vec<&str> = m.checks.iter().filter(|c| !c.detail.is_empty()).map(|c| c.detail.as_str()).collect();
            let text = if details.is_empty() { m.action.clone() } else { details.join("; ") };
            l.push(format!("    - {} {}: {}", short(&m.id), actor_words(&m.actor), clip(&text, 80)));
        }
    }
    l.push("next".into());
    let b = if is_container(f) { Some(below(g, f)) } else { None };
    for nw in next_words(g, f, &si, b.as_ref()) {
        l.push(format!("  {}", nw));
    }
    if let Some(b) = &b {
        l.push(format!(
            "  below: {}; {} wrong, {} stale; gates read {} ({} met, {} not met, {} can't tell); {} flagged; {}",
            plural(b.members.len(), "frag", None),
            b.wrong.len(),
            b.stale.len(),
            read_gates(&b.gates),
            b.gates.len() - b.gate_not_met - b.gate_cant_tell,
            b.gate_not_met,
            b.gate_cant_tell,
            b.flag,
            plural(b.asks.len(), "open ask", None)
        ));
        for a in &b.asks {
            l.push(format!("    - asks {}: {}", short(&a.id), clip(&a.decision.as_ref().unwrap().question, 80)));
        }
        for w in &b.wrong {
            l.push(format!("    - wrong {}: {}", short(&w.id), clip(&w.action, 80)));
        }
        for s2 in &b.stale {
            l.push(format!("    - stale {}: {}", short(&s2.id), clip(&s2.action, 80)));
        }
        l.push(if b.heads.is_empty() { "  latest: none".into() } else { "  latest (finished steps collapse):".into() });
        for h in &b.heads {
            l.push(format!("    - {} [{}] {}", short(&h.id), st[&h.id].status, clip(&h.action, 80)));
        }
        let mut in_scope: Vec<String> = vec![f.id.clone()];
        for m in &b.members {
            if !in_scope.contains(&m.id) {
                in_scope.push(m.id.clone());
            }
        }
        let judgements: Vec<&Frag> = in_scope.iter().flat_map(|x| g.judgements_of(x).iter().map(|j| &g.frags[j])).collect();
        let mut merged: Vec<&Frag> = Vec::new();
        for m in b.members.iter().copied().chain(judgements) {
            if let Some(pos) = merged.iter().position(|x| x.id == m.id) {
                merged[pos] = m;
            } else {
                merged.push(m);
            }
        }
        let mut calls: Vec<&Frag> = merged
            .into_iter()
            .filter(|m| matches!(m.actor, Actor::Person(_)) && (m.decision.as_ref().map_or(false, |d| d.answer.is_some()) || m.claim_check.is_some()))
            .collect();
        calls.sort_by(|a, b| by_time_then_id(a, b));
        if !calls.is_empty() {
            l.push("  steered by people:".into());
            for m in calls {
                let person = match &m.actor {
                    Actor::Person(p) => p.clone(),
                    _ => String::new(),
                };
                if let Some(d) = m.decision.as_ref().filter(|d| d.answer.is_some()) {
                    l.push(format!("    - {} answered \"{}\": {}", person, clip(&d.question, 60), clip(&d.answer.as_ref().unwrap().choice, 40)));
                } else {
                    let (t, r) = m.claim_check.as_ref().unwrap();
                    l.push(format!("    - {} judged {} {}", person, short(t), if r == "cant-tell" { "can't tell" } else { r }));
                }
            }
        }
    }
    let mut inside: Vec<&Frag> = g.ancestors_of(&f.parents).iter().filter_map(|a| g.get(a)).filter(|a| is_container(a)).collect();
    inside.sort_by(|a, b| by_time_then_id(a, b));
    if !inside.is_empty() {
        l.push("  inside:".into());
        for c in inside {
            l.push(format!("    - {} {}: {}", c.level, short(&c.id), clip(&c.action, 70)));
        }
    }
    Ok(l.join("\n") + "\n")
}

// ---------------------------------------------------------------------------------------------------------------------
// bundle.ts: the deposited file

const DEPOSIT_KEYS: [&str; 6] = ["schema", "note", "charters", "frags", "prose", "bundle_sha256"];

pub struct Deposit {
    pub exit: i32,
    pub lines: Vec<String>,
}

/// openDeposit: from the file's bytes alone (0 intact, 2 something cannot be told here, 3 not a deposited file, 4 tampered).
pub fn open_deposit(b: &[u8], name: &str) -> Deposit {
    let x = match parse_strict_bytes(b, name) {
        Ok(x) => x,
        Err(e) => return Deposit { exit: 3, lines: vec![format!("not a deposited work graph: {}", e.message)] },
    };
    if x.is_obj() && json::is_str(x.get("schema"), FRAG_CHAIN_SCHEMA) {
        return Deposit {
            exit: 3,
            lines: vec![format!(
                "not a deposited work graph: {} is a frag work chain: open it with riposte-frag open (its schema is {}; this command opens {})",
                name, FRAG_CHAIN_SCHEMA, BUNDLE_SCHEMA
            )],
        };
    }
    if !x.is_obj() || !json::is_str(x.get("schema"), BUNDLE_SCHEMA) {
        return Deposit { exit: 3, lines: vec![format!("not a deposited work graph: {} is not of the schema {}", name, BUNDLE_SCHEMA)] };
    }
    let o = x.as_obj().unwrap();
    let shape = DEPOSIT_KEYS.iter().all(|k| o.has(k))
        && o.keys_lossy().iter().all(|k| DEPOSIT_KEYS.contains(&k.as_str()))
        && o.get("charters").unwrap().as_arr().is_some()
        && o.get("frags").unwrap().as_arr().is_some()
        && o.get("prose").unwrap().is_obj()
        && o.get("bundle_sha256").unwrap().as_jstr().is_some();
    if !shape {
        return Deposit { exit: 3, lines: vec![format!("not a deposited work graph: {} does not have the fields {}", name, DEPOSIT_KEYS.join(", "))] };
    }
    let bad = |why: Vec<String>| {
        let mut lines = vec![TAMPERED.to_string()];
        lines.extend(why.into_iter().map(|w| format!("  {}", w)));
        Deposit { exit: 4, lines }
    };
    let body = Value::Obj(o.without(&["bundle_sha256"]));
    let want = json::hash_of(&body);
    if sv(o.get("bundle_sha256")) != want {
        return bad(vec![format!("bundle_sha256 does not recompute (the content hashes to {})", want)]);
    }
    let mut g = Graph::new(true);
    let mut tell: Vec<String> = Vec::new();
    let mut party_lines: Vec<String> = Vec::new();
    for (i, c) in o.get("charters").unwrap().as_arr().unwrap().iter().enumerate() {
        match validate_charter(c).and_then(|(ch, parties)| g.add_charter(c).map(|_| (ch, parties))) {
            Err(e) => return bad(vec![format!("charters[{}]: {}: {}", i, e.code, e.message)]),
            Ok((charter, parties)) => {
                let pw = |p: &Party| {
                    if p.signed {
                        format!("signed, key sha256 {}", &p.fingerprint.as_deref().unwrap_or("")[..16.min(p.fingerprint.as_deref().unwrap_or("").len())])
                    } else if let Some(fp) = &p.fingerprint {
                        format!("keyed (sha256 {}) but not signed", &fp[..16])
                    } else {
                        "named, not signed".into()
                    }
                };
                party_lines.push(format!(
                    "charter {}: {}",
                    short(&charter.id),
                    parties.iter().map(|p| format!("{} ({}): {}", p.kind, p.as_, pw(p))).collect::<Vec<_>>().join("; ")
                ));
                for p in &parties {
                    if !p.signed {
                        tell.push(format!("charter {}: the {} party \"{}\" has not signed", short(&charter.id), p.kind, p.as_));
                    }
                }
            }
        }
    }
    for (i, f) in o.get("frags").unwrap().as_arr().unwrap().iter().enumerate() {
        if let Err(e) = g.add_frag(f) {
            return bad(vec![format!("frags[{}]: {}: {}", i, e.code, e.message)]);
        }
    }
    let early: Vec<String> = g.outside.iter().filter(|i| g.has(i)).cloned().collect();
    if !early.is_empty() {
        return bad(vec![format!(
            "{} frag(s) appear after a frag that relies on them ({}); a deposit lists parents first",
            early.len(),
            early.iter().take(3).map(|i| short(i)).collect::<Vec<_>>().join(", ")
        )]);
    }
    if !g.outside.is_empty() {
        let mut out_ids = g.outside.clone();
        out_ids.sort_by(|a, b| cmp16(a, b));
        tell.push(format!(
            "{} id(s) referenced but not in this file: {}{}",
            out_ids.len(),
            out_ids.iter().take(5).map(|i| short(i)).collect::<Vec<_>>().join(", "),
            if out_ids.len() > 5 { ", ..." } else { "" }
        ));
    }
    let mut prose = Obj::new();
    for h in g.heads() {
        match digest_line(&g, &h.id) {
            Ok(line) => prose.set(&h.id, Value::s(&line)),
            Err(e) => return bad(vec![format!("prose: {}: {}", e.code, e.message)]),
        }
    }
    let carried = o.get("prose").unwrap().as_obj().unwrap();
    let mut seen: Vec<JStr> = Vec::new();
    let mut diffs = Vec::new();
    for k in prose.js_keys().into_iter().chain(carried.js_keys()) {
        if seen.contains(k) {
            continue;
        }
        seen.push(k.clone());
        let pv = prose.get_j(k);
        let cv = carried.get_j(k);
        if let (Some(p), Some(Value::Str(c))) = (pv, cv) {
            if p.as_jstr() == Some(c) {
                continue;
            }
        }
        let kl = k.lossy();
        let in_prose = pv.is_some() || PROTO.contains(&kl.as_str());
        let in_carried = cv.is_some() || PROTO.contains(&kl.as_str());
        diffs.push(format!(
            "prose for {}: {}",
            short(&kl),
            if in_prose {
                if in_carried {
                    "differs from what the graph generates"
                } else {
                    "missing"
                }
            } else {
                "is not a head of this graph"
            }
        ));
    }
    if !diffs.is_empty() {
        diffs.truncate(5);
        return bad(diffs);
    }
    let st = g.statuses();
    let count = |s: &str| st.values().filter(|v| v.status == s).count();
    let mut lines = vec![format!(
        "{}: intact{}: {} frag(s), {} charter(s); bundle sha256 {}",
        BUNDLE_SCHEMA,
        if tell.is_empty() { "" } else { ", and some things cannot be told here" },
        g.frags.len(),
        g.charters.len(),
        want
    )];
    lines.extend(party_lines);
    lines.push(format!(
        "statuses: {} ok, {} wrong, {} stale, {} cleared; {} open ask(s)",
        count("ok"),
        count("wrong"),
        count("stale"),
        count("cleared"),
        g.open_asks(None).len()
    ));
    if !tell.is_empty() {
        lines.push("can't tell here:".into());
        lines.extend(tell.iter().map(|t| format!("  {}", t)));
    }
    lines.push("heads (generated, re-derived from the graph):".into());
    for h in g.heads() {
        lines.push(format!("  {} {}", short(&h.id), prose.get(&h.id).and_then(|v| v.as_str()).unwrap_or_default()));
    }
    Deposit { exit: if tell.is_empty() { 0 } else { 2 }, lines }
}

// ---------------------------------------------------------------------------------------------------------------------
// head.ts + store.ts: a store's index chain and head record (read only)

fn tampered(what: String) -> Refused {
    refused("store_tampered", format!("store: {}", what))
}

fn lines_word(k: usize) -> String {
    format!("{} line{}", k, if k == 1 { "" } else { "s" })
}

struct StoreHead {
    bytes: usize,
    count: usize,
    head: String,
}

fn parse_store_head(text: &str) -> R<StoreHead> {
    let unreadable = |why: &str| {
        tampered(format!(
            "the head record {} {}, so it cannot say where the index ends; if nothing else touched the store, delete it: the next append \
             checks the whole store and writes it again",
            STORE_HEAD_FILE, why
        ))
    };
    let r = parse_strict(text, STORE_HEAD_FILE).map_err(|_| unreadable("does not parse"))?;
    let shape_ok = match r.as_obj() {
        Some(o) => {
            let mut ks = o.keys_lossy();
            ks.sort_by(|a, b| cmp16(a, b));
            ks.join(",") == "bytes,count,head,version"
                && json::js_eq(o.get("version"), Some(&Value::n(1.0)))
                && is_safe_integer(o.get("bytes"))
                && o.get("bytes").unwrap().as_num().unwrap() >= 0.0
                && is_safe_integer(o.get("count"))
                && o.get("count").unwrap().as_num().unwrap() >= 0.0
                && o.get("head").and_then(|h| h.as_str()).map_or(false, |h| is_hex64(&h))
        }
        None => false,
    };
    if !shape_ok {
        return Err(unreadable("is not { bytes, count, head, version }"));
    }
    let h = StoreHead {
        bytes: r.get("bytes").unwrap().as_num().unwrap() as usize,
        count: r.get("count").unwrap().as_num().unwrap() as usize,
        head: sv(r.get("head")),
    };
    if (h.count == 0) != (h.bytes == 0) || (h.count == 0 && h.head != ZERO) {
        return Err(unreadable(&format!(
            "records {} in {} bytes with head {}, which cannot all be true",
            lines_word(h.count),
            h.bytes,
            json::ellipsis16(&h.head)
        )));
    }
    Ok(h)
}

fn check_lines_against_head(index_lines: &[&str], h: &StoreHead) -> R<Option<String>> {
    let n = index_lines.len();
    if n < h.count {
        let k = h.count - n;
        return Err(tampered(format!(
            "{} holds {}, but its head record {} says {}: the last {} {} removed or the index was rewritten",
            INDEX,
            lines_word(n),
            STORE_HEAD_FILE,
            h.count,
            lines_word(k),
            if k == 1 { "was" } else { "were" }
        )));
    }
    if h.count > 0 {
        let at = sha256_text(index_lines[h.count - 1]);
        if at != h.head {
            return Err(tampered(format!(
                "line {} of {} is not the one its head record {} names (the record says hash {}, the index has {} there): the index was rewritten",
                h.count,
                INDEX,
                STORE_HEAD_FILE,
                json::ellipsis16(&h.head),
                json::ellipsis16(&at)
            )));
        }
    }
    let nbytes: usize = index_lines[..h.count].iter().map(|l| l.len() + 1).sum();
    if nbytes != h.bytes {
        return Err(tampered(format!(
            "{} holds {} bytes up to the end of line {}, but its head record {} says {}: bytes were added to or removed from the lines it covers",
            INDEX, nbytes, h.count, STORE_HEAD_FILE, h.bytes
        )));
    }
    if n > h.count {
        return Ok(Some(format!(
            "the head record {} covers {} of the {} index lines (an append stopped before it wrote the head); the next append checks the whole store \
             and writes it again",
            STORE_HEAD_FILE, h.count, n
        )));
    }
    Ok(None)
}

/// A failure of loadStore: a refusal (exit 1, "refused (<code>): ...") or an I/O error in Node's words (exit 1, the words alone).
pub enum StoreErr {
    Refused(Refused),
    Io(String),
}

impl From<Refused> for StoreErr {
    fn from(r: Refused) -> StoreErr {
        StoreErr::Refused(r)
    }
}

fn read_text_lossy(p: &Path) -> Option<String> {
    std::fs::read(p).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// loadStore: (graph, notes), re-checking every id, file name, the index chain, every indexed file, and the head record.
pub fn load_store(d: &Path) -> Result<(Graph, Vec<String>), StoreErr> {
    if !(d.join(INDEX).exists() && d.join("frags").exists()) {
        return Err(refused("field_missing", format!("{} is not a work graph store (run \"workgraph init\" there first)", d.display())).into());
    }
    let hp = d.join(STORE_HEAD_FILE);
    let head_text = if hp.exists() { read_text_lossy(&hp) } else { None };
    let mut graph = Graph::new(false);
    let mut notes = Vec::new();
    let text = read_text_lossy(&d.join(INDEX)).unwrap_or_default();
    let mut lines: Vec<&str> = text.split('\n').collect();
    if lines.last() != Some(&"") {
        return Err(tampered(format!("{} does not end with a newline (a line was cut short)", INDEX)).into());
    }
    lines.pop();
    let mut prev = ZERO.to_string();
    let mut indexed: HashSet<String> = HashSet::new();
    for (i, line) in lines.iter().enumerate() {
        let e = parse_strict(line, &format!("{} line {}", INDEX, i + 1)).map_err(|err| tampered(err.message))?;
        if json::canonicalize(&e) != *line {
            return Err(tampered(format!("{} line {} is not in canonical form", INDEX, i + 1)).into());
        }
        if e.is_null() {
            return Err(tampered(format!("{} line {} is not an index line (JSON null)", INDEX, i + 1)).into());
        }
        if !json::js_eq(e.get("seq"), Some(&Value::n(i as f64))) {
            return Err(tampered(format!("{} line {} says seq {}; lines were removed or reordered", INDEX, i + 1, js_str(e.get("seq")))).into());
        }
        if !json::js_eq(e.get("prev"), Some(&Value::s(&prev))) {
            return Err(tampered(format!("{} line {} does not chain to the line before it", INDEX, i + 1)).into());
        }
        prev = sha256_text(line);
        let typ = e.get("type");
        let sub = if json::is_str(typ, "frag") {
            "frags"
        } else if json::is_str(typ, "charter") {
            "charters"
        } else {
            return Err(tampered(format!("{} line {} has an unknown type", INDEX, i + 1)).into());
        };
        let eid = js_str(e.get("id"));
        let p = d.join(sub).join(format!("{}.json", eid));
        let b = match std::fs::read(&p) {
            Ok(b) => b,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(tampered(format!("{}/{}.json is indexed but missing", sub, eid)).into())
            }
            Err(err) => return Err(StoreErr::Io(err.to_string())),
        };
        let obj = parse_strict_bytes(&b, &format!("{}/{}.json", sub, eid)).map_err(Refused::from)?;
        if String::from_utf8_lossy(&b) != json::canonicalize(&obj) + "\n" {
            return Err(tampered(format!("{}/{}.json is not the canonical JSON its id was taken over", sub, eid)).into());
        }
        let added = if sub == "frags" {
            if !json::is_str(obj.get("schema"), WORK_FRAG_SCHEMA) {
                Err(refused("schema_wrong", "not a work frag".into()))
            } else {
                graph.add_frag(&obj)
            }
        } else if !json::is_str(obj.get("schema"), CHARTER_SCHEMA) {
            Err(refused("schema_wrong", "not a charter".into()))
        } else {
            graph.add_charter(&obj)
        };
        if let Err(r) = added {
            return Err(tampered(format!("{}/{}.json: {}{}", sub, eid, if r.code.is_empty() { String::new() } else { format!("{}: ", r.code) }, r.message)).into());
        }
        if !json::js_eq(obj.get("id"), e.get("id")) {
            return Err(tampered(format!("{}/{}.json holds {}", sub, eid, js_slice(&js_str(obj.get("id")), 12))).into());
        }
        indexed.insert(format!("{}/{}.json", sub, eid));
    }
    if let Some(ht) = head_text {
        if let Some(behind) = check_lines_against_head(&lines, &parse_store_head(&ht)?)? {
            notes.push(behind);
        }
    }
    for sub in ["frags", "charters"] {
        let p = d.join(sub);
        if !p.is_dir() {
            return Err(StoreErr::Io(format!("ENOENT: no such file or directory, scandir '{}'", p.display())));
        }
        let mut names: Vec<String> = std::fs::read_dir(&p)
            .map_err(|e| StoreErr::Io(e.to_string()))?
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
            .collect();
        names.sort_by(|a, b| cmp16(a, b));
        for name in names {
            if name.ends_with(".json") && !indexed.contains(&format!("{}/{}", sub, name)) {
                notes.push(format!(
                    "{}/{} is not in the index (a write that did not finish, or a file added by hand); it is not part of the graph",
                    sub, name
                ));
            }
        }
    }
    Ok((graph, notes))
}

// ---------------------------------------------------------------------------------------------------------------------
// cli.ts (the reading verbs)

pub const USAGE: &str = "prototype; no measured accuracy\n\
usage: riposte-record workgraph <verb> [options]   (the store is --store <dir>, else $WORKGRAPH_STORE, else ./.workgraph)\n\
\x20 open <file.workgraph.json> [--json]        check a deposited file with no other file (exit 0, 2, 3 or 4)\n\
\x20 status [--json]                            counts, wrong, stale, open asks (the store's index chain and head record re-checked)\n\
\x20 digest <id> [--detail]                     doing / why / next, generated from the graph\n\
\x20 charter check <charter.json>               verify the id and every signature; list the parties\n\
\x20 (a reader, tier 1: init, add, invalidate, check, deposit, open --into, charter parse and charter sign write, and are the workgraph command's)";

const VALUE: [&str; 11] = ["--store", "--by", "--reason", "--evidence", "--time", "--result", "--compare", "--out", "--into", "--party", "--key"];
const BOOL: [&str; 3] = ["--json", "--detail", "--help"];

enum CliErr {
    Usage(String),
    Refused(Refused),
    Io(String),
}

impl From<Refused> for CliErr {
    fn from(r: Refused) -> CliErr {
        CliErr::Refused(r)
    }
}

impl From<StoreErr> for CliErr {
    fn from(e: StoreErr) -> CliErr {
        match e {
            StoreErr::Refused(r) => CliErr::Refused(r),
            StoreErr::Io(s) => CliErr::Io(s),
        }
    }
}

/// `workgraph <verb> ...` with `cwd` as the working folder and `env_store` as $WORKGRAPH_STORE.
pub fn workgraph_cli(argv: &[String], cwd: &Path, env_store: Option<&str>) -> CmdResult {
    let mut out = String::new();
    let mut err = String::new();
    let code = match run_cli(argv, cwd, env_store, &mut out, &mut err) {
        Ok(c) => c,
        Err(CliErr::Usage(m)) => {
            err.push_str(&format!("{}\n{}\n", m, USAGE));
            3
        }
        Err(CliErr::Refused(r)) => {
            err.push_str(&format!("refused ({}): {}\n", r.code, r.message));
            1
        }
        Err(CliErr::Io(m)) => {
            err.push_str(&format!("{}\n", m));
            1
        }
    };
    CmdResult { code, out, err }
}

fn say(out: &mut String, s: &str) {
    out.push_str(s);
    if !s.ends_with('\n') {
        out.push('\n');
    }
}

fn run_cli(argv: &[String], cwd: &Path, env_store: Option<&str>, out: &mut String, err: &mut String) -> Result<i32, CliErr> {
    let verb = match argv.first() {
        None => {
            err.push_str(&format!("{}\n", USAGE));
            return Ok(3);
        }
        Some(v) => v.as_str(),
    };
    if verb == "help" || verb == "--help" {
        say(out, USAGE);
        return Ok(0);
    }
    let mut flags: Vec<(String, String)> = Vec::new();
    let mut bools: Vec<String> = Vec::new();
    let mut rest: Vec<String> = Vec::new();
    let args = &argv[1..];
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if VALUE.contains(&a.as_str()) {
            i += 1;
            match args.get(i) {
                None => return Err(CliErr::Usage(format!("{} needs a value", a))),
                Some(v) => {
                    flags.retain(|(k, _)| k != a);
                    flags.push((a.clone(), v.clone()));
                }
            }
        } else if BOOL.contains(&a.as_str()) {
            bools.push(a.clone());
        } else if a.starts_with("--") {
            return Err(CliErr::Usage(format!("unknown option {}", a)));
        } else {
            rest.push(a.clone());
        }
        i += 1;
    }
    let flag = |k: &str| flags.iter().find(|(f, _)| f == k).map(|(_, v)| v.clone());
    let has = |k: &str| bools.iter().any(|b| b == k);
    let store_s = flag("--store").or_else(|| env_store.map(String::from)).unwrap_or_else(|| ".workgraph".into());
    let store = join_norm(cwd, &store_s);
    if matches!(verb, "init" | "add" | "invalidate" | "check" | "deposit") {
        return Err(CliErr::Usage(format!("{} writes to a store; this reader only reads (node packages/workgraph/dist/cli.js {})", verb, verb)));
    }
    match verb {
        "status" => {
            let (graph, notes) = load_store(&store)?;
            let st = graph.statuses();
            let by = |s: &str| -> Vec<&Frag> { graph.frag_order.iter().filter(|i| st[*i].status == s).map(|i| &graph.frags[i]).collect() };
            let asks = graph.open_asks(None);
            if has("--json") {
                let ids = |v: Vec<&Frag>| Value::Arr(v.iter().map(|f| Value::s(&f.id)).collect());
                let o = Value::obj(vec![
                    ("frags", Value::n(graph.frags.len() as f64)),
                    ("charters", Value::n(graph.charters.len() as f64)),
                    ("wrong", ids(by("wrong"))),
                    ("stale", ids(by("stale"))),
                    ("cleared", ids(by("cleared"))),
                    ("open_asks", ids(asks.clone())),
                    ("notes", Value::strs(&notes)),
                ]);
                say(out, &json::stringify(&o));
                return Ok(0);
            }
            say(
                out,
                &format!(
                    "{} frag(s), {} charter(s): {} ok, {} wrong, {} stale, {} cleared; {} open ask(s)",
                    graph.frags.len(),
                    graph.charters.len(),
                    by("ok").len(),
                    by("wrong").len(),
                    by("stale").len(),
                    by("cleared").len(),
                    asks.len()
                ),
            );
            for s in ["wrong", "stale", "cleared"] {
                for f in by(s) {
                    say(out, &format!("  {} {} {}", s, short(&f.id), f.action));
                }
            }
            for a in &asks {
                say(out, &format!("  asks {} {}", short(&a.id), a.decision.as_ref().unwrap().question));
            }
            for n in &notes {
                say(out, &format!("note: {}", n));
            }
            Ok(0)
        }
        "digest" => {
            if rest.len() != 1 {
                return Err(CliErr::Usage("digest takes one id".into()));
            }
            if flag("--compare").is_some() {
                return Err(CliErr::Usage("--compare is the workgraph command's (node packages/workgraph/dist/cli.js digest --compare)".into()));
            }
            let (graph, _) = load_store(&store)?;
            let id = graph.resolve(&rest[0])?;
            if has("--detail") {
                out.push_str(&digest_detail(&graph, &id)?);
            } else {
                out.push_str(&(digest_line(&graph, &id)? + "\n"));
            }
            Ok(0)
        }
        "open" => {
            if rest.len() != 1 {
                return Err(CliErr::Usage("open takes one file".into()));
            }
            if flag("--into").is_some() {
                return Err(CliErr::Usage("--into writes to a store; this reader only reads (node packages/workgraph/dist/cli.js open --into)".into()));
            }
            let f = join_norm(cwd, &rest[0]);
            if !f.exists() {
                err.push_str(&format!("no such file: {}\n", rest[0]));
                return Ok(3);
            }
            let b = std::fs::read(&f).map_err(|e| CliErr::Io(e.to_string()))?;
            let r = open_deposit(&b, &rest[0]);
            if has("--json") {
                let o = Value::obj(vec![("exit", Value::n(r.exit as f64)), ("lines", Value::strs(&r.lines))]);
                say(out, &json::stringify(&o));
            } else {
                for ln in &r.lines {
                    say(out, ln);
                }
            }
            Ok(r.exit)
        }
        "charter" => {
            let (sub, file) = match (rest.first(), rest.get(1)) {
                (Some(s), Some(f)) => (s.clone(), f.clone()),
                _ => return Err(CliErr::Usage("charter parse|sign|check <file>".into())),
            };
            if sub == "parse" || sub == "sign" {
                return Err(CliErr::Usage(format!("charter {} writes; this reader only reads (node packages/workgraph/dist/cli.js charter {})", sub, sub)));
            }
            if sub != "check" {
                return Err(CliErr::Usage(format!("unknown charter verb {}", sub)));
            }
            let b = std::fs::read(join_norm(cwd, &file)).map_err(|e| CliErr::Io(e.to_string()))?;
            let v = parse_strict_bytes(&b, &file).map_err(Refused::from)?;
            let (charter, parties) = validate_charter(&v)?;
            say(out, &format!("charter {}: the id recomputes and every signature present verifies", charter.id));
            for p in &parties {
                let words = if p.signed {
                    format!("signed, key sha256 {}", p.fingerprint.clone().unwrap_or_default())
                } else if let Some(fp) = &p.fingerprint {
                    format!("keyed (sha256 {}), not signed", fp)
                } else {
                    "named, not signed".into()
                };
                say(out, &format!("  party {}: {} ({}): {}", p.index, p.kind, p.as_, words));
            }
            Ok(if parties.iter().all(|p| p.signed) { 0 } else { 2 })
        }
        _ => Err(CliErr::Usage(format!("unknown verb {}", verb))),
    }
}
