// SPDX-License-Identifier: Apache-2.0
//! JSON values as JavaScript holds them: every number a double, every string a sequence of UTF-16 code units (so a lone
//! surrogate is data and keys sort by code unit), objects in insertion order with a repeated key kept at its first place and
//! given its last value (JSON.parse). Canonical JSON (docs/INTERCHANGE.md, section 3), JSON.stringify compact and with an
//! indent of two, and Number-to-String, each byte for byte as the Node packages write them.

use core::cmp::Ordering;

/// A JavaScript string: UTF-16 code units.
#[derive(Clone, PartialEq, Eq, Hash, Default, Debug, PartialOrd, Ord)]
pub struct JStr(pub Vec<u16>);

impl JStr {
    pub fn new(s: &str) -> JStr {
        JStr(s.encode_utf16().collect())
    }
    /// The text with a lone surrogate written as U+FFFD (what Node writes for it on a stream or into a Buffer).
    pub fn lossy(&self) -> String {
        String::from_utf16_lossy(&self.0)
    }
    pub fn is(&self, s: &str) -> bool {
        self.0.iter().copied().eq(s.encode_utf16())
    }
    pub fn len16(&self) -> usize {
        self.0.len()
    }
}

#[derive(Clone, Debug)]
pub enum Value {
    Null,
    Bool(bool),
    Num(f64),
    Str(JStr),
    Arr(Vec<Value>),
    Obj(Obj),
}

/// An object: keys in insertion order.
#[derive(Clone, Debug, Default)]
pub struct Obj(pub Vec<(JStr, Value)>);

impl Obj {
    pub fn new() -> Obj {
        Obj(Vec::new())
    }
    pub fn get(&self, k: &str) -> Option<&Value> {
        self.0.iter().find(|(key, _)| key.is(k)).map(|(_, v)| v)
    }
    pub fn get_j(&self, k: &JStr) -> Option<&Value> {
        self.0.iter().find(|(key, _)| key == k).map(|(_, v)| v)
    }
    pub fn has(&self, k: &str) -> bool {
        self.get(k).is_some()
    }
    pub fn has_j(&self, k: &JStr) -> bool {
        self.get_j(k).is_some()
    }
    /// obj[k] = v: a key already there keeps its place.
    pub fn set(&mut self, k: &str, v: Value) {
        self.set_j(JStr::new(k), v)
    }
    pub fn set_j(&mut self, k: JStr, v: Value) {
        if let Some(slot) = self.0.iter_mut().find(|(key, _)| *key == k) {
            slot.1 = v;
        } else {
            self.0.push((k, v));
        }
    }
    pub fn without(&self, drop: &[&str]) -> Obj {
        Obj(self.0.iter().filter(|(k, _)| !drop.iter().any(|d| k.is(d))).cloned().collect())
    }
    /// Object.keys order: array-index keys ascending, then the rest in insertion order.
    pub fn js_keys(&self) -> Vec<&JStr> {
        let mut idx: Vec<(u64, &JStr)> = self.0.iter().filter_map(|(k, _)| index_key(k).map(|n| (n, k))).collect();
        idx.sort_by_key(|(n, _)| *n);
        let mut out: Vec<&JStr> = idx.into_iter().map(|(_, k)| k).collect();
        for (k, _) in &self.0 {
            if index_key(k).is_none() {
                out.push(k);
            }
        }
        out
    }
    pub fn keys_lossy(&self) -> Vec<String> {
        self.js_keys().into_iter().map(|k| k.lossy()).collect()
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
}

/// An array-index key: "0" or a decimal without a leading zero, at most 4294967294.
pub fn index_key(k: &JStr) -> Option<u64> {
    let u = &k.0;
    if u.is_empty() || u.len() > 10 || !u.iter().all(|c| (b'0' as u16..=b'9' as u16).contains(c)) {
        return None;
    }
    if u.len() > 1 && u[0] == b'0' as u16 {
        return None;
    }
    let n: u64 = u.iter().fold(0u64, |a, c| a * 10 + (*c as u64 - b'0' as u64));
    if n <= 4_294_967_294 {
        Some(n)
    } else {
        None
    }
}

impl Value {
    pub fn s(x: &str) -> Value {
        Value::Str(JStr::new(x))
    }
    pub fn n(x: f64) -> Value {
        Value::Num(x)
    }
    pub fn obj(pairs: Vec<(&str, Value)>) -> Value {
        let mut o = Obj::new();
        for (k, v) in pairs {
            o.set(k, v);
        }
        Value::Obj(o)
    }
    pub fn strs<S: AsRef<str>>(xs: &[S]) -> Value {
        Value::Arr(xs.iter().map(|x| Value::s(x.as_ref())).collect())
    }
    pub fn opt_s(x: Option<&str>) -> Value {
        x.map(Value::s).unwrap_or(Value::Null)
    }
    /// o[k] for an object; None (undefined) for anything else or a key it lacks.
    pub fn get(&self, k: &str) -> Option<&Value> {
        match self {
            Value::Obj(o) => o.get(k),
            _ => None,
        }
    }
    pub fn as_obj(&self) -> Option<&Obj> {
        match self {
            Value::Obj(o) => Some(o),
            _ => None,
        }
    }
    pub fn as_arr(&self) -> Option<&Vec<Value>> {
        match self {
            Value::Arr(a) => Some(a),
            _ => None,
        }
    }
    pub fn as_jstr(&self) -> Option<&JStr> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<String> {
        self.as_jstr().map(|s| s.lossy())
    }
    pub fn as_num(&self) -> Option<f64> {
        match self {
            Value::Num(x) => Some(*x),
            _ => None,
        }
    }
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }
    pub fn is_obj(&self) -> bool {
        matches!(self, Value::Obj(_))
    }
    pub fn is_container(&self) -> bool {
        matches!(self, Value::Obj(_) | Value::Arr(_))
    }
    pub fn is_str(&self, s: &str) -> bool {
        matches!(self, Value::Str(j) if j.is(s))
    }
}

