# The replay contract in Python: `python cli.py replay <file | folder | cases.jsonl>`. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
A second implementation of `node packages/verify/dist/cli.js replay`, in Python with the standard library only, for the
inputs this folder can re-perform: verdicts of the built-in invoice ruleset (invoice@0.1.0, through engine.py), bundles and
signed envelopes. It follows the replay contract in packages/verify/docs/REPLAY.md in the engine's own order (the refusals
before hashing, the keys a bundle or an envelope does not define, an annotation member outside its declared shape, the
signature and the trusted key, the binding, the outcome, the remedies, --strict), and prints the engine's first line and
exit code for each answer it gives. What it does not re-perform it says so (exit 2, "structure verified; outcome NOT
re-performed"), never guessed.

    python3 conformance/engine_py/cli.py replay <bundle.json | verdict.json | envelope.json | cases.jsonl | folder>
        [--strict] [--trusted-key <public.pem | keygen.json | 64-hex fingerprint | inline PEM>] [--lenient-remedies]
        [--allow-unknown-keys]

Exit codes (the replay scale, REPLAY.md "Exit codes"): 0 VERIFIED · 1 FAILED · 2 structure verified, outcome not
re-performed · 3 refused, unreadable, or a usage error. The JSON goes to stdout; the lines a person reads go to stderr, the
first of them the replay's answer, worded as the engine words it.

A signed envelope's signature is checked with an Ed25519 verifier written beside this folder (engine_py/record) when one is
there; without one the signature is not checked, and the replay says "can't tell here" instead of an answer it cannot give.
"""

import base64
import hashlib
import json
import math
import os
import re
import struct
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import engine as E  # noqa: E402  (the invoice engine and its replay helpers, imported unchanged)
import riposte_bind as rb  # noqa: E402  (canonical JSON, sha256 and the identity chain, imported unchanged)

PREFIX = "verify replay: "
ENGINE_VERSION = E.ENGINES[-1]
STRUCTURE_ONLY_NOTE = "structure verified; outcome NOT re-performed"


class Refused(Exception):
    """An input the hash contract refuses before anything is hashed, or a value a flag cannot use (exit 3)."""


# ---------------------------------------------------------------------------------------------------------------------
# Reading under the hash contract (packages/verify/src/protocol/hash-input.ts), with the engine's words

def _path_step(path, key):
    if isinstance(key, int):
        return "%s[%d]" % (path, key)
    return "%s.%s" % (path, key) if re.match(r"^[A-Za-z_$][A-Za-z0-9_$]*\Z", key) else "%s[%s]" % (path, rb.js_string(key))


def decode_utf8_strict(data, name):
    """decodeUtf8Strict: the bytes as UTF-8, or the refusal naming the offset of the first byte that is not UTF-8."""
    try:
        return data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as e:
        shown = " ".join("%02X" % b for b in data[e.start:e.start + 4])
        raise Refused(
            "%s is not valid UTF-8: the bytes at offset %d (%s) are not a UTF-8 character. A text input is hashed as UTF-8, and "
            "decoding would replace those bytes with U+FFFD, so two different files would share one input_hash. Re-save the file "
            "as UTF-8 (or fix the byte), then run it again" % (name, e.start, shown))


def _utf16_units(text):
    b = text.encode("utf-16-le", "surrogatepass")
    return list(struct.unpack("<%dH" % (len(b) // 2), b))


def _from_units(units):
    return struct.pack("<%dH" % len(units), *units).decode("utf-16-le", "surrogatepass")


def too_deep_offset(text, limit=256):
    """tooDeepOffset: the UTF-16 offset at which an object or array opens more than `limit` levels down, or -1."""
    depth, in_string, skip, at = 0, False, False, 0
    for ch in text:
        width = 2 if ord(ch) > 0xFFFF else 1
        if skip:
            skip = False
        elif in_string:
            if ch == "\\":
                skip = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch in "{[":
            depth += 1
            if depth > limit:
                return at
        elif ch in "}]":
            depth -= 1
        at += width
    return -1


# V8's JSON.parse, for its error words only (v8/src/json/json-parser.cc: ParseJsonValue, ParseJsonNumber, ScanJsonString,
# ScanLiteral, ReportUnexpectedToken, CalculateFileLocation), as Node 22 and later word them. Positions are UTF-16 offsets.

class _V8Fail(Exception):
    def __init__(self, pos, template=None, token=None):
        Exception.__init__(self)
        self.pos, self.template, self.token = pos, template, token


_T_PROP = "Expected property name or '}'"
_T_COMMA_RBRACK = "Expected ',' or ']' after array element"
_T_COMMA_RBRACE = "Expected ',' or '}' after property value"
_T_UNTERMINATED = "Unterminated string"
_T_COLON = "Expected ':' after property name"
_T_DQ_PROP = "Expected double-quoted property name"
_T_EXPONENT = "Exponent part is missing a number"
_T_FRACTION = "Unterminated fractional number"
_T_MINUS = "No number after minus sign"
_T_CONTROL = "Bad control character in string literal"
_T_UNICODE = "Bad Unicode escape"
_T_ESCAPE = "Bad escaped character"
_T_TRAILING = "Unexpected non-whitespace character after JSON"
_JSON_WS = (0x20, 0x09, 0x0A, 0x0D)


def _json_token(c):
    if c is None or c < 0:
        return "EOS"
    if c == 0x22:
        return "STRING"
    if 0x30 <= c <= 0x39 or c == 0x2D:
        return "NUMBER"
    return {0x74: "TRUE", 0x66: "FALSE", 0x6E: "NULL", 0x20: "WS", 0x09: "WS", 0x0A: "WS", 0x0D: "WS", 0x3A: "COLON",
            0x2C: "COMMA", 0x5B: "LBRACK", 0x5D: "RBRACK", 0x7B: "LBRACE", 0x7D: "RBRACE"}.get(c, "ILLEGAL")


def _file_location(cu, pos):
    line, last_break, i = 1, 0, 0
    while i < pos:
        if cu[i] == 0x0D and i < pos - 1 and cu[i + 1] == 0x0A:
            i += 1
        if cu[i] in (0x0D, 0x0A):
            line += 1
            last_break = i + 1
        i += 1
    return line, 1 + i - last_break


def _v8_message(cu, f):
    n = len(cu)
    if f.template is not None or f.token in ("NUMBER", "STRING"):
        line, col = _file_location(cu, f.pos)
        what = f.template if f.template is not None else ("Unexpected number" if f.token == "NUMBER" else "Unexpected string")
        where = "at position" if f.template == _T_TRAILING else "in JSON at position"  # "…after JSON at position N"
        return "%s %s %d (line %d column %d)" % (what, where, f.pos, line, col)
    if f.token == "EOS":
        return "Unexpected end of JSON input"
    src = _from_units(cu)
    if src in ("[object Object]", "undefined", "Infinity", "NaN"):
        return '"%s" is not valid JSON' % src
    ch = _from_units(cu[f.pos:f.pos + 1])
    if n < 21:
        return "Unexpected token '%s', \"%s\" is not valid JSON" % (ch, src)
    if f.pos < 10:
        return "Unexpected token '%s', \"%s\"... is not valid JSON" % (ch, _from_units(cu[:f.pos + 10]))
    if f.pos < n - 10:
        return "Unexpected token '%s', ...\"%s\"... is not valid JSON" % (ch, _from_units(cu[f.pos - 10:f.pos + 10]))
    return "Unexpected token '%s', ...\"%s\" is not valid JSON" % (ch, _from_units(cu[f.pos - 10:]))


def v8_json_error(text):
    """None when JSON.parse(text) accepts it, else the message V8 throws."""
    cu = _utf16_units(text)
    n = len(cu)
    st = {"p": 0}

    def peek():
        return cu[st["p"]] if st["p"] < n else None

    def skip_ws():
        while st["p"] < n and cu[st["p"]] in _JSON_WS:
            st["p"] += 1

    def fail_char(c):
        raise _V8Fail(st["p"], token=_json_token(c))

    def check(ch):
        skip_ws()
        if peek() == ch:
            st["p"] += 1
            return True
        return False

    def expect(ch, template):
        if peek() == ch:
            st["p"] += 1
        else:
            raise _V8Fail(st["p"], template=template)

    def expect_next(ch, template):
        skip_ws()
        expect(ch, template)

    def scan_string():  # the cursor is past the opening quote
        while True:
            while st["p"] < n and cu[st["p"]] != 0x22 and cu[st["p"]] != 0x5C and cu[st["p"]] >= 0x20:
                st["p"] += 1
            if st["p"] >= n:
                raise _V8Fail(st["p"], template=_T_UNTERMINATED)
            c = cu[st["p"]]
            if c == 0x22:
                st["p"] += 1
                return
            if c == 0x5C:
                st["p"] += 1
                e = cu[st["p"]] if st["p"] < n else -1
                if not 0 <= e <= 0xFF:
                    fail_char(e)
                if e == 0x75:  # \uXXXX
                    for _ in range(4):
                        st["p"] += 1
                        h = cu[st["p"]] if st["p"] < n else -1
                        if not (0x30 <= h <= 0x39 or 0x41 <= h <= 0x46 or 0x61 <= h <= 0x66):
                            raise _V8Fail(st["p"], template=_T_UNICODE)
                elif e not in (0x22, 0x5C, 0x2F, 0x62, 0x66, 0x6E, 0x72, 0x74):
                    raise _V8Fail(st["p"], template=_T_ESCAPE)
                st["p"] += 1
                continue
            raise _V8Fail(st["p"], template=_T_CONTROL)

    def is_digit(c):
        return c is not None and 0x30 <= c <= 0x39

    def is_number_part(c):
        return c is not None and (is_digit(c) or c in (0x2E, 0x65, 0x45, 0x2B, 0x2D))

    def scan_number():
        sign = 1
        c = peek()
        if c == 0x2D:
            sign = -1
            st["p"] += 1
            c = peek()
        if c == 0x30:
            st["p"] += 1
            c = peek()
            if is_number_part(c):
                if is_digit(c):
                    raise _V8Fail(st["p"], token="NUMBER")
            elif sign > 0:
                return
        else:
            start = st["p"]
            while st["p"] < n and is_digit(cu[st["p"]]):
                st["p"] += 1
            if start == st["p"]:
                raise _V8Fail(st["p"], template=_T_MINUS)
            if not is_number_part(peek()):
                return
        if peek() == 0x2E:
            st["p"] += 1
            if not is_digit(peek()):
                raise _V8Fail(st["p"], template=_T_FRACTION)
            while is_digit(peek()):
                st["p"] += 1
        if peek() in (0x65, 0x45):
            st["p"] += 1
            if peek() in (0x2B, 0x2D):
                st["p"] += 1
            if not is_digit(peek()):
                raise _V8Fail(st["p"], template=_T_EXPONENT)
            while is_digit(peek()):
                st["p"] += 1

    def scan_literal(word):
        units = [ord(ch) for ch in word]
        remaining = n - st["p"]
        if remaining >= len(units) and cu[st["p"]:st["p"] + len(units)] == units:
            st["p"] += len(units)
            return
        st["p"] += 1
        for i in range(min(len(units) - 1, remaining - 1)):
            if units[1 + i] != cu[st["p"]]:
                fail_char(cu[st["p"]])
            st["p"] += 1
        raise _V8Fail(st["p"], token="EOS")

    def value():
        skip_ws()
        t = _json_token(peek())
        if t == "STRING":
            st["p"] += 1
            scan_string()
        elif t == "NUMBER":
            scan_number()
        elif t == "LBRACE":
            st["p"] += 1
            if check(0x7D):
                return
            expect_next(0x22, _T_PROP)
            scan_string()
            expect_next(0x3A, _T_COLON)
            while True:
                value()
                if check(0x2C):
                    expect_next(0x22, _T_DQ_PROP)
                    scan_string()
                    expect_next(0x3A, _T_COLON)
                    continue
                expect(0x7D, _T_COMMA_RBRACE)
                return
        elif t == "LBRACK":
            st["p"] += 1
            if check(0x5D):
                return
            while True:
                value()
                if check(0x2C):
                    continue
                expect(0x5D, _T_COMMA_RBRACK)
                return
        elif t in ("TRUE", "FALSE", "NULL"):
            scan_literal({"TRUE": "true", "FALSE": "false", "NULL": "null"}[t])
        else:
            raise _V8Fail(st["p"], token=t)

    try:
        value()
        skip_ws()
        if st["p"] < n:
            raise _V8Fail(st["p"], template=_T_TRAILING)
    except _V8Fail as f:
        return _v8_message(cu, f)
    return None


def _reduced_decimal(text):
    m = re.match(r"^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?\Z", text)
    if not m:
        return None
    frac = m.group(3) or ""
    digits = (m.group(2) + frac).lstrip("0")
    if digits == "":
        return "zero"
    exp = (int(m.group(4)) if m.group(4) is not None else 0) - len(frac)
    stripped = digits.rstrip("0")
    return (m.group(1) == "-", stripped, exp + len(digits) - len(stripped))


def _js_number_of(text):
    try:
        return float(text)
    except (OverflowError, ValueError):
        return math.inf


def number_text_is_exact(text):
    """numberTextIsExact: the decimal the text names is the decimal of the double it reads as (any zero is any zero)."""
    a = _reduced_decimal(text)
    if a is None:
        return True
    x = _js_number_of(text)
    if not math.isfinite(x):
        return True
    b = _reduced_decimal(rb.js_number(x))
    if a == "zero" or b == "zero":
        return a == b
    return b is not None and a == b


def scan_json_text(text, mode):
    """scanJsonText: 'duplicate' gives (path, key) of the first key repeated in one object; 'inexact' (path, token) of the
    first number whose text does not read back as written. None when there is none, or at the first thing it cannot read."""
    n = len(text)
    st = {"i": 0}
    stack = []

    def ws():
        while st["i"] < n and text[st["i"]] in " \n\r\t":
            st["i"] += 1

    def string_end():
        j = st["i"] + 1
        while True:
            q = text.find('"', j)
            if q < 0:
                return -1
            b, slashes = q - 1, 0
            while b > st["i"] and text[b] == "\\":
                slashes += 1
                b -= 1
            if slashes % 2 == 0:
                return q
            j = q + 1

    def path_to(key):
        p = "$"
        for fr in stack[1:]:
            p = _path_step(p, fr["seg"])
        return _path_step(p, key)

    state = "value"
    while True:
        if state == "value":
            ws()
            c = text[st["i"]] if st["i"] < n else ""
            if c in ("{", "["):
                top = stack[-1] if stack else None
                seg = None if top is None else (top["key"] if top["obj"] else top["count"])
                st["i"] += 1
                ws()
                if st["i"] < n and text[st["i"]] == ("}" if c == "{" else "]"):
                    st["i"] += 1
                    state = "after"
                    continue
                stack.append({"obj": c == "{", "seg": seg, "keys": set() if c == "{" and mode == "duplicate" else None, "key": "", "count": 0})
                state = "key" if c == "{" else "value"
                continue
            if c == '"':
                e = string_end()
                if e < 0:
                    return None
                st["i"] = e + 1
                state = "after"
                continue
            if st["i"] >= n:
                return None
            start = st["i"]
            while st["i"] < n and text[st["i"]] not in ",]} \n\r\t":
                st["i"] += 1
            if mode == "inexact" and (c == "-" or "0" <= c <= "9"):
                token = text[start:st["i"]]
                if not number_text_is_exact(token):
                    top = stack[-1] if stack else None
                    return ("$" if top is None else path_to(top["key"] if top["obj"] else top["count"])), token
            state = "after"
            continue
        if state == "key":
            ws()
            if st["i"] >= n or text[st["i"]] != '"':
                return None
            e = string_end()
            if e < 0:
                return None
            raw = text[st["i"] + 1:e]
            if "\\" in raw:
                try:
                    key = json.loads(text[st["i"]:e + 1])
                except ValueError:
                    return None
            else:
                key = raw
            st["i"] = e + 1
            top = stack[-1]
            if mode == "duplicate":
                if key in top["keys"]:
                    return path_to(key), key
                top["keys"].add(key)
            top["key"] = key
            ws()
            if st["i"] >= n or text[st["i"]] != ":":
                return None
            st["i"] += 1
            state = "value"
            continue
        ws()
        top = stack[-1] if stack else None
        if top is None:
            return None
        c = text[st["i"]] if st["i"] < n else ""
        if c == ",":
            st["i"] += 1
            if top["obj"]:
                state = "key"
            else:
                top["count"] += 1
                state = "value"
            continue
        if (c == "}" and top["obj"]) or (c == "]" and not top["obj"]):
            st["i"] += 1
            stack.pop()
            continue
        return None


def non_finite_path(v, path="$"):
    """nonFinitePath: the path of the first number that is not finite, in Object.keys order."""
    if isinstance(v, float):
        return path if not math.isfinite(v) else None
    if isinstance(v, list):
        for i, x in enumerate(v):
            p = non_finite_path(x, _path_step(path, i))
            if p:
                return p
    elif isinstance(v, dict):
        for k in E.js_keys(v):
            p = non_finite_path(v[k], _path_step(path, k))
            if p:
                return p
    return None


def _value_at(v, path):
    for m in re.finditer(r'\.([A-Za-z_$][A-Za-z0-9_$]*)|\[([0-9]+)\]|\[("(?:[^"\\]|\\.)*")\]', path[1:]):
        key = m.group(1) if m.group(1) is not None else (int(m.group(2)) if m.group(2) is not None else json.loads(m.group(3)))
        if isinstance(key, int):
            v = v[key] if isinstance(v, list) and key < len(v) else (v.get(str(key)) if isinstance(v, dict) else None)
        else:
            v = v.get(key) if isinstance(v, dict) else None
    return v


INEXACT_NUMBER_WORDS = "a number that cannot be represented exactly; write amounts as strings with two decimals"
REPLAY_INEXACT_WORDS = ("a number that cannot be represented exactly; re-issue the verdict with the amount as a string; a replay "
                        "of the existing verdict cannot change its input")


def replay_advice(message):
    """replayAdvice: the inexact-number advice in the words true of a replay; any other message unchanged."""
    if INEXACT_NUMBER_WORDS not in message:
        return message
    return re.sub(r"\. Then run it again\Z", "", message.replace(INEXACT_NUMBER_WORDS, REPLAY_INEXACT_WORDS, 1))


def _no_constant(c):
    raise ValueError("%s is not JSON" % c)


def _parse_value(text):
    """JSON.parse on text V8 accepts: every number a double, the last of a repeated key kept (refused right after)."""
    return json.loads(text, parse_float=_js_number_of, parse_int=_js_number_of, parse_constant=_no_constant)


def _refuse_parsed(name, text, x, with_value=True):
    hit = scan_json_text(text, "duplicate")
    if hit is not None:
        raise Refused("%s: the key %s appears twice in one object (at %s). JSON keeps only the last of them, so a reader that keeps "
                      "the first would see a different document than the one hashed and signature-checked here. Keep one of them, "
                      "then run it again" % (name, rb.js_string(hit[1]), hit[0]))
    p = non_finite_path(x)
    if p is not None:
        val = _value_at(x, p)
        shown = " (%s)" % ("Infinity" if val > 0 else "-Infinity" if val < 0 else "NaN") if with_value and isinstance(val, float) else ""
        raise Refused("%s: the number at %s is not finite%s: JSON reads a number past the double range (1e999) as Infinity, and the "
                      "hash writes every non-finite number as null, so it could not be told from null or from its negative. Write it "
                      "as a finite number, or as a string the ruleset reads, then run it again" % (name, p, shown))
    hit = scan_json_text(text, "inexact")
    if hit is not None:
        token = hit[1]
        short = token if len(token) <= 40 else "%s…(%d characters)" % (token[:32], len(token))
        reads = rb.js_number(_js_number_of(token))
        raise Refused("%s: the number at %s (%s) is %s. JSON numbers are read as doubles, and this one reads as %s, so the hash and "
                      "every check would see %s, not what was written. Then run it again" % (name, hit[0], short, INEXACT_NUMBER_WORDS, reads, reads))


def parse_json_strict(text, name):
    """parseJsonStrict: a byte-order mark, nesting past 256, text that is not JSON, a repeated key, a number past the double
    range, a number whose text does not read back as written: each refused in the engine's words."""
    if text.startswith("﻿"):
        raise Refused("%s: file starts with a UTF-8 byte-order mark; remove it (save the file as UTF-8 without BOM)" % name)
    deep = too_deep_offset(text)
    if deep >= 0:
        raise Refused("%s: nesting too deep, limit 256: an object or array opens more than 256 levels down (at character %d). No "
                      "document, verdict or ruleset this engine reads nests that deep. Flatten it, then run it again" % (name, deep))
    err = v8_json_error(text)
    if err is not None:
        raise Refused("%s: not valid JSON: %s" % (name, err))
    x = _parse_value(text)
    _refuse_parsed(name, text, x)
    return x


def _node_open_error(path, e):
    shown = os.path.abspath(path) if os.name == "nt" else path
    if isinstance(e, FileNotFoundError):
        return "ENOENT: no such file or directory, open '%s'" % shown
    if isinstance(e, IsADirectoryError):
        return "EISDIR: illegal operation on a directory, read"
    if isinstance(e, PermissionError):
        return "EACCES: permission denied, open '%s'" % shown
    return "%s, open '%s'" % (e.strerror or str(e), shown)


def read_text(path):
    """readText: a file (or stdin, `-`) decoded as strict UTF-8; a folder is refused."""
    if path != "-" and os.path.isdir(path):
        raise Refused("%s is a folder, not a file" % path)
    try:
        if path == "-":
            data = sys.stdin.buffer.read()
        else:
            with open(path, "rb") as fh:
                data = fh.read()
    except OSError as e:
        raise Refused(_node_open_error(path, e))
    return decode_utf8_strict(data, "stdin" if path == "-" else path)


def read_json(path):
    return parse_json_strict(read_text(path), "stdin" if path == "-" else path)


# ---------------------------------------------------------------------------------------------------------------------
# Keys, the Ed25519 public key, fingerprints and Node's base64 (ledger/registry.ts keyFingerprint, cli.ts readTrustedKeyArg)

_ED25519_SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")
PEM_PUBLIC = re.compile(r"-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----")
NODE_DECODER_UNSUPPORTED = "error:1E08010C:DECODER routines::unsupported"


def ed25519_der(pem):
    """The DER SubjectPublicKeyInfo of an Ed25519 public key in a PEM, or None."""
    if not isinstance(pem, str):
        return None
    m = re.search(r"-----BEGIN PUBLIC KEY-----([\s\S]*?)-----END PUBLIC KEY-----", pem)
    if not m:
        return None
    body = re.sub(r"\s+", "", m.group(1))
    try:
        der = base64.b64decode(body, validate=True)
    except ValueError:
        return None
    if len(der) != 44 or not der.startswith(_ED25519_SPKI_PREFIX):
        return None
    return der


def key_fingerprint(pem):
    der = ed25519_der(pem)
    return None if der is None else hashlib.sha256(der).hexdigest()


def legacy_key_fingerprint(pem):
    der = ed25519_der(pem)
    return None if der is None else hashlib.sha256(base64.b64encode(der)).hexdigest()


_B64 = {c: i for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")}
_B64.update({"-": 62, "_": 63})


def node_base64(s):
    """Buffer.from(s, 'base64'): characters outside the alphabet skipped, decoding stops at the first '='."""
    vals = []
    for ch in s:
        if ch == "=":
            break
        if ch in _B64:
            vals.append(_B64[ch])
    out = bytearray()
    for i in range(0, len(vals) - len(vals) % 4, 4):
        a, b, c, d = vals[i:i + 4]
        n = (a << 18) | (b << 12) | (c << 6) | d
        out += bytes(((n >> 16) & 255, (n >> 8) & 255, n & 255))
    rest = vals[len(vals) - len(vals) % 4:]
    if len(rest) == 2:
        out.append(((rest[0] << 18) | (rest[1] << 12)) >> 16 & 255)
    elif len(rest) == 3:
        n = (rest[0] << 18) | (rest[1] << 12) | (rest[2] << 6)
        out += bytes(((n >> 16) & 255, (n >> 8) & 255))
    return bytes(out)


def _load_beside(folder, name):
    """The module <folder>/<name>.py of this folder, loaded from that file only (never a same-named module elsewhere), or None."""
    path = os.path.join(HERE, folder, name + ".py")
    if not os.path.isfile(path):
        return None
    import importlib.util
    spec = importlib.util.spec_from_file_location("engine_py_%s_%s" % (folder, name), path)
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, os.path.join(HERE, folder))  # its own siblings import by plain name
    try:
        spec.loader.exec_module(mod)
    except Exception:  # noqa: BLE001  (a module that cannot load is not there)
        return None
    finally:
        if sys.path and sys.path[0] == os.path.join(HERE, folder):
            sys.path.pop(0)
    return mod


_VERIFIER = []


def _ed25519_verifier():
    """The pure-Python Ed25519 verify written beside this folder (record/ed25519.py), when it is there: verify(key32, msg, sig)."""
    if not _VERIFIER:
        ed = _load_beside("record", "ed25519")
        fn = getattr(ed, "verify", None) if ed is not None else None
        _VERIFIER.append(fn if callable(fn) else None)
    return _VERIFIER[0]


def verify_envelope(env, verifier):
    """verifyEnvelope: (signature_ok, reason) or None when no verifier is here to check it."""
    alg = env.get("alg", E._UNDEFINED)
    if alg != "ed25519":
        return False, "unsupported alg: %s" % ("undefined" if alg is E._UNDEFINED else E.js_str(alg))
    der = ed25519_der(env["public_key"])
    if der is None:
        return False, "signature verification errored: %s" % NODE_DECODER_UNSUPPORTED
    if verifier is None:
        return None
    sig = node_base64(env["signature"])
    msg = rb.canonical_json(env["verdict"]).encode("utf-8", "surrogatepass")
    try:
        ok = len(sig) == 64 and bool(verifier(der[12:], msg, sig))
    except Exception:  # noqa: BLE001  (a verifier that cannot read the signature has not verified it)
        ok = False
    return (True, None) if ok else (False, "signature does not verify — the verdict body was altered, or the key does not match")


def read_trusted_key_arg(k):
    """readTrustedKeyArg: the pinned fingerprints, in the order given; Refused with the engine's words."""
    fps = []

    def add_pem(pem):
        fp = key_fingerprint(pem)
        if fp is None:
            raise Refused("--trusted-key: not an Ed25519 public key")
        if fp not in fps:
            fps.append(fp)

    if re.match(r"^[0-9a-fA-F]{64}\Z", E.js_trim(k)):
        return [E.js_trim(k).lower()]
    text = k if "-----BEGIN" in k else (read_text(k) if os.path.exists(k) else None)
    if text is None and re.match(r"^[0-9a-fA-F]{8,63}\Z", E.js_trim(k)):
        raise Refused("--trusted-key %s: a fingerprint prefix is not a pin (a key can be ground to match a short prefix): pass the full "
                      "64-hex fingerprint, which replay prints on stderr as \"signing key fingerprint\"" % k)
    if text is None:
        raise Refused("--trusted-key %s: no such file, and not a PEM public key or a 64-hex key fingerprint" % k)
    if re.search(r"PRIVATE KEY-----", text):
        raise Refused("--trusted-key holds a PRIVATE key: pass the PUBLIC key (the .pub.pem verify keygen wrote), and keep the private "
                      "key to the signer")
    t = text.strip(E._JS_WS)
    if t.startswith("{"):
        raw = parse_json_strict(t, "--trusted-key %s" % k)
        pems = []
        if isinstance(raw, dict) and isinstance(raw.get("public_key"), str):
            pems.append(raw["public_key"])
        tk = raw["trusted_keys"] if isinstance(raw, dict) and isinstance(raw.get("trusted_keys"), dict) else (
            raw if isinstance(raw, dict) and "public_key" not in raw else None)
        if tk:
            for kk in E.js_keys(tk):
                v = tk[kk]
                for x in (v if isinstance(v, list) else [v]):
                    if isinstance(x, str):
                        pems.append(x)
        if not pems:
            raise Refused("--trusted-key %s: no public key in it (expected verify keygen's output, or { \"<signer>\": \"<public PEM>\" })" % k)
        seen = []
        for pem in pems:
            if pem not in seen:
                seen.append(pem)
                add_pem(pem)
        return fps
    blocks = PEM_PUBLIC.findall(t)
    if not blocks:
        raise Refused("--trusted-key %s: no -----BEGIN PUBLIC KEY----- block in it" % k)
    for pem in blocks:
        add_pem(pem)
    return fps


def trust_match(trust, pem):
    fp = key_fingerprint(pem)
    if fp is not None and fp in trust:
        return "current"
    old = legacy_key_fingerprint(pem)
    return "older" if old is not None and old in trust else None


def older_form_note(fp):
    return ("verify replay: note: --trusted-key matched this key by the older fingerprint form (sha256 of the key's base64 text), which "
            "this release still accepts; pin %s instead (sha256 over the key's DER bytes)\n" % (fp or "the key's fingerprint"))


# ---------------------------------------------------------------------------------------------------------------------
# What a replay file is (packages/verify/src/protocol/replay-case.ts, replay-ap.ts, ap/structured.ts apProofOf)

_isobj = lambda x: isinstance(x, dict)  # noqa: E731
ENVELOPE_KEYS = ("verdict", "alg", "public_key", "signature")
BUNDLE_KEYS = ("verdict", "inputs", "options")
AP_OUTPUT_KEYS = ("verdict", "decision", "payable", "grounding", "reasons", "not_checked", "proof", "read", "exit", "allow_open")
AP_READ_KEYS = ("form", "text_sha256", "history_sha256", "policy", "invoice_sha256", "po_sha256", "receipt_sha256")
AP_DERIVED_KEYS = ("decision", "payable", "grounding", "reasons", "not_checked")
ALLOWED_CALLER_KEYS = ("id", "note")
NOT_A_BUNDLE = 'not a replay bundle: { "verdict": <verdict or envelope>, "inputs": <inputs>, "options"? }'
# the fail-closed pieces of 2026-10-19 are engine.py's (one implementation, two entry points): the unknown-key refusal and its
# words, the line --allow-unknown-keys prints, and the annotation shapes
ALLOW_UNKNOWN_KEYS_LINE = E.ALLOW_UNKNOWN_KEYS_LINE
unknown_keys = E.unknown_keys
unknown_keys_reason = E.unknown_keys_reason
carried_line = E.carried_line
allowed_line = E.allowed_line
annotation_member_problem = E.annotation_member_problem


def is_envelope(x):
    return _isobj(x) and _isobj(x.get("verdict")) and isinstance(x.get("signature"), str) and isinstance(x.get("public_key"), str)


def is_replay_bundle(x):
    return _isobj(x) and _isobj(x.get("verdict")) and not is_envelope(x)


def is_ap_output(x):
    if "inputs" in x:
        return False
    if _isobj(x.get("proof")) and _isobj(x["proof"].get("verdict")):
        return True
    v = x.get("verdict")
    return _isobj(v) and _isobj(v.get("ruleset")) and v["ruleset"].get("id") == "ap-threeway" and isinstance(x.get("decision"), str)


def ap_derivable(b):
    if not _isobj(b) or not _isobj(b.get("verdict")):
        return False
    v = b["verdict"]["verdict"] if _isobj(b["verdict"].get("verdict")) and isinstance(b["verdict"].get("signature"), str) else b["verdict"]
    inputs = b.get("inputs")
    return (_isobj(v.get("ruleset")) and E.js_str(v["ruleset"].get("id")) in ("ap-threeway", "ap-structured") and _isobj(inputs)
            and _isobj(inputs.get("policy")) and (_isobj(inputs.get("ap_structured")) or _isobj(inputs.get("ap"))))


def ap_derived_keys_in(x):
    return [k for k in AP_DERIVED_KEYS if k in x] if _isobj(x) else []


def carried_keys(x, read_used=False, ap_checked=False):
    if not _isobj(x):
        return []

    def extra(o, known, prefix=""):
        return [prefix + k for k in E.js_keys(o) if k not in known]
    if is_envelope(x):
        return extra(x, ENVELOPE_KEYS)
    if is_ap_output(x):
        read = "read" in x and not read_used
        return (extra(x, AP_OUTPUT_KEYS) + (extra(x["proof"], ("verdict", "inputs"), "proof.") if _isobj(x.get("proof")) else [])
                + (["read"] if read else (extra(x["read"], AP_READ_KEYS, "read.") if _isobj(x.get("read")) else [])))
    if not is_replay_bundle(x):
        return []
    known = BUNDLE_KEYS + ALLOWED_CALLER_KEYS + (AP_DERIVED_KEYS if ap_checked and ap_derivable(x) else ())
    out = extra(x, known)
    if "options" in x:
        if not _isobj(x["options"]):
            out.append("options")
        else:
            for k in E.js_keys(x["options"]):
                v = x["options"][k]
                if not (k == "tolerance" and _isobj(v)) and not (k == "document" and isinstance(v, str)):
                    out.append("options.%s" % k)
    if is_envelope(x["verdict"]):
        out += extra(x["verdict"], ENVELOPE_KEYS, "verdict.")
    return out


def allowed_keys(x):
    if not _isobj(x) or is_envelope(x) or is_ap_output(x) or not is_replay_bundle(x):
        return []
    return [k for k in E.js_keys(x) if k in ALLOWED_CALLER_KEYS]


def ap_proof_of(x):
    if not _isobj(x) or "inputs" in x or not _isobj(x.get("proof")):
        return None
    p = x["proof"]
    if not _isobj(p.get("verdict")) or "inputs" not in p or not _isobj(p["inputs"]):
        return None
    same = "verdict" not in x or rb.canonical_json(x["verdict"]) == rb.canonical_json(p["verdict"])
    return {"verdict": p["verdict"], "inputs": p["inputs"]}, same


def ap_text_result(x):
    if not _isobj(x) or not _isobj(x.get("verdict")) or not _isobj(x["verdict"].get("ruleset")) or \
            x["verdict"]["ruleset"].get("id") != "ap-threeway" or not isinstance(x.get("decision"), str):
        return None
    return {"verdict": x["verdict"], "read": x["read"] if _isobj(x.get("read")) else None}


# ---------------------------------------------------------------------------------------------------------------------
# The verdict's own checks (packages/verify/src/protocol/replay.ts)

ANNOTATIONS = ("channel", "ledger", "declared_accuracy", "action_context", "case")
# JavaScript's \d is 0-9 only; Python's matches every script's digits, so each digit class here is written [0-9]
_ISO_INSTANT = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,9})?)?(?:Z|[+-]([0-9]{2}):([0-9]{2}))\Z")


