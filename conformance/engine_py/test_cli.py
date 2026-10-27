# Tests for the replay contract in Python (cli.py) and its Node shim. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
"""
    cd conformance/engine_py && python -m unittest test_cli

Standard library only. The words expected here were read from the Node engine's own output (Node 25, engine 0.7.2), so the
tests that do not start Node hold this build to the engine's first lines wherever Python runs. The tests that run both engines
(AgainstNodeTest) are skipped, with "can't tell", when the Node CLI is not built or Node is older than 22 (V8 worded its JSON
errors differently before). The Node CLI is found at RIPOSTE_VERIFY_CLI, else packages/verify/dist/cli.js at the repository
root, else the sibling engine folder of a source checkout (../verify/dist/cli.js).
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(os.path.dirname(HERE))

import cli as C  # noqa: E402

VECTORS = os.path.join(ROOT, "conformance", "vectors")


def _first_existing(*paths):
    for p in paths:
        if p and os.path.isfile(p):
            return p
    return None


NODE_CLI = _first_existing(os.environ.get("RIPOSTE_VERIFY_CLI"), os.path.join(ROOT, "packages", "verify", "dist", "cli.js"),
                           os.path.join(ROOT, "..", "verify", "dist", "cli.js"))
PACK = _first_existing(os.path.join(ROOT, "packages", "verify", "test", "fixtures", "engine-0.0.1-bundles.json"),
                       os.path.join(ROOT, "..", "verify", "test", "fixtures", "engine-0.0.1-bundles.json"))


def _node_major():
    try:
        out = subprocess.run(["node", "--version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.decode()
        return int(out.strip().lstrip("v").split(".")[0])
    except (OSError, ValueError):
        return 0


NODE_OK = NODE_CLI is not None and _node_major() >= 22
NODE_SKIP = "can't tell: the Node CLI is not built here, or Node is older than 22"


def first_line(text):
    for line in text.split("\n"):
        if line.strip():
            return line
    return ""


def vector(name):
    with open(os.path.join(VECTORS, name), "rb") as fh:
        return json.loads(fh.read().decode("utf-8"))


class Scratch(object):
    """A temporary folder outside the tree for constructed files, removed after use."""

    def __enter__(self):
        self.dir = tempfile.mkdtemp(prefix="engine-py-cli-")
        return self

    def __exit__(self, *a):
        shutil.rmtree(self.dir, ignore_errors=True)

    def put(self, name, obj=None, raw=None):
        p = os.path.join(self.dir, name)
        d = os.path.dirname(p)
        if not os.path.isdir(d):
            os.makedirs(d)
        with open(p, "wb") as fh:
            fh.write(raw if isinstance(raw, bytes) else (raw if raw is not None else json.dumps(obj, ensure_ascii=False)).encode("utf-8"))
        return p


def replay(*args):
    return C.run(list(args))


class V8MessagesTest(unittest.TestCase):
    """JSON.parse's error words, as Node 25 printed them for each input (read from its output on 2026-10-20)."""

    CASES = [
        ("", "Unexpected end of JSON input"),
        ("{", "Expected property name or '}' in JSON at position 1 (line 1 column 2)"),
        ("[", "Unexpected end of JSON input"),
        ('{"a":1}x', "Unexpected non-whitespace character after JSON at position 7 (line 1 column 8)"),
        ('{"a":1}\n{"b":2}', "Unexpected non-whitespace character after JSON at position 8 (line 2 column 1)"),
        ('{"a":1}\r\n{"b"}', "Unexpected non-whitespace character after JSON at position 9 (line 2 column 1)"),
        ('{"a":1}\r{"b":2}', "Unexpected non-whitespace character after JSON at position 8 (line 2 column 1)"),
        ("abc", "Unexpected token 'a', \"abc\" is not valid JSON"),
        ("abcdefghijklmnopqrstuvwxyz0123", "Unexpected token 'a', \"abcdefghij\"... is not valid JSON"),
        ('{"a"\t:\t1,\n"b":[true,false,null,x]}', "Unexpected token 'x', ...\"alse,null,x]}\" is not valid JSON"),
        ('{"a":}', "Unexpected token '}', \"{\"a\":}\" is not valid JSON"),
        ('{"a" 1}', "Expected ':' after property name in JSON at position 5 (line 1 column 6)"),
        ('{"a":1,}', "Expected double-quoted property name in JSON at position 7 (line 1 column 8)"),
        ("[1,]", "Unexpected token ']', \"[1,]\" is not valid JSON"),
        ("[1 2]", "Expected ',' or ']' after array element in JSON at position 3 (line 1 column 4)"),
        ('{"a":1 "b":2}', "Expected ',' or '}' after property value in JSON at position 7 (line 1 column 8)"),
        ('"abc', "Unterminated string in JSON at position 4 (line 1 column 5)"),
        ('"a\x01b"', "Bad control character in string literal in JSON at position 2 (line 1 column 3)"),
        ('"\\x"', "Bad escaped character in JSON at position 2 (line 1 column 3)"),
        ('"\\u12G4"', "Bad Unicode escape in JSON at position 5 (line 1 column 6)"),
        ('"\\u00', "Bad Unicode escape in JSON at position 5 (line 1 column 6)"),
        ('"\\', "Unexpected end of JSON input"),
        ("-", "No number after minus sign in JSON at position 1 (line 1 column 2)"),
        ("1e", "Exponent part is missing a number in JSON at position 2 (line 1 column 3)"),
        ("1.", "Unterminated fractional number in JSON at position 2 (line 1 column 3)"),
        ("01", "Unexpected number in JSON at position 1 (line 1 column 2)"),
        ("tr1e", "Unexpected number in JSON at position 2 (line 1 column 3)"),
        ('f"', "Unexpected string in JSON at position 1 (line 1 column 2)"),
        ("tru", "Unexpected end of JSON input"),
        ('{"a":tru}', "Unexpected token '}', \"{\"a\":tru}\" is not valid JSON"),
        ("NaN", "\"NaN\" is not valid JSON"),
        ("[0x10]", "Expected ',' or ']' after array element in JSON at position 2 (line 1 column 3)"),
        ('{"\U0001F600":1}x', "Unexpected non-whitespace character after JSON at position 8 (line 1 column 9)"),
        ('{"a":1}  \xa0', "Unexpected non-whitespace character after JSON at position 9 (line 1 column 10)"),
        ('{"a":1} ', None),
        ('{"a":[1,{"b":null}],"c":"\\u00e9"}', None),
    ]

    def test_each_input_reads_as_v8_words_it(self):
        for text, want in self.CASES:
            self.assertEqual(C.v8_json_error(text), want, repr(text))


