# Tests for ed25519.py: RFC 8032's own vectors, the refusals, real signatures from the receipts fixtures. prototype; no measured accuracy.
# SPDX-License-Identifier: Apache-2.0
import base64
import json
import os
import sys
import unittest

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ed25519 as E  # noqa: E402
import nodetools as N  # noqa: E402

# RFC 8032, section 7.1 ("Test Vectors for Ed25519"), TEST 1 to TEST 3: secret key, public key, message, signature
RFC8032 = [
    ("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "",
     "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"),
    ("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "72",
     "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00"),
    ("c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7", "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025", "af82",
     "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a"),
]
LEDGER = N.package_path("receipts", "test", "fixtures", "ledger-cold-review-2026-10-13", "receipts.jsonl")
PUB = N.package_path("receipts", "test", "fixtures", "ledger-cold-review-2026-10-13", "pub.pem")
# measured 2026-10-20 with node packages/receipts/dist/ledger-cli.js fingerprint on that pub.pem
PUB_FINGERPRINT = "9aede853947cec4f4a135819d1d6390f4ee2054adee88de52cf3e40da44015e7"


def pkcs8_pem(seed):
    b = base64.b64encode(E.PKCS8_PREFIX + seed).decode("ascii")
    return "-----BEGIN PRIVATE KEY-----\n%s\n-----END PRIVATE KEY-----\n" % b


class Rfc8032Test(unittest.TestCase):
    def test_the_rfc_s_three_vectors_give_its_public_keys_and_signatures(self):
        for secret, public, msg, sig in RFC8032:
            sk, pk, m, s = bytes.fromhex(secret), bytes.fromhex(public), bytes.fromhex(msg), bytes.fromhex(sig)
            self.assertEqual(E.secret_to_public(sk), pk)
            self.assertEqual(E.sign(sk, m), s)
            self.assertTrue(E.verify(pk, m, s))

    def test_a_changed_message_or_signature_or_key_does_not_verify(self):
        _, public, msg, sig = RFC8032[1]
        pk, m, s = bytes.fromhex(public), bytes.fromhex(msg), bytes.fromhex(sig)
        self.assertFalse(E.verify(pk, m + b"x", s))
        self.assertFalse(E.verify(pk, m, s[:-1] + bytes([s[-1] ^ 1])))
        self.assertFalse(E.verify(bytes.fromhex(RFC8032[0][1]), m, s))
        self.assertFalse(E.verify(pk, m, s[:63]))

    def test_s_at_or_past_the_group_order_is_refused(self):
        _, public, msg, sig = RFC8032[0]
        s = bytes.fromhex(sig)
        big = int.from_bytes(s[32:], "little") + E.q
        self.assertFalse(E.verify(bytes.fromhex(public), bytes.fromhex(msg), s[:32] + big.to_bytes(32, "little")))

    def test_an_encoding_with_y_past_p_is_refused(self):
        self.assertIsNone(E.point_decompress((E.p + 1).to_bytes(32, "little")))


class KeysTest(unittest.TestCase):
    def test_a_private_key_pem_gives_its_public_key_as_node_s_createpublickey_does(self):
        secret, public, _, _ = RFC8032[0]
        self.assertEqual(E.public_key_bytes(pkcs8_pem(bytes.fromhex(secret))), bytes.fromhex(public))
        pem = E.spki_pem(bytes.fromhex(public))
        self.assertEqual(E.public_key_bytes(pem), bytes.fromhex(public))
        self.assertTrue(pem.startswith("-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA"))

    def test_another_algorithm_s_public_key_is_named_as_not_ed25519(self):
        # a SubjectPublicKeyInfo naming rsaEncryption (1.2.840.113549.1.1.1) with a stub key: read as a key, refused as not Ed25519
        alg = bytes.fromhex("300d06092a864886f70d0101010500")
        bits = bytes.fromhex("0305003003020101")
        body = alg + bits
        der = bytes([0x30, len(body)]) + body
        pem = "-----BEGIN PUBLIC KEY-----\n%s\n-----END PUBLIC KEY-----\n" % base64.b64encode(der).decode()
        with self.assertRaises(E.KeyError_) as cm:
            E.public_key_bytes(pem)
        self.assertIn("not Ed25519", str(cm.exception))
        with self.assertRaises(E.KeyError_):
            E.public_key_bytes("not a key")

    def test_base64_is_read_as_node_reads_it(self):
        self.assertEqual(E.b64decode_lenient("aGk="), b"hi")
        self.assertEqual(E.b64decode_lenient("aGk"), b"hi")
        self.assertEqual(E.b64decode_lenient("a G\nk="), b"hi")
        self.assertEqual(E.b64decode_lenient("-_8="), base64.b64decode("+/8="))


@unittest.skipIf(not LEDGER, "can't tell: the receipts package's fixtures are not in this tree")
class FixtureSignaturesTest(unittest.TestCase):
    def test_every_signature_of_the_cold_review_ledger_verifies_and_its_key_has_the_receipts_fingerprint(self):
        with open(LEDGER, encoding="utf-8") as fh:
            entries = [json.loads(line) for line in fh if line.strip()]
        self.assertEqual(len(entries), 5)
        for e in entries:
            s = e["signature"]
            self.assertTrue(E.verify_pem(s["public_key"], e["hash"].encode(), s["sig"]), e["seq"])
            self.assertFalse(E.verify_pem(s["public_key"], (e["hash"][:-1] + "0").encode() if e["hash"][-1] != "0" else e["hash"][:-1].encode() + b"1", s["sig"]))
        with open(PUB, encoding="utf-8") as fh:
            self.assertEqual(E.key_fingerprint(fh.read()), PUB_FINGERPRINT)

    @unittest.skipIf(not N.command("receipts"), "can't tell: the receipts command is not built, or no Node 20 or later")
    def test_the_fingerprint_is_the_one_riposte_ledger_prints(self):
        code, out, _ = N.run(N.command("receipts") + ["fingerprint", PUB])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["fingerprint"], PUB_FINGERPRINT)


if __name__ == "__main__":
    unittest.main()
