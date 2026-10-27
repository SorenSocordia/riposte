# Tests for the declarative ruleset interpreter in Python. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""Run from the repository root: python3 -m unittest discover -s conformance/engine_py/declarative (standard library only).

The tests that read the Node package's fixtures or run its build are skipped with "can't tell" when they are absent. The Node
package is packages/verify in an exported repository, or ../verify beside this repository in the source tree."""

import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import jsrt as J  # noqa: E402
import numread as N  # noqa: E402
import expr as X  # noqa: E402
import interpret as I  # noqa: E402
import issue as ISS  # noqa: E402
import lint as LINT  # noqa: E402
import reconcile as REC  # noqa: E402
import remedies as RM  # noqa: E402
import replay as RP  # noqa: E402
import ruleset as RS  # noqa: E402

rb = J.rb
E = J.E


def _node_package(*need):
    for d in (os.path.join(ROOT, "packages", "verify"), os.path.join(os.path.dirname(ROOT), "verify")):
        if os.path.exists(os.path.join(d, *need)):
            return d
    return None


FIXTURES = _node_package("test", "fixtures", "declarative-golden-hashes.json")
NODE_PKG = _node_package("dist", "cli.js")
EXAMPLES = _node_package("docs", "examples", "peppol-en16931.ruleset.v0.3.json")


def _node_ok():
    if NODE_PKG is None:
        return False
    try:
        return subprocess.run(["node", "--version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE).returncode == 0
    except OSError:
        return False


NODE = _node_ok()
CANT_FIX = "can't tell: the Node package's test fixtures are not here (packages/verify/test/fixtures or ../verify/test/fixtures)"
CANT_NODE = "can't tell: the Node engine is not built here (packages/verify/dist/cli.js or ../verify/dist/cli.js), or node is not on PATH"


def _load(path):
    with open(path, "rb") as fh:
        return rb.read_json_bytes(fh.read(), path)


INPUTS = _load(os.path.join(HERE, "fixtures", "golden_inputs.json"))
LABELLED = _load(os.path.join(HERE, "fixtures", "einvoice_labelled.json"))["docs"]
RULESETS = INPUTS["rulesets"]


def core_of(x):
    """test/fixtures/remedy-core.ts coreOf: a verdict-shaped object without its remedies."""
    if isinstance(x, list):
        return [core_of(v) for v in x]
    if not isinstance(x, dict):
        return x
    is_verdict = isinstance(x.get("verdict_id"), str) and isinstance(x.get("claims"), list)
    return {k: core_of(v) for k, v in x.items() if not (is_verdict and k == "remedies")}


def golden_result(c):
    """One recorded golden case, run here under engine 0.0.1, as declarative-golden.test.ts runs it."""
    fn = c["fn"]
    if fn == "verifyDeclarative":
        o = dict(c["o"])
        o["engine"] = "0.0.1"
        return I.verify_declarative(c["x"], RULESETS[c["rs"]], o)
    if fn == "verify":
        o = dict(c["o"])
        o["ruleset"] = RULESETS[o["ruleset"]]
        o["engine"] = "0.0.1"
        return ISS.verify(c["x"], o)
    if fn == "reconcile":
        o = dict(c["o"])
        o["engine"] = "0.0.1"
        return REC.reconcile(c["x"], RULESETS[c["rs"]], o)
    if fn == "lintRuleset":
        return LINT.lint_ruleset(RULESETS[c["rs"]])
    env = X.Env({"A": 10.0, "B": 4.0, "C": None}, lambda r: 30.0 if r == "L" else None)
    try:
        v = X.eval_expr(c["expr"], env)
        return {"v": "undefined" if v is None else v}
    except X.ExprError as e:
        return {"error": str(e)}


def golden_hash(x):
    return hashlib.sha256(J.stringify(core_of(x)).encode("utf-8", "surrogatepass")).hexdigest()


def corrections_doc(n=0):
    docs = [c for c in INPUTS["golden_einvoice_v010"] if c["id"].startswith("v010/peppol/corrections-set/")]
    return docs[n]["x"]


class CarriedRulesetTest(unittest.TestCase):
    def test_the_carried_copies_hash_as_pinned(self):
        for _, _, f in RS.CARRIED:
            with open(os.path.join(RS.RULESET_DIR, f), "rb") as fh:
                self.assertEqual(hashlib.sha256(fh.read()).hexdigest(), RS.CARRIED_SHA256[f], f)

    @unittest.skipUnless(EXAMPLES, "can't tell: the Node package's docs/examples are not here")
    def test_the_carried_copies_are_the_node_package_files_byte_for_byte(self):
        for _, _, f in RS.CARRIED:
            with open(os.path.join(RS.RULESET_DIR, f), "rb") as a, open(os.path.join(EXAMPLES, "docs", "examples", f), "rb") as b:
                self.assertEqual(a.read(), b.read(), f)

    def test_a_bare_name_takes_the_default_version_of_its_engine(self):
        self.assertEqual(RS.resolve_carried("peppol-en16931", "0.7.2")["version"], "0.3.0")
        self.assertEqual(RS.resolve_carried("peppol-en16931", "0.6.0")["version"], "0.3.0")
        self.assertEqual(RS.resolve_carried("peppol-en16931", "0.5.0")["version"], "0.2.0")
        self.assertEqual(RS.resolve_carried("peppol-en16931", "0.0.1")["version"], "0.2.0")
        self.assertEqual(RS.resolve_carried("e-invoice", "0.7.2")["version"], "0.3.0")
        self.assertEqual(RS.resolve_carried("peppol-en16931@0.1.0", "0.7.2")["version"], "0.1.0")
        self.assertIsNone(RS.resolve_carried("e-invoice@0.2.0"))

    def test_what_the_node_loader_refuses_is_refused_in_its_words(self):
        with self.assertRaises(RS.RulesetRefused) as cm:
            RS.load_ruleset("peppol-en1693")
        self.assertEqual(str(cm.exception), 'no ruleset named "peppol-en1693" (did you mean peppol-en16931?); known: invoice, pay-app, peppol-en16931, '
                         'peppol-en16931@0.1.0, peppol-en16931@0.2.0, peppol-en16931@0.3.0, e-invoice; or the path of a ruleset JSON file')
        with self.assertRaises(RS.RulesetRefused) as cm:
            RS.load_ruleset("peppol-en16931@0.9.0")
        self.assertEqual(str(cm.exception), "ruleset peppol-en16931@0.9.0 is not one this build carries; it carries peppol-en16931@0.1.0, peppol-en16931@0.2.0, peppol-en16931@0.3.0")
        self.assertEqual(cm.exception.lead, "error reading reference:")
        path = tempfile.mktemp(suffix=".json")
        with open(path, "wb") as fh:
            fh.write(b'{"id": "x", "id": "y", "fields": {}, "checks": []}')
        try:
            with self.assertRaises(rb.Refused) as cm:
                RS.load_ruleset(path)
            self.assertIn('the key "id" appears twice in one object (at $.id)', str(cm.exception))
        finally:
            os.remove(path)

    def test_the_carried_rulesets_lint_clean(self):
        for id_, v, _ in RS.CARRIED:
            self.assertTrue(LINT.lint_ruleset(RS.resolve_carried("%s@%s" % (id_, v)))["ok"], v)


@unittest.skipUnless(FIXTURES, CANT_FIX)
class GoldenTest(unittest.TestCase):
    """The two byte-identity goldens of the Node package, reproduced here: the sha256 of every result's core."""

    def _run(self, which, hashes_file):
        hashes = _load(os.path.join(FIXTURES, "test", "fixtures", hashes_file))
        cases = INPUTS[which]
        self.assertEqual(len(cases), hashes["cases"])
        self.assertEqual(sorted(c["id"] for c in cases), sorted(hashes["hashes"].keys()))
        bad = [c["id"] for c in cases if golden_hash(golden_result(c)) != hashes["hashes"][c["id"]]]
        self.assertEqual(bad, [], "%d of %d golden results do not hash as pinned" % (len(bad), len(cases)))

    def test_the_declarative_golden_489_results_hash_as_pinned(self):
        self._run("golden", "declarative-golden-hashes.json")

    def test_the_einvoice_golden_177_results_hash_as_pinned(self):
        self._run("golden_einvoice_v010", "declarative-golden-einvoice-v010-hashes.json")


