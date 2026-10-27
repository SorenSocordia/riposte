# Tests for the Python engine for invoice@0.1.0. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""Run from this folder: python3 -m unittest (standard library only)."""

import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

import engine  # noqa: E402
import invoice_rules as R  # noqa: E402
import riposte_bind as rb  # noqa: E402

SAMPLE = os.path.join(ROOT, "docs", "doors", "examples", "invoice.json")
VECTOR_01 = os.path.join(ROOT, "conformance", "vectors", "01-valid-invoice-0.6.0.json")


def _in_tree(*parts):
    """A path of the engine's package: packages/verify/... in this repository, or the sibling engine folder of a source checkout."""
    for base in (os.path.join(ROOT, "packages", "verify"), os.path.join(ROOT, "..", "verify")):
        if os.path.exists(os.path.join(base, *parts)):
            return os.path.join(base, *parts)
    return os.path.join(ROOT, "packages", "verify", *parts)


# compare.py and sweep.py name packages/verify/dist/cli.js; the tests that run them are held to that path, the others to the engine
CLI = os.path.join(ROOT, "packages", "verify", "dist", "cli.js")
NODE_CLI = _in_tree("dist", "cli.js")
PACK = _in_tree("test", "fixtures", "engine-0.0.1-bundles.json")
# Two files a cold reader wrote on 2026-10-12, read in place (their sha256 are in that folder's README.md): a legal bundle with a
# key `extra` beside its verdict and inputs, and a signed envelope with a key `issued_note` beside its four members.
COLD = _in_tree("test", "fixtures", "core-cold-review-2026-10-12")


def run(args):
    out, err = io.StringIO(), io.StringIO()
    code = engine.main(args, out, err)
    return code, out.getvalue(), err.getvalue()


def write_temp(obj_or_bytes):
    fd, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "wb") as fh:
        fh.write(obj_or_bytes if isinstance(obj_or_bytes, bytes) else json.dumps(obj_or_bytes).encode("utf-8"))
    return path


def sample():
    with open(SAMPLE, "rb") as fh:
        return rb.read_json_bytes(fh.read(), "sample")


class IdentityTest(unittest.TestCase):
    def test_the_transcribed_remedy_table_hashes_as_the_engine_s(self):
        self.assertEqual(engine.remedy_table_hash(), R.EXPECTED_REMEDY_TABLE_HASH)

    def test_the_shipped_sample_gives_the_recorded_verdict_of_vector_01_byte_for_byte(self):
        with open(VECTOR_01, "rb") as fh:
            recorded = rb.read_json_bytes(fh.read(), "vector 01")["verdict"]
        mine = engine.issue(sample(), recorded["issued_at"], engine=recorded["engine_version"])
        self.assertEqual(mine["input_hash"], recorded["input_hash"])
        self.assertEqual(mine["verdict_id"], recorded["verdict_id"])
        self.assertEqual(rb.canonical_json(engine._fix_ints(mine)), rb.canonical_json(recorded))

    def test_the_identity_is_the_binding_verifier_s(self):
        v = engine.issue(sample(), "2026-10-12T00:00:00.000Z")
        bundle = {"verdict": json.loads(engine.render(v)),
                  "inputs": {"extraction": sample(), "references": {"contract": None, "evidence": [], "history": []}, "source": None}}
        result = rb.check_bundle(bundle)
        self.assertEqual(result["binding"], "holds", result)  # riposte_bind's exit 2: it binds and never re-performs
        self.assertEqual(result["computed_verdict_id"], v["verdict_id"])


class ExitCodeTest(unittest.TestCase):
    def test_the_sample_is_pass_with_open_exit_2(self):
        code, out, err = run(["issue", SAMPLE, "--issued-at", "2026-10-12T00:00:00.000Z"])
        self.assertEqual(code, 2)
        self.assertIn("PASS-WITH-OPEN: 8 of 13 checks could not run", err)
        self.assertTrue(out.endswith("}\n"))

    def test_a_total_off_by_five_is_fail_exit_1_with_its_arithmetic(self):
        x = sample()
        x["totals"]["total"] = 1900.0
        code, out, _ = run(["issue", write_temp(x), "--issued-at", "2026-10-12T00:00:00.000Z"])
        self.assertEqual(code, 1)
        v = json.loads(out)
        total = [c for c in v["claims"] if c["claim_id"] == "document.TOTAL_INT"][0]
        self.assertEqual(total["outcome"], "FAIL")
        self.assertEqual(total["variance"], 5.08)
        self.assertEqual(v["remedies"][0]["clears"], ["TOTAL_INT"])

    def test_one_cent_on_the_total_is_rounding_and_says_so(self):
        x = sample()
        x["totals"]["total"] = 1894.93
        code, out, _ = run(["issue", write_temp(x), "--issued-at", "2026-10-12T00:00:00.000Z"])
        total = [c for c in json.loads(out)["claims"] if c["claim_id"] == "document.TOTAL_INT"][0]
        self.assertEqual(code, 2)
        self.assertEqual(total["outcome"], "PASS")

    def test_an_exact_prior_invoice_number_fails_the_duplicate_check(self):
        x = sample()
        x["prior_invoice_ids"] = ["INV-1001"]
        code, out, _ = run(["issue", write_temp(x), "--issued-at", "2026-10-12T00:00:00.000Z"])
        self.assertEqual(code, 1)
        dup = [c for c in json.loads(out)["claims"] if c["claim_id"] == "document.DUP_PROHIB"][0]
        self.assertEqual((dup["outcome"], dup["locked"]), ("FAIL", True))


class RefusalTest(unittest.TestCase):
    def assert_refused(self, data, words):
        code, out, err = run(["issue", write_temp(data)])
        self.assertEqual(code, 3)
        self.assertEqual(out, "")
        self.assertIn(words, err)

    def test_refused_before_hashing(self):
        self.assert_refused(b"\xef\xbb\xbf{}", "byte-order mark")
        self.assert_refused(b'{"a": 1, "a": 2}', "appears twice")
        self.assert_refused(b'{"a": 9007199254740993}', "cannot be represented exactly")

    def test_a_verdict_is_not_an_extraction(self):
        with open(VECTOR_01, "rb") as fh:
            self.assert_refused(fh.read(), "replay it instead")

    def test_outside_this_build_is_named_never_guessed(self):
        x = sample()
        x["totals"]["total"] = "1894.92"
        self.assert_refused(x, "outside what this build re-performs: GRAND_TOTAL is written as the text")
        x = sample()
        x["totals"]["total "] = x["totals"].pop("total")
        self.assert_refused(x, "near-miss key rule is not re-performed")
        x = sample()
        x["service_date"] = "next Tuesday"
        self.assert_refused(x, "JavaScript Date parser")

    def test_a_date_is_read_and_asserted_as_its_iso_calendar_date(self):
        x = sample()
        x["service_date"] = "09/15/2026"
        v = engine.issue(x, "2026-10-12T00:00:00.000Z")
        time_ord = [c for c in v["claims"] if c["claim_id"] == "document.TIME_ORD"][0]
        self.assertEqual(time_ord["asserted"], "2026-09-15")
        self.assertEqual(time_ord["insufficiency"]["reason"], "REFERENCE_NOT_PROVIDED")

    def test_usage(self):
        self.assertEqual(run([])[0], 3)
        self.assertEqual(run(["issue"])[0], 3)
        self.assertEqual(run(["issue", SAMPLE, "--issued-at", "yesterday"])[0], 3)
        self.assertEqual(run(["issue", SAMPLE, "--engine", "9.9.9"])[0], 3)
        self.assertEqual(run(["replay"])[0], 3)
        self.assertEqual(run(["replay", VECTOR_01, "--fast"])[0], 3)


