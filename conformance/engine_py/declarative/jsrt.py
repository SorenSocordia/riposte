# JavaScript semantics the declarative interpreter depends on, in Python. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
The Node engine's verdict bytes depend on how JavaScript writes numbers, trims text, rounds, slices UTF-16 strings, orders an
object's keys and matches Unicode classes in a regular expression. This module states each of those once. The canonical JSON,
the number writer and the string writer are imported from conformance/riposte_bind.py, unchanged; JSON.stringify(v, null, 2)
is engine.py's `pretty`, unchanged. What is added here is only what the invoice engine did not need.
"""

import copy
import math
import os
import re
import sys
import unicodedata
from decimal import Decimal, ROUND_HALF_UP

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_PY = os.path.dirname(HERE)
for _p in (os.path.dirname(ENGINE_PY), ENGINE_PY, HERE):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import riposte_bind as rb  # noqa: E402  (canonical JSON, the number and string writers: imported unchanged)
import engine as E  # noqa: E402  (JSON.stringify(v, null, 2), Object.keys order: imported unchanged)


class _Undefined(object):
    """JavaScript's undefined: a key or value that is not there, never the same as null (None)."""

    _one = None

    def __new__(cls):
        if cls._one is None:
            cls._one = object.__new__(cls)
        return cls._one

    def __repr__(self):
        return "undefined"

    def __bool__(self):
        return False


UNDEF = _Undefined()

# ECMAScript WhiteSpace and LineTerminator: what `\s` matches and what String.prototype.trim removes.
JS_WS = "\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
S = "[\\t\\n\\x0b\\x0c\\r \\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]"  # JavaScript \s, for a pattern
S_IN = "\\t\\n\\x0b\\x0c\\r \\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"  # the same, inside [...]
LINE_END = "\n\r\u2028\u2029"  # what a JavaScript `.` (no s flag) does not match


def trim(s):
    return s.strip(JS_WS)


def is_num(x):
    return type(x) in (float, int)


def is_str(x):
    return isinstance(x, str)


def is_obj(x):
    """x !== null && typeof x === 'object' && !Array.isArray(x)"""
    return isinstance(x, dict)


def truthy(v):
    if v is None or v is False or v is UNDEF:
        return False
    if is_num(v):
        return v != 0 and not math.isnan(v)
    if isinstance(v, str):
        return v != ""
    return True


# ---------------------------------------------------------------------------------------------------------------------
# Numbers

js_number = rb.js_number


def math_round(x):
    """Math.round: the nearest integer, a tie toward +infinity; NaN and the infinities as they are."""
    if not math.isfinite(x):
        return x
    f = math.floor(x)
    return float(f + 1 if x - f >= 0.5 else f)


def round4(x):
    return math_round(x * 1e4) / 1e4


def to_fixed(x, digits):
    """Number.prototype.toFixed(digits): the exact double, a tie rounded to the larger n."""
    if not math.isfinite(x) or abs(x) >= 1e21:
        return js_number(x) if math.isfinite(x) else ("NaN" if math.isnan(x) else ("Infinity" if x > 0 else "-Infinity"))
    neg = x < 0
    s = str(Decimal(abs(x)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))
    return ("-" if neg else "") + s


def round9(x):
    """Number(x.toFixed(9))"""
    return number_of(to_fixed(x, 9))


_DEC_LITERAL = re.compile(r"[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)\Z")
_FLOAT_PREFIX = re.compile(r"[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)")


def number_of(s):
    """Number(string): StringToNumber (white space trimmed; "" is 0; a decimal, 0x/0o/0b, Infinity; else NaN)."""
    t = trim(s)
    if t == "":
        return 0.0
    m = re.match(r"0([xXoObB])([0-9A-Fa-f]+)\Z", t)
    if m:
        base = {"x": 16, "o": 8, "b": 2}[m.group(1).lower()]
        try:
            return float(int(m.group(2), base))
        except ValueError:
            return math.nan
    if _DEC_LITERAL.match(t):
        try:
            return float(t)
        except OverflowError:
            return math.inf if not t.startswith("-") else -math.inf
    return math.nan


def parse_float(s):
    """parseFloat: the longest decimal literal at the start (after leading white space), else NaN."""
    m = _FLOAT_PREFIX.match(s.lstrip(JS_WS))
    if not m:
        return math.nan
    try:
        return float(m.group(0))
    except OverflowError:
        return math.inf


def parse_int10(s):
    """parseInt(s, 10) for a string of ASCII digits (all the callers pass)."""
    return float(int(s))


# ---------------------------------------------------------------------------------------------------------------------
# Strings

js_string = rb.js_string