class StrictReaderTest(unittest.TestCase):
    def test_refusals_before_hashing_name_the_place_in_the_engines_words(self):
        with self.assertRaises(C.Refused) as e:
            C.parse_json_strict('{"verdict":{"outcome":"FAIL","outcome":"PASS"}}', "f.json")
        self.assertTrue(str(e.exception).startswith('f.json: the key "outcome" appears twice in one object (at $.verdict.outcome). JSON keeps only'))
        with self.assertRaises(C.Refused) as e:
            C.parse_json_strict('{"a":[1,1e999]}', "f.json")
        self.assertTrue(str(e.exception).startswith("f.json: the number at $.a[1] is not finite (Infinity): JSON reads"))
        with self.assertRaises(C.Refused) as e:
            C.parse_json_strict('{"x y":{"p":9007199254740993}}', "f.json")
        self.assertIn('the number at $["x y"].p (9007199254740993) is a number that cannot be represented exactly; write amounts as '
                      'strings with two decimals. JSON numbers are read as doubles, and this one reads as 9007199254740992', str(e.exception))
        self.assertEqual(C.replay_advice(str(e.exception)).count("re-issue the verdict with the amount as a string"), 1)
        self.assertFalse(C.replay_advice(str(e.exception)).endswith("Then run it again"))
        with self.assertRaises(C.Refused) as e:
            C.parse_json_strict("﻿{}", "f.json")
        self.assertEqual(str(e.exception), "f.json: file starts with a UTF-8 byte-order mark; remove it (save the file as UTF-8 without BOM)")
        with self.assertRaises(C.Refused) as e:
            C.parse_json_strict("[" * 257 + "]" * 257, "f.json")
        self.assertIn("nesting too deep, limit 256: an object or array opens more than 256 levels down (at character 256)", str(e.exception))
        with self.assertRaises(C.Refused) as e:
            C.decode_utf8_strict(b'{"a":"\xff\x41"}', "f.json")
        self.assertTrue(str(e.exception).startswith("f.json is not valid UTF-8: the bytes at offset 6 (FF 41 22 7D) are not a UTF-8 character."))

    def test_spellings_of_one_decimal_are_one_input(self):
        for t in ("6125", "6125.0", "6.125e3", "612500e-2", "-0", "0.1", "0.30000000000000004"):
            self.assertTrue(C.number_text_is_exact(t), t)
        for t in ("9007199254740993", "0.10000000000000001", "123456789012345678901", "1e-400"):
            self.assertFalse(C.number_text_is_exact(t), t)

    def test_every_number_is_a_double_and_keys_keep_their_index_order_when_hashed(self):
        x = C.parse_json_strict('{"b":1,"10":2,"9":3}', "f")
        self.assertEqual(C.rb.canonical_json(x), '{"9":3,"10":2,"b":1}')
        self.assertIsInstance(x["b"], float)