/// A string a value holds, or None.
pub fn str_of(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str())
}

pub fn is_str(v: Option<&Value>, s: &str) -> bool {
    matches!(v, Some(x) if x.is_str(s))
}

/// JavaScript truthiness (undefined is None).
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::Num(x)) => *x != 0.0 && !x.is_nan(),
        Some(Value::Str(s)) => !s.0.is_empty(),
        _ => true,
    }
}

/// a === b for parsed values (undefined is None; an object or an array is never === another value).
pub fn js_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(Value::Num(x)), Some(Value::Num(y))) => x == y,
        (Some(Value::Str(x)), Some(Value::Str(y))) => x == y,
        (Some(Value::Bool(x)), Some(Value::Bool(y))) => x == y,
        (Some(Value::Null), Some(Value::Null)) => true,
        _ => false,
    }
}

/// String(v), a template literal's ${v} (undefined is None).
pub fn js_str(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => if *b { "true".into() } else { "false".into() },
        Some(Value::Num(x)) => js_num_str(*x),
        Some(Value::Str(s)) => s.lossy(),
        Some(Value::Arr(a)) => a
            .iter()
            .map(|x| if x.is_null() { String::new() } else { js_str(Some(x)) })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Obj(_)) => "[object Object]".into(),
    }
}

