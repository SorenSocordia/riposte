# Replay a stored declarative verdict: re-perform it and compare it byte for byte. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
    python3 conformance/engine_py/declarative/replay.py <bundle.json | cases.jsonl | folder> [--strict] [--lenient-remedies] [--allow-unknown-keys]
    python3 conformance/engine_py/declarative/replay.py <verdict.json> --extraction <file> --ruleset <name | file> [--source <file>] [--quotes <file>]

A port of the declarative path of packages/verify/src/protocol/replay.ts (verifyReplay, reperform, compareBodies,
pinnedRemedyProblem) and protocol/replay-case.ts (replayBundle, unknownKeys), in the conventions engine.py's replay already
follows: the binding (verdict_id, then input_hash) is riposte_bind.check_bundle, imported unchanged; the keys a file carries
outside the verdict and its inputs, the allowed caller keys, the exempt set, the first difference, the case lines and the folder
exit are engine.py's functions, imported unchanged. A declarative bundle ({ verdict, inputs: { extraction, ruleset, source?,
tolerance? }, options? }) is re-performed under the engine label the verdict names with interpret.py, and a reconciliation bundle
({ documents, ruleset }) with reconcile.py. Any other bundle is structure-verified and named as not re-performed here (an
invoice@0.1.0 bundle is engine.py's).

Exit codes, the engine's replay scale (docs/INTERCHANGE.md section 13): 0 VERIFIED · 1 FAILED (the binding, a divergence named at
its first field, deleted remedies, or --strict) · 2 structure verified, the outcome not re-performed (named) · 3 refused (not a
verdict, refused before hashing, a key the bundle format does not define, a signed envelope, or a usage error). A folder or a .jsonl
exits 3 whenever a case was refused, else 1 when one diverged, else 2 when one was not re-performed, else 0.

