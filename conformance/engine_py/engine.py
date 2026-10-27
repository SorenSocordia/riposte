# A second engine for invoice@0.1.0 in Python: it re-performs the checks and issues the verdict. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
Issues the verdict `node packages/verify/dist/cli.js <extraction.json>` issues for the built-in invoice ruleset
(invoice@0.1.0, engine 0.7.1), byte for byte, from a second implementation in Python (standard library only). The hashing
and the binding are imported unchanged from conformance/riposte_bind.py. See SPEC.md beside this file.

    python3 conformance/engine_py/engine.py issue <extraction.json> [--issued-at <ISO-8601 timestamp>]

Exit codes (the engine's own `check` scale): 0 PASS · 1 FAIL · 2 PASS-WITH-OPEN or can't tell · 3 refused, a usage error, or
outside what this build re-performs (named, never guessed).
"""

import datetime
import json
import math
import os
import re
import sys
import unicodedata

sys.dont_write_bytecode = True  # importing the binding verifier must not write a cache beside it, outside this folder
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import riposte_bind as rb  # noqa: E402  (the binding verifier, imported unchanged)
import invoice_rules as R  # noqa: E402

MAX_SAFE_INTEGER = 9007199254740991.0
# Every engine label the Node build retains (packages/verify/src/version.ts ENGINE_VERSIONS), oldest first. Engine 0.7.0 changed
# only the accounts-payable reading: an invoice verdict under it is 0.6.0's with the label, and the ids the label enters, changed.
# Engine 0.7.1 words each invoice explanation in a controller's words (explain_in_words); nothing else on the invoice path moved.
# Engine 0.7.2 changed the accounts-payable and legal defaults only: an invoice verdict under it is 0.7.1's with the label changed.
ENGINES = ["0.0.1", "0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.7.1", "0.7.2"]


def engine_at_least(v, minimum):
    return ENGINES.index(v) >= ENGINES.index(minimum)
MIN_VERDICT_CONFIDENCE = 90


class Outside(Exception):
    """An input this build does not re-perform (yet). Refused, exit 3, naming what is outside; never a guessed verdict."""


class Refused(Exception):
    """An input the engine itself refuses before it issues a verdict (exit 3)."""


# ---------------------------------------------------------------------------------------------------------------------
# JavaScript semantics the engine's arithmetic and words depend on

def is_num(x):
    return type(x) is float  # the reader gives every JSON number as a float; a bool is never a number


def js_round(x):
    """Math.round: the nearest integer, a tie toward +infinity; NaN and the infinities as they are (Math.round(Infinity) is
    Infinity; math.floor would raise)."""
    if not math.isfinite(x):
        return x
    f = math.floor(x)
    return float(f + 1 if x - f >= 0.5 else f)


def round4(x):
    return js_round(x * 1e4) / 1e4


def js_str(v):
    """String(v) for the values a bound value can hold."""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if is_num(v):
        return rb.js_number(v)
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ",".join("" if x is None else js_str(x) for x in v)
    if type(v).__name__ == "JsDate":
        raise Outside("a date written as words in the local time zone; not re-performed by this build")
    return "[object Object]"


def js_stringify(v):
    """JSON.stringify(v), compact, for the words a refusal quotes."""
    if v is None or v is True or v is False or is_num(v) or isinstance(v, str):
        return rb.js_string(v) if isinstance(v, str) else ("null" if v is None else js_str(v))
    if isinstance(v, list):
        return "[" + ",".join(js_stringify(x) for x in v) + "]"
    if type(v).__name__ == "JsDate":
        return rb.js_string(v.iso + "T00:00:00.000Z")
    return "{" + ",".join(rb.js_string(k) + ":" + js_stringify(v[k]) for k in js_keys(v)) + "}"


def utf16_len(s):
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def js_slice(s, n):
    """s.slice(0, n), counted in UTF-16 code units."""
    b = s.encode("utf-16-le", "surrogatepass")[: 2 * n]
    return b.decode("utf-16-le", "surrogatepass")


def js_to_fixed(x, digits):
    """Number.prototype.toFixed(digits): the exact double, a tie rounded to the larger magnitude."""
    from decimal import Decimal, ROUND_HALF_UP
    if not math.isfinite(x):
        return rb.js_number(x)
    if abs(x) >= 1e21:
        return rb.js_number(x)
    neg = x < 0
    s = str(Decimal(abs(x)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))
    return ("-" if neg else "") + s


def js_to_fixed2(x):
    return js_to_fixed(x, 2)


# \Z, not $, in every pattern read against document text: Python's $ also matches before a final newline, JavaScript's does not
# ("5\n" is no array index, and a key "a\n" is written $["a\n"]); and [0-9], not \d, which in Python matches other scripts' digits
_INDEX_KEY = re.compile(r"^(?:0|[1-9][0-9]*)\Z")


def js_keys(o):
    """Object.keys order: array-index keys ascending, then the rest in insertion order. An array's keys are its indices."""
    if isinstance(o, list):
        return [str(i) for i in range(len(o))]
    idx = sorted((k for k in o if _INDEX_KEY.match(k) and int(k) <= 4294967294), key=int)
    taken = set(idx)
    return idx + [k for k in o if k not in taken]


def js_get(o, k):
    """o[k] for an object or an array, as the bridge reads a document (undefined is None)."""
    if isinstance(o, dict):
        return o.get(k)
    if isinstance(o, list) and _INDEX_KEY.match(k):
        i = int(k)
        return o[i] if i < len(o) else None
    return None


def js_truthy(v):
    if v is None or v is False:
        return False
    if is_num(v):
        return v != 0 and not math.isnan(v)
    if isinstance(v, str):
        return v != ""
    return True


_JS_WS = "\t\n\x0b\x0c\r \xa0                　﻿"


def js_trim(s):
    return s.strip(_JS_WS)


_JS_S = "[" + re.escape(_JS_WS) + "]"  # JavaScript's \s (WhiteSpace and LineTerminator); Python's \s also takes U+001C to U+001F


def pretty(v, indent=""):
    """JSON.stringify(v, null, 2)."""
    if isinstance(v, dict):
        keys = js_keys(v)
        if not keys:
            return "{}"
        inner = indent + "  "
        return "{\n" + ",\n".join(inner + rb.js_string(k) + ": " + pretty(v[k], inner) for k in keys) + "\n" + indent + "}"
    if isinstance(v, list):
        if not v:
            return "[]"
        inner = indent + "  "
        return "[\n" + ",\n".join(inner + pretty(x, inner) for x in v) + "\n" + indent + "]"
    return rb.canonical_json(v)


# ---------------------------------------------------------------------------------------------------------------------
# The bridge: each role from its path (100), an alternative path (95) or the fuzzy alias search (75)
# (packages/verify/src/binding/ontological-bridge.ts)

_FIELD_ALIASES = {
    "rate": ["unit_price", "price", "hourly_rate", "rate_per_unit", "price_per_unit", "unit_rate", "cost", "charge"],
    "unit_price": ["rate", "price", "hourly_rate", "cost", "charge"],
    "quantity": ["qty", "units", "hours", "count", "num", "amount"],
    "hours": ["quantity", "qty", "units", "total_hours", "worked_hours"],
    "amount": ["total", "sum", "value", "price", "cost", "charge", "billed_amount", "line_total"],
    "total": ["amount", "sum", "grand_total", "subtotal", "total_amount"],
    "date": ["service_date", "event_date", "transaction_date", "work_date", "effective_date"],
    "effective_date": ["start_date", "begin_date", "commencement_date"],
    "end_date": ["expiration_date", "termination_date", "expiry_date", "contract_end"],
    "document_number": ["invoice_number", "reference", "ref", "po_number", "order_number", "ticket_number"],
}


def _norm_key(k):
    return k.lower().replace("-", "_")


def field_aliases(name):
    n = _norm_key(name)
    out = [n]
    for a in _FIELD_ALIASES.get(n, []):
        if a not in out:
            out.append(a)
    for canonical, lst in _FIELD_ALIASES.items():
        if n in lst:
            for a in [canonical] + lst:
                if a not in out:
                    out.append(a)
    return out


_WILD = re.compile(r"^(.+)\[\*\]\Z")


def extract_exact(doc, path, index):
    current = doc
    for part in path.split("."):
        if current is None:
            return None
        m = _WILD.match(part)
        if m:
            arr = js_get(current, m.group(1))
            if not isinstance(arr, list):
                return None
            if index is not None:
                current = arr[index] if index < len(arr) else None
            else:
                for item in arr:
                    if item is not None:
                        current = item
                        break
                if current is arr:
                    return arr
        elif re.match(r"^[0-9]+\Z", part):
            if isinstance(current, list):
                i = int(part)
                current = current[i] if i < len(current) else None
            else:
                return None
        else:
            current = js_get(current, part)
    return current


def _deep_search(obj, field, index, depth=4):
    if depth <= 0:
        return None
    for k in js_keys(obj):
        if _norm_key(k) == field.lower():
            value = js_get(obj, k)
            if isinstance(value, list) and index is not None:
                return value[index] if index < len(value) else None
            return value
    for k in js_keys(obj):
        value = js_get(obj, k)
        if isinstance(value, (dict, list)):
            if isinstance(value, list):
                if index is not None and index < len(value) and js_truthy(value[index]):
                    item = value[index]
                    if isinstance(item, (dict, list)):
                        r = _deep_search(item, field, None, depth - 1)
                        if r is not None:
                            return r
                else:
                    for item in value:
                        if isinstance(item, (dict, list)):
                            r = _deep_search(item, field, None, depth - 1)
                            if r is not None:
                                return r
            else:
                r = _deep_search(value, field, index, depth - 1)
                if r is not None:
                    return r
    return None


def _search_in_arrays(obj, array_name, field, index):
    arr = None
    for alias in field_aliases(array_name):
        for k in js_keys(obj):
            if _norm_key(k) == alias.lower() and isinstance(js_get(obj, k), list):
                arr = js_get(obj, k)
                break
        if arr is not None:
            break
    if arr is None:
        return None
    i = 0 if index is None else index
    item = arr[i] if i < len(arr) else None
    if js_truthy(item) and isinstance(item, (dict, list)):
        for alias in field_aliases(field):
            for k in js_keys(item):
                if _norm_key(k) == alias.lower():
                    return js_get(item, k)
    return None


def extract_fuzzy(doc, path, index):
    exact = extract_exact(doc, path, index)
    if exact is not None:
        return exact
    parts = path.split(".")
    last = parts[-1]
    m = _WILD.match(last)
    if m:
        last = m.group(1)
    for alias in field_aliases(last):
        r = _deep_search(doc, alias, index)
        if r is not None:
            return r
    if len(parts) >= 2 and "[*]" in parts[0]:
        m = _WILD.match(parts[0])
        if m:
            r = _search_in_arrays(doc, m.group(1), last, index)
            if r is not None:
                return r
    return None


_NUMERIC_ROLES = {"RATE_APPLIED", "RATE_CONTRACTED", "CLAIMED_AMOUNT", "VERIFIED_AMOUNT", "CONTRACTED_LIMIT", "CLAIMED_QUANTITY",
                  "ACTUAL_QUANTITY", "LINE_ITEM_TOTAL", "EXPECTED_TOTAL", "SUBTOTAL", "TAX_AMOUNT", "TAX_RATE", "DISCOUNT_AMOUNT",
                  "SERVICE_CHARGE", "GRAND_TOTAL", "LINE_ITEMS_SUM", "EXPECTED_GRAND_TOTAL", "EXPECTED_TAX_AMOUNT"}
_DATE_ROLES = {"EVENT_DATE", "CONTRACT_START", "CONTRACT_END"}
_STRING_ROLES = {"DOCUMENT_ID", "INVOICE_DESCRIPTION", "EVIDENCE_DESCRIPTION", "CURRENCY_CODE"}


def fuzzy_type_ok(value, role):
    """validateValueType: would the bridge accept this fuzzy candidate for the role?"""
    if role in _NUMERIC_ROLES:
        if is_num(value):
            return True
        if isinstance(value, str):
            cleaned = re.sub("[,$" + re.escape(_JS_WS) + "]", "", value)
            return re.match(r"^-?[0-9]*\.?[0-9]+\Z", cleaned) is not None
        return False
    if role in _DATE_ROLES:
        if isinstance(value, str):
            raise Outside("the fuzzy search would read %s as a candidate date for %s; dates are not re-performed by this build"
                          % (js_stringify(value), role))
        return False
    if role == "PRIOR_CLAIM_IDS":
        return isinstance(value, list)
    if role in _STRING_ROLES:
        return isinstance(value, str)
    return True


# Normalizers (packages/verify/src/binding/forensic-normalizer.ts). Engines before 0.6.0 read a figure written as text through
# these lenient parsers; from engine 0.6.0 it is read strictly (rulesets/strict.ts), which this build does not re-perform yet.

class JsDate(object):
    """A Date the bridge made from an ISO calendar date (UTC midnight). Only valid dates are ever made."""

    def __init__(self, iso):
        self.iso = iso

    def __eq__(self, other):
        return isinstance(other, JsDate) and other.iso == self.iso

    def __ne__(self, other):
        return not self.__eq__(other)

    __hash__ = None


def fold_digits(s):
    out, folded = [], False
    for ch in s:
        c = ord(ch)
        for lo in (0xFF10, 0x0660, 0x06F0, 0x0966, 0x09E6, 0x0E50):
            if lo <= c <= lo + 9:
                out.append(str(c - lo))
                folded = True
                break
        else:
            if c == 0xFF0E:
                out.append(".")
                folded = True
            elif c == 0xFF0C:
                out.append(",")
                folded = True
            else:
                out.append(ch)
    return "".join(out), folded


_CJK_DIGIT = {"〇": 0, "零": 0, "一": 1, "壹": 1, "二": 2, "貳": 2, "贰": 2, "兩": 2, "两": 2, "三": 3, "參": 3, "叁": 3, "叄": 3,
              "四": 4, "肆": 4, "五": 5, "伍": 5, "六": 6, "陸": 6, "陆": 6, "七": 7, "柒": 7, "八": 8, "捌": 8, "九": 9, "玖": 9}
_CJK_SMALL = {"十": 10, "拾": 10, "百": 100, "佰": 100, "千": 1000, "仟": 1000}
_CJK_BIG = {"万": 1e4, "萬": 1e4, "億": 1e8, "亿": 1e8, "兆": 1e12}


def parse_cjk(text):
    s = "".join(ch for ch in text if ch not in "円圓圆元圜￥¥整正也," and ch not in _JS_WS)
    if s == "" or not any(ch in _CJK_DIGIT or ch in _CJK_SMALL or ch in _CJK_BIG for ch in s):
        return None
    total, section, num = 0.0, 0.0, 0.0
    last_big, last_small = math.inf, math.inf
    for ch in s:
        if "0" <= ch <= "9":
            num = num * 10 + (ord(ch) - 48)
        elif ch in _CJK_DIGIT:
            num = num * 10 + _CJK_DIGIT[ch]
        elif ch in _CJK_SMALL:
            u = _CJK_SMALL[ch]
            if u >= last_small:
                return None
            last_small = u
            section += (1 if num == 0 else num) * u
            num = 0.0
        elif ch in _CJK_BIG:
            b = _CJK_BIG[ch]
            if b >= last_big:
                return None
            last_big = b
            section += num
            if section == 0:
                return None
            total += section * b
            section, num, last_small = 0.0, 0.0, math.inf
        else:
            return None
    section += num
    total += section
    return float(total) if math.isfinite(total) else None


_FLOAT_PREFIX = re.compile(r"^[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)")


def js_parse_float(s):
    """parseFloat: the longest decimal literal at the start (after leading white space), else NaN."""
    m = _FLOAT_PREFIX.match(s.lstrip(_JS_WS))
    return float(m.group(0)) if m else math.nan


def _parse_money(value, to_cents):
    """parseMoney: (success, normalized, transformations)."""
    if is_num(value):
        rounded = js_round(value * 100) / 100 if to_cents else value
        return True, rounded, (["rounded_to_2_decimals"] if rounded != value else ["already_number"])
    tr = []
    cleaned = js_trim(value)
    cleaned, folded = fold_digits(cleaned)
    if folded:
        tr.append("non_ascii_digits_folded")
    cjk = parse_cjk(cleaned)
    if cjk is not None:
        cleaned = rb.js_number(cjk)
        tr.append("cjk_numerals_parsed")
    neg = False
    if cleaned.startswith("(") and cleaned.endswith(")"):
        neg, cleaned = True, cleaned[1:-1]
        tr.append("parentheses_negative")
    if cleaned.endswith("-"):
        neg, cleaned = True, cleaned[:-1]
        tr.append("trailing_minus")
    if cleaned.startswith("-"):
        neg, cleaned = True, cleaned[1:]
        tr.append("leading_minus")
    before = cleaned
    cleaned = re.sub(r"^[^0-9.\-,]+|[^0-9.\-,]+\Z", "", cleaned)
    if cleaned != before:
        tr.append("currency_symbols_removed")
    last_comma, last_period = cleaned.rfind(","), cleaned.rfind(".")
    locale = "unknown"
    if last_comma > last_period:
        after = cleaned[last_comma + 1:]
        if re.match(r"^[0-9]{1,2}\Z", after):
            locale = "EU"
        elif re.match(r"^[0-9]{3}\Z", after):
            locale = "US"
    elif last_period > last_comma:
        after = cleaned[last_period + 1:]
        if re.match(r"^[0-9]{1,2}\Z", after):
            locale = "US"
        elif re.match(r"^[0-9]{3}\Z", after):
            locale = "US" if re.match(r"^0\.", cleaned) else "EU"
    if locale == "unknown":
        if re.match(r"^[0-9]{1,3}(\.[0-9]{3})+(,[0-9]{1,2})?\Z", cleaned) or re.match(r"^[0-9]+,[0-9]{1,2}\Z", cleaned):
            locale = "EU"
        else:
            locale = "US"
    if locale == "EU":
        cleaned = cleaned.replace(".", "").replace(",", ".", 1)
        tr.append("european_format_converted")
    else:
        b2 = cleaned
        cleaned = cleaned.replace(",", "")
        if cleaned != b2:
            tr.append("thousands_separators_removed")
    parts = cleaned.split(".")
    if len(parts) > 2:
        cleaned = "".join(parts[:-1]) + "." + parts[-1]
        tr.append("multiple_decimals_fixed")
    parsed = js_parse_float(cleaned)
    if math.isnan(parsed):
        return False, 0.0, ["parse_failed"]
    result = -parsed if neg else parsed
    rounded = js_round(result * 100) / 100 if to_cents else result
    if rounded != result and not (math.isinf(result)):
        tr.append("rounded_to_2_decimals")
        result = rounded
    return True, result, tr


_UNITS = re.compile(_JS_S + "*(hours?|hrs?|hr|days?|d|minutes?|mins?|min|units?|un|each|ea|pieces?|pcs?|pc|pounds?|lbs?|lb|gallons?|gal|miles?|mi|tons?)"
                    + _JS_S + "*\\Z", re.I | re.A)


def _parse_quantity(value):
    if is_num(value):
        return True, value, ["already_number"]
    tr = []
    cleaned = js_trim(value).lower()
    cleaned, folded = fold_digits(cleaned)
    if folded:
        tr.append("non_ascii_digits_folded")
    cjk = parse_cjk(cleaned)
    if cjk is not None:
        cleaned = rb.js_number(cjk)
        tr.append("cjk_numerals_parsed")
    m = re.match(r"^([0-9]+)/([0-9]+)", cleaned)
    if m and int(m.group(2)) != 0:
        tr.append("fraction_converted")
        return True, float(int(m.group(1))) / float(int(m.group(2))), tr
    m = re.match(r"^([0-9]+(?:\.[0-9]+)?)" + _JS_S + "*[-–—to]" + _JS_S + "*[0-9]+", cleaned)
    if m:
        tr.append("range_first_value_used")
        return True, js_parse_float(m.group(1)), tr
    without = _UNITS.sub("", cleaned, count=1)
    if without != cleaned:
        tr.append("unit_suffix_removed")
        cleaned = without
    m = re.match(r"^-?[0-9]*\.?[0-9]+", cleaned)
    if m:
        return True, js_parse_float(m.group(0)), tr or ["number_extracted"]
    return False, 0.0, ["parse_failed"]


def _parse_rate(value):
    tr = []
    if is_num(value):
        parsed = value
        tr.append("already_number")
    else:
        cleaned = js_trim(value)
        cleaned, folded = fold_digits(cleaned)
        if folded:
            tr.append("non_ascii_digits_folded")
        percent = "%" in cleaned
        if percent:
            cleaned = cleaned.replace("%", "")
            tr.append("percent_sign_removed")
        before = cleaned
        cleaned = re.sub(r"[^0-9.,\-]", "", cleaned)
        if cleaned != before:
            tr.append("non_numeric_removed")
        if "," in cleaned and "." not in cleaned:
            cleaned = cleaned.replace(",", ".", 1)
            tr.append("decimal_comma_converted")
        elif "," in cleaned:
            cleaned = cleaned.replace(",", "")
            tr.append("thousands_separators_removed")
        parsed = js_parse_float(cleaned)
        if math.isnan(parsed):
            return False, 0.0, ["parse_failed"]
        if percent:
            parsed = parsed / 100
            tr.append("percent_to_fraction")
    if parsed > 1:
        parsed = parsed / 100
        tr.append("percent_to_fraction_heuristic")
    if parsed < 0:
        return False, parsed, tr + ["negative_rate"]
    return True, js_round(parsed * 1e9) / 1e9, tr


_MONTHS = {"jan": "01", "january": "01", "feb": "02", "february": "02", "mar": "03", "march": "03", "apr": "04", "april": "04",
           "may": "05", "jun": "06", "june": "06", "jul": "07", "july": "07", "aug": "08", "august": "08", "sep": "09", "sept": "09",
           "september": "09", "oct": "10", "october": "10", "nov": "11", "november": "11", "dec": "12", "december": "12"}


def _finish_date(iso, tr):
    m = re.match(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})\Z", iso)
    ok = False
    if m and m.group(1) != "0000":
        try:
            datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            ok = True
        except ValueError:
            ok = False
    elif m:
        raise Outside("the date %s is in year 0, which this build does not read" % iso)
    return (True, iso, tr) if ok else (False, "", tr + ["invalid_calendar_date"])


