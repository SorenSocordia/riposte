# The source-text axis: a quoted passage found verbatim, a value found in the text. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
A port of packages/verify/src/textmatch/{normalize,matcher,index}.ts. The text is worked in UTF-16 code units, as JavaScript
works it, so a span's offsets are the offsets the Node engine records.
"""

import re
from decimal import Decimal, ROUND_HALF_UP

import jsrt as J

_QUOTE_MAP = {"‘": "'", "’": "'", "‚": "'", "‛": "'", "“": '"', "”": '"', "„": '"', "‟": '"',
              "«": '"', "»": '"', "‹": "'", "›": "'", "`": "'", "´": "'"}
_DASHES = set("‐‑‒–—―−")
_SPACE = set(" \t\n\r\x0c\x0b\xa0")


def _is_hyphen_or_dash(c):
    return c == "-" or c in _DASHES


def normalize_mapped(src_units, profile):
    """normalizeMapped over a string already in UTF-16 units: (text in units, map, original units)."""
    out, mp = [], []
    n = len(src_units)

    def push(ch, off):
        for k in ch:
            out.append(k)
            mp.append(off)
    i = 0
    while i < n:
        c = src_units[i]
        if _is_hyphen_or_dash(c):
            k = i + 1
            while k < n and src_units[k] in (" ", "\t"):
                k += 1
            if k < n and src_units[k] in ("\n", "\r"):
                i = k
                while i < n and src_units[i] in _SPACE:
                    i += 1
                continue
            push("-", i)
            i += 1
            continue
        if c in _SPACE:
            start = i
            while i < n and src_units[i] in _SPACE:
                i += 1
            push(" ", start)
            continue
        if c == "…":
            push("...", i)
            i += 1
            continue
        q = _QUOTE_MAP.get(c)
        if q is not None:
            push(q, i)
            i += 1
            continue
        push(J.units(c.lower()) if profile == "legal" else c, i)
        i += 1
    return {"text": "".join(out), "map": mp, "original": src_units}


def to_original_span(m, norm_start, norm_end):
    if len(m["text"]) == 0:
        return {"start": 0, "end": 0}
    s = max(0, min(norm_start, len(m["text"]) - 1))
    e = max(s, min(norm_end - 1, len(m["text"]) - 1))
    return {"start": m["map"][s], "end": m["map"][e] + 1}


def _locale_en(x):
    """Number(x).toLocaleString('en-US'): grouped, at most three fraction digits (half away from zero)."""
    neg = x < 0
    d = Decimal(abs(x)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    s = format(d, "f")
    ip, _, fp = s.partition(".")
    fp = fp.rstrip("0")
    body = format(int(ip), ",") + ("." + fp if fp else "")
    return ("-" if neg and body not in ("0",) else "") + body


def number_surface_forms(value):
    import math
    if not math.isfinite(value):
        return []
    a = abs(value)
    forms = []

    def add(f):
        if f not in forms:
            forms.append(f)
    two = J.to_fixed(a, 2)
    ip, fp = (two.split(".") + ["undefined"])[:2]
    grouped = _locale_en(J.number_of(ip))
    add(two)
    add("%s.%s" % (grouped, fp))
    plain = J.js_number(a)
    add(plain)
    if a == int(a):
        add(grouped)
        add(ip)
    else:
        parts = plain.split(".")
        pp = parts[0]
        pf = parts[1] if len(parts) > 1 else "undefined"
        add("%s.%s" % (_locale_en(J.number_of(pp)), pf))
    return [s for s in forms if len(s) > 0]


def prepare_source(source):
    u = J.units(source)
    return {"legal": normalize_mapped(u, "legal"), "value": normalize_mapped(u, "value"), "raw": u}


_WORD = re.compile("[^" + J.S_IN + "]+")


def _edge_is_number_part(text, idx, d):
    if idx < 0 or idx >= len(text):
        return False
    c = text[idx]
    if "0" <= c <= "9":
        return True
    if c in (".", ","):
        b = idx + d
        return 0 <= b < len(text) and "0" <= text[b] <= "9"
    return False


def match_quote(prepared, quote):
    src = prepared["legal"]
    qn = J.trim(normalize_mapped(J.units(quote), "legal")["text"])
    if len(qn) == 0:
        return {"found": False, "reason": "not_located"}
    idx = src["text"].find(qn)
    if idx >= 0:
        span = to_original_span(src, idx, idx + len(qn))
        return {"found": True, "span": span, "matchedText": J.from_units(prepared["raw"][span["start"]:span["end"]]), "reason": "verbatim"}
    words = _WORD.findall(qn)
    best_len, best_pos, best_chars = 0, -1, 0
    j = -1

    def phrase(i, jj):
        return " ".join(words[i:jj + 1])
    for i in range(len(words)):
        if j < i:
            if src["text"].find(words[i]) < 0:
                continue
            j = i
        while j + 1 < len(words) and src["text"].find(phrase(i, j + 1)) >= 0:
            j += 1
        ln = j - i + 1
        if ln > best_len:
            p = phrase(i, j)
            best_len, best_pos, best_chars = ln, src["text"].find(p), len(p)
    if best_len >= 3 and best_pos >= 0:
        margin = max(len(qn), 40)
        ws = max(0, best_pos - margin)
        we = min(len(src["text"]), best_pos + best_chars + margin)
        while ws > 0 and src["text"][ws - 1] != " ":
            ws -= 1
        while we < len(src["text"]) and src["text"][we] != " ":
            we += 1
        span = to_original_span(src, ws, we)
        return {"found": False, "nearest": {"span": span, "text": J.from_units(prepared["raw"][span["start"]:span["end"]])},
                "reason": "misquote_nearest"}
    return {"found": False, "reason": "not_located"}


def match_value(prepared, value):
    src = prepared["value"]
    for form in number_surface_forms(value):
        frm = 0
        while True:
            p = src["text"].find(form, frm)
            if p < 0:
                break
            if not _edge_is_number_part(src["text"], p - 1, -1) and not _edge_is_number_part(src["text"], p + len(form), 1):
                span = to_original_span(src, p, p + len(form))
                return {"found": True, "span": span, "matchedText": J.from_units(prepared["raw"][span["start"]:span["end"]]), "form": form}
            frm = p + 1
    return {"found": False}


def _span_evidence(source_hash, span, text):
    return {"locator": {"kind": "span", "source_hash": source_hash, "start": span["start"], "end": span["end"]}, "value": text,
            "confidence": 100, "role": "QUOTE"}


def verify_quote(a, prepared, source_hash):
    r = match_quote(prepared, a["quote"])
    base = {"claim_id": a["id"], "kind": "QUOTE_MATCH", "tier": "DETERMINISTIC", "field": a["label"] if a.get("label") is not None else "quote",
            "asserted": a["quote"], "rule_id": "QUOTE_MATCH", "rule_name": "Verbatim quotation"}
    if r["found"] and r.get("span"):
        c = dict(base)
        c.update(outcome="PASS", locked=True, evidence=[_span_evidence(source_hash, r["span"], r.get("matchedText", ""))],
                 explanation="The quoted passage appears verbatim in the source at [%d, %d)." % (r["span"]["start"], r["span"]["end"]))
        return c
    if r["reason"] == "misquote_nearest" and r.get("nearest"):
        t = r["nearest"]["text"]
        c = dict(base)
        c.update(outcome="FAIL", locked=True,
                 computation={"formula": "quoted = source[cited span]", "operands": {"quoted": a["quote"], "source_says": t}, "result": t},
                 evidence=[_span_evidence(source_hash, r["nearest"]["span"], t)],
                 explanation="The citation points at real text, but the quotation is not verbatim. The source reads: \"%s\"." % t)
        return c
    c = dict(base)
    c.update(outcome="INSUFFICIENT_DATA", locked=False, evidence=[],
             insufficiency={"reason": "SPAN_NOT_FOUND", "detail": "The quoted passage was not located in the supplied source text; it may be quoted from a different source, or the source text may be incomplete (e.g. scanned/OCR gaps)."},
             explanation="Could not locate the quoted passage in the source; abstaining rather than asserting a negative.")
    return c


def verify_value_in_text(a, prepared, source_hash):
    r = match_value(prepared, a["value"])
    base = {"claim_id": a["id"], "kind": "QUOTE_MATCH", "tier": "DETERMINISTIC", "field": a["field"], "asserted": a["value"],
            "rule_id": "VALUE_IN_SOURCE", "rule_name": "Extracted value present in source"}
    shown = J.js_str(a["value"])
    if r["found"] and r.get("span"):
        c = dict(base)
        c.update(outcome="PASS", locked=False, evidence=[_span_evidence(source_hash, r["span"], r.get("matchedText", ""))],
                 explanation="The extracted %s (%s) appears in the source as \"%s\" (presence only — not proof it is the correct field)." % (
                     J.js_str(a["field"]), shown, r.get("matchedText")))
        return c
    c = dict(base)
    c.update(outcome="INSUFFICIENT_DATA", locked=False, evidence=[],
             insufficiency={"reason": "SPAN_NOT_FOUND", "detail": "The extracted %s (%s) was not found in the supplied source text; the value may be computed, formatted differently, or extracted from a region not included." % (J.js_str(a["field"]), shown)},
             explanation="Could not locate %s in the source; abstaining." % J.js_str(a["field"]))
    return c