Entry points for a caller: replay_parsed(bundle, strict=False, lenient_remedies=False, allow_unknown_keys=False) returns
(exit, result, lines, case); replay_bytes(data, name, ...) returns (exit, result, lines); replay_cases(path, ...) returns
(exit, summary, stderr text); is_mine(bundle) says whether this module re-performs a bundle.
"""

import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import jsrt as J  # noqa: E402
from jsrt import UNDEF  # noqa: E402
import interpret as I  # noqa: E402
import reconcile as REC  # noqa: E402
import ruleset as RS  # noqa: E402
import issue as ISS  # noqa: E402

E = J.E
rb = J.rb

ANNOTATION_SHAPES = {"ledger": ["tenant_id", "retention_until", "reviewer"],
                     "declared_accuracy": ["domain", "ruleset_version", "fp_rate", "fn_rate", "abstain_rate", "measured_on"],
                     "action_context": ["tool_name", "call_id", "argument_path"],
                     "case": ["case_id", "prior_verdict_id", "move_id"]}
LEDGER_REVIEWER_SHAPE = ["id", "decided_at", "decision", "note"]
ALLOW_UNKNOWN_KEYS_LINE = ("--allow-unknown-keys was given: a key a bundle or a signed envelope does not define is named and carried, not "
                           "checked, instead of refused (the caller's stated choice; --strict still refuses it)")
NON_DECLARATIVE_IDS = ("invoice", "pay-app", "action", "legal", "ap-threeway", "ap-structured", "twin-einvoice")


def annotation_member_problem(verdict):
    """protocol/replay.ts annotationMemberProblem: an annotation member its declared shape does not have (refused)."""
    if not isinstance(verdict, dict):
        return None
    found = []

    def check(at, value, shape):
        if not isinstance(value, dict):
            return
        members = ["%s.%s" % (at, k) for k in J.keys(value) if k not in shape]
        if members:
            found.append((at, shape, members))
    for a in E.ANNOTATIONS:
        shape = ANNOTATION_SHAPES.get(a)
        if not shape:
            continue
        check(a, verdict.get(a), shape)
        if a == "ledger" and isinstance(verdict.get("ledger"), dict):
            check("ledger.reviewer", verdict["ledger"].get("reviewer"), LEDGER_REVIEWER_SHAPE)
    if not found:
        return None
    n = sum(len(m) for _, _, m in found)
    parts = ["the verdict's %s carries %s its declared shape { %s } does not have: %s" % (at, "a member" if len(m) == 1 else "members", ", ".join(s), ", ".join(m))
             for at, s, m in found]
    return "%s (an annotation is added after the engine and is never compared, so a member it does not declare is a claim nothing checks; remove %s: annotations sit outside what the verdict_id binds, so the verdict replays without %s)" % (
        "; ".join(parts), "it" if n == 1 else "them", "it" if n == 1 else "them")


def unknown_keys_reason(kind, keys):
    one = len(keys) == 1
    shape = ("a bundle is { verdict, inputs, options? } with the caller keys id and note, and beside an AP verdict the gate's fields, which a replay compares"
             if kind == "bundle" else "a signed envelope is { verdict, alg, public_key, signature }")
    return "the %s carries %s its format does not define: %s (%s; a replay checks nothing else, so it refuses what it would not check: remove %s, or replay with --allow-unknown-keys to have %s named and carried, not checked)" % (
        kind, "a key" if one else "keys", ", ".join(keys), shape, "it" if one else "them", "it" if one else "them")


def unknown_keys(bundle):
    """replay-case.ts unknownKeys for a bundle (an AP output is engine.py's and never this module's)."""
    if not isinstance(bundle, dict):
        return "bundle", []
    if E._is_envelope(bundle):
        return "signed envelope", E.carried_keys(bundle)
    if E._is_ap_output(bundle) or not E.is_replay_bundle(bundle):
        return "bundle", []
    return "bundle", E.carried_keys(bundle)


def is_declarative_inputs(inputs):
    return isinstance(inputs, dict) and "extraction" in inputs and "ruleset" in inputs and RS.is_declarative_ruleset(inputs["ruleset"])


def is_reconcile_inputs(inputs):
    return isinstance(inputs, dict) and "documents" in inputs and "ruleset" in inputs


def is_mine(bundle):
    """True for a bundle this module re-performs: declarative or reconciliation inputs beside a verdict."""
    return E.is_replay_bundle(bundle) and isinstance(bundle.get("inputs"), dict) and (is_declarative_inputs(bundle["inputs"]) or is_reconcile_inputs(bundle["inputs"]))


def pinned_remedy_problem(supplied):
    """protocol/replay.ts pinnedRemedyProblem: a carried ruleset's remedies are the carried ones, whatever a bundle says."""
    try:
        carried = RS.resolve_carried("%s@%s" % (supplied.get("id"), supplied.get("version")))
    except RS.RulesetRefused:
        return None
    if carried is None:
        return None
    if J.canonical(I.ruleset_identity(carried)) != J.canonical(I.ruleset_identity(supplied)):
        return None
    a, b = I.remedy_table_of(carried), I.remedy_table_of(supplied)
    if J.canonical(a) == J.canonical(b):
        return None
    for part in ("checks", "quotes"):
        for k in sorted(set(J.keys(a[part]) + J.keys(b[part])), key=lambda s: s.encode("utf-16-be", "surrogatepass")):
            if J.canonical(a[part].get(k)) == J.canonical(b[part].get(k)):
                continue
            return "the inputs carry ruleset %s@%s, which this build carries, but the remedy declared for %s %s is not the carried ruleset's: remedies are re-derived from the pinned ruleset, never taken from a bundle" % (
                supplied["id"], supplied["version"], "check" if part == "checks" else "quote", k)
    return "the inputs carry ruleset %s@%s, whose remedies are not the carried ruleset's" % (supplied["id"], supplied["version"])


