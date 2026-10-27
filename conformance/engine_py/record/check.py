# The work graph's conformance cases, run against this folder's Python reader. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
Runs packages/workgraph/conformance/work-frags.json against workgraph.py the way packages/workgraph/conformance/check.mjs runs
it against any implementation: canonical pairs, accepted frags with their ids (and that each is accepted), refusals with their
codes, check-contract effects, gate readings, and small graphs with every frag's status and every container's state.

    python3 conformance/engine_py/record/check.py [--cases <work-frags.json>] [--no-codes]

It prints one line per failure and then "<passed> passed, <failures> failures". Exit 0 no failures; 1 at least one; 3 the cases
file cannot be found or read. The cases file is found at --cases, else $RIPOSTE_WORKGRAPH_CASES, else
packages/workgraph/conformance/work-frags.json under the repository root, else ../workgraph/conformance/work-frags.json beside
the overlay (the lab's layout).
"""

import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import strict as S  # noqa: E402
import workgraph as W  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))


def cases_path(given=None):
    """Where work-frags.json is: the flag, the environment, the exported layout, the lab's layout (or None). A file named by the
    flag or the environment is that file or nothing: a missing one is never replaced by another."""
    named = given or os.environ.get("RIPOSTE_WORKGRAPH_CASES")
    if named:
        return named if os.path.isfile(named) else None
    for p in (os.path.join(ROOT, "packages", "workgraph", "conformance", "work-frags.json"),
              os.path.join(os.path.dirname(ROOT), "workgraph", "conformance", "work-frags.json")):
        if os.path.isfile(p):
            return p
    return None


def check(cases, codes=True, impl=None):
    """check.mjs's check(impl, { codes }): returns (passed, failures)."""
    impl = impl or {"fragId": W.frag_id, "validate": W.validate, "canonicalize": W.canonicalize, "mapFinding": W.map_finding,
                    "readGates": W.read_gates, "statuses": W.statuses, "states": W.states}
    failures = []
    passed = 0

    def code_of(e):
        return getattr(e, "code", None)
    if impl.get("canonicalize"):
        for c in cases["canonical"]:
            got = impl["canonicalize"](S.json_parse(c["text"]))
            if got == c["canonical"]:
                passed += 1
            else:
                failures.append("canonical, %s: got %s, expected %s" % (c["name"], got, c["canonical"]))
    for c in cases["frags"]:
        try:
            got = impl["fragId"](c["frag"])
        except Exception as e:
            failures.append("frag, %s: fragId threw %s" % (c["name"], e))
            continue
        if got == c["expect"]["id"]:
            passed += 1
        else:
            failures.append("frag, %s: id %s, expected %s" % (c["name"], got, c["expect"]["id"]))
        if impl.get("validate"):
            try:
                impl["validate"](c["frag"])
                passed += 1
            except Exception as e:
                failures.append("frag, %s: refused (%s): %s" % (c["name"], code_of(e), e))
    if impl.get("validate"):
        for c in cases["refusals"]:
            try:
                impl["validate"](c["frag"])
                failures.append("refusal, %s: accepted, expected the refusal %s" % (c["name"], c["expect"]["refused"]))
            except Exception as e:
                if not codes or code_of(e) == c["expect"]["refused"]:
                    passed += 1
                else:
                    failures.append("refusal, %s: refused with %s, expected %s" % (c["name"], code_of(e), c["expect"]["refused"]))
    if impl.get("mapFinding"):
        for c in cases["effects"]:
            got = impl["mapFinding"](c["rows"], c["by"], c["finding"], c["source"], c.get("kind"))
            if got == c["expect"]["effect"]:
                passed += 1
            else:
                failures.append("effect, %s: got %s, expected %s" % (c["name"], got, c["expect"]["effect"]))
    if impl.get("readGates"):
        for c in cases["gates"]:
            got = impl["readGates"](c["findings"])
            if got == c["expect"]["reads"]:
                passed += 1
            else:
                failures.append("gates, %s: got %s, expected %s" % (c["name"], got, c["expect"]["reads"]))

    def same_map(part, c, got, want):
        ids = sorted(set(want) | set(got))
        off = [i for i in ids if got.get(i) != want.get(i)]
        if not off:
            return 1
        failures.append("%s, %s: %s" % (part, c["name"], "; ".join("%s got %s, expected %s" % (i[:12], got.get(i) or "nothing", want.get(i) or "nothing")
                                                                for i in off[:4])))
        return 0
    for part, key in (("statuses", "statuses"), ("states", "states")):
        if impl.get(key):
            for c in cases.get(key) or []:
                try:
                    got = impl[key](c["frags"])
                except Exception as e:
                    failures.append("%s, %s: threw %s" % (part, c["name"], e))
                    continue
                passed += same_map(part, c, got, c["expect"][key])
    return passed, failures


def main(argv):
    given = None
    codes = True
    i = 0
    while i < len(argv):
        if argv[i] == "--cases" and i + 1 < len(argv):
            given = argv[i + 1]
            i += 2
        elif argv[i] == "--no-codes":
            codes = False
            i += 1
        else:
            sys.stderr.write("usage: python3 conformance/engine_py/record/check.py [--cases <work-frags.json>] [--no-codes]\n")
            return 3
    path = cases_path(given)
    if not path:
        sys.stderr.write("cannot find work-frags.json: give --cases <file> or set RIPOSTE_WORKGRAPH_CASES\n")
        return 3
    try:
        with open(path, "rb") as fh:
            cases = S.json_parse(fh.read().decode("utf-8"))
    except (OSError, ValueError) as e:
        sys.stderr.write("cannot read %s: %s\n" % (path, e))
        return 3
    passed, failures = check(cases, codes)
    for f in failures:
        sys.stdout.write(f + "\n")
    sys.stdout.write("%d passed, %d failures\n" % (passed, len(failures)))
    return 0 if not failures else 1


if __name__ == "__main__":
    S.utf8_streams()
    sys.exit(main(sys.argv[1:]))