/// String(x) for a double: NaN and the infinities by name, the rest as Number-to-String.
pub fn js_num_str(x: f64) -> String {
    if x.is_nan() {
        "NaN".into()
    } else if x.is_infinite() {
        if x > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else {
        js_number(x)
    }
}

pub fn is_safe_integer(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Num(x)) => x.is_finite() && x.floor() == *x && x.abs() <= 9007199254740991.0,
        _ => false,
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Number-to-String (ECMAScript 6.1.6.1.20), from the shortest digits that read back exactly

/// A double as ECMAScript writes it; NaN and the infinities as "null" (canonical JSON's rule).
pub fn js_number(x: f64) -> String {
    if x == 0.0 {
        return "0".into();
    }
    if !x.is_finite() {
        return "null".into();
    }
    let sign = if x < 0.0 { "-" } else { "" };
    // Rust writes the shortest round-trip digits; {:e} gives them as d.ddde±X
    let e = format!("{:e}", x.abs());
    let (mant, exp) = e.split_once('e').unwrap();
    let exp: i64 = exp.parse().unwrap();
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let digits = digits.trim_end_matches('0');
    let digits = if digits.is_empty() { "0" } else { digits };
    let k = digits.len() as i64;
    let n = exp + 1; // the value is 0.d1d2...dk x 10^n
    let body = if k <= n && n <= 21 {
        format!("{}{}", digits, "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{}", "0".repeat((-n) as usize), digits)
    } else {
        let e = n - 1;
        let m = if k == 1 { digits.to_string() } else { format!("{}.{}", &digits[..1], &digits[1..]) };
        format!("{}e{}{}", m, if e >= 0 { "+" } else { "-" }, e.abs())
    };
    format!("{}{}", sign, body)
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing

/// A string as JSON.stringify writes it: quote, backslash and control characters escaped, a lone surrogate as \udxxx.
pub fn js_string(s: &JStr) -> String {
    let u = &s.0;
    let mut out = String::with_capacity(u.len() + 2);
    out.push('"');
    let mut i = 0;
    while i < u.len() {
        let c = u[i];
        if (0xD800..0xDC00).contains(&c) && i + 1 < u.len() && (0xDC00..0xE000).contains(&u[i + 1]) {
            let cp = 0x10000 + (((c as u32) - 0xD800) << 10) + ((u[i + 1] as u32) - 0xDC00);
            out.push(char::from_u32(cp).unwrap());
            i += 2;
            continue;
        }
        match c {
            0x22 => out.push_str("\\\""),
            0x5C => out.push_str("\\\\"),
            0x08 => out.push_str("\\b"),
            0x0C => out.push_str("\\f"),
            0x0A => out.push_str("\\n"),
            0x0D => out.push_str("\\r"),
            0x09 => out.push_str("\\t"),
            c if c < 0x20 || (0xD800..0xE000).contains(&c) => out.push_str(&format!("\\u{:04x}", c)),
            c => out.push(char::from_u32(c as u32).unwrap()),
        }
        i += 1;
    }
    out.push('"');
    out
}

pub fn js_string_str(s: &str) -> String {
    js_string(&JStr::new(s))
}

/// The canonical key order: array-index keys ascending, then every other key by UTF-16 code unit.
pub fn canonical_order(o: &Obj) -> Vec<&(JStr, Value)> {
    let mut idx: Vec<(u64, &(JStr, Value))> = o.0.iter().filter_map(|e| index_key(&e.0).map(|n| (n, e))).collect();
    idx.sort_by_key(|(n, _)| *n);
    let mut rest: Vec<&(JStr, Value)> = o.0.iter().filter(|e| index_key(&e.0).is_none()).collect();
    rest.sort_by(|a, b| a.0 .0.cmp(&b.0 .0));
    idx.into_iter().map(|(_, e)| e).chain(rest).collect()
}

/// Canonical JSON (docs/INTERCHANGE.md, section 3).
pub fn canonicalize(v: &Value) -> String {
    let mut out = String::new();
    canon_into(v, &mut out);
    out
}

fn canon_into(v: &Value, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Num(x) => out.push_str(&js_number(*x)),
        Value::Str(s) => out.push_str(&js_string(s)),
        Value::Arr(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canon_into(x, out);
            }
            out.push(']');
        }
        Value::Obj(o) => {
            out.push('{');
            for (i, (k, x)) in canonical_order(o).into_iter().map(|e| (&e.0, &e.1)).enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&js_string(k));
                out.push(':');
                canon_into(x, out);
            }
            out.push('}');
        }
    }
}

/// JSON.stringify(v): compact, keys in Object.keys order.
pub fn stringify(v: &Value) -> String {
    match v {
        Value::Arr(a) => format!("[{}]", a.iter().map(stringify).collect::<Vec<_>>().join(",")),
        Value::Obj(o) => format!(
            "{{{}}}",
            o.js_keys().into_iter().map(|k| format!("{}:{}", js_string(k), stringify(o.get_j(k).unwrap()))).collect::<Vec<_>>().join(",")
        ),
        _ => canonicalize(v),
    }
}

/// JSON.stringify(v, null, 2).
pub fn pretty(v: &Value) -> String {
    let mut out = String::new();
    pretty_into(v, "", &mut out);
    out
}

fn pretty_into(v: &Value, indent: &str, out: &mut String) {
    match v {
        Value::Obj(o) => {
            let keys = o.js_keys();
            if keys.is_empty() {
                out.push_str("{}");
                return;
            }
            let inner = format!("{}  ", indent);
            out.push_str("{\n");
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push_str(",\n");
                }
                out.push_str(&inner);
                out.push_str(&js_string(k));
                out.push_str(": ");
                pretty_into(o.get_j(k).unwrap(), &inner, out);
            }
            out.push('\n');
            out.push_str(indent);
            out.push('}');
        }
        Value::Arr(a) => {
            if a.is_empty() {
                out.push_str("[]");
                return;
            }
            let inner = format!("{}  ", indent);
            out.push_str("[\n");
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push_str(",\n");
                }
                out.push_str(&inner);
                pretty_into(x, &inner, out);
            }
            out.push('\n');
            out.push_str(indent);
            out.push(']');
        }
        _ => canon_into(v, out),
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// JSON.parse

/// The deepest nesting this parser walks (JSON.parse is bounded by its stack; the strict readers refuse far earlier).
pub const PARSE_DEPTH_LIMIT: usize = 4096;

