# Tests for frag.py: frags signed here (every exit of `frag open`), the published frags, and the same bytes as the Node tool where
# it is built. prototype; no measured accuracy.
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
import frag as F  # noqa: E402
import ledger as L  # noqa: E402
import nodetools as N  # noqa: E402
import strict as S  # noqa: E402
import engine  # noqa: E402  (engine_py/engine.py)

SEED = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")  # RFC 8032 TEST 1's secret key: a test key
OTHER = bytes.fromhex("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb")
PUB_PEM = E.spki_pem(E.secret_to_public(SEED))
ROOT = N.ROOT
VECTOR_01 = os.path.join(ROOT, "conformance", "vectors", "01-valid-invoice-0.6.0.json")
VECTOR_04 = os.path.join(ROOT, "conformance", "vectors", "04-tampered-outcome.json")
SAMPLE = os.path.join(ROOT, "docs", "doors", "examples", "invoice.json")
PUBLISHED = os.path.join(ROOT, "frags")
LOCK = {"rule": "sha256 over the text formed by one line per file", "engine": {"label": "0.7.2", "over": "packages/verify/src/", "recursive": True,
                                                                          "sha256": "0" * 64, "files": 1},
        "rulesets": [], "tools": [], "corpus": [], "prereg": None}


def sig_entry(seq, body, prev):
    e = {"seq": seq, "kind": "note", "at": "2026-10-20T00:00:0%d.000Z" % seq, "body": body, "prev_hash": prev}
    e["hash"] = L.entry_hash(e)
    e["signature"] = {"alg": "ed25519", "public_key": PUB_PEM, "sig": base64.b64encode(E.sign(SEED, e["hash"].encode())).decode()}
    return e