class NumberReadingTest(unittest.TestCase):
    """docs/RULESETS.md "How a ruleset reads numbers", the rows the declarative path reads."""

    def test_engine_020_reads_numbers_whole_and_never_guesses_a_grouping(self):
        read = lambda s, loc=J.UNDEF: (N.read_number_text_v020(s, loc) or {}).get("canonical")  # noqa: E731
        self.assertIsNone(read("1.234"))
        self.assertIsNone(read("1,234"))
        self.assertIsNone(read("1,23"))
        self.assertIsNone(read("1 234"))
        self.assertEqual(read("0.125"), "0.125")
        self.assertEqual(read("1,234.56"), "1234.56")
        self.assertEqual(read("−330.00"), "-330.00")
        self.assertEqual(read("€1,234.567"), "1234.567")
        self.assertEqual(read("(12.50)"), "-12.50")
        self.assertEqual(read("1,23", N.LOCALE_TAGS["de"]), "1.23")
        self.assertEqual(read("1 234", N.LOCALE_TAGS["fr"]), "1234")
        self.assertEqual(read("十一万"), "十一万")

    def test_the_strict_reading_refuses_what_the_lenient_one_coerces(self):
        self.assertFalse(N.is_strict_number_text("°225.0"))
        self.assertFalse(N.is_strict_number_text("1,2?5.00"))
        self.assertEqual(N.normalize_amount("°225.0")["normalized"], 225.0)
        self.assertTrue(N.is_strict_number_text_v010("1万2千"))
        self.assertFalse(N.is_strict_number_text("1万2千"))

    def test_a_number_text_that_a_double_cannot_hold_is_not_exact(self):
        self.assertFalse(N.number_text_is_exact("9007199254740993"))
        self.assertTrue(N.number_text_is_exact("6.125e3"))
        self.assertTrue(N.number_text_is_exact("-0"))


