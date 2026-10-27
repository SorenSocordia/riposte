# Issue a declarative verdict, as `node packages/verify/dist/cli.js <extraction.json> --ruleset <r>` issues it. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
    python3 conformance/engine_py/declarative/issue.py <extraction.json> --ruleset <name | file.json> [--source <file.txt>]
            [--quotes <file.json>] [--engine <version>] [--issued-at <YYYY-MM-DDTHH:MM:SS.mmmZ>] [--producer <label>] [--allow-open]

The verdict goes to stdout exactly as the Node engine writes it (two-space JSON and a newline); the headline to stderr. The
input_hash, remedy_table_hash, verdict_id, canonical JSON and the two-space writer are engine.py's and riposte_bind.py's,
imported unchanged. Exit codes are the engine's `check` scale (verdict/exit.ts): 0 a clean PASS · 1 FAIL or HELD-SUSPECT ·
2 PASS-WITH-OPEN, OPEN or INSUFFICIENT_DATA (--allow-open: 0 when each open check waits on a reference or a missing field, with
no field struck) · 3 refused, a usage error, or outside what this build re-performs (named).
"""

import math
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import jsrt as J  # noqa: E402
from jsrt import UNDEF  # noqa: E402
import numread as N  # noqa: E402
import interpret as I  # noqa: E402
import ruleset as RS  # noqa: E402

E = J.E
rb = J.rb

_SHAPE = '{ "rel": <number ≥ 0>, "absCap": <number ≥ 0>, "roundingCap"?: { "perLine"?: [<rule id>...], "cashStep"?: [<rule id>...] }, "rounding"?: "infer" | "none" }'


def is_declarative_ruleset(x):
    """declarative/types.ts isDeclarativeRuleset: fields an object (null passes, as typeof null is 'object'), checks a list, no compute."""
    return isinstance(x, dict) and "compute" not in x and (x.get("fields", UNDEF) is None or isinstance(x.get("fields"), (dict, list))) \
        and isinstance(x.get("checks"), list)


def tolerance_problem(t):
    """tolerance.ts toleranceProblem"""
    if not isinstance(t, dict):
        return "tolerance must be an object %s" % _SHAPE
    extra = [k for k in J.keys(t) if k not in ("rel", "absCap", "roundingCap", "rounding")]
    if extra:
        return "tolerance carries %s, which no engine reads (so its identity would not commit to it); the shape is %s" % (", ".join(J.js_string(k) for k in extra), _SHAPE)
    for k in ("rel", "absCap"):
        v = t.get(k, UNDEF)
        if not J.is_num(v) or not math.isfinite(v) or v < 0:
            shown = J.js_str(v) if J.is_num(v) else (J.stringify(v) if J.stringify(v) is not UNDEF else ("undefined" if v is UNDEF else "object"))
            return "tolerance.%s must be a finite number ≥ 0 (got %s)" % (k, shown)
    r = t.get("rounding", UNDEF)
    if r is not UNDEF and r not in ("infer", "none"):
        return "tolerance.rounding must be \"infer\" or \"none\" (got %s)" % J.stringify(r)
    rc = t.get("roundingCap", UNDEF)
    if rc is not UNDEF:
        if not isinstance(rc, dict):
            return 'tolerance.roundingCap must be an object { "perLine"?: [<rule id>...], "cashStep"?: [<rule id>...] }'
        extra = [k for k in J.keys(rc) if k not in ("perLine", "cashStep")]
        if extra:
            return 'tolerance.roundingCap carries %s, which no engine reads; it takes "perLine" and "cashStep"' % ", ".join(J.js_string(k) for k in extra)
        for k in ("perLine", "cashStep"):
            v = rc.get(k, UNDEF)
            if v is UNDEF:
                continue
            if not isinstance(v, list):
                return "tolerance.roundingCap.%s must be an array of rule-id strings, such as [\"TAX_INT\"] (got %s): a string would be read one character at a time by the hash but as one id by the engine" % (
                    k, "the string %s" % J.js_string(v) if isinstance(v, str) else J.stringify(v))
            bad = next((i for i, x in enumerate(v) if not isinstance(x, str)), -1)
            if bad >= 0:
                return "tolerance.roundingCap.%s[%d] must be a rule-id string (got %s)" % (k, bad, J.stringify(v[bad]))
    return None


def assert_hashable_inputs(extraction, options):
    """verify.ts assertHashableInputs, for a declarative ruleset's inputs."""
    if options.get("tolerance", UNDEF) is not UNDEF:
        p = tolerance_problem(options["tolerance"])
        if p:
            raise I.InputRefused("tolerance", "verify: %s" % p)
    parts = [("extraction", "the extraction", extraction), ("source", "source", options.get("source", UNDEF)),
             ("tolerance", "tolerance", options.get("tolerance", UNDEF)), ("supplied_choices", "supplied_choices", options.get("supplied_choices", UNDEF)),
             ("archive_files", "archive_files", options.get("archive_files", UNDEF))]
    for inp, name, value in parts:
        if value is UNDEF:
            continue
        at = N.non_finite_path(value)
        if at is not None:
            raise I.InputRefused(inp, "verify: %s" % N.non_finite_refusal(name, at))
    try:
        engine = I.engine_for(options.get("engine", UNDEF))
    except I.EngineError:
        engine = None
    if engine is not None and I.at_least(engine, "0.6.0"):
        for inp, name, value in parts:
            if value is UNDEF:
                continue
            at = N.unsafe_magnitude_path(value)
            if at is not None:
                raise I.InputRefused(inp, "verify: %s" % N.unsafe_magnitude_refusal(name, at, N.value_at_path(value, at)))