def _js_typeof(v):
    if v is None or isinstance(v, (dict, list)):
        return "object"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, float):
        return "number"
    return "string"


def _days_in_month(y, mo):
    import calendar
    year = 1900 + y if 0 <= y <= 99 else y  # Date.UTC reads a year 0 to 99 as 1900 + y
    if mo == 0:
        return 31
    if mo == 13:
        return 31
    return calendar.monthrange(year, mo)[1]


def issued_at_problem(verdict):
    if "issued_at" not in verdict:
        return None
    v = verdict["issued_at"]
    if isinstance(v, str):
        shown = rb.js_string(v)
    else:
        kind = "null" if v is None else ("list" if isinstance(v, list) else _js_typeof(v))
        shown = "%s (a %s, not a string)" % (E.js_stringify(v), kind)
    bad = "issued_at is not an ISO-8601 timestamp: %s. A verdict records when it was issued as, for example, 2026-10-05T16:03:24.839Z" % shown
    m = _ISO_INSTANT.match(v) if isinstance(v, str) else None
    if not m:
        return bad
    y, mo, d, h, mi = (int(m.group(i)) for i in range(1, 6))
    s, oh, om = (int(m.group(i) or 0) for i in (6, 7, 8))
    if mo < 1 or mo > 12:
        return bad
    if d < 1 or d > _days_in_month(y, mo) or h > 23 or mi > 59 or s > 59 or oh > 23 or om > 59:
        return bad
    return None