class ExpressionTest(unittest.TestCase):
    def test_the_two_grammars_throw_at_the_same_inputs_in_the_same_words(self):
        env = X.Env({"A": 10.0}, lambda r: None)
        with self.assertRaises(X.ExprError) as cm:
            X.eval_expr("doc.A", env)
        self.assertEqual(str(cm.exception), "trailing tokens in expression")
        self.assertEqual(X.eval_expr_v040("doc.A", env.copy(ref=lambda k, r: 3.0)), 3.0)
        with self.assertRaises(X.ExprError) as cm:
            X.eval_expr("median(A)", env)
        self.assertEqual(str(cm.exception), "unknown function 'median'")
        self.assertEqual([r["name"] for r in X.operand_refs("median(V, OUTER) + prev(R) + doc.D + A?")], ["median(V,OUTER)", "prev.R", "doc.D", "A"])


def _bundle(extraction, ruleset, engine="0.7.2", source=None, issued_at="2026-10-20T00:00:00.000Z"):
    opts = {"ruleset": ruleset, "engine": engine, "now": issued_at}
    if source is not None:
        opts["source"] = source
    verdict = ISS.verify(extraction, opts)
    verdict = json.loads(ISS.render(verdict))
    return {"verdict": verdict, "inputs": I.declarative_inputs(extraction, ruleset, opts)}


SOURCE = {"text": "Invoice\nAmount due for payment EUR 1,000.00\nThank you for your business.\n", "quotes": [{"id": "q1", "quote": "Thank you for your business."}]}


