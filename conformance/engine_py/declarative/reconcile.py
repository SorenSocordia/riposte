# Cross-document reconciliation (the N-way match), in Python. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
A port of packages/verify/src/reconcile/index.ts (reconcile). It shares the expression parser of the declarative format, so the
first golden pins it with the declarative cases.
"""

import math

import jsrt as J
from jsrt import UNDEF
import expr as X
import numread as N
import remedies as RM
import interpret as I

OP_LABEL = {"=": "=", "<=": "≤", ">=": "≥", "!=": "≠"}


def _bind(documents, spec, strict):
    doc = spec["doc"]
    source = documents[doc] if doc in documents else UNDEF
    default = spec.get("default", UNDEF)
    if source is UNDEF:
        if default is not UNDEF:
            return {"status": "ok", "value": default, "doc": doc, "path": "default(%s)" % J.js_str(default)}
        return {"status": "doc_missing", "doc": doc}
    bad, why = False, UNDEF
    for p in spec["paths"]:
        raw = I.get_path(source, p)
        if raw is UNDEF or raw is None or raw == "":
            continue
        norm = N.normalize_amount(raw)
        if strict and isinstance(raw, str) and J.trim(raw) != "":
            fmt = N.format_of_texts(N.text_values(source), source.get("number_locale", UNDEF) if isinstance(source, dict) else UNDEF)
            s = N.strict_number_text(raw, "amount", fmt)
            if not s["ok"]:
                bad = True
                if why is UNDEF:
                    why = "%s is %s, which does not read as one number (%s): not read, never guessed" % (p, J.js_string(raw), s["why"])
                continue
            value = None if s["value"] is None else J.math_round(s["value"] * 100) / 100
            if value is not None and not (norm and norm["success"] is not False and norm["normalized"] == value):
                return {"status": "ok", "value": value, "doc": doc, "path": p, "original": raw, "norms": ["strict_reading_%s" % fmt.get("tag", "plain")]}
        if norm and norm["success"] is not False:
            return {"status": "ok", "value": norm["normalized"], "doc": doc, "path": p, "original": raw, "norms": norm["transformations"]}
        bad = True
    if strict and not bad:
        for p in spec["paths"]:
            k = N.near_miss_path(source, p)
            if k is not None:
                bad = True
                why = "%s was reported under the key path %s, which differs from it only by spaces or invisible characters: not read" % (p, J.js_string(k))
                break
    if strict and bad:
        b = {"status": "unparseable", "doc": doc}
        if why is not UNDEF:
            b["why"] = why
        return b
    if default is not UNDEF:
        return {"status": "ok", "value": default, "doc": doc, "path": "default(%s)" % J.js_str(default)}
    return {"status": "unparseable" if bad else "field_missing", "doc": doc}


def reconcile(documents, ruleset, options=None):
    options = options or {}
    policy = ruleset.get("tolerance") if ruleset.get("tolerance") is not None else {"rel": 0.0003, "absCap": 0}
    engine = I.engine_for(options.get("engine"))
    strict = I.at_least(engine, "0.6.0")
    fields = ruleset["fields"]
    claims = []
    for chk in ruleset["checks"]:
        roles = []
        for r in X.referenced_roles(chk["left"]) + X.referenced_roles(chk["right"]):
            if r not in roles and r in fields:
                roles.append(r)
        bounds = {r: _bind(documents, fields[r], strict) for r in roles}
        base = {"claim_id": "recon.%s" % chk["code"], "kind": "CROSS_REFERENCE", "tier": "DETERMINISTIC",
                "field": chk["field"] if chk.get("field") is not None else chk["code"].lower(), "rule_id": chk["code"],
                "rule_name": chk["name"] if chk.get("name") is not None else chk["code"]}
        ins = None
        for r in roles:
            b = bounds[r]
            if b["status"] == "doc_missing":
                ins = {"reason": "REFERENCE_NOT_PROVIDED", "detail": "document \"%s\" (needed for %s) was not supplied" % (b["doc"], r), "missing": [r]}
                break
        if ins is None:
            for r in roles:
                b = bounds[r]
                if b["status"] == "unparseable":
                    ins = {"reason": "UNPARSEABLE", "detail": "%s in \"%s\" is present but not a number%s" % (r, b["doc"], ": %s" % b["why"] if "why" in b else ""), "missing": [r]}
                    break
                if b["status"] == "field_missing":
                    ins = {"reason": "FIELD_MISSING", "detail": "%s not found in document \"%s\"" % (r, b["doc"]), "missing": [r]}
                    break
        if ins is not None:
            c = dict(base)
            c.update(outcome="INSUFFICIENT_DATA", asserted=None, evidence=[], insufficiency=ins, locked=False, explanation="%s: %s" % (chk["code"], ins["detail"]))
            claims.append(c)
            continue
        vars_ = {r: bounds[r].get("value") for r in roles}
        env = X.Env(vars_, lambda r: None)
        try:
            left = X.eval_expr(chk["left"], env)
            right = X.eval_expr(chk["right"], env)
        except X.ExprError as e:
            c = dict(base)
            c.update(outcome="INSUFFICIENT_DATA", asserted=None, evidence=[], insufficiency={"reason": "OUT_OF_RULESET_SCOPE", "detail": "expression error: %s" % e},
                     locked=False, explanation="%s: bad expression" % chk["code"])
            claims.append(c)
            continue
        if left is None or right is None:
            c = dict(base)
            c.update(outcome="INSUFFICIENT_DATA", asserted=None, evidence=[], insufficiency={"reason": "FIELD_MISSING", "detail": "a value needed by %s was absent" % chk["code"], "missing": roles},
                     locked=False, explanation="%s: operand absent" % chk["code"])
            claims.append(c)
            continue
        tol_abs = max(chk["tol"] if chk.get("tol") is not None else 0.01, policy["absCap"], policy["rel"] * max(abs(left), abs(right)))
        diff = left - right
        op = chk["op"]
        if op == "=":
            passed = abs(diff) <= tol_abs
        elif op == "!=":
            passed = abs(diff) > tol_abs
        elif op == "<=":
            passed = left <= right + tol_abs
        else:
            passed = left >= right - tol_abs
        evidence = []
        for r in roles:
            b = bounds[r]
            computed = (b.get("path") or "").startswith("default(")
            e = {"locator": {"kind": "field", "source": "computed" if computed else "evidence", "path": "%s.%s" % (b["doc"], b.get("path") or "")},
                 "value": b.get("value"), "confidence": 100, "role": "OPERAND"}
            if b.get("original", UNDEF) is not UNDEF and J.js_str(b["original"]) != J.js_str(b.get("value", UNDEF)):
                e["original"] = b["original"]
            if b.get("norms"):
                e["normalizations"] = b["norms"]
            evidence.append(e)
        label = OP_LABEL.get(op, "undefined")
        d4 = J.number_of(J.to_fixed(diff, 4))
        c = dict(base)
        c.update(outcome="PASS" if passed else "FAIL", asserted=left,
                 computation={"formula": "%s %s %s" % (chk["left"], label, chk["right"]), "operands": {r: (vars_[r] if vars_[r] is not None else None) for r in roles},
                              "result": right, "tolerance": {"abs": tol_abs}},
                 evidence=evidence)
        if not passed:
            c["variance"] = d4
        c["locked"] = passed
        c["explanation"] = "%s: coheres (%s %s %s)" % (chk["code"], J.js_str(left), label, J.js_str(right)) if passed else \
            "%s: cross-document mismatch — %s = %s but expected %s (Δ %s)" % (chk["code"], chk["left"], J.js_str(left), J.js_str(right), J.js_str(d4))
        claims.append(c)
    outcome = "FAIL" if any(c["outcome"] == "FAIL" for c in claims) else ("PASS" if any(c["outcome"] == "PASS" for c in claims) else "INSUFFICIENT_DATA")
    coverage = {"claims_total": len(claims), "claims_checked": sum(1 for c in claims if c["outcome"] in ("PASS", "FAIL")),
                "claims_pass": sum(1 for c in claims if c["outcome"] == "PASS"), "claims_fail": sum(1 for c in claims if c["outcome"] == "FAIL"),
                "claims_insufficient": sum(1 for c in claims if c["outcome"] == "INSUFFICIENT_DATA")}
    input_hash = J.hash_of({"documents": documents, "ruleset": ruleset})
    rth = J.hash_of({}) if I.at_least(engine, "0.2.0") else None
    verdict = {"schema_version": I.SCHEMA_VERSION, "verdict_id": J.rb.derive_verdict_id(input_hash, ruleset, engine, rth),
               "issued_at": options.get("now") or J.E.now_iso(), "engine_version": engine,
               "ruleset": {"id": ruleset["id"], "version": ruleset["version"], "domain": ruleset["domain"] if ruleset.get("domain") is not None else ruleset["id"]},
               "input_hash": input_hash}
    if rth is not None:
        verdict["remedy_table_hash"] = rth
    verdict.update({"replayable": True, "document": {"extraction_hash": J.hash_of(documents), "line_items": 0},
                    "references": {"contract": False, "evidence": len(J.keys(documents)), "history": 0, "source": False},
                    "outcome": outcome, "aggregation": "ANY_FAIL_FAILS", "claims": claims, "coverage": coverage})
    RM.attach_remedies(verdict, {"document": "documents"})
    return I.attach_scope(verdict)