class KeysTest(unittest.TestCase):
    # a public test key of the whetstone corpus (whetstone/gen.mjs derives its keys from published phrases; they sign nothing real)
    PEM_A = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA%s\n-----END PUBLIC KEY-----\n"

    def test_node_base64_skips_what_is_not_base64_and_stops_at_the_first_pad(self):
        for s, want in (("QUJD", "414243"), ("QU JD", "414243"), ("QU\nJD", "414243"), ("QUJD====", "414243"), ("QUJ=D", "4142"),
                        ("Q=UJD", ""), ("QUJ", "4142"), ("QU", "41"), ("Q", ""), ("QUJD!", "414243"), ("-_8=", "fbff"),
                        ("QUJDéRA", "41424344"), ("QUJD=QUJD", "414243")):
            self.assertEqual(C.node_base64(s).hex(), want, s)

    def test_trusted_key_forms_and_refusals_in_the_engines_words(self):
        fp = "a" * 64
        self.assertEqual(C.read_trusted_key_arg(fp.upper()), [fp])
        with self.assertRaises(C.Refused) as e:
            C.read_trusted_key_arg("6cbc469ed4af34ca")
        self.assertTrue(str(e.exception).startswith("--trusted-key 6cbc469ed4af34ca: a fingerprint prefix is not a pin"))
        with self.assertRaises(C.Refused) as e:
            C.read_trusted_key_arg("-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIG3mbNEBSIIjsvFZPsCDr0HkQF4TBHJtIOqFSgP9v5p6\n-----END PRIVATE KEY-----\n")
        self.assertTrue(str(e.exception).startswith("--trusted-key holds a PRIVATE key"))
        with self.assertRaises(C.Refused) as e:
            C.read_trusted_key_arg("no/such/key.pem")
        self.assertEqual(str(e.exception), "--trusted-key no/such/key.pem: no such file, and not a PEM public key or a 64-hex key fingerprint")

    def test_a_key_has_one_fingerprint_sha256_over_its_der(self):
        pem = self.PEM_A % "CPXg8myEliF+ZjWh1K3R4eo5zc6MC1yZOaeZ52GiF6A="
        der = C.ed25519_der(pem)
        self.assertEqual(len(der), 44)
        self.assertEqual(C.key_fingerprint(pem), C.hashlib.sha256(der).hexdigest())
        self.assertEqual(C.key_fingerprint(pem.replace("\n", "\r\n")), C.key_fingerprint(pem))
        self.assertIsNone(C.key_fingerprint("not a key"))
        self.assertEqual(C.read_trusted_key_arg(pem), [C.key_fingerprint(pem)])


