// SPDX-License-Identifier: Apache-2.0
//! The engine's strict JSON reader (packages/verify/src/protocol/hash-input.ts parseJsonStrict), in its order and its
//! sentences: a byte-order mark, nesting past 256 levels, text JSON.parse would not read, a key written twice in one object
//! (with its JSON path), a number past the double range, a number whose text does not read back as written. Text that is not
//! JSON at all is refused with this reader's own reason (V8's words are the runtime's, not the format's).

use crate::json::{self, is_ident, js_number, js_slice, js_string, utf16_len, JStr, Value};

pub const MAX_JSON_DEPTH: usize = 256;
pub const BOM: char = '\u{FEFF}';
pub const INEXACT_NUMBER_WORDS: &str = "a number that cannot be represented exactly; write amounts as strings with two decimals";

#[derive(Debug, Clone)]
pub enum StrictErr {
    /// HashInputRefused: the engine's sentence and the place it names.
    Refused { message: String, at: String },
    /// Text JSON.parse would not read.
    NotJson { message: String },
}

impl StrictErr {
    pub fn message(&self) -> &str {
        match self {
            StrictErr::Refused { message, .. } | StrictErr::NotJson { message } => message,
        }
    }
    pub fn place(&self) -> Option<&str> {
        match self {
            StrictErr::Refused { at, .. } => Some(at),
            StrictErr::NotJson { .. } => None,
        }
    }
}

/// hash-input.ts invalidUtf8Offset: the offset of the first byte that does not begin a UTF-8 character, or None.
pub fn invalid_utf8_offset(b: &[u8]) -> Option<usize> {
    let n = b.len();
    let mut i = 0;
    while i < n {
        let c = b[i];
        if c < 0x80 {
            i += 1;
            continue;
        }
        let (need, lo, hi) = match c {
            0xC2..=0xDF => (1, 0x80, 0xBF),
            0xE0 => (2, 0xA0, 0xBF),
            0xED => (2, 0x80, 0x9F),
            0xE1..=0xEF => (2, 0x80, 0xBF),
            0xF0 => (3, 0x90, 0xBF),
            0xF4 => (3, 0x80, 0x8F),
            0xF1..=0xF3 => (3, 0x80, 0xBF),
            _ => return Some(i),
        };
        if i + need >= n {
            return Some(i);
        }
        let second = b[i + 1];
        if second < lo || second > hi {
            return Some(i);
        }
        for k in 2..=need {
            let x = b[i + k];
            if !(0x80..=0xBF).contains(&x) {
                return Some(i);
            }
        }
        i += need + 1;
    }
    None
}

/// decodeUtf8Strict: the text of valid UTF-8 (a byte-order mark kept as U+FEFF), or the refusal naming the offset.
pub fn decode_utf8_strict(b: &[u8], name: &str) -> Result<String, StrictErr> {
    if let Some(at) = invalid_utf8_offset(b) {
        let shown: Vec<String> = b[at..(at + 4).min(b.len())].iter().map(|x| format!("{:02X}", x)).collect();
        return Err(StrictErr::Refused {
            message: format!(
                "{} is not valid UTF-8: the bytes at offset {} ({}) are not a UTF-8 character. A text input is hashed as UTF-8, and decoding \
                 would replace those bytes with U+FFFD, so two different files would share one input_hash. Re-save the file as UTF-8 (or fix \
                 the byte), then run it again",
                name,
                at,
                shown.join(" ")
            ),
            at: format!("byte {}", at),
        });
    }
    Ok(String::from_utf8_lossy(b).into_owned())
}

pub fn path_step_key(path: &str, key: &JStr) -> String {
    if is_ident(key) {
        format!("{}.{}", path, key.lossy())
    } else {
        format!("{}[{}]", path, js_string(key))
    }
}

pub fn path_step_idx(path: &str, i: usize) -> String {
    format!("{}[{}]", path, i)
}