def _reperform(verdict, inputs, tolerance):
    """reperform for a declarative or reconciliation bundle: {not} (not re-performed, why), {pinned, first}, or {again, engine}."""
    engine = verdict["engine_version"]
    if engine not in I.ENGINES:
        return {"not": "the verdict was issued by engine %s; this build re-performs engines %s only, and a check is re-performed only by the engine that made it" % (engine, " and ".join(I.ENGINES))}
    if not isinstance(inputs, dict):
        return {"not": "the inputs are not an object, so no engine takes them"}
    x = J.clone(inputs)
    doc = verdict.get("document")
    producer = doc.get("producer") if isinstance(doc, dict) and isinstance(doc.get("producer"), str) else UNDEF
    now = verdict["issued_at"] if isinstance(verdict.get("issued_at"), str) else "1970-01-01T00:00:00.000Z"
    tol = tolerance if tolerance is not None else (x["tolerance"] if isinstance(x.get("tolerance"), dict) else None)
    rs = verdict["ruleset"]
    if is_reconcile_inputs(x):
        name = "reconcile"
        try:
            again = REC.reconcile(x["documents"], x["ruleset"], {"now": now, "engine": engine})
        except (I.Outside, I.EngineError, KeyError, TypeError) as e:
            return {"not": "the %s engine could not run on these inputs (%s)" % (name, e)}
    elif "extraction" in x and "ruleset" in x and RS.is_declarative_ruleset(x["ruleset"]):
        name = "declarative"
        pinned = pinned_remedy_problem(x["ruleset"])
        if pinned is not None:
            return {"pinned": pinned, "first": "inputs.ruleset (remedies)", "engine": name}
        opts = {"now": now, "engine": engine}
        if producer is not UNDEF:
            opts["producer"] = producer
        if tol is not None:
            opts["tolerance"] = tol
        if isinstance(x.get("source"), dict):
            opts["source"] = x["source"]
        for k in ("evidence", "supplied_choices", "archive_files"):
            if k in x:
                opts[k] = x[k]
        try:
            again = I.verify_declarative(x["extraction"], x["ruleset"], opts)
        except I.Outside as e:
            return {"not": "outside what this build re-performs: %s" % e, "outside": True}
        except (I.InputRefused, I.EngineError) as e:
            return {"not": "the %s engine could not run on these inputs (%s)" % (name, e)}
    else:
        keys = ", ".join(sorted(J.keys(x)))
        return {"not": "no engine in this folder takes inputs shaped { %s } for ruleset %s@%s (an invoice bundle is conformance/engine_py/engine.py's)" % (keys, rs["id"], rs["version"]), "outside": True}
    if again["ruleset"]["id"] != rs["id"] or again["ruleset"]["version"] != rs["version"]:
        return {"not": "this build's %s engine is ruleset %s@%s; the verdict is %s@%s, and a check is re-performed only under the ruleset that made it" % (
            name, again["ruleset"]["id"], again["ruleset"]["version"], rs["id"], rs["version"])}
    return {"again": again, "engine": name}


def _compare(presented, again, engine_label):
    """compareBodies: (identical, first difference, remedies not carried)."""
    a = E._stripped(J.rb.read_json_bytes(J.pretty(again).encode("utf-8", "surrogatepass"), "verdict"))
    p = E._stripped(presented)
    binds = engine_label not in ("0.0.1", "0.1.0")
    not_carried = "remedies" not in presented and "remedies" in a and not binds
    if not_carried:
        del a["remedies"]
    identical = J.canonical(a) == J.canonical(p)
    first = None if identical else (E.first_difference(a, p) or "(canonical bytes)")
    return identical, first, not_carried


