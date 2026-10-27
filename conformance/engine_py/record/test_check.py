# Tests for check.py: the work graph's conformance cases, run against the Python reader, and the count the Node check gives.
# prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
import io
import json
import os
import re
import subprocess
import sys
import unittest
import urllib.parse
import urllib.request
from contextlib import redirect_stderr, redirect_stdout

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import check as C  # noqa: E402
import nodetools as N  # noqa: E402
import strict as S  # noqa: E402
import workgraph as W  # noqa: E402

CASES_FILE = N.cases_file()


def load():
    with open(CASES_FILE, "rb") as fh:
        return S.json_parse(fh.read().decode("utf-8"))


@unittest.skipIf(not CASES_FILE, "can't tell: work-frags.json is not in this tree")
class ConformanceTest(unittest.TestCase):
    def test_every_case_passes_with_no_failures(self):
        cases = load()
        passed, failures = C.check(cases)
        self.assertEqual(failures, [])
        self.assertEqual(passed, len(cases["canonical"]) + 2 * len(cases["frags"]) + len(cases["refusals"]) + len(cases["effects"])
                         + len(cases["gates"]) + len(cases["statuses"]) + len(cases["states"]))
        self.assertEqual(passed, 78)

    def test_an_implementation_that_hashes_differently_fails_by_name(self):
        def bad_id(f):
            g = dict(f)
            g["schema"] = "riposte.work/0.1.0"
            return W.frag_id(g)
        _, failures = C.check(load(), impl={"fragId": bad_id})
        self.assertTrue(failures)
        self.assertRegex(failures[0], r"^frag, a task frag by a person: id [0-9a-f]{64}, expected [0-9a-f]{64}$")

    def test_codes_false_accepts_any_refusal_and_codes_true_compares_them(self):
        def refuse_all(f):
            if "refusal" in json.dumps(f):
                pass
            raise W.Refused("other_code", "refused")
        cases = load()
        p_codes, f_codes = C.check(cases, codes=True, impl={"fragId": W.frag_id, "validate": lambda f: W.validate(f) if f in [c["frag"] for c in cases["frags"]] else refuse_all(f)})
        p_any, f_any = C.check(cases, codes=False, impl={"fragId": W.frag_id, "validate": lambda f: W.validate(f) if f in [c["frag"] for c in cases["frags"]] else refuse_all(f)})
        self.assertEqual(len(f_any), 0)
        self.assertEqual(len(f_codes), len(cases["refusals"]))
        self.assertEqual(p_any - p_codes, len(cases["refusals"]))

    def test_the_command_prints_the_count_and_exits_0(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(C.main(["--cases", CASES_FILE]), 0)
        self.assertEqual(buf.getvalue(), "78 passed, 0 failures\n")
        said = io.StringIO()
        with redirect_stderr(said):
            self.assertEqual(C.main(["--cases", os.path.join(HERE, "no-such-file.json")]), 3)
        self.assertEqual(said.getvalue(), "cannot find work-frags.json: give --cases <file> or set RIPOSTE_WORKGRAPH_CASES\n")


WG_INDEX = N.package_path("workgraph", "dist", "index.js")
CHECK_MJS = N.package_path("workgraph", "conformance", "check.mjs")


@unittest.skipIf(not (N.node_exe() and WG_INDEX and CHECK_MJS and CASES_FILE), "can't tell: the workgraph package is not built, or no Node 20 or later")
class SameCountAsCheckMjsTest(unittest.TestCase):
    def test_check_mjs_gives_the_node_package_the_same_count(self):
        url = lambda p: json.dumps(urllib.parse.urljoin("file:", urllib.request.pathname2url(os.path.abspath(p))))
        script = ("const wg = await import(%s); const { check } = await import(%s);"
                  "const { Graph, canonicalize, containerState, fragId, mapFinding, readGates, validateFrag } = wg;"
                  "const r = check({ fragId, validate: validateFrag, canonicalize,"
                  " mapFinding: (rows, by, f, s, k) => mapFinding({ findings: rows, roles: [] }, by, f, s, k), readGates,"
                  " statuses: (frags) => { const g = new Graph(); for (const f of frags) g.addFrag(f); return new Map([...g.statuses()].map(([i, x]) => [i, x.status])) },"
                  " states: (frags) => { const g = new Graph(); for (const f of frags) g.addFrag(f);"
                  "  return new Map(frags.map((f) => [f.id, containerState(g, f.id)]).filter((e) => e[1] !== null)) } });"
                  "console.log(JSON.stringify({ passed: r.passed, failures: r.failures.length }))") % (url(WG_INDEX), url(CHECK_MJS))
        p = subprocess.run([N.node_exe(), "--input-type=module", "-e", script], capture_output=True, timeout=120)
        self.assertEqual(p.returncode, 0, p.stderr)
        node = json.loads(p.stdout)
        passed, failures = C.check(load())
        self.assertEqual((passed, len(failures)), (node["passed"], node["failures"]))


if __name__ == "__main__":
    unittest.main()