/// The reduced decimal of a number token: None when it is not one; Some(None) for zero; Some(Some((negative, digits, exp))).
#[allow(clippy::type_complexity)]
fn reduced_decimal(text: &str) -> Option<Option<(bool, String, i128)>> {
    let b = text.as_bytes();
    let mut i = 0;
    let neg = b.first() == Some(&b'-');
    if neg {
        i += 1;
    }
    let ds = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    if i == ds {
        return None;
    }
    let int = &text[ds..i];
    let mut frac = "";
    if i < b.len() && b[i] == b'.' {
        let fs = i + 1;
        let mut j = fs;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j == fs {
            return None;
        }
        frac = &text[fs..j];
        i = j;
    }
    let mut exp: i128 = 0;
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        let es = i + 1;
        let mut j = es;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
            j += 1;
        }
        let dstart = j;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j == dstart {
            return None;
        }
        let t = &text[es..j];
        exp = t.parse::<i128>().unwrap_or(if t.starts_with('-') { -(1i128 << 100) } else { 1i128 << 100 });
        i = j;
    }
    if i != b.len() {
        return None;
    }
    let all = format!("{}{}", int, frac);
    let digits = all.trim_start_matches('0');
    if digits.is_empty() {
        return Some(None);
    }
    let mut e = exp - frac.len() as i128;
    let stripped = digits.trim_end_matches('0');
    e += (digits.len() - stripped.len()) as i128;
    Some(Some((neg, stripped.to_string(), e)))
}

/// float(text), Infinity past the double range.
pub fn number_of(text: &str) -> f64 {
    text.parse::<f64>().unwrap_or(f64::INFINITY)
}

/// numberTextIsExact: the token reads back as written (a non-finite number is the non-finite check's).
pub fn number_text_is_exact(text: &str) -> bool {
    let a = match reduced_decimal(text) {
        None => return true,
        Some(a) => a,
    };
    let x = number_of(text);
    if !x.is_finite() {
        return true;
    }
    let b = reduced_decimal(&js_number(x));
    match (&a, &b) {
        (None, Some(None)) => true,
        (None, _) | (_, Some(None)) => false,
        (Some(a), Some(Some(b))) => a == b,
        (_, None) => false,
    }
}

/// The offset, in UTF-16 code units, where nesting passes `limit`, or None.
pub fn too_deep_offset(text: &str, limit: usize) -> Option<usize> {
    let mut depth: isize = 0; // signed, as JavaScript's counter is: a stray closer takes it below zero
    let mut in_string = false;
    let mut at16 = 0usize;
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if in_string {
            if c == '\\' {
                at16 += 1;
                match chars.next() {
                    Some(n) => at16 += n.len_utf16(),
                    None => break,
                }
                continue;
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
        } else if c == '{' || c == '[' {
            depth += 1;
            if depth > limit as isize {
                return Some(at16);
            }
        } else if c == '}' || c == ']' {
            depth -= 1;
        }
        at16 += c.len_utf16();
    }
    None
}

#[derive(Clone)]
enum Seg {
    None,
    Key(JStr),
    Idx(usize),
}

struct Frame {
    is_obj: bool,
    seg: Seg,
    keys: Vec<JStr>,
    key: JStr,
    count: usize,
}

enum Mode {
    Duplicate,
    Inexact,
}