def _parse_date(value):
    """normalizeDate for a string: (success, iso, transformations). The JavaScript Date parser fallback is not re-performed."""
    s = js_trim(value)
    if re.match(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}\Z", s):
        return _finish_date(s, ["already_iso"])
    m = re.match(r"^([0-9]{4}-[0-9]{2}-[0-9]{2})T", s)
    if m:
        return _finish_date(m.group(1), ["time_stripped"])
    m = re.match(r"^([0-9]{1,2})/([0-9]{1,2})/([0-9]{2,4})\Z", s)
    if m:
        first, second, yp = m.groups()
        year = "20" + yp if len(yp) == 2 else yp
        f, s2 = int(first), int(second)
        if f > 12 and s2 <= 12:
            return _finish_date("%s-%s-%s" % (year, second.zfill(2), first.zfill(2)), ["european_format_parsed"])
        if f > 12 or s2 > 31:
            return False, "", ["parse_failed"]
        tr = ["AMBIGUOUS_DATE"] if f <= 12 and s2 <= 12 and f != s2 else []
        return _finish_date("%s-%s-%s" % (year, first.zfill(2), second.zfill(2)), tr + ["us_format_parsed"])
    m = re.match(r"^([0-9]{1,2})[-/]([0-9]{1,2})[-/]([0-9]{4})\Z", s)
    if m:
        first, second, year = m.groups()
        if int(first) > 12:
            return _finish_date("%s-%s-%s" % (year, second.zfill(2), first.zfill(2)), ["european_format_parsed"])
        if int(second) > 12:
            return _finish_date("%s-%s-%s" % (year, first.zfill(2), second.zfill(2)), ["us_format_parsed"])
        tr = ["AMBIGUOUS_DATE"] if int(first) != int(second) else []
        return _finish_date("%s-%s-%s" % (year, first.zfill(2), second.zfill(2)), tr + ["us_format_defaulted"])
    m = re.match(r"^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|"
                 r"Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)" + _JS_S + "+([0-9]{1,2})(?:st|nd|rd|th)?,?" + _JS_S + "*([0-9]{4})\\Z", s, re.I | re.A)
    if m and _MONTHS.get(m.group(1).lower()):
        return _finish_date("%s-%s-%s" % (m.group(3), _MONTHS[m.group(1).lower()], m.group(2).zfill(2)), ["text_month_parsed"])
    raise Outside("the text %s would be read by the JavaScript Date parser, which this build does not re-perform"
                  % js_stringify(js_slice(value, 40)))


def _reference(value):
    if value is None or value == "" or not (isinstance(value, str) or is_num(value)):
        return None
    original = js_str(value)
    tr = []
    n = js_trim(original)
    if n != original:
        tr.append("whitespace_trimmed")
    up = n.upper()
    if up != n:
        tr.append("uppercased")
        n = up
    cleaned = re.sub(r"[^A-Z0-9]", "", n)
    if cleaned != n:
        tr.append("special_chars_removed")
        n = cleaned
    if n == "":
        return None
    return original, n, tr or ["no_changes"]


def _plain(value):
    """normalizeValue, the bridge's fallback, for a value no role-specific normalizer read."""
    if value is None:
        return None
    if is_num(value):
        return value
    if isinstance(value, str):
        if value != "":
            ok, n, _ = _parse_money(value, True)
            if ok:
                return n
            ok, iso, _ = _parse_date(value)
            if ok:
                return JsDate(iso)
        return value
    if isinstance(value, list):
        return [js_str(x) for x in value]
    return js_str(value)


_KIND = {"CLAIMED_AMOUNT": "amount", "SUBTOTAL": "amount", "TAX_AMOUNT": "amount", "DISCOUNT_AMOUNT": "amount",
         "SERVICE_CHARGE": "amount", "GRAND_TOTAL": "amount", "RATE_APPLIED": "price", "TAX_RATE": "rate",
         "CLAIMED_QUANTITY": "quantity"}


def normalize_for_role(value, role, engine):
    """normalizeValueForRole: (value, originalValue, normalizations or None)."""
    kind = _KIND.get(role)
    if kind is not None and isinstance(value, str) and engine_at_least(engine, "0.6.0") and js_trim(value) != "":
        raise Outside("%s is written as the text %s; from engine 0.6.0 a figure written as text is read by the strict reading, "
                      "which this build does not re-perform yet (send JSON numbers)" % (role, js_stringify(js_slice(value, 40))))
    if kind is not None and (is_num(value) or (isinstance(value, str) and value != "")):
        if kind in ("amount", "price"):
            ok, n, tr = _parse_money(value, kind == "amount")
        elif kind == "quantity":
            ok, n, tr = _parse_quantity(value)
        else:
            ok, n, tr = _parse_rate(value)
        if ok:
            return n, value, tr
    if role in _DATE_ROLES and value is not None and value != "":
        if isinstance(value, str):
            ok, iso, tr = _parse_date(value)
            return (JsDate(iso) if ok else value), value, tr
        if is_num(value):
            raise Outside("%s is a number, which the engine reads as a timestamp in the local time zone; not re-performed by this build" % role)
        return js_str(value), value, None
    if role == "DOCUMENT_ID":
        r = _reference(value)
        if r is not None:
            return r[1], r[0], r[2]
    if role in ("INVOICE_DESCRIPTION", "CURRENCY_CODE"):
        return value, value, None  # bound, never read by an invoice check while no reference is supplied
    return _plain(value), value, None


def date_of(doc):
    """extractDateValue: the invoice's service date, when it carries one (service date preferred)."""
    for f in ["service_date", "work_date", "event_date", "date", "invoice_date", "ticket_date"]:
        raw = doc.get(f)
        if isinstance(raw, str) or is_num(raw):
            return js_str(raw)
    dates = doc.get("dates")
    if not isinstance(dates, list):
        return None
    dates = [d for d in dates if isinstance(d, (dict, list))]
    if not dates:
        return None

    def typ(d):
        t = d.get("type") if isinstance(d, dict) else None
        if js_truthy(t) and not isinstance(t, str):
            raise Outside("a date's type is not text; the engine's reading of it is not re-performed by this build")
        return t.lower() if js_truthy(t) else None

    def val(d):
        if not isinstance(d, dict):
            return None
        v = d.get("date") if js_truthy(d.get("date")) else d.get("value")
        return js_str(v) if js_truthy(v) else None

    service = [d for d in dates if typ(d) and any(t in typ(d) for t in ("service_date", "service", "work_date", "work", "event_date", "event"))]
    if service and val(service[0]):
        return val(service[0])
    other = [d for d in dates if not typ(d) or not any(t in typ(d) for t in ("invoice_date", "invoice", "billing_date"))]
    if other and val(other[0]):
        return val(other[0])
    return val(dates[0])


def bind(doc, index, engine):
    """createBindings for the invoice document at one line (index) or at the document (None), with no references."""
    b = {}
    for m in R.INVOICE_MAPPINGS:
        role = m["role"]
        if role in b:
            continue
        if role == "EVENT_DATE":
            d = date_of(doc)
            if d:
                value, original, normalizations = normalize_for_role(d, role, engine)
                bv = {"value": value, "source": "invoice", "field": "dates[service_date]", "confidence": 100, "originalValue": d}
                if normalizations:
                    bv["normalizations"] = normalizations
                b[role] = bv
                continue
        found = None
        for conf, path in [(100, m["path"])] + [(95, p) for p in m["alts"]]:
            v = extract_exact(doc, path, index)
            if v is not None:
                found = (v, conf, path)
                break
        if found is None and m["fuzzy"]:
            v = extract_fuzzy(doc, m["path"], index)
            if v is not None and fuzzy_type_ok(v, role):
                found = (v, 75, "fuzzy")  # bound at 75; honesty rule 3 then keeps any claim that rests on it from deciding
        if found is None:
            continue
        value, original, normalizations = normalize_for_role(found[0], role, engine)
        bv = {"value": value, "source": "invoice", "field": found[2], "confidence": found[1], "originalValue": original}
        if normalizations:
            bv["normalizations"] = normalizations
        b[role] = bv
    # computeDerivedBindings: a line's price × quantity is the amount MATH_INT compares (no evidence supplied)
    rate, qty = b.get("RATE_APPLIED"), b.get("CLAIMED_QUANTITY")
    if rate and qty and is_num(rate["value"]) and is_num(qty["value"]):
        conf = min(rate["confidence"], qty["confidence"])
        b["LINE_ITEM_TOTAL"] = {"value": rate["value"] * qty["value"], "source": "computed", "field": "RATE_APPLIED * CLAIMED_QUANTITY", "confidence": conf}
        b["VERIFIED_AMOUNT"] = {"value": rate["value"] * qty["value"], "source": "computed",
                                "field": "RATE_APPLIED * CLAIMED_QUANTITY (math check)", "confidence": conf}
    return b


