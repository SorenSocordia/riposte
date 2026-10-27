# Tests for ledger.py: every verdict path of `riposte-ledger verify`, on ledgers signed here and on the receipts fixtures, and the
# same bytes as the Node tool where it is built. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
import base64
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ed25519 as E  # noqa: E402
import ledger as L  # noqa: E402
import nodetools as N  # noqa: E402
import strict as S  # noqa: E402

SEED = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")  # RFC 8032 TEST 1's secret key: a test key
OTHER = bytes.fromhex("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb")  # TEST 2's
PUB_PEM = E.spki_pem(E.secret_to_public(SEED))
FP = E.key_fingerprint(PUB_PEM)
COLD = N.package_path("receipts", "test", "fixtures", "ledger-cold-review-2026-10-13")
CORE = N.package_path("receipts", "test", "fixtures", "core-cold-review-2026-10-12")


def entry(seq, body, prev, seed=SEED, kind="ap_gate", at=None):
    e = {"seq": seq, "kind": kind, "at": at or "2026-10-20T00:00:0%d.000Z" % seq, "body": body, "prev_hash": prev}
    e["hash"] = L.entry_hash(e)
    if seed is not None:
        e["signature"] = {"alg": "ed25519", "public_key": E.spki_pem(E.secret_to_public(seed)), "sig": base64.b64encode(E.sign(seed, e["hash"].encode())).decode()}
    return e


def chain(n=3, seed=SEED):
    out, prev = [], L.GENESIS
    for i in range(n):
        e = entry(i, {"bill": "B%d" % i, "decision": "EXECUTE" if i != 1 else "HOLD", "amount": 1000 * (i + 1)}, prev, seed)
        out.append(e)
        prev = e["hash"]
    return out


def line(e):
    return json.dumps(e, separators=(",", ":"), ensure_ascii=False)


def head_record(text, entries):
    return json.dumps({"version": 1, "ledger": "r.jsonl", "count": len(entries), "head": entries[-1]["hash"] if entries else L.GENESIS,
                       "bytes": len(text.encode("utf-8")), "updated_at": "2026-10-20T00:00:09.000Z"}, separators=(",", ":"))


class Folder(object):
    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="record-ledger-")

    def put(self, name, data):
        with open(os.path.join(self.dir, name), "wb") as fh:
            fh.write(data.encode("utf-8") if isinstance(data, str) else data)

    def ledger(self, name, entries, head=True, raw=None):
        text = raw if raw is not None else "".join(line(e) + "\n" for e in entries)
        self.put(name, text)
        if head:
            self.put(name + ".head.json", head_record(text, entries))
        return name


def cli(args, cwd):
    old = os.getcwd()
    os.chdir(cwd)
    try:
        r = L.ledger_cli(args)
    finally:
        os.chdir(old)
    return r["code"], r["out"], r["err"]