/// One pass of scanJsonText: (path, key) of the first key repeated in one object, or (path, token) of the first number that
/// does not read back as written; None otherwise, or at the first thing the scan cannot read.
fn scan_json_text(text: &str, mode: Mode) -> Option<(String, JStr)> {
    let b = text.as_bytes();
    let n = b.len();
    let mut i = 0usize;
    let mut stack: Vec<Frame> = Vec::new();

    let ws = |i: &mut usize| {
        while *i < n && matches!(b[*i], b' ' | b'\n' | b'\r' | b'\t') {
            *i += 1;
        }
    };
    let string_end = |i: usize| -> Option<usize> {
        let mut j = i + 1;
        loop {
            let qq = j + b.get(j..)?.iter().position(|c| *c == b'"')?;
            let mut k = qq;
            let mut slashes = 0;
            while k > i + 1 && b[k - 1] == b'\\' {
                slashes += 1;
                k -= 1;
            }
            // a backslash at i itself (the opening quote) is never counted
            if slashes % 2 == 0 {
                return Some(qq);
            }
            j = qq + 1;
        }
    };
    let seg_path = |stack: &Vec<Frame>, last: Seg| -> String {
        let mut p = String::from("$");
        for f in stack.iter().skip(1) {
            p = match &f.seg {
                Seg::Key(k) => path_step_key(&p, k),
                Seg::Idx(x) => path_step_idx(&p, *x),
                Seg::None => p,
            };
        }
        match last {
            Seg::Key(k) => path_step_key(&p, &k),
            Seg::Idx(x) => path_step_idx(&p, x),
            Seg::None => p,
        }
    };

    #[derive(PartialEq)]
    enum St {
        Value,
        Key,
        After,
    }
    let mut state = St::Value;
    loop {
        match state {
            St::Value => {
                ws(&mut i);
                let c = b.get(i).copied();
                if c == Some(b'{') || c == Some(b'[') {
                    let c = c.unwrap();
                    let seg = match stack.last() {
                        None => Seg::None,
                        Some(t) => {
                            if t.is_obj {
                                Seg::Key(t.key.clone())
                            } else {
                                Seg::Idx(t.count)
                            }
                        }
                    };
                    i += 1;
                    ws(&mut i);
                    if i < n && b[i] == if c == b'{' { b'}' } else { b']' } {
                        i += 1;
                        state = St::After;
                        continue;
                    }
                    stack.push(Frame { is_obj: c == b'{', seg, keys: Vec::new(), key: JStr::default(), count: 0 });
                    state = if c == b'{' { St::Key } else { St::Value };
                    continue;
                }
                if c == Some(b'"') {
                    let e = string_end(i)?;
                    i = e + 1;
                    state = St::After;
                    continue;
                }
                if i >= n {
                    return None;
                }
                let start = i;
                while i < n && !matches!(b[i], b',' | b']' | b'}' | b' ' | b'\n' | b'\r' | b'\t') {
                    i += 1;
                }
                let c = c.unwrap();
                if matches!(mode, Mode::Inexact) && (c == b'-' || c.is_ascii_digit()) {
                    let token = &text[start..i];
                    if !number_text_is_exact(token) {
                        let last = match stack.last() {
                            None => Seg::None,
                            Some(t) => {
                                if t.is_obj {
                                    Seg::Key(t.key.clone())
                                } else {
                                    Seg::Idx(t.count)
                                }
                            }
                        };
                        return Some((seg_path(&stack, last), JStr::new(token)));
                    }
                }
                state = St::After;
            }
            St::Key => {
                ws(&mut i);
                if i >= n || b[i] != b'"' {
                    return None;
                }
                let e = string_end(i)?;
                let raw = &text[i + 1..e];
                let key = if raw.contains('\\') { json::parse_string_token(&text[i..=e])? } else { JStr::new(raw) };
                i = e + 1;
                let top = stack.last_mut().unwrap();
                if matches!(mode, Mode::Duplicate) {
                    if top.keys.contains(&key) {
                        let k = key.clone();
                        return Some((seg_path(&stack, Seg::Key(k.clone())), k));
                    }
                    top.keys.push(key.clone());
                }
                let top = stack.last_mut().unwrap();
                top.key = key;
                ws(&mut i);
                if i >= n || b[i] != b':' {
                    return None;
                }
                i += 1;
                state = St::Value;
            }
            St::After => {
                ws(&mut i);
                let top = stack.last_mut()?;
                let c = b.get(i).copied();
                if c == Some(b',') {
                    i += 1;
                    if top.is_obj {
                        state = St::Key;
                    } else {
                        top.count += 1;
                        state = St::Value;
                    }
                    continue;
                }
                if (c == Some(b'}') && top.is_obj) || (c == Some(b']') && !top.is_obj) {
                    i += 1;
                    stack.pop();
                    continue;
                }
                return None;
            }
        }
    }
}