def verify(extraction, options):
    """verify(extraction, { ruleset: <declarative>, now?, producer?, tolerance?, source?, engine? })"""
    if extraction is None or extraction is UNDEF:
        raise I.InputRefused("extraction", "verify: the extraction is null: there is no document to verify (pass the extracted fields as a JSON object)")
    assert_hashable_inputs(extraction, options)
    engine = I.engine_for(options.get("engine", UNDEF))
    rs = options.get("ruleset", UNDEF)
    if not is_declarative_ruleset(rs):
        raise I.Outside("the ruleset is not a declarative ruleset; the built-in rulesets are not re-performed by this folder")
    o = {"engine": engine}
    for k in ("now", "producer", "tolerance", "source", "supplied_choices", "archive_files"):
        if options.get(k, UNDEF) is not UNDEF:
            o[k] = options[k]
    return I.verify_declarative(extraction, rs, o)


def issue(extraction, ruleset, issued_at=None, engine=None, producer=None, source_text=None, quotes=None):
    """The verdict `verify <extraction> --ruleset <ruleset> [--source] [--quotes]` issues, under `engine` (this build's newest
    when None), with issued_at fixed when given."""
    opts = {"ruleset": ruleset}
    if engine is not None:
        opts["engine"] = engine
    if issued_at is not None:
        opts["now"] = issued_at
    if producer is not None:
        opts["producer"] = producer
    if source_text is not None:
        src = {"text": source_text}
        if quotes is not None:
            src["quotes"] = quotes
        opts["source"] = src
    return verify(extraction, opts)


def render(verdict):
    """JSON.stringify(verdict, null, 2) and a newline (engine.py's writer)."""
    return E.render(verdict)


# ---- the gate reading (verdict/aggregation.ts, verdict/exit.ts) ------------------------------------------------------

def _held(v):
    return [c for c in v["claims"] if c["outcome"] == "INSUFFICIENT_DATA" and c.get("tier") != "REASONED" and "suspect" in c]


def _open(v):
    return [c for c in v["claims"] if c["outcome"] == "INSUFFICIENT_DATA" and c.get("tier") != "REASONED"]


def _struck_load_bearing(v):
    return any(len(w["claims"]) > 0 for w in v.get("would_unlock") or [])


def gate_status(v):
    if v["outcome"] == "FAIL" or _held(v):
        return "FAIL"
    if v["outcome"] != "PASS":
        return v["outcome"]
    return "PASS-WITH-OPEN" if _open(v) else "PASS"


def gate_label(v):
    if v["outcome"] != "FAIL" and _held(v):
        return "HELD-SUSPECT"
    if v["outcome"] != "FAIL" and _struck_load_bearing(v):
        return "OPEN"
    return gate_status(v)


