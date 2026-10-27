# The declarative ruleset interpreter, in Python: a ruleset run over an extraction. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
A port of packages/verify/src/declarative/evaluate.ts (verifyDeclarative), written from the Node sources, sentence for sentence,
under every engine label the Node build retains (0.0.1 to 0.7.2). It returns the verdict object the Node evaluator returns,
key for key, so JSON.stringify of it is the Node engine's bytes.

What this build does not re-perform is refused by name (Outside), never guessed: a ruleset with pinned `algorithms` or choice
slots, a check's measured `support` under engine 0.5.0, `require_contract`, an extraction-contract envelope, an arbitration
evidence overlay, the judge's supplied choices, archive files, and a declared accuracy. None of the e-invoice rulesets uses them.
"""

import math
import re
import unicodedata

import jsrt as J
from jsrt import UNDEF
import numread as N
import expr as X
import textmatch as T
import remedies as RM

E = J.E
ENGINES = list(E.ENGINES)
SCHEMA_VERSION = "v0"


class Outside(Exception):
    """An input this build does not re-perform (named). Refused, never a guessed verdict."""


class InputRefused(Exception):
    """protocol/input.ts InputRefused: refused before any verdict (the CLI's exit 3)."""

    def __init__(self, inp, message):
        Exception.__init__(self, message)
        self.input = inp


class EngineError(Exception):
    """An Error the Node evaluator throws (an engine label it does not carry, an option it does not read under this engine)."""


def engine_for(requested):
    if requested is None or requested is UNDEF:
        return ENGINES[-1]
    if requested in ENGINES:
        return requested
    raise EngineError("engine %s is not one this build carries (it carries %s)" % (J.js_str(requested), ", ".join(ENGINES)))


def at_least(v, minimum):
    return ENGINES.index(v) >= ENGINES.index(minimum)


def _nn(v, d):
    return d if (v is None or v is UNDEF) else v


def _g(o, k):
    return o.get(k, UNDEF) if isinstance(o, dict) else UNDEF


def _arr(v):
    return v if isinstance(v, list) else []


def _num(v):
    return J.js_number(float(v))


# ---------------------------------------------------------------------------------------------------------------------
# Paths

_IDX = re.compile(r"(?:0|[1-9][0-9]*)\Z")


def _prop(o, p):
    if isinstance(o, dict):
        return o[p] if p in o else UNDEF
    if isinstance(o, list):
        if _IDX.match(p):
            i = int(p)
            return o[i] if i < len(o) else UNDEF
        if p == "length":
            return float(len(o))
    return UNDEF


_PARTS = {}


def _parts(path):
    hit = _PARTS.get(path)
    if hit is None:
        hit = tuple(p for p in re.sub(r"\[([0-9]+)\]", r".\1", path).split(".") if p)
        if len(_PARTS) > 65536:
            _PARTS.clear()
        _PARTS[path] = hit
    return hit


def get_path(obj, path):
    cur = obj
    for p in _parts(path):
        if not isinstance(cur, (dict, list)):
            return UNDEF
        cur = _prop(cur, p)
    return cur


def set_path(obj, path, value):
    parts = _parts(path)
    cur = obj
    for p in parts[:-1]:
        nxt = _prop(cur, p) if isinstance(cur, (dict, list)) else UNDEF
        if not isinstance(nxt, (dict, list)):
            return
        cur = nxt
    if not parts:
        return
    last = parts[-1]
    if isinstance(cur, dict):
        cur[last] = value
    elif isinstance(cur, list) and _IDX.match(last) and int(last) < len(cur):
        cur[int(last)] = value


# ---------------------------------------------------------------------------------------------------------------------
# Field readers (evaluate.ts)

def declarative_reading(ruleset, engine):
    if engine == "0.0.1":
        on = _g(ruleset, "distinguish_unreadable") is True
        return on, on
    return _g(ruleset, "distinguish_unreadable") is not False, _g(ruleset, "strict_numbers") is not False


ROUNDING_UNITS = (1000000.0, 100000.0, 1000.0, 1.0)


def infer_reporting_unit(values):
    if not values:
        return None
    for u in ROUNDING_UNITS:
        if all(math.isfinite(v) and math.fmod(abs(v), u) == 0 for v in values):
            return u
    return None


def rounding_tolerance(values, rel, abs_cap, floor):
    n = len(values)
    max_abs = 0.0
    for v in values:
        max_abs = max(max_abs, abs(v))
    unit = infer_reporting_unit(values)
    rel_term = J.round4(min(rel * max_abs, abs_cap) if abs_cap > 0 else rel * max_abs)
    return {"tol": max(floor, rel_term, (unit or 0.0) * n), "unit": unit, "n": n, "maxAbs": max_abs}


def condition_holds(l, op, r, tol):
    if op == "=":
        return abs(l - r) <= tol
    if op == "!=":
        return abs(l - r) > tol
    if op == "<":
        return l < r - tol
    if op == "<=":
        return l <= r + tol
    if op == ">":
        return l > r + tol
    if op == ">=":
        return l >= r - tol
    return False


def _norm_bool(raw):
    if raw is True or raw is False:
        return {"value": 1.0 if raw else 0.0, "norms": ["bool_to_number"]}
    if J.is_num(raw) and raw in (0, 1):
        return {"value": float(raw), "norms": ["already_number"]}
    if isinstance(raw, str):
        s = J.trim(raw).lower()
        if s in ("true", "yes", "1"):
            return {"value": 1.0, "norms": ["bool_text_parsed"]}
        if s in ("false", "no", "0"):
            return {"value": 0.0, "norms": ["bool_text_parsed"]}
    return None


def _invisible_or_space(ch):
    return ch in J.JS_WS or J.category_is(ch, "Cf", "Zs")


_FOLDS = {}


def fold_identifier_text(x, v020=False):
    key = (x, v020)
    hit = _FOLDS.get(key)
    if hit is None:
        if v020:
            s = "".join(ch for ch in unicodedata.normalize("NFKC", x) if not _invisible_or_space(ch))
        else:
            s = re.sub(J.S + "+", "", x)
        hit = s.upper()
        if len(_FOLDS) > 65536:
            _FOLDS.clear()
        _FOLDS[key] = hit
    return hit


_KEYS = {}


def fold_key(k):
    hit = _KEYS.get(k)
    if hit is None:
        hit = "".join(ch for ch in unicodedata.normalize("NFKC", k) if not _invisible_or_space(ch))
        if len(_KEYS) > 65536:
            _KEYS.clear()
        _KEYS[k] = hit
    return hit


def _norm_identifiers(raw, v020=False):
    def one(x):
        if J.is_num(x) and math.isfinite(x):
            return J.js_str(x)
        if not isinstance(x, str):
            return UNDEF
        n = fold_identifier_text(x, v020)
        return n if len(n) else None
    if not isinstance(raw, list):
        n = one(raw)
        return [n] if isinstance(n, str) else None
    out = []
    for x in raw:
        n = one(x)
        if n is UNDEF:
            return None
        if n is not None and n not in out:
            out.append(n)
    return out


def identifier_key(id_):
    chars = list(id_)
    out = []
    i = 0
    while i < len(chars):
        if not J.category_is(chars[i], "P"):
            out.append(chars[i])
            i += 1
            continue
        j = i
        while j < len(chars) and J.category_is(chars[j], "P"):
            j += 1
        if out and J.category_is(out[-1], "Nd") and j < len(chars) and J.category_is(chars[j], "Nd"):
            out.append("-")
        i = j
    return "".join(out)


def _same_identifiers(a, b):
    ka, kb = set(identifier_key(x) for x in a), set(identifier_key(x) for x in b)
    return ka == kb


def format_money(n):
    if not math.isfinite(n):
        return J.js_str(n)
    neg = n < 0
    whole, frac = J.to_fixed(abs(J.round4(n)), 2).split(".")
    return "%s%s.%s" % ("-" if neg else "", re.sub(r"\B(?=(\d{3})+(?!\d))", ",", whole), frac)


_PLAIN_DECIMAL = re.compile(r"\A" + J.S + r"*-?[0-9]+(\.[0-9]+)?" + J.S + r"*\Z")


def _norm_price(raw):
    if J.is_num(raw):
        return {"value": float(raw), "norms": ["already_number"]} if math.isfinite(raw) else None
    if isinstance(raw, str) and _PLAIN_DECIMAL.match(raw):
        v = J.number_of(raw)
        return {"value": v, "norms": ["plain_decimal_parsed"]} if math.isfinite(v) else None
    n = N.normalize_amount(raw)
    if not n or not n["success"] or not J.is_num(n["normalized"]) or not math.isfinite(n["normalized"]):
        return None
    if "rounded_to_2_decimals" in n["transformations"]:
        return None
    return {"value": n["normalized"], "norms": n["transformations"]}


def norm_by_kind(kind, raw):
    if kind == "bool":
        return _norm_bool(raw)
    if kind == "price":
        return _norm_price(raw)
    if kind == "rate":
        n = N.normalize_rate(raw)
    elif kind == "quantity":
        n = N.normalize_quantity(raw)
    else:
        n = N.normalize_amount(raw)
    if not n or not n["success"] or not J.is_num(n["normalized"]) or not math.isfinite(n["normalized"]):
        return None
    return {"value": n["normalized"], "norms": n["transformations"]}


def _numeric_kind(kind):
    return kind is UNDEF or kind in ("amount", "price", "quantity")


def bind_field(source, field, strict=False, strict_numbers=None, is_strict_text=None, ctx=None):
    """bindField: the Bound for one field spec read off one object (the extraction, a line, a list element)."""
    if strict_numbers is None:
        strict_numbers = strict
    if is_strict_text is None:
        is_strict_text = N.is_strict_number_text
    ctx = ctx or {}
    kind = _g(field, "kind")
    paths = _g(field, "paths")
    if not isinstance(paths, list):
        raise Outside("a field's \"paths\" is not a list; the Node evaluator does not read such a ruleset either")
    resolved_but_bad = False
    bad_path = UNDEF
    unreadable = UNDEF
    for i, p in enumerate(paths):
        raw = get_path(source, p)
        if raw is UNDEF:
            continue
        if not strict and (raw is None or raw == ""):
            continue
        if strict:
            marker = N.unreadable_marker(raw)
            if marker:
                resolved_but_bad = True
                if bad_path is UNDEF:
                    bad_path = p
                if unreadable is UNDEF:
                    unreadable = {"how": marker, "path": p, "raw": N.show_raw(raw)}
                continue
        confidence = 100 if i == 0 else 95
        if kind == "string":
            return {"status": "ok", "strValue": J.js_str(raw), "path": p, "confidence": confidence, "original": raw}
        if kind == "identifier":
            ids = _norm_identifiers(raw, ctx.get("v020") is True)
            if ids is not None:
                return {"status": "ok", "ids": ids, "path": p, "confidence": confidence, "original": raw, "norms": ["identifier_normalized"]}
            resolved_but_bad = True
            if bad_path is UNDEF:
                bad_path = p
            if strict and unreadable is UNDEF:
                unreadable = {"how": "unparseable", "path": p, "raw": N.show_raw(raw)}
            continue
        if ctx.get("v020") and strict_numbers and isinstance(raw, str) and _numeric_kind(kind):
            why = UNDEF
            if ctx.get("figures"):
                script = N.digit_script_of(raw)
                why = N.figure_character_problem(raw)
                if why is None:
                    why = UNDEF
                if why is UNDEF and ctx.get("digits", UNDEF) is not UNDEF and script is not None and script != "the digits 0-9":
                    why = "%s, and this figure is written in %s; send every figure in the digits 0-9, or as JSON numbers" % (ctx["digits"], script)
                if why is UNDEF and ctx.get("mixed", UNDEF) is not UNDEF and N.has_mark(raw):
                    why = "%s, so what its \".\" and \",\" mean is not settled (declare the ruleset's \"locale\", or send JSON numbers)" % ctx["mixed"]
            if why is not UNDEF:
                resolved_but_bad = True
                if bad_path is UNDEF:
                    bad_path = p
                if strict and unreadable is UNDEF:
                    unreadable = {"how": "unparseable", "path": p, "raw": N.show_raw(raw), "detail": why}
                continue
            r = N.read_number_text_v020(raw, ctx.get("locale", UNDEF))
            n = norm_by_kind(kind, r["canonical"]) if r and (not ctx.get("exact") or N.number_text_is_exact(r["canonical"])) else None
            if r and n:
                norms = ["number_text_read"] + list(n.get("norms") or []) if r["changed"] else n.get("norms")
                b = {"status": "ok", "value": n["value"], "path": p, "confidence": confidence, "original": raw}
                if norms is not None:
                    b["norms"] = norms
                return b
            resolved_but_bad = True
            if bad_path is UNDEF:
                bad_path = p
            if strict and unreadable is UNDEF:
                unreadable = {"how": "unparseable", "path": p, "raw": N.show_raw(raw)}
            continue
        strict_reject = strict_numbers and isinstance(raw, str) and _numeric_kind(kind) and not is_strict_text(raw)
        norm = None if strict_reject else norm_by_kind(kind, raw)
        if norm:
            b = {"status": "ok", "value": norm["value"], "path": p, "confidence": confidence, "original": raw}
            if norm.get("norms") is not None:
                b["norms"] = norm["norms"]
            return b
        resolved_but_bad = True
        if bad_path is UNDEF:
            bad_path = p
        if strict and unreadable is UNDEF:
            unreadable = {"how": "unparseable", "path": p, "raw": N.show_raw(raw)}
    if ctx.get("v020") and not resolved_but_bad and isinstance(source, dict):
        ks = J.keys(source)
        for p in paths:
            if re.search(r"[.\[\]]", p):
                continue
            fp = fold_key(p)
            k = next((x for x in ks if x != p and fold_key(x) == fp), None)
            if k is not None:
                b = {"status": "unparseable", "confidence": 0, "badPath": k}
                if strict:
                    b["unreadable"] = {"how": "key", "path": k, "raw": N.show_raw(source[k])}
                return b
    default = _g(field, "default")
    if not resolved_but_bad and default is not UNDEF:
        return {"status": "ok", "value": default, "path": "default(%s)" % J.js_str(default), "confidence": 100}
    if resolved_but_bad:
        b = {"status": "unparseable", "confidence": 0}
        if bad_path is not UNDEF:
            b["badPath"] = bad_path
        if unreadable is not UNDEF:
            b["unreadable"] = unreadable
        return b
    return {"status": "missing", "confidence": 0}


def field_evidence(role, b):
    if b.get("status") != "ok" or not b.get("path"):
        return None
    if "ids" in b:
        value = b["ids"] if isinstance(b.get("original", UNDEF), list) else (b["ids"][0] if b["ids"] else None)
    elif "value" in b:
        value = b["value"]
    else:
        value = b.get("strValue", None)
    path = b["path"]
    source = "computed" if (path.startswith("default(") or path.startswith("line_computed(")) else "invoice"
    e = {"locator": {"kind": "field", "source": source, "path": path}, "value": value, "confidence": b["confidence"], "role": "OPERAND"}
    if b.get("original", UNDEF) is not UNDEF and J.js_str(b["original"]) != J.js_str(value):
        e["original"] = b["original"]
    if b.get("norms"):
        e["normalizations"] = b["norms"]
    return e


def _declared_abstention(why):
    return {"reason": "OUT_OF_RULESET_SCOPE", "detail": "declared abstention: %s" % J.js_str(why)}


def _evidence_key(e):
    loc = e["locator"]
    return "%s:%s" % (loc["source"], loc["path"]) if loc["kind"] == "field" else "span:%s" % loc["source_hash"]


def _is_defaulted(b):
    return bool(b) and b.get("status") == "ok" and bool(b.get("path")) and b["path"].startswith("default(")


def _is_amount_field(f):
    return isinstance(f, dict) and _g(f, "kind") in (UNDEF, "amount")


def _status_of(b):
    if not b:
        return "missing"
    if b["status"] == "ok":
        return "defaulted" if _is_defaulted(b) else "ok"
    return b["status"]


def _qc_excluded(b):
    return bool(b) and b.get("qc") is not None and b["qc"]["action"] in ("struck", "absent")


def _round9(x):
    return J.round9(x)


SUSPECT_BUDGET = 1000
SUSPECT_MAX_COMBOS = 400
SUSPECT_MAX_RAW = 32
SUSPECT_ALPHABET = "0123456789.,"


class Scope(object):
    """ScopeInfo: status(role), where(role), amounts(roles); a row's scope also knows its neighbours (engine 0.4.0)."""

    def __init__(self, status, where, amounts, neighbours=None):
        self.status = status
        self.where = where
        self.amounts = amounts
        self.neighbours = neighbours


def _is_contract_envelope(x):
    return isinstance(x, dict) and isinstance(x.get("extraction_contract"), str) and isinstance(x.get("fields"), dict)


# ---------------------------------------------------------------------------------------------------------------------
# verifyDeclarative

def verify_declarative(inp, ruleset, options=None):
    """verifyDeclarative(input, ruleset, options): options are now (an ISO timestamp), producer, tolerance, source
    ({text, quotes?, values?}) and engine. Raises InputRefused, EngineError, Outside."""
    options = dict(options or {})
    engine = engine_for(options.get("engine"))
    if at_least(engine, "0.6.0"):
        for name, value in (("the extraction", inp), ("supplied_choices", options.get("supplied_choices", UNDEF))):
            at = None if value is UNDEF else N.non_finite_path(value)
            if at is not None:
                raise InputRefused("extraction" if name == "the extraction" else "supplied_choices", "verify: %s" % N.non_finite_refusal(name, at))
        for name, value in (("the extraction", inp), ("supplied_choices", options.get("supplied_choices", UNDEF))):
            at = None if value is UNDEF else N.unsafe_magnitude_path(value)
            if at is not None:
                raise InputRefused("extraction" if name == "the extraction" else "supplied_choices",
                                   "verify: %s" % N.unsafe_magnitude_refusal(name, at, N.value_at_path(value, at)))
    try:
        return _Run(inp, ruleset, options, False).verdict()
    except X.ExprError as e:
        raise EngineError(str(e))


def _outside_scope(inp, ruleset, options, engine):
    """What this build does not re-perform, refused by name before anything is computed."""
    if not isinstance(inp, dict):
        raise Outside("the extraction is not a JSON object; the evaluator answers it with a verdict this build does not re-perform yet")
    for k in ("evidence", "supplied_choices", "archive_files", "declared_accuracy"):
        if options.get(k, UNDEF) is not UNDEF:
            raise Outside("an option %s is given; it is not re-performed by this build" % k)
    if isinstance(_g(ruleset, "algorithms"), dict):
        raise Outside("the ruleset names pinned algorithms (engine 0.4.0); this build carries no algorithm registry")
    ch = _g(ruleset, "choices")
    if isinstance(ch, list) and any(isinstance(s, dict) and isinstance(s.get("id"), str) for s in ch) and at_least(engine, "0.5.0"):
        raise Outside("the ruleset declares choice slots (engine 0.5.0); the choice ledger is not re-performed by this build")
    if at_least(engine, "0.5.0") and any(isinstance(c, dict) and "support" in c for c in _arr(_g(ruleset, "checks"))):
        raise Outside("a check declares its measured support (engine 0.5.0); it is not re-performed by this build")
    if engine != "0.0.1" and _g(ruleset, "require_contract") is True:
        raise Outside("the ruleset requires the extraction contract (require_contract); it is not re-performed by this build")
    if engine != "0.0.1" and _is_contract_envelope(inp):
        raise Outside("the extraction is an extraction-contract envelope; lowering it is not re-performed by this build")
    if not isinstance(_g(ruleset, "fields"), dict) or not isinstance(_g(ruleset, "checks"), list):
        raise Outside("not a declarative ruleset (it needs a \"fields\" object and a \"checks\" list)")


class _Run(object):
    """One evaluateDeclarative(input, ruleset, options, nested): the state the TypeScript closures share."""

    def __init__(self, inp, ruleset, options, nested):
        self.input = inp
        self.rs = ruleset
        self.options = options
        self.nested = nested

    # -- the field spec of a role, if the ruleset declares one
    def spec(self, r):
        f = self.rs["fields"]
        return f[r] if r in f else None

    def verdict(self):
        inp, rs, options = self.input, self.rs, self.options
        engine = engine_for(options.get("engine"))
        self.engine = engine
        _outside_scope(inp, rs, options, engine)
        lowered = None
        self.lowered = lowered
        self.extraction = inp
        self.line_keys = _nn(_g(rs, "lineArrayKeys"), ["line_items"])
        self._lines_of()

        fields = rs["fields"]
        self.doc_roles = [(r, f) for r, f in J.entries(fields) if not J.truthy(_g(f, "line")) and not isinstance(_g(f, "each"), list)]
        self.line_roles = [(r, f) for r, f in J.entries(fields) if J.truthy(_g(f, "line"))]
        self.line_role_names = [r for r, _ in self.line_roles]
        self.list_roles = [(r, f) for r, f in J.entries(fields) if not J.truthy(_g(f, "line")) and isinstance(_g(f, "each"), list)]

        src = options.get("source", UNDEF)
        self.src = src
        self.source_given = isinstance(src, dict) and isinstance(src.get("text"), str) and len(src["text"]) > 0
        self.engine_version = engine
        strict, strict_numbers = declarative_reading(rs, engine)
        self.strict, self.strict_numbers = strict, strict_numbers
        self.strict_text = N.is_strict_number_text if engine == "0.0.1" else N.is_strict_number_text_v010
        self.v020 = at_least(engine, "0.2.0")
        loc = N.resolve_locale(_g(rs, "locale")) if self.v020 else UNDEF
        self.locale = UNDEF if (loc is None or loc is UNDEF) else loc
        ctx = {}
        if self.v020:
            ctx["v020"] = True
            if self.locale is not UNDEF:
                ctx["locale"] = self.locale
            if at_least(engine, "0.6.0"):
                ctx["exact"] = True
                ctx["figures"] = True
        self.bind_ctx = ctx
        if ctx.get("figures"):
            texts = []

            def take(o, f):
                for p in _g(f, "paths"):
                    v = get_path(o, p)
                    if isinstance(v, str):
                        texts.append(v)
            for _, f in self.doc_roles:
                if _numeric_kind(_g(f, "kind")):
                    take(self.extraction, f)
            for _, f in self.line_roles:
                if _numeric_kind(_g(f, "kind")):
                    for l in self.lines:
                        take(l, f)
            fmt = N.format_of_texts(texts, UNDEF)
            if fmt.get("digits") is not None:
                ctx["digits"] = fmt["digits"]
            if self.locale is UNDEF and fmt["source"] == "mixed" and fmt.get("note") is not None:
                ctx["mixed"] = fmt["note"]
        self.v040 = at_least(engine, "0.4.0")
        self.v050 = at_least(engine, "0.5.0")
        self.v060 = at_least(engine, "0.6.0")
        self.v030 = at_least(engine, "0.3.0")
        if not self.v050 and options.get("supplied_choices", UNDEF) is not UNDEF:
            raise EngineError("supplied_choices are read from engine 0.5.0 on; this verdict is made under engine %s" % engine)
        if not self.v050 and options.get("archive_files", UNDEF) is not UNDEF:
            raise EngineError("archive_files are read from engine 0.5.0 on; this verdict is made under engine %s" % engine)
        # the choice ledger of a ruleset without slots: empty (a ruleset with slots is refused above)
        self.ledger = {"entries": [], "values": {}, "kinds": {}, "load_bearing": 0, "stated": 0, "stated_rate": None}
        self.choice_roles = set()
        self.beyond_data = 0

        self._bind_all()
        self.findings, self.support, self.path_tier = [], [], {}
        overlay = options.get("evidence", UNDEF)
        if overlay is not UNDEF and not self.v030:
            raise EngineError("an evidence overlay is read from engine 0.3.0 on; this verdict is made under engine %s" % engine)

        # line-computed roles, in declaration order (engine 0.4.0 evaluates them later, role by role over every row)
        lc = _g(rs, "line_computed")
        self.lc = lc if isinstance(lc, dict) else {}
        for role in J.keys(self.lc) if isinstance(lc, dict) else []:
            if role not in self.line_role_names:
                self.line_role_names.append(role)
        if isinstance(lc, dict) and not self.v040:
            for m in self.bound_lines:
                for role, formula in J.entries(lc):
                    vars_ = {r: (b.get("value") if b["status"] == "ok" else None) for r, b in m.items()}
                    try:
                        refs = X.referenced_roles(formula)
                    except X.ExprError:
                        refs = []
                    unreadable_operand = any((m.get(r) or {}).get("status") == "unparseable" for r in refs)
                    try:
                        value = None if unreadable_operand else X.eval_expr(formula, X.Env(vars_, lambda r: None))
                    except X.ExprError:
                        value = None
                    if value is not None and math.isfinite(value):
                        m[role] = {"status": "ok", "value": value, "path": "line_computed(%s)" % role, "confidence": 100}
                    else:
                        m[role] = {"status": "unparseable" if any((m.get(r) or {}).get("status") == "unparseable" for r in refs) else "missing", "confidence": 0}

        # labels in the source text, and where an unparseable raw value is printed (absent vs unreadable)
        if strict and self.source_given:
            src_lines = N.source_lines(src["text"])
            for role, f in self.doc_roles:
                b = self.bound_doc[role]
                labels = _g(f, "labels")
                if isinstance(labels, list) and len(labels) and (b["status"] == "missing" or _is_defaulted(b)):
                    at = N.find_label_line(src_lines, labels)
                    if at:
                        self.bound_doc[role] = {"status": "unparseable", "confidence": 0, "unreadable": {"how": "label", "at": at}}

            def locate(b):
                u = (b or {}).get("unreadable")
                if not u or "at" in u or u["how"] != "unparseable" or "raw" not in u:
                    return
                try:
                    import json
                    raw = json.loads(u["raw"])
                except ValueError:
                    return
                if isinstance(raw, str) or (J.is_num(raw) and not isinstance(raw, bool)):
                    hit = N.find_raw_line(src_lines, J.js_str(float(raw)) if J.is_num(raw) else raw)
                    if hit:
                        u["at"] = hit
            for b in list(self.bound_doc.values()):
                locate(b)
            for m in self.bound_lines:
                for b in list(m.values()):
                    locate(b)

        self.docVars = {}
        for role, b in self.bound_doc.items():
            self.docVars[role] = b.get("value") if b["status"] == "ok" else None
        self.computed_formula = {}
        comp = _g(rs, "computed")
        for role, formula in (J.entries(comp) if isinstance(comp, dict) else []):
            self.computed_formula[role] = formula
            if not self.v040:
                self.docVars[role] = X.eval_expr(formula, X.Env(self.docVars, self.sum_role))
        self.doc_env = X.Env(self.docVars, self.sum_role)
        self.algo_roles = {}

        tol_opt = options.get("tolerance", UNDEF)
        rs_tol = _g(rs, "tolerance")
        self.policy = tol_opt if tol_opt is not UNDEF and tol_opt is not None else (rs_tol if rs_tol is not UNDEF and rs_tol is not None else {"rel": 0.0003, "absCap": 0})
        if not isinstance(self.policy, dict) or not J.is_num(self.policy.get("rel", UNDEF)) or not J.is_num(self.policy.get("absCap", UNDEF)):
            raise Outside("the tolerance policy does not state rel and absCap as numbers; the Node engine computes such a policy in "
                          "NaN arithmetic, which this build does not re-perform")
        rd = UNDEF
        if isinstance(tol_opt, dict):
            rd = tol_opt.get("rounding", UNDEF)
        if (rd is UNDEF or rd is None) and isinstance(rs_tol, dict):
            rd = rs_tol.get("rounding", UNDEF)
        self.rounding_default = "none" if (rd is UNDEF or rd is None) else rd
        self.claims = []
        self.rests_on = {}
        self.not_applicable = []
        self.display_ids = {}
        self.display_money = set()
        self.inferred = set()
        self.advisories = []
        self.claim_check = {}
        self.agg_cache = {}
        self.computed_notes = {}

        if self.v040:
            self.doc_env.agg = lambda fn, role, st=None: self._agg_value(fn, role, st)
            self.doc_env.ref = lambda kind, role: self.docVars.get(role) if kind == "doc" else None
            late = self._late_line_computed()
            for role, f in J.entries(self.lc):
                if role not in late:
                    self._eval_line_computed(role, f)
            self.agg_cache.clear()
            for role, formula in (J.entries(comp) if isinstance(comp, dict) else []):
                notes = []
                self.docVars[role] = X.eval_expr_v040(formula, self.doc_env.copy(domain=notes.append))
                if self.docVars[role] is None and notes:
                    self.computed_notes[role] = notes[0]
            for role, f in J.entries(self.lc):
                if role in late:
                    self._eval_line_computed(role, f)
            self.agg_cache.clear()

        self.doc_scope = Scope(self._doc_status, self._doc_where, self._doc_amounts)
        self.doc_scope_v040 = Scope(
            lambda r: self._scope_status_of(self._resolve_doc(r)) if X.parse_operand_name(r) else self.doc_scope.status(r),
            lambda r: None if X.parse_operand_name(r) else self.doc_scope.where(r),
            lambda roles: self.doc_scope.amounts([r for r in roles if not X.parse_operand_name(r)]))

        for chk in [c for c in rs["checks"] if _nn(_g(c, "scope"), "document") == "document"]:
            d_scope = self.doc_scope_v040 if self.v040 else self.doc_scope

            def run(chk=chk, d_scope=d_scope):
                cmp_ = _g(chk, "compare")
                if cmp_ == "identifier":
                    self._run_identifier(chk, "document", "document", lambda r: self.bound_doc.get(r), self.doc_env, d_scope)
                elif cmp_ == "member":
                    self._run_member(chk, "document", "document", lambda r: self.bound_doc.get(r), self.doc_env, d_scope)
                else:
                    self._run_check(chk, self.doc_env, "document", self._doc_evidence_v040 if self.v040 else self._doc_evidence,
                                    self._doc_missing_v040 if self.v040 else self._doc_missing, d_scope, lambda r: self.bound_doc.get(r))
            self._run_advisable(chk, run)

        for chk in [c for c in rs["checks"] if _g(c, "scope") == "line"]:
            for i, m in enumerate(self.bound_lines):
                self._line_check(chk, i, m)

        from_policy = self.policy
        self._apply_tolerance_policy([c for c in self.claims if id(c) not in self.inferred] if self.inferred else self.claims, from_policy)

        self.quote_remedies = {}
        quotes = _g(rs, "quotes")
        if (isinstance(quotes, list) and len(quotes) > 0) or self.source_given:
            prepared = T.prepare_source(src["text"]) if self.source_given else None
            source_hash = J.sha256(src["text"]) if self.source_given else ""

            def id_of(raw):
                return raw if raw.startswith("source.") else "source.%s" % raw
            for q in _arr(quotes):
                claim_id = id_of(q["id"])
                ap = self._applicability(_g(q, "applies_if"), self.doc_env, self.doc_scope, lambda r: self.bound_doc.get(r))
                if ap["applies"] is False:
                    self.not_applicable.append({"claim_id": claim_id, "rule_id": "QUOTE_MATCH", "detail": "applies_if: %s" % ap["detail"]})
                    continue
                if _g(q, "remedy") is not UNDEF:
                    self.quote_remedies[claim_id] = RM.normalize_declaration(q["remedy"])
                label = _g(q, "label")
                base = {"claim_id": claim_id, "kind": "QUOTE_MATCH", "tier": "DETERMINISTIC", "field": q["id"] if label is UNDEF or label is None else label,
                        "asserted": q["quote"], "rule_id": "QUOTE_MATCH", "rule_name": "Verbatim quotation"}
                if ap["applies"] == "unknown":
                    c = dict(base)
                    c.update(outcome="INSUFFICIENT_DATA", locked=False, evidence=[], insufficiency=ap["why"], explanation="QUOTE_MATCH: %s" % ap["why"]["detail"])
                    self.claims.append(c)
                    continue
                if not self.source_given:
                    c = dict(base)
                    c.update(outcome="INSUFFICIENT_DATA", locked=False, evidence=[],
                             insufficiency={"reason": "REFERENCE_NOT_PROVIDED", "detail": "the ruleset requires this passage verbatim in the source document, and no source text was supplied (CLI --source; options.source.text)", "missing": ["source"]},
                             explanation="Could not look for the passage: no source text was supplied; abstaining.")
                    self.claims.append(c)
                    continue
                self.claims.append(T.verify_quote({"id": claim_id, "quote": q["quote"], "label": q["id"] if label is UNDEF or label is None else label}, prepared, source_hash))
            if self.source_given:
                for q in _arr(src.get("quotes", UNDEF)):
                    a = dict(q)
                    a["id"] = id_of(q["id"])
                    self.claims.append(T.verify_quote(a, prepared, source_hash))
                for v in _arr(src.get("values", UNDEF)):
                    a = dict(v)
                    a["id"] = id_of(v["id"])
                    self.claims.append(T.verify_value_in_text(a, prepared, source_hash))

        if self.v020 and not self.v030 and strict and _g(rs, "held_suspect") is not False and not self.nested and not lowered:
            self._held_suspect()

        v030_blocks = None
        if self.v030 and not self.nested:
            v030_blocks = self._v030_blocks()

        p = f = ins = 0
        for c in self.claims:
            if c["outcome"] == "PASS":
                p += 1
            elif c["outcome"] == "FAIL":
                f += 1
            else:
                ins += 1
        coverage = {"claims_total": len(self.claims), "claims_checked": p + f, "claims_pass": p, "claims_fail": f, "claims_insufficient": ins}
        outcome = "FAIL" if f > 0 else ("INSUFFICIENT_DATA" if p + f == 0 else "PASS")

        # A nested run (a one-character reading of an unreadable value) is read for its claims' outcomes only, so its identity
        # hashes are not computed (the Node evaluator computes and discards them; nothing read from a nested verdict depends on them).
        if self.nested:
            input_hash, rth, verdict_id = "", None, ""
        else:
            input_hash = input_hash_of(inp, rs, options)
            rth = remedy_table_hash(rs) if E.engine_at_least(engine, "0.2.0") else None
            verdict_id = J.rb.derive_verdict_id(input_hash, {"id": rs["id"], "version": rs["version"]}, engine, rth)
        issued_at = options.get("now") or E.now_iso()
        verdict = {"schema_version": SCHEMA_VERSION, "verdict_id": verdict_id, "issued_at": issued_at, "engine_version": engine,
                   "ruleset": {"id": rs["id"], "version": rs["version"], "domain": _nn(_g(rs, "domain"), rs["id"])},
                   "input_hash": input_hash}
        if rth is not None:
            verdict["remedy_table_hash"] = rth
        document = {"extraction_hash": "" if self.nested else J.hash_of(inp)}
        if options.get("producer", UNDEF) is not UNDEF:
            document["producer"] = options["producer"]
        document["line_items"] = len(self.lines)
        verdict.update({"replayable": True, "document": document,
                        "references": {"contract": False, "evidence": 0, "history": 0, "source": self.source_given},
                        "outcome": outcome, "aggregation": "ANY_FAIL_FAILS", "claims": self.claims, "coverage": coverage})
        if self.not_applicable:
            verdict["not_applicable"] = self.not_applicable
        if self.advisories:
            verdict["advisories"] = self.advisories
        if v030_blocks:
            verdict.update(v030_blocks)
        # engine 0.4.0: archives and algorithm pins (neither is carried by an input this build accepts)
        if self.v050:
            verdict["choices"] = self.ledger["entries"]
        if self.nested:
            return verdict
        declared = {}
        for c in rs["checks"]:
            code = _g(c, "code")
            if code not in declared:
                declared[code] = RM.normalize_declaration(_g(c, "remedy"))
        computed_roles = set(J.keys(comp) if isinstance(comp, dict) else [])

        def original(b):
            o = b.get("original", UNDEF)
            if o is UNDEF:
                return None
            return ", ".join(J.js_str(x) for x in o) if isinstance(o, list) else J.js_str(o)

        def shown(c, key):
            ident = self.display_ids.get(c["claim_id"])
            if ident:
                if key == "asserted" or key == "op:%s" % ident["left"]:
                    return original(ident["l"])
                if key == "expected" or key == "op:%s" % ident["right"]:
                    return original(ident["r"])
                return None
            if c["claim_id"] not in self.display_money:
                return None
            comp_ = c.get("computation") if isinstance(c.get("computation"), dict) else {}
            if key == "asserted":
                n = c.get("asserted", UNDEF)
            elif key == "expected":
                n = comp_.get("result", UNDEF)
            elif key == "variance":
                n = c.get("variance", UNDEF)
            elif key.startswith("op:"):
                n = (comp_.get("operands") or {}).get(key[3:], UNDEF)
            else:
                n = UNDEF
            return format_money(n) if J.is_num(n) else None

        ctx = {"declared": lambda rule: declared.get(rule), "declaredFor": lambda c: self.quote_remedies.get(c["claim_id"]), "display": shown,
               "document": _nn(_g(rs, "domain"), rs["id"]), "isComputed": lambda role: role in computed_roles,
               "sourceOfRole": lambda role: "source" if role == "source" else None,
               "pathOfRole": self._path_of_role}
        if strict:
            ctx["operandInfo"] = self._operand_info
        if self.v030:
            ctx["evidenceLaw"] = True
        if self.v050:
            ctx["choiceOf"] = lambda role: None
        RM.attach_remedies(verdict, ctx)
        return attach_scope(verdict)

    # ---- lines and binding -------------------------------------------------------------------------------------------
    def _lines_of(self):
        ex = self.extraction
        self.line_key = None
        self.lines = []
        for k in _arr(self.line_keys):
            if isinstance(ex.get(k, UNDEF) if isinstance(k, str) else UNDEF, list):
                self.line_key = k
                self.lines = [x for x in ex[k] if isinstance(x, dict)]
                break

    def _bind(self, o, f):
        return bind_field(o, f, self.strict, self.strict_numbers, self.strict_text, self.bind_ctx)

    def _bind_all(self):
        ex = self.extraction
        self.bound_doc = {}
        for role, f in self.doc_roles:
            self.bound_doc[role] = self._bind(ex, f)
        self.bound_lines = []
        for line in self.lines:
            m = {}
            for role, f in self.line_roles:
                m[role] = self._bind(line, f)
            self.bound_lines.append(m)
        self.bound_lists = {}
        for role, f in self.list_roles:
            key, arr = UNDEF, []
            for k in _g(f, "each"):
                a = get_path(ex, k)
                if isinstance(a, list):
                    key, arr = k, a
                    break
            elems = []
            for el in arr:
                if isinstance(el, dict):
                    elems.append(self._bind(el, f))
                else:
                    b = {"status": "unparseable", "confidence": 0, "badPath": ""}
                    if self.strict:
                        b["unreadable"] = {"how": "unparseable", "path": "", "raw": N.show_raw(el)}
                    elems.append(b)
            L = {"elems": elems}
            if key is not UNDEF:
                L["key"] = key
            self.bound_lists[role] = L

    def _list_at(self, role, j, rel=UNDEF):
        L = self.bound_lists.get(role)
        key = L.get("key") if L and "key" in L else role
        return "%s[%d]%s" % (key, j, ".%s" % rel if rel is not UNDEF and rel is not None and rel != "" else "")

    def _unp_detail(self, role, b, fallback):
        if b and b.get("unreadable"):
            kind = _g(self.spec(role), "kind") if self.spec(role) is not None else UNDEF
            k = None if kind is UNDEF else kind
            return N.describe_unreadable(role, b["unreadable"], k, self._strict_note(b["unreadable"], k))
        return fallback

    def _strict_note(self, u, kind):
        return N.not_strict_note(u, kind) if self.v060 else None

    def sum_role(self, role):
        L = self.bound_lists.get(role)
        if L is not None:
            if not L["elems"]:
                return None
            acc = 0.0
            for b in L["elems"]:
                if b["status"] != "ok" or "value" not in b:
                    return None
                acc += b["value"]
            return J.round4(acc)
        if not self.bound_lines:
            return None
        acc = 0.0
        for m in self.bound_lines:
            b = m.get(role)
            if not b or b["status"] != "ok" or "value" not in b:
                return None
            acc += b["value"]
        return J.round4(acc)

    # ---- guards and applicability ------------------------------------------------------------------------------------
    def _E_role_refs(self, *exprs):
        return X.role_refs_v040(*exprs) if self.v040 else X.role_refs(*exprs)

    def _E_eval(self, e, env):
        return X.eval_expr_v040(e, env) if self.v040 else X.eval_expr(e, env)

    def _E_refs(self, e):
        return X.referenced_roles_v040(e) if self.v040 else X.referenced_roles(e)

    def _guard(self, chk, env, scope):
        g = self._fired_guard(chk, env, scope)
        gr = _g(chk, "guard_reason")
        if g is not None and gr is not UNDEF:
            g = dict(g)
            g["detail"] = "%s. Reason: %s" % (g["detail"], J.js_str(gr))
        return g

    def _fired_guard(self, chk, env, scope):
        unless = _nn(_g(chk, "abstain_unless_all_present"), [])
        if unless:
            bad = [r for r in unless if scope.status(r) == "unparseable"]
            if bad:
                return {"reason": "UNPARSEABLE", "detail": "guard abstain_unless_all_present: %s present but unparseable" % ", ".join(bad), "missing": bad}
            absent = [r for r in unless if scope.status(r) != "ok"]
            if absent:
                return {"reason": "FIELD_MISSING", "detail": "guard abstain_unless_all_present: %s not reported" % ", ".join(absent), "missing": absent}
        for r in _nn(_g(chk, "abstain_if_present"), []):
            s = scope.status(r)
            if s in ("ok", "unparseable"):
                w = scope.where(r)
                return {"reason": "OUT_OF_RULESET_SCOPE", "detail": "guard abstain_if_present: %s is reported%s; the identity does not model it" % (r, " (%s)" % w if w else "")}
        for g in _nn(_g(chk, "abstain_if_present_without"), []):
            s = scope.status(g["present"])
            if s in ("ok", "unparseable") and scope.status(g["without"]) != "ok":
                w = scope.where(g["present"])
                return {"reason": "OUT_OF_RULESET_SCOPE", "detail": "guard abstain_if_present_without: %s is reported%s without %s; the identity reads %s in its place" % (
                    g["present"], " (%s)" % w if w else "", g["without"], g["without"])}
        for c in _nn(_g(chk, "abstain_if"), []):
            try:
                unp = [x for x in self._E_role_refs(c["left"], c["right"])["all"] if scope.status(x) == "unparseable"]
                if unp:
                    return {"reason": "UNPARSEABLE", "detail": "guard abstain_if: %s present but unparseable, so \"%s %s %s\" cannot be evaluated" % (
                        ", ".join(unp), c["left"], c["op"], c["right"]), "missing": unp}
                l = self._E_eval(c["left"], env)
                r = self._E_eval(c["right"], env)
            except X.ExprError as e:
                return {"reason": "OUT_OF_RULESET_SCOPE", "detail": "guard abstain_if: expression error: %s" % e}
            if l is None or r is None:
                continue
            if condition_holds(l, c["op"], r, _nn(_g(c, "tol"), 0.0)):
                return {"reason": "OUT_OF_RULESET_SCOPE", "detail": "guard abstain_if: %s %s %s holds (%s vs %s)" % (c["left"], c["op"], c["right"], _num(J.round4(l)), _num(J.round4(r)))}
        return None

    def _applicability(self, conds, env, scope, lookup):
        if conds is UNDEF or conds is None or len(conds) == 0:
            return {"applies": True}

        def unknown(reason, roles, what):
            why = {"reason": reason, "detail": "cannot tell whether this applies: %s" % what}
            if roles:
                why["missing"] = roles
            return {"applies": "unknown", "why": why}
        for c in conds:
            if self.v040 and isinstance(c, dict) and "neighbour" in c:
                want = c["neighbour"]
                has = scope.neighbours
                if not has or want not in ("prev", "next"):
                    shown_ = J.stringify(want)
                    return unknown("OUT_OF_RULESET_SCOPE", [], "a neighbour condition is read on a row, with \"prev\" or \"next\" (got %s%s)" % (
                        shown_ if shown_ is not UNDEF else "undefined", "" if has else " at document scope"))
                if not has[want]:
                    return {"applies": False, "detail": "no_neighbour: this row has no %s row" % ("previous" if want == "prev" else "next")}
                continue
            if isinstance(c, dict) and "any_present" in c:
                sts = [scope.status(r) for r in c["any_present"]]
                if "ok" in sts:
                    continue
                bad = [r for r, s in zip(c["any_present"], sts) if s == "unparseable"]
                if bad:
                    return unknown("UNPARSEABLE", bad, "%s present but could not be read" % ", ".join(bad))
                return {"applies": False, "detail": "none of %s is reported" % ", ".join(c["any_present"])}
            if isinstance(c, dict) and "field" in c and "present" in c:
                st = scope.status(c["field"])
                if st == "unparseable":
                    return unknown("UNPARSEABLE", [c["field"]], "%s is present but could not be read" % c["field"])
                if st != "ok":
                    return {"applies": False, "detail": "%s is not reported" % c["field"]}
                continue
            if isinstance(c, dict) and "field" in c:
                s = scope.status(c["field"])
                if s == "unparseable":
                    return unknown("UNPARSEABLE", [c["field"]], "%s is present but could not be read" % c["field"])
                b = lookup(c["field"])
                if not b or b["status"] != "ok":
                    return unknown("FIELD_MISSING", [c["field"]], "%s not reported" % c["field"])

                def fold(x):
                    return identifier_key(fold_identifier_text(x, self.v020))
                if "ids" in b:
                    vals = b["ids"]
                elif "strValue" in b:
                    vals = [b["strValue"]]
                elif "value" in b:
                    vals = [J.js_str(b["value"])]
                else:
                    vals = []
                vals = [fold(v) for v in vals]
                is_in = "in" in c
                lst = [J.js_str(x) for x in (c["in"] if is_in else c["not_in"])]
                st_ = set(fold(x) for x in lst)
                holds = (len(vals) > 0 and all(v in st_ for v in vals)) if is_in else not any(v in st_ for v in vals)
                if not holds:
                    o = b.get("original", UNDEF)
                    shown_ = ", ".join(J.js_str(x) for x in o) if isinstance(o, list) else J.js_str(o if o is not UNDEF and o is not None else ", ".join(vals))
                    return {"applies": False, "detail": "%s %s [%s] does not hold (%s is \"%s\")" % (c["field"], "in" if is_in else "not in", ", ".join(lst), c["field"], shown_)}
                continue
            try:
                refs = self._E_role_refs(c["left"], c["right"])["all"]
            except X.ExprError as e:
                return unknown("OUT_OF_RULESET_SCOPE", [], "expression error: %s" % e)
            nn = next((r for r in refs if scope.status(r) == "no_neighbour"), None) if self.v040 else None
            if nn is not None:
                return unknown("OUT_OF_RULESET_SCOPE", [], "%s, in \"%s %s %s\"" % (self._no_neighbour_text(nn), c["left"], c["op"], c["right"]))
            unp = [r for r in refs if scope.status(r) == "unparseable"]
            if unp:
                return unknown("UNPARSEABLE", unp, "%s present but could not be read" % ", ".join(unp))
            miss = [r for r in refs if scope.status(r) == "missing"]
            if miss:
                return unknown("FIELD_MISSING", miss, "%s not reported" % ", ".join(miss))
            try:
                l = self._E_eval(c["left"], env)
                r = self._E_eval(c["right"], env)
            except X.ExprError as e:
                return unknown("OUT_OF_RULESET_SCOPE", [], "expression error: %s" % e)
            if l is None or r is None:
                return unknown("FIELD_MISSING", refs, "a value in \"%s %s %s\" is absent" % (c["left"], c["op"], c["right"]))
            if not condition_holds(l, c["op"], r, _nn(_g(c, "tol"), 0.0)):
                return {"applies": False, "detail": "%s %s %s does not hold (%s vs %s)" % (c["left"], c["op"], c["right"], _num(J.round4(l)), _num(J.round4(r)))}
        return {"applies": True}

    def _no_neighbour_text(self, name, i=None):
        p = X.parse_operand_name(name)
        kind = "next" if p and p["kind"] == "next" else "prev"
        return "no_neighbour: %s has no %s row, so %s(%s) has no value" % (
            "this row" if i is None else "line %d" % i, "previous" if kind == "prev" else "next", kind, p["role"] if p else name)

    def _is_money_role(self, r, seen=None):
        seen = seen if seen is not None else set()
        if r in seen:
            return False
        seen.add(r)
        f = self.spec(r)
        if f is not None:
            return _is_amount_field(f)
        formula = self.computed_formula.get(r)
        if formula is None:
            return False
        refs = self._E_refs(formula)
        return len(refs) > 0 and all(self._is_money_role(x, seen) for x in refs)

    def _unresolved_operand(self, role, prefix, lookup):
        def as_value(b):
            u = b.get("unreadable") or {}
            if "raw" not in u:
                return None
            try:
                import json
                v = json.loads(u["raw"])
                return v if (v is None or isinstance(v, (str, bool)) or J.is_num(v)) else u["raw"]
            except ValueError:
                return u["raw"]

        def say(path, b):
            return "%s is reported without a value" % path if b["status"] == "missing" else "%s was reported as %s and could not be read" % (
                path, (b.get("unreadable") or {}).get("raw", "a value"))
        L = self.bound_lists.get(role)
        if L is not None:
            if not L["elems"]:
                return []
            out = []
            for j, e in enumerate(L["elems"]):
                if e["status"] == "ok":
                    continue
                rel = (e.get("unreadable") or {}).get("path", UNDEF)
                if rel is UNDEF:
                    sp = self.spec(role)
                    rel = sp["paths"][0] if sp is not None and sp.get("paths") else UNDEF
                p = self._list_at(role, j, rel)
                out.append({"role": role, "path": p, "value": as_value(e), "what": say(p, e)})
            return out
        lk = self.line_key if self.line_key is not None else "line_items"
        li = re.match(r"line\[([0-9]+)\]\Z", prefix)
        if li:
            b = lookup(role)
            if b and b["status"] == "unparseable":
                u = b.get("unreadable") or {}
                sp = self.spec(role)
                rel = u["path"] if "path" in u else (sp["paths"][0] if sp is not None and sp.get("paths") else role)
                return [{"role": role, "path": "%s[%s].%s" % (lk, li.group(1), rel), "value": as_value(b),
                         "what": say("%s[%s].%s" % (lk, li.group(1), u.get("path", role)), b)}]
            return []
        if role in self.line_role_names:
            out = []
            for i, m in enumerate(self.bound_lines):
                b = m.get(role)
                if b and b["status"] == "unparseable":
                    u = b.get("unreadable") or {}
                    p = "%s[%d].%s" % (lk, i, u.get("path", role))
                    out.append({"role": role, "path": p, "value": as_value(b), "what": say(p, b)})
            return out
        b = self.bound_doc.get(role)
        if b and b["status"] == "unparseable":
            u = b.get("unreadable") or {}
            p = u["path"] if "path" in u else b.get("badPath", role)
            return [{"role": role, "path": p, "value": as_value(b), "what": say(p, b)}]
        return []

    def _advisory_of(self, chk, c):
        comp = c.get("computation")
        ops = comp.get("operands") if isinstance(comp, dict) else None
        uses_lines = re.search(r"\bsum" + J.S + r"*\(", "%s %s" % (chk["left"], chk["right"])) is not None and len(self.lines) > 0
        a = {"channel": "COUNSEL", "rule_id": chk["code"], "rule_name": _nn(_g(chk, "name"), chk["code"]), "claim_id": c["claim_id"],
             "detail": "%s: %s %s %s does not hold%s. Counsel, not a verdict: the ruleset reads this check as advice (advisory), so it changes no outcome and no gate." % (
                 _nn(_g(chk, "field"), chk["code"]), J.js_str(_nn((ops or {}).get("left", UNDEF), "?")), chk["op"],
                 J.js_str(_nn((ops or {}).get("right", UNDEF), "?")),
                 " (over %d line%s)" % (len(self.lines), "" if len(self.lines) == 1 else "s") if uses_lines else "")}
        if comp:
            a["computation"] = comp
        return a

    def _run_advisable(self, chk, run):
        before = len(self.claims)
        run()
        if self.v040:
            for c in self.claims[before:]:
                m = re.match(r"line\[([0-9]+)\]\Z", c["claim_id"].split(".")[0])
                cc = {"chk": chk}
                if m:
                    cc["line"] = int(m.group(1))
                self.claim_check[id(c)] = cc
        if _g(chk, "advisory") is not True:
            return
        taken = self.claims[before:]
        del self.claims[before:]
        for c in taken:
            self.inferred.discard(id(c))
            self.display_money.discard(c["claim_id"])
            self.display_ids.pop(c["claim_id"], None)
            if c["outcome"] == "FAIL":
                self.advisories.append(self._advisory_of(chk, c))

    @staticmethod
    def _line_of_prefix(prefix):
        m = re.match(r"line\[([0-9]+)\]\Z", prefix)
        return int(m.group(1)) if m else None

    def _set_rests(self, claim, roles, prefix):
        info = {"roles": roles}
        li = self._line_of_prefix(prefix)
        if li is not None:
            info["line"] = li
        self.rests_on[id(claim)] = (claim, info)

    # ---- a numeric check ---------------------------------------------------------------------------------------------
    def _run_check(self, chk, env, prefix, gather, missing_of, scope, lookup):
        claim_id = "%s.%s" % (prefix, chk["code"])
        base = {"claim_id": claim_id, "kind": "RECOMPUTE", "tier": "DETERMINISTIC", "field": _nn(_g(chk, "field"), chk["code"].lower()),
                "rule_id": chk["code"], "rule_name": _nn(_g(chk, "name"), chk["code"])}

        def abstain(ins):
            c = dict(base)
            c.update(outcome="INSUFFICIENT_DATA", asserted=None, evidence=[], insufficiency=ins, locked=False,
                     explanation="%s: %s" % (chk["code"], ins["detail"]))
            self.claims.append(c)

        ap = self._applicability(_g(chk, "applies_if"), env, scope, lookup)
        if ap["applies"] is False:
            self.not_applicable.append({"claim_id": claim_id, "rule_id": chk["code"], "detail": "applies_if: %s" % ap["detail"]})
            return
        if ap["applies"] == "unknown":
            return abstain(ap["why"])
        if _g(chk, "abstain") is not UNDEF:
            return abstain(_declared_abstention(chk["abstain"]))
        fiu = _g(chk, "fail_if_unreadable")
        if fiu is not UNDEF and fiu is not None and len(fiu):
            try:
                named = [r for r in self._E_role_refs(chk["left"], chk["right"], *[x for a in _nn(_g(chk, "alternatives"), []) for x in (a["left"], a["right"])])["all"] if r in fiu]
            except X.ExprError:
                named = []
            items = [it for r in named for it in self._unresolved_operand(r, prefix, lookup)]
            if items:
                try:
                    left_v = self._E_eval(chk["left"], env)
                except X.ExprError:
                    left_v = None
                try:
                    ok_roles = self._E_role_refs(chk["left"], chk["right"])["all"]
                except X.ExprError:
                    ok_roles = []
                ev = list(gather(ok_roles)) + [{"locator": {"kind": "field", "source": "invoice", "path": it["path"]}, "value": it["value"],
                                                "confidence": 0, "role": "OPERAND", "normalizations": ["unreadable"]} for it in items]
                roles_named = []
                for it in items:
                    if it["role"] not in roles_named:
                        roles_named.append(it["role"])
                c = dict(base)
                c.update(outcome="FAIL", asserted=None if left_v is None else J.round4(left_v),
                         computation={"formula": "%s %s %s" % (chk["left"], chk["op"], chk["right"]), "operands": {"unreadable": [it["path"] for it in items]}, "result": None},
                         evidence=ev, locked=False,
                         explanation="%s: %s. The ruleset fails this check on an unreadable %s instead of abstaining (fail_if_unreadable)." % (
                             chk["code"], "; ".join(it["what"] for it in items), ", ".join(roles_named)))
                self.claims.append(c)
                self._set_rests(c, [r for r in ok_roles if r not in named], prefix)
                return

        forms = [{"left": chk["left"], "right": chk["right"]}] + list(_nn(_g(chk, "alternatives"), []))
        multi = len(forms) > 1

        def blocked_by(refs):
            m = missing_of(refs["required"])
            if self.strict:
                unp_opt = [o for o in refs["optional"] if scope.status(o) == "unparseable"]
                if unp_opt and (not m or m["reason"] == "UNPARSEABLE"):
                    opt = [self._unp_detail(o, lookup(o), "optional %s is present but could not be parsed as a number" % o) for o in unp_opt]
                    return {"reason": "UNPARSEABLE", "detail": "; ".join(([m["detail"]] if m else []) + opt), "missing": list((m or {}).get("missing") or []) + unp_opt}
            if m:
                return m
            for o in refs["optional"]:
                if scope.status(o) == "unparseable":
                    return {"reason": "UNPARSEABLE", "detail": "optional %s is present but could not be parsed as a number" % o, "missing": [o]}
            return None
        k = -1
        refs = self._E_role_refs(forms[0]["left"], forms[0]["right"])
        blocks = []
        for i in range(len(forms)):
            r = refs if i == 0 else self._E_role_refs(forms[i]["left"], forms[i]["right"])
            why = blocked_by(r)
            if not why:
                k = i
                refs = r
                break
            blocks.append({"refs": r, "why": why})
        if k < 0:
            if not multi:
                return abstain(blocks[0]["why"])
            unp = next((b for b in blocks if b["why"]["reason"] == "UNPARSEABLE"), None)
            if unp:
                return abstain(unp["why"])
            lacks = [[x for x in b["refs"]["required"] if scope.status(x) not in ("ok", "defaulted")] for b in blocks]
            miss = []
            for l in lacks:
                for x in l:
                    if x not in miss:
                        miss.append(x)
            return abstain({"reason": "FIELD_MISSING", "detail": "no form of %s has all its required operands (%s)" % (
                chk["code"], "; ".join("form %d lacks %s" % (i + 1, ", ".join(l) or blocks[i]["why"]["detail"]) for i, l in enumerate(lacks))), "missing": miss})
        form = forms[k]
        roles = refs["all"]
        if len(refs["required"]) == 0 and len(refs["optional"]) > 0 and not any(scope.status(o) == "ok" for o in refs["optional"]):
            return abstain({"reason": "FIELD_MISSING", "detail": "none of the operands of %s is reported (all are optional)" % chk["code"], "missing": refs["optional"]})
        g = self._guard(chk, env, scope)
        if g:
            return abstain(g)
        domain_notes = []
        eval_env = env.copy(domain=domain_notes.append) if self.v040 else env
        try:
            left = self._E_eval(form["left"], eval_env)
            right = self._E_eval(form["right"], eval_env)
        except X.ExprError as e:
            c = dict(base)
            c.update(outcome="INSUFFICIENT_DATA", asserted=None, evidence=[], insufficiency={"reason": "OUT_OF_RULESET_SCOPE", "detail": "expression error: %s" % e},
                     locked=False, explanation="%s: bad expression" % chk["code"])
            self.claims.append(c)
            return
        if (left is None or right is None) and domain_notes:
            return abstain({"reason": "OUT_OF_RULESET_SCOPE", "detail": "no value: %s in \"%s\"" % (domain_notes[0], form["left"] if left is None else form["right"])})
        if left is None or right is None:
            c = dict(base)
            c.update(outcome="INSUFFICIENT_DATA", asserted=None, evidence=[], insufficiency={"reason": "FIELD_MISSING", "detail": "a value needed by %s was absent" % chk["code"], "missing": roles},
                     locked=False, explanation="%s: operand absent" % chk["code"])
            self.claims.append(c)
            return
        exact = _g(chk, "exact_tolerance") is True
        infer = not exact and _nn(_g(chk, "rounding"), self.rounding_default) == "infer"
        policy = self.policy
        rt = rounding_tolerance(scope.amounts(roles), policy["rel"], policy["absCap"], _nn(_g(chk, "tol"), 0.01)) if infer else None
        tol = rt["tol"] if rt else _nn(_g(chk, "tol"), 0.01)
        op = chk["op"]
        if exact:
            d = J.round9(left - right)
            passed = abs(d) <= tol if op == "=" else (d <= tol if op == "<=" else (d >= -tol if op == ">=" else abs(d) > tol))
        elif op == "=":
            passed = abs(left - right) <= tol
        elif op == "<=":
            passed = left <= right + tol
        elif op == ">=":
            passed = left >= right - tol
        else:
            passed = abs(left - right) > tol
        evidence = gather(roles)
        absent_optional = [o for o in refs["optional"] if scope.status(o) != "ok"]
        notes = []
        if multi:
            notes.append("Form %d of %d." % (k + 1, len(forms)))
        if absent_optional:
            notes.append("Optional terms not reported (counted as 0): %s." % ", ".join(absent_optional))
        if exact:
            notes.append("Tolerance %s, compared exactly (the difference to 9 decimal places)." % _num(tol))
        if rt:
            notes.append("Rounding-aware tolerance %s = max(%s%% of the largest operand %s, unit %s × %d operands%s, floor %s)%s." % (
                _num(J.round4(rt["tol"])), _num(J.round4(policy["rel"] * 100)), _num(J.round4(rt["maxAbs"])),
                "none" if rt["unit"] is None else _num(rt["unit"]), rt["n"],
                "; relative term capped at %s" % _num(policy["absCap"]) if policy["absCap"] > 0 else "", _num(_nn(_g(chk, "tol"), 0.01)),
                ": the difference is treated as rounding, not error" if (passed and left != right and op == "=") else ""))
        claim = dict(base)
        claim.update(outcome="PASS" if passed else "FAIL", asserted=J.round4(left),
                     computation={"formula": "%s %s %s" % (form["left"], op, form["right"]), "operands": {"left": J.round4(left), "right": J.round4(right)},
                                  "result": J.round4(right), "tolerance": {"abs": J.round4(rt["tol"]), "rel": policy["rel"]} if rt else {"abs": tol}},
                     evidence=evidence, locked=not passed,
                     explanation="%s: %s %s %s — %s.%s" % (_nn(_g(chk, "field"), chk["code"]), _num(J.round4(left)), op, _num(J.round4(right)),
                                                         "holds" if passed else "does not hold", " %s" % " ".join(notes) if notes else ""))
        if not passed:
            claim["variance"] = J.round4(left - right)
        self.claims.append(claim)
        self._set_rests(claim, roles, prefix)
        if rt or exact:
            self.inferred.add(id(claim))
        if len(roles) > 0 and all(self._is_money_role(r) for r in roles):
            self.display_money.add(claim_id)

    # ---- an identifier check -----------------------------------------------------------------------------------------
    def _run_identifier(self, chk, prefix, scope_name, lookup, env, info):
        claim_id = "%s.%s" % (prefix, chk["code"])
        base = {"claim_id": claim_id, "kind": "CROSS_REFERENCE", "tier": "DETERMINISTIC", "field": _nn(_g(chk, "field"), chk["code"].lower()),
                "rule_id": chk["code"], "rule_name": _nn(_g(chk, "name"), chk["code"])}

        def abstain(ins):
            c = dict(base)
            c.update(outcome="INSUFFICIENT_DATA", asserted=None, evidence=[], insufficiency=ins, locked=False, explanation="%s: %s" % (chk["code"], ins["detail"]))
            self.claims.append(c)
        ap = self._applicability(_g(chk, "applies_if"), env, info, lookup)
        if ap["applies"] is False:
            self.not_applicable.append({"claim_id": claim_id, "rule_id": chk["code"], "detail": "applies_if: %s" % ap["detail"]})
            return
        if ap["applies"] == "unknown":
            return abstain(ap["why"])
        if _g(chk, "abstain") is not UNDEF:
            return abstain(_declared_abstention(chk["abstain"]))
        L = J.trim(J.js_str(_nn(_g(chk, "left"), "")))
        R = J.trim(J.js_str(_nn(_g(chk, "right"), "")))
        if chk["op"] not in ("=", "!="):
            return abstain({"reason": "OUT_OF_RULESET_SCOPE", "detail": "identifier checks support only = and != (got %s)" % J.js_str(chk["op"])})
        if _g(chk, "rounding") is not UNDEF:
            return abstain({"reason": "OUT_OF_RULESET_SCOPE", "detail": "rounding applies to numeric checks only, not to an identifier check"})
        form_note = ""
        alts = _g(chk, "alternatives")
        if alts is not UNDEF:
            forms = [{"left": L, "right": R}] + [{"left": J.trim(J.js_str(_nn(_g(a, "left"), ""))), "right": J.trim(J.js_str(_nn(_g(a, "right"), "")))} for a in _arr(alts)]

            def st(r):
                return info.status(r)
            k = next((i for i, f in enumerate(forms) if st(f["left"]) == "ok" and st(f["right"]) == "ok"), -1)
            if k < 0:
                unp = []
                for f in forms:
                    for r in (f["left"], f["right"]):
                        if st(r) == "unparseable" and r not in unp:
                            unp.append(r)
                if unp:
                    return abstain({"reason": "UNPARSEABLE", "detail": "; ".join(self._unp_detail(r, lookup(r), "%s is present but is not an identifier or a list of identifiers" % r) for r in unp), "missing": unp})
                lacks = [[r for r in (f["left"], f["right"]) if st(r) != "ok"] for f in forms]
                miss = []
                for l in lacks:
                    for x in l:
                        if x not in miss:
                            miss.append(x)

                def uniq(l):
                    out = []
                    for x in l:
                        if x not in out:
                            out.append(x)
                    return out
                return abstain({"reason": "FIELD_MISSING", "detail": "no form of %s has both its fields reported (%s)" % (
                    chk["code"], "; ".join("form %d lacks %s" % (i + 1, ", ".join(uniq(l))) for i, l in enumerate(lacks))), "missing": miss})
            L, R = forms[k]["left"], forms[k]["right"]
            form_note = " Form %d of %d." % (k + 1, len(forms))
        for r in (L, R):
            f = self.spec(r)
            if not isinstance(f, dict) or _g(f, "kind") != "identifier" or J.truthy(_g(f, "line")) != (scope_name == "line"):
                return abstain({"reason": "OUT_OF_RULESET_SCOPE", "detail": "\"%s\" is not a %s-level 'identifier' field (an identifier check names two identifier fields)" % (r, scope_name)})
        bl, br = lookup(L), lookup(R)
        if self.strict:
            bad = [r for r in ([L] if L == R else [L, R]) if (lookup(r) or {}).get("status") == "unparseable"]
            if bad:
                return abstain({"reason": "UNPARSEABLE", "detail": "; ".join(self._unp_detail(r, lookup(r), "%s is present but is not an identifier or a list of identifiers" % r) for r in bad), "missing": bad})
        for r, b in ((L, bl), (R, br)):
            if b and b["status"] == "unparseable":
                return abstain({"reason": "UNPARSEABLE", "detail": "%s is present but is not an identifier or a list of identifiers" % r, "missing": [r]})
        for r, b in ((L, bl), (R, br)):
            if not b or b["status"] != "ok" or "ids" not in b:
                return abstain({"reason": "FIELD_MISSING", "detail": "%s not present" % r, "missing": [r]})
        g = self._guard(chk, env, info)
        if g:
            return abstain(g)
        li, ri = bl["ids"], br["ids"]
        same_exact = len(li) == len(ri) and all(x in ri for x in li)
        same = same_exact or _same_identifiers(li, ri)
        folded = same and not same_exact
        passed = same if chk["op"] == "=" else not same

        def show(ids):
            return ids[0] if len(ids) == 1 else "{%s}" % ", ".join(ids)

        def as_value(ids):
            return ids[0] if len(ids) == 1 else ids
        self.display_ids[claim_id] = {"left": L, "right": R, "l": bl, "r": br}
        c = dict(base)
        c.update(outcome="PASS" if passed else "FAIL", asserted=as_value(li),
                 computation={"formula": "%s %s %s (identifier sets; whitespace removed, upper-cased%s)" % (L, chk["op"], R, "; punctuation ignored except between digits" if folded else ""),
                              "operands": {L: li, R: ri}, "result": as_value(ri)},
                 evidence=[e for e in (field_evidence(L, bl), field_evidence(R, br)) if e is not None],
                 locked=not passed, explanation="%s: %s %s %s — %s.%s" % (_nn(_g(chk, "field"), chk["code"]), show(li), chk["op"], show(ri), "holds" if passed else "does not hold", form_note))
        self.claims.append(c)
        self._set_rests(c, [L, R], prefix)

    # ---- a membership check ------------------------------------------------------------------------------------------
    def _run_member(self, chk, prefix, scope_name, lookup, env, info):
        claim_id = "%s.%s" % (prefix, chk["code"])
        base = {"claim_id": claim_id, "kind": "CONSISTENCY", "tier": "DETERMINISTIC", "field": _nn(_g(chk, "field"), chk["code"].lower()),
                "rule_id": chk["code"], "rule_name": _nn(_g(chk, "name"), chk["code"])}

        def abstain(ins):
            c = dict(base)
            c.update(outcome="INSUFFICIENT_DATA", asserted=None, evidence=[], insufficiency=ins, locked=False, explanation="%s: %s" % (chk["code"], ins["detail"]))
            self.claims.append(c)
        ap = self._applicability(_g(chk, "applies_if"), env, info, lookup)
        if ap["applies"] is False:
            self.not_applicable.append({"claim_id": claim_id, "rule_id": chk["code"], "detail": "applies_if: %s" % ap["detail"]})
            return
        if ap["applies"] == "unknown":
            return abstain(ap["why"])
        if _g(chk, "abstain") is not UNDEF:
            return abstain(_declared_abstention(chk["abstain"]))
        L = J.trim(J.js_str(_nn(_g(chk, "left"), "")))
        f = self.spec(L)
        if chk["op"] not in ("=", "!="):
            return abstain({"reason": "OUT_OF_RULESET_SCOPE", "detail": "member checks support only = and != (got %s)" % J.js_str(chk["op"])})
        codes_in = _g(chk, "in")
        if not isinstance(f, dict) or _g(f, "kind") not in ("identifier", "string") or J.truthy(_g(f, "line")) != (scope_name == "line") or not isinstance(codes_in, list) or len(codes_in) == 0:
            return abstain({"reason": "OUT_OF_RULESET_SCOPE", "detail": "\"%s\" is not a %s-level 'identifier' or 'string' field with a list of codes (a member check names one field and its codes)" % (L, scope_name)})
        b = lookup(L)
        if b and b["status"] == "unparseable":
            return abstain({"reason": "UNPARSEABLE", "detail": self._unp_detail(L, b, "%s is present but could not be read" % L) if self.strict else "%s is present but could not be read" % L, "missing": [L]})
        if not b or b["status"] != "ok":
            return abstain({"reason": "FIELD_MISSING", "detail": "%s not present" % L, "missing": [L]})
        g = self._guard(chk, env, info)
        if g:
            return abstain(g)

        def code_of(x):
            s = "".join(ch for ch in unicodedata.normalize("NFKC", x) if not J.category_is(ch, "Cf"))
            return J.trim(re.sub(J.S + "+", " ", s))
        raw = b.get("original", UNDEF)
        values = [(J.js_str(x) if (J.is_num(x) and math.isfinite(x)) else (x if isinstance(x, str) else UNDEF)) for x in (raw if isinstance(raw, list) else [raw])]
        if any(v is UNDEF for v in values):
            return abstain({"reason": "UNPARSEABLE", "detail": "%s is not a code or a list of codes" % L, "missing": [L]})
        codes = set(code_of(x) for x in codes_in)
        vals = [v for v in (code_of(x) for x in values) if len(v) > 0]
        if not vals:
            return abstain({"reason": "FIELD_MISSING", "detail": "%s is blank" % L, "missing": [L]})

        def member(v):
            return " " not in v and v in codes
        passed = all(member(v) for v in vals) if chk["op"] == "=" else not any(member(v) for v in vals)
        outside = [v for v in vals if not member(v)]
        shown_ = vals[0] if len(vals) == 1 else "{%s}" % ", ".join(vals)
        n = len(codes_in)
        rt = _g(chk, "right")
        c = dict(base)
        if chk["op"] == "=":
            words = "is one of the listed codes" if passed else "is not one of the %d listed codes (%s)" % (n, ", ".join(outside))
        else:
            words = "is none of the listed codes" if passed else "is one of the codes it must not be"
        c.update(outcome="PASS" if passed else "FAIL", asserted=vals[0] if len(vals) == 1 else vals,
                 computation={"formula": "%s %s %s (%d code%s; whitespace collapsed, case kept)" % (L, "in" if chk["op"] == "=" else "not in", J.js_str(rt) if J.truthy(rt) else "the listed codes", n, "" if n == 1 else "s"),
                              "operands": {L: vals}, "result": 1 if passed else 0},
                 evidence=[e for e in (field_evidence(L, b),) if e is not None], locked=not passed,
                 explanation="%s: %s %s." % (_nn(_g(chk, "field"), chk["code"]), shown_, words))
        self.claims.append(c)
        self._set_rests(c, [L], prefix)

    # ---- document scope ----------------------------------------------------------------------------------------------
    def _doc_missing(self, roles):
        if self.strict:
            bad, why = [], []
            for r in roles:
                L = self.bound_lists.get(r)
                if L is not None:
                    j = next((i for i, e in enumerate(L["elems"]) if e["status"] == "unparseable"), -1)
                    if j >= 0:
                        e = L["elems"][j]
                        bad.append(r)
                        why.append("%s: %s" % (self._list_at(r, j), self._unp_detail(r, e, "")) if e.get("unreadable") else "%s present but unparseable at %s" % (r, self._list_at(r, j)))
                    continue
                b = self.bound_doc.get(r)
                if b and b["status"] == "unparseable":
                    bad.append(r)
                    why.append(self._unp_detail(r, b, "%s is present but could not be parsed as a number" % r))
                    continue
                if r not in self.line_role_names:
                    continue
                i = next((i for i, m in enumerate(self.bound_lines) if (m.get(r) or {}).get("status") == "unparseable"), -1)
                if i >= 0:
                    lb = self.bound_lines[i].get(r)
                    bad.append(r)
                    why.append("line %d: %s" % (i, self._unp_detail(r, lb, "")) if lb and lb.get("unreadable") else "%s present but unparseable on line %d" % (r, i))
            if bad:
                return {"reason": "UNPARSEABLE", "detail": "; ".join(why), "missing": bad}
        for r in roles:
            L = self.bound_lists.get(r)
            if L is not None:
                j = next((i for i, e in enumerate(L["elems"]) if e["status"] == "unparseable"), -1)
                if j >= 0:
                    return {"reason": "UNPARSEABLE", "detail": "%s present but unparseable at %s" % (r, self._list_at(r, j)), "missing": [r]}
                continue
            b = self.bound_doc.get(r)
            if b and b["status"] == "unparseable":
                return {"reason": "UNPARSEABLE", "detail": "%s is present but could not be parsed as a number" % r, "missing": [r]}
        for r in roles:
            if r not in self.line_role_names:
                continue
            for i, m in enumerate(self.bound_lines):
                b = m.get(r)
                if b and b["status"] == "unparseable":
                    return {"reason": "UNPARSEABLE", "detail": "%s present but unparseable on line %d" % (r, i), "missing": [r]}
        for r in roles:
            L = self.bound_lists.get(r)
            if L is not None:
                if self.sum_role(r) is not None:
                    continue
                j = next((i for i, e in enumerate(L["elems"]) if e["status"] != "ok"), -1)
                sp = self.spec(r)
                each = _arr(_g(sp, "each")) if sp is not None else []
                return {"reason": "FIELD_MISSING", "detail": "%s: no element of %s was reported" % (r, " / ".join(each)) if not L["elems"] else "%s absent at %s" % (r, self._list_at(r, j)), "missing": [r]}
            if r in self.algo_roles:
                return {"reason": "FIELD_MISSING", "detail": "algorithm role %s was not computed" % r, "missing": [r]}
            if r in self.computed_formula and self.v040 and self.docVars.get(r) is None and self._computed_needs_why(r):
                return self._computed_why(r)
            if r in self.computed_formula:
                if self.docVars.get(r) is None:
                    return {"reason": "FIELD_MISSING", "detail": "computed %s could not be produced (an operand was absent)" % r, "missing": [r]}
                continue
            if r in self.line_role_names:
                if self.sum_role(r) is None:
                    return {"reason": "FIELD_MISSING", "detail": "%s absent on one or more lines" % r, "missing": [r]}
                continue
            b = self.bound_doc.get(r)
            if not b or b["status"] == "missing":
                return {"reason": "FIELD_MISSING", "detail": "%s not present on the document" % r, "missing": [r]}
        return None

    def _doc_evidence(self, roles):
        out, seen = [], set()

        def add(e):
            if e:
                k = _evidence_key(e)
                if k not in seen:
                    seen.add(k)
                    out.append(e)
        for r in roles:
            if r in self.bound_doc:
                add(field_evidence(r, self.bound_doc[r]))
            elif r in self.computed_formula and self.docVars.get(r) is not None:
                add({"locator": {"kind": "field", "source": "computed", "path": self.computed_formula[r]}, "value": J.round4(self.docVars[r]), "confidence": 100, "role": "CONTEXT"})
            for m in self.bound_lines:
                if r in m:
                    add(field_evidence(r, m[r]))
            L = self.bound_lists.get(r)
            if L is not None:
                for j, e in enumerate(L["elems"]):
                    if _is_defaulted(e) or "path" not in e:
                        add(field_evidence(r, e))
                    else:
                        e2 = dict(e)
                        e2["path"] = self._list_at(r, j, e["path"])
                        add(field_evidence(r, e2))
        return out

    def _doc_status(self, r):
        if r in self.bound_doc:
            return _status_of(self.bound_doc.get(r))
        if r in self.algo_roles:
            return "missing" if self.docVars.get(r) is None else "ok"
        if r in self.computed_formula:
            return "missing" if self.docVars.get(r) is None else "ok"
        L = self.bound_lists.get(r)
        if L is not None:
            if any(e["status"] == "unparseable" for e in L["elems"]):
                return "unparseable"
            return "missing" if self.sum_role(r) is None else "ok"
        sp = self.spec(r)
        lk = _g(sp, "kind") if sp is not None else UNDEF
        if self.v020 and r in self.line_role_names and lk in ("string", "identifier"):
            if any((m.get(r) or {}).get("status") == "ok" for m in self.bound_lines):
                return "ok"
            return "unparseable" if any((m.get(r) or {}).get("status") == "unparseable" for m in self.bound_lines) else "missing"
        if r in self.line_role_names:
            for m in self.bound_lines:
                if (m.get(r) or {}).get("status") == "unparseable":
                    return "unparseable"
            return "missing" if self.sum_role(r) is None else "ok"
        return "missing"

    def _doc_where(self, r):
        b = self.bound_doc.get(r)
        if b is not None and b.get("path") is not None:
            return b["path"]
        if r in self.computed_formula:
            return self.computed_formula[r]
        L = self.bound_lists.get(r)
        if L is not None and "key" in L:
            return L["key"]
        return None

    def _doc_amounts(self, roles):
        out, seen = [], set()

        def walk(r):
            if r in seen:
                return
            seen.add(r)
            f = self.spec(r)
            L = self.bound_lists.get(r)
            if f is not None and L is not None:
                if _is_amount_field(f):
                    for b in L["elems"]:
                        if b["status"] == "ok" and "value" in b and not _is_defaulted(b):
                            out.append(b["value"])
                return
            if f is not None and not J.truthy(_g(f, "line")):
                b = self.bound_doc.get(r)
                if _is_amount_field(f) and b and b["status"] == "ok" and "value" in b and not _is_defaulted(b):
                    out.append(b["value"])
                return
            if f is not None and J.truthy(_g(f, "line")):
                if _is_amount_field(f):
                    for m in self.bound_lines:
                        b = m.get(r)
                        if b and b["status"] == "ok" and "value" in b and not _is_defaulted(b):
                            out.append(b["value"])
                return
            formula = self.computed_formula.get(r)
            if formula is not None and self.docVars.get(r) is not None:
                for x in self._E_refs(formula):
                    walk(x)
        for r in roles:
            walk(r)
        return out

    def _line_scope(self, m):
        return Scope(lambda r: _status_of(m.get(r)), lambda r: (m.get(r) or {}).get("path"),
                     lambda roles: [m[r]["value"] for r in roles if _is_amount_field(self.spec(r)) and m.get(r) and m[r]["status"] == "ok" and "value" in m[r] and not _is_defaulted(m[r])])

    # ---- line scope --------------------------------------------------------------------------------------------------
    def _line_check(self, chk, i, m):
        line_vars = {r: (b.get("value") if b["status"] == "ok" else None) for r, b in m.items()}
        env = self._line_env_v040(i) if self.v040 else X.Env(line_vars, lambda r: None)
        l_scope = self._line_scope_v040(i) if self.v040 else self._line_scope(m)
        cmp_ = _g(chk, "compare")
        if cmp_ == "identifier":
            self._run_advisable(chk, lambda: self._run_identifier(chk, "line[%d]" % i, "line", lambda r: m.get(r), env, l_scope))
            return
        if cmp_ == "member":
            self._run_advisable(chk, lambda: self._run_member(chk, "line[%d]" % i, "line", lambda r: m.get(r), env, l_scope))
            return

        def missing(roles):
            if self.strict:
                bad = [r for r in roles if (m.get(r) or {}).get("status") == "unparseable"]
                if bad:
                    return {"reason": "UNPARSEABLE", "detail": "; ".join(self._unp_detail(r, m.get(r), "%s present but unparseable on line %d" % (r, i)) for r in bad), "missing": bad}
            for r in roles:
                b = m.get(r)
                if b and b["status"] == "unparseable":
                    return {"reason": "UNPARSEABLE", "detail": "%s present but unparseable on line %d" % (r, i), "missing": [r]}
            for r in roles:
                b = m.get(r)
                if not b or b["status"] == "missing":
                    return {"reason": "FIELD_MISSING", "detail": "%s not present on line %d" % (r, i), "missing": [r]}
            return None

        def ev(roles):
            out = []
            for r in roles:
                e = field_evidence(r, m.get(r) or {"status": "missing", "confidence": 0})
                if e:
                    out.append(e)
            return out
        self._run_advisable(chk, lambda: self._run_check(chk, env, "line[%d]" % i, self._line_evidence_v040(i, ev) if self.v040 else ev,
                                                         self._line_missing_v040(i, missing) if self.v040 else missing, l_scope, lambda r: m.get(r)))

    # ---- engine 0.4.0: claims over tables ----------------------------------------------------------------------------
    def _line_abs(self, i, rel=UNDEF):
        return "%s[%d]%s" % (self.line_key if self.line_key is not None else "line_items", i, ".%s" % rel if rel is not UNDEF and rel else "")

    def _line_value(self, j, role):
        b = self.bound_lines[j].get(role) if 0 <= j < len(self.bound_lines) else None
        return b.get("value") if b and b["status"] == "ok" else None

    def _line_env_v040(self, i, notes=None):
        m = self.bound_lines[i]
        vars_ = {r: (b.get("value") if b["status"] == "ok" else None) for r, b in m.items()}

        def ref(kind, role):
            if kind == "doc":
                return self.docVars.get(role)
            j = i - 1 if kind == "prev" else i + 1
            if j < 0 or j >= len(self.bound_lines):
                if notes is not None:
                    notes.append(self._no_neighbour_text("%s.%s" % (kind, role), i))
                return None
            return self._line_value(j, role)
        return X.Env(vars_, lambda r: None, agg=lambda *a: None, ref=ref, domain=(notes.append if notes is not None else None))

    def _row_role(self, j, role):
        b = self.bound_lines[j].get(role) if 0 <= j < len(self.bound_lines) else None
        st = _status_of(b)
        if st in ("ok", "defaulted") and "value" in b and math.isfinite(b["value"]):
            return {"status": "ok", "value": b["value"], "locs": [], "rows": [j]}
        if st == "unparseable":
            return {"status": "unparseable", "why": {"reason": "UNPARSEABLE", "detail": "line %d: %s" % (j, self._unp_detail(role, b, "%s present but unparseable on line %d" % (role, j))), "missing": [role]},
                    "locs": [{"role": role, "line": j}], "rows": [j]}
        if b and b.get("noValue") is not None:
            nv = b["noValue"]
            return {"status": "novalue", "why": {"reason": "OUT_OF_RULESET_SCOPE", "detail": "%s (%s on line %d reads it)" % (nv, role, j) if nv.startswith("no_neighbour:") else "%s has no value on line %d: %s" % (role, j, nv)},
                    "locs": [], "rows": [j]}
        return {"status": "missing", "why": {"reason": "FIELD_MISSING", "detail": "%s not present on line %d" % (role, j), "missing": [role]}, "locs": [{"role": role, "line": j}], "rows": [j]}

    def _resolve_doc_role(self, role):
        st = self.doc_scope.status(role)
        if st in ("ok", "defaulted") and self.docVars.get(role) is not None:
            return {"status": "ok", "value": self.docVars[role], "locs": [], "rows": []}
        why = self._doc_missing([role]) or {"reason": "FIELD_MISSING", "detail": "%s has no numeric value on the document" % role, "missing": [role]}
        status = "unparseable" if why["reason"] == "UNPARSEABLE" else ("novalue" if why["reason"] == "OUT_OF_RULESET_SCOPE" else "missing")
        return {"status": status, "why": why, "locs": [{"role": role}], "rows": []}

    def _locs_for_name(self, i, r):
        p = X.parse_operand_name(r)
        if not p:
            return [{"role": r, "line": i}] if i is not None and r in self.line_role_names else [{"role": r}]
        if p["kind"] == "doc":
            return [{"role": p["role"]}]
        if p["kind"] in ("prev", "next"):
            if i is None:
                return []
            j = i - 1 if p["kind"] == "prev" else i + 1
            return [] if j < 0 or j >= len(self.bound_lines) else [{"role": p["role"], "line": j}]
        return self._aggregate(p["fn"], p["role"], p.get("set"))["locs"]

    @staticmethod
    def _summ(xs):
        return "; ".join(xs) if len(xs) <= 3 else "%s; and %d more" % ("; ".join(xs[:3]), len(xs) - 3)

    def _collect(self, role, st, label):
        c = {"vals": [], "rows": [], "locs": [], "unp": [], "miss": [], "novalue": [], "missRoles": [role]}

        def early(status, reason, detail):
            why = {"reason": reason, "detail": "%s: %s" % (label, detail)}
            if reason != "OUT_OF_RULESET_SCOPE":
                why["missing"] = [role]
            out = dict(c)
            out["early"] = {"status": status, "why": why, "locs": [], "rows": []}
            return out
        L = self.bound_lists.get(role)
        if L is not None:
            if st is not None:
                return early("novalue", "OUT_OF_RULESET_SCOPE", "a row set selects line rows, and %s is a list field" % role)
            if "key" not in L:
                sp = self.spec(role)
                return early("missing", "FIELD_MISSING", "no element of %s was reported" % " / ".join(_arr(_g(sp, "each")) if sp is not None else []))
            for j, b in enumerate(L["elems"]):
                if self.v050 and _qc_excluded(b):
                    continue
                s = _status_of(b)
                if s in ("ok", "defaulted") and "value" in b and math.isfinite(b["value"]):
                    c["vals"].append(b["value"])
                    c["rows"].append(j)
                elif s == "unparseable":
                    c["unp"].append("%s: %s" % (self._list_at(role, j), self._unp_detail(role, b, "could not be read")))
                    c["locs"].append({"role": role, "elem": j})
                else:
                    c["miss"].append("%s absent at %s" % (role, self._list_at(role, j)))
                    c["locs"].append({"role": role, "elem": j})
            return c
        if role not in self.line_role_names:
            return early("novalue", "OUT_OF_RULESET_SCOPE", "%s is not a line field, a line-computed role or a list field" % role)
        if self.line_key is None:
            return early("missing", "FIELD_MISSING", "the line array (%s) is absent" % " / ".join(_arr(self.line_keys)))
        sets = _g(self.rs, "row_sets")
        sets = sets if isinstance(sets, dict) else {}
        conds = None if st is None else (sets[st] if st in sets else UNDEF)
        if st is not None and not isinstance(conds, list):
            return early("novalue", "OUT_OF_RULESET_SCOPE", "no row set named %s is declared" % st)
        for i in range(len(self.bound_lines)):
            if self.v050 and _qc_excluded(self.bound_lines[i].get(role)):
                continue
            if conds:
                m = self.bound_lines[i]
                ap = self._applicability(conds, self._line_env_v040(i), self._line_scope_v040(i), lambda r, m=m: m.get(r))
                if ap["applies"] is False:
                    continue
                if ap["applies"] == "unknown":
                    w = ap["why"]
                    target = c["unp"] if w["reason"] == "UNPARSEABLE" else (c["miss"] if w["reason"] == "FIELD_MISSING" else c["novalue"])
                    target.append("line %d: membership in %s is unknown (%s)" % (i, st, w["detail"]))
                    for r in w.get("missing") or []:
                        pr = X.parse_operand_name(r)
                        rr = pr["role"] if pr else r
                        if rr not in c["missRoles"]:
                            c["missRoles"].append(rr)
                        c["locs"].extend(self._locs_for_name(i, r))
                    continue
            one = self._row_role(i, role)
            if one["status"] == "ok":
                c["vals"].append(one["value"])
                c["rows"].append(i)
                continue
            (c["unp"] if one["status"] == "unparseable" else c["miss"] if one["status"] == "missing" else c["novalue"]).append(one["why"]["detail"])
            c["locs"].extend(one["locs"])
        return c

    def _unresolved_of(self, label, c):
        missing = list(c["missRoles"])
        if c["unp"]:
            return {"status": "unparseable", "why": {"reason": "UNPARSEABLE", "detail": "%s: %s" % (label, self._summ(c["unp"])), "missing": missing}, "locs": c["locs"], "rows": c["rows"]}
        if c["miss"]:
            return {"status": "missing", "why": {"reason": "FIELD_MISSING", "detail": "%s: %s" % (label, self._summ(c["miss"])), "missing": missing}, "locs": c["locs"], "rows": c["rows"]}
        if c["novalue"]:
            return {"status": "novalue", "why": {"reason": "OUT_OF_RULESET_SCOPE", "detail": "%s: %s" % (label, self._summ(c["novalue"]))}, "locs": c["locs"], "rows": c["rows"]}
        return None

    def _aggregate(self, fn, role, st=None):
        label = "%s(%s%s)" % (fn, role, ", %s" % st if st is not None else "")
        key = "%s(%s%s)" % (fn, role, ",%s" % st if st is not None else "")
        hit = self.agg_cache.get(key)
        if hit:
            return hit
        c = self._collect(role, st, label)
        if "early" in c:
            res = c["early"]
        else:
            bad = self._unresolved_of(label, c)
            if bad:
                res = bad
            elif fn == "count":
                res = {"status": "ok", "value": float(len(c["vals"])), "locs": c["locs"], "rows": c["rows"]}
            elif not c["vals"]:
                res = {"status": "missing", "why": {"reason": "FIELD_MISSING", "detail": "%s: no row %shas a value to aggregate" % (label, "of %s " % st if st is not None else ""), "missing": [role]},
                       "locs": c["locs"], "rows": c["rows"]}
            else:
                v = c["vals"]
                if fn == "sum":
                    acc = 0.0
                    for x in v:
                        acc += x
                    value = J.round4(acc)
                elif fn == "min":
                    m = v[0]
                    for x in v:
                        if x < m:
                            m = x
                    value = J.round9(m)
                elif fn == "max":
                    m = v[0]
                    for x in v:
                        if x > m:
                            m = x
                    value = J.round9(m)
                else:
                    s = sorted(v)
                    n = len(s)
                    value = J.round9(s[(n - 1) // 2] if n % 2 == 1 else (s[n // 2 - 1] + s[n // 2]) / 2)
                res = {"status": "ok", "value": value, "locs": c["locs"], "rows": c["rows"]} if math.isfinite(value) else \
                    {"status": "novalue", "why": {"reason": "OUT_OF_RULESET_SCOPE", "detail": "%s is not a finite number" % label}, "locs": c["locs"], "rows": c["rows"]}
        self.agg_cache[key] = res
        return res

    def _agg_value(self, fn, role, st=None):
        r = self._aggregate(fn, role, st)
        return r["value"] if r["status"] == "ok" else None

    def _resolve_line(self, i, name):
        p = X.parse_operand_name(name)
        if not p:
            return None
        if p["kind"] == "doc":
            return self._resolve_doc_role(p["role"])
        if p["kind"] in ("prev", "next"):
            j = i - 1 if p["kind"] == "prev" else i + 1
            if j < 0 or j >= len(self.bound_lines):
                return {"status": "no_neighbour", "why": {"reason": "OUT_OF_RULESET_SCOPE", "detail": self._no_neighbour_text(name, i)}, "locs": [], "rows": []}
            return self._row_role(j, p["role"])
        return {"status": "novalue", "why": {"reason": "OUT_OF_RULESET_SCOPE", "detail": "%s is read at document scope (an aggregate is not available per row)" % name}, "locs": [], "rows": []}

    def _resolve_doc(self, name):
        p = X.parse_operand_name(name)
        if p["kind"] == "agg":
            return self._aggregate(p["fn"], p["role"], p.get("set"))
        if p["kind"] == "doc":
            return self._resolve_doc_role(p["role"])
        return {"status": "novalue", "why": {"reason": "OUT_OF_RULESET_SCOPE", "detail": "%s is read on a row, not at document scope" % name}, "locs": [], "rows": []}

    @staticmethod
    def _scope_status_of(r):
        return r["status"] if r["status"] in ("ok", "unparseable", "no_neighbour") else "missing"

    def _line_scope_v040(self, i):
        m = self.bound_lines[i]
        base = self._line_scope(m)

        def status(r):
            res = self._resolve_line(i, r)
            return self._scope_status_of(res) if res else base.status(r)
        return Scope(status, lambda r: None if X.parse_operand_name(r) else base.where(r),
                     lambda roles: base.amounts([r for r in roles if not X.parse_operand_name(r)]),
                     {"prev": i > 0, "next": i < len(self.bound_lines) - 1})

    @staticmethod
    def _merge_unp(from_real, unp):
        detail = ([from_real["detail"]] if from_real and from_real["reason"] == "UNPARSEABLE" else []) + [u["why"]["detail"] for u in unp]
        missing = []
        for x in ((from_real.get("missing") or []) if from_real and from_real["reason"] == "UNPARSEABLE" else []) + [m for u in unp for m in (u["why"].get("missing") or [])]:
            if x not in missing:
                missing.append(x)
        return {"reason": "UNPARSEABLE", "detail": "; ".join(detail), "missing": missing}

    def _doc_missing_v040(self, roles):
        syn = [r for r in roles if X.parse_operand_name(r)]
        if not syn:
            return self._doc_missing(roles)
        real = [r for r in roles if not X.parse_operand_name(r)]
        res = [self._resolve_doc(r) for r in syn]
        from_real = self._doc_missing(real) if real else None
        unp = [r for r in res if r["status"] == "unparseable"]
        if unp or (from_real and from_real["reason"] == "UNPARSEABLE"):
            return self._merge_unp(from_real, unp)
        if from_real:
            return from_real
        hit = next((r for r in res if r["status"] == "missing"), None) or next((r for r in res if r["status"] != "ok"), None)
        return hit["why"] if hit else None

    def _line_missing_v040(self, i, orig):
        def f(roles):
            syn = [r for r in roles if X.parse_operand_name(r)]
            real = [r for r in roles if not X.parse_operand_name(r)]
            res = [self._resolve_line(i, r) for r in syn]
            nn = next((r for r in res if r["status"] == "no_neighbour"), None)
            if nn:
                return nn["why"]
            from_real = orig(real) if real else None
            if from_real and from_real["reason"] == "FIELD_MISSING":
                absent = [r for r in real if not self.bound_lines[i].get(r) or self.bound_lines[i][r]["status"] == "missing"]
                no_value = [r for r in absent if (self.bound_lines[i].get(r) or {}).get("noValue") is not None]
                if absent and len(no_value) == len(absent):
                    from_real = self._row_role(i, no_value[0])["why"]
            unp = [r for r in res if r["status"] == "unparseable"]
            if unp or (from_real and from_real["reason"] == "UNPARSEABLE"):
                return self._merge_unp(from_real, unp)
            if from_real:
                return from_real
            hit = next((r for r in res if r["status"] == "missing"), None) or next((r for r in res if r["status"] != "ok"), None)
            return hit["why"] if hit else None
        return f

    def _row_evidence(self, role, i):
        b = self.bound_lines[i].get(role) if 0 <= i < len(self.bound_lines) else None
        if not b or b["status"] != "ok":
            return None
        if (b.get("path") or "").startswith("line_computed("):
            return None if "value" not in b else {"locator": {"kind": "field", "source": "computed", "path": "%s.%s" % (self._line_abs(i), role)}, "value": b["value"], "confidence": 100, "role": "CONTEXT"}
        e = field_evidence(role, b)
        if e and not _is_defaulted(b) and b.get("path") is not None:
            e = dict(e)
            e["locator"] = {"kind": "field", "source": "invoice", "path": self._line_abs(i, b["path"])}
        return e

    def _list_evidence(self, role, j):
        L = self.bound_lists.get(role)
        b = L["elems"][j] if L and j < len(L["elems"]) else None
        if not b:
            return None
        if _is_defaulted(b) or "path" not in b:
            return field_evidence(role, b)
        b2 = dict(b)
        b2["path"] = self._list_at(role, j, b["path"])
        return field_evidence(role, b2)

    @staticmethod
    def _push_unique(out, e):
        if e and not any(_evidence_key(x) == _evidence_key(e) for x in out):
            out.append(e)

    def _doc_evidence_v040(self, roles):
        out = self._doc_evidence([r for r in roles if not X.parse_operand_name(r)])
        for r in roles:
            p = X.parse_operand_name(r)
            if not p or p["kind"] != "agg":
                continue
            res = self._aggregate(p["fn"], p["role"], p.get("set"))
            for j in res["rows"]:
                self._push_unique(out, self._list_evidence(p["role"], j) if p["role"] in self.bound_lists else self._row_evidence(p["role"], j))
        return out

    def _line_evidence_v040(self, i, orig):
        def f(roles):
            out = orig([r for r in roles if not X.parse_operand_name(r)])
            for r in roles:
                p = X.parse_operand_name(r)
                if not p:
                    continue
                if p["kind"] == "doc":
                    for e in self._doc_evidence([p["role"]]):
                        self._push_unique(out, e)
                elif p["kind"] in ("prev", "next"):
                    self._push_unique(out, self._row_evidence(p["role"], i - 1 if p["kind"] == "prev" else i + 1))
            return out
        return f

    def _late_line_computed(self):
        late = set()
        for role, f in J.entries(self.lc):
            try:
                refs = X.operand_refs(f)
            except X.ExprError:
                refs = []
            if any((r["kind"] == "doc" and (r["role"] in self.computed_formula or r["role"] in self.algo_roles)) or
                   (r["kind"] not in ("doc", "agg") and r["role"] in late) for r in refs):
                late.add(role)
        return late

    def _eval_line_computed(self, role, formula):
        try:
            refs = X.operand_refs(formula)
        except X.ExprError:
            refs = []
        for i, m in enumerate(self.bound_lines):
            def status_at(r):
                if r["kind"] == "doc":
                    return self.doc_scope_status(r["role"])
                if r["kind"] == "prev":
                    return _status_of(self.bound_lines[i - 1].get(r["role"])) if i > 0 else "no_neighbour"
                if r["kind"] == "next":
                    return _status_of(self.bound_lines[i + 1].get(r["role"])) if i < len(self.bound_lines) - 1 else "no_neighbour"
                return _status_of(m.get(r["role"]))
            unreadable = any(status_at(r) == "unparseable" for r in refs)
            notes = []
            try:
                value = None if unreadable else X.eval_expr_v040(formula, self._line_env_v040(i, notes))
            except X.ExprError:
                value = None
            if value is not None and math.isfinite(value):
                m[role] = {"status": "ok", "value": value, "path": "line_computed(%s)" % role, "confidence": 100}
            else:
                b = {"status": "unparseable" if unreadable else "missing", "confidence": 0}
                if not unreadable and notes:
                    b["noValue"] = notes[0]
                m[role] = b

    def doc_scope_status(self, r):
        return self._doc_status(r)

    def _computed_needs_why(self, role, seen=None):
        f = self.computed_formula.get(role)
        if f is None:
            return False
        if role in self.computed_notes:
            return True
        seen = seen if seen is not None else set()
        if role in seen:
            return False
        seen.add(role)
        try:
            return any(r["kind"] in ("agg", "doc") or r["role"] in self.algo_roles or (r["role"] in self.computed_formula and r["role"] != role and self._computed_needs_why(r["role"], seen))
                       for r in X.operand_refs(f))
        except X.ExprError:
            return False

    def _computed_why(self, role):
        f = self.computed_formula.get(role, "")

        def prefix(w):
            out = dict(w)
            out["detail"] = "computed %s could not be produced: %s" % (role, w["detail"])
            if w["reason"] != "OUT_OF_RULESET_SCOPE":
                out["missing"] = [role]
            return out
        try:
            refs = X.operand_refs(f)
        except X.ExprError:
            refs = []
        for r in refs:
            if r["kind"] == "agg":
                a = self._aggregate(r["fn"], r["role"], r.get("set"))
                if a["status"] != "ok":
                    return prefix(a["why"])
                continue
            if r["kind"] in ("doc", "prev", "next"):
                continue
            if r["optional"]:
                continue
            w = self._doc_missing([r["role"]])
            if w:
                return prefix(w)
        note = self.computed_notes.get(role)
        if note is not None:
            return {"reason": "OUT_OF_RULESET_SCOPE", "detail": "computed %s has no value: %s" % (role, note)}
        return {"reason": "FIELD_MISSING", "detail": "computed %s could not be produced (an operand was absent)" % role, "missing": [role]}

    def _check_exprs(self, chk):
        out = [chk.get("left"), chk.get("right")]
        for a in _nn(_g(chk, "alternatives"), []):
            out += [_g(a, "left"), _g(a, "right")]
        for g in _nn(_g(chk, "abstain_if"), []):
            out += [_g(g, "left"), _g(g, "right")]
        for g in _nn(_g(chk, "applies_if"), []):
            if isinstance(g, dict) and "left" in g:
                out += [g.get("left"), g.get("right")]
        return [e for e in out if isinstance(e, str)]

    def _claim_locs_v040(self, c):
        cc = self.claim_check.get(id(c))
        if not cc or c["outcome"] != "INSUFFICIENT_DATA" or _g(cc["chk"], "compare") in ("identifier", "member"):
            return None
        try:
            refs = [r for e in self._check_exprs(cc["chk"]) for r in X.operand_refs(e)]
        except X.ExprError:
            return None
        if not any(r["kind"] in ("doc", "prev", "next", "agg") or r["role"] in self.algo_roles or (r["role"] in self.computed_formula and self._computed_needs_why(r["role"])) for r in refs):
            return None
        out = []
        line = cc.get("line")
        for r in refs:
            if r["kind"] in ("role", "sum"):
                if r["role"] in self.algo_roles:
                    pass
                else:
                    out.append({"role": r["role"], "line": line} if line is not None and r["role"] in self.line_role_names and r["kind"] == "role" else {"role": r["role"]})
            else:
                out.extend(self._locs_for_name(line, r["name"]))
        return out

    def _operand_at_v040(self, c, role):
        locs = self._claim_locs_v040(c)
        if not locs:
            return None
        return next((l for l in locs if l["role"] == role and (l.get("line") is not None or l.get("elem") is not None)), None)

    # ---- the remedies' readers ---------------------------------------------------------------------------------------
    def _path_of_role(self, role, c):
        at = self._operand_at_v040(c, role) if self.v040 else None
        if at and at.get("line") is not None:
            b = self.bound_lines[at["line"]].get(role) if at["line"] < len(self.bound_lines) else None
            p = (b or {}).get("badPath")
            return None if p is None else self._line_abs(at["line"], p)
        if at and at.get("elem") is not None:
            L = self.bound_lists.get(role)
            e = L["elems"][at["elem"]] if L and at["elem"] < len(L["elems"]) else None
            return None if not e or e.get("badPath") is None else self._list_at(role, at["elem"], e["badPath"])
        li = re.match(r"line\[([0-9]+)\]\.", c["claim_id"])
        if li:
            i = int(li.group(1))
            b = self.bound_lines[i].get(role) if i < len(self.bound_lines) else None
            p = (b or {}).get("badPath")
            return None if p is None else "%s[%s].%s" % (self.line_key if self.line_key is not None else "line_items", li.group(1), p)
        L = self.bound_lists.get(role)
        if L is not None:
            j = next((i for i, e in enumerate(L["elems"]) if e["status"] == "unparseable"), -1)
            return None if j < 0 else self._list_at(role, j, L["elems"][j].get("badPath", UNDEF))
        return (self.bound_doc.get(role) or {}).get("badPath")

    def _operand_info(self, role, c):
        f = self.spec(role)
        if f is None:
            return None
        at = self._operand_at_v040(c, role) if self.v040 else None
        li = re.match(r"line\[([0-9]+)\]\.", c["claim_id"])
        line_idx = at["line"] if at and at.get("line") is not None else (int(li.group(1)) if li else None)
        L = self.bound_lists.get(role)
        j = at["elem"] if at and at.get("elem") is not None else (next((i for i, e in enumerate(L["elems"]) if e["status"] == "unparseable"), -1) if L is not None else -1)
        if line_idx is not None:
            b = self.bound_lines[line_idx].get(role) if line_idx < len(self.bound_lines) else None
        elif L is not None:
            b = L["elems"][j] if j >= 0 else None
        else:
            b = self.bound_doc.get(role)
        u_all = (b or {}).get("unreadable") or {}
        paths = _g(f, "paths")
        rel = u_all["path"] if "path" in u_all else (paths[0] if isinstance(paths, list) and paths else UNDEF)
        if rel is UNDEF:
            path = UNDEF
        elif line_idx is not None:
            path = "%s[%d].%s" % (self.line_key if self.line_key is not None else "line_items", line_idx, rel)
        elif L is not None:
            path = self._list_at(role, max(j, 0), rel)
        else:
            path = rel
        u = b.get("unreadable") if (b and b["status"] == "unparseable") else None
        out = {}
        if path is not UNDEF:
            out["path"] = path
        term = _g(f, "term")
        if term is not UNDEF:
            out["term"] = term
        if u:
            kind = _g(f, "kind")
            kk = None if kind is UNDEF else kind
            ur = {}
            if "raw" in u:
                ur["value"] = u["raw"]
            if "at" in u:
                ur["at"] = N.render_at(u["at"])
            note = self._strict_note(u, kk)
            if note is not None:
                ur["note"] = note
            if self.v030 and (u["how"] in ("withdrawn", "unsupported", "conflict") or (self.v050 and u["how"] in ("qc_held", "qc_struck"))):
                ur["struck"] = u["how"]
                if "detail" in u:
                    ur["why"] = u["detail"]
            out["unreadable"] = ur
        return out

    # ---- the tolerance policy ----------------------------------------------------------------------------------------
    @staticmethod
    def _apply_tolerance_policy(claims, policy):
        """tolerance.ts applyTolerancePolicy"""
        rel = policy["rel"]
        if rel <= 0:
            return
        rc = policy.get("roundingCap") if isinstance(policy, dict) else None
        grain = _document_grain(claims) if rc else 0.0
        lines = _line_count(claims) if (rc and rc.get("perLine")) else 0
        for c in claims:
            comp = c.get("computation")
            if not isinstance(comp, dict) or not J.is_num(comp.get("result", UNDEF)):
                continue
            tol = comp.get("tolerance")
            abs_floor = tol["abs"] if isinstance(tol, dict) and tol.get("abs") is not None else 0.01
            comp["tolerance"] = {"abs": abs_floor, "rel": rel}
            if c["outcome"] != "FAIL" or not J.is_num(c.get("variance", UNDEF)):
                continue
            cap = policy["absCap"] if policy["absCap"] > 0 else math.inf
            if not rc:
                eff = max(abs_floor, min(rel * abs(comp["result"]), cap))
                if abs(c["variance"]) <= eff + 1e-9:
                    c["outcome"] = "PASS"
                    c["locked"] = False
                    c["explanation"] = "Within tolerance (|variance| %s ≤ %s = min(%s%% of %s, cap $%s), floor $%s): treated as rounding, not error. %s" % (
                        _num(J.round4(abs(c["variance"]))), _num(J.round4(eff)), _num(J.round4(rel * 100)), _num(comp["result"]), _num(policy["absCap"]), _num(abs_floor), c["explanation"])
                continue
            rel_band = min(rel * abs(comp["result"]), cap)
            k = _rounding_steps(c) + (lines if c["rule_id"] in (rc.get("perLine") or []) else 0)
            step = _cash_step_of(c.get("asserted", UNDEF), grain) if c["rule_id"] in (rc.get("cashStep") or []) else 0.0
            round_cap = J.round4(grain * k + step / 2)
            eff = max(abs_floor, min(rel_band, round_cap))
            v = J.round4(abs(c["variance"]))
            cap_text = "rounding cap %s × %d step%s%s = %s%s" % (_num(grain), k, "" if k == 1 else "s", " + half a cash step of %s" % _num(step) if step > 0 else "",
                                                             _num(round_cap), ", cap %s" % _num(policy["absCap"]) if policy["absCap"] > 0 else "")
            if abs(c["variance"]) <= eff + 1e-9:
                c["outcome"] = "PASS"
                c["locked"] = False
                c["explanation"] = "Within tolerance (|variance| %s ≤ %s = min(%s%% of %s, %s), floor %s): treated as rounding, not error. %s" % (
                    _num(v), _num(J.round4(eff)), _num(J.round4(rel * 100)), _num(comp["result"]), cap_text, _num(abs_floor), c["explanation"])
            elif abs(c["variance"]) <= max(abs_floor, rel_band) + 1e-9:
                c["explanation"] = "%s Not treated as rounding: |variance| %s is within %s%% of %s but above the %s (the most rounding can produce on this claim)." % (
                    c["explanation"], _num(v), _num(J.round4(rel * 100)), _num(comp["result"]), cap_text)

    # ---- HELD-SUSPECT (engine 0.2.0 only) ----------------------------------------------------------------------------
    def _read_value(self, t, kind):
        r = N.read_number_text_v020(t, self.locale)
        n = norm_by_kind(kind, r["canonical"]) if r else None
        return n["value"] if n else None

    def _one_away(self, raw, kind):
        cs = list(raw)
        if len(cs) > SUSPECT_MAX_RAW:
            return []
        seen, out = set(), []

        def try_text(t):
            if t == raw:
                return
            v = self._read_value(t, kind)
            if v is None or v in seen:
                return
            seen.add(v)
            out.append({"text": t, "value": v})
        for i in range(len(cs)):
            try_text("".join(cs[:i]) + "".join(cs[i + 1:]))
        for i in range(len(cs)):
            for a in SUSPECT_ALPHABET:
                try_text("".join(cs[:i]) + a + "".join(cs[i + 1:]))
        for i in range(len(cs) + 1):
            for a in SUSPECT_ALPHABET:
                try_text("".join(cs[:i]) + a + "".join(cs[i:]))
        return out

    def _nested_options(self):
        o = dict(self.options)
        o.pop("declared_accuracy", None)
        return o

    def _held_suspect(self):
        lk = self.line_key if self.line_key is not None else "line_items"

        def raw_at(path):
            v = get_path(self.extraction, path)
            return v if isinstance(v, str) else None

        def unreadable_loc(role, b, absf):
            u = b.get("unreadable") if (b and b["status"] == "unparseable") else None
            if not u or u["how"] != "unparseable" or "path" not in u:
                return None
            path = absf(u["path"])
            raw = raw_at(path)
            sp = self.spec(role)
            return None if raw is None else {"role": role, "path": path, "raw": raw, "kind": _g(sp, "kind") if sp is not None else UNDEF}

        def locs_of(c):
            missing = (c.get("insufficiency") or {}).get("missing") or []
            if not missing:
                return None
            li = re.match(r"line\[([0-9]+)\]\.", c["claim_id"])
            out = []
            for r in missing:
                f = self.spec(r)
                if f is None or not _numeric_kind(_g(f, "kind")):
                    return None
                if li:
                    n = int(li.group(1))
                    loc = unreadable_loc(r, self.bound_lines[n].get(r) if n < len(self.bound_lines) else None, lambda rel, n=n: "%s[%d].%s" % (lk, n, rel))
                    if not loc:
                        return None
                    out.append(loc)
                    continue
                L = self.bound_lists.get(r)
                if L is not None:
                    for j, e in enumerate(L["elems"]):
                        if e["status"] == "ok":
                            continue
                        loc = unreadable_loc(r, e, lambda rel, j=j, r=r: self._list_at(r, j, rel))
                        if not loc:
                            return None
                        out.append(loc)
                    continue
                if J.truthy(_g(f, "line")):
                    for i, m in enumerate(self.bound_lines):
                        b = m.get(r)
                        if b and b["status"] == "ok":
                            continue
                        loc = unreadable_loc(r, b, lambda rel, i=i: "%s[%d].%s" % (lk, i, rel))
                        if not loc:
                            return None
                        out.append(loc)
                    continue
                loc = unreadable_loc(r, self.bound_doc.get(r), lambda rel: rel)
                if not loc:
                    return None
                out.append(loc)
            return out if out else None
        groups, order = {}, []
        for c in self.claims:
            if c["outcome"] != "INSUFFICIENT_DATA" or (c.get("insufficiency") or {}).get("reason") != "UNPARSEABLE":
                continue
            if not c["claim_id"].startswith("document.") and not c["claim_id"].startswith("line["):
                continue
            locs = locs_of(c)
            if not locs:
                continue
            key = "\u0000".join(l["path"] for l in locs)
            if key not in groups:
                groups[key] = {"locs": locs, "claims": []}
                order.append(key)
            groups[key]["claims"].append(c)
        budget = SUSPECT_BUDGET
        nested_opts = self._nested_options()
        for key in order:
            g = groups[key]
            readings = [self._one_away(l["raw"], l["kind"]) for l in g["locs"]]
            total = 1
            for r in readings:
                total *= len(r)
            if total == 0 or total > SUSPECT_MAX_COMBOS or total > budget:
                continue
            budget -= total
            stats = {}
            combo = []

            def walk(k):
                if k == len(readings):
                    patched = J.clone(self.input)
                    for i, r in enumerate(combo):
                        set_path(patched, g["locs"][i]["path"], r["text"])
                    try:
                        nv = _Run(patched, self.rs, nested_opts, True).verdict()
                    except Exception:
                        return
                    for c in g["claims"]:
                        st = stats.setdefault(id(c), {"failing": 0})
                        nc = next((x for x in nv["claims"] if x["claim_id"] == c["claim_id"]), None)
                        if nc is not None and nc["outcome"] == "FAIL":
                            st["failing"] += 1
                            if "first" not in st:
                                st["first"] = {"combo": list(combo), "nc": nc}
                    return
                for r in readings[k]:
                    combo.append(r)
                    walk(k + 1)
                    combo.pop()
            walk(0)
            for c in g["claims"]:
                st = stats.get(id(c))
                if not st or "first" not in st:
                    continue
                first, nc = st["first"]["combo"], st["first"]["nc"]
                comp = nc.get("computation") if isinstance(nc.get("computation"), dict) else {}
                ops = comp.get("operands") if isinstance(comp.get("operands"), dict) else {}
                left = ops.get("left", None)
                right = ops.get("right", None)
                c["suspect"] = {"reported": [{"role": l["role"], "path": l["path"], "raw": l["raw"]} for l in g["locs"]],
                                "reading": [{"role": l["role"], "path": l["path"], "read_as": first[i]["text"], "value": first[i]["value"]} for i, l in enumerate(g["locs"])],
                                "computed": {"left": left, "right": right}, "readings_checked": total, "readings_failing": st["failing"]}
                as_ = ", ".join("%s %s as %s" % (l["role"], J.js_string(l["raw"]), J.js_string(first[i]["text"])) for i, l in enumerate(g["locs"]))
                why = "held as suspect: read one character differently (%s), %s gives %s against %s, which does not hold; %d of %d such readings fail it. The gate books it as a FAIL until a legible value is supplied" % (
                    as_, comp.get("formula") if comp.get("formula") is not None else c["rule_id"], J.js_str(left), J.js_str(right), st["failing"], total)
                ins = dict(c["insufficiency"])
                ins["detail"] = "%s; %s" % (c["insufficiency"]["detail"], why)
                c["insufficiency"] = ins
                c["explanation"] = "%s Held as suspect: a one-character reading of the unreadable value fails the check." % c["explanation"]

    # ---- engine 0.3.0: strike and recompute --------------------------------------------------------------------------
    def _v030_blocks(self):
        lk = self.line_key if self.line_key is not None else "line_items"

        def loc_of(role, b, line=None, elem=None):
            if not b or b["status"] != "unparseable":
                return None
            u = b.get("unreadable") or {}
            rel = u["path"] if "path" in u else b.get("badPath", UNDEF)
            if rel is UNDEF or rel == "":
                path = UNDEF
            elif line is not None:
                path = "%s[%d].%s" % (lk, line, rel)
            elif elem is not None:
                path = self._list_at(role, elem, rel)
            else:
                path = rel
            fld = "%s@line[%d]" % (role, line) if line is not None else ("%s[%d]" % (role, elem) if elem is not None else role)
            l = {"key": path if path is not UNDEF else "label:%s" % fld, "field": fld, "role": role, "b": b}
            if path is not UNDEF:
                l["path"] = path
            if line is not None:
                l["line"] = line
            if elem is not None:
                l["elem"] = elem
            return l

        def refs_of(formula):
            try:
                return self._E_refs(formula)
            except X.ExprError:
                return []

        def expand(role, line, seen=None):
            seen = seen if seen is not None else set()
            k = "%s@%s" % (role, "" if line is None else line)
            if k in seen:
                return []
            seen.add(k)
            if self.v040:
                def near(x):
                    return [l for l in expand(x["role"], x.get("line"), seen) if x.get("elem") is None or l.get("elem") is None or l.get("elem") == x.get("elem")]
                p = X.parse_operand_name(role)
                if p and p["kind"] == "doc":
                    return expand(p["role"], None, seen)
                if p and p["kind"] in ("prev", "next"):
                    if line is None:
                        return []
                    j = line - 1 if p["kind"] == "prev" else line + 1
                    return [] if j < 0 or j >= len(self.bound_lines) else expand(p["role"], j, seen)
                if p and p["kind"] == "agg":
                    return [l for x in self._aggregate(p["fn"], p["role"], p.get("set"))["locs"] for l in near(x)]
            L = self.bound_lists.get(role)
            if L is not None:
                return [l for l in (loc_of(role, e, None, j) for j, e in enumerate(L["elems"])) if l]
            if line is not None:
                b = self.bound_lines[line].get(role) if line < len(self.bound_lines) else None
                l = loc_of(role, b, line)
                if l and b and b.get("unreadable"):
                    return [l]
                f = self.lc.get(role) if isinstance(self.lc, dict) and role in self.lc else None
                return [x for r in refs_of(f) for x in expand(r, line, seen)] if f is not None else ([l] if l else [])
            if role in self.bound_doc:
                l = loc_of(role, self.bound_doc.get(role))
                return [l] if l else []
            cf = self.computed_formula.get(role)
            if cf is not None:
                return [x for r in refs_of(cf) for x in expand(r, None, seen)]
            if role in self.line_role_names:
                return [x for i in range(len(self.bound_lines)) for x in expand(role, i, set(seen))]
            return []
        locs, waits, claim_locs, order = {}, {}, [], []
        for c in self.claims:
            ins = c.get("insufficiency") or {}
            if c["outcome"] != "INSUFFICIENT_DATA" or not ins.get("missing"):
                continue
            if not c["claim_id"].startswith("document.") and not c["claim_id"].startswith("line["):
                continue
            li = re.match(r"line\[([0-9]+)\]\.", c["claim_id"])
            mine = {}
            ov = self._claim_locs_v040(c) if self.v040 else None
            if ov:
                for x in ov:
                    for l in expand(x["role"], x.get("line")):
                        if x.get("elem") is None or l.get("elem") is None or l.get("elem") == x.get("elem"):
                            mine[l["key"]] = l
            else:
                for r in ins["missing"]:
                    for l in expand(r, int(li.group(1)) if li else None):
                        mine[l["key"]] = l
            if not mine:
                continue
            claim_locs.append((c, list(mine.values())))
            for l in mine.values():
                if l["key"] not in locs:
                    locs[l["key"]] = l
                    order.append(l["key"])
                w = waits.setdefault(l["key"], [])
                if c["claim_id"] not in w:
                    w.append(c["claim_id"])
        suspect_of = {}
        if _g(self.rs, "held_suspect") is not False:
            def candidates_of(l):
                sp = self.spec(l["role"])
                kind = _g(sp, "kind") if sp is not None else UNDEF
                if not _numeric_kind(kind) or "path" not in l:
                    return None
                u = l["b"].get("unreadable") or {}
                if (u.get("how")) != "unparseable":
                    return None
                raw = get_path(self.input, l["path"])
                if not isinstance(raw, str):
                    return None
                return {"at": l["path"], "cands": [{"text": x["text"], "value": x["value"], "write": x["text"]} for x in self._one_away(raw, kind)]}
            cand = {k: candidates_of(locs[k]) for k in order}
            groups, gorder = {}, []
            for c, ls in claim_locs:
                if any(not (cand.get(l["key"]) and cand[l["key"]]["cands"]) for l in ls):
                    continue
                key = "\u0000".join(sorted((l["key"] for l in ls), key=_utf16_key))
                if key not in groups:
                    groups[key] = {"locs": sorted(ls, key=lambda l: _utf16_key(l["key"])), "claims": []}
                    gorder.append(key)
                groups[key]["claims"].append(c)
            budget = SUSPECT_BUDGET
            nested_opts = self._nested_options()
            tally, torder = {}, []
            for key in gorder:
                g = groups[key]
                lists = [cand[l["key"]]["cands"] for l in g["locs"]]
                total = 1
                for r in lists:
                    total *= len(r)
                if total == 0 or total > SUSPECT_MAX_COMBOS or total > budget:
                    continue
                budget -= total
                combo = []

                def walk(k, g=g, lists=lists):
                    if k == len(lists):
                        patched = J.clone(self.input)
                        for i, r in enumerate(combo):
                            set_path(patched, cand[g["locs"][i]["key"]]["at"], r["write"])
                        try:
                            nv = _Run(patched, self.rs, nested_opts, True).verdict()
                        except Exception:
                            return
                        failed = [c["claim_id"] for c in g["claims"] if (next((x for x in nv["claims"] if x["claim_id"] == c["claim_id"]), {}) or {}).get("outcome") == "FAIL"]
                        for i, r in enumerate(combo):
                            key2 = g["locs"][i]["key"]
                            if key2 not in tally:
                                tally[key2] = {"all": [], "failing": {}, "forder": []}
                                torder.append(key2)
                            t = tally[key2]
                            if r["text"] not in t["all"]:
                                t["all"].append(r["text"])
                            if failed:
                                if r["text"] not in t["failing"]:
                                    t["failing"][r["text"]] = {"value": r["value"], "fails": []}
                                    t["forder"].append(r["text"])
                                fl = t["failing"][r["text"]]["fails"]
                                for idd in failed:
                                    if idd not in fl:
                                        fl.append(idd)
                        return
                    for r in lists[k]:
                        combo.append(r)
                        walk(k + 1)
                        combo.pop()
                walk(0)
            for key in torder:
                t = tally[key]
                if not t["failing"]:
                    continue
                shown_ = [{"read_as": ra, "value": t["failing"][ra]["value"], "fails": list(t["failing"][ra]["fails"])} for ra in t["forder"][:5]]
                suspect_of[key] = {"checked": len(t["all"]), "failing": len(t["failing"]), "passing": len(t["all"]) - len(t["failing"]), "shown": shown_}
        struck, would_unlock = [], []
        by_reason = {"unreadable": 0, "suspect": 0, "withdrawn": 0, "unsupported-assertion": 0, "conflict": 0, "qc_held": 0, "qc_struck": 0}
        for key in order:
            l = locs[key]
            u = l["b"].get("unreadable") or {}
            sus = suspect_of.get(key)
            how = u.get("how")
            reason = "withdrawn" if how == "withdrawn" else "unsupported-assertion" if how == "unsupported" else "conflict" if how == "conflict" else \
                "qc_held" if how == "qc_held" else "qc_struck" if how == "qc_struck" else ("suspect" if sus else "unreadable")
            by_reason[reason] += 1
            prov = {}
            if "raw" in u:
                prov["raw"] = u["raw"]
            if "at" in u:
                prov["at"] = N.render_at(u["at"])
            prov["tier"] = "unstated"
            sp = self.spec(l["role"])
            kind = _g(sp, "kind") if sp is not None else UNDEF
            kk = None if kind is UNDEF else kind
            detail = N.describe_unreadable(l["role"], u, kk, self._strict_note(u, kk)) if u else "%s could not be read" % l["role"]
            s = {"field": l["field"], "role": l["role"]}
            if "path" in l:
                s["path"] = l["path"]
            s.update(reason=reason, provenance=prov, detail=detail)
            if sus and reason == "suspect":
                s["candidates"] = sus
            struck.append(s)
            would_unlock.append({"field": l["field"], "claims": waits.get(key, [])})

        def value_tiers(role, line, seen=None):
            seen = seen if seen is not None else set()
            k = "%s@%s" % (role, "" if line is None else line)
            if k in seen:
                return []
            seen.add(k)

            def ok_path(b):
                return b["path"] if (b and b["status"] == "ok" and not _is_defaulted(b) and b.get("path") is not None and not b["path"].startswith("line_computed(")) else None
            if self.v040:
                p = X.parse_operand_name(role)
                if p and p["kind"] == "doc":
                    return value_tiers(p["role"], None, seen)
                if p and p["kind"] in ("prev", "next"):
                    if line is None:
                        return []
                    j = line - 1 if p["kind"] == "prev" else line + 1
                    return [] if j < 0 or j >= len(self.bound_lines) else value_tiers(p["role"], j, seen)
                if p and p["kind"] == "agg":
                    res = self._aggregate(p["fn"], p["role"], p.get("set"))
                    Lp = self.bound_lists.get(p["role"])
                    if Lp is not None:
                        return ["unstated" for j in res["rows"] if ok_path(Lp["elems"][j]) is not None]
                    return [t for i in res["rows"] for t in value_tiers(p["role"], i, set(seen))]
            L = self.bound_lists.get(role)
            if L is not None:
                return ["unstated" for e in L["elems"] if ok_path(e) is not None]
            if line is not None:
                f = self.lc.get(role) if isinstance(self.lc, dict) and role in self.lc else None
                if f is not None:
                    return [t for r in refs_of(f) for t in value_tiers(r, line, seen)]
                p2 = ok_path(self.bound_lines[line].get(role) if line < len(self.bound_lines) else None)
                return [] if p2 is None else ["unstated"]
            if role in self.bound_doc:
                return [] if ok_path(self.bound_doc.get(role)) is None else ["unstated"]
            cf = self.computed_formula.get(role)
            if cf is not None:
                return [t for r in refs_of(cf) for t in value_tiers(r, None, seen)]
            if role in self.line_role_names:
                return [t for i in range(len(self.bound_lines)) for t in value_tiers(role, i, set(seen))]
            return []
        tiers = []
        for _, (c, r) in self.rests_on.items():
            if c["outcome"] in ("PASS", "FAIL"):
                for role in r["roles"]:
                    tiers.extend(value_tiers(role, r.get("line")))
        passed = [c["claim_id"] for c in self.claims if c["outcome"] == "PASS"]
        failed = [c["claim_id"] for c in self.claims if c["outcome"] == "FAIL"]
        waiting = set(x for w in would_unlock for x in w["claims"])
        counts = {"checks_computed": len(passed) + len(failed), "checks_pass": len(passed), "checks_fail": len(failed), "checks_struck": len(waiting),
                  "fields_struck": len(struck), "unreadable": by_reason["unreadable"], "suspect": by_reason["suspect"], "withdrawn": by_reason["withdrawn"],
                  "unsupported_assertion": by_reason["unsupported-assertion"], "conflict": by_reason["conflict"], "findings": len(self.findings)}
        if self.v050:
            counts.update(choices_load_bearing=self.ledger["load_bearing"], choices_stated=self.ledger["stated"], stated_rate=self.ledger["stated_rate"],
                          qc_held=by_reason["qc_held"], qc_struck=by_reason["qc_struck"], beyond_data=self.beyond_data)
        blocks = {"computed": {"pass": passed, "fail": failed}, "struck": struck, "would_unlock": would_unlock, "counts": counts,
                  "evidence_floor": "none" if not tiers else "unstated"}
        if self.findings:
            blocks["findings"] = self.findings
        if self.support:
            blocks["support"] = self.support
        return blocks


def _utf16_key(s):
    return s.encode("utf-16-be", "surrogatepass")


def _document_grain(claims):
    any_ = False
    for c in claims:
        a = c.get("asserted", UNDEF)
        if c["kind"] != "RECOMPUTE" or not J.is_num(a) or not math.isfinite(a):
            continue
        any_ = True
        if abs(a - J.math_round(a)) > 1e-9:
            return 0.01
    return 1.0 if any_ else 0.01


def _rounding_steps(claim):
    k = 0
    for e in claim["evidence"]:
        loc = e["locator"]
        if loc["kind"] == "field" and loc["source"] != "computed" and J.is_num(e["value"]):
            k += 1
    return k


def _cash_step_of(stated, grain):
    if not J.is_num(stated) or not math.isfinite(stated):
        return 0.0
    for m in (100, 50, 10, 5):
        s = m * grain
        q = stated / s
        if abs(q - J.math_round(q)) < 1e-9:
            return J.round4(s)
    return 0.0


def _line_count(claims):
    lines = set()
    for c in claims:
        m = re.match(r"line\[([0-9]+)\]\.", c["claim_id"])
        if m:
            lines.add(m.group(1))
    return len(lines)


# ---------------------------------------------------------------------------------------------------------------------
# The identity: input_hash, the remedy table, the scope block and gate_status

def ruleset_identity(rs):
    """declarative/types.ts rulesetIdentity: every check's and quote's `remedy` removed (algorithms are refused upstream)."""
    def has_remedy(x):
        return isinstance(x, dict) and "remedy" in x
    checks_carry = isinstance(rs.get("checks"), list) and any(has_remedy(c) for c in rs["checks"])
    quotes_carry = isinstance(rs.get("quotes"), list) and any(has_remedy(c) for c in rs["quotes"])
    if not checks_carry and not quotes_carry:
        return rs

    def strip(c):
        if not has_remedy(c):
            return c
        return {k: v for k, v in c.items() if k != "remedy"}
    out = dict(rs)
    if checks_carry:
        out["checks"] = [strip(c) for c in rs["checks"]]
    if quotes_carry:
        out["quotes"] = [strip(c) for c in rs["quotes"]]
    return out


def tolerance_identity(t):
    out = {"rel": t.get("rel", UNDEF), "absCap": t.get("absCap", UNDEF)}
    if t.get("rounding", UNDEF) is not UNDEF:
        out["rounding"] = t["rounding"]
    if t.get("roundingCap", UNDEF) is not UNDEF:
        rc = t["roundingCap"]

        def lst(x):
            return list(x) if isinstance(x, list) else ([] if x is UNDEF else x)
        out["roundingCap"] = {"perLine": lst(rc.get("perLine", UNDEF)), "cashStep": lst(rc.get("cashStep", UNDEF))}
    return {k: v for k, v in out.items() if v is not UNDEF}


def declarative_inputs(extraction, ruleset, options):
    """protocol/inputs.ts verifyInputs for a declarative ruleset: { extraction, ruleset, tolerance?, source? }"""
    inputs = {"extraction": extraction, "ruleset": ruleset}
    if options.get("tolerance", UNDEF) is not UNDEF and options.get("tolerance") is not None:
        inputs["tolerance"] = tolerance_identity(options["tolerance"])
    if options.get("source", UNDEF) is not UNDEF:
        inputs["source"] = options["source"]
    return inputs


def input_hash_of(extraction, ruleset, options):
    inputs = declarative_inputs(extraction, ruleset, options)
    inputs["ruleset"] = ruleset_identity(ruleset)
    return J.hash_of(inputs)


def remedy_table_of(rs):
    checks, seen = {}, set()
    for c in _arr(rs.get("checks")):
        if not c or not isinstance(c.get("code"), str) or c["code"] in seen:
            continue
        seen.add(c["code"])
        d = RM.normalize_declaration(c.get("remedy", UNDEF))
        if d:
            checks[c["code"]] = d
    quotes = {}
    for q in _arr(rs.get("quotes")):
        if not q or not isinstance(q.get("id"), str):
            continue
        d = RM.normalize_declaration(q.get("remedy", UNDEF))
        if d:
            quotes[q["id"] if q["id"].startswith("source.") else "source.%s" % q["id"]] = d
    return {"checks": checks, "quotes": quotes}


def remedy_table_hash(rs):
    return J.hash_of(remedy_table_of(rs))


SCOPE_STATEMENTS = ["advisories are counsel, not verdicts", "this is a check, not a decision"]


def recorded_gate_status(v):
    """verdict/aggregation.ts recordedGateStatus"""
    held = [c for c in v["claims"] if c["outcome"] == "INSUFFICIENT_DATA" and c.get("tier") != "REASONED" and "suspect" in c]
    if v["outcome"] == "FAIL" or held:
        s = "FAIL"
    elif v["outcome"] != "PASS":
        s = v["outcome"]
    else:
        s = "PASS-WITH-OPEN" if any(c["outcome"] == "INSUFFICIENT_DATA" and c.get("tier") != "REASONED" for c in v["claims"]) else "PASS"
    if s == "PASS-WITH-OPEN":
        return "PASS_WITH_OPEN"
    if s == "PASS" and any(len(w["claims"]) > 0 for w in v.get("would_unlock") or []):
        return "PASS_WITH_OPEN"
    return s


def attach_scope(v):
    """verdict/scope.ts attachScope: gate_status after `outcome` from engine 0.6.0, the scope block last from engine 0.3.0."""
    engine = v["engine_version"]
    if engine in ENGINES and at_least(engine, "0.6.0"):
        gate = recorded_gate_status(v)
        items = [(k, x) for k, x in v.items() if k != "gate_status"]
        v.clear()
        placed = False
        for k, x in items:
            v[k] = x
            if k == "outcome":
                v["gate_status"] = gate
                placed = True
        if not placed:
            v["gate_status"] = gate
    if engine in ENGINES and at_least(engine, "0.3.0"):
        v.pop("scope", None)
        v["scope"] = {"ruleset": "%s@%s" % (v["ruleset"]["id"], v["ruleset"]["version"]), "engine_version": engine,
                      "evidence_floor": v.get("evidence_floor", "unstated"), "statements": list(SCOPE_STATEMENTS)}
    return v