class FlagsTest(unittest.TestCase):
    def test_usage_errors_read_as_the_engines(self):
        door = os.path.join(VECTORS, "01-valid-invoice-0.6.0.json")
        cases = [
            (["--json"], "verify replay: unknown option(s) --json"),
            (["--allow-open"], "verify replay: unknown option(s) --allow-open"),
            (["--stirct"], "verify replay: unknown option(s) --stirct (did you mean --strict?)"),
            (["--strict", "--strict"], "verify replay: --strict is given twice"),
            (["--trusted-key"], "verify replay: --trusted-key needs a value"),
            ([door], "verify replay: unexpected argument %s" % door),
        ]
        for extra, want in cases:
            code, out, err = replay(door, *extra)
            self.assertEqual((code, first_line(err)), (3, want), extra)
        code, out, err = replay()
        self.assertEqual(code, 3)
        self.assertTrue(first_line(err).startswith("verify replay: needs <verdict.json>"))

    def test_a_flag_the_engine_takes_and_this_build_does_not_is_refused_never_ignored(self):
        code, out, err = replay(os.path.join(VECTORS, "01-valid-invoice-0.6.0.json"), "--require-ruleset", "invoice@>=0.1.0")
        self.assertEqual(code, 3)
        self.assertIn("this build does not take --require-ruleset", first_line(err))


class VectorsTest(unittest.TestCase):
    """Every conformance vector run (conformance/vectors.json), in this build alone: the manifest's exit and phrase."""

    def test_every_vector_as_the_manifest_expects(self):
        with open(os.path.join(ROOT, "conformance", "vectors.json"), "rb") as fh:
            m = json.loads(fh.read().decode("utf-8"))
        n = 0
        for v in m["vectors"]:
            e = v["expect"]
            for args, code, phrase in [(e.get("args", []), e["engine_exit"], e["engine_says"])] + \
                    [(a.get("args", []), a["engine_exit"], a["engine_says"]) for a in e.get("also", [])]:
                got, out, err = replay(os.path.join(VECTORS, v["file"]), *args)
                self.assertEqual(got, code, "%s %s: %s" % (v["id"], args, first_line(err)))
                self.assertIn(phrase, first_line(err), v["id"])
                n += 1
        self.assertEqual(n, 23)


