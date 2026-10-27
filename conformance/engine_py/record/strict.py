# The engine's strict JSON reader and the JavaScript semantics the record readers need. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
Shared by the readers beside this file (ledger.py, frag.py). Written from packages/verify/src/protocol/hash-input.ts:

- parse_json_strict(text, name): parseJsonStrict, in its order and its words: a byte-order mark, nesting past 256 levels, text
  JSON.parse would not read, a key written twice in one object (with its JSON path), a number past the double range, a number
  whose text does not read back as written. The refusals (HashInputRefused) carry the engine's sentences byte for byte; text
  that is not JSON at all says "not valid JSON" with this reader's own reason, which is Python's, not V8's.
- json_parse(text): what JSON.parse returns: every number a float, a repeated key kept at its first place with its last value.
- decode_utf8_strict(bytes, name), invalid_utf8_offset(bytes): the engine's UTF-8 rule and its words.

Canonical JSON and sha256 are imported unchanged from conformance/riposte_bind.py; JSON.stringify(v, null, 2), String(v) and
the UTF-16 helpers from conformance/engine_py/engine.py. Nothing here forks them.
"""

import json
import math
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.dirname(HERE)
CONFORMANCE_DIR = os.path.dirname(ENGINE_DIR)
for _p in (ENGINE_DIR, CONFORMANCE_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import riposte_bind as rb  # noqa: E402  (canonical JSON, sha256, numbers and strings as JavaScript writes them)
import engine as E  # noqa: E402  (JSON.stringify(v, null, 2), String(v), Object.keys order, UTF-16 lengths)

canonicalize = rb.canonical_json
sha256_text = rb.sha256_hex
js_string = rb.js_string
js_number = rb.js_number
pretty = E.pretty
js_keys = E.js_keys
utf16_len = E.utf16_len
js_slice = E.js_slice

MAX_JSON_DEPTH = 256
BOM = chr(0xFEFF)
INEXACT_NUMBER_WORDS = "a number that cannot be represented exactly; write amounts as strings with two decimals"


class _Undefined(object):
    """JavaScript's undefined: a key an object does not carry."""

    def __repr__(self):
        return "undefined"


UNDEFINED = _Undefined()


class HashInputRefused(Exception):
    """An input the hash contract cannot bind faithfully (hash-input.ts HashInputRefused); `where` names the place."""

    def __init__(self, message, where):
        Exception.__init__(self, message)
        self.message = message
        self.where = where


class NotJson(Exception):
    """Text JSON.parse would not read (parseJsonStrict throws a plain Error for it)."""

    def __init__(self, message):
        Exception.__init__(self, message)
        self.message = message


# ---------------------------------------------------------------------------------------------------------------------
# JavaScript values


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def js_str(v):
    """String(v) (a template literal's ${v}) for any value json_parse returns, and UNDEFINED."""
    if v is UNDEFINED:
        return "undefined"
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if is_num(v):
        x = float(v)
        if math.isnan(x):
            return "NaN"
        if math.isinf(x):
            return "Infinity" if x > 0 else "-Infinity"
        return js_number(x)
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ",".join("" if (x is None or x is UNDEFINED) else js_str(x) for x in v)
    return "[object Object]"


def js_truthy(v):
    if v is UNDEFINED or v is None or v is False:
        return False
    if is_num(v):
        return float(v) != 0 and not math.isnan(float(v))
    if isinstance(v, str):
        return v != ""
    return True