def replay_input_problem(x):
    if not _isobj(x):
        return "not a verdict: %s, not a verdict object" % ("null" if x is None else "an array" if isinstance(x, list) else _js_typeof(x))
    missing = []
    if not isinstance(x.get("verdict_id"), str):
        missing.append("verdict_id")
    if not isinstance(x.get("input_hash"), str):
        missing.append("input_hash")
    rs = x.get("ruleset")
    if not (_isobj(rs) and isinstance(rs.get("id"), str) and isinstance(rs.get("version"), str)):
        missing.append("ruleset {id, version}")
    if not isinstance(x.get("engine_version"), str):
        missing.append("engine_version")
    if missing:
        return "not a verdict: %s %s missing or not a string, so no verdict_id can be derived" % (", ".join(missing), "is" if len(missing) == 1 else "are")
    return issued_at_problem(x)


def not_reperformed_fields(verdict):
    if not _isobj(verdict):
        return []
    out = [k for k in ANNOTATIONS if k in verdict]
    if _isobj(verdict.get("document")) and isinstance(verdict["document"].get("producer"), str):
        out.append("document.producer")
    return out


_TOL_SHAPE = ('{ "rel": <number ≥ 0>, "absCap": <number ≥ 0>, "roundingCap"?: { "perLine"?: [<rule id>...], "cashStep"?: [<rule id>...] }, '
              '"rounding"?: "infer" | "none" }')


