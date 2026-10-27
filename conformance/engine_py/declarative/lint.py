# Lint a declarative ruleset before it runs, in Python. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
A port of packages/verify/src/declarative/lint.ts (lintRuleset): the same errors and warnings, in the same words and order.
A ruleset that names pinned `algorithms`, or a choice slot whose default needs the algorithm registry or a quality-flag scheme,
is refused (Outside): this build carries neither registry.
"""

import re

import jsrt as J
from jsrt import UNDEF
import expr as X
import numread as N
import remedies as RM
from interpret import Outside

VALID_KINDS = ("amount", "rate", "quantity", "string", "bool", "identifier", "price")
VALID_OPS = ("=", "<=", ">=", "!=")
VALID_COMPARE = ("number", "identifier", "member")
VALID_GUARD_OPS = ("=", "!=", "<", "<=", ">", ">=")
VALID_ROUNDING = ("none", "infer")
CHOICE_KINDS = ["weights", "flags", "ratio", "units", "model_form", "algorithm", "tolerance", "selection"]


def _g(o, k):
    return o.get(k, UNDEF) if isinstance(o, dict) else UNDEF


def _refs_of(e):
    if not isinstance(e, str):
        return []
    try:
        return X.operand_refs(e)
    except X.ExprError:
        pass
    try:
        return [{"name": r, "kind": "role", "role": r, "optional": False} for r in X.referenced_roles(e)]
    except X.ExprError:
        return []


def _uniq(xs):
    out = []
    for x in xs:
        if x not in out:
            out.append(x)
    return out


def _safe_refs(e):
    return _uniq([r["role"] for r in _refs_of(e) if r["kind"] in ("role", "sum")])


def _all_underlying(e):
    return _uniq([r["role"] for r in _refs_of(e)])


def _form(r):
    if r["kind"] == "agg":
        return "%s(%s%s)" % (r["fn"], r["role"], ", %s" % r["set"] if "set" in r else "")
    if r["kind"] == "doc":
        return "doc.%s" % r["role"]
    return "%s(%s)" % (r["kind"], r["role"])


def _q(v):
    """String(v) as a template literal writes a ruleset's value."""
    return J.js_str(v)


def _is_list(x):
    return isinstance(x, list)


