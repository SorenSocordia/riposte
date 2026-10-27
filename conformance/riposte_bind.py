# Binding verifier for Riposte verdicts: it recomputes input_hash and verdict_id, and it does NOT re-perform the check.
# SPDX-License-Identifier: Apache-2.0
"""
A one-file reference verifier for the verdict interchange (docs/INTERCHANGE.md), in Python, standard library only.

It reads one replay bundle ({ "verdict": <verdict or envelope>, "inputs": <inputs>, "options"?: {...} }), applies the
refusals before hashing, recomputes input_hash from the inputs and verdict_id from the identity parts, and says whether the
binding holds. It never runs a ruleset, so it can never say VERIFIED: a verdict with its outcome flipped keeps a valid
binding, and only a re-performing verifier (node packages/verify/dist/cli.js replay) catches that. It does not check a
signed envelope's signature.

    python3 conformance/riposte_bind.py <bundle.json>

Exit codes, on the replay's scale (docs/INTERCHANGE.md, section 13):
    1  the binding fails: input_hash or verdict_id does not recompute, or the inputs cannot be bound as given
    2  the binding holds; the outcome was not re-performed
    3  refused before hashing, not a bundle or a verdict, a malformed issued_at, or outside what this verifier binds
It never exits 0. The JSON result goes to stdout; the lines a person reads go to stderr.
"""

import calendar
import hashlib
import json
import math
import re
import sys
from decimal import Decimal

FIRST_LINE = "binding only: input_hash and verdict_id recomputed; the check is not re-performed"
MAX_DEPTH = 256
MAX_ARRAY_INDEX = 4294967294
ISO_INSTANT = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,9})?)?(?:Z|[+-]([0-9]{2}):([0-9]{2}))\Z")  # [0-9], not \d: Python's \d matches other scripts' digits (2026-10-20)
NUMBER_TOKEN = re.compile(r"^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?\Z")
# \Z, not $: Python's $ also matches before a final newline, JavaScript's does not; "5\n" is not an array index (2026-10-20)
INDEX_KEY = re.compile(r"^(?:0|[1-9][0-9]*)\Z")
UNBOUND_REMEDY_ENGINES = ("0.0.1", "0.1.0")


class Refused(Exception):
    """An input the hash contract cannot bind faithfully, or a file that is not a bundle (exit 3)."""


class Unbindable(Exception):
    """Inputs that parse but cannot be bound as given (exit 1, as the replay FAILS them)."""


# ---------------------------------------------------------------------------------------------------------------------
# Reading under the hash contract


def _decode(data, name):
    try:
        return data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as e:
        shown = " ".join("%02X" % b for b in data[e.start:e.start + 4])
        raise Refused("%s is not valid UTF-8: the bytes at offset %d (%s) are not a UTF-8 character" % (name, e.start, shown))


def _too_deep_offset(text, limit=MAX_DEPTH):
    depth, in_string, i, n = 0, False, 0, len(text)
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
                return i
        elif c in "}]":
            depth -= 1
        i += 1
    return -1


def _reduced_decimal(text):
    m = NUMBER_TOKEN.match(text)
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


class _Reader:
    """Parses JSON text the way the engine reads it: numbers as doubles, duplicate keys, non-finite and inexact numbers refused."""

    def __init__(self, name):
        self.name = name

    def number(self, text):
        try:
            x = float(text)
        except OverflowError:
            x = math.inf
        if math.isinf(x) or math.isnan(x):
            raise Refused("%s: the number %s is not finite" % (self.name, text))
        a = _reduced_decimal(text)
        b = _reduced_decimal(js_number(x))
        if a != b:
            raise Refused(
                "%s: the number %s is a number that cannot be represented exactly; write amounts as strings with two decimals "
                "(it reads as %s)" % (self.name, text, js_number(x)))
        return x

    def pairs(self, pairs):
        out = {}
        for k, v in pairs:
            if k in out:
                raise Refused('%s: the key "%s" appears twice in one object' % (self.name, k))
            out[k] = v
        return out

    def constant(self, text):
        raise Refused("%s: not valid JSON: %s is not a JSON value" % (self.name, text))


