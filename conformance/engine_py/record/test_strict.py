# Tests for strict.py: the engine's strict reader, its words, and JSON.parse's semantics. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
import json
import os
import subprocess
import sys
import unittest
import urllib.parse
import urllib.request

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import strict as S  # noqa: E402
import engine  # noqa: E402  (engine_py/engine.py, put on the path by strict)
import nodetools as N  # noqa: E402

B = chr(92)
CASES = [
    '{"a":1}', '{"a":1,"a":2}', '{"x":{"b":[1,{"c":1,"c":2}]}}', '{"seq":1,"seq":1}', '{"n":9007199254740993}', '{"n":[0.10000000000000001]}',
    '{"n":1e999}', '{"n":-1e999}', '[1e-400]', '{"k' + B + 'u0041":1,"kA":2}', '{"a b":{"x":1,"x":2}}', '{"' + B + 'ud800":1,"' + B + 'ud800":2}',
    S.BOM + '{}', '[' * 300 + ']' * 300, '{"a":' + '[' * 257 + ']' * 257 + '}', '6125.0', '-0', '{"t":"' + B + '"","u":1,"u":2}',
    '{"a' + B + 'n":1,"a' + B + 'n":2}', '{"1":1,"1":2}', '{"x":12345678901234567890123456789012345678901234567890}',
    '{"' + chr(0x1F600) + '":[1,1e999]}', '{"' + chr(0x1F600) + '":' + '[' * 257 + ']' * 257 + '}', '{"a":}',
]


def outcome(text):
    try:
        S.parse_json_strict(text, "line 1")
        r = {"ok": True}
    except S.HashInputRefused as e:
        r = {"refused": True, "where": e.where, "message": e.message}
    except S.NotJson:
        r = {"refused": False, "where": None, "message": None}
    d, i = S.duplicate_key_path(text), S.inexact_number_path(text)
    r["dup"] = {"path": d[0], "key": d[1]} if d else None
    r["inexact"] = {"path": i[0], "token": i[1]} if i else None
    return r


class WordsTest(unittest.TestCase):
    def test_a_repeated_key_is_refused_with_its_path_in_the_engine_s_words(self):
        with self.assertRaises(S.HashInputRefused) as cm:
            S.parse_json_strict('{"body":{"decision":"EXECUTE","decision":"HOLD"}}', "line 3")
        self.assertEqual(cm.exception.where, "$.body.decision")
        self.assertEqual(cm.exception.message,
                         'line 3: the key "decision" appears twice in one object (at $.body.decision). JSON keeps only the last of them, so a '
                         "reader that keeps the first would see a different document than the one hashed and signature-checked here. Keep one "
                         "of them, then run it again")

    def test_a_number_that_does_not_read_back_is_refused_with_what_it_reads_as(self):
        with self.assertRaises(S.HashInputRefused) as cm:
            S.parse_json_strict('{"amount":9007199254740993}', "f")
        self.assertEqual(cm.exception.message,
                         "f: the number at $.amount (9007199254740993) is a number that cannot be represented exactly; write amounts as strings "
                         "with two decimals. JSON numbers are read as doubles, and this one reads as 9007199254740992, so the hash and every check "
                         "would see 9007199254740992, not what was written. Then run it again")

    def test_the_other_refusals_name_their_place(self):
        cases = [(S.BOM + "{}", "byte 0"), ('{"n":[1,1e999]}', "$.n[1]"), ("[" * 257 + "]" * 257, "character 256"),
                 # the brace is level 1, so the 256th bracket opens level 257, at 5 + 256; the emoji counts as two UTF-16 code units
                 ('{"' + chr(0x1F600) + '":' + "[" * 257 + "]" * 257 + "}", "character 261")]
        for text, where in cases:
            with self.assertRaises(S.HashInputRefused) as cm:
                S.parse_json_strict(text, "f")
            self.assertEqual(cm.exception.where, where, text[:20])
        with self.assertRaises(S.NotJson):
            S.parse_json_strict('{"a":}', "f")

    def test_invalid_utf8_is_named_by_its_offset(self):
        with self.assertRaises(S.HashInputRefused) as cm:
            S.decode_utf8_strict(b'{"a":"\xc3\x28"}', "f")
        self.assertEqual(cm.exception.where, "byte 6")
        self.assertTrue(cm.exception.message.startswith("f is not valid UTF-8: the bytes at offset 6 (C3 28 22 7D) are not a UTF-8 character."))
        self.assertEqual(S.decode_utf8_strict(b"\xef\xbb\xbf{}", "f"), S.BOM + "{}")

    def test_json_parse_keeps_a_repeated_key_at_its_first_place_with_its_last_value(self):
        self.assertEqual(list(S.json_parse('{"a":1,"b":2,"a":3}').items()), [("a", 3.0), ("b", 2.0)])
        self.assertEqual(S.json_parse("1e999"), float("inf"))
        with self.assertRaises(ValueError):
            S.json_parse("NaN")

    def test_javascript_words_for_values(self):
        self.assertEqual([S.js_str(x) for x in (S.UNDEFINED, None, True, 1.0, 1.5e21, float("nan"), "x", [1.0, None, "a"], {})],
                         ["undefined", "null", "true", "1", "1.5e+21", "NaN", "x", "1,,a", "[object Object]"])
        self.assertEqual(S.js_trim(S.BOM + chr(0x3000) + " a " + chr(0x2029)), "a")
        self.assertEqual(S.to_json({"a": S.UNDEFINED, "b": [S.UNDEFINED], "1": 2.0}), '{\n  "1": 2,\n  "b": [\n    null\n  ]\n}')


class AgreesWithEnginePyTest(unittest.TestCase):
    def test_the_repeated_key_path_is_engine_py_s_for_plain_keys(self):
        for text in ('{"a":1,"a":2}', '{"x":{"b":[1,{"c":1,"c":2}]}}', '{"a b":{"x":1,"x":2}}', '{"1":1,"1":2}'):
            self.assertEqual(S.duplicate_key_path(text), engine.duplicate_key_path(text), text)


VERIFY_HASH_INPUT = N.package_path("verify", "dist", "protocol", "hash-input.js")


@unittest.skipIf(not (N.node_exe() and VERIFY_HASH_INPUT), "can't tell: the engine is not built, or no Node 20 or later")
class AgainstTheEngineTest(unittest.TestCase):
    def test_every_case_reads_as_the_engine_s_parsejsonstrict_reads_it_words_included(self):
        url = urllib.parse.urljoin("file:", urllib.request.pathname2url(os.path.abspath(VERIFY_HASH_INPUT)))
        script = ("const v = await import(%s); let t = ''; for await (const c of process.stdin) t += c; const cases = JSON.parse(t);"
                  "console.log(JSON.stringify(cases.map((x) => { let r; try { v.parseJsonStrict(x, 'line 1'); r = { ok: true } } catch (e) {"
                  " r = { refused: e.name === 'HashInputRefused', where: e.where ?? null, message: e.name === 'HashInputRefused' ? e.message : null } }"
                  " return { ...r, dup: v.duplicateKeyPath(x) ?? null, inexact: v.inexactNumberPath(x) ?? null } })))") % json.dumps(url)
        p = subprocess.run([N.node_exe(), "--input-type=module", "-e", script], input=json.dumps(CASES).encode(), capture_output=True, timeout=120)
        self.assertEqual(p.returncode, 0, p.stderr)
        node = json.loads(p.stdout)
        for text, want in zip(CASES, node):
            self.assertEqual(outcome(text), want, repr(text[:60]))


if __name__ == "__main__":
    unittest.main()