def lint_ruleset(rs):
    errors, warnings = [], []
    if not isinstance(rs, (dict, list)):
        return {"ok": False, "errors": ["ruleset must be an object"], "warnings": warnings}
    R = rs if isinstance(rs, dict) else {}
    rid, ver = _g(R, "id"), _g(R, "version")
    if not isinstance(rid, str) or len(rid) == 0:
        errors.append('missing or empty "id"')
    if not isinstance(ver, str) or len(ver) == 0:
        errors.append('missing or empty "version"')
    fields_raw = _g(R, "fields")
    fields_ok = isinstance(fields_raw, dict) and len(J.keys(fields_raw)) > 0
    if not fields_ok:
        errors.append('"fields" must be a non-empty object')
    checks = _g(R, "checks")
    if not isinstance(checks, list) or len(checks) == 0:
        errors.append('"checks" must be a non-empty array')
    if errors:
        return {"ok": False, "errors": errors, "warnings": warnings}
    if isinstance(_g(R, "algorithms"), dict) and len(R["algorithms"]):
        raise Outside("the ruleset names pinned algorithms; this build carries no algorithm registry to lint them against")

    fields = fields_raw
    computed = _g(R, "computed")
    computed = computed if (computed is not UNDEF and computed is not None) else {}
    computed_d = computed if isinstance(computed, dict) else {}
    lc_raw = _g(R, "line_computed")
    lc = lc_raw if isinstance(lc_raw, dict) else {}
    fkeys = J.keys(fields)

    def fget(r):
        return fields[r] if r in fields else None

    list_roles = [k for k in fkeys if _g(fields[k], "each") is not UNDEF and not J.truthy(_g(fields[k], "line"))]
    doc_roles = [k for k in fkeys if not J.truthy(_g(fields[k], "line")) and k not in list_roles]
    line_roles = _uniq([k for k in fkeys if J.truthy(_g(fields[k], "line"))] + J.keys(lc))
    computed_roles = J.keys(computed_d)
    algo_roles = []
    row_sets_raw = _g(R, "row_sets")
    row_sets = row_sets_raw if isinstance(row_sets_raw, dict) else {}
    choices_raw = _g(R, "choices")
    slot_list = [s for s in choices_raw if isinstance(s, dict)] if isinstance(choices_raw, list) else []
    for s in slot_list:
        if _g(s, "default") is not UNDEF and _g(s, "kind") in ("algorithm", "flags"):
            raise Outside("a choice slot's default needs the algorithm registry or a quality-flag scheme; this build carries neither")
    slot_ids = _uniq([s["id"] for s in slot_list if isinstance(s.get("id"), str) and len(s["id"]) > 0])

    def slot_of(i):
        return next((s for s in slot_list if s.get("id") == i), None)
    all_roles = _uniq(doc_roles + line_roles + computed_roles + list_roles + algo_roles + slot_ids)
    identifier_roles = [k for k in fkeys if _g(fields[k], "kind") == "identifier"]
    late_roles = set()
    for role, f in J.entries(lc):
        if any((r["kind"] == "doc" and (r["role"] in computed_roles or r["role"] in algo_roles)) or (r["kind"] not in ("doc", "agg") and r["role"] in late_roles) for r in _refs_of(f)):
            late_roles.add(role)

    def no_identifier_arithmetic(e, where):
        if not isinstance(e, str):
            return
        for ref in _all_underlying(e):
            if ref in identifier_roles:
                errors.append('%s: identifier field "%s" cannot be used in arithmetic (use a check with compare: "identifier")' % (where, ref))

    strict_flag = _g(R, "distinguish_unreadable")
    if strict_flag is not UNDEF and not isinstance(strict_flag, bool):
        errors.append('"distinguish_unreadable" must be true or false')
    sn = _g(R, "strict_numbers")
    if sn is not UNDEF and not isinstance(sn, bool):
        errors.append('"strict_numbers" must be true or false')
    rc = _g(R, "require_contract")
    if rc is not UNDEF and not isinstance(rc, bool):
        errors.append('"require_contract" must be true or false')
    hs = _g(R, "held_suspect")
    if hs is not UNDEF and not isinstance(hs, bool):
        errors.append('"held_suspect" must be true or false')
    loc = _g(R, "locale")
    if loc is not UNDEF and N.resolve_locale(loc) is None:
        errors.append('"locale" must be one of en, de, fr, ch, or { "decimal": "." | ",", "group": "," | "." | " " | "\'" | "" } with different marks')
    if lc_raw is not UNDEF and not isinstance(lc_raw, dict):
        errors.append('"line_computed" must be an object mapping each role to an expression')
    for role, f in J.entries(fields):
        paths = _g(f, "paths")
        if not isinstance(paths, list) or len(paths) == 0:
            errors.append('field "%s": "paths" must be a non-empty array' % role)
        kind = _g(f, "kind")
        if kind is not UNDEF and kind not in VALID_KINDS:
            errors.append('field "%s": invalid kind "%s"' % (role, _q(kind)))
        labels = _g(f, "labels")
        if labels is not UNDEF:
            if not isinstance(labels, list) or len(labels) == 0 or any(not isinstance(l, str) or J.trim(l) == "" for l in labels):
                errors.append('field "%s": "labels" must be a non-empty array of non-empty strings' % role)
            elif J.truthy(_g(f, "line")):
                errors.append('field "%s": "labels" are read for document fields only (this is a line field)' % role)
            elif strict_flag is False:
                warnings.append('field "%s": "labels" are not read: the ruleset sets "distinguish_unreadable": false' % role)
        term = _g(f, "term")
        if term is not UNDEF and (not isinstance(term, str) or J.trim(term) == ""):
            errors.append('field "%s": "term" must be a non-empty string' % role)
        each = _g(f, "each")
        if each is not UNDEF:
            if not isinstance(each, list) or len(each) == 0 or any(not isinstance(k, str) or J.trim(k) == "" for k in each):
                errors.append('field "%s": "each" must be a non-empty array of array paths' % role)
            if J.truthy(_g(f, "line")):
                errors.append('field "%s": a list field ("each") is a document field, not a line field' % role)
            if labels is not UNDEF:
                errors.append('field "%s": "labels" are not read for a list field' % role)
            if kind in ("identifier", "string"):
                errors.append('field "%s": a list field is summed, so its kind is a number kind' % role)
    for r in J.keys(lc):
        if J.truthy(fget(r)) or r in computed_roles:
            errors.append('"%s" is a line-computed role and a field or computed role: names must be unique' % r)
    for r in computed_roles:
        if J.truthy(fget(r)):
            errors.append('"%s" is both a field and a computed role — names must be unique' % r)

    used = set()
    dummy = X.Env({r: 1.0 for r in all_roles}, lambda r: 1.0 if (r in line_roles or r in list_roles) else None, agg=lambda *a: 1.0, ref=lambda *a: 1.0)

    def parse(e, where):
        if not isinstance(e, str) or J.trim(e) == "":
            errors.append("%s: expression must be a non-empty string" % where)
            return
        try:
            X.eval_expr_v040(e, dummy)
        except X.ExprError as ex:
            errors.append("%s: %s" % (where, ex))
            return
        for ref in X.role_refs_v040(e)["all"]:
            r = next((x for x in _refs_of(e) if x["name"] == ref), None)
            if not r or r["role"] not in all_roles:
                errors.append('%s: references unknown role "%s"' % (where, r["role"] if r else ref))
            elif r["kind"] == "agg" and "set" in r and r["set"] not in row_sets:
                errors.append('%s: %s names the row set "%s", which "row_sets" does not declare' % (where, _form(r), r["set"]))

    def new_forms(e, where, scope, lc_before=None):
        for r in _refs_of(e):
            if r["role"] not in all_roles:
                continue
            if r["kind"] == "agg":
                if scope != "document":
                    errors.append("%s: %s is not available per row (an aggregate is document-scope; read it on a row through doc. and a computed role)" % (where, _form(r)))
                    continue
                if r["role"] not in line_roles and r["role"] not in list_roles:
                    errors.append('%s: %s aggregates "%s", which is not a line field, a line-computed role or a list field' % (where, _form(r), r["role"]))
                if "set" in r and r["role"] in list_roles:
                    errors.append('%s: %s: a row set selects line rows; "%s" is a list field' % (where, _form(r), r["role"]))
            elif r["kind"] == "doc":
                if scope == "document":
                    errors.append('%s: %s is read on a row; a document check reads "%s" directly' % (where, _form(r), r["role"]))
                elif r["role"] not in doc_roles and r["role"] not in computed_roles and r["role"] not in algo_roles and r["role"] not in slot_ids:
                    errors.append('%s: %s: "%s" is not a document field, a computed role%s' % (where, _form(r), r["role"], ", an algorithm role or a choice" if slot_ids else " or an algorithm role"))
                elif scope == "row_set" and r["role"] not in doc_roles and r["role"] not in slot_ids:
                    errors.append("%s: %s: a row-set condition reads document fields %sonly (computed and algorithm roles are evaluated after the row sets they may aggregate)" % (where, _form(r), "and choices " if slot_ids else ""))
            elif r["kind"] in ("prev", "next"):
                if scope == "document":
                    errors.append("%s: %s is read on a row, not at document scope" % (where, _form(r)))
                elif r["role"] not in line_roles:
                    errors.append('%s: %s: "%s" is not a line field or a line-computed role' % (where, _form(r), r["role"]))
                elif scope == "line_computed" and r["role"] in lc and not (lc_before is not None and r["role"] in lc_before):
                    errors.append('%s: %s reads line-computed role "%s" before it is defined (line-computed roles are evaluated in order, each over every row)' % (where, _form(r), r["role"]))
            if scope == "row_set" and r["role"] in late_roles:
                errors.append('%s: "%s" reads a computed or algorithm role through doc., so it is evaluated after the row sets; a row-set condition cannot read it' % (where, r["role"]))

    for role, formula in J.entries(computed_d):
        parse(formula, 'computed "%s"' % role)
        no_identifier_arithmetic(formula, 'computed "%s"' % role)
        new_forms(formula, 'computed "%s"' % role, "document")
        for r in _refs_of(formula):
            if r["role"] in late_roles:
                errors.append('computed "%s": reads line-computed role "%s", which reads a computed or algorithm role through doc. and is evaluated after the computed roles' % (role, r["role"]))
    lc_seen = set()
    for role, formula in J.entries(lc):
        where = 'line_computed "%s"' % role
        parse(formula, where)
        no_identifier_arithmetic(formula, where)
        if isinstance(formula, str):
            if re.search(r"\bsum" + J.S + r"*\(", formula):
                errors.append("%s: sum() is not available per line" % where)
            for ref in _safe_refs(formula):
                if ref in lc and ref not in lc_seen:
                    errors.append('%s: uses line-computed role "%s" before it is defined' % (where, ref))
                elif ref not in line_roles and ref in all_roles:
                    errors.append('%s: "%s" is not a line field (a line-computed role sees only its line)' % (where, ref))
            new_forms(formula, where, "line_computed", lc_seen)
        lc_seen.add(role)

    alg_raw = _g(R, "algorithms")
    if alg_raw is not UNDEF and not isinstance(alg_raw, dict):
        errors.append('"algorithms" must be an object mapping each role to { algorithm, inputs, output? }')

    if choices_raw is not UNDEF and not isinstance(choices_raw, list):
        errors.append('"choices" must be an array of choice slots { id, kind, load_bearing, default?, not_applicable?, governs?, name? }')
    if isinstance(choices_raw, list):
        seen_ids = set()
        check_codes = set(c.get("code") for c in checks if isinstance(c, dict) and isinstance(c.get("code"), str))
        for i, raw in enumerate(choices_raw):
            s = raw if isinstance(raw, dict) else {}
            where = "choices[%d]%s" % (i, " (%s)" % s["id"] if isinstance(s.get("id"), str) else "")
            if not isinstance(raw, dict):
                errors.append("%s: a choice slot is an object" % where)
                continue
            sid = s.get("id", UNDEF)
            if not isinstance(sid, str) or not re.match(r"[A-Za-z_][A-Za-z0-9_]*\Z", sid):
                errors.append('%s: "id" is a plain name (letters, digits, _): it is a document role' % where)
            elif sid in seen_ids:
                errors.append('%s: duplicate id "%s"' % (where, sid))
            else:
                seen_ids.add(sid)
                if J.truthy(fget(sid)) or sid in computed_roles or sid in lc or sid in algo_roles or sid in row_sets:
                    errors.append('%s: "%s" is also a field, computed, line-computed or algorithm role, or a row set: names must be unique' % (where, sid))
            if not isinstance(s.get("kind"), str) or s.get("kind") not in CHOICE_KINDS:
                errors.append('%s: "kind" must be one of %s' % (where, ", ".join(CHOICE_KINDS)))
            if not isinstance(s.get("load_bearing", UNDEF), bool):
                errors.append('%s: "load_bearing" must be true or false' % where)
            nm = s.get("name", UNDEF)
            if nm is not UNDEF and (not isinstance(nm, str) or J.trim(nm) == ""):
                errors.append('%s: "name" must be a non-empty string' % where)
            na = s.get("not_applicable", UNDEF)
            if na is not UNDEF:
                if not isinstance(na, str) or J.trim(na) == "":
                    errors.append('%s: "not_applicable" must be a non-empty string (why the choice does not apply)' % where)
                if s.get("load_bearing") is True:
                    errors.append("%s: a choice declared not applicable is never load-bearing" % where)
                if s.get("default", UNDEF) is not UNDEF:
                    errors.append("%s: a choice declared not applicable has no default" % where)
            d = s.get("default", UNDEF)
            if d is not UNDEF:
                v = d.get("value", UNDEF) if isinstance(d, dict) else UNDEF
                value_ok = (J.is_num(v) and v == v and abs(v) != float("inf")) or (isinstance(v, str) and J.trim(v) != "") or isinstance(v, dict)
                if not isinstance(d, dict) or not value_ok or not isinstance(d.get("source"), str) or J.trim(d["source"]) == "":
                    errors.append('%s: "default" must be { value: a number, a non-empty string or an object, source: a non-empty string naming where the value comes from }' % where)
            gv = s.get("governs", UNDEF)
            if gv is not UNDEF:
                if not isinstance(gv, list) or len(gv) == 0 or any(not isinstance(x, str) for x in gv):
                    errors.append('%s: "governs" must be a non-empty array of check codes' % where)
                else:
                    for c in gv:
                        if c not in check_codes:
                            errors.append('%s: "governs" names "%s", which is not a check code' % (where, c))

    for i, c in enumerate(checks):
        sp = _g(c, "support")
        if sp is UNDEF:
            continue
        where = "check[%d]%s" % (i, " (%s)" % _q(c["code"]) if J.truthy(_g(c, "code")) else "")
        if not isinstance(sp, dict) or not isinstance(sp.get("field"), str) or not isinstance(sp.get("max_of"), str):
            errors.append('%s: "support" must be { field: the point the model is evaluated at, max_of: the measured line field }' % where)
            continue
        if _g(c, "compare") in ("identifier", "member"):
            errors.append('%s: "support" applies to numeric checks only' % where)
        parse(sp["field"], "%s.support.field" % where)
        for ref in _all_underlying(sp["field"]):
            used.add(ref)
        if sp["max_of"] not in line_roles:
            errors.append('%s: support.max_of "%s" must be a line field or a line-computed role (the measured support)' % (where, sp["max_of"]))
        else:
            used.add(sp["max_of"])

    pk = _g(R, "provenance_kinds")
    if pk is not UNDEF and (not isinstance(pk, list) or len(pk) == 0 or any(k not in ("page", "archive") for k in pk)):
        errors.append('"provenance_kinds" must be a non-empty array of "page" and "archive"')
    tol = _g(R, "tolerance")
    tr = _g(tol, "rounding") if isinstance(tol, dict) else UNDEF
    if tr is not UNDEF and tr not in VALID_ROUNDING:
        errors.append('tolerance.rounding: invalid value "%s" (none | infer)' % _q(tr))
    src = _g(R, "sources")
    if src is not UNDEF and (not isinstance(src, dict) or any(not isinstance(v, str) or J.trim(v) == "" for v in src.values())):
        errors.append('"sources" must be an object mapping each key to a non-empty string (a URL or a citation)')

    def check_side(e, where, err, scope):
        parse(e, where)
        no_identifier_arithmetic(e, where)
        if not isinstance(e, str):
            return
        new_forms(e, err, "document" if scope == "document" else ("row_set" if scope == "row_set" else "line"))
        for ref in _all_underlying(e):
            used.add(ref)
        for ref in _safe_refs(e):
            used.add(ref)
            if ref not in all_roles:
                continue
            if scope in ("line", "row_set"):
                if ref in doc_roles or ref in list_roles:
                    errors.append('%s: line-scope check references document field "%s" (only line fields are visible per line)' % (err, ref))
                if ref in computed_roles:
                    errors.append('%s: line-scope check references computed role "%s" (computed roles are document-scope)' % (err, ref))
                if ref in algo_roles:
                    errors.append('%s: line-scope check references algorithm role "%s" directly (it is document-scope: read it as doc.%s)' % (err, ref, ref))
                if ref in slot_ids:
                    errors.append('%s: line-scope check references choice "%s" directly (a choice is document-scope: read it as doc.%s)' % (err, ref, ref))
                if re.search(r"\bsum" + J.S + r"*\(", e):
                    errors.append("%s: sum() is not available in a line-scope check" % err)
            else:
                if ref in line_roles and not re.search(r"\bsum" + J.S + r"*\(" + J.S + "*" + ref + J.S + r"*\)", e):
                    errors.append('%s: document-scope check uses per-line field "%s" directly — wrap it as sum(%s)' % (err, ref, ref))
                if ref in list_roles and not re.search(r"\bsum" + J.S + r"*\(" + J.S + "*" + ref + J.S + r"*\)", e):
                    errors.append('%s: document-scope check uses list field "%s" directly — wrap it as sum(%s)' % (err, ref, ref))

    def lint_applicability(conds, where, scope):
        line_like = scope != "document"
        scope_word = "line" if line_like else "document"
        if not isinstance(conds, list) or len(conds) == 0:
            errors.append('%s: "applies_if" must be a non-empty array of conditions' % where)
            return
        for j, g in enumerate(conds):
            gw = "%s.applies_if[%d]" % (where, j)
            if not isinstance(g, (dict, list)):
                errors.append("%s: must be { left, op, right } or { field, in | not_in }" % gw)
                continue
            o = g if isinstance(g, dict) else {}  # an array is an object to JavaScript, with none of these keys
            if "neighbour" in o:
                if o["neighbour"] not in ("prev", "next"):
                    errors.append('%s: "neighbour" must be "prev" or "next"' % gw)
                if not line_like:
                    errors.append("%s: a neighbour condition is read on a row; this condition is document-scope" % gw)
                if len(J.keys(o)) != 1:
                    errors.append("%s: a neighbour condition is { neighbour } alone" % gw)
                continue
            if "any_present" in o:
                lst = o["any_present"]
                if not isinstance(lst, list) or len(lst) == 0 or any(not isinstance(x, str) for x in lst):
                    errors.append('%s: "any_present" must be a non-empty array of field names' % gw)
                    continue
                for name in lst:
                    used.add(name)
                    f = fget(name)
                    if not J.truthy(f):
                        errors.append('%s: "any_present" names "%s", which is not a field' % (gw, name))
                    elif J.truthy(_g(f, "line")) != line_like:
                        errors.append('%s: "%s" is a %s field but the condition is %s-scope' % (gw, name, "line" if J.truthy(_g(f, "line")) else "document", scope_word))
                continue
            if "field" in o:
                name = o["field"] if isinstance(o["field"], str) else ""
                used.add(name)
                f = fget(name)
                if "present" in o:
                    if o["present"] is not True:
                        errors.append('%s: "present" must be true' % gw)
                    if "in" in o or "not_in" in o:
                        errors.append('%s: give exactly one of "in", "not_in" or "present"' % gw)
                    if not J.truthy(f):
                        errors.append('%s: "field" must name a field (got "%s")' % (gw, name))
                    elif J.truthy(_g(f, "line")) != line_like:
                        errors.append('%s: "%s" is a %s field but the condition is %s-scope' % (gw, name, "line" if J.truthy(_g(f, "line")) else "document", scope_word))
                    continue
                if not J.truthy(f) or _g(f, "kind") not in ("identifier", "string"):
                    errors.append("%s: \"field\" must name an 'identifier' or 'string' field (got \"%s\")" % (gw, name))
                elif J.truthy(_g(f, "line")) != line_like:
                    errors.append('%s: "%s" is a %s field but the condition is %s-scope' % (gw, name, "line" if J.truthy(_g(f, "line")) else "document", scope_word))
                has_in, has_not = "in" in o, "not_in" in o
                if has_in == has_not:
                    errors.append('%s: give exactly one of "in" or "not_in"' % gw)
                    continue
                lst = o["in"] if has_in else o["not_in"]
                if not isinstance(lst, list) or len(lst) == 0 or any(not isinstance(x, str) or J.trim(x) == "" for x in lst):
                    errors.append('%s: "%s" must be a non-empty array of non-empty strings' % (gw, "in" if has_in else "not_in"))
                continue
            if o.get("op", UNDEF) not in VALID_GUARD_OPS:
                errors.append('%s: invalid op "%s" (= != < <= > >=)' % (gw, _q(o.get("op", UNDEF))))
            t = o.get("tol", UNDEF)
            if t is not UNDEF and not (J.is_num(t) and t >= 0):
                errors.append('%s: "tol" must be a number >= 0' % gw)
            for side in ("left", "right"):
                check_side(o.get(side, UNDEF), '%s."%s"' % (gw, side), gw, scope)

    def check_new_options(c, where, scope, is_identifier):
        if _g(c, "remedy") is not UNDEF:
            errors.extend(RM.remedy_declaration_problems(c["remedy"], "%s.remedy" % where))
        et = _g(c, "exact_tolerance")
        if et is not UNDEF:
            if not isinstance(et, bool):
                errors.append('%s: "exact_tolerance" must be true or false' % where)
            elif is_identifier and et:
                errors.append('%s: "exact_tolerance" applies to numeric checks only' % where)
            elif et and _g(c, "rounding") == "infer":
                warnings.append('%s: "exact_tolerance" takes precedence; rounding inference is not applied' % where)
        adv = _g(c, "advisory")
        if adv is not UNDEF and not isinstance(adv, bool):
            errors.append('%s: "advisory" must be true or false' % where)
        elif adv is True:
            warnings.append("%s: advisory; the check never makes a claim (a failure is counsel on the verdict)" % where)
        fiu = _g(c, "fail_if_unreadable")
        if fiu is not UNDEF:
            if is_identifier:
                errors.append('%s: "fail_if_unreadable" applies to numeric checks only' % where)
            elif not isinstance(fiu, list) or len(fiu) == 0 or any(not isinstance(x, str) for x in fiu):
                errors.append('%s: "fail_if_unreadable" must be a non-empty array of role names' % where)
            else:
                refs = set(_safe_refs(_g(c, "left")) + _safe_refs(_g(c, "right")))
                if isinstance(_g(c, "alternatives"), list):
                    for a in c["alternatives"]:
                        refs |= set(_safe_refs(_g(a, "left")) + _safe_refs(_g(a, "right")))
                for r in fiu:
                    if r not in refs:
                        errors.append('%s."fail_if_unreadable": "%s" is not an operand of the check' % (where, r))
        if _g(c, "applies_if") is not UNDEF:
            lint_applicability(c["applies_if"], where, scope)
        ab = _g(c, "abstain")
        if ab is not UNDEF:
            if not isinstance(ab, str) or J.trim(ab) == "":
                errors.append('%s: "abstain" must be a non-empty string (the reason the check never decides)' % where)
            else:
                warnings.append("%s: declared abstention; the check never decides (%s)" % (where, J.slice16(ab, 0, 77) + "..." if J.utf16_len(ab) > 80 else ab))
        gr = _g(c, "guard_reason")
        if gr is not UNDEF:
            if not isinstance(gr, str) or J.trim(gr) == "":
                errors.append('%s: "guard_reason" must be a non-empty string' % where)
            elif all(_g(c, k) is UNDEF for k in ("abstain_if_present", "abstain_unless_all_present", "abstain_if", "abstain_if_present_without")):
                warnings.append('%s: "guard_reason" is set but the check has no abstain guard' % where)
        apw = _g(c, "abstain_if_present_without")
        if apw is not UNDEF:
            if not isinstance(apw, list) or len(apw) == 0 or any(not isinstance(g, dict) or not isinstance(g.get("present"), str) or not isinstance(g.get("without"), str) for g in apw):
                errors.append('%s: "abstain_if_present_without" must be a non-empty array of { present, without } role names' % where)
            else:
                for g in apw:
                    for r in (g["present"], g["without"]):
                        used.add(r)
                        if r not in all_roles:
                            errors.append('%s."abstain_if_present_without": unknown role "%s"' % (where, r))
                        elif scope == "line" and r not in line_roles:
                            errors.append('%s."abstain_if_present_without": a line-scope check can only name line fields ("%s" is not one)' % (where, r))
                        elif scope == "document" and r in line_roles:
                            errors.append('%s."abstain_if_present_without": a document-scope check cannot name the per-line field "%s"' % (where, r))
        rd = _g(c, "rounding")
        if rd is not UNDEF:
            if is_identifier:
                errors.append('%s: "rounding" applies to numeric checks only' % where)
            elif rd not in VALID_ROUNDING:
                errors.append('%s: invalid rounding "%s" (none | infer)' % (where, _q(rd)))
        alts = _g(c, "alternatives")
        if alts is not UNDEF:
            if is_identifier and _g(c, "compare") == "identifier":
                if not isinstance(alts, list) or len(alts) == 0:
                    errors.append('%s: "alternatives" must be a non-empty array of { left, right }' % where)
                else:
                    for j, a in enumerate(alts):
                        for side in ("left", "right"):
                            name = J.trim(a[side]) if isinstance(a, dict) and isinstance(a.get(side), str) else ""
                            used.add(name)
                            f = fget(name)
                            if not J.truthy(f) or _g(f, "kind") != "identifier":
                                errors.append("%s.alternatives[%d].\"%s\": an identifier check must name an 'identifier' field (got \"%s\")" % (where, j, side, name))
                            elif J.truthy(_g(f, "line")) != (scope == "line"):
                                errors.append('%s.alternatives[%d]."%s": "%s" is a %s field but the check is %s-scope' % (where, j, side, name, "line" if J.truthy(_g(f, "line")) else "document", scope))
            elif is_identifier:
                errors.append('%s: "alternatives" apply to numeric and identifier checks only' % where)
            elif not isinstance(alts, list) or len(alts) == 0:
                errors.append('%s: "alternatives" must be a non-empty array of { left, right }' % where)
            else:
                for j, a in enumerate(alts):
                    aw = "%s.alternatives[%d]" % (where, j)
                    if not isinstance(a, dict):
                        errors.append("%s: must be an object { left, right }" % aw)
                        continue
                    for side in ("left", "right"):
                        check_side(a.get(side, UNDEF), '%s."%s"' % (aw, side), aw, scope)
        for key in ("abstain_unless_all_present", "abstain_if_present"):
            lst = _g(c, key)
            if lst is UNDEF:
                continue
            if not isinstance(lst, list) or len(lst) == 0 or any(not isinstance(x, str) for x in lst):
                errors.append('%s: "%s" must be a non-empty array of role names' % (where, key))
                continue
            for r in lst:
                used.add(r)
                if r not in all_roles:
                    errors.append('%s."%s": unknown role "%s"' % (where, key, r))
                elif scope == "line" and r not in line_roles:
                    errors.append('%s."%s": a line-scope check can only name line fields ("%s" is not one)' % (where, key, r))
                elif scope == "document" and r in line_roles and not (key == "abstain_if_present" and _g(fget(r), "kind") in ("string", "identifier")):
                    errors.append('%s."%s": a document-scope check cannot name the per-line field "%s"' % (where, key, r))
        ai = _g(c, "abstain_if")
        if ai is not UNDEF:
            if not isinstance(ai, list) or len(ai) == 0:
                errors.append('%s: "abstain_if" must be a non-empty array of { left, op, right }' % where)
            else:
                for j, g in enumerate(ai):
                    gw = "%s.abstain_if[%d]" % (where, j)
                    if not isinstance(g, (dict, list)):
                        errors.append("%s: must be an object { left, op, right }" % gw)
                        continue
                    g = g if isinstance(g, dict) else {}  # an array is an object to JavaScript, with none of these keys
                    if g.get("op", UNDEF) not in VALID_GUARD_OPS:
                        errors.append('%s: invalid op "%s" (= != < <= > >=)' % (gw, _q(g.get("op", UNDEF))))
                    t = g.get("tol", UNDEF)
                    if t is not UNDEF and not (J.is_num(t) and t >= 0):
                        errors.append('%s: "tol" must be a number >= 0' % gw)
                    for side in ("left", "right"):
                        check_side(g.get(side, UNDEF), '%s."%s"' % (gw, side), gw, scope)
        if not is_identifier:
            forms = [{"left": _g(c, "left"), "right": _g(c, "right")}] + (list(alts) if isinstance(alts, list) else [])
            for j, f in enumerate(forms):
                if not isinstance(f, dict) or not isinstance(f.get("left"), str) or not isinstance(f.get("right"), str):
                    continue
                try:
                    r = X.role_refs_v040(f["left"], f["right"])
                    if len(r["required"]) == 0 and len(r["optional"]) > 0:
                        warnings.append("%s%s: every operand is optional (%s); the form abstains when none of them is reported" % (
                            where, ".alternatives[%d]" % (j - 1) if j else "", ", ".join(r["optional"])))
                except X.ExprError:
                    pass

    def check_doc_keys(c, where):
        nr = _g(c, "narrowing")
        if nr is not UNDEF and (not isinstance(nr, list) or any(not isinstance(x, str) or J.trim(x) == "" for x in nr)):
            errors.append('%s: "narrowing" must be an array of non-empty strings' % where)
        so = _g(c, "source")
        if so is not UNDEF:
            if not isinstance(so, dict) or not isinstance(so.get("file"), str) or not isinstance(so.get("sha256"), str) or not J.is_num(so.get("line", UNDEF)) or not isinstance(so.get("assert_id"), str):
                errors.append('%s: "source" must be an object with file, sha256, line and assert_id' % where)
        cf = _g(c, "compiled_from")
        if cf is not UNDEF and (not J.truthy(cf) or not isinstance(cf, dict) or not isinstance(cf.get("compiler"), str)):
            errors.append('%s: "compiled_from" must be an object naming the compiler' % where)
        he = _g(c, "hand_edited")
        if he is not UNDEF and not isinstance(he, bool):
            errors.append('%s: "hand_edited" must be true or false' % where)
    for role, f in J.entries(fields):
        tk = _g(f, "term_key")
        if tk is not UNDEF and (not isinstance(tk, str) or J.trim(tk) == ""):
            errors.append('field "%s": "term_key" must be a non-empty string' % role)
    for role, f in J.entries(fields):
        he = _g(f, "hand_edited")
        if he is not UNDEF and not isinstance(he, bool):
            errors.append('field "%s": "hand_edited" must be true or false' % role)
    cfr = _g(R, "compiled_from")
    if cfr is not UNDEF and (not J.truthy(cfr) or not isinstance(cfr, dict) or not isinstance(cfr.get("compiler"), str) or not isinstance(cfr.get("compiler_version"), str)):
        errors.append('"compiled_from" must be an object naming the compiler and its version')

    for i, c in enumerate(checks):
        code = _g(c, "code")
        where = "check[%d]%s" % (i, " (%s)" % _q(code) if J.truthy(code) else "")
        if not isinstance(code, str) or len(code) == 0:
            errors.append('%s: missing "code"' % where)
        op = _g(c, "op")
        if op not in VALID_OPS:
            errors.append('%s: invalid op "%s"' % (where, _q(op)))
        scope = _g(c, "scope")
        scope = "document" if (scope is UNDEF or scope is None) else scope
        cmp_ = _g(c, "compare")
        if cmp_ is not UNDEF and cmp_ not in VALID_COMPARE:
            errors.append('%s: invalid compare "%s" (number | identifier)' % (where, _q(cmp_)))
            continue
        if _g(c, "in") is not UNDEF and cmp_ != "member":
            errors.append('%s: "in" belongs to a compare: "member" check' % where)
        if cmp_ == "member":
            if op not in ("=", "!="):
                errors.append("%s: a member check supports only = and !=" % where)
            name = J.trim(c["left"]) if isinstance(c.get("left"), str) else ""
            used.add(name)
            f = fget(name)
            if not J.truthy(f) or _g(f, "kind") not in ("identifier", "string"):
                errors.append("%s.\"left\": a member check must name an 'identifier' or 'string' field (got \"%s\")" % (where, name))
            elif J.truthy(_g(f, "line")) != (scope == "line"):
                errors.append('%s."left": "%s" is a %s field but the check is %s-scope' % (where, name, "line" if J.truthy(_g(f, "line")) else "document", scope))
            cin = _g(c, "in")
            if not isinstance(cin, list) or len(cin) == 0 or any(not isinstance(x, str) or J.trim(x) == "" for x in cin):
                errors.append('%s: "in" must be a non-empty array of non-empty codes' % where)
            if not isinstance(_g(c, "right"), str):
                errors.append('%s: "right" must be a string (it documents the list)' % where)
            if _g(c, "alternatives") is not UNDEF:
                errors.append('%s: "alternatives" do not apply to a member check' % where)
            c2 = dict(c)
            c2.pop("alternatives", None)
            check_new_options(c2, where, scope, True)
            check_doc_keys(c, where)
            continue
        if cmp_ == "identifier":
            if op not in ("=", "!="):
                errors.append("%s: an identifier check supports only = and !=" % where)
            for side in ("left", "right"):
                name = J.trim(c[side]) if isinstance(c.get(side), str) else ""
                used.add(name)
                f = fget(name)
                if not J.truthy(f) or _g(f, "kind") != "identifier":
                    errors.append("%s.\"%s\": an identifier check must name an 'identifier' field (got \"%s\")" % (where, side, name))
                elif J.truthy(_g(f, "line")) != (scope == "line"):
                    errors.append('%s."%s": "%s" is a %s field but the check is %s-scope' % (where, side, name, "line" if J.truthy(_g(f, "line")) else "document", scope))
            check_new_options(c, where, scope, True)
            check_doc_keys(c, where)
            continue
        for side in ("left", "right"):
            check_side(_g(c, side), '%s."%s"' % (where, side), where, scope)
        check_new_options(c, where, scope, False)
        check_doc_keys(c, where)

    if row_sets_raw is not UNDEF and not isinstance(row_sets_raw, dict):
        errors.append('"row_sets" must be an object mapping each name to a non-empty array of conditions')
    for name, conds in J.entries(row_sets):
        if not re.match(r"[A-Za-z_][A-Za-z0-9_]*\Z", name):
            errors.append('row_sets "%s": a row set name is a plain name (letters, digits, _)' % name)
        if name in all_roles:
            errors.append('row_sets "%s": "%s" is also a role: names must be unique' % (name, name))
        lint_applicability(conds, 'row_sets "%s"' % name, "row_set")

    quotes = _g(R, "quotes")
    if quotes is not UNDEF:
        if not isinstance(quotes, list) or len(quotes) == 0:
            errors.append('"quotes" must be a non-empty array of { id, quote, label?, applies_if?, remedy? }')
        else:
            seen = set()
            for i, q in enumerate(quotes):
                o = q if isinstance(q, dict) else {}
                where = "quotes[%d]%s" % (i, " (%s)" % o["id"] if isinstance(o.get("id"), str) else "")
                if not isinstance(o.get("id"), str) or J.trim(o["id"]) == "":
                    errors.append('%s: missing "id"' % where)
                elif o["id"] in seen:
                    errors.append('%s: duplicate id "%s"' % (where, o["id"]))
                else:
                    seen.add(o["id"])
                if not isinstance(o.get("quote"), str) or J.trim(o["quote"]) == "":
                    errors.append('%s: "quote" must be a non-empty string' % where)
                if o.get("label", UNDEF) is not UNDEF and not isinstance(o.get("label"), str):
                    errors.append('%s: "label" must be a string' % where)
                if o.get("applies_if", UNDEF) is not UNDEF:
                    lint_applicability(o["applies_if"], where, "document")
                if o.get("remedy", UNDEF) is not UNDEF:
                    errors.extend(RM.remedy_declaration_problems(o["remedy"], "%s.remedy" % where))

    referenced_by_computed = set()
    for formula in [v for _, v in J.entries(computed_d)]:
        referenced_by_computed |= set(_all_underlying(formula))
    for formula in [v for _, v in J.entries(lc)]:
        referenced_by_computed |= set(_all_underlying(formula))
    for r in all_roles:
        if r not in slot_ids and r not in used and r not in referenced_by_computed:
            warnings.append('role "%s" is defined but never used in a check' % r)

    if slot_list:
        _lint_slots(R, slot_list, slot_ids, computed_d, lc, checks, row_sets, errors, warnings)
    return {"ok": len(errors) == 0, "errors": errors, "warnings": warnings}