# ---------------------------------------------------------------------------------------------------------------------
# Evidence and values (packages/verify/src/verdict/from-report.ts)

def to_value(v):
    if v is None:
        return None
    if isinstance(v, JsDate):
        return v.iso
    if isinstance(v, list):
        return [js_str(x) for x in v]
    return v


def evidence_of(bv):
    value = to_value(bv["value"])
    original = to_value(bv.get("originalValue")) if "originalValue" in bv else None
    has_original = "originalValue" in bv and bv.get("originalValue") is not None
    src = bv["source"]
    e = {"locator": {"kind": "field", "source": src, "path": bv["field"]}, "value": value, "confidence": bv["confidence"],
         "role": "CONTEXT" if src == "computed" else ("REFERENCE" if src in ("contract", "evidence", "history") else "OPERAND")}
    # JavaScript compares by identity: a list is never the same object as another list, so a list always records `original`
    if has_original and (isinstance(original, list) or original != value or type(original) is not type(value)):
        e["original"] = original
    if bv.get("normalizations"):
        e["normalizations"] = bv["normalizations"]
    return e


def ev_key(e):
    return "%s:%s" % (e["locator"]["source"], e["locator"]["path"])


def num(bv):
    return bv["value"] if bv is not None and is_num(bv["value"]) and math.isfinite(bv["value"]) else None


def computed(value, formula, operands):
    return {"value": value, "source": "computed", "field": formula,
            "confidence": min(o["confidence"] for o in operands) if operands else 0}


# ---------------------------------------------------------------------------------------------------------------------
# The ruleset's compute(): the computed roles and the reasons for any that could not be computed
# (packages/verify/src/rulesets/invoice/index.ts)

def _shown(bv):
    s = js_stringify(bv["value"] if bv else None)
    return js_slice(s, 40) + "…" if utf16_len(s) > 40 else s


def _unparseable(bv):
    return bv is not None and bv["value"] is not None and num(bv) is None


def compute(extraction, doc_ctx, line_ctxs):
    doc_absence, line_absence = {}, [{} for _ in line_ctxs]
    attach = {}
    line_amounts, problems = [], []
    for i, ctx in enumerate(line_ctxs):
        attach["line[%d].MATH_INT" % i] = [evidence_of(ctx[r]) for r in ("RATE_APPLIED", "CLAIMED_QUANTITY") if r in ctx]
        amt = ctx.get("CLAIMED_AMOUNT")
        if amt and num(amt) is not None:
            a = dict(amt)
            a["field"] = amt["field"].replace("[*]", "[%d]" % i, 1)
            line_amounts.append(a)
        else:
            problems.append("line_items[%d]: amount missing or unparseable" % i)
    line_count = len(extraction["line_items"]) if isinstance(extraction.get("line_items"), list) else 0
    if line_count == 0:
        doc_absence["LINE_ITEMS_SUM"] = "no line_items array on the extraction"
    elif problems:
        doc_absence["LINE_ITEMS_SUM"] = "; ".join(problems)
    else:
        total = 0.0
        for a in line_amounts:
            total = total + a["value"]
        doc_ctx["LINE_ITEMS_SUM"] = computed(round4(total), "Σ(%s)" % " + ".join(a["field"] for a in line_amounts), line_amounts)
        attach["document.SUM_INT"] = [dict(evidence_of(a)) for a in line_amounts]

    B = doc_ctx
    subtotal, tax, discount, service = num(B.get("SUBTOTAL")), num(B.get("TAX_AMOUNT")), num(B.get("DISCOUNT_AMOUNT")), num(B.get("SERVICE_CHARGE"))
    subtotal_junk = _unparseable(B.get("SUBTOTAL"))
    subtotal_absence = ({"reason": "UNPARSEABLE", "detail": "SUBTOTAL is present but is not a number (%s)" % _shown(B.get("SUBTOTAL"))}
                        if subtotal_junk else "SUBTOTAL not present on the extraction")
    junk = [r for r in ("TAX_AMOUNT", "SERVICE_CHARGE", "DISCOUNT_AMOUNT") if _unparseable(B.get(r))]
    if subtotal is None or not B.get("SUBTOTAL"):
        doc_absence["EXPECTED_GRAND_TOTAL"] = subtotal_absence
    elif junk:
        doc_absence["EXPECTED_GRAND_TOTAL"] = {"reason": "UNPARSEABLE", "detail": "%s present but not a number, so the expected total cannot be computed (it is never read as 0)"
                                               % ", ".join("%s (%s)" % (r, _shown(B.get(r))) for r in junk)}
    else:
        notes = []
        if tax is None:
            notes.append("TAX_AMOUNT absent → 0")
        if service is None:
            notes.append("SERVICE_CHARGE absent → 0")
        if discount is None:
            notes.append("DISCOUNT_AMOUNT absent → 0")
        ops = [B["SUBTOTAL"]] + [B[r] for r, v in (("TAX_AMOUNT", tax), ("SERVICE_CHARGE", service), ("DISCOUNT_AMOUNT", discount)) if v is not None]
        value = round4(subtotal + (tax if tax is not None else 0.0) + (service if service is not None else 0.0) - abs(discount if discount is not None else 0.0))
        B["EXPECTED_GRAND_TOTAL"] = computed(value, "SUBTOTAL + TAX_AMOUNT + SERVICE_CHARGE − |DISCOUNT_AMOUNT|%s"
                                             % (" (%s)" % "; ".join(notes) if notes else ""), ops)
    attach["document.TOTAL_INT"] = [evidence_of(B[r]) for r in ("SUBTOTAL", "TAX_AMOUNT", "SERVICE_CHARGE", "DISCOUNT_AMOUNT") if r in B]

    rate = num(B.get("TAX_RATE"))
    if subtotal is None or not B.get("SUBTOTAL"):
        doc_absence["EXPECTED_TAX_AMOUNT"] = subtotal_absence
    elif _unparseable(B.get("TAX_RATE")):
        doc_absence["EXPECTED_TAX_AMOUNT"] = {"reason": "UNPARSEABLE", "detail": "TAX_RATE is present but is not a number (%s)" % _shown(B.get("TAX_RATE"))}
    elif rate is None or not B.get("TAX_RATE"):
        doc_absence["EXPECTED_TAX_AMOUNT"] = "TAX_RATE not present on the extraction"
    else:
        B["EXPECTED_TAX_AMOUNT"] = computed(round4(subtotal * rate), "SUBTOTAL × TAX_RATE", [B["SUBTOTAL"], B["TAX_RATE"]])
    attach["document.TAX_INT"] = [evidence_of(B[r]) for r in ("SUBTOTAL", "TAX_RATE") if r in B]

    return doc_absence, line_absence, attach, duplicate_claims(B.get("DOCUMENT_ID"), B.get("PRIOR_CLAIM_IDS"))


# ---------------------------------------------------------------------------------------------------------------------
# Duplicates (packages/verify/src/dedup.ts)

_REVISION = re.compile(r"^(?:REV(?:ISED)?[0-9]*|CORRECTED|AMENDED|COPY|DUPLICATE|DUP|REISSUED?|FINAL|[A-Z])\Z")


def _segments(raw):
    return [re.sub(r"^0+(?=[0-9])", "", s) if re.match(r"^[0-9]+\Z", s) else s for s in re.split(r"[^A-Z0-9]+", raw.upper()) if s]


def _tight(raw):
    return "|".join(_segments(raw))


def _base(raw):
    s = _segments(raw)
    if len(s) >= 2 and _REVISION.match(s[-1]):
        return "|".join(s[:-1])
    return "|".join(s)


def duplicate_claims(doc_id, prior):
    base = {"kind": "CONSISTENCY", "tier": "DETERMINISTIC", "field": "invoice_number"}
    id_ev = [evidence_of(doc_id)] if doc_id else []
    prior_ev = [evidence_of(prior)] if prior else []

    def claim(**kw):
        c = dict(base)
        c.update(kw)
        return c

    if not doc_id or not isinstance(doc_id["value"], str):
        return [claim(claim_id="document.DUP_PROHIB", outcome="INSUFFICIENT_DATA", asserted=None, rule_id="DUP_PROHIB",
                      rule_name="Law of Duplicate Prohibition", evidence=[],
                      insufficiency={"reason": "FIELD_MISSING", "detail": "no invoice number on the extraction; cannot check for duplicates", "missing": ["DOCUMENT_ID"]},
                      locked=False, explanation="No invoice number to compare against prior invoices.")]
    original = doc_id.get("originalValue")
    current = js_str(original if original is not None else doc_id["value"])
    if not prior or not isinstance(prior["value"], list):
        return [claim(claim_id="document.DUP_PROHIB", outcome="INSUFFICIENT_DATA", asserted=doc_id["value"], rule_id="DUP_PROHIB",
                      rule_name="Law of Duplicate Prohibition", evidence=[],
                      insufficiency={"reason": "FIELD_MISSING", "detail": "no prior_invoice_ids supplied; supply the prior invoice-number history to check for duplicates", "missing": ["PRIOR_CLAIM_IDS"]},
                      locked=False, explanation="No prior invoice history supplied.")]
    priors = [x for x in prior["value"] if isinstance(x, str)]
    exact, near = [], []
    for p in priors:
        if p == "":
            continue
        if p == current:
            exact.append(p)
        elif _tight(p) == _tight(current):
            near.append((p, "formatting"))
        elif _base(p) == _base(current):
            near.append((p, "revision"))
    near.sort(key=lambda n: 0 if n[1] == "formatting" else 1)
    did = doc_id["value"]
    out = []
    if exact:
        out.append(claim(claim_id="document.DUP_PROHIB", outcome="FAIL", asserted=did, rule_id="DUP_PROHIB", rule_name="Law of Duplicate Prohibition",
                         computation={"formula": "invoice_number ∉ prior_invoice_ids", "operands": {"DOCUMENT_ID": did, "matched": exact}, "result": False},
                         evidence=id_ev + prior_ev, locked=True,
                         explanation="This invoice number was already processed (exact match: %s). Paying it again is a duplicate." % ", ".join(exact)))
    else:
        out.append(claim(claim_id="document.DUP_PROHIB", outcome="PASS", asserted=did, rule_id="DUP_PROHIB", rule_name="Law of Duplicate Prohibition",
                         computation={"formula": "invoice_number ∉ prior_invoice_ids", "operands": {"DOCUMENT_ID": did}, "result": True},
                         evidence=id_ev + prior_ev, locked=False, explanation="No prior invoice carries this exact number."))
    if near:
        words = ("A prior invoice number normalizes to the same value (%s) — same number, different formatting. Almost certainly a duplicate; do not pay until cleared."
                 if near[0][1] == "formatting" else
                 "A prior invoice number shares this base with a revision suffix (%s). This may be a legitimate re-issue with a corrected amount — a human should confirm before payment.")
        out.append(claim(claim_id="document.DUP_NEAR", outcome="FAIL", asserted=did, rule_id="DUP_NEAR", rule_name="Law of Near-Duplicate Prohibition",
                         computation={"formula": "normalize(invoice_number) ∉ normalize(prior_invoice_ids)",
                                      "operands": {"DOCUMENT_ID": did, "matched": ["%s (%s)" % n for n in near]}, "result": False},
                         evidence=[dict(e) for e in id_ev + prior_ev], locked=False, explanation=words % ", ".join(n[0] for n in near)))
    else:
        out.append(claim(claim_id="document.DUP_NEAR", outcome="PASS", asserted=did, rule_id="DUP_NEAR", rule_name="Law of Near-Duplicate Prohibition",
                         computation={"formula": "normalize(invoice_number) ∉ normalize(prior_invoice_ids)", "operands": {"DOCUMENT_ID": did}, "result": True},
                         evidence=[dict(e) for e in id_ev + prior_ev], locked=False,
                         explanation="No prior invoice number normalizes to this one (no formatting or revision-suffix collision)."))
    return out


# ---------------------------------------------------------------------------------------------------------------------
# The gavel (packages/verify/src/kernel/validation-gavel.ts) and its results as claims (verdict/from-report.ts)

def _kind(x):
    if x is None:
        return "missing"
    if isinstance(x, JsDate):
        return "date"
    if isinstance(x, list):
        return "list"
    if isinstance(x, bool):
        return "boolean"
    if is_num(x):
        return "number"
    if isinstance(x, str):
        return "string"
    return "object"


def _describe(x):
    k = _kind(x)
    if k == "string":
        return 'the text "%s"' % (js_slice(x, 40) + "…" if utf16_len(x) > 40 else x)
    return "missing" if k == "missing" else "a %s" % k


def evaluate(pred, ctx):
    left_role, op, right_role, tol = pred
    lb, rbv = ctx.get(left_role), ctx.get(right_role)
    lv = lb["value"] if lb else None
    rv = rbv["value"] if rbv else None
    res = {"pred": pred, "passed": False, "left": lv, "right": rv, "variance": None, "reason": None, "lp": lb, "rp": rbv}
    if lv is None:
        res["reason"] = "Left value (%s) is missing" % left_role
        return res
    t = 0.01 if tol is None else tol
    if op in ("<=", ">="):
        if is_num(lv) and is_num(rv):
            res["passed"] = lv <= rv + t if op == "<=" else lv >= rv - t
            res["variance"] = lv - rv
            if not res["passed"]:
                res["reason"] = "%s %s %s" % (rb.js_number(lv), ">" if op == "<=" else "<", rb.js_number(rv))
        elif isinstance(lv, JsDate) and isinstance(rv, JsDate):
            res["passed"] = lv.iso <= rv.iso if op == "<=" else lv.iso >= rv.iso
            if not res["passed"]:
                res["reason"] = "%sT00:00:00.000Z %s %sT00:00:00.000Z" % (lv.iso, ">" if op == "<=" else "<", rv.iso)
        else:
            res["reason"] = "Type mismatch for %s comparison" % op
    elif op == "=":
        if is_num(lv) and is_num(rv):
            res["passed"] = abs(lv - rv) <= t
            res["variance"] = lv - rv
            if not res["passed"]:
                res["reason"] = "%s ≠ %s (diff: %s)" % (rb.js_number(lv), rb.js_number(rv), js_to_fixed2(lv - rv))
        elif isinstance(lv, str) and isinstance(rv, str):
            res["passed"] = lv == rv
            if not res["passed"]:
                res["reason"] = '"%s" ≠ "%s"' % (lv, rv)
        elif isinstance(lv, JsDate) and isinstance(rv, JsDate):
            res["passed"] = lv.iso == rv.iso
            if not res["passed"]:
                res["reason"] = "%sT00:00:00.000Z ≠ %sT00:00:00.000Z" % (lv.iso, rv.iso)
        elif _kind(lv) != _kind(rv):
            res["reason"] = "Type mismatch for = comparison: %s is %s, %s is %s, so they could not be compared" % (
                left_role, _describe(lv), right_role or "the constant", _describe(rv))
        else:
            raise Outside("%s and %s are both %ss; comparing them is not re-performed by this build" % (left_role, right_role, _kind(lv)))
    return res