/// The path and the key (as written by js_string) of the first key repeated in one object.
pub fn duplicate_key_path(text: &str) -> Option<(String, JStr)> {
    scan_json_text(text, Mode::Duplicate)
}

pub fn inexact_number_path(text: &str) -> Option<(String, String)> {
    scan_json_text(text, Mode::Inexact).map(|(p, t)| (p, t.lossy()))
}

/// The JSON path of the first number that is not finite (objects walked in Object.keys order), with that number.
pub fn non_finite_path(v: &Value) -> Option<(String, f64)> {
    fn walk(v: &Value, p: &str) -> Option<(String, f64)> {
        match v {
            Value::Num(x) if !x.is_finite() => Some((p.to_string(), *x)),
            Value::Arr(a) => a.iter().enumerate().find_map(|(i, x)| walk(x, &path_step_idx(p, i))),
            Value::Obj(o) => o.js_keys().into_iter().find_map(|k| walk(o.get_j(k).unwrap(), &path_step_key(p, k))),
            _ => None,
        }
    }
    walk(v, "$")
}

fn short_token(t: &str) -> String {
    if utf16_len(t) > 40 {
        format!("{}…({} characters)", js_slice(t, 32), utf16_len(t))
    } else {
        t.to_string()
    }
}

/// parseJsonStrict(text, name): the value, or the engine's refusal, or NotJson.
pub fn parse_json_strict(text: &str, name: &str) -> Result<Value, StrictErr> {
    if text.starts_with(BOM) {
        return Err(StrictErr::Refused {
            message: format!("{}: file starts with a UTF-8 byte-order mark; remove it (save the file as UTF-8 without BOM)", name),
            at: "byte 0".into(),
        });
    }
    if let Some(deep) = too_deep_offset(text, MAX_JSON_DEPTH) {
        return Err(StrictErr::Refused {
            message: format!(
                "{}: nesting too deep, limit {}: an object or array opens more than {} levels down (at character {}). No document, verdict \
                 or ruleset this engine reads nests that deep. Flatten it, then run it again",
                name, MAX_JSON_DEPTH, MAX_JSON_DEPTH, deep
            ),
            at: format!("character {}", deep),
        });
    }
    let x = json::parse(text).map_err(|e| StrictErr::NotJson { message: format!("{}: not valid JSON: {}", name, e) })?;
    if let Some((path, key)) = duplicate_key_path(text) {
        return Err(StrictErr::Refused {
            message: format!(
                "{}: the key {} appears twice in one object (at {}). JSON keeps only the last of them, so a reader that keeps the first \
                 would see a different document than the one hashed and signature-checked here. Keep one of them, then run it again",
                name,
                js_string(&key),
                path
            ),
            at: path,
        });
    }
    if let Some((path, v)) = non_finite_path(&x) {
        let shown = if v > 0.0 { " (Infinity)" } else { " (-Infinity)" };
        return Err(StrictErr::Refused {
            message: format!(
                "{}: the number at {} is not finite{}: JSON reads a number past the double range (1e999) as Infinity, and the hash writes \
                 every non-finite number as null, so it could not be told from null or from its negative. Write it as a finite number, or \
                 as a string the ruleset reads, then run it again",
                name, path, shown
            ),
            at: path,
        });
    }
    if let Some((path, token)) = inexact_number_path(text) {
        let reads = js_number(number_of(&token));
        return Err(StrictErr::Refused {
            message: format!(
                "{}: the number at {} ({}) is {}. JSON numbers are read as doubles, and this one reads as {}, so the hash and every check \
                 would see {}, not what was written. Then run it again",
                name,
                path,
                short_token(&token),
                INEXACT_NUMBER_WORDS,
                reads,
                reads
            ),
            at: path,
        });
    }
    Ok(x)
}