def replay_parsed(bundle, strict=False, lenient_remedies=False, allow_unknown_keys=False):
    """(exit code, result for stdout, lines for stderr, the case as a folder replay reports it) for a parsed file."""
    carried, allowed = E.carried_keys(bundle), E.allowed_keys(bundle)
    follow = ([E.carried_line(carried)] if carried else []) + ([ALLOW_UNKNOWN_KEYS_LINE] if allow_unknown_keys else []) + \
        ([E.allowed_line(allowed)] if allowed else [])
    carried_block = {}
    if carried:
        carried_block["carried_not_checked"] = carried
    if allowed:
        carried_block["carried_allowed"] = allowed
    presented = None
    if isinstance(bundle, dict):
        presented = bundle["verdict"]["verdict"] if E.is_replay_bundle(bundle) and E._is_envelope(bundle["verdict"]) else \
            bundle.get("verdict") if E.is_replay_bundle(bundle) else bundle
    vid = {"verdict_id": presented["verdict_id"]} if isinstance(presented, dict) and isinstance(presented.get("verdict_id"), str) else {}

    def done(code, status, lines, case, **extra):
        res = {"status": status}
        res.update(extra)
        res.update(carried_block)
        if allow_unknown_keys:
            res["allow_unknown_keys"] = "stated"
        if strict:
            res["strict"] = {"ok": False, "problems": []}
        return code, res, lines[:1] + follow + lines[1:], case

    def refused(why, lead=""):
        case = {"result": "REFUSED"}
        case.update(vid)
        case["reason"] = lead + why
        return done(3, "REFUSED", ["input refused: %s%s" % (lead, why)], case, reason=why)

    if not isinstance(bundle, dict):
        return refused(E.NOT_A_BUNDLE)
    if E.is_replay_bundle(bundle) and not allow_unknown_keys:
        kind, keys = unknown_keys(bundle)
        if keys:
            why = unknown_keys_reason(kind, keys)
            case = {"result": "REFUSED"}
            case.update(vid)
            case.update(reason=why, unknown_keys=keys)
            return 3, {"ok": False, "status": "REFUSED", "refused": True, "reason": why, "unknown_keys": keys}, ["input refused: %s" % why], case
    if E._is_envelope(bundle) or E._is_envelope(bundle.get("verdict")):
        return refused("a signed envelope: its signature is not checked by this build, so it is not replayed here", "outside what this build re-performs: ")
    problem = annotation_member_problem(presented)
    if problem:
        return refused(problem)
    try:
        bound = rb.check_bundle(bundle)
    except rb.Refused as e:
        return refused(E.replay_advice(str(e)))
    ids = {k: bound.get(k) for k in ("recorded_input_hash", "computed_input_hash", "recorded_verdict_id", "computed_verdict_id")}
    if bound["binding"] != "holds":
        why = bound["reasons"][0]
        first = "verdict_id" if why.startswith(("verdict_id does not derive", "a verdict of engine")) else "input_hash"
        case = {"result": "DIVERGED"}
        case.update(vid)
        case.update(first_difference=first, reason=why)
        return done(1, "FAILED", ["FAILED: %s" % why], case, reperformed=False, reason=why, **ids)
    verdict = bundle["verdict"] if isinstance(bundle.get("verdict"), dict) else bundle

    def not_here(why, words="structure verified; outcome NOT re-performed by this build"):
        case = {"result": "NOT_REPERFORMED"}
        case.update(vid)
        case["reason"] = "%s: %s" % (words, why)
        return done(2, "NOT_REPERFORMED", ["%s: %s. Exit 2." % (words, why)], case, reperformed=False, reason=why, **ids)
    if verdict is bundle or "inputs" not in bundle:
        return not_here("no inputs were supplied, so the check was not run again (the verdict_id binds the inputs, not the outcome)",
                        "structure verified; outcome NOT re-performed")
    if isinstance(verdict.get("algorithms"), list):
        return not_here("the verdict was made with pinned algorithms, which this build does not carry")
    options = bundle.get("options") if isinstance(bundle.get("options"), dict) else {}
    tolerance = options.get("tolerance") if isinstance(options.get("tolerance"), dict) else None
    r = _reperform(verdict, bundle.get("inputs"), tolerance)
    engine_label = verdict["engine_version"]
    if "not" in r:
        return not_here(r["not"])
    name = r["engine"]
    base = dict(reperformed=True, engine=name, **ids)
    annotations = E.not_reperformed_fields(verdict)
    if annotations:
        base["annotations"] = annotations

    def diverged(first_field, why):
        case = {"result": "DIVERGED"}
        case.update(vid)
        case.update(engine=name, first_difference=first_field, reason=why)
        return done(1, "FAILED", ["FAILED: %s" % why], case, first_difference=first_field, reason=why, **base)
    if "pinned" in r:
        return diverged(r["first"], r["pinned"])
    again = r["again"]
    if again["input_hash"] != verdict["input_hash"]:
        return diverged("input_hash", "the re-performed verdict differs from the presented one at `input_hash`: the check run again on these inputs does not give this verdict (%s, engine %s)" % (name, engine_label))
    identical, first, not_carried = _compare(verdict, again, engine_label)
    if identical and not_carried and not lenient_remedies:
        n = len(again.get("remedies", []))
        return diverged("remedies", "the verdict carries no remedies; the engine re-derives %d %s for it (engine %s); a replayed verdict must carry what it said. For a verdict issued before remedies existed, --lenient-remedies compares its core and reports the re-derived remedies" % (
            n, "remedy" if n == 1 else "remedies", engine_label))
    if not identical:
        named = ""
        m = re.match(r"^remedies\[(\d+)\]", first)
        if m and "remedies" in again and int(m.group(1)) < len(again["remedies"]) and again["remedies"][int(m.group(1))].get("clears"):
            named = " (the remedy that answers %s)" % ", ".join(again["remedies"][int(m.group(1))]["clears"])
        movable = re.match(r"^(claims|outcome|gate_status|coverage|remedies)(\b|\[|\.|$)", first) is not None
        hint = ". If it was issued under a rounding-tolerance override, restate it (a verdict issued before 2026-09-28 does not commit to it in input_hash)" if (movable and tolerance is None) else ""
        return diverged(first, "the re-performed verdict differs from the presented one at `%s`%s: the check run again on these inputs does not give this verdict (%s, engine %s)%s" % (
            first, named, name, engine_label, hint))
    rs = verdict["ruleset"]
    line = "outcome VERIFIED: re-performed with %s (ruleset %s@%s, engine %s) and byte-identical%s.%s" % (
        name, rs["id"], rs["version"], engine_label, "; " + E.ISSUED_AT_MISSING if "issued_at" not in verdict else ", issued_at aside",
        " Not re-performed (not the engine's output): %s." % ", ".join(annotations) if annotations else "")
    lines = [line, ISS.headline(verdict)]
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
            problems.append(E._outside_keys_problem(carried))
    claims = verdict["claims"] if isinstance(verdict.get("claims"), list) else []
    case = {"result": "MATCH"}
    case.update(vid)
    case.update(engine=name, answer=verdict["outcome"])
    if "remedies" in again:
        case["remedies"] = again["remedies"]
    if not_carried:
        case["remedies_not_carried"] = True
    case.update(checks=len(claims), unchecked=sum(1 for c in claims if isinstance(c, dict) and c.get("outcome") == "INSUFFICIENT_DATA"))
    if strict:
        case["strict_problems"] = problems
    if problems:
        lines.append("STRICT: FAILED: the outcome re-performed byte-identical, but not everything in the file was:\n%s" % "\n".join("  " + p for p in problems))
    code, res, lines, case = done(1 if problems else 0, "VERIFIED", lines, case, **base)
    if strict:
        res["strict"] = {"ok": not problems, "problems": problems}
    return code, res, lines, case