def read_json_bytes(data, name="input"):
    """Bytes to a parsed value, or Refused: invalid UTF-8, a byte-order mark, nesting past 256, not JSON, a repeated key, a
    number past the double range, a number no double holds exactly."""
    text = _decode(data, name)
    if text.startswith("﻿"):
        raise Refused("%s: file starts with a UTF-8 byte-order mark; remove it" % name)
    at = _too_deep_offset(text)
    if at >= 0:
        raise Refused("%s: nesting too deep, limit %d: an object or array opens more than %d levels down (at character %d)"
                      % (name, MAX_DEPTH, MAX_DEPTH, at))
    r = _Reader(name)
    try:
        return json.loads(text, object_pairs_hook=r.pairs, parse_float=r.number, parse_int=r.number,
                          parse_constant=r.constant)
    except json.JSONDecodeError as e:
        raise Refused("%s: not valid JSON: %s" % (name, e))


# ---------------------------------------------------------------------------------------------------------------------
# Canonical JSON (docs/INTERCHANGE.md, section 3)


def js_number(x):
    """A double as ECMAScript's Number-to-String writes it: the shortest form that reads back exactly."""
    if x == 0:
        return "0"
    if math.isnan(x) or math.isinf(x):
        return "null"
    sign = "-" if x < 0 else ""
    t = Decimal(repr(abs(x))).as_tuple()
    digits = "".join(str(d) for d in t.digits)
    exp = t.exponent
    stripped = digits.rstrip("0")
    exp += len(digits) - len(stripped)
    digits = stripped.lstrip("0") or "0"
    k = len(digits)
    n = k + exp  # the value is 0.d1d2...dk x 10^n
    if k <= n <= 21:
        body = digits + "0" * (n - k)
    elif 0 < n <= 21:
        body = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        body = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        mant = digits if k == 1 else digits[0] + "." + digits[1:]
        body = mant + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return sign + body


_ESCAPES = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}


def js_string(s):
    """A string as JSON.stringify writes it: quote, backslash and control characters escaped, a lone surrogate as \\udxxx."""
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch in _ESCAPES:
            out.append(_ESCAPES[ch])
        elif o < 0x20 or 0xD800 <= o <= 0xDFFF:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _key_order(keys):
    index = sorted((k for k in keys if INDEX_KEY.match(k) and int(k) <= MAX_ARRAY_INDEX), key=int)
    taken = set(index)
    rest = sorted((k for k in keys if k not in taken), key=lambda k: k.encode("utf-16-be", "surrogatepass"))
    return index + rest