/// JSON.parse(text): numbers as doubles (1e999 reads as Infinity), a repeated key kept at its first place with its last value.
pub fn parse(text: &str) -> Result<Value, String> {
    let mut p = Parser { b: text.as_bytes(), i: 0 };
    p.ws();
    let v = p.value(0)?;
    p.ws();
    if p.i < p.b.len() {
        return Err(format!("unexpected text after the value at position {}", p.i));
    }
    Ok(v)
}

/// The value of one JSON string token (quotes included), or None when it is not one.
pub fn parse_string_token(tok: &str) -> Option<JStr> {
    let mut p = Parser { b: tok.as_bytes(), i: 0 };
    if p.b.first() != Some(&b'"') {
        return None;
    }
    let s = p.string().ok()?;
    if p.i != p.b.len() {
        return None;
    }
    Some(s)
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Parser<'a> {
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
    }
    fn err<T>(&self, what: &str) -> Result<T, String> {
        Err(format!("{} at position {}", what, self.i))
    }
    fn value(&mut self, depth: usize) -> Result<Value, String> {
        if depth > PARSE_DEPTH_LIMIT {
            return self.err("nested deeper than this reader allows");
        }
        match self.b.get(self.i) {
            None => self.err("unexpected end of JSON input"),
            Some(b'{') => {
                self.i += 1;
                let mut o = Obj::new();
                self.ws();
                if self.b.get(self.i) == Some(&b'}') {
                    self.i += 1;
                    return Ok(Value::Obj(o));
                }
                loop {
                    self.ws();
                    if self.b.get(self.i) != Some(&b'"') {
                        return self.err("expected a property name");
                    }
                    let k = self.string()?;
                    self.ws();
                    if self.b.get(self.i) != Some(&b':') {
                        return self.err("expected ':'");
                    }
                    self.i += 1;
                    self.ws();
                    let v = self.value(depth + 1)?;
                    o.set_j(k, v);
                    self.ws();
                    match self.b.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b'}') => {
                            self.i += 1;
                            return Ok(Value::Obj(o));
                        }
                        _ => return self.err("expected ',' or '}'"),
                    }
                }
            }
            Some(b'[') => {
                self.i += 1;
                let mut a = Vec::new();
                self.ws();
                if self.b.get(self.i) == Some(&b']') {
                    self.i += 1;
                    return Ok(Value::Arr(a));
                }
                loop {
                    self.ws();
                    a.push(self.value(depth + 1)?);
                    self.ws();
                    match self.b.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b']') => {
                            self.i += 1;
                            return Ok(Value::Arr(a));
                        }
                        _ => return self.err("expected ',' or ']'"),
                    }
                }
            }
            Some(b'"') => Ok(Value::Str(self.string()?)),
            Some(b't') if self.b[self.i..].starts_with(b"true") => {
                self.i += 4;
                Ok(Value::Bool(true))
            }
            Some(b'f') if self.b[self.i..].starts_with(b"false") => {
                self.i += 5;
                Ok(Value::Bool(false))
            }
            Some(b'n') if self.b[self.i..].starts_with(b"null") => {
                self.i += 4;
                Ok(Value::Null)
            }
            Some(c) if *c == b'-' || c.is_ascii_digit() => {
                let start = self.i;
                match number_end(self.b, self.i) {
                    Some(end) => {
                        self.i = end;
                        let t = core::str::from_utf8(&self.b[start..end]).unwrap();
                        Ok(Value::Num(t.parse::<f64>().unwrap_or(f64::INFINITY)))
                    }
                    None => self.err("not a JSON number"),
                }
            }
            _ => self.err("unexpected token"),
        }
    }
    fn string(&mut self) -> Result<JStr, String> {
        self.i += 1; // the opening quote
        let mut out: Vec<u16> = Vec::new();
        loop {
            let c = match self.b.get(self.i) {
                None => return self.err("unterminated string"),
                Some(c) => *c,
            };
            match c {
                b'"' => {
                    self.i += 1;
                    return Ok(JStr(out));
                }
                b'\\' => {
                    let e = match self.b.get(self.i + 1) {
                        None => return self.err("unterminated string"),
                        Some(e) => *e,
                    };
                    self.i += 2;
                    match e {
                        b'"' => out.push(0x22),
                        b'\\' => out.push(0x5C),
                        b'/' => out.push(0x2F),
                        b'b' => out.push(0x08),
                        b'f' => out.push(0x0C),
                        b'n' => out.push(0x0A),
                        b'r' => out.push(0x0D),
                        b't' => out.push(0x09),
                        b'u' => {
                            if self.i + 4 > self.b.len() {
                                return self.err("bad unicode escape");
                            }
                            let h = core::str::from_utf8(&self.b[self.i..self.i + 4]).map_err(|_| "bad unicode escape".to_string())?;
                            if !h.bytes().all(|x| x.is_ascii_hexdigit()) {
                                return self.err("bad unicode escape");
                            }
                            out.push(u16::from_str_radix(h, 16).unwrap());
                            self.i += 4;
                        }
                        _ => return self.err("bad escaped character"),
                    }
                }
                c if c < 0x20 => return self.err("bad control character in string literal"),
                c if c < 0x80 => {
                    out.push(c as u16);
                    self.i += 1;
                }
                _ => {
                    // a whole UTF-8 character (the text is a &str, so it is well formed)
                    let n = if c >= 0xF0 { 4 } else if c >= 0xE0 { 3 } else { 2 };
                    let s = core::str::from_utf8(&self.b[self.i..self.i + n]).map_err(|_| "bad UTF-8".to_string())?;
                    let mut buf = [0u16; 2];
                    out.extend_from_slice(s.chars().next().unwrap().encode_utf16(&mut buf));
                    self.i += n;
                }
            }
        }
    }
}