def verdict_exit(v, allow_open=False):
    """(exit, words, gate label)"""
    gate = gate_label(v)
    if gate == "FAIL":
        return 1, "a check failed", gate
    if gate == "HELD-SUSPECT":
        return 1, "%d check(s) could not read a value, and a reading one character away fails the check; a gate books it as a FAIL" % len(_held(v)), gate
    if gate == "PASS":
        return 0, "every check ran and held", gate
    if gate in ("PASS-WITH-OPEN", "OPEN") and v["outcome"] == "PASS":
        op = _open(v)
        parts = (["%d check(s) could not run: %s" % (len(op), ", ".join(c["claim_id"] for c in op))] if op else []) + \
            (["%d load-bearing field(s) are struck" % len(v.get("struck") or [])] if gate == "OPEN" else [])
        what = "; ".join(parts)
        if allow_open:
            refused = [c for c in op if (c.get("insufficiency") or {}).get("reason") not in ("REFERENCE_NOT_PROVIDED", "FIELD_MISSING")]
            if not refused and gate != "OPEN":
                return 0, "exit 0 by allow-open, the caller's stated choice: every check that ran held, but %s; a gate would hold" % what, gate
            why = "; ".join((["%s could not run for another reason" % ", ".join("%s (%s)" % (c["claim_id"], (c.get("insufficiency") or {}).get("reason", "no reason stated")) for c in refused)] if refused else [])
                            + (["a load-bearing field is struck"] if gate == "OPEN" else []))
            return 2, "fails closed: every check that ran held, but %s; allow-open does not apply: it accepts only checks that could not run for want of a reference (REFERENCE_NOT_PROVIDED) or of a field the document does not carry (FIELD_MISSING), and %s" % (what, why), gate
        return 2, "fails closed: every check that ran held, but %s" % what, gate
    return 2, ("no check could run" if gate == "INSUFFICIENT_DATA" else "a load-bearing field is struck and no check could run"), gate


def headline(v):
    """verdict/aggregation.ts gateHeadline"""
    s = v.get("gate_status") if v.get("gate_status") in ("PASS", "PASS_WITH_OPEN", "FAIL", "INSUFFICIENT_DATA") else I.recorded_gate_status(v)
    n = len(v["claims"])

    def checks(k):
        return "%d of %d check%s" % (k, n, "" if n == 1 else "s")
    if s == "FAIL":
        failed = sum(1 for c in v["claims"] if c["outcome"] == "FAIL")
        return "FAIL: %s failed" % checks(failed) if failed else "FAIL: %s held as suspect (a reading one character away fails)" % checks(len(_held(v)))
    if s == "INSUFFICIENT_DATA":
        return "INSUFFICIENT_DATA: none of the %d check%s could run" % (n, "" if n == 1 else "s") if n else "INSUFFICIENT_DATA: no check applied"
    op = len(_open(v))
    if s == "PASS_WITH_OPEN":
        return "PASS-WITH-OPEN: %s could not run" % checks(op) if op else "PASS-WITH-OPEN: every check that ran held, and a load-bearing field is struck"
    passed = sum(1 for c in v["claims"] if c["outcome"] == "PASS")
    judged = n - passed
    return "PASS: %s ran and held%s" % (checks(passed), "; %d judgement claim%s did not decide (judgement never opens a verdict)" % (judged, "" if judged == 1 else "s") if judged else "")


# ---- the command line --------------------------------------------------------------------------------------------------

USAGE = ("usage: python3 conformance/engine_py/declarative/issue.py <extraction.json> --ruleset <name | file.json> [--source <file.txt>] "
         "[--quotes <file.json>] [--engine <version>] [--issued-at <YYYY-MM-DDTHH:MM:SS.mmmZ>] [--producer <label>] [--allow-open]")


def _read_text(path):
    with open(path, "rb") as fh:
        data = fh.read()
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as e:
        shown = " ".join("%02X" % b for b in data[e.start:e.start + 4])
        raise rb.Refused("%s is not valid UTF-8: the bytes at offset %d (%s) are not a UTF-8 character. A text input is hashed as UTF-8, and "
                         "decoding would replace those bytes with U+FFFD, so two different files would share one input_hash. Re-save the file as "
                         "UTF-8 (or fix the byte), then run it again" % (path, e.start, shown))


def read_quotes(path):
    with open(path, "rb") as fh:
        raw = E.read_json(fh.read(), path)
    lst = raw if isinstance(raw, list) else (raw.get("quotes") if isinstance(raw, dict) else None)
    ok = isinstance(lst, list) and all(isinstance(q, dict) and isinstance(q.get("id"), str) and len(q["id"]) > 0 and isinstance(q.get("quote"), str)
                                       and len(q["quote"]) > 0 and (q.get("label", UNDEF) is UNDEF or isinstance(q.get("label"), str)) for q in lst)
    if not ok:
        raise ValueError('%s: --quotes is [{ "id", "quote", "label"? }] with non-empty strings' % path)
    return lst