def canonical_json(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return js_number(float(v))
    if isinstance(v, str):
        return js_string(v)
    if isinstance(v, list):
        return "[" + ",".join(canonical_json(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(js_string(k) + ":" + canonical_json(v[k]) for k in _key_order(list(v.keys()))) + "}"
    raise TypeError("not a JSON value: %r" % (v,))


def sha256_hex(text):
    return hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()


# ---------------------------------------------------------------------------------------------------------------------
# The inputs as input_hash identifies them (docs/INTERCHANGE.md, section 4)


def _is_obj(x):
    return isinstance(x, dict)


def _is_declarative_ruleset(x):
    # a ruleset object with no "compute", whose "fields" is present and an object, a list or null, and whose "checks" is a list
    return _is_obj(x) and "compute" not in x and "fields" in x and (x["fields"] is None or isinstance(x["fields"], (dict, list))) \
        and isinstance(x.get("checks"), list)


def _strip_remedy(entry):
    if _is_obj(entry) and "remedy" in entry:
        return {k: v for k, v in entry.items() if k != "remedy"}
    return entry


def ruleset_identity(rs):
    """The declarative ruleset as its identity binds it: the "remedy" key removed from each entry of checks and quotes."""
    block = rs.get("algorithms")
    if _is_obj(block):
        raise Refused("the ruleset names pinned algorithms; their identity needs the engine's registry pins, which this verifier "
                      "does not reconstruct (outside what this verifier binds)")
    out = dict(rs)
    if any(_is_obj(c) and "remedy" in c for c in rs["checks"]):
        out["checks"] = [_strip_remedy(c) for c in rs["checks"]]
    if isinstance(rs.get("quotes"), list) and any(_is_obj(c) and "remedy" in c for c in rs["quotes"]):
        out["quotes"] = [_strip_remedy(c) for c in rs["quotes"]]
    return out


def _tolerance_problem(t):
    if not _is_obj(t):
        return "not an object"
    for k in t:
        if k not in ("rel", "absCap", "rounding", "roundingCap"):
            return "an unknown key %s" % k
    for k in ("rel", "absCap"):
        v = t.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
            return "%s is not a finite number of at least 0" % k
    if "rounding" in t and t["rounding"] not in ("infer", "none"):
        return 'rounding is not "infer" or "none"'
    if "roundingCap" in t:
        rc = t["roundingCap"]
        if not _is_obj(rc):
            return "roundingCap is not an object"
        for k in rc:
            if k not in ("perLine", "cashStep"):
                return "roundingCap has an unknown key %s" % k
            if not isinstance(rc[k], list) or not all(isinstance(x, str) for x in rc[k]):
                return "roundingCap.%s is not a list of rule-id strings" % k
    return None


def _tolerance_identity(t):
    out = {}
    for k in ("rel", "absCap", "rounding"):
        if k in t:
            out[k] = t[k]
    if "roundingCap" in t:
        rc = t["roundingCap"]
        out["roundingCap"] = {"perLine": list(rc.get("perLine", [])), "cashStep": list(rc.get("cashStep", []))}
    return out


def _takes_tolerance(inputs):
    return _is_obj(inputs) and "extraction" in inputs and ("references" in inputs or _is_declarative_ruleset(inputs.get("ruleset")))


def bound_inputs(inputs, options):
    """The object input_hash covers: the inputs, a restated tolerance override added, a declarative ruleset's remedies set aside."""
    restated = options.get("tolerance") if _is_obj(options) else None
    if restated is not None:
        p = _tolerance_problem(restated)
        if p:
            raise Unbindable("the restated rounding-tolerance override is not one an engine reads exactly as its identity hashes it (%s)" % p)
    if _takes_tolerance(inputs) and "tolerance" in inputs:
        p = _tolerance_problem(inputs["tolerance"])
        if p:
            raise Unbindable("the inputs' rounding-tolerance override is not one an engine reads exactly as its identity hashes it (%s)" % p)
    out = inputs
    if restated is not None and _takes_tolerance(inputs) and "tolerance" not in inputs:
        out = dict(inputs)
        out["tolerance"] = _tolerance_identity(restated)
    if _is_obj(out) and _is_declarative_ruleset(out.get("ruleset")):
        out = dict(out)
        out["ruleset"] = ruleset_identity(out["ruleset"])
    return out


# ---------------------------------------------------------------------------------------------------------------------
# The binding


def derive_verdict_id(input_hash, ruleset, engine_version, remedy_table_hash=None):
    base = "%s:%s@%s:%s" % (input_hash, ruleset["id"], ruleset["version"], engine_version)
    if remedy_table_hash is not None:
        base += ":" + remedy_table_hash
    return sha256_hex(base)[:32]


def _issued_at_problem(v):
    m = ISO_INSTANT.match(v) if isinstance(v, str) else None
    bad = "issued_at is not an ISO-8601 timestamp: %s" % json.dumps(v)
    if not m:
        return bad
    y, mo, d, h, mi = (int(m.group(i)) for i in range(1, 6))
    s, oh, om = (int(m.group(i) or 0) for i in (6, 7, 8))
    if not 1 <= mo <= 12:
        return bad
    if not 1 <= d <= calendar.monthrange(y, mo)[1] or h > 23 or mi > 59 or s > 59 or oh > 23 or om > 59:
        return bad
    return None


def _is_envelope(x):
    return _is_obj(x) and _is_obj(x.get("verdict")) and isinstance(x.get("signature"), str) and isinstance(x.get("public_key"), str)


def check_bundle(bundle):
    """A parsed bundle (or a bare verdict) to a result dict. Raises Refused for exit 3."""
    if not _is_obj(bundle):
        raise Refused("not a replay bundle: { \"verdict\": <verdict or envelope>, \"inputs\": <inputs>, \"options\"? }")
    has_inputs = False
    if _is_obj(bundle.get("verdict")) and not _is_envelope(bundle):
        verdict, has_inputs = bundle["verdict"], "inputs" in bundle
        inputs, options = bundle.get("inputs"), bundle.get("options")
    else:
        verdict, inputs, options = bundle, None, None
    envelope = _is_envelope(verdict)
    if envelope:
        verdict = verdict["verdict"]
    if not _is_obj(verdict):
        raise Refused("not a verdict")
    missing = [k for k in ("verdict_id", "input_hash", "engine_version") if not isinstance(verdict.get(k), str)]
    rs = verdict.get("ruleset")
    if not (_is_obj(rs) and isinstance(rs.get("id"), str) and isinstance(rs.get("version"), str)):
        missing.append("ruleset {id, version}")
    if missing:
        raise Refused("not a verdict: it lacks %s" % ", ".join(missing))
    if "issued_at" in verdict:
        p = _issued_at_problem(verdict["issued_at"])
        if p:
            raise Refused(p)

    rth = verdict.get("remedy_table_hash") if isinstance(verdict.get("remedy_table_hash"), str) else None
    computed_id = derive_verdict_id(verdict["input_hash"], rs, verdict["engine_version"], rth)
    result = {
        "binding": "holds", "reperformed": False,
        "recorded_input_hash": verdict["input_hash"], "computed_input_hash": None,
        "recorded_verdict_id": verdict["verdict_id"], "computed_verdict_id": computed_id,
        "signature_checked": False if envelope else None,
        "reasons": [],
    }
    if computed_id != verdict["verdict_id"]:
        result["binding"] = "fails"
        result["reasons"].append("verdict_id does not derive from input_hash + ruleset@version + engine_version%s (computed %s)"
                                 % (" + remedy_table_hash" if rth is not None else "", computed_id))
    elif rth is None and verdict["engine_version"] not in UNBOUND_REMEDY_ENGINES:
        result["binding"] = "fails"
        result["reasons"].append("a verdict of engine %s binds its remedy table, and this one carries no remedy_table_hash"
                                 % verdict["engine_version"])
    if not has_inputs:
        result["reasons"].append("no inputs were given, so input_hash was not recomputed")
        return result
    try:
        computed = sha256_hex(canonical_json(bound_inputs(inputs, options if _is_obj(options) else {})))
    except Unbindable as e:
        result["binding"] = "fails"
        result["reasons"].append(str(e))
        return result
    result["computed_input_hash"] = computed
    if computed != verdict["input_hash"]:
        result["binding"] = "fails"
        result["reasons"].append("input_hash does not match the supplied inputs")
    return result


def check_file(path):
    """A bundle file to (exit code, result dict)."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as e:
        return 3, {"binding": "refused", "reperformed": False, "reasons": ["cannot read %s: %s" % (path, e.strerror)]}
    try:
        result = check_bundle(read_json_bytes(data, path))
    except Refused as e:
        return 3, {"binding": "refused", "reperformed": False, "reasons": [str(e)]}
    return (2 if result["binding"] == "holds" else 1), result


def main(argv):
    # 2026-10-12 (integration): write UTF-8 whatever the console or pipe encoding is (cp1252 on Windows), so a character the
    # locale cannot write never raises and exits 1, which means "the binding fails"; backslashreplace keeps a lone surrogate
    # writable (as a JSON escape on stdout).
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    sys.stderr.write("riposte_bind: %s\n" % FIRST_LINE)
    if len(argv) != 1 or argv[0] in ("-h", "--help"):
        sys.stderr.write("usage: python3 conformance/riposte_bind.py <bundle.json>\n"
                         "exit 1 the binding fails, 2 the binding holds (outcome not re-performed), 3 refused; never 0\n")
        return 3
    code, result = check_file(argv[0])
    sys.stdout.write(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    if code == 2:
        sys.stderr.write("riposte_bind: binding holds: input_hash and verdict_id recompute; the outcome was not re-performed "
                         "(node packages/verify/dist/cli.js replay re-performs it)\n")
    elif code == 1:
        sys.stderr.write("riposte_bind: binding FAILS: %s\n" % "; ".join(result["reasons"]))
    else:
        sys.stderr.write("riposte_bind: refused: %s\n" % "; ".join(result["reasons"]))
    for r in result.get("reasons", []) if code == 2 else []:
        sys.stderr.write("riposte_bind: note: %s\n" % r)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