class IssueReplayTest(unittest.TestCase):
    def setUp(self):
        self.rs = RS.resolve_carried("peppol-en16931@0.3.0")
        self.x = corrections_doc(0)

    def test_a_verdict_issued_here_replays_verified_here(self):
        b = _bundle(self.x, self.rs, source=SOURCE)
        code, res, lines, case = RP.replay_parsed(b)
        self.assertEqual((code, res["status"], case["result"]), (0, "VERIFIED", "MATCH"), lines)
        self.assertTrue(lines[0].startswith("outcome VERIFIED: re-performed with declarative (ruleset peppol-en16931@0.3.0, engine 0.7.2)"))

    def test_a_flipped_outcome_keeps_its_binding_and_fails_at_outcome(self):
        b = _bundle(self.x, self.rs)
        b["verdict"]["outcome"] = "PASS" if b["verdict"]["outcome"] != "PASS" else "FAIL"
        code, res, _, case = RP.replay_parsed(b)
        self.assertEqual((code, res["status"], case["first_difference"]), (1, "FAILED", "outcome"))
        self.assertEqual(res["computed_verdict_id"], b["verdict"]["verdict_id"])

    def test_a_changed_input_fails_the_binding(self):
        b = _bundle(self.x, self.rs)
        b["inputs"] = dict(b["inputs"])
        b["inputs"]["extraction"] = dict(self.x)
        b["inputs"]["extraction"]["payable_amount"] = 123456.78
        code, res, _, case = RP.replay_parsed(b)
        self.assertEqual((code, case["first_difference"]), (1, "input_hash"))

    def test_a_key_the_bundle_format_does_not_define_is_refused_unless_allowed(self):
        b = _bundle(self.x, self.rs)
        b["extra"] = 1
        code, res, lines, case = RP.replay_parsed(b)
        self.assertEqual((code, res["status"], case["unknown_keys"]), (3, "REFUSED", ["extra"]))
        self.assertIn("its format does not define: extra", lines[0])
        code, res, lines, _ = RP.replay_parsed(b, allow_unknown_keys=True)
        self.assertEqual((code, res["carried_not_checked"], res["allow_unknown_keys"]), (0, ["extra"], "stated"))
        code, res, _, _ = RP.replay_parsed(b, strict=True, allow_unknown_keys=True)
        self.assertEqual((code, res["strict"]["ok"]), (1, False))

    def test_without_inputs_the_structure_is_verified_and_the_outcome_is_not(self):
        b = _bundle(self.x, self.rs)
        code, res, _, _ = RP.replay_parsed({"verdict": b["verdict"]})
        self.assertEqual((code, res["status"]), (2, "NOT_REPERFORMED"))

    def test_deleted_remedies_of_an_engine_001_verdict_fail_unless_lenient(self):
        b = _bundle(self.x, self.rs, engine="0.0.1")
        self.assertIn("remedies", b["verdict"])
        del b["verdict"]["remedies"]
        code, res, _, case = RP.replay_parsed(b)
        self.assertEqual((code, case["first_difference"]), (1, "remedies"))
        code, res, _, case = RP.replay_parsed(b, lenient_remedies=True)
        self.assertEqual((code, case.get("remedies_not_carried")), (0, True))

    def test_a_carried_ruleset_with_other_remedies_fails_at_its_remedies(self):
        b = _bundle(self.x, self.rs)
        rs = J.clone(self.rs)
        first = next(c for c in rs["checks"] if "remedy" in c)
        first["remedy"] = {"kind": "none", "detail": "a remedy a bundle made up"}
        b["inputs"]["ruleset"] = rs
        code, res, _, case = RP.replay_parsed(b)
        self.assertEqual((code, case["first_difference"]), (1, "inputs.ruleset (remedies)"))

    def test_the_issuer_command_line_writes_the_verdict_and_its_exit(self):
        path = tempfile.mktemp(suffix=".json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(J.pretty(self.x))
        try:
            out, err = io.StringIO(), io.StringIO()
            code = ISS.main([path, "--ruleset", "peppol-en16931@0.3.0", "--issued-at", "2026-10-20T00:00:00.000Z", "--engine", "0.7.2"], out, err)
            v = json.loads(out.getvalue())
            self.assertEqual(v["ruleset"]["version"], "0.3.0")
            self.assertEqual(code, ISS.verdict_exit(v)[0])
            self.assertTrue(err.getvalue().startswith("verify: "))
        finally:
            os.remove(path)

    def test_outside_what_this_build_re_performs_is_refused_by_name(self):
        rs = J.clone(self.rs)
        rs["algorithms"] = {"V": {"algorithm": "sparc.vflat@1", "inputs": {}}}
        with self.assertRaises(I.Outside):
            I.verify_declarative(self.x, rs, {"engine": "0.7.2"})


class TeethTest(unittest.TestCase):
    """A changed reading in this interpreter must make the comparison fail while input_hash and verdict_id stay the same."""

    def test_a_cent_added_to_every_amount_diverges_with_the_ids_unchanged(self):
        rs = RS.resolve_carried("peppol-en16931@0.3.0")
        b = _bundle(corrections_doc(0), rs)
        real = N.normalize_amount
        try:
            def plus_a_cent(v):
                r = real(v)
                if r and r["success"] and isinstance(r["normalized"], float):
                    r = dict(r, normalized=r["normalized"] + 0.01)
                return r
            N.normalize_amount = plus_a_cent
            code, res, _, case = RP.replay_parsed(b)
        finally:
            N.normalize_amount = real
        self.assertEqual(code, 1)
        # the first differing field in the re-performed verdict's own order (outcome and gate_status come before the claims)
        self.assertRegex(case["first_difference"], r"^(outcome|gate_status|claims\[)", case["first_difference"])
        self.assertEqual(res["computed_verdict_id"], b["verdict"]["verdict_id"])
        self.assertEqual(res["computed_input_hash"], b["verdict"]["input_hash"])
        self.assertEqual(RP.replay_parsed(b)[0], 0)

    def test_a_reworded_remedy_diverges_at_the_remedies(self):
        rs = RS.resolve_carried("peppol-en16931@0.3.0")
        b = _bundle({"payable_amount": "UNREADABLE"}, rs)
        real = RM._fill
        try:
            RM._fill = lambda text, fact: real(text, fact) + "!"
            code, _, _, case = RP.replay_parsed(b)
        finally:
            RM._fill = real
        self.assertEqual(code, 1)
        self.assertTrue(case["first_difference"].startswith("remedies["), case["first_difference"])


@unittest.skipUnless(NODE, CANT_NODE)
class AgainstNodeTest(unittest.TestCase):
    """Byte for byte against the Node build: its library (the function the command line calls) and its command line."""

    def _node_cases(self, cases):
        d = tempfile.mkdtemp()
        inp, outp = os.path.join(d, "cases.jsonl"), os.path.join(d, "out.jsonl")
        with open(inp, "w", encoding="utf-8", newline="\n") as fh:
            for c in cases:
                fh.write(J.stringify(c) + "\n")
        p = subprocess.run(["node", os.path.join(HERE, "node_run.mjs"), os.path.join(NODE_PKG, "dist"), inp, outp], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(p.returncode, 0, p.stderr.decode("utf-8", "replace"))
        out = {}
        with open(outp, encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    r = json.loads(line)
                    out[r["id"]] = r
        return out

    def _compare(self, cases):
        node = self._node_cases(cases)
        differ = []
        for c in cases:
            if c["fn"] == "lintRuleset":
                mine = J.pretty(LINT.lint_ruleset(c["rs"])) + "\n"
            else:
                mine = J.pretty(I.verify_declarative(c["x"], c["rs"], c["o"])) + "\n"
            if node[c["id"]].get("out") != mine:
                differ.append(c["id"])
        return differ

    def test_the_einvoice_golden_inputs_are_byte_identical_under_engines_020_and_072(self):
        cases = []
        for c in INPUTS["golden_einvoice_v010"]:
            if c["fn"] == "lintRuleset":
                cases.append({"id": c["id"], "fn": "lintRuleset", "rs": RULESETS[c["rs"]]})
                continue
            for e in ("0.2.0", "0.7.2"):
                cases.append({"id": "%s@%s" % (c["id"], e), "fn": "verifyDeclarative", "x": c["x"], "rs": RULESETS[c["rs"]], "o": dict(c["o"], engine=e)})
        self.assertEqual(self._compare(cases), [])

    def test_the_labelled_einvoice_extractions_are_byte_identical_under_peppol_020_and_030(self):
        cases = []
        for v in ("0.2.0", "0.3.0"):
            rs = RS.resolve_carried("peppol-en16931@%s" % v)
            for d in LABELLED:
                cases.append({"id": "%s|%s" % (d["id"], v), "fn": "verifyDeclarative", "x": d["extraction"], "rs": rs, "o": {"engine": "0.7.2", "now": "2026-10-20T00:00:00.000Z"}})
        self.assertEqual(self._compare(cases), [])

    def test_the_command_lines_write_the_same_bytes_and_exit_the_same(self):
        d = tempfile.mkdtemp()
        src, quotes = os.path.join(d, "source.txt"), os.path.join(d, "quotes.json")
        with open(src, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(SOURCE["text"])
        with open(quotes, "w", encoding="utf-8") as fh:
            json.dump(SOURCE["quotes"], fh)
        cli = os.path.join(NODE_PKG, "dist", "cli.js")
        for n, extra in ((0, []), (1, []), (2, ["--source", src, "--quotes", quotes])):
            path = os.path.join(d, "x%d.json" % n)
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(J.pretty(corrections_doc(n)))
            for rsn in ("peppol-en16931@0.2.0", "peppol-en16931@0.3.0"):
                p = subprocess.run(["node", cli, path, "--ruleset", rsn] + extra, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                v = json.loads(p.stdout.decode("utf-8"))
                q = subprocess.run([sys.executable, os.path.join(HERE, "issue.py"), path, "--ruleset", rsn, "--issued-at", v["issued_at"], "--engine", v["engine_version"]] + extra,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                self.assertEqual(q.stdout, p.stdout, "%s %s" % (path, rsn))
                self.assertEqual(q.returncode, p.returncode)

    def test_each_engine_replays_the_other_s_verdict(self):
        d = tempfile.mkdtemp()
        b = _bundle(corrections_doc(2), RS.resolve_carried("peppol-en16931@0.3.0"), source=SOURCE)
        path = os.path.join(d, "bundle.json")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(J.pretty(b))
        p = subprocess.run(["node", os.path.join(NODE_PKG, "dist", "cli.js"), "replay", path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(p.returncode, 0, p.stderr.decode("utf-8", "replace")[:400])
        x = os.path.join(d, "x.json")
        with open(x, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(J.pretty(corrections_doc(1)))
        p = subprocess.run(["node", os.path.join(NODE_PKG, "dist", "cli.js"), x, "--ruleset", "peppol-en16931@0.2.0"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        node_bundle = {"verdict": json.loads(p.stdout.decode("utf-8")), "inputs": I.declarative_inputs(corrections_doc(1), RS.resolve_carried("peppol-en16931@0.2.0"), {})}
        code, res, lines, _ = RP.replay_parsed(node_bundle)
        self.assertEqual((code, res["status"]), (0, "VERIFIED"), lines)

    def test_the_loaders_refuse_in_the_same_words(self):
        d = tempfile.mkdtemp()
        x = os.path.join(d, "x.json")
        with open(x, "w", encoding="utf-8") as fh:
            fh.write('{"payable_amount": 10}')
        for name in ("peppol-en1693", "peppol-en16931@0.9.0"):
            p = subprocess.run(["node", os.path.join(NODE_PKG, "dist", "cli.js"), x, "--ruleset", name], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            out, err = io.StringIO(), io.StringIO()
            code = ISS.main([x, "--ruleset", name], out, err)
            self.assertEqual((code, err.getvalue().split("\n")[0]), (p.returncode, p.stderr.decode("utf-8").split("\n")[0]))


if __name__ == "__main__":
    unittest.main()