def _needs(required):
    contract = ["RATE_CONTRACTED", "CONTRACTED_LIMIT", "CONTRACT_START", "CONTRACT_END"]
    evidence = ["ACTUAL_QUANTITY", "VERIFIED_AMOUNT", "EVIDENCE_DESCRIPTION"]
    return any(r in contract for r in required), any(r in evidence for r in required), contract, evidence


def validate(code, ctx):
    ax = R.AXIOMS[code]
    missing = [r for r in ax["required"] if not ctx.get(r) or ctx[r]["value"] is None]
    if missing:
        return {"code": code, "verdict": "INSUFFICIENT_DATA", "locked": False, "results": [], "missing": missing,
                "hint": "Please supply: %s" % ", ".join(R.ROLE_HINTS.get(r, r) for r in missing),
                "explanation": "Cannot evaluate: missing bindings for %s" % ", ".join(missing)}
    results = [evaluate(p, ctx) for p in ax["predicates"]]
    passed = all(r["passed"] for r in results)
    exact = all(ctx[r]["confidence"] >= 90 for r in ax["required"])
    need_c, need_e, croles, eroles = _needs(ax["required"])
    reliable = True
    for need, roles in ((need_c, croles), (need_e, eroles)):
        if need:
            bound = [ctx[r] for r in roles if r in ctx]
            if not (bound and all(b["confidence"] >= 95 for b in bound)):
                reliable = False  # no reference is supplied in this build, so there is no correlation to fall back on
    locked = (not passed) and exact and reliable and ax["detectable"] == "PRECOMPUTE"
    variances = [r["variance"] for r in results if r["variance"] is not None]
    variance = None
    if variances:
        variance = 0.0
        for v in variances:
            variance = variance + abs(v)
        q = ctx.get("CLAIMED_QUANTITY")
        if code == "RATE_SUP" and q and is_num(q["value"]) and q["value"] > 0:
            variance = variance * q["value"]
    if passed:
        explanation = "%s: All predicates satisfied." % ax["name"]
    else:
        explanation = "%s VIOLATED: %s" % (ax["name"], "; ".join(r["reason"] or "" for r in results if not r["passed"]))
    return {"code": code, "verdict": "PASS" if passed else "FAIL", "locked": locked, "variance": variance, "results": results,
            "explanation": explanation}


_UNCOMPARABLE = [re.compile(p) for p in (r"^Type mismatch", r"is missing$", r"must be array", r"requires string values", r"^Unknown operator")]


def _insufficiency(missing, absence, refs, hint):
    if not missing:
        return {"reason": "OUT_OF_RULESET_SCOPE", "detail": hint or "rule could not be evaluated"}
    rr = R.REFERENCE_ROLES
    for name, label in (("contract", "No contract/PO reference supplied"), ("evidence", "No evidence reference supplied"),
                        ("history", "No previous document supplied as history")):
        if all(m in rr[name] for m in missing) and not refs[name]:
            return {"reason": "REFERENCE_NOT_PROVIDED", "detail": "%s; this check needs %s" % (label, ", ".join(missing)), "missing": missing}
    for m in missing:
        a = absence.get(m)
        if isinstance(a, dict):
            return {"reason": a["reason"], "detail": a["detail"], "missing": missing}
    notes = ["%s: %s" % (m, absence[m]) for m in missing if isinstance(absence.get(m), str) and absence[m]]
    parts = [p for p in ("; ".join(notes), hint) if p]
    return {"reason": "FIELD_MISSING", "detail": " — ".join(parts) if parts else "missing %s" % ", ".join(missing), "missing": missing}


def to_claim(r, ctx, prefix, absence, refs):
    code = r["code"]
    ax = R.AXIOMS[code]
    evidence, seen = [], set()
    for pr in r["results"]:
        for p in (pr["lp"], pr["rp"]):
            if not p:
                continue
            e = evidence_of(p)
            if ev_key(e) in seen:
                continue
            seen.add(ev_key(e))
            evidence.append(e)
    if r["results"]:
        asserted = to_value(r["results"][0]["left"])
    else:
        first = ctx.get(ax["required"][0])
        asserted = to_value(first["value"]) if first else None
    head = {"claim_id": "%s.%s" % (prefix, code), "kind": R.KIND_BY_CODE.get(code, "CONSISTENCY"), "tier": "DETERMINISTIC"}
    common = {"field": R.FIELD_BY_CODE.get(code, code.lower()), "asserted": asserted, "rule_id": code, "rule_name": ax["name"]}
    if r["verdict"] == "INSUFFICIENT_DATA":
        c = dict(head, outcome="INSUFFICIENT_DATA", **common)
        c.update(evidence=evidence, insufficiency=_insufficiency(r["missing"], absence, refs, r.get("hint")), locked=False,
                 explanation=r["explanation"])
        return c
    failed = [p for p in r["results"] if not p["passed"]]
    if r["verdict"] == "FAIL" and failed and all(any(rx.search(p["reason"] or "") for rx in _UNCOMPARABLE) for p in failed):
        c = dict(head, outcome="INSUFFICIENT_DATA", **common)
        c.update(evidence=evidence, insufficiency={"reason": "UNPARSEABLE", "detail": "; ".join(p["reason"] or "operands could not be compared" for p in failed)},
                 locked=False, explanation=r["explanation"])
        return c
    operands = {}
    for pr in r["results"]:
        operands[pr["pred"][0]] = to_value(pr["left"])
        operands[pr["pred"][2]] = to_value(pr["right"])
    tol = r["results"][0]["pred"][3]
    comp = {"formula": ax["formal"], "operands": operands, "result": to_value(r["results"][0]["right"])}
    if tol is not None:
        comp["tolerance"] = {"abs": tol}
    c = dict(head, outcome=r["verdict"], **common)
    c.update(computation=comp, evidence=evidence, locked=r["locked"], explanation=r["explanation"])
    if r["variance"] is not None:
        only = r["results"][0] if len(r["results"]) == 1 else None
        sign = -1.0 if only is not None and only["variance"] is not None and only["variance"] < 0 else 1.0
        c["variance"] = round4(sign * abs(r["variance"]))
    return c


# ---------------------------------------------------------------------------------------------------------------------
# The tolerance policy (packages/verify/src/tolerance.ts), CAPPED for invoice@0.1.0

def apply_tolerance(claims, policy):
    rel, abs_cap, rc = policy["rel"], policy["absCap"], policy.get("roundingCap")
    if rel <= 0:
        return
    grain = 0.01
    any_ = False
    for c in claims:
        if c["kind"] != "RECOMPUTE" or not is_num(c.get("asserted")) or not math.isfinite(c["asserted"]):
            continue
        any_ = True
        if abs(c["asserted"] - js_round(c["asserted"])) > 1e-9:
            grain = 0.01
            break
    else:
        grain = 1.0 if any_ else 0.01
    lines = len({m.group(1) for m in (re.match(r"^line\[(\d+)\]\.", c["claim_id"]) for c in claims) if m}) if rc and rc.get("perLine") else 0
    for c in claims:
        comp = c.get("computation")
        if not comp or not is_num(comp.get("result")):
            continue
        floor = comp.get("tolerance", {}).get("abs", 0.01)
        comp["tolerance"] = {"abs": floor, "rel": rel}
        if c["outcome"] != "FAIL" or not is_num(c.get("variance")):
            continue
        cap = abs_cap if abs_cap > 0 else math.inf
        rel_band = min(rel * abs(comp["result"]), cap)
        k = sum(1 for e in c["evidence"] if e["locator"]["kind"] == "field" and e["locator"]["source"] != "computed" and is_num(e["value"]))
        if c["rule_id"] in rc.get("perLine", []):
            k += lines
        step = 0.0
        if c["rule_id"] in rc.get("cashStep", []) and is_num(c["asserted"]) and math.isfinite(c["asserted"]):
            for mult in (100, 50, 10, 5):
                s = mult * grain
                q = c["asserted"] / s
                if abs(q - js_round(q)) < 1e-9:
                    step = round4(s)
                    break
        round_cap = round4(grain * k + step / 2)
        eff = max(floor, min(rel_band, round_cap))
        v = round4(abs(c["variance"]))
        cap_text = "rounding cap %s × %d step%s%s = %s%s" % (
            rb.js_number(grain), k, "" if k == 1 else "s", " + half a cash step of %s" % rb.js_number(step) if step > 0 else "",
            rb.js_number(round_cap), ", cap %s" % rb.js_number(abs_cap) if abs_cap > 0 else "")
        if abs(c["variance"]) <= eff + 1e-9:
            c["outcome"] = "PASS"
            c["locked"] = False
            c["explanation"] = "Within tolerance (|variance| %s ≤ %s = min(%s%% of %s, %s), floor %s): treated as rounding, not error. %s" % (
                rb.js_number(v), rb.js_number(round4(eff)), rb.js_number(round4(rel * 100)), rb.js_number(comp["result"]), cap_text,
                rb.js_number(floor), c["explanation"])
        elif abs(c["variance"]) <= max(floor, rel_band) + 1e-9:
            c["explanation"] = "%s Not treated as rounding: |variance| %s is within %s%% of %s but above the %s (the most rounding can produce on this claim)." % (
                c["explanation"], rb.js_number(v), rb.js_number(round4(rel * 100)), rb.js_number(comp["result"]), cap_text)


def abstain_on_guessed(claims):
    for c in claims:
        if c["outcome"] == "INSUFFICIENT_DATA":
            continue
        guessed = [e for e in c["evidence"] if e["confidence"] < MIN_VERDICT_CONFIDENCE]
        if not guessed:
            continue
        where = "; ".join("%s (confidence %s)" % (ev_key(g), rb.js_number(float(g["confidence"]))) for g in guessed)
        c["outcome"] = "INSUFFICIENT_DATA"
        c["locked"] = False
        c.pop("computation", None)
        c.pop("variance", None)
        c["insufficiency"] = {"reason": "AMBIGUOUS_FIELD", "detail": "%s — a required field was located only by fuzzy name-matching; verdicts are never issued on guessed fields. Supply it under a recognized field name." % where}
        c["explanation"] = "Abstained: %s" % c["explanation"]


def cant_tell_in_words(claims):
    for c in claims:
        if c["outcome"] != "INSUFFICIENT_DATA" or " VIOLATED: " not in c.get("explanation", ""):
            continue
        what = R.CANT_TELL_WHAT.get(c["rule_id"], "the check %s" % c["rule_id"])
        dates = c["rule_id"] == "TIME_ORD"
        if any("parse_failed" in (e.get("normalizations") or []) for e in c["evidence"]):
            raise Outside("an operand of %s did not parse; its words are not re-performed by this build" % c["claim_id"])
        why = "a value it needs is not %s it can compare" % ("a date" if dates else "a number or a date")
        c["explanation"] = "Can't tell %s: %s, so nothing was compared.%s" % (what, why, " Write the date as YYYY-MM-DD and check again." if dates else "")


# ---------------------------------------------------------------------------------------------------------------------
# Explanations in a controller's words, every engine after 0.7.0 (packages/verify/src/rulesets/invoice/words.ts, run as the
# ruleset's finish(), after the guessed-field rule and before the can't-tell wording). Only the sentence changes: never an
# outcome, a value, the evidence, the insufficiency or an id. The rule's kernel name stays in rule_name.

_UNDEFINED = object()  # a key the claim does not carry (JavaScript's undefined), never the same as null
_JS_LINE_END = "\n\r\u2028\u2029"  # what a JavaScript `.` does not match


def _grouped(text):
    """Thousands separated: "1894.92" reads "1,894.92" (the leading digits only)."""
    return re.sub(r"^[0-9]+", lambda m: re.sub(r"\B(?=(?:[0-9]{3})+(?![0-9]))", ",", m.group(0)), text, count=1)


def _figure(x):
    """A figure as a controller reads it: thousands separated, two decimals, more only where the figure carries them (up to 4)."""
    if not is_num(x) or not math.isfinite(x):
        if isinstance(x, str):
            return x
        return "undefined" if x is _UNDEFINED else js_stringify(x)
    a = abs(x)
    cents = abs(a * 100 - js_round(a * 100)) < 1e-6
    text = js_to_fixed(a, 2) if cents else re.sub(r"0+\Z", "", js_to_fixed(a, 4))
    if text.endswith("."):
        text += "00"
    elif re.search(r"\.[0-9]\Z", text):
        text += "0"
    return ("-" if x < 0 else "") + _grouped(text)


def _money2(x):
    """A difference, always to two decimals ("5.00")."""
    return _grouped(js_to_fixed(abs(x), 2))


def _count(x):
    """A count as written ("10", "9.5"): quantities are not money."""
    if is_num(x) and math.isfinite(x):
        return ("-" if x < 0 else "") + _grouped(rb.js_number(abs(x)))
    return _figure(x)


def _cross_figure(rule, x):
    return _count(x) if rule == "QTY_MATCH" else _figure(x)


def _role_words(role):
    w = R.ROLE_WORDS.get(role)
    return w if w is not None else role.lower().replace("_", " ")


def _asserted_and_result(c):
    comp = c.get("computation")
    return c.get("asserted", _UNDEFINED), (comp["result"] if isinstance(comp, dict) and "result" in comp else _UNDEFINED)


def _two_figures(rule, asserted, result):
    """twoFigures: (computed, the invoice's own). For TOTAL_INT, TAX_INT and MATH_INT the invoice's figure is asserted and the
    recomputation computation.result; SUM_INT is the other way round (its predicate is LINE_ITEMS_SUM = SUBTOTAL)."""
    return (asserted, result) if rule == "SUM_INT" else (result, asserted)


def _pass_words(c):
    rule = c["rule_id"]
    check = R.WORDS_CHECK[rule]
    a, r = _asserted_and_result(c)
    if rule in R.WORDS_RECOMPUTE and is_num(a) and is_num(r):
        computed, invoice = _two_figures(rule, a, r)
        return "%s: %s computed, %s on the invoice%s" % (check, _figure(computed), _figure(invoice),
                                                         ", the same to the cent" if abs(invoice - computed) < 0.005 else "")
    if rule in R.WORDS_AGAINST and a is not None and a is not _UNDEFINED and r is not _UNDEFINED:
        return "%s: %s on the invoice, %s %s" % (check, _cross_figure(rule, a), _cross_figure(rule, r), R.WORDS_AGAINST[rule])
    if rule == "TIME_ORD" and isinstance(a, str):
        return "the service date, %s, falls within the contract's term" % a
    return "%s: it holds" % check


def _fail_words(c, reasons):
    rule = c["rule_id"]
    check = R.WORDS_CHECK[rule]
    a, r = _asserted_and_result(c)
    if rule in R.WORDS_RECOMPUTE and is_num(a) and is_num(r):
        computed, invoice = _two_figures(rule, a, r)
        return "%s: %s computed, but the invoice says %s (a difference of %s)" % (check, _figure(computed), _figure(invoice), _money2(invoice - computed))
    if rule in R.WORDS_AGAINST and a is not None and a is not _UNDEFINED and r is not _UNDEFINED:
        return "%s does not hold: %s on the invoice, %s %s" % (check, _cross_figure(rule, a), _cross_figure(rule, r), R.WORDS_AGAINST[rule])
    return "%s does not hold: %s" % (check, reasons)


