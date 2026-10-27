# Tests for forecast.py: forecasts sealed here and re-performed here, the forecast vectors, and the same bytes as the Node command
# where it is built. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import forecast as FC  # noqa: E402
import nodetools as N  # noqa: E402

SALT = hashlib.sha256(b"forecast python test salt").hexdigest()
Q = ("kalshi:KXEXAMPLE-26DEC31", "https://external-api.kalshi.com/trade-api/v2/markets/KXEXAMPLE-26DEC31", "2026-12-31T00:00:00Z")


def proof_over(digest_hex):
    uri = b"https://a.pool.opentimestamps.org"
    payload = bytes([len(uri)]) + uri
    return FC.OTS_MAGIC + b"\x01\x08" + bytes.fromhex(digest_hex) + b"\x00" + bytes.fromhex("83dfe30d2ef90c8e") + bytes([len(payload)]) + payload


def resealed(r, **change):
    t = dict(r, **change)
    t["id"] = FC.reveal_id_of(t)
    return t


class SealAndVerify(unittest.TestCase):
    def setUp(self):
        self.c, self.r = FC.seal(0.61, *Q, salt=SALT)

    def test_ids_digest_and_stamp_input(self):
        self.assertEqual(self.c["id"], FC.commit_id_of(self.c))
        self.assertEqual(self.r["id"], FC.reveal_id_of(self.r))
        self.assertEqual(hashlib.sha256(FC.commit_stamp_bytes(self.c)).hexdigest(), self.c["id"])
        self.assertEqual(self.r["commit_ref"], self.c["id"])
        self.assertEqual(FC.shape_problems(self.c, "commit"), [])
        self.assertEqual(FC.shape_problems(self.r, "reveal"), [])

    def test_every_exit(self):
        p = proof_over(self.c["id"])
        self.assertEqual(FC.verify(self.c, self.r, proof=p, attested_time="2026-10-27T01:00:00Z", outcome="no")["exit"], 0)
        self.assertEqual(FC.verify(self.c, self.r, proof=p, attested_time="2026-12-31T00:00:00Z")["exit"], 1)
        self.assertEqual(FC.verify(self.c, self.r, proof=p, attested_time="2026-11-20T00:00:00Z", closed_at="2026-11-15T00:00:00Z")["exit"], 1)
        self.assertEqual(FC.verify(self.c, self.r)["exit"], 2)
        self.assertEqual(FC.verify(self.r, self.c)["exit"], 3)
        self.assertEqual(FC.verify(self.c, resealed(self.r, p=0.62))["exit"], 4)
        k = FC.verify(self.c, self.r, proof=proof_over(hashlib.sha256(b"other").hexdigest()))
        self.assertEqual(k["exit"], 4)
        self.assertEqual(FC.sheet(k)[1], FC.FORECAST_TAMPERED)

    def test_brier(self):
        k = FC.verify(self.c, self.r, proof=proof_over(self.c["id"]), attested_time="2026-10-27T01:00:00Z", outcome="no")
        self.assertEqual(k["brier"], 0.61 * 0.61)

    def test_iso_rule(self):
        self.assertTrue(FC.is_iso_utc("2028-02-29T12:00:00Z"))
        for bad in ("2026-02-29T12:00:00Z", "2026-02-30T00:00:00Z", "2026-01-01T24:00:00Z", "٢٠٢٦-01-01T00:00:00Z", "1999-12-31T23:59:59Z"):
            self.assertFalse(FC.is_iso_utc(bad), bad)
        self.assertEqual(FC.iso_ms("2026-01-01T00:00:00.5Z"), 1767225600500)


class Vectors(unittest.TestCase):
    def test_every_case(self):
        path = FC.default_vectors()
        if not path:
            self.skipTest("can't tell: vectors-forecast-0.1.0.json is not beside conformance/record in this tree")
        with open(path, encoding="utf-8") as fh:
            passed, failures = FC.run_vectors(json.load(fh))
        self.assertEqual(failures, [])
        self.assertGreater(passed, 0)


class AgainstNode(unittest.TestCase):
    """Sealed here, verified by the Node command: the same exit and the same bytes."""

    def test_same_bytes_as_node(self):
        cmd = N.command("frag")
        if not cmd:
            self.skipTest("can't tell: the frag package is not built, or no Node 20.6+ is found")
        d = tempfile.mkdtemp(prefix="forecast-py-node-")
        try:
            c, r = FC.seal(0.61, *Q, salt=SALT)
            for name, obj in (("c.json", c), ("r.json", r), ("t.json", resealed(r, p=0.62))):
                with open(os.path.join(d, name), "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(FC.pretty(obj) + "\n")
            with open(os.path.join(d, "p.ots"), "wb") as fh:
                fh.write(proof_over(c["id"]))
            cases = [
                (["c.json", "r.json", "--ots", "p.ots", "--attested", "2026-10-27T01:00:00Z", "--outcome", "no"], 0),
                (["c.json", "r.json", "--ots", "p.ots", "--attested", "2027-01-02T00:00:00Z"], 1),
                (["c.json", "r.json"], 2),
                (["r.json", "c.json"], 3),
                (["c.json", "t.json"], 4),
            ]
            for args, want in cases:
                for extra in ([], ["--json"]):
                    code, out, err = N.run(cmd + ["forecast", "verify"] + args + extra, cwd=d)
                    self.assertEqual(code, want, (args, err))
                    buf = io.StringIO()
                    cwd = os.getcwd()
                    os.chdir(d)
                    try:
                        with redirect_stdout(buf):
                            py = FC.main(["verify"] + args + extra)
                    finally:
                        os.chdir(cwd)
                    self.assertEqual(py, want, args)
                    self.assertEqual(out.decode("utf-8"), buf.getvalue(), (args, extra))
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