def _stringify_or_type(v):
    """`JSON.stringify(v) ?? typeof v`, for a value read from JSON (or absent)."""
    return "undefined" if v is E._UNDEFINED else E.js_stringify(v)


def tolerance_problem(t):
    """tolerance.ts toleranceProblem: why an override's shape is not one an engine reads as its identity hashes it, or None."""
    if not _isobj(t):
        return "tolerance must be an object %s" % _TOL_SHAPE
    extra = [k for k in E.js_keys(t) if k not in ("rel", "absCap", "roundingCap", "rounding")]
    if extra:
        return "tolerance carries %s, which no engine reads (so its identity would not commit to it); the shape is %s" % (
            ", ".join(rb.js_string(k) for k in extra), _TOL_SHAPE)
    for k in ("rel", "absCap"):
        v = t.get(k, E._UNDEFINED)
        if not (isinstance(v, float) and math.isfinite(v) and v >= 0):
            return "tolerance.%s must be a finite number ≥ 0 (got %s)" % (k, rb.js_number(v) if isinstance(v, float) else _stringify_or_type(v))
    if "rounding" in t and t["rounding"] not in ("infer", "none"):
        return 'tolerance.rounding must be "infer" or "none" (got %s)' % E.js_stringify(t["rounding"])
    if "roundingCap" in t:
        rc = t["roundingCap"]
        if not _isobj(rc):
            return 'tolerance.roundingCap must be an object { "perLine"?: [<rule id>...], "cashStep"?: [<rule id>...] }'
        extra = [k for k in E.js_keys(rc) if k not in ("perLine", "cashStep")]
        if extra:
            return 'tolerance.roundingCap carries %s, which no engine reads; it takes "perLine" and "cashStep"' % ", ".join(rb.js_string(k) for k in extra)
        for k in ("perLine", "cashStep"):
            if k not in rc:
                continue
            v = rc[k]
            if not isinstance(v, list):
                got = "the string %s" % rb.js_string(v) if isinstance(v, str) else E.js_stringify(v)
                return ('tolerance.roundingCap.%s must be an array of rule-id strings, such as ["TAX_INT"] (got %s): a string would be read one '
                        'character at a time by the hash but as one id by the engine' % (k, got))
            for i, x in enumerate(v):
                if not isinstance(x, str):
                    return "tolerance.roundingCap.%s[%d] must be a rule-id string (got %s)" % (k, i, E.js_stringify(x))
    return None


def tolerance_identity(t):
    """tolerance.ts toleranceIdentity: the part of an override its identity commits to."""
    out = {"rel": t.get("rel"), "absCap": t.get("absCap")}
    if "rounding" in t:
        out["rounding"] = t["rounding"]
    if "roundingCap" in t:
        rc = t["roundingCap"]
        lst = lambda k: list(rc[k]) if isinstance(rc.get(k), list) else ([] if k not in rc else rc[k])  # noqa: E731
        out["roundingCap"] = {"perLine": lst("perLine"), "cashStep": lst("cashStep")}
    return out


class _Unbindable(Exception):
    pass


def bound_input_hash(verdict, inputs, tol):
    """replay.ts unbindableInputs, boundInputs and the binding hash: the computed input_hash, legacy override verdicts read as issued."""
    if tol is not None:
        p = tolerance_problem(tol)
        if p:
            raise _Unbindable("the restated rounding-tolerance override is not one an engine reads exactly as its identity hashes it (%s)" % p)
    if rb._takes_tolerance(inputs) and "tolerance" in inputs:
        p = tolerance_problem(inputs["tolerance"])
        if p:
            raise _Unbindable("the inputs' rounding-tolerance override is not one an engine reads exactly as its identity hashes it (%s)" % p)
    bound = inputs
    if tol is not None and rb._takes_tolerance(inputs) and "tolerance" not in inputs:
        bound = dict(inputs, tolerance=tolerance_identity(tol))

    def identity_hash(x):
        if _isobj(x) and rb._is_declarative_ruleset(x.get("ruleset")):
            x = dict(x, ruleset=rb.ruleset_identity(x["ruleset"]))
        return rb.sha256_hex(rb.canonical_json(x))
    computed = identity_hash(bound)
    if bound is not inputs and computed != verdict["input_hash"] and identity_hash(inputs) == verdict["input_hash"]:
        computed = verdict["input_hash"]  # a verdict issued before 2026-09-28 did not commit to its override
    return computed


def binds_remedy_table(engine_version):
    return engine_version not in ("0.0.1", "0.1.0")


# the engines Node dispatches a verdict's inputs to (replay.ts reperform), in its order; this build re-performs invoice@0.1.0
# itself, and a declarative ruleset through engine_py/declarative when that folder is beside it
TWIN_MAPS = ("twin-xbrl-fs-core@0.1.0", "twin-xbrl-fs-core@0.2.0", "twin-xbrl-fs-core@0.2.1")
BUILTIN_RULESETS = (("invoice", "0.1.0"), ("pay-app", None), ("invoice", "0.0.1"))


_READER = []


def _declarative_reader():
    """declarative/replay.py, when that file is beside this one and carries _reperform and _compare; else None."""
    if not _READER:
        dr = _load_beside("declarative", "replay")
        ok = dr is not None and callable(getattr(dr, "_reperform", None)) and callable(getattr(dr, "_compare", None))
        _READER.append(dr if ok else None)
    return _READER[0]


def _outside(engine, rs):
    return {"not": "this build re-performs invoice@0.1.0 only; the verdict is %s@%s (the %s engine)" % (rs["id"], rs["version"], engine),
            "here_only": True}


def _reperform_declarative(presented, x, tolerance, engine):
    """The declarative and reconciliation verdicts, through declarative/replay.py beside this file (its _reperform and _compare)."""
    rs = presented["ruleset"]
    dr = _declarative_reader()
    if dr is None:
        return _outside(engine, rs)
    try:
        r = dr._reperform(presented, x, tolerance)
        if not isinstance(r, dict):
            raise TypeError("no answer")
        if "not" in r:
            return {"not": r["not"], "here_only": bool(r.get("outside"))}
        if "pinned" in r:
            return {"engine": r.get("engine", engine), "identical": False, "first_difference": r.get("first") or "inputs.ruleset (remedies)", "pinned": r["pinned"]}
        again = r["again"]
        name = r.get("engine", engine)
        if again.get("input_hash") != presented["input_hash"]:
            return {"engine": name, "identical": False, "first_difference": "input_hash"}
        identical, first, not_carried = dr._compare(presented, again, presented["engine_version"])
    except Exception as e:  # noqa: BLE001  (a reader that cannot run has not re-performed: said, never guessed)
        return {"not": "the declarative reader beside this build stopped on these inputs (%s)" % type(e).__name__, "here_only": True}
    out = {"engine": name, "identical": bool(identical)}
    if not identical:
        out["first_difference"] = first or "(canonical bytes)"
    ann = not_reperformed_fields(presented)
    if ann:
        out["annotations"] = ann
    if isinstance(again, dict) and "remedies" in again:
        out["remedies"] = json.loads(json.dumps(again["remedies"]))
    if not_carried:
        out["remedies_not_carried"] = True
    return out


def reperform(presented, inputs, lenient_remedies, document=None, tolerance=None):
    """replay.ts reperform for the inputs this build re-performs; {"not": why} for the rest (here_only: Node would run it)."""
    ev = presented["engine_version"]
    if ev not in E.ENGINES:
        return {"not": "the verdict was issued by engine %s; this is engine %s, which re-performs engines %s only, and a check is "
                       "re-performed only by the engine that made it" % (ev, ENGINE_VERSION, " and ".join(E.ENGINES))}
    if not _isobj(inputs):
        return {"not": "the inputs are not an object, so no engine takes them"}
    x = inputs
    rs = presented["ruleset"]
    has = lambda *ks: all(k in x for k in ks)  # noqa: E731
    if has("twin_sha256"):
        if document is None:
            return {"not": "a twin verdict's inputs commit to the filing by its sha256, not its text: supply the iXBRL document to re-perform it"}
        if not (isinstance(x.get("map"), str) and x["map"] in TWIN_MAPS):
            return {"not": "no twin map %s in this build" % ("undefined" if "map" not in x else E.js_str(x["map"]))}
        return _outside("twin", rs)
    if has("xml_sha256"):
        if document is None:
            return {"not": "an e-invoice twin verdict's inputs commit to the XML by its sha256, not its text: supply the XML to re-perform it"}
        return _outside("twin-einvoice", rs)
    if has("action", "sources") and rs["id"] == "action":
        return _outside("action", rs)
    if has("ap_structured", "policy"):
        return _outside("ap-structured", rs)
    if has("ap", "policy"):
        return _outside("ap", rs)
    if has("citations", "sources") and rs["id"] == "legal":
        return _outside("legal", rs)
    if has("documents", "ruleset"):
        return _reperform_declarative(presented, x, tolerance, "reconcile")
    if has("extraction", "ruleset") and rb._is_declarative_ruleset(x.get("ruleset")):
        return _reperform_declarative(presented, x, tolerance, "declarative")
    if has("extraction", "references", "source"):
        found = [b for b in BUILTIN_RULESETS if b[0] == rs["id"] and (b[1] == rs["version"] or b[1] is None)] or \
            [b for b in BUILTIN_RULESETS if b[0] == rs["id"]]
        if not found:
            return {"not": "no built-in ruleset '%s' in this build (a declarative ruleset's inputs carry the ruleset itself)" % rs["id"]}
        if rs["id"] == "invoice" and rs["version"] != "0.1.0" and rs["version"] != "0.0.1":
            return {"not": "this build's verify:invoice engine is ruleset invoice@0.1.0; the verdict is invoice@%s, and a check is "
                           "re-performed only under the ruleset that made it" % rs["version"]}
        if (rs["id"], rs["version"]) != ("invoice", "0.1.0"):
            return _outside("verify:%s" % rs["id"], rs)
        if tolerance is not None or _isobj(x.get("tolerance")):
            return {"not": "a rounding-tolerance override; overrides are not re-performed by this build yet", "here_only": True}
        return _reperform_invoice(presented, x)
    return {"not": "no engine in this build takes inputs shaped { %s } for ruleset %s@%s"
                   % (", ".join(sorted(x.keys(), key=lambda k: k.encode("utf-16-be", "surrogatepass"))), rs["id"], rs["version"])}


def _reperform_invoice(presented, x):
    engine_name = "verify:invoice"
    ev = presented["engine_version"]
    producer = presented["document"].get("producer") if _isobj(presented.get("document")) else None
    issued_at = presented["issued_at"] if isinstance(presented.get("issued_at"), str) else "1970-01-01T00:00:00.000Z"
    try:
        again = E.issue(x["extraction"], issued_at, engine=ev, producer=producer if isinstance(producer, str) else None,
                        references=x["references"], source=x["source"])
    except E.Outside as e:
        return {"not": "outside what this build re-performs: %s" % e, "here_only": True}
    except E.Refused as e:  # the library's own message, as replay.ts wraps the error verify() throws
        return {"not": "the %s engine could not run on these inputs (%s)" % (engine_name, getattr(e, "library_message", str(e)))}
    except Exception as e:  # noqa: BLE001  (a shape engine.py was not written for: not re-performed, never a guessed answer)
        return {"not": "outside what this build re-performs: the invoice engine here stopped on these inputs (%s)" % type(e).__name__, "here_only": True}
    again = json.loads(E.render(again))
    if again["input_hash"] != presented["input_hash"]:
        return {"engine": engine_name, "identical": False, "first_difference": "input_hash"}
    a, p = E._stripped(again), E._stripped(presented)
    not_carried = "remedies" not in presented and "remedies" in again and not binds_remedy_table(ev)
    if not_carried:
        del a["remedies"]
    identical = rb.canonical_json(a) == rb.canonical_json(p)
    out = {"engine": engine_name, "identical": identical}
    if not identical:
        out["first_difference"] = E.first_difference(a, p) or "(canonical bytes)"
    ann = not_reperformed_fields(presented)
    if ann:
        out["annotations"] = ann
    if "remedies" in again:
        out["remedies"] = again["remedies"]
    if not_carried:
        out["remedies_not_carried"] = True
    return out