class VerifyTest(unittest.TestCase):
    def setUp(self):
        self.f = Folder()
        self.f.put("k.pub.pem", PUB_PEM)
        self.f.put("other.pub.pem", E.spki_pem(E.secret_to_public(OTHER)))

    def tearDown(self):
        shutil.rmtree(self.f.dir, ignore_errors=True)

    def v(self, *args):
        return cli(["verify"] + list(args), self.f.dir)

    def test_a_signed_ledger_with_its_head_record_verifies_with_its_key(self):
        es = chain()
        self.f.ledger("r.jsonl", es)
        code, out, err = self.v("r.jsonl", "--key", "k.pub.pem")
        self.assertEqual(code, 0)
        self.assertEqual(err.split("\n")[0], "OK: 3 entries, head %s… · 3 signed (%s) · 0 unsigned" % (es[-1]["hash"][:16], FP))
        self.assertTrue(json.loads(out)["ok"])

    def test_an_edited_body_breaks_the_chain_and_says_why_the_signatures_still_verify(self):
        es = chain()
        es[1]["body"]["decision"] = "EXECUTE"
        self.f.ledger("r.jsonl", es)
        code, out, err = self.v("r.jsonl", "--key", "k.pub.pem")
        self.assertEqual(code, 1)
        lines = err.split("\n")
        self.assertEqual(lines[:2], ["BROKEN: chain", "BROKEN at entry 1: entry 1 was altered after it was written"])
        self.assertTrue(lines[2].startswith("signatures_ok is true because each signature covers the hash its entry records"))
        j = json.loads(out)
        self.assertEqual((j["ok"], j["chain_ok"], j["signatures_ok"], j["broken_at"]), (False, False, True, 1))

    def test_a_key_written_twice_in_one_entry_breaks_the_chain_at_that_line_with_its_path(self):
        es = chain()
        text = "".join(line(e) + "\n" for e in es).replace('"decision":"HOLD"', '"decision":"EXECUTE","decision":"HOLD"', 1)
        self.f.ledger("r.jsonl", es, raw=text)
        code, _, err = self.v("r.jsonl", "--key", "k.pub.pem", "--no-sidecar")
        self.assertEqual(code, 1)
        self.assertEqual(err.split("\n")[1],
                         'BROKEN at entry 1: entry 1 cannot be read one way: line 2: the key "decision" appears twice in one object (at $.body.decision). '
                         "JSON keeps the last, so the entry's hash and signature cover that value, while a reader that keeps the first sees the other. "
                         "The receipts store writes every key once, so something else wrote this line")

    def test_a_cut_at_the_tail_is_shown_by_the_head_record_and_a_missing_record_does_not_verify(self):
        es = chain()
        self.f.ledger("r.jsonl", es)
        self.f.put("r.jsonl", "".join(line(e) + "\n" for e in es[:2]))
        code, _, err = self.v("r.jsonl", "--key", "k.pub.pem")
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("BROKEN at the tail: the file has 2 entries; its head record (r.jsonl.head.json) says 3 (head %s…); the last entry "
                                       "was removed or the file was rewritten" % es[2]["hash"][:16]), err)
        os.remove(os.path.join(self.f.dir, "r.jsonl.head.json"))
        code, _, err = self.v("r.jsonl")
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("NOT VERIFIED: no head record found (r.jsonl.head.json)"))
        code, _, err = self.v("r.jsonl", "--no-sidecar")
        self.assertEqual(code, 0)
        self.assertIn("note: head record not read (--no-sidecar)", err)

    def test_bytes_added_inside_an_entry_the_record_covers_are_a_rewrite(self):
        es = chain()
        self.f.ledger("r.jsonl", es)
        text = "".join(line(e) + "\n" for e in es).replace('"amount":2000', '"amount":2000      ', 1)
        self.f.put("r.jsonl", text)
        code, _, err = self.v("r.jsonl", "--key", "k.pub.pem")
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("BROKEN: the file holds"), err)

    def test_another_key_an_unsigned_entry_and_an_anchor_not_in_the_chain_are_not_verified_while_the_chain_holds(self):
        self.f.ledger("r.jsonl", chain())
        code, _, err = self.v("r.jsonl", "--key", "other.pub.pem")
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("NOT VERIFIED: entry 0 is signed by key %s, not the expected %s" % (FP, E.key_fingerprint(E.spki_pem(E.secret_to_public(OTHER))))))
        self.f.ledger("u.jsonl", chain(seed=None))
        code, _, err = self.v("u.jsonl", "--require-signed")
        self.assertEqual((code, err.split("\n")[0][:62]), (1, "NOT VERIFIED: entry 0 is not signed (signatures required); the"))
        code, _, err = self.v("r.jsonl", "--head", "ab" * 32)
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("NOT VERIFIED: the anchored hash abababababababab… is not in this chain"))

    def test_both_torn_tails_and_a_whole_last_entry_without_a_newline(self):
        es = chain()
        whole = "".join(line(e) + "\n" for e in es)
        self.f.ledger("t.jsonl", es, raw=whole + line(entry(3, {}, es[-1]["hash"]))[:40], head=False)
        self.f.put("t.jsonl.head.json", head_record(whole, es))  # the store's record: the whole entries, before the crash
        code, out, err = self.v("t.jsonl")
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("NOT VERIFIED: torn tail. The file ends in an unfinished line"))
        self.assertEqual(json.loads(out)["torn_tail"], {"bytes": 40, "after_line": 3})
        self.f.ledger("n.jsonl", es, raw=whole[:-1], head=False)
        self.f.put("n.jsonl.head.json", head_record(whole, es))  # the record counts the newline the store wrote
        code, _, err = self.v("n.jsonl")
        self.assertEqual(code, 0)
        self.assertIn("note: the last line has no newline after it", err)

    def test_a_line_that_is_json_null_is_named_where_the_node_verifier_throws(self):
        es = chain(2)
        self.f.ledger("z.jsonl", es, raw=line(es[0]) + "\nnull\n" + line(es[1]) + "\n", head=False)
        code, _, err = self.v("z.jsonl", "--no-sidecar")
        self.assertEqual(code, 1)
        self.assertEqual(err.split("\n")[:2], ["BROKEN: chain", "BROKEN at entry 1: entry 1 is not a ledger entry (the line is JSON null)"])

    def test_what_cannot_be_read_is_exit_3(self):
        es = chain()
        self.f.ledger("m.jsonl", es, raw=line(es[0]) + "\n{oops\n" + line(es[1]) + "\n")
        self.assertEqual(self.v("m.jsonl")[0::2], (3, "m.jsonl: line 2 is not JSON\n"))
        self.f.put("b.jsonl", b'{"seq":0,"x":"\xff"}\n')
        code, _, err = self.v("b.jsonl")
        self.assertEqual(code, 3)
        self.assertTrue(err.startswith("cannot read b.jsonl: b.jsonl is not valid UTF-8 at byte 14"))
        code, _, err = self.v("r.jsonl", "--proof", "p.json") if False else self.v("m.jsonl", "--proof", "p.json")
        self.assertEqual(code, 3)
        self.assertTrue(err.startswith("m.jsonl: line 2 is not JSON"))
        self.f.ledger("r.jsonl", es)
        code, _, err = self.v("r.jsonl", "--proof", "p.json")
        self.assertEqual(code, 3)
        self.assertTrue(err.startswith("--proof is outside what this reader checks"))

    def test_summary_and_verify_signature(self):
        es = chain()
        self.f.ledger("r.jsonl", es)
        code, out, _ = cli(["summary", "r.jsonl"], self.f.dir)
        s = json.loads(out)
        self.assertEqual((code, s["entries"], s["kinds"], s["signers"]), (0, 3, {"ap_gate": 3}, [FP]))
        verdict = {"verdict_id": "a" * 32, "outcome": "PASS", "claims": []}
        env = {"verdict": verdict, "alg": "ed25519", "public_key": PUB_PEM,
               "signature": base64.b64encode(E.sign(SEED, S.canonicalize(verdict).encode())).decode()}
        self.f.put("env.json", json.dumps(env))
        code, out, err = cli(["verify-signature", "env.json", "--trusted-key", FP], self.f.dir)
        self.assertEqual((code, err.split("\n")[0]), (0, "OK: the signature verifies, by the trusted key; issuer fingerprint %s" % FP))
        env["verdict"]["outcome"] = "FAIL"
        self.f.put("env2.json", json.dumps(env))
        code, out, err = cli(["verify-signature", "env2.json"], self.f.dir)
        self.assertEqual((code, err.split("\n")[0]), (1, "NOT VERIFIED: the signature does not verify: the verdict body was altered, or the key does not match"))