def vector(name):
    return os.path.join(ROOT, "conformance", "vectors", name)


def pack_bundles():
    with open(PACK, "rb") as fh:
        return [b for b in rb.read_json_bytes(fh.read(), "pack")["bundles"] if b["id"] in ("invoice-builtin-clean", "invoice-builtin-garbled-tax")]


class ReplayTest(unittest.TestCase):
    """`engine.py replay` answers through cli.py's implementation (one code path, two entry points): the replay's JSON, as the Node
    replay writes it, with `computed_input_hash` and `computed_verdict_id` beside it; no JSON when the file cannot be read."""

    def replay(self, path, *flags):
        code, out, err = run(["replay", path] + list(flags))
        return code, (json.loads(out) if out.strip() else None), err.split("\n")[0]

    def test_a_verdict_as_issued_is_verified(self):
        code, res, first = self.replay(vector("01-valid-invoice-0.6.0.json"))
        self.assertEqual((code, res["status"], res["reperformed"]["identical"], res["outcome_verified"]), (0, "REPERFORMED", True, True))
        self.assertEqual(first, "engine_py replay: outcome VERIFIED: re-performed with verify:invoice (ruleset invoice@0.1.0, engine 0.6.0) and "
                                "byte-identical, issued_at aside.")
        self.assertEqual(res["computed_verdict_id"], "cce800d0bbe37b80371bc7b478fd7d2e")

    def test_a_flipped_outcome_diverges_exit_1_naming_the_field(self):
        code, res, first = self.replay(vector("04-tampered-outcome.json"))
        self.assertEqual((code, res["status"], res["reperformed"]["first_difference"]), (1, "FAILED", "outcome"))
        self.assertIn("differs from the presented one at `outcome`", first)

    def test_a_broken_binding_fails_before_anything_is_re_performed(self):
        code, res, first = self.replay(vector("05-tampered-input-figure.json"))
        self.assertEqual((code, first), (1, "engine_py replay: FAILED: input_hash does not match the supplied inputs: this verdict is not for these inputs"))
        code, res, first = self.replay(vector("07-tampered-verdict-id.json"))
        self.assertEqual(code, 1)
        self.assertNotIn("reperformed", res)
        self.assertEqual(first, "engine_py replay: FAILED: verdict_id does not derive from input_hash + ruleset@version + engine_version + "
                                "remedy_table_hash (expected cce800d0bbe37b80371bc7b478fd7d2e)")

    def test_a_repeated_key_is_refused_with_its_path(self):
        code, res, first = self.replay(vector("08-refused-duplicate-key.json"))
        self.assertEqual((code, res), (3, None))
        self.assertTrue(first.startswith("engine_py replay: error reading input: "), first)
        self.assertIn('the key "outcome" appears twice in one object (at $.verdict.outcome)', first)

    def test_engine_0_0_1_deleted_remedies_fail_unless_lenient(self):
        code, res, first = self.replay(vector("11-deleted-remedies-0.0.1.json"))
        self.assertEqual((code, res["reperformed"]["first_difference"]), (1, "remedies"))
        self.assertIn("the verdict carries no remedies", first)
        code, res, first = self.replay(vector("11-deleted-remedies-0.0.1.json"), "--lenient-remedies")
        self.assertEqual(code, 0)
        self.assertIn("engine 0.0.1) and byte-identical", first)

    def test_strict_fails_what_was_not_re_performed(self):
        self.assertEqual(self.replay(vector("16-missing-issued-at.json"))[0], 0)
        self.assertEqual(self.replay(vector("16-missing-issued-at.json"), "--strict")[0], 1)
        code, res, first = self.replay(vector("17-annotation-channel.json"), "--strict")
        self.assertEqual(code, 1)
        self.assertIn("Not re-performed (not the engine's output): channel", first)

    def test_no_inputs_is_structure_only_and_an_envelope_s_signature_is_checked(self):
        with open(VECTOR_01, "rb") as fh:
            bundle = rb.read_json_bytes(fh.read(), "vector 01")
        self.assertEqual(run(["replay", write_temp(json.dumps(bundle["verdict"]).encode())])[0], 2)
        env = {"verdict": {"verdict": bundle["verdict"], "alg": "ed25519", "public_key": "k", "signature": "s"}, "inputs": bundle["inputs"]}
        code, out, err = run(["replay", write_temp(json.dumps(env).encode())])
        # the Node replay's words for a key that is not a public key (measured 2026-10-20)
        self.assertEqual((code, err.split("\n")[0]), (1, "engine_py replay: FAILED: the envelope's signature does not verify (signature "
                                                         "verification errored: error:1E08010C:DECODER routines::unsupported)"))


class EngineZeroZeroOneTest(unittest.TestCase):
    def test_the_pack_bundles_are_re_issued_as_engine_0_0_1_said_them(self):
        for b in pack_bundles():
            v, inp = b["verdict"], b["inputs"]
            again = engine.issue(inp["extraction"], v["issued_at"], engine=v["engine_version"], references=inp["references"], source=inp["source"])
            self.assertEqual(rb.canonical_json(engine._fix_ints(again)), rb.canonical_json(v), b["id"])
            self.assertNotIn("gate_status", again)
            self.assertNotIn("scope", again)
            self.assertNotIn("remedy_table_hash", again)

    def test_the_text_figure_is_read_leniently_under_0_0_1_and_refused_as_outside_under_0_6_0(self):
        garbled = [b for b in pack_bundles() if b["id"] == "invoice-builtin-garbled-tax"][0]
        x = garbled["inputs"]["extraction"]
        v = engine.issue(x, "2026-10-12T00:00:00.000Z", engine="0.0.1")
        tax = [c for c in v["claims"] if c["claim_id"] == "document.TAX_INT"][0]
        self.assertEqual(tax["outcome"], "PASS")
        self.assertIn({"locator": {"kind": "field", "source": "invoice", "path": "totals.tax"}, "value": 144.42, "confidence": 100,
                       "role": "OPERAND", "original": "°144.42", "normalizations": ["currency_symbols_removed"]}, tax["evidence"])
        with self.assertRaises(engine.Outside):
            engine.issue(x, "2026-10-12T00:00:00.000Z", engine="0.6.0")