class ReplayTest(unittest.TestCase):
    def setUp(self):
        self.door = vector("01-valid-invoice-0.6.0.json")

    def test_a_key_the_bundle_does_not_define_is_refused_unless_allowed(self):
        with Scratch() as s:
            p = s.put("b.json", dict(self.door, extra=1))
            code, out, err = replay(p)
            self.assertEqual(code, 3)
            self.assertEqual(first_line(err), "verify replay: input refused: the bundle carries a key its format does not define: extra (a bundle "
                             "is { verdict, inputs, options? } with the caller keys id and note, and beside an AP verdict the gate's fields, "
                             "which a replay compares; a replay checks nothing else, so it refuses what it would not check: remove it, or "
                             "replay with --allow-unknown-keys to have it named and carried, not checked)")
            self.assertEqual(json.loads(out)["unknown_keys"], ["extra"])
            code, out, err = replay(p, "--allow-unknown-keys")
            self.assertEqual(code, 0)
            self.assertIn("verify replay: carried, not checked: extra", err)
            self.assertIn("verify replay: --allow-unknown-keys was given", err)
            code, out, err = replay(p, "--allow-unknown-keys", "--strict")
            self.assertEqual(code, 1)
            self.assertIn("  outside keys under --strict: extra", err)

    def test_an_annotation_member_outside_its_shape_is_refused_with_or_without_strict(self):
        v = dict(self.door["verdict"], action_context={"tool_name": "t", "approved": True})
        with Scratch() as s:
            p = s.put("b.json", dict(self.door, verdict=v))
            for flags in ([], ["--strict"], ["--allow-unknown-keys"]):
                code, out, err = replay(p, *flags)
                self.assertEqual(code, 3)
                self.assertTrue(first_line(err).startswith("verify replay: input refused: the verdict's action_context carries a member its "
                                                           "declared shape { tool_name, call_id, argument_path } does not have: action_context.approved"))

    def test_an_outcome_flip_fails_and_a_malformed_issued_at_is_refused(self):
        with Scratch() as s:
            code, out, err = replay(s.put("f.json", dict(self.door, verdict=dict(self.door["verdict"], outcome="FAIL"))))
            self.assertEqual(code, 1)
            self.assertTrue(first_line(err).startswith("verify replay: FAILED: the re-performed verdict differs from the presented one at `outcome`"))
            code, out, err = replay(s.put("i.json", dict(self.door, verdict=dict(self.door["verdict"], issued_at=None))))
            self.assertEqual((code, first_line(err)), (3, "verify replay: input refused: issued_at is not an ISO-8601 timestamp: null (a null, "
                                                           "not a string). A verdict records when it was issued as, for example, 2026-10-05T16:03:24.839Z"))

    def test_an_issued_at_in_other_digits_is_refused_as_the_engine_refuses_it(self):
        # JavaScript's \d reads 0-9 only; a timestamp written in Arabic-Indic digits is not one (the dry run of 2026-10-20 found this
        # build reading it as one, where the engine refuses it)
        ts = "٢٠٢٦-١٠-٠٣T٠٠:٠٠:٠٠.٠٠٠Z"
        with Scratch() as s:
            code, out, err = replay(s.put("d.json", dict(self.door, verdict=dict(self.door["verdict"], issued_at=ts))))
            self.assertEqual(code, 3)
            self.assertEqual(first_line(err), "verify replay: input refused: issued_at is not an ISO-8601 timestamp: \"%s\". A verdict "
                                              "records when it was issued as, for example, 2026-10-05T16:03:24.839Z" % ts)

    def test_without_inputs_only_the_structure_is_checked(self):
        with Scratch() as s:
            code, out, err = replay(s.put("v.json", self.door["verdict"]))
            self.assertEqual(code, 2)
            self.assertEqual(first_line(err), "verify replay: structure verified; outcome NOT re-performed: no inputs were supplied, so the check "
                                              "was not run again (the verdict_id binds the inputs, not the outcome). To re-perform it, pass the "
                                              "inputs (--inputs <inputs.json>, or --extraction <doc.json> with the flags the verdict was made "
                                              "with). Exit 2.")

    @unittest.skipUnless(PACK, "can't tell: the engine 0.0.1 pack is not in this tree")
    def test_a_ruleset_this_build_does_not_re_perform_says_so_never_verified(self):
        with open(PACK, "rb") as fh:
            pack = json.loads(fh.read().decode("utf-8"))
        with Scratch() as s:
            for b in pack["bundles"]:
                code, out, err = replay(s.put("%s.json" % b["id"], b))
                if b["verdict"]["ruleset"]["id"] == "invoice":
                    self.assertEqual(code, 0, b["id"])
                    self.assertIn("outcome VERIFIED: re-performed with verify:invoice", first_line(err))
                elif C._declarative_reader() is not None and b["verdict"]["ruleset"]["id"] != "legal":
                    self.assertEqual(code, 0, b["id"])
                    self.assertIn("outcome VERIFIED: re-performed with declarative", first_line(err))
                else:
                    self.assertEqual(code, 2, b["id"])
                    self.assertTrue(first_line(err).startswith("verify replay: structure verified; outcome NOT re-performed: this build "
                                                               "re-performs invoice@0.1.0 only; the verdict is %s@%s"
                                                               % (b["verdict"]["ruleset"]["id"], b["verdict"]["ruleset"]["version"])))
                    self.assertNotIn("VERIFIED", err)

    def test_in_a_folder_a_refused_case_wins_the_exit(self):
        with Scratch() as s:
            s.put("cases/a.json", self.door)
            s.put("cases/b.json", dict(self.door, verdict=dict(self.door["verdict"], outcome="FAIL")))
            s.put("cases/c.json", raw="{not json")
            os.makedirs(os.path.join(s.dir, "cases", "inner"))
            code, out, err = replay(os.path.join(s.dir, "cases"))
            self.assertEqual(code, 3)
            summary = json.loads(out)
            self.assertEqual((summary["matched"], summary["diverged"], summary["refused"], summary["skipped_folders"]), (1, 1, 1, ["inner"]))
            self.assertTrue(first_line(err).startswith("MATCH           a.json  PASS-WITH-OPEN"))
            self.assertIn("REFUSED         c.json\n    not JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)", err)

    def test_a_jsonl_names_each_case_by_its_line(self):
        with Scratch() as s:
            p = s.put("c.jsonl", raw=json.dumps(self.door) + "\n\n" + json.dumps(dict(self.door, extra=1)) + "\n")
            code, out, err = replay(p)
            self.assertEqual(code, 3)
            self.assertEqual([c["name"] for c in json.loads(out)["cases"]], [p + "#1", p + "#3"])


