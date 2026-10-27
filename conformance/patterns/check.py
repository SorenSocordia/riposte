# SPDX-License-Identifier: Apache-2.0
"""The conformance check for riposte.pattern/0.1.0 in Python (3.10 or later, standard library only).

    python3 conformance/patterns/check.py

Runs vectors.json through translate.py beside it and prints `passed N, failures M`, as check.mjs does for translate.mjs.
From another runner: `check(impl)` with impl a dict of callables: compile(source, flags, table=None) (raises an exception
with `.code` and `.at` for a pattern outside the dialect), first_match(compiled, text) ({'answer': ..., 'span': [s, e]},
the span in UTF-16 code units), and optionally fold(text, map) and table_bytes(). The catalogue of rewrites is
JavaScript's (rewrite.mjs); here each rewrite's written form is checked on its probes.

Exit 0 every case as expected; 1 at least one was not; 3 vectors.json or the translator cannot be read.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = os.path.join(HERE, "vectors.json")
TABLE = os.path.join(HERE, "unicode-classes.json")


def load_cases():
    with open(CASES, encoding="utf-8") as f:
        return json.load(f)


def holds(f, answers):
    """A formula over pattern answers: a name, {all}, {any} or {not}; True, False, or None for can't tell."""
    if isinstance(f, str):
        return None if answers[f] == "can't tell" else answers[f] == "match"
    if "all" in f:
        v = [holds(x, answers) for x in f["all"]]
        return False if False in v else None if None in v else True
    if "any" in f:
        v = [holds(x, answers) for x in f["any"]]
        return True if True in v else None if None in v else False
    if "not" in f:
        v = holds(f["not"], answers)
        return None if v is None else not v
    raise ValueError("unknown formula %r" % (f,))


def check(impl, cases=None):
    cases = cases if cases is not None else load_cases()
    failures = []
    passed = 0

    def show(s):
        return json.dumps(s, ensure_ascii=True)[:80]

    def probe(part, name, compiled, p):
        nonlocal passed
        try:
            got = impl["first_match"](compiled, p["text"])
        except Exception as e:  # noqa: BLE001
            failures.append("%s, %s, %s: threw %s" % (part, name, show(p["text"]), e))
            return
        if got["answer"] == p["expect"] and ("span" not in p or got.get("span") == p["span"]):
            passed += 1
        else:
            failures.append("%s, %s, %s: got %s %s, expected %s %s" % (part, name, show(p["text"]), got["answer"], got.get("span", ""),
                                                                     p["expect"], p.get("span", "")))

    def compile_or(part, name, source, flags, table=None):
        try:
            return impl["compile"](source, flags, table)
        except Exception as e:  # noqa: BLE001
            failures.append("%s, %s: refused (%s at %s), expected it to be read" % (part, name, getattr(e, "code", e), getattr(e, "at", None)))
            return None

    parts = {}
    mark = [0]

    def part(name):
        parts[name] = passed - mark[0]
        mark[0] = passed

    if "table_bytes" in impl:
        sha = hashlib.sha256(impl["table_bytes"]()).hexdigest()
        if sha == cases["table"]["sha256"]:
            passed += 1
        else:
            failures.append("table: sha256 %s, expected %s" % (sha, cases["table"]["sha256"]))
    part("table")
    for c in cases["constructs"]:
        comp = compile_or("construct", c["name"], c["pattern"], c["flags"])
        if comp is not None:
            for p in c["probes"]:
                probe("construct", c["name"], comp, p)
    part("constructs")
    for c in cases["refusals"]:
        try:
            impl["compile"](c["pattern"], c["flags"], None)
            failures.append("refusal, %s: accepted, expected %s at %s" % (c["name"], c["expect"]["refused"], c["expect"]["at"]))
        except Exception as e:  # noqa: BLE001
            if getattr(e, "code", None) == c["expect"]["refused"] and getattr(e, "at", "-") == c["expect"]["at"]:
                passed += 1
            else:
                failures.append("refusal, %s: %s at %s, expected %s at %s" % (c["name"], getattr(e, "code", e), getattr(e, "at", None),
                                                                            c["expect"]["refused"], c["expect"]["at"]))
    part("refusals")
    for c in cases["rewrites"]:
        comp = compile_or("rewrite", c["name"], c["to"]["source"], c["to"]["flags"])
        if comp is not None:
            for p in c["probes"]:
                probe("rewrite", c["name"], comp, p)
    part("rewrites")
    for c in cases["table_cases"]:
        comp = compile_or("table", c["name"], c["pattern"], c["flags"], cases["doctored_table"])
        if comp is not None:
            for p in c["probes"]:
                probe("table", c["name"], comp, p)
    part("table_cases")
    if "fold" in impl:
        for c in cases["folds"]:
            got = impl["fold"](c["text"], c["map"])
            if got == c["expect"]:
                passed += 1
            else:
                failures.append("fold, %s: got %s, expected %s" % (c["name"], show(got), show(c["expect"])))
    part("folds")
    readings = 0
    w = cases["worked"]
    comps = {k: compile_or("worked", k, p["re"], p["flags"]) for k, p in w["patterns"].items()}
    if all(v is not None for v in comps.values()):
        for row in w["probes"]:
            answers = {}
            for k, comp in comps.items():
                answers[k] = impl["first_match"](comp, row["text"])["answer"]
                if answers[k] != "can't tell" and (answers[k] == "match") == row["patterns"][k]:
                    passed += 1
                else:
                    failures.append("worked, %s, %s: got %s, expected %s" % (k, show(row["text"]), answers[k],
                                                                             "match" if row["patterns"][k] else "no match"))
            r = holds(w["when"], answers)
            if r == row["reading"]:
                passed += 1
                readings += 1
            else:
                failures.append("worked, the reading, %s: got %s, expected %s" % (show(row["text"]), r, row["reading"]))
    parts["worked_patterns"] = passed - mark[0] - readings
    parts["worked_readings"] = readings
    return passed, failures, parts


def main():
    try:
        cases = load_cases()
        sys.path.insert(0, HERE)
        import translate as T  # noqa: E402

        def table_bytes():
            with open(TABLE, "rb") as f:
                return f.read()

        impl = {"compile": lambda s, f, t=None: T.compile_pattern(s, f, t), "first_match": T.first_match,
                "fold": lambda text, name: T.fold(text, name), "table_bytes": table_bytes}
    except Exception as e:  # noqa: BLE001
        print("cannot read the vectors or the translator: %s" % e)
        return 3
    passed, failures, parts = check(impl, cases)
    for f in failures:
        print(f.encode("ascii", "backslashreplace").decode("ascii"))
    print(", ".join("%s %d" % kv for kv in parts.items()))
    print("python %s: passed %d, failures %d" % (sys.version.split()[0], passed, len(failures)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