def _not_given_words(c, roles):
    what = R.CANT_TELL_WHAT.get(c["rule_id"], "the check %s" % c["rule_id"])
    return "Can't tell %s: not given: %s" % (what, ", ".join(_role_words(r) for r in roles))


def _held_back_words(c):
    what = R.CANT_TELL_WHAT.get(c["rule_id"], "the check %s" % c["rule_id"])
    ins = c.get("insufficiency")
    reason = ins.get("reason") if isinstance(ins, dict) else None
    if reason == "AMBIGUOUS_REFERENCE":
        why = ("the contract lists several values it could be checked against, and none is tied to this line. Give one value, or a "
               "contract line whose description matches this line")
    elif reason == "AMBIGUOUS_FIELD":
        why = ("a figure it rests on was found only by a near match of its field name, and nothing is decided on a guessed field. "
               "Give it under a field name the ruleset reads")
    else:
        why = "a figure it rests on is not certain, so nothing was decided"
    return "Can't tell %s: %s" % (what, why)


def _js_replace_first(s, pattern, replacement):
    """s.replace(pattern, replacement) for a string pattern: the first occurrence, with the replacement's $ patterns read."""
    at = s.find(pattern)
    if at < 0:
        return s
    out, i = [], 0
    while i < len(replacement):
        ch = replacement[i]
        nxt = replacement[i + 1] if i + 1 < len(replacement) else ""
        if ch == "$" and nxt in ("$", "&", "`", "'"):
            out.append({"$": "$", "&": pattern, "`": s[:at], "'": s[at + len(pattern):]}[nxt])
            i += 2
            continue
        out.append(ch)
        i += 1
    return s[:at] + "".join(out) + s[at + len(pattern):]


_JS_SPACE = "[" + re.escape(_JS_WS) + "]"


def explain_in_words(claims):
    """explainInWords: reword every invoice explanation the kernel wrote in its own vocabulary, in place. An INSUFFICIENT_DATA
    claim whose text says a law was VIOLATED is left to the can't-tell wording that runs after this."""
    for c in claims:
        expl = c.get("explanation")
        if not isinstance(expl, str) or c.get("rule_id") not in R.WORDS_CHECK:
            continue
        name = c["rule_name"] if isinstance(c.get("rule_name"), str) else ""
        missing = re.match(r"^Cannot evaluate: missing bindings for ([^%s]+)\Z" % _JS_LINE_END, expl)
        if missing:
            c["explanation"] = _not_given_words(c, re.split(",%s*" % _JS_SPACE, missing.group(1)))
            continue
        if not name:
            continue
        passed = "%s: All predicates satisfied." % name
        if c["outcome"] == "INSUFFICIENT_DATA":
            # a check held back after it passed: "Abstained: <name>: All predicates satisfied." becomes the reason in words
            if passed in expl:
                c["explanation"] = _held_back_words(c)
            continue
        if c["outcome"] == "PASS" and passed in expl:
            c["explanation"] = _js_replace_first(expl, passed, "%s." % _pass_words(c))
            continue
        # a FAIL, or a PASS the rounding pass turned from one ("Within tolerance (…): treated as rounding, not error. <name> VIOLATED: …")
        m = re.match(r"^(.*?)%s VIOLATED: (.*?)( Not treated as rounding: .*)?\Z" % re.escape(name), expl, re.S)
        if not m:
            continue
        if c["outcome"] == "FAIL":
            c["explanation"] = "%s%s%s" % (m.group(1), _fail_words(c, m.group(2)), m.group(3) or "")
        elif c["outcome"] == "PASS":
            c["explanation"] = "%s%s.%s" % (m.group(1), _pass_words(c), m.group(3) or "")


# ---------------------------------------------------------------------------------------------------------------------
# Remedies (packages/verify/src/verdict/remedy.ts)

def _show(v):
    if v is None:
        return "?"
    if is_num(v) or isinstance(v, bool):
        return js_str(v)
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ", ".join(_show(x) for x in v)
    return rb.canonical_json(v)


def _facts(c):
    m = re.search(r"line\[(\d+)\]", c["claim_id"])
    line = m.group(1) if m else None

    def fact(key):
        comp = c.get("computation") or {}
        if key.startswith("op:"):
            return _show((comp.get("operands") or {}).get(key[3:]))
        ins = c.get("insufficiency") or {}
        return {
            "field": lambda: c["field"], "asserted": lambda: _show(c.get("asserted")), "expected": lambda: _show(comp.get("result")),
            "variance": lambda: "?" if c.get("variance") is None else rb.js_number(c["variance"]), "claim": lambda: c["claim_id"],
            "rule": lambda: c["rule_id"], "line": lambda: line if line is not None else "?",
            "position": lambda: "?" if line is None else str(int(line) + 1),
            "missing": lambda: ", ".join(ins["missing"]) if ins.get("missing") else "?",
            "reason": lambda: ins.get("reason", "?"),
        }.get(key, lambda: "?")()
    return fact


def _fill(text, fact):
    return re.sub(r"\{(op:[A-Za-z0-9_]+|[a-z]+)\}", lambda m: fact(m.group(1)), text)


def _instantiate(spec, c):
    fact = _facts(c)
    r = {"kind": spec["kind"], "detail": _fill(spec["detail"], fact)}
    if "operand" in spec:
        op = {"source": spec["operand"]["source"]}
        if "role" in spec["operand"]:
            op["role"] = spec["operand"]["role"]
        if "path" in spec["operand"]:
            op["path"] = _fill(spec["operand"]["path"], fact)
        r["operand"] = op
    if "transform" in spec:
        r["transform"] = spec["transform"]
    if "authority" in spec:
        r["authority"] = spec["authority"]
    return r


def _source_of(role):
    for name in ("contract", "evidence", "history"):
        if role in R.REFERENCE_ROLES[name]:
            return name
    return R.RULESET["id"]


def _derived_abstain(c):
    doc = R.RULESET["id"]
    ins = c.get("insufficiency") or {}
    missing = ins.get("missing") or []
    reason = ins.get("reason")
    if reason == "REFERENCE_NOT_PROVIDED":
        if not missing:
            return [{"kind": "missing-operand", "operand": {"source": "reference"}, "detail": "supply the reference this check reads: %s" % ins["detail"]}]
        by = {}
        for m in missing:
            by.setdefault(_source_of(m), []).append(m)
        out = []
        for source, roles in by.items():
            op = {"source": source}
            if len(roles) == 1:
                op["role"] = roles[0]
            out.append({"kind": "missing-operand", "operand": op, "detail": "supply the %s reference: %s needs %s from it" % (source, c["rule_id"], ", ".join(roles))})
        return out
    if reason == "FIELD_MISSING":
        if not missing:
            return [{"kind": "missing-operand", "operand": {"source": doc, "path": c["field"]}, "detail": "supply %s: %s" % (c["field"], ins["detail"])}]
        out = []
        for m in missing:
            if m not in R.COMPUTED_ROLES:
                out.append({"kind": "missing-operand", "operand": {"source": _source_of(m), "role": m}, "detail": "supply %s: the rule cannot run without it" % m})
                continue
            why = None
            if re.match(r"^[A-Z0-9_]+\Z", m):
                hit = re.search(r"(?:^|; )%s: ([^;]*)" % m, ins["detail"])
                if hit:
                    why = hit.group(1).split(" — ")[0]
            out.append({"kind": "missing-operand", "operand": {"source": doc, "role": m},
                        "detail": "%s is computed from the document and could not be: %s" % (m, why if why is not None else ins["detail"])})
        return out
    if reason == "UNPARSEABLE":
        if missing:
            return [{"kind": "recompute-with", "operand": {"source": _source_of(m), "role": m},
                     "detail": "re-read %s as a value the rule can compare: %s" % (m, ins["detail"])} for m in missing]
        return [{"kind": "recompute-with", "operand": {"source": doc, "path": c["field"]}, "detail": "re-read %s as a value the rule can compare: %s" % (c["field"], ins["detail"])}]
    if reason == "AMBIGUOUS_FIELD":
        return [{"kind": "transform", "transform": "declare-field-path", "operand": {"source": doc, "path": c["field"]}, "detail": "say which field is %s: %s" % (c["field"], ins["detail"])}]
    if reason == "OUT_OF_RULESET_SCOPE":
        return [{"kind": "authority", "authority": "reviewer", "detail": "the ruleset does not decide this (%s); a person rules, for this verdict only" % ins["detail"]}]
    raise Outside("a claim that cannot run for the reason %s; its remedies are not re-performed by this build" % reason)


def _specs(c):
    declared = R.REMEDY_TABLE.get(c["rule_id"])
    if c["outcome"] == "FAIL":
        if declared and declared.get("fail"):
            return declared["fail"]
        return [{"kind": "none", "detail": "no remedy is declared for %s: the finding stands" % c["rule_id"]}]
    reason = (c.get("insufficiency") or {}).get("reason")
    hits = [s for s in (declared or {}).get("abstain", []) if "when" not in s or (reason is not None and reason in s["when"])]
    return hits if hits else _derived_abstain(c)


def remedies_for(outcome, claims):
    open_ = [c for c in claims if c["outcome"] == "FAIL"] + [c for c in claims if c["outcome"] == "INSUFFICIENT_DATA"]
    if not open_:
        if outcome == "PASS":
            return None
        return [{"kind": "missing-operand", "operand": {"source": R.RULESET["id"]},
                 "detail": "every claim passed, but under ANY_FAIL_FAILS they cannot alone make the verdict PASS: supply a value to check against the invoice"
                 if claims else "no claim could be formed from these inputs: supply a document the ruleset reads", "clears": [], "claims": []}]
    merged = {}
    for c in open_:
        for s in _specs(c):
            r = _instantiate(s, c)
            key = rb.canonical_json(r)
            if key in merged:
                hit = merged[key]
                if c["rule_id"] not in hit["clears"]:
                    hit["clears"].append(c["rule_id"])
                if c["claim_id"] not in hit["claims"]:
                    hit["claims"].append(c["claim_id"])
            else:
                r = dict(r)
                r["clears"] = [c["rule_id"]]
                r["claims"] = [c["claim_id"]]
                merged[key] = r
    return list(merged.values())


# ---------------------------------------------------------------------------------------------------------------------
# The verdict (packages/verify/src/verify.ts)

def remedy_table_hash():
    h = rb.sha256_hex(rb.canonical_json(R.REMEDY_TABLE))
    if h != R.EXPECTED_REMEDY_TABLE_HASH:
        raise RuntimeError("the transcribed remedy table hashes to %s, not the engine's %s" % (h, R.EXPECTED_REMEDY_TABLE_HASH))
    return h