@unittest.skipUnless(C._ed25519_verifier() is not None, "can't tell: no Ed25519 verifier beside this build (conformance/engine_py/record)")
class EnvelopeTest(unittest.TestCase):
    """Signed envelopes, signed here with the RFC 8032 code beside this folder and a throwaway secret."""

    def setUp(self):
        self.ed = C._load_beside("record", "ed25519")
        self.secret = C.hashlib.sha256(b"two-engines test key A").digest()
        self.public = self.ed.secret_to_public(self.secret)
        der = bytes.fromhex("302a300506032b6570032100") + self.public
        self.pem = "-----BEGIN PUBLIC KEY-----\n%s\n-----END PUBLIC KEY-----\n" % C.base64.b64encode(der).decode()
        self.door = vector("01-valid-invoice-0.6.0.json")

    def envelope(self, v):
        sig = self.ed.sign(self.secret, C.rb.canonical_json(v).encode("utf-8"))
        return {"verdict": v, "alg": "ed25519", "public_key": self.pem, "signature": C.base64.b64encode(sig).decode()}

    def test_a_signed_bundle_verifies_and_a_pinned_other_key_fails(self):
        with Scratch() as s:
            p = s.put("e.json", {"verdict": self.envelope(self.door["verdict"]), "inputs": self.door["inputs"]})
            code, out, err = replay(p)
            self.assertEqual(code, 0)
            self.assertIn("The envelope's signature verifies (key %s…)" % C.key_fingerprint(self.pem)[:12], first_line(err))
            code, out, err = replay(p, "--trusted-key", C.key_fingerprint(self.pem))
            self.assertEqual(code, 0)
            self.assertIn("by the trusted key", first_line(err))
            code, out, err = replay(p, "--trusted-key", "b" * 64)
            self.assertEqual(code, 1)
            self.assertTrue(first_line(err).startswith("verify replay: FAILED: the envelope is signed by key %s…, which is not the trusted key (bbbbbbbbbbbb…)"
                                                       % C.key_fingerprint(self.pem)[:12]))

    def test_without_a_verifier_the_signature_is_cant_tell_never_verified(self):
        saved = list(C._VERIFIER)
        C._VERIFIER[:] = [None]  # as in a tree without record/ed25519.py
        try:
            with Scratch() as s:
                env = self.envelope(self.door["verdict"])
                code, out, err = replay(s.put("e.json", {"verdict": env, "inputs": self.door["inputs"]}))
                self.assertEqual(code, 2)
                self.assertIn("can't tell here", first_line(err))
                self.assertNotIn("VERIFIED", err)
                code, out, err = replay(s.put("f.json", {"verdict": env, "inputs": dict(self.door["inputs"], source={"text": "x"})}))
                self.assertEqual(code, 1)
                self.assertTrue(first_line(err).startswith("verify replay: FAILED: input_hash does not match"))
                self.assertIn("the envelope's signature was not checked", err)
        finally:
            C._VERIFIER[:] = saved

    def test_a_tampered_body_fails_on_its_signature_first(self):
        env = self.envelope(self.door["verdict"])
        env["verdict"] = dict(env["verdict"], outcome="FAIL")
        with Scratch() as s:
            code, out, err = replay(s.put("t.json", {"verdict": env, "inputs": self.door["inputs"]}))
            self.assertEqual((code, first_line(err)), (1, "verify replay: FAILED: the envelope's signature does not verify (signature does not "
                                                          "verify — the verdict body was altered, or the key does not match)"))