def utf16_len(s):
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def slice16(s, start, end=None):
    """s.slice(start, end), counted in UTF-16 code units (start, end >= 0)."""
    b = s.encode("utf-16-le", "surrogatepass")
    b = b[2 * start:] if end is None else b[2 * start:2 * end]
    return b.decode("utf-16-le", "surrogatepass")


def units(s):
    """A string as its UTF-16 code units, one Python character each (a non-BMP character becomes its two surrogates), so
    indexing, slicing and searching count as JavaScript counts."""
    out = []
    for ch in s:
        c = ord(ch)
        if c > 0xFFFF:
            c -= 0x10000
            out.append(chr(0xD800 + (c >> 10)))
            out.append(chr(0xDC00 + (c & 0x3FF)))
        else:
            out.append(ch)
    return "".join(out)


def from_units(u):
    """The inverse of units(): surrogate pairs joined again; a lone surrogate stays as it is."""
    return u.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass")


def js_str(v):
    """String(v) for the values the interpreter holds."""
    if v is UNDEF:
        return "undefined"
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if is_num(v):
        return js_number(float(v))
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ",".join("" if (x is None or x is UNDEF) else js_str(x) for x in v)
    return "[object Object]"


def keys(o):
    """Object.keys order: array-index keys ascending, then the rest in insertion order."""
    return E.js_keys(o)


def entries(o):
    return [(k, o[k]) for k in E.js_keys(o)]


def stringify(v):
    """JSON.stringify(v): compact, keys in Object.keys order; undefined dropped from objects, null in arrays; a non-finite number
    is null. Returns UNDEF for a top-level undefined (JSON.stringify returns undefined)."""
    if v is UNDEF:
        return UNDEF
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if is_num(v):
        return js_number(float(v))
    if isinstance(v, str):
        return js_string(v)
    if isinstance(v, (list, tuple)):
        return "[" + ",".join("null" if x is UNDEF else stringify(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(js_string(k) + ":" + stringify(v[k]) for k in E.js_keys(v) if v[k] is not UNDEF) + "}"
    raise TypeError("not a JSON value: %r" % (v,))


def pretty(v):
    """JSON.stringify(v, null, 2)"""
    return E.pretty(E._fix_ints(v))


def canonical(v):
    """verdict/canonical.ts canonicalize (keys sorted; the sha256 of it is hashOf)."""
    return rb.canonical_json(_floats(v))


def hash_of(v):
    return rb.sha256_hex(canonical(v))


def sha256(text):
    return rb.sha256_hex(text)


def _floats(v):
    if isinstance(v, dict):
        return {k: _floats(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_floats(x) for x in v]
    if type(v) is int:
        return float(v)
    return v


def clone(v):
    """structuredClone"""
    return copy.deepcopy(v)


# ---------------------------------------------------------------------------------------------------------------------
# Unicode general categories, for the regular expressions Node writes with \p{...} (the 'u' flag). Built once from this
# Python's Unicode tables (13.0 on Python 3.10, 15.0 on 3.12; Node carries its ICU's): a character assigned after 13.0 may be
# classed differently on 3.10, which README.md states.

_CLASSES = {}


def _esc(cp):
    return "\\U%08x" % cp


_REGEX_CATS = ("Nd", "Sc")


def _build_classes():
    """One pass over the code points below U+20000, for the categories a pattern needs as a class (Nd, Sc). Planes 2 and up
    hold ideographs, tags and private use: no decimal digit and no currency sign is assigned there."""
    found = {c: [] for c in _REGEX_CATS}
    open_ = {c: None for c in _REGEX_CATS}
    cat = unicodedata.category
    for cp in range(0x20000):
        c = cat(chr(cp))
        for k in _REGEX_CATS:
            if c == k:
                if open_[k] is None:
                    open_[k] = [cp, cp]
                else:
                    open_[k][1] = cp
            elif open_[k] is not None and open_[k][1] == cp - 1:
                found[k].append(tuple(open_[k]))
                open_[k] = None
    for k in _REGEX_CATS:
        if open_[k] is not None:
            found[k].append(tuple(open_[k]))
        _CLASSES[k] = "".join(_esc(a) if a == b else "%s-%s" % (_esc(a), _esc(b)) for a, b in found[k])


def uclass(cat):
    """A regex character-class BODY (no brackets) for one general category this module builds (Nd or Sc)."""
    if not _CLASSES:
        _build_classes()
    return _CLASSES[cat]


_CAT = {}


def category_is(ch, *cats):
    """unicodedata.category(ch) is one of `cats` (a one-letter name matches its whole class: 'L' every L*)."""
    c = _CAT.get(ch)
    if c is None:
        c = _CAT[ch] = unicodedata.category(ch)
    for x in cats:
        if c == x or c[0] == x:
            return True
    return False