def replay_bytes(data, name, strict=False, lenient_remedies=False, allow_unknown_keys=False):
    """(exit code, result for stdout, lines for stderr) for one file's bytes."""
    try:
        bundle = E.read_json(data, name)
    except rb.Refused as e:
        why = E.replay_advice(str(e))
        return 3, {"status": "REFUSED", "reason": why}, ["input refused: %s" % why]
    code, res, lines, _ = replay_parsed(bundle, strict, lenient_remedies, allow_unknown_keys)
    return code, res, lines


def render_case(c, verdict, not_reperformed, carried, allowed):
    """engine.py's case line (renderCaseReplay), with the gate headline of a declarative verdict (held as suspect, struck fields)."""
    ok = c["result"] == "MATCH" and isinstance(verdict, dict) and isinstance(verdict.get("claims"), list) and isinstance(verdict.get("outcome"), str)
    gate_words = ISS.headline(verdict) if ok else None
    if c.get("answer") and gate_words is None:
        gate_words = c["answer"]
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
        out += "\n    " + E.carried_line(carried)
    if allowed:
        out += "\n    " + E.allowed_line(allowed)
    if c["result"] == "MATCH" and not_reperformed:
        out += "\n    not re-performed (not the engine's output): %s" % ", ".join(not_reperformed)
    out += "".join("\n    remedy: %s" % line for line in E.render_remedies(c.get("remedies")))
    if c.get("remedies_not_carried"):
        out += ("\n    remedies absent; re-derived: the verdict carries no remedies (issued before engine 0.2.0 bound them, or removed "
                "since); these are this build's, and its core matched")
    if c["result"] == "MATCH" and isinstance(verdict, dict) and "issued_at" not in verdict and "strict_problems" not in c:
        out += "\n    " + E.ISSUED_AT_MISSING
    out += "".join("\n    STRICT: %s" % p for p in c.get("strict_problems") or [])
    return out