def verify_replay(verdict, inputs, has_inputs, options, lenient_remedies):
    """replay.ts verifyReplay: a dict in ReplayCheck's shape and key order (inputs the bundle's, when has_inputs)."""
    problem = replay_input_problem(verdict) or annotation_member_problem(verdict)
    if problem:
        return {"ok": False, "id_ok": False, "expected_verdict_id": "", "reason": problem, "refused": True, "outcome_verified": False,
                "status": "REFUSED"}
    rth = verdict["remedy_table_hash"] if isinstance(verdict.get("remedy_table_hash"), str) else None
    expected = rb.derive_verdict_id(verdict["input_hash"], verdict["ruleset"], verdict["engine_version"], rth)
    id_ok = expected == verdict["verdict_id"]
    out = {"ok": id_ok, "id_ok": id_ok, "expected_verdict_id": expected, "outcome_verified": False, "status": "STRUCTURE_ONLY" if id_ok else "FAILED"}
    if not id_ok:
        out["reason"] = "verdict_id does not derive from input_hash + ruleset@version + engine_version%s (expected %s)" % (
            " + remedy_table_hash" if rth is not None else "", expected)
    if id_ok and rth is None and verdict["engine_version"] in E.ENGINES and binds_remedy_table(verdict["engine_version"]):
        out.update(ok=False, status="FAILED", reason="a verdict of engine %s binds the remedy table it was answered from, and this one "
                                                     "carries no remedy_table_hash" % verdict["engine_version"])
        return out
    if id_ok and isinstance(verdict.get("algorithms"), list) and verdict["algorithms"]:
        out["not_reperformed"] = "%s: the verdict pins algorithms, whose registry this build does not carry, so nothing after the binding of " \
                                 "its id was checked here" % STRUCTURE_ONLY_NOTE
        out["_here_only"] = True
        return out
    if not has_inputs:
        if id_ok:
            out["not_reperformed"] = "%s: no inputs were supplied, so the check was not run again (the verdict_id binds the inputs, not the outcome)" % STRUCTURE_ONLY_NOTE
        return out
    tol = options.get("tolerance") if _isobj(options) else None
    # the inputs as input_hash binds them (a restated override folded in, a declarative ruleset's remedies set aside); an override
    # whose shape an engine and the identity read differently cannot be bound, so the binding FAILS (replay.ts unbindableInputs)
    try:
        computed = bound_input_hash(verdict, inputs, tol)
    except _Unbindable as e:
        out.update(input_ok=False, ok=False, status="FAILED", reason="%s, so the input binding cannot be checked" % e)
        return out
    except rb.Refused as e:
        out["not_reperformed"] = "%s: %s" % (STRUCTURE_ONLY_NOTE, e)
        out["_here_only"] = True
        return out
    input_ok = computed == verdict["input_hash"]
    out["input_ok"] = input_ok
    out["expected_input_hash"] = computed
    out["ok"] = id_ok and input_ok
    if id_ok and not input_ok:
        out["recorded_input_hash"] = verdict["input_hash"]
        out["computed_input_hash"] = computed
        out["reason"] = "input_hash does not match the supplied inputs: recorded %s, computed %s — this verdict is not for these inputs" % (
            verdict["input_hash"], computed)
    if not out["ok"]:
        out["status"] = "FAILED"
        return out
    r = reperform(verdict, inputs, lenient_remedies, options.get("document") if _isobj(options) else None, tol)
    if "not" in r:
        out["not_reperformed"] = "%s: %s" % (STRUCTURE_ONLY_NOTE, r["not"])
        if r.get("here_only"):
            out["_here_only"] = True
        return out
    out["reperformed"] = {k: v for k, v in r.items() if k in ("engine", "identical", "first_difference", "annotations", "remedies", "remedies_not_carried")}
    rr = out["reperformed"]
    if r.get("pinned"):
        out.update(ok=False, status="FAILED", reason=r["pinned"])
    elif rr["identical"] and rr.get("remedies_not_carried") and not lenient_remedies:
        n = len(rr.get("remedies") or [])
        rr2 = dict(rr)
        rr2["identical"] = False
        rr2["first_difference"] = "remedies"
        out["reperformed"] = rr2
        out.update(ok=False, status="FAILED", reason="the verdict carries no remedies; the engine re-derives %d %s for it (engine %s); a replayed "
                                                     "verdict must carry what it said. For a verdict issued before remedies existed, `verify replay "
                                                     "--lenient-remedies` compares its core and reports the re-derived remedies"
                                                     % (n, "remedy" if n == 1 else "remedies", verdict["engine_version"]))
    elif rr["identical"]:
        out.update(outcome_verified=True, status="REPERFORMED")
    else:
        first = rr.get("first_difference")
        named = ""
        m = re.match(r"^remedies\[([0-9]+)\]", first or "")
        rem = rr.get("remedies") or []
        if m and int(m.group(1)) < len(rem) and rem[int(m.group(1))].get("clears"):
            named = " (the remedy that answers %s)" % ", ".join(rem[int(m.group(1))]["clears"])
        movable = re.match(r"^(claims|outcome|gate_status|coverage|remedies)(\b|\[|\.|$)", first or "") is not None
        engine = rr["engine"]
        hint = ". If it was issued under a rounding-tolerance override, restate it (a verdict issued before 2026-09-28 does not commit to it in input_hash)" \
            if (engine.startswith("verify:") or engine == "declarative") and movable else ""
        out.update(ok=False, status="FAILED", reason="the re-performed verdict differs from the presented one at `%s`%s: the check run again on these "
                                                     "inputs does not give this verdict (%s, engine %s)%s"
                                                     % (first, named, engine, verdict["engine_version"], hint))
    return out


def strict_problems(verdict, remedies_absent, unpinned_envelope, carried):
    fields = [f for f in not_reperformed_fields(verdict) if f != "document.producer"]
    out = []
    if fields:
        out.append("not re-performed (not the engine's output): %s" % ", ".join(fields))
    if remedies_absent:
        out.append("remedies absent; re-derived (the verdict carries none, so the remedies shown are this build's)")
    if unpinned_envelope:
        out.append("the envelope's key is not pinned: pass --trusted-key <public key> to say whose signature counts")
    if _isobj(verdict) and "issued_at" not in verdict:
        out.append("issued_at is missing: every verdict records when it was issued")
    if carried:
        out.append("outside keys under --strict: %s (carried beside the verdict, not checked: remove them, or replay without --strict)" % ", ".join(carried))
    return out


def strict_notes(verdict, signed_by_pinned_key):
    doc = verdict.get("document") if _isobj(verdict) and _isobj(verdict.get("document")) else None
    if doc is None or not isinstance(doc.get("producer"), str):
        return []
    return ["document.producer %s is the issuer's label: compared as carried, bound by neither input_hash nor verdict_id%s"
            % (rb.js_string(doc["producer"]), "; it is inside the body the pinned key signed" if signed_by_pinned_key else "; only a signature by a pinned key binds it")]


# ---------------------------------------------------------------------------------------------------------------------
# What a person reads (verdict/aggregation.ts gateHeadline, protocol/replay-case.ts renderCaseReplay)

def _open_claims(v):
    return [c for c in v["claims"] if _isobj(c) and c.get("outcome") == "INSUFFICIENT_DATA" and c.get("tier") != "REASONED"]


def _held_suspect(v):
    return [c for c in v["claims"] if _isobj(c) and c.get("outcome") == "INSUFFICIENT_DATA" and c.get("tier") != "REASONED" and "suspect" in c]


def _struck_load_bearing(v):
    return any(_isobj(w) and isinstance(w.get("claims"), list) and len(w["claims"]) > 0 for w in (v.get("would_unlock") or []))


def _recorded_gate_status(v):
    if v["outcome"] == "FAIL" or _held_suspect(v):
        s = "FAIL"
    elif v["outcome"] != "PASS":
        s = v["outcome"]
    else:
        s = "PASS-WITH-OPEN" if _open_claims(v) else "PASS"
    if s == "PASS-WITH-OPEN":
        return "PASS_WITH_OPEN"
    if s == "PASS" and _struck_load_bearing(v):
        return "PASS_WITH_OPEN"
    return s


def gate_headline(v):
    s = v["gate_status"] if v.get("gate_status") in ("PASS", "PASS_WITH_OPEN", "FAIL", "INSUFFICIENT_DATA") else _recorded_gate_status(v)
    n = len(v["claims"])
    checks = lambda k: "%d of %d check%s" % (k, n, "" if n == 1 else "s")  # noqa: E731
    if s == "FAIL":
        failed = sum(1 for c in v["claims"] if _isobj(c) and c.get("outcome") == "FAIL")
        return "FAIL: %s failed" % checks(failed) if failed else "FAIL: %s held as suspect (a reading one character away fails)" % checks(len(_held_suspect(v)))
    if s == "INSUFFICIENT_DATA":
        return "INSUFFICIENT_DATA: none of the %d check%s could run" % (n, "" if n == 1 else "s") if n else "INSUFFICIENT_DATA: no check applied"
    open_ = len(_open_claims(v))
    if s == "PASS_WITH_OPEN":
        return "PASS-WITH-OPEN: %s could not run" % checks(open_) if open_ else "PASS-WITH-OPEN: every check that ran held, and a load-bearing field is struck"
    passed = sum(1 for c in v["claims"] if _isobj(c) and c.get("outcome") == "PASS")
    judged = n - passed
    return "PASS: %s ran and held%s" % (checks(passed), "; %d judgement claim%s did not decide (judgement never opens a verdict)" % (judged, "" if judged == 1 else "s") if judged else "")


def _render_case(c, verdict, not_reperformed, carried, allowed, hint=None):
    gate_words = gate_headline(verdict) if c["result"] == "MATCH" and _isobj(verdict) and isinstance(verdict.get("claims"), list) \
        and isinstance(verdict.get("outcome"), str) else None
    answer = ""
    if c.get("answer"):
        if gate_words is not None:
            answer = "  %s" % gate_words
        else:
            unable = " with %d of %s check%s unable to run" % (c["unchecked"], c.get("checks", "?"), "" if c.get("checks") == 1 else "s") \
                if c["answer"] == "PASS" and c.get("unchecked") else ""
            answer = "  %s%s" % (c["answer"], unable)
    head = "%s %s%s%s" % (c["result"].ljust(15), c["name"], answer, "  verdict %s…" % c["verdict_id"][:12] if c.get("verdict_id") else "")
    if c["result"] == "DIVERGED":
        why = "\n    diverges at `%s`: %s" % (c.get("first_difference") or "?", c.get("reason") or "")
    elif c["result"] != "MATCH":
        why = "\n    %s" % (c.get("reason") or "")
    else:
        why = ""
    out = head + why
    if carried:
        out += "\n    " + carried_line(carried)
    if allowed:
        out += "\n    " + allowed_line(allowed)
    if hint:
        out += "\n    " + hint
    if c["result"] == "MATCH" and not_reperformed:
        out += "\n    not re-performed (not the engine's output): %s" % ", ".join(not_reperformed)
    out += "".join("\n    remedy: %s" % line for line in E.render_remedies(c.get("remedies")))
    if c.get("remedies_not_carried"):
        out += ("\n    remedies absent; re-derived: the verdict carries no remedies (issued before engine 0.2.0 bound them, or removed "
                "since); these are this build's, and its core matched")
    if c["result"] == "MATCH" and _isobj(verdict) and "issued_at" not in verdict and "strict_problems" not in c:
        out += "\n    " + E.ISSUED_AT_MISSING
    out += "".join("\n    STRICT: %s" % p for p in c.get("strict_problems") or [])
    out += "".join("\n    strict note: %s" % p for p in c.get("strict_notes") or [])
    return out


_FLOOR_WORDS = {
    "E0": "E0 (a system of record, through an authenticated channel)", "E1": "E1 (a structured document)", "E2": "E2 (a PDF text layer)",
    "E3": "E3 (OCR of a scan)", "E4": "E4 (an assertion)",
    "unstated": "unstated (the values carry no provenance: the extraction is checked as given)", "none": "none (no check was computed)",
}