@unittest.skipUnless(shutil.which("node"), "can't tell: Node is not on PATH")
class ShimTest(unittest.TestCase):
    def test_the_shim_relays_exit_and_both_streams_byte_for_byte(self):
        for name, flags in (("01-valid-invoice-0.6.0.json", []), ("04-tampered-outcome.json", []), ("08-refused-duplicate-key.json", []),
                            ("16-missing-issued-at.json", ["--strict"])):
            path = os.path.join("conformance", "vectors", name)
            env = dict(os.environ, RIPOSTE_PYTHON=sys.executable)
            a = subprocess.run(["node", os.path.join("conformance", "engine_py", "shim.mjs"), "replay", path] + flags, cwd=ROOT,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            b = subprocess.run([sys.executable, os.path.join("conformance", "engine_py", "cli.py"), "replay", path] + flags, cwd=ROOT,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertEqual((a.returncode, a.stdout, a.stderr), (b.returncode, b.stdout, b.stderr), name)


@unittest.skipUnless(NODE_OK, NODE_SKIP)
class AgainstNodeTest(unittest.TestCase):
    """The two engines on the same files with the same flags: the exit code and the first stderr line, compared."""

    def both(self, args, cwd):
        n = subprocess.run(["node", os.path.abspath(NODE_CLI), "replay"] + args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        p = subprocess.run([sys.executable, os.path.join(HERE, "cli.py"), "replay"] + args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return (n.returncode, first_line(n.stderr.decode("utf-8", "replace"))), (p.returncode, first_line(p.stderr.decode("utf-8", "replace")))

    def test_every_conformance_vector_run(self):
        with open(os.path.join(ROOT, "conformance", "vectors.json"), "rb") as fh:
            m = json.loads(fh.read().decode("utf-8"))
        for v in m["vectors"]:
            e = v["expect"]
            for args in [e.get("args", [])] + [a.get("args", []) for a in e.get("also", [])]:
                n, p = self.both([os.path.join("conformance", "vectors", v["file"])] + args, ROOT)
                self.assertEqual(n, p, v["id"])

    def test_constructed_bundles(self):
        door = vector("01-valid-invoice-0.6.0.json")
        with Scratch() as s:
            files = {
                "extra.json": json.dumps(dict(door, extra=1)), "opt.json": json.dumps(dict(door, options={"foo": 1})),
                "ann.json": json.dumps(dict(door, verdict=dict(door["verdict"], ledger={"tenant_id": "a", "reviewer": {"id": "r", "rating": 1}}))),
                "chan.json": json.dumps(dict(door, verdict=dict(door["verdict"], channel="email"))),
                "bare.json": json.dumps(door["verdict"]), "noinputs.json": json.dumps({"verdict": door["verdict"]}),
                "badid.json": json.dumps(dict(door, verdict=dict(door["verdict"], verdict_id="0" * 32))),
                "feb30.json": json.dumps(dict(door, verdict=dict(door["verdict"], issued_at="2026-02-30T00:00:00Z"))),
                "engine.json": json.dumps(dict(door, verdict=dict(door["verdict"], engine_version="9.9.9"))),
                "second.json": json.dumps(door) + "\n" + json.dumps(door) + "\n", "comma.json": json.dumps(door)[:-1] + ",}",
                "array.json": json.dumps([door]), "null.json": "null", "empty.json": "", "nan.json": "NaN",
                "cases.jsonl": json.dumps(door) + "\n\n" + json.dumps(dict(door, extra=2)) + "\n{bad\n",
                "tol-string.json": json.dumps(dict(door, options={"tolerance": {"rel": 0.001, "absCap": 1, "roundingCap": {"perLine": "TAX_INT"}}})),
                "tol-extra.json": json.dumps(dict(door, options={"tolerance": {"rel": 0.001, "absCap": 1, "x": 1}})),
                "tol-inputs.json": json.dumps(dict(door, inputs=dict(door["inputs"], tolerance={"rel": -1, "absCap": 1}))),
            }
            for n, t in files.items():
                s.put(n, raw=t)
            s.put("folder/a.json", door)
            s.put("folder/b.json", raw="[1,")
            for name in sorted(files) + ["folder", "missing.json"]:
                for flags in ([], ["--strict"]):
                    n, p = self.both([name] + flags, s.dir)
                    self.assertEqual(n, p, "%s %s" % (name, flags))


if __name__ == "__main__":
    unittest.main()