def replay_cases(path, strict=False, lenient_remedies=False, allow_unknown_keys=False):
    """(exit code, summary for stdout, text for stderr) for a folder (its *.json and *.jsonl, name order) or a .jsonl file."""
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
            items.append((name, E._Unread("cannot read %s: %s" % (name, e.strerror))))
            continue
        items.extend(E._bundles_from(name, data))
    if not items:
        return 3, None, "replay: %s holds no bundles (*.json or *.jsonl)\n" % path
    cases, fields, carried_map, allowed_map = [], {}, {}, {}
    for name, b in items:
        if isinstance(b, E._Unread):
            c = {"result": "REFUSED", "reason": b.reason}
        elif not E.is_replay_bundle(b):
            c = {"result": "REFUSED", "reason": E.NOT_A_BUNDLE}
        else:
            c = replay_parsed(b, strict, lenient_remedies, allow_unknown_keys)[3]
        case = {"name": name}
        case.update(c)
        cases.append(case)
        if isinstance(b, E._Unread):
            continue
        if case["result"] == "MATCH":
            f = E.not_reperformed_fields(E._presented_of(b))
            if f:
                fields[name] = f
        k = E.carried_keys(b) if (E.is_replay_bundle(b) and "unknown_keys" not in case) else []
        if k:
            carried_map[name] = k
        a = E.allowed_keys(b)
        if a:
            allowed_map[name] = a

    def count(r):
        return sum(1 for c in cases if c["result"] == r)
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
        verdict = None if isinstance(b, E._Unread) else E._presented_of(b)
        err.append(render_case(c, verdict, fields.get(name, []), carried_map.get(name, []), allowed_map.get(name, [])) + "\n")
    for d in skipped:
        err.append("SKIPPED         %s/\n    a folder: a folder replay does not walk into folders. Replay it on its own: "
                   "python3 conformance/engine_py/declarative/replay.py %s\n" % (d, os.path.join(path, d)))
    if allow_unknown_keys:
        err.append("replay: %s\n" % ALLOW_UNKNOWN_KEYS_LINE)
    err.append("replay: %d case(s): %d match · %d diverged · %d not re-performed · %d refused\n" % (
        s["total"], s["matched"], s["diverged"], s["not_reperformed"], s["refused"]))
    if strict and s["strict_failed"] > 0:
        err.append("replay: STRICT: FAILED: %d matching case(s) carry something that was not re-performed (each is listed above)\n" % s["strict_failed"])
    return E.replay_exit(s), s, "".join(err)


def replay_ruleset_ref(arg, verdict):
    """protocol/replay.ts replayRulesetRef: a carried name without @version means the version the verdict names."""
    if "@" in arg or not RS.is_carried_name(arg) or not isinstance(verdict, dict) or not isinstance(verdict.get("ruleset"), dict) \
            or not isinstance(verdict["ruleset"].get("version"), str):
        return arg
    id_ = RS.DOMAIN_DEFAULTS.get(arg, arg)
    return "%s@%s" % (id_, verdict["ruleset"]["version"]) if id_ == verdict["ruleset"].get("id") else arg