/// The end of a JSON number token starting at i: -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?, or None.
pub fn number_end(b: &[u8], mut i: usize) -> Option<usize> {
    if b.get(i) == Some(&b'-') {
        i += 1;
    }
    match b.get(i) {
        Some(b'0') => i += 1,
        Some(c) if c.is_ascii_digit() => {
            while b.get(i).map_or(false, |c| c.is_ascii_digit()) {
                i += 1;
            }
        }
        _ => return None,
    }
    if b.get(i) == Some(&b'.') && b.get(i + 1).map_or(false, |c| c.is_ascii_digit()) {
        i += 1;
        while b.get(i).map_or(false, |c| c.is_ascii_digit()) {
            i += 1;
        }
    }
    if matches!(b.get(i), Some(b'e') | Some(b'E')) {
        let mut j = i + 1;
        if matches!(b.get(j), Some(b'+') | Some(b'-')) {
            j += 1;
        }
        if b.get(j).map_or(false, |c| c.is_ascii_digit()) {
            while b.get(j).map_or(false, |c| c.is_ascii_digit()) {
                j += 1;
            }
            i = j;
        }
    }
    Some(i)
}

// ---------------------------------------------------------------------------------------------------------------------
// UTF-16 helpers

pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// s.slice(0, n), counted in UTF-16 code units.
pub fn js_slice(s: &str, n: usize) -> String {
    let u: Vec<u16> = s.encode_utf16().take(n).collect();
    String::from_utf16_lossy(&u)
}

/// Compare two strings by UTF-16 code unit (JavaScript's default sort).
pub fn cmp16(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// `${h.slice(0, 16)}…`
pub fn ellipsis16(h: &str) -> String {
    format!("{}…", js_slice(h, 16))
}

const JS_WS: [char; 25] = [
    '\u{9}', '\u{A}', '\u{B}', '\u{C}', '\u{D}', '\u{20}', '\u{A0}', '\u{1680}', '\u{2000}', '\u{2001}', '\u{2002}', '\u{2003}', '\u{2004}',
    '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}', '\u{2009}', '\u{200A}', '\u{2028}', '\u{2029}', '\u{202F}', '\u{205F}', '\u{3000}', '\u{FEFF}',
];

pub fn is_js_ws(c: char) -> bool {
    JS_WS.contains(&c)
}

/// String.prototype.trim.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_ws)
}

/// Buffer.byteLength(s, 'utf8').
pub fn byte_length(s: &str) -> usize {
    s.len()
}

/// The sha256 hex of a text's UTF-8 bytes.
pub fn sha256_hex(b: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let d = Sha256::digest(b);
    hex(&d)
}

pub fn sha256_text(s: &str) -> String {
    sha256_hex(s.as_bytes())
}

pub fn hash_of(v: &Value) -> String {
    sha256_text(&canonicalize(v))
}

pub fn hex(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}

pub fn unhex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

/// 64 lowercase hex characters.
pub fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// [A-Za-z_$][A-Za-z0-9_$]*
pub fn is_ident(s: &JStr) -> bool {
    let u = &s.0;
    let first = |c: u16| c < 128 && ((c as u8).is_ascii_alphabetic() || c == b'_' as u16 || c == b'$' as u16);
    let rest = |c: u16| c < 128 && ((c as u8).is_ascii_alphanumeric() || c == b'_' as u16 || c == b'$' as u16);
    !u.is_empty() && first(u[0]) && u[1..].iter().all(|c| rest(*c))
}