def main(argv, out=sys.stdout, err=sys.stderr):
    args = list(argv)
    vals, flags, files = {}, set(), []
    while args:
        a = args.pop(0)
        if a.startswith("--") and "=" in a:
            k, v = a[2:].split("=", 1)
            args.insert(0, v)
            a = "--" + k
        if a in ("--ruleset", "--source", "--quotes", "--engine", "--issued-at", "--producer"):
            if not args:
                err.write("issue: %s needs a value\n%s\n" % (a, USAGE))
                return 3
            vals[a[2:]] = args.pop(0)
        elif a == "--allow-open":
            flags.add("allow-open")
        elif a.startswith("-") and a != "-":
            err.write("issue: unknown option %s\n%s\n" % (a, USAGE))
            return 3
        else:
            files.append(a)
    if len(files) != 1 or "ruleset" not in vals:
        err.write("issue: one extraction and --ruleset per call\n%s\n" % USAGE)
        return 3
    if "issued-at" in vals and not E._ISO_MS.match(vals["issued-at"]):
        err.write("issue: --issued-at must read like 2026-10-05T16:03:24.839Z (got %s)\n" % vals["issued-at"])
        return 3
    try:
        with open(files[0], "rb") as fh:
            extraction = E.read_json(fh.read(), files[0])
    except OSError as e:
        err.write("error reading extraction: cannot read %s: %s\n" % (files[0], e.strerror))
        return 3
    except rb.Refused as e:
        err.write("error reading extraction: %s\n" % e)
        return 3
    if isinstance(extraction, dict):
        binds = lambda v: isinstance(v, dict) and isinstance(v.get("verdict_id"), str) and isinstance(v.get("input_hash"), str) \
            and isinstance(v.get("engine_version"), str) and isinstance(v.get("ruleset"), dict)  # noqa: E731
        like = ("a verdict (it carries verdict_id, input_hash, ruleset and engine_version)" if binds(extraction) else
                "a signed envelope (a verdict with its signature)" if isinstance(extraction.get("verdict"), dict) and isinstance(extraction.get("signature"), str) and isinstance(extraction.get("public_key"), str) else
                "a replay bundle (a verdict with its inputs)" if binds(extraction.get("verdict")) and "inputs" in extraction else None)
        if like:
            err.write("verify: %s looks like %s, not an extraction.\ndid you mean: python3 conformance/engine_py/declarative/replay.py %s\n" % (files[0], like, files[0]))
            return 3
    if extraction is None:
        err.write("verify: input refused: the extraction is null: there is no document to verify (pass the extracted fields as a JSON object)\n")
        return 3
    try:
        ruleset = RS.load_ruleset(vals["ruleset"], engine=vals.get("engine"))
        if "quotes" in vals and "source" not in vals:
            raise ValueError("--quotes are found in --source: give the source text too")
        source_text = _read_text(vals["source"]) if "source" in vals else None
        quotes = read_quotes(vals["quotes"]) if "quotes" in vals else None
    except RS.RulesetRefused as e:
        err.write("%s %s\n" % (e.lead, e))
        return 3
    except (OSError, ValueError, rb.Refused) as e:
        err.write("error reading reference: %s\n" % (e.strerror if isinstance(e, OSError) else e))
        return 3
    try:
        verdict = issue(extraction, ruleset, issued_at=vals.get("issued-at") or E.now_iso(), engine=vals.get("engine"), producer=vals.get("producer"),
                        source_text=source_text, quotes=quotes)
    except I.InputRefused as e:
        err.write("verify: input refused: %s\n" % e)
        return 3
    except I.EngineError as e:
        err.write("verify: %s\n" % e)
        return 3
    except I.Outside as e:
        err.write("issue: not re-performed: outside what this build re-performs: %s\n" % e)
        return 3
    out.write(render(verdict))
    err.write("verify: %s\n" % headline(verdict))
    code, words, gate = verdict_exit(verdict, "allow-open" in flags)
    if gate == "HELD-SUSPECT":
        err.write("  exit 1: %s\n" % words)
    elif "allow-open" in flags and code == 0 and gate != "PASS":
        err.write("  %s\n" % words.replace("allow-open", "--allow-open"))
    elif gate in ("PASS-WITH-OPEN", "OPEN") and verdict["outcome"] == "PASS":
        if "allow-open" in flags:
            err.write("  exit 2: %s. Supply what they need (--gate names each)\n" % words.replace("allow-open", "--allow-open"))
        else:
            would = verdict_exit(verdict, True)[0] == 0
            err.write("  exit 2: %s. Supply what they need (--gate names each)%s\n" % (
                words, ", or pass --allow-open to exit 0 on an open verdict" if would else
                "; --allow-open would not apply here: it accepts only checks that wait on a reference or a field the document does not carry, with no field struck"))
    return code


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")
    sys.exit(main(sys.argv[1:]))