class MainTest(unittest.TestCase):
    def test_main_writes_the_json_to_stdout_and_the_lines_to_stderr(self):
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(L.main(["--help"], out, err), 0)
        self.assertEqual(out.getvalue(), "")
        self.assertIn("a reader: it never writes to a ledger", err.getvalue().lower())
        self.assertEqual(L.main(["verify"], out, err), 3)


@unittest.skipIf(not (N.command("receipts") and COLD and CORE), "can't tell: the receipts command is not built (or no Node 20 or later), or its fixtures are absent")
class AgainstRiposteLedgerTest(unittest.TestCase):
    """The same files through both readers: exit code, stdout and stderr byte for byte."""

    def same(self, args, cwd):
        n = N.run(N.command("receipts") + args, cwd=cwd)
        p = cli(args, cwd)
        self.assertEqual(p[0], n[0], (args, n[2]))
        self.assertEqual(p[1].encode("utf-8"), n[1], args)
        self.assertEqual(p[2].encode("utf-8"), n[2], args)

    def test_the_reviewer_s_attacks_of_2026_10_13_read_the_same(self):
        with open(os.path.join(COLD, "receipts.jsonl.head.json"), encoding="utf-8") as fh:
            h0 = json.load(fh)["head"]
        k = ["--key", "../pub.pem"]
        flags = {"case-pristine": [], "case-pristine___key": k, "case-cut_last_2__head_deleted____no_sidecar": k + ["--no-sidecar"],
                 "case-cut_last_2__head_recomputed____head_H0": k + ["--head", h0], "case-edit_rechain_re_signed____head_H0": ["--head", h0],
                 "case-edit_rechain_unsigned__head_recomputed": [], "case-edit_rechain_re_signed_attacker_key__no___key": []}
        for folder in sorted(d for d in os.listdir(COLD) if d.startswith("case-")):
            self.same(["verify", "receipts.jsonl"] + flags.get(folder, k), os.path.join(COLD, folder))
        self.same(["summary", "receipts.jsonl"], os.path.join(COLD, "case-dupkey-conflict"))

    def test_the_tails_of_2026_10_12_read_the_same(self):
        for f in ("receipts.jsonl", "edit.jsonl", "torn.jsonl", "nonl.jsonl"):
            self.same(["verify", f, "--key", "k.pub.pem"], CORE)

    def test_ledgers_signed_here_read_the_same(self):
        f = Folder()
        try:
            f.put("k.pub.pem", PUB_PEM)
            es = chain()
            f.ledger("ok.jsonl", es)
            whole = "".join(line(e) + "\n" for e in es)
            f.ledger("torn.jsonl", es, raw=whole + whole.split("\n")[0][:30])
            f.ledger("tornnl.jsonl", es, raw=whole + whole.split("\n")[0][:30] + "\n")
            f.ledger("dup.jsonl", es, raw=whole.replace('"seq":1,', '"seq":1,"seq":1,', 1))
            f.ledger("big.jsonl", es, raw=whole.replace('"amount":3000', '"amount":9007199254740993', 1))
            f.ledger("crlf.jsonl", es, raw=whole.replace("\n", "\r\n"))
            f.ledger("bom.jsonl", es, raw=S.BOM + whole)
            f.ledger("unsigned.jsonl", chain(seed=None))
            for name in ("ok.jsonl", "torn.jsonl", "tornnl.jsonl", "dup.jsonl", "big.jsonl", "crlf.jsonl", "bom.jsonl", "unsigned.jsonl"):
                self.same(["verify", name], f.dir)
                self.same(["verify", name, "--key", "k.pub.pem"], f.dir)
            self.same(["summary", "ok.jsonl"], f.dir)
            self.same(["fingerprint", "k.pub.pem", "--short"], f.dir)
        finally:
            shutil.rmtree(f.dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