def _first_big_number(v, path="$"):
    if is_num(v):
        return path if abs(v) > MAX_SAFE_INTEGER else None
    if isinstance(v, list):
        for i, x in enumerate(v):
            p = _first_big_number(x, "%s[%d]" % (path, i))
            if p:
                return p
    elif isinstance(v, dict):
        for k in js_keys(v):
            p = _first_big_number(v[k], "%s.%s" % (path, k) if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", k) else "%s[%s]" % (path, rb.js_string(k)))
            if p:
                return p
    return None


def _value_at_path(v, path):
    """The value a path _first_big_number wrote ($.a, $[0], $["a b"]) names in v."""
    for m in re.finditer(r'\.([A-Za-z_$][A-Za-z0-9_$]*)|\[([0-9]+)\]|\[("(?:[^"\\]|\\.)*")\]', path[1:]):
        if m.group(2) is not None:
            v = v[int(m.group(2))]
        else:
            v = v[m.group(1) if m.group(1) is not None else json.loads(m.group(3))]
    return v


def _scope_guard(extraction, engine):
    """What this build does not re-perform yet, refused by name before anything is computed."""
    if not isinstance(extraction, dict):
        raise Outside("the extraction is not a JSON object; the engine answers it with a verdict this build does not re-perform yet")
    if not engine_at_least(engine, "0.6.0"):
        return  # the near-miss key rule is engine 0.6.0's strict reading; earlier engines read keys as written
    def fold(k):  # strict.ts foldKey: NFKC, then every format character, space separator and JavaScript \s removed
        return "".join(ch for ch in unicodedata.normalize("NFKC", k)
                       if unicodedata.category(ch) not in ("Cf", "Zs") and ch not in _JS_WS)

    def walk(o, depth):
        if isinstance(o, dict):
            for k in o:
                if fold(k) != k:
                    raise Outside("the key %s holds spaces or invisible characters; the engine 0.6.0 near-miss key rule is not "
                                  "re-performed by this build" % rb.js_string(k))
                if depth > 1:
                    walk(o[k], depth - 1)
        elif isinstance(o, list):
            for x in o:
                walk(x, depth)
    walk(extraction, 3)
    if isinstance(extraction.get("line_items"), list) is False:
        for k in ("items", "lines"):
            if isinstance(extraction.get(k), list):
                raise Outside("the line items are under %s; only line_items is re-performed by this build" % rb.js_string(k))


def _doubles(v):
    if isinstance(v, dict):
        return {k: _doubles(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_doubles(x) for x in v]
    if isinstance(v, int) and not isinstance(v, bool):
        return float(v)
    return v


def _given(references, source):
    """What verify() counts as supplied: a contract object, evidence and history objects, page text. Outside this build."""
    refs = references if isinstance(references, dict) else {}
    if isinstance(refs.get("contract"), dict):
        raise Outside("a contract reference is supplied; references are not re-performed by this build yet")
    for name in ("evidence", "history"):
        if isinstance(refs.get(name), list) and any(isinstance(x, dict) for x in refs[name]):
            raise Outside("%s references are supplied; references are not re-performed by this build yet" % name)
    if isinstance(source, dict) and isinstance(source.get("text"), str) and source["text"] != "":
        raise Outside("page text (source) is supplied; the source-text checks are not re-performed by this build yet")


def issue(extraction, issued_at, engine=R.ENGINE_VERSION, producer=None, references=None, source=None):
    """verify(extraction, { engine, producer, references, source }) for invoice@0.1.0. references and source are hashed as
    given (absent: null / [] / [] and null), and refused as Outside when they supply anything a check would read."""
    if engine not in ENGINES:
        raise Refused("verify: engine %s is not one this build carries (it carries %s)" % (engine, ", ".join(ENGINES)))
    # every JSON number is a double: a caller that parsed with json.load (ints) is read as the engine reads its numbers
    extraction, references, source = _doubles(extraction), _doubles(references), _doubles(source)
    if extraction is None:
        raise Refused("verify: input refused: the extraction is null: there is no document to verify (pass the extracted fields as a JSON object)")
    if isinstance(extraction, dict):
        binds = lambda v: isinstance(v, dict) and isinstance(v.get("verdict_id"), str) and isinstance(v.get("input_hash"), str) \
            and isinstance(v.get("engine_version"), str) and isinstance(v.get("ruleset"), dict)
        if binds(extraction) or (isinstance(extraction.get("verdict"), dict) and (
                (isinstance(extraction.get("signature"), str) and isinstance(extraction.get("public_key"), str))
                or (binds(extraction["verdict"]) and "inputs" in extraction))):
            raise Refused("verify: this looks like a verdict, an envelope or a replay bundle, not an extraction; replay it instead")
    big = _first_big_number(extraction) if engine_at_least(engine, "0.6.0") else None
    if big:
        # hash-input.ts unsafeMagnitudeRefusal, as verify() words it for the extraction; the command line leads it with
        # "verify: input refused: " (the library's own message is kept beside, for a caller that wraps it as a replay does)
        inner = ("verify: the extraction: the number at %s (%s) is a number that cannot be represented exactly; write amounts as strings "
                 "with two decimals. Past 9007199254740991 (2^53 - 1) a double cannot hold every whole number, so this one may already "
                 "have been rounded when it was parsed, and the hash and every check would read the rounded figure. Then run it again"
                 % (big, rb.js_number(_value_at_path(extraction, big))))
        refusal = Refused("verify: input refused: %s" % inner)
        refusal.library_message = inner
        raise refusal
    _scope_guard(extraction, engine)
    refs_in = references if isinstance(references, dict) else {}
    _given(refs_in, source)

    inputs = rb.bound_inputs({"extraction": extraction,
                              "references": {"contract": refs_in.get("contract"),
                                             "evidence": refs_in["evidence"] if refs_in.get("evidence") is not None else [],
                                             "history": refs_in["history"] if refs_in.get("history") is not None else []},
                              "source": source}, {})
    input_hash = rb.sha256_hex(rb.canonical_json(inputs))
    extraction_hash = rb.sha256_hex(rb.canonical_json(extraction))

    items = extraction.get("line_items") if isinstance(extraction.get("line_items"), list) else []
    line_ctxs = [bind(extraction, i, engine) for i in range(len(items))]
    doc_ctx = bind(extraction, None, engine)
    refs = {"contract": False, "evidence": False, "history": False}
    doc_absence, line_absence, attach, ruleset_claims = compute(extraction, doc_ctx, line_ctxs)

    claims = [to_claim(validate(code, doc_ctx), doc_ctx, "document", doc_absence, refs) for code in R.DOCUMENT_CODES]
    for i, ctx in enumerate(line_ctxs):
        claims += [to_claim(validate(code, ctx), ctx, "line[%d]" % i, line_absence[i], refs) for code in R.LINE_CODES]
    claims += ruleset_claims
    by_id = {}
    for c in claims:
        by_id.setdefault(c["claim_id"], c)
    for cid, extra in attach.items():
        c = by_id.get(cid)
        if not c:
            continue
        seen = {ev_key(e) for e in c["evidence"]}
        for e in extra:
            if ev_key(e) in seen:
                continue
            seen.add(ev_key(e))
            c["evidence"].append(e)
    apply_tolerance(claims, R.DEFAULT_TOLERANCE)
    abstain_on_guessed(claims)
    if engine_at_least(engine, "0.7.1"):  # rulesets/invoice/index.ts finish(): every engine after 0.7.0 explains in words
        explain_in_words(claims)
    if engine_at_least(engine, "0.6.0"):
        cant_tell_in_words(claims)

    p = sum(1 for c in claims if c["outcome"] == "PASS")
    f = sum(1 for c in claims if c["outcome"] == "FAIL")
    coverage = {"claims_total": len(claims), "claims_checked": p + f, "claims_pass": p, "claims_fail": f,
                "claims_insufficient": len(claims) - p - f}
    outcome = "FAIL" if f > 0 else ("INSUFFICIENT_DATA" if p + f == 0 else "PASS")
    if outcome == "FAIL":
        gate = "FAIL"
    elif outcome != "PASS":
        gate = outcome
    else:
        gate = "PASS_WITH_OPEN" if any(c["outcome"] == "INSUFFICIENT_DATA" for c in claims) else "PASS"
    # Engine 0.2.0 binds the remedy table into the id (protocol/verdict-id.ts); 0.0.1 and 0.1.0 derive it from three parts
    rth = remedy_table_hash() if engine_at_least(engine, "0.2.0") else None
    document = {"extraction_hash": extraction_hash}
    if producer is not None:
        document["producer"] = producer
    document["line_items"] = float(len(items))
    verdict = {
        "schema_version": R.SCHEMA_VERSION,
        "verdict_id": rb.derive_verdict_id(input_hash, R.RULESET, engine, rth),
        "issued_at": issued_at,
        "engine_version": engine,
        "ruleset": dict(R.RULESET),
        "input_hash": input_hash,
    }
    if rth is not None:
        verdict["remedy_table_hash"] = rth
    verdict.update({"replayable": True, "document": document,
                    "references": {"contract": False, "evidence": 0.0, "history": 0.0, "source": False},
                    "outcome": outcome})
    if engine_at_least(engine, "0.6.0"):  # verdict/aggregation.ts: gate_status, the key right after outcome
        verdict["gate_status"] = gate
    verdict.update({"aggregation": "ANY_FAIL_FAILS", "claims": claims, "coverage": {k: float(v) for k, v in coverage.items()}})
    remedies = remedies_for(outcome, claims)
    if remedies is not None:
        verdict["remedies"] = remedies
    if engine_at_least(engine, "0.3.0"):  # verdict/scope.ts: the scope block closes every verdict from engine 0.3.0
        verdict["scope"] = {"ruleset": "%s@%s" % (R.RULESET["id"], R.RULESET["version"]), "engine_version": engine,
                            "evidence_floor": "unstated", "statements": list(R.SCOPE_STATEMENTS)}
    return verdict


def _fix_ints(v):
    """Confidences are written as the integers the engine holds; every number is a double on the wire either way."""
    if isinstance(v, dict):
        return {k: _fix_ints(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_fix_ints(x) for x in v]
    if isinstance(v, int) and not isinstance(v, bool):
        return float(v)
    return v


def render(verdict):
    return pretty(_fix_ints(verdict)) + "\n"


def headline(v):
    n = len(v["claims"])
    s = gate_of(v)
    checks = lambda k: "%d of %d check%s" % (k, n, "" if n == 1 else "s")
    if s == "FAIL":
        return "FAIL: %s failed" % checks(sum(1 for c in v["claims"] if c["outcome"] == "FAIL"))
    if s == "INSUFFICIENT_DATA":
        return "INSUFFICIENT_DATA: none of the %d check%s could run" % (n, "" if n == 1 else "s")
    if s == "PASS_WITH_OPEN":
        return "PASS-WITH-OPEN: %s could not run" % checks(sum(1 for c in v["claims"] if c["outcome"] == "INSUFFICIENT_DATA"))
    return "PASS: %s ran and held" % checks(sum(1 for c in v["claims"] if c["outcome"] == "PASS"))



# ---------------------------------------------------------------------------------------------------------------------
# Reading under the hash contract: riposte_bind's reader, unchanged, plus the JSON path of a repeated key, which the engine's
# refusal names (packages/verify/src/protocol/hash-input.ts duplicateKeyPath, duplicateKeyRefusal) and that reader does not.

_SCALAR = re.compile(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null')


def _path_step(path, key):
    if isinstance(key, int):
        return "%s[%d]" % (path, key)
    return "%s.%s" % (path, key) if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", key) else "%s[%s]" % (path, rb.js_string(key))


def duplicate_key_path(text):
    """The first key repeated in one object, scanning the text in order: (path, key), or None."""
    ws = " \t\n\r"

    def value(i, path):
        while text[i] in ws:
            i += 1
        c = text[i]
        if c == "{":
            i += 1
            seen = set()
            while True:
                while text[i] in ws:
                    i += 1
                if text[i] == "}":
                    return i + 1, None
                key, i = json.decoder.scanstring(text, i + 1)
                if key in seen:
                    return i, (_path_step(path, key), key)
                seen.add(key)
                while text[i] in ws:
                    i += 1
                i, hit = value(i + 1, _path_step(path, key))  # past the colon
                if hit:
                    return i, hit
                while text[i] in ws:
                    i += 1
                if text[i] == ",":
                    i += 1
                    continue
                return i + 1, None
        if c == "[":
            i += 1
            n = 0
            while True:
                while text[i] in ws:
                    i += 1
                if text[i] == "]":
                    return i + 1, None
                i, hit = value(i, _path_step(path, n))
                if hit:
                    return i, hit
                while text[i] in ws:
                    i += 1
                n += 1
                if text[i] == ",":
                    i += 1
                    continue
                return i + 1, None
        if c == '"':
            return json.decoder.scanstring(text, i + 1)[1], None
        m = _SCALAR.match(text, i)
        return m.end(), None

    try:
        return value(0, "$")[1]
    except (IndexError, ValueError, AttributeError):
        return None


def read_json(data, name):
    """rb.read_json_bytes; a repeated key is refused in the engine's words, with its JSON path."""
    try:
        return rb.read_json_bytes(data, name)
    except rb.Refused as e:
        if "appears twice in one object" not in str(e):
            raise
        hit = duplicate_key_path(data.decode("utf-8"))
        if hit is None:
            raise
        raise rb.Refused("%s: the key %s appears twice in one object (at %s). JSON keeps only the last of them, so a reader that "
                         "keeps the first would see a different document than the one hashed and signature-checked here. Keep one "
                         "of them, then run it again" % (name, rb.js_string(hit[1]), hit[0]))


def gate_of(v):
    """recordedGateStatus: the verdict's own gate_status, or the same reading from its claims (an earlier engine's verdict)."""
    if v.get("gate_status") in ("PASS", "PASS_WITH_OPEN", "FAIL", "INSUFFICIENT_DATA"):
        return v["gate_status"]
    if v["outcome"] != "PASS":
        return v["outcome"]
    return "PASS_WITH_OPEN" if any(c["outcome"] == "INSUFFICIENT_DATA" for c in v["claims"]) else "PASS"


# ---------------------------------------------------------------------------------------------------------------------
# Replay: re-perform a bundle's verdict and compare it byte for byte (packages/verify/src/protocol/replay.ts verifyReplay,
# reperform, compareBodies; the words of packages/verify/src/cli.ts runReplay). Exit codes: INTERCHANGE.md section 13.

ANNOTATIONS = ["channel", "ledger", "declared_accuracy", "action_context", "case"]
ISSUED_AT_MISSING = "the verdict carries no issued_at (every verdict records when it was issued; --strict fails it)"

# Keys outside the verdict and its inputs (packages/verify/src/protocol/replay-case.ts carriedKeys, allowedKeys): a replay
# compares the verdict and binds its inputs and reads nothing else, so every replay names such keys, and --strict refuses them.
# `id` and `note` at a bundle's top level are the two caller keys a bundle may carry: named apart, never refused.
_ENVELOPE_KEYS = ("verdict", "alg", "public_key", "signature")
_BUNDLE_KEYS = ("verdict", "inputs", "options")
_AP_OUTPUT_KEYS = ("verdict", "decision", "payable", "grounding", "reasons", "not_checked", "proof", "read", "exit", "allow_open")
_AP_READ_KEYS = ("form", "text_sha256", "history_sha256", "policy", "invoice_sha256", "po_sha256", "receipt_sha256")
ALLOWED_CALLER_KEYS = ("id", "note")
NOT_A_BUNDLE = 'not a replay bundle: { "verdict": <verdict or envelope>, "inputs": <inputs>, "options"? }'
# The advice a replay gives for a number that cannot be represented exactly (replay-case.ts replayAdvice): writing it as a string
# changes the input the verdict is bound to, so the replay advises re-issuing the verdict instead.
INEXACT_NUMBER_WORDS = "a number that cannot be represented exactly; write amounts as strings with two decimals"
REPLAY_INEXACT_WORDS = ("a number that cannot be represented exactly; re-issue the verdict with the amount as a string; a replay of "
                        "the existing verdict cannot change its input")


# Fail closed (2026-10-19; protocol/replay-case.ts unknownKeys, unknownKeysReason): a key a bundle or a signed envelope does not
# define is refused before anything is hashed, each named by its path, unless the caller states --allow-unknown-keys, which reads it
# as before (carried, not checked; --strict refuses it) and says so. The AP gate's fields beside an AP verdict whose inputs the gate
# reads are the format's own (a replay compares them), so they are not among the unknown keys.
UNKNOWN_KEYS_WORDS = "its format does not define"
ALLOW_UNKNOWN_KEYS_LINE = ("--allow-unknown-keys was given: a key a bundle or a signed envelope does not define is named and carried, "
                           "not checked, instead of refused (the caller's stated choice; --strict still refuses it)")
_AP_DERIVED_KEYS = ("decision", "payable", "grounding", "reasons", "not_checked")


def _ap_derivable(x):
    """replay-ap.ts apDerivable: an AP verdict (ap-threeway or ap-structured) beside inputs the gate reads ({ policy, ap | ap_structured })."""
    if not isinstance(x, dict) or not isinstance(x.get("verdict"), dict):
        return False
    v = x["verdict"]["verdict"] if isinstance(x["verdict"].get("verdict"), dict) and isinstance(x["verdict"].get("signature"), str) else x["verdict"]
    i = x.get("inputs")
    return isinstance(v.get("ruleset"), dict) and js_str(v["ruleset"].get("id")) in ("ap-threeway", "ap-structured") \
        and isinstance(i, dict) and isinstance(i.get("policy"), dict) and (isinstance(i.get("ap_structured"), dict) or isinstance(i.get("ap"), dict))


def unknown_keys(x):
    """(kind, keys): the keys a bundle or a signed envelope carries that its format does not define, by path; none for anything else."""
    if not isinstance(x, dict):
        return "bundle", []
    if _is_envelope(x):
        return "signed envelope", carried_keys(x)
    if _is_ap_output(x) or not is_replay_bundle(x):
        return "bundle", []
    keys = carried_keys(x)
    if _ap_derivable(x):
        keys = [k for k in keys if k not in _AP_DERIVED_KEYS]
    return "bundle", keys


def unknown_keys_reason(kind, keys):
    """The words a replay refuses unknown keys with (after "input refused: "), as replay-case.ts unknownKeysReason writes them."""
    one = len(keys) == 1
    shape = ("a bundle is { verdict, inputs, options? } with the caller keys id and note, and beside an AP verdict the gate's fields, "
             "which a replay compares") if kind == "bundle" else "a signed envelope is { verdict, alg, public_key, signature }"
    return ("the %s carries %s %s: %s (%s; a replay checks nothing else, so it refuses what it would not check: remove %s, or replay "
            "with --allow-unknown-keys to have %s named and carried, not checked)"
            % (kind, "a key" if one else "keys", UNKNOWN_KEYS_WORDS, ", ".join(keys), shape, "it" if one else "them", "it" if one else "them"))


# An annotation is never compared, but its members are held to its declared shape (2026-10-19; protocol/replay.ts ANNOTATION_SHAPES,
# annotationMemberProblem): a member the shape does not declare is refused, with or without --strict; --allow-unknown-keys does not
# reach it.
ANNOTATION_SHAPES = (("ledger", ("tenant_id", "retention_until", "reviewer")),
                     ("declared_accuracy", ("domain", "ruleset_version", "fp_rate", "fn_rate", "abstain_rate", "measured_on")),
                     ("action_context", ("tool_name", "call_id", "argument_path")),
                     ("case", ("case_id", "prior_verdict_id", "move_id")))
_LEDGER_REVIEWER_SHAPE = ("id", "decided_at", "decision", "note")


def annotation_member_problem(verdict):
    """Why a verdict is refused for an annotation member its declared shape does not have, in the engine's words; None when none."""
    if not isinstance(verdict, dict):
        return None
    found = []

    def check(at, value, shape):
        if isinstance(value, dict):
            members = ["%s.%s" % (at, k) for k in js_keys(value) if k not in shape]
            if members:
                found.append((at, shape, members))
    shapes = dict(ANNOTATION_SHAPES)
    for a in ANNOTATIONS:
        if a not in shapes:
            continue
        check(a, verdict.get(a), shapes[a])
        if a == "ledger" and isinstance(verdict.get("ledger"), dict):
            check("ledger.reviewer", verdict["ledger"].get("reviewer"), _LEDGER_REVIEWER_SHAPE)
    if not found:
        return None
    n = sum(len(m) for _, _, m in found)
    parts = ["the verdict's %s carries %s its declared shape { %s } does not have: %s"
             % (at, "a member" if len(members) == 1 else "members", ", ".join(shape), ", ".join(members)) for at, shape, members in found]
    return ("%s (an annotation is added after the engine and is never compared, so a member it does not declare is a claim nothing checks; "
            "remove %s: annotations sit outside what the verdict_id binds, so the verdict replays without %s)"
            % ("; ".join(parts), "it" if n == 1 else "them", "it" if n == 1 else "them"))


def carried_line(keys):
    return "carried, not checked: %s (outside the verdict and its inputs: a replay compares neither; --strict refuses them)" % ", ".join(keys)


def allowed_line(keys):
    return ("carried (allowed): %s (the caller keys a bundle may carry beside its verdict: not checked, and --strict allows them)"
            % ", ".join(keys))


def _outside_keys_problem(keys):
    return "outside keys under --strict: %s (carried beside the verdict, not checked: remove them, or replay without --strict)" % ", ".join(keys)


def replay_advice(message):
    if INEXACT_NUMBER_WORDS not in message:
        return message
    return re.sub(r"\. Then run it again\Z", "", message.replace(INEXACT_NUMBER_WORDS, REPLAY_INEXACT_WORDS, 1))


def _is_envelope(x):
    return isinstance(x, dict) and isinstance(x.get("verdict"), dict) and isinstance(x.get("signature"), str) \
        and isinstance(x.get("public_key"), str)


def is_replay_bundle(x):
    """{ verdict, inputs?, options? } rather than a bare verdict or envelope; any other key is carried, not checked."""
    return isinstance(x, dict) and isinstance(x.get("verdict"), dict) and not _is_envelope(x)


def _is_ap_output(x):
    if "inputs" in x:
        return False
    if isinstance(x.get("proof"), dict) and isinstance(x["proof"].get("verdict"), dict):
        return True
    v = x.get("verdict")
    return isinstance(v, dict) and isinstance(v.get("ruleset"), dict) and v["ruleset"].get("id") == "ap-threeway" \
        and isinstance(x.get("decision"), str)


def carried_keys(x):
    """The keys a replay file carries outside the verdict and its inputs, as paths from the file's top: beside a signed envelope's
    four members; beside a bundle's verdict, inputs and options (an options key the replay does not read, and an envelope's
    extra key when the bundle's verdict is one, `verdict.<key>`); beside the members `ap` writes, and its `read` member (this
    build is never given the files `read` records). A bare verdict carries none. `id` and `note` at a bundle's top level are not
    among them (allowed_keys)."""
    if not isinstance(x, dict):
        return []

    def extra(o, known, prefix=""):
        return [prefix + k for k in js_keys(o) if k not in known]
    if _is_envelope(x):
        return extra(x, _ENVELOPE_KEYS)
    if _is_ap_output(x):
        read = "read" in x
        return (extra(x, _AP_OUTPUT_KEYS) + (extra(x["proof"], ("verdict", "inputs"), "proof.") if isinstance(x.get("proof"), dict) else [])
                + (["read"] if read else []))
    if not is_replay_bundle(x):
        return []
    out = extra(x, _BUNDLE_KEYS + ALLOWED_CALLER_KEYS)
    if "options" in x:
        if not isinstance(x["options"], dict):
            out.append("options")
        else:
            for k in js_keys(x["options"]):
                v = x["options"][k]
                if not (k == "tolerance" and isinstance(v, dict)) and not (k == "document" and isinstance(v, str)):
                    out.append("options.%s" % k)
    if _is_envelope(x["verdict"]):
        out += extra(x["verdict"], _ENVELOPE_KEYS, "verdict.")
    return out


def allowed_keys(x):
    """The allowed caller keys (`id`, `note`) a bundle carries at its top level, in the file's order; none for anything else."""
    if not isinstance(x, dict) or _is_envelope(x) or _is_ap_output(x) or not is_replay_bundle(x):
        return []
    return [k for k in js_keys(x) if k in ALLOWED_CALLER_KEYS]


def not_reperformed_fields(v):
    out = [k for k in ANNOTATIONS if k in v]
    if isinstance(v.get("document"), dict) and isinstance(v["document"].get("producer"), str):
        out.append("document.producer")
    return out


def first_difference(a, b, path=""):
    """The first path where b (presented) differs from a (re-performed), in a's own field order."""
    if isinstance(a, list) or isinstance(b, list):
        if not (isinstance(a, list) and isinstance(b, list)):
            return path or "(root)"
        for i in range(max(len(a), len(b))):
            if i >= len(a) or i >= len(b):
                return "%s[%d]" % (path, i)
            d = first_difference(a[i], b[i], "%s[%d]" % (path, i))
            if d is not None:
                return d
        return None
    if isinstance(a, dict) and isinstance(b, dict):
        for k in js_keys(a) + [k for k in js_keys(b) if k not in a]:
            d = first_difference(a.get(k), b.get(k), "%s.%s" % (path, k) if path else k)
            if d is not None:
                return d
        return None
    return None if rb.canonical_json(a) == rb.canonical_json(b) else (path or "(root)")


def _stripped(v):
    out = {k: x for k, x in v.items() if k != "issued_at" and k not in ANNOTATIONS}
    return out


def replay(data, name, strict=False, lenient_remedies=False, allow_unknown_keys=False):
    """(exit code, result for stdout, lines for stderr)."""
    try:
        bundle = read_json(data, name)
    except rb.Refused as e:
        why = replay_advice(str(e))
        return 3, {"status": "REFUSED", "reason": why}, ["input refused: %s" % why]
    code, res, lines, _ = replay_parsed(bundle, strict=strict, lenient_remedies=lenient_remedies, allow_unknown_keys=allow_unknown_keys)
    return code, res, lines


def replay_parsed(bundle, strict=False, lenient_remedies=False, allow_unknown_keys=False):
    """(exit code, result for stdout, lines for stderr, the case as a folder replay reports it) for a parsed file. A key a bundle
    or a signed envelope does not define is refused before anything is hashed (exit 3), unless allow_unknown_keys, which names it on
    the line under the first (carried, not checked), says the flag was given, and lets --strict refuse it."""
    carried, allowed = carried_keys(bundle), allowed_keys(bundle)
    kind, unknown = unknown_keys(bundle)
    if unknown and not allow_unknown_keys:
        # cli.ts runReplay: the refusal is the whole answer (nothing follows it); replay-case.ts replayBundle: a REFUSED case
        presented = _presented_of(bundle) if is_replay_bundle(bundle) else (bundle.get("verdict") if _is_envelope(bundle) else None)
        why = unknown_keys_reason(kind, unknown)
        case = dict([("result", "REFUSED")] + ([("verdict_id", presented["verdict_id"])] if isinstance(presented, dict)
                                                and isinstance(presented.get("verdict_id"), str) else []) + [("reason", why), ("unknown_keys", unknown)])
        res = {"status": "REFUSED", "refused": True, "reason": why, "unknown_keys": unknown}
        if strict:
            res["strict"] = {"ok": False, "problems": []}
        return 3, res, ["input refused: %s" % why], case
    follow = ([carried_line(carried)] if carried else []) + ([ALLOW_UNKNOWN_KEYS_LINE] if allow_unknown_keys else []) + \
        ([allowed_line(allowed)] if allowed else [])
    carried_block = dict(([("carried_not_checked", carried)] if carried else []) + ([("carried_allowed", allowed)] if allowed else [])
                         + ([("allow_unknown_keys", "stated")] if allow_unknown_keys else []))
    presented = None
    if isinstance(bundle, dict):
        presented = bundle["verdict"]["verdict"] if is_replay_bundle(bundle) and _is_envelope(bundle["verdict"]) else \
            bundle.get("verdict") if is_replay_bundle(bundle) else bundle
    vid = {"verdict_id": presented["verdict_id"]} if isinstance(presented, dict) and isinstance(presented.get("verdict_id"), str) else {}

    def done(code, status, lines, case, **extra):
        res = {"status": status}
        res.update(extra)
        res.update(carried_block)
        if strict:  # a strict replay passes only a verdict that re-performed (the VERIFIED path writes its own block)
            res["strict"] = {"ok": False, "problems": []}
        return code, res, lines[:1] + follow + lines[1:], case

    def refused(why, lead=""):
        return done(3, "REFUSED", ["input refused: %s%s" % (lead, why)], dict(result="REFUSED", **dict(vid, reason=lead + why)), reason=why)

    if not isinstance(bundle, dict):
        return refused("not a replay bundle: { \"verdict\": <verdict>, \"inputs\": <inputs>, \"options\"? }")
    if _is_envelope(bundle) or _is_envelope(bundle.get("verdict")):
        return refused("a signed envelope: its signature is not checked by this build, so it is not replayed here",
                       "outside what this build re-performs: ")
    try:
        bound = rb.check_bundle(bundle)
    except rb.Refused as e:
        return refused(replay_advice(str(e)))
    # replay.ts verifyReplay: after the verdict's own fields, an annotation member its declared shape does not have is refused
    problem = annotation_member_problem(presented)
    if problem:
        return refused(problem)
    ids = {k: bound.get(k) for k in ("recorded_input_hash", "computed_input_hash", "recorded_verdict_id", "computed_verdict_id")}
    if bound["binding"] != "holds":
        why = bound["reasons"][0]
        first = "verdict_id" if why.startswith(("verdict_id does not derive", "a verdict of engine")) else "input_hash"
        return done(1, "FAILED", ["FAILED: %s" % why], dict(result="DIVERGED", **dict(vid, first_difference=first, reason=why)),
                    reperformed=False, reason=why, **ids)
    verdict = bundle["verdict"] if isinstance(bundle.get("verdict"), dict) else bundle  # a bare verdict carries no inputs

    def not_here(why, words="structure verified; outcome NOT re-performed by this build"):
        case = dict(result="NOT_REPERFORMED", **dict(vid, reason="%s: %s" % (words, why)))
        return done(2, "NOT_REPERFORMED", ["%s: %s. Exit 2." % (words, why)], case, reperformed=False, reason=why, **ids)

    if verdict is bundle or "inputs" not in bundle:
        return not_here("no inputs were supplied, so the check was not run again (the verdict_id binds the inputs, not the outcome)",
                        "structure verified; outcome NOT re-performed")
    rs, engine, inputs = verdict["ruleset"], verdict["engine_version"], bundle.get("inputs")
    if (rs["id"], rs["version"]) != (R.RULESET["id"], R.RULESET["version"]):
        return not_here("this build re-performs invoice@0.1.0 only; the verdict is %s@%s" % (rs["id"], rs["version"]))
    if engine not in ENGINES:
        return not_here("the verdict was issued by engine %s, which the engine this build follows does not carry" % engine)
    if not (isinstance(inputs, dict) and all(k in inputs for k in ("extraction", "references", "source"))):
        return not_here("the inputs are not the built-in ruleset's { extraction, references, source }")
    if "tolerance" in inputs or (isinstance(bundle.get("options"), dict) and bundle["options"].get("tolerance") is not None):
        return not_here("a rounding-tolerance override; overrides are not re-performed by this build yet")
    producer = verdict["document"].get("producer") if isinstance(verdict.get("document"), dict) else None
    issued_at = verdict["issued_at"] if isinstance(verdict.get("issued_at"), str) else "1970-01-01T00:00:00.000Z"
    try:
        again = issue(inputs["extraction"], issued_at, engine=engine, producer=producer if isinstance(producer, str) else None,
                      references=inputs["references"], source=inputs["source"])
    except (Outside, Refused) as e:
        return not_here(str(e))
    again = json.loads(render(again))  # the bytes this engine writes, read back as a reader of them would
    engine_name = "verify:invoice"
    if again["input_hash"] != verdict["input_hash"]:
        first = "input_hash"
        identical, not_carried = False, False
    else:
        a, p = _stripped(again), _stripped(verdict)
        not_carried = "remedies" not in verdict and "remedies" in again and not engine_at_least(engine, "0.2.0")
        if not_carried:
            del a["remedies"]
        identical = rb.canonical_json(a) == rb.canonical_json(p)
        first = None if identical else (first_difference(a, p) or "(canonical bytes)")
    annotations = not_reperformed_fields(verdict)
    base = dict(reperformed=True, engine=engine_name, **ids)
    if annotations:
        base["annotations"] = annotations

    def diverged(first_field, why):
        case = dict(result="DIVERGED", **dict(vid, engine=engine_name, first_difference=first_field, reason=why))
        return done(1, "FAILED", ["FAILED: %s" % why], case, first_difference=first_field, reason=why, **base)

    if identical and not_carried and not lenient_remedies:
        n = len(again.get("remedies", []))
        return diverged("remedies", "the verdict carries no remedies; the engine re-derives %d %s for it (engine %s); a replayed verdict "
                        "must carry what it said. For a verdict issued before remedies existed, --lenient-remedies compares its core and "
                        "reports the re-derived remedies" % (n, "remedy" if n == 1 else "remedies", engine))
    if not identical:
        named = ""
        m = re.match(r"^remedies\[(\d+)\]", first)
        if m and "remedies" in again and int(m.group(1)) < len(again["remedies"]) and again["remedies"][int(m.group(1))].get("clears"):
            named = " (the remedy that answers %s)" % ", ".join(again["remedies"][int(m.group(1))]["clears"])
        movable = re.match(r"^(claims|outcome|gate_status|coverage|remedies)(\b|\[|\.|$)", first) is not None
        hint = ". If it was issued under a rounding-tolerance override, restate it (a verdict issued before 2026-09-28 does not commit to it in input_hash)" if movable else ""
        return diverged(first, "the re-performed verdict differs from the presented one at `%s`%s: the check run again on these inputs does "
                        "not give this verdict (%s, engine %s)%s" % (first, named, engine_name, engine, hint))
    line = "outcome VERIFIED: re-performed with %s (ruleset %s@%s, engine %s) and byte-identical%s.%s" % (
        engine_name, rs["id"], rs["version"], engine, "; " + ISSUED_AT_MISSING if "issued_at" not in verdict else ", issued_at aside",
        " Not re-performed (not the engine's output): %s." % ", ".join(annotations) if annotations else "")
    lines = [line, headline(verdict)]
    if not_carried:
        lines.append("  remedies absent; re-derived: the verdict carries no remedies (issued before engine 0.2.0 bound them, or removed since); these are this build's, and its core matched")
    problems = []
    if strict:
        fields = [f for f in annotations if f != "document.producer"]
        if fields:
            problems.append("not re-performed (not the engine's output): %s" % ", ".join(fields))
        if not_carried:
            problems.append("remedies absent; re-derived (the verdict carries none, so the remedies shown are this build's)")
        if "issued_at" not in verdict:
            problems.append("issued_at is missing: every verdict records when it was issued")
        if carried:
            problems.append(_outside_keys_problem(carried))
    claims = verdict["claims"] if isinstance(verdict.get("claims"), list) else []
    case = dict(result="MATCH", **dict(vid, engine=engine_name, answer=verdict["outcome"]))
    if "remedies" in again:
        case["remedies"] = again["remedies"]
    if not_carried:
        case["remedies_not_carried"] = True
    case.update(checks=len(claims), unchecked=sum(1 for c in claims if isinstance(c, dict) and c.get("outcome") == "INSUFFICIENT_DATA"))
    if strict:
        case["strict_problems"] = problems
    strict_block = {"strict": {"ok": not problems, "problems": problems}} if strict else {}
    if problems:
        # "in the file", since a key carried beside the verdict is one of the things listed
        lines.append("STRICT: FAILED: the outcome re-performed byte-identical, but not everything in the file was:\n%s"
                     % "\n".join("  " + p for p in problems))
    code, res, lines, case = done(1 if problems else 0, "VERIFIED", lines, case, **base)
    res.update(strict_block)
    return code, res, lines, case


# ---------------------------------------------------------------------------------------------------------------------
# A folder or a .jsonl of bundles (packages/verify/src/cli.ts runReplayCases, protocol/replay-case.ts replayBundles and
# renderCaseReplay): every case replayed on its own inputs, a summary on stdout, one line per case on stderr, the summary line
# last. A refused case wins the exit: 3 whenever any case was refused, else 1 when one diverged or failed --strict, else 2
# when one was not re-performed, else 0 (replayExit).

class _Unread(object):
    """A case that could not be read as JSON under the hash contract: refused with its own reason."""

    def __init__(self, reason):
        self.reason = reason


def _bundles_from(name, data):
    """bundlesFromText: a .jsonl holds one bundle per line (named <file>#<line>), a .json one bundle (<file>) or an array of them
    (<file>[i]). A line or file that does not read becomes a refused case, never the end of the replay."""
    if re.search(r"\.jsonl\Z", name, re.I):
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as e:
            return [(name, _Unread("%s is not valid UTF-8: the bytes at offset %d (%s) are not a UTF-8 character"
                                   % (name, e.start, " ".join("%02X" % b for b in data[e.start:e.start + 4]))))]
        out = []
        for i, line in enumerate(re.split(r"\r?\n", text)):
            if js_trim(line) == "":
                continue
            label = "%s#%d" % (name, i + 1)
            try:
                out.append((label, read_json(line.encode("utf-8", "surrogatepass"), label)))
            except rb.Refused as e:
                out.append((label, _Unread(replay_advice(str(e)))))
        return out
    try:
        x = read_json(data, name)
    except rb.Refused as e:
        return [(name, _Unread(replay_advice(str(e))))]
    return [("%s[%d]" % (name, i), b) for i, b in enumerate(x)] if isinstance(x, list) else [(name, x)]


def replay_exit(s):
    if s["refused"] > 0:
        return 3
    if s["diverged"] > 0 or s.get("strict_failed", 0) > 0:
        return 1
    return 2 if s["not_reperformed"] > 0 else 0


def _presented_of(bundle):
    if not is_replay_bundle(bundle):
        return None
    return bundle["verdict"]["verdict"] if _is_envelope(bundle["verdict"]) else bundle["verdict"]


def render_remedies(remedies):
    """One line per remedy (verdict/remedy.ts renderRemedies): `authority buyer → AP_PRICE_PO: approve …`."""
    out = []
    for r in remedies or []:
        op = r.get("operand")
        if r["kind"] == "authority":
            what = "authority %s" % r.get("authority")
        elif r["kind"] == "transform":
            what = "transform %s" % r.get("transform")
        elif op:
            what = "%s %s%s%s" % (r["kind"], op.get("source"), ":%s" % op["role"] if op.get("role") else "", " (%s)" % op["path"] if op.get("path") else "")
        else:
            what = r["kind"]
        out.append("%s%s: %s" % (what, " → %s" % ", ".join(r["clears"]) if r.get("clears") else "", r["detail"]))
    return out


def render_case(c, verdict, not_reperformed, carried, allowed):
    """renderCaseReplay: the case's line, then what it carries and what was not re-performed indented under it."""
    gate_words = headline(verdict) if c["result"] == "MATCH" and isinstance(verdict, dict) and isinstance(verdict.get("claims"), list) \
        and isinstance(verdict.get("outcome"), str) else None
    if c.get("answer") and gate_words is None:  # renderAnswer: only a PASS needs the count of checks that could not run
        unable = " with %d of %s check%s unable to run" % (c["unchecked"], c.get("checks", "?"), "" if c.get("checks") == 1 else "s") \
            if c["answer"] == "PASS" and c.get("unchecked") else ""
        gate_words = c["answer"] + unable
    answer = "  %s" % gate_words if c.get("answer") else ""
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
    if c["result"] == "MATCH" and not_reperformed:
        out += "\n    not re-performed (not the engine's output): %s" % ", ".join(not_reperformed)
    out += "".join("\n    remedy: %s" % line for line in render_remedies(c.get("remedies")))
    if c.get("remedies_not_carried"):
        out += ("\n    remedies absent; re-derived: the verdict carries no remedies (issued before engine 0.2.0 bound them, or removed "
                "since); these are this build's, and its core matched")
    if c["result"] == "MATCH" and isinstance(verdict, dict) and "issued_at" not in verdict and "strict_problems" not in c:
        out += "\n    " + ISSUED_AT_MISSING
    out += "".join("\n    STRICT: %s" % p for p in c.get("strict_problems") or [])
    return out


def replay_cases(path, strict=False, lenient_remedies=False, allow_unknown_keys=False):
    """(exit code, summary for stdout, text for stderr) for a folder (its *.json and *.jsonl files in name order, not walked into
    its folders) or a .jsonl file. A case whose bundle carries a key its format does not define is REFUSED, the keys named, unless
    allow_unknown_keys."""
    is_dir = os.path.isdir(path)
    items, skipped = [], []
    entries = sorted(os.listdir(path), key=lambda n: n.encode("utf-16-be", "surrogatepass")) if is_dir else [path]
    for n in entries:
        fp = os.path.join(path, n) if is_dir else n
        if is_dir and os.path.isdir(fp):
            skipped.append(n)
            continue
        if is_dir and not re.search(r"\.jsonl?\Z", n, re.I):
            continue
        name = n if is_dir else fp
        try:
            with open(fp, "rb") as fh:
                data = fh.read()
        except OSError as e:
            items.append((name, _Unread("cannot read %s: %s" % (name, e.strerror))))
            continue
        items.extend(_bundles_from(name, data))
    if not items:
        why = "%s holds no bundles (*.json or *.jsonl)%s" % (path, "; it holds the folder(s) %s, which a folder replay does not walk: replay each on its own"
                                                              % ", ".join("%s/" % s for s in skipped) if skipped else "")
        return 3, None, "engine_py: %s\n%s\n" % (why, USAGE)
    cases, fields, carried_map, allowed_map = [], {}, {}, {}
    for name, b in items:
        if isinstance(b, _Unread):
            c = {"result": "REFUSED", "reason": b.reason}
        elif not is_replay_bundle(b):
            c = {"result": "REFUSED", "reason": NOT_A_BUNDLE}
        else:
            c = replay_parsed(b, strict=strict, lenient_remedies=lenient_remedies, allow_unknown_keys=allow_unknown_keys)[3]
        case = {"name": name}
        case.update(c)
        cases.append(case)
        if isinstance(b, _Unread):
            continue
        if case["result"] == "MATCH":
            f = not_reperformed_fields(_presented_of(b))
            if f:
                fields[name] = f
        # a case refused for its unknown keys names them in its reason and `unknown_keys`: refused, not carried
        k = carried_keys(b) if is_replay_bundle(b) and "unknown_keys" not in case else []
        if k:
            carried_map[name] = k
        a = allowed_keys(b)
        if a:
            allowed_map[name] = a
    count = lambda r: sum(1 for c in cases if c["result"] == r)
    s = {"total": len(cases), "matched": count("MATCH"), "diverged": count("DIVERGED"), "not_reperformed": count("NOT_REPERFORMED"),
         "refused": count("REFUSED"), "cases": cases}
    if fields:
        s["fields_not_reperformed"] = fields
    if strict:
        s["strict_failed"] = sum(1 for c in cases if c.get("strict_problems"))
    if carried_map:
        s["carried_not_checked"] = carried_map
    if allowed_map:
        s["carried_allowed"] = allowed_map
    if allow_unknown_keys:
        s["allow_unknown_keys"] = "stated"
    if skipped:
        s["skipped_folders"] = skipped
    err = []
    for (name, b), c in zip(items, cases):
        verdict = None if isinstance(b, _Unread) else _presented_of(b)
        err.append(render_case(c, verdict, fields.get(name, []), carried_map.get(name, []), allowed_map.get(name, [])) + "\n")
    for d in skipped:
        err.append("SKIPPED         %s/\n    a folder: a folder replay does not walk into folders. Replay it on its own: "
                   "python3 conformance/engine_py/engine.py replay %s\n" % (d, os.path.join(path, d)))
    if allow_unknown_keys:  # stated before the summary line, which stays the last word on the cases (cli.ts runReplayCases)
        err.append("engine_py replay: %s\n" % ALLOW_UNKNOWN_KEYS_LINE)
    err.append("engine_py replay: %d case(s): %d match · %d diverged · %d not re-performed · %d refused\n" % (
        s["total"], s["matched"], s["diverged"], s["not_reperformed"], s["refused"]))
    if strict and s["strict_failed"] > 0:
        err.append("engine_py replay: STRICT: FAILED: %d matching case(s) carry something that was not re-performed (each is listed "
                   "above)\n" % s["strict_failed"])
    return replay_exit(s), s, "".join(err)


_ISO_MS = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z\Z")


def now_iso():
    t = datetime.datetime.now(datetime.timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (t.microsecond // 1000)


USAGE = ("usage: python3 conformance/engine_py/engine.py issue <extraction.json> [--issued-at <YYYY-MM-DDTHH:MM:SS.mmmZ>] "
         "[--engine <version>] [--producer <label>]\n"
         "       python3 conformance/engine_py/engine.py replay <bundle.json | cases.jsonl | folder> [--strict] [--lenient-remedies] "
         "[--allow-unknown-keys]")


def _parse(args, values, flags):
    got, files = {}, []
    while args:
        a = args.pop(0)
        key = a[2:].split("=", 1)[0] if a.startswith("--") else None
        if key in values:
            if "=" in a:
                got[key] = a.split("=", 1)[1]
            elif args:
                got[key] = args.pop(0)
            else:
                raise ValueError("--%s needs a value" % key)
        elif key in flags and "=" not in a:
            got[key] = True
        elif a.startswith("-"):
            raise ValueError("unknown option %s" % a)
        else:
            files.append(a)
    if len(files) != 1:
        raise ValueError("one file per call")
    return got, files[0]


def replay_command(args, out=sys.stdout, err=sys.stderr):
    """`engine.py replay`: the replay contract through cli.py's implementation, so the two commands give one answer (one code path,
    two entry points; 2026-10-20). Its exit code and every line it prints are cli.py's, each line that names the program naming
    this one (`engine_py replay: `). The JSON on stdout is the replay's, with the two keys this command's JSON always carried for its
    callers (conformance/engine_py/sweep.py among them): `computed_input_hash` and `computed_verdict_id`, the ids this build
    computed. The library functions above (replay, replay_parsed, replay_cases) stay for the callers that import them."""
    import cli  # cli.py imports this module; it is imported here, when a replay is asked for, so neither import waits on the other
    try:
        code, o, e = cli.run(list(args))
    except Exception as x:  # noqa: BLE001  (an error the replay does not handle never reads as FAILED, exit 1, or as a match)
        code, o, e = 3, "", ("verify replay: input refused: this build stopped on an error it does not handle (%s: %s); nothing was "
                             "verified\n" % (type(x).__name__, x))
    files = [a for a in args if not a.startswith("-")]
    one_file = o.strip() != "" and not (files and (os.path.isdir(files[0]) or re.search(r"\.jsonl\Z", files[0], re.I | re.A)))
    if one_file:
        res = json.loads(o)
        if isinstance(res, dict):
            if res.get("expected_verdict_id"):
                res["computed_verdict_id"] = res["expected_verdict_id"]
            if "computed_input_hash" not in res and res.get("expected_input_hash"):
                res["computed_input_hash"] = res["expected_input_hash"]
            o = pretty(_fix_ints(res)) + "\n"
    out.write(o)
    err.write("".join(("engine_py replay: " + line[len("verify replay: "):]) if line.startswith("verify replay: ") else line
                      for line in e.splitlines(True)))
    return code


def main(argv, out=sys.stdout, err=sys.stderr):
    args = list(argv)
    verb = args.pop(0) if args else None
    if verb == "replay":
        return replay_command(args, out, err)
    try:
        if verb == "issue":
            opts, path = _parse(args, ("issued-at", "engine", "producer"), ())
        else:
            raise ValueError("needs a verb: issue or replay")
    except ValueError as e:
        err.write("engine_py: %s\n%s\n" % (e, USAGE))
        return 3
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError as e:
        err.write("engine_py: cannot read %s: %s\n" % (path, e.strerror))
        return 3
    issued_at = opts.get("issued-at")
    if issued_at is not None and not _ISO_MS.match(issued_at):
        err.write("engine_py: --issued-at must read like 2026-10-05T16:03:24.839Z (got %s)\n" % issued_at)
        return 3
    try:
        extraction = read_json(data, path)
        verdict = issue(extraction, issued_at or now_iso(), engine=opts.get("engine", R.ENGINE_VERSION), producer=opts.get("producer"))
    except rb.Refused as e:
        err.write("error reading extraction: %s\n" % e)
        return 3
    except Refused as e:
        err.write("%s\n" % e)
        return 3
    except Outside as e:
        err.write("engine_py: not re-performed: outside what this build re-performs: %s\n" % e)
        return 3
    out.write(render(verdict))
    err.write("engine_py: %s\n" % headline(verdict))
    gate = gate_of(verdict)
    return 0 if gate == "PASS" else (1 if verdict["outcome"] == "FAIL" else 2)


if __name__ == "__main__":
    # 2026-10-12 (integration): write UTF-8 whatever the console or pipe encoding is (cp1252 on Windows), so a character the
    # locale cannot write (the verdict carries some) never raises and exits 1, which reads as FAIL; as
    # conformance/riposte_bind.py does. backslashreplace keeps a lone surrogate writable. Line ends are written as LF, as the
    # Node engine writes them, not as CRLF (Windows), so the two engines' stdout can be compared byte for byte.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")
    sys.exit(main(sys.argv[1:]))