class TeethTest(unittest.TestCase):
    """The comparison has teeth (SPEC.md): a changed check tolerance in this engine makes the full-byte
    comparison fail, while input_hash and verdict_id stay the same, exactly as REPLAY.md derives them (from the inputs, the
    ruleset label, the engine and the remedy table; a check's tolerance is in none of them)."""

    def setUp(self):
        self.saved = R.AXIOMS["TAX_INT"]["predicates"]
        R.AXIOMS["TAX_INT"]["predicates"] = [("TAX_AMOUNT", "=", "EXPECTED_TAX_AMOUNT", 0.02)]  # one cent becomes two

    def tearDown(self):
        R.AXIOMS["TAX_INT"]["predicates"] = self.saved

    def recorded(self):
        with open(VECTOR_01, "rb") as fh:
            return rb.read_json_bytes(fh.read(), "vector 01")["verdict"]

    def test_the_bytes_differ_and_the_ids_do_not(self):
        rec = self.recorded()
        v = engine._fix_ints(engine.issue(sample(), rec["issued_at"], engine=rec["engine_version"]))
        self.assertEqual((v["input_hash"], v["verdict_id"]), (rec["input_hash"], rec["verdict_id"]))
        self.assertNotEqual(rb.canonical_json(v), rb.canonical_json(rec))
        self.assertEqual(engine.first_difference(v, rec), "claims[2].computation.tolerance.abs")

    def test_the_replay_of_the_recorded_verdict_diverges_exit_1(self):
        code, out, err = run(["replay", VECTOR_01])
        res = json.loads(out)
        self.assertEqual((code, res["status"], res["reperformed"]["first_difference"]), (1, "FAILED", "claims[2].computation.tolerance.abs"))
        rec = self.recorded()
        self.assertEqual((res["computed_input_hash"], res["computed_verdict_id"]), (rec["input_hash"], rec["verdict_id"]))

    @unittest.skipUnless(os.path.isfile(NODE_CLI), "can't tell: packages/verify/dist/cli.js is not built (npm run build at the root)")
    def test_the_node_engine_s_bytes_differ_from_the_changed_engine_s(self):
        p = subprocess.run(["node", NODE_CLI, SAMPLE], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        node = p.stdout.decode("utf-8")
        issued_at, label = json.loads(node)["issued_at"], json.loads(node)["engine_version"]
        changed = engine.render(engine.issue(sample(), issued_at, engine=label))
        self.assertNotEqual(changed, node)
        self.tearDown()
        self.assertEqual(engine.render(engine.issue(sample(), issued_at, engine=label)), node)  # and with the tolerance restored, identical
        self.setUp()


class JavaScriptSemanticsTest(unittest.TestCase):
    def test_math_round_ties_toward_positive_infinity(self):
        self.assertEqual(engine.js_round(2.5), 3.0)
        self.assertEqual(engine.js_round(-2.5), -2.0)
        self.assertEqual(engine.round4(144.41625), 144.4163)

    def test_to_fixed_rounds_the_exact_double_half_up(self):
        self.assertEqual(engine.js_to_fixed2(0.125), "0.13")
        self.assertEqual(engine.js_to_fixed2(-5.08), "-5.08")
        self.assertEqual(engine.js_to_fixed2(1.005), "1.00")  # 1.005 is 1.00499999... as a double

    def test_object_keys_put_array_indices_first(self):
        self.assertEqual(engine.js_keys({"b": 1, "10": 2, "9": 3}), ["9", "10", "b"])


class PythonRegexTrapsTest(unittest.TestCase):
    """Where Python's regular expressions read text differently from JavaScript's (2026-10-20): `$` also matches before a final
    newline, `\\d` matches every script's digits, `\\s` takes U+001C to U+001F, and re.I folds `ſ` onto `s`. Each case below is the
    Node engine's measured answer; each failed before its fix (the earlier answer is named)."""

    KEYED = {"5\n": 1.0, "10": 2.0, "a": 3.0, "7": 4.0}

    def test_a_key_ending_in_a_newline_is_no_array_index(self):
        # Node: Object.keys gives 7, 10, "5\n", a; canonicalize and its sha256 as below (before: "5\n" sorted as index 5)
        self.assertEqual(engine.js_keys(self.KEYED), ["7", "10", "5\n", "a"])
        self.assertEqual(rb.canonical_json(self.KEYED), '{"7":4,"10":2,"5\\n":1,"a":3}')
        self.assertEqual(rb.sha256_hex(rb.canonical_json(self.KEYED)), "08283184249663187179de2b1f1176d71c24642e67e585cdc13927c0de6d129d")

    def test_a_repeated_key_ending_in_a_newline_is_named_as_the_engine_names_it(self):
        # Node duplicateKeyPath: {"path":"$[\"a\\n\"]","key":"a\n"} (before: $.a and a raw newline)
        self.assertEqual(engine.duplicate_key_path('{"a\\n":1,"a\\n":2}'), ('$["a\\n"]', "a\n"))

    def test_a_number_past_2_53_at_a_key_ending_in_a_newline_is_refused_in_the_engine_s_words(self):
        # node packages/verify/dist/cli.js <file>: exit 3, this first line (before: $.a and a raw newline, in other words)
        path = write_temp(b'{"a\\n": 9007199254740994, "totals": {"total": 1}}')
        self.addCleanup(os.remove, path)
        code, out, err = run(["issue", path, "--issued-at", "2026-10-20T00:00:00.000Z"])
        self.assertEqual((code, err.split("\n")[0]), (3, (
            'verify: input refused: verify: the extraction: the number at $["a\\n"] (9007199254740994) is a number that cannot be '
            "represented exactly; write amounts as strings with two decimals. Past 9007199254740991 (2^53 - 1) a double cannot hold "
            "every whole number, so this one may already have been rounded when it was parsed, and the hash and every check would read "
            "the rounded figure. Then run it again")))

    def test_an_issued_at_ending_in_a_newline_or_in_other_digits_is_no_timestamp(self):
        one = vector_bundle()
        for ts in (one["verdict"]["issued_at"] + "\n", "٢٠٢٦-١٠-٠٣T٠٠:٠٠:٠٠.٠٠٠Z"):
            self.assertIsNotNone(rb._issued_at_problem(ts), repr(ts))  # the binding verifier (before: None for both)
            with self.assertRaises(rb.Refused):
                rb.check_bundle(dict(one, verdict=dict(one["verdict"], issued_at=ts)))
        path = write_bundle(dict(one, verdict=dict(one["verdict"], issued_at=one["verdict"]["issued_at"] + "\n")))
        self.addCleanup(os.remove, path)
        code, out, err = run(["replay", path])
        # the Node replay: exit 3, this first line (measured 2026-10-20)
        self.assertEqual((code, err.split("\n")[0]), (3, 'engine_py replay: input refused: issued_at is not an ISO-8601 timestamp: '
                                                         '"2026-10-08T01:29:23.004Z\\n". A verdict records when it was issued as, for '
                                                         'example, 2026-10-05T16:03:24.839Z'))

    def test_math_round_of_an_infinity_is_that_infinity(self):
        inf = float("inf")
        self.assertEqual((engine.js_round(inf), engine.js_round(-inf)), (inf, -inf))
        self.assertTrue(engine.js_round(float("nan")) != engine.js_round(float("nan")))

    def test_engine_0_5_0_figures_read_as_the_engine_reads_them(self):
        # verify(x, { engine: '0.5.0' }) in the Node library, JSON.stringify(v, null, 2) + "\n", sha256 (measured 2026-10-20)
        cases = (
            ("a text figure past the double range (before: OverflowError, exit 1)", {"subtotal": "1e999", "tax": 1.0, "total": 2.0},
             "8504a3eb0c8413560919303c5fc8442cddaaabcc6eba0367c4d14d91968e1d33"),
            ("a quantity range around U+001C, which JavaScript's \\s does not take (before: read as a range)",
             {"invoice_number": "INV-9", "line_items": [{"description": "x", "quantity": "5\x1c-\x1c7", "unit_price": 10.0, "amount": 50.0}],
              "totals": {"subtotal": 50.0, "total": 50.0}}, "7abaf1c28b24aeb57fa668b497e49f7952570feb0261fa09271e67333fb34661"),
            ("a quantity range with spaces", {"invoice_number": "INV-9", "line_items": [{"description": "x", "quantity": "5 - 7", "unit_price": 10.0,
                                                                                          "amount": 50.0}], "totals": {"subtotal": 50.0, "total": 50.0}},
             "011749b0a26b10aee2dc81cc12c52e55c5976264f204afda384553b2d60e31aa"),
            ("a unit after U+001C", {"invoice_number": "INV-9", "line_items": [{"description": "x", "quantity": "10\x1chrs", "unit_price": 10.0,
                                                                                 "amount": 100.0}], "totals": {"subtotal": 100.0, "total": 100.0}},
             "02ce051e0fc397d04f0dcb0858525a3be552294b1548b6769581d161b093d3f6"))
        for name, x, sha in cases:
            text = engine.render(engine.issue(x, "2026-10-20T00:00:00.000Z", engine="0.5.0"))
            self.assertEqual(rb.sha256_hex(text), sha, name)
        path = write_temp(b'{"subtotal": "1e999", "tax": 1, "total": 2}')
        self.addCleanup(os.remove, path)
        code, out, err = run(["issue", path, "--engine", "0.5.0", "--issued-at", "2026-10-20T00:00:00.000Z"])
        self.assertEqual((code, err), (2, "engine_py: INSUFFICIENT_DATA: none of the 5 checks could run\n"))  # the Node verdict's gate

    def test_a_month_written_with_a_long_s_or_after_u001c_is_left_to_the_date_parser_never_guessed(self):
        # JavaScript's /Sep/i does not match "ſep", and its \s+ does not take U+001C: the engine hands both to the Date parser, which
        # this build does not re-perform (before: the U+001C one was read as 2026-09-15; the long s was already left alone)
        for text in ("ſep 15, 2026", "Sep\x1c15, 2026"):
            x = sample()
            x["service_date"] = text
            with self.assertRaises(engine.Outside, msg=repr(text)):
                engine.issue(x, "2026-10-20T00:00:00.000Z", engine="0.5.0")


def claim(v, claim_id):
    return [c for c in v["claims"] if c["claim_id"] == claim_id][0]


def wording_cases():
    """The sample and copies of it that reach every way an invoice explanation is worded: a check that holds, one that fails,
    a pass inside the rounding band, a fail above the rounding cap, a check held back on a guessed field, a check not given
    what it needs, and one that could not compare."""
    def changed(fn):
        x = sample()
        fn(x)
        return x

    def guessed(x, amount=1500.0):
        x["line_items"][0] = {"description": "Consulting", "quantity": 10.0, "unit_price": 150.0, "sum": amount}  # found by a near match only
        x["grand_total"] = x["totals"].pop("total")

    above_cap = {"invoice_number": "INV-2001", "line_items": [{"description": "Plant", "quantity": 1.0, "unit_price": 100000.5, "amount": 100000.5}],
                 "totals": {"subtotal": 100000.5, "tax_rate": 0.1, "tax": 10000.05, "total": 110001.55}}
    millions = {"invoice_number": "INV-3001", "line_items": [{"description": "Turbine", "quantity": 3.0, "unit_price": 1234567.89, "amount": 3703703.67}],
                "totals": {"subtotal": 3703703.67, "tax_rate": 0.07, "tax": 259259.26, "total": 3962962.93}}
    return [
        ("the sample", sample()),
        ("a total five over", changed(lambda x: x["totals"].__setitem__("total", 1899.92))),
        ("a total five under", changed(lambda x: x["totals"].__setitem__("total", 1889.92))),
        ("a line amount three over", changed(lambda x: x["line_items"][0].__setitem__("amount", 1503.0))),
        ("a tax one cent over", changed(lambda x: x["totals"].__setitem__("tax", 144.43))),
        ("a total above the rounding cap", above_cap),
        ("a line amount found by a near match", changed(guessed)),
        ("a near-matched line amount that is off", changed(lambda x: guessed(x, 1501.0))),
        ("a tax rate that is not a number", changed(lambda x: x["totals"].__setitem__("tax_rate", True))),
        ("a total that is not a number", changed(lambda x: x["totals"].__setitem__("total", True))),
        ("no subtotal", changed(lambda x: x["totals"].pop("subtotal"))),
        ("no line items", changed(lambda x: x.pop("line_items"))),
        ("a discount and a service charge", changed(lambda x: x["totals"].update({"discount": 50.0, "service_charge": 20.25, "total": 1885.17}))),
        ("a unit price with four decimals", changed(lambda x: (x["line_items"].__setitem__(1, {"description": "Parts", "quantity": 10.0, "unit_price": 25.0456, "amount": 250.46}),
                                                              x["totals"].update({"subtotal": 1750.46, "tax": 144.41, "total": 1894.87})))),
        ("figures in the millions", millions),
        ("an exact prior invoice number", changed(lambda x: x.__setitem__("prior_invoice_ids", ["INV-1001"]))),
    ]


class WordsTest(unittest.TestCase):
    """Engine 0.7.1 words each invoice explanation in a controller's words (rulesets/invoice/words.ts): what was checked and
    the figures. Engines 0.7.0 and earlier keep the kernel's text byte for byte. Only the sentence changes."""
    JARGON = re.compile(r"\bLaw of\b|predicates|VIOLATED|missing bindings|\b[A-Z]+_[A-Z_]+\b")

    def issue(self, x, e="0.7.1"):
        return engine.issue(x, "2026-10-12T00:00:00.000Z", engine=e)

    def test_the_default_label_is_the_node_build_s(self):
        self.assertEqual(R.ENGINE_VERSION, engine.ENGINES[-1])
        self.assertEqual(engine.issue(sample(), "2026-10-12T00:00:00.000Z")["engine_version"], "0.7.2")

    def test_a_check_that_holds_says_what_was_checked_and_the_figures(self):
        c = claim(self.issue(sample()), "document.TOTAL_INT")
        self.assertEqual(c["explanation"], "total = subtotal + tax − discount: 1,894.92 computed, 1,894.92 on the invoice, the same to the cent.")
        self.assertEqual(c["rule_name"], "Law of the Bottom Line")  # the name stays an identifier

    def test_a_fail_names_both_figures_and_the_difference(self):
        x = sample()
        x["totals"]["total"] = 1899.92
        c = claim(self.issue(x), "document.TOTAL_INT")
        self.assertEqual((c["outcome"], c["explanation"]),
                         ("FAIL", "total = subtotal + tax − discount: 1,894.92 computed, but the invoice says 1,899.92 (a difference of 5.00)"))

    def test_a_pass_inside_the_rounding_band_keeps_its_rounding_sentence(self):
        x = sample()
        x["totals"]["tax"] = 144.43
        c = claim(self.issue(x), "document.TAX_INT")
        self.assertEqual(c["outcome"], "PASS")
        self.assertRegex(c["explanation"], r"^Within tolerance \(.*\): treated as rounding, not error\. "
                                           r"tax = subtotal × tax rate: 144\.4163 computed, 144\.43 on the invoice\.$")

    def test_a_fail_above_the_rounding_cap_keeps_its_rounding_note(self):
        c = claim(self.issue(dict(wording_cases())["a total above the rounding cap"]), "document.TOTAL_INT")
        self.assertEqual(c["outcome"], "FAIL")
        self.assertTrue(c["explanation"].startswith("total = subtotal + tax − discount: 110,000.55 computed, but the invoice says 110,001.55 "
                                                    "(a difference of 1.00) Not treated as rounding: |variance| 1 is within 0.03% of 110000.55"),
                        c["explanation"])

    def test_a_check_that_could_not_run_says_what_it_was_not_given(self):
        v = self.issue(sample())
        self.assertEqual(claim(v, "line[0].RATE_SUP")["explanation"],
                         "Can't tell whether the unit price is within the contract's rate: not given: a contract rate for this line")
        self.assertEqual(claim(v, "document.TIME_ORD")["explanation"],
                         "Can't tell whether the service date falls within the contract's term: not given: the service date on the "
                         "invoice, the contract's start date, the contract's end date")

    def test_a_check_held_back_on_a_guessed_field_says_why(self):
        c = claim(self.issue(dict(wording_cases())["a line amount found by a near match"]), "line[0].MATH_INT")
        self.assertEqual((c["outcome"], c["insufficiency"]["reason"]), ("INSUFFICIENT_DATA", "AMBIGUOUS_FIELD"))
        self.assertEqual(c["explanation"], "Can't tell whether the line's amount matches its quantity times its unit price: a figure it "
                                           "rests on was found only by a near match of its field name, and nothing is decided on a "
                                           "guessed field. Give it under a field name the ruleset reads")

    def test_the_subtotal_sentence_names_the_computed_sum_and_the_invoice_s_subtotal(self):
        # SUM_INT's predicate is LINE_ITEMS_SUM = SUBTOTAL: asserted is the computed sum of the line amounts, computation.result the
        # subtotal the invoice states, the other way round from the total, tax and line checks
        x = sample()
        x["line_items"][0]["amount"] = 1503.0
        c = claim(self.issue(x), "document.SUM_INT")
        self.assertEqual((c["asserted"], c["computation"]["result"]), (1753.5, 1750.5))
        self.assertEqual(c["explanation"], "subtotal = the sum of the line amounts: 1,753.50 computed, but the invoice says 1,750.50 (a difference of 3.00)")
        self.assertEqual(claim(self.issue(x), "line[0].MATH_INT")["explanation"],
                         "amount = quantity × unit price: 1,500.00 computed, but the invoice says 1,503.00 (a difference of 3.00)")

    def test_figures_read_as_a_controller_reads_them(self):
        self.assertEqual([engine._figure(v) for v in (1894.92, 1500.0, 12.3, 144.4163, 250.456, -100.0, 1234567.89, 0.0)],
                         ["1,894.92", "1,500.00", "12.30", "144.4163", "250.456", "-100.00", "1,234,567.89", "0.00"])
        self.assertEqual((engine._money2(-5.000000000000227), engine._money2(1234.5)), ("5.00", "1,234.50"))
        self.assertEqual([engine._count(v) for v in (10.0, 9.5, 12345.0)], ["10", "9.5", "12,345"])
        # toFixed rounds the exact double: 144.41625 is stored just below the tie, 0.125 and 2.5 are ties (as node -e prints them)
        self.assertEqual((engine.js_to_fixed(144.41625, 4), engine.js_to_fixed(0.125, 2), engine.js_to_fixed(2.5, 0)), ("144.4162", "0.13", "3"))

    def test_no_explanation_carries_a_kernel_name_or_a_role_in_capitals(self):
        for name, x in wording_cases():
            for c in self.issue(x)["claims"]:
                self.assertNotRegex(c["explanation"], self.JARGON, "%s, %s" % (name, c["claim_id"]))

    def test_engine_0_7_0_and_earlier_keep_the_kernel_text(self):
        for e in engine.ENGINES[:engine.ENGINES.index("0.7.1")]:  # every engine before the words (0.7.1 and later explain in words)
            self.assertEqual(claim(self.issue(sample(), e), "document.TOTAL_INT")["explanation"], "Law of the Bottom Line: All predicates satisfied.", e)
        x = sample()
        x["totals"]["total"] = 1899.92
        self.assertEqual(claim(self.issue(x, "0.7.0"), "document.TOTAL_INT")["explanation"], "Law of the Bottom Line VIOLATED: 1899.92 ≠ 1894.92 (diff: 5.00)")
        self.assertEqual(claim(self.issue(sample(), "0.7.0"), "line[0].RATE_SUP")["explanation"], "Cannot evaluate: missing bindings for RATE_CONTRACTED")

    def test_only_the_sentence_changes(self):
        for name, x in wording_cases():
            a, b = self.issue(x, "0.7.0"), self.issue(x, "0.7.1")
            for k in ("outcome", "gate_status", "coverage", "remedies", "input_hash", "remedy_table_hash"):
                self.assertEqual(a.get(k), b.get(k), "%s: %s" % (name, k))
            strip = lambda v: [{k: c[k] for k in c if k != "explanation"} for c in v["claims"]]
            self.assertEqual(strip(a), strip(b), name)
            self.assertNotEqual(a["verdict_id"], b["verdict_id"])  # the label enters the id


def vector_bundle(name="01-valid-invoice-0.6.0.json"):
    with open(vector(name), "rb") as fh:
        return rb.read_json_bytes(fh.read(), name)


def write_bundle(obj, suffix=".json"):
    fd, path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as fh:
        fh.write(obj if isinstance(obj, bytes) else json.dumps(obj, ensure_ascii=False).encode("utf-8"))
    return path


CARRIED = "engine_py replay: carried, not checked: %s (outside the verdict and its inputs: a replay compares neither; --strict refuses them)"
ALLOWED = "engine_py replay: carried (allowed): %s (the caller keys a bundle may carry beside its verdict: not checked, and --strict allows them)"
OUTSIDE = "outside keys under --strict: %s (carried beside the verdict, not checked: remove them, or replay without --strict)"
STATED = ("engine_py replay: --allow-unknown-keys was given: a key a bundle or a signed envelope does not define is named and carried, not "
          "checked, instead of refused (the caller's stated choice; --strict still refuses it)")
# the Node replay's first lines for a key a bundle or an envelope does not define (2026-10-19), as it printed them on 2026-10-20
UNKNOWN_BUNDLE = ("engine_py replay: input refused: the bundle carries a key its format does not define: %s (a bundle is { verdict, inputs, "
                  "options? } with the caller keys id and note, and beside an AP verdict the gate's fields, which a replay compares; a replay "
                  "checks nothing else, so it refuses what it would not check: remove it, or replay with --allow-unknown-keys to have it named "
                  "and carried, not checked)")
UNKNOWN_ENVELOPE = ("engine_py replay: input refused: the signed envelope carries a key its format does not define: %s (a signed envelope is "
                    "{ verdict, alg, public_key, signature }; a replay checks nothing else, so it refuses what it would not check: remove it, or "
                    "replay with --allow-unknown-keys to have it named and carried, not checked)")


class CarriedKeysTest(unittest.TestCase):
    """A key a bundle or a signed envelope does not define is refused before anything is hashed (exit 3; REPLAY.md, "Keys outside
    the verdict and its inputs", 2026-10-19); --allow-unknown-keys reads it as before: named on every replay, the flag stated, and
    refused by --strict. `id` and `note` at a bundle's top level are allowed ("Two caller keys are allowed")."""

    def replay(self, bundle, *flags):
        path = write_bundle(bundle)
        self.addCleanup(os.remove, path)
        code, out, err = run(["replay", path] + list(flags))
        return code, json.loads(out), err.split("\n")

    def setUp(self):
        one = vector_bundle()
        self.v, self.i = one["verdict"], one["inputs"]

    def test_a_key_the_bundle_does_not_define_is_refused_before_hashing(self):
        for flags in ([], ["--strict"]):
            code, res, lines = self.replay({"verdict": self.v, "inputs": self.i, "extra": 1.0}, *flags)
            self.assertEqual((code, lines[0], lines[1]), (3, UNKNOWN_BUNDLE % "extra", ""), flags)  # the refusal is the whole answer
            self.assertEqual((res["status"], res["unknown_keys"]), ("REFUSED", ["extra"]))
            self.assertNotIn("carried_not_checked", res)

    def test_allow_unknown_keys_names_it_on_the_line_under_the_first_and_says_so(self):
        code, res, lines = self.replay({"verdict": self.v, "inputs": self.i, "extra": 1.0}, "--allow-unknown-keys")
        self.assertEqual(code, 0)
        self.assertTrue(lines[0].startswith("engine_py replay: outcome VERIFIED: "), lines[0])
        self.assertEqual((lines[1], lines[2]), (CARRIED % "extra", STATED))
        self.assertEqual((res["carried_not_checked"], res["allow_unknown_keys"]), (["extra"], "stated"))
        self.assertNotIn("carried_allowed", res)

    def test_strict_refuses_a_carried_key_exit_1(self):
        code, res, lines = self.replay({"verdict": self.v, "inputs": self.i, "extra": 1.0}, "--allow-unknown-keys", "--strict")
        self.assertEqual(code, 1)
        self.assertEqual(res["strict"], {"ok": False, "problems": [OUTSIDE % "extra"]})
        self.assertIn("engine_py replay: STRICT: FAILED: the outcome re-performed byte-identical, but not everything in the file was:", lines)
        self.assertIn("  " + OUTSIDE % "extra", lines)

    def test_an_annotation_member_outside_its_shape_is_refused_whatever_the_flags(self):
        v = dict(self.v, action_context={"tool_name": "t", "approved": True, "amount": "1894.92"})
        for flags in ([], ["--strict"], ["--allow-unknown-keys"]):
            code, res, lines = self.replay({"verdict": v, "inputs": self.i}, *flags)
            self.assertEqual(code, 3, flags)
            self.assertEqual(lines[0], "engine_py replay: input refused: the verdict's action_context carries members its declared shape { "
                                       "tool_name, call_id, argument_path } does not have: action_context.approved, action_context.amount (an "
                                       "annotation is added after the engine and is never compared, so a member it does not declare is a claim "
                                       "nothing checks; remove them: annotations sit outside what the verdict_id binds, so the verdict replays "
                                       "without them)")
        v = dict(self.v, ledger={"tenant_id": "a", "reviewer": {"id": "r", "rating": 1}}, case={"case_id": "c", "x": 1})
        code, res, lines = self.replay({"verdict": v, "inputs": self.i})
        self.assertEqual(code, 3)
        self.assertTrue(lines[0].startswith("engine_py replay: input refused: the verdict's ledger.reviewer carries a member its declared shape "
                                            "{ id, decided_at, decision, note } does not have: ledger.reviewer.rating; the verdict's case carries "
                                            "a member its declared shape { case_id, prior_verdict_id, move_id } does not have: case.x (an "), lines[0])
        v = dict(self.v, ledger={"tenant_id": "a", "retention_until": "2027-01-01", "reviewer": {"id": "r", "decided_at": "x", "decision": "ok"}})
        self.assertEqual(self.replay({"verdict": v, "inputs": self.i})[0], 0)  # the declared shape replays as before

    def test_the_same_bundle_without_the_key_names_nothing(self):
        code, res, lines = self.replay({"verdict": self.v, "inputs": self.i}, "--strict")
        self.assertEqual((code, res["strict"]), (0, {"ok": True, "problems": []}))
        self.assertFalse([l for l in lines if "carried" in l])
        self.assertNotIn("carried_not_checked", res)

    def test_id_and_note_are_allowed_named_apart_and_pass_strict(self):
        code, res, lines = self.replay({"note": "the door invoice", "verdict": self.v, "inputs": self.i, "id": "case-1"}, "--strict")
        self.assertEqual(code, 0)
        self.assertEqual(lines[1], ALLOWED % "note, id")  # in the file's order
        self.assertEqual(res["carried_allowed"], ["note", "id"])
        self.assertNotIn("carried_not_checked", res)
        self.assertEqual(res["strict"], {"ok": True, "problems": []})

    def test_a_third_key_is_refused_naming_only_it_and_with_the_flag_fails_strict(self):
        bundle = {"id": "x", "verdict": self.v, "inputs": self.i, "approved_by": "someone", "note": "n"}
        code, res, lines = self.replay(bundle)
        self.assertEqual((code, lines[0], res["unknown_keys"]), (3, UNKNOWN_BUNDLE % "approved_by", ["approved_by"]))
        code, res, lines = self.replay(bundle, "--allow-unknown-keys", "--strict")
        self.assertEqual(code, 1)
        self.assertEqual((lines[1], lines[2], lines[3]), (CARRIED % "approved_by", STATED, ALLOWED % "id, note"))
        self.assertEqual((res["carried_not_checked"], res["carried_allowed"]), (["approved_by"], ["id", "note"]))
        self.assertEqual(res["strict"]["problems"], [OUTSIDE % "approved_by"])

    def test_a_note_in_options_or_beside_an_envelope_is_a_key_the_format_does_not_define(self):
        code, res, lines = self.replay({"verdict": self.v, "inputs": self.i, "options": {"note": "x"}})
        self.assertEqual((code, lines[0]), (3, UNKNOWN_BUNDLE % "options.note"))
        code, res, lines = self.replay({"verdict": self.v, "inputs": self.i, "options": {"note": "x"}}, "--allow-unknown-keys", "--strict")
        self.assertEqual((code, res["carried_not_checked"], lines[1]), (1, ["options.note"], CARRIED % "options.note"))
        self.assertNotIn("carried_allowed", res)
        env = {"verdict": self.v, "alg": "ed25519", "public_key": "k", "signature": "s", "note": "n"}
        code, res, lines = self.replay(env)
        self.assertEqual((code, lines[0], res["unknown_keys"]), (3, UNKNOWN_ENVELOPE % "note", ["note"]))
        code, res, lines = self.replay(env, "--allow-unknown-keys")
        self.assertEqual(code, 1)  # with the flag, the envelope's signature is checked ("k" is no key), and its key is named all the same
        self.assertEqual((lines[1], lines[2], res["carried_not_checked"]), (CARRIED % "note", STATED, ["note"]))

    def test_with_the_flag_named_on_every_run_whatever_the_first_line_says(self):
        broken_id = vector_bundle("07-tampered-verdict-id.json")["verdict"]
        flipped = vector_bundle("04-tampered-outcome.json")["verdict"]
        for what, bundle, exit_code in (
                ("a binding that fails", {"verdict": broken_id, "inputs": self.i, "extra": 1.0}, 1),
                ("a diverged outcome", {"verdict": flipped, "inputs": self.i, "extra": 1.0}, 1),
                ("no inputs", {"verdict": self.v, "extra": 1.0}, 2),
                ("a malformed issued_at", {"verdict": dict(self.v, issued_at="yesterday"), "inputs": self.i, "extra": 1.0}, 3)):
            code, res, lines = self.replay(bundle, "--allow-unknown-keys")
            self.assertEqual((code, lines[1], lines[2]), (exit_code, CARRIED % "extra", STATED), what)
            self.assertEqual(res["carried_not_checked"], ["extra"], what)
            self.assertEqual(self.replay(bundle)[0], 3, what)  # without it, each is refused before anything else

    def test_a_cold_reader_s_files_are_refused_naming_their_keys(self):
        for name, first in (("b-extra-top.json", UNKNOWN_BUNDLE % "extra"), ("env-extra-top-pinA.json", UNKNOWN_ENVELOPE % "issued_note")):
            code, out, err = run(["replay", os.path.join(COLD, name)])
            self.assertEqual((code, err.split("\n")[0]), (3, first), name)
            code, out, err = run(["replay", os.path.join(COLD, name), "--allow-unknown-keys"])
            self.assertEqual(err.split("\n")[1], CARRIED % ("extra" if name.startswith("b-") else "issued_note"), name)

    def test_the_pack_s_invoice_bundles_pass_strict(self):
        for b in pack_bundles():
            code, res, lines = self.replay(b, "--strict")
            self.assertEqual((code, res["carried_allowed"], lines[1]), (0, ["id", "note"], ALLOWED % "id, note"), b["id"])
            self.assertNotIn("carried_not_checked", res)

    def test_a_number_that_cannot_be_represented_exactly_advises_re_issuing_the_verdict(self):
        code, out, err = run(["replay", vector("10-refused-inexact-number.json")])
        self.assertEqual(code, 3)
        self.assertIn("cannot be represented exactly; re-issue the verdict with the amount as a string; a replay of the existing "
                      "verdict cannot change its input", err.split("\n")[0])
        self.assertNotIn("write amounts as strings", err)


class FolderReplayTest(unittest.TestCase):
    """A folder or a .jsonl of bundles, each case replayed on its own inputs. A refused case wins the exit: 3 whenever any case was
    refused, else 1 when one diverged or failed --strict, else 2 when one was not re-performed, else 0 (REPLAY.md, "Exit codes")."""

    def folder(self, files):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        for name, data in files.items():
            if data is None:
                os.mkdir(os.path.join(d, name))
                continue
            with open(os.path.join(d, name), "wb") as fh:
                fh.write(data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode("utf-8"))
        return d

    def raw(self, name):
        with open(vector(name), "rb") as fh:
            return fh.read()

    def replay(self, path, *flags):
        code, out, err = run(["replay", path] + list(flags))
        return code, (json.loads(out) if out else None), err

    def test_a_refused_case_wins_the_exit(self):
        d = self.folder({"a.json": self.raw("01-valid-invoice-0.6.0.json"), "b.json": self.raw("04-tampered-outcome.json"),
                         "c.json": self.raw("08-refused-duplicate-key.json")})
        code, s, err = self.replay(d)
        self.assertEqual(code, 3)
        self.assertEqual([(c["name"], c["result"]) for c in s["cases"]], [("a.json", "MATCH"), ("b.json", "DIVERGED"), ("c.json", "REFUSED")])
        self.assertEqual(s["cases"][1]["first_difference"], "outcome")
        self.assertIn("engine_py replay: 3 case(s): 1 match · 1 diverged · 0 not re-performed · 1 refused\n", err)

    def test_then_a_divergence_then_a_case_not_re_performed_then_every_match(self):
        v = vector_bundle()["verdict"]
        self.assertEqual(self.replay(self.folder({"a.json": self.raw("01-valid-invoice-0.6.0.json"), "b.json": self.raw("04-tampered-outcome.json")}))[0], 1)
        self.assertEqual(self.replay(self.folder({"a.json": self.raw("01-valid-invoice-0.6.0.json"), "b.json": {"verdict": v}}))[0], 2)
        self.assertEqual(self.replay(self.folder({"a.json": self.raw("01-valid-invoice-0.6.0.json"), "b.json": self.raw("02-equivalent-reordered-crlf.json")}))[0], 0)
        exits = [engine.replay_exit({"refused": r, "diverged": d, "not_reperformed": n}) for r, d, n in ((1, 1, 1), (0, 1, 1), (0, 0, 1), (0, 0, 0))]
        self.assertEqual(exits, [3, 1, 2, 0])

    def test_a_jsonl_names_each_line_and_refuses_one_that_does_not_read(self):
        one = json.dumps(vector_bundle(), ensure_ascii=False)
        four = json.dumps(vector_bundle("04-tampered-outcome.json"), ensure_ascii=False)
        path = write_bundle(("%s\n\n{not json\n%s\n" % (one, four)).encode("utf-8"), ".jsonl")
        self.addCleanup(os.remove, path)
        code, s, err = self.replay(path)
        self.assertEqual(code, 3)
        self.assertEqual([(c["name"], c["result"]) for c in s["cases"]],
                         [(path + "#1", "MATCH"), (path + "#3", "REFUSED"), (path + "#4", "DIVERGED")])

    def test_a_case_with_a_key_its_bundle_does_not_define_is_refused_and_wins_the_exit(self):
        one = vector_bundle()
        d = self.folder({"a.json": self.raw("01-valid-invoice-0.6.0.json"),
                         "b.json": {"id": "b", "verdict": one["verdict"], "inputs": one["inputs"], "extra": 1.0}})
        code, s, err = self.replay(d)
        self.assertEqual(code, 3)
        b = s["cases"][1]
        self.assertEqual((b["result"], b["verdict_id"], b["unknown_keys"]), ("REFUSED", one["verdict"]["verdict_id"], ["extra"]))
        self.assertEqual(b["reason"], UNKNOWN_BUNDLE[len("engine_py replay: input refused: "):] % "extra")
        self.assertNotIn("carried_not_checked", s)  # refused, not carried
        self.assertEqual(s["carried_allowed"], {"b.json": ["id"]})

    def test_with_the_flag_carried_keys_are_listed_by_case_and_refused_by_strict(self):
        one = vector_bundle()
        d = self.folder({"a.json": self.raw("01-valid-invoice-0.6.0.json"),
                         "b.json": {"id": "b", "verdict": one["verdict"], "inputs": one["inputs"], "extra": 1.0}})
        code, s, err = self.replay(d, "--allow-unknown-keys")
        self.assertEqual(code, 0)
        self.assertEqual((s["carried_not_checked"], s["carried_allowed"], s["allow_unknown_keys"]), ({"b.json": ["extra"]}, {"b.json": ["id"]}, "stated"))
        self.assertIn("\n    " + CARRIED[len("engine_py replay: "):] % "extra" + "\n    " + ALLOWED[len("engine_py replay: "):] % "id" + "\n", err)
        self.assertIn(STATED + "\nengine_py replay: 2 case(s): 2 match", err)  # stated just before the summary line
        code, s, err = self.replay(d, "--allow-unknown-keys", "--strict")
        self.assertEqual((code, s["strict_failed"]), (1, 1))
        self.assertEqual([c["strict_problems"] for c in s["cases"]], [[], [OUTSIDE % "extra"]])
        self.assertIn("    STRICT: %s\n" % (OUTSIDE % "extra"), err)
        self.assertIn("engine_py replay: STRICT: FAILED: 1 matching case(s) carry something that was not re-performed (each is listed above)\n", err)

    def test_what_a_folder_replay_does_not_read_or_walk(self):
        d = self.folder({"a.json": self.raw("01-valid-invoice-0.6.0.json"), "b.txt": b"not read", "c.json": vector_bundle()["verdict"], "inner": None})
        code, s, err = self.replay(d)
        self.assertEqual(code, 3)  # a bare verdict is not a bundle: refused
        self.assertEqual([(c["name"], c["result"]) for c in s["cases"]], [("a.json", "MATCH"), ("c.json", "REFUSED")])
        self.assertEqual((s["cases"][1]["reason"], s["skipped_folders"]), (engine.NOT_A_BUNDLE, ["inner"]))
        self.assertIn("SKIPPED         inner/\n", err)
        self.assertEqual(self.replay(self.folder({"x.txt": b"no bundles here"}))[0], 3)


@unittest.skipUnless(os.path.isfile(CLI), "can't tell: packages/verify/dist/cli.js is not built (npm run build at the root)")
class AgainstNodeTest(unittest.TestCase):
    def test_compare_finds_the_shipped_sample_identical(self):
        p = subprocess.run([sys.executable, os.path.join(HERE, "compare.py")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(p.returncode, 0, p.stdout.decode() + p.stderr.decode())
        self.assertIn(b"IDENTICAL docs/doors/examples/invoice.json", p.stdout)
        self.assertIn(b"1 of 1 identical", p.stdout)

    def test_compare_catches_a_changed_byte(self):
        # A Python verdict that differs from the Node verdict must be caught: run compare with an engine that alters one claim.
        import compare
        real = compare._run

        def doctored(cmd):
            code, out, err = real(cmd)
            if cmd[0] == sys.executable:
                out = out.replace(b'"variance": 0.0037', b'"variance": 0.0038', 1)
            return code, out, err
        compare._run = doctored
        try:
            status, line = compare.compare_one(SAMPLE)
        finally:
            compare._run = real
        self.assertEqual(status, "DIFFERS", line)
        self.assertIn('"variance": 0.0037', line)

    def test_every_way_an_explanation_is_worded_is_the_node_engine_s_byte_for_byte(self):
        # what compare.py does, for each wording case: the Node verdict, then this engine's under the Node verdict's label and issued_at
        for name, x in wording_cases():
            path = write_bundle(x)
            try:
                p = subprocess.run(["node", CLI, path], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            finally:
                os.remove(path)
            node = json.loads(p.stdout.decode("utf-8"))
            self.assertEqual(node["engine_version"], "0.7.2", name)
            mine = engine.render(engine.issue(x, node["issued_at"], engine=node["engine_version"]))
            self.assertEqual(mine, p.stdout.decode("utf-8"), name)


@unittest.skipUnless(os.path.isfile(NODE_CLI), "can't tell: packages/verify/dist/cli.js is not built (npm run build at the root)")
class ReplayAgainstNodeTest(unittest.TestCase):
    """Keys a bundle does not define (refused, or carried with --allow-unknown-keys), the allowed caller keys, an annotation member
    outside its shape, --strict and a folder's exit, as the Node replay says them."""

    def both(self, target, *flags):
        n = subprocess.run(["node", NODE_CLI, "replay", target] + list(flags), cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        p = subprocess.run([sys.executable, os.path.join(HERE, "engine.py"), "replay", target] + list(flags), cwd=ROOT,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return n, p

    def test_one_bundle_names_its_keys_as_the_node_replay_does(self):
        one = vector_bundle()
        path = write_bundle({"id": "x", "verdict": one["verdict"], "inputs": one["inputs"], "approved_by": "a", "note": "n", "options": {"note": "o"}})
        self.addCleanup(os.remove, path)
        first = lambda err, lead: err.decode("utf-8").split("\n")[0][len(lead):]
        pick = lambda out: {k: json.loads(out.decode("utf-8")).get(k) for k in ("carried_not_checked", "carried_allowed", "strict", "unknown_keys", "allow_unknown_keys")}
        for flags in ([], ["--strict"]):  # refused, exit 3, in both, in the same words
            n, p = self.both(path, *flags)
            self.assertEqual((n.returncode, p.returncode), (3, 3), flags)
            self.assertEqual(first(p.stderr, "engine_py replay: "), first(n.stderr, "verify replay: "), flags)
            self.assertEqual(pick(p.stdout)["unknown_keys"], pick(n.stdout)["unknown_keys"], flags)
        for flags, exit_code in ((["--allow-unknown-keys"], 0), (["--allow-unknown-keys", "--strict"], 1)):
            n, p = self.both(path, *flags)
            self.assertEqual((n.returncode, p.returncode), (exit_code, exit_code), flags)
            lines = lambda err, lead: [l[len(lead):] for l in err.decode("utf-8").split("\n") if l.startswith((lead + "carried", lead + "--allow-unknown-keys"))]
            self.assertEqual(lines(p.stderr, "engine_py replay: "), lines(n.stderr, "verify replay: "))
            self.assertEqual(len(lines(p.stderr, "engine_py replay: ")), 3)
            self.assertEqual(pick(p.stdout), pick(n.stdout), flags)

    def test_an_annotation_member_is_refused_as_the_node_replay_refuses_it(self):
        one = vector_bundle()
        v = dict(one["verdict"], action_context={"tool_name": "t", "approved": True}, ledger={"tenant_id": "a", "reviewer": {"id": "r", "x": 1}})
        path = write_bundle({"verdict": v, "inputs": one["inputs"]})
        self.addCleanup(os.remove, path)
        for flags in ([], ["--strict"], ["--allow-unknown-keys"]):
            n, p = self.both(path, *flags)
            self.assertEqual((n.returncode, p.returncode), (3, 3), flags)
            self.assertEqual(p.stderr.replace(b"engine_py replay: ", b"verify replay: "), n.stderr, flags)

    def test_a_folder_replays_byte_for_byte_as_the_node_replay_does(self):
        one = vector_bundle()
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        for name, src in (("a.json", "01-valid-invoice-0.6.0.json"), ("b.json", "04-tampered-outcome.json"), ("c.json", "08-refused-duplicate-key.json")):
            shutil.copyfile(vector(src), os.path.join(d, name))
        with open(os.path.join(d, "d.json"), "wb") as fh:
            fh.write(json.dumps({"id": "d", "verdict": one["verdict"], "inputs": one["inputs"], "note": "n", "extra": 1, "options": {"foo": 2}},
                                ensure_ascii=False).encode("utf-8"))
        for flags in ([], ["--strict"], ["--allow-unknown-keys"], ["--allow-unknown-keys", "--strict"]):
            n, p = self.both(d, *flags)
            self.assertEqual((n.returncode, p.returncode), (3, 3), flags)  # a refused case wins in both
            self.assertEqual(p.stdout, n.stdout, flags)
            self.assertEqual(p.stderr.replace(b"engine_py replay: ", b"verify replay: "), n.stderr, flags)


@unittest.skipUnless(os.path.isfile(CLI), "can't tell: packages/verify/dist/cli.js is not built (npm run build at the root)")
class SweepTest(unittest.TestCase):
    def test_every_invoice_vector_and_pack_bundle_agrees_in_both_engines(self):
        p = subprocess.run([sys.executable, os.path.join(HERE, "sweep.py")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(p.returncode, 0, p.stdout.decode())
        self.assertIn(b"25 of 25 as expected", p.stdout)

    def test_every_engine_label_issued_here_is_verified_by_the_node_replay(self):
        garbled = sample()
        garbled["totals"]["tax"] = "°144.42"
        garbled["invoice_date"] = "2026-09-15"
        failing = sample()
        failing["totals"]["total"] = 1900.0
        cases = dict(wording_cases())
        for name, x in (("sample", sample()), ("text tax and a date", garbled), ("a failing total", failing),
                        ("a tax one cent over", cases["a tax one cent over"]), ("a line amount found by a near match", cases["a line amount found by a near match"])):
            for e in engine.ENGINES:
                if x is garbled and engine.engine_at_least(e, "0.6.0"):
                    continue  # the strict reading of text, from engine 0.6.0, is outside this build
                v = json.loads(engine.render(engine.issue(x, "2026-10-12T00:00:00.000Z", engine=e)))
                bundle = {"verdict": v, "inputs": {"extraction": x, "references": {"contract": None, "evidence": [], "history": []}, "source": None}}
                path = write_temp(json.dumps(bundle, ensure_ascii=False).encode("utf-8"))
                p = subprocess.run(["node", CLI, "replay", path], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                os.remove(path)
                self.assertEqual(p.returncode, 0, "%s, engine %s: %s" % (name, e, p.stderr.decode()[:300]))


if __name__ == "__main__":
    unittest.main()