def js_number_of(v):
    """Number(v) for the values json_parse returns."""
    if v is UNDEFINED:
        return math.nan
    if v is None or v is False:
        return 0.0
    if v is True:
        return 1.0
    if is_num(v):
        return float(v)
    if isinstance(v, str):
        t = js_trim(v)
        if t == "":
            return 0.0
        if re.fullmatch(r"[+-]?Infinity", t):
            return -math.inf if t.startswith("-") else math.inf
        if re.fullmatch(r"0[xX][0-9a-fA-F]+", t):
            return float(int(t[2:], 16))
        if re.fullmatch(r"0[oO][0-7]+", t):
            return float(int(t[2:], 8))
        if re.fullmatch(r"0[bB][01]+", t):
            return float(int(t[2:], 2))
        if re.fullmatch(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", t):
            return float(t)
        return math.nan
    if isinstance(v, list):
        if not v:
            return 0.0
        if len(v) == 1:
            return js_number_of(js_str(v[0]) if v[0] is not None else "")
        return math.nan
    return math.nan


def defined(v):
    """A copy without JavaScript's undefined: keys holding it dropped, array slots holding it written as null."""
    if isinstance(v, dict):
        return {k: defined(x) for k, x in v.items() if x is not UNDEFINED}
    if isinstance(v, list):
        return [None if x is UNDEFINED else defined(x) for x in v]
    return v


def to_json(v):
    """JSON.stringify(v, null, 2): engine.py's pretty, after undefined is dropped as JSON.stringify drops it."""
    return E.pretty(defined(v))


def js_eq(a, b):
    """a === b for JSON values (numbers compared as doubles; an object or an array is never === another value)."""
    if is_num(a) and is_num(b):
        return float(a) == float(b)
    if isinstance(a, (dict, list)) or isinstance(b, (dict, list)):
        return a is b
    if type(a) is not type(b):
        return False
    return a == b


def is_obj(x):
    return isinstance(x, dict)


def get(o, k):
    """o[k] for a parsed value: UNDEFINED when o is not an object or lacks k (o must not be null: callers check, as JS throws)."""
    if isinstance(o, dict):
        return o.get(k, UNDEFINED)
    if isinstance(o, list) and k == "length":
        return float(len(o))
    if isinstance(o, str) and k == "length":
        return float(utf16_len(o))
    return UNDEFINED


def is_safe_integer(x):
    return is_num(x) and math.isfinite(x) and float(x) == math.floor(x) and abs(x) <= 9007199254740991


_JS_WS = set(chr(c) for c in (0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
                              0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF))


def js_trim(s):
    """String.prototype.trim: WhiteSpace and LineTerminator characters at both ends."""
    i, j = 0, len(s)
    while i < j and s[i] in _JS_WS:
        i += 1
    while j > i and s[j - 1] in _JS_WS:
        j -= 1
    return s[i:j]


def byte_length(s):
    """Buffer.byteLength(s, 'utf8')."""
    return len(s.encode("utf-8", "surrogatepass"))


def stringify(v):
    """JSON.stringify(v) compact, keys in Object.keys order (JSON.stringify of a string is js_string)."""
    if v is UNDEFINED:
        return "undefined"
    if isinstance(v, dict):
        return "{" + ",".join(js_string(k) + ":" + stringify(v[k]) for k in js_keys(v) if v[k] is not UNDEFINED) + "}"
    if isinstance(v, list):
        return "[" + ",".join("null" if x is UNDEFINED else stringify(x) for x in v) + "]"
    return canonicalize(v)


def ellipsis16(h):
    """`${h.slice(0, 16)}…` for a value JavaScript would slice (a string; String(h) otherwise)."""
    return js_slice(h if isinstance(h, str) else js_str(h), 16) + "…"


# ---------------------------------------------------------------------------------------------------------------------
# UTF-8 (hash-input.ts invalidUtf8Offset, decodeUtf8Strict)


def invalid_utf8_offset(b):
    n = len(b)
    i = 0
    while i < n:
        c = b[i]
        if c < 0x80:
            i += 1
            continue
        if 0xC2 <= c <= 0xDF:
            need, lo, hi = 1, 0x80, 0xBF
        elif c == 0xE0:
            need, lo, hi = 2, 0xA0, 0xBF
        elif c == 0xED:
            need, lo, hi = 2, 0x80, 0x9F
        elif 0xE1 <= c <= 0xEF:
            need, lo, hi = 2, 0x80, 0xBF
        elif c == 0xF0:
            need, lo, hi = 3, 0x90, 0xBF
        elif c == 0xF4:
            need, lo, hi = 3, 0x80, 0x8F
        elif 0xF1 <= c <= 0xF3:
            need, lo, hi = 3, 0x80, 0xBF
        else:
            return i
        if i + need >= n:
            return i
        second = b[i + 1]
        if second < lo or second > hi:
            return i
        for k in range(2, need + 1):
            x = b[i + k]
            if x < 0x80 or x > 0xBF:
                return i
        i += need + 1
    return -1


def decode_utf8_strict(b, name):
    """decodeUtf8Strict: the text of valid UTF-8 (a byte-order mark kept as U+FEFF), or HashInputRefused naming the offset."""
    at = invalid_utf8_offset(b)
    if at >= 0:
        shown = " ".join("%02X" % x for x in b[at:min(at + 4, len(b))])
        raise HashInputRefused(
            "%s is not valid UTF-8: the bytes at offset %d (%s) are not a UTF-8 character. A text input is hashed as UTF-8, and decoding "
            "would replace those bytes with U+FFFD, so two different files would share one input_hash. Re-save the file as UTF-8 (or fix "
            "the byte), then run it again" % (name, at, shown), "byte %d" % at)
    return b.decode("utf-8")


# ---------------------------------------------------------------------------------------------------------------------
# JSON.parse


def _const(text):
    raise ValueError("%s is not a JSON value" % text)


def _pairs(pairs):
    out = {}
    for k, v in pairs:
        out[k] = v  # a repeated key keeps its first place and takes the last value, as JSON.parse does
    return out


def json_parse(text):
    """JSON.parse(text): numbers as floats (1e999 reads as inf, as JavaScript reads Infinity). ValueError when not JSON."""
    try:
        return json.loads(text, object_pairs_hook=_pairs, parse_int=float, parse_float=float, parse_constant=_const)
    except RecursionError:
        raise ValueError("nested deeper than this reader's Python stack allows")


# ---------------------------------------------------------------------------------------------------------------------
# The scanners (hash-input.ts scanJsonText, numberTextIsExact, tooDeepOffset)

_IDENT = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
_NUMBER_TOKEN = re.compile(r"(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?")


def path_step(path, key):
    if isinstance(key, int):
        return "%s[%d]" % (path, key)
    return "%s.%s" % (path, key) if _IDENT.fullmatch(key) else "%s[%s]" % (path, js_string(key))


def _reduced_decimal(text):
    m = _NUMBER_TOKEN.fullmatch(text)
    if not m:
        return None
    frac = m.group(3) or ""
    digits = (m.group(2) + frac).lstrip("0")
    if digits == "":
        return "zero"
    exp = (int(m.group(4)) if m.group(4) is not None else 0) - len(frac)
    stripped = digits.rstrip("0")
    exp += len(digits) - len(stripped)
    return (m.group(1) == "-", stripped, exp)


def _number(text):
    try:
        return float(text)
    except (OverflowError, ValueError):
        return math.inf


def number_text_is_exact(text):
    a = _reduced_decimal(text)
    if a is None:
        return True
    x = _number(text)
    if not math.isfinite(x):
        return True
    b = _reduced_decimal(js_number(x))
    if a == "zero" or b == "zero":
        return a == b
    return b is not None and a == b


def too_deep_offset(text, limit=MAX_JSON_DEPTH):
    """The offset, in UTF-16 code units as JavaScript counts them, where nesting passes `limit`, or -1."""
    depth = 0
    in_string = False
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if in_string:
            if c == "\\":
                i += 1
            elif c == '"':
                in_string = False
        elif c == '"':
            in_string = True
        elif c in "{[":
            depth += 1
            if depth > limit:
                return utf16_len(text[:i])
        elif c in "}]":
            depth -= 1
        i += 1
    return -1


def scan_json_text(text, mode):
    """One pass: 'duplicate' gives (path, key) of the first key repeated in one object; 'inexact' gives (path, token) of the
    first number that does not read back as written; None otherwise, or at the first thing the scan cannot read."""
    n = len(text)
    st = {"i": 0}
    stack = []  # frames: [obj, seg, keys, key, count]

    def ws():
        i = st["i"]
        while i < n and text[i] in " \n\r\t":
            i += 1
        st["i"] = i

    def string_end():
        i = st["i"]
        j = i + 1
        while True:
            qq = text.find('"', j)
            if qq < 0:
                return -1
            b, slashes = qq - 1, 0
            while b > i and text[b] == "\\":
                slashes += 1
                b -= 1
            if slashes % 2 == 0:
                return qq
            j = qq + 1

    def path_to(key):
        pth = "$"
        for k in range(1, len(stack)):
            pth = path_step(pth, stack[k][1])
        return path_step(pth, key)

    state = "value"
    while True:
        if state == "value":
            ws()
            i = st["i"]
            c = text[i] if i < n else ""
            if c in ("{", "["):
                top = stack[-1] if stack else None
                seg = None if top is None else (top[3] if top[0] else top[4])
                st["i"] = i + 1
                ws()
                i = st["i"]
                if i < n and text[i] == ("}" if c == "{" else "]"):
                    st["i"] = i + 1
                    state = "after"
                    continue
                stack.append([c == "{", seg, set() if (c == "{" and mode == "duplicate") else None, "", 0])
                state = "key" if c == "{" else "value"
                continue
            if c == '"':
                e = string_end()
                if e < 0:
                    return None
                st["i"] = e + 1
                state = "after"
                continue
            if i >= n:
                return None
            start = i
            while i < n and text[i] not in ",]} \n\r\t":
                i += 1
            st["i"] = i
            if mode == "inexact" and (c == "-" or "0" <= c <= "9"):
                token = text[start:i]
                if not number_text_is_exact(token):
                    top = stack[-1] if stack else None
                    return ("$" if top is None else path_to(top[3] if top[0] else top[4]), token)
            state = "after"
            continue
        if state == "key":
            ws()
            i = st["i"]
            if i >= n or text[i] != '"':
                return None
            e = string_end()
            if e < 0:
                return None
            raw = text[i + 1:e]
            if "\\" in raw:
                try:
                    key = json.loads(text[i:e + 1])
                except ValueError:
                    return None
            else:
                key = raw
            st["i"] = e + 1
            top = stack[-1]
            if mode == "duplicate":
                if key in top[2]:
                    return (path_to(key), key)
                top[2].add(key)
            top[3] = key
            ws()
            i = st["i"]
            if i >= n or text[i] != ":":
                return None
            st["i"] = i + 1
            state = "value"
            continue
        ws()
        top = stack[-1] if stack else None
        if top is None:
            return None
        i = st["i"]
        c = text[i] if i < n else ""
        if c == ",":
            st["i"] = i + 1
            if top[0]:
                state = "key"
            else:
                top[4] += 1
                state = "value"
            continue
        if (c == "}" and top[0]) or (c == "]" and not top[0]):
            st["i"] = i + 1
            stack.pop()
            continue
        return None


def duplicate_key_path(text):
    return scan_json_text(text, "duplicate")


def inexact_number_path(text):
    return scan_json_text(text, "inexact")


def non_finite_path(value, root="$"):
    """The JSON path of the first number that is not finite, walking objects in Object.keys order."""
    def walk(v, pth):
        if is_num(v):
            return pth if not math.isfinite(v) else None
        if isinstance(v, list):
            for i, x in enumerate(v):
                hit = walk(x, path_step(pth, i))
                if hit is not None:
                    return hit
            return None
        if isinstance(v, dict):
            for k in js_keys(v):
                hit = walk(v[k], path_step(pth, k))
                if hit is not None:
                    return hit
        return None
    return walk(value, root)


def _value_at(value, pth):
    steps = re.findall(r'\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]', pth[1:])
    cur = value
    for name, idx, quoted in steps:
        key = name or (int(idx) if idx else json.loads(quoted))
        if isinstance(cur, dict) and isinstance(key, str):
            cur = cur.get(key)
        elif isinstance(cur, list) and isinstance(key, int):
            cur = cur[key] if key < len(cur) else None
        else:
            return None
    return cur


def _short_token(t):
    return "%s…(%d characters)" % (js_slice(t, 32), utf16_len(t)) if utf16_len(t) > 40 else t


def parse_json_strict(text, name):
    """parseJsonStrict(text, name): the value, or HashInputRefused (the engine's words), or NotJson."""
    if text.startswith(BOM):
        raise HashInputRefused("%s: file starts with a UTF-8 byte-order mark; remove it (save the file as UTF-8 without BOM)" % name, "byte 0")
    deep = too_deep_offset(text)
    if deep >= 0:
        raise HashInputRefused(
            "%s: nesting too deep, limit %d: an object or array opens more than %d levels down (at character %d). No document, verdict "
            "or ruleset this engine reads nests that deep. Flatten it, then run it again" % (name, MAX_JSON_DEPTH, MAX_JSON_DEPTH, deep),
            "character %d" % deep)
    try:
        x = json_parse(text)
    except ValueError as e:
        raise NotJson("%s: not valid JSON: %s" % (name, e))
    dup = duplicate_key_path(text)
    if dup is not None:
        raise HashInputRefused(
            "%s: the key %s appears twice in one object (at %s). JSON keeps only the last of them, so a reader that keeps the first "
            "would see a different document than the one hashed and signature-checked here. Keep one of them, then run it again"
            % (name, js_string(dup[1]), dup[0]), dup[0])
    nf = non_finite_path(x)
    if nf is not None:
        v = _value_at(x, nf)
        shown = " (%s)" % ("Infinity" if v > 0 else "-Infinity") if is_num(v) else ""
        raise HashInputRefused(
            "%s: the number at %s is not finite%s: JSON reads a number past the double range (1e999) as Infinity, and the hash writes "
            "every non-finite number as null, so it could not be told from null or from its negative. Write it as a finite number, or "
            "as a string the ruleset reads, then run it again" % (name, nf, shown), nf)
    inexact = inexact_number_path(text)
    if inexact is not None:
        reads = js_number(_number(inexact[1]))
        raise HashInputRefused(
            "%s: the number at %s (%s) is %s. JSON numbers are read as doubles, and this one reads as %s, so the hash and every check "
            "would see %s, not what was written. Then run it again" % (name, inexact[0], _short_token(inexact[1]), INEXACT_NUMBER_WORDS,
                                                                    reads, reads), inexact[0])
    return x


# ---------------------------------------------------------------------------------------------------------------------
# Files as Node reports a failed read


def read_bytes(path):
    """The file's bytes, or an OSError whose message is Node's for the common cases (readFileSync's words; on Windows Node names
    the absolute path, elsewhere the path as given)."""
    shown = os.path.abspath(path) if os.name == "nt" else path
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except FileNotFoundError:
        raise OSError("ENOENT: no such file or directory, open '%s'" % shown)
    except IsADirectoryError:
        raise OSError("EISDIR: illegal operation on a directory, read")
    except PermissionError:
        if os.path.isdir(path):
            raise OSError("EISDIR: illegal operation on a directory, read")
        raise OSError("EACCES: permission denied, open '%s'" % shown)


def node_error(e):
    return e.args[0] if e.args else str(e)


def utf8_streams():
    """Write UTF-8 whatever the console's encoding is (cp1252 on Windows), as riposte_bind.py does."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")
