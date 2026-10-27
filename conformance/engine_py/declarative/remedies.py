# Typed remedies for every non-PASS claim, in Python. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
A port of packages/verify/src/verdict/remedy.ts: the declaration checks lint uses, normalizeDeclaration, the derivation from a
claim's insufficiency, and the merge (one remedy per distinct kind / operand / transform / authority / detail, FAIL claims
first, then can't-tell, each in claim order).
"""

import re

import jsrt as J
from jsrt import UNDEF

REMEDY_KINDS = ["missing-operand", "transform", "authority", "recompute-with", "none"]
REMEDY_TRANSFORMS = ["declare-field-path", "declare-unit", "tax-inclusive-subtotal", "cap-at-received"]
REASONS = ["FIELD_MISSING", "UNPARSEABLE", "AMBIGUOUS_UNIT", "SPAN_NOT_FOUND", "OUT_OF_RULESET_SCOPE", "REFERENCE_NOT_PROVIDED",
           "AMBIGUOUS_FIELD", "AMBIGUOUS_REFERENCE", "SELECTIVE_QUOTE"]


def remedy_spec_problems(s, where, outcome):
    if not isinstance(s, dict):
        return ["%s: a remedy is an object { kind, detail, … }" % where]
    out = []
    known = ("kind", "operand", "transform", "authority", "detail", "when")
    for k in J.keys(s):
        if k not in known:
            out.append('%s: unknown remedy field "%s"' % (where, k))
    kind = s.get("kind", UNDEF)
    if not isinstance(kind, str) or kind not in REMEDY_KINDS:
        out.append("%s: kind must be one of %s" % (where, ", ".join(REMEDY_KINDS)))
    detail = s.get("detail", UNDEF)
    if not isinstance(detail, str) or not J.trim(detail):
        out.append("%s: detail is required (what the remedy is, in words)" % where)
    op = s.get("operand", UNDEF)
    if op is not UNDEF:
        if not isinstance(op, dict) or not isinstance(op.get("source"), str) or not op.get("source"):
            out.append("%s: operand needs a source" % where)
        else:
            for k in ("role", "path"):
                if op.get(k, UNDEF) is not UNDEF and not isinstance(op.get(k), str):
                    out.append("%s: operand.%s must be a string" % (where, k))
    if kind in ("missing-operand", "recompute-with") and op is UNDEF:
        out.append("%s: a %s remedy names its operand" % (where, kind))
    tr = s.get("transform", UNDEF)
    if kind == "transform":
        if not isinstance(tr, str):
            out.append("%s: a transform remedy names a registered transformation (one of %s)" % (where, ", ".join(REMEDY_TRANSFORMS)))
        elif tr not in REMEDY_TRANSFORMS:
            out.append('%s: transform "%s" is not registered (registered: %s)' % (where, tr, ", ".join(REMEDY_TRANSFORMS)))
    elif tr is not UNDEF:
        out.append("%s: only a transform remedy names a transform" % where)
    au = s.get("authority", UNDEF)
    if kind == "authority":
        if not isinstance(au, str) or not J.trim(au):
            out.append("%s: an authority remedy names the role that may rule" % where)
    elif au is not UNDEF:
        out.append("%s: only an authority remedy names an authority" % where)
    when = s.get("when", UNDEF)
    if when is not UNDEF:
        if outcome != "abstain":
            out.append('%s: "when" filters ABSTAIN remedies by insufficiency reason; a FAIL remedy has none' % where)
        elif not isinstance(when, list) or any(not isinstance(w, str) or w not in REASONS for w in when):
            out.append("%s: when lists insufficiency reasons (%s)" % (where, ", ".join(REASONS)))
    return out


def remedy_declaration_problems(d, where):
    if isinstance(d, list):
        out = []
        for i, s in enumerate(d):
            out.extend(remedy_spec_problems(s, "%s[%d]" % (where, i), "fail"))
        return out
    if not isinstance(d, dict):
        return ["%s: remedy must be a remedy, a list of remedies, or { fail: [...], abstain: [...] }" % where]
    if "kind" in d:
        return remedy_spec_problems(d, where, "fail")
    out = []
    for k in J.keys(d):
        if k not in ("fail", "abstain"):
            out.append('%s: unknown key "%s" (fail, abstain)' % (where, k))
    for k in ("fail", "abstain"):
        if d.get(k, UNDEF) is UNDEF:
            continue
        if not isinstance(d[k], list):
            out.append("%s.%s: a list of remedies" % (where, k))
            continue
        for i, s in enumerate(d[k]):
            out.extend(remedy_spec_problems(s, "%s.%s[%d]" % (where, k, i), k))
    return out


def normalize_declaration(d):
    """normalizeDeclaration: {fail?, abstain?} with only the well-formed specs, or None."""
    if d is UNDEF or d is None:
        return None

    def keep(xs, outcome):
        if not isinstance(xs, list):
            return None
        ok = [s for s in xs if not remedy_spec_problems(s, "", outcome)]
        return ok if ok else None
    out = {}
    if isinstance(d, list):
        f = keep(d, "fail")
        if f:
            out["fail"] = f
    elif isinstance(d, dict) and "kind" in d:
        f = keep([d], "fail")
        if f:
            out["fail"] = f
    elif isinstance(d, dict):
        f = keep(d.get("fail", UNDEF), "fail")
        if f:
            out["fail"] = f
        a = keep(d.get("abstain", UNDEF), "abstain")
        if a:
            out["abstain"] = a
    else:
        return None
    return out if (out.get("fail") or out.get("abstain")) else None


def _operand_name(info):
    return "%s%s" % (" (%s)" % info["path"] if "path" in info else "", ", %s" % info["term"] if "term" in info else "")


def _show(v):
    if v is UNDEF or v is None:
        return "?"
    if J.is_num(v) or isinstance(v, bool):
        return J.js_str(v)
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ", ".join(_show(x) for x in v)
    return J.canonical(v)


def _facts(c, display):
    m = re.search(r"line\[([0-9]+)\]", c["claim_id"])
    line = m.group(1) if m else None

    def fact(key):
        if display is not None:
            shown = display(c, key)
            if shown is not None:
                return shown
        comp = c.get("computation") if isinstance(c.get("computation"), dict) else {}
        if key.startswith("op:"):
            ops = comp.get("operands") if isinstance(comp.get("operands"), dict) else {}
            return _show(ops.get(key[3:], UNDEF))
        ins = c.get("insufficiency") if isinstance(c.get("insufficiency"), dict) else {}
        if key == "field":
            return c["field"]
        if key == "asserted":
            return _show(c.get("asserted", UNDEF))
        if key == "expected":
            return _show(comp.get("result", UNDEF))
        if key == "variance":
            return "?" if c.get("variance", UNDEF) is UNDEF else J.js_str(c["variance"])
        if key == "claim":
            return c["claim_id"]
        if key == "rule":
            return c["rule_id"]
        if key == "line":
            return line if line is not None else "?"
        if key == "position":
            return "?" if line is None else str(int(line) + 1)
        if key == "missing":
            return ", ".join(ins["missing"]) if ins.get("missing") else "?"
        if key == "reason":
            return ins.get("reason", "?")
        return "?"
    return fact


def _fill(text, fact):
    return re.sub(r"\{(op:[A-Za-z0-9_]+|[a-z]+)\}", lambda m: fact(m.group(1)), text)


def _instantiate(s, c, display):
    fact = _facts(c, display)
    r = {"kind": s["kind"], "detail": _fill(s["detail"], fact)}
    if s.get("operand"):
        op = {"source": s["operand"]["source"]}
        if s["operand"].get("role", UNDEF) is not UNDEF:
            op["role"] = s["operand"]["role"]
        if s["operand"].get("path", UNDEF) is not UNDEF:
            op["path"] = _fill(s["operand"]["path"], fact)
        r["operand"] = op
    if s.get("transform", UNDEF) is not UNDEF:
        r["transform"] = s["transform"]
    if s.get("authority", UNDEF) is not UNDEF:
        r["authority"] = s["authority"]
    return r


def _call(fn, *a):
    return None if fn is None else fn(*a)


def _derived_abstain(c, ctx):
    doc = ctx.get("document") or "document"
    ins = c.get("insufficiency")
    ins = ins if isinstance(ins, dict) else None
    missing = (ins or {}).get("missing") or []

    def source_of(role):
        s = _call(ctx.get("sourceOfRole"), role)
        return s if s is not None else doc
    reason = ins.get("reason") if ins else None
    if reason == "REFERENCE_NOT_PROVIDED":
        if not missing:
            return [{"kind": "missing-operand", "operand": {"source": "reference"}, "detail": "supply the reference this check reads: %s" % ins["detail"]}]
        by = {}
        for m in missing:
            by.setdefault(source_of(m), []).append(m)
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
            choice = _call(ctx.get("choiceOf"), m)
            if choice:
                out.append({"kind": "missing-operand", "operand": {"source": doc, "role": m, "path": "choices.%s" % m},
                            "detail": "state the choice %s (%s): the document does not state it and the ruleset supplies no default. A fill { value, stated: true, span: { page or section, quote } } quoting the passage that states it, or a value the judge supplies (supplied_choices), runs the check again" % (m, choice["kind"])})
                continue
            computed = bool(_call(ctx.get("isComputed"), m))
            info = None if computed else _call(ctx.get("operandInfo"), m, c)
            if info:
                op = {"source": source_of(m), "role": m}
                if "path" in info:
                    op["path"] = info["path"]
                out.append({"kind": "missing-operand", "operand": op, "detail": "supply %s%s: the rule cannot run without it" % (m, _operand_name(info))})
                continue
            if not computed:
                out.append({"kind": "missing-operand", "operand": {"source": source_of(m), "role": m}, "detail": "supply %s: the rule cannot run without it" % m})
                continue
            why = None
            if re.match(r"[A-Z0-9_]+\Z", m):
                hit = re.search(r"(?:^|; )%s: ([^;]*)" % m, ins["detail"])
                if hit:
                    why = hit.group(1).split(" — ")[0]
            out.append({"kind": "missing-operand", "operand": {"source": doc, "role": m},
                        "detail": "%s is computed from the document and could not be: %s" % (m, why if why is not None else ins["detail"])})
        return out
    if reason == "UNPARSEABLE":
        if missing:
            out = []
            for m in missing:
                info = _call(ctx.get("operandInfo"), m, c)
                u = info.get("unreadable") if info else None
                if u and ctx.get("evidenceLaw") and u.get("struck") in ("qc_held", "qc_struck"):
                    op = {"source": source_of(m), "role": m}
                    if "path" in info:
                        op["path"] = info["path"]
                    out.append({"kind": "missing-operand", "operand": op,
                                "detail": "%s%s is %s by its quality flag%s. It is answered by the archive: a CORRECT carrying the file in which the archive serves the value with a flag the ruleset's flags choice computes (a later quality state), or a restated flags choice; never by a typed value" % (
                                    m, _operand_name(info), "held" if u["struck"] == "qc_held" else "struck", " (%s)" % u["why"] if u.get("why") else "")})
                    continue
                if u and ctx.get("evidenceLaw"):
                    st = u.get("struck")
                    if st == "withdrawn":
                        what = "withdrawn%s" % (" (%s)" % u["why"] if u.get("why") else "")
                    elif st == "unsupported":
                        what = "an unsupported assertion%s" % (" (%s)" % u["why"] if u.get("why") else "")
                    elif st == "conflict":
                        what = "in conflict: %s" % (u["why"] if u.get("why") is not None else "two sources at one tier disagree")
                    else:
                        what = "unreadable%s; %s%s" % (" at %s" % u["at"] if "at" in u else "", "reported as %s" % u["value"] if "value" in u else "no value was read",
                                                      "; %s" % u["note"] if "note" in u else "")
                    op = {"source": source_of(m), "role": m}
                    if "path" in info:
                        op["path"] = info["path"]
                    out.append({"kind": "missing-operand", "operand": op,
                                "detail": "%s%s is struck: %s. It is answered by evidence, never by a typed value: a CORRECT carrying the page or document that prints it (the engine reads it), or a CORROBORATE from an independent source; the checks waiting on it run again" % (m, _operand_name(info), what)})
                    continue
                if u:
                    op = {"source": source_of(m), "role": m}
                    if "path" in info:
                        op["path"] = info["path"]
                    out.append({"kind": "missing-operand", "operand": op,
                                "detail": "supply %s%s: unreadable%s; %s%s. Read it off the document and run the check again" % (
                                    m, _operand_name(info), " at %s" % u["at"] if "at" in u else "", "reported as %s" % u["value"] if "value" in u else "no value was read",
                                    "; %s" % u["note"] if "note" in u else "")})
                    continue
                path = _call(ctx.get("pathOfRole"), m, c)
                op = {"source": source_of(m), "role": m}
                if path is not None:
                    op["path"] = path
                out.append({"kind": "recompute-with", "operand": op, "detail": "re-read %s%s as a value the rule can compare: %s" % (m, " (%s)" % path if path is not None else "", ins["detail"])})
            return out
        return [{"kind": "recompute-with", "operand": {"source": doc, "path": c["field"]}, "detail": "re-read %s as a value the rule can compare: %s" % (c["field"], ins["detail"])}]
    if reason == "AMBIGUOUS_FIELD":
        return [{"kind": "transform", "transform": "declare-field-path", "operand": {"source": doc, "path": c["field"]}, "detail": "say which field is %s: %s" % (c["field"], ins["detail"])}]
    if reason == "AMBIGUOUS_UNIT":
        return [{"kind": "transform", "transform": "declare-unit", "operand": {"source": doc, "path": c["field"]}, "detail": "state the unit of %s: %s" % (c["field"], ins["detail"])}]
    if reason == "AMBIGUOUS_REFERENCE":
        op = {"source": source_of(missing[0]) if missing else "reference"}
        if len(missing) == 1:
            op["role"] = missing[0]
        return [{"kind": "missing-operand", "operand": op, "detail": "name the one reference entry that applies: %s" % ins["detail"]}]
    if reason == "SPAN_NOT_FOUND":
        return [{"kind": "missing-operand", "operand": {"source": "source", "path": c["field"]}, "detail": "supply the complete source text, or where the passage appears: %s" % ins["detail"]}]
    if reason == "SELECTIVE_QUOTE":
        return [{"kind": "authority", "authority": "reviewer", "detail": "a person reads the passage in context and rules, for this verdict only: %s" % ins["detail"]}]
    if reason == "OUT_OF_RULESET_SCOPE":
        return [{"kind": "authority", "authority": "reviewer", "detail": "the ruleset does not decide this (%s); a person rules, for this verdict only" % ins["detail"]}]
    return [{"kind": "none", "detail": "no remedy is declared for %s; the claim abstains: %s" % (c["rule_id"], ins["detail"] if ins and "detail" in ins else "undecided")}]


def _specs_for(c, ctx):
    declared = _call(ctx.get("declaredFor"), c)
    if declared is None:
        declared = _call(ctx.get("declared"), c["rule_id"])
    if c["outcome"] == "FAIL":
        if declared and declared.get("fail"):
            return declared["fail"]
        return [{"kind": "none", "detail": "no remedy is declared for %s: the finding stands" % c["rule_id"]}]
    ins = c.get("insufficiency") if isinstance(c.get("insufficiency"), dict) else {}
    reason = ins.get("reason")
    # `!s.when`: an empty list is truthy in JavaScript, so it filters (and matches nothing)
    hits = [s for s in ((declared or {}).get("abstain") or []) if not J.truthy(s.get("when", UNDEF)) or (reason is not None and reason in s["when"])]
    return hits if hits else _derived_abstain(c, ctx)


def remedies_for(v, ctx):
    open_ = [c for c in v["claims"] if c["outcome"] == "FAIL"] + [c for c in v["claims"] if c["outcome"] == "INSUFFICIENT_DATA"]
    if not open_:
        if v["outcome"] == "PASS":
            return None
        source = ctx.get("document") or "document"
        detail = ("every claim passed, but under %s they cannot alone make the verdict PASS: supply a value to check against the %s"
                  % (v.get("aggregation") or "its aggregation", source)) if v["claims"] else \
            "no claim could be formed from these inputs: supply a document the ruleset reads"
        return [{"kind": "missing-operand", "operand": {"source": source}, "detail": detail, "clears": [], "claims": []}]
    merged = {}
    order = []
    for c in open_:
        for s in _specs_for(c, ctx):
            r = _instantiate(s, c, ctx.get("display"))
            key = J.canonical(r)
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
                order.append(key)
    return [merged[k] for k in order]


def attach_remedies(v, ctx):
    rem = remedies_for(v, ctx)
    if rem is not None:
        v["remedies"] = rem
    return v