def mint(out, items):
    """Frags as `frag build` writes them: frag.json (two-space JSON, fields in order), cover.txt, bundle.json; the signed record and
    its head record; ISSUER.json. `items`: (address, bundle)."""
    os.makedirs(os.path.join(out, "frags"), exist_ok=True)
    entries, prev = [], L.GENESIS
    for seq, (path, bundle) in enumerate(items):
        claim = {"kind": "verdict", "bundle": bundle}
        proof = {"kind": "verdict", "replay": "node packages/verify/dist/cli.js replay <frag folder>/bundle.json", "reruns_from_this_tree": "yes",
                 "reason": "the bundle carries the verdict and every input it was issued on"}
        f = {"schema": F.FRAG_SCHEMA, "prototype": F.PROTOTYPE_LINE, "name": {"title": "Test " + path.split("/")[-1], "path": path}, "lock": LOCK,
             "claim": claim, "proof": proof, "provenance": {"issued_at": "2026-10-20T00:00:00.000Z", "tier": "demo", "labellers": "none", "not_shipped": [],
                                                           "supersedes": None, "issuer": "a test key"}}
        f["frag_id"] = F.frag_id_of(f)
        f["signature"] = {"alg": "ed25519", "public_key": PUB_PEM, "signature": base64.b64encode(E.sign(SEED, F._message(f))).decode()}
        e = sig_entry(seq, {"event": F.RECORD_EVENT, "frag_id": f["frag_id"], "path": path, "claim": "verdict", "body_sha256": F.body_sha256(f), "supersedes": None}, prev)
        entries.append(e)
        prev = e["hash"]
        f["record"] = {"ledger": "frags/frags.jsonl", "seq": seq, "hash": e["hash"]}
        d = os.path.join(out, *path.split("/"))
        os.makedirs(d)
        with open(os.path.join(d, "frag.json"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(S.to_json(f) + "\n")
        with open(os.path.join(d, "cover.txt"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(F.cover_text(f))
        with open(os.path.join(d, "bundle.json"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(S.to_json(bundle) + "\n")
    text = "".join(json.dumps(e, separators=(",", ":"), ensure_ascii=False) + "\n" for e in entries)
    with open(os.path.join(out, "frags", "frags.jsonl"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    with open(os.path.join(out, "frags", "frags.jsonl.head.json"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({"version": 1, "ledger": "frags.jsonl", "count": len(entries), "head": prev, "bytes": len(text.encode()), "updated_at": "x"}))
    with open(os.path.join(out, "frags", "ISSUER.json"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({"public_key": PUB_PEM, "fingerprint": E.key_fingerprint(PUB_PEM), "note": "issuer key: a test key"}, indent=2) + "\n")


def bundle_of(path):
    with open(path, "rb") as fh:
        return S.json_parse(fh.read().decode("utf-8"))


def fail_bundle():
    """A FAIL invoice verdict issued by the Python second engine (total off by 5.08), with the inputs it was issued on."""
    with open(SAMPLE, "rb") as fh:
        x = S.json_parse(fh.read().decode("utf-8"))
    x["totals"]["total"] = 1900.0
    v = engine.issue(x, "2026-10-20T00:00:00.000Z")
    return {"verdict": json.loads(engine.render(v)), "inputs": {"extraction": x, "references": {"contract": None, "evidence": [], "history": []}, "source": None}}


def opened(folder, cwd, *flags):
    out, err = io.StringIO(), io.StringIO()
    code = F.main(["open", folder] + list(flags), out, err, cwd=cwd)
    return code, out.getvalue(), err.getvalue()


@unittest.skipIf(not (os.path.exists(VECTOR_01) and os.path.exists(SAMPLE)), "can't tell: the conformance vectors are not in this tree")
class MintedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="record-frag-")
        cls.items = [("frags/t/open", bundle_of(VECTOR_01)), ("frags/t/fail", fail_bundle()), ("frags/t/flipped", bundle_of(VECTOR_04))]
        mint(cls.dir, cls.items)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def copy(self):
        d = tempfile.mkdtemp(prefix="record-frag-t-")
        shutil.rmtree(d)
        shutil.copytree(self.dir, d)
        self.addCleanup(shutil.rmtree, d, True)
        return d

    def test_a_pass_with_open_verdict_is_intact_replayed_and_exit_2(self):
        code, out, _ = opened("frags/t/open", self.dir)
        lines = out.split("\n")
        self.assertEqual(code, 2)
        self.assertEqual(lines[:2], [F.PROTOTYPE_LINE, "On opening: intact; some of it cannot be told here."])
        self.assertIn("  claim: the bundle replays: MATCH, PASS-WITH-OPEN", lines)
        self.assertIn("  signature: verifies, key %s… (the issuer's: issuer key: a test key)" % E.key_fingerprint(PUB_PEM)[:16], lines)

    def test_a_fail_verdict_that_replays_is_exit_1(self):
        code, out, _ = opened("frags/t/fail", self.dir)
        self.assertEqual(code, 1)
        self.assertEqual(out.split("\n")[1], "On opening: intact and re-performed; the verdict is FAIL.")

    def test_an_outcome_flipped_before_signing_is_signed_and_recorded_and_still_does_not_replay(self):
        code, out, _ = opened("frags/t/flipped", self.dir)
        self.assertEqual(code, 4)
        self.assertEqual(out.split("\n")[1], "FRAG TAMPERED OR NOT AS RECORDED: the frag is not what it says it is.")
        self.assertIn("  - frag.json: the verdict does not replay (DIVERGED: ", out)

    def test_each_kind_of_tampering_is_exit_4_or_3_and_named(self):
        def edit(d, rel, fn):
            p = os.path.join(d, *rel.split("/"))
            with open(p, "rb") as fh:
                b = fh.read()
            with open(p, "wb") as fh:
                fh.write(fn(b))
        d = self.copy()
        edit(d, "frags/t/open/cover.txt", lambda b: b.replace(b"Test", b"Tess", 1))
        code, out, _ = opened("frags/t/open", d)
        self.assertEqual((code, out.split("\n")[2]), (4, "  - cover.txt: does not match the cover sentence re-derived from frag.json"))
        d = self.copy()
        edit(d, "frags/t/open/frag.json", lambda b: b.replace(b'"tier": "demo"', b'"tier": "blind"', 1))
        code, out, _ = opened("frags/t/open", d)
        self.assertEqual(code, 4)
        self.assertIn("  - frag.json: the signature does not verify: the frag was altered after it was signed, or the key does not match", out)
        self.assertIn("  - frags.jsonl: entry 0 records another body (name or provenance changed after the frag was recorded)", out)
        d = self.copy()
        other = E.spki_pem(E.secret_to_public(OTHER))
        with open(os.path.join(d, "frags", "ISSUER.json"), "w") as fh:
            json.dump({"public_key": other, "fingerprint": E.key_fingerprint(other), "note": "another key"}, fh)
        code, out, _ = opened("frags/t/open", d)
        self.assertEqual(code, 4)
        self.assertIn("  - frag.json: signed by key %s, not the issuer's %s" % (E.key_fingerprint(PUB_PEM), E.key_fingerprint(other)), out)
        d = self.copy()
        edit(d, "frags/frags.jsonl", lambda b: b.replace(b'"claim":"verdict"', b'"claim":"verdicT"', 1))
        code, out, _ = opened("frags/t/open", d)
        self.assertEqual(code, 4)
        self.assertIn("  - frags.jsonl: the chain does not verify (entry 0 was altered after it was written)", out)
        d = self.copy()
        edit(d, "frags/t/open/frag.json", lambda b: b.replace(b'"schema": "riposte.frag/0.1.0"', b'"schema": "riposte.frag/0.1.0", "schema": "x"', 1))
        code, out, _ = opened("frags/t/open", d)
        self.assertEqual(code, 3)
        self.assertTrue(out.split("\n")[2].startswith('  - frag.json: refused by the strict JSON reader (frag.json: the key "schema" appears twice'))
        d = self.copy()
        os.remove(os.path.join(d, "frags", "frags.jsonl"))
        code, out, _ = opened("frags/t/open", d)
        self.assertEqual(code, 2)
        self.assertIn("  can't tell: the record is not reachable from this folder", out)
        self.assertEqual(opened("frags/nope", d)[0], 3)

    @unittest.skipIf(not N.command("frag"), "can't tell: the frag command is not built, or no Node 20 or later")
    def test_the_node_tool_reads_frags_signed_here_the_same(self):
        for folder in ("frags/t/open", "frags/t/fail", "frags/t/flipped"):
            for flags in ([], ["--json"]):
                n = N.run(N.command("frag") + ["open", folder] + flags, cwd=self.dir)
                p = opened(folder, self.dir, *flags)
                self.assertEqual((p[0], p[1].encode("utf-8"), p[2].encode("utf-8")), n, (folder, flags))


@unittest.skipIf(not os.path.isdir(PUBLISHED), "can't tell: no published frags in this tree")
class PublishedTest(unittest.TestCase):
    def test_each_published_frag_opens_with_the_prototype_line_and_its_signature_verifies(self):
        for f in ("frags/legal/blind-2/half-b", "frags/ap/bpi-2019/run-1", "frags/engine/0.7.0/closed"):
            r = F.open_frag(f, cwd=ROOT)
            self.assertEqual(r["cover"][0], F.PROTOTYPE_LINE)
            self.assertTrue(r["signature"]["ok"], f)
            self.assertTrue(r["signature"]["issuer_pinned"], f)
            self.assertIn(r["exit"], (2, 4), f)

    def test_engine_0_7_0_closed_reads_tampered_against_a_tree_whose_changelog_no_longer_quotes_it(self):
        tree = N.tree_root()
        if not tree:
            self.skipTest("can't tell: no repository root to compare against")
        with open(os.path.join(PUBLISHED, "engine", "0.7.0", "closed", "frag.json"), encoding="utf-8") as fh:
            statement = json.load(fh)["claim"]["statement"]
        t = F.resolve_tree(tree)
        with open(F.tree_path(t, F.CHANGELOG), encoding="utf-8") as fh:
            if statement in fh.read():
                self.skipTest("can't tell: the changelog carries the sentence again (the frag was minted again, or the line restored)")
        r = F.open_frag("frags/engine/0.7.0/closed", tree=tree, cwd=ROOT)
        self.assertEqual(r["exit"], 4)
        self.assertEqual(r["cover"][1], "FRAG TAMPERED OR NOT AS RECORDED: the frag is not what it says it is.")
        self.assertIn("  - packages/verify/CHANGELOG.md no longer carries the sentence the claim quotes", r["cover"])

    @unittest.skipIf(not N.command("frag"), "can't tell: the frag command is not built, or no Node 20 or later")
    def test_the_node_tool_says_the_same_of_the_release_frag_with_and_without_a_tree(self):
        runs = [["open", "frags/engine/0.7.0/closed"], ["open", "frags/engine/0.7.0/closed", "--json"]]
        if N.tree_root():
            runs.append(["open", "frags/engine/0.7.0/closed", "--tree", N.tree_root()])
        for args in runs:
            n = N.run(N.command("frag") + args, cwd=ROOT)
            out, err = io.StringIO(), io.StringIO()
            code = F.main(args, out, err, cwd=ROOT)
            self.assertEqual((code, out.getvalue().encode("utf-8"), err.getvalue().encode("utf-8")), n, args)

    @unittest.skipIf(not N.command("frag"), "can't tell: the frag command is not built, or no Node 20 or later")
    def test_a_bench_frag_s_first_line_is_the_node_tool_s_and_this_reader_never_says_re_performed_for_it(self):
        for f in ("frags/legal/blind-2/half-b", "frags/ap/bpi-2019/run-1"):
            n = N.run(N.command("frag") + ["open", f], cwd=ROOT)
            r = F.open_frag(f, cwd=ROOT)
            self.assertEqual(r["cover"][0].encode("utf-8"), n[1].split(b"\n")[0])
            self.assertNotEqual(r["exit"], 0)
            if n[0] == 2:
                self.assertEqual(("\n".join(r["cover"]) + "\n").encode("utf-8"), n[1], f)


if __name__ == "__main__":
    unittest.main()