def inputs_from_files(verdict, extraction_path, ruleset_arg, source_path=None, quotes_path=None):
    """verifyInputsFrom for a declarative ruleset: { extraction, ruleset, source? }, read as `verify <doc> --ruleset --source` reads them."""
    with open(extraction_path, "rb") as fh:
        extraction = E.read_json(fh.read(), extraction_path)
    rs = RS.load_ruleset(replay_ruleset_ref(ruleset_arg, verdict))
    if quotes_path is not None and source_path is None:
        raise ValueError("--quotes are found in --source: give the source text too")
    opts = {}
    if source_path is not None:
        src = {"text": ISS._read_text(source_path)}
        if quotes_path is not None:
            src["quotes"] = ISS.read_quotes(quotes_path)
        opts["source"] = src
    return I.declarative_inputs(extraction, rs, opts)


USAGE = ("usage: python3 conformance/engine_py/declarative/replay.py <bundle.json | cases.jsonl | folder> [--strict] [--lenient-remedies] [--allow-unknown-keys]\n"
         "       python3 conformance/engine_py/declarative/replay.py <verdict.json> --extraction <file> --ruleset <name | file> [--source <file>] [--quotes <file>]")


def main(argv, out=sys.stdout, err=sys.stderr):
    args = list(argv)
    vals, flags, files = {}, set(), []
    while args:
        a = args.pop(0)
        if a.startswith("--") and "=" in a:
            k, v = a[2:].split("=", 1)
            args.insert(0, v)
            a = "--" + k
        if a in ("--extraction", "--ruleset", "--source", "--quotes"):
            if not args:
                err.write("replay: %s needs a value\n%s\n" % (a, USAGE))
                return 3
            vals[a[2:]] = args.pop(0)
        elif a in ("--strict", "--lenient-remedies", "--allow-unknown-keys"):
            flags.add(a[2:])
        elif a.startswith("-") and a != "-":
            err.write("replay: unknown option %s\n%s\n" % (a, USAGE))
            return 3
        else:
            files.append(a)
    if len(files) != 1:
        err.write("replay: one file per call\n%s\n" % USAGE)
        return 3
    path = files[0]
    strict, lenient, allow = "strict" in flags, "lenient-remedies" in flags, "allow-unknown-keys" in flags
    if os.path.isdir(path) or re.search(r"\.jsonl\Z", path, re.I):
        if vals:
            err.write("replay: a folder or .jsonl of bundles carries each case's own inputs: give no --extraction\n")
            return 3
        code, summary, text = replay_cases(path, strict, lenient, allow)
        if summary is not None:
            out.write(J.pretty(summary) + "\n")
        err.write(text)
        return code
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError as e:
        err.write("replay: cannot read %s: %s\n" % (path, e.strerror))
        return 3
    if vals:
        if "extraction" not in vals or "ruleset" not in vals:
            err.write("replay: --extraction and --ruleset build the inputs a declarative verdict is bound to: give both\n")
            return 3
        try:
            verdict = E.read_json(data, path)
            inputs = inputs_from_files(verdict, vals["extraction"], vals["ruleset"], vals.get("source"), vals.get("quotes"))
        except rb.Refused as e:
            err.write("replay: input refused: %s\n" % E.replay_advice(str(e)))
            return 3
        except RS.RulesetRefused as e:
            err.write("replay: %s\n" % e)
            return 3
        except (OSError, ValueError) as e:
            err.write("replay: %s\n" % (e.strerror if isinstance(e, OSError) else e))
            return 3
        code, result, lines, _ = replay_parsed({"verdict": verdict, "inputs": inputs}, strict, lenient, allow)
    else:
        code, result, lines = replay_bytes(data, path, strict, lenient, allow)
    out.write(J.pretty(result) + "\n")
    for i, line in enumerate(lines):
        if i == 0 or line.startswith(("STRICT", "carried, not checked: ", "carried (allowed): ", "--allow-unknown-keys")):
            err.write("replay: %s\n" % line)
        else:
            err.write("%s%s\n" % ("" if line.startswith(" ") else "  ", line))
    return code


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")
    sys.exit(main(sys.argv[1:]))