def _lint_slots(R, slot_list, slot_ids, computed, lc, checks, row_sets, errors, warnings):
    memo = {}

    def roles_of(role, seen):
        if role in memo:
            return memo[role]
        out = [role]
        if role in seen:
            return out
        seen.add(role)
        f = computed.get(role, lc.get(role, UNDEF)) if role in computed or role in lc else UNDEF
        if isinstance(f, str):
            for r in _all_underlying(f):
                for x in roles_of(r, seen):
                    if x not in out:
                        out.append(x)
        memo[role] = out
        return out

    def exprs_of(c):
        out = [_g(c, "left"), _g(c, "right")]
        for a in (_g(c, "alternatives") if isinstance(_g(c, "alternatives"), list) else []):
            out += [_g(a, "left"), _g(a, "right")]
        for g in (_g(c, "abstain_if") if isinstance(_g(c, "abstain_if"), list) else []):
            out += [_g(g, "left"), _g(g, "right")]
        for g in (_g(c, "applies_if") if isinstance(_g(c, "applies_if"), list) else []):
            if isinstance(g, dict) and "left" in g:
                out += [g.get("left"), g.get("right")]
        sp = _g(c, "support")
        if isinstance(sp, dict):
            out += [sp.get("field"), sp.get("max_of")]
        return [e for e in out if isinstance(e, str)]
    depended, read_in_arith = {}, set()
    for c in checks:
        deps = []
        for e in exprs_of(c):
            for ref in _refs_of(e):
                for x in roles_of(ref["role"], set()):
                    if x not in deps:
                        deps.append(x)
                if ref["kind"] == "agg" and "set" in ref:
                    for g in (row_sets.get(ref["set"]) if isinstance(row_sets.get(ref["set"]), list) else []):
                        if isinstance(g, dict) and "left" in g:
                            for e2 in (g.get("left"), g.get("right")):
                                for r2 in _all_underlying(e2):
                                    for x in roles_of(r2, set()):
                                        if x not in deps:
                                            deps.append(x)
        for s in slot_list:
            if isinstance(s.get("governs"), list) and _g(c, "code") in s["governs"] and isinstance(s.get("id"), str) and s["id"] not in deps:
                deps.append(s["id"])
        for d in deps:
            if d in slot_ids:
                depended.setdefault(d, []).append(_g(c, "code"))
    for f in [v for _, v in J.entries(computed)] + [v for _, v in J.entries(lc)] + [e for c in checks for e in exprs_of(c)]:
        for r in _all_underlying(f):
            if r in slot_ids:
                read_in_arith.add(r)
    for s in slot_list:
        sid = s.get("id")
        if not isinstance(sid, str):
            continue
        codes = depended.get(sid, [])
        uc = ", ".join(_uniq([J.js_str(x) for x in codes]))
        if codes and s.get("load_bearing") is False:
            errors.append('choice "%s": the checks %s depend on it, so it is load-bearing (declare "load_bearing": true)' % (sid, uc))
        if codes and s.get("not_applicable", UNDEF) is not UNDEF:
            errors.append('choice "%s": declared not applicable, and the checks %s depend on it' % (sid, uc))
        if not codes and s.get("load_bearing") is True:
            warnings.append('choice "%s": declared load-bearing, and no check depends on it (name the checks it governs with "governs")' % sid)
        if codes and s.get("load_bearing") is True and s.get("default", UNDEF) is UNDEF and s.get("not_applicable", UNDEF) is UNDEF:
            warnings.append('choice "%s": load-bearing with no default: a document that does not state it, with no value from the judge, leaves %s abstaining (choice_unstated)' % (sid, uc))
        d = s.get("default", UNDEF)
        if sid in read_in_arith and isinstance(d, dict) and d.get("value", UNDEF) is not UNDEF and not J.is_num(d["value"]):
            errors.append('choice "%s": an expression reads it, and its default is %s, not a number' % (sid, J.stringify(d["value"])))