def scope_lines(v):
    """verdict/scope.ts renderScope (legal/replay-notice.ts legalScopeLines for a legal verdict): the closing lines of a match."""
    s = v.get("scope") if _isobj(v) else None
    if not s:
        return []
    if _isobj(v.get("ruleset")) and v["ruleset"].get("id") == "legal":
        first = ("Scope: checked against %s by engine %s; each quotation against the opinion text supplied for its cite, recorded in the "
                 "verdict by its sha256." % (E.js_str(s.get("ruleset", E._UNDEFINED)) if "ruleset" in s else "undefined",
                                              E.js_str(s["engine_version"]) if "engine_version" in s else "undefined"))
    else:
        floor = s.get("evidence_floor")
        words = _FLOOR_WORDS.get(floor) if isinstance(floor, str) else None
        first = "Scope: checked against %s by engine %s; evidence floor %s." % (
            E.js_str(s["ruleset"]) if "ruleset" in s else "undefined", E.js_str(s["engine_version"]) if "engine_version" in s else "undefined",
            words if words is not None else ("undefined" if "evidence_floor" not in s else E.js_str(floor)))
    return [first, "Advisories are counsel, not verdicts.", "This is a check, not a decision."]


def _js_pretty(v):
    return E.pretty(E._fix_ints(v))


# ---------------------------------------------------------------------------------------------------------------------
# One file (packages/verify/src/cli.ts runReplay)

class _Out(object):
    def __init__(self):
        self.out, self.err = [], []


def _signed_sentence(sig, trust):
    if sig is None:
        return ""
    fp12 = sig["key_fingerprint"][:12] if sig.get("key_fingerprint") else "?"
    if trust is not None:
        return " The envelope's signature verifies, by the trusted key (%s…)." % fp12
    return " The envelope's signature verifies (key %s…): the body, outcome included, is what that key holder issued; anchor the key to its holder out of band." % fp12


def _structure_how(inputs_given, verdict, raw_file, file_arg):
    if not inputs_given and declarative_replay_needs(verdict) is not None:
        n = declarative_replay_needs(verdict)
        s = replay_needs_sentence(n)
        s = re.sub(r"^t", "T", s, count=1).replace(": pass ", ": to re-perform it, pass ", 1)
        return " %s (or --inputs <inputs.json>)." % s
    if not inputs_given and ap_text_result(raw_file) is not None:
        return " To re-perform it: replay %s --source <the bill's text file> --history <the payment history file, when one was given>." % file_arg
    return " To re-perform it, pass the inputs (--inputs <inputs.json>, or --extraction <doc.json> with the flags the verdict was made with)."


def run_replay_one(file_arg, opts, verifier):
    """(exit, stdout, stderr) for one file, in runReplay's order and words."""
    o = _Out()
    strict, lenient, allow_unknown, trust = opts["strict"], opts["lenient"], opts["allow_unknown"], opts["trust"]
    # the output of `ap` on an emailed bill that records what it read: the replay needs those files, which this build does not take
    try:
        raw_file = read_json(file_arg)
        read_error = None
    except Refused as e:
        raw_file, read_error = None, e
    if read_error is None:
        t = ap_text_result(raw_file)
        if t is not None and t["read"] is not None:
            read = t["read"]
            three = read.get("form") == "three files"
            history_read = isinstance(read.get("history_sha256"), str)
            text_flags = ["invoice", "po", "receipt"] if three else ["source"]
            missing = ["--%s" % k for k in text_flags] + (["--history"] if history_read else [])
            recipe = ("--invoice <the invoice text> --po <the purchase order text> --receipt <the goods receipt text>" if three
                      else "--source <the bill's text file>") + (" --history <the payment history file>" if history_read else "")
            msg = ("verify replay: this is the output of `ap` on an emailed bill: it records the sha256 of the text%s it read, never the "
                   "documents, so the replay needs those files: replay %s %s; this call leaves out %s\n"
                   % (" and of the payment history" if history_read else "", file_arg, recipe, ", ".join(missing)))
            unread = carried_keys(raw_file)
            o.err.append(msg + ("verify replay: %s\n" % carried_line(unread) if unread else ""))
            return 3, "", "".join(o.err)
    if read_error is not None:
        o.err.append("verify replay: error reading input: %s\n" % replay_advice(str(read_error)))
        return 3, "", "".join(o.err)
    raw = raw_file
    carried = carried_keys(raw)
    allowed = allowed_keys(raw)
    kind, unknown = unknown_keys(raw)
    if unknown and not allow_unknown:
        reason = unknown_keys_reason(kind, unknown)
        o.out.append(_js_pretty({"ok": False, "status": "REFUSED", "refused": True, "reason": reason, "unknown_keys": unknown}) + "\n")
        o.err.append("verify replay: input refused: %s\n" % reason)
        return 3, "".join(o.out), "".join(o.err)
    ap = ap_proof_of(raw)
    proof_note = "verify replay: this file is the output of `ap --input`; its proof member (the verdict and the inputs it was issued on) was replayed\n" if ap else ""
    if ap and not ap[1]:
        o.err.append("verify replay: FAILED: the file's verdict is not the verdict in its proof member; the file was changed after `ap --input` wrote it\n")
        return 1, "", "".join(o.err)
    if ap:
        raw = ap[0]
    inputs, has_inputs, options = None, False, {}
    if is_replay_bundle(raw):
        has_inputs = "inputs" in raw
        inputs = raw.get("inputs")
        if _isobj(raw.get("options")):
            if _isobj(raw["options"].get("tolerance")):
                options["tolerance"] = raw["options"]["tolerance"]
            if isinstance(raw["options"].get("document"), str):
                options["document"] = raw["options"]["document"]
        raw = raw["verdict"]
    envelope = is_envelope(raw)
    verdict = raw["verdict"] if envelope else raw
    result = verify_replay(verdict, inputs, has_inputs, options, lenient)
    here_only = result.pop("_here_only", False)
    sig, older_note, sig_unchecked = None, "", False
    if envelope:
        check = verify_envelope(raw, verifier)
        fp = key_fingerprint(raw["public_key"])
        match = trust_match(trust, raw["public_key"]) if trust is not None else None
        if check is None:
            sig_unchecked = True
            sig = {"alg": E.js_str(raw.get("alg", None)) if "alg" in raw else "undefined", "signature_ok": None}
        else:
            sig = {"alg": "undefined" if "alg" not in raw else E.js_str(raw["alg"]), "signature_ok": check[0]}
            if fp:
                sig["key_fingerprint"] = fp
            if check[1]:
                sig["reason"] = check[1]
            if trust is not None:
                sig["trusted"] = match is not None
            if match == "older":
                sig["older_fingerprint_form"] = True
                older_note = older_form_note(fp)
        if sig_unchecked and fp:
            sig["key_fingerprint"] = fp
    reading = None
    if result["status"] == "REPERFORMED":
        claims = verdict["claims"] if isinstance(verdict.get("claims"), list) else []
        reading = {"answer": verdict["outcome"], "checks": len(claims),
                   "unchecked": sum(1 for c in claims if _isobj(c) and c.get("outcome") == "INSUFFICIENT_DATA")}
    shown_carried = carried
    strict_list = strict_problems(verdict, bool((result.get("reperformed") or {}).get("remedies_not_carried")), envelope and trust is None, shown_carried) \
        if strict and result["status"] == "REPERFORMED" else []
    note_list = strict_notes(verdict, envelope and trust is not None and bool(sig and sig.get("trusted"))) if strict and result["status"] == "REPERFORMED" else []
    body = {}
    if sig is not None:
        body["envelope"] = sig
    if reading:
        body.update(reading)
    body.update(result)
    if shown_carried:
        body["carried_not_checked"] = shown_carried
    if allowed:
        body["carried_allowed"] = allowed
    if strict:
        sb = {"ok": result["status"] == "REPERFORMED" and not strict_list, "problems": strict_list}
        if note_list:
            sb["notes"] = note_list
        body["strict"] = sb
    if allow_unknown:
        body["allow_unknown_keys"] = "stated"
    if sig_unchecked and not result.get("refused"):
        body["signature_checked"] = False
    o.out.append(_js_pretty(body) + "\n")
    follow = older_note + ("verify replay: %s\n" % carried_line(shown_carried) if shown_carried else "") + \
        ("verify replay: %s\n" % ALLOW_UNKNOWN_KEYS_LINE if allow_unknown else "") + ("verify replay: %s\n" % allowed_line(allowed) if allowed else "")
    if result.get("refused"):
        o.err.append("verify replay: input refused: %s\n%s" % (result.get("reason") or "not a verdict", follow))
        return 3, "".join(o.out), "".join(o.err)
    if sig_unchecked:
        # no Ed25519 verifier here: what the signature would decide is not said; a binding that fails, fails whatever it says
        cant = "verify replay: note: the envelope's signature was not checked: no Ed25519 verifier is beside this build (can't tell here whether it verifies)\n"
        if result["status"] == "FAILED":
            o.err.append("verify replay: FAILED: %s\n%s%s" % (result.get("reason") or "the verdict does not replay", cant, follow))
            return 1, "".join(o.out), "".join(o.err)
        o.err.append("verify replay: structure verified; can't tell here: the envelope's signature was not checked (no Ed25519 verifier is "
                     "beside this build), so neither the signature nor the outcome is reported. Exit 2.\n%s" % follow)
        return 2, "".join(o.out), "".join(o.err)
    if sig is not None and not sig["signature_ok"]:
        o.err.append("verify replay: FAILED: the envelope's signature does not verify (%s)\n%s" % (sig.get("reason") or "altered, or another key", follow))
        return 1, "".join(o.out), "".join(o.err)
    if trust is not None and sig is None:
        o.err.append("verify replay: FAILED: the verdict is not signed, and --trusted-key requires an envelope signed by the trusted key\n%s" % follow)
        return 1, "".join(o.out), "".join(o.err)
    fp_line = ""
    if sig is not None and sig.get("key_fingerprint"):
        fp_line = "verify replay: signing key fingerprint %s%s\n" % (sig["key_fingerprint"], " (the trusted key)" if sig.get("trusted") is True else
                                                                     " (to pin it: --trusted-key %s)" % sig["key_fingerprint"])
    if trust is not None and sig is not None and not sig.get("trusted"):
        fp12 = sig["key_fingerprint"][:12] if sig.get("key_fingerprint") else "?"
        o.err.append("verify replay: FAILED: the envelope is signed by key %s…, which is not the trusted key (%s): its signature verifies, but it "
                     "proves only that the holder of that other key issued it\n%s%s  trusted: %s\n"
                     % (fp12, ", ".join("%s…" % x[:12] for x in trust), follow, fp_line, ", ".join(trust)))
        return 1, "".join(o.out), "".join(o.err)
    signed = _signed_sentence(sig, trust)
    if result["status"] == "FAILED":
        if result.get("input_ok") is False and result["id_ok"]:
            lines = ["FAILED: input_hash does not match the supplied inputs: this verdict is not for these inputs",
                     "  recorded %s (in the verdict)" % (result.get("recorded_input_hash") or "?"),
                     "  computed %s (from the inputs given here)" % (result.get("computed_input_hash") or result.get("expected_input_hash") or "?")]
        else:
            lines = ["FAILED: %s" % (result.get("reason") or "the verdict does not replay")]
        o.err.append("\n".join(("verify replay: " + l) if i == 0 else l for i, l in enumerate(lines)) + "\n" + follow + proof_note)
        return 1, "".join(o.out), "".join(o.err)
    if result["status"] == "REPERFORMED":
        rr = result["reperformed"]
        ann = rr.get("annotations") or []
        o.err.append("verify replay: outcome VERIFIED: re-performed with %s (ruleset %s@%s, engine %s) and byte-identical%s.%s%s\n%s%s%s"
                     % (rr["engine"], verdict["ruleset"]["id"], verdict["ruleset"]["version"], verdict["engine_version"],
                        "; " + E.ISSUED_AT_MISSING if "issued_at" not in verdict else ", issued_at aside",
                        " Not re-performed (not the engine's output): %s." % ", ".join(ann) if ann else "", signed, follow, fp_line, proof_note))
        rem = E.render_remedies(rr.get("remedies"))
        absent = ("\n  remedies absent; re-derived: the verdict carries no remedies (issued before engine 0.2.0 bound them, or removed since); "
                  "these are this build's, and its core matched") if rr.get("remedies_not_carried") else ""
        sc = scope_lines(verdict)
        o.err.append("verify replay: %s%s%s%s\n" % (gate_headline(verdict), "".join("\n  remedy: %s" % l for l in rem), absent,
                                                     "\n" + "\n".join("  %s" % s for s in sc) if sc else ""))
        if note_list:
            o.err.append("".join("verify replay: strict note: %s\n" % p for p in note_list))
        if strict_list:
            o.err.append("verify replay: STRICT: FAILED: the outcome re-performed byte-identical, but not everything in the file was:\n%s\n"
                         % "\n".join("  %s" % p for p in strict_list))
            return 1, "".join(o.out), "".join(o.err)
        return 0, "".join(o.out), "".join(o.err)
    how = "" if here_only else _structure_how(has_inputs, verdict, raw, file_arg)
    o.err.append("verify replay: %s.%s%s Exit 2.\n%s%s%s" % (result.get("not_reperformed") or STRUCTURE_ONLY_NOTE, signed, how, follow, fp_line, proof_note))
    return 2, "".join(o.out), "".join(o.err)


