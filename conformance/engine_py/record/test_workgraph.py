# Tests for workgraph.py: the strict reader, a deposited file, a store's index chain and head record, and the same bytes as the
# workgraph command where it is built. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
import io
import json
import math
import os
import shutil
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import nodetools as N  # noqa: E402
import strict as S  # noqa: E402
import workgraph as W  # noqa: E402

DEPOSIT = N.package_path("workgraph", "test", "fixtures", "graph-50.workgraph.json")
CHAIN = N.package_path("workgraph", "test", "fixtures", "frag-ledger.work-chain.json")
CASES_FILE = N.cases_file()


def cases():
    with open(CASES_FILE, "rb") as fh:
        return S.json_parse(fh.read().decode("utf-8"))


def read_text(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def write_text(p, text):
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def write_store(d, frags):
    """A store as SCHEMA.md section 9 writes it: one canonical file per frag, the chained index, the head record."""
    os.makedirs(os.path.join(d, "frags"))
    os.makedirs(os.path.join(d, "charters"))
    prev, lines = W.ZERO, []
    for i, f in enumerate(frags):
        with open(os.path.join(d, "frags", f["id"] + ".json"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(W.canonicalize(f) + "\n")
        ln = W.canonicalize({"id": f["id"], "prev": prev, "seq": i, "type": "frag"})
        lines.append(ln)
        prev = W.sha256(ln)
    text = "".join(ln + "\n" for ln in lines)
    with open(os.path.join(d, "index.jsonl"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    with open(os.path.join(d, W.STORE_HEAD_FILE), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(W.canonicalize({"bytes": len(text.encode()), "count": len(lines), "head": prev, "version": 1}) + "\n")


class StrictReaderTest(unittest.TestCase):
    def refused(self, text):
        with self.assertRaises(W.StrictJsonRefused) as cm:
            W.parse_strict(text, "f.json")
        return cm.exception.message

    def test_each_refusal_names_its_path_and_its_character_in_utf16_code_units(self):
        self.assertEqual(self.refused('{"a":{"b":1,"b":2}}'), 'f.json: the key "b" appears twice in one object (at $.a.b, character 15)')
        self.assertEqual(self.refused('{"' + chr(0x1F600) + '":[1,2,9007199254740993]}'),
                         'f.json: the number 9007199254740993 does not read back as written (it reads as 9007199254740992) (at $["' + chr(0x1F600) + '"][2], character 11)')
        self.assertEqual(self.refused('{"n":1e999}'), "f.json: the number 1e999 is not finite (at $.n, character 5)")
        # the root is level 0: 65 brackets nest 64 levels below it and read; the 66th opens level 65 and is refused where it starts
        self.assertEqual(self.refused("[" * 66 + "]" * 66), "f.json: nesting deeper than 64 levels (at $" + "[0]" * 65 + ", character 65)")
        self.assertIsInstance(W.parse_strict("[" * 65 + "]" * 65, "f"), list)
        self.assertEqual(self.refused("{} x"), "f.json: text after the value (at $, character 3)")
        self.assertEqual(self.refused(S.BOM + "{}"), "f.json: starts with a UTF-8 byte-order mark; save it without one")
        with self.assertRaises(W.StrictJsonRefused) as cm:
            W.parse_strict_bytes(b'{"a":"\xff"}', "f.json")
        self.assertEqual(cm.exception.message, "f.json: not valid UTF-8")

    def test_iso_times_parse_as_v8_parses_them(self):
        # measured 2026-10-20 with Node 25: Date.parse on each
        want = {"2026-02-30T00:00:00Z": 1772409600000, "2026-01-01T24:00:00Z": 1767312000000, "2026-01-01T00:00:00.12Z": 1767225600120,
                "0000-01-01T00:00:00Z": -62167219200000, "9999-12-31T23:59:59.999Z": 253402300799999}
        for s, ms in want.items():
            self.assertEqual(W.date_parse(s), ms, s)
        for s in ("2026-13-01T00:00:00Z", "2026-01-32T00:00:00Z", "2026-01-01T24:00:01Z", "2026-01-01T23:60:00Z", "2026-01-01T23:59:60Z"):
            self.assertTrue(math.isnan(W.date_parse(s)), s)


@unittest.skipIf(not CASES_FILE, "can't tell: work-frags.json is not in this tree")
class GraphTest(unittest.TestCase):
    def test_the_conformance_graphs_give_their_statuses_and_states(self):
        c = cases()
        for g in c["statuses"]:
            self.assertEqual(W.statuses(g["frags"]), g["expect"]["statuses"], g["name"])
        for g in c["states"]:
            self.assertEqual(W.states(g["frags"]), g["expect"]["states"], g["name"])

    def test_a_graph_refuses_a_parent_it_does_not_hold_and_a_frag_twice(self):
        frags = cases()["statuses"][0]["frags"]
        g = W.Graph()
        with self.assertRaises(W.Refused) as cm:
            g.add_frag(frags[1])
        self.assertEqual(cm.exception.code, "unknown_parent")
        g.add_frag(frags[0])
        with self.assertRaises(W.Refused) as cm:
            g.add_frag(frags[0])
        self.assertEqual(cm.exception.code, "duplicate")

    def test_a_store_written_by_the_format_s_rules_loads_and_each_tampering_is_named(self):
        g0 = cases()["statuses"][0]
        d = tempfile.mkdtemp(prefix="record-store-")
        try:
            write_store(os.path.join(d, "s"), g0["frags"])
            graph, notes = W.load_store(os.path.join(d, "s"))
            self.assertEqual({i: x["status"] for i, x in graph.statuses().items()}, g0["expect"]["statuses"])
            self.assertEqual(notes, [])
            n = len(g0["frags"])

            def variant(name, edit):
                s = os.path.join(d, name)
                shutil.copytree(os.path.join(d, "s"), s)
                edit(s)
                with self.assertRaises(W.Refused) as cm:
                    W.load_store(s)
                return cm.exception
            e = variant("bytes", lambda s: write_text(os.path.join(s, W.STORE_HEAD_FILE), read_text(os.path.join(d, "s", W.STORE_HEAD_FILE)).replace('"bytes":', '"bytes":1')))
            self.assertEqual(e.code, "store_tampered")
            self.assertIn("bytes were added to or removed from the lines it covers", e.message)

            def cut(s):
                p = os.path.join(s, "index.jsonl")
                lines = read_text(p).split("\n")
                write_text(p, "\n".join(lines[:-2]) + "\n")
            e = variant("cut", cut)
            self.assertEqual(e.message, "store: index.jsonl holds %d lines, but its head record index.jsonl.head.json says %d: the last 1 line was removed "
                                        "or the index was rewritten" % (n - 1, n))
            e = variant("missing", lambda s: os.remove(os.path.join(s, "frags", g0["frags"][0]["id"] + ".json")))
            self.assertEqual(e.message, "store: frags/%s.json is indexed but missing" % g0["frags"][0]["id"])
            write_text(os.path.join(d, "s", "frags", "e" * 64 + ".json"), "{}\n")
            self.assertEqual(W.load_store(os.path.join(d, "s"))[1],
                             ["frags/%s.json is not in the index (a write that did not finish, or a file added by hand); it is not part of the graph" % ("e" * 64)])
        finally:
            shutil.rmtree(d, ignore_errors=True)


@unittest.skipIf(not DEPOSIT, "can't tell: the workgraph package's fixtures are not in this tree")
class DepositTest(unittest.TestCase):
    def test_the_fixture_deposit_is_intact_with_an_unsigned_party_named(self):
        with open(DEPOSIT, "rb") as fh:
            r = W.open_deposit(fh.read(), "graph-50.workgraph.json")
        self.assertEqual(r["exit"], 2)
        self.assertEqual(r["lines"][0], "riposte.workgraph/0.1.0: intact, and some things cannot be told here: 50 frag(s), 1 charter(s); bundle sha256 "
                                        "982ef6dc213dcd0b36d5685d4b9208ad1fe0813f412ad6397fd4549591c4c200")
        self.assertIn("  charter b7af4a0509c3: the person party \"owner\" has not signed", r["lines"])

    def test_a_changed_byte_a_recomputed_digest_and_a_frag_chain_are_named(self):
        with open(DEPOSIT, "rb") as fh:
            raw = fh.read()
        r = W.open_deposit(raw.replace(b"edit src/part-4", b"edit src/part-X", 1), "x")
        self.assertEqual((r["exit"], r["lines"][0]), (4, W.TAMPERED))
        self.assertTrue(r["lines"][1].startswith("  bundle_sha256 does not recompute (the content hashes to "))
        d = json.loads(raw)
        d["frags"][5]["action"] = "edit something else"
        body = {k: v for k, v in d.items() if k != "bundle_sha256"}
        d["bundle_sha256"] = W.hash_of(body)
        r = W.open_deposit(json.dumps(d).encode(), "x")
        self.assertEqual(r["exit"], 4)
        self.assertTrue(r["lines"][1].startswith("  frags[5]: id_mismatch: id: does not recompute"))
        if CHAIN:
            with open(CHAIN, "rb") as fh:
                r = W.open_deposit(fh.read(), "c.json")
            self.assertEqual(r["exit"], 3)
            self.assertIn("is a frag work chain: open it with riposte-frag open", r["lines"][0])
        self.assertEqual(W.open_deposit(b"{oops", "x")["exit"], 3)

    def test_the_command_line_writes_the_lines_and_exits_with_open_s_code(self):
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(W.main(["open", DEPOSIT], out, err), 2)
        self.assertTrue(out.getvalue().startswith("riposte.workgraph/0.1.0: intact"))
        self.assertEqual(W.main(["open", "no-such.json"], out, err), 3)
        self.assertEqual(W.main(["add", "x.jsonl"], out, err), 3)


@unittest.skipIf(not (N.command("workgraph") and CASES_FILE), "can't tell: the workgraph command is not built, or no Node 20 or later")
class AgainstTheWorkgraphCommandTest(unittest.TestCase):
    """Stores built by the Node command from the conformance graphs; every reading verb in both: exit, stdout, stderr byte for byte."""

    def same(self, args, cwd):
        n = N.run(N.command("workgraph") + args, cwd=cwd)
        out, err = io.StringIO(), io.StringIO()
        code = W.main(args, out, err, env={}, cwd=cwd)
        self.assertEqual((code, out.getvalue().encode("utf-8"), err.getvalue().encode("utf-8")), n, args)

    def test_every_reading_verb_agrees_on_the_conformance_graphs(self):
        d = tempfile.mkdtemp(prefix="record-wg-")
        try:
            c = cases()
            for k, g in enumerate(c["statuses"] + c["states"]):
                src = os.path.join(d, "g%d.jsonl" % k)
                with open(src, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write("".join(json.dumps(f) + "\n" for f in g["frags"]))
                store = "s%d" % k
                self.assertEqual(N.run(N.command("workgraph") + ["add", src, "--store", store], cwd=d)[0], 0)
                self.assertEqual(N.run(N.command("workgraph") + ["deposit", "--store", store, "--out", store + ".workgraph.json"], cwd=d)[0], 0)
                self.same(["status", "--store", store], d)
                self.same(["status", "--json", "--store", store], d)
                self.same(["open", store + ".workgraph.json"], d)
                self.same(["open", store + ".workgraph.json", "--json"], d)
                for f in g["frags"]:
                    self.same(["digest", f["id"], "--detail", "--store", store], d)
            self.same(["open", DEPOSIT], d)
            self.same(["status", "--store", "nowhere"], d)
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
