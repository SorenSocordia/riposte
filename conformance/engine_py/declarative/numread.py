# How the declarative interpreter reads numbers written as text, in Python. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
Ports, sentence for sentence, of the Node engine's number readers the declarative path calls:
  binding/forensic-normalizer.ts   normalizeAmount, normalizeQuantity, normalizeRate, foldDigits, parseCjkNumeral
  declarative/unreadable.ts        the strict readers (engine 0.0.1, 0.1.0, 0.2.0), the source-line finders, the words
  rulesets/strict.ts               the engine 0.6.0 figure checks (digitScriptOf, figureCharacterProblem, formatOfTexts, hasMark)
  protocol/hash-input.ts           numberTextIsExact, nonFinitePath, unsafeMagnitudePath and their refusals
engine.py carries private ports of the first three normalizers for the invoice path; they are not imported here because two
of their patterns use Python's \\s (not JavaScript's) and their rounding raises on an infinite value, which a declarative field
can reach ("1e999" as text). These are written to the Node sentences directly.
"""

import math
import re

import jsrt as J
from jsrt import UNDEF

_S = J.S
_SI = J.S_IN

# ---------------------------------------------------------------------------------------------------------------------
# forensic-normalizer.ts

_FOLD = ((0xFF10, 0xFF19), (0x0660, 0x0669), (0x06F0, 0x06F9), (0x0966, 0x096F), (0x09E6, 0x09EF), (0x0E50, 0x0E59))


def fold_digits(s):
    """foldDigits: (text, folded)"""
    out, folded = [], False
    for ch in s:
        c = ord(ch)
        for lo, hi in _FOLD:
            if lo <= c <= hi:
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


_CJK_DIGIT = {"〇": 0, "零": 0, "一": 1, "壹": 1, "二": 2, "貳": 2, "贰": 2, "兩": 2, "两": 2,
              "三": 3, "參": 3, "叁": 3, "叄": 3, "四": 4, "肆": 4, "五": 5, "伍": 5,
              "六": 6, "陸": 6, "陆": 6, "七": 7, "柒": 7, "八": 8, "捌": 8, "九": 9, "玖": 9}
_CJK_SMALL = {"十": 10, "拾": 10, "百": 100, "佰": 100, "千": 1000, "仟": 1000}
_CJK_BIG = {"万": 1e4, "萬": 1e4, "億": 1e8, "亿": 1e8, "兆": 1e12}
_CJK_STRIP = re.compile("[円圓圆元圜￥\xa5整正也" + _SI + ",]")


def parse_cjk(text):
    """parseCjkNumeral: the number, or None."""
    s = _CJK_STRIP.sub("", text)
    if s == "":
        return None
    if not any(ch in _CJK_DIGIT or ch in _CJK_SMALL or ch in _CJK_BIG for ch in s):
        return None
    total, section, num = 0.0, 0.0, 0.0
    last_big, last_small = math.inf, math.inf
    for ch in s:
        if "0" <= ch <= "9":
            num = num * 10 + (ord(ch) - 48)
            continue
        if ch in _CJK_DIGIT:
            num = num * 10 + _CJK_DIGIT[ch]
            continue
        if ch in _CJK_SMALL:
            u = _CJK_SMALL[ch]
            if u >= last_small:
                return None
            last_small = u
            section += (1 if num == 0 else num) * u
            num = 0.0
            continue
        if ch in _CJK_BIG:
            b = _CJK_BIG[ch]
            if b >= last_big:
                return None
            last_big = b
            section += num
            if section == 0:
                return None
            total += section * b
            section, num, last_small = 0.0, 0.0, math.inf
            continue
        return None
    section += num
    total += section
    return float(total) if math.isfinite(total) else None


def _empty(value):
    return value is None or value is UNDEF or value == ""


def _parse_money(value, to_cents):
    """parseMoney: {normalized, transformations, success} or None (null, undefined, '', or not a string or a number)."""
    if _empty(value) and not J.is_num(value):
        return None
    tr = []
    if J.is_num(value):
        value = float(value)
        if math.isnan(value):
            return {"normalized": 0.0, "transformations": ["invalid_nan"], "success": False}
        rounded = J.math_round(value * 100) / 100 if to_cents else value
        if rounded != value:
            tr.append("rounded_to_2_decimals")
        return {"normalized": rounded, "transformations": tr if tr else ["already_number"], "success": True}
    if not isinstance(value, str):
        return None
    cleaned = J.trim(value)
    cleaned, folded = fold_digits(cleaned)
    if folded:
        tr.append("non_ascii_digits_folded")
    cjk = parse_cjk(cleaned)
    if cjk is not None:
        cleaned = J.js_number(cjk)
        tr.append("cjk_numerals_parsed")
    neg = False
    if cleaned.startswith("(") and cleaned.endswith(")"):
        neg = True
        cleaned = J.slice16(cleaned, 1, J.utf16_len(cleaned) - 1) if J.utf16_len(cleaned) >= 2 else ""
        tr.append("parentheses_negative")
    if cleaned.endswith("-"):
        neg = True
        cleaned = cleaned[:-1]
        tr.append("trailing_minus")
    if cleaned.startswith("-"):
        neg = True
        cleaned = cleaned[1:]
        tr.append("leading_minus")
    before = cleaned
    cleaned = re.sub(r"\A[^0-9.\-,]+|[^0-9.\-,]+\Z", "", cleaned)
    if cleaned != before:
        tr.append("currency_symbols_removed")
    last_comma, last_period = cleaned.rfind(","), cleaned.rfind(".")
    locale = "unknown"
    if last_comma > last_period:
        after = cleaned[last_comma + 1:]
        if re.match(r"[0-9]{1,2}\Z", after):
            locale = "EU"
        elif re.match(r"[0-9]{3}\Z", after):
            locale = "US"
    elif last_period > last_comma:
        after = cleaned[last_period + 1:]
        if re.match(r"[0-9]{1,2}\Z", after):
            locale = "US"
        elif re.match(r"[0-9]{3}\Z", after):
            locale = "US" if re.match(r"0\.", cleaned) else "EU"
    if locale == "unknown":
        if re.match(r"[0-9]{1,3}(\.[0-9]{3})+(,[0-9]{1,2})?\Z", cleaned) or re.match(r"[0-9]+,[0-9]{1,2}\Z", cleaned):
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
    parsed = J.parse_float(cleaned)
    if math.isnan(parsed):
        return {"normalized": 0.0, "transformations": ["parse_failed"], "success": False}
    result = -parsed if neg else parsed
    rounded = J.math_round(result * 100) / 100 if to_cents else result
    if rounded != result:
        tr.append("rounded_to_2_decimals")
        result = rounded
    return {"normalized": result, "transformations": tr, "success": True}


def normalize_amount(value):
    return _parse_money(value, True)


def normalize_price(value):
    return _parse_money(value, False)


_UNITS = re.compile(_S + "*(hours?|hrs?|hr|days?|d|minutes?|mins?|min|units?|un|each|ea|pieces?|pcs?|pc|pounds?|lbs?|lb|gallons?|gal|miles?|mi|tons?)" + _S + "*\\Z")


def normalize_quantity(value):
    if _empty(value) and not J.is_num(value):
        return None
    tr = []
    if J.is_num(value):
        value = float(value)
        if math.isnan(value):
            return {"normalized": 0.0, "transformations": ["invalid_nan"], "success": False}
        return {"normalized": value, "transformations": ["already_number"], "success": True}
    if not isinstance(value, str):
        return None
    cleaned = J.trim(value).lower()
    cleaned, folded = fold_digits(cleaned)
    if folded:
        tr.append("non_ascii_digits_folded")
    cjk = parse_cjk(cleaned)
    if cjk is not None:
        cleaned = J.js_number(cjk)
        tr.append("cjk_numerals_parsed")
    m = re.match(r"([0-9]+)/([0-9]+)", cleaned)
    if m:
        num, den = float(int(m.group(1))), float(int(m.group(2)))
        if den != 0:
            tr.append("fraction_converted")
            return {"normalized": num / den, "transformations": tr, "success": True}
    m = re.match(r"([0-9]+(?:\.[0-9]+)?)" + _S + "*[-–—to]" + _S + "*[0-9]+", cleaned)
    if m:
        tr.append("range_first_value_used")
        return {"normalized": J.parse_float(m.group(1)), "transformations": tr, "success": True}
    without = _UNITS.sub("", cleaned, count=1)
    if without != cleaned:
        tr.append("unit_suffix_removed")
        cleaned = without
    m = re.match(r"-?[0-9]*\.?[0-9]+", cleaned)
    if m:
        return {"normalized": J.parse_float(m.group(0)), "transformations": tr if tr else ["number_extracted"], "success": True}
    return {"normalized": 0.0, "transformations": ["parse_failed"], "success": False}


def normalize_rate(value):
    if _empty(value) and not J.is_num(value):
        return None
    tr = []
    if J.is_num(value):
        value = float(value)
        if math.isnan(value):
            return {"normalized": 0.0, "transformations": ["invalid_nan"], "success": False}
        parsed = value
        tr.append("already_number")
    elif isinstance(value, str):
        cleaned = J.trim(value)
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
        parsed = J.parse_float(cleaned)
        if math.isnan(parsed):
            return {"normalized": 0.0, "transformations": ["parse_failed"], "success": False}
        if percent:
            parsed = parsed / 100
            tr.append("percent_to_fraction")
    else:
        return None
    if parsed > 1:
        parsed = parsed / 100
        tr.append("percent_to_fraction_heuristic")
    if parsed < 0:
        return {"normalized": parsed, "transformations": tr + ["negative_rate"], "success": False}
    return {"normalized": J.math_round(parsed * 1e9) / 1e9, "transformations": tr, "success": True}


# ---------------------------------------------------------------------------------------------------------------------
# unreadable.ts

_MARKER = re.compile(r"\A" + _S + "*unreadable" + _S + "*\\Z", re.I)


def unreadable_marker(raw):
    if raw is None:
        return "null"
    if isinstance(raw, str):
        if J.trim(raw) == "":
            return "blank"
        if _MARKER.match(raw):
            return "marker"
    return None


def _cur():
    return "(?:[" + J.uclass("Sc") + "]|[A-Z]{3})"


def _nd():
    return J.uclass("Nd")


_STRICT = None


def _strict_number():
    global _STRICT
    if _STRICT is None:
        nd = _nd()
        num = "(?:[" + nd + "]{1,3}(?:[ ,.'\xa0 ٬][" + nd + "]{3})+|[" + nd + "]+)(?:[.,٫][" + nd + "]+)?"
        _STRICT = re.compile("\\A" + _S + "*(?:[-−+]" + _S + "*)?\\(?" + _S + "*(?:" + _cur() + _S + "*)?(?:[-−+]" + _S
                             + "*)?" + num + _S + "*(?:" + _cur() + ")?" + _S + "*\\)?" + _S + "*-?" + _S + "*\\Z")
    return _STRICT


def is_strict_number_text(s):
    return _strict_number().match(s) is not None


def is_strict_number_text_v010(s):
    return _strict_number().match(s) is not None or parse_cjk(J.trim(s)) is not None


def show_raw(raw):
    """showRaw: JSON, at most 60 characters (UTF-16 units)."""
    s = J.stringify(raw)
    if s is UNDEF:
        s = J.js_str(raw)
    return J.slice16(s, 0, 57) + "..." if J.utf16_len(s) > 60 else s


def collapse(s):
    return J.trim(re.sub(_S + "+", " ", s))


def source_lines(text):
    out = []
    for p, page in enumerate(text.split("\f")):
        for i, l in enumerate(re.split(r"\r?\n", page)):
            out.append({"page": p + 1, "line": i + 1, "text": l})
    return out


def _at(l, multi_page, label=UNDEF):
    t = collapse(l["text"])
    o = {}
    if multi_page:
        o["page"] = l["page"]
    o["line"] = l["line"]
    o["text"] = J.slice16(t, 0, 117) + "..." if J.utf16_len(t) > 120 else t
    if label is not UNDEF:
        o["label"] = label
    return o


def _lower_word_first(rest):
    """/^\\p{Ll}+(\\s|$)/u: one or more lower-case letters, then white space or the end."""
    i = 0
    while i < len(rest) and J.category_is(rest[i], "Ll"):
        i += 1
    return i > 0 and (i == len(rest) or rest[i] in J.JS_WS)


def find_label_line(lines, labels):
    multi = any(l["page"] > 1 for l in lines)
    wanted = [x for x in (collapse(l) for l in labels) if len(x) > 0]
    for l in lines:
        orig = collapse(l["text"])
        low = orig.lower()
        for label in wanted:
            lab = label.lower()
            if not low.startswith(lab):
                continue
            # orig.charAt(lab.length): lab's length in UTF-16 units, read off orig
            n = J.utf16_len(lab)
            nxt = J.slice16(orig, n, n + 1)
            if nxt != "" and (J.category_is(nxt, "L", "N") if len(nxt) == 1 else False):
                continue
            rest = J.trim(J.slice16(orig, n))
            if rest != "" and _lower_word_first(rest) and not any(J.category_is(ch, "N") for ch in rest):
                continue
            return _at(l, multi, label)
    return None


def find_raw_line(lines, raw):
    r = collapse(raw)
    if J.utf16_len(r) < 2:
        return None
    multi = any(l["page"] > 1 for l in lines)
    for l in lines:
        if r in collapse(l["text"]):
            return _at(l, multi)
    return None


def render_at(s):
    return "%sline %s of the source text: \"%s\"" % ("page %s, " % J.js_number(float(s["page"])) if "page" in s else "",
                                                   J.js_number(float(s["line"])), s["text"])


_KIND_WORD = {"amount": "an amount", "price": "a price", "quantity": "a quantity", "rate": "a rate", "bool": "true or false",
              "identifier": "an identifier", "string": "text"}


def not_strict_note(u, kind):
    """notStrictNote (engine 0.6.0)."""
    if u.get("how") != "label" or "at" not in u or (kind is not None and kind not in ("amount", "price")):
        return None
    text = u["at"]["text"]
    label = u["at"].get("label")
    rest = J.slice16(text, J.utf16_len(label)) if label is not None and text.lower().startswith(label.lower()) else text
    nd = _nd()
    m = re.search("[" + nd + "](?:[" + nd + ",.' ]*[" + nd + "])?", rest)
    if m is None:
        return None
    fig = m.group(0)
    if re.search("[.,][" + nd + "]{2}\\Z", fig):
        return None
    return "the line prints \"%s\": an amount needs two decimals, so \"%s\" is read as not strict%s" % (
        fig, fig, "" if re.search("[.,]", fig) else ", never as %s.00" % fig)


def describe_unreadable(role, u, kind, note=None):
    where = "; the source prints it at %s" % render_at(u["at"]) if "at" in u else ""
    how = u["how"]
    path = u.get("path", "?")
    detail = u.get("detail")
    if how == "key":
        return "%s was reported under the key %s, which is not its path but differs from it only by spaces or invisible characters: not read%s" % (
            role, J.js_string(u.get("path", "?")), where)
    if how == "label":
        return "%s is printed but no value was read: the label \"%s\" heads %s%s" % (
            role, u["at"].get("label", "?") if "at" in u else "?", render_at(u["at"]) if "at" in u else "a source line",
            "; %s" % note if note is not None else "")
    if how == "null":
        return "%s was reported as null at %s: seen, not read%s" % (role, path, where)
    if how == "blank":
        return "%s was reported as an empty string at %s: seen, not read%s" % (role, path, where)
    if how == "marker":
        return "%s was reported as %s at %s: seen, not read%s" % (role, u.get("raw", '"UNREADABLE"'), path, where)
    if how == "withdrawn":
        return "%s at %s is struck: withdrawn%s" % (role, path, " (%s)" % detail if detail else "")
    if how == "unsupported":
        return "%s at %s is struck: an unsupported assertion%s; a value with no provenance is never load-bearing" % (
            role, path, " (%s)" % detail if detail else "")
    if how == "conflict":
        return "%s at %s is struck: %s" % (role, path, detail if detail is not None else "two sources at one tier disagree")
    if how == "qc_held":
        return "%s at %s is held by its quality flag: %s" % (role, path, detail if detail is not None else "the flags choice holds it")
    if how == "qc_struck":
        return "%s at %s is struck by its quality flag: %s" % (role, path, detail if detail is not None else "the flags choice strikes it")
    word = _KIND_WORD.get(kind if kind is not None else "amount", "a value")
    return "%s at %s reads %s, which is not %s the rule can use%s%s" % (
        role, path, u.get("raw", "?"), word, " (%s)" % detail if detail is not None else "", where)


LOCALE_TAGS = {"en": {"decimal": ".", "group": ","}, "de": {"decimal": ",", "group": "."}, "fr": {"decimal": ",", "group": " "},
               "ch": {"decimal": ".", "group": "'"}}


def resolve_locale(l):
    """resolveLocale: the marks, UNDEF when none is declared, None when the declaration is not valid."""
    if l is UNDEF:
        return UNDEF
    if isinstance(l, str):
        return dict(LOCALE_TAGS[l]) if l in LOCALE_TAGS else None
    if not isinstance(l, dict):
        return None
    dec, grp = l.get("decimal", UNDEF), l.get("group", UNDEF)
    if dec not in (".", ","):
        return None
    if grp not in (",", ".", " ", "'", ""):
        return None
    if dec == grp:
        return None
    return {"decimal": dec, "group": grp}


_SPACE_MARK = re.compile("[" + _SI + "\xa0   ]\\Z")
_V020 = None


def _number_v020():
    global _V020
    if _V020 is None:
        nd = _nd()
        _V020 = re.compile("\\A" + _S + "*(?:([-−+])" + _S + "*)?(\\()?" + _S + "*(?:" + _cur() + _S + "*)?(?:([-−+])" + _S
                           + "*)?([" + nd + "](?:[" + nd + " ,.'\xa0   ٬٫]*[" + nd + "])?)" + _S
                           + "*(?:" + _cur() + ")?" + _S + "*(\\))?" + _S + "*(-)?" + _S + "*\\Z")
    return _V020


def _grouped(gs):
    return len(gs) >= 1 and 1 <= len(gs[0]) <= 3 and not (len(gs) > 1 and gs[0].startswith("0")) and all(len(g) == 3 for g in gs[1:])


_V020_MEMO = {}


def read_number_text_v020(raw, locale=UNDEF):
    """readNumberTextV020: {canonical, changed} or None (a pure function of its arguments, so it is memoized; callers never
    change the result)."""
    key = (raw, None if (locale is UNDEF or not locale) else (locale["decimal"], locale["group"]))
    if key in _V020_MEMO:
        return _V020_MEMO[key]
    r = _read_number_text_v020(raw, locale)
    if len(_V020_MEMO) > 65536:
        _V020_MEMO.clear()
    _V020_MEMO[key] = r
    return r


def _read_number_text_v020(raw, locale=UNDEF):
    trimmed = J.trim(raw)
    if trimmed != "" and parse_cjk(trimmed) is not None:
        return {"canonical": trimmed, "changed": False}
    m = _number_v020().match(raw)
    if not m:
        return None
    lead, opn, inner, core, close, trail = m.groups()
    if (opn is None) != (close is None):
        return None

    def minus(s):
        return s in ("-", "−")
    negatives = sum(1 for x in (minus(lead), minus(inner), opn is not None, trail is not None) if x)
    if negatives > 1:
        return None
    groups, seps = [""], []
    for ch in fold_digits(core)[0]:
        if "0" <= ch <= "9":
            groups[-1] += ch
            continue
        if groups[-1] == "":
            return None
        seps.append(" " if _SPACE_MARK.match(ch) else ch)
        groups.append("")
    if any(g == "" or not re.match(r"[0-9]+\Z", g) for g in groups):
        return None
    dec = None
    if not seps:
        int_part = groups[0]
    elif locale is not UNDEF and locale:
        dec_at = seps.index(locale["decimal"]) if locale["decimal"] in seps else -1
        if dec_at >= 0 and (dec_at != len(seps) - 1 or len(seps) - 1 - seps[::-1].index(locale["decimal"]) != dec_at):
            return None
        group_seps = seps[:-1] if dec_at >= 0 else seps
        if any(s != locale["group"] or locale["group"] == "" for s in group_seps):
            return None
        int_groups = groups[:-1] if dec_at >= 0 else groups
        if group_seps and not _grouped(int_groups):
            return None
        int_part = "".join(int_groups)
        dec = groups[-1] if dec_at >= 0 else None
    else:
        kinds = []
        for s in seps:
            if s not in kinds:
                kinds.append(s)
        last = seps[-1]
        after = groups[-1]
        if " " in kinds:
            return None
        if len(kinds) == 1:
            k = kinds[0]
            if len(seps) > 1:
                if k == "٫" or not _grouped(groups):
                    return None
                int_part = "".join(groups)
            elif k == ".":
                if len(after) == 3 and not groups[0].startswith("0"):
                    return None
                int_part, dec = groups[0], after
            elif k == "٫":
                int_part, dec = groups[0], after
            elif k in ("'", "٬"):
                if not _grouped(groups):
                    return None
                int_part = "".join(groups)
            else:
                return None
        elif len(kinds) == 2:
            if seps.index(last) != len(seps) - 1:
                return None
            if last not in (".", ",", "٫"):
                return None
            if [k for k in kinds if k != last][0] == "٫":
                return None
            int_groups = groups[:-1]
            if not _grouped(int_groups):
                return None
            int_part = "".join(int_groups)
            dec = after
        else:
            return None
    neg = negatives == 1 and not re.match(r"0+\Z", int_part + (dec if dec is not None else ""))
    canonical = "%s%s%s" % ("-" if neg else "", int_part, "." + dec if dec is not None else "")
    return {"canonical": canonical, "changed": canonical != trimmed}


# ---------------------------------------------------------------------------------------------------------------------
# rulesets/strict.ts (the parts the declarative path and reconcile call)

_DIGIT_SCRIPTS = ((0x30, "the digits 0-9"), (0xFF10, "full-width digits"), (0x0660, "Arabic-Indic digits"), (0x06F0, "Persian digits"),
                  (0x0966, "Devanagari digits"), (0x09E6, "Bengali digits"), (0x0E50, "Thai digits"))


def _code_point(ch):
    return "U+%04X" % ord(ch)


def _digit_script(ch):
    c = ord(ch)
    for zero, name in _DIGIT_SCRIPTS:
        if zero <= c <= zero + 9:
            return name
    return "digits near %s" % _code_point(ch)


def digit_script_of(text):
    m = re.search("[" + _nd() + "]", text)
    return _digit_script(m.group(0)) if m else None


_GROUP_SPACES = ("\xa0", " ", " ", " ")
_CHAR_NAMES = {"\xa0": "a no-break space", " ": "a narrow no-break space", " ": "a thin space", " ": "a figure space",
               "　": "an ideographic space", "​": "a zero-width space", "﻿": "a zero-width no-break space",
               "‎": "a left-to-right mark", "‏": "a right-to-left mark", "⁠": "a word joiner", "\xad": "a soft hyphen"}


def _character_name(ch):
    if ch in _CHAR_NAMES:
        return _CHAR_NAMES[ch]
    return "a space other than the ordinary one" if J.category_is(ch, "Zs") else "an invisible formatting character"


def figure_character_problem(raw):
    chars = list(raw)
    scripts = {}
    for i, ch in enumerate(chars):
        if J.category_is(ch, "Nd"):
            s = _digit_script(ch)
            if s not in scripts:
                scripts[s] = ch
            if len(scripts) > 1:
                return "it mixes %s (%s); send a figure in one script of digits, or as a JSON number" % (
                    " and ".join(scripts.keys()), "; ".join("%s, %s" % (J.js_string(x), _code_point(x)) for x in scripts.values()))
            continue
        prev = chars[i - 1] if i - 1 >= 0 else ""
        nxt = chars[i + 1] if i + 1 < len(chars) else ""
        if ch in _GROUP_SPACES and prev != "" and J.category_is(prev, "Nd") and nxt != "" and J.category_is(nxt, "Nd"):
            continue
        if ord(ch) != 0x20 and J.category_is(ch, "Zs", "Cf"):
            return "it holds %s (%s), which is not part of a number as handed over; remove it, or send the figure as a JSON number" % (
                _character_name(ch), _code_point(ch))
    return None


def has_mark(t):
    nd = _nd()
    return re.search("[" + nd + "][.,][" + nd + "]", t) is not None


def format_of_texts(texts, declared=UNDEF):
    """formatOfTexts: {source, tag?, locale?, note?, digits?}"""
    scripts = {}
    for text in texts:
        s = digit_script_of(text) if is_strict_number_text(text) else None
        if s is not None and s not in scripts:
            scripts[s] = J.trim(text)
    digits = {"digits": "the document writes its figures in more than one script of digits (%s)" % "; ".join(
        "%s: %s" % (s, J.js_string(t)) for s, t in scripts.items())} if len(scripts) > 1 else {}

    def base(f):
        out = dict(f)
        out.update(digits)
        return out
    if declared is not UNDEF:
        loc = resolve_locale(declared) if isinstance(declared, str) else UNDEF
        if loc:
            return base({"source": "declared", "tag": declared, "locale": loc})
        shown = J.stringify(declared)
        return base({"source": "none", "note": "\"number_locale\" is %s, which is not one of %s" % (
            shown if shown is not UNDEF else "undefined", ", ".join(LOCALE_TAGS.keys()))})
    en = de = None
    for text in texts:
        if read_number_text_v020(text) is None:
            continue
        in_en = read_number_text_v020(text, LOCALE_TAGS["en"]) is not None
        in_de = read_number_text_v020(text, LOCALE_TAGS["de"]) is not None
        if in_en and not in_de and en is None:
            en = text
        if in_de and not in_en and de is None:
            de = text
    if en is not None and de is None:
        return base({"source": "settled", "tag": "en", "locale": dict(LOCALE_TAGS["en"])})
    if de is not None and en is None:
        return base({"source": "settled", "tag": "de", "locale": dict(LOCALE_TAGS["de"])})
    if en is not None and de is not None:
        return base({"source": "mixed", "note": "the document mixes both number formats (%s and %s)" % (
            J.js_string(J.trim(en)), J.js_string(J.trim(de)))})
    return base({"source": "none"})


def _numeric_core(t):
    nd = _nd()
    return re.sub("\\A[^" + nd + "]+|[^" + nd + "]+\\Z", "", J.trim(t))


_LONE_THREE = re.compile(r"[1-9][0-9]{0,2}[.,][0-9]{3}\Z")


def _rate_text(raw, kind):
    if kind != "rate":
        return raw, False
    m = re.match("(.*?)" + _S + "*%" + _S + "*\\Z", raw, re.S)
    return (m.group(1), True) if m else (raw, False)


def strict_number_text(raw, kind, fmt=None):
    """strictNumberText (rulesets/strict.ts): {ok: True, value} or {ok: False, why, inexact?}."""
    fmt = fmt if fmt is not None else {"source": "none"}
    text, percent = _rate_text(raw, kind)
    bad = figure_character_problem(text)
    if bad is not None:
        return {"ok": False, "why": bad}
    script = digit_script_of(text)
    if fmt.get("digits") is not None and script is not None and script != "the digits 0-9":
        return {"ok": False, "why": "%s, and this figure is written in %s; send every figure in the digits 0-9, or as JSON numbers" % (fmt["digits"], script)}
    if fmt["source"] == "mixed" and has_mark(text):
        return {"ok": False, "why": "%s, so what its \".\" and \",\" mean is not settled (declare \"number_locale\": \"en\" or \"de\", or send JSON numbers)" % (
            fmt["note"] if fmt.get("note") is not None else "the document mixes both number formats")}
    loc = fmt.get("locale", UNDEF)
    if fmt["source"] == "settled" and _LONE_THREE.match(fold_digits(_numeric_core(text))[0]) and read_number_text_v020(text, loc) is not None:
        return {"ok": False, "why": "one separator followed by three digits is a thousands group or three decimals, and only a declared format settles which; the document's other figures are written in %s, which does not settle a lone group of three (declare \"number_locale\": \"en\" or \"de\", or send JSON numbers)" % fmt.get("tag")}
    r = read_number_text_v020(text, loc)
    if not r:
        t = J.trim(text)
        nd = _nd()
        unsettled = ("%snothing in the document settles its number format (declare \"number_locale\": \"en\" or \"de\", or send JSON numbers)" % (
            "%s; " % fmt["note"] if fmt.get("note") else "")) if fmt["source"] == "none" else ""
        if loc is not UNDEF and loc and read_number_text_v020(text) is not None:
            why = "it does not read in the document's number format (%s, %s)" % (fmt.get("tag"), fmt["source"])
        elif re.match("[" + nd + "]{1,3}([" + _SI + "\xa0   ][" + nd + "]{3})+([.,][" + nd + "]+)?\\Z", t):
            why = "a space-grouped number reads as one number or as several%s" % (
                " and the document's format (%s) does not group with spaces" % fmt.get("tag") if (loc is not UNDEF and loc) else " (only a declared \"number_locale\": \"fr\" reads it)")
        elif re.match("[" + nd + "]+[.,][" + nd + "]{3}\\Z", t):
            why = "one separator followed by three digits is a thousands group or three decimals%s" % (", and %s" % unsettled if unsettled else "")
        elif re.match("[" + nd + "]+,[" + nd + "]{1,2}\\Z", t):
            why = "a single comma is a decimal comma or a thousands mark%s" % (", and %s" % unsettled if unsettled else "")
        else:
            why = "it holds characters that are not part of a number"
        return {"ok": False, "why": why}
    n = J.number_of(r["canonical"])
    if math.isfinite(n) and not number_text_is_exact(r["canonical"]):
        return {"ok": False, "inexact": True, "why": "it has more digits than a number can hold exactly (it would read as %s), so no check can use it as written" % J.js_number(n)}
    return {"ok": True, "value": (n / 100 if percent else n) if math.isfinite(n) else None}


def text_values(doc, depth=4):
    if isinstance(doc, str):
        return [doc]
    if depth == 0 or not isinstance(doc, (dict, list)):
        return []
    vals = doc if isinstance(doc, list) else [doc[k] for k in J.keys(doc)]
    out = []
    for v in vals:
        out.extend(text_values(v, depth - 1))
    return out


def _fold_key(k):
    import unicodedata
    return "".join(ch for ch in unicodedata.normalize("NFKC", k) if ch not in J.JS_WS and not J.category_is(ch, "Cf", "Zs"))


def near_miss_path(doc, path):
    parts = [p for p in re.sub(r"\[([0-9]+)\]", r".\1", path).split(".") if p]
    cur = doc
    written, missed = [], False
    for p in parts:
        if not isinstance(cur, (dict, list)):
            return None
        if isinstance(cur, dict) and p in cur:
            written.append(p)
            cur = cur[p]
            continue
        if isinstance(cur, list) and re.match(r"(?:0|[1-9][0-9]*)\Z", p) and int(p) < len(cur):
            written.append(p)
            cur = cur[int(p)]
            continue
        ks = J.keys(cur) if isinstance(cur, dict) else [str(i) for i in range(len(cur))]
        k = next((x for x in ks if x != p and _fold_key(x) == p), None)
        if k is None:
            return None
        missed = True
        written.append(k)
        cur = cur[k] if isinstance(cur, dict) else cur[int(k)]
    return ".".join(written) if (missed and cur is not None and cur is not UNDEF and cur != "") else None


# ---------------------------------------------------------------------------------------------------------------------
# protocol/hash-input.ts

_NUMBER_TOKEN = re.compile(r"(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?\Z")


def _reduced_decimal(text):
    m = _NUMBER_TOKEN.match(text)
    if not m:
        return UNDEF
    frac = m.group(3) or ""
    digits = (m.group(2) + frac).lstrip("0")
    if digits == "":
        return "zero"
    exp = (0 if m.group(4) is None else int(m.group(4))) - len(frac)
    stripped = digits.rstrip("0")
    exp += len(digits) - len(stripped)
    return (m.group(1) == "-", stripped, exp)


def number_text_is_exact(text):
    a = _reduced_decimal(text)
    if a is UNDEF:
        return True
    x = J.number_of(text)
    if not math.isfinite(x):
        return True
    b = _reduced_decimal(J.js_number(x))
    if a == "zero" or b == "zero":
        return a == b
    return b is not UNDEF and a == b


_IDENT = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*\Z")


def path_step(path, key):
    if isinstance(key, int):
        return "%s[%d]" % (path, key)
    return "%s.%s" % (path, key) if _IDENT.match(key) else "%s[%s]" % (path, J.js_string(key))


def _first_number_path(value, bad, root):
    def walk(v, path):
        if J.is_num(v):
            return path if bad(float(v)) else None
        if isinstance(v, list):
            for i, x in enumerate(v):
                p = walk(x, path_step(path, i))
                if p is not None:
                    return p
            return None
        if isinstance(v, dict):
            for k in J.keys(v):
                p = walk(v[k], path_step(path, k))
                if p is not None:
                    return p
        return None
    return walk(value, root)


def non_finite_path(value, root="$"):
    return _first_number_path(value, lambda n: not math.isfinite(n), root)


def unsafe_magnitude_path(value, root="$"):
    return _first_number_path(value, lambda n: math.isfinite(n) and abs(n) > 9007199254740991.0, root)


def value_at_path(value, path):
    cur = value
    for m in re.finditer(r'\.([A-Za-z_$][A-Za-z0-9_$]*)|\[([0-9]+)\]|\[("(?:[^"\\]|\\.)*")\]', path[1:]):
        if m.group(1) is not None:
            key = m.group(1)
        elif m.group(2) is not None:
            key = int(m.group(2))
        else:
            import json
            key = json.loads(m.group(3))
        if isinstance(cur, list) and isinstance(key, int):
            cur = cur[key] if key < len(cur) else UNDEF
        elif isinstance(cur, dict):
            cur = cur.get(str(key), UNDEF)
        else:
            return UNDEF
    return cur


INEXACT_NUMBER_WORDS = "a number that cannot be represented exactly; write amounts as strings with two decimals"


def non_finite_refusal(name, path, value=UNDEF):
    shown = " (%s)" % J.js_str(value) if J.is_num(value) else ""
    return ("%s: the number at %s is not finite%s: JSON reads a number past the double range (1e999) as Infinity, and the hash "
            "writes every non-finite number as null, so it could not be told from null or from its negative. Write it as a finite "
            "number, or as a string the ruleset reads, then run it again" % (name, path, shown))


def unsafe_magnitude_refusal(name, path, value=UNDEF):
    shown = " (%s)" % J.js_str(value) if J.is_num(value) else ""
    return ("%s: the number at %s%s is %s. Past 9007199254740991 (2^53 - 1) a double cannot hold every whole number, so this one "
            "may already have been rounded when it was parsed, and the hash and every check would read the rounded figure. Then run "
            "it again" % (name, path, shown, INEXACT_NUMBER_WORDS))