# ---------------------------------------------------------------------------------------------------------------------
# The declarative verdict's inputs, named off the verdict alone (replay.ts declarativeReplayNeeds, replayNeedsSentence)

# The rulesets the engine carries as declarative data (rulesets/declarative.ts DECLARATIVE_RULESETS) and the quote ids each
# declares, read from the same files the engine embeds; and the ruleset ids no declarative verdict carries.
_NON_DECLARATIVE_IDS = ("invoice", "pay-app", "action", "legal", "ap-threeway", "ap-structured", "twin-einvoice", "twin-xbrl-fs-core")


def _carried_declarative():
    """{ "id@version": [quote ids] } for the declarative rulesets this tree ships beside the engine, or {} when none is found."""
    out = {}
    root = os.path.dirname(os.path.dirname(HERE))
    for d in (os.path.join(root, "packages", "verify", "docs", "examples"), os.path.join(root, "..", "verify", "docs", "examples")):
        if not os.path.isdir(d):
            continue
        for n in sorted(os.listdir(d)):
            if not re.match(r"^peppol-en16931\.ruleset\.v[0-9.]+\.json\Z", n):
                continue
            try:
                with open(os.path.join(d, n), "rb") as fh:
                    rs = json.loads(fh.read().decode("utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(rs, dict) and isinstance(rs.get("id"), str) and isinstance(rs.get("version"), str):
                out["%s@%s" % (rs["id"], rs["version"])] = [q.get("id") for q in rs.get("quotes") or [] if _isobj(q) and isinstance(q.get("id"), str)]
        if out:
            break
    return out


def is_declarative_verdict(v):
    if replay_input_problem(v) is not None:
        return False
    doc, refs = v.get("document"), v.get("references")
    return (_isobj(doc) and isinstance(doc.get("extraction_hash"), str) and _isobj(refs) and refs.get("contract") is False
            and refs.get("evidence") == 0.0 and not isinstance(refs.get("evidence"), bool) and refs.get("history") == 0.0
            and not isinstance(refs.get("history"), bool) and isinstance(refs.get("source"), bool) and v["ruleset"]["id"] not in _NON_DECLARATIVE_IDS)


def _list_of(items, last="and"):
    return items[0] if len(items) == 1 else ("" if not items else "%s %s %s" % (", ".join(items[:-1]), last, items[-1]))


def declarative_replay_needs(v):
    if not is_declarative_verdict(v):
        return None
    ref = "%s@%s" % (v["ruleset"]["id"], v["ruleset"]["version"])
    carried = _carried_declarative()
    has = ref in carried
    needs = ["--extraction <file>", "--ruleset %s (or its file)" % ref if has else "--ruleset <the file of %s>" % ref]
    maybe, words = [], []
    if v["references"]["source"] is True:
        needs.append("--source <file>")
        words.append("page text")
    claims = v["claims"] if isinstance(v.get("claims"), list) else []
    quote_claims = [c for c in claims if _isobj(c) and c.get("rule_id") == "QUOTE_MATCH" and isinstance(c.get("claim_id"), str) and c["claim_id"].startswith("source.")]
    if quote_claims:
        if not has:
            maybe.append("--quotes <file>")
        else:
            own = set(q if q.startswith("source.") else "source." + q for q in carried[ref])
            if any(c["claim_id"] not in own for c in quote_claims):
                needs.append("--quotes <file>")
                words.append("quotes")
    choices = v.get("choices") if isinstance(v.get("choices"), list) else []
    if any(_isobj(c) and _isobj(c.get("source")) and c["source"].get("by") == "judge" and isinstance(c.get("id"), str) for c in choices):
        needs.append("--supplied-choices <file>")
        words.append("the judge's choice values")
    seen = set()
    for a in v.get("archives") if isinstance(v.get("archives"), list) else []:
        if _isobj(a) and isinstance(a.get("matched"), str) and re.match(r"^archive_files\[[0-9]+\]", a["matched"]):
            seen.add(re.sub(r"^(archive_files\[[0-9]+\]).*\Z", r"\1", a["matched"], flags=re.S))
    if seen:
        needs.append("--archive-file <file>%s" % (" (×%d)" % len(seen) if len(seen) > 1 else ""))
        words.append("%d archive files" % len(seen) if len(seen) > 1 else "an archive file")
    return {"ruleset": ref, "needs": needs, "maybe": maybe, "issued_with": _list_of(words + ["an external extraction"])}


def replay_needs_sentence(n):
    maybe = ", and %s if it was issued with them (without its ruleset, the verdict alone cannot tell)" % _list_of(n["maybe"]) if n["maybe"] else ""
    return "this verdict was issued with %s under ruleset %s: pass %s%s" % (n["issued_with"], n["ruleset"], _list_of(n["needs"]), maybe)


# ---------------------------------------------------------------------------------------------------------------------
# A folder or a .jsonl of bundles (cli.ts runReplayCases, replay-case.ts bundlesFromText, replayBundle, replayBundles)

class _Unparseable(object):
    def __init__(self, reason):
        self.reason = reason


def bundles_from_text(name, text):
    def parse(label, t, first):
        if first and t.startswith("﻿"):
            return label, _Unparseable("file starts with a UTF-8 byte-order mark; remove it (save the file as UTF-8 without BOM)")
        deep = too_deep_offset(t)
        if deep >= 0:
            return label, _Unparseable("%s: nesting too deep, limit 256: an object or array opens more than 256 levels down (at character %d). "
                                       "No document, verdict or ruleset this engine reads nests that deep. Flatten it, then run it again" % (label, deep))
        err = v8_json_error(t)
        if err is not None:
            return label, _Unparseable("not JSON: %s" % err)
        x = _parse_value(t)
        try:
            _refuse_parsed(label, t, x, with_value=False)
        except Refused as e:
            return label, _Unparseable(str(e))
        return label, x
    if re.search(r"\.jsonl\Z", name, re.I | re.A):
        out = []
        for i, line in enumerate(re.split(r"\r?\n", text)):
            if line.strip(E._JS_WS) == "":
                continue
            out.append(parse("%s#%d" % (name, i + 1), line, i == 0))
        return out
    label, x = parse(name, text, True)
    if isinstance(x, _Unparseable):
        return [(label, x)]
    return [("%s[%d]" % (name, i), b) for i, b in enumerate(x)] if isinstance(x, list) else [(name, x)]


def replay_bundle_case(b, name, opts, verifier):
    """replayBundle: the case as a folder replay reports it."""
    if isinstance(b, _Unparseable):
        return {"name": name, "result": "REFUSED", "reason": b.reason}
    if not is_replay_bundle(b):
        return {"name": name, "result": "REFUSED", "reason": NOT_A_BUNDLE}
    env = b["verdict"] if is_envelope(b["verdict"]) else None
    verdict = env["verdict"] if env else b["verdict"]
    vid = {"verdict_id": verdict["verdict_id"]} if _isobj(verdict) and isinstance(verdict.get("verdict_id"), str) else {}
    if not opts["allow_unknown"]:
        kind, keys = unknown_keys(b)
        if keys:
            c = {"name": name, "result": "REFUSED"}
            c.update(vid)
            c.update(reason=unknown_keys_reason(kind, keys), unknown_keys=keys)
            return c
    options = {}
    if _isobj(b.get("options")):
        if _isobj(b["options"].get("tolerance")):
            options["tolerance"] = b["options"]["tolerance"]
        if isinstance(b["options"].get("document"), str):
            options["document"] = b["options"]["document"]
    r = verify_replay(verdict, b.get("inputs"), "inputs" in b, options, opts["lenient"])
    r.pop("_here_only", None)
    base = {"name": name, "result": "REFUSED"}
    base.update(vid)
    if r.get("refused"):
        base["reason"] = r.get("reason") or "not a verdict"
        return base
    if env:
        check = verify_envelope(env, verifier)
        if check is None:
            base.update(result="NOT_REPERFORMED", reason="can't tell here: the envelope's signature was not checked (no Ed25519 verifier is beside this build)")
            if r["status"] == "FAILED":
                base.update(result="DIVERGED", first_difference=(r.get("reperformed") or {}).get("first_difference") or ("input_hash" if r["id_ok"] else "verdict_id"),
                            reason=r.get("reason") or "the verdict does not replay")
            return base
        base["signature_ok"] = check[0]
        if not check[0]:
            base.update(result="DIVERGED", first_difference="signature", reason=check[1] or "the envelope's signature does not verify")
            return base
    if opts["trust"] is not None:
        if not env:
            base.update(result="DIVERGED", first_difference="signature", reason="the verdict is not signed, and --trusted-key requires a signature by the trusted key")
            return base
        m = trust_match(opts["trust"], env["public_key"])
        if m == "older":
            opts["_older"].append(key_fingerprint(env["public_key"]) or "")
        if m is None:
            base.update(result="DIVERGED", first_difference="signature", reason="the envelope is signed by a key that is not the trusted key: its signature verifies, but it proves only that the holder of that other key issued the verdict")
            return base
    if r.get("reperformed"):
        base["engine"] = r["reperformed"]["engine"]
    if r["status"] == "FAILED":
        fd = (r.get("reperformed") or {}).get("first_difference")
        base.update(result="DIVERGED", first_difference=fd if fd else ("input_hash" if r["id_ok"] else "verdict_id"), reason=r.get("reason") or "the verdict does not replay")
        return base
    if r["status"] != "REPERFORMED":
        base.update(result="NOT_REPERFORMED", reason=r.get("not_reperformed") or "not re-performed")
        return base
    rr = r["reperformed"]
    claims = verdict["claims"] if isinstance(verdict.get("claims"), list) else []
    base.update(result="MATCH", answer=verdict["outcome"])
    if rr.get("remedies") is not None:
        base["remedies"] = rr["remedies"]
    if rr.get("remedies_not_carried"):
        base["remedies_not_carried"] = True
    base.update(checks=len(claims), unchecked=sum(1 for c in claims if _isobj(c) and c.get("outcome") == "INSUFFICIENT_DATA"))
    if opts["strict"]:
        base["strict_problems"] = strict_problems(verdict, bool(rr.get("remedies_not_carried")), env is not None and opts["trust"] is None,
                                                  carried_keys(b, ap_checked=ap_derived_keys_in(b) != [] and ap_derivable(b)))
        notes = strict_notes(verdict, env is not None and opts["trust"] is not None)
        if notes:
            base["strict_notes"] = notes
    return base


def _node_join(a, b):
    """path.join: the parts joined and normalized (on Windows with backslashes)."""
    return os.path.normpath(os.path.join(a, b))


def run_replay_cases(path, is_dir, opts, verifier):
    items, skipped = [], []
    if is_dir:
        entries = sorted(os.listdir(path), key=lambda n: n.encode("utf-16-be", "surrogatepass"))
    else:
        entries = [path]
    for n in entries:
        fp = _node_join(path, n) if is_dir else n
        if is_dir and os.path.isdir(fp):
            skipped.append(n)
            continue
        if is_dir and not re.search(r"\.jsonl?\Z", n, re.I | re.A):
            continue
        name = re.sub(r"^[\\/]+", "", fp[len(path):]) if is_dir else fp  # cli.ts: fp.slice(path.length), leading separators off
        try:
            text = read_text(fp)
        except Refused as e:
            items.append((name, _Unparseable(str(e))))
            continue
        items.extend(bundles_from_text(name, text))
    items = [(nm, _Unparseable(replay_advice(b.reason)) if isinstance(b, _Unparseable) else b) for nm, b in items]
    if not items:
        extra = ""
        if skipped:
            extra = "; it holds the folder(s) %s, which a folder replay does not walk: replay each on its own (%s replay %s)" % (
                ", ".join("%s/" % s for s in skipped), _invoked_as(), _node_join(path, skipped[0]))
        return 3, "", "verify replay: %s holds no bundles (*.json or *.jsonl)%s\n%s\n" % (path, extra, _see_help())
    opts = dict(opts)
    opts["_older"] = []
    cases = [replay_bundle_case(b, nm, opts, verifier) for nm, b in items]
    fields, carried_map, allowed_map = {}, {}, {}
    for (nm, b), c in zip(items, cases):
        if isinstance(b, _Unparseable):
            continue
        if c["result"] == "MATCH":
            pv = (b["verdict"]["verdict"] if is_envelope(b["verdict"]) else b["verdict"]) if is_replay_bundle(b) else None
            f = not_reperformed_fields(pv)
            if f:
                fields[c["name"]] = f
        ap_checked = c["result"] == "MATCH" or (c["result"] == "DIVERGED" and c.get("first_difference") in AP_DERIVED_KEYS)
        k = carried_keys(b, ap_checked=ap_checked) if is_replay_bundle(b) and "unknown_keys" not in c else []
        if k:
            carried_map[c["name"]] = k
        a = allowed_keys(b)
        if a:
            allowed_map[c["name"]] = a
    count = lambda r: sum(1 for c in cases if c["result"] == r)  # noqa: E731
    s = {"total": len(cases), "matched": count("MATCH"), "diverged": count("DIVERGED"), "not_reperformed": count("NOT_REPERFORMED"),
         "refused": count("REFUSED"), "cases": cases}
    if fields:
        s["fields_not_reperformed"] = fields
    if opts["strict"]:
        s["strict_failed"] = sum(1 for c in cases if c.get("strict_problems"))
    if carried_map:
        s["carried_not_checked"] = carried_map
    if allowed_map:
        s["carried_allowed"] = allowed_map
    if opts["allow_unknown"]:
        s["allow_unknown_keys"] = "stated"
    summary = dict(s)
    if skipped:
        summary["skipped_folders"] = skipped
    out = _js_pretty(summary) + "\n"
    err = []
    for (nm, b), c in zip(items, cases):
        verdict = None
        if not isinstance(b, _Unparseable) and is_replay_bundle(b):
            verdict = b["verdict"]["verdict"] if is_envelope(b["verdict"]) else b["verdict"]
        hint = None
        if c["result"] == "REFUSED" and is_dir and "#" not in c["name"] and not isinstance(b, _Unparseable) and _isobj(b):
            hint = _not_a_bundle_hint(b, _node_join(path, c["name"]))
        err.append(_render_case(c, verdict, fields.get(c["name"], []), carried_map.get(c["name"], []), allowed_map.get(c["name"], []), hint) + "\n")
    for d in skipped:
        err.append("SKIPPED         %s/\n    a folder: a folder replay does not walk into folders. Replay it on its own: %s replay %s\n" % (d, _invoked_as(), _node_join(path, d)))
    seen = []
    for fp in opts["_older"]:
        if fp not in seen:
            seen.append(fp)
            err.append(older_form_note(fp or None))
    if opts["allow_unknown"]:
        err.append("verify replay: %s\n" % ALLOW_UNKNOWN_KEYS_LINE)
    err.append("verify replay: %d case(s): %d match · %d diverged · %d not re-performed · %d refused\n" % (
        s["total"], s["matched"], s["diverged"], s["not_reperformed"], s["refused"]))
    if opts["strict"] and s["strict_failed"] > 0:
        err.append("verify replay: STRICT: FAILED: %d matching case(s) carry something that was not re-performed (each is listed above)\n" % s["strict_failed"])
    code = 3 if s["refused"] else (1 if s["diverged"] or s.get("strict_failed", 0) else (2 if s["not_reperformed"] else 0))
    return code, out, "".join(err)


def _not_a_bundle_hint(bundle, path):
    verdict = bundle["verdict"] if is_envelope(bundle) else bundle
    if _isobj(verdict) and isinstance(verdict.get("verdict_id"), str) and isinstance(verdict.get("input_hash"), str):
        n = declarative_replay_needs(verdict)
        flags = " ".join(re.sub(r" \(or its file\)\Z", "", x) for x in n["needs"]) if n else "--inputs <inputs.json>"
        return "this is a verdict%s without its inputs, not a bundle. Replay it on its own: %s replay %s %s" % (
            " (a signed envelope)" if is_envelope(bundle) else "", _invoked_as(), path, flags)
    if "verdict" not in bundle and "claims" not in bundle:
        return ("this looks like an extraction, not a bundle: check it with %s check %s --ruleset <name | file>, or give it to a verdict's "
                "replay with --extraction %s" % (_invoked_as(), path, path))
    return None


# ---------------------------------------------------------------------------------------------------------------------
# The command line (cli.ts parseFlags with REPLAY_FLAGS, usageError, inputError)

REPLAY_FLAGS = [("inputs", "value"), ("extraction", "value"), ("ruleset", "value"), ("contract", "value"), ("evidence", "multi"),
                ("history", "multi"), ("source", "value"), ("quotes", "value"), ("tolerance", "value"), ("document", "value"),
                ("pre", "value"), ("filing-summary", "value"), ("schema", "value"), ("archive-file", "multi"),
                ("supplied-choices", "value"), ("trusted-key", "value"), ("strict", "bool"), ("invoice", "value"), ("po", "value"),
                ("receipt", "value"), ("lenient-remedies", "bool"), ("require-ruleset", "multi"), ("allow-unknown-keys", "bool")]
# the flags this build reads; the others the engine takes build inputs from documents or check a rule floor, which this build
# does not do, and it says so instead of ignoring them
TAKEN = ("trusted-key", "strict", "lenient-remedies", "allow-unknown-keys")


def _invoked_as():
    try:
        shown = os.path.relpath(os.path.abspath(__file__)).replace(os.sep, "/")
    except ValueError:  # another drive on Windows
        shown = os.path.abspath(__file__)
    return "python3 %s" % (rb.js_string(shown) if re.search(r"[\s\"'$`&|;()<>]", shown) else shown)


def _see_help():
    return "see: %s replay --help" % _invoked_as()


def _edit_distance(a, b):
    d = [[i] + [0] * len(b) for i in range(len(a) + 1)]
    for j in range(1, len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (0 if a[i - 1] == b[j - 1] else 1))
    return d[len(a)][len(b)]


def _did_you_mean(unknown, known):
    name = re.sub(r"=[\s\S]*\Z", "", unknown)
    best, best_d = None, 3
    for k in known:
        dd = _edit_distance(name, k)
        if dd < best_d:
            best, best_d = k, dd
    return " (did you mean %s?)" % best if best is not None and best != name else ""


def parse_flags(argv0):
    argv = []
    for t in argv0:
        if re.match(r"^--[A-Za-z][A-Za-z0-9_-]*=", t):
            argv += [t[:t.index("=")], t[t.index("=") + 1:]]
        else:
            argv.append(t)
    spec = dict(REPLAY_FLAGS)
    f = {"v": {}, "on": set(), "multi": {}, "args": [], "help": False, "problems": []}
    unknown, after_unknown, i = [], False, 0
    while i < len(argv):
        t = argv[i]
        if t in ("-h", "--help"):
            f["help"] = True
            after_unknown = False
            i += 1
            continue
        name = t[2:] if t.startswith("--") else ""
        kind = spec.get(name) if name else None
        if not kind:
            if after_unknown and not t.startswith("-"):
                after_unknown = False
                i += 1
                continue
            if not t.startswith("-") or t == "-":
                if len(f["args"]) < 1:
                    f["args"].append(t)
                else:
                    f["problems"].append("unexpected argument %s" % t)
                i += 1
                continue
            unknown.append(t)
            after_unknown = t.startswith("--")
            i += 1
            continue
        after_unknown = False
        if kind != "multi" and (name in f["v"] or name in f["on"]):
            f["problems"].append("%s is given twice" % t)
        if kind == "bool":
            f["on"].add(name)
            i += 1
            continue
        val = argv[i + 1] if i + 1 < len(argv) else None
        if val is None or (val.startswith("--") and not val.startswith("-----BEGIN ")):
            f["problems"].append("%s needs a value" % t)
            i += 1
            continue
        if kind == "multi":
            f["multi"].setdefault(name, []).append(val)
        else:
            f["v"][name] = val
        i += 2
    if unknown:
        known = ["--%s" % k for k, _ in REPLAY_FLAGS] + ["--help"]
        f["problems"].insert(0, "unknown option(s) %s" % ", ".join("%s%s" % (u, _did_you_mean(u, known)) for u in unknown))
    return f


HELP = """python3 conformance/engine_py/cli.py replay <bundle.json | verdict.json | envelope.json | cases.jsonl | folder>
              [--strict] [--trusted-key <public.pem | keygen.json | 64-hex fingerprint | inline PEM>] [--lenient-remedies]
              [--allow-unknown-keys]
    the replay contract (docs/REPLAY.md), in Python: a verdict of the built-in invoice ruleset (invoice@0.1.0) is re-performed
    under the engine version it names and compared byte for byte; anything else is checked for structure, and the line says it
    was not re-performed (exit 2). The first line and the exit code are the engine's own for every answer this build gives:
    the refusals before hashing, a key a bundle or a signed envelope does not define (--allow-unknown-keys carries it), an
    annotation member outside its declared shape, the binding, deleted remedies (--lenient-remedies), --strict and
    --trusted-key. A signed envelope's signature is checked only when an Ed25519 verifier is beside this file
    (conformance/engine_py/record); without one the replay says it cannot tell. It takes none of the engine's flags that
    build inputs from documents (--inputs, --extraction, --ruleset, --source, ...) or set a rule floor (--require-ruleset).
    Exit 0 VERIFIED · 1 FAILED · 2 structure verified, outcome NOT re-performed · 3 refused, unreadable, or a usage error"""


def main(argv, out=None, err=None):
    out = out or sys.stdout
    err = err or sys.stderr
    args = list(argv)
    verb = args.pop(0) if args else None
    if verb in ("-h", "--help", None):
        err.write(HELP + "\n")
        return 0 if verb else 3
    if verb != "replay":
        err.write("verify: %s is not a command this build takes: it takes replay\n%s\n" % (verb, _see_help()))
        return 3
    try:
        code, o, e = run(args)
    except Exception as x:  # noqa: BLE001  (an error this build does not handle never reads as FAILED, exit 1, or as a match)
        code, o, e = 3, "", ("verify replay: input refused: this build stopped on an error it does not handle (%s: %s); nothing was "
                             "verified\n" % (type(x).__name__, x))
    out.write(o)
    err.write(e)
    return code


def run(args):
    """(exit, stdout, stderr) for `replay <args>`."""
    f = parse_flags(args)
    if f["help"]:
        return 0, "", HELP + "\n"
    if f["problems"]:
        return 3, "", "verify replay: %s\n%s\n" % ("; ".join(f["problems"]), _see_help())
    if not f["args"]:
        return 3, "", ("verify replay: needs <verdict.json> (a verdict, a signed envelope, or a bundle), a cases.jsonl, or a folder of "
                       "bundles\n%s\n" % HELP)
    file_arg = f["args"][0]
    trust = None
    if "trusted-key" in f["v"]:
        try:
            trust = read_trusted_key_arg(f["v"]["trusted-key"])
        except Refused as e:
            return 3, "", "verify replay: error reading input: %s\n" % e
    not_taken = ["--%s" % k for k, _ in REPLAY_FLAGS if k not in TAKEN and (k in f["v"] or k in f["multi"])]
    if not_taken:
        return 3, "", ("verify replay: this build does not take %s: it replays a bundle, a verdict or an envelope as the file carries "
                       "it, and builds no inputs from documents and sets no rule floor (the engine's own command does)\n%s\n"
                       % (", ".join(not_taken), _see_help()))
    opts = {"strict": "strict" in f["on"], "lenient": "lenient-remedies" in f["on"], "allow_unknown": "allow-unknown-keys" in f["on"],
            "trust": trust}
    verifier = _ed25519_verifier()
    is_dir = file_arg != "-" and os.path.isdir(file_arg)
    if is_dir or re.search(r"\.jsonl\Z", file_arg, re.I | re.A):
        return run_replay_cases(file_arg, is_dir, opts, verifier)
    return run_replay_one(file_arg, opts, verifier)


if __name__ == "__main__":
    # UTF-8 whatever the console or pipe encoding is, line ends as LF, as engine.py writes them, so the two engines' bytes compare
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")
    sys.exit(main(sys.argv[1:]))
